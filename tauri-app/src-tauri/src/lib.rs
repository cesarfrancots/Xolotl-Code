use specta_typescript::Typescript;
use std::sync::Arc;
use tauri_specta::{collect_commands, Builder};

use crate::commands::{
    chat_turn, cleanup_eval_processes, delete_eval, delete_session, get_api_key_status,
    get_worktree_diff, launch_swarm, launch_team, list_agents, list_eval_suites, list_evals,
    list_models, list_prompt_commands, list_sessions, load_eval, load_session, merge_worktrees,
    respond_to_permission, run_agent_turn, run_eval_suite, run_goal_grade, run_llm_judge,
    save_human_scores, save_manual_reviews, save_session, set_api_key, smoke_test, spawn_agent,
    start_eval, start_eval_artifact, start_goal_eval, stop_agent, test_api_connection,
    test_permission_prompt, AutoScores, ChatMessage, EvalArtifactFileInput,
    EvalArtifactLaunchResult, EvalArtifactRequest, EvalMeta, EvalResult, EvalSuite, FileDiff,
    GoalAxisScore, GoalGrade, GroupLaunchResult, HumanScores, JudgeScores, ManualReview,
    ModelEvalResult, PromptCommand, ReasoningFlag, RoleConfig, SessionMeta, SuitePrompt,
};
use crate::permission_prompter::{PendingPrompts, PermissionDecision};
use crate::skills_mcp::{
    list_mcp_servers, list_skills, read_skill, test_mcp_server, McpServerConfig, McpTestResult,
    SkillManifest,
};
use runtime::{AgentEvent, AgentId, AgentState, AgentSupervisor};

mod commands;
mod permission_prompter;
pub mod skills_mcp;

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
            list_prompt_commands,
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
            save_manual_reviews,
            list_eval_suites,
            run_eval_suite,
            run_llm_judge,
            start_goal_eval,
            run_goal_grade,
            list_skills,
            read_skill,
            list_mcp_servers,
            test_mcp_server,
            get_api_key_status,
            set_api_key,
            test_api_connection,
            start_eval_artifact,
            cleanup_eval_processes,
            chat_turn,
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
        .typ::<PromptCommand>()
        .typ::<EvalMeta>()
        .typ::<EvalResult>()
        .typ::<ModelEvalResult>()
        .typ::<HumanScores>()
        .typ::<ManualReview>()
        .typ::<AutoScores>()
        .typ::<JudgeScores>()
        .typ::<EvalSuite>()
        .typ::<SuitePrompt>()
        .typ::<GoalAxisScore>()
        .typ::<ReasoningFlag>()
        .typ::<GoalGrade>()
        .typ::<EvalArtifactFileInput>()
        .typ::<EvalArtifactRequest>()
        .typ::<EvalArtifactLaunchResult>()
        .typ::<SkillManifest>()
        .typ::<McpServerConfig>()
        .typ::<McpTestResult>()
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
        .on_window_event(|_window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                crate::commands::cleanup_eval_processes();
            }
        })
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
