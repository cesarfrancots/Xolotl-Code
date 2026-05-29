//! Shared text helpers for the whitespace/anchored edit strategies: line-ending
//! detection, indentation handling, re-indentation of replacement text, and
//! splicing a replacement block back into the original content while preserving
//! the file's line endings and final-newline.

/// The dominant line ending of `content` (`\r\n` if any CRLF is present, else
/// `\n`). Used to reconstruct spliced content with the file's own endings.
pub(super) fn line_ending(content: &str) -> &'static str {
    if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

/// The leading-whitespace prefix of `line` (spaces/tabs before the first
/// non-whitespace character).
pub(super) fn leading_whitespace(line: &str) -> &str {
    &line[..line.len() - line.trim_start().len()]
}

/// The longest common leading-whitespace prefix across the non-blank lines.
fn common_leading_whitespace(lines: &[&str]) -> String {
    let mut common: Option<String> = None;
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        let lw = leading_whitespace(line);
        common = Some(match common {
            None => lw.to_string(),
            Some(prefix) => {
                let shared = prefix
                    .chars()
                    .zip(lw.chars())
                    .take_while(|(a, b)| a == b)
                    .count();
                prefix.chars().take(shared).collect()
            }
        });
    }
    common.unwrap_or_default()
}

/// Re-indent `new` to fit the matched `file_block` it will replace, given the
/// model wrote it against `old_lines`' indentation.
///
/// When `new` has the same number of lines as `file_block`, each new line takes
/// the **exact** indentation of the corresponding file line — perfect for the
/// common content-only edit and guaranteed never to mix tabs and spaces. When
/// the line counts differ (e.g. lines added/removed), it shifts each line by the
/// common-indent delta; if the file and old indentation use incompatible
/// whitespace (tab vs space), it returns `None` so the caller declines rather
/// than emit corrupted (mixed tab/space) indentation.
pub(super) fn reindent_block(
    new: &str,
    old_lines: &[&str],
    file_block: &[&str],
) -> Option<Vec<String>> {
    let new_lines: Vec<&str> = new.lines().collect();

    if new_lines.len() == file_block.len() {
        return Some(
            new_lines
                .iter()
                .enumerate()
                .map(|(i, line)| {
                    if line.trim().is_empty() {
                        String::new()
                    } else {
                        format!("{}{}", leading_whitespace(file_block[i]), line.trim_start())
                    }
                })
                .collect(),
        );
    }

    // Differing line counts: shift by the common-indent delta.
    let old_base = common_leading_whitespace(old_lines);
    let file_base = common_leading_whitespace(file_block);
    if let (Some(o), Some(f)) = (old_base.chars().next(), file_base.chars().next()) {
        if o != f {
            return None; // incompatible indent characters (tab vs space)
        }
    }
    Some(
        new_lines
            .iter()
            .map(|line| {
                if line.trim().is_empty() {
                    String::new()
                } else if let Some(rest) = line.strip_prefix(old_base.as_str()) {
                    format!("{file_base}{rest}")
                } else {
                    (*line).to_string()
                }
            })
            .collect(),
    )
}

/// Byte offset where line `line_idx` (0-indexed, per `str::lines` semantics)
/// begins in `content`; `content.len()` when `line_idx` is past the last line.
fn line_start_offset(content: &str, line_idx: usize) -> usize {
    if line_idx == 0 {
        return 0;
    }
    let mut seen = 0usize;
    for (i, byte) in content.bytes().enumerate() {
        if byte == b'\n' {
            seen += 1;
            if seen == line_idx {
                return i + 1;
            }
        }
    }
    content.len()
}

/// Rebuild `content` with lines `[start, end)` (per `content.lines()`) replaced
/// by `replacement`. The bytes outside the replaced range — including every
/// untouched line's *original* ending — are preserved verbatim, so a file with
/// mixed line endings is never silently normalized (the line-ending bug). The
/// replacement uses the ending found inside the replaced region (CRLF if any),
/// and keeps the region's trailing-newline state.
pub(super) fn splice(
    content: &str,
    file_lines: &[&str],
    start: usize,
    end: usize,
    replacement: &[String],
) -> String {
    let _ = file_lines; // indices are resolved against `content` directly
    let start_off = line_start_offset(content, start);
    let end_off = line_start_offset(content, end);
    let prefix = &content[..start_off];
    let suffix = &content[end_off..];
    let replaced = &content[start_off..end_off];

    let nl = if replaced.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let region_has_trailing_newline = replaced.ends_with('\n');

    let mut mid = replacement.join(nl);
    if region_has_trailing_newline && !replacement.is_empty() {
        mid.push_str(nl);
    }
    format!("{prefix}{mid}{suffix}")
}

#[cfg(test)]
mod tests {
    use super::{leading_whitespace, line_ending, reindent_block, splice};

    #[test]
    fn detects_line_endings() {
        assert_eq!(line_ending("a\nb\n"), "\n");
        assert_eq!(line_ending("a\r\nb\r\n"), "\r\n");
    }

    #[test]
    fn extracts_leading_whitespace() {
        assert_eq!(leading_whitespace("    foo"), "    ");
        assert_eq!(leading_whitespace("\t\tfoo"), "\t\t");
        assert_eq!(leading_whitespace("foo"), "");
    }

    #[test]
    fn equal_line_count_takes_file_indentation_per_line() {
        // The model wrote tabs; the file uses 4/8 spaces. Per-line indentation
        // from the matched block yields correct, non-mixed indentation.
        let old_lines = vec!["\tfn f() {", "\t\tbody();", "\t}"];
        let file_block = vec!["    fn f() {", "        body();", "    }"];
        let new = "\tfn f() {\n\t\tbody2();\n\t}";
        let out = reindent_block(new, &old_lines, &file_block).expect("equal-count reindent");
        assert_eq!(
            out,
            vec![
                "    fn f() {".to_string(),
                "        body2();".to_string(), // 8 spaces, NOT "    \tbody2();"
                "    }".to_string(),
            ]
        );
        for line in &out {
            let lw = leading_whitespace(line);
            assert!(
                !(lw.contains('\t') && lw.contains(' ')),
                "mixed tab/space indent: {line:?}"
            );
        }
    }

    #[test]
    fn differing_line_count_declines_incompatible_indent() {
        // tab old vs space file, with a line-count change → cannot safely
        // reindent without mixing → None (caller declines).
        let old_lines = vec!["\tfn f() {", "\t}"];
        let file_block = vec!["    fn f() {", "        a();", "    }"];
        let new = "\tfn f() {\n\t\tx();\n\t\ty();\n\t}"; // 4 lines vs 3-line block
        assert_eq!(reindent_block(new, &old_lines, &file_block), None);
    }

    #[test]
    fn reindent_keeps_blank_lines_blank() {
        let old_lines = vec!["a", "b"];
        let file_block = vec!["  a", "  b"];
        let out = reindent_block("a\n\nb", &old_lines, &file_block);
        // line counts differ (3 vs 2) → delta path; blank line stays blank
        assert_eq!(
            out,
            Some(vec!["  a".to_string(), String::new(), "  b".to_string()])
        );
    }

    #[test]
    fn splice_preserves_crlf_and_final_newline() {
        let content = "a\r\nb\r\nc\r\n";
        let file_lines: Vec<&str> = content.lines().collect();
        let out = splice(content, &file_lines, 1, 2, &["B".to_string()]);
        assert_eq!(out, "a\r\nB\r\nc\r\n");
    }

    #[test]
    fn splice_without_final_newline() {
        let content = "a\nb\nc";
        let file_lines: Vec<&str> = content.lines().collect();
        let out = splice(content, &file_lines, 0, 1, &["A".to_string()]);
        assert_eq!(out, "A\nb\nc");
    }

    #[test]
    fn splice_preserves_mixed_line_endings_of_untouched_lines() {
        // 'a' is CRLF, 'b' and 'c' are LF. Replacing 'b' must NOT convert the
        // untouched a/c lines to CRLF (the line-ending corruption bug).
        let content = "a\r\nb\nc\n";
        let file_lines: Vec<&str> = content.lines().collect();
        let out = splice(content, &file_lines, 1, 2, &["B".to_string()]);
        assert_eq!(out, "a\r\nB\nc\n");
    }
}
