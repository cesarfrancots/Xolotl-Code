//! Parse compiler/test output into normalized diagnostics (CP 3.2, T-3.2.1).
//!
//! Turns `cargo check`, `tsc --noEmit`, and `pytest` output into `{file, line,
//! message}` records so the post-edit verification step can feed the model a
//! compact, structured failure digest instead of raw console noise.

use std::sync::LazyLock;

use regex::Regex;

use super::ProjectKind;

/// A single normalized diagnostic extracted from tool output.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub file: String,
    pub line: Option<u32>,
    pub column: Option<u32>,
    pub message: String,
}

/// Parse the output of a project's check command into diagnostics.
#[must_use]
pub fn parse_check_output(kind: ProjectKind, output: &str) -> Vec<Diagnostic> {
    match kind {
        ProjectKind::Rust => parse_cargo(output),
        ProjectKind::Node => parse_tsc(output),
        ProjectKind::Python => parse_pytest(output),
        ProjectKind::Unknown => Vec::new(),
    }
}

// ── cargo ───────────────────────────────────────────────────────────────────

static CARGO_HEADER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(error|warning)(\[[A-Za-z0-9]+\])?:\s+(.*)$").unwrap());
static CARGO_LOCATION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*-->\s+(\S+?):(\d+):(\d+)").unwrap());

/// Cargo human-readable output: an `error[CODE]: message` header followed (within
/// the diagnostic block) by a `  --> file:line:col` location line.
#[must_use]
pub fn parse_cargo(output: &str) -> Vec<Diagnostic> {
    let lines: Vec<&str> = output.lines().collect();
    let mut diagnostics = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let Some(header) = CARGO_HEADER.captures(line) else {
            continue;
        };
        let message = header.get(3).map_or("", |m| m.as_str()).trim().to_string();
        if message.is_empty() || is_cargo_summary_noise(&message) {
            continue;
        }
        // Find the location line before the next header.
        let mut file = None;
        let mut line_no = None;
        let mut column = None;
        for next in lines.iter().skip(index + 1) {
            if CARGO_HEADER.is_match(next) {
                break;
            }
            if let Some(loc) = CARGO_LOCATION.captures(next) {
                file = Some(loc[1].to_string());
                line_no = loc[2].parse::<u32>().ok();
                column = loc[3].parse::<u32>().ok();
                break;
            }
        }
        diagnostics.push(Diagnostic {
            file: file.unwrap_or_default(),
            line: line_no,
            column,
            message,
        });
    }
    diagnostics
}

/// Summary lines that are not actionable per-site diagnostics.
fn is_cargo_summary_noise(message: &str) -> bool {
    message.starts_with("aborting due to")
        || message.starts_with("could not compile")
        || message.starts_with("build failed")
        || message.starts_with("For more information")
        || message.contains("generated ") && message.contains(" warning")
}

// ── tsc ───────────────────────────────────────────────────────────────────

static TSC_LINE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(.+?)\((\d+),(\d+)\):\s+error\s+TS\d+:\s+(.+)$").unwrap());

/// `tsc --noEmit` output: `path(line,col): error TSxxxx: message`.
#[must_use]
pub fn parse_tsc(output: &str) -> Vec<Diagnostic> {
    output
        .lines()
        .filter_map(|line| {
            let caps = TSC_LINE.captures(line.trim())?;
            Some(Diagnostic {
                file: caps[1].to_string(),
                line: caps[2].parse().ok(),
                column: caps[3].parse().ok(),
                message: caps[4].trim().to_string(),
            })
        })
        .collect()
}

// ── pytest ──────────────────────────────────────────────────────────────────

static PYTEST_FAILED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^FAILED\s+([^:\s]+(?:\.py)?)(::\S+)?\s*(?:-\s*(.*))?$").unwrap());
static PYTEST_LOCATION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\S+\.py):(\d+):\s").unwrap());

/// pytest output: short-summary `FAILED path::test - message` lines, enriched
/// with line numbers from `path.py:line:` traceback lines where available.
#[must_use]
pub fn parse_pytest(output: &str) -> Vec<Diagnostic> {
    // Collect file -> line from traceback lines first.
    let mut file_lines: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    for line in output.lines() {
        if let Some(caps) = PYTEST_LOCATION.captures(line.trim()) {
            if let Ok(n) = caps[2].parse::<u32>() {
                file_lines.entry(caps[1].to_string()).or_insert(n);
            }
        }
    }

    output
        .lines()
        .filter_map(|line| {
            let caps = PYTEST_FAILED.captures(line.trim())?;
            let file = caps[1].to_string();
            let message = caps
                .get(3)
                .map_or(String::new(), |m| m.as_str().trim().to_string());
            let line_no = file_lines.get(&file).copied();
            Some(Diagnostic {
                line: line_no,
                column: None,
                message,
                file,
            })
        })
        .collect()
}

// ── digest ──────────────────────────────────────────────────────────────────

/// Format up to `limit` diagnostics into a compact digest for the model.
#[must_use]
pub fn format_digest(diagnostics: &[Diagnostic], limit: usize) -> String {
    let mut out = String::new();
    for diag in diagnostics.iter().take(limit) {
        let location = match (diag.file.is_empty(), diag.line) {
            (false, Some(line)) => format!("{}:{}", diag.file, line),
            (false, None) => diag.file.clone(),
            (true, _) => String::new(),
        };
        if location.is_empty() {
            out.push_str(&format!("- {}\n", diag.message));
        } else {
            out.push_str(&format!("- {}: {}\n", location, diag.message));
        }
    }
    if diagnostics.len() > limit {
        out.push_str(&format!("- ... and {} more\n", diagnostics.len() - limit));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{format_digest, parse_cargo, parse_check_output, parse_pytest, parse_tsc};
    use crate::verify::ProjectKind;

    #[test]
    fn parses_cargo_error_with_location() {
        let output = "\
    Checking foo v0.1.0 (/repo)
error[E0599]: no method named `bar` found for struct `Foo` in the current scope
  --> src/lib.rs:42:10
   |
42 |     x.bar();
   |       ^^^ method not found
error: aborting due to 1 previous error
";
        let diags = parse_cargo(output);
        assert_eq!(diags.len(), 1, "summary 'aborting' line must be filtered");
        assert_eq!(diags[0].file, "src/lib.rs");
        assert_eq!(diags[0].line, Some(42));
        assert_eq!(diags[0].column, Some(10));
        assert!(diags[0].message.contains("no method named"));
    }

    #[test]
    fn parses_multiple_cargo_diagnostics() {
        let output = "\
error[E0425]: cannot find value `x` in this scope
  --> src/main.rs:3:13
warning: unused variable: `y`
  --> src/main.rs:5:9
";
        let diags = parse_cargo(output);
        assert_eq!(diags.len(), 2);
        assert_eq!(diags[0].line, Some(3));
        assert_eq!(diags[1].file, "src/main.rs");
        assert_eq!(diags[1].line, Some(5));
    }

    #[test]
    fn parses_tsc_errors() {
        let output = "\
src/index.ts(10,5): error TS2304: Cannot find name 'foo'.
src/util.ts(3,17): error TS2345: Argument of type 'string' is not assignable.
Found 2 errors.
";
        let diags = parse_tsc(output);
        assert_eq!(diags.len(), 2);
        assert_eq!(diags[0].file, "src/index.ts");
        assert_eq!(diags[0].line, Some(10));
        assert_eq!(diags[0].column, Some(5));
        assert!(diags[1].message.contains("not assignable"));
    }

    #[test]
    fn parses_pytest_failures_with_lines() {
        let output = "\
=================================== FAILURES ===================================
    def test_addition():
>       assert add(1, 2) == 4
E       assert 3 == 4
tests/test_math.py:5: AssertionError
=========================== short test summary info ============================
FAILED tests/test_math.py::test_addition - assert 3 == 4
";
        let diags = parse_pytest(output);
        assert_eq!(diags.len(), 1);
        assert_eq!(diags[0].file, "tests/test_math.py");
        assert_eq!(diags[0].line, Some(5));
        assert!(diags[0].message.contains("assert 3 == 4"));
    }

    #[test]
    fn dispatch_and_clean_output_yields_nothing() {
        assert!(parse_check_output(ProjectKind::Rust, "    Finished dev\n").is_empty());
        assert!(parse_check_output(ProjectKind::Unknown, "anything").is_empty());
    }

    #[test]
    fn digest_truncates_and_formats() {
        let output = "\
error[E0001]: a
  --> a.rs:1:1
error[E0002]: b
  --> b.rs:2:2
error[E0003]: c
  --> c.rs:3:3
";
        let diags = parse_cargo(output);
        let digest = format_digest(&diags, 2);
        assert!(digest.contains("a.rs:1: a"));
        assert!(digest.contains("b.rs:2: b"));
        assert!(digest.contains("and 1 more"));
        assert!(!digest.contains("c.rs"));
    }
}
