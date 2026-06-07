//! Integrated terminals.
//!
//! Each terminal is a real PTY-backed shell (ConPTY on Windows, openpty on
//! Unix) via `portable-pty`. A reader thread streams the PTY's output to the
//! frontend as base64 over the `terminal://output` event; the frontend writes
//! keystrokes back through [`terminal_write`]. Multiple terminals run
//! concurrently, keyed by id — the basis for running several shells / agent
//! CLIs (xolotl, claude, aider, …) side by side against one project.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::process::Command as ProcessCommand;
use std::sync::Mutex;

use base64::Engine as _;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

/// One live PTY session. Held behind the manager's mutex.
struct TerminalSession {
    /// Writer half of the PTY master — keystrokes go here.
    writer: Box<dyn Write + Send>,
    /// Master PTY, retained for resize.
    master: Box<dyn MasterPty + Send>,
    /// Child shell process, retained so it can be killed.
    child: Box<dyn portable_pty::Child + Send + Sync>,
    shell: String,
    shell_name: String,
    cwd: String,
    env_source: String,
}

/// Tauri-managed registry of live terminals.
#[derive(Default)]
pub struct TerminalManager {
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

/// Metadata for one terminal, returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct TerminalInfo {
    pub id: String,
    pub shell: String,
    pub shell_name: String,
    pub cwd: String,
    pub env_source: String,
}

#[derive(Clone, Serialize)]
struct TerminalOutput {
    id: String,
    /// Base64-encoded raw PTY bytes (output may not be valid UTF-8 mid-chunk).
    data: String,
}

#[derive(Clone, Serialize)]
struct TerminalExit {
    id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ShellPlatform {
    Windows,
    Macos,
    Unix,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ShellProfile {
    command: String,
    shell_name: String,
    shell_args: Vec<String>,
    env_source: String,
}

fn current_shell_platform() -> ShellPlatform {
    if cfg!(windows) {
        ShellPlatform::Windows
    } else if cfg!(target_os = "macos") {
        ShellPlatform::Macos
    } else {
        ShellPlatform::Unix
    }
}

fn shell_display_name(command: &str) -> String {
    let name = Path::new(command)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(command)
        .trim();
    if name.eq_ignore_ascii_case("powershell.exe") || name.eq_ignore_ascii_case("powershell") {
        "PowerShell".to_string()
    } else if name.eq_ignore_ascii_case("pwsh.exe") || name.eq_ignore_ascii_case("pwsh") {
        "PowerShell".to_string()
    } else if name.is_empty() {
        command.to_string()
    } else {
        name.trim_end_matches(".exe").to_string()
    }
}

fn macos_login_shell_args(shell_name: &str) -> Vec<String> {
    if matches!(shell_name, "zsh" | "bash" | "fish") {
        vec!["-l".to_string()]
    } else {
        Vec::new()
    }
}

fn fallback_shell(platform: ShellPlatform) -> String {
    match platform {
        ShellPlatform::Windows => "powershell.exe".to_string(),
        ShellPlatform::Macos => {
            if Path::new("/bin/zsh").exists() {
                "/bin/zsh".to_string()
            } else {
                "/bin/bash".to_string()
            }
        }
        ShellPlatform::Unix => "/bin/bash".to_string(),
    }
}

#[cfg(target_os = "macos")]
fn read_macos_login_shell() -> Option<String> {
    let user = std::env::var("USER").ok()?;
    let output = ProcessCommand::new("/usr/bin/dscl")
        .args([".", "-read", &format!("/Users/{user}"), "UserShell"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout)
        .ok()
        .and_then(|stdout| stdout.split_whitespace().last().map(str::to_string))
        .filter(|shell| !shell.trim().is_empty())
}

#[cfg(not(target_os = "macos"))]
fn read_macos_login_shell() -> Option<String> {
    None
}

fn shell_profile_from_inputs(
    requested: Option<String>,
    env_shell: Option<String>,
    login_shell: Option<String>,
    platform: ShellPlatform,
) -> ShellProfile {
    if let Some(shell) = requested
        .map(|shell| shell.trim().to_string())
        .filter(|shell| !shell.is_empty())
    {
        return ShellProfile {
            shell_name: shell_display_name(&shell),
            command: shell,
            shell_args: Vec::new(),
            env_source: "Inherited app environment + requested shell".to_string(),
        };
    }

    let (command, source) = if platform == ShellPlatform::Windows {
        (fallback_shell(platform), "platform default")
    } else if let Some(shell) = env_shell
        .map(|shell| shell.trim().to_string())
        .filter(|shell| !shell.is_empty())
    {
        (shell, "$SHELL")
    } else if platform == ShellPlatform::Macos {
        if let Some(shell) = login_shell
            .map(|shell| shell.trim().to_string())
            .filter(|shell| !shell.is_empty())
        {
            (shell, "macOS login shell")
        } else {
            (fallback_shell(platform), "platform default")
        }
    } else {
        (fallback_shell(platform), "platform default")
    };

    let shell_name = shell_display_name(&command);
    let shell_args = if platform == ShellPlatform::Macos {
        macos_login_shell_args(&shell_name)
    } else {
        Vec::new()
    };
    ShellProfile {
        command,
        shell_name,
        shell_args,
        env_source: format!("Inherited app environment + {source}"),
    }
}

fn resolve_shell_profile(shell: Option<String>) -> ShellProfile {
    shell_profile_from_inputs(
        shell,
        std::env::var("SHELL").ok(),
        read_macos_login_shell(),
        current_shell_platform(),
    )
}

impl TerminalManager {
    /// Spawn a new shell in a PTY and start streaming its output.
    fn spawn(
        &self,
        app: &AppHandle,
        cwd: Option<String>,
        shell: Option<String>,
        cols: u16,
        rows: u16,
    ) -> Result<TerminalInfo, String> {
        let shell_profile = resolve_shell_profile(shell);
        let pty = native_pty_system();
        let pair = pty
            .openpty(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("openpty failed: {e}"))?;

        let mut cmd = CommandBuilder::new(&shell_profile.command);
        for arg in &shell_profile.shell_args {
            cmd.arg(arg);
        }
        let cwd_str = cwd
            .filter(|d| !d.trim().is_empty())
            .or_else(|| {
                std::env::current_dir()
                    .ok()
                    .map(|p| p.to_string_lossy().into_owned())
            })
            .unwrap_or_default();
        if !cwd_str.is_empty() {
            cmd.cwd(&cwd_str);
        }
        // Inherit the full parent environment (PATH, etc.).
        for (key, value) in std::env::vars() {
            cmd.env(key, value);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("failed to spawn '{}': {e}", shell_profile.command))?;
        // Drop the slave so the master sees EOF when the child exits.
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("failed to clone pty reader: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("failed to take pty writer: {e}"))?;

        let id = uuid::Uuid::new_v4().to_string();

        // Reader thread: stream output, then announce exit and self-clean.
        let app_for_reader = app.clone();
        let id_for_reader = id.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let data = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                        let _ = app_for_reader.emit(
                            "terminal://output",
                            TerminalOutput {
                                id: id_for_reader.clone(),
                                data,
                            },
                        );
                    }
                }
            }
            let _ = app_for_reader.emit(
                "terminal://exit",
                TerminalExit {
                    id: id_for_reader.clone(),
                },
            );
            // Remove the finished session so the registry doesn't leak.
            if let Some(manager) = app_for_reader.try_state::<TerminalManager>() {
                if let Ok(mut sessions) = manager.sessions.lock() {
                    sessions.remove(&id_for_reader);
                }
            }
        });

        let info = TerminalInfo {
            id: id.clone(),
            shell: shell_profile.command.clone(),
            shell_name: shell_profile.shell_name.clone(),
            cwd: cwd_str.clone(),
            env_source: shell_profile.env_source.clone(),
        };
        self.sessions.lock().map_err(|e| e.to_string())?.insert(
            id,
            TerminalSession {
                writer,
                master: pair.master,
                child,
                shell: shell_profile.command,
                shell_name: shell_profile.shell_name,
                cwd: cwd_str,
                env_source: shell_profile.env_source,
            },
        );
        Ok(info)
    }

    fn write(&self, id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions.get_mut(id).ok_or("unknown terminal id")?;
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())
    }

    fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions.get(id).ok_or("unknown terminal id")?;
        session
            .master
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    fn kill(&self, id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        if let Some(mut session) = sessions.remove(id) {
            let _ = session.child.kill();
        }
        Ok(())
    }

    fn list(&self) -> Vec<TerminalInfo> {
        self.sessions
            .lock()
            .map(|sessions| {
                sessions
                    .iter()
                    .map(|(id, s)| TerminalInfo {
                        id: id.clone(),
                        shell: s.shell.clone(),
                        shell_name: s.shell_name.clone(),
                        cwd: s.cwd.clone(),
                        env_source: s.env_source.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
}

/// Spawn a new terminal. Returns its metadata (including the generated id).
#[tauri::command]
#[specta::specta]
pub fn terminal_spawn(
    manager: tauri::State<'_, TerminalManager>,
    app_handle: AppHandle,
    cwd: Option<String>,
    shell: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<TerminalInfo, String> {
    manager.spawn(&app_handle, cwd, shell, cols, rows)
}

/// Write input (keystrokes) to a terminal.
#[tauri::command]
#[specta::specta]
pub fn terminal_write(
    manager: tauri::State<'_, TerminalManager>,
    id: String,
    data: String,
) -> Result<(), String> {
    manager.write(&id, &data)
}

/// Resize a terminal's PTY.
#[tauri::command]
#[specta::specta]
pub fn terminal_resize(
    manager: tauri::State<'_, TerminalManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager.resize(&id, cols, rows)
}

/// Kill a terminal and remove it from the registry.
#[tauri::command]
#[specta::specta]
pub fn terminal_kill(manager: tauri::State<'_, TerminalManager>, id: String) -> Result<(), String> {
    manager.kill(&id)
}

/// List all live terminals.
#[tauri::command]
#[specta::specta]
pub fn terminal_list(manager: tauri::State<'_, TerminalManager>) -> Vec<TerminalInfo> {
    manager.list()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_profile_uses_requested_shell_without_login_args() {
        let profile = shell_profile_from_inputs(
            Some("/opt/homebrew/bin/fish".to_string()),
            Some("/bin/zsh".to_string()),
            Some("/bin/bash".to_string()),
            ShellPlatform::Macos,
        );

        assert_eq!(profile.command, "/opt/homebrew/bin/fish");
        assert_eq!(profile.shell_name, "fish");
        assert!(profile.shell_args.is_empty());
        assert_eq!(
            profile.env_source,
            "Inherited app environment + requested shell"
        );
    }

    #[test]
    fn macos_shell_profile_prefers_shell_env_and_uses_login_shell_args() {
        let profile = shell_profile_from_inputs(
            None,
            Some("/bin/zsh".to_string()),
            Some("/bin/bash".to_string()),
            ShellPlatform::Macos,
        );

        assert_eq!(profile.command, "/bin/zsh");
        assert_eq!(profile.shell_name, "zsh");
        assert_eq!(profile.shell_args, vec!["-l"]);
        assert_eq!(profile.env_source, "Inherited app environment + $SHELL");
    }

    #[test]
    fn macos_shell_profile_uses_login_shell_when_shell_env_is_missing() {
        let profile = shell_profile_from_inputs(
            None,
            None,
            Some("/opt/homebrew/bin/fish".to_string()),
            ShellPlatform::Macos,
        );

        assert_eq!(profile.command, "/opt/homebrew/bin/fish");
        assert_eq!(profile.shell_name, "fish");
        assert_eq!(profile.shell_args, vec!["-l"]);
        assert_eq!(
            profile.env_source,
            "Inherited app environment + macOS login shell"
        );
    }

    #[test]
    fn unix_shell_profile_uses_platform_fallback_without_login_args() {
        let profile = shell_profile_from_inputs(None, None, None, ShellPlatform::Unix);

        assert_eq!(profile.command, "/bin/bash");
        assert_eq!(profile.shell_name, "bash");
        assert!(profile.shell_args.is_empty());
        assert_eq!(
            profile.env_source,
            "Inherited app environment + platform default"
        );
    }

    #[test]
    fn powershell_display_name_is_normalized() {
        assert_eq!(shell_display_name("powershell.exe"), "PowerShell");
        assert_eq!(shell_display_name("pwsh"), "PowerShell");
        assert_eq!(shell_display_name("/bin/bash"), "bash");
    }
}
