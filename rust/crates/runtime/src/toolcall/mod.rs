//! Malformed tool-call recovery (Phase 2). Open models frequently emit
//! tool-call arguments that are *almost* valid — fenced, trailing-comma'd, or
//! truncated JSON — or call a tool with a missing/mistyped field. This module
//! salvages and validates such calls so the loop can re-prompt precisely
//! instead of leaving the model to debug blind.
//!
//! Constraint B5: this lives in `runtime`, which cannot import `tools`. It
//! validates against tool JSON schemas passed into the runtime as data, never
//! by importing `tools::mvp_tool_specs`.

pub mod fallback_parser;
pub mod repair;
pub mod validate;

pub use fallback_parser::parse_tool_call_from_text;
pub use repair::repair_json;
pub use validate::{describe_schema, validate_against_schema};
