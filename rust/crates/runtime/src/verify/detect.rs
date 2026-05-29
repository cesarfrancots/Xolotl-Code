//! Project ecosystem detection and verify-command resolution (CP 3.1, D8).
//!
//! Detects whether a directory is a Cargo / npm / Python project and resolves
//! the build / test / typecheck commands to run. Defaults follow D8 and are
//! overridable via a `verify` object in `.claude/settings.json`.

use std::path::Path;

use crate::json::JsonValue;

/// A detected project ecosystem.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectKind {
    Rust,
    Node,
    Python,
    Unknown,
}

/// A single runnable command: a program plus its arguments.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifyCommand {
    pub program: String,
    pub args: Vec<String>,
}

impl VerifyCommand {
    fn new(program: &str, args: &[&str]) -> Self {
        Self {
            program: program.to_string(),
            args: args.iter().map(|a| (*a).to_string()).collect(),
        }
    }

    /// Render the command as a single display string (e.g. `cargo check`).
    #[must_use]
    pub fn display(&self) -> String {
        if self.args.is_empty() {
            self.program.clone()
        } else {
            format!("{} {}", self.program, self.args.join(" "))
        }
    }

    /// Parse a command from a settings value: a string (whitespace-split) or an
    /// array of strings. Returns `None` for an empty/invalid value, and for an
    /// explicit `null`/`false` (a way to disable a check).
    fn from_json(value: &JsonValue) -> Option<Self> {
        let parts: Vec<String> = match value {
            JsonValue::String(s) => s.split_whitespace().map(str::to_string).collect(),
            JsonValue::Array(items) => items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect(),
            // null / false / number / object → not a usable command.
            _ => return None,
        };
        let mut iter = parts.into_iter();
        let program = iter.next()?;
        if program.is_empty() {
            return None;
        }
        Some(Self {
            program,
            args: iter.collect(),
        })
    }
}

/// Resolved verification commands for a project.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifyCommands {
    pub kind: ProjectKind,
    /// Full build (heavier).
    pub build: Option<VerifyCommand>,
    /// Test suite.
    pub test: Option<VerifyCommand>,
    /// Cheap correctness check (compile/typecheck) — the preferred post-edit signal.
    pub typecheck: Option<VerifyCommand>,
}

impl VerifyCommands {
    /// The command best suited to a fast post-edit correctness check: the
    /// typecheck if available, else the build.
    #[must_use]
    pub fn post_edit_check(&self) -> Option<&VerifyCommand> {
        self.typecheck.as_ref().or(self.build.as_ref())
    }
}

/// Detect the project ecosystem of `dir` by its marker files.
///
/// Precedence when several markers coexist: Rust, then Node, then Python.
#[must_use]
pub fn detect_project(dir: &Path) -> ProjectKind {
    if dir.join("Cargo.toml").is_file() {
        ProjectKind::Rust
    } else if dir.join("package.json").is_file() {
        ProjectKind::Node
    } else if dir.join("pyproject.toml").is_file()
        || dir.join("setup.py").is_file()
        || dir.join("requirements.txt").is_file()
    {
        ProjectKind::Python
    } else {
        ProjectKind::Unknown
    }
}

/// Resolve the build/test/typecheck commands for `dir`.
///
/// `overrides` is the `verify` object from `.claude/settings.json` (pass the
/// value of the `"verify"` key, or `None`). For each of `build`/`test`/
/// `typecheck`, an override key replaces the default; an explicit `null`/`false`
/// disables that command; an absent key keeps the D8 default.
#[must_use]
pub fn resolve_verify_commands(dir: &Path, overrides: Option<&JsonValue>) -> VerifyCommands {
    let kind = detect_project(dir);
    let (mut build, mut test, mut typecheck) = defaults_for(kind);

    if let Some(JsonValue::Object(map)) = overrides {
        apply_override(map.get("build"), &mut build);
        apply_override(map.get("test"), &mut test);
        apply_override(map.get("typecheck"), &mut typecheck);
    }

    VerifyCommands {
        kind,
        build,
        test,
        typecheck,
    }
}

/// Apply a single override: present → replace (or disable); absent → leave default.
fn apply_override(value: Option<&JsonValue>, slot: &mut Option<VerifyCommand>) {
    if let Some(value) = value {
        *slot = VerifyCommand::from_json(value);
    }
}

/// D8 default commands per ecosystem.
fn defaults_for(
    kind: ProjectKind,
) -> (
    Option<VerifyCommand>,
    Option<VerifyCommand>,
    Option<VerifyCommand>,
) {
    match kind {
        ProjectKind::Rust => (
            None,
            Some(VerifyCommand::new("cargo", &["test"])),
            Some(VerifyCommand::new("cargo", &["check"])),
        ),
        ProjectKind::Node => (
            None,
            Some(VerifyCommand::new("npm", &["test"])),
            Some(VerifyCommand::new("npx", &["tsc", "--noEmit"])),
        ),
        ProjectKind::Python => (
            None,
            Some(VerifyCommand::new("python", &["-m", "pytest", "-q"])),
            Some(VerifyCommand::new("pyright", &[])),
        ),
        ProjectKind::Unknown => (None, None, None),
    }
}

#[cfg(test)]
mod tests {
    use super::{detect_project, resolve_verify_commands, ProjectKind, VerifyCommand};
    use crate::json::JsonValue;
    use std::collections::BTreeMap;
    use std::fs;
    use tempfile::tempdir;

    fn touch(dir: &std::path::Path, name: &str) {
        fs::write(dir.join(name), "").expect("write marker");
    }

    #[test]
    fn detects_rust_and_resolves_cargo_commands() {
        let dir = tempdir().unwrap();
        touch(dir.path(), "Cargo.toml");
        let cmds = resolve_verify_commands(dir.path(), None);
        assert_eq!(cmds.kind, ProjectKind::Rust);
        assert_eq!(
            cmds.typecheck.as_ref().map(VerifyCommand::display),
            Some("cargo check".to_string())
        );
        assert_eq!(
            cmds.test.as_ref().map(VerifyCommand::display),
            Some("cargo test".to_string())
        );
        // post_edit_check prefers the cheap typecheck.
        assert_eq!(
            cmds.post_edit_check().map(VerifyCommand::display),
            Some("cargo check".to_string())
        );
    }

    #[test]
    fn detects_node_typecheck() {
        let dir = tempdir().unwrap();
        touch(dir.path(), "package.json");
        let cmds = resolve_verify_commands(dir.path(), None);
        assert_eq!(cmds.kind, ProjectKind::Node);
        assert_eq!(
            cmds.typecheck.as_ref().map(VerifyCommand::display),
            Some("npx tsc --noEmit".to_string())
        );
    }

    #[test]
    fn detects_python_from_pyproject() {
        let dir = tempdir().unwrap();
        touch(dir.path(), "pyproject.toml");
        let cmds = resolve_verify_commands(dir.path(), None);
        assert_eq!(cmds.kind, ProjectKind::Python);
        assert_eq!(
            cmds.typecheck.as_ref().map(VerifyCommand::display),
            Some("pyright".to_string())
        );
        assert_eq!(
            cmds.test.as_ref().map(VerifyCommand::display),
            Some("python -m pytest -q".to_string())
        );
    }

    #[test]
    fn rust_takes_precedence_over_node() {
        let dir = tempdir().unwrap();
        touch(dir.path(), "Cargo.toml");
        touch(dir.path(), "package.json");
        assert_eq!(detect_project(dir.path()), ProjectKind::Rust);
    }

    #[test]
    fn unknown_when_no_markers() {
        let dir = tempdir().unwrap();
        let cmds = resolve_verify_commands(dir.path(), None);
        assert_eq!(cmds.kind, ProjectKind::Unknown);
        assert!(cmds.build.is_none() && cmds.test.is_none() && cmds.typecheck.is_none());
        assert!(cmds.post_edit_check().is_none());
    }

    #[test]
    fn settings_override_replaces_default() {
        let dir = tempdir().unwrap();
        touch(dir.path(), "Cargo.toml");
        let mut verify = BTreeMap::new();
        verify.insert(
            "typecheck".to_string(),
            JsonValue::String("cargo clippy -- -D warnings".to_string()),
        );
        verify.insert(
            "test".to_string(),
            JsonValue::Array(vec![
                JsonValue::String("cargo".to_string()),
                JsonValue::String("nextest".to_string()),
                JsonValue::String("run".to_string()),
            ]),
        );
        let overrides = JsonValue::Object(verify);
        let cmds = resolve_verify_commands(dir.path(), Some(&overrides));
        assert_eq!(
            cmds.typecheck.as_ref().map(VerifyCommand::display),
            Some("cargo clippy -- -D warnings".to_string())
        );
        assert_eq!(
            cmds.test.as_ref().map(VerifyCommand::display),
            Some("cargo nextest run".to_string())
        );
    }

    #[test]
    fn settings_null_disables_a_check() {
        let dir = tempdir().unwrap();
        touch(dir.path(), "Cargo.toml");
        let mut verify = BTreeMap::new();
        verify.insert("test".to_string(), JsonValue::Null);
        let overrides = JsonValue::Object(verify);
        let cmds = resolve_verify_commands(dir.path(), Some(&overrides));
        assert!(
            cmds.test.is_none(),
            "explicit null disables the test command"
        );
        // unaffected default remains.
        assert_eq!(
            cmds.typecheck.as_ref().map(VerifyCommand::display),
            Some("cargo check".to_string())
        );
    }
}
