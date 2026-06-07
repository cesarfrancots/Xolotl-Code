---
phase: 05
plan: 03
subsystem: tauri-ipc
tags: [tauri, ipc, budget, event-relay, agent-execution, rust]
dependency_graph:
  requires: [05-01, 05-02]
  provides: [spawn_agent-extended-signature, spawn_event_relay-budget-enforcement, spawn_agent_executor, spawnAgent-binding-updated]
  affects: [tauri-app/src-tauri/src/commands.rs, tauri-app/src/bindings.ts, rust/crates/runtime/src/lib.rs]
tech_stack:
  added: []
  patterns: [subprocess-NDJSON-streaming, budget-enforcement-in-relay, tokio-spawn_blocking-for-sync-io]
key_files:
  created: []
  modified:
    - tauri-app/src-tauri/src/commands.rs
    - tauri-app/src/bindings.ts
    - rust/crates/runtime/src/lib.rs
decisions:
  - "spawn_agent_executor uses subprocess (std::process::Command) not in-process ConversationRuntime — resolves RESEARCH.md Open Q1; in-process runtime would require ApiClient+ToolExecutor+Session wiring not yet present in the Tauri layer"
  - "spawn_agent_executor is tokio::task::spawn_blocking (synchronous BufRead::lines) rather than tokio async I/O — matches pattern from SubAgentSpawner reference impl"
  - "slugify_task added to runtime crate root pub use (was in supervisor/mod.rs but not lib.rs) — Rule 3 auto-fix"
  - "Budget enforcement placed in spawn_event_relay (not spawn_agent) so it runs on every TurnCompleted regardless of which code path emits the event"
metrics:
  duration: "6 minutes"
  completed_date: "2026-05-10"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 3
  tests_added: 0
  tests_total_after: 161
---

# Phase 5 Plan 03: Tauri IPC Wiring — spawn_agent Extension + Budget Relay + Self-Execution Summary

**One-liner:** `spawn_agent` Tauri command extended to (task, model, budget_dollars), budget enforcement added to the event relay via `accumulate_cost` on TurnCompleted, and `spawn_agent_executor` wired to drive agents via CLI subprocess NDJSON streaming — resolving RESEARCH.md Open Question 1.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Rewrite spawn_agent + extend spawn_event_relay with budget enforcement + spawn_agent_executor | 6ab735e | commands.rs, lib.rs |
| 2 | Update bindings.ts spawnAgent declaration to new signature | 9aaa2e8 | bindings.ts |
| 3 | Wire ConversationRuntime self-execution via spawn_agent_executor | (included in 6ab735e) | commands.rs |

> Task 3 was implemented within Task 1's commit because the full `spawn_agent_executor` function (not a stub) was written as part of the commands.rs rewrite. The plan allowed this — Task 1 step 5 said "stub it with `fn spawn_agent_executor(_id: AgentId, _h: AgentHandle) {}` and replace in Task 3" but implementing it fully upfront avoids a two-step rewrite.

## What Was Built

### `spawn_agent` Command (commands.rs)

Old signature: `spawn_agent(supervisor, app_handle, branch: String) -> Result<String, String>`

New signature:
```rust
pub fn spawn_agent(
    supervisor: tauri::State<'_, Arc<AgentSupervisor>>,
    app_handle: AppHandle,
    task: String,
    model: String,
    budget_dollars: Option<f64>,
) -> Result<String, String>
```

Branch is derived internally: `let branch = slugify_task(&task)`. Frontend never sends a branch.

Calls `spawn_agent_with_config` then starts both the event relay and the self-execution task.

### Budget Enforcement in `spawn_event_relay` (commands.rs)

After every `Ok(event)` emit, checks if event is `TurnCompleted`. If so, calls `handle.accumulate_cost(usage, &handle.model)`. If the new cumulative total meets or exceeds `handle.budget_dollars`, injects `StateChanged(Failed)` and `Error { message: "Budget exceeded: $X.XXXX" }` via `handle.event_tx.try_send()`.

### `spawn_agent_executor` (commands.rs)

Resolves RESEARCH.md Open Question 1. Runs in `tokio::task::spawn_blocking` to perform synchronous `BufRead::lines()` on the subprocess stdout.

Flow:
1. Emits `StateChanged(Planning)` immediately.
2. Spawns `std::env::current_exe()` with `--print-output --task-prompt <task> --task-id <id> --model <model> --working-dir <worktree_path>`.
3. Streams each NDJSON line as an `AgentEvent` into `event_tx` via `blocking_send`.
4. Non-JSON lines are silently skipped (CLI may emit human-readable preamble).
5. On clean exit: emits `StateChanged(Done)`.
6. On non-zero/signal exit: emits `Error { message: "agent process exited with code N" }` + `StateChanged(Failed)`.
7. On spawn failure: emits `Error` + `StateChanged(Failed)` and returns early.

Design choice rationale (subprocess vs in-process ConversationRuntime): documented in the function doc comment. The Tauri layer does not yet construct `ApiClient` / `ToolExecutor` / `Session`. `SubAgentSpawner` (Phase 2 ORC-06) already encapsulates this pattern. The subprocess approach costs ~100 lines of streaming glue vs hundreds of lines of new API client wiring.

### `bindings.ts` spawnAgent Update

Old:
```typescript
spawnAgent: (branch: string) => typedError<string, string>(__TAURI_INVOKE("spawn_agent", { branch }))
```

New:
```typescript
spawnAgent: (task: string, model: string, budgetDollars: number | null) =>
  typedError<string, string>(__TAURI_INVOKE("spawn_agent", { task, model, budgetDollars }))
```

Invoke payload uses `budgetDollars` (camelCase) matching Tauri's automatic snake_case conversion.

## Frontend Callsites Broken by This Change

The following callsite now has a TypeScript type error and will be fixed in plan 05-05 (SpawnAgentDialog):

| File | Line | Old call | Status |
|------|------|----------|--------|
| `tauri-app/src/components/chat/MessageInput.tsx` | 110 | `commands.spawnAgent("main")` | Will TypeScript-error — fix in 05-05 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `slugify_task` missing from runtime crate root `pub use`**

- **Found during:** Task 1 cargo check
- **Issue:** `supervisor/mod.rs` re-exports `slugify_task` from `handle.rs`, but `lib.rs` line 70's `pub use supervisor::{ ... }` block did not include it. The import `use runtime::slugify_task` in commands.rs failed to resolve.
- **Fix:** Added `slugify_task` to the `pub use supervisor::{ ... }` block in `lib.rs`.
- **Files modified:** `rust/crates/runtime/src/lib.rs`
- **Commit:** 6ab735e

**2. [Rule 3 - Adaptation] Task 3 implemented in full within Task 1 commit**

- **Reason:** The plan's Task 1 step 5 suggested stubbing `spawn_agent_executor` and replacing in Task 3. Since I had the full plan for Task 3 already and the implementation was straightforward, implementing it completely in Task 1 avoids a stub-then-replace cycle and produces cleaner commit history.
- **Impact:** Task 3's acceptance criteria all pass; no functional change from implementing in two steps.

## RESEARCH.md Open Question 1 — Resolved

**Q1:** "How do we drive the agent's first turn after spawn? Does spawn_agent need to call run_agent_turn automatically, or should the frontend do it?"

**Answer:** `spawn_agent` now calls `spawn_agent_executor` immediately after the event relay, which spawns the CLI binary as a child process with `--task-prompt` + `--model` + `--working-dir`. NDJSON `AgentEvent` lines from the subprocess stdout are streamed into `handle.event_tx`. This provides real `TextDelta` and `TurnCompleted` events without requiring the Tauri layer to build an in-process `ConversationRuntime`.

The existing `run_agent_turn` command (which emits an echo stub) is left unchanged — it handles subsequent turns for the interactive chat view. `spawn_agent_executor` handles the first autonomous turn only.

## Known Stubs

None — this plan wires real logic. The `run_agent_turn` echo stub in the existing code predates this plan and is tracked separately.

## Threat Surface Scan

No new trust boundaries introduced beyond what the plan's `<threat_model>` documented. All STRIDE mitigations applied:

| Threat ID | Status |
|-----------|--------|
| T-5-01 | Mitigated — budget validation in `spawn_agent_with_config` (plan 05-01) |
| T-5-02 | Mitigated — `slugify_task(&task)` applied before any git call |
| T-5-06 | Mitigated — handle cloned into tokio task; `try_send` is non-blocking |
| T-5-07 | Mitigated — `Command::arg(&task)` passes task as single argv element, no shell interpolation |
| T-5-08 | Accepted — `budget_dollars: None` = unlimited; `stop_agent` available to user |

## Self-Check

- [x] `tauri-app/src-tauri/src/commands.rs` — modified, contains new spawn_agent + budget relay + spawn_agent_executor
- [x] `tauri-app/src/bindings.ts` — modified, spawnAgent uses (task, model, budgetDollars)
- [x] `rust/crates/runtime/src/lib.rs` — modified, slugify_task added to pub use
- [x] Commit `6ab735e` exists (Task 1 + Task 3)
- [x] Commit `9aaa2e8` exists (Task 2)
- [x] `cargo check` passes (warnings only, zero errors)
- [x] 161 runtime tests pass with 0 failures

## Self-Check: PASSED
