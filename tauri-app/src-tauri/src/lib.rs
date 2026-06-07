use specta_typescript::Typescript;
use std::sync::Arc;
use tauri::menu::{AboutMetadata, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Emitter;
use tauri_specta::{collect_commands, Builder};

use crate::civilization::{
    advance_civ_turn, apply_civ_intervention, create_civ_session, delete_civ_session,
    list_civ_sessions, load_civ_session, CivCivilization, CivDecisionAction, CivEntity, CivGenes,
    CivIntervention, CivLogEntry, CivModelDecision, CivModifier, CivRegion, CivScore,
    CivSessionConfig, CivSessionMeta, CivSessionSnapshot, CivTile, CivWorld,
};
use crate::commands::{
    add_project, browse_directory, build_hint_proposals, build_reliability_profiles,
    cancel_chat_turn, chat_turn, cleanup_eval_processes, convert_pdf, delete_eval, delete_session,
    get_api_key_status, get_worktree_diff, launch_swarm, launch_team, list_agents,
    list_eval_suites, list_evals, list_hint_proposals, list_models, list_projects,
    list_prompt_commands, list_reliability_profiles, list_sessions, load_eval, load_session,
    merge_worktrees, pick_directory, remove_project, respond_to_permission, run_agent_turn,
    run_eval_suite, run_goal_grade, run_llm_judge, save_human_scores, save_manual_reviews,
    save_session, set_api_key, smoke_test, spawn_agent, start_eval, start_eval_artifact,
    start_goal_eval, stop_agent, test_api_connection, test_permission_prompt, touch_project,
    AutoScores, ChatMessage, DirChild, DirListing, EvalArtifactFileInput, EvalArtifactLaunchResult,
    EvalArtifactRequest, EvalMeta, EvalResult, EvalSuite, FileDiff, GoalAxisScore, GoalGrade,
    GroupLaunchResult, HumanScores, JudgeScores, ManualReview, ModelEvalResult, ProfileBuildResult,
    Project, PromptCommand, ProposalBuildResult, ReasoningFlag, ReliabilityMetrics, RoleConfig,
    SessionMeta, SuitePrompt,
};
use crate::permission_prompter::{PendingPrompts, PermissionDecision};
use crate::skills_mcp::{
    list_mcp_servers, list_skills, read_skill, test_mcp_server, McpServerConfig, McpTestResult,
    SkillManifest,
};
use crate::terminal::{
    terminal_kill, terminal_list, terminal_resize, terminal_spawn, terminal_write, TerminalInfo,
    TerminalManager,
};
use runtime::{
    AgentEvent, AgentId, AgentState, AgentSupervisor, HintProposal, ProposedOverride,
    ReliabilityProfile,
};

mod civilization;
mod commands;
mod permission_prompter;
pub mod skills_mcp;
mod terminal;

const MENU_EVENT: &str = "xolotl://menu";
const MENU_NEW_CHAT: &str = "xolotl:new-chat";
const MENU_OPEN_FOLDER: &str = "xolotl:open-folder";
const MENU_SETTINGS: &str = "xolotl:settings";
const MENU_COMMANDS: &str = "xolotl:commands";
const MENU_TOGGLE_TERMINAL: &str = "xolotl:toggle-terminal";
const MENU_TERMINAL_NEW_TAB: &str = "xolotl:terminal-new-tab";
const MENU_TERMINAL_CLOSE_TAB: &str = "xolotl:terminal-close-tab";
const MENU_TERMINAL_PREV_TAB: &str = "xolotl:terminal-prev-tab";
const MENU_TERMINAL_NEXT_TAB: &str = "xolotl:terminal-next-tab";
const MENU_TAB_CHAT: &str = "xolotl:tab-chat";
const MENU_TAB_EVAL: &str = "xolotl:tab-eval";
const MENU_TAB_CIV: &str = "xolotl:tab-civ";

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
            build_reliability_profiles,
            build_hint_proposals,
            list_reliability_profiles,
            list_hint_proposals,
            cleanup_eval_processes,
            cancel_chat_turn,
            chat_turn,
            list_projects,
            add_project,
            remove_project,
            touch_project,
            pick_directory,
            browse_directory,
            convert_pdf,
            terminal_spawn,
            terminal_write,
            terminal_resize,
            terminal_kill,
            terminal_list,
            create_civ_session,
            list_civ_sessions,
            load_civ_session,
            delete_civ_session,
            apply_civ_intervention,
            advance_civ_turn,
        ])
        .typ::<AgentId>()
        .typ::<AgentState>()
        .typ::<AgentEvent>()
        .typ::<PermissionDecision>()
        .typ::<SessionMeta>()
        .typ::<Project>()
        .typ::<DirChild>()
        .typ::<DirListing>()
        .typ::<RoleConfig>()
        .typ::<GroupLaunchResult>()
        .typ::<FileDiff>()
        .typ::<ChatMessage>()
        .typ::<PromptCommand>()
        .typ::<EvalMeta>()
        .typ::<EvalResult>()
        .typ::<ModelEvalResult>()
        .typ::<ReliabilityMetrics>()
        .typ::<ProfileBuildResult>()
        .typ::<ProposalBuildResult>()
        .typ::<ReliabilityProfile>()
        .typ::<HintProposal>()
        .typ::<ProposedOverride>()
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
        .typ::<TerminalInfo>()
        .typ::<CivSessionConfig>()
        .typ::<CivSessionMeta>()
        .typ::<CivSessionSnapshot>()
        .typ::<CivWorld>()
        .typ::<CivRegion>()
        .typ::<CivTile>()
        .typ::<CivEntity>()
        .typ::<CivGenes>()
        .typ::<CivCivilization>()
        .typ::<CivScore>()
        .typ::<CivModifier>()
        .typ::<CivLogEntry>()
        .typ::<CivIntervention>()
        .typ::<CivModelDecision>()
        .typ::<CivDecisionAction>()
}

fn build_native_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let about_metadata = AboutMetadata {
        name: Some("Xolotl Code".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        short_version: Some(env!("CARGO_PKG_VERSION").into()),
        ..Default::default()
    };

    let settings = MenuItemBuilder::with_id(MENU_SETTINGS, "Settings...")
        .accelerator("CmdOrCtrl+Comma")
        .build(app)?;
    let new_chat = MenuItemBuilder::with_id(MENU_NEW_CHAT, "New Chat")
        .accelerator("CmdOrCtrl+KeyN")
        .build(app)?;
    let open_folder = MenuItemBuilder::with_id(MENU_OPEN_FOLDER, "Open Folder...")
        .accelerator("CmdOrCtrl+KeyO")
        .build(app)?;
    let commands = MenuItemBuilder::with_id(MENU_COMMANDS, "Command Palette...")
        .accelerator("CmdOrCtrl+KeyK")
        .build(app)?;
    let toggle_terminal = MenuItemBuilder::with_id(MENU_TOGGLE_TERMINAL, "Toggle Terminal")
        .accelerator("CmdOrCtrl+KeyJ")
        .build(app)?;
    let new_terminal_tab = MenuItemBuilder::with_id(MENU_TERMINAL_NEW_TAB, "New Terminal Tab")
        .accelerator("CmdOrCtrl+KeyT")
        .build(app)?;
    let close_terminal_tab =
        MenuItemBuilder::with_id(MENU_TERMINAL_CLOSE_TAB, "Close Terminal Tab")
            .accelerator("CmdOrCtrl+KeyW")
            .build(app)?;
    let previous_terminal_tab =
        MenuItemBuilder::with_id(MENU_TERMINAL_PREV_TAB, "Previous Terminal Tab")
            .accelerator("CmdOrCtrl+Shift+ArrowLeft")
            .build(app)?;
    let next_terminal_tab = MenuItemBuilder::with_id(MENU_TERMINAL_NEXT_TAB, "Next Terminal Tab")
        .accelerator("CmdOrCtrl+Shift+ArrowRight")
        .build(app)?;
    let chat_tab = MenuItemBuilder::with_id(MENU_TAB_CHAT, "Chat")
        .accelerator("CmdOrCtrl+Digit1")
        .build(app)?;
    let eval_tab = MenuItemBuilder::with_id(MENU_TAB_EVAL, "Eval")
        .accelerator("CmdOrCtrl+Digit2")
        .build(app)?;
    let civ_tab = MenuItemBuilder::with_id(MENU_TAB_CIV, "Civ")
        .accelerator("CmdOrCtrl+Digit3")
        .build(app)?;

    let app_menu = SubmenuBuilder::new(app, "Xolotl Code")
        .about(Some(about_metadata))
        .separator()
        .item(&settings)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_chat)
        .item(&open_folder)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&commands)
        .item(&toggle_terminal)
        .separator()
        .fullscreen()
        .build()?;

    let workbench_menu = SubmenuBuilder::new(app, "Workbench")
        .item(&chat_tab)
        .item(&eval_tab)
        .item(&civ_tab)
        .build()?;

    let terminal_menu = SubmenuBuilder::new(app, "Terminal")
        .item(&new_terminal_tab)
        .item(&close_terminal_tab)
        .separator()
        .item(&previous_terminal_tab)
        .item(&next_terminal_tab)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .bring_all_to_front()
        .build()?;

    MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&workbench_menu)
        .item(&terminal_menu)
        .item(&window_menu)
        .build()
}

fn menu_action_for_id(id: &tauri::menu::MenuId) -> Option<&'static str> {
    if id == MENU_NEW_CHAT {
        Some(MENU_NEW_CHAT)
    } else if id == MENU_OPEN_FOLDER {
        Some(MENU_OPEN_FOLDER)
    } else if id == MENU_SETTINGS {
        Some(MENU_SETTINGS)
    } else if id == MENU_COMMANDS {
        Some(MENU_COMMANDS)
    } else if id == MENU_TOGGLE_TERMINAL {
        Some(MENU_TOGGLE_TERMINAL)
    } else if id == MENU_TERMINAL_NEW_TAB {
        Some(MENU_TERMINAL_NEW_TAB)
    } else if id == MENU_TERMINAL_CLOSE_TAB {
        Some(MENU_TERMINAL_CLOSE_TAB)
    } else if id == MENU_TERMINAL_PREV_TAB {
        Some(MENU_TERMINAL_PREV_TAB)
    } else if id == MENU_TERMINAL_NEXT_TAB {
        Some(MENU_TERMINAL_NEXT_TAB)
    } else if id == MENU_TAB_CHAT {
        Some(MENU_TAB_CHAT)
    } else if id == MENU_TAB_EVAL {
        Some(MENU_TAB_EVAL)
    } else if id == MENU_TAB_CIV {
        Some(MENU_TAB_CIV)
    } else {
        None
    }
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Arc::new(AgentSupervisor::new(repo_root)))
        .manage(PendingPrompts::default())
        .manage(TerminalManager::default())
        .on_window_event(|_window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                crate::commands::cleanup_eval_processes();
            }
        })
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            let menu = build_native_menu(app.handle())?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                if let Some(action) = menu_action_for_id(event.id()) {
                    let _ = app.emit(MENU_EVENT, action);
                }
            });
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
