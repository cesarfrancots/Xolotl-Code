//! AgentHandle — typed control surface for a single supervised agent.
//!
//! Implements D-03: subscribe() → broadcast::Receiver<AgentEvent>, stop(), pause().
//! Dual-channel design (D-01):
//!   - mpsc::Sender<AgentEvent>   event_tx  — stored in AgentHandle so the mpsc channel
//!                                             stays open as long as the handle lives.
//!                                             Worker tasks clone this sender to emit events.
//!   - broadcast::Sender<AgentEvent> broadcast_tx — supervisor fans out to Phase 3 subscribers
//!   - mpsc::Sender<AgentControl> cancel_tx — handle sends Stop/Pause to worker task
//!
//! IMPORTANT: event_tx MUST be stored as a field (not a local variable). If it is dropped,
//! the mpsc channel closes immediately and the re-broadcast loop exits — no events flow.

use crate::supervisor::{AgentControl, AgentEvent, AgentId, AgentState};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tokio::sync::{broadcast, mpsc};

/// Typed control surface for a single supervised agent.
///
/// Clone to get multiple control handles to the same agent.
/// Phase 3 (Tauri layer) calls `subscribe()` to get a broadcast receiver
/// for streaming AgentEvents to the UI.
///
/// Worker tasks send events into `event_tx`; AgentSupervisor's re-broadcast
/// loop forwards them to the broadcast channel for fan-out.
#[derive(Clone)]
pub struct AgentHandle {
    /// Stable identifier for this agent.
    pub agent_id: AgentId,
    /// Path of the git worktree assigned to this agent.
    pub worktree_path: PathBuf,
    /// mpsc sender — worker tasks clone this to send AgentEvents to the supervisor.
    /// Stored here so the channel stays open as long as any AgentHandle clone is alive.
    pub event_tx: mpsc::Sender<AgentEvent>,
    /// Broadcast sender — supervisor re-broadcasts mpsc events here.
    /// `subscribe()` creates new receivers from this.
    broadcast_tx: broadcast::Sender<AgentEvent>,
    /// Control channel — stop()/pause()/resume() send AgentControl here.
    cancel_tx: mpsc::Sender<AgentControl>,
    /// Pause flag — checked by the agent task before each spawn_blocking call.
    /// Pause takes effect at turn boundaries (cannot interrupt in-flight run_turn).
    pub paused: Arc<AtomicBool>,
    /// Current state — written by the agent task, read by supervisor for listings.
    pub state: Arc<std::sync::Mutex<AgentState>>,
}

impl AgentHandle {
    /// Create a new AgentHandle.
    ///
    /// Called by AgentSupervisor::spawn_agent() — not by user code directly.
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
        }
    }

    /// Subscribe to the agent's event stream.
    ///
    /// Returns a `broadcast::Receiver<AgentEvent>`. Multiple subscribers are supported.
    /// If a subscriber falls behind by >64 events, it receives `RecvError::Lagged(n)` —
    /// handle this case in Phase 3 by emitting a synthetic "events lost" notification.
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
    /// Pause takes effect at turn boundaries — cannot interrupt in-flight run_turn().
    /// Sets the `paused` AtomicBool flag which the agent task checks before each spawn_blocking.
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

    fn make_handle() -> (AgentHandle, mpsc::Receiver<AgentControl>, broadcast::Receiver<AgentEvent>) {
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
        let received = subscriber.recv().await.expect("event arrived at subscriber");
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
}
