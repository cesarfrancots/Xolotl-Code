---
phase: 04-chat-ui
plan: "05"
subsystem: tool-call-ui
tags: [react, typescript, collapsible, diff, permissions, zustand, tauri]
dependency_graph:
  requires:
    - "04-01: npm deps (lucide-react, shadcn collapsible/card/button/badge), diff package"
    - "04-02: chatStore.ts (ToolCall, PermissionItem, resolvePermission, addAlwaysAllow)"
    - "04-04: Message.tsx (PermissionItem placeholder to replace, AssistantMessage to extend)"
  provides:
    - "DiffView: line diff renderer with green/red React children (no HTML injection)"
    - "ToolBlock: collapsible tool call card with bash truncation and DiffView integration"
    - "PermissionCard: 3-button inline permission prompt resolving to badge state"
    - "Message.tsx: PermissionCard wired (replaces placeholder), ToolBlock list below content"
  affects:
    - "Plan 06 (event wiring) — PermissionCard is the display surface for PermissionRequest events"
tech_stack:
  added: []
  patterns:
    - "DiffView: React children only, never dangerouslySetInnerHTML (T-4-05-01 mitigation)"
    - "ToolBlock: Radix Collapsible (shadcn) with controlled open state, default collapsed"
    - "PermissionCard: optimistic UI — store resolved immediately, Tauri command awaited after"
    - "isResolved gate: ResolvedBadge replaces buttons after decision (T-4-05-03 mitigation)"
    - "Bash truncation: TRUNCATE_AT=2000, showFullOutput state, 'Show N more characters' link"
    - "DiffView in ToolBlock: <<<BEFORE/>>>AFTER marker parsing for structured diff output"
key_files:
  created:
    - tauri-app/src/components/chat/DiffView.tsx
    - tauri-app/src/components/chat/ToolBlock.tsx
    - tauri-app/src/components/chat/PermissionCard.tsx
  modified:
    - tauri-app/src/components/chat/Message.tsx (PermissionCard + ToolBlock wired)
decisions:
  - "PermissionCard uses optimistic UI: resolvePermission/addAlwaysAllow called before awaiting respondToPermission to eliminate visible latency on user decision"
  - "ToolBlock DiffView: structured <<<BEFORE/>>>AFTER marker format; raw tool output not auto-diffed (would require old content which ToolCall.input does not carry)"
  - "DiffView null-returns on empty changes array to avoid rendering empty bordered box"
metrics:
  duration: "~5 minutes"
  completed: "2026-05-10"
  tasks_completed: 3
  files_created: 3
  files_modified: 1
---

# Phase 4 Plan 05: Tool Blocks, Diff View, and Permission Cards Summary

**One-liner:** Collapsible ToolBlock with 2000-char bash truncation, DiffView line-diff renderer via React children (XSS-safe), and PermissionCard with 3-button optimistic decision flow wired to Tauri + Zustand.

## Tasks Completed

| Task | Name | Commit | Key Output |
|------|------|--------|-----------|
| 1 | DiffView — line diff with green/red coloring | a9cfd2e | DiffView.tsx |
| 2 | ToolBlock — collapsible card with bash truncation | 0c9246f | ToolBlock.tsx |
| 3 | PermissionCard and update Message.tsx | ee2fed2 | PermissionCard.tsx, Message.tsx updated |

## Verification Results

1. `grep "dangerouslySetInnerHTML" DiffView.tsx ToolBlock.tsx PermissionCard.tsx` — only comment in DiffView.tsx, no actual usage (XSS prevention VERIFIED)
2. `grep "isResolved" PermissionCard.tsx` — gate confirmed; buttons hidden after decision (T-4-05-03 VERIFIED)
3. `grep "Allow.*Deny.*Always Allow"` — copywriting confirmed per 04-UI-SPEC.md
4. `grep "PermissionCard" Message.tsx` — placeholder replaced with real import + usage
5. `grep "ToolBlock" Message.tsx` — ToolBlock list rendered below assistant message content
6. TypeScript structure verified against chatStore interfaces and bindings.ts types

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. All plan artifacts are fully wired:
- DiffView uses real `computeLineDiff` from diff.ts
- ToolBlock imports DiffView and ToolCall type from chatStore
- PermissionCard imports `commands.respondToPermission` from bindings.ts and both store actions

## Threat Surface Scan

All threats from the plan's threat model mitigated:

| Threat | ID | Mitigation | Status |
|--------|-----|-----------|--------|
| XSS via diff HTML | T-4-05-01 | DiffView renders React text children only; no dangerouslySetInnerHTML | VERIFIED |
| XSS via tool output | T-4-05-02 | ToolBlock uses `<pre>` with React string children; no HTML parsing | VERIFIED |
| Double-respond permission | T-4-05-03 | isResolved check replaces buttons with ResolvedBadge after decision | VERIFIED |
| AlwaysAllow bypass | T-4-05-04 | addAlwaysAllow called in PermissionCard; alwaysAllowedTools Set updated in store | VERIFIED (Plan 06 will check this set before inserting PermissionItem) |

No new network endpoints, auth paths, or file access patterns introduced.

## Self-Check: PASSED

- [x] `tauri-app/src/components/chat/DiffView.tsx` — `export function DiffView`, `computeLineDiff`, `bg-green-900/40`, `bg-red-900/40`, no `dangerouslySetInnerHTML` code
- [x] `tauri-app/src/components/chat/ToolBlock.tsx` — `export function ToolBlock`, `TRUNCATE_AT = 2000`, `useState(false)`, `DiffView`, `Loader2`, `animate-spin`
- [x] `tauri-app/src/components/chat/PermissionCard.tsx` — `export function PermissionCard`, `respondToPermission`, `resolvePermission`, `addAlwaysAllow`, `isResolved`, Allow/Deny/Always Allow buttons
- [x] `tauri-app/src/components/chat/Message.tsx` — `import { PermissionCard }`, `import { ToolBlock }`, `<PermissionCard item={...} />`, `<ToolBlock key={...} toolCall={...} />`
- [x] Commits a9cfd2e, 0c9246f, ee2fed2 exist in git log
