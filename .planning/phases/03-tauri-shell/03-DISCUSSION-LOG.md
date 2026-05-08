# Phase 3: Tauri Shell - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-08
**Phase:** 3-Tauri Shell
**Areas discussed:** Windows toolchain, Tauri project layout, AgentEvent streaming, Permission prompt round-trip

---

## Windows Toolchain

| Option | Description | Selected |
|--------|-------------|----------|
| Switch to MSVC everywhere | Install VS Build Tools, switch override in `rust/`. Cleaner path, Tauri officially supports MSVC. | |
| Keep GNU, fix issues as hit | Stay on WinLibs. Tauri can build on GNU but may hit WebView2 linker quirks. | |
| Dual setup: MSVC for Tauri, GNU for rest | Two toolchain overrides in different directories. ABI risk if sharing crates. | ✓ (initial) |
| Either is fine — use MSVC everywhere | No objection to MSVC Build Tools. One toolchain, one workspace. | ✓ (revised) |

**User's choice:** Initially selected dual setup, then clarified: MSVC everywhere is fine. No objection to installing Build Tools.

**Follow-up questions:**
- Q: Is dual-toolchain a hard constraint or avoiding MSVC install? → A: Either is fine, use MSVC everywhere.
- Q: Is VS Build Tools installed already? → A: Not installed — include setup in the plan.

**Notes:** The dual-toolchain interest was likely about keeping things working without disruption, not a hard requirement for GNU.

---

## Tauri Project Layout

| Option | Description | Selected |
|--------|-------------|----------|
| New top-level `tauri-app/` | Standalone dir: `tauri-app/src-tauri/` + `tauri-app/src/`. Path dep to `../rust/crates/runtime`. | ✓ |
| Extend existing `rust/` workspace | Add `src-tauri` as workspace member in `rust/Cargo.toml`. | |
| New root workspace wrapping everything | Root `Cargo.toml` with all crates as members. Requires restructuring. | |

**User's choice:** New top-level `tauri-app/` directory.

| Option | Description | Selected |
|--------|-------------|----------|
| Separate binary, built manually | `rusty-claude-cli` stays in `rust/`. App finds it on PATH. | ✓ |
| Bundle in Tauri build via beforeEach hook | `beforeDevCommand` builds CLI first. Convenient but adds complexity. | |
| Tauri sidecar | Bundle CLI as Tauri resource. Clean for distribution, overkill for dev use. | |

**User's choice:** Separate binary, built manually.

| Option | Description | Selected |
|--------|-------------|----------|
| Vite + npm | Official `create-tauri-app` scaffold. Simple, well-supported. | ✓ |
| Vite + pnpm | Faster installs, stricter deps. | |
| Vite + bun | Fastest installs, minor Tauri CLI compatibility risk. | |

**User's choice:** Vite + npm.

---

## AgentEvent Streaming

| Option | Description | Selected |
|--------|-------------|----------|
| Tauri `emit()` push per event | Rust task subscribes to broadcast, calls `app_handle.emit()`. True real-time push. | ✓ |
| Frontend polls via `invoke()` | Frontend calls `get_pending_events()` on interval. Simple Rust side but latency. | |
| Tauri streaming channel | Tauri 2.x `Channel<AgentEvent>`. More structured, less examples. | |

**User's choice:** Tauri `emit()` push per event.

| Option | Description | Selected |
|--------|-------------|----------|
| Per-agent channel `"agent-event:{id}"` | Frontend subscribes per-agent. Scales cleanly to multiple agents. | ✓ |
| Single global `"agent-events"` channel | Frontend filters by agentId. Simpler to wire, every view gets every event. | |

**User's choice:** Per-agent channel.

---

## Permission Prompt Round-Trip

| Option | Description | Selected |
|--------|-------------|----------|
| tokio oneshot channel | Emit request with unique ID, block on `oneshot_rx.blocking_recv()`. `respond_to_permission` command resolves sender. | ✓ |
| std::sync::mpsc with pending-prompts registry | Same idea with std channels. More manual lifecycle. | |
| HTTP endpoint inside Tauri | Prompter makes HTTP call to local server. Overkill, not idiomatic. | |

**User's choice:** tokio oneshot channel.

| Option | Description | Selected |
|--------|-------------|----------|
| Timeout auto-deny after 60s | Configurable timeout. Safe default. Emit `permission-timeout` on expiry. | ✓ |
| Block indefinitely | No timeout. Risk of deadlock if window is closed. | |
| Timeout auto-allow | On timeout, assume allow. Risky for coding agent. | |

**User's choice:** 60s timeout, auto-deny.

| Option | Description | Selected |
|--------|-------------|----------|
| Same 3 choices: Allow / Deny / Always Allow | Matches CLI behavior. AlwaysAllow updates PermissionPolicy for session. | ✓ |
| Just Allow / Deny for now | Simpler. AlwaysAllow deferred to Phase 4. | |

**User's choice:** All 3 choices — matches CLI [y]/[n]/[a] behavior.

---

## Claude's Discretion

- Tauri capability manifest scope (researcher follows Tauri 2.x format, scope to actual smoke-test needs)
- Window initial size and title (reasonable defaults)
- IPC error handling (standard `Result<T, String>`, frontend logs to console)

## Deferred Ideas

None — discussion stayed within phase scope.
