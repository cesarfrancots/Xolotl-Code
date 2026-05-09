# Phase 3: Tauri Shell - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Stand up the Tauri 2.x desktop app with typed IPC wiring to the existing Rust orchestrator
(`AgentSupervisor`, `WorktreeManager`, `SharedContextStore`), generate TypeScript types via
`specta` + `tauri-specta`, wire real-time `AgentEvent` streaming to the frontend, implement
`TauriPermissionPrompter` for the permission round-trip, and smoke-test the Tauri plugin bundle
(`window-state`, `clipboard-manager`, `fs`). No real UI beyond what is needed to verify IPC.

</domain>

<decisions>
## Implementation Decisions

### Windows Toolchain
- **D-01:** Switch the entire project to `stable-x86_64-pc-windows-msvc`. Remove the WinLibs/GNU
  override from `rust/.cargo/config.toml`. The `ring` crate (Bedrock SigV4) compiles on MSVC.
- **D-02:** ~~Visual Studio Build Tools are NOT yet installed.~~ **UPDATED 2026-05-08:** VS Build
  Tools 2026 (version 18.4) is already installed at `C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools`
  with the C++ workload, `link.exe`, and `cl.exe` present. The first plan step is: update
  `stable-x86_64-pc-windows-msvc` to 1.95.0, remove the GNU override from `rust/.cargo/config.toml`,
  verify `cargo test` green. No winget install step needed.
- **D-03:** Single toolchain for both the existing Rust workspace and the new Tauri crate. No
  dual-toolchain split.

### Project Layout
- **D-04:** Tauri app lives at `tauri-app/` (a new top-level directory). Structure:
  `tauri-app/src-tauri/` (Rust backend crate) + `tauri-app/src/` (React frontend).
  `src-tauri` is its own Cargo workspace (NOT a member of `rust/`), with `runtime` added as a
  path dependency: `{ path = "../rust/crates/runtime" }`.
- **D-05:** `rusty-claude-cli` binary remains a separate build in the existing `rust/` workspace.
  The Tauri app finds it on PATH (or a configured path). No build coupling between the two
  workspaces. Sub-agent behavior from Phases 1–2 is unchanged.
- **D-06:** Frontend tooling: Vite + React + TypeScript + npm. Use `create-tauri-app` scaffold
  for the initial project structure.

### AgentEvent Streaming
- **D-07:** Use Tauri's `app_handle.emit(channel, payload)` for server→client push. A dedicated
  Rust async task subscribes to each `AgentHandle`'s broadcast channel and re-emits events.
- **D-08:** Per-agent event channels: emit on `"agent-event:{agent_id}"` (e.g.,
  `"agent-event:agent-0"`). Frontend subscribes with `listen("agent-event:agent-0", handler)`.
  No global fan-out channel.
- **D-09:** `AgentEvent` must implement `serde::Serialize` (already done in Phase 2) and `specta::Type`
  so `tauri-specta` can generate the TypeScript union.

### Permission Prompt Round-Trip
- **D-10:** `TauriPermissionPrompter` implements the `PermissionPrompter` trait using a
  `tokio::sync::oneshot` channel per prompt. Flow:
  1. Generate a unique `prompt_id` (UUID).
  2. Store `oneshot_tx` in a shared `pending_prompts: Arc<Mutex<HashMap<String, oneshot::Sender<PermissionDecision>>>>`.
  3. Call `app_handle.emit("permission-request", PermissionRequest { prompt_id, tool_name, preview })`.
  4. Call `oneshot_rx.blocking_recv()` (runs inside `spawn_blocking`, so safe to block).
  5. Frontend calls `#[tauri::command] respond_to_permission(prompt_id, decision)` which looks
     up the sender and resolves it.
- **D-11:** Timeout: 60 seconds. On timeout, return `PermissionDecision::Deny` and emit a
  `"permission-timeout"` event so the frontend can display feedback.
- **D-12:** Three decision values: `Allow`, `Deny`, `AlwaysAllow`. **Phase 3 scope (UPDATED
  2026-05-08):** `AlwaysAllow` returns `Allow` for the current call only and emits a
  `"policy-update-requested"` event to the frontend. Full in-session `PermissionPolicy` mutation
  (matching CLI `[a]` behavior) is deferred to Phase 4 when the full agent loop is wired into
  Tauri managed state. This is the authorized Phase 3 scope — not a gap.

### Type Generation
- **D-13:** `specta` + `tauri-specta` version: use `tauri-specta` 2.x (the Tauri 2.x-compatible
  release). Generated types output to `tauri-app/src/bindings.ts`. Committed to the repo.
  Build step regenerates on change. Frontend imports from `./bindings` — no hand-written types.
- **D-14:** Types to export: `AgentId`, `AgentState`, `AgentEvent`, `PermissionDecision`,
  `PermissionRequestPayload` (the IPC wire type — see note), and all `#[tauri::command]`
  signatures. **UPDATED 2026-05-08:** `AgentControl` excluded — the frontend never constructs it
  directly; lifecycle commands (`spawn_agent`, `stop_agent`) abstract over it. `PermissionRequest`
  (runtime type) replaced by `PermissionRequestPayload` (Tauri-layer struct with `prompt_id`,
  `tool_name`, `preview`) as the IPC-emitted form — the runtime type is internal only.

### Claude's Discretion
- Tauri capability manifest (`capabilities/*.json`) — researcher should follow Tauri 2.x
  capability format; scope permissions to what Phase 3 smoke-tests actually need.
- Window initial size and title — reasonable defaults; no user preference stated.
- Error handling for IPC command failures — standard Tauri `Result<T, String>` return, frontend
  logs errors to console for now.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Foundation
- `.planning/ROADMAP.md` — Phase 3 success criteria (TAU-01 through TAU-05), dependency on Phase 2
- `.planning/PROJECT.md` — Core value, constraints (Windows primary, personal use, Rust-extend-only)
- `.planning/REQUIREMENTS.md` — Full requirement definitions (if exists)

### Existing Rust Backend (integrate, don't rewrite)
- `rust/crates/runtime/src/supervisor/mod.rs` — `AgentSupervisor` public API; this becomes Tauri managed state
- `rust/crates/runtime/src/supervisor/agent_state.rs` — `AgentId`, `AgentState`, `AgentEvent`, `AgentControl` types
- `rust/crates/runtime/src/supervisor/handle.rs` — `AgentHandle` broadcast channel (source for D-07 event streaming)
- `rust/crates/runtime/src/permissions.rs` — `PermissionPrompter` trait + `PermissionPolicy`; `TauriPermissionPrompter` implements this
- `rust/crates/runtime/src/supervisor/supervisor.rs` — `AgentSupervisor` registry methods (`spawn_agent`, `list`, `stop_agent`, `stop_all`)

### Build Config
- `rust/.cargo/config.toml` — Current GNU toolchain overrides; MUST be updated as part of D-01/D-02
- `rust/Cargo.toml` — Workspace definition; `src-tauri/` is a SEPARATE workspace (D-04), not added here

### Prior Phase Summaries
- `.planning/phases/01-cli-completion/01-04-SUMMARY.md` — Phase 1 completion status
- `.planning/phases/02-orchestration-layer/02-06-SUMMARY.md` — Phase 2 completion status (151 tests green)

No external spec docs referenced during discussion.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `AgentSupervisor` (`supervisor/supervisor.rs`): `Send + Sync` (Phase 2 invariant enforced), ready to be
  held as `tauri::State<Arc<AgentSupervisor>>` managed state.
- `AgentHandle::subscribe()` (`supervisor/handle.rs`): returns `broadcast::Receiver<AgentEvent>` — the
  source for the Tauri emit loop (D-07).
- `PermissionPrompter` trait (`permissions.rs`): `prompt(tool_name, preview) -> PermissionDecision` — all
  `TauriPermissionPrompter` has to do is implement this trait with the oneshot pattern (D-10).

### Established Patterns
- `run_turn()` inside `tokio::task::spawn_blocking` — this is the day-one invariant from Phase 2 (ORC-03).
  Any Tauri command that drives a conversation turn must call `spawn_blocking`. Do NOT call `run_turn()`
  from an async Tauri command directly.
- `Arc<Mutex<T>>` for write-heavy shared state (WorktreeManager); `Arc<RwLock<T>>` for read-heavy
  (SharedContextStore). Same pattern applies to the `pending_prompts` map in D-10: use `Arc<Mutex<HashMap>>`.
- Error types: `thiserror`-derived enums at crate boundaries. Tauri commands return `Result<T, String>`
  for IPC (serialize the error message).

### Integration Points
- `tauri-app/src-tauri/` → `runtime` path dep for `AgentSupervisor`, `PermissionPrompter`, all supervisor types
- `TauriPermissionPrompter` lives in `tauri-app/src-tauri/src/` (not in `runtime`) to avoid pulling
  `tauri` as a dep into the `runtime` crate
- `tauri-specta` codegen runs at build time; output goes to `tauri-app/src/bindings.ts`

</code_context>

<specifics>
## Specific Ideas

No specific UI mock-ups or design references provided — this phase is wiring only.
The smoke-test commands (TAU-05) just need to return a value from each plugin; no UI treatment required.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 3-Tauri Shell*
*Context gathered: 2026-05-08*
