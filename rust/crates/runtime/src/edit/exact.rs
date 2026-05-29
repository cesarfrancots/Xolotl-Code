//! Exact-substring strategy — byte-identical to the historical `edit_file`
//! apply step. `replace_all` replaces every occurrence; otherwise only the
//! first. This is the tightest (and safest) rung of the ladder and is always
//! tried first, so the Claude/Bedrock happy path is unchanged.

use super::{EditApply, EditStrategy};

/// Applies `old` → `new` only when `old` appears verbatim in the content.
pub struct ExactStrategy;

impl EditStrategy for ExactStrategy {
    fn name(&self) -> &'static str {
        "exact"
    }

    fn try_apply(&self, content: &str, old: &str, new: &str, replace_all: bool) -> EditApply {
        if !content.contains(old) {
            return EditApply::NoMatch;
        }
        let updated = if replace_all {
            content.replace(old, new)
        } else {
            content.replacen(old, new, 1)
        };
        EditApply::Applied(updated)
    }
}

#[cfg(test)]
mod tests {
    use super::ExactStrategy;
    use crate::edit::{EditApply, EditStrategy};

    #[test]
    fn applies_first_occurrence_by_default() {
        let outcome = ExactStrategy.try_apply("alpha beta alpha", "alpha", "omega", false);
        assert_eq!(outcome, EditApply::Applied("omega beta alpha".to_string()));
    }

    #[test]
    fn applies_all_occurrences_when_requested() {
        let outcome = ExactStrategy.try_apply("alpha beta alpha", "alpha", "omega", true);
        assert_eq!(outcome, EditApply::Applied("omega beta omega".to_string()));
    }

    #[test]
    fn reports_no_match_when_absent() {
        let outcome = ExactStrategy.try_apply("alpha beta", "gamma", "omega", false);
        assert_eq!(outcome, EditApply::NoMatch);
    }
}
