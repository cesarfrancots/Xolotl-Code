use specta_typescript::Typescript;
use tauri_specta::{collect_commands, Builder};

use runtime::{AgentEvent, AgentId, AgentState};

mod commands;
pub use crate::commands::smoke_test;

fn make_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![smoke_test])
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

    tauri::Builder::default()
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
