---
phase: 6
slug: parallel-worktrees-team-orchestration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-11
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest + jsdom (frontend) + cargo test (Rust) |
| **Config file** | `tauri-app/vitest.config.ts` |
| **Quick run command** | `cd tauri-app && npm test -- --run` |
| **Full suite command** | `cd tauri-app && npm test -- --run && cd ../rust && cargo test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd tauri-app && npm test -- --run`
- **After every plan wave:** Run `cd tauri-app && npm test -- --run && cd ../rust && cargo test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 6-01-01 | 01 | 1 | WRK-01, WRK-02, WRK-03 | — | Branch names are slug-sanitized; branch uniqueness enforced by role index prefix | unit (Rust) | `cd rust && cargo test -p runtime launch_team` | ❌ W0 | ⬜ pending |
| 6-01-02 | 01 | 1 | WRK-03 | — | Swarm count validated 1–8 before spawning | unit (Rust) | `cd rust && cargo test -p runtime launch_swarm` | ❌ W0 | ⬜ pending |
| 6-01-03 | 01 | 1 | WRK-05 | — | get_worktree_diff returns file list for agent's worktree | unit (Rust) | `cd rust && cargo test -p runtime get_diff_files` | ❌ W0 | ⬜ pending |
| 6-02-01 | 02 | 2 | WRK-01 | — | addAgent with branch/groupId stores correct values | unit (store) | `cd tauri-app && npm test -- --run agentStore` | ❌ W0 | ⬜ pending |
| 6-02-02 | 02 | 2 | WRK-05 | — | agentStore.openMergeCheckpoint sets mergeCheckpointGroupId | unit (store) | `cd tauri-app && npm test -- --run agentStore` | ❌ W0 | ⬜ pending |
| 6-02-03 | 02 | 2 | WRK-04, WRK-05 | — | useGroupWatcher triggers AllDone when all agents Done/Failed | unit (hook) | `cd tauri-app && npm test -- --run useGroupWatcher` | ❌ W0 | ⬜ pending |
| 6-03-01 | 03 | 3 | WRK-01 | — | AgentCard renders branch label when branch is non-empty | unit (component) | `cd tauri-app && npm test -- --run AgentCard` | ❌ W0 | ⬜ pending |
| 6-03-02 | 03 | 3 | WRK-01 | — | AgentCard renders pulsing badge when state is Executing | unit (component) | `cd tauri-app && npm test -- --run AgentCard` | ❌ W0 | ⬜ pending |
| 6-04-01 | 04 | 4 | WRK-04 | — | findConflicts returns paths touched by 2+ agents | unit (TS fn) | `cd tauri-app && npm test -- --run conflict` | ❌ W0 | ⬜ pending |
| 6-04-02 | 04 | 4 | WRK-05 | — | MergeCheckpointView renders yellow badge on conflicting file | unit (component) | `cd tauri-app && npm test -- --run MergeCheckpointView` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `rust/crates/runtime/src/supervisor/tests/launch_team_test.rs` — unit tests for launch_team, launch_swarm, get_diff_files (WRK-01, WRK-02, WRK-03)
- [ ] `tauri-app/src/stores/agentStore.test.ts` — extend with group action tests: addGroup, updateGroupMergeState, openMergeCheckpoint, addAgent with branch (WRK-01, WRK-05)
- [ ] `tauri-app/src/hooks/useGroupWatcher.test.ts` — covers AllDone auto-trigger (WRK-04, WRK-05)
- [ ] `tauri-app/src/components/agent/AgentCard.test.tsx` — branch label + pulsing badge rendering (WRK-01)
- [ ] `tauri-app/src/components/agent/MergeCheckpointView.test.tsx` — conflict badge rendering, findConflicts logic (WRK-04, WRK-05)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Two agents run concurrently on separate git worktrees without index.lock corruption | WRK-01 | Requires live Tauri app + git repo state; cannot mock GitOpQueue in unit test | Launch 2 agents via LaunchTeamDialog, verify both reach Done without error badges |
| Merge checkpoint opens automatically when all agents in group are Done | WRK-05 | Requires real IPC event chain from Rust → frontend | Launch team of 2, wait for both Done, verify MergeCheckpointView appears without user action |
| "Approve & Merge" button disabled while any agent is still running | WRK-05 | React interaction state; hard to test with mock data | Launch team, manually open MergeCheckpointView while 1 agent still running; verify button is disabled |
| Per-worktree accordion shows correct file list and expandable DiffView | WRK-05 | Requires real git diff data from worktree | After agents complete, verify each accordion section shows changed files with before/after diff |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
