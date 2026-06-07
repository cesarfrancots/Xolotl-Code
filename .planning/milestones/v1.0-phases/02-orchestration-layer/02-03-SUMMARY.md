---
phase: "02"
plan: "02-03"
subsystem: runtime/supervisor
tags: [rust, git-worktree, process-command, arc-mutex, isolation]
dependency_graph:
  requires:
    - phase: "02-01"
      provides: AgentId type (newtype String, Display/Clone/Hash/PartialEq)
    - phase: "02-02"
      provides: supervisor/mod.rs with Wave 2 module scaffold
  provides:
    - WorktreeManager with add/remove/list/prune/get_path and WorktreeError
    - supervisor/mod.rs re-exports: WorktreeError, WorktreeManager
  affects:
    - "02-04 (AgentSupervisor — owns WorktreeManager, calls add() at spawn, remove() on stop)"
tech_stack:
  added: []
  patterns:
    - "Arc<Mutex<HashMap>> for shared active-worktrees map (clone shares the map — D-08 supervisor ownership)"
    - "std::process::Command with per-element .args([...]) — no shell concatenation (Windows-safe, Pitfall 3)"
    - "tempfile::TempDir + real git init for integration-style unit tests"
key_files:
  created:
    - rust/crates/runtime/src/supervisor/worktree.rs
  modified:
    - rust/crates/runtime/src/supervisor/mod.rs
decisions:
  - "WorktreeError uses thiserror (already in runtime [dependencies] from 02-02) — no new dependency"
  - "Arc<Mutex<HashMap>> chosen (not RwLock) because worktree add/remove operations are write-heavy compared to SharedContextStore's read-heavy workload"
  - "remove() removes from active map before git command — entry removed even if git exits non-zero (best-effort cleanup on crash)"
metrics:
  duration: "~10 minutes"
  completed: "2026-05-08"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 1
---

# Phase 2 Plan 03: WorktreeManager Summary

**One-liner:** WorktreeManager with add/remove/list/prune git worktree lifecycle using per-element Command args (Windows-safe), 6 passing tests with real git init in tempdir, wired into supervisor/mod.rs.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| T01 | Implement WorktreeManager with full git worktree lifecycle | 2c6a592 | rust/crates/runtime/src/supervisor/worktree.rs |
| T02 | Wire WorktreeManager into supervisor/mod.rs | 21f669b | rust/crates/runtime/src/supervisor/mod.rs |

## What Was Built

- **WorktreeManager** — struct with `Arc<Mutex<HashMap<AgentId, PathBuf>>>` active map, shared via Clone (D-08 supervisor ownership pattern)
- **add(agent_id, branch)** — runs `git worktree add -b <branch> <repo_root>/.xolotl-worktrees/<agent_id>` with per-element args; records path in active map
- **remove(agent_id)** — removes from active map first, then runs `git worktree remove --force <path>`; returns `NotAssigned` for unknown agents
- **list()** — returns all (AgentId, PathBuf) pairs from active map
- **prune()** — runs `git worktree prune` for crash recovery at startup
- **get_path(agent_id)** — non-destructive lookup
- **WorktreeError** — `GitFailed(String)`, `Io(#[from] std::io::Error)`, `NotAssigned(AgentId)` via thiserror
- **supervisor/mod.rs** — `mod worktree` declaration (replacing Wave 2 commented stub) + `pub use worktree::{WorktreeError, WorktreeManager}`

## Verification Results

```
cargo check -p runtime → Finished (exit 0, 12 dead_code/unused_import warnings — expected, Wave 3 not yet wired)
cargo test -p runtime worktree → 6 passed; 0 failed
cargo test -p runtime → 120 passed; 0 failed (114 prior + 6 new)
```

## Test Coverage

| Test | Assertion |
|------|-----------|
| worktree_list_empty_initially | list() returns empty vec on new manager |
| worktree_add_creates_entry_and_directory | add() returns path; list() returns 1 entry; directory exists on disk |
| worktree_remove_cleans_up_entry | remove() after add() produces empty list() |
| worktree_remove_unknown_agent_returns_err | remove() on unknown agent returns Err(NotAssigned) |
| worktree_prune_runs_without_error | prune() on clean repo returns Ok(()) |
| worktree_clone_shares_active_map | Clone of manager shares same active map (Arc) |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all public APIs are fully implemented and tested.

## Threat Surface Scan

No new network endpoints or auth paths introduced.

- **T-03-01 (path tampering)** — mitigated: AgentId formats as `agent-N` (counter-based, no user-controlled segments); `.args([...])` per-element prevents shell interpretation
- **T-03-02 (stale worktrees after crash)** — mitigated: `prune()` is available for supervisor to call at startup; documented in code comments
- **T-03-03 (unconstrained worktree creation)** — accepted: bounded by AgentSupervisor spawn call sites; no per-process limit needed in v1

## Self-Check: PASSED

- `rust/crates/runtime/src/supervisor/worktree.rs` — FOUND
- `rust/crates/runtime/src/supervisor/mod.rs` contains `mod worktree` — FOUND
- `rust/crates/runtime/src/supervisor/mod.rs` contains `WorktreeManager` — FOUND
- Commit `2c6a592` — FOUND
- Commit `21f669b` — FOUND
- 6 worktree tests pass — CONFIRMED
- 120 total runtime tests pass — CONFIRMED
