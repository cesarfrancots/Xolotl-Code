use specta_typescript::Typescript;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::menu::{AboutMetadata, Menu, MenuBuilder, MenuItemBuilder, Submenu, SubmenuBuilder};
use tauri::{Emitter, Manager};
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
    get_api_key_status, get_mac_productivity_settings, get_worktree_diff, launch_swarm,
    launch_team, list_agents, list_eval_suites, list_evals, list_hint_proposals, list_models,
    list_projects, list_prompt_commands, list_reliability_profiles, list_sessions, load_eval,
    load_session, merge_worktrees, migrate_api_key_to_keychain, open_path_in_external_editor,
    pick_directory, remove_project, respond_to_permission, reveal_in_finder, run_agent_turn,
    run_eval_suite, run_goal_grade, run_llm_judge, save_human_scores, save_manual_reviews,
    save_session, set_api_key, set_external_editor, smoke_test, spawn_agent, start_eval,
    start_eval_artifact, start_goal_eval, stop_agent, test_api_connection, test_permission_prompt,
    touch_project, AutoScores, ChatMessage, DirChild, DirListing, EvalArtifactFileInput,
    EvalArtifactLaunchResult, EvalArtifactRequest, EvalMeta, EvalResult, EvalSuite, FileDiff,
    GoalAxisScore, GoalGrade, GroupLaunchResult, HumanScores, JudgeScores, MacProductivitySettings,
    ManualReview, ModelEvalResult, ProfileBuildResult, Project, PromptCommand, ProposalBuildResult,
    ReasoningFlag, ReliabilityMetrics, RoleConfig, SessionMeta, SuitePrompt,
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
const PROJECT_OPEN_EVENT: &str = "xolotl://open-project";
const MENU_NEW_CHAT: &str = "xolotl:new-chat";
const MENU_OPEN_FOLDER: &str = "xolotl:open-folder";
const MENU_RECENT_PROJECT_PREFIX: &str = "xolotl:recent-project:";
const MENU_NO_RECENT_PROJECTS: &str = "xolotl:no-recent-projects";
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
const RECENT_PROJECT_LIMIT: usize = 8;

#[derive(Default)]
struct PendingOpenProjects(Mutex<Vec<String>>);

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
            get_mac_productivity_settings,
            migrate_api_key_to_keychain,
            set_external_editor,
            set_api_key,
            open_path_in_external_editor,
            test_api_connection,
            start_eval_artifact,
            build_reliability_profiles,
            build_hint_proposals,
            list_reliability_profiles,
            list_hint_proposals,
            cleanup_eval_processes,
            cancel_chat_turn,
            chat_turn,
            macos_commands::launch_project_paths,
            list_projects,
            add_project,
            remove_project,
            touch_project,
            reveal_in_finder,
            macos_commands::refresh_native_menu,
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
        .typ::<MacProductivitySettings>()
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

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn hex_decode(value: &str) -> Option<Vec<u8>> {
    let bytes = value.as_bytes();
    if bytes.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() / 2);
    for pair in bytes.chunks_exact(2) {
        let high = hex_value(pair[0])?;
        let low = hex_value(pair[1])?;
        out.push((high << 4) | low);
    }
    Some(out)
}

fn recent_project_menu_id(path: &str) -> String {
    format!("{MENU_RECENT_PROJECT_PREFIX}{}", hex_encode(path.as_bytes()))
}

fn recent_project_path_from_menu_id(id: &tauri::menu::MenuId) -> Option<String> {
    let encoded = id.as_ref().strip_prefix(MENU_RECENT_PROJECT_PREFIX)?;
    let bytes = hex_decode(encoded)?;
    String::from_utf8(bytes).ok()
}

fn mac_path_label(path: &str) -> String {
    let path_ref = Path::new(path);
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        if let Ok(relative) = path_ref.strip_prefix(&home) {
            if relative.as_os_str().is_empty() {
                return "~".into();
            }
            return format!("~/{}", relative.to_string_lossy());
        }
    }
    path.to_string()
}

fn recent_project_label(project: &Project) -> String {
    format!("{} - {}", project.name, mac_path_label(&project.path))
}

fn build_recent_projects_menu(app: &tauri::AppHandle) -> tauri::Result<Submenu<tauri::Wry>> {
    let projects = list_projects();
    let mut builder = SubmenuBuilder::new(app, "Open Recent").enabled(!projects.is_empty());

    if projects.is_empty() {
        let empty = MenuItemBuilder::with_id(MENU_NO_RECENT_PROJECTS, "No Recent Projects")
            .enabled(false)
            .build(app)?;
        builder = builder.item(&empty);
        return builder.build();
    }

    for project in projects.iter().take(RECENT_PROJECT_LIMIT) {
        let item = MenuItemBuilder::with_id(
            recent_project_menu_id(&project.path),
            recent_project_label(project),
        )
        .build(app)?;
        builder = builder.item(&item);
    }

    builder.build()
}

fn canonical_project_path_from_arg(arg: OsString) -> Option<String> {
    let raw = PathBuf::from(arg);
    if !raw.is_dir() {
        return None;
    }
    let canonical = std::fs::canonicalize(&raw).unwrap_or(raw);
    Some(canonical.to_string_lossy().into_owned())
}

fn launch_project_paths_from_args<I>(args: I) -> Vec<String>
where
    I: IntoIterator<Item = OsString>,
{
    let mut paths = Vec::new();
    for arg in args.into_iter().skip(1) {
        let Some(path) = canonical_project_path_from_arg(arg) else {
            continue;
        };
        if !paths.iter().any(|existing| existing == &path) {
            paths.push(path);
        }
    }
    paths
}

fn dedupe_project_paths(paths: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut unique = Vec::new();
    for path in paths {
        if !unique.iter().any(|existing| existing == &path) {
            unique.push(path);
        }
    }
    unique
}

fn project_path_from_open_url(url: &tauri::Url) -> Option<String> {
    if url.scheme() != "file" {
        return None;
    }
    let path = url.to_file_path().ok()?;
    canonical_project_path_from_arg(path.into_os_string())
}

fn project_paths_from_open_urls(urls: Vec<tauri::Url>) -> Vec<String> {
    dedupe_project_paths(urls.iter().filter_map(project_path_from_open_url))
}

fn store_pending_project_paths(app: &tauri::AppHandle, paths: &[String]) {
    let pending = app.state::<PendingOpenProjects>();
    let Ok(mut pending_paths) = pending.0.lock() else {
        return;
    };
    for path in paths {
        if !pending_paths.iter().any(|existing| existing == path) {
            pending_paths.push(path.clone());
        }
    }
}

fn drain_pending_project_paths(pending: &PendingOpenProjects) -> Vec<String> {
    let Ok(mut pending_paths) = pending.0.lock() else {
        return Vec::new();
    };
    let paths = pending_paths.clone();
    pending_paths.clear();
    paths
}

fn emit_project_open_paths(app: &tauri::AppHandle, paths: Vec<String>) {
    let paths = dedupe_project_paths(paths);
    if paths.is_empty() {
        return;
    }
    store_pending_project_paths(app, &paths);
    for path in paths {
        let _ = app.emit(PROJECT_OPEN_EVENT, path);
    }
}

fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

mod macos_commands {
    #[tauri::command]
    #[specta::specta]
    pub fn launch_project_paths(state: tauri::State<'_, super::PendingOpenProjects>) -> Vec<String> {
        let launch_paths = super::launch_project_paths_from_args(std::env::args_os());
        let pending_paths = super::drain_pending_project_paths(&state);
        super::dedupe_project_paths(launch_paths.into_iter().chain(pending_paths))
    }

    #[tauri::command]
    #[specta::specta]
    pub fn refresh_native_menu(app_handle: tauri::AppHandle) -> Result<(), String> {
        let menu = super::build_native_menu(&app_handle).map_err(|err| err.to_string())?;
        app_handle.set_menu(menu).map_err(|err| err.to_string())?;
        Ok(())
    }
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
    let recent_projects = build_recent_projects_menu(app)?;
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
        .separator()
        .item(&recent_projects)
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
        .manage(PendingOpenProjects::default())
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
                } else if let Some(path) = recent_project_path_from_menu_id(event.id()) {
                    let _ = app.emit(PROJECT_OPEN_EVENT, path);
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
            tauri::RunEvent::Opened { urls } => {
                let paths = project_paths_from_open_urls(urls);
                emit_project_open_paths(app, paths);
                focus_main_window(app);
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows: _,
                ..
            } => {
                focus_main_window(app);
            }
            _ => {}
        });
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

    #[test]
    fn recent_project_menu_id_round_trips_path() {
        let path = "/Users/cesar/Projects/Xolotl Code";
        let menu_id = tauri::menu::MenuId::new(recent_project_menu_id(path));

        assert_eq!(
            recent_project_path_from_menu_id(&menu_id),
            Some(path.to_string())
        );
    }

    #[test]
    fn recent_project_menu_id_rejects_malformed_payload() {
        let menu_id = tauri::menu::MenuId::new(format!("{MENU_RECENT_PROJECT_PREFIX}xyz"));

        assert_eq!(recent_project_path_from_menu_id(&menu_id), None);
    }

    #[test]
    fn launch_project_paths_keep_existing_directories_once() {
        let root =
            std::env::temp_dir().join(format!("xolotl-launch-paths-{}", std::process::id()));
        let project = root.join("Project With Spaces");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&project).expect("project test dir should be created");

        let paths = launch_project_paths_from_args(vec![
            OsString::from("xolotl-code"),
            project.clone().into_os_string(),
            OsString::from("/not/a/real/project"),
            project.clone().into_os_string(),
        ]);

        let expected = std::fs::canonicalize(&project)
            .expect("project test dir should canonicalize")
            .to_string_lossy()
            .into_owned();
        assert_eq!(paths, vec![expected]);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn project_paths_from_open_urls_accepts_file_directory_urls() {
        let root =
            std::env::temp_dir().join(format!("xolotl-open-url-{}", std::process::id()));
        let project = root.join("Project From Finder");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&project).expect("project test dir should be created");

        let file_url = tauri::Url::from_file_path(&project).expect("file url should be created");
        let paths = project_paths_from_open_urls(vec![file_url.clone(), file_url]);

        let expected = std::fs::canonicalize(&project)
            .expect("project test dir should canonicalize")
            .to_string_lossy()
            .into_owned();
        assert_eq!(paths, vec![expected]);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn project_paths_from_open_urls_rejects_non_file_urls_and_files() {
        let root =
            std::env::temp_dir().join(format!("xolotl-open-url-reject-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("project test dir should be created");
        let file = root.join("note.txt");
        std::fs::write(&file, "not a project").expect("test file should be written");

        let urls = vec![
            tauri::Url::parse("https://example.com/project").expect("https url should parse"),
            tauri::Url::from_file_path(&file).expect("file url should be created"),
        ];

        assert!(project_paths_from_open_urls(urls).is_empty());

        let _ = std::fs::remove_dir_all(&root);
    }
}
