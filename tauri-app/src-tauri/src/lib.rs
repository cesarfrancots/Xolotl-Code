use serde::{Deserialize, Serialize};
#[cfg(feature = "dev-tools")]
use specta_typescript::Typescript;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::menu::{
    AboutMetadata, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder,
};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};
use tauri_specta::{collect_commands, Builder};

use crate::commands::{
    add_project, browse_directory, build_hint_proposals, build_reliability_profiles,
    cancel_chat_turn, chat_turn, cleanup_eval_processes, convert_pdf, delete_eval, delete_session,
    export_eval_report, get_agent_worktree_path, get_api_key_status, get_mac_productivity_settings,
    get_worktree_diff, launch_swarm, launch_team, list_agents, list_eval_suites, list_evals,
    list_hint_proposals, list_models, list_projects, list_prompt_commands,
    list_reliability_profiles, list_sessions, load_eval, load_session, merge_worktrees,
    migrate_api_key_to_keychain, open_path_in_external_editor, open_path_in_external_terminal,
    pick_directory, quick_look_path, remove_project, respond_to_permission,
    reveal_eval_artifacts_in_finder, reveal_eval_result_in_finder, reveal_in_finder,
    run_agent_turn, run_eval_suite, run_goal_grade, run_llm_judge, save_human_scores,
    save_manual_reviews, save_session, set_api_key, set_external_editor, set_external_terminal,
    set_mac_global_hotkey_settings, set_mac_notification_settings, set_mac_status_item_settings,
    smoke_test, spawn_agent, start_eval, start_eval_artifact, start_goal_eval, stop_agent,
    test_api_connection, test_permission_prompt, touch_project, AutoScores, ChatMessage, DirChild,
    DirListing, EvalArtifactFileInput, EvalArtifactLaunchResult, EvalArtifactRequest, EvalMeta,
    EvalReportExportResult, EvalResult, EvalSuite, FileDiff, GoalAxisScore, GoalGrade,
    GroupLaunchResult, HumanScores, JudgeScores, MacExternalAppCandidate, MacGlobalHotkeySettings,
    MacNotificationSettings, MacProductivitySettings, MacStatusItemSettings, ManualReview,
    ModelEvalResult, ProfileBuildResult, Project, PromptCommand, ProposalBuildResult,
    ReasoningFlag, ReliabilityMetrics, RoleConfig, SessionMeta, SuitePrompt,
};
use crate::permission_prompter::{PendingPrompts, PermissionDecision};
use crate::skills_mcp::{
    list_mcp_servers, list_skills, read_skill, test_mcp_server, McpServerConfig, McpTestResult,
    SkillManifest,
};
use crate::terminal::{
    terminal_kill, terminal_kill_all, terminal_list, terminal_resize, terminal_spawn,
    terminal_write, TerminalInfo, TerminalManager,
};
use runtime::{
    AgentEvent, AgentId, AgentState, AgentSupervisor, HintProposal, ProposedOverride,
    ReliabilityProfile,
};

mod commands;
mod permission_prompter;
pub mod skills_mcp;
mod terminal;

const MENU_EVENT: &str = "xolotl://menu";
const PROJECT_OPEN_EVENT: &str = "xolotl://open-project";
const APP_REOPEN_EVENT: &str = "xolotl://app-reopen";
const APP_URL_SCHEME: &str = "xolotl-code";
const STATUS_ITEM_ID: &str = "xolotl-status-item";
const STATUS_PROJECT_ID: &str = "xolotl:status-project";
const STATUS_AGENTS_ID: &str = "xolotl:status-agents";
const STATUS_EVAL_ID: &str = "xolotl:status-eval";
const STATUS_REVEAL_ACTIVE_PROJECT: &str = "xolotl:status-reveal-active-project";
const STATUS_OPEN_ACTIVE_PROJECT_EDITOR: &str = "xolotl:status-open-active-project-editor";
const STATUS_OPEN_ACTIVE_PROJECT_TERMINAL: &str = "xolotl:status-open-active-project-terminal";
const STATUS_OPEN_LATEST_AGENT: &str = "xolotl:status-open-latest-agent";
const STATUS_COPY_ACTIVE_PROJECT_LINK: &str = "xolotl:status-copy-active-project-link";
const STATUS_COPY_ACTIVE_PROJECT_SHELL_OPEN: &str = "xolotl:status-copy-active-project-shell-open";
const MENU_OPEN_LATEST_AGENT: &str = "xolotl:open-latest-agent";
const MENU_REVEAL_LATEST_AGENT_WORKTREE: &str = "xolotl:reveal-latest-agent-worktree";
const MENU_OPEN_LATEST_AGENT_WORKTREE_EDITOR: &str = "xolotl:open-latest-agent-worktree-editor";
const MENU_OPEN_LATEST_AGENT_WORKTREE_TERMINAL: &str = "xolotl:open-latest-agent-worktree-terminal";
const MENU_NEW_LATEST_AGENT_WORKTREE_TERMINAL_TAB: &str =
    "xolotl:new-latest-agent-worktree-terminal-tab";
const MENU_COPY_LATEST_AGENT_WORKTREE_PATH: &str = "xolotl:copy-latest-agent-worktree-path";
const MENU_COPY_LATEST_AGENT_WORKTREE_LINK: &str = "xolotl:copy-latest-agent-worktree-link";
const MENU_COPY_LATEST_AGENT_WORKTREE_SHELL_OPEN: &str =
    "xolotl:copy-latest-agent-worktree-shell-open";
const MENU_COPY_LATEST_AGENT_WORKTREE_CONTEXT: &str = "xolotl:copy-latest-agent-worktree-context";
const MENU_COPY_LATEST_AGENT_WORKTREE_SHORTCUTS_JSON: &str =
    "xolotl:copy-latest-agent-worktree-shortcuts-json";
const MENU_NEW_ACTIVE_PROJECT_TERMINAL_TAB: &str = "xolotl:new-active-project-terminal-tab";
const MENU_COPY_ACTIVE_PROJECT_PATH: &str = "xolotl:copy-active-project-path";
const MENU_COPY_ACTIVE_PROJECT_CONTEXT: &str = "xolotl:copy-active-project-context";
const MENU_COPY_ACTIVE_PROJECT_SHORTCUTS_JSON: &str = "xolotl:copy-active-project-shortcuts-json";
const MENU_FOCUS_WINDOW: &str = "xolotl:focus-window";
const MENU_NEW_CHAT: &str = "xolotl:new-chat";
const MENU_OPEN_FOLDER: &str = "xolotl:open-folder";
const MENU_RECENT_PROJECT_PREFIX: &str = "xolotl:recent-project:";
const MENU_RECENT_PROJECT_ACTION_PREFIX: &str = "xolotl:recent-project-action:";
const RECENT_PROJECT_MENU_EVENT: &str = "xolotl://recent-project-menu";
const RECENT_PROJECT_ACTION_REVEAL: &str = "reveal";
const RECENT_PROJECT_ACTION_OPEN_EDITOR: &str = "open-editor";
const RECENT_PROJECT_ACTION_OPEN_TERMINAL: &str = "open-external-terminal";
const RECENT_PROJECT_ACTION_NEW_TERMINAL: &str = "new-terminal";
const RECENT_PROJECT_ACTION_COPY_PATH: &str = "copy-path";
const RECENT_PROJECT_ACTION_COPY_LINK: &str = "copy-link";
const RECENT_PROJECT_ACTION_COPY_SHELL_OPEN: &str = "copy-shell-open";
const RECENT_PROJECT_ACTION_COPY_CONTEXT: &str = "copy-context";
const RECENT_PROJECT_ACTION_COPY_SHORTCUTS_JSON: &str = "copy-shortcuts-json";
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

#[derive(Clone, Debug, Default, Deserialize, Serialize, specta::Type)]
pub struct MacStatusItemState {
    pub active_project_name: Option<String>,
    pub active_project_path: Option<String>,
    pub running_agents: u32,
    pub waiting_agents: u32,
    pub completed_agents: u32,
    pub failed_agents: u32,
    pub total_agents: u32,
    pub running_eval_models: u32,
    pub pending_eval_models: u32,
    pub completed_eval_models: u32,
    pub failed_eval_models: u32,
    pub total_eval_models: u32,
    pub active_eval_complete: bool,
}

#[derive(Default)]
pub(crate) struct MacStatusItemStateStore(Mutex<MacStatusItemState>);

fn make_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            smoke_test,
            spawn_agent,
            list_agents,
            get_agent_worktree_path,
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
            reveal_eval_result_in_finder,
            export_eval_report,
            reveal_eval_artifacts_in_finder,
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
            set_external_terminal,
            set_mac_global_hotkey_settings,
            set_mac_status_item_settings,
            set_mac_notification_settings,
            set_api_key,
            open_path_in_external_editor,
            open_path_in_external_terminal,
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
            quick_look_path,
            macos_commands::refresh_native_menu,
            pick_directory,
            browse_directory,
            convert_pdf,
            macos_commands::update_mac_status_item,
            terminal_spawn,
            terminal_write,
            terminal_resize,
            terminal_kill,
            terminal_kill_all,
            terminal_list,
        ])
        .typ::<AgentId>()
        .typ::<AgentState>()
        .typ::<AgentEvent>()
        .typ::<PermissionDecision>()
        .typ::<SessionMeta>()
        .typ::<Project>()
        .typ::<MacProductivitySettings>()
        .typ::<MacExternalAppCandidate>()
        .typ::<MacGlobalHotkeySettings>()
        .typ::<MacStatusItemSettings>()
        .typ::<MacStatusItemState>()
        .typ::<MacNotificationSettings>()
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
        .typ::<EvalReportExportResult>()
        .typ::<SkillManifest>()
        .typ::<McpServerConfig>()
        .typ::<McpTestResult>()
        .typ::<TerminalInfo>()
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
    format!(
        "{MENU_RECENT_PROJECT_PREFIX}{}",
        hex_encode(path.as_bytes())
    )
}

fn recent_project_action_menu_id(action: &str, path: &str) -> String {
    format!(
        "{MENU_RECENT_PROJECT_ACTION_PREFIX}{action}:{}",
        hex_encode(path.as_bytes())
    )
}

fn recent_project_path_from_menu_id(id: &tauri::menu::MenuId) -> Option<String> {
    let encoded = id.as_ref().strip_prefix(MENU_RECENT_PROJECT_PREFIX)?;
    let bytes = hex_decode(encoded)?;
    String::from_utf8(bytes).ok()
}

fn is_recent_project_action(action: &str) -> bool {
    matches!(
        action,
        RECENT_PROJECT_ACTION_REVEAL
            | RECENT_PROJECT_ACTION_OPEN_EDITOR
            | RECENT_PROJECT_ACTION_OPEN_TERMINAL
            | RECENT_PROJECT_ACTION_NEW_TERMINAL
            | RECENT_PROJECT_ACTION_COPY_PATH
            | RECENT_PROJECT_ACTION_COPY_LINK
            | RECENT_PROJECT_ACTION_COPY_SHELL_OPEN
            | RECENT_PROJECT_ACTION_COPY_CONTEXT
            | RECENT_PROJECT_ACTION_COPY_SHORTCUTS_JSON
    )
}

fn recent_project_action_from_menu_id(id: &tauri::menu::MenuId) -> Option<(String, String)> {
    let payload = id
        .as_ref()
        .strip_prefix(MENU_RECENT_PROJECT_ACTION_PREFIX)?;
    let (action, encoded_path) = payload.split_once(':')?;
    if !is_recent_project_action(action) {
        return None;
    }
    let bytes = hex_decode(encoded_path)?;
    let path = String::from_utf8(bytes).ok()?;
    Some((action.to_string(), path))
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

fn build_recent_project_handoff_menu(
    app: &tauri::AppHandle,
    project: &Project,
) -> tauri::Result<Submenu<tauri::Wry>> {
    let reveal = MenuItemBuilder::with_id(
        recent_project_action_menu_id(RECENT_PROJECT_ACTION_REVEAL, &project.path),
        "Reveal in Finder",
    )
    .build(app)?;
    let editor = MenuItemBuilder::with_id(
        recent_project_action_menu_id(RECENT_PROJECT_ACTION_OPEN_EDITOR, &project.path),
        "Open in Editor",
    )
    .build(app)?;
    let terminal = MenuItemBuilder::with_id(
        recent_project_action_menu_id(RECENT_PROJECT_ACTION_OPEN_TERMINAL, &project.path),
        "Open in External Terminal",
    )
    .build(app)?;
    let embedded_terminal = MenuItemBuilder::with_id(
        recent_project_action_menu_id(RECENT_PROJECT_ACTION_NEW_TERMINAL, &project.path),
        "New Embedded Terminal Here",
    )
    .build(app)?;
    let copy_path = MenuItemBuilder::with_id(
        recent_project_action_menu_id(RECENT_PROJECT_ACTION_COPY_PATH, &project.path),
        "Copy POSIX Path",
    )
    .build(app)?;
    let copy_link = MenuItemBuilder::with_id(
        recent_project_action_menu_id(RECENT_PROJECT_ACTION_COPY_LINK, &project.path),
        "Copy Xolotl Link",
    )
    .build(app)?;
    let copy_shell = MenuItemBuilder::with_id(
        recent_project_action_menu_id(RECENT_PROJECT_ACTION_COPY_SHELL_OPEN, &project.path),
        "Copy Shell Open Command",
    )
    .build(app)?;
    let copy_context = MenuItemBuilder::with_id(
        recent_project_action_menu_id(RECENT_PROJECT_ACTION_COPY_CONTEXT, &project.path),
        "Copy Context Prompt",
    )
    .build(app)?;
    let copy_shortcuts_json = MenuItemBuilder::with_id(
        recent_project_action_menu_id(RECENT_PROJECT_ACTION_COPY_SHORTCUTS_JSON, &project.path),
        "Copy Shortcuts JSON",
    )
    .build(app)?;

    SubmenuBuilder::new(app, recent_project_label(project))
        .item(&reveal)
        .item(&editor)
        .item(&terminal)
        .item(&embedded_terminal)
        .separator()
        .item(&copy_path)
        .item(&copy_link)
        .item(&copy_shell)
        .item(&copy_context)
        .item(&copy_shortcuts_json)
        .build()
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

    let mut handoffs = SubmenuBuilder::new(app, "Project Handoffs");
    for project in projects.iter().take(RECENT_PROJECT_LIMIT) {
        let project_handoffs = build_recent_project_handoff_menu(app, project)?;
        handoffs = handoffs.item(&project_handoffs);
    }
    let handoffs = handoffs.build()?;
    builder = builder.separator().item(&handoffs);

    builder.build()
}

fn build_active_project_menu(app: &tauri::AppHandle) -> tauri::Result<Submenu<tauri::Wry>> {
    let reveal =
        MenuItemBuilder::with_id(STATUS_REVEAL_ACTIVE_PROJECT, "Reveal in Finder").build(app)?;
    let editor =
        MenuItemBuilder::with_id(STATUS_OPEN_ACTIVE_PROJECT_EDITOR, "Open in Editor").build(app)?;
    let terminal = MenuItemBuilder::with_id(
        STATUS_OPEN_ACTIVE_PROJECT_TERMINAL,
        "Open in External Terminal",
    )
    .build(app)?;
    let embedded_terminal = MenuItemBuilder::with_id(
        MENU_NEW_ACTIVE_PROJECT_TERMINAL_TAB,
        "New Embedded Terminal Here",
    )
    .build(app)?;
    let copy_path =
        MenuItemBuilder::with_id(MENU_COPY_ACTIVE_PROJECT_PATH, "Copy POSIX Path").build(app)?;
    let copy_link =
        MenuItemBuilder::with_id(STATUS_COPY_ACTIVE_PROJECT_LINK, "Copy Xolotl Link").build(app)?;
    let copy_shell = MenuItemBuilder::with_id(
        STATUS_COPY_ACTIVE_PROJECT_SHELL_OPEN,
        "Copy Shell Open Command",
    )
    .build(app)?;
    let copy_context =
        MenuItemBuilder::with_id(MENU_COPY_ACTIVE_PROJECT_CONTEXT, "Copy Context Prompt")
            .build(app)?;
    let copy_shortcuts_json = MenuItemBuilder::with_id(
        MENU_COPY_ACTIVE_PROJECT_SHORTCUTS_JSON,
        "Copy Shortcuts JSON",
    )
    .build(app)?;

    SubmenuBuilder::new(app, "Active Project")
        .item(&reveal)
        .item(&editor)
        .item(&terminal)
        .item(&embedded_terminal)
        .separator()
        .item(&copy_path)
        .item(&copy_link)
        .item(&copy_shell)
        .item(&copy_context)
        .item(&copy_shortcuts_json)
        .build()
}

fn build_latest_agent_worktree_menu(app: &tauri::AppHandle) -> tauri::Result<Submenu<tauri::Wry>> {
    let reveal = MenuItemBuilder::with_id(
        MENU_REVEAL_LATEST_AGENT_WORKTREE,
        "Reveal Worktree in Finder",
    )
    .build(app)?;
    let editor = MenuItemBuilder::with_id(MENU_OPEN_LATEST_AGENT_WORKTREE_EDITOR, "Open in Editor")
        .build(app)?;
    let terminal = MenuItemBuilder::with_id(
        MENU_OPEN_LATEST_AGENT_WORKTREE_TERMINAL,
        "Open in External Terminal",
    )
    .build(app)?;
    let embedded_terminal = MenuItemBuilder::with_id(
        MENU_NEW_LATEST_AGENT_WORKTREE_TERMINAL_TAB,
        "New Embedded Terminal Here",
    )
    .build(app)?;
    let copy_path =
        MenuItemBuilder::with_id(MENU_COPY_LATEST_AGENT_WORKTREE_PATH, "Copy POSIX Path")
            .build(app)?;
    let copy_link =
        MenuItemBuilder::with_id(MENU_COPY_LATEST_AGENT_WORKTREE_LINK, "Copy Xolotl Link")
            .build(app)?;
    let copy_shell = MenuItemBuilder::with_id(
        MENU_COPY_LATEST_AGENT_WORKTREE_SHELL_OPEN,
        "Copy Shell Open Command",
    )
    .build(app)?;
    let copy_context = MenuItemBuilder::with_id(
        MENU_COPY_LATEST_AGENT_WORKTREE_CONTEXT,
        "Copy Context Prompt",
    )
    .build(app)?;
    let copy_shortcuts_json = MenuItemBuilder::with_id(
        MENU_COPY_LATEST_AGENT_WORKTREE_SHORTCUTS_JSON,
        "Copy Shortcuts JSON",
    )
    .build(app)?;

    SubmenuBuilder::new(app, "Latest Agent Worktree")
        .item(&reveal)
        .item(&editor)
        .item(&terminal)
        .item(&embedded_terminal)
        .separator()
        .item(&copy_path)
        .item(&copy_link)
        .item(&copy_shell)
        .item(&copy_context)
        .item(&copy_shortcuts_json)
        .build()
}

fn file_project_container(file: &Path) -> Option<PathBuf> {
    let fallback = file.parent()?.to_path_buf();
    for dir in fallback.ancestors() {
        if dir.join(".git").exists()
            || dir.join("package.json").is_file()
            || dir.join("Cargo.toml").is_file()
            || dir.join("pyproject.toml").is_file()
            || dir.join("go.mod").is_file()
        {
            return Some(dir.to_path_buf());
        }
    }
    Some(fallback)
}

fn canonical_project_path_from_input_path(raw: PathBuf) -> Option<String> {
    let target = if raw.is_dir() {
        raw
    } else if raw.is_file() {
        file_project_container(&raw)?
    } else {
        return None;
    };
    let canonical = std::fs::canonicalize(&target).unwrap_or(target);
    Some(canonical.to_string_lossy().into_owned())
}

fn canonical_project_path_from_arg(arg: OsString) -> Option<String> {
    canonical_project_path_from_input_path(PathBuf::from(arg))
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
    if url.scheme() == "file" {
        let path = url.to_file_path().ok()?;
        return canonical_project_path_from_input_path(path);
    }
    if url.scheme() == APP_URL_SCHEME {
        let host = url.host_str()?;
        if host != "open" && host != "project" {
            return None;
        }
        let path = url
            .query_pairs()
            .find_map(|(key, value)| (key == "path").then_some(value.into_owned()))?;
        return canonical_project_path_from_input_path(PathBuf::from(path));
    }
    None
}

fn project_paths_from_open_urls(urls: Vec<tauri::Url>) -> Vec<String> {
    dedupe_project_paths(urls.iter().filter_map(project_path_from_open_url))
}

fn cleanup_owned_processes(app: &tauri::AppHandle) {
    crate::commands::cleanup_eval_processes();
    if let Some(manager) = app.try_state::<TerminalManager>() {
        manager.kill_all();
    }
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

fn mac_status_item_title(state: &MacStatusItemState) -> String {
    let active_work_items = state
        .running_agents
        .saturating_add(state.waiting_agents)
        .saturating_add(state.running_eval_models)
        .saturating_add(state.pending_eval_models);
    if active_work_items == 0 {
        "Xolotl".into()
    } else {
        format!("Xolotl {active_work_items}")
    }
}

fn mac_status_project_label(state: &MacStatusItemState) -> String {
    if let Some(name) = state
        .active_project_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
    {
        return format!("Project: {name}");
    }
    if let Some(path) = state
        .active_project_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        return format!("Project: {}", mac_path_label(path));
    }
    "Project: No project".into()
}

fn mac_status_agents_label(state: &MacStatusItemState) -> String {
    let counted_agents = state
        .running_agents
        .saturating_add(state.waiting_agents)
        .saturating_add(state.completed_agents)
        .saturating_add(state.failed_agents);
    let idle_agents = state.total_agents.saturating_sub(counted_agents);
    let mut parts = Vec::new();

    if state.running_agents > 0 {
        parts.push(format!("{} running", state.running_agents));
    }
    if state.waiting_agents > 0 {
        parts.push(format!("{} waiting", state.waiting_agents));
    }
    if state.failed_agents > 0 {
        parts.push(format!("{} failed", state.failed_agents));
    }
    if state.completed_agents > 0 {
        parts.push(format!("{} done", state.completed_agents));
    }
    if idle_agents > 0 {
        parts.push(format!("{idle_agents} idle"));
    }

    if parts.is_empty() {
        "Agents: Idle".into()
    } else {
        format!("Agents: {}", parts.join(", "))
    }
}

fn mac_status_eval_label(state: &MacStatusItemState) -> String {
    if state.total_eval_models == 0 {
        return "Eval: Idle".into();
    }

    let finished = state
        .completed_eval_models
        .saturating_add(state.failed_eval_models);
    if state.active_eval_complete || finished >= state.total_eval_models {
        if state.failed_eval_models == 0 {
            return format!(
                "Eval: Complete ({}/{})",
                state.completed_eval_models, state.total_eval_models
            );
        }
        return format!(
            "Eval: Complete ({} done, {} failed)",
            state.completed_eval_models, state.failed_eval_models
        );
    }

    let mut parts = Vec::new();
    if state.running_eval_models > 0 {
        parts.push(format!("{} running", state.running_eval_models));
    }
    if state.pending_eval_models > 0 {
        parts.push(format!("{} pending", state.pending_eval_models));
    }
    if finished > 0 {
        parts.push(format!("{finished}/{} finished", state.total_eval_models));
    }

    if parts.is_empty() {
        "Eval: Ready".into()
    } else {
        format!("Eval: {}", parts.join(", "))
    }
}

fn mac_status_item_tooltip(state: &MacStatusItemState) -> String {
    format!(
        "Xolotl Code - {} - {} - {}",
        mac_status_project_label(state),
        mac_status_agents_label(state),
        mac_status_eval_label(state)
    )
}

fn mac_status_item_has_active_project(state: &MacStatusItemState) -> bool {
    state
        .active_project_path
        .as_deref()
        .map(str::trim)
        .is_some_and(|path| !path.is_empty())
}

fn mac_status_item_has_agents(state: &MacStatusItemState) -> bool {
    state.total_agents > 0
        || state.running_agents > 0
        || state.waiting_agents > 0
        || state.completed_agents > 0
        || state.failed_agents > 0
}

fn mac_status_item_has_eval(state: &MacStatusItemState) -> bool {
    state.total_eval_models > 0
        || state.running_eval_models > 0
        || state.pending_eval_models > 0
        || state.completed_eval_models > 0
        || state.failed_eval_models > 0
}

fn build_mac_status_item_menu(
    app: &tauri::AppHandle,
    state: &MacStatusItemState,
) -> tauri::Result<Menu<tauri::Wry>> {
    let project = MenuItemBuilder::with_id(STATUS_PROJECT_ID, mac_status_project_label(state))
        .enabled(false)
        .build(app)?;
    let agents = MenuItemBuilder::with_id(STATUS_AGENTS_ID, mac_status_agents_label(state))
        .enabled(false)
        .build(app)?;
    let eval = MenuItemBuilder::with_id(STATUS_EVAL_ID, mac_status_eval_label(state))
        .enabled(false)
        .build(app)?;
    let open_latest_agent =
        MenuItemBuilder::with_id(STATUS_OPEN_LATEST_AGENT, "Open Latest Agent Output")
            .build(app)?;
    let latest_agent_worktree = build_latest_agent_worktree_menu(app)?;
    let open_eval = MenuItemBuilder::with_id(MENU_TAB_EVAL, "Open Eval Workspace").build(app)?;
    let reveal_active_project = MenuItemBuilder::with_id(
        STATUS_REVEAL_ACTIVE_PROJECT,
        "Reveal Active Project in Finder",
    )
    .build(app)?;
    let open_active_project_editor = MenuItemBuilder::with_id(
        STATUS_OPEN_ACTIVE_PROJECT_EDITOR,
        "Open Active Project in Editor",
    )
    .build(app)?;
    let open_active_project_terminal = MenuItemBuilder::with_id(
        STATUS_OPEN_ACTIVE_PROJECT_TERMINAL,
        "Open Active Project in External Terminal",
    )
    .build(app)?;
    let new_active_project_terminal_tab = MenuItemBuilder::with_id(
        MENU_NEW_ACTIVE_PROJECT_TERMINAL_TAB,
        "New Embedded Terminal Here",
    )
    .build(app)?;
    let copy_active_project_path = MenuItemBuilder::with_id(
        MENU_COPY_ACTIVE_PROJECT_PATH,
        "Copy Active Project POSIX Path",
    )
    .build(app)?;
    let copy_active_project_link = MenuItemBuilder::with_id(
        STATUS_COPY_ACTIVE_PROJECT_LINK,
        "Copy Active Project Xolotl Link",
    )
    .build(app)?;
    let copy_active_project_shell_open = MenuItemBuilder::with_id(
        STATUS_COPY_ACTIVE_PROJECT_SHELL_OPEN,
        "Copy Shell Open Command",
    )
    .build(app)?;
    let copy_active_project_context = MenuItemBuilder::with_id(
        MENU_COPY_ACTIVE_PROJECT_CONTEXT,
        "Copy Active Project Context Prompt",
    )
    .build(app)?;
    let copy_active_project_shortcuts_json = MenuItemBuilder::with_id(
        MENU_COPY_ACTIVE_PROJECT_SHORTCUTS_JSON,
        "Copy Active Project Shortcuts JSON",
    )
    .build(app)?;
    let open = MenuItemBuilder::with_id(MENU_FOCUS_WINDOW, "Open Xolotl Code").build(app)?;
    let new_chat = MenuItemBuilder::with_id(MENU_NEW_CHAT, "New Chat").build(app)?;
    let open_folder = MenuItemBuilder::with_id(MENU_OPEN_FOLDER, "Open Folder...").build(app)?;
    let commands = MenuItemBuilder::with_id(MENU_COMMANDS, "Command Palette...").build(app)?;
    let toggle_terminal =
        MenuItemBuilder::with_id(MENU_TOGGLE_TERMINAL, "Toggle Terminal").build(app)?;
    let settings = MenuItemBuilder::with_id(MENU_SETTINGS, "Settings...").build(app)?;
    let quit = PredefinedMenuItem::quit(app, Some("Quit Xolotl Code"))?;

    let mut builder = MenuBuilder::new(app)
        .item(&project)
        .item(&agents)
        .item(&eval)
        .separator();

    if mac_status_item_has_agents(state) {
        builder = builder
            .item(&open_latest_agent)
            .item(&latest_agent_worktree);
    }
    if mac_status_item_has_eval(state) {
        builder = builder.item(&open_eval);
    }
    if mac_status_item_has_agents(state) || mac_status_item_has_eval(state) {
        builder = builder.separator();
    }

    if mac_status_item_has_active_project(state) {
        builder = builder
            .item(&reveal_active_project)
            .item(&open_active_project_editor)
            .item(&open_active_project_terminal)
            .item(&new_active_project_terminal_tab)
            .separator()
            .item(&copy_active_project_path)
            .item(&copy_active_project_link)
            .item(&copy_active_project_shell_open)
            .item(&copy_active_project_context)
            .item(&copy_active_project_shortcuts_json)
            .separator();
    }

    builder
        .item(&open)
        .item(&new_chat)
        .item(&open_folder)
        .separator()
        .item(&commands)
        .item(&toggle_terminal)
        .separator()
        .item(&settings)
        .separator()
        .item(&quit)
        .build()
}

fn mac_status_item_state(app: &tauri::AppHandle) -> MacStatusItemState {
    let Some(state) = app.try_state::<MacStatusItemStateStore>() else {
        return MacStatusItemState::default();
    };
    state
        .0
        .lock()
        .map(|state| state.clone())
        .unwrap_or_default()
}

pub(crate) fn update_mac_status_item(
    app: &tauri::AppHandle,
    state: &MacStatusItemState,
) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id(STATUS_ITEM_ID) else {
        return Ok(());
    };
    tray.set_title(Some(mac_status_item_title(state)))?;
    tray.set_tooltip(Some(mac_status_item_tooltip(state)))?;
    tray.set_menu(Some(build_mac_status_item_menu(app, state)?))
}

pub(crate) fn set_mac_status_item_enabled(
    app: &tauri::AppHandle,
    enabled: bool,
) -> tauri::Result<()> {
    if !enabled {
        let _ = app.remove_tray_by_id(STATUS_ITEM_ID);
        return Ok(());
    }

    let state = mac_status_item_state(app);
    if app.tray_by_id(STATUS_ITEM_ID).is_some() {
        return update_mac_status_item(app, &state);
    }

    let menu = build_mac_status_item_menu(app, &state)?;
    let mut builder = TrayIconBuilder::with_id(STATUS_ITEM_ID)
        .title(mac_status_item_title(&state))
        .tooltip(mac_status_item_tooltip(&state))
        .menu(&menu)
        .show_menu_on_left_click(true);

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon).icon_as_template(true);
    }

    builder.build(app)?;
    Ok(())
}

mod macos_commands {
    #[tauri::command]
    #[specta::specta]
    pub fn launch_project_paths(
        state: tauri::State<'_, super::PendingOpenProjects>,
    ) -> Vec<String> {
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

    #[tauri::command]
    #[specta::specta]
    pub fn update_mac_status_item(
        app_handle: tauri::AppHandle,
        state: super::MacStatusItemState,
        store: tauri::State<'_, super::MacStatusItemStateStore>,
    ) -> Result<(), String> {
        if let Ok(mut stored) = store.0.lock() {
            *stored = state.clone();
        }
        if super::commands::get_mac_productivity_settings()
            .status_item
            .enabled
        {
            super::set_mac_status_item_enabled(&app_handle, true).map_err(|err| err.to_string())?;
            super::update_mac_status_item(&app_handle, &state).map_err(|err| err.to_string())?;
        }
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
    let active_project = build_active_project_menu(app)?;
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
    let civ_tab = MenuItemBuilder::with_id(MENU_TAB_CIV, "Pond")
        .accelerator("CmdOrCtrl+Digit3")
        .build(app)?;
    let latest_agent_output =
        MenuItemBuilder::with_id(MENU_OPEN_LATEST_AGENT, "Latest Agent Output").build(app)?;
    let latest_agent_worktree = build_latest_agent_worktree_menu(app)?;

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
        .item(&active_project)
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
        .separator()
        .item(&latest_agent_output)
        .item(&latest_agent_worktree)
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
    } else if id == STATUS_REVEAL_ACTIVE_PROJECT {
        Some(STATUS_REVEAL_ACTIVE_PROJECT)
    } else if id == STATUS_OPEN_ACTIVE_PROJECT_EDITOR {
        Some(STATUS_OPEN_ACTIVE_PROJECT_EDITOR)
    } else if id == STATUS_OPEN_ACTIVE_PROJECT_TERMINAL {
        Some(STATUS_OPEN_ACTIVE_PROJECT_TERMINAL)
    } else if id == MENU_OPEN_LATEST_AGENT {
        Some(MENU_OPEN_LATEST_AGENT)
    } else if id == MENU_REVEAL_LATEST_AGENT_WORKTREE {
        Some(MENU_REVEAL_LATEST_AGENT_WORKTREE)
    } else if id == MENU_OPEN_LATEST_AGENT_WORKTREE_EDITOR {
        Some(MENU_OPEN_LATEST_AGENT_WORKTREE_EDITOR)
    } else if id == MENU_OPEN_LATEST_AGENT_WORKTREE_TERMINAL {
        Some(MENU_OPEN_LATEST_AGENT_WORKTREE_TERMINAL)
    } else if id == MENU_NEW_LATEST_AGENT_WORKTREE_TERMINAL_TAB {
        Some(MENU_NEW_LATEST_AGENT_WORKTREE_TERMINAL_TAB)
    } else if id == MENU_COPY_LATEST_AGENT_WORKTREE_PATH {
        Some(MENU_COPY_LATEST_AGENT_WORKTREE_PATH)
    } else if id == MENU_COPY_LATEST_AGENT_WORKTREE_LINK {
        Some(MENU_COPY_LATEST_AGENT_WORKTREE_LINK)
    } else if id == MENU_COPY_LATEST_AGENT_WORKTREE_SHELL_OPEN {
        Some(MENU_COPY_LATEST_AGENT_WORKTREE_SHELL_OPEN)
    } else if id == MENU_COPY_LATEST_AGENT_WORKTREE_CONTEXT {
        Some(MENU_COPY_LATEST_AGENT_WORKTREE_CONTEXT)
    } else if id == MENU_COPY_LATEST_AGENT_WORKTREE_SHORTCUTS_JSON {
        Some(MENU_COPY_LATEST_AGENT_WORKTREE_SHORTCUTS_JSON)
    } else if id == STATUS_OPEN_LATEST_AGENT {
        Some(STATUS_OPEN_LATEST_AGENT)
    } else if id == STATUS_COPY_ACTIVE_PROJECT_LINK {
        Some(STATUS_COPY_ACTIVE_PROJECT_LINK)
    } else if id == STATUS_COPY_ACTIVE_PROJECT_SHELL_OPEN {
        Some(STATUS_COPY_ACTIVE_PROJECT_SHELL_OPEN)
    } else if id == MENU_NEW_ACTIVE_PROJECT_TERMINAL_TAB {
        Some(MENU_NEW_ACTIVE_PROJECT_TERMINAL_TAB)
    } else if id == MENU_COPY_ACTIVE_PROJECT_PATH {
        Some(MENU_COPY_ACTIVE_PROJECT_PATH)
    } else if id == MENU_COPY_ACTIVE_PROJECT_CONTEXT {
        Some(MENU_COPY_ACTIVE_PROJECT_CONTEXT)
    } else if id == MENU_COPY_ACTIVE_PROJECT_SHORTCUTS_JSON {
        Some(MENU_COPY_ACTIVE_PROJECT_SHORTCUTS_JSON)
    } else {
        None
    }
}

#[cfg(feature = "dev-tools")]
pub fn export_bindings(path: &str) {
    make_builder()
        // u64 timestamps (created_at, duration_ms) exceed TS number precision in
        // theory; in practice these are unix-ms / millisecond durations that fit
        // comfortably under Number.MAX_SAFE_INTEGER for centuries.
        .dangerously_cast_bigints_to_number()
        .export(Typescript::default(), path)
        .expect("Failed to export TypeScript bindings");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = make_builder();

    #[cfg(all(debug_assertions, feature = "dev-tools"))]
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
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Arc::new(AgentSupervisor::new(repo_root)))
        .manage(PendingPrompts::default())
        .manage(TerminalManager::default())
        .manage(PendingOpenProjects::default())
        .manage(MacStatusItemStateStore::default())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                cleanup_owned_processes(window.app_handle());
            }
        })
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            let menu = build_native_menu(app.handle())?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                if event.id() == MENU_FOCUS_WINDOW {
                    focus_main_window(app);
                } else if let Some(action) = menu_action_for_id(event.id()) {
                    let _ = app.emit(MENU_EVENT, action);
                } else if let Some((action, path)) = recent_project_action_from_menu_id(event.id())
                {
                    let _ = app.emit(
                        RECENT_PROJECT_MENU_EVENT,
                        serde_json::json!({ "action": action, "path": path }),
                    );
                } else if let Some(path) = recent_project_path_from_menu_id(event.id()) {
                    let _ = app.emit(PROJECT_OPEN_EVENT, path);
                }
            });
            if crate::commands::get_mac_productivity_settings()
                .status_item
                .enabled
            {
                set_mac_status_item_enabled(app.handle(), true)?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                cleanup_owned_processes(app);
            }
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
            tauri::RunEvent::Opened { urls } => {
                let paths = project_paths_from_open_urls(urls);
                emit_project_open_paths(app, paths);
                focus_main_window(app);
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } => {
                let _ = app.emit(
                    APP_REOPEN_EVENT,
                    serde_json::json!({ "has_visible_windows": has_visible_windows }),
                );
                focus_main_window(app);
            }
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(feature = "dev-tools")]
    use std::path::Path;

    #[cfg(feature = "dev-tools")]
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
    fn recent_project_action_menu_id_round_trips_action_and_path() {
        let path = "/Users/cesar/Projects/Xolotl Code/mañana";
        let menu_id = tauri::menu::MenuId::new(recent_project_action_menu_id(
            RECENT_PROJECT_ACTION_COPY_SHORTCUTS_JSON,
            path,
        ));

        assert_eq!(
            recent_project_action_from_menu_id(&menu_id),
            Some((
                RECENT_PROJECT_ACTION_COPY_SHORTCUTS_JSON.to_string(),
                path.to_string()
            ))
        );
        assert_eq!(menu_action_for_id(&menu_id), None);
    }

    #[test]
    fn recent_project_action_menu_id_rejects_unknown_actions() {
        let menu_id = tauri::menu::MenuId::new(format!(
            "{MENU_RECENT_PROJECT_ACTION_PREFIX}delete:{}",
            hex_encode(b"/Users/cesar/Projects/Xolotl")
        ));

        assert_eq!(recent_project_action_from_menu_id(&menu_id), None);
    }

    #[test]
    fn mac_status_item_formats_idle_and_active_state() {
        let idle = MacStatusItemState::default();
        assert_eq!(mac_status_item_title(&idle), "Xolotl");
        assert_eq!(mac_status_project_label(&idle), "Project: No project");
        assert_eq!(mac_status_agents_label(&idle), "Agents: Idle");
        assert_eq!(mac_status_eval_label(&idle), "Eval: Idle");
        assert!(!mac_status_item_has_active_project(&idle));
        assert!(!mac_status_item_has_agents(&idle));
        assert!(!mac_status_item_has_eval(&idle));

        let active = MacStatusItemState {
            active_project_name: Some("Xolotl Code".into()),
            active_project_path: Some("/Users/cesar/Documents/Xolotl".into()),
            running_agents: 2,
            waiting_agents: 1,
            completed_agents: 1,
            failed_agents: 0,
            total_agents: 4,
            running_eval_models: 1,
            pending_eval_models: 1,
            completed_eval_models: 2,
            failed_eval_models: 0,
            total_eval_models: 4,
            active_eval_complete: false,
        };
        assert_eq!(mac_status_item_title(&active), "Xolotl 5");
        assert_eq!(mac_status_project_label(&active), "Project: Xolotl Code");
        assert_eq!(
            mac_status_agents_label(&active),
            "Agents: 2 running, 1 waiting, 1 done"
        );
        assert_eq!(
            mac_status_eval_label(&active),
            "Eval: 1 running, 1 pending, 2/4 finished"
        );
        assert!(mac_status_item_has_active_project(&active));
        assert!(mac_status_item_has_agents(&active));
        assert!(mac_status_item_has_eval(&active));
    }

    #[test]
    fn mac_status_agents_label_preserves_completed_and_failed_agent_state() {
        let completed = MacStatusItemState {
            completed_agents: 2,
            failed_agents: 1,
            total_agents: 4,
            ..Default::default()
        };

        assert_eq!(
            mac_status_agents_label(&completed),
            "Agents: 1 failed, 2 done, 1 idle"
        );
    }

    #[test]
    fn mac_status_eval_label_formats_completed_failures() {
        let completed = MacStatusItemState {
            completed_eval_models: 2,
            failed_eval_models: 1,
            total_eval_models: 3,
            active_eval_complete: true,
            ..Default::default()
        };

        assert_eq!(
            mac_status_eval_label(&completed),
            "Eval: Complete (2 done, 1 failed)"
        );
        assert_eq!(mac_status_item_title(&completed), "Xolotl");
        assert!(mac_status_item_has_eval(&completed));
    }

    #[test]
    fn status_item_project_menu_ids_route_through_native_actions() {
        assert_eq!(
            menu_action_for_id(&tauri::menu::MenuId::new(STATUS_REVEAL_ACTIVE_PROJECT)),
            Some(STATUS_REVEAL_ACTIVE_PROJECT)
        );
        assert_eq!(
            menu_action_for_id(&tauri::menu::MenuId::new(STATUS_OPEN_ACTIVE_PROJECT_EDITOR)),
            Some(STATUS_OPEN_ACTIVE_PROJECT_EDITOR)
        );
        assert_eq!(
            menu_action_for_id(&tauri::menu::MenuId::new(
                STATUS_OPEN_ACTIVE_PROJECT_TERMINAL
            )),
            Some(STATUS_OPEN_ACTIVE_PROJECT_TERMINAL)
        );
        assert_eq!(
            menu_action_for_id(&tauri::menu::MenuId::new(STATUS_OPEN_LATEST_AGENT)),
            Some(STATUS_OPEN_LATEST_AGENT)
        );
        assert_eq!(
            menu_action_for_id(&tauri::menu::MenuId::new(MENU_OPEN_LATEST_AGENT)),
            Some(MENU_OPEN_LATEST_AGENT)
        );
        assert_eq!(
            menu_action_for_id(&tauri::menu::MenuId::new(MENU_REVEAL_LATEST_AGENT_WORKTREE)),
            Some(MENU_REVEAL_LATEST_AGENT_WORKTREE)
        );
        assert_eq!(
            menu_action_for_id(&tauri::menu::MenuId::new(
                MENU_OPEN_LATEST_AGENT_WORKTREE_EDITOR
            )),
            Some(MENU_OPEN_LATEST_AGENT_WORKTREE_EDITOR)
        );
        assert_eq!(
            menu_action_for_id(&tauri::menu::MenuId::new(
                MENU_OPEN_LATEST_AGENT_WORKTREE_TERMINAL
            )),
            Some(MENU_OPEN_LATEST_AGENT_WORKTREE_TERMINAL)
        );
        assert_eq!(
            menu_action_for_id(&tauri::menu::MenuId::new(
                MENU_NEW_LATEST_AGENT_WORKTREE_TERMINAL_TAB
            )),
            Some(MENU_NEW_LATEST_AGENT_WORKTREE_TERMINAL_TAB)
        );
        assert_eq!(
            menu_action_for_id(&tauri::menu::MenuId::new(
                MENU_COPY_LATEST_AGENT_WORKTREE_PATH
            )),
            Some(MENU_COPY_LATEST_AGENT_WORKTREE_PATH)
        );
        assert_eq!(
            menu_action_for_id(&tauri::menu::MenuId::new(
                MENU_COPY_LATEST_AGENT_WORKTREE_LINK
            )),
            Some(MENU_COPY_LATEST_AGENT_WORKTREE_LINK)
        );
        assert_eq!(
            menu_action_for_id(&tauri::menu::MenuId::new(
                MENU_COPY_LATEST_AGENT_WORKTREE_SHELL_OPEN
            )),
            Some(MENU_COPY_LATEST_AGENT_WORKTREE_SHELL_OPEN)
        );
        assert_eq!(
            menu_action_for_id(&tauri::menu::MenuId::new(
                MENU_COPY_LATEST_AGENT_WORKTREE_CONTEXT
            )),
            Some(MENU_COPY_LATEST_AGENT_WORKTREE_CONTEXT)
        );
        assert_eq!(
            menu_action_for_id(&tauri::menu::MenuId::new(
                MENU_COPY_LATEST_AGENT_WORKTREE_SHORTCUTS_JSON
            )),
            Some(MENU_COPY_LATEST_AGENT_WORKTREE_SHORTCUTS_JSON)
        );
        assert_eq!(
            menu_action_for_id(&tauri::menu::MenuId::new(MENU_TAB_EVAL)),
            Some(MENU_TAB_EVAL)
        );
        assert_eq!(
            menu_action_for_id(&tauri::menu::MenuId::new(STATUS_COPY_ACTIVE_PROJECT_LINK)),
            Some(STATUS_COPY_ACTIVE_PROJECT_LINK)
        );
        assert_eq!(
            menu_action_for_id(&tauri::menu::MenuId::new(
                STATUS_COPY_ACTIVE_PROJECT_SHELL_OPEN
            )),
            Some(STATUS_COPY_ACTIVE_PROJECT_SHELL_OPEN)
        );
        assert_eq!(
            menu_action_for_id(&tauri::menu::MenuId::new(
                MENU_NEW_ACTIVE_PROJECT_TERMINAL_TAB
            )),
            Some(MENU_NEW_ACTIVE_PROJECT_TERMINAL_TAB)
        );
        assert_eq!(
            menu_action_for_id(&tauri::menu::MenuId::new(MENU_COPY_ACTIVE_PROJECT_PATH)),
            Some(MENU_COPY_ACTIVE_PROJECT_PATH)
        );
        assert_eq!(
            menu_action_for_id(&tauri::menu::MenuId::new(MENU_COPY_ACTIVE_PROJECT_CONTEXT)),
            Some(MENU_COPY_ACTIVE_PROJECT_CONTEXT)
        );
        assert_eq!(
            menu_action_for_id(&tauri::menu::MenuId::new(
                MENU_COPY_ACTIVE_PROJECT_SHORTCUTS_JSON
            )),
            Some(MENU_COPY_ACTIVE_PROJECT_SHORTCUTS_JSON)
        );
    }

    #[test]
    fn launch_project_paths_keep_existing_directories_once() {
        let root = std::env::temp_dir().join(format!("xolotl-launch-paths-{}", std::process::id()));
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
    fn launch_project_paths_accept_files_by_parent_directory() {
        let root =
            std::env::temp_dir().join(format!("xolotl-launch-file-path-{}", std::process::id()));
        let project = root.join("Project From File Arg");
        let file = project.join("README.md");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&project).expect("project test dir should be created");
        std::fs::write(&file, "# Project").expect("project file should be written");

        let paths = launch_project_paths_from_args(vec![
            OsString::from("xolotl-code"),
            file.into_os_string(),
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
        let root = std::env::temp_dir().join(format!("xolotl-open-url-{}", std::process::id()));
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
    fn project_paths_from_open_urls_accepts_file_urls_by_project_root() {
        let root =
            std::env::temp_dir().join(format!("xolotl-open-file-url-{}", std::process::id()));
        let project = root.join("Project From Source File");
        let file = project.join("src").join("main.ts");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(project.join(".git")).expect("project marker should be created");
        std::fs::create_dir_all(file.parent().expect("file should have parent"))
            .expect("project test dir should be created");
        std::fs::write(&file, "console.log('xolotl');").expect("project file should be written");

        let file_url = tauri::Url::from_file_path(&file).expect("file url should be created");
        let paths = project_paths_from_open_urls(vec![file_url]);

        let expected = std::fs::canonicalize(&project)
            .expect("project root should canonicalize")
            .to_string_lossy()
            .into_owned();
        assert_eq!(paths, vec![expected]);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn project_paths_from_open_urls_accepts_xolotl_code_url_scheme() {
        let root =
            std::env::temp_dir().join(format!("xolotl-open-link-url-{}", std::process::id()));
        let project = root.join("Project From Shortcut");
        let file = project.join("src").join("main.ts");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(project.join(".git")).expect("project marker should be created");
        std::fs::create_dir_all(file.parent().expect("file should have parent"))
            .expect("project test dir should be created");
        std::fs::write(&file, "console.log('xolotl');").expect("project file should be written");

        let url = tauri::Url::parse_with_params(
            "xolotl-code://open",
            &[("path", file.to_string_lossy().as_ref())],
        )
        .expect("xolotl-code url should parse");
        let paths = project_paths_from_open_urls(vec![url]);

        let expected = std::fs::canonicalize(&project)
            .expect("project root should canonicalize")
            .to_string_lossy()
            .into_owned();
        assert_eq!(paths, vec![expected]);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn project_paths_from_open_urls_rejects_non_file_urls_and_missing_paths() {
        let root =
            std::env::temp_dir().join(format!("xolotl-open-url-reject-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("project test dir should be created");
        let missing = root.join("missing");

        let urls = vec![
            tauri::Url::parse("https://example.com/project").expect("https url should parse"),
            tauri::Url::parse("xolotl-code://unknown?path=/tmp/project")
                .expect("unknown xolotl url should parse"),
            tauri::Url::parse("xolotl-code://open").expect("missing path xolotl url should parse"),
            tauri::Url::from_file_path(&missing).expect("missing file url should be created"),
        ];

        assert!(project_paths_from_open_urls(urls).is_empty());

        let _ = std::fs::remove_dir_all(&root);
    }
}
