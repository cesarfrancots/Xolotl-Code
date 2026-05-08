# State: xolotl

**Initialized:** 2026-05-07
**Mode:** yolo
**Granularity:** standard

---

## Project Reference

- **Core Value:** A developer can spawn, monitor, and coordinate multiple AI agents working in parallel on a single project — from a chat-first desktop app — without being locked into OpenAI or Anthropic.
- **Current Focus:** Rust orchestration layer complete — AgentSupervisor, WorktreeManager, SharedContextStore, GitOpQueue, and NDJSON spawner all verified headlessly. Next: Tauri 2.x desktop shell with typed IPC.

## Current Position

- **Milestone:** v1
- **Phase:** 3 — Tauri Shell
- **Plan:** — (Phase 2 complete; Phase 3 not yet planned)
- **Status:** Phase 2 complete; all 6 plans executed and verified
- **Progress:** Phase 2 of 6 complete; Phase 3 not yet planned

```
[x][x][ ][ ][ ][ ]
 1  2  3  4  5  6
```

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases completed | 2 / 6 |
| v1 requirements mapped | 40 / 40 |
| v1 requirements completed | 13 / 40 |
| Plans completed | 10 |
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

### Open Todos

- None — initial roadmap just defined; first action is to plan Phase 1.

### Blockers

- None at initialization. Note: Windows build fix (WinLibs + `rustup override set stable-x86_64-pc-windows-gnu`) must be in place locally before Phase 1 work; Tauri/GNU compatibility revisited at Phase 3.

### Open Questions (carried from research)

1. GNU toolchain + Tauri 2.x compatibility on Windows (Phase 3 blocker).
2. Kimi K2 / MiniMax M1 tool-call schema edge cases against real endpoints (Phase 1 deliverable).
3. `specta` + `tauri-specta` maintenance status and Tauri 2.1.x compatibility (Phase 3 decision).
4. Tailwind 4 stable release status (Phase 4 decision).
5. `SubAgentResult` structured contract (Phase 2 deliverable).
6. Orchestrator prompt design for worker models (Phase 5).

## Session Continuity

- **Last action:** Phase 3 context gathered — 4 areas discussed (toolchain, project layout, event streaming, permission round-trip). CR-01–CR-04 fixes applied (151 tests still green).
- **Next action:** /gsd-plan-phase 3 to plan the Tauri Shell phase.
- **Last updated:** 2026-05-08

---
*State initialized: 2026-05-07*
