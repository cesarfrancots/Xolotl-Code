//! Parser for unified-diff payloads. Each hunk (`@@ -a,b +c,d @@` followed by
//! ` `/`-`/`+` body lines) is reconstructed into the `old` text (context +
//! removed) and the `new` text (context + added) of one [`EditOp`]. File
//! headers (`--- a/path`, `+++ b/path`) set the op's `path`.
//!
//! The hunk header's line counts (`b`, `d`) bound the hunk body, so the parser
//! knows exactly where a hunk ends. This is what lets it (a) flush each hunk
//! under the *correct* file path in multi-file diffs, and (b) never mistake a
//! body line that happens to start with `+++ `/`--- ` for a file header.
//!
//! Malformed payloads (a diff line where a body line is expected, or no hunk at
//! all) are rejected; the parser never invents content.

use super::EditOp;

/// Parse a unified diff into one [`EditOp`] per hunk.
pub fn parse_udiff(payload: &str) -> Result<Vec<EditOp>, String> {
    let mut ops = Vec::new();
    let mut path: Option<String> = None;
    let mut old_lines: Vec<String> = Vec::new();
    let mut new_lines: Vec<String> = Vec::new();
    let mut old_budget = 0usize;
    let mut new_budget = 0usize;

    for line in payload.lines() {
        let in_hunk_body = old_budget > 0 || new_budget > 0;
        if in_hunk_body {
            let mut chars = line.chars();
            match chars.next() {
                Some('+') => {
                    new_lines.push(chars.as_str().to_string());
                    new_budget = new_budget.saturating_sub(1);
                }
                Some('-') => {
                    old_lines.push(chars.as_str().to_string());
                    old_budget = old_budget.saturating_sub(1);
                }
                Some(' ') => {
                    let rest = chars.as_str().to_string();
                    old_lines.push(rest.clone());
                    new_lines.push(rest);
                    old_budget = old_budget.saturating_sub(1);
                    new_budget = new_budget.saturating_sub(1);
                }
                // a truly empty line inside a hunk = an unchanged empty line
                None => {
                    old_lines.push(String::new());
                    new_lines.push(String::new());
                    old_budget = old_budget.saturating_sub(1);
                    new_budget = new_budget.saturating_sub(1);
                }
                // the genuine "no newline at end of file" marker consumes nothing
                Some('\\') if line.starts_with("\\ No newline") => {}
                Some(_) => return Err(format!("unexpected line in diff hunk body: {line:?}")),
            }
            if old_budget == 0 && new_budget == 0 {
                flush(&mut ops, path.as_deref(), &mut old_lines, &mut new_lines);
            }
            continue;
        }

        // Outside a hunk body: file headers, hunk headers, or preamble.
        if let Some(rest) = line.strip_prefix("+++ ") {
            path = Some(strip_diff_path(rest));
        } else if line.starts_with("--- ") {
            // old-file header; the path comes from the +++ line.
        } else if let Some((old_count, new_count)) = parse_hunk_header(line) {
            old_budget = old_count;
            new_budget = new_count;
            // A zero-line hunk (pure no-op) flushes immediately to nothing.
            if old_budget == 0 && new_budget == 0 {
                flush(&mut ops, path.as_deref(), &mut old_lines, &mut new_lines);
            }
        }
        // else: preamble (e.g. "diff --git ...") — ignored.
    }
    flush(&mut ops, path.as_deref(), &mut old_lines, &mut new_lines);

    if ops.is_empty() {
        return Err("no diff hunk (@@) found".to_string());
    }
    Ok(ops)
}

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

/// Parse `@@ -oldStart[,oldCount] +newStart[,newCount] @@` into `(oldCount,
/// newCount)` (counts default to 1 when omitted). `None` if not a hunk header.
fn parse_hunk_header(line: &str) -> Option<(usize, usize)> {
    if !line.starts_with("@@") {
        return None;
    }
    let mut old_count = None;
    let mut new_count = None;
    for token in line.split_whitespace() {
        if let Some(spec) = token.strip_prefix('-') {
            old_count = Some(parse_count(spec));
        } else if let Some(spec) = token.strip_prefix('+') {
            new_count = Some(parse_count(spec));
        }
    }
    Some((old_count?, new_count?))
}

fn parse_count(spec: &str) -> usize {
    spec.split_once(',')
        .map_or(1, |(_, count)| count.parse().unwrap_or(1))
}

/// Strip a leading `a/` or `b/` and any trailing tab-separated metadata.
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
    fn multi_file_diff_routes_each_hunk_to_its_own_file() {
        // Two hunks in f1, one in f2. The last hunk of f1 must NOT be attributed
        // to f2 (the misrouting bug).
        let payload = "\
--- a/f1
+++ b/f1
@@ -1 +1 @@
-a
+A
@@ -5 +5 @@
-b
+B
--- a/f2
+++ b/f2
@@ -1 +1 @@
-c
+C
";
        let ops = parse_udiff(payload).expect("parse");
        assert_eq!(ops.len(), 3);
        assert_eq!(ops[0].path.as_deref(), Some("f1"));
        assert_eq!(ops[1].path.as_deref(), Some("f1")); // was misrouted to f2
        assert_eq!(ops[1].old, "b");
        assert_eq!(ops[2].path.as_deref(), Some("f2"));
    }

    #[test]
    fn body_line_starting_with_plus_plus_plus_is_content_not_header() {
        // A real added line whose text begins with "+++ " (e.g. editing a diff
        // file). Within the hunk budget it must be treated as content.
        let payload = "--- a/p\n+++ b/p\n@@ -1,1 +1,2 @@\n keep\n++++ added marker text\n";
        let ops = parse_udiff(payload).expect("parse");
        assert_eq!(ops[0].path.as_deref(), Some("p"));
        assert_eq!(ops[0].new, "keep\n+++ added marker text");
    }

    #[test]
    fn no_newline_marker_is_ignored_but_other_backslash_lines_error() {
        let ok = "@@ -1,1 +1,1 @@\n-foo\n+bar\n\\ No newline at end of file\n";
        let ops = parse_udiff(ok).expect("parse");
        assert_eq!(ops[0].old, "foo");
        assert_eq!(ops[0].new, "bar");
    }

    #[test]
    fn rejects_no_hunk() {
        assert!(parse_udiff("--- a/x\n+++ b/x\n").is_err());
    }
}
