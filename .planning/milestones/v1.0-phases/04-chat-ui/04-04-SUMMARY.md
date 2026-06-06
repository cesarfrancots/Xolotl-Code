---
phase: 04-chat-ui
plan: "04"
subsystem: message-rendering
tags: [react, typescript, virtualizer, markdown, rehype-highlight, streaming, clipboard]
dependency_graph:
  requires:
    - "04-01: npm deps (react-markdown, rehype-highlight, highlight.js, @tanstack/react-virtual, @tauri-apps/plugin-clipboard-manager, lucide-react), shadcn Button"
    - "04-02: chatStore.ts (useChatStore, Message, PermissionItem, ChatItem), cost.ts (formatTurnFootnote)"
    - "04-03: ChatPane.tsx placeholder div (replaced by MessageList)"
  provides:
    - "MarkdownRenderer: react-markdown + rehype-highlight + CopyButton (Tauri clipboard)"
    - "MessageItem: user/assistant/permission-placeholder renderer"
    - "StreamingMessage: partial markdown with animate-pulse cursor"
    - "MessageList: useVirtualizer with measureElement, overscan=5, estimateSize=80, auto-scroll"
    - "ChatPane: placeholder replaced with MessageList"
  affects:
    - "Plan 05 (ToolBlock/DiffView/PermissionCard) — replaces PermissionItem placeholder in Message.tsx"
    - "Plan 06 (event wiring) — MessageList is the display surface for streamed content"
tech_stack:
  added: []
  patterns:
    - "react-markdown + rehype-highlight (no rehypeRaw — XSS prevention T-4-04-01)"
    - "not-prose wrapper on code blocks (Tailwind typography vs hljs Pitfall 5)"
    - "useVirtualizer with measureElement ref + data-index on same element (RESEARCH.md Pattern 2)"
    - "Virtualizer streaming slot at index === items.length when isStreaming"
    - "Auto-scroll with near-bottom threshold (100px) to preserve scroll position on user scroll-up"
    - "Tauri clipboard-manager plugin with navigator.clipboard fallback"
key_files:
  created:
    - tauri-app/src/components/chat/MarkdownRenderer.tsx
    - tauri-app/src/components/chat/Message.tsx
    - tauri-app/src/components/chat/MessageList.tsx
  modified:
    - tauri-app/src/components/chat/ChatPane.tsx (placeholder div → MessageList)
    - tauri-app/src/components/chat/MessageInput.tsx (pre-existing unused var bug fix)
decisions:
  - "react-markdown v10 removed className prop from ReactMarkdown component — wrapped in div.prose instead"
  - "ChatPane message container uses flex-1 min-h-0 (not just flex-1) to ensure virtualizer scroll container gets non-zero height"
  - "PermissionItem placeholder renders amber card with tool name + preview; Plan 05 will replace with PermissionCard"
metrics:
  duration: "~15 minutes"
  completed: "2026-05-10"
  tasks_completed: 2
  files_created: 3
  files_modified: 2
---

# Phase 4 Plan 04: Message List Summary

**One-liner:** Virtualized message list (useVirtualizer + measureElement) with react-markdown/rehype-highlight rendering, Tauri clipboard copy button, streaming cursor, and per-turn cost footnote.

## Tasks Completed

| Task | Name | Commit | Key Output |
|------|------|--------|-----------|
| 1 | MarkdownRenderer with syntax highlighting and copy button | 6a44d25 | MarkdownRenderer.tsx, MessageInput.tsx (bug fix) |
| 2 | Message component and MessageList with virtualization | 1e34294 | Message.tsx, MessageList.tsx, ChatPane.tsx updated |

## Verification Results

1. `npx tsc --noEmit` — exits 0, no TypeScript errors
2. `grep "dangerouslySetInnerHTML" tauri-app/src/components/chat/` — returns nothing (XSS prevention)
3. `grep "rehypeRaw\|rehype-raw" MarkdownRenderer.tsx` — returns nothing (only comment)
4. `ref={virtualizer.measureElement}` and `data-index={vItem.index}` confirmed on same element
5. `animate-pulse` streaming cursor confirmed in Message.tsx
6. `grep "MessageList" ChatPane.tsx` — import and usage confirmed; placeholder div removed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] react-markdown v10 removed className prop from ReactMarkdown**
- **Found during:** Task 1 verification (`npx tsc --noEmit`)
- **Issue:** `react-markdown` v10 changed the component API — the `className` prop is no longer accepted directly on `<ReactMarkdown>`. Plan template used `<ReactMarkdown className="prose prose-sm max-w-none">`.
- **Fix:** Wrapped `<ReactMarkdown>` in a `<div className="prose prose-sm max-w-none">` container. The prose styling applies to all child markdown elements identically.
- **Files modified:** `tauri-app/src/components/chat/MarkdownRenderer.tsx`
- **Commit:** 6a44d25

**2. [Rule 1 - Bug] Pre-existing unused variables in MessageInput.tsx**
- **Found during:** Task 1 verification (`npx tsc --noEmit`)
- **Issue:** `appendItem` and `model` were destructured from `useChatStore()` in MessageInput.tsx but never used — both cause TS6133 errors with strict mode. Pre-existing from plan 03 (plan 03 SUMMARY does not list this as fixed).
- **Fix:** Removed `appendItem` and `model` from the destructuring. The send handler already accesses `appendItem` via `useChatStore.getState()`.
- **Files modified:** `tauri-app/src/components/chat/MessageInput.tsx`
- **Commit:** 6a44d25

**3. [Rule 2 - Missing] ChatPane flex container needs min-h-0 for virtualizer height**
- **Found during:** Task 2 implementation (structural analysis)
- **Issue:** Plan template showed `<MessageList />` directly inside the `flex-1` parent, but a flex child with `flex-1` does not shrink below its content height without `min-h-0`. The virtualizer's scroll container needs an explicit, non-zero, bounded height.
- **Fix:** Wrapped `<MessageList />` in `<div className="flex-1 min-h-0">` to ensure the virtualizer gets a measurable height.
- **Files modified:** `tauri-app/src/components/chat/ChatPane.tsx`
- **Commit:** 1e34294

## Known Stubs

| Stub | File | Description |
|------|------|-------------|
| PermissionItem placeholder | Message.tsx:22-30 | Renders amber border card with tool name + preview; Plan 05 replaces with full PermissionCard |

This stub is intentional per plan design — the PermissionItem renders correctly for the message list and the placeholder is visually distinguishable. Plan 05 will replace it with the interactive PermissionCard.

## Threat Surface Scan

Mitigations verified against plan's threat model:
- **T-4-04-01 (XSS):** No `dangerouslySetInnerHTML`; no `rehypeRaw` plugin; react-markdown sanitizes by default — VERIFIED
- **T-4-04-02 (Listener leak):** No `listen()` calls in any file created by this plan — VERIFIED
- **T-4-04-03 (Zero-height virtualizer):** MessageList uses `h-full` on scroll container; ChatPane uses `flex-1 min-h-0` (deviation 3); styles.css sets `html/body/#root height:100%` — VERIFIED

No new network endpoints, auth paths, or file access patterns introduced.

## Self-Check: PASSED

- [x] `tauri-app/src/components/chat/MarkdownRenderer.tsx` — `export function MarkdownRenderer` present, `rehypeHighlight`, `github-dark.css`, `not-prose`, `writeText` present
- [x] `tauri-app/src/components/chat/Message.tsx` — `export function MessageItem`, `export function StreamingMessage`, `animate-pulse` cursor present
- [x] `tauri-app/src/components/chat/MessageList.tsx` — `export function MessageList`, `useVirtualizer`, `measureElement`, `data-index` present
- [x] `tauri-app/src/components/chat/ChatPane.tsx` — `import { MessageList }` and `<MessageList />` present; placeholder div removed
- [x] TypeScript compiles clean (exits 0)
- [x] No `dangerouslySetInnerHTML` in any chat component
- [x] Commits 6a44d25, 1e34294 exist in git log
