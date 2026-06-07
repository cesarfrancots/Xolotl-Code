//! Regenerate `tauri-app/src/bindings.ts` without launching the desktop app.
//!
//! `tauri dev` regenerates the bindings at startup, but on Windows the test
//! harness can't load WebView2 (see CLAUDE.md gotcha #5), so this standalone
//! binary is the headless way to refresh bindings after changing the IPC
//! surface. It only runs the `tauri-specta` exporter — no window, no WebView2.
//!
//! Run from `tauri-app/src-tauri`:
//!   cargo run --features dev-tools --example export_bindings

fn main() {
    xolotl_lib::export_bindings("../src/bindings.ts");
    println!("bindings exported to ../src/bindings.ts");
}
