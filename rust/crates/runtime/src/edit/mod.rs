//! Pluggable edit-strategy ladder (Phase 1 — Resilient Edit / Apply Layer).
//!
//! `edit_file` (see `file_ops.rs`) historically applied a single exact-substring
//! replacement with no fallback. This module factors the *apply* step into an
//! ordered ladder of [`EditStrategy`] implementations, tried from tightest to
//! loosest match. The orchestrator [`apply_edit`] returns the first strategy's
//! `Applied` result; if none applies it reports the most informative failure.
//!
//! Strategies are pure string transforms (no I/O), so they are trivially
//! unit-testable; `edit_file` keeps the file read/write around the ladder.
//!
//! Blocker B1: this lives in `runtime` (not `tools`/`bench`) because the edit
//! primitive lives here and the dependency edge is one-way (`tools → runtime`).
//!
//! Risk R1: an ambiguous match is **never** silently applied. A strategy that
//! finds more than one plausible location returns [`EditApply::Ambiguous`], and
//! the caller turns that into a re-prompt rather than guessing.

mod anchored;
mod exact;
mod failure;
pub mod formats;
mod fuzzy;
mod util;
mod whitespace;

pub use anchored::AnchoredStrategy;
pub use exact::ExactStrategy;
pub use failure::{EditFailure, EditFailureKind};
pub use formats::{parse_search_replace, parse_udiff, EditFormat, EditOp};
pub use fuzzy::FuzzyStrategy;
pub use whitespace::WhitespaceStrategy;

use serde::{Deserialize, Serialize};

/// Files at or below this many lines are shown in full in a failure region;
/// larger files show a focused window around the closest fuzzy candidate.
const REGION_MAX_LINES: usize = 80;
/// Context lines shown on each side of the closest candidate in a large file.
const REGION_CONTEXT: usize = 12;

/// Build a line-numbered file region to show the model after a failed edit:
/// the whole file when small, otherwise a window around the closest fuzzy
/// candidate for `old`.
#[must_use]
pub fn locate_region(content: &str, old: &str) -> String {
    let file_lines: Vec<&str> = content.lines().collect();
    if file_lines.len() <= REGION_MAX_LINES {
        return number_lines(&file_lines, 0);
    }
    let span = old.lines().count().max(1);
    let center = fuzzy::best_window(content, old).unwrap_or(0);
    let start = center.saturating_sub(REGION_CONTEXT);
    let end = (center + span + REGION_CONTEXT).min(file_lines.len());
    number_lines(&file_lines[start..end], start)
}

/// Render lines with 1-indexed line numbers starting at `offset` + 1.
fn number_lines(lines: &[&str], offset: usize) -> String {
    lines
        .iter()
        .enumerate()
        .map(|(i, line)| format!("{:>5} | {}", offset + i + 1, line))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Result of attempting to apply an edit to file *content* (no I/O).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EditApply {
    /// The edit applied cleanly; carries the full new file content.
    Applied(String),
    /// This strategy found no place to apply the edit.
    NoMatch,
    /// The edit matched in more than one plausible location (carries the
    /// candidate count). Never applied — the caller must disambiguate.
    Ambiguous(usize),
}

/// One rung of the edit ladder. Implementations are pure: given the current
/// file `content` and the requested `old`/`new` strings they return an
/// [`EditApply`] without touching the filesystem.
pub trait EditStrategy {
    /// Stable identifier (used by hints/metrics).
    fn name(&self) -> &'static str;

    /// Attempt to apply `old` → `new` within `content`.
    fn try_apply(&self, content: &str, old: &str, new: &str, replace_all: bool) -> EditApply;
}

/// Try each strategy in order. Return the first `Applied`. If a strategy reports
/// `Ambiguous`, stop and return that immediately: a tighter strategy already
/// found more than one plausible match, and a looser one cannot safely
/// disambiguate it (R1). If every strategy misses, return `NoMatch`.
#[must_use]
pub fn apply_edit(
    content: &str,
    old: &str,
    new: &str,
    replace_all: bool,
    ladder: &[Box<dyn EditStrategy>],
) -> EditApply {
    for strategy in ladder {
        match strategy.try_apply(content, old, new, replace_all) {
            EditApply::Applied(updated) => return EditApply::Applied(updated),
            EditApply::Ambiguous(count) => return EditApply::Ambiguous(count),
            EditApply::NoMatch => {}
        }
    }
    EditApply::NoMatch
}

/// Which edit-ladder rungs are enabled for a model. All on by default (D3);
/// P6 may disable a rung for a model that mis-applies it. `exact` is the safe
/// control rung and is expected to stay enabled.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[allow(clippy::struct_excessive_bools)]
pub struct EditStrategySet {
    pub exact: bool,
    pub whitespace: bool,
    pub anchored: bool,
    pub fuzzy: bool,
}

impl EditStrategySet {
    /// All rungs enabled (the D3 default for every model).
    #[must_use]
    pub fn all() -> Self {
        Self {
            exact: true,
            whitespace: true,
            anchored: true,
            fuzzy: true,
        }
    }
}

impl Default for EditStrategySet {
    fn default() -> Self {
        Self::all()
    }
}

/// The default edit ladder, ordered tightest → loosest. `exact` runs first so
/// the Claude/Bedrock happy path (exact-string edits) is byte-identical;
/// whitespace and anchored only fire when an exact match is impossible, and
/// `fuzzy` is the gated last resort.
#[must_use]
pub fn default_ladder() -> Vec<Box<dyn EditStrategy>> {
    ladder_from_set(EditStrategySet::all())
}

/// Build the ladder containing only the rungs enabled in `set`, preserving the
/// tightest → loosest order. This is how a model's `enabled_edit_strategies`
/// hint is plumbed into the orchestrator.
#[must_use]
pub fn ladder_from_set(set: EditStrategySet) -> Vec<Box<dyn EditStrategy>> {
    let mut ladder: Vec<Box<dyn EditStrategy>> = Vec::new();
    if set.exact {
        ladder.push(Box::new(ExactStrategy));
    }
    if set.whitespace {
        ladder.push(Box::new(WhitespaceStrategy));
    }
    if set.anchored {
        ladder.push(Box::new(AnchoredStrategy));
    }
    if set.fuzzy {
        ladder.push(Box::new(FuzzyStrategy));
    }
    ladder
}

#[cfg(test)]
mod tests {
    use super::{apply_edit, default_ladder, EditApply, EditStrategy};

    /// A strategy that always returns a fixed outcome — for orchestrator tests.
    struct FixedStrategy(&'static str, EditApply);
    impl EditStrategy for FixedStrategy {
        fn name(&self) -> &'static str {
            self.0
        }
        fn try_apply(&self, _: &str, _: &str, _: &str, _: bool) -> EditApply {
            self.1.clone()
        }
    }

    #[test]
    fn orchestrator_returns_first_applied() {
        let ladder: Vec<Box<dyn EditStrategy>> = vec![
            Box::new(FixedStrategy("a", EditApply::NoMatch)),
            Box::new(FixedStrategy("b", EditApply::Applied("won".to_string()))),
            Box::new(FixedStrategy("c", EditApply::Applied("loser".to_string()))),
        ];
        assert_eq!(
            apply_edit("x", "x", "y", false, &ladder),
            EditApply::Applied("won".to_string())
        );
    }

    #[test]
    fn orchestrator_stops_at_ambiguous_and_never_reaches_looser_strategy() {
        // A NoMatch, then Ambiguous, then a strategy that WOULD apply: the
        // ambiguous result wins and the looser strategy is never consulted.
        let ladder: Vec<Box<dyn EditStrategy>> = vec![
            Box::new(FixedStrategy("a", EditApply::NoMatch)),
            Box::new(FixedStrategy("b", EditApply::Ambiguous(3))),
            Box::new(FixedStrategy("c", EditApply::Applied("unsafe".to_string()))),
        ];
        assert_eq!(
            apply_edit("x", "x", "y", false, &ladder),
            EditApply::Ambiguous(3)
        );
    }

    #[test]
    fn orchestrator_reports_no_match_when_all_miss() {
        let ladder: Vec<Box<dyn EditStrategy>> =
            vec![Box::new(FixedStrategy("a", EditApply::NoMatch))];
        assert_eq!(
            apply_edit("x", "x", "y", false, &ladder),
            EditApply::NoMatch
        );
    }

    #[test]
    fn default_ladder_is_ordered_tightest_first() {
        let ladder = default_ladder();
        let names: Vec<&str> = ladder.iter().map(|s| s.name()).collect();
        assert_eq!(names, vec!["exact", "whitespace", "anchored", "fuzzy"]);
    }

    #[test]
    fn ladder_from_set_includes_only_enabled_rungs_in_order() {
        use super::{ladder_from_set, EditStrategySet};
        let set = EditStrategySet {
            exact: true,
            whitespace: false,
            anchored: false,
            fuzzy: true,
        };
        let names: Vec<&str> = ladder_from_set(set).iter().map(|s| s.name()).collect();
        assert_eq!(names, vec!["exact", "fuzzy"]);
    }

    #[test]
    fn exact_wins_over_looser_strategies_when_it_matches() {
        // "x = 1" appears once verbatim and once with different indentation.
        // Exact must replace the verbatim one and stop (no ambiguity), even
        // though whitespace would consider both blocks.
        let content = "x = 1\n    x = 1\n";
        let outcome = apply_edit(content, "x = 1", "x = 2", false, &default_ladder());
        assert_eq!(
            outcome,
            EditApply::Applied("x = 2\n    x = 1\n".to_string())
        );
    }
}
