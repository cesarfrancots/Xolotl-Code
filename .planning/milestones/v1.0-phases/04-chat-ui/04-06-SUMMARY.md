---
phase: 04-chat-ui
plan: "06"
subsystem: event-wiring
tags: [react, typescript, tauri, zustand, requestAnimationFrame, hooks]
dependency_graph:
  requires:
    - "04-02: chatStore.ts (appendStreamingContent, finalizeStream, startToolCall, completeToolCall, insertPermissionItem, resolvePermission, addAlwaysAllow, alwaysAllowedTools)"
    - "04-03: sessionStore.ts (saveSession, setActiveSessionId, serializeSession)"
    - "04-05: PermissionCard and ToolBlock — the display surfaces for events handled here"
    - "04-01: bindings.ts (AgentEvent discriminated union, commands.respondToPermission)"
  provides:
    - "useAgentEvents: Tauri event subscription hook — rAF-buffered TextDelta, tool call lifecycle, permission auto-respond"
    - "ChatPane: event subscriptions now active when agentId is set (end-to-end wiring complete)"
  affects:
    - "Full chat IPC pipeline now functional — agent turn output visible in UI"
tech_stack:
  added: []
  patterns:
    - "rAF buffer: TextDelta strings accumulate in useRef, flushed once per animation frame via requestAnimationFrame"
    - "Unlisten array: both listen() Promises push their UnlistenFn into unlisteners[]; all called on cleanup"
    - "AlwaysAllow auto-respond: alwaysAllowedTools.has() checked before insertPermissionItem; auto-responds immediately if already authorized"
    - "Optimistic TurnCompleted: pending rAF cancelled and buffer flushed before finalizeStream()"
    - "Session auto-save: generateSessionId() fallback (no crypto.randomUUID()) for WebView2 compat"
key_files:
  created:
    - tauri-app/src/hooks/useAgentEvents.ts
  modified:
    - tauri-app/src/components/chat/ChatPane.tsx
decisions:
  - "Used generateSessionId() (Date.now + Math.random) instead of globalThis.crypto.randomUUID() — avoids potential WebView2 version compatibility issue; both produce collision-resistant IDs for single-user local use"
  - "AgentEvent discriminated union guard pattern: 'ToolCallStarted' in payload && payload.ToolCallStarted — required by TypeScript because non-present variants are typed as '?: never' not absent, so a truthiness check is needed after 'in'"
  - "Did not add globalThis.crypto.randomUUID() per plan note — chose the explicit fallback function which is clearer and avoids any target lib concerns"
metrics:
  duration: "~4 minutes"
  completed: "2026-05-10"
  tasks_completed: 2
  files_created: 1
  files_modified: 1
---

# Phase 4 Plan 06: useAgentEvents Hook and ChatPane Wiring Summary

**One-liner:** rAF-buffered TextDelta hook with tool call lifecycle handlers, AlwaysAllow auto-respond, and session auto-save — wired into ChatPane to complete end-to-end Tauri IPC event flow.

## Tasks Completed

| Task | Name | Commit | Key Output |
|------|------|--------|-----------|
| 1 | useAgentEvents hook — rAF buffer, tool calls, permission events | 03e8352 | tauri-app/src/hooks/useAgentEvents.ts |
| 2 | Mount useAgentEvents in ChatPane; wire session auto-save | 91659be | ChatPane.tsx updated (3 lines) |

## Verification Results

1. `node_modules/.bin/tsc --noEmit` exits 0 (TypeScript clean — both tasks)
2. `vitest run` — 4 test files, 15 tests, all passed
3. `grep "return () =>"` — cleanup function present
4. `grep "for (const unlisten"` — all listeners cleaned up via unlisteners array
5. `grep "deltaBuffer.current +="` — buffer accumulation confirmed (not direct setState)
6. `grep "useChatStore.getState().appendStreamingContent"` — rAF dispatch confirmed (3 call sites)
7. `grep "alwaysAllowedTools.has"` — AlwaysAllow auto-respond check confirmed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript discriminated union narrowing for AgentEvent**
- **Found during:** Task 1 verification (tsc --noEmit)
- **Issue:** The `AgentEvent` discriminated union from bindings.ts marks non-present variant fields as `?: never`, so TypeScript sees `payload.ToolCallStarted` as `{ tool: string; input: string } | undefined` even after `"ToolCallStarted" in payload`. Direct destructuring caused TS2339 errors on tool, input, output, usage, and message fields.
- **Fix:** Added truthiness guard after `in` operator: `"ToolCallStarted" in payload && payload.ToolCallStarted`. Applied same pattern to ToolCallCompleted, TurnCompleted, and Error variants.
- **Files modified:** tauri-app/src/hooks/useAgentEvents.ts
- **Commit:** 03e8352 (inline fix before commit)

**2. [Rule 2 - Missing critical functionality] generateSessionId() fallback instead of crypto.randomUUID()**
- **Found during:** Task 1 — plan explicitly noted this as a preferred alternative
- **Issue:** `globalThis.crypto.randomUUID()` may not be available in older WebView2 builds; plan provided explicit fallback.
- **Fix:** Used `generateSessionId()` function with `Date.now() + Math.random().toString(36)` — collision-resistant for single-user local sessions, no browser API concerns.
- **Files modified:** tauri-app/src/hooks/useAgentEvents.ts
- **Commit:** 03e8352

## Known Stubs

None. All event handlers are fully wired:
- TextDelta → rAF buffer → appendStreamingContent → Zustand state → MessageList renders streamingContent
- TurnCompleted → finalizeStream → committed Message → session auto-save
- ToolCallStarted/Completed → startToolCall/completeToolCall → ToolBlock shows loading/output
- permission-request → insertPermissionItem or auto-respond → PermissionCard shows or silently approves

## Threat Surface Scan

All threats from the plan's threat model verified:

| Threat | ID | Mitigation | Status |
|--------|-----|-----------|--------|
| Listener accumulation | T-4-06-01 | useEffect cleanup calls all unlisteners; [agentId] dependency ensures single listener per agentId | VERIFIED |
| Stale closure in rAF callback | T-4-06-02 | appendStreamingContent uses functional update (set(state => ...)); rAF callback calls useChatStore.getState(), never captures stale refs | VERIFIED |
| Session auto-save O(N) file writes | T-4-06-03 | One sessionId per session, file overwritten each turn — O(1) disk writes; accepted | ACCEPTED |
| AlwaysAllow bypass | T-4-06-04 | alwaysAllowedTools.has() checked before insertPermissionItem; Set populated only by user explicit action via PermissionCard | VERIFIED |
| Error message info disclosure | T-4-06-05 | Single-user local dev tool — error context is a feature; accepted | ACCEPTED |

No new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Self-Check: PASSED

- [x] `tauri-app/src/hooks/useAgentEvents.ts` — `export function useAgentEvents`, `deltaBuffer`, `rafId`, `requestAnimationFrame`, `unlisteners`, `alwaysAllowedTools.has`, `generateSessionId`, no `import crypto`
- [x] `tauri-app/src/components/chat/ChatPane.tsx` — `import { useAgentEvents }`, `useAgentEvents(agentId)`, `agentId = useChatStore((s) => s.agentId)`, `MessageList`, `MessageInput`
- [x] Commit 03e8352 exists: `feat(04-06): implement useAgentEvents hook`
- [x] Commit 91659be exists: `feat(04-06): mount useAgentEvents in ChatPane`
- [x] tsc --noEmit exits 0
- [x] vitest run: 15/15 tests pass
