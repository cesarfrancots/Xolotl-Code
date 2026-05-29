//! Fuzzy strategy — the last resort. When exact, whitespace, and anchored all
//! miss, this ranks file blocks by similarity to `old` and applies the best one
//! **only** if it clears the confidence threshold (D2 = 0.85) and is unique.
//!
//! Similarity (D1) is a difflib-style Ratcliff–Obershelp ratio over the
//! whitespace-normalized text, implemented in pure Rust (no new dependency).
//!
//! Safety (R1): below threshold → `NoMatch`; two or more high-confidence matches
//! in distinct regions → `Ambiguous`. A wrong fuzzy apply is the single biggest
//! risk in this layer, so the gate is deliberately strict and never guesses.

use super::util::{leading_whitespace, reindent, splice};
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
    if normalized_old.is_empty() {
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
        let score = ratio(&normalized_old, &window);
        if best.is_none_or(|(_, b)| score > b) {
            best = Some((i, score));
        }
    }
    best.map(|(i, _)| i)
}

impl EditStrategy for FuzzyStrategy {
    fn name(&self) -> &'static str {
        "fuzzy"
    }

    fn try_apply(&self, content: &str, old: &str, new: &str, _replace_all: bool) -> EditApply {
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

        // Score every same-height window that clears the confidence threshold.
        let mut hits: Vec<(usize, f64)> = Vec::new();
        for i in 0..=file_lines.len() - span {
            let window = file_lines[i..i + span].join("\n");
            let normalized_window = normalize(&window);
            if normalized_window.len() > MAX_NORMALIZED_LEN {
                continue;
            }
            let score = ratio(&normalized_old, &normalized_window);
            if score >= CONFIDENCE_THRESHOLD {
                hits.push((i, score));
            }
        }

        if hits.is_empty() {
            return EditApply::NoMatch;
        }

        // Cluster overlapping/adjacent high-confidence windows into regions
        // (windows within `span` of each other describe the same region). Two
        // distinct regions ⇒ genuinely ambiguous; never guess.
        hits.sort_by_key(|(i, _)| *i);
        let mut regions = 1usize;
        for pair in hits.windows(2) {
            if pair[1].0 - pair[0].0 >= span {
                regions += 1;
            }
        }
        if regions > 1 {
            return EditApply::Ambiguous(regions);
        }

        // Single region: apply the highest-scoring window in it.
        let (best_index, _) = hits
            .iter()
            .copied()
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
            .expect("hits is non-empty");
        let replacement = reindent(
            new,
            leading_whitespace(old_lines[0]),
            leading_whitespace(file_lines[best_index]),
        );
        EditApply::Applied(splice(
            content,
            &file_lines,
            best_index,
            best_index + span,
            &replacement,
        ))
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
}
