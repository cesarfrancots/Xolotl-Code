use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use runtime::{AgentHandle, AgentId, AgentSupervisor};
use tokio::sync::broadcast::error::RecvError;
use crate::permission_prompter::{PendingPrompts, PermissionDecision, PermissionRequestPayload};

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

/// respond_to_permission: resolves a pending permission prompt (D-10 / D-11).
/// Called from the frontend after the user makes a decision in the UI.
#[tauri::command]
#[specta::specta]
pub fn respond_to_permission(
    pending_prompts: tauri::State<'_, PendingPrompts>,
    prompt_id: String,
    decision: PermissionDecision,
) -> Result<(), String> {
    let prompts = pending_prompts.lock().map_err(|e| e.to_string())?;
    match prompts.get(&prompt_id) {
        Some(tx) => tx.send(decision).map_err(|e| e.to_string()),
        None => Err(format!(
            "prompt_id {prompt_id} not found (may have timed out or already resolved)"
        )),
    }
}

/// test_permission_prompt: emits a synthetic permission-request event for smoke testing.
/// Allows verifying the full permission round-trip from DevTools without a running agent.
/// The receiver is held alive in a background thread for 10 seconds so that
/// respond_to_permission can complete the round-trip.
#[tauri::command]
#[specta::specta]
pub fn test_permission_prompt(
    app_handle: AppHandle,
    pending_prompts: tauri::State<'_, PendingPrompts>,
) -> Result<String, String> {
    let prompt_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = std::sync::mpsc::channel::<PermissionDecision>();

    pending_prompts
        .lock()
        .map_err(|e| e.to_string())?
        .insert(prompt_id.clone(), tx);

    app_handle
        .emit(
            "permission-request",
            PermissionRequestPayload {
                prompt_id: prompt_id.clone(),
                tool_name: "test_tool".to_string(),
                preview: "This is a smoke-test permission prompt".to_string(),
            },
        )
        .map_err(|e| e.to_string())?;

    // Hold the receiver alive in a background thread for 10 seconds so that
    // respond_to_permission can complete the round-trip. If no response arrives,
    // clean up the pending entry automatically.
    let pending = pending_prompts.inner().clone();
    let id_clone = prompt_id.clone();
    std::thread::spawn(move || {
        match rx.recv_timeout(std::time::Duration::from_secs(10)) {
            Ok(decision) => {
                println!("[smoke-test] permission response received: {:?}", decision);
            }
            Err(_) => {
                // Timed out — clean up so the HashMap does not grow unboundedly
                let _ = pending.lock().map(|mut p| p.remove(&id_clone));
                println!("[smoke-test] permission prompt timed out");
            }
        }
    });

    Ok(prompt_id)
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

