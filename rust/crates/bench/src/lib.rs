//! Failure-mode benchmark harness for Xolotl Code.
//!
//! Phase 0 of the long-term harness-improvement plan. This crate runs fixed
//! coding tasks against a model through the real [`runtime::ConversationRuntime`]
//! loop and reports per-model reliability metrics (edit-apply rate, tool-call
//! parse rate, completion rate, …).
//!
//! It depends on `runtime` for the conversation loop and the
//! [`runtime::BenchRecorder`] instrumentation trait, and on `tools` for the
//! production tool dispatch (`execute_tool`). The production conversation path
//! is unaffected when no recorder is attached.
//!
//! Isolation note (blocker B2): the runner rolls its own temp-dir isolation —
//! it does **not** reuse `runtime::WorktreeManager`, which requires an existing
//! git repository.

pub mod recorder;
pub mod runner;

pub use recorder::{CountingRecorder, Metrics};
pub use runner::{run_task, RealToolExecutor, RunOutcome, SeedFile, TaskSpec};
