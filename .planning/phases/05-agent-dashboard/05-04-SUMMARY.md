---
phase: 05
plan: 04
subsystem: tauri-frontend-store
tags: [zustand, store, hook, streaming, tests, tdd]
dependency_graph:
  requires: [05-03]
  provides: [useAgentStore, AgentRecord, AgentStoreState, useAgentPanelEvents]
  affects:
    - tauri-app/src/stores/agentStore.ts
    - tauri-app/src/stores/agentStore.test.ts
    - tauri-app/src/hooks/useAgentPanelEvents.ts
tech_stack:
  added: ["@tauri-apps/plugin-notification@2.3.3 (installed — was in package.json but missing from node_modules)"]
  patterns: [zustand-functional-set, raf-delta-buffer, client-side-cost-estimate, lazy-notification-permission]
key_files:
  created:
    - tauri-app/src/stores/agentStore.ts
    - tauri-app/src/stores/agentStore.test.ts
    - tauri-app/src/hooks/useAgentPanelEvents.ts
  modified: []
decisions:
  - "completeAgentToolCall matches by client-side toolCallId (not tool name) — hook tracks tool→id mapping in pendingToolIds ref since ToolCallCompleted only provides tool name in bindings.ts"
  - "StateChanged guard uses && payload.StateChanged to satisfy TypeScript narrowing on the discriminated union"
  - "node_modules junction created in worktree pointing to main repo install — worktree does not have its own install"
metrics:
  duration: "7 minutes"
  completed_date: "2026-05-10"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 0
  files_created: 3
  tests_added: 12
  tests_total_after: 173
---

# Phase 5 Plan 04: agentStore + useAgentPanelEvents Summary

**One-liner:** Zustand agentStore (roster + per-agent messages + streaming + cost accumulation) with 12 passing tests, and useAgentPanelEvents hook (rAF-buffered TextDelta, per-agent event subscription, OS notification on Done/Failed with T-5-03 title cap).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing tests for agentStore | b57bc19 | agentStore.test.ts |
| 1 (GREEN) | Implement agentStore.ts | 34b9e25 | agentStore.ts |
| 2 | Create useAgentPanelEvents.ts hook | de850fc | useAgentPanelEvents.ts |

## What Was Built

### `agentStore.ts`

Zustand store with full `AgentRecord` type and `AgentStoreState` interface.

`AgentRecord` fields: `id`, `task`, `model`, `state` (AgentState), `cumulativeCost`, `messages: ChatItem[]`, `streamingContent`, `isStreaming`.

Nine actions:
- `addAgent(id, task, model)` — appends Idle record with zero cost
- `updateAgentState(id, state)` — mutates only the matching agent
- `appendAgentStreamingContent(id, delta)` — accumulates TextDelta, sets isStreaming
- `finalizeAgentStream(id, usage)` — commits message, resets streaming, increments cumulativeCost
- `startAgentToolCall(id, toolCallId, tool, input)` — appends ToolCall to last assistant message or creates placeholder
- `completeAgentToolCall(id, toolCallId, output)` — resolves by id, sets loading: false
- `appendAgentError(id, message)` — pushes assistant message with `stopped: true`
- `setExpandedAgent(id)` — sets center-pane expansion target

`estimateTurnCost()` with per-model rates:
```
claude-sonnet-4 / claude-sonnet-4-5: $3/$15 per 1M in/out
claude-opus-4: $15/$75 per 1M in/out
kimi-k2: $0.15/$2.5 per 1M in/out
minimax-m1: $0.3/$1.65 per 1M in/out
Default (unknown model): sonnet pricing
```

### `agentStore.test.ts`

12 tests passing. Covers all required behaviors:
- `addAgent` default initialization
- Per-agent model isolation (AGT-05)
- `updateAgentState` targets only matching agent
- `appendAgentStreamingContent` accumulates; cross-agent isolation verified
- `finalizeAgentStream` commits message, resets state
- `finalizeAgentStream` cost accumulation verified numerically (0.0105 for 1000 in + 500 out at sonnet rates)
- `finalizeAgentStream` is no-op when nothing was streaming
- `startAgentToolCall` creates placeholder assistant message when no prior message exists
- `completeAgentToolCall` resolves by id, sets loading: false + output
- `appendAgentError` produces assistant message with `stopped: true` containing error text
- `setExpandedAgent` toggles expandedAgentId

### `useAgentPanelEvents.ts`

Fork of `useAgentEvents.ts` targeting `agentStore` instead of `chatStore`.

Event handling:
- `TextDelta` — buffered in `deltaBuffer.current` ref, flushed via single rAF per batch
- `ToolCallStarted` — generates client-side `tc-{timestamp}-{random}` id, stored in `pendingToolIds` ref
- `ToolCallCompleted` — resolves pending tool id from `pendingToolIds` map, calls `completeAgentToolCall`
- `TurnCompleted` — cancels pending rAF, flushes buffer, calls `finalizeAgentStream`
- `StateChanged` — calls `updateAgentState`; fires `fireDoneNotification` on Done/Failed
- `Error` — calls `appendAgentError`

Notification:
- `fireDoneNotification()` — async, lazy permission grant (cached in `notifPermissionGranted`)
- T-5-03: title = `record.task.slice(0, 60)` — caps user-controlled string before OS notification
- Body: `"${state} — $${cost.toFixed(4)}"`
- T-5-07: cleanup returns cancel rAF + run all unlisteners

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `@tauri-apps/plugin-notification` not installed**

- **Found during:** Task 2 `tsc --noEmit` check
- **Issue:** `@tauri-apps/plugin-notification@2.3.3` was declared in `package.json` but not present in `node_modules` (plan 05-01/02 added the Cargo.toml entry but npm install was not run in the tauri-app directory)
- **Fix:** Ran `npm install @tauri-apps/plugin-notification@2.3.3` in the main repo tauri-app directory. No package.json change needed (already declared).
- **Files modified:** `tauri-app/package-lock.json` (main repo, not worktree — committed separately by orchestrator)
- **Impact:** Zero — type declarations now resolve; no functional behavior change

**2. [Rule 1 - Bug] `ToolCallCompleted` in bindings.ts uses `{ tool, output }` not `{ id, output }`**

- **Found during:** Task 2 implementation review of actual bindings.ts vs plan's interface block
- **Issue:** The plan's `<interfaces>` block showed `ToolCallCompleted: { id: string; output: string }` but actual `bindings.ts` has `ToolCallCompleted: { tool: string; output: string }` (tool name, not id). Same discrepancy for `ToolCallStarted` (no `id` field in actual bindings).
- **Fix:** Hook generates client-side `toolCallId` on `ToolCallStarted` and stores it in `pendingToolIds: Map<string, string>` ref keyed by tool name. On `ToolCallCompleted`, looks up the id from the map. This matches how `useAgentEvents.ts` handles the same discrepancy (generating client-side ids there too). The store's `completeAgentToolCall(id, toolCallId, output)` signature remains correct.
- **Impact:** None — behavior is identical to the desired spec; adapts to actual IPC types

**3. [Rule 1 - Bug] TypeScript narrowing issue with `StateChanged` union discriminant**

- **Found during:** Task 2 `tsc --noEmit`
- **Issue:** TypeScript reported `AgentState | undefined` for `payload.StateChanged` after `"StateChanged" in payload` guard — the discriminated union type in bindings.ts requires an additional truthy check to narrow correctly.
- **Fix:** Changed `if ("StateChanged" in payload)` to `if ("StateChanged" in payload && payload.StateChanged)`.
- **Files modified:** `useAgentPanelEvents.ts`

## Known Stubs

None — agentStore and useAgentPanelEvents implement real logic. No hardcoded values or placeholder content.

## Threat Surface Scan

No new trust boundaries beyond the plan's `<threat_model>`. All STRIDE mitigations applied:

| Threat ID | Status |
|-----------|--------|
| T-5-03 | Mitigated — `record.task.slice(0, 60)` caps title before sendNotification |
| T-5-07 | Mitigated — cleanup callback cancels rafId and runs all unlisteners |
| T-5-08 | Accepted — notifications fire on all Done/Failed per D-14 user decision |

## Self-Check

- [x] `tauri-app/src/stores/agentStore.ts` exists — 206 lines
- [x] `tauri-app/src/stores/agentStore.test.ts` exists — 160 lines, 12 tests
- [x] `tauri-app/src/hooks/useAgentPanelEvents.ts` exists — 158 lines
- [x] Commit `b57bc19` exists (RED — failing tests)
- [x] Commit `34b9e25` exists (GREEN — agentStore implementation)
- [x] Commit `de850fc` exists (useAgentPanelEvents hook)
- [x] `npx vitest run src/stores/agentStore.test.ts` — 12/12 tests pass
- [x] `npx tsc --noEmit` — 0 errors in new files (pre-existing MessageInput.tsx error from 05-03 not introduced by this plan)

## Self-Check: PASSED

## TDD Gate Compliance

- [x] RED gate: `test(05-04): add failing tests for agentStore (RED)` — commit `b57bc19`
- [x] GREEN gate: `feat(05-04): implement agentStore.ts Zustand store (GREEN)` — commit `34b9e25`
