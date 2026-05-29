//! Anchored strategy. When the exact and whitespace strategies miss because the
//! *middle* of a block has drifted, this matches on the unique first and last
//! lines of `old` (trimmed) and replaces the whole bounded file block.
//!
//! Safety (R1):
//! - requires `old` to have at least two lines (distinct anchors) with
//!   non-blank first/last lines;
//! - the first anchor must occur exactly once and the last anchor exactly once
//!   in the file — any non-uniqueness is [`EditApply::Ambiguous`];
//! - the bounded file block is capped relative to `old`'s size so a stray
//!   anchor pair can never trigger a catastrophic large-region replacement.

use super::util::{reindent_block, splice};
use super::{EditApply, EditStrategy};

pub struct AnchoredStrategy;

/// Upper bound on the matched block size relative to `old`'s line count, so
/// far-apart coincidental anchors do not replace an unrelated large region.
fn max_block_for(old_len: usize) -> usize {
    old_len.saturating_mul(2) + 10
}

impl EditStrategy for AnchoredStrategy {
    fn name(&self) -> &'static str {
        "anchored"
    }

    fn try_apply(&self, content: &str, old: &str, new: &str, _replace_all: bool) -> EditApply {
        let old_lines: Vec<&str> = old.lines().collect();
        if old_lines.len() < 2 {
            return EditApply::NoMatch;
        }
        let first = old_lines[0].trim();
        let last = old_lines[old_lines.len() - 1].trim();
        if first.is_empty() || last.is_empty() {
            return EditApply::NoMatch;
        }

        let file_lines: Vec<&str> = content.lines().collect();
        let first_idxs: Vec<usize> = file_lines
            .iter()
            .enumerate()
            .filter(|(_, line)| line.trim() == first)
            .map(|(i, _)| i)
            .collect();
        let last_idxs: Vec<usize> = file_lines
            .iter()
            .enumerate()
            .filter(|(_, line)| line.trim() == last)
            .map(|(i, _)| i)
            .collect();

        if first_idxs.is_empty() || last_idxs.is_empty() {
            return EditApply::NoMatch;
        }
        if first_idxs.len() > 1 || last_idxs.len() > 1 {
            return EditApply::Ambiguous(first_idxs.len().max(last_idxs.len()));
        }

        let (fi, li) = (first_idxs[0], last_idxs[0]);
        if li <= fi {
            return EditApply::NoMatch;
        }
        if li - fi + 1 > max_block_for(old_lines.len()) {
            return EditApply::NoMatch;
        }

        match reindent_block(new, &old_lines, &file_lines[fi..=li]) {
            Some(replacement) => {
                EditApply::Applied(splice(content, &file_lines, fi, li + 1, &replacement))
            }
            None => EditApply::NoMatch,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::AnchoredStrategy;
    use crate::edit::{EditApply, EditStrategy};

    #[test]
    fn replaces_block_with_drifted_middle() {
        let content = "fn f() {\n    a();\n    b();\n    c();\n}\n";
        // old's middle differs from the file (drift); anchors fn f() { and }
        let old = "fn f() {\n    OLD MIDDLE\n}";
        let new = "fn f() {\n    rewritten();\n}";
        let outcome = AnchoredStrategy.try_apply(content, old, new, false);
        assert_eq!(
            outcome,
            EditApply::Applied("fn f() {\n    rewritten();\n}\n".to_string())
        );
    }

    #[test]
    fn ambiguous_when_first_anchor_not_unique() {
        let content = "start\nx\nend\nstart\ny\nend\n";
        let old = "start\nMIDDLE\nend";
        let outcome = AnchoredStrategy.try_apply(content, old, "start\nZ\nend", false);
        assert_eq!(outcome, EditApply::Ambiguous(2));
    }

    #[test]
    fn no_match_when_block_far_too_large() {
        // anchors present but bounding 200 lines apart with a 3-line old
        let mut content = String::from("HEAD\n");
        for i in 0..200 {
            content.push_str(&format!("line{i}\n"));
        }
        content.push_str("TAIL\n");
        let old = "HEAD\nm\nTAIL";
        let outcome = AnchoredStrategy.try_apply(&content, old, "HEAD\nx\nTAIL", false);
        assert_eq!(outcome, EditApply::NoMatch);
    }

    #[test]
    fn no_match_for_single_line_old() {
        let outcome = AnchoredStrategy.try_apply("a\nb\n", "a", "z", false);
        assert_eq!(outcome, EditApply::NoMatch);
    }

    #[test]
    fn no_match_when_anchors_absent() {
        let outcome = AnchoredStrategy.try_apply("a\nb\nc\n", "X\nm\nY", "X\nz\nY", false);
        assert_eq!(outcome, EditApply::NoMatch);
    }
}
