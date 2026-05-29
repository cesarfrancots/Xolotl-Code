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

mod exact;

pub use exact::ExactStrategy;

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

/// Try each strategy in order and return the first `Applied`. If no strategy
/// applies, report `Ambiguous` when any strategy saw an ambiguous match (more
/// actionable for a re-prompt than a bare miss), otherwise `NoMatch`.
#[must_use]
pub fn apply_edit(
    content: &str,
    old: &str,
    new: &str,
    replace_all: bool,
    ladder: &[Box<dyn EditStrategy>],
) -> EditApply {
    let mut ambiguous: Option<usize> = None;
    for strategy in ladder {
        match strategy.try_apply(content, old, new, replace_all) {
            EditApply::Applied(updated) => return EditApply::Applied(updated),
            EditApply::Ambiguous(count) => {
                ambiguous.get_or_insert(count);
            }
            EditApply::NoMatch => {}
        }
    }
    match ambiguous {
        Some(count) => EditApply::Ambiguous(count),
        None => EditApply::NoMatch,
    }
}

/// The default edit ladder. CP 1.1 ships exact-only — byte-identical to the
/// historical `edit_file` behavior. Later checkpoints append the
/// whitespace / anchored / fuzzy strategies.
#[must_use]
pub fn default_ladder() -> Vec<Box<dyn EditStrategy>> {
    vec![Box::new(ExactStrategy)]
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
    fn orchestrator_prefers_ambiguous_over_no_match_when_nothing_applies() {
        let ladder: Vec<Box<dyn EditStrategy>> = vec![
            Box::new(FixedStrategy("a", EditApply::NoMatch)),
            Box::new(FixedStrategy("b", EditApply::Ambiguous(3))),
            Box::new(FixedStrategy("c", EditApply::NoMatch)),
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
    fn default_ladder_is_exact_only() {
        let ladder = default_ladder();
        assert_eq!(ladder.len(), 1);
        assert_eq!(ladder[0].name(), "exact");
    }
}
