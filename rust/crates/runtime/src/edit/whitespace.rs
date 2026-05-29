//! Whitespace-insensitive strategy. Matches a contiguous block of lines whose
//! *trimmed* content equals the trimmed `old` lines, tolerating differences in
//! indentation width, trailing whitespace, and line endings (CRLF/LF). The
//! replacement is re-indented to the matched block's base indentation.
//!
//! Safety (R1): if more than one block matches and `replace_all` is false, the
//! match is [`EditApply::Ambiguous`] and nothing is applied.

use super::util::{leading_whitespace, line_ending, reindent, splice};
use super::{EditApply, EditStrategy};

pub struct WhitespaceStrategy;

/// True when two line slices match ignoring leading/trailing whitespace.
fn block_matches(window: &[&str], old_lines: &[&str]) -> bool {
    window
        .iter()
        .zip(old_lines)
        .all(|(file, old)| file.trim() == old.trim())
}

impl EditStrategy for WhitespaceStrategy {
    fn name(&self) -> &'static str {
        "whitespace"
    }

    fn try_apply(&self, content: &str, old: &str, new: &str, replace_all: bool) -> EditApply {
        let old_lines: Vec<&str> = old.lines().collect();
        if old_lines.is_empty() {
            return EditApply::NoMatch;
        }
        let file_lines: Vec<&str> = content.lines().collect();
        if old_lines.len() > file_lines.len() {
            return EditApply::NoMatch;
        }

        let old_base = leading_whitespace(old_lines[0]);
        let span = old_lines.len();
        let matches: Vec<usize> = (0..=file_lines.len() - span)
            .filter(|&i| block_matches(&file_lines[i..i + span], &old_lines))
            .collect();

        if matches.is_empty() {
            return EditApply::NoMatch;
        }

        if !replace_all {
            if matches.len() > 1 {
                return EditApply::Ambiguous(matches.len());
            }
            let i = matches[0];
            let replacement = reindent(new, old_base, leading_whitespace(file_lines[i]));
            return EditApply::Applied(splice(content, &file_lines, i, i + span, &replacement));
        }

        // replace_all: replace every non-overlapping match (greedy, left to
        // right), splicing right-to-left so earlier indices stay valid.
        let mut non_overlapping = Vec::new();
        let mut next_free = 0usize;
        for &i in &matches {
            if i >= next_free {
                non_overlapping.push(i);
                next_free = i + span;
            }
        }
        let mut lines: Vec<String> = file_lines.iter().map(|s| (*s).to_string()).collect();
        for &i in non_overlapping.iter().rev() {
            let replacement = reindent(new, old_base, leading_whitespace(file_lines[i]));
            lines.splice(i..i + span, replacement);
        }
        let nl = line_ending(content);
        let mut result = lines.join(nl);
        if content.ends_with('\n') {
            result.push_str(nl);
        }
        EditApply::Applied(result)
    }
}

#[cfg(test)]
mod tests {
    use super::WhitespaceStrategy;
    use crate::edit::{EditApply, EditStrategy};

    #[test]
    fn matches_despite_indentation_difference() {
        let content = "fn main() {\n        let x = 1;\n}\n";
        // model under-indented old/new by 4 spaces
        let outcome =
            WhitespaceStrategy.try_apply(content, "    let x = 1;", "    let x = 2;", false);
        assert_eq!(
            outcome,
            EditApply::Applied("fn main() {\n        let x = 2;\n}\n".to_string())
        );
    }

    #[test]
    fn matches_despite_trailing_whitespace() {
        let content = "alpha   \nbeta\n";
        let outcome = WhitespaceStrategy.try_apply(content, "alpha", "ALPHA", false);
        assert_eq!(outcome, EditApply::Applied("ALPHA\nbeta\n".to_string()));
    }

    #[test]
    fn matches_crlf_file_with_lf_old_and_preserves_crlf() {
        let content = "one\r\ntwo\r\nthree\r\n";
        let outcome = WhitespaceStrategy.try_apply(content, "two", "TWO", false);
        assert_eq!(
            outcome,
            EditApply::Applied("one\r\nTWO\r\nthree\r\n".to_string())
        );
    }

    #[test]
    fn multiline_block_reindented_to_file() {
        let content = "class C:\n    def f(self):\n        return 1\n";
        let old = "def f(self):\n    return 1"; // model wrote at column 0 / 4
        let new = "def f(self):\n    return 2";
        let outcome = WhitespaceStrategy.try_apply(content, old, new, false);
        assert_eq!(
            outcome,
            EditApply::Applied("class C:\n    def f(self):\n        return 2\n".to_string())
        );
    }

    #[test]
    fn ambiguous_when_two_blocks_match_and_not_replace_all() {
        let content = "x = 1\ny = 2\nx = 1\n";
        let outcome = WhitespaceStrategy.try_apply(content, "x = 1", "x = 9", false);
        assert_eq!(outcome, EditApply::Ambiguous(2));
    }

    #[test]
    fn replace_all_applies_every_match() {
        let content = "  a\nb\n    a\n";
        let outcome = WhitespaceStrategy.try_apply(content, "a", "Z", true);
        // each match re-indented to its own block base
        assert_eq!(outcome, EditApply::Applied("  Z\nb\n    Z\n".to_string()));
    }

    #[test]
    fn no_match_when_absent() {
        let outcome = WhitespaceStrategy.try_apply("a\nb\n", "zzz", "q", false);
        assert_eq!(outcome, EditApply::NoMatch);
    }
}
