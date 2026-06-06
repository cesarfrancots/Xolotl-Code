---
phase: 05
plan: 06
subsystem: tauri-frontend-app-shell
tags: [react, app-shell, virtualized, expansion, agent-output]
dependency_graph:
  requires: [05-04, 05-05]
  provides: [AgentMessageList, AgentOutputView, App-3-column]
  affects:
    - tauri-app/src/App.tsx
    - tauri-app/src/components/agent/AgentMessageList.tsx
    - tauri-app/src/components/agent/AgentOutputView.tsx
tech_stack:
  added: []
  patterns:
    - "App.tsx reads expandedAgentId from agentStore to conditionally swap center pane"
    - "AgentMessageList mirrors MessageList.tsx virtualizer pattern against agentStore instead of chatStore"
    - "StreamingMessage reused from chat/Message.tsx for the in-progress streaming row"
    - "MessageItem reused from chat/Message.tsx for committed agent messages (existing export — no modification to Message.tsx needed)"
key_files:
  created:
    - tauri-app/src/components/agent/AgentMessageList.tsx
    - tauri-app/src/components/agent/AgentOutputView.tsx
  modified:
    - tauri-app/src/App.tsx
decisions:
  - "MessageItem import option A (existing export) — MessageItem was already exported from chat/Message.tsx; no surgical modification to Message.tsx required"
  - "StreamingMessage used for streaming row (not MessageItem with streaming prop) — MessageItem does not accept a streaming prop; StreamingMessage is the correct existing export for in-progress turns"
  - "AgentMessageList filters ChatItem defensively with role-in check — agent messages are always Message type but the ChatItem union includes PermissionItem; filter avoids future breakage"
  - "node_modules junction created in worktree via PowerShell New-Item -ItemType Junction — required to run tsc and npm run build from worktree directory"
metrics:
  duration: "~5 minutes"
  completed_date: "2026-05-10"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 1
  files_created: 2
---

# Phase 5 Plan 06: AgentMessageList + AgentOutputView + 3-Column App.tsx Summary

**Three-column App.tsx with conditional center pane (ChatPane or AgentOutputView based on expandedAgentId), virtualized AgentMessageList reading from agentStore, and read-only AgentOutputView with task header, state badge, cost display, and close button — tsc clean, production build succeeds.**

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | AgentMessageList + AgentOutputView | 03d92e0 | AgentMessageList.tsx, AgentOutputView.tsx |
| 2 | Extend App.tsx 3-column layout | 4f90489 | App.tsx |

## What Was Built

### `AgentMessageList.tsx`

Virtualized message list for an expanded agent's conversation. Mirrors `MessageList.tsx` exactly but reads from `agentStore` instead of `chatStore`.

Key implementation details:
- `useAgentStore(s => s.agents.find(a => a.id === agentId))` for per-agent record
- `@tanstack/react-virtual` `useVirtualizer` with `estimateSize: 80`, `overscan: 5`, `measureElement` for dynamic heights
- `StreamingMessage` renders the in-progress streaming row (same as `MessageList.tsx`)
- `MessageItem` renders committed messages — existing export from `chat/Message.tsx` (no modification needed)
- Auto-scroll to bottom when new items arrive or streaming content grows
- Defensive filter: skips non-Message items via `"role" in chatItem` check
- Empty state when no messages yet; agent-not-found state when record is missing

### `AgentOutputView.tsx`

Read-only center pane takeover (D-04/D-05/D-06):
- Top bar (h-12): `AgentStateBadge` + task description (truncated with `title` tooltip) + `$X.XXXX` cost + close button
- Close button calls `setExpandedAgent(null)` → center pane returns to `ChatPane` (D-06)
- No input bar (D-05 — observation only)
- `flex-1 min-w-0` root div matches `ChatPane` layout contract

### `App.tsx` (extended)

Upgraded from 2-column to 3-column layout:
```tsx
<SessionSidebar />
{expandedAgentId ? <AgentOutputView agentId={expandedAgentId} /> : <ChatPane />}
<AgentPanel />
```

`useAgentStore(s => s.expandedAgentId)` drives the conditional. All three columns always visible (D-01). No wrapper needed around the center — both `ChatPane` and `AgentOutputView` already use `flex-1 min-w-0`.

### MessageItem Import Strategy

**Option A chosen (existing export — no modification to Message.tsx).**

`grep "^export" tauri-app/src/components/chat/Message.tsx` revealed:
- `export function MessageItem({ item }: MessageItemProps)` — takes `item: Message | PermissionItem`
- `export function StreamingMessage({ content }: { content: string })` — for streaming rows

The plan's pseudocode used `message={item}` prop which was incorrect — the actual API is `item={chatItem}`. `StreamingMessage` handles streaming rows correctly without a `streaming` prop on `MessageItem`. Both exports reused unchanged from `chat/Message.tsx`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] node_modules junction required for tsc/build in worktree**

- **Found during:** Task 1 verification — `npx tsc --noEmit` returned "This is not the tsc command you are looking for" (global npx stub, not the project's TypeScript)
- **Issue:** Worktree's `tauri-app/` directory has no `node_modules/` — the 05-04 SUMMARY noted a junction was created for that worktree but this worktree did not have one
- **Fix:** Created Windows junction via `PowerShell New-Item -ItemType Junction` pointing worktree's `tauri-app/node_modules` → main repo's `tauri-app/node_modules`
- **Files modified:** Junction only — no tracked files changed
- **Impact:** Zero on committed code; required to run verification commands

### MessageItem Prop Mismatch (Plan Pseudocode vs Reality)

The plan's pseudocode used `<MessageItem message={item} streaming />` which does not match the actual `MessageItem` signature (`item` prop, no `streaming` prop). Corrected to:
- `<MessageItem item={chatItem as Message} />` for committed messages
- `<StreamingMessage content={streamingContent} />` for streaming rows

This is not a code deviation — the plan explicitly instructed to verify via grep and adjust accordingly.

## Known Stubs

None — all wiring uses real store state and existing rendering components. No hardcoded values.

## Threat Surface Scan

No new trust boundaries beyond the plan's `<threat_model>`.

| Threat ID | Status |
|-----------|--------|
| T-5-11 | Accepted — React text rendering escapes HTML; `title={record.task}` is plain text |
| T-5-07 | Mitigated — virtualizer reuses Phase 4 pattern (estimateSize 80, overscan 5, measureElement) |

## Self-Check

- [x] `tauri-app/src/components/agent/AgentMessageList.tsx` exists — 110 lines
- [x] `tauri-app/src/components/agent/AgentOutputView.tsx` exists — 52 lines
- [x] `tauri-app/src/App.tsx` modified — 31 lines (3-column layout)
- [x] Commit `03d92e0` exists (Task 1 — AgentMessageList + AgentOutputView)
- [x] Commit `4f90489` exists (Task 2 — App.tsx 3-column)
- [x] `grep -c "export function AgentMessageList" AgentMessageList.tsx` → 1
- [x] `grep -c "useVirtualizer" AgentMessageList.tsx` → 2
- [x] `grep -c "useAgentStore" AgentMessageList.tsx` → 2
- [x] `grep -c "export function AgentOutputView" AgentOutputView.tsx` → 1
- [x] `grep -c "<AgentMessageList" AgentOutputView.tsx` → 1
- [x] `grep -c "setExpanded(null)" AgentOutputView.tsx` → 1
- [x] `grep -c "MessageInput" AgentOutputView.tsx` → 0 (D-05)
- [x] `grep -c "import { AgentPanel }" App.tsx` → 1
- [x] `grep -c "import { AgentOutputView }" App.tsx` → 1
- [x] `grep -c "import { useAgentStore }" App.tsx` → 1
- [x] `grep -c "expandedAgentId ?" App.tsx` → 1
- [x] `grep -c "<AgentPanel />" App.tsx` → 1
- [x] `tsc --noEmit` → 0 errors (whole project)
- [x] `npm run build` → success (2331 modules, built in 2.77s)

## Self-Check: PASSED
