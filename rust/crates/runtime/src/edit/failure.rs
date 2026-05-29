//! Structured edit-failure signal (B6). `edit_file` returns `Result<_, String>`,
//! so a failed edit reaches the conversation loop only as text. To let the loop
//! recognize an edit failure *without parsing prose* — and to give the model a
//! genuinely actionable re-prompt — a failure is rendered with a stable machine
//! tag plus the relevant file region and re-emit guidance.

/// Machine tag prefixed to a "could not locate `old_string`" failure message.
pub const NO_MATCH_TAG: &str = "[edit_file:no_match]";
/// Machine tag prefixed to an "ambiguous match" failure message.
pub const AMBIGUOUS_TAG: &str = "[edit_file:ambiguous]";

/// Why an edit could not be applied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EditFailureKind {
    /// No exact/whitespace/anchored/fuzzy match for `old_string`.
    NoMatch,
    /// `old_string` matched in more than one place (carries the count).
    Ambiguous(usize),
}

/// A failed edit, carrying the kind and a helpful file `region` to show the
/// model so it can re-emit a correct edit.
#[derive(Debug, Clone)]
pub struct EditFailure {
    pub kind: EditFailureKind,
    /// A snippet of the current file (line-numbered) for the model to copy from.
    pub region: String,
}

impl EditFailure {
    /// Render the actionable re-prompt message, prefixed with the machine tag.
    #[must_use]
    pub fn message(&self) -> String {
        match &self.kind {
            EditFailureKind::NoMatch => format!(
                "{NO_MATCH_TAG} edit_file could not find old_string in the file \
                 (no exact, whitespace, anchored, or fuzzy match).\n\n\
                 Current file content — copy old_string EXACTLY from here, including \
                 indentation:\n{region}\n\n\
                 Re-emit edit_file with an old_string that appears verbatim in the file \
                 above, including enough surrounding lines to make it unique.",
                region = self.region,
            ),
            EditFailureKind::Ambiguous(count) => format!(
                "{AMBIGUOUS_TAG} edit_file found {count} possible locations for old_string, \
                 so nothing was changed (ambiguous match).\n\n{region}\n\n\
                 Re-emit edit_file with a larger old_string that includes enough surrounding \
                 context to identify exactly one location (or set replace_all if you intend \
                 to change every occurrence).",
                region = self.region,
            ),
        }
    }

    /// True when `message` is a structured edit-failure produced by `message()`.
    #[must_use]
    pub fn is_edit_failure(message: &str) -> bool {
        message.contains(NO_MATCH_TAG) || message.contains(AMBIGUOUS_TAG)
    }
}

#[cfg(test)]
mod tests {
    use super::{EditFailure, EditFailureKind, AMBIGUOUS_TAG, NO_MATCH_TAG};

    #[test]
    fn no_match_message_carries_tag_and_region() {
        let f = EditFailure {
            kind: EditFailureKind::NoMatch,
            region: "    1 | fn main() {}".to_string(),
        };
        let msg = f.message();
        assert!(msg.contains(NO_MATCH_TAG));
        assert!(msg.contains("fn main()"));
        assert!(EditFailure::is_edit_failure(&msg));
    }

    #[test]
    fn ambiguous_message_carries_tag_and_count() {
        let f = EditFailure {
            kind: EditFailureKind::Ambiguous(3),
            region: String::new(),
        };
        let msg = f.message();
        assert!(msg.contains(AMBIGUOUS_TAG));
        assert!(msg.contains('3'));
        assert!(EditFailure::is_edit_failure(&msg));
    }

    #[test]
    fn plain_text_is_not_an_edit_failure() {
        assert!(!EditFailure::is_edit_failure("some other tool error"));
    }
}
