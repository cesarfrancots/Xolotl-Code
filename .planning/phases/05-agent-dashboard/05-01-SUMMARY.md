---
phase: 05
plan: 01
subsystem: rust-supervisor
tags: [rust, supervisor, agent-handle, budget, tdd]
dependency_graph:
  requires: []
  provides: [AgentHandle.task, AgentHandle.model, AgentHandle.budget_dollars, AgentHandle.cumulative_cost, AgentHandle.new_with_config, AgentHandle.accumulate_cost, slugify_task, AgentSupervisor.spawn_agent_with_config, SupervisorError.InvalidBudget]
  affects: [tauri-app/src-tauri/src/commands.rs, supervisor/mod.rs]
tech_stack:
  added: []
  patterns: [TDD red-green, thiserror error variants, Arc<Mutex<f64>> for shared cost accumulation]
key_files:
  created: []
  modified:
    - rust/crates/runtime/src/supervisor/handle.rs
    - rust/crates/runtime/src/supervisor/supervisor.rs
    - rust/crates/runtime/src/supervisor/mod.rs
decisions:
  - accumulate_cost creates a fresh UsageTracker per call (stateless per-turn cost calculation, additive to stored cumulative)
  - slugify_task returns "agent/" (not "agent/agent") when input has no alphanumeric content — intentional per plan spec
  - InvalidBudget variant placed after Context variant in SupervisorError to avoid breaking existing match patterns
metrics:
  duration: "4 minutes"
  completed_date: "2026-05-10"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 3
  tests_added: 10
  tests_total_after: 161
---

# Phase 5 Plan 01: Rust Supervisor Handle Extension Summary

**One-liner:** AgentHandle extended with task/model/budget/cumulative_cost fields plus `new_with_config`, `accumulate_cost`, `slugify_task`, and `spawn_agent_with_config` with T-5-01 budget validation.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend AgentHandle with task/model/budget fields + accumulate_cost + slugify_task | faacaf6 | handle.rs, mod.rs |
| 2 | Add spawn_agent_with_config to AgentSupervisor with budget validation | eb66222 | supervisor.rs |

## What Was Built

### Task 1: AgentHandle extensions (handle.rs, mod.rs)

Four new public fields added to `AgentHandle` after the `state` field:
- `pub task: String` — task description set at spawn time (AGT-03)
- `pub model: String` — model name set at spawn time (AGT-05)
- `pub budget_dollars: Option<f64>` — optional spend cap in USD (AGT-06)
- `pub cumulative_cost: Arc<std::sync::Mutex<f64>>` — running cost accumulator

New constructor `new_with_config` accepts the same 5 channel/path args plus task/model/budget, defaulting `cumulative_cost` to 0.0. The existing `new` constructor is unchanged (backwards-compatible: new fields default to `String::new()`, `None`, `0.0`).

`accumulate_cost(&usage, model)` creates a fresh `UsageTracker`, records the token usage, calculates per-turn cost, adds it to the mutex-guarded cumulative total, and returns the new total.

`slugify_task(task)` strips all non-ASCII-alphanumeric chars to `-`, collapses consecutive hyphens, lowercases, caps slug to 40 chars, and prefixes with `"agent/"`. Mitigates T-5-02 (no shell metacharacters or path separators survive into the git branch name).

`slugify_task` re-exported from `supervisor/mod.rs` for use by plan 03's `commands.rs`.

### Task 2: spawn_agent_with_config (supervisor.rs)

`InvalidBudget(String)` variant added to `SupervisorError`.

`spawn_agent_with_config(branch, task, model, budget_dollars)` on `AgentSupervisor`:
- Validates budget upfront (T-5-01): rejects `Some(b)` where `!b.is_finite() || b <= 0.0`
- Returns `Err(InvalidBudget(...))` before touching worktree or registry on invalid input
- On valid input: creates worktree, channels, `AgentHandle::new_with_config`, re-broadcast loop, registers handle
- `None` budget = unlimited (D-07)

## Test Results

- **Task 1:** 5 new tests + 6 existing = 11 tests in `supervisor::handle` — all pass
- **Task 2:** 5 new tests + 7 existing = 12 tests in `supervisor::supervisor` — all pass
- **Full runtime suite:** 161 tests, 0 failures

## Deviations from Plan

None — plan executed exactly as written. All interfaces, field names, method signatures, and test names match the plan specification.

## Known Stubs

None. This plan adds Rust-only backend types and logic. No UI components or data flow stubs.

## Threat Flags

No new threat surface beyond what is documented in the plan's `<threat_model>`. T-5-01 and T-5-02 mitigations are both implemented.

## Self-Check

- [x] `rust/crates/runtime/src/supervisor/handle.rs` — modified, contains all new fields and methods
- [x] `rust/crates/runtime/src/supervisor/supervisor.rs` — modified, contains `spawn_agent_with_config` and `InvalidBudget`
- [x] `rust/crates/runtime/src/supervisor/mod.rs` — modified, re-exports `slugify_task`
- [x] Commit `faacaf6` exists (Task 1)
- [x] Commit `eb66222` exists (Task 2)
- [x] 161 runtime tests pass with 0 failures

## Self-Check: PASSED
