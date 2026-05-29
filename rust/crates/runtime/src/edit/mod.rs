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
mod fuzzy;
mod util;
mod whitespace;

pub use anchored::AnchoredStrategy;
pub use exact::ExactStrategy;
pub use fuzzy::FuzzyStrategy;
pub use whitespace::WhitespaceStrategy;

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

/// The default edit ladder, ordered tightest → loosest. `exact` runs first so
/// the Claude/Bedrock happy path (exact-string edits) is byte-identical;
/// whitespace and anchored only fire when an exact match is impossible, and
/// `fuzzy` is the gated last resort.
#[must_use]
pub fn default_ladder() -> Vec<Box<dyn EditStrategy>> {
    vec![
        Box::new(ExactStrategy),
        Box::new(WhitespaceStrategy),
        Box::new(AnchoredStrategy),
        Box::new(FuzzyStrategy),
    ]
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
