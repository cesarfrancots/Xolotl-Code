use std::collections::HashMap;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Emitter};
use runtime::{PermissionPrompter, PermissionPromptDecision, PermissionRequest};

/// Frontend-facing decision type with three options (D-12).
/// Distinct from PermissionPromptDecision in runtime — that type drives the Rust outcome.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub enum PermissionDecision {
    Allow,
    Deny,
    AlwaysAllow,
}

/// Payload emitted to frontend when a permission prompt is raised.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct PermissionRequestPayload {
    pub prompt_id: String,
    pub tool_name: String,
    pub preview: String, // first 120 chars of request.input
}

/// Shared managed state: maps prompt_id -> mpsc::Sender waiting for response.
/// Arc<Mutex<...>> because it is accessed from both the blocking decide() thread
/// and the async respond_to_permission command handler.
pub type PendingPrompts = Arc<Mutex<HashMap<String, mpsc::Sender<PermissionDecision>>>>;

pub struct TauriPermissionPrompter {
    pub app_handle: AppHandle,
    pub pending_prompts: PendingPrompts,
}

impl PermissionPrompter for TauriPermissionPrompter {
    fn decide(&mut self, request: &PermissionRequest) -> PermissionPromptDecision {
        let prompt_id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = mpsc::channel::<PermissionDecision>();

        // Register sender before emitting event (avoids race where frontend
        // responds before the sender is stored)
        // CR-01: use map_err instead of unwrap to avoid process crash on poisoned mutex
        let Ok(mut pending) = self.pending_prompts.lock() else {
            return PermissionPromptDecision::Deny {
                reason: "Internal error: mutex poisoned".to_string(),
            };
        };
        pending.insert(prompt_id.clone(), tx);
        drop(pending);

        // First 120 chars of input as preview — use .chars().take(120) for correct Unicode handling
        let preview: String = request.input.chars().take(120).collect();

        let _ = self.app_handle.emit(
            "permission-request",
            PermissionRequestPayload {
                prompt_id: prompt_id.clone(),
                tool_name: request.tool_name.clone(),
                preview,
            },
        );

        // SAFE: decide() is always called from within tokio::task::spawn_blocking
        // (ORC-03 invariant). recv_timeout blocks this OS thread — not an async task.
        let decision = match rx.recv_timeout(Duration::from_secs(60)) {
            Ok(d) => d,
            Err(_) => {
                // Timeout (or sender dropped) — emit timeout event and deny
                let _ = self.app_handle.emit("permission-timeout", &prompt_id);
                PermissionDecision::Deny
            }
        };

        // Clean up regardless of outcome (CR-01: use map_err to avoid panic on poisoned mutex)
        let mut pending = self.pending_prompts.lock().map_err(|poisoned| {
            eprintln!("warn: PendingPrompts mutex poisoned during cleanup, recovering: {poisoned}");
            poisoned.into_inner()
        }).unwrap_or_else(|guard| guard);
        pending.remove(&prompt_id);

        match decision {
            PermissionDecision::Allow => PermissionPromptDecision::Allow,
            PermissionDecision::AlwaysAllow => {
                // AlwaysAllow: authorized Phase 3 scope — Allow for the current call and
                // emit "policy-update-requested" so the frontend can show persistent-approval
                // feedback. Full in-session PermissionPolicy mutation (matching CLI [a]
                // behavior) is deferred to Phase 4 when the full agent loop is wired (D-12).
                let _ = self.app_handle.emit("policy-update-requested", &prompt_id);
                PermissionPromptDecision::Allow
            }
            PermissionDecision::Deny => PermissionPromptDecision::Deny {
                reason: "User denied".to_string(),
            },
        }
    }
}
