# State: xolotl

**Initialized:** 2026-05-07
**Mode:** yolo
**Granularity:** standard

---

## Project Reference

- **Core Value:** A developer can spawn, monitor, and coordinate multiple AI agents working in parallel on a single project — from a chat-first desktop app — without being locked into OpenAI or Anthropic.
- **Current Focus:** Phase 5 Agent Dashboard — not started.

## Current Position

- **Milestone:** v1
- **Phase:** 5 — Agent Dashboard
- **Plan:** Not started
- **Status:** Phase 4 complete — ready for Phase 5
- **Progress:** Phase 3 of 6 complete

```
[x][x][x][ ][ ][ ]
 1  2  3  4  5  6
```

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases completed | 4 / 6 |
| v1 requirements mapped | 40 / 40 |
| v1 requirements completed | 18 / 40 |
| Plans completed | 21 |
| Active blockers | 0 |

## Accumulated Context

### Key Decisions

- Rust core is not rewritten — extend only.
- Tauri 2.x chosen for desktop shell (not Electron); leverages existing Rust backend directly.
- Orchestrator runs in-process; worker sub-agents continue to use child-process `SubAgentSpawner`.
- `ConversationRuntime::run_turn()` must always run inside `tokio::task::spawn_blocking` (day-one architectural invariant).
- Frontend stack: React 19 + TypeScript + Zustand + Tailwind 4 + shadcn/Radix + `@tanstack/react-virtual`.
- Type pipeline: `specta` + `tauri-specta` to generate TypeScript from Rust IPC types.
- SharedContextStore uses `Arc<RwLock<HashMap>>` (vs Mutex) for read-heavy concurrent workload.
- GitOpQueue uses `spawn_blocking` inside `tokio::spawn` to avoid blocking tokio worker threads on `std::process::Command`.
- `thiserror` added to runtime `[dependencies]` (was workspace-only); resolves compile blocker for ContextError derive.
- WorktreeManager uses Arc<Mutex<HashMap>> (not RwLock) — write-heavy add/remove vs SharedContextStore's read-heavy pull workload.
- MSVC toolchain required for Tauri on Windows (GNU toolchain incompatible); resolved in Phase 3.
- `std::sync::mpsc` (not tokio::oneshot) for TauriPermissionPrompter — enables recv_timeout(60s) without async complexity.
- AlwaysAllow emits policy-update-requested and returns Allow — Phase 3 authorized scope; full session persistence deferred to Phase 4.
- `bindings.ts` is committed to repo (D-13); partially hand-updated due to WebView2 DLL issue preventing binary execution.
- `fs:default` (not `fs:allow-*`) for Phase 3 — path scoping deferred to Phase 4 when UI file ops are defined.

### Open Todos

- CR-01 (medium priority): permission_prompter.rs — use `.lock().map_err()` instead of `.unwrap()` to avoid process crash on poisoned mutex.
- CR-02 (medium priority): respond_to_permission — use `HashMap::remove` not `.get()` to prevent double-resolve race.
- CR-03 (low priority): lib.rs — validate git rev-parse repo root is ancestor of cwd.
- CR-04 (low priority for Phase 3, revisit in Phase 4): capabilities/default.json — add path scope to `fs:default`.

### Blockers

- None.

### Open Questions (carried from research)

1. Tailwind 4 stable release status (Phase 4 decision).
2. Orchestrator prompt design for worker models (Phase 5).

## Session Continuity

- **Last action:** Phase 4 complete — all 7 plans executed, 2 gaps fixed (session hydration + cost bar), verified and closed.
- **Next action:** `/gsd-discuss-phase 5` or `/gsd-plan-phase 5` — Agent Dashboard.
- **Resume file:** `.planning/phases/04-chat-ui/04-07-SUMMARY.md`
- **Last updated:** 2026-05-10

---
*State initialized: 2026-05-07*
