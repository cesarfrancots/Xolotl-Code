# Phase 3: Tauri Shell - Research

**Researched:** 2026-05-08
**Domain:** Tauri 2.x desktop shell, specta/tauri-specta type generation, Tauri IPC, Windows MSVC toolchain
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Windows Toolchain**
- D-01: Switch the entire project to `stable-x86_64-pc-windows-msvc`. Remove the WinLibs/GNU override from `rust/.cargo/config.toml`.
- D-02: Visual Studio Build Tools 2026 (version 18.4) ARE installed at `C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools`. The first plan step must update stable-msvc to 1.95.0 (`rustup update stable-x86_64-pc-windows-msvc`) and verify `cargo build` succeeds.
- D-03: Single toolchain for both the existing Rust workspace and the new Tauri crate.

**Project Layout**
- D-04: Tauri app at `tauri-app/` (top-level). `tauri-app/src-tauri/` is its own Cargo workspace (NOT a member of `rust/`), with `runtime` as a path dep: `{ path = "../rust/crates/runtime" }`.
- D-05: `rusty-claude-cli` binary remains in `rust/` workspace. No build coupling.
- D-06: Vite + React + TypeScript + npm frontend via `create-tauri-app` scaffold.

**AgentEvent Streaming**
- D-07: Use `app_handle.emit(channel, payload)` for server→client push. Dedicated async task per AgentHandle broadcast channel.
- D-08: Per-agent channels: `"agent-event:{agent_id}"`. Frontend subscribes with `listen()`.
- D-09: `AgentEvent` must implement `serde::Serialize` (done) and `specta::Type`.

**Permission Prompt Round-Trip**
- D-10: `TauriPermissionPrompter` uses `tokio::sync::oneshot` per prompt. Flow: UUID → store oneshot_tx in `Arc<Mutex<HashMap<String, oneshot::Sender<PermissionDecision>>>>` → emit `"permission-request"` → `oneshot_rx.blocking_recv()` inside `spawn_blocking`.
- D-11: Timeout: 60 seconds. On timeout, return `PermissionDecision::Deny` + emit `"permission-timeout"`.
- D-12: Three decisions: `Allow`, `Deny`, `AlwaysAllow`.

**Type Generation**
- D-13: `tauri-specta` 2.x. Generated types to `tauri-app/src/bindings.ts`. Committed to repo.
- D-14: Types to export: `AgentId`, `AgentState`, `AgentEvent`, `PermissionRequestPayload`, `PermissionDecision`, and all `#[tauri::command]` signatures. (`AgentControl` excluded — lifecycle commands abstract over it; `PermissionRequest` replaced by `PermissionRequestPayload` for the Tauri event layer.)

### Claude's Discretion
- Tauri capability manifest format and permission scoping
- Window initial size and title
- Error handling for IPC command failures (use `Result<T, String>`)

### Deferred Ideas (OUT OF SCOPE)
- None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TAU-01 | `src-tauri` scaffolded with Tauri 2.x capability config; `core:default` grant established; `invoke()` verified working | Section 2: Scaffold + tauri.conf.json + capability format |
| TAU-02 | `AgentSupervisor` held as Tauri managed state; command layer exposes agent lifecycle to frontend | Section 4: managed state + IPC command patterns |
| TAU-03 | `TauriPermissionPrompter` replaces REPL stdin; permission requests surface as UI events | Section 5: oneshot + spawn_blocking pattern |
| TAU-04 | `specta` + `tauri-specta` type generation pipeline produces TypeScript from Rust types | Section 3: tauri-specta v2 setup pattern |
| TAU-05 | Plugins installed and capability-granted: `window-state`, `clipboard-manager`, `fs` | Section 6: plugin Cargo deps + init + capabilities |
</phase_requirements>

---

## Executive Summary

Phase 3 builds the Tauri 2.x desktop shell that connects the existing Rust orchestrator to a React frontend via typed IPC. Research uncovered several important real-world deviations from the assumptions captured in the CONTEXT.md discussion:

**MSVC toolchain status:** D-02 says "VS Build Tools NOT yet installed," but VS Build Tools 2026 (version 18.4, released April 2026) IS installed at `C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools` with the C++ workload, `link.exe`, and `cl.exe` all present. The `stable-x86_64-pc-windows-msvc` toolchain is already the system default. The only action needed is removing the GNU override from `rust/.cargo/config.toml` (D-01) — no winget install step required. The MSVC toolchain also needs `rustup update` since the installed stable-msvc channel is 1.93.1 and 1.95.0 is available.

**tauri-specta API (v2):** The v2 API is structurally different from v1. Commands use `#[specta::specta]` + `#[tauri::command]` together. The builder is `Builder::<tauri::Wry>::new().commands(collect_commands![...]).events(collect_events![...])`. Bindings export via `builder.export(Typescript::default(), "../src/bindings.ts")` — only in `#[cfg(debug_assertions)]`. The builder's `invoke_handler()` replaces `tauri::generate_handler![]`.

**ring crate on MSVC:** ring 0.17 from crates.io includes precompiled object files for Windows x86_64 MSVC. No NASM or separate assembler is required. VS Build Tools provides the linker. This confirms D-01 is safe.

**WebView2:** Already installed (version 147.0.3912.98) — no extra step needed for Tauri's web rendering engine.

**Primary recommendation:** Begin with D-01 toolchain migration (update stable-msvc channel, remove GNU override from rust/.cargo/config.toml, verify `cargo test` green in rust/). Then scaffold tauri-app/, wire AgentSupervisor as managed state, implement tauri-specta, implement event streaming, implement TauriPermissionPrompter, and add plugins.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Agent lifecycle commands (spawn/list/stop) | API / Backend (Rust) | Frontend (invoke) | Business logic lives in AgentSupervisor; frontend calls via tauri::command |
| AgentEvent streaming | API / Backend (Rust) | Browser / Client (listen) | Rust emits from tokio task; frontend subscribes with listen() |
| Permission prompt round-trip | API / Backend (Rust) | Browser / Client (listen + invoke) | Blocking on Rust side via oneshot; frontend renders UI and calls respond_to_permission |
| TypeScript type generation | API / Backend (build-time) | — | tauri-specta runs at build time in Rust; output is static .ts file |
| Plugin smoke tests | Browser / Client | — | Invoked from frontend JS via @tauri-apps/plugin-* |
| Window state persistence | API / Backend (plugin) | Browser / Client (init call) | tauri-plugin-window-state runs in Rust; frontend triggers save/restore |

---

## Critical Findings

### 1. Windows MSVC Toolchain Switch (D-01 / D-02)

**Current state (verified):**
- System default toolchain: `stable-x86_64-pc-windows-msvc` [VERIFIED: `rustup show`]
- Installed stable-msvc version: `1.93.1` (Dec 2025) — out of date [VERIFIED: `rustup check`]
- Latest stable available: `1.95.0` — needs `rustup update stable-x86_64-pc-windows-msvc` [VERIFIED: `rustup check`]
- VS Build Tools 2026 installed at `C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools` [VERIFIED: vswhere]
- `cl.exe` and `link.exe` present at `VC/Tools/MSVC/14.50.35717/bin/Hostx64/x64/` [VERIFIED: node fs check]
- WebView2 runtime installed at version `147.0.3912.98` [VERIFIED: file system]
- Git's `link.exe` (`C:\Program Files\Git\usr\bin\link.exe`) is on PATH but Rust's MSVC toolchain uses vswhere-detected linker — not PATH — so no conflict [VERIFIED: `where link.exe`, Rust toolchain behavior]

**D-02 correction:** VS Build Tools are already installed. The plan step "install VS Build Tools" should be replaced with "update stable-msvc to 1.95.0 and verify."

**What to change in `rust/.cargo/config.toml`:** [VERIFIED: file read]

Current file sets GNU target with WinLibs paths. After D-01, remove the `[target.x86_64-pc-windows-gnu]` linker block and the `[env]` CC/AR block entirely. The `[build] target-dir` line should stay (it sets the build output directory). The toolchain switch itself is via `rustup override unset` inside `rust/` (which removes the directory override to `stable-x86_64-pc-windows-gnu`), letting the system default MSVC toolchain apply.

**Exact commands for D-01:**
```powershell
# Step 1: Update stable-msvc to latest
rustup update stable-x86_64-pc-windows-msvc

# Step 2: Remove directory override (inside rust/ directory)
rustup override unset   # run from rust/ directory

# Step 3: Verify the correct toolchain is active
rustup show active-toolchain   # should show stable-x86_64-pc-windows-msvc
```

**ring crate on MSVC:** ring 0.17 from crates.io ships precompiled assembly object files for Windows x86_64. MSVC linker (link.exe from VS Build Tools) is sufficient. No NASM needed. [CITED: https://raw.githubusercontent.com/briansmith/ring/main/BUILDING.md] Confidence: HIGH.

---

### 2. Tauri 2.x Project Scaffold (D-04 / D-06)

**Current package versions (verified from npm registry and crates.io):**
- `@tauri-apps/cli`: `2.11.1` [VERIFIED: npm view]
- `@tauri-apps/api`: `2.11.0` [VERIFIED: npm view]
- `tauri` crate: `2.11.1` [VERIFIED: cargo search]
- `tauri-build` crate: `2.6.1` [VERIFIED: cargo search]
- `create-tauri-app`: `4.6.2` [VERIFIED: npm view]

**Scaffold command (for D-04/D-06):**
```powershell
npm create tauri-app@latest tauri-app -- --template react-ts --manager npm --identifier com.xolotl.app --yes
```

This produces `tauri-app/` with:
- `tauri-app/src/` — React + TypeScript + Vite frontend
- `tauri-app/src-tauri/` — Rust backend crate with its own Cargo.toml and Cargo.lock

**`tauri-app/src-tauri/Cargo.toml` structure (D-04 path dep):**

```toml
[package]
name = "xolotl"
version = "0.1.0"
edition = "2021"

[lib]
name = "xolotl_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2.6", features = [] }

[dependencies]
tauri = { version = "2.11", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
uuid = { version = "1.6", features = ["v4"] }
# Runtime path dependency (D-04)
runtime = { path = "../../rust/crates/runtime" }
# specta + tauri-specta (D-13)
specta = { version = "=2.0.0-rc.25", features = [] }
specta-typescript = "0.0.12"
tauri-specta = { version = "=2.0.0-rc.25", features = ["derive", "typescript"] }

[features]
custom-protocol = ["tauri/custom-protocol"]
default = ["custom-protocol"]
```

Note: specta is rc — pin the exact version with `=` to avoid surprise updates.

**`tauri.conf.json` key fields for Tauri 2.x:** [VERIFIED: Context7/tauri-docs]

```json
{
  "$schema": "../node_modules/@tauri-apps/cli/config.schema.json",
  "productName": "xolotl",
  "version": "0.1.0",
  "identifier": "com.xolotl.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "devUrl": "http://localhost:5173",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "xolotl",
        "width": 1200,
        "height": 800,
        "resizable": true
      }
    ]
  },
  "bundle": {
    "active": false
  }
}
```

**Capabilities file** (`src-tauri/capabilities/default.json`): [VERIFIED: Context7/tauri-docs]

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability for xolotl",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "window-state:default",
    "clipboard-manager:allow-read-text",
    "clipboard-manager:allow-write-text",
    "fs:default"
  ]
}
```

**Separate workspace clarification:** `tauri-app/src-tauri/` is its own Cargo workspace (has its own Cargo.toml with `[workspace]` or is a standalone crate). The `rust/` workspace's `members = ["crates/*"]` glob does NOT pick it up because it lives outside `rust/`. No changes to `rust/Cargo.toml` are needed for D-04. [VERIFIED: Context7/tauri-docs workspace docs, CONTEXT.md D-04]

---

### 3. specta + tauri-specta (D-13 / D-14)

**Verified crate versions:**
- `tauri-specta = "2.0.0-rc.25"` [VERIFIED: cargo search]
- `specta = "2.0.0-rc.25"` [VERIFIED: cargo search]
- `specta-typescript = "0.0.12"` [VERIFIED: cargo search]

**v2 API is completely different from v1.** Key facts verified from the official example at `specta-rs/tauri-specta/examples/app/src-tauri/src/main.rs`: [VERIFIED: GitHub API + base64 decode]

**On Rust types (D-09 / D-14):** Add `specta::Type` derive alongside existing serde derives:

```rust
// In runtime crate — add specta::Type to existing types
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub enum AgentState { ... }

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub enum AgentEvent { ... }

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
pub struct AgentId(pub String);
```

**Important:** `AgentControl` currently does NOT derive `Serialize`/`Deserialize`. If it needs to be exported (D-14), it must get those derives too, or be excluded. Check actual need — it's a control message sent TO agents, not emitted FROM agents. Consider whether it actually needs TypeScript export.

**On commands (D-13 / D-14):** Use both `#[tauri::command]` AND `#[specta::specta]`:

```rust
#[tauri::command]
#[specta::specta]
async fn spawn_agent(
    supervisor: tauri::State<'_, Arc<AgentSupervisor>>,
    branch: String,
) -> Result<String, String> { ... }
```

**In `lib.rs` / `main.rs` — the builder pattern:**

```rust
use tauri_specta::{Builder, collect_commands, collect_events};
use specta_typescript::Typescript;

fn main() {
    let builder = Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            spawn_agent,
            list_agents,
            stop_agent,
            respond_to_permission,
            smoke_test_invoke,
        ])
        .events(collect_events![
            AgentEventWrapper,   // newtype wrapper to avoid name collision
            PermissionRequest,
        ])
        .typ::<AgentId>()
        .typ::<AgentState>()
        .typ::<AgentEvent>()
        .typ::<PermissionDecision>();

    // Only regenerate in debug builds
    #[cfg(debug_assertions)]
    builder
        .export(Typescript::default(), "../src/bindings.ts")
        .expect("Failed to export TypeScript bindings");

    tauri::Builder::default()
        .manage(Arc::new(AgentSupervisor::new(...)))
        .manage(PendingPrompts::default())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Frontend usage of generated bindings:**

```typescript
// tauri-app/src/bindings.ts is auto-generated — do not edit
import { commands, events } from './bindings';

// Call a command
const agentId = await commands.spawnAgent("feature-branch");

// Listen to events
await events.agentEventWrapper.listen(({ payload }) => {
  console.log('AgentEvent:', payload);
});
```

**`tauri_specta::Event` derive** — for events emitted from Rust:

```rust
#[derive(Serialize, Deserialize, Debug, Clone, specta::Type, tauri_specta::Event)]
pub struct PermissionRequest {
    pub prompt_id: String,
    pub tool_name: String,
    pub preview: String,
}
```

The event name on the TypeScript side defaults to the struct name (snake_case). Use `#[tauri_specta(event_name = "permissionRequest")]` to rename.

---

### 4. AgentEvent Streaming (D-07 / D-08)

**Managed state pattern:** [VERIFIED: Context7/tauri-docs]

```rust
// In lib.rs setup closure
tauri::Builder::default()
    .manage(Arc::new(AgentSupervisor::new(repo_root)))
    ...
    .setup(|app| {
        // Spawn event relay task per existing agent (or on spawn command)
        Ok(())
    })
```

**Per-agent broadcast relay task pattern (D-07 / D-08):**

```rust
fn spawn_event_relay(app_handle: AppHandle, agent_id: AgentId, handle: AgentHandle) {
    let mut rx = handle.subscribe();  // broadcast::Receiver<AgentEvent>
    let channel = format!("agent-event:{}", agent_id);
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let _ = app_handle.emit(&channel, &event);
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    // Emit synthetic "events-lost" notification to frontend
                    let _ = app_handle.emit(&channel, serde_json::json!({
                        "type": "EventsLost", "count": n
                    }));
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}
```

**`app_handle.emit()` vs `emit_to()`:** [VERIFIED: Context7/tauri-docs]
- `emit(event, payload)` — sends to ALL windows (global broadcast)
- `emit_to("main", event, payload)` — sends only to the window labeled "main"
- For per-agent channels, `emit()` is sufficient since there's only one window in Phase 3

**Frontend listen pattern (D-08):**
```typescript
import { listen } from '@tauri-apps/api/event';

const unlisten = await listen<AgentEvent>(`agent-event:${agentId}`, (event) => {
  console.log('agent event:', event.payload);
});
// Call unlisten() to clean up
```

**Important:** The broadcast channel has capacity 64 (from Phase 2 code). If the frontend falls behind by >64 events, `RecvError::Lagged` is returned — the relay task must handle this case.

---

### 5. TauriPermissionPrompter (D-10 / D-11 / D-12)

**Trait signature (from codebase):** [VERIFIED: file read of permissions.rs]

```rust
pub trait PermissionPrompter {
    fn decide(&mut self, request: &PermissionRequest) -> PermissionPromptDecision;
}

pub enum PermissionPromptDecision {
    Allow,
    Deny { reason: String },
}
```

**D-12 requires three decisions (Allow, Deny, AlwaysAllow) but the current trait only has two.** `AlwaysAllow` is NOT in the existing `PermissionPromptDecision` enum. The plan must add `AlwaysAllow` to `PermissionPromptDecision` in the runtime crate (or create a Tauri-specific decision type). This is an extension to the runtime crate, within the "extend only" constraint.

**Proposed `PermissionDecision` enum for D-12 (new, in tauri-app/src-tauri):**

```rust
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub enum PermissionDecision {
    Allow,
    Deny,
    AlwaysAllow,
}
```

**`TauriPermissionPrompter` structure:**

```rust
// Lives in tauri-app/src-tauri/src/permission_prompter.rs
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

pub type PendingPrompts = Arc<Mutex<HashMap<String, oneshot::Sender<PermissionDecision>>>>;

pub struct TauriPermissionPrompter {
    app_handle: AppHandle,
    pending_prompts: PendingPrompts,
}

impl PermissionPrompter for TauriPermissionPrompter {
    fn decide(&mut self, request: &PermissionRequest) -> PermissionPromptDecision {
        let prompt_id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel::<PermissionDecision>();

        // Store sender
        self.pending_prompts.lock().unwrap().insert(prompt_id.clone(), tx);

        // Emit to frontend
        let _ = self.app_handle.emit("permission-request", PermissionRequestPayload {
            prompt_id: prompt_id.clone(),
            tool_name: request.tool_name.clone(),
            preview: request.input[..request.input.len().min(120)].to_string(),
        });

        // Block with timeout — MUST be called from within spawn_blocking context
        // ORC-03 invariant: run_turn() is always inside spawn_blocking, so decide()
        // is called from a blocking thread — blocking_recv() is safe here.
        let decision = match rx.blocking_recv() {
            Ok(d) => d,
            Err(_) => {
                // Timeout path: emit timeout event, deny
                let _ = self.app_handle.emit("permission-timeout", &prompt_id);
                PermissionDecision::Deny
            }
        };

        // Clean up
        self.pending_prompts.lock().unwrap().remove(&prompt_id);

        match decision {
            PermissionDecision::Allow | PermissionDecision::AlwaysAllow => {
                PermissionPromptDecision::Allow
            }
            PermissionDecision::Deny => PermissionPromptDecision::Deny {
                reason: "User denied".to_string(),
            },
        }
    }
}
```

**D-11 timeout implementation:** The `blocking_recv()` call above does NOT automatically timeout. For 60s timeout:

```rust
// Use tokio's timeout via spawn_blocking calling block_on — but this gets complicated.
// Simpler: run_blocking inside spawn_blocking can use std thread::sleep style — but that
// blocks the blocking thread indefinitely.
// Correct approach: wrap the recv in a separate tokio oneshot with a select! timeout.
// But decide() is synchronous. Resolution: the prompter itself is not async.
// Use a std::sync::mpsc::Receiver with recv_timeout:

// Instead of tokio::oneshot, use std::sync::mpsc::channel for the blocking path:
use std::sync::mpsc;
use std::time::Duration;

pub struct TauriPermissionPrompter {
    app_handle: AppHandle,
    pending_prompts: PendingPrompts, // Arc<Mutex<HashMap<String, mpsc::Sender<PermissionDecision>>>>
}

// In decide():
let (tx, rx) = mpsc::channel::<PermissionDecision>();
// ...store tx, emit event...
match rx.recv_timeout(Duration::from_secs(60)) {
    Ok(d) => d,
    Err(_) => {
        let _ = self.app_handle.emit("permission-timeout", &prompt_id);
        PermissionDecision::Deny
    }
}
```

**Correction from D-10:** Use `std::sync::mpsc::channel` (not `tokio::oneshot`) for the pending_prompts map to enable `recv_timeout()`. The `respond_to_permission` Tauri command sends to the std mpsc sender. Both are `Send`, so this works across thread boundaries.

**`respond_to_permission` Tauri command:**

```rust
#[tauri::command]
#[specta::specta]
fn respond_to_permission(
    pending_prompts: tauri::State<'_, PendingPrompts>,
    prompt_id: String,
    decision: PermissionDecision,
) -> Result<(), String> {
    let prompts = pending_prompts.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = prompts.get(&prompt_id) {
        tx.send(decision).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err(format!("prompt_id {} not found (may have timed out)", prompt_id))
    }
}
```

**`AlwaysAllow` handling:** When the Tauri command layer receives `AlwaysAllow`, the command that called the agent's `run_turn()` is responsible for mutating the `PermissionPolicy` for that agent. The `TauriPermissionPrompter` returns `Allow` to the runtime for the current call; the caller (the Tauri command that invoked the agent loop) updates the policy for future calls. This requires the agent's `PermissionPolicy` to be accessible and mutable from the Tauri command layer.

---

### 6. Plugin Installation (TAU-05)

**Verified crate versions from crates.io:** [VERIFIED: cargo search]
- `tauri-plugin-window-state = "2.4.1"`
- `tauri-plugin-clipboard-manager = "2.3.2"`
- `tauri-plugin-fs = "2.5.1"`

**Verified npm package versions:** [VERIFIED: npm view]
- `@tauri-apps/plugin-window-state = "2.4.1"`
- `@tauri-apps/plugin-clipboard-manager = "2.3.2"`
- `@tauri-apps/plugin-fs = "2.5.1"`

**Cargo.toml additions:**

```toml
tauri-plugin-window-state = "2"
tauri-plugin-clipboard-manager = "2"
tauri-plugin-fs = "2"
```

**Registration in `lib.rs`:** [VERIFIED: Context7/tauri-docs]

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_fs::init())
    // ...
```

**npm dependencies:**

```bash
npm install @tauri-apps/plugin-window-state @tauri-apps/plugin-clipboard-manager @tauri-apps/plugin-fs
```

**Capability grants in `capabilities/default.json`:** [VERIFIED: Context7/tauri-docs]

```json
{
  "permissions": [
    "core:default",
    "window-state:default",
    "clipboard-manager:allow-read-text",
    "clipboard-manager:allow-write-text",
    "fs:default"
  ]
}
```

**Smoke test commands from frontend (TAU-05):**

```typescript
// window-state: no direct JS API — automatic on window close/open
// clipboard-manager:
import { writeText, readText } from '@tauri-apps/plugin-clipboard-manager';
await writeText('smoke-test');
const text = await readText(); // should return 'smoke-test'

// fs:
import { readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
// Just verify the API is importable and invoke doesn't throw
```

---

## Validation Architecture

nyquist_validation is enabled (config.json). Phase 3 has no existing test files to rely on — all validation is integration/smoke-test style (Tauri app must actually launch).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Tauri's built-in dev mode + manual invoke() smoke tests in browser DevTools |
| Config file | None — manual verification via `npm run tauri dev` |
| Quick run command | `npm run tauri dev` (from `tauri-app/`) |
| Full suite command | `cargo test --workspace` (from `tauri-app/src-tauri/`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TAU-01 | Window launches; `invoke('smoke_test')` returns a value | smoke | `npm run tauri dev` — manual invoke in console | No — Wave 0 |
| TAU-02 | `spawn_agent`, `list_agents`, `stop_agent` commands reach AgentSupervisor | integration | `cargo test -p xolotl` — unit test commands with mock AppHandle | No — Wave 0 |
| TAU-03 | Permission request reaches frontend as typed event; response unblocks agent | integration | Manual test via DevTools + `respond_to_permission` invoke | No — Wave 0 |
| TAU-04 | `bindings.ts` exists and exports correct TypeScript types | build | `cargo build` (debug) generates file; `tsc --noEmit` in frontend | No — Wave 0 |
| TAU-05 | clipboard smoke: write + read round-trip; fs: readdir succeeds; window-state: no error on init | smoke | Manual from DevTools after `npm run tauri dev` | No — Wave 0 |

### Wave 0 Gaps

- `tauri-app/src-tauri/src/` — all source files (Wave 0 creates them via scaffold)
- `tauri-app/src/bindings.ts` — generated on first `cargo build --debug` run
- No unit test files exist yet for tauri commands; these can be added after scaffold

---

## Recommended Wave Structure

The dependency graph forces a strict ordering. Nothing can be parallelized across major structural boundaries.

```
Wave 0: Toolchain + Scaffold
  0-A: Update stable-msvc toolchain, remove GNU override from rust/.cargo/config.toml
  0-B: Verify rust/ workspace builds and all 151 tests pass with MSVC toolchain
  0-C: Scaffold tauri-app/ with create-tauri-app (React + TypeScript + Vite + npm)
  0-D: Add runtime path dep to tauri-app/src-tauri/Cargo.toml; verify `cargo build` in src-tauri/

Wave 1: specta derives on runtime types (D-09 / D-14)
  1-A: Add specta and specta-typescript to tauri-app/src-tauri/Cargo.toml
  1-B: Add `specta::Type` derive to AgentId, AgentState, AgentEvent in runtime crate
  1-C: Add `AlwaysAllow` to PermissionPromptDecision (or create PermissionDecision enum in tauri layer)
  1-D: Build tauri-app/src-tauri/ — verify specta derives compile

Wave 2: TAU-01 — Minimal Tauri app with invoke smoke test
  2-A: Write lib.rs with tauri-specta Builder, smoke_test command, core:default capability
  2-B: Run `npm run tauri dev` — verify window opens and invoke() returns value from Rust
  [TAU-01 DONE]

Wave 3: TAU-04 — Type generation pipeline
  3-A: Wire all D-14 types into Builder (.typ::<...>(), .events(...))
  3-B: Verify bindings.ts is generated in src/
  3-C: Run `tsc --noEmit` in tauri-app/ to confirm frontend compiles with generated types
  [TAU-04 DONE]

Wave 4: TAU-02 — AgentSupervisor managed state + lifecycle commands
  4-A: Add AgentSupervisor as managed state in lib.rs Builder
  4-B: Implement spawn_agent, list_agents, stop_agent Tauri commands (all #[specta::specta])
  4-C: Spawn event relay task inside the spawn_agent command (D-07 pattern)
  4-D: Smoke test all three commands from browser DevTools
  [TAU-02 DONE]

Wave 5: TAU-03 — TauriPermissionPrompter
  5-A: Implement PermissionDecision enum + PermissionRequestPayload struct
  5-B: Implement TauriPermissionPrompter (std::sync::mpsc + recv_timeout(60s))
  5-C: Implement respond_to_permission Tauri command
  5-D: Register PendingPrompts as managed state
  5-E: Smoke test: trigger a permission prompt from a test command, respond from DevTools
  [TAU-03 DONE]

Wave 6: TAU-05 — Plugins
  6-A: Add plugin Cargo deps and npm packages
  6-B: Register plugins in Builder chain
  6-C: Add capability grants to capabilities/default.json
  6-D: Smoke test each plugin from browser DevTools
  [TAU-05 DONE]
```

**Can Wave 3 and Wave 4 be merged?** Wave 3 (type generation) and Wave 4 (lifecycle commands) can proceed in order within a single plan step since type generation just requires the Builder to have the commands registered — adding commands and exporting types happen in the same lib.rs change.

---

## Risks and Mitigations

### Risk 1: VS Build Tools 2026 (version 18) not recognized by Rust 1.93/1.95 cc crate
**Likelihood:** MEDIUM — VS 2026 was released in 2026, Rust 1.93 is from Dec 2025. The cc crate uses vswhere and generally supports all installed VS versions, but version 18 (VS 2026) is newer than the toolchain.
**Impact:** HIGH — cargo build would fail with linker errors.
**Mitigation:** Run `cargo build` in the `rust/` directory with MSVC toolchain FIRST (Wave 0-B). If it fails, the workaround is to use the explicit linker path in `rust/.cargo/config.toml`:
```toml
[target.x86_64-pc-windows-msvc]
linker = "C:\\Program Files (x86)\\Microsoft Visual Studio\\18\\BuildTools\\VC\\Tools\\MSVC\\14.50.35717\\bin\\Hostx64\\x64\\link.exe"
```
**Detection:** Wave 0-B build failure with "error: linker `link.exe` not found" message.

### Risk 2: specta rc version API instability
**Likelihood:** LOW — rc.25 is the current published version and example code matches it.
**Impact:** MEDIUM — if an rc.26 is published during development with breaking changes.
**Mitigation:** Pin exact version with `=` in Cargo.toml (`specta = "=2.0.0-rc.25"`). [ASSUMED] — specta rc is still pre-stable and can have breaking changes between rc releases.

### Risk 3: AlwaysAllow session persistence complexity
**Likelihood:** HIGH — it WILL come up (D-12 requires it).
**Impact:** MEDIUM — AlwaysAllow must update the agent's PermissionPolicy for the session. But the agent's PermissionPolicy is owned by the conversation loop running inside spawn_blocking. Accessing it from the Tauri command layer requires either passing it through managed state or making it Arc<Mutex<PermissionPolicy>>.
**Mitigation:** Phase 3 can implement AlwaysAllow as returning Allow to the current call and emitting a "policy-update-requested" event to the frontend. The frontend logs it but no in-session persistence is implemented in Phase 3 (defer to Phase 4 when the full agent loop is wired). Document this as a known limitation.

### Risk 4: runtime crate becomes a dependency of tauri (pulling in tauri features transitively)
**Likelihood:** LOW — the CONTEXT.md explicitly places TauriPermissionPrompter in tauri-app/src-tauri/src/, not in the runtime crate. The runtime crate only gets `specta::Type` derives added to it.
**Impact:** HIGH if violated — would create circular or improper deps.
**Mitigation:** Enforce: nothing in rust/crates/runtime/ imports tauri. specta::Type is a pure derive macro with no runtime dep on tauri.

### Risk 5: `create-tauri-app` scaffold version drift
**Likelihood:** LOW — npm view confirms version 4.6.2 is current.
**Impact:** LOW — scaffold generates boilerplate; any drift is minor.
**Mitigation:** Use `npm create tauri-app@4.6.2` to pin the scaffold version.

---

## Standard Stack

### Core
| Library | Version | Purpose | Notes |
|---------|---------|---------|-------|
| tauri | 2.11.1 | Desktop app framework | [VERIFIED: cargo search] |
| tauri-build | 2.6.1 | Build-time codegen | [VERIFIED: cargo search] |
| @tauri-apps/cli | 2.11.1 | Dev + build CLI | [VERIFIED: npm view] |
| @tauri-apps/api | 2.11.0 | Frontend JS bindings | [VERIFIED: npm view] |
| tauri-specta | =2.0.0-rc.25 | TypeScript type gen | [VERIFIED: cargo search] Pin exact version. |
| specta | =2.0.0-rc.25 | Type reflection derive | [VERIFIED: cargo search] |
| specta-typescript | 0.0.12 | TS export backend | [VERIFIED: cargo search] |

### Plugins
| Library | Version | Purpose | Capability |
|---------|---------|---------|------------|
| tauri-plugin-window-state | 2.4.1 | Save/restore window size | window-state:default |
| tauri-plugin-clipboard-manager | 2.3.2 | Clipboard read/write | clipboard-manager:allow-read-text, allow-write-text |
| tauri-plugin-fs | 2.5.1 | File system access | fs:default |

### Frontend
| Library | Version | Purpose | Notes |
|---------|---------|---------|-------|
| React | (scaffold default) | UI rendering | Via create-tauri-app scaffold |
| Vite | (scaffold default) | Dev server + bundler | [VERIFIED: Context7/tauri-docs] |
| TypeScript | (scaffold default) | Type safety | Frontend imports from bindings.ts |

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TypeScript type sync | Manual bindings.ts | tauri-specta | Types drift; hand-rolled types break silently |
| Window size persistence | localStorage | tauri-plugin-window-state | Handles multi-monitor, DPI changes, OS-level |
| Clipboard access | navigator.clipboard API | tauri-plugin-clipboard-manager | Tauri security model blocks web clipboard without the plugin |
| File I/O from frontend | Raw invoke to custom Rust command | tauri-plugin-fs | Plugin handles path scoping, permissions, all FS ops |
| IPC serialization | Manual JSON encode/decode | serde + Tauri's built-in IPC | Tauri IPC uses serde under the hood automatically |
| Permission timeout | std::thread::sleep loop | std::sync::mpsc::recv_timeout | recv_timeout blocks the thread cleanly for exactly 60s |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | VS Build Tools 2026 (v18) is recognized by Rust 1.95 cc crate via vswhere | Risk 1 | cargo build fails; need explicit linker path workaround |
| A2 | specta rc.25 API is stable enough for the duration of this phase | Risk 2 | Breaking change in rc.26 requires version bump and possible API changes |
| A3 | `create-tauri-app` with `--template react-ts --manager npm` produces correct scaffold | Scaffold section | May need to adjust flags if CLI version changed interactive defaults |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| VS Build Tools (MSVC) | D-01/ring/linker | VERIFIED | VS 2026 18.4 | None — required |
| rustup stable-msvc | D-01 | VERIFIED (needs update) | 1.93.1 → update to 1.95.0 | None |
| WebView2 | Tauri on Windows | VERIFIED | 147.0.3912.98 | None — required |
| Node.js | Vite frontend | VERIFIED | 24.14.1 | None — required |
| npm | Package management | VERIFIED | 11.12.1 | None — required |
| winget | VS Install (D-02) | VERIFIED (not needed) | 1.28.240 | N/A — VS already installed |
| create-tauri-app | Scaffold | VERIFIED | 4.6.2 | Manual scaffold |

**Missing dependencies with no fallback:** None — all required dependencies are available.

---

## Open Questions (RESOLVED 2026-05-08)

1. **Does Rust 1.95 cc crate auto-detect VS Build Tools 2026 (version 18)?**
   - **RESOLVED:** Unknown until Wave 0-B build test runs. Risk 1 documents the explicit linker path workaround (`[target.x86_64-pc-windows-msvc] linker = "..."`) if auto-detection fails. Plan 03-01 includes this fallback.

2. **Should `AgentControl` derive `specta::Type` and be exported in D-14?**
   - **RESOLVED (user decision 2026-05-08):** AgentControl is EXCLUDED from TypeScript export. D-14 updated in CONTEXT.md. Rationale: lifecycle commands (spawn_agent, stop_agent) abstract over it; the frontend never constructs AgentControl directly.

3. **How does AlwaysAllow update the per-session PermissionPolicy in Phase 3?**
   - **RESOLVED (user decision 2026-05-08):** Phase 3 implements AlwaysAllow as Allow for the current call only, emits "policy-update-requested" event. Full PermissionPolicy mutation deferred to Phase 4. D-12 updated in CONTEXT.md to reflect this authorized scope split.

---

## Sources

### Primary (HIGH confidence)
- [VERIFIED: `rustup show`, `rustup check`, `rustup toolchain list`] — toolchain state
- [VERIFIED: vswhere JSON output] — VS Build Tools 2026 installation
- [VERIFIED: node fs check `C:/Program Files (x86)/Microsoft Visual Studio/18/BuildTools/VC/Tools/MSVC/14.50.35717/bin/Hostx64/x64/link.exe`] — MSVC linker present
- [VERIFIED: `cargo search tauri`, `cargo search specta`, `cargo search tauri-plugin-*`] — crate versions
- [VERIFIED: `npm view @tauri-apps/cli`, `npm view @tauri-apps/api`, `npm view @tauri-apps/plugin-*`] — npm package versions
- [VERIFIED: `npm view create-tauri-app version`] — scaffold version
- [VERIFIED: GitHub API `gh api repos/specta-rs/tauri-specta/contents/examples/app/src-tauri/src/main.rs`] — tauri-specta v2 API patterns
- [VERIFIED: Context7 `/tauri-apps/tauri-docs`] — managed state, emit patterns, capability format, plugin setup
- [CITED: https://raw.githubusercontent.com/briansmith/ring/main/BUILDING.md] — ring MSVC support and NASM requirement (crates.io build only, no NASM needed)
- [VERIFIED: file read `rust/crates/runtime/src/permissions.rs`] — PermissionPrompter trait signature
- [VERIFIED: file read `rust/crates/runtime/src/supervisor/agent_state.rs`] — AgentId, AgentState, AgentEvent, AgentControl types
- [VERIFIED: file read `rust/crates/runtime/src/supervisor/handle.rs`] — AgentHandle.subscribe() API
- [VERIFIED: file read `rust/.cargo/config.toml`] — current GNU toolchain override to remove
- [VERIFIED: node fs check WebView2 `C:/Program Files (x86)/Microsoft/EdgeWebView/Application/147.0.3912.98`] — WebView2 installed

### Secondary (MEDIUM confidence)
- [CITED: Context7/tauri-docs] — capability permission identifiers (window-state:default, clipboard-manager:allow-*, fs:default)

---

## Metadata

**Confidence breakdown:**
- Toolchain state: HIGH — directly verified via rustup and vswhere
- Standard stack versions: HIGH — verified against npm registry and crates.io
- tauri-specta v2 API: HIGH — verified against official example source code
- Capability format: HIGH — verified against Context7/tauri-docs
- ring MSVC support: HIGH — verified against BUILDING.md
- VS Build Tools 2026 cc crate compatibility: MEDIUM — vswhere found, but cc crate allowlist unknown (Wave 0-B resolves)
- AlwaysAllow persistence design: MEDIUM — design recommendation, not verified against a working implementation

**Research date:** 2026-05-08
**Valid until:** 2026-06-08 (30 days — stable APIs, but specta rc may change)
