---
phase: "02"
plan: "02-04"
subsystem: runtime/supervisor
tags: [rust, actor-model, tokio-channels, broadcast, mpsc, agent-handle, supervisor]
dependency_graph:
  requires:
    - phase: "02-01"
      provides: AgentId, AgentState, AgentEvent, AgentControl types
    - phase: "02-02"
      provides: SharedContextStore, ContextError, GitOpQueue
    - phase: "02-03"
      provides: WorktreeManager, WorktreeError
  provides:
    - AgentHandle with subscribe/stop/pause and dual-channel design
    - AgentSupervisor with spawn_agent/list/get_handle/stop_agent/stop_all
    - SupervisorError
    - Full supervisor/mod.rs re-exports and lib.rs pub use extension
  affects:
    - "02-05+ (Phase 3 Tauri uses AgentSupervisor as managed state)"
tech_stack:
  added: []
  patterns:
    - "Dual-channel design: mpsc for worker→supervisor events, broadcast for supervisor→subscribers fan-out"
    - "Arc<AtomicBool> pause flag — checked before each spawn_blocking at turn boundaries"
    - "Arc<Mutex<HashMap>> for registry — lock released before every .await (Pitfall 1 guard)"
    - "tokio::spawn re-broadcast loop: mpsc event_rx → broadcast_tx fan-out"
    - "event_tx stored as named pub field on AgentHandle — prevents premature channel close"
key_files:
  created:
    - rust/crates/runtime/src/supervisor/handle.rs
    - rust/crates/runtime/src/supervisor/supervisor.rs
  modified:
    - rust/crates/runtime/src/supervisor/mod.rs
    - rust/crates/runtime/src/lib.rs
decisions:
  - "event_tx stored as pub field on AgentHandle (not local _event_tx) — dropping it closes mpsc channel immediately"
  - "Re-broadcast loop spawned in spawn_agent() — silently discards events when no subscribers (Phase 3 not yet active)"
  - "Pitfall 1 applied in stop_agent(): clone handle under lock, drop lock, then await handle.stop()"
  - "spawn_agent() is sync (not async) — tokio::spawn is non-blocking; tests needing it require #[tokio::test]"
  - "SupervisorError wraps WorktreeError and ContextError via thiserror #[from]"
metrics:
  duration: "~15 minutes"
  completed: "2026-05-08"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 2
---

# Phase 2 Plan 04: AgentHandle and AgentSupervisor Summary

**One-liner:** AgentHandle with dual-channel event_tx/broadcast_tx design and AgentSupervisor with spawn/list/stop registry, 13 new tests passing (133 total), ORC-02 event bus verified end-to-end.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| T01 | Implement AgentHandle with dual-channel design | 7f6c36c | rust/crates/runtime/src/supervisor/handle.rs, mod.rs |
| T02 | Implement AgentSupervisor + wire mod.rs + lib.rs | 34bba1a | rust/crates/runtime/src/supervisor/supervisor.rs, mod.rs, lib.rs |

## What Was Built

### AgentHandle (`handle.rs`)

- **Dual-channel design (D-01):**
  - `event_tx: mpsc::Sender<AgentEvent>` — stored as named pub field; worker tasks clone this to send events. Channel stays open as long as any AgentHandle clone is alive.
  - `broadcast_tx: broadcast::Sender<AgentEvent>` — supervisor re-broadcasts mpsc events here; `subscribe()` creates receivers from this.
  - `cancel_tx: mpsc::Sender<AgentControl>` — handle sends Stop/Pause/Resume to worker task.
- **`subscribe()`** — returns `broadcast::Receiver<AgentEvent>`; multiple subscribers supported; capacity 64.
- **`stop()`/`pause()`/`resume()`** — async, send AgentControl to cancel_tx; pause also sets `paused: Arc<AtomicBool>`.
- **`paused: Arc<AtomicBool>`** — checked before each `spawn_blocking` call; pause takes effect at turn boundary.
- **`state: Arc<std::sync::Mutex<AgentState>>`** — readable via `current_state()`; writable via `set_state()`.
- 6 tests covering all paths including the critical end-to-end `event_tx → broadcast` path.

### AgentSupervisor (`supervisor.rs`)

- **`spawn_agent(branch)`** — assigns worktree via WorktreeManager, creates all channels, stores `event_tx` in AgentHandle, spawns re-broadcast loop, registers handle. Returns `AgentId`.
- **`list()`** — returns `Vec<AgentId>` of all registered agents.
- **`get_handle(id)`** — returns `Option<AgentHandle>` clone.
- **`stop_agent(id)`** — clones handle under lock, drops lock, awaits `handle.stop()`, removes from registry, releases worktree. `SupervisorError::NotFound` if missing.
- **`stop_all()`** — collects all IDs under lock, then stops each.
- **`git_queue_for(repo_root)`** — gets or creates GitOpQueue per repo root.
- Owns `WorktreeManager` (D-08) and `SharedContextStore`.
- 7 tests including the ORC-02 requirement test `orc02_event_tx_flows_to_broadcast_subscriber`.

### Module wiring

- `supervisor/mod.rs` — all 6 sub-modules declared; full re-export of all public types.
- `lib.rs` — extended `pub use supervisor::` to include all new types: AgentHandle, AgentSupervisor, ContextError, GitOpQueue, SharedContextStore, SupervisorError, WorktreeError, WorktreeManager.

## Verification Results

```
cargo check -p runtime    → Finished (exit 0, 1 dead_code warning — set_state not yet called)
cargo test -p runtime agent_handle  → 6 passed; 0 failed
cargo test -p runtime supervisor    → 33 passed; 0 failed
cargo test -p runtime               → 133 passed; 0 failed
```

## Test Coverage

| Test | Assertion |
|------|-----------|
| agent_handle_subscribe_receives_events | Two independent subscribers both receive the same event |
| agent_handle_event_tx_flows_through_broadcast | End-to-end: event_tx send → re-broadcast loop → broadcast subscriber |
| agent_handle_stop_sends_control | stop() delivers AgentControl::Stop to cancel_rx |
| agent_handle_pause_sets_flag_and_sends_control | pause() sets AtomicBool true and sends AgentControl::Pause |
| agent_handle_resume_clears_flag | resume() clears paused AtomicBool |
| agent_handle_initial_state_is_idle | AgentHandle starts in AgentState::Idle |
| supervisor_list_empty_initially | list() returns empty on new supervisor |
| supervisor_spawn_agent_registers_handle | spawn_agent() returns id; list() shows 1 entry |
| supervisor_spawn_multiple_agents | Two spawns produce list of size 2 |
| supervisor_get_handle_returns_handle | get_handle() returns handle with correct agent_id |
| supervisor_stop_agent_removes_from_registry | stop_agent() removes entry; list() is empty |
| supervisor_stop_all_clears_registry | stop_all() after 2 spawns produces empty list |
| orc02_event_tx_flows_to_broadcast_subscriber | ORC-02: event sent via event_tx arrives at subscriber within 1s |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Three supervisor tests needed #[tokio::test] not #[test]**
- **Found during:** Task 2, running `cargo test -p runtime supervisor`
- **Issue:** `spawn_agent()` calls `tokio::spawn` internally. The three sync tests `supervisor_spawn_agent_registers_handle`, `supervisor_spawn_multiple_agents`, and `supervisor_get_handle_returns_handle` ran without a Tokio runtime, panicking with "there is no reactor running".
- **Fix:** Changed the three affected test functions from `#[test] fn` to `#[tokio::test] async fn`.
- **Files modified:** `rust/crates/runtime/src/supervisor/supervisor.rs`
- **Commit:** 34bba1a (included in Task 2 commit)

## Known Stubs

None — all public APIs fully implemented. `set_state()` is `pub(crate)` and will be called by agent worker tasks in Phase 3.

## Threat Surface Scan

No new network endpoints or auth paths introduced.

- **T-04-01 (broadcast lagged receiver)** — accepted per plan: capacity 64 handles worst-case burst; Phase 3 must handle `RecvError::Lagged` explicitly.
- **T-04-02 (registry mutation)** — accepted: supervisor is in-process, trusted code path.
- **T-04-03 (worktree leak on crash)** — mitigated: worktree assigned in `spawn_agent()`, released in `stop_agent()`/`stop_all()`; `prune()` called at startup.

## Self-Check: PASSED

- `rust/crates/runtime/src/supervisor/handle.rs` — FOUND
- `rust/crates/runtime/src/supervisor/supervisor.rs` — FOUND
- `rust/crates/runtime/src/supervisor/mod.rs` contains `mod handle` and `mod supervisor` — FOUND
- `rust/crates/runtime/src/lib.rs` contains `AgentSupervisor` — FOUND
- Commit `7f6c36c` — FOUND
- Commit `34bba1a` — FOUND
- 133 total runtime tests pass — CONFIRMED
