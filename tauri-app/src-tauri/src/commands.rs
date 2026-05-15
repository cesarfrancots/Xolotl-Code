use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use runtime::{AgentEvent, AgentHandle, AgentId, AgentState, AgentSupervisor, TokenUsage, slugify_task};
use tokio::sync::broadcast::error::RecvError;
use crate::permission_prompter::{PendingPrompts, PermissionDecision, PermissionRequestPayload};
use futures_util::StreamExt;

// ── Chat message type used by run_agent_turn ──────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

// ── Eval types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct EvalMeta {
    pub id: String,
    pub prompt: String,
    pub models: Vec<String>,
    pub created_at: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct ModelEvalResult {
    pub model: String,
    pub content: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub duration_ms: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct HumanScores {
    pub accuracy: f32,
    pub helpfulness: f32,
    pub quality: f32,
    pub creativity: f32,
    pub design: f32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct EvalResult {
    pub id: String,
    pub prompt: String,
    pub models: Vec<String>,
    pub results: Vec<ModelEvalResult>,
    pub human_scores: HashMap<String, HumanScores>,
    pub created_at: u64,
}

// ── Health check ──────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn smoke_test() -> String {
    "smoke_test_ok".to_string()
}

// ── Agent lifecycle ───────────────────────────────────────────────────────────

/// spawn_agent: creates an agent with task/model/optional budget.
///
/// `chat_mode = true` (used by the chat composer) skips spawn_agent_executor,
/// which would otherwise launch the autonomous `xolotl` CLI subprocess.
/// In chat we only need the agent handle as an event channel for
/// run_agent_turn — the CLI subprocess would race with the streaming API
/// call and pollute the chat with its own output.
///
/// `chat_mode = false` (Agents panel) keeps the original autonomous behavior.
#[tauri::command]
#[specta::specta]
pub fn spawn_agent(
    supervisor: tauri::State<'_, Arc<AgentSupervisor>>,
    app_handle: AppHandle,
    task: String,
    model: String,
    budget_dollars: Option<f64>,
    chat_mode: Option<bool>,
) -> Result<String, String> {
    let branch = slugify_task(&task);
    let agent_id = supervisor
        .spawn_agent_with_config(&branch, &task, &model, budget_dollars)
        .map_err(|e| e.to_string())?;
    if let Some(handle) = supervisor.get_handle(&agent_id) {
        spawn_event_relay(app_handle, agent_id.clone(), handle.clone());
        if !chat_mode.unwrap_or(false) {
            spawn_agent_executor(agent_id.clone(), handle);
        }
    }
    Ok(agent_id.0)
}

#[tauri::command]
#[specta::specta]
pub fn list_agents(
    supervisor: tauri::State<'_, Arc<AgentSupervisor>>,
) -> Vec<String> {
    supervisor.list().into_iter().map(|id| id.0).collect()
}

#[tauri::command]
#[specta::specta]
pub async fn stop_agent(
    supervisor: tauri::State<'_, Arc<AgentSupervisor>>,
    agent_id: String,
) -> Result<(), String> {
    let id = AgentId(agent_id);
    supervisor.stop_agent(&id).await.map_err(|e| e.to_string())
}

// ── Permission handling ───────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn respond_to_permission(
    pending_prompts: tauri::State<'_, PendingPrompts>,
    prompt_id: String,
    decision: PermissionDecision,
) -> Result<(), String> {
    let mut prompts = pending_prompts.lock().map_err(|e| e.to_string())?;
    match prompts.remove(&prompt_id) {
        Some(tx) => tx.send(decision).map_err(|e| e.to_string()),
        None => Err(format!(
            "prompt_id {prompt_id} not found (may have timed out or already resolved)"
        )),
    }
}

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

    let pending = pending_prompts.inner().clone();
    let id_clone = prompt_id.clone();
    std::thread::spawn(move || {
        match rx.recv_timeout(std::time::Duration::from_secs(10)) {
            Ok(decision) => {
                println!("[smoke-test] permission response received: {:?}", decision);
            }
            Err(_) => {
                let _ = pending.lock().map(|mut p| p.remove(&id_clone));
                println!("[smoke-test] permission prompt timed out");
            }
        }
    });

    Ok(prompt_id)
}

// ── AI conversation turn ──────────────────────────────────────────────────────

/// chat_turn: streaming chat that bypasses the agent/worktree system entirely.
///
/// This is for the conversational chat UX (vibe-coding style, like Claude or
/// ChatGPT). Unlike run_agent_turn, it does NOT spawn an AgentSupervisor entry,
/// create a git worktree, or maintain any per-session state on the Rust side —
/// it just streams from the LLM and emits events on `chat-event:{turn_id}`.
///
/// The caller (frontend) generates `turn_id`, subscribes to the channel BEFORE
/// invoking this command (to avoid losing the first events), then awaits a
/// TurnCompleted or Error event to know the turn finished.
#[tauri::command]
#[specta::specta]
pub async fn chat_turn(
    app_handle: AppHandle,
    turn_id: String,
    messages: Vec<ChatMessage>,
    model: String,
) -> Result<(), String> {
    let channel = format!("chat-event:{turn_id}");
    eprintln!("[chat_turn] start turn_id={turn_id} model={model} msgs={}", messages.len());

    tokio::spawn(async move {
        let (tx, mut rx) = tokio::sync::mpsc::channel::<AgentEvent>(256);

        let model2 = model.clone();
        let msgs = messages;
        let tx2 = tx.clone();
        tokio::spawn(async move {
            match call_model_streaming(&model2, &msgs, &tx2).await {
                Ok(usage) => {
                    eprintln!(
                        "[chat_turn] streaming OK in={} out={}",
                        usage.input_tokens, usage.output_tokens
                    );
                    let _ = tx2.send(AgentEvent::TurnCompleted { usage }).await;
                }
                Err(e) => {
                    eprintln!("[chat_turn] streaming ERR: {e}");
                    let _ = tx2.send(AgentEvent::Error { message: e }).await;
                }
            }
        });
        drop(tx);

        let mut emitted = 0usize;
        while let Some(event) = rx.recv().await {
            emitted += 1;
            let _ = app_handle.emit(&channel, &event);
        }
        eprintln!("[chat_turn] emitted {emitted} events on {channel}");
    });

    Ok(())
}

/// run_agent_turn: send message history to the AI and stream back the response.
/// Messages is the full conversation including the new user message.
/// Model is passed explicitly to enable per-turn model switching.
#[tauri::command]
#[specta::specta]
pub async fn run_agent_turn(
    supervisor: tauri::State<'_, Arc<AgentSupervisor>>,
    agent_id: String,
    messages: Vec<ChatMessage>,
    model: String,
) -> Result<(), String> {
    let id = AgentId(agent_id);
    let handle = supervisor
        .get_handle(&id)
        .ok_or_else(|| format!("agent {id} not found"))?;

    let event_tx = handle.event_tx.clone();

    // Signal turn start
    event_tx
        .send(AgentEvent::StateChanged(AgentState::Executing))
        .await
        .map_err(|e| e.to_string())?;

    // Run the actual AI call in a background task so this command returns quickly.
    // We create a local mpsc channel as the streaming sink, then forward all events
    // to handle.event_tx (which is an mpsc::Sender going to the broadcast re-emitter).
    let handle_tx = handle.event_tx.clone();
    let model_log = model.clone();
    let msg_count = messages.len();
    eprintln!("[run_agent_turn] starting model={model_log} msgs={msg_count}");
    tokio::spawn(async move {
        // Use a separate mpsc channel for the stream so we can intercept and forward
        let (stream_tx, mut stream_rx) = tokio::sync::mpsc::channel::<AgentEvent>(256);

        let model2 = model.clone();
        let msgs = messages.clone();
        let stream_tx2 = stream_tx.clone();
        tokio::spawn(async move {
            let res = call_model_streaming(&model2, &msgs, &stream_tx2).await;
            match res {
                Ok(usage) => {
                    eprintln!(
                        "[run_agent_turn] streaming OK — in={} out={}",
                        usage.input_tokens, usage.output_tokens
                    );
                    let _ = stream_tx2.send(AgentEvent::TurnCompleted { usage }).await;
                }
                Err(e) => {
                    eprintln!("[run_agent_turn] streaming ERR: {e}");
                    let _ = stream_tx2.send(AgentEvent::Error { message: e }).await;
                }
            }
        });
        drop(stream_tx);

        let mut forwarded = 0usize;
        while let Some(event) = stream_rx.recv().await {
            forwarded += 1;
            let _ = handle_tx.send(event).await;
        }
        eprintln!("[run_agent_turn] forwarded {forwarded} events to broadcast");

        let _ = handle_tx.send(AgentEvent::StateChanged(AgentState::Waiting)).await;
    });

    Ok(())
}

// ── Model list ────────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn list_models() -> Vec<String> {
    vec![
        "claude-sonnet-4-6".to_string(),
        "claude-haiku-4-5-20251001".to_string(),
        "claude-opus-4-7".to_string(),
        "kimi2.6".to_string(),
        "kimi-coding".to_string(),
        "minimax2.7".to_string(),
    ]
}

// ── Session persistence ───────────────────────────────────────────────────────

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

#[tauri::command]
#[specta::specta]
pub fn load_session(id: String) -> Result<String, String> {
    if !id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err("invalid session id".to_string());
    }
    let path = home_sessions_dir().join(format!("{id}.json"));
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn delete_session(id: String) -> Result<(), String> {
    if !id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err("invalid session id".to_string());
    }
    let path = home_sessions_dir().join(format!("{id}.json"));
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct SessionMeta {
    pub id: String,
    pub title: String,
    pub created_at: u64,
}

// ── Eval commands ─────────────────────────────────────────────────────────────

/// start_eval: runs selected models on the same prompt sequentially.
/// Emits "eval-event:{eval_id}" events as each model responds.
/// Saves result to ~/.xolotl-code/evals/{eval_id}.json when all complete.
#[tauri::command]
#[specta::specta]
pub async fn start_eval(
    app_handle: AppHandle,
    prompt: String,
    models: Vec<String>,
) -> Result<String, String> {
    let eval_id = uuid::Uuid::new_v4().to_string();
    let evals_dir = home_evals_dir();
    std::fs::create_dir_all(&evals_dir).map_err(|e| e.to_string())?;

    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let eval_id_clone = eval_id.clone();

    tokio::spawn(async move {
        let channel = format!("eval-event:{eval_id_clone}");
        let mut all_results: Vec<ModelEvalResult> = Vec::new();

        for model in &models {
            let _ = app_handle.emit(
                &channel,
                serde_json::json!({ "type": "ModelStart", "model": model }),
            );

            let messages = vec![ChatMessage {
                role: "user".to_string(),
                content: prompt.clone(),
            }];

            let start = std::time::Instant::now();

            // mpsc channel to collect streaming events from the model call
            let (local_tx, mut local_rx) = tokio::sync::mpsc::channel::<AgentEvent>(256);

            let model_name = model.clone();
            let msgs = messages.clone();
            let local_tx2 = local_tx.clone();
            // Stream model response in a sibling task; sends terminal event when done
            tokio::spawn(async move {
                match call_model_streaming(&model_name, &msgs, &local_tx2).await {
                    Ok(usage) => { let _ = local_tx2.send(AgentEvent::TurnCompleted { usage }).await; }
                    Err(e) => { let _ = local_tx2.send(AgentEvent::Error { message: e }).await; }
                }
                // local_tx2 drops → channel closes after local_tx also drops
            });
            drop(local_tx); // drop our copy so channel closes when spawned task is done

            // Drain events, collecting content and forwarding deltas to frontend
            let mut content_buf = String::new();
            let mut in_tokens: u32 = 0;
            let mut out_tokens: u32 = 0;
            let mut err_msg: Option<String> = None;

            while let Some(event) = local_rx.recv().await {
                match event {
                    AgentEvent::TextDelta(text) => {
                        content_buf.push_str(&text);
                        let _ = app_handle.emit(
                            &channel,
                            serde_json::json!({ "type": "ModelDelta", "model": model, "text": &text }),
                        );
                    }
                    AgentEvent::TurnCompleted { usage } => {
                        in_tokens = usage.input_tokens;
                        out_tokens = usage.output_tokens;
                        break;
                    }
                    AgentEvent::Error { message: e } => {
                        err_msg = Some(e);
                        break;
                    }
                    _ => {}
                }
            }

            let duration_ms = start.elapsed().as_millis() as u64;
            let model_result = ModelEvalResult {
                model: model.clone(),
                content: content_buf,
                input_tokens: in_tokens,
                output_tokens: out_tokens,
                duration_ms,
                error: err_msg,
            };

            let _ = app_handle.emit(
                &channel,
                serde_json::json!({
                    "type": "ModelComplete",
                    "model": model,
                    "input_tokens": model_result.input_tokens,
                    "output_tokens": model_result.output_tokens,
                    "duration_ms": model_result.duration_ms,
                    "error": model_result.error,
                }),
            );
            all_results.push(model_result);
        }

        let eval_result = EvalResult {
            id: eval_id_clone.clone(),
            prompt: prompt.clone(),
            models: models.clone(),
            results: all_results,
            human_scores: HashMap::new(),
            created_at,
        };

        if let Ok(json) = serde_json::to_string_pretty(&eval_result) {
            let path = home_evals_dir().join(format!("{eval_id_clone}.json"));
            let _ = std::fs::write(path, json);
        }

        let _ = app_handle.emit(
            &channel,
            serde_json::json!({ "type": "EvalComplete", "eval_id": eval_id_clone }),
        );
    });

    Ok(eval_id)
}

#[tauri::command]
#[specta::specta]
pub fn list_evals() -> Vec<EvalMeta> {
    let dir = home_evals_dir();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut metas: Vec<EvalMeta> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "json").unwrap_or(false))
        .filter_map(|e| {
            let json = std::fs::read_to_string(e.path()).ok()?;
            let result: EvalResult = serde_json::from_str(&json).ok()?;
            Some(EvalMeta {
                id: result.id,
                prompt: result.prompt,
                models: result.models,
                created_at: result.created_at,
            })
        })
        .collect();
    metas.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    metas
}

#[tauri::command]
#[specta::specta]
pub fn load_eval(id: String) -> Result<String, String> {
    if !id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err("invalid eval id".to_string());
    }
    let path = home_evals_dir().join(format!("{id}.json"));
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn delete_eval(id: String) -> Result<(), String> {
    if !id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err("invalid eval id".to_string());
    }
    let path = home_evals_dir().join(format!("{id}.json"));
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

/// save_human_scores: updates the human_scores map in a stored eval.
/// scores_json is a JSON object mapping model name → HumanScores.
#[tauri::command]
#[specta::specta]
pub fn save_human_scores(id: String, scores_json: String) -> Result<(), String> {
    if !id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err("invalid eval id".to_string());
    }
    let path = home_evals_dir().join(format!("{id}.json"));
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut result: EvalResult = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let scores: HashMap<String, HumanScores> =
        serde_json::from_str(&scores_json).map_err(|e| e.to_string())?;
    result.human_scores = scores;
    let updated = serde_json::to_string_pretty(&result).map_err(|e| e.to_string())?;
    std::fs::write(&path, updated).map_err(|e| e.to_string())
}

// ── Phase 6: Team/Swarm + Worktree Diff + Merge ───────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct RoleConfig {
    pub role: String,
    pub task: String,
    pub model: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct GroupLaunchResult {
    pub group_id: String,
    pub agent_ids: Vec<String>,
    pub branches: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct FileDiff {
    pub path: String,
    pub old_content: String,
    pub new_content: String,
}

#[tauri::command]
#[specta::specta]
pub fn launch_team(
    supervisor: tauri::State<'_, Arc<AgentSupervisor>>,
    app_handle: AppHandle,
    roles: Vec<RoleConfig>,
) -> Result<GroupLaunchResult, String> {
    let role_tuples: Vec<(String, String, String)> = roles
        .into_iter()
        .map(|r| (r.role, r.task, r.model))
        .collect();
    let (group_id, agent_ids, branches) = supervisor
        .launch_team(role_tuples)
        .map_err(|e| e.to_string())?;
    for agent_id in &agent_ids {
        if let Some(handle) = supervisor.get_handle(agent_id) {
            spawn_event_relay(app_handle.clone(), agent_id.clone(), handle.clone());
            spawn_agent_executor(agent_id.clone(), handle);
        }
    }
    Ok(GroupLaunchResult {
        group_id,
        agent_ids: agent_ids.into_iter().map(|id| id.0).collect(),
        branches,
    })
}

#[tauri::command]
#[specta::specta]
pub fn launch_swarm(
    supervisor: tauri::State<'_, Arc<AgentSupervisor>>,
    app_handle: AppHandle,
    count: u32,
    objective: String,
    model: String,
) -> Result<GroupLaunchResult, String> {
    let (group_id, agent_ids, branches) = supervisor
        .launch_swarm(count, objective, model)
        .map_err(|e| e.to_string())?;
    for agent_id in &agent_ids {
        if let Some(handle) = supervisor.get_handle(agent_id) {
            spawn_event_relay(app_handle.clone(), agent_id.clone(), handle.clone());
            spawn_agent_executor(agent_id.clone(), handle);
        }
    }
    Ok(GroupLaunchResult {
        group_id,
        agent_ids: agent_ids.into_iter().map(|id| id.0).collect(),
        branches,
    })
}

#[tauri::command]
#[specta::specta]
pub fn get_worktree_diff(
    supervisor: tauri::State<'_, Arc<AgentSupervisor>>,
    agent_id: String,
) -> Result<Vec<FileDiff>, String> {
    let id = AgentId(agent_id);
    if supervisor.get_handle(&id).is_none() {
        return Err(format!("agent {} not found", id.0));
    }
    let changed_files = supervisor
        .worktree_manager
        .get_diff_files(&id)
        .map_err(|e| e.to_string())?;

    let worktree_path = supervisor
        .worktree_manager
        .get_path(&id)
        .ok_or_else(|| format!("no worktree path for agent {}", id.0))?;

    let mut diffs = Vec::new();
    for file_path in changed_files {
        let old = std::process::Command::new("git")
            .args(["show", &format!("HEAD:{}", file_path)])
            .current_dir(&worktree_path)
            .output()
            .map(|o| {
                if o.status.success() {
                    String::from_utf8_lossy(&o.stdout).into_owned()
                } else {
                    String::new()
                }
            })
            .unwrap_or_default();
        let new_path = worktree_path.join(&file_path);
        let new = std::fs::read_to_string(&new_path).unwrap_or_default();
        diffs.push(FileDiff {
            path: file_path,
            old_content: old,
            new_content: new,
        });
    }
    Ok(diffs)
}

#[tauri::command]
#[specta::specta]
pub async fn merge_worktrees(
    supervisor: tauri::State<'_, Arc<AgentSupervisor>>,
    app_handle: AppHandle,
    group_id: String,
    agent_ids: Vec<String>,
) -> Result<(), String> {
    let repo_root = supervisor.repo_root().to_path_buf();
    for raw_id in &agent_ids {
        let id = AgentId(raw_id.clone());
        let branch = supervisor
            .worktree_manager
            .get_branch(&id)
            .ok_or_else(|| format!("no branch for agent {raw_id}"))?;

        let git_queue = supervisor.git_queue_for(repo_root.clone());
        let result = git_queue
            .run(
                vec!["merge".to_string(), branch.clone()],
                repo_root.clone(),
            )
            .await
            .map_err(|e| e.to_string())?;

        if !result.status.success() {
            let stderr = String::from_utf8_lossy(&result.stderr).into_owned();
            return Err(format!("Merge failed for branch {branch}: {stderr}"));
        }
        let _ = supervisor.worktree_manager.remove(&id);
    }
    app_handle
        .emit(
            "group-state-changed",
            serde_json::json!({ "groupId": group_id, "state": "Merged" }),
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Settings / API key management ─────────────────────────────────────────────
//
// Config file at ~/.xolotl-code/config.json is shared with the xolotl CLI,
// which uses UPPERCASE env-var-style keys (e.g. ANTHROPIC_API_KEY). We treat
// the file as a free-form JSON object so we don't drop unknown fields written
// by the CLI (KIMI_CODING_BASE_URL, AWS_*, etc.) when we save.

type ConfigMap = serde_json::Map<String, serde_json::Value>;

/// Maps the provider id used by the frontend to the env-var-style key in
/// config.json. Keep these names aligned with what call_model_streaming /
/// call_anthropic_streaming read.
fn provider_env_var(provider: &str) -> Option<&'static str> {
    match provider {
        "anthropic" => Some("ANTHROPIC_API_KEY"),
        "kimi" => Some("KIMI_API_KEY"),
        "kimi_coding" => Some("KIMI_CODING_API_KEY"),
        "minimax" => Some("MINIMAX_API_KEY"),
        _ => None,
    }
}

fn home_config_path() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".xolotl-code").join("config.json")
}

fn load_config() -> ConfigMap {
    let path = home_config_path();
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|data| serde_json::from_str::<ConfigMap>(&data).ok())
        .unwrap_or_default()
}

fn save_config(config: &ConfigMap) -> Result<(), String> {
    let path = home_config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(&path, data).map_err(|e| e.to_string())
}

fn config_get(config: &ConfigMap, key: &str) -> Option<String> {
    config
        .get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
}

/// Resolve a key: env var first, then config file.
fn resolve_api_key(env_var: &str, config: &ConfigMap) -> Option<String> {
    std::env::var(env_var)
        .ok()
        .filter(|k| !k.is_empty())
        .or_else(|| config_get(config, env_var))
}

/// Returns which providers have an API key configured (env var or config file).
#[tauri::command]
#[specta::specta]
pub fn get_api_key_status() -> HashMap<String, bool> {
    let config = load_config();
    let mut status = HashMap::new();
    for provider in ["anthropic", "kimi", "kimi_coding", "minimax"] {
        let env_var = provider_env_var(provider).unwrap();
        status.insert(provider.to_string(), resolve_api_key(env_var, &config).is_some());
    }
    status
}

/// Save an API key for a provider. Pass an empty string to clear the key.
/// Preserves all other fields in config.json (CLI-written settings).
#[tauri::command]
#[specta::specta]
pub fn set_api_key(provider: String, key: String) -> Result<(), String> {
    let env_var = provider_env_var(&provider)
        .ok_or_else(|| format!("Unknown provider: {provider}"))?;
    let mut config = load_config();
    if key.is_empty() {
        config.remove(env_var);
    } else {
        config.insert(env_var.to_string(), serde_json::Value::String(key));
    }
    save_config(&config)
}

/// Test connectivity to an AI provider using its configured API key.
/// Returns "Connected to <provider>" on success.
#[tauri::command]
#[specta::specta]
pub async fn test_api_connection(provider: String) -> Result<String, String> {
    let config = load_config();
    let client = reqwest::Client::new();

    match provider.as_str() {
        "anthropic" => {
            let key = resolve_api_key("ANTHROPIC_API_KEY", &config)
                .ok_or_else(|| "Anthropic API key not set".to_string())?;
            let resp = client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", &key)
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .json(&serde_json::json!({
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 1,
                    "messages": [{"role": "user", "content": "hi"}]
                }))
                .send()
                .await
                .map_err(|e| format!("Request failed: {e}"))?;
            if resp.status().is_success() {
                Ok("Connected to Anthropic".to_string())
            } else {
                let body = resp.text().await.unwrap_or_default();
                Err(format!("Anthropic error: {body}"))
            }
        }
        "kimi" => {
            let key = resolve_api_key("KIMI_API_KEY", &config)
                .ok_or_else(|| "Kimi API key not set".to_string())?;
            let resp = client
                .post("https://api.moonshot.cn/v1/chat/completions")
                .header("Authorization", format!("Bearer {key}"))
                .header("content-type", "application/json")
                .json(&serde_json::json!({
                    "model": "moonshot-v1-8k",
                    "max_tokens": 1,
                    "messages": [{"role": "user", "content": "hi"}]
                }))
                .send()
                .await
                .map_err(|e| format!("Request failed: {e}"))?;
            if resp.status().is_success() {
                Ok("Connected to Kimi".to_string())
            } else {
                let body = resp.text().await.unwrap_or_default();
                Err(format!("Kimi error: {body}"))
            }
        }
        "kimi_coding" => {
            let key = resolve_api_key("KIMI_CODING_API_KEY", &config)
                .or_else(|| resolve_api_key("KIMI_API_KEY", &config))
                .ok_or_else(|| "Kimi Coding API key not set".to_string())?;
            let resp = client
                .post("https://api.kimi.com/coding/v1/chat/completions")
                .header("Authorization", format!("Bearer {key}"))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .header("User-Agent", "claude-code/1.0.0 (Windows; x64)")
                .header("X-Client-Name", "claude-code")
                .header("X-Client-Version", "1.0.0")
                .header("X-Source", "claude-code")
                .json(&serde_json::json!({
                    "model": "kimi-k2-turbo-preview",
                    "max_tokens": 1,
                    "messages": [{"role": "user", "content": "hi"}]
                }))
                .send()
                .await
                .map_err(|e| format!("Request failed: {e}"))?;
            if resp.status().is_success() {
                Ok("Connected to Kimi Coding".to_string())
            } else {
                let body = resp.text().await.unwrap_or_default();
                Err(format!("Kimi Coding error: {body}"))
            }
        }
        "minimax" => {
            let key = resolve_api_key("MINIMAX_API_KEY", &config)
                .ok_or_else(|| "MiniMax API key not set".to_string())?;
            let resp = client
                .post("https://api.minimax.chat/v1/text/chatcompletion_v2")
                .header("Authorization", format!("Bearer {key}"))
                .header("content-type", "application/json")
                .json(&serde_json::json!({
                    "model": "MiniMax-Text-01",
                    "max_tokens": 1,
                    "messages": [{"role": "user", "content": "hi"}]
                }))
                .send()
                .await
                .map_err(|e| format!("Request failed: {e}"))?;
            if resp.status().is_success() {
                Ok("Connected to MiniMax".to_string())
            } else {
                let body = resp.text().await.unwrap_or_default();
                Err(format!("MiniMax error: {body}"))
            }
        }
        _ => Err(format!("Unknown provider: {provider}")),
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn home_sessions_dir() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".xolotl-code").join("sessions")
}

fn home_evals_dir() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".xolotl-code").join("evals")
}

// ── AI API streaming ──────────────────────────────────────────────────────────

/// Route a model name to the appropriate provider and stream the response.
/// Sends AgentEvent::TextDelta for each text chunk via the mpsc sender.
async fn call_model_streaming(
    model: &str,
    messages: &[ChatMessage],
    event_tx: &tokio::sync::mpsc::Sender<AgentEvent>,
) -> Result<TokenUsage, String> {
    if model.starts_with("claude") {
        call_anthropic_streaming(model, messages, event_tx).await
    } else if model.starts_with("kimi-coding") {
        let config = load_config();
        let api_key = resolve_api_key("KIMI_CODING_API_KEY", &config)
            .or_else(|| resolve_api_key("KIMI_API_KEY", &config))
            .ok_or_else(|| "KIMI_CODING_API_KEY not set. Configure it in Settings.".to_string())?;
        call_openai_compat_streaming(
            "https://api.kimi.com/coding/v1",
            &api_key,
            "kimi-k2-turbo-preview",
            messages,
            event_tx,
        )
        .await
    } else if model.starts_with("kimi") {
        let config = load_config();
        let api_key = resolve_api_key("KIMI_API_KEY", &config)
            .ok_or_else(|| "KIMI_API_KEY not set. Configure it in Settings.".to_string())?;
        call_openai_compat_streaming(
            "https://api.moonshot.cn/v1",
            &api_key,
            "moonshot-v1-8k",
            messages,
            event_tx,
        )
        .await
    } else if model.starts_with("minimax") {
        let config = load_config();
        let api_key = resolve_api_key("MINIMAX_API_KEY", &config)
            .ok_or_else(|| "MINIMAX_API_KEY not set. Configure it in Settings.".to_string())?;
        call_openai_compat_streaming(
            "https://api.minimax.chat/v1",
            &api_key,
            "MiniMax-Text-01",
            messages,
            event_tx,
        )
        .await
    } else {
        Err(format!("Unknown model: {model}"))
    }
}

/// Stream from the Anthropic Messages API (SSE format).
async fn call_anthropic_streaming(
    model: &str,
    messages: &[ChatMessage],
    event_tx: &tokio::sync::mpsc::Sender<AgentEvent>,
) -> Result<TokenUsage, String> {
    let config = load_config();
    let api_key = resolve_api_key("ANTHROPIC_API_KEY", &config)
        .ok_or_else(|| "ANTHROPIC_API_KEY not set. Configure it in Settings.".to_string())?;

    let client = reqwest::Client::new();

    let api_messages: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
        .collect();

    let body = serde_json::json!({
        "model": model,
        "max_tokens": 8096,
        "stream": true,
        "messages": api_messages,
    });

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let err_body = response.text().await.unwrap_or_default();
        return Err(format!("Anthropic API error {status}: {err_body}"));
    }

    let mut input_tokens: u32 = 0;
    let mut output_tokens: u32 = 0;
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream read error: {e}"))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        // Process all complete SSE events (delimited by double newline)
        loop {
            let Some(pos) = buffer.find("\n\n") else { break };
            let raw_event = buffer[..pos].to_string();
            buffer = buffer[pos + 2..].to_string();

            let mut event_type = String::new();
            let mut data_str = String::new();
            for line in raw_event.lines() {
                if let Some(t) = line.strip_prefix("event: ") {
                    event_type = t.to_string();
                } else if let Some(d) = line.strip_prefix("data: ") {
                    data_str = d.to_string();
                }
            }

            if data_str == "[DONE]" {
                break;
            }

            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&data_str) {
                match event_type.as_str() {
                    "message_start" => {
                        input_tokens = v["message"]["usage"]["input_tokens"]
                            .as_u64()
                            .unwrap_or(0) as u32;
                    }
                    "content_block_delta" => {
                        if let Some(text) = v["delta"]["text"].as_str() {
                            let _ = event_tx.send(AgentEvent::TextDelta(text.to_string())).await;
                        }
                    }
                    "message_delta" => {
                        output_tokens = v["usage"]["output_tokens"]
                            .as_u64()
                            .unwrap_or(0) as u32;
                    }
                    _ => {}
                }
            }
        }
    }

    Ok(TokenUsage {
        input_tokens,
        output_tokens,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
    })
}

/// Stream from an OpenAI-compatible API (kimi, minimax, etc.).
async fn call_openai_compat_streaming(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[ChatMessage],
    event_tx: &tokio::sync::mpsc::Sender<AgentEvent>,
) -> Result<TokenUsage, String> {
    let client = reqwest::Client::new();

    let api_messages: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
        .collect();

    let body = serde_json::json!({
        "model": model,
        "stream": true,
        "messages": api_messages,
    });

    let url = format!("{base_url}/chat/completions");
    // Kimi For Coding gates on coding-agent identification headers. Match the
    // exact set the rusty-claude-cli sends (rust/crates/rusty-claude-cli/src/openai.rs)
    // so behavior is consistent across CLI and desktop app. Harmless for other
    // OpenAI-compatible providers.
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .header("User-Agent", "claude-code/1.0.0 (Windows; x64)")
        .header("X-Client-Name", "claude-code")
        .header("X-Client-Version", "1.0.0")
        .header("X-Source", "claude-code")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let err_body = response.text().await.unwrap_or_default();
        return Err(format!("API error {status}: {err_body}"));
    }

    let mut input_tokens: u32 = 0;
    let mut output_tokens: u32 = 0;
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream read error: {e}"))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        // Process lines (OpenAI format uses "data: {...}\n\n")
        loop {
            let Some(pos) = buffer.find("\n\n") else { break };
            let raw = buffer[..pos].to_string();
            buffer = buffer[pos + 2..].to_string();

            for line in raw.lines() {
                // Accept both "data: {...}" (OpenAI canonical) and "data:{...}"
                // (Kimi For Coding emits no space after the colon). Trimming the
                // tail also strips any whitespace the canonical form carries.
                let Some(rest) = line.strip_prefix("data:") else {
                    continue;
                };
                let data = rest.trim_start();
                if data == "[DONE]" {
                    continue;
                }
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                        let delta = &v["choices"][0]["delta"];
                        // reasoning_content: chain-of-thought from reasoning models
                        // (Kimi For Coding, DeepSeek-R1, etc.). Emit as a separate
                        // ReasoningDelta variant so the UI can present it in a
                        // de-emphasized, collapsible block — not steal attention
                        // from the actual reply.
                        if let Some(reasoning) = delta["reasoning_content"].as_str() {
                            if !reasoning.is_empty() {
                                let _ = event_tx
                                    .send(AgentEvent::ReasoningDelta(reasoning.to_string()))
                                    .await;
                            }
                        }
                        // Final answer content
                        if let Some(content) = delta["content"].as_str() {
                            if !content.is_empty() {
                                let _ = event_tx
                                    .send(AgentEvent::TextDelta(content.to_string()))
                                    .await;
                            }
                        }
                        // Usage (some providers include it in last chunk)
                        if let Some(usage) = v.get("usage") {
                            input_tokens =
                                usage["prompt_tokens"].as_u64().unwrap_or(0) as u32;
                            output_tokens =
                                usage["completion_tokens"].as_u64().unwrap_or(0) as u32;
                        }
                    }
            }
        }
    }

    Ok(TokenUsage {
        input_tokens,
        output_tokens,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
    })
}

// ── Event relay ───────────────────────────────────────────────────────────────

pub(crate) fn spawn_event_relay(
    app_handle: AppHandle,
    agent_id: AgentId,
    handle: AgentHandle,
) {
    let mut rx = handle.subscribe();
    let channel = format!("agent-event:{}", agent_id.0);
    eprintln!("[spawn_event_relay] subscribed channel={channel}");
    tokio::spawn(async move {
        let mut emitted = 0usize;
        loop {
            match rx.recv().await {
                Ok(event) => {
                    emitted += 1;
                    let tag = match &event {
                        AgentEvent::TextDelta(s) => format!("TextDelta({} chars)", s.len()),
                        AgentEvent::ReasoningDelta(s) => {
                            format!("ReasoningDelta({} chars)", s.len())
                        }
                        AgentEvent::StateChanged(s) => format!("StateChanged({s:?})"),
                        AgentEvent::TurnCompleted { .. } => "TurnCompleted".to_string(),
                        AgentEvent::Error { message } => format!("Error({message})"),
                        AgentEvent::ToolCallStarted { tool, .. } => format!("ToolCallStarted({tool})"),
                        AgentEvent::ToolCallCompleted { tool, .. } => {
                            format!("ToolCallCompleted({tool})")
                        }
                    };
                    eprintln!("[relay #{emitted} {channel}] emit {tag}");
                    let _ = app_handle.emit(&channel, &event);
                    if let AgentEvent::TurnCompleted { ref usage } = event {
                        let new_cost = handle.accumulate_cost(usage, &handle.model);
                        if let Some(budget) = handle.budget_dollars {
                            if new_cost >= budget {
                                let _ = handle.event_tx.send(
                                    AgentEvent::StateChanged(AgentState::Failed)
                                ).await;
                                let _ = handle.event_tx.send(AgentEvent::Error {
                                    message: format!("Budget exceeded: ${:.4}", new_cost),
                                }).await;
                            }
                        }
                    }
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
                    let _ = app_handle.emit(
                        &channel,
                        serde_json::json!({ "type": "EventsLost", "count": n }),
                    );
                }
                Err(RecvError::Closed) => break,
            }
        }
    });
}

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

pub(crate) fn spawn_agent_executor(_agent_id: AgentId, handle: AgentHandle) {
    let task = handle.task.clone();
    let model = handle.model.clone();
    let worktree_path = handle.worktree_path.clone();
    let event_tx = handle.event_tx.clone();

    tokio::spawn(async move {
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

#[cfg(test)]
mod config_tests {
    use super::*;

    fn make_legacy_cli_config() -> ConfigMap {
        // Mimics what the existing rusty-claude-cli writes today: uppercase
        // env-var-style keys plus extras the Tauri side doesn't know about.
        serde_json::from_str(
            r#"{
                "ANTHROPIC_API_KEY": "ant-xxx",
                "KIMI_API_KEY": "kimi-xxx",
                "KIMI_CODING_BASE_URL": "https://api.kimi.com/coding/v1",
                "AWS_SECRET_ACCESS_KEY": "aws-secret",
                "OPENAI_API_KEY": "oai-xxx"
            }"#,
        )
        .unwrap()
    }

    #[test]
    fn config_get_reads_uppercase_cli_keys() {
        let cfg = make_legacy_cli_config();
        assert_eq!(config_get(&cfg, "KIMI_API_KEY"), Some("kimi-xxx".to_string()));
        assert_eq!(
            config_get(&cfg, "ANTHROPIC_API_KEY"),
            Some("ant-xxx".to_string())
        );
        assert_eq!(config_get(&cfg, "MISSING"), None);
        // Empty strings should be treated as unset.
        let mut cfg2 = cfg.clone();
        cfg2.insert("KIMI_API_KEY".into(), serde_json::Value::String("".into()));
        assert_eq!(config_get(&cfg2, "KIMI_API_KEY"), None);
    }

    #[test]
    fn provider_env_var_map_matches_streaming_code() {
        // These mappings must stay aligned with what call_anthropic_streaming
        // and call_model_streaming read.
        assert_eq!(provider_env_var("anthropic"), Some("ANTHROPIC_API_KEY"));
        assert_eq!(provider_env_var("kimi"), Some("KIMI_API_KEY"));
        assert_eq!(provider_env_var("kimi_coding"), Some("KIMI_CODING_API_KEY"));
        assert_eq!(provider_env_var("minimax"), Some("MINIMAX_API_KEY"));
        assert_eq!(provider_env_var("nope"), None);
    }

    #[test]
    fn setting_a_key_preserves_unknown_cli_fields() {
        // Regression: a previous AppConfig struct silently dropped any field
        // the Tauri side didn't model, destroying the CLI's settings on save.
        let mut cfg = make_legacy_cli_config();
        let env_var = provider_env_var("kimi").unwrap();
        cfg.insert(env_var.to_string(), serde_json::Value::String("new-kimi".into()));
        // Round-trip serialize/deserialize to simulate save_config -> load_config.
        let s = serde_json::to_string(&cfg).unwrap();
        let cfg2: ConfigMap = serde_json::from_str(&s).unwrap();
        assert_eq!(config_get(&cfg2, "KIMI_API_KEY"), Some("new-kimi".into()));
        // CLI-only fields must still be present.
        assert_eq!(
            config_get(&cfg2, "KIMI_CODING_BASE_URL"),
            Some("https://api.kimi.com/coding/v1".into())
        );
        assert_eq!(
            config_get(&cfg2, "AWS_SECRET_ACCESS_KEY"),
            Some("aws-secret".into())
        );
        assert_eq!(config_get(&cfg2, "OPENAI_API_KEY"), Some("oai-xxx".into()));
    }
}
