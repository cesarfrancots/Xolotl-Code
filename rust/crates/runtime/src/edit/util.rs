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

/// Re-indent the lines of `new` for insertion at a block whose base indentation
/// is `file_base`, given that the model wrote `new` against base indentation
/// `old_base`. Each non-blank line has its `old_base` prefix swapped for
/// `file_base`; blank lines stay blank (no trailing whitespace); lines that are
/// less-indented than `old_base` are left as the model wrote them.
pub(super) fn reindent(new: &str, old_base: &str, file_base: &str) -> Vec<String> {
    new.lines()
        .map(|line| {
            if line.trim().is_empty() {
                String::new()
            } else if let Some(rest) = line.strip_prefix(old_base) {
                format!("{file_base}{rest}")
            } else {
                line.to_string()
            }
        })
        .collect()
}

/// Rebuild `content` with `file_lines[start..end]` replaced by `replacement`.
/// `file_lines` must be `content.lines()` collected. Reconstructs using the
/// file's line ending and preserves a trailing newline if the original had one.
pub(super) fn splice(
    content: &str,
    file_lines: &[&str],
    start: usize,
    end: usize,
    replacement: &[String],
) -> String {
    let nl = line_ending(content);
    let mut lines: Vec<&str> =
        Vec::with_capacity(file_lines.len() - (end - start) + replacement.len());
    lines.extend_from_slice(&file_lines[..start]);
    lines.extend(replacement.iter().map(String::as_str));
    lines.extend_from_slice(&file_lines[end..]);
    let mut result = lines.join(nl);
    if content.ends_with('\n') {
        result.push_str(nl);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::{leading_whitespace, line_ending, reindent, splice};

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
    fn reindents_from_four_to_eight_spaces() {
        let out = reindent("    if x:\n        return 2", "    ", "        ");
        assert_eq!(
            out,
            vec![
                "        if x:".to_string(),
                "            return 2".to_string()
            ]
        );
    }

    #[test]
    fn reindent_keeps_blank_lines_blank() {
        let out = reindent("    a\n\n    b", "    ", "  ");
        assert_eq!(
            out,
            vec!["  a".to_string(), String::new(), "  b".to_string()]
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
}
