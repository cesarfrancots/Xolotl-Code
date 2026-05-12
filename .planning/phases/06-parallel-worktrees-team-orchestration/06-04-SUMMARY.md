---
phase: "06"
plan: "04"
subsystem: "frontend-merge-checkpoint"
tags: [typescript, react, tailwind, zustand, phase6, merge-checkpoint, accordion, app-routing]
dependency_graph:
  requires:
    - "06-02 — agentStore groups/AgentGroup/mergeCheckpointGroupId/openMergeCheckpoint"
    - "06-03 — AgentPanel useGroupWatcher triggers merge checkpoint open"
    - "06-01 — bindings.ts getWorktreeDiff/mergeWorktrees/FileDiff"
  provides:
    - "MergeCheckpointView — center pane replacement for merge review (D-10, D-11, D-12)"
    - "findConflicts() — detects files touched by 2+ agents (D-08)"
    - "App.tsx 3-branch center pane — mergeCheckpointGroupId | expandedAgentId | ChatPane"
    - "shadcn accordion — AccordionItem/AccordionTrigger/AccordionContent installed"
  affects:
    - "tauri-app/src/components/agent/MergeCheckpointView.tsx — new component"
    - "tauri-app/src/App.tsx — 3-branch center pane ternary"
    - "tauri-app/src/components/ui/accordion.tsx — new shadcn component"
tech_stack:
  added:
    - "shadcn accordion (radix-ui AccordionPrimitive)"
  patterns:
    - "Center pane replacement — MergeCheckpointView follows AgentOutputView mount/unmount pattern exactly"
    - "Parallel diff fetch — Promise.all over agentsInGroup on mount; loading state set before and after"
    - "Conflict detection — path frequency counter; Set<string> of paths with count >= 2"
    - "Approval gate — window.confirm before irreversible merge IPC call (T-06-10)"
    - "Auto-close after merge — setTimeout 1500ms calling openMergeCheckpoint(null) (D-12)"
    - "3-branch center pane priority — mergeCheckpointGroupId > expandedAgentId > ChatPane (D-10)"
    - "TDD cycle — RED failing test committed first, then GREEN implementation"
key_files:
  created:
    - tauri-app/src/components/agent/MergeCheckpointView.tsx
    - tauri-app/src/components/agent/MergeCheckpointView.test.tsx
    - tauri-app/src/components/ui/accordion.tsx
  modified:
    - tauri-app/src/App.tsx
decisions:
  - "MergeCheckpointView fetches all diffs in parallel on mount (not lazily per accordion expand) — single loading state covers entire view"
  - "findConflicts is a pure internal function (not exported) — tested via rendered component output"
  - "mergeCheckpointGroupId takes priority over expandedAgentId in center pane (D-10 spec)"
  - "node_modules symlinked from main repo into worktree for test execution — worktrees share a package-lock.json"
metrics:
  duration: "~20 minutes"
  completed_date: "2026-05-11"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 4
---

# Phase 06 Plan 04: Wave 4 MergeCheckpointView + App.tsx 3-branch Center Pane

**One-liner:** MergeCheckpointView built with parallel diff fetch, per-file accordion, conflict detection (yellow badge), Approve & Merge with window.confirm gate and 1.5s auto-close; App.tsx center pane promoted to 3-branch ternary; npm run build exits 0.

## What Was Built

### Task 0: Install shadcn accordion

`npx shadcn@latest add accordion` created `tauri-app/src/components/ui/accordion.tsx` with `Accordion`, `AccordionItem`, `AccordionTrigger`, `AccordionContent` exports backed by Radix UI AccordionPrimitive. Required before MergeCheckpointView could import these components.

### Task 1: MergeCheckpointView (TDD RED → GREEN)

**RED:** `MergeCheckpointView.test.tsx` committed first with 4 failing tests:
- Empty worktree state: "No file changes in this worktree."
- Yellow conflict badge on file touched by 2+ agents
- "No conflicts" label when no shared files
- "1 conflict detected" count summary

**GREEN:** `MergeCheckpointView.tsx` created with:

**`findConflicts()`** — internal pure function; iterates all `{ agentId, files }` pairs, counts path occurrences with a `Map<string, number>`, returns `Set<string>` of paths where count >= 2.

**Diff fetch on mount** — `useEffect([groupId])` runs `Promise.all` over `agentsInGroup`, calling `commands.getWorktreeDiff(agent.id)` for each. On error, returns empty file list (graceful degradation). Sets `diffsMap` + `conflictPaths` + transitions to `"ready"` state.

**Merge status indicator** (header, left of close button):
- `"loading"` → Loader2 spinner + "Loading…"
- `"merging"` → Loader2 spinner + "Merging…"
- `"merged"` → "Merged" in emerald-400
- `"error"` → error message in red-400
- `"ready"` → nothing

**Approve & Merge** — disabled when `loadState === "merging" || "merged" || anyAgentStillRunning` (T-06-09). Click triggers `window.confirm("Merge all worktree branches? This cannot be undone.")` (T-06-10) before `commands.mergeWorktrees`. On success: transitions to "merged", calls `updateGroupMergeState(groupId, "Merged")`, auto-closes after 1500ms (D-12).

**Per-agent WorktreeSection** — renders inside `ScrollArea` flex-col body. Each agent: branch `<code>` label + file count. If diffs empty → italic "No file changes in this worktree." If diffs non-empty → `Accordion type="multiple"` with per-file `AccordionItem`. Conflict badge (`bg-yellow-900/40 text-yellow-400 border border-yellow-800`) in `AccordionTrigger` when `conflictPaths.has(file.path)`. `AccordionContent` renders `<DiffView oldStr={file.old_content} newStr={file.new_content} />`.

All 5 MergeCheckpointView tests pass; 51 total tests pass across 8 test files.

### Task 2: App.tsx 3-branch center pane + build gate

Two surgical changes to `App.tsx`:

1. Added `import { MergeCheckpointView } from "./components/agent/MergeCheckpointView";`
2. Added `const mergeCheckpointGroupId = useAgentStore((s) => s.mergeCheckpointGroupId);`
3. Replaced 2-branch ternary with 3-branch:

```tsx
{mergeCheckpointGroupId ? (
  <MergeCheckpointView groupId={mergeCheckpointGroupId} />
) : expandedAgentId ? (
  <AgentOutputView agentId={expandedAgentId} />
) : (
  <ChatPane />
)}
```

`npm run build` exits 0 — TypeScript + Vite compile clean. Chunk size warning is pre-existing and not an error.

## Deviations from Plan

**[Operational] node_modules symlink for test execution in worktree**
- **Found during:** Task 1 — `npm test` in the worktree directory failed because `node_modules` is not checked into git
- **Fix:** Symlinked `tauri-app/node_modules` from the main repo into the worktree (`ln -s`). This is a worktree-only filesystem concern; no source files changed.
- **Impact:** None on committed code; tests ran correctly with the symlink.

No source code deviations — plan executed exactly as written.

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED (test) | 4bdd49c | PASS — 5 tests fail (MergeCheckpointView missing) |
| GREEN (feat) | 9f86d5b | PASS — 51 tests pass |
| REFACTOR | n/a | Not needed |

## Threat Surface Scan

| Flag | File | Mitigation |
|------|------|------------|
| T-06-09 mitigated | MergeCheckpointView.tsx | Approve & Merge disabled when `anyAgentStillRunning` |
| T-06-10 mitigated | MergeCheckpointView.tsx | `window.confirm` gate before `mergeWorktrees` call |
| T-06-11 accepted | MergeCheckpointView.tsx | `agent.id` from agentStore (Rust-sourced), not arbitrary user input |

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| accordion.tsx exists | FOUND |
| grep "AccordionItem\|AccordionTrigger\|AccordionContent" accordion.tsx | FOUND |
| MergeCheckpointView.tsx exists | FOUND |
| grep "findConflicts" MergeCheckpointView.tsx | FOUND |
| grep "conflictPaths.has" MergeCheckpointView.tsx | FOUND |
| grep "window.confirm" MergeCheckpointView.tsx | FOUND |
| grep "Approve & Merge\|Merging…" MergeCheckpointView.tsx | FOUND |
| grep "No file changes in this worktree" MergeCheckpointView.tsx | FOUND |
| grep "1500" MergeCheckpointView.tsx | FOUND |
| grep "DiffView" MergeCheckpointView.tsx | FOUND |
| grep "Accordion" MergeCheckpointView.tsx | FOUND |
| MergeCheckpointView tests (5) | PASSED |
| All tests (51) | PASSED |
| grep "mergeCheckpointGroupId" App.tsx | FOUND |
| grep "MergeCheckpointView" App.tsx | FOUND |
| grep "expandedAgentId" App.tsx | FOUND |
| npx tsc --noEmit | 0 errors |
| npm run build | exits 0 |
| Commit d023954 (Task 0 accordion) | FOUND |
| Commit 4bdd49c (TDD RED) | FOUND |
| Commit 9f86d5b (Task 1 GREEN) | FOUND |
| Commit 6603cdc (Task 2 App.tsx) | FOUND |
| No file deletions in commits | CONFIRMED |
