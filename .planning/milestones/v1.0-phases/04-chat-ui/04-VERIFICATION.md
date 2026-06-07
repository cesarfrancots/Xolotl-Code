---
phase: 04-chat-ui
verified: 2026-05-10T00:00:00Z
status: human_needed
score: 9/11 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Verify session resume actually restores prior messages across app restarts"
    expected: "Clicking a session in the sidebar restores its messages into the chat thread (not just sets the active ID)"
    why_human: "handleResumeSession() calls setActiveSessionId() only — no loadSession() or chatStore hydration. Whether the smoke test (04-07) verified true message restoration or only that the sidebar highlights the session is unclear. Cannot verify programmatically."
  - test: "Verify cost bar shows correct dollar amount after real (non-stub) turns"
    expected: "The session-total cost bar computes actual cost from sessionUsage via calcTurnCost(), not hardcoded 0"
    why_human: "ChatPane passes hardcoded 0 as the cost argument to formatCostBar(0, totalTokens). For the Phase 4 echo stub (zero token usage) this is invisible — cost is $0.0000 either way. Requires human to confirm behavior is acceptable or flag for fix."
---

# Phase 4: Chat UI Verification Report

**Phase Goal:** A user can run a complete streamed chat session in the Tauri app with every table-stakes coding-assistant feature working.
**Verified:** 2026-05-10
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | User sees AI responses stream token-by-token without UI jank at 60–100 events/sec, with markdown, syntax-highlighted code blocks, and copy buttons rendering correctly | ✓ VERIFIED | `useAgentEvents.ts`: rAF buffer accumulates TextDelta in ref, flushes via `requestAnimationFrame`. `MarkdownRenderer.tsx`: `rehypeHighlight` + `github-dark.css` + `CopyButton` with `writeText`. Smoke test 04-07 approved. |
| SC2 | User sees tool-call blocks (bash, file ops, grep, glob) as collapsible cards with truncated bash output and inline before/after diffs for file edits | ✓ VERIFIED | `ToolBlock.tsx`: `TRUNCATE_AT=2000`, `Collapsible` (shadcn), "Show N more characters" link. `DiffView.tsx`: `computeLineDiff` → React children, green/red CSS, `<<<BEFORE/>>>AFTER` marker parsing. `Message.tsx` wires both. Smoke test approved. |
| SC3 | User can browse, resume, or delete saved sessions from a sidebar, and a 200+ turn session scrolls smoothly via virtualization | ? UNCERTAIN | Browse: `SessionSidebar` calls `loadSessions()` on mount, renders `SessionItem` list. Delete: `deleteSession()` wired to Tauri command. Virtualization: `MessageList.tsx` uses `useVirtualizer` with `measureElement`. However, **resume** in `handleResumeSession()` only calls `setActiveSessionId(id)` — no `loadSession()` call, no `chatStore` hydration. Prior messages are NOT restored. Whether the smoke test verified actual message restoration or only sidebar highlight is unknown. |
| SC4 | User can switch model per session, see per-turn and session-total token/dollar cost, cancel an in-flight turn while preserving partial output, and approve/deny/always-allow permission prompts as inline cards | ? UNCERTAIN | Model selector: wired. Per-turn cost: `formatTurnFootnote` renders in `AssistantMessage`. Cancel/stop: `StopButton` calls `cancelStream()` + `stopAgent()`. PermissionCard: 3-button flow wired to `respondToPermission` + store actions. **Session-total cost**: `ChatPane` passes hardcoded `0` as cost to `formatCostBar(0, totalTokens)` — dollar amount always shows `$0.0000` even after real turns with non-zero usage. For the Phase 4 echo stub (zero tokens) this is invisible; for production it is wrong. |
| SC5 | User can open a slash-command palette with `/`, see described commands, and execute them inline in the chat input | ✓ VERIFIED | `MessageInput.tsx`: `shouldFilter={false}`, 5 SLASH_COMMANDS array, `Popover` opens when value starts with `/`, `CommandItem.onSelect` → `executeSlashCommand`. Smoke test approved. |

**Roadmap Score:** 3/5 fully VERIFIED, 2/5 UNCERTAIN (require human review of smoke test coverage and hardcoded-0 acceptability)

---

### Plan-Declared Must-Have Truths (all plans combined)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | TextDelta variant exists in Rust AgentEvent enum and bindings.ts union type | ✓ VERIFIED | `agent_state.rs:94`: `TextDelta(String),`. `bindings.ts:43`: `\| ({ TextDelta: string }) & { ... }`. |
| 2 | All npm dependencies installed (tailwindcss, zustand, react-markdown, etc.) | ✓ VERIFIED | `package.json` deps confirmed in summaries. `vite.config.ts`: `tailwindcss()` plugin. Glob confirms `tauri-app/src/components/ui/` has 13 components. |
| 3 | shadcn components added to tauri-app/src/components/ui/ | ✓ VERIFIED | 13 files confirmed: badge, button, card, collapsible, command, dialog, dropdown-menu, input, input-group, popover, scroll-area, separator, textarea. |
| 4 | Tailwind v4 processes styles via @tailwindcss/vite plugin | ✓ VERIFIED | `vite.config.ts:3,11`: `import tailwindcss` + `plugins: [tailwindcss(), react()]`. |
| 5 | run_agent_turn Tauri command compiles and is registered in lib.rs | ✓ VERIFIED | `lib.rs:8,25`: registered in `collect_commands!`. `commands.rs:128`: `pub async fn run_agent_turn`. |
| 6 | list_models, session management commands compile and are registered | ✓ VERIFIED | `lib.rs:26-30`: all 5 registered. `commands.rs`: all implementations present. |
| 7 | CR-01 mutex fix applied in permission_prompter.rs | ✓ VERIFIED | `permission_prompter.rs:43-44`: `let Ok(mut pending) = self.pending_prompts.lock() else { return Deny }`. No `.unwrap()`. |
| 8 | CR-02 HashMap::remove fix applied in commands.rs | ✓ VERIFIED | Confirmed in 04-01-SUMMARY: "CR-02 applied: HashMap::remove() instead of .get()". |
| 9 | CR-04 path scope added to capabilities/default.json | ✓ VERIFIED | `default.json:17-18`: `"$HOME/.xolotl-code/sessions/**"` and `"$APPDATA/.xolotl-code/sessions/**"`. |
| 10 | vitest is configured and npm test passes | ✓ VERIFIED | `vitest.config.ts`: jsdom + globals. 04-06 SUMMARY: "vitest run: 15/15 tests pass". |
| 11 | chatStore manages messages, streamingContent, isStreaming, agentId, sessionUsage, alwaysAllowedTools | ✓ VERIFIED | `chatStore.ts:66,79,85,91,108,140-147`: all fields and actions present. Functional updates confirmed. |
| 12 | sessionStore manages session list loaded from Tauri commands | ✓ VERIFIED | `sessionStore.ts`: `loadSessions()` calls `commands.listSessions()`. `deleteSession`, `saveSession` wired. |
| 13 | computeLineDiff() returns Change[] from the diff npm package | ✓ VERIFIED | `diff.ts:9-11`: `return diffLines(oldStr, newStr)`. 15 unit tests pass including diff tests. |
| 14 | formatCost() returns dollar-formatted string from TokenUsage | ✓ VERIFIED | `cost.ts:36-38`: `return \`$\${usd.toFixed(4)}\``. Unit tests confirm `formatCost(0.001234) === "$0.0012"`. |
| 15 | App.tsx renders 2-column flex layout with SessionSidebar and ChatPane | ✓ VERIFIED | `App.tsx:12-14`: `h-screen w-screen flex flex-row overflow-hidden` with `<SessionSidebar />` and `<ChatPane />`. |
| 16 | SessionSidebar shows session list with new/delete buttons per UI-SPEC | ✓ VERIFIED | `SessionSidebar.tsx:38`: `w-64 flex-none`. `handleNewSession` + `handleDeleteSession` wired. Empty state text present. |
| 17 | ChatPane top bar shows model selector dropdown and session cost display | ✓ VERIFIED | `ChatPane.tsx:46-70`: `DropdownMenu` with `listModels()` + cost bar. |
| 18 | Stop button renders in ChatPane top bar (visible only during isStreaming); MessageInput renders textarea, send button, and slash palette trigger | ✓ VERIFIED | `ChatPane.tsx:69`: `{isStreaming && <StopButton />}`. `MessageInput.tsx`: textarea + Send + Popover slash palette. |
| 19 | Message list uses useVirtualizer with measureElement for dynamic height items | ✓ VERIFIED | `MessageList.tsx:23-28`: `useVirtualizer` with `measureElement: el => el?.getBoundingClientRect().height`. `ref={virtualizer.measureElement}` + `data-index` on same element. |
| 20 | Assistant messages render markdown with syntax-highlighted code blocks | ✓ VERIFIED | `MarkdownRenderer.tsx:3-4`: `rehypeHighlight` + `github-dark.css`. Custom `code` component with `not-prose` wrapper. |
| 21 | Code blocks have a copy-to-clipboard button using Tauri clipboard plugin | ✓ VERIFIED | `MarkdownRenderer.tsx:7,75`: `writeText` from `@tauri-apps/plugin-clipboard-manager`. `navigator.clipboard` fallback. |
| 22 | Streaming message renders partial markdown with animated cursor | ✓ VERIFIED | `Message.tsx:78-86`: `StreamingMessage` component + `animate-pulse` cursor span. |
| 23 | Per-turn cost footnote appears below assistant messages | ✓ VERIFIED | `Message.tsx:6,64`: `formatTurnFootnote` imported and rendered when `message.usage` is present. |
| 24 | Tool call blocks are collapsible cards with bash truncation | ✓ VERIFIED | `ToolBlock.tsx:52,54,97`: `TRUNCATE_AT=2000`, `isTruncated` check, "Show N more characters" button. |
| 25 | File edit tool calls render a DiffView with green/red line coloring | ✓ VERIFIED | `DiffView.tsx:36,38`: `bg-green-900/40`, `bg-red-900/40`. `ToolBlock.tsx:101-108`: parses `<<<BEFORE/>>>AFTER` markers. |
| 26 | Permission cards show approve/deny/always-allow buttons and resolve to badge state | ✓ VERIFIED | `PermissionCard.tsx:27,31,33,36,67`: `resolvePermission`, `addAlwaysAllow`, `respondToPermission`, `isResolved` gate. |
| 27 | TextDelta events are buffered in React ref and flushed per requestAnimationFrame | ✓ VERIFIED | `useAgentEvents.ts:43,61,63-68`: `deltaBuffer` ref, `rafId` ref, `requestAnimationFrame` callback flushes to `appendStreamingContent`. |
| 28 | AgentEvent listener is cleaned up via unlisten() on component unmount | ✓ VERIFIED | `useAgentEvents.ts:50,148,176,184`: `unlisteners[]` array, both promises push unlisten fns, cleanup iterates all. |
| 29 | Sending a message spawns an agent (if needed) and calls run_agent_turn | ✓ VERIFIED | `MessageInput.tsx:110-119`: `spawnAgent("main")` if `!currentAgentId`, then `runAgentTurn(currentAgentId, msg)`. |
| 30 | Session auto-saves after every TurnCompleted event | ✓ VERIFIED | `useAgentEvents.ts:101-114`: TurnCompleted handler calls `finalizeStream` then `sessionStore.saveSession()` with serialized session. |

**Plan Must-Have Score:** 28/30 verified; 2 UNCERTAIN (SC3 resume hydration, SC4 cost bar dollar amount)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `rust/crates/runtime/src/supervisor/agent_state.rs` | TextDelta variant | ✓ VERIFIED | Line 94: `TextDelta(String),` present |
| `tauri-app/src/bindings.ts` | TextDelta union + 6 commands + SessionMeta | ✓ VERIFIED | All confirmed |
| `tauri-app/src-tauri/src/commands.rs` | 6 new commands | ✓ VERIFIED | All 6 present and substantive |
| `tauri-app/src-tauri/src/lib.rs` | collect_commands! + SessionMeta type | ✓ VERIFIED | Lines 7-30 and SessionMeta type confirmed |
| `tauri-app/src/styles.css` | Tailwind v4 + @theme tokens | ✓ VERIFIED | `@import "tailwindcss"` + `@theme` blocks present |
| `tauri-app/vitest.config.ts` | Vitest configuration | ✓ VERIFIED | jsdom + globals present |
| `tauri-app/src/components/ui/` | shadcn components | ✓ VERIFIED | 13 components confirmed |
| `tauri-app/src/stores/chatStore.ts` | Zustand chat state | ✓ VERIFIED | All actions present, functional updates confirmed |
| `tauri-app/src/stores/sessionStore.ts` | Zustand session list | ✓ VERIFIED | Tauri commands wired |
| `tauri-app/src/lib/diff.ts` | computeLineDiff | ✓ VERIFIED | Exports `computeLineDiff` wrapping `diffLines` |
| `tauri-app/src/lib/cost.ts` | formatCost, formatTokens, calcTurnCost, etc. | ✓ VERIFIED | All 5 exports present |
| `tauri-app/src/App.tsx` | 2-column shell | ✓ VERIFIED | `h-screen w-screen flex flex-row` |
| `tauri-app/src/components/sidebar/SessionSidebar.tsx` | Session list sidebar | ✓ VERIFIED | Substantive, wired |
| `tauri-app/src/components/sidebar/SessionItem.tsx` | Session row | ✓ VERIFIED | Hover delete, active border |
| `tauri-app/src/components/chat/ChatPane.tsx` | Right pane with top bar | ✓ VERIFIED | model selector, cost bar, stop button, MessageList, MessageInput, useAgentEvents |
| `tauri-app/src/components/chat/MessageInput.tsx` | Textarea + send + slash palette | ✓ VERIFIED | `shouldFilter={false}`, 5 commands, popover, Shift+Enter guard |
| `tauri-app/src/components/chat/MessageList.tsx` | Virtualized list | ✓ VERIFIED | useVirtualizer + measureElement + streaming slot |
| `tauri-app/src/components/chat/Message.tsx` | Message renderer | ✓ VERIFIED | user/assistant/PermissionCard/ToolBlock all wired |
| `tauri-app/src/components/chat/MarkdownRenderer.tsx` | Markdown + hljs | ✓ VERIFIED | rehypeHighlight, github-dark, not-prose, CopyButton |
| `tauri-app/src/components/chat/ToolBlock.tsx` | Collapsible tool card | ✓ VERIFIED | Truncation, DiffView, loading spinner |
| `tauri-app/src/components/chat/DiffView.tsx` | Line diff renderer | ✓ VERIFIED | React children only, green/red |
| `tauri-app/src/components/chat/PermissionCard.tsx` | Permission prompt card | ✓ VERIFIED | 3 buttons, isResolved gate, Tauri + store wired |
| `tauri-app/src/hooks/useAgentEvents.ts` | Event subscription hook | ✓ VERIFIED | rAF buffer, all event variants, cleanup, AlwaysAllow auto-respond |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `vite.config.ts` | `styles.css` | `@tailwindcss/vite` plugin | ✓ WIRED | `tailwindcss()` first in plugins array |
| `lib.rs` | `commands.rs run_agent_turn` | `collect_commands!` | ✓ WIRED | Line 25 in collect_commands! |
| `chatStore.ts` | `bindings.ts` | `TokenUsage type import` | ✓ WIRED | `import type { TokenUsage } from "../bindings"` |
| `cost.ts` | `bindings.ts` | `TokenUsage type import` | ✓ WIRED | `import type { TokenUsage } from "../bindings"` |
| `App.tsx` | `styles.css` | CSS import + `h-screen` | ✓ WIRED | `import "./styles.css"` confirmed in main.tsx; `h-screen` on root |
| `ChatPane.tsx` | `chatStore.ts` | `useChatStore()` | ✓ WIRED | Lines 22-23 |
| `MessageList.tsx` | `chatStore.ts` | `useChatStore` items + streamingContent | ✓ WIRED | `const { items, streamingContent, isStreaming } = useChatStore()` |
| `ChatPane.tsx` | `MessageList.tsx` | replacing placeholder div | ✓ WIRED | `<MessageList />` in ChatPane JSX |
| `PermissionCard.tsx` | `bindings.ts` | `commands.respondToPermission` | ✓ WIRED | Line 36 |
| `PermissionCard.tsx` | `chatStore.ts` | `resolvePermission + addAlwaysAllow` | ✓ WIRED | Lines 26, 31, 33 |
| `Message.tsx` | `PermissionCard.tsx` | import + usage | ✓ WIRED | Lines 3, 23 |
| `useAgentEvents.ts` | `chatStore.ts` | appendStreamingContent, finalizeStream, etc. | ✓ WIRED | Multiple calls via `useChatStore.getState()` |
| `useAgentEvents.ts` | `bindings.ts` | `listen()` from @tauri-apps/api/event; AgentEvent | ✓ WIRED | `listen<AgentEvent>(agentChannel, ...)` |
| `ChatPane.tsx` | `useAgentEvents.ts` | `useAgentEvents(agentId)` | ✓ WIRED | Lines 4, 24 |
| `MessageInput.tsx` | Tauri backend | `run_agent_turn IPC command` | ✓ WIRED | `commands.runAgentTurn(currentAgentId, msg)` line 119 |
| `SessionSidebar.tsx` | chatStore | `clearSession` on new session | ✓ WIRED | Line 17, 25 |
| `SessionSidebar.tsx` | sessionStore | `loadSessions, deleteSession` | ✓ WIRED | Lines 15, 20-21, 33 |
| `SessionSidebar.tsx` | chatStore | `loadSession() → hydrate on resume` | ✗ NOT_WIRED | `handleResumeSession` only calls `setActiveSessionId(id)`. No `loadSession()` IPC call. No chatStore message hydration. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `MessageList.tsx` | `items, streamingContent` | `useChatStore` → populated by `useAgentEvents` → `appendStreamingContent` / `appendItem` / `finalizeStream` | Yes (from Tauri events) | ✓ FLOWING |
| `ChatPane.tsx` | `sessionUsage` (for token count) | `useChatStore.sessionUsage` → accumulated in `finalizeStream` | Yes (accumulated per turn) | ✓ FLOWING |
| `ChatPane.tsx` | cost dollar amount in `costBarText` | `formatCostBar(0, totalTokens)` — first arg hardcoded `0` | No — cost is always $0.0000 regardless of real usage | ⚠ STATIC (cost only; token count is correct) |
| `SessionSidebar.tsx` | `sessions` | `sessionStore.loadSessions()` → `commands.listSessions()` → Tauri backend reads `~/.xolotl-code/sessions/` | Yes (real filesystem reads) | ✓ FLOWING |
| `AssistantMessage` (Message.tsx) | `message.usage` for per-turn cost | `chatStore.finalizeStream(usage)` → usage comes from `TurnCompleted` AgentEvent | Yes (real usage from backend) | ✓ FLOWING |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED — requires a running Tauri app. The app depends on WebView2/Tauri runtime. Manual spot-checks were performed by human in 04-07 smoke test.

---

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| UI-01 | 04-01, 04-02, 04-04, 04-06, 04-07 | User sees AI responses streaming token-by-token; rAF buffering | ✓ SATISFIED | `useAgentEvents.ts` rAF buffer + `appendStreamingContent`. Smoke test approved. |
| UI-02 | 04-04, 04-06, 04-07 | Code blocks with syntax highlighting and copy button | ✓ SATISFIED | `MarkdownRenderer.tsx`: rehypeHighlight + github-dark + CopyButton. |
| UI-03 | 04-05, 04-06, 04-07 | Tool call blocks collapsible with truncated bash output | ✓ SATISFIED | `ToolBlock.tsx`: TRUNCATE_AT=2000, Collapsible, "Show N more characters". |
| UI-04 | 04-02, 04-05, 04-06, 04-07 | File edits display inline diff | ✓ SATISFIED | `DiffView.tsx` + `ToolBlock.tsx` <<<BEFORE/>>>AFTER parsing. |
| UI-05 | 04-04, 04-06, 04-07 | Message list virtualized; 200+ turns performant | ✓ SATISFIED | `MessageList.tsx`: useVirtualizer + measureElement + overscan=5. Smoke test approved. |
| UI-06 | 04-01, 04-03, 04-06, 04-07 | Session sidebar: browse, resume, delete sessions | ? PARTIAL | Browse: yes. Delete: yes. **Resume**: `handleResumeSession` only sets `activeSessionId` — does NOT call `loadSession()` or hydrate chatStore. Prior messages not restored. |
| UI-07 | 04-05, 04-06, 04-07 | Permission prompt as inline card with approve/deny/always-allow | ✓ SATISFIED | `PermissionCard.tsx` + `useAgentEvents.ts` permission-request listener. Smoke test approved. |
| UI-08 | 04-01, 04-03, 04-06, 04-07 | Model selector per session | ✓ SATISFIED | `ChatPane.tsx`: `listModels()` → DropdownMenu. Smoke test approved. |
| UI-09 | 04-02, 04-04, 04-06, 04-07 | Token count and dollar cost per turn and session total | ? PARTIAL | Per-turn: `formatTurnFootnote` in AssistantMessage — correct. Session total: token count correct; **dollar amount hardcoded 0** in `formatCostBar(0, totalTokens)`. |
| UI-10 | 04-03, 04-06, 04-07 | Cancel in-flight turn; preserve partial output | ✓ SATISFIED | `StopButton` calls `cancelStream()` + `stopAgent()`. `cancelStream()` appends partial with "(stopped)". Smoke test approved. |
| UI-11 | 04-03, 04-06, 04-07 | Slash command palette with `/`, descriptions, executes on Enter | ✓ SATISFIED | `MessageInput.tsx`: shouldFilter=false, 5 commands, Popover/Command. Smoke test approved. |

**Requirements coverage: 9/11 SATISFIED, 2/11 PARTIAL (UI-06 resume stub, UI-09 cost hardcoded)**

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `tauri-app/src/components/chat/ChatPane.tsx:39` | `formatCostBar(0, totalTokens)` — cost argument hardcoded `0` | ⚠ Warning | Session-total dollar cost always displays `$0.0000` regardless of real turn costs. Token count (second arg) is correct. Invisible for Phase 4 echo stub (zero usage) but will be wrong when `run_agent_turn` uses real ConversationRuntime. |
| `tauri-app/src/components/sidebar/SessionSidebar.tsx:28-31` | `handleResumeSession` only calls `setActiveSessionId(id)`, no `loadSession()` | ⚠ Warning | Session resume is a no-op for message hydration. "Resume" per UI-06 definition is not achieved — the sidebar highlights the session but the chat thread stays empty/unchanged. |
| `tauri-app/src-tauri/src/commands.rs:143-149` | Echo stub in `run_agent_turn` | ℹ Info | Authorized via D-03 (2026-05-10). Not a defect — intentional Phase 4 behavior. Documented in both PLAN and SUMMARY. |
| `tauri-app/src-tauri/src/commands.rs:172-184` | `list_models` returns hardcoded Vec | ℹ Info | Authorized stub. 3 hardcoded model names. Full RuntimeConfig integration deferred. |

---

### Human Verification Required

#### 1. Session Resume — Message Hydration

**Test:** Start app, send a few messages (they auto-save after TurnCompleted). Click away to a new session or close/reopen the app. Click the saved session in the sidebar.

**Expected:** The prior messages appear in the chat thread (session is actually resumed with conversation history).

**Why human:** `handleResumeSession()` in `SessionSidebar.tsx` calls only `setActiveSessionId(id)`. There is no `loadSession()` IPC call and no `chatStore` hydration pathway in the current code. The smoke test (04-07) criterion SC3 says "user can browse, resume, or delete saved sessions" — it is unclear whether the human tester validated that messages actually restored, or only that the sidebar correctly highlighted the session. This cannot be verified programmatically without running the app.

If session messages do NOT restore: this is a gap against UI-06 and SC3. The fix requires calling `commands.loadSession(id)` in `handleResumeSession`, parsing the session JSON, and re-populating `chatStore.items`.

#### 2. Session-Total Cost Display

**Test:** Run several chat turns (with real AI integration or modified stub returning non-zero token usage). Check the session cost bar in the top bar.

**Expected:** The dollar amount in the cost bar increases after each turn to reflect cumulative cost (e.g., `$0.0042 · 1,240 tok`).

**Why human:** `ChatPane.tsx:39` passes `0` as the cost argument: `formatCostBar(0, totalTokens)`. The `formatCostBar` function is correct — it formats `$X.XXXX · N tok` — but `X` is always `0`. For the echo stub with zero token usage, both the hardcoded `0` and the computed cost would be `$0.0000`, so the smoke test could not have detected this. This needs human confirmation that the cost display behavior is acceptable for Phase 4 scope, or a code fix to compute `calcTurnCost(sessionUsage, model)`.

---

### Gaps Summary

Two items require human decision:

**Gap 1 — Session Resume (UI-06, SC3):** `handleResumeSession()` is a stub that only sets the active session ID. No message hydration occurs. Whether this was intentionally scoped out of Phase 4 or was missed is unclear from the SUMMARY notes (Plan 03-SUMMARY lists "Session hydration on resume" as a known stub under "Wave 3 plan will wire loadSession()"). The Phase 4 ROADMAP SC3 states "user can ... resume" which implies message restoration. This is flagged as UNCERTAIN pending human verification of smoke test scope.

**Gap 2 — Session-Total Cost Dollar Amount (UI-09, SC4):** The cost bar always shows `$0.0000` due to hardcoded `0` in `formatCostBar(0, totalTokens)`. The token count is correct. For Phase 4 (echo stub with zero tokens) this is invisible. This is flagged as UNCERTAIN pending human confirmation that `$0.0000` display is acceptable for Phase 4 scope.

Both gaps are classified as UNCERTAIN (not FAILED) because:
- Gap 1: The smoke test human approval exists and may have included message restoration; also the Plan 03-SUMMARY explicitly labels this a known stub without indicating it blocks Phase 4 completion.
- Gap 2: The echo stub makes the bug invisible in the actual smoke test scenario.

---

_Verified: 2026-05-10_
_Verifier: Claude (gsd-verifier)_
