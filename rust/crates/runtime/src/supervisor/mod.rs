//! Orchestration supervisor — actor model for multi-agent coordination.
//!
//! All public types are re-exported from this module.
//! Phase 3 (Tauri) imports from `runtime::supervisor::*`.

mod agent_state;

// Wave 2 modules (created in Plan 02 and Plan 03):
// mod context_store;
// mod git_queue;
// mod worktree;

// Wave 3 modules (created in Plan 04):
// mod handle;
// mod supervisor;

pub use agent_state::{AgentControl, AgentEvent, AgentId, AgentState};
