//! Parser for unified-diff payloads. Each hunk (`@@ … @@` with ` `/`-`/`+`
//! lines) is reconstructed into the `old` text (context + removed lines) and
//! the `new` text (context + added lines) of one [`EditOp`]. File headers
//! (`--- a/path`, `+++ b/path`) set the op's `path`.
//!
//! Malformed payloads (a `+`/`-` line outside any hunk, or no hunk at all) are
//! rejected; the parser never invents content.

use super::EditOp;

/// Parse a unified diff into one [`EditOp`] per hunk. Returns `Err` when no hunk
/// is present or a diff line appears outside a hunk.
pub fn parse_udiff(payload: &str) -> Result<Vec<EditOp>, String> {
    let mut ops = Vec::new();
    let mut path: Option<String> = None;
    let mut in_hunk = false;
    let mut old_lines: Vec<String> = Vec::new();
    let mut new_lines: Vec<String> = Vec::new();

    // Flush the current hunk into an op.
    fn flush(
        ops: &mut Vec<EditOp>,
        path: Option<&str>,
        old_lines: &mut Vec<String>,
        new_lines: &mut Vec<String>,
    ) {
        if old_lines.is_empty() && new_lines.is_empty() {
            return;
        }
        ops.push(EditOp {
            path: path.map(str::to_string),
            old: old_lines.join("\n"),
            new: new_lines.join("\n"),
        });
        old_lines.clear();
        new_lines.clear();
    }

    for line in payload.lines() {
        if let Some(rest) = line.strip_prefix("+++ ") {
            // New-file header; capture path, stripping a leading "b/".
            path = Some(strip_diff_path(rest));
            continue;
        }
        if line.starts_with("--- ") {
            continue; // old-file header; path taken from +++
        }
        if line.starts_with("@@") {
            flush(&mut ops, path.as_deref(), &mut old_lines, &mut new_lines);
            in_hunk = true;
            continue;
        }
        if !in_hunk {
            continue; // preamble (e.g. "diff --git") — ignore
        }
        // Split on the first char (panic-free for multi-byte content).
        let mut chars = line.chars();
        match chars.next() {
            Some('+') => new_lines.push(chars.as_str().to_string()),
            Some('-') => old_lines.push(chars.as_str().to_string()),
            Some(' ') => {
                let rest = chars.as_str().to_string();
                old_lines.push(rest.clone());
                new_lines.push(rest);
            }
            // A blank line inside a hunk is an unchanged empty line.
            None => {
                old_lines.push(String::new());
                new_lines.push(String::new());
            }
            Some('\\') => {} // "\ No newline at end of file" marker — ignore
            Some(_) => return Err(format!("unexpected diff line outside +/-/space: {line:?}")),
        }
    }
    flush(&mut ops, path.as_deref(), &mut old_lines, &mut new_lines);

    if ops.is_empty() {
        return Err("no diff hunk (@@) found".to_string());
    }
    Ok(ops)
}

/// Strip a `a/` or `b/` prefix and any trailing tab-separated metadata from a
/// diff path header.
fn strip_diff_path(raw: &str) -> String {
    let trimmed = raw.split('\t').next().unwrap_or(raw).trim();
    trimmed
        .strip_prefix("a/")
        .or_else(|| trimmed.strip_prefix("b/"))
        .unwrap_or(trimmed)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::parse_udiff;

    #[test]
    fn parses_single_hunk_with_path() {
        let payload = "\
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,3 +1,3 @@
 fn main() {
-    let x = 1;
+    let x = 2;
 }
";
        let ops = parse_udiff(payload).expect("parse");
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].path.as_deref(), Some("src/lib.rs"));
        assert_eq!(ops[0].old, "fn main() {\n    let x = 1;\n}");
        assert_eq!(ops[0].new, "fn main() {\n    let x = 2;\n}");
    }

    #[test]
    fn parses_pure_addition() {
        let payload = "@@ -1,1 +1,2 @@\n existing\n+added\n";
        let ops = parse_udiff(payload).expect("parse");
        assert_eq!(ops[0].old, "existing");
        assert_eq!(ops[0].new, "existing\nadded");
    }

    #[test]
    fn rejects_no_hunk() {
        assert!(parse_udiff("--- a/x\n+++ b/x\n").is_err());
    }

    #[test]
    fn rejects_diff_line_outside_hunk() {
        assert!(parse_udiff("+orphan added line\n").is_err());
    }
}
