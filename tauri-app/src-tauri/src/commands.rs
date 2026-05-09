use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use runtime::{AgentHandle, AgentId, AgentSupervisor};
use tokio::sync::broadcast::error::RecvError;

#[tauri::command]
#[specta::specta]
pub fn smoke_test() -> String {
    "smoke_test_ok".to_string()
}

/// spawn_agent: creates an agent on `branch` and starts its event relay task (D-07).
/// Returns the new AgentId as a String on success.
#[tauri::command]
#[specta::specta]
pub fn spawn_agent(
    supervisor: tauri::State<'_, Arc<AgentSupervisor>>,
    app_handle: AppHandle,
    branch: String,
) -> Result<String, String> {
    let agent_id = supervisor.spawn_agent(&branch).map_err(|e| e.to_string())?;
    // Wire event relay immediately after spawn (D-07)
    if let Some(handle) = supervisor.get_handle(&agent_id) {
        spawn_event_relay(app_handle, agent_id.clone(), handle);
    }
    Ok(agent_id.0)
}

/// list_agents: returns all agent IDs currently in the supervisor registry.
#[tauri::command]
#[specta::specta]
pub fn list_agents(
    supervisor: tauri::State<'_, Arc<AgentSupervisor>>,
) -> Vec<String> {
    supervisor.list().into_iter().map(|id| id.0).collect()
}

/// stop_agent: sends stop signal to the named agent (async because stop_agent() is async).
#[tauri::command]
#[specta::specta]
pub async fn stop_agent(
    supervisor: tauri::State<'_, Arc<AgentSupervisor>>,
    agent_id: String,
) -> Result<(), String> {
    let id = AgentId(agent_id);
    supervisor.stop_agent(&id).await.map_err(|e| e.to_string())
}

/// spawn_event_relay: dedicated tokio task per agent (D-07 / D-08).
/// Subscribes to the agent's broadcast channel and re-emits each AgentEvent
/// on "agent-event:{agent_id}" so the frontend can listen via listen().
///
/// RecvError::Lagged is handled by emitting a synthetic EventsLost notification
/// instead of panicking or silently dropping events (T-03-03-02 mitigation).
pub(crate) fn spawn_event_relay(
    app_handle: AppHandle,
    agent_id: AgentId,
    handle: AgentHandle,
) {
    let mut rx = handle.subscribe(); // broadcast::Receiver<AgentEvent>
    let channel = format!("agent-event:{}", agent_id.0); // D-08 channel naming
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let _ = app_handle.emit(&channel, &event);
                }
                Err(RecvError::Lagged(n)) => {
                    // Broadcast channel capacity 64 (Phase 2 invariant).
                    // Frontend fell behind — emit synthetic event so UI can react.
                    let _ = app_handle.emit(
                        &channel,
                        serde_json::json!({ "type": "EventsLost", "count": n }),
                    );
                }
                Err(RecvError::Closed) => break, // agent stopped — relay task exits
            }
        }
    });
}

