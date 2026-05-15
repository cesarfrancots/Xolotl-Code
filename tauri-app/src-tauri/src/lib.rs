use std::sync::Arc;
use specta_typescript::Typescript;
use tauri_specta::{collect_commands, Builder};

use runtime::{AgentEvent, AgentId, AgentState, AgentSupervisor};
use crate::commands::{
    delete_session, list_agents, list_models, list_sessions, load_session, respond_to_permission,
    save_session, smoke_test, spawn_agent, stop_agent, test_permission_prompt, run_agent_turn,
    launch_team, launch_swarm, get_worktree_diff, merge_worktrees,
    start_eval, list_evals, load_eval, delete_eval, save_human_scores,
    get_api_key_status, set_api_key, test_api_connection,
    SessionMeta, RoleConfig, GroupLaunchResult, FileDiff,
    ChatMessage, EvalMeta, EvalResult, ModelEvalResult, HumanScores,
};
use crate::permission_prompter::{PermissionDecision, PendingPrompts};

mod commands;
mod permission_prompter;

fn make_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        // u64 timestamps (created_at, duration_ms) exceed TS number precision in
        // theory; in practice these are unix-ms / millisecond durations that fit
        // comfortably under Number.MAX_SAFE_INTEGER for centuries.
        .dangerously_cast_bigints_to_number()
        .commands(collect_commands![
            smoke_test,
            spawn_agent,
            list_agents,
            stop_agent,
            respond_to_permission,
            test_permission_prompt,
            run_agent_turn,
            list_models,
            list_sessions,
            load_session,
            delete_session,
            save_session,
            launch_team,
            launch_swarm,
            get_worktree_diff,
            merge_worktrees,
            start_eval,
            list_evals,
            load_eval,
            delete_eval,
            save_human_scores,
            get_api_key_status,
            set_api_key,
            test_api_connection,
        ])
        .typ::<AgentId>()
        .typ::<AgentState>()
        .typ::<AgentEvent>()
        .typ::<PermissionDecision>()
        .typ::<SessionMeta>()
        .typ::<RoleConfig>()
        .typ::<GroupLaunchResult>()
        .typ::<FileDiff>()
        .typ::<ChatMessage>()
        .typ::<EvalMeta>()
        .typ::<EvalResult>()
        .typ::<ModelEvalResult>()
        .typ::<HumanScores>()
}

pub fn export_bindings(path: &str) {
    make_builder()
        .export(Typescript::default(), path)
        .expect("Failed to export TypeScript bindings");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = make_builder();

    #[cfg(debug_assertions)]
    export_bindings("../src/bindings.ts");

    let cwd = std::env::current_dir().expect("cwd must be accessible");
    let repo_root = std::process::Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| std::path::PathBuf::from(s.trim()))
        .filter(|root| cwd.starts_with(root))
        .unwrap_or(cwd);

    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Arc::new(AgentSupervisor::new(repo_root)))
        .manage(PendingPrompts::default())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn generate_bindings_ts() {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let out = format!("{manifest_dir}/../src/bindings.ts");
        export_bindings(&out);
        assert!(
            Path::new(&out).exists(),
            "bindings.ts should have been generated at {out}"
        );
    }
}
