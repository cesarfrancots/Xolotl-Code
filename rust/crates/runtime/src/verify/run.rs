//! Running verify commands and turning failures into a model-facing digest
//! (CP 3.2, T-3.2.2).
//!
//! The runner is a trait so the in-loop verification step can be unit-tested
//! with canned results instead of spawning real `cargo`/`tsc`/`pytest`.

use std::fmt::Write as _;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::{
    format_digest, parse_check_output, resolve_verify_commands, VerifyCommand, VerifyCommands,
};
use crate::config::RuntimeConfig;
use crate::json::JsonValue;

/// Outcome of running a single verify command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifyOutcome {
    pub success: bool,
    pub output: String,
}

/// Runs a verify command. Abstracted so the conversation loop can be tested
/// without spawning real subprocesses.
pub trait VerifyRunner: Send + Sync {
    fn run(&self, command: &VerifyCommand, dir: &Path, timeout: Duration) -> VerifyOutcome;
}

/// Production runner: spawns the command as a subprocess with a best-effort
/// timeout, draining stdout/stderr on threads to avoid pipe-buffer deadlock.
#[derive(Debug, Clone, Copy)]
pub struct ProcessVerifyRunner;

impl VerifyRunner for ProcessVerifyRunner {
    fn run(&self, command: &VerifyCommand, dir: &Path, timeout: Duration) -> VerifyOutcome {
        let mut child = match Command::new(&command.program)
            .args(&command.args)
            .current_dir(dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(error) => {
                return VerifyOutcome {
                    success: false,
                    output: format!("failed to run `{}`: {error}", command.display()),
                };
            }
        };

        // Drain stdout/stderr on detached threads that send their result over a
        // channel. We never `join` them: if the killed command left grandchildren
        // (rustc, node, pytest workers) holding the pipe write-ends, `read_to_string`
        // would block until those exit. Bounding the collection with `recv_timeout`
        // guarantees the runner returns within `timeout + grace` regardless.
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let (out_tx, out_rx) = std::sync::mpsc::channel();
        let (err_tx, err_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = out_tx.send(read_all(stdout));
        });
        std::thread::spawn(move || {
            let _ = err_tx.send(read_all(stderr));
        });

        let start = Instant::now();
        let mut exit_success = false;
        let timed_out = loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    exit_success = status.success();
                    break false;
                }
                Ok(None) => {
                    if start.elapsed() >= timeout {
                        let _ = child.kill();
                        let _ = child.wait();
                        break true;
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break true;
                }
            }
        };

        // Grace period to collect output after the process exits or is killed.
        let grace = Duration::from_secs(2);
        let mut output = out_rx.recv_timeout(grace).unwrap_or_default();
        let err = err_rx.recv_timeout(grace).unwrap_or_default();
        if !err.is_empty() {
            if !output.is_empty() {
                output.push('\n');
            }
            output.push_str(&err);
        }
        if timed_out {
            let _ = write!(
                output,
                "\n[verification timed out after {}s]",
                timeout.as_secs()
            );
        }
        VerifyOutcome {
            success: !timed_out && exit_success,
            output,
        }
    }
}

fn read_all(stream: Option<impl Read>) -> String {
    let mut buf = String::new();
    if let Some(mut s) = stream {
        let _ = s.read_to_string(&mut buf);
    }
    buf
}

/// Configuration for the in-loop post-edit verification step (CP 3.2).
///
/// Absent from the runtime by default, so verification is fully opt-in and the
/// Claude/Bedrock happy path is unchanged unless a caller enables it.
#[derive(Clone)]
pub struct VerifyConfig {
    /// Resolved commands; `post_edit_check()` selects the one that runs.
    pub commands: VerifyCommands,
    /// Directory to run the check in.
    pub workdir: PathBuf,
    /// Best-effort wall-clock timeout per run.
    pub timeout: Duration,
    /// Minimum loop iterations between two runs (debounce). 1 = every edit turn.
    pub min_iterations_between: usize,
    /// Max diagnostics included in the digest.
    pub max_diagnostics: usize,
    runner: Arc<dyn VerifyRunner>,
}

impl VerifyConfig {
    /// Build a config with sensible guardrail defaults (90s timeout, run on
    /// every edit-applying turn, 10-diagnostic digest cap).
    #[must_use]
    pub fn new(
        commands: VerifyCommands,
        workdir: impl Into<PathBuf>,
        runner: Arc<dyn VerifyRunner>,
    ) -> Self {
        Self {
            commands,
            workdir: workdir.into(),
            timeout: Duration::from_secs(90),
            min_iterations_between: 1,
            max_diagnostics: 10,
            runner,
        }
    }

    /// Build a config from merged `.claude/settings.json`, or `None` when
    /// post-edit verification is not explicitly enabled (the default — keeping
    /// the Claude/Bedrock happy path unchanged).
    ///
    /// Enabled by `verify.post_edit: true` (or `verify.enabled: true`). The same
    /// `verify` object supplies command overrides (`build`/`test`/`typecheck`)
    /// and optional `timeout_secs` / `min_iterations_between`.
    #[must_use]
    pub fn from_settings(cwd: impl Into<PathBuf>, config: &RuntimeConfig) -> Option<Self> {
        let cwd = cwd.into();
        let verify = config.get("verify")?;
        let obj = verify.as_object()?;
        let enabled = obj
            .get("post_edit")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false)
            || obj
                .get("enabled")
                .and_then(JsonValue::as_bool)
                .unwrap_or(false);
        if !enabled {
            return None;
        }
        let commands = resolve_verify_commands(&cwd, Some(verify));
        let mut cfg = Self::new(commands, cwd, Arc::new(ProcessVerifyRunner));
        if let Some(secs) = obj.get("timeout_secs").and_then(JsonValue::as_i64) {
            if secs > 0 {
                cfg.timeout = Duration::from_secs(secs.unsigned_abs());
            }
        }
        if let Some(n) = obj
            .get("min_iterations_between")
            .and_then(JsonValue::as_i64)
        {
            if let Ok(n) = usize::try_from(n) {
                if n >= 1 {
                    cfg.min_iterations_between = n;
                }
            }
        }
        Some(cfg)
    }

    #[must_use]
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    #[must_use]
    pub fn with_min_iterations_between(mut self, n: usize) -> Self {
        self.min_iterations_between = n;
        self
    }

    /// Run the post-edit check.
    ///
    /// Returns `None` when there is no check command to run; `Some(Ok(()))` when
    /// it passed; `Some(Err(digest))` with a compact failure digest otherwise.
    #[must_use]
    pub fn run_post_edit(&self) -> Option<Result<(), String>> {
        let command = self.commands.post_edit_check()?;
        let outcome = self.runner.run(command, &self.workdir, self.timeout);
        if outcome.success {
            return Some(Ok(()));
        }
        let diagnostics = parse_check_output(self.commands.kind, &outcome.output);
        let digest = if diagnostics.is_empty() {
            tail_lines(&outcome.output, 20)
        } else {
            format_digest(&diagnostics, self.max_diagnostics)
        };
        Some(Err(digest))
    }
}

/// Keep the last `n` non-empty lines of `text` (a fallback when no structured
/// diagnostics could be parsed).
fn tail_lines(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}

#[cfg(test)]
mod tests {
    use super::{tail_lines, ProcessVerifyRunner, VerifyConfig, VerifyOutcome, VerifyRunner};
    use crate::verify::{ProjectKind, VerifyCommand, VerifyCommands};
    use std::path::Path;
    use std::sync::Arc;
    use std::time::Duration;

    struct CannedRunner(VerifyOutcome);
    impl VerifyRunner for CannedRunner {
        fn run(&self, _c: &VerifyCommand, _d: &Path, _t: Duration) -> VerifyOutcome {
            self.0.clone()
        }
    }

    fn rust_commands() -> VerifyCommands {
        VerifyCommands {
            kind: ProjectKind::Rust,
            build: None,
            test: None,
            typecheck: Some(VerifyCommand {
                program: "cargo".to_string(),
                args: vec!["check".to_string()],
            }),
        }
    }

    #[test]
    fn run_post_edit_passes() {
        let runner = Arc::new(CannedRunner(VerifyOutcome {
            success: true,
            output: String::new(),
        }));
        let config = VerifyConfig::new(rust_commands(), ".", runner);
        assert_eq!(config.run_post_edit(), Some(Ok(())));
    }

    #[test]
    fn run_post_edit_failure_produces_diagnostic_digest() {
        let runner = Arc::new(CannedRunner(VerifyOutcome {
            success: false,
            output: "error[E0425]: cannot find value `x`\n  --> src/main.rs:3:13\n".to_string(),
        }));
        let config = VerifyConfig::new(rust_commands(), ".", runner);
        let Some(Err(digest)) = config.run_post_edit() else {
            panic!("expected a failure digest");
        };
        assert!(digest.contains("src/main.rs:3"));
        assert!(digest.contains("cannot find value"));
    }

    #[test]
    fn run_post_edit_none_when_no_check_command() {
        let commands = VerifyCommands {
            kind: ProjectKind::Unknown,
            build: None,
            test: None,
            typecheck: None,
        };
        let runner = Arc::new(CannedRunner(VerifyOutcome {
            success: false,
            output: "ignored".to_string(),
        }));
        let config = VerifyConfig::new(commands, ".", runner);
        assert_eq!(config.run_post_edit(), None);
    }

    #[test]
    fn failure_without_parseable_diagnostics_falls_back_to_tail() {
        let runner = Arc::new(CannedRunner(VerifyOutcome {
            success: false,
            output: "linker failed\nsome opaque error\n".to_string(),
        }));
        let config = VerifyConfig::new(rust_commands(), ".", runner);
        let Some(Err(digest)) = config.run_post_edit() else {
            panic!("expected a failure digest");
        };
        assert!(digest.contains("opaque error"));
    }

    #[cfg(unix)]
    #[test]
    fn process_runner_does_not_hang_when_grandchild_holds_the_pipe() {
        // `sh` exits immediately but the backgrounded `sleep` inherits stdout and
        // keeps the pipe open. The channel-bounded reads must return within the
        // grace period rather than blocking until the grandchild exits.
        let start = std::time::Instant::now();
        let outcome = ProcessVerifyRunner.run(
            &VerifyCommand {
                program: "sh".to_string(),
                args: vec!["-c".to_string(), "sleep 10 &".to_string()],
            },
            Path::new("."),
            Duration::from_secs(30),
        );
        assert!(
            start.elapsed() < Duration::from_secs(6),
            "runner hung on a grandchild holding the pipe"
        );
        let _ = outcome;
    }

    #[test]
    fn process_runner_reports_spawn_failure() {
        // A non-existent program yields a non-success outcome rather than panicking.
        let outcome = ProcessVerifyRunner.run(
            &VerifyCommand {
                program: "definitely-not-a-real-program-xyz".to_string(),
                args: vec![],
            },
            Path::new("."),
            Duration::from_secs(5),
        );
        assert!(!outcome.success);
    }

    #[test]
    fn tail_lines_keeps_last_n_nonempty() {
        let text = "a\n\nb\nc\nd\n";
        assert_eq!(tail_lines(text, 2), "c\nd");
    }

    #[test]
    fn from_settings_disabled_by_default_and_when_flag_absent() {
        use crate::config::ConfigLoader;
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        std::fs::create_dir_all(&home).unwrap();
        // No settings at all → None.
        let config = ConfigLoader::new(dir.path(), &home).load().unwrap();
        assert!(VerifyConfig::from_settings(dir.path(), &config).is_none());

        // verify object present but post_edit not set → None (control).
        let claude = dir.path().join(".claude");
        std::fs::create_dir_all(&claude).unwrap();
        std::fs::write(
            claude.join("settings.json"),
            "{\"verify\":{\"typecheck\":\"cargo check\"}}",
        )
        .unwrap();
        let config = ConfigLoader::new(dir.path(), &home).load().unwrap();
        assert!(VerifyConfig::from_settings(dir.path(), &config).is_none());
    }

    #[test]
    fn from_settings_enabled_builds_config_with_overrides() {
        use crate::config::ConfigLoader;
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::write(dir.path().join("Cargo.toml"), "").unwrap();
        let claude = dir.path().join(".claude");
        std::fs::create_dir_all(&claude).unwrap();
        std::fs::write(
            claude.join("settings.json"),
            "{\"verify\":{\"post_edit\":true,\"timeout_secs\":45}}",
        )
        .unwrap();
        let config = ConfigLoader::new(dir.path(), &home).load().unwrap();
        let cfg = VerifyConfig::from_settings(dir.path(), &config).expect("enabled");
        assert_eq!(cfg.timeout, Duration::from_secs(45));
        // Rust project default check resolved.
        assert_eq!(
            cfg.commands.post_edit_check().map(VerifyCommand::display),
            Some("cargo check".to_string())
        );
    }
}
