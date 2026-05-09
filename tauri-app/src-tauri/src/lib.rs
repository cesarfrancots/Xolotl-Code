use std::sync::Arc;
use specta_typescript::Typescript;
use tauri_specta::{collect_commands, Builder};

use runtime::{AgentEvent, AgentId, AgentState, AgentSupervisor};
use crate::commands::{list_agents, smoke_test, spawn_agent, stop_agent};

mod commands;

fn make_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            smoke_test,
            spawn_agent,
            list_agents,
            stop_agent,
        ])
        .typ::<AgentId>()
        .typ::<AgentState>()
        .typ::<AgentEvent>()
    // PermissionRequestPayload added in Plan 03-04 (D-14).
    // AgentControl excluded per D-14 — lifecycle commands abstract over it.
}

/// Export TypeScript bindings to tauri-app/src/bindings.ts.
/// Called from run() in debug builds and from tests to generate the file.
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

    // repo_root for AgentSupervisor: detect git root so WorktreeManager::add()
    // can run `git worktree add` successfully. Falls back to cwd if git is unavailable.
    let repo_root = std::process::Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| std::path::PathBuf::from(s.trim()))
        .unwrap_or_else(|| std::env::current_dir().expect("cwd must be accessible"));

    tauri::Builder::default()
        .manage(Arc::new(AgentSupervisor::new(repo_root)))
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
        // Write bindings.ts relative to this file's location at compile time.
        // CARGO_MANIFEST_DIR is the tauri-app/src-tauri directory.
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let out = format!("{manifest_dir}/../src/bindings.ts");
        export_bindings(&out);
        assert!(
            Path::new(&out).exists(),
            "bindings.ts should have been generated at {out}"
        );
    }
}
