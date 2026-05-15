//! `AgentHandle` — typed control surface for a single supervised agent.
//!
//! Implements D-03: `subscribe()` → `broadcast::Receiver`<AgentEvent>, `stop()`, `pause()`.
//! Dual-channel design (D-01):
//!   - `mpsc::Sender`<AgentEvent>   `event_tx`  — stored in `AgentHandle` so the mpsc channel
//!                                             stays open as long as the handle lives.
//!                                             Worker tasks clone this sender to emit events.
//!   - `broadcast::Sender`<AgentEvent> `broadcast_tx` — supervisor fans out to Phase 3 subscribers
//!   - `mpsc::Sender`<AgentControl> `cancel_tx` — handle sends Stop/Pause to worker task
//!
//! IMPORTANT: `event_tx` MUST be stored as a field (not a local variable). If it is dropped,
//! the mpsc channel closes immediately and the re-broadcast loop exits — no events flow.

use crate::supervisor::{AgentControl, AgentEvent, AgentId, AgentState};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tokio::sync::{broadcast, mpsc};

/// Convert a task description to a safe git branch slug prefixed with `agent/`.
///
/// Strips all non-ASCII-alphanumeric characters (replacing with hyphens), collapses
/// consecutive hyphens, lowercases the result, and caps the slug portion to 40 chars.
/// Used by commands.rs to derive the worktree branch name from a user-provided task.
/// Mitigates T-5-02: no path separators or shell metacharacters survive.
#[must_use] 
pub fn slugify_task(task: &str) -> String {
    let lowered: String = task
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let slug: String = lowered
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let capped: String = slug.chars().take(40).collect();
    format!("agent/{capped}")
}

/// Typed control surface for a single supervised agent.
///
/// Clone to get multiple control handles to the same agent.
/// Phase 3 (Tauri layer) calls `subscribe()` to get a broadcast receiver
/// for streaming `AgentEvents` to the UI.
///
/// Worker tasks send events into `event_tx`; `AgentSupervisor`'s re-broadcast
/// loop forwards them to the broadcast channel for fan-out.
#[derive(Clone)]
pub struct AgentHandle {
    /// Stable identifier for this agent.
    pub agent_id: AgentId,
    /// Path of the git worktree assigned to this agent.
    pub worktree_path: PathBuf,
    /// mpsc sender — worker tasks clone this to send `AgentEvents` to the supervisor.
    /// Stored here so the channel stays open as long as any `AgentHandle` clone is alive.
    pub event_tx: mpsc::Sender<AgentEvent>,
    /// Broadcast sender — supervisor re-broadcasts mpsc events here.
    /// `subscribe()` creates new receivers from this.
    broadcast_tx: broadcast::Sender<AgentEvent>,
    /// Control channel — `stop()/pause()/resume()` send `AgentControl` here.
    cancel_tx: mpsc::Sender<AgentControl>,
    /// Pause flag — checked by the agent task before each `spawn_blocking` call.
    /// Pause takes effect at turn boundaries (cannot interrupt in-flight `run_turn`).
    pub paused: Arc<AtomicBool>,
    /// Current state — written by the agent task, read by supervisor for listings.
    pub state: Arc<std::sync::Mutex<AgentState>>,
    /// Task description provided at spawn time (AGT-03, AGT-05).
    pub task: String,
    /// Model name provided at spawn time (AGT-05).
    pub model: String,
    /// Optional budget in USD (AGT-06). None means unlimited.
    pub budget_dollars: Option<f64>,
    /// Cumulative cost in USD accumulated via `accumulate_cost` (AGT-06).
    pub cumulative_cost: Arc<std::sync::Mutex<f64>>,
}

impl AgentHandle {
    /// Create a new `AgentHandle`.
    ///
    /// Called by `AgentSupervisor::spawn_agent()` — not by user code directly.
    /// New fields (`task/model/budget/cumulative_cost`) are defaulted for backwards-compatibility.
    pub(crate) fn new(
        agent_id: AgentId,
        worktree_path: PathBuf,
        event_tx: mpsc::Sender<AgentEvent>,
        broadcast_tx: broadcast::Sender<AgentEvent>,
        cancel_tx: mpsc::Sender<AgentControl>,
    ) -> Self {
        Self {
            agent_id,
            worktree_path,
            event_tx,
            broadcast_tx,
            cancel_tx,
            paused: Arc::new(AtomicBool::new(false)),
            state: Arc::new(std::sync::Mutex::new(AgentState::Idle)),
            task: String::new(),
            model: String::new(),
            budget_dollars: None,
            cumulative_cost: Arc::new(std::sync::Mutex::new(0.0_f64)),
        }
    }

    /// Create a new `AgentHandle` with full task/model/budget configuration.
    ///
    /// Called by `AgentSupervisor::spawn_agent_with_config()` — not by user code directly.
    /// `cumulative_cost` starts at 0.0 and is incremented via `accumulate_cost()`.
    pub(crate) fn new_with_config(
        agent_id: AgentId,
        worktree_path: PathBuf,
        event_tx: mpsc::Sender<AgentEvent>,
        broadcast_tx: broadcast::Sender<AgentEvent>,
        cancel_tx: mpsc::Sender<AgentControl>,
        task: String,
        model: String,
        budget_dollars: Option<f64>,
    ) -> Self {
        Self {
            agent_id,
            worktree_path,
            event_tx,
            broadcast_tx,
            cancel_tx,
            paused: Arc::new(AtomicBool::new(false)),
            state: Arc::new(std::sync::Mutex::new(AgentState::Idle)),
            task,
            model,
            budget_dollars,
            cumulative_cost: Arc::new(std::sync::Mutex::new(0.0_f64)),
        }
    }

    /// Accumulate the cost of a single turn into the handle's `cumulative_cost`.
    ///
    /// Computes the turn cost from `usage` and `model`, adds it to the running total,
    /// and returns the new cumulative total in USD.
    #[must_use] 
    pub fn accumulate_cost(&self, usage: &crate::usage::TokenUsage, model: &str) -> f64 {
        let mut tracker = crate::usage::UsageTracker::new();
        tracker.record(*usage);
        let turn_cost = tracker.cost_usd(model);
        let mut cost = self
            .cumulative_cost
            .lock()
            .expect("cumulative_cost mutex poisoned");
        *cost += turn_cost;
        *cost
    }

    /// Subscribe to the agent's event stream.
    ///
    /// Returns a `broadcast::Receiver<AgentEvent>`. Multiple subscribers are supported.
    /// If a subscriber falls behind by >64 events, it receives `RecvError::Lagged(n)` —
    /// handle this case in Phase 3 by emitting a synthetic "events lost" notification.
    #[must_use] 
    pub fn subscribe(&self) -> broadcast::Receiver<AgentEvent> {
        self.broadcast_tx.subscribe()
    }

    /// Signal the agent to stop after its current turn completes.
    ///
    /// Non-blocking — sends to the control channel and returns immediately.
    /// The agent task must poll the control channel at turn boundaries.
    pub async fn stop(&self) {
        let _ = self.cancel_tx.send(AgentControl::Stop).await;
    }

    /// Signal the agent to pause before starting its next turn.
    ///
    /// Pause takes effect at turn boundaries — cannot interrupt in-flight `run_turn()`.
    /// Sets the `paused` `AtomicBool` flag which the agent task checks before each `spawn_blocking`.
    pub async fn pause(&self) {
        self.paused.store(true, Ordering::SeqCst);
        let _ = self.cancel_tx.send(AgentControl::Pause).await;
    }

    /// Resume a paused agent.
    pub async fn resume(&self) {
        self.paused.store(false, Ordering::SeqCst);
        let _ = self.cancel_tx.send(AgentControl::Resume).await;
    }

    /// Get the current state of the agent.
    #[must_use] 
    pub fn current_state(&self) -> AgentState {
        self.state.lock().unwrap().clone()
    }

    /// Update the agent's state (called by the agent task, not external callers).
    pub(crate) fn set_state(&self, new_state: AgentState) {
        let mut state = self.state.lock().unwrap();
        *state = new_state;
    }
}

impl std::fmt::Debug for AgentHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgentHandle")
            .field("agent_id", &self.agent_id)
            .field("worktree_path", &self.worktree_path)
            .field("state", &self.current_state())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_handle() -> (
        AgentHandle,
        mpsc::Receiver<AgentControl>,
        broadcast::Receiver<AgentEvent>,
    ) {
        let agent_id = AgentId::new();
        let (event_tx, _event_rx) = mpsc::channel(64);
        let (broadcast_tx, broadcast_rx) = broadcast::channel(64);
        let (cancel_tx, cancel_rx) = mpsc::channel(8);
        let handle = AgentHandle::new(
            agent_id,
            std::path::PathBuf::from("/tmp/test-worktree"),
            event_tx,
            broadcast_tx,
            cancel_tx,
        );
        (handle, cancel_rx, broadcast_rx)
    }

    #[tokio::test]
    async fn agent_handle_subscribe_receives_events() {
        let (handle, _cancel_rx, _) = make_handle();

        // Get two independent subscribers
        let mut rx1 = handle.subscribe();
        let mut rx2 = handle.subscribe();

        // Broadcast directly via the sender (in real code the supervisor does this)
        handle
            .broadcast_tx
            .send(AgentEvent::StateChanged(AgentState::Executing))
            .unwrap();

        let ev1 = rx1.recv().await.expect("rx1 receives event");
        let ev2 = rx2.recv().await.expect("rx2 receives event");

        // Both received the same event
        let json1 = serde_json::to_string(&ev1).unwrap();
        let json2 = serde_json::to_string(&ev2).unwrap();
        assert_eq!(json1, json2);
    }

    #[tokio::test]
    async fn agent_handle_event_tx_flows_through_broadcast() {
        // Verify the end-to-end path: event_tx → event_rx → broadcast_tx → subscriber
        // This is the path that was broken when event_tx was a local _event_tx (dropped immediately).
        let agent_id = AgentId::new();
        let (event_tx, mut event_rx) = mpsc::channel::<AgentEvent>(64);
        let (broadcast_tx, _) = broadcast::channel::<AgentEvent>(64);
        let (cancel_tx, _cancel_rx) = mpsc::channel::<AgentControl>(8);

        let handle = AgentHandle::new(
            agent_id,
            std::path::PathBuf::from("/tmp/test-worktree"),
            event_tx,
            broadcast_tx.clone(),
            cancel_tx,
        );

        // Simulate the re-broadcast loop (normally spawned in AgentSupervisor::spawn_agent)
        let broadcast_tx_clone = broadcast_tx.clone();
        tokio::spawn(async move {
            while let Some(evt) = event_rx.recv().await {
                let _ = broadcast_tx_clone.send(evt);
            }
        });

        // Subscribe BEFORE sending the event
        let mut subscriber = handle.subscribe();

        // Worker sends event via event_tx (stored in handle — channel is alive)
        use crate::usage::TokenUsage;
        handle
            .event_tx
            .send(AgentEvent::TurnCompleted {
                usage: TokenUsage {
                    input_tokens: 10,
                    output_tokens: 5,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0,
                },
            })
            .await
            .expect("event_tx send succeeded — channel is open because handle holds the sender");

        // Event must arrive at the broadcast subscriber
        let received = subscriber
            .recv()
            .await
            .expect("event arrived at subscriber");
        assert!(
            matches!(received, AgentEvent::TurnCompleted { .. }),
            "received wrong event variant: {received:?}"
        );
    }

    #[tokio::test]
    async fn agent_handle_stop_sends_control() {
        let (handle, mut cancel_rx, _) = make_handle();
        handle.stop().await;
        let ctrl = cancel_rx.recv().await.expect("control message received");
        assert!(matches!(ctrl, AgentControl::Stop));
    }

    #[tokio::test]
    async fn agent_handle_pause_sets_flag_and_sends_control() {
        let (handle, mut cancel_rx, _) = make_handle();
        assert!(!handle.paused.load(Ordering::SeqCst));
        handle.pause().await;
        assert!(handle.paused.load(Ordering::SeqCst));
        let ctrl = cancel_rx.recv().await.expect("control received");
        assert!(matches!(ctrl, AgentControl::Pause));
    }

    #[tokio::test]
    async fn agent_handle_resume_clears_flag() {
        let (handle, _cancel_rx, _) = make_handle();
        handle.pause().await;
        assert!(handle.paused.load(Ordering::SeqCst));
        handle.resume().await;
        assert!(!handle.paused.load(Ordering::SeqCst));
    }

    #[test]
    fn agent_handle_initial_state_is_idle() {
        let (handle, _cancel_rx, _) = make_handle();
        assert_eq!(handle.current_state(), AgentState::Idle);
    }

    // --- New tests for Task 1 (Phase 5) ---

    #[test]
    fn handle_new_with_config_stores_fields() {
        let agent_id = AgentId::new();
        let (event_tx, _event_rx) = mpsc::channel(64);
        let (broadcast_tx, _broadcast_rx) = broadcast::channel(64);
        let (cancel_tx, _cancel_rx) = mpsc::channel(8);
        let handle = AgentHandle::new_with_config(
            agent_id,
            std::path::PathBuf::from("/tmp/test-worktree"),
            event_tx,
            broadcast_tx,
            cancel_tx,
            "refactor auth".to_string(),
            "claude-sonnet-4".to_string(),
            Some(1.25),
        );
        assert_eq!(handle.task, "refactor auth");
        assert_eq!(handle.model, "claude-sonnet-4");
        assert_eq!(handle.budget_dollars, Some(1.25));
        let cost = *handle.cumulative_cost.lock().unwrap();
        assert_eq!(cost, 0.0);
    }

    #[test]
    fn handle_accumulate_cost_increments() {
        use crate::usage::TokenUsage;
        let agent_id = AgentId::new();
        let (event_tx, _event_rx) = mpsc::channel(64);
        let (broadcast_tx, _broadcast_rx) = broadcast::channel(64);
        let (cancel_tx, _cancel_rx) = mpsc::channel(8);
        let handle = AgentHandle::new_with_config(
            agent_id,
            std::path::PathBuf::from("/tmp/test-worktree"),
            event_tx,
            broadcast_tx,
            cancel_tx,
            "test".to_string(),
            "claude-sonnet-4-5".to_string(),
            None,
        );
        let usage = TokenUsage {
            input_tokens: 1000,
            output_tokens: 500,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
        };
        let first = handle.accumulate_cost(&usage, "claude-sonnet-4-5");
        assert!(first > 0.0, "first call must return positive cost");
        let second = handle.accumulate_cost(&usage, "claude-sonnet-4-5");
        assert!(
            (second - 2.0 * first).abs() < 1e-10,
            "second call must return 2x the first"
        );
        let stored = *handle.cumulative_cost.lock().unwrap();
        assert!(
            (stored - second).abs() < 1e-10,
            "stored value must match second return"
        );
    }

    #[test]
    fn slugify_task_basic() {
        assert_eq!(
            slugify_task("Refactor Auth Module!"),
            "agent/refactor-auth-module"
        );
    }

    #[test]
    fn slugify_task_length_capped() {
        let long_input = "abc ".repeat(50);
        let result = slugify_task(&long_input);
        let slug = result
            .strip_prefix("agent/")
            .expect("must start with agent/");
        assert!(
            slug.len() <= 40,
            "slug portion must be <= 40 chars, got {}",
            slug.len()
        );
    }

    #[test]
    fn slugify_task_punctuation_only() {
        let result = slugify_task("***///");
        // Must not panic, must start with "agent/", must not contain * or /  beyond the prefix
        assert!(result.starts_with("agent/"), "must start with agent/");
        let slug = result.strip_prefix("agent/").unwrap();
        assert!(!slug.contains('*'), "slug must not contain *");
        assert!(!slug.contains('/'), "slug must not contain /");
    }
}
