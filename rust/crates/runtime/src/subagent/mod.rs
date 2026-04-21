//! Sub-agent orchestration for parallel task delegation.
//!
//! This module provides the infrastructure for spawning child agent runtimes
//! that execute tasks independently, enabling the parent runtime to scale
//! complex work across multiple concurrent agents.

mod registry;
mod result;
mod spawner;

pub use registry::{AggregatedResults, TaskRegistry, TaskStatus};
pub use result::{ErrorCategory, SubAgentResult};
pub use spawner::{SubAgentConfig, SubAgentSpawner};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SubAgentStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl std::fmt::Display for SubAgentStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Pending => write!(f, "pending"),
            Self::Running => write!(f, "running"),
            Self::Completed => write!(f, "completed"),
            Self::Failed => write!(f, "failed"),
            Self::Cancelled => write!(f, "cancelled"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubAgentInfo {
    pub task_id: String,
    pub description: String,
    pub status: SubAgentStatus,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub output_preview: Option<String>,
}
