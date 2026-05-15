//! Core types for the agent supervisor: `AgentId`, `AgentState`, `AgentEvent`, `AgentControl`.

use crate::usage::TokenUsage;
use serde::{Deserialize, Serialize};

/// Stable identifier for a supervised agent.
/// Newtype over String — use `AgentId::new()` to generate a unique id.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
pub struct AgentId(pub String);

impl AgentId {
    /// Generate a new unique `AgentId` using a counter-based id.
    pub fn new() -> Self {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        Self(format!("agent-{n}"))
    }
}

impl Default for AgentId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for AgentId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Typed state machine for a supervised agent.
///
/// Valid transitions (`can_transition_to` returns true):
/// - Idle → Planning, Executing
/// - Planning → Executing, Failed
/// - Executing → Waiting, Done, Failed
/// - Waiting → Executing, Failed
/// - Done → (terminal — no transitions)
/// - Failed → (terminal — no transitions)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub enum AgentState {
    Idle,
    Planning,
    Executing,
    /// Blocked on a permission prompt or context pull.
    Waiting,
    Done,
    Failed,
}

impl AgentState {
    /// Returns true if transitioning from self to `next` is a valid state machine step.
    /// Terminal states (Done, Failed) always return false.
    #[must_use]
    pub fn can_transition_to(&self, next: &AgentState) -> bool {
        match (self, next) {
            (AgentState::Done | AgentState::Failed, _) => false,
            (AgentState::Idle, AgentState::Planning | AgentState::Executing) => true,
            (AgentState::Planning, AgentState::Executing | AgentState::Failed) => true,
            (
                AgentState::Executing,
                AgentState::Waiting | AgentState::Done | AgentState::Failed,
            ) => true,
            (AgentState::Waiting, AgentState::Executing | AgentState::Failed) => true,
            _ => false,
        }
    }
}

impl std::fmt::Display for AgentState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AgentState::Idle => write!(f, "idle"),
            AgentState::Planning => write!(f, "planning"),
            AgentState::Executing => write!(f, "executing"),
            AgentState::Waiting => write!(f, "waiting"),
            AgentState::Done => write!(f, "done"),
            AgentState::Failed => write!(f, "failed"),
        }
    }
}

/// Events emitted by a supervised agent.
///
/// This enum is the single event schema for both in-process channels (D-01)
/// and NDJSON stdout serialization from child-process workers (D-04).
/// All variants must remain serde-compatible — do NOT add non-serializable fields.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub enum AgentEvent {
    StateChanged(AgentState),
    ToolCallStarted {
        tool: String,
        input: String,
    },
    ToolCallCompleted {
        tool: String,
        output: String,
    },
    TurnCompleted {
        usage: TokenUsage,
    },
    Error {
        message: String,
    },
    TextDelta(String),
    /// Chain-of-thought delta from reasoning models (Kimi For Coding,
    /// DeepSeek-R1, …). Kept on a separate event so the UI can present it
    /// as a collapsible/muted block beside the main reply.
    ReasoningDelta(String),
}

/// Control messages sent to an agent via its handle.
#[derive(Debug, Clone)]
pub enum AgentControl {
    Stop,
    Pause,
    Resume,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_state_terminal_states_reject_all_transitions() {
        for terminal in [AgentState::Done, AgentState::Failed] {
            for next in [
                AgentState::Idle,
                AgentState::Planning,
                AgentState::Executing,
                AgentState::Waiting,
                AgentState::Done,
                AgentState::Failed,
            ] {
                assert!(
                    !terminal.can_transition_to(&next),
                    "{terminal} should not transition to {next}"
                );
            }
        }
    }

    #[test]
    fn agent_state_valid_transitions() {
        assert!(AgentState::Idle.can_transition_to(&AgentState::Planning));
        assert!(AgentState::Idle.can_transition_to(&AgentState::Executing));
        assert!(AgentState::Planning.can_transition_to(&AgentState::Executing));
        assert!(AgentState::Planning.can_transition_to(&AgentState::Failed));
        assert!(AgentState::Executing.can_transition_to(&AgentState::Waiting));
        assert!(AgentState::Executing.can_transition_to(&AgentState::Done));
        assert!(AgentState::Executing.can_transition_to(&AgentState::Failed));
        assert!(AgentState::Waiting.can_transition_to(&AgentState::Executing));
        assert!(AgentState::Waiting.can_transition_to(&AgentState::Failed));
    }

    #[test]
    fn agent_state_invalid_transitions() {
        // Waiting cannot go back to Idle or Planning
        assert!(!AgentState::Waiting.can_transition_to(&AgentState::Idle));
        assert!(!AgentState::Waiting.can_transition_to(&AgentState::Planning));
        // Idle cannot jump to Done or Failed
        assert!(!AgentState::Idle.can_transition_to(&AgentState::Done));
        assert!(!AgentState::Idle.can_transition_to(&AgentState::Failed));
    }

    #[test]
    fn agent_event_serde_roundtrip() {
        let events = vec![
            AgentEvent::StateChanged(AgentState::Executing),
            AgentEvent::ToolCallStarted {
                tool: "bash".to_string(),
                input: "echo hi".to_string(),
            },
            AgentEvent::ToolCallCompleted {
                tool: "bash".to_string(),
                output: "hi".to_string(),
            },
            AgentEvent::TurnCompleted {
                usage: TokenUsage {
                    input_tokens: 100,
                    output_tokens: 50,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0,
                },
            },
            AgentEvent::Error {
                message: "test error".to_string(),
            },
            AgentEvent::TextDelta("hello".to_string()),
        ];

        for event in &events {
            let json = serde_json::to_string(event).expect("serialize ok");
            let back: AgentEvent = serde_json::from_str(&json).expect("deserialize ok");
            // Re-serialize and compare strings as AgentEvent doesn't derive PartialEq
            let json2 = serde_json::to_string(&back).expect("re-serialize ok");
            assert_eq!(json, json2, "serde roundtrip failed for event");
        }
    }

    #[test]
    fn agent_id_display_and_uniqueness() {
        let id1 = AgentId::new();
        let id2 = AgentId::new();
        assert_ne!(id1, id2);
        assert!(id1.to_string().starts_with("agent-"));
    }
}
