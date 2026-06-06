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
    cwd: String,
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
    pub cwd: String,
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

/// Default interactive shell for the platform.
fn default_shell() -> String {
    if cfg!(windows) {
        "powershell.exe".to_string()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
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
        let shell = shell
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(default_shell);
        let pty = native_pty_system();
        let pair = pty
            .openpty(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("openpty failed: {e}"))?;

        let mut cmd = CommandBuilder::new(&shell);
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
            .map_err(|e| format!("failed to spawn '{shell}': {e}"))?;
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
            shell: shell.clone(),
            cwd: cwd_str.clone(),
        };
        self.sessions.lock().map_err(|e| e.to_string())?.insert(
            id,
            TerminalSession {
                writer,
                master: pair.master,
                child,
                shell,
                cwd: cwd_str,
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
                        cwd: s.cwd.clone(),
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
