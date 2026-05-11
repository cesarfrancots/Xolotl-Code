use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use runtime::{AgentEvent, AgentHandle, AgentId, AgentState, AgentSupervisor, TokenUsage, slugify_task};
use tokio::sync::broadcast::error::RecvError;
use crate::permission_prompter::{PendingPrompts, PermissionDecision, PermissionRequestPayload};

#[tauri::command]
#[specta::specta]
pub fn smoke_test() -> String {
    "smoke_test_ok".to_string()
}

/// spawn_agent: creates an agent with task/model/optional budget. Worktree branch is
/// derived from the task via slugify_task. Starts event relay AND agent self-execution.
/// Returns new AgentId.
#[tauri::command]
#[specta::specta]
pub fn spawn_agent(
    supervisor: tauri::State<'_, Arc<AgentSupervisor>>,
    app_handle: AppHandle,
    task: String,
    model: String,
    budget_dollars: Option<f64>,
) -> Result<String, String> {
    // T-5-02: slugify the task before passing to git
    let branch = slugify_task(&task);
    let agent_id = supervisor
        .spawn_agent_with_config(&branch, &task, &model, budget_dollars)
        .map_err(|e| e.to_string())?;
    if let Some(handle) = supervisor.get_handle(&agent_id) {
        spawn_event_relay(app_handle, agent_id.clone(), handle.clone());
        // Task 3 self-execution — agent runs its initial task in a CLI subprocess,
        // streaming NDJSON AgentEvents back into handle.event_tx.
        spawn_agent_executor(agent_id.clone(), handle);
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
    let mut prompts = pending_prompts.lock().map_err(|e| e.to_string())?;
    // CR-02: use remove() not get() to prevent double-resolve race (2026-05-10)
    match prompts.remove(&prompt_id) {
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

/// run_agent_turn: send a user message to a running agent (per D-03, approved 2026-05-10).
///
/// Phase 4 stub behavior: does NOT call ConversationRuntime::run_turn().
/// Emits a single TextDelta echoing the message, then TurnCompleted with zero usage.
/// The echo streams as one chunk — correct stub behavior for Phase 4.
/// Real ConversationRuntime wiring is a follow-on task.
#[tauri::command]
#[specta::specta]
pub async fn run_agent_turn(
    supervisor: tauri::State<'_, Arc<AgentSupervisor>>,
    agent_id: String,
    message: String,
) -> Result<(), String> {
    let id = AgentId(agent_id);
    let handle = supervisor
        .get_handle(&id)
        .ok_or_else(|| format!("agent {id} not found"))?;
    // Emit StateChanged(Executing) so frontend knows the turn started
    handle
        .event_tx
        .send(AgentEvent::StateChanged(AgentState::Executing))
        .await
        .map_err(|e| e.to_string())?;
    // Echo stub — approved Phase 4 behavior per D-03 (2026-05-10).
    // The smoke tester (Plan 07, SC1) expects to see "Echo (stub):" in the chat.
    // Replace with ConversationRuntime::run_turn() in a follow-on iteration.
    handle
        .event_tx
        .send(AgentEvent::TextDelta(format!(
            "Echo (stub): {message}\n\n_Real AI streaming requires ConversationRuntime wiring (follow-on)._"
        )))
        .await
        .map_err(|e| e.to_string())?;
    handle
        .event_tx
        .send(AgentEvent::TurnCompleted {
            usage: TokenUsage {
                input_tokens: 0,
                output_tokens: 0,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
            },
        })
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// list_models: returns configured model names.
/// Powers the model selector dropdown (UI-08, D-05).
#[tauri::command]
#[specta::specta]
pub fn list_models() -> Vec<String> {
    // Model aliases match the xolotl CLI exactly so they can be passed verbatim to --model.
    // kimi-coding → KIMI_CODING_API_KEY + api.kimi.com/coding/v1
    // kimi2.6     → KIMI_API_KEY + Moonshot API
    // minimax2.7  → MINIMAX_API_KEY + MiniMax API
    vec![
        "kimi2.6".to_string(),
        "kimi-coding".to_string(),
        "minimax2.7".to_string(),
        "claude-sonnet-4-5".to_string(),
        "claude-haiku-3-5".to_string(),
        "claude-opus-4-5".to_string(),
    ]
}

/// list_sessions: returns saved session metadata from ~/.xolotl-code/sessions/
/// Each entry: { id, title, created_at (unix timestamp) }
#[tauri::command]
#[specta::specta]
pub fn list_sessions() -> Vec<SessionMeta> {
    let sessions_dir = home_sessions_dir();
    let Ok(entries) = std::fs::read_dir(&sessions_dir) else {
        return Vec::new();
    };
    let mut metas: Vec<SessionMeta> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "json").unwrap_or(false))
        .filter_map(|e| {
            let id = e.path().file_stem()?.to_str()?.to_string();
            let meta = std::fs::metadata(e.path()).ok()?;
            let created_at = meta
                .created()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?
                .as_secs();
            Some(SessionMeta { id, title: String::new(), created_at })
        })
        .collect();
    metas.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    metas
}

/// load_session: read a session JSON file by UUID id.
/// Returns raw JSON string — frontend parses display fields only.
/// Validates id is alphanumeric + hyphens only (path traversal prevention).
#[tauri::command]
#[specta::specta]
pub fn load_session(id: String) -> Result<String, String> {
    if !id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err("invalid session id".to_string());
    }
    let path = home_sessions_dir().join(format!("{id}.json"));
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// delete_session: remove a session JSON file by UUID id.
/// Validates id is alphanumeric + hyphens only (path traversal prevention).
#[tauri::command]
#[specta::specta]
pub fn delete_session(id: String) -> Result<(), String> {
    if !id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err("invalid session id".to_string());
    }
    let path = home_sessions_dir().join(format!("{id}.json"));
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

/// save_session: write session JSON to ~/.xolotl-code/sessions/{id}.json
#[tauri::command]
#[specta::specta]
pub fn save_session(id: String, json: String) -> Result<(), String> {
    if !id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err("invalid session id".to_string());
    }
    let dir = home_sessions_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{id}.json"));
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

/// SessionMeta: lightweight session list item returned by list_sessions.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct SessionMeta {
    pub id: String,
    pub title: String,
    pub created_at: u64,
}

fn home_sessions_dir() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".xolotl-code").join("sessions")
}

/// spawn_event_relay: dedicated tokio task per agent (D-07 / D-08).
/// Subscribes to the agent's broadcast channel and re-emits each AgentEvent
/// on "agent-event:{agent_id}" so the frontend can listen via listen().
///
/// RecvError::Lagged is handled by emitting a synthetic EventsLost notification
/// instead of panicking or silently dropping events (T-03-03-02 mitigation).
///
/// Budget enforcement (D-10, D-11): on every TurnCompleted event, accumulates cost
/// and injects StateChanged(Failed) + Error when cumulative cost exceeds budget.
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
                    // Budget enforcement (D-10, D-11). Accumulate cost unconditionally on
                    // TurnCompleted; only enforce the cap when budget is set.
                    if let AgentEvent::TurnCompleted { ref usage } = event {
                        let new_cost = handle.accumulate_cost(usage, &handle.model);
                        if let Some(budget) = handle.budget_dollars {
                            if new_cost >= budget {
                                // CR-03: use send().await instead of try_send so budget-exceeded
                                // events are never silently dropped when the channel is full.
                                let _ = handle.event_tx.send(
                                    AgentEvent::StateChanged(AgentState::Failed)
                                ).await;
                                let _ = handle.event_tx.send(AgentEvent::Error {
                                    message: format!("Budget exceeded: ${:.4}", new_cost),
                                }).await;
                            }
                        }
                    }
                    // OS notification on terminal states (D-12, D-13, D-14).
                    if let AgentEvent::StateChanged(ref state) = event {
                        if matches!(state, AgentState::Done | AgentState::Failed) {
                            let cost = handle.cumulative_cost
                                .lock()
                                .map(|g| *g)
                                .unwrap_or(0.0);
                            let state_label = if matches!(state, AgentState::Done) { "Done" } else { "Failed" };
                            let title: String = handle.task.chars().take(60).collect();
                            let body = format!("{} — ${:.4}", state_label, cost);
                            let _ = app_handle
                                .notification()
                                .builder()
                                .title(&title)
                                .body(&body)
                                .show();
                        }
                    }
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

/// Locate the xolotl CLI binary. Checks $USERPROFILE/.cargo/bin first (Windows),
/// then $HOME/.cargo/bin (Unix), then falls back to a plain PATH lookup.
fn find_xolotl_bin() -> PathBuf {
    for var in &["USERPROFILE", "HOME"] {
        if let Ok(home) = std::env::var(var) {
            let p = PathBuf::from(home)
                .join(".cargo")
                .join("bin")
                .join(if cfg!(windows) { "xolotl.exe" } else { "xolotl" });
            if p.exists() {
                return p;
            }
        }
    }
    PathBuf::from(if cfg!(windows) { "xolotl.exe" } else { "xolotl" })
}

/// spawn_agent_executor: drives the agent's initial task by invoking the xolotl CLI
/// in sub-agent mode (`--print-output --task-prompt <task> --task-output <tmpfile>`).
/// The CLI handles all model routing — kimi-coding uses KIMI_CODING_API_KEY +
/// api.kimi.com/coding/v1, minimax uses MINIMAX_API_KEY, etc. — exactly as in the
/// interactive CLI. The output file is read on completion and emitted as TextDelta
/// + TurnCompleted + StateChanged(Done).
pub(crate) fn spawn_agent_executor(_agent_id: AgentId, handle: AgentHandle) {
    let task = handle.task.clone();
    let model = handle.model.clone();
    let worktree_path = handle.worktree_path.clone();
    let event_tx = handle.event_tx.clone();

    tokio::spawn(async move {
        // CR-02: delay so the IPC round-trip returns and listen() registers before events fire.
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        let _ = event_tx.send(AgentEvent::StateChanged(AgentState::Planning)).await;

        let xolotl = find_xolotl_bin();
        let output_file = std::env::temp_dir().join(format!(
            "xolotl-agent-{}.txt",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.subsec_nanos())
                .unwrap_or(0)
        ));

        let output_file_clone = output_file.clone();
        let task_clone = task.clone();
        let model_clone = model.clone();
        let worktree_clone = worktree_path.clone();

        let spawn_result = tokio::task::spawn_blocking(move || {
            std::process::Command::new(&xolotl)
                .arg("--model").arg(&model_clone)
                .arg("--print-output")
                .arg("--task-prompt").arg(&task_clone)
                .arg("--task-output").arg(&output_file_clone)
                .arg("--yes")
                .current_dir(&worktree_clone)
                .output()
        }).await;

        let _ = event_tx.send(AgentEvent::StateChanged(AgentState::Executing)).await;

        match spawn_result {
            Err(join_err) => {
                let _ = event_tx.send(AgentEvent::Error {
                    message: format!("failed to spawn xolotl: {join_err}"),
                }).await;
                let _ = event_tx.send(AgentEvent::StateChanged(AgentState::Failed)).await;
            }
            Ok(Err(io_err)) => {
                let _ = event_tx.send(AgentEvent::Error {
                    message: format!("xolotl binary not found or failed to start: {io_err}. \
                                     Install with: cargo install --path rust/crates/rusty-claude-cli"),
                }).await;
                let _ = event_tx.send(AgentEvent::StateChanged(AgentState::Failed)).await;
            }
            Ok(Ok(output)) => {
                if output.status.success() {
                    let content = std::fs::read_to_string(&output_file)
                        .unwrap_or_default();
                    if !content.is_empty() {
                        let _ = event_tx.send(AgentEvent::TextDelta(content)).await;
                    }
                    let _ = event_tx.send(AgentEvent::TurnCompleted {
                        usage: TokenUsage {
                            input_tokens: 0,
                            output_tokens: 0,
                            cache_creation_input_tokens: 0,
                            cache_read_input_tokens: 0,
                        },
                    }).await;
                    let _ = event_tx.send(AgentEvent::StateChanged(AgentState::Done)).await;
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    let code = output.status.code().unwrap_or(-1);
                    let _ = event_tx.send(AgentEvent::Error {
                        message: format!("agent exited with code {code}: {stderr}"),
                    }).await;
                    let _ = event_tx.send(AgentEvent::StateChanged(AgentState::Failed)).await;
                }
                let _ = std::fs::remove_file(&output_file);
            }
        }
    });
}

