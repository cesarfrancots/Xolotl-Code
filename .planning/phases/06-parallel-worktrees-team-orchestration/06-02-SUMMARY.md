---
phase: "06"
plan: "02"
subsystem: "frontend-store + frontend-hooks"
tags: [typescript, zustand, react, hooks, phase6, group-orchestration]
dependency_graph:
  requires:
    - "06-01 — bindings.ts IPC types (GroupLaunchResult, RoleConfig, FileDiff)"
  provides:
    - "AgentGroup interface — id, agentIds, mode, mergeState, name"
    - "AgentRecord.branch — worktree branch name for agent cards"
    - "AgentRecord.groupId — links agent to its group, or null for solo"
    - "agentStore.groups[] — group registry alongside agents map"
    - "agentStore.mergeCheckpointGroupId — which group checkpoint is open"
    - "agentStore.addGroup — creates group with Pending mergeState"
    - "agentStore.updateGroupMergeState — state machine transitions"
    - "agentStore.openMergeCheckpoint — opens/closes center-pane checkpoint"
    - "useGroupWatcher — auto-triggers AllDone + opens checkpoint when group completes"
    - "useGroupWatcher — listens for group-state-changed; auto-closes after Merged"
  affects:
    - "tauri-app/src/stores/agentStore.ts — extended with group state"
    - "tauri-app/src/hooks/useGroupWatcher.ts — new hook"
    - "tauri-app/src/components/agent/SpawnAgentDialog.tsx — backward-compat addAgent"
tech_stack:
  added: []
  patterns:
    - "Zustand store extension — new fields/actions added surgically alongside existing (no new store)"
    - "TDD cycle — RED failing tests first, then GREEN implementation"
    - "mergeState guard (group.mergeState !== Pending) prevents useGroupWatcher re-entrancy"
    - "Tauri listen() cleanup pattern — unlisten stored in closure, called on useEffect return"
key_files:
  created:
    - tauri-app/src/hooks/useGroupWatcher.ts
    - tauri-app/src/hooks/useGroupWatcher.test.ts
  modified:
    - tauri-app/src/stores/agentStore.ts
    - tauri-app/src/stores/agentStore.test.ts
    - tauri-app/src/components/agent/SpawnAgentDialog.tsx
    - tauri-app/src/components/agent/AgentCard.test.tsx
decisions:
  - "groups and agents coexist in the same Zustand store — no separate store — matches D-13 from 06-CONTEXT"
  - "addAgent optional branch/groupId params default to empty string and null — preserves all 3-arg callers"
  - "useGroupWatcher reads agents/groups from store, not passed as props — consistent with useAgentPanelEvents pattern"
  - "AgentCard.test.tsx makeAgent factory updated with branch/groupId fields (Rule 1 fix)"
metrics:
  duration: "~25 minutes"
  completed_date: "2026-05-11"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 6
---

# Phase 06 Plan 02: Zustand Group State + useGroupWatcher Hook

**One-liner:** agentStore extended with AgentGroup type, group actions, and branch/groupId fields on AgentRecord; useGroupWatcher hook auto-triggers merge checkpoint when all group agents complete — data contracts Wave 3 and 4 UI plans depend on.

## What Was Built

This plan delivers the Wave 2 frontend store and hook foundation. No UI components; the output is stable data contracts and event-driven group state management.

### Task 1: agentStore extended with AgentGroup + group actions

New exported types:

- `AgentGroup` — `{ id, agentIds, mode: "team"|"swarm", mergeState: "Pending"|"AllDone"|"CheckpointOpen"|"Merged", name }`

Extended `AgentRecord`:

- `branch: string` — worktree branch name (e.g. `"agent/0-refactor-auth"`). Defaults to `""` for solo agents.
- `groupId: string | null` — group membership, or `null` for solo agents.

Extended `AgentStoreState`:

- `groups: AgentGroup[]` — initially empty
- `mergeCheckpointGroupId: string | null` — initially null
- `addGroup(id, agentIds, mode, name)` — creates group with `mergeState: "Pending"`
- `updateGroupMergeState(groupId, state)` — transitions matching group's state
- `openMergeCheckpoint(groupId | null)` — opens/closes center-pane checkpoint

`addAgent` gained optional `branch` and `groupId` params with defaults `""` and `null` — all existing 3-arg callers unchanged.

Tests: 6 new group action tests added; 18 total store tests pass.

### Task 2: useGroupWatcher hook + SpawnAgentDialog fix

`useGroupWatcher.ts` — void hook, mount once in AgentPanel (Wave 3):

- `useEffect([agents, groups])` — iterates groups; for any `Pending` group where all registered agents are `Done` or `Failed`: calls `updateGroupMergeState(id, "AllDone")` then `openMergeCheckpoint(id)`. Guards: skips empty groups and non-Pending groups.
- `useEffect([])` — registers Tauri `listen("group-state-changed")` on mount. On payload `{ state: "Merged" }`: calls `updateGroupMergeState(groupId, "Merged")` then schedules `openMergeCheckpoint(null)` after 1500ms. Cleans up unlisten on unmount.

`SpawnAgentDialog.tsx` — two `addAgent` calls updated to pass explicit `""` and `null` for branch/groupId.

`AgentCard.test.tsx` — `makeAgent` factory updated to include `branch: ""` and `groupId: null` (Rule 1 fix — TypeScript required the new fields).

All 46 tests across 7 test files pass; `npx tsc --noEmit` exits 0.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] AgentCard.test.tsx makeAgent missing new required fields**
- **Found during:** Task 1 — `npx tsc --noEmit` failed after adding `branch` and `groupId` as required fields on `AgentRecord`
- **Issue:** The existing `makeAgent` factory in `AgentCard.test.tsx` returned an object without `branch` or `groupId`, causing a type mismatch
- **Fix:** Added `branch: ""` and `groupId: null` to the factory defaults; updated `beforeEach` to reset `groups` and `mergeCheckpointGroupId`
- **Files modified:** `tauri-app/src/components/agent/AgentCard.test.tsx`
- **Commit:** 401cb2c

## Threat Surface Scan

No new network endpoints or Tauri commands. The only new trust boundary is the `group-state-changed` Tauri event consumed by `useGroupWatcher`, which was already in the plan's threat model:

| Flag | File | Description |
|------|------|-------------|
| T-06-05 accepted | useGroupWatcher.ts | group-state-changed payload only calls updateGroupMergeState — no filesystem access |
| T-06-06 accepted | useGroupWatcher.ts | mergeState !== "Pending" guard prevents re-entrancy |

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| agentStore.ts exists | FOUND |
| useGroupWatcher.ts exists | FOUND |
| useGroupWatcher.test.ts exists | FOUND |
| SpawnAgentDialog.tsx updated | FOUND |
| grep "groups: AgentGroup[]" agentStore.ts | FOUND |
| grep "mergeCheckpointGroupId" agentStore.ts | FOUND |
| grep "branch: string" agentStore.ts | FOUND |
| grep "groupId: string | null" agentStore.ts | FOUND |
| npm test --run agentStore | 18 passed |
| npm test --run useGroupWatcher | 3 passed |
| npm test --run (all) | 46 passed, 7 files |
| npx tsc --noEmit | 0 errors |
| Commit 401cb2c (Task 1) | FOUND |
| Commit 69de827 (Task 2) | FOUND |
