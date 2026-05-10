---
phase: 04-chat-ui
plan: "03"
subsystem: ui-shell
tags: [react, typescript, tailwind, zustand, shadcn, layout]
dependency_graph:
  requires:
    - "04-01 (npm deps, shadcn components, bindings.ts, styles.css)"
  provides:
    - "App.tsx 2-column flex layout shell"
    - "SessionSidebar with empty state, session list, new/delete buttons"
    - "SessionItem with hover-delete, active accent border"
    - "ChatPane with model selector dropdown and cost display top bar"
    - "StopButton (visible only during isStreaming)"
    - "MessageInput with auto-resize textarea, send button, slash palette"
    - "cost.ts utility (formatCostBar, calcTurnCost, formatCost, formatTokens)"
    - "chatStore.ts Zustand store (all streaming actions)"
    - "sessionStore.ts Zustand store (load/delete/save session)"
  affects:
    - "tauri-app frontend — all wave 3+ plans build on this layout shell"
    - "Plan 04 (MessageList) replaces the placeholder div in ChatPane"
tech_stack:
  added: []
  patterns:
    - "Zustand store with functional updates (avoid stale closures)"
    - "shadcn Command with shouldFilter=false + manual filter for slash palette"
    - "Tailwind oklch color tokens for dark-only design"
    - "Auto-resize textarea with scrollHeight clamped to 192px"
    - "Group hover pattern for delete button (opacity-0 group-hover:opacity-100)"
key_files:
  created:
    - tauri-app/src/App.tsx (replaced scaffold with 2-column layout)
    - tauri-app/src/components/sidebar/SessionSidebar.tsx
    - tauri-app/src/components/sidebar/SessionItem.tsx
    - tauri-app/src/components/chat/ChatPane.tsx
    - tauri-app/src/components/chat/MessageInput.tsx
    - tauri-app/src/lib/cost.ts
    - tauri-app/src/stores/chatStore.ts
    - tauri-app/src/stores/sessionStore.ts
  modified: []
decisions:
  - "Created chatStore.ts and sessionStore.ts here (plan 02 runs in parallel; needed for tsc compilation — Rule 3)"
  - "cost.ts created here because ChatPane imports formatCostBar (parallel plan dependency)"
  - "Fixed missing closing brace in /save switch case from plan template"
  - "Removed unnecessary useSessionStore import from ChatPane (noUnusedLocals strict)"
metrics:
  duration: "~10 minutes"
  completed: "2026-05-10"
  tasks_completed: 3
  files_created: 7
  files_modified: 1
---

# Phase 4 Plan 03: App Shell Layout Summary

**One-liner:** 2-column Tauri app shell with SessionSidebar (w-64), ChatPane with model selector/stop button, auto-resize MessageInput with slash palette (shouldFilter=false), and Zustand stores for chat and session state.

## Tasks Completed

| Task | Name | Commit | Key Output |
|------|------|--------|-----------|
| 1 | App.tsx 2-column layout shell | 41a6fbc | App.tsx replaced, cost.ts, chatStore.ts, sessionStore.ts |
| 2 | SessionSidebar and SessionItem | ee44c02 | SessionSidebar.tsx, SessionItem.tsx |
| 3 | ChatPane with TopBar and MessageInput | d92b6fa | ChatPane.tsx, MessageInput.tsx |

## Verification Results

1. `npx tsc --noEmit` — exits 0, no TypeScript errors
2. `grep "shouldFilter={false}"` — confirmed in MessageInput.tsx (Pitfall 8 mitigation)
3. `grep "h-screen w-screen flex flex-row"` — confirmed in App.tsx root div
4. `grep "data-placeholder"` — confirmed message list placeholder div in ChatPane.tsx
5. `grep "height: 100%"` — confirmed in styles.css (html/body/#root constraint)
6. `grep "h-screen"` — confirmed in App.tsx root div
7. Scaffold removed: no greet/useState/invoke/reactLogo in App.tsx

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Stores not available (plan 02 runs in parallel)**
- **Found during:** Task 1 verification
- **Issue:** ChatPane, SessionSidebar, and MessageInput all import from stores that plan 02 creates. Since plans run in parallel, the stores didn't exist when plan 03 started. TypeScript can't compile without them.
- **Fix:** Created chatStore.ts and sessionStore.ts with the exact same implementation as plan 02 specifies (read from plan 02 spec). Also created cost.ts since ChatPane imports formatCostBar.
- **Files modified:** tauri-app/src/stores/chatStore.ts, tauri-app/src/stores/sessionStore.ts, tauri-app/src/lib/cost.ts
- **Commit:** 41a6fbc
- **Note:** When plan 02 is merged, its store files will be identical (same spec) or will supersede these. No conflict expected.

**2. [Rule 1 - Bug] Missing closing brace in /save case of switch statement**
- **Found during:** Task 3 (MessageInput.tsx)
- **Issue:** Plan template had `case "/save": {` ... `break;` immediately followed by `case "/load":` — the closing `}` for the `/save` block was missing, making the code syntactically invalid.
- **Fix:** Added the missing `}` closing brace after `break;` in the `/save` case.
- **Files modified:** tauri-app/src/components/chat/MessageInput.tsx
- **Commit:** d92b6fa

**3. [Rule 1 - Bug] Unnecessary useSessionStore import in ChatPane**
- **Found during:** Task 3 (ChatPane.tsx TypeScript strict check)
- **Issue:** Plan template imported useSessionStore in ChatPane but never used it (noUnusedLocals would error).
- **Fix:** Removed the unused import.
- **Files modified:** tauri-app/src/components/chat/ChatPane.tsx
- **Commit:** d92b6fa

**4. [Rule 3 - Blocking] npm install required before tsc**
- **Found during:** Task 1 verification
- **Issue:** node_modules was not populated in the worktree context; npx tsc failed with "module not found" for all shadcn/radix/zustand dependencies.
- **Fix:** `npm install` run in tauri-app/ — all 597 packages installed.
- **Files modified:** (no tracked files changed — node_modules is gitignored)

## Known Stubs

| Stub | File | Description |
|------|------|-------------|
| Message list placeholder div | ChatPane.tsx:71 | `data-placeholder="message-list"` empty div — Plan 04 will replace with MessageList + virtualizer |
| `/load` command no-op | MessageInput.tsx | The /load slash command is a no-op; Wave 3 wiring deferred to Plan 05 |
| `/model` command no-op | MessageInput.tsx | The /model slash command closes palette but doesn't open model picker; picker is in top bar |
| Session hydration on resume | SessionSidebar.tsx | handleResumeSession only sets activeSessionId; loadSession() wiring deferred to Wave 3 |

These stubs are intentional per plan design. The plan's goal (shell layout + interactive input) is achieved.

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns beyond the plan's threat model. All threat model items verified:

- T-4-03-01: Command items hardcoded strings (not user-controlled) — confirmed in MessageInput.tsx SLASH_COMMANDS array
- T-4-03-02: /save writes chatStore items (not user-string-controlled) — accepted for local single-user app
- T-4-03-03: max-h-[192px] cap enforced with overflow-y-auto — confirmed in textarea className

## Self-Check: PASSED

- [x] tauri-app/src/App.tsx — h-screen w-screen flex flex-row layout present
- [x] tauri-app/src/components/sidebar/SessionSidebar.tsx — w-64 flex-none sidebar, empty state, session list
- [x] tauri-app/src/components/sidebar/SessionItem.tsx — hover delete, active border
- [x] tauri-app/src/components/chat/ChatPane.tsx — top bar, model selector, cost display, stop button, placeholder
- [x] tauri-app/src/components/chat/MessageInput.tsx — textarea, send button, slash palette, shouldFilter=false
- [x] tauri-app/src/lib/cost.ts — formatCostBar, calcTurnCost, formatCost, formatTokens
- [x] tauri-app/src/stores/chatStore.ts — useChatStore with all streaming actions
- [x] tauri-app/src/stores/sessionStore.ts — useSessionStore with load/delete/save
- [x] Commits 41a6fbc, ee44c02, d92b6fa exist in git log
