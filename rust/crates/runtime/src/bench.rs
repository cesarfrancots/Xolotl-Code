//! Benchmark instrumentation seam (Phase 0 of the harness-improvement plan).
//!
//! The conversation loop can carry an optional [`BenchRecorder`]. When attached,
//! it observes tool-call parse outcomes and `edit_file` apply outcomes so the
//! `bench` crate can compute per-model reliability metrics. When **not** attached
//! (the default and the entire production path), the cost is a single `Option`
//! check per tool call — behavior is byte-identical to before.
//!
//! Blocker B1: this trait must live in `runtime` (not `bench`). The dependency
//! edge is one-way (`tools → runtime`), so a trait referenced by the loop must
//! sit in `runtime`; the concrete counting recorder lives in `bench`.

use std::sync::Arc;

/// Outcome of an `edit_file` tool invocation, classified for benchmarking.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditOutcome {
    /// `edit_file` returned successfully — the edit was written to disk.
    Applied,
    /// `old_string` was not present in the target file.
    NoMatch,
    /// The edit failed for some other reason (file missing, no-op edit, …).
    Error,
}

/// Observes runtime events during a benchmark run.
///
/// Implementations must be cheap and thread-safe: tool execution runs on worker
/// threads, so the recorder is shared as `Arc<dyn BenchRecorder>` and its methods
/// may be called concurrently. Use interior mutability (e.g. atomics) rather than
/// `&mut self`.
pub trait BenchRecorder: Send + Sync {
    /// Record that the model emitted a tool call. `parsed_ok` is `true` when the
    /// raw `input` deserializes as valid JSON — a proxy for first-parse usability.
    fn record_tool_call(&self, tool_name: &str, raw_input: &str, parsed_ok: bool);

    /// Record the outcome of an `edit_file` invocation. `detail` carries a
    /// human-readable message (the underlying error text for non-`Applied`).
    fn record_edit(&self, outcome: EditOutcome, detail: &str);
}

/// Shared, thread-safe handle to a [`BenchRecorder`].
pub type SharedBenchRecorder = Arc<dyn BenchRecorder>;
