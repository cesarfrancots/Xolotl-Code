//! Alternate edit payload formats (D3). Some open models emit edits more
//! reliably as aider-style search/replace blocks or as unified diffs than as
//! `old_string`/`new_string` arguments. These parsers normalize such payloads
//! into [`EditOp`]s that the edit ladder can apply.
//!
//! Per D3 these formats are **opt-in** via `ModelHints::preferred_edit_format`;
//! the default remains `OldNew` for every model until P6 data justifies a
//! per-model switch. This module ships the parsers as ready infrastructure.

mod search_replace;
mod udiff;

pub use search_replace::parse_search_replace;
pub use udiff::parse_udiff;

use serde::{Deserialize, Serialize};

/// The edit payload format a model prefers to emit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum EditFormat {
    /// `old_string` / `new_string` arguments (the historical default).
    #[default]
    OldNew,
    /// aider-style `<<<<<<< SEARCH … ======= … >>>>>>> REPLACE` blocks.
    SearchReplace,
    /// Unified diff hunks (`@@ … @@` with `-`/`+` lines).
    Udiff,
}

/// A normalized edit operation parsed from an alternate format: replace `old`
/// with `new` in `path` (when the format carries a path, e.g. udiff headers).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EditOp {
    /// Target file path, when the format encodes it (udiff `+++`); otherwise the
    /// caller supplies the path out-of-band.
    pub path: Option<String>,
    pub old: String,
    pub new: String,
}

#[cfg(test)]
mod tests {
    use super::EditFormat;

    #[test]
    fn default_format_is_old_new() {
        assert_eq!(EditFormat::default(), EditFormat::OldNew);
    }
}
