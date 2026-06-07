---
phase: 05
plan: 08
subsystem: agent-dashboard
tags: [gap-closure, uat-fix, worktree, notifications, model-defaults]
depends_on: [05-07]
requirements: [AGT-01, AGT-03, AGT-04, AGT-05]

dependency_graph:
  requires: [05-07]
  provides: [worktree-collision-fix, failed-agent-card, model-defaults, model-persistence, os-notifications]
  affects: [tauri-app/src-tauri/src/commands.rs, tauri-app/src/components/agent/SpawnAgentDialog.tsx, tauri-app/src/components/chat/MessageInput.tsx, tauri-app/src/stores/chatStore.ts, rust/crates/runtime/src/supervisor/worktree.rs]

tech_stack:
  added: []
  patterns: [detect-delete-retry, localStorage-persistence, OS-notification-on-terminal-state]

key_files:
  modified:
    - rust/crates/runtime/src/supervisor/worktree.rs
    - tauri-app/src-tauri/src/commands.rs
    - tauri-app/src/components/agent/SpawnAgentDialog.tsx
    - tauri-app/src/components/chat/MessageInput.tsx
    - tauri-app/src/stores/chatStore.ts

decisions:
  - Worktree active map changed to HashMap<AgentId, (PathBuf, String)> to enable branch cleanup on remove
  - Branch delete-retry only attempts once — second failure surfaces unchanged error
  - Failed agent card uses synthetic `failed-${Date.now()}` ID (not a real agent ID from backend)
  - localStorage key is "xolotl-selected-model" — consistent between init read and setModel write
  - accumulate_cost() called unconditionally on TurnCompleted (not only when budget is set) so cost is always tracked for notification body

metrics:
  duration_minutes: 25
  completed_date: "2026-05-10"
  tasks_completed: 6
  tasks_total: 6
  files_changed: 5
---

# Phase 05 Plan 08: UAT Gap Closure Summary

**One-liner:** Six UAT blockers/majors fixed — worktree collision retry, Failed card on error, kimi2.6 as default, localStorage model persistence, and OS notifications on Done/Failed.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fix worktree branch collision | d6f6514 | worktree.rs |
| 2 | Show Failed agent card on spawn error | ff6edb5 | SpawnAgentDialog.tsx |
| 3 | Fix model defaults, ordering, chat hardcode | e0e4a1f | commands.rs, chatStore.ts, SpawnAgentDialog.tsx, MessageInput.tsx |
| 4 | Persist model selection to localStorage | f15447b | chatStore.ts |
| 5 | Wire OS notifications on Done/Failed | 7061d66 | commands.rs |
| 6 | Final verification — all gates pass | — | (no code changes) |

## UAT Gaps Closed

| Gap | Severity | Fix |
|-----|----------|-----|
| Worktree branch collision crashes spawn (test 4) | BLOCKER | worktree.rs add(): detect "already exists", delete stale branch, retry once |
| No agent card on spawn failure (test 5) | BLOCKER | SpawnAgentDialog.tsx creates synthetic Failed card in error path |
| Chat crashes with non-claude model (out-of-band) | BLOCKER | MessageInput.tsx uses chatStore.model instead of hardcoded "claude-sonnet-4-5" |
| Model default is claude-opus-4-5 not kimi2.6 (test 3) | MAJOR | list_models() reordered; chatStore DEFAULT_MODEL = "kimi2.6" |
| Selected model reverts on restart (test 10) | MAJOR | chatStore reads/writes localStorage("xolotl-selected-model") |
| OS notification never fires on Done/Failed (test 8) | MAJOR | spawn_event_relay fires notification on StateChanged(Done|Failed) |

## Automated Gate Results

- `cargo test -p runtime --lib`: 161 passed, 0 failed
- `npx vitest run`: 37 passed, 0 failed (6 test files)
- `npx tsc --noEmit`: 0 errors
- `cargo check` (tauri-app/src-tauri): 0 errors (2 pre-existing dead_code warnings)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None introduced in this plan.

## Threat Flags

None — no new trust boundaries. All changes are within existing command/store boundaries. Branch deletion is gated on the `agent/` prefix pattern (branches come from `slugify_task()` which always prefixes `agent/`).

## Self-Check: PASSED

- worktree.rs modified: confirmed
- commands.rs modified: confirmed
- SpawnAgentDialog.tsx modified: confirmed
- MessageInput.tsx modified: confirmed
- chatStore.ts modified: confirmed
- All 5 commits exist in git log: d6f6514, ff6edb5, e0e4a1f, f15447b, 7061d66
