//! Correctness feedback loop (Phase 3): detect a project's verify commands and
//! (CP 3.2) run them after edits, feeding failures back into the conversation.
//!
//! Hooks are fire-and-forget (`Hook::on_event -> ()`, blocker B3), so post-edit
//! verification is an in-loop step in `conversation.rs` that appends a synthetic
//! tool result — not a hook. This module supplies the building blocks: project
//! detection (`detect`) and, later, output parsing.

mod detect;
mod parse;

pub use detect::{
    detect_project, resolve_verify_commands, ProjectKind, VerifyCommand, VerifyCommands,
};
pub use parse::{format_digest, parse_check_output, Diagnostic};
