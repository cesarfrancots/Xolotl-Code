//! Orchestration supervisor — actor model for multi-agent coordination.
//!
//! All public types are re-exported from this module.
//! Phase 3 (Tauri) imports from `runtime::supervisor::*`.

mod agent_state;
mod context_store;
mod git_queue;
mod worktree;

mod handle;
// Wave 3 (supervisor.rs added in T02):
// mod supervisor;

pub use agent_state::{AgentControl, AgentEvent, AgentId, AgentState};
pub use context_store::{ContextError, SharedContextStore};
pub use git_queue::GitOpQueue;
pub use handle::AgentHandle;
pub use worktree::{WorktreeError, WorktreeManager};
