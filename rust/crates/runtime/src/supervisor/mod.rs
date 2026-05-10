//! Orchestration supervisor — actor model for multi-agent coordination.

mod agent_state;
mod context_store;
mod git_queue;
mod handle;
mod supervisor;
mod worktree;

pub use agent_state::{AgentControl, AgentEvent, AgentId, AgentState};
pub use context_store::{ContextError, SharedContextStore};
pub use git_queue::GitOpQueue;
pub use handle::{AgentHandle, slugify_task};
pub use supervisor::{AgentSupervisor, SupervisorError};
pub use worktree::{WorktreeError, WorktreeManager};

#[cfg(test)]
mod tests;
