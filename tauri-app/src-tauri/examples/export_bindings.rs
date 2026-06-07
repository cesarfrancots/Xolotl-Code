//! Regenerate `tauri-app/src/bindings.ts` without launching the desktop app.
//!
//! The `dev-tools` feature enables the TypeScript exporter without launching
//! the app. This is the headless way to refresh bindings after changing the IPC
//! surface, and it avoids starting a WebView.
//!
//! Run from `tauri-app/src-tauri`:
//!   cargo run --features dev-tools --example export_bindings

fn main() {
    xolotl_lib::export_bindings("../src/bindings.ts");
    println!("bindings exported to ../src/bindings.ts");
}
