//! Fuzzy strategy — the last resort. When exact and whitespace miss, this ranks
//! same-height file blocks by similarity to `old` and applies the best one
//! **only** if it clears the confidence threshold (D2 = 0.85) and is the unique
//! placement.
//!
//! Similarity (D1) is a difflib-style Ratcliff–Obershelp ratio over the
//! whitespace-normalized text, implemented in pure Rust (no new dependency).
//!
//! Safety (R1) — a wrong fuzzy apply is the single biggest risk in this layer:
//! - below threshold → `NoMatch`;
//! - two or more **non-overlapping** high-confidence placements → `Ambiguous`
//!   (this correctly catches duplicated multi-line blocks, not just spaced-out
//!   ones);
//! - a **single-line** match is accepted only when `old` and the candidate
//!   differ purely in whitespace. This refuses the dangerous near-twin case
//!   where a one-character logic flip (a dropped `!`, `==` vs `!=`, `+` vs `-`)
//!   scores far above 0.85 — applying there would silently invert the line.

use super::util::{reindent_block, splice};
use super::{EditApply, EditStrategy};

/// Minimum similarity (D2) for a fuzzy match to be eligible to apply.
const CONFIDENCE_THRESHOLD: f64 = 0.85;

/// Cap on normalized-text length compared per pair, bounding the O(n·m)
/// Ratcliff–Obershelp cost; larger blocks decline fuzzy matching (safer anyway).
const MAX_NORMALIZED_LEN: usize = 2_000;

pub struct FuzzyStrategy;

/// Collapse all runs of whitespace (including newlines) to single spaces.
fn normalize(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// difflib-style similarity ratio (Ratcliff–Obershelp): 2·M / T, where M is the
/// total number of characters in matching blocks found by recursively matching
/// the longest common contiguous substring, and T is the combined length.
#[allow(clippy::cast_precision_loss)]
fn ratio(a: &str, b: &str) -> f64 {
    let ca: Vec<char> = a.chars().collect();
    let cb: Vec<char> = b.chars().collect();
    let total = ca.len() + cb.len();
    if total == 0 {
        return 1.0;
    }
    let matches = matching_chars(&ca, &cb);
    2.0 * matches as f64 / total as f64
}

/// Total matching characters via recursive longest-common-substring (the
/// Ratcliff–Obershelp matching-blocks count).
#[allow(clippy::similar_names)]
fn matching_chars(a: &[char], b: &[char]) -> usize {
    if a.is_empty() || b.is_empty() {
        return 0;
    }
    // Longest common substring via rolling DP rows.
    let mut prev = vec![0usize; b.len() + 1];
    let (mut best_len, mut best_a_end, mut best_b_end) = (0usize, 0usize, 0usize);
    for i in 1..=a.len() {
        let mut cur = vec![0usize; b.len() + 1];
        for j in 1..=b.len() {
            if a[i - 1] == b[j - 1] {
                cur[j] = prev[j - 1] + 1;
                if cur[j] > best_len {
                    best_len = cur[j];
                    best_a_end = i;
                    best_b_end = j;
                }
            }
        }
        prev = cur;
    }
    if best_len == 0 {
        return 0;
    }
    let (a_start, b_start) = (best_a_end - best_len, best_b_end - best_len);
    matching_chars(&a[..a_start], &b[..b_start])
        + best_len
        + matching_chars(&a[best_a_end..], &b[best_b_end..])
}

/// Index of the same-height window in `content` most similar to `old`, for
/// showing the model the likeliest region after a failed match. Returns `None`
/// when `old` or `content` is empty or `old` is taller than the file.
pub(super) fn best_window(content: &str, old: &str) -> Option<usize> {
    let normalized_old = normalize(old);
    // Cap the comparison cost on the failure path too (locate_region calls this
    // on every NoMatch/Ambiguous): without the cap a large minified file could
    // hang the loop for seconds.
    if normalized_old.is_empty() || normalized_old.len() > MAX_NORMALIZED_LEN {
        return None;
    }
    let file_lines: Vec<&str> = content.lines().collect();
    let span = old.lines().count().max(1);
    if span > file_lines.len() {
        return None;
    }
    let mut best: Option<(usize, f64)> = None;
    for i in 0..=file_lines.len() - span {
        let window = normalize(&file_lines[i..i + span].join("\n"));
        if window.len() > MAX_NORMALIZED_LEN {
            continue;
        }
        let score = ratio(&normalized_old, &window);
        if best.is_none_or(|(_, b)| score > b) {
            best = Some((i, score));
        }
    }
    best.map(|(i, _)| i)
}

/// All characters of `text` with every whitespace character removed.
fn strip_whitespace(text: &str) -> String {
    text.chars().filter(|c| !c.is_whitespace()).collect()
}

/// Greedy maximum set of non-overlapping window start indices (each at least
/// `span` apart). Two non-overlapping high-confidence windows mean `old` fits in
/// two genuinely distinct places — ambiguous.
fn non_overlapping(sorted_indices: &[usize], span: usize) -> Vec<usize> {
    let mut picked = Vec::new();
    let mut next_free = 0usize;
    for &i in sorted_indices {
        if picked.is_empty() || i >= next_free {
            picked.push(i);
            next_free = i + span;
        }
    }
    picked
}

impl EditStrategy for FuzzyStrategy {
    fn name(&self) -> &'static str {
        "fuzzy"
    }

    fn try_apply(&self, content: &str, old: &str, new: &str, replace_all: bool) -> EditApply {
        let old_lines: Vec<&str> = old.lines().collect();
        if old_lines.is_empty() {
            return EditApply::NoMatch;
        }
        let normalized_old = normalize(old);
        if normalized_old.is_empty() || normalized_old.len() > MAX_NORMALIZED_LEN {
            return EditApply::NoMatch;
        }

        let file_lines: Vec<&str> = content.lines().collect();
        let span = old_lines.len();
        if span > file_lines.len() {
            return EditApply::NoMatch;
        }
        let single_line = span == 1;
        let old_stripped = strip_whitespace(old);

        // Collect every same-height window that clears the confidence threshold.
        // For a single-line match, additionally require a *whitespace-only*
        // difference — a one-character logic flip must never be fuzzily applied.
        let mut hits: Vec<usize> = Vec::new();
        for i in 0..=file_lines.len() - span {
            let window = file_lines[i..i + span].join("\n");
            let normalized_window = normalize(&window);
            if normalized_window.len() > MAX_NORMALIZED_LEN {
                continue;
            }
            if ratio(&normalized_old, &normalized_window) < CONFIDENCE_THRESHOLD {
                continue;
            }
            if single_line && strip_whitespace(&window) != old_stripped {
                continue;
            }
            hits.push(i);
        }

        if hits.is_empty() {
            return EditApply::NoMatch;
        }

        let placements = non_overlapping(&hits, span);

        if replace_all {
            // Apply to every distinct placement (each already passed the gate),
            // splicing right-to-left so earlier indices stay valid.
            let mut current = content.to_string();
            let mut applied_any = false;
            for &i in placements.iter().rev() {
                let lines: Vec<&str> = current.lines().collect();
                if let Some(replacement) = reindent_block(new, &old_lines, &lines[i..i + span]) {
                    let next = splice(&current, &lines, i, i + span, &replacement);
                    drop(lines);
                    current = next;
                    applied_any = true;
                }
            }
            return if applied_any {
                EditApply::Applied(current)
            } else {
                EditApply::NoMatch
            };
        }

        // Two or more distinct placements ⇒ ambiguous; never guess.
        if placements.len() > 1 {
            return EditApply::Ambiguous(placements.len());
        }
        let i = placements[0];
        match reindent_block(new, &old_lines, &file_lines[i..i + span]) {
            Some(replacement) => {
                EditApply::Applied(splice(content, &file_lines, i, i + span, &replacement))
            }
            None => EditApply::NoMatch,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ratio, FuzzyStrategy};
    use crate::edit::{EditApply, EditStrategy};

    #[test]
    fn ratio_is_one_for_identical_and_zero_for_disjoint() {
        assert!((ratio("hello world", "hello world") - 1.0).abs() < 1e-9);
        assert_eq!(ratio("abc", "xyz"), 0.0);
    }

    #[test]
    fn applies_when_only_internal_whitespace_differs() {
        // whitespace strategy trims ends only, so "foo(a, b)" vs "foo(a,b)" is
        // not a whitespace match; fuzzy should catch the high-similarity line.
        let content = "let x = foo(a,b);\nlet y = 2;\n";
        let outcome = FuzzyStrategy.try_apply(
            content,
            "let x = foo(a, b);",
            "let x = foo(a, b, c);",
            false,
        );
        assert_eq!(
            outcome,
            EditApply::Applied("let x = foo(a, b, c);\nlet y = 2;\n".to_string())
        );
    }

    #[test]
    fn rejects_below_threshold() {
        let content = "completely different line here\n";
        let outcome = FuzzyStrategy.try_apply(content, "let x = foo(a, b);", "z", false);
        assert_eq!(outcome, EditApply::NoMatch);
    }

    #[test]
    fn ambiguous_when_two_distinct_regions_match() {
        let content = "let value = compute(a,b);\nmiddle\nlet value = compute(a,b);\n";
        let outcome = FuzzyStrategy.try_apply(
            content,
            "let value = compute(a, b);",
            "let value = compute(a, b, c);",
            false,
        );
        assert!(
            matches!(outcome, EditApply::Ambiguous(_)),
            "got {outcome:?}"
        );
    }

    #[test]
    fn overlapping_windows_of_one_region_are_not_falsely_ambiguous() {
        // A 2-line block whose neighbor windows share a line should resolve to a
        // single region, not an ambiguous match.
        let content = "fn a() {}\nlet total = sum(x,y);\nlet other = 9;\n";
        let outcome = FuzzyStrategy.try_apply(
            content,
            "let total = sum(x, y);\nlet other = 9;",
            "let total = sum(x, y, z);\nlet other = 9;",
            false,
        );
        assert!(matches!(outcome, EditApply::Applied(_)), "got {outcome:?}");
    }

    #[test]
    fn refuses_single_line_negation_flip() {
        // The file has `!is_blocked`; the model's old dropped the `!`. The
        // one-char diff scores ~0.98 but is semantically opposite — fuzzy must
        // refuse it (whitespace-only guard) rather than silently invert the line.
        let content = "        let allowed = !is_blocked(user);\n";
        let outcome = FuzzyStrategy.try_apply(
            content,
            "        let allowed = is_blocked(user);",
            "        let allowed = is_blocked(user) && quota_ok(user);",
            false,
        );
        assert_eq!(outcome, EditApply::NoMatch);
    }

    #[test]
    fn refuses_single_line_operator_flip() {
        let content = "    if status == 200 { ok(); }\n";
        let outcome = FuzzyStrategy.try_apply(
            content,
            "    if status != 200 { ok(); }",
            "    ok();",
            false,
        );
        assert_eq!(outcome, EditApply::NoMatch);
    }

    #[test]
    fn duplicate_multiline_run_is_ambiguous_not_silently_applied() {
        // Four identical lines hold two distinct non-overlapping 2-line
        // placements for old → ambiguous, never an arbitrary silent single apply.
        let content = "P(a,b);\nP(a,b);\nP(a,b);\nP(a,b);\n";
        let outcome =
            FuzzyStrategy.try_apply(content, "P(a, b);\nP(a, b);", "Q(a, b);\nQ(a, b);", false);
        assert!(
            matches!(outcome, EditApply::Ambiguous(_)),
            "got {outcome:?}"
        );
    }

    #[test]
    fn replace_all_applies_to_each_distinct_placement() {
        let content = "P(a,b);\nP(a,b);\nP(a,b);\nP(a,b);\n";
        let outcome =
            FuzzyStrategy.try_apply(content, "P(a, b);\nP(a, b);", "Q(a, b);\nQ(a, b);", true);
        assert_eq!(
            outcome,
            EditApply::Applied("Q(a, b);\nQ(a, b);\nQ(a, b);\nQ(a, b);\n".to_string())
        );
    }
}
