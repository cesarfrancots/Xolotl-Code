# Phase 4: Chat UI - Context

**Gathered:** 2026-05-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the table-stakes chat experience inside the Tauri shell: token-by-token streaming, tool call blocks (bash, file ops, grep, glob) with inline diffs, session sidebar, permission prompt cards, model selector, cost display, cancel-turn, and a slash-command palette. Builds entirely on the Tauri IPC and event infrastructure from Phase 3. Does NOT include multi-agent dashboard or parallel worktrees (Phase 5/6).

</domain>

<decisions>
## Implementation Decisions

### Streaming Architecture
- **D-01:** Add `AgentEvent::TextDelta(String)` variant to the Rust runtime. The existing broadcast channel + Tauri event relay (Phase 3) picks it up automatically — no separate stream channel needed.
- **D-02:** Frontend buffers incoming `TextDelta` events in a React ref and flushes to state on each `requestAnimationFrame` tick (~60fps). Matches UI-01 requirement directly.
- **D-03:** User messages are sent by extending/reusing the existing `spawn_agent` Tauri command (not a new `run_turn` command). The agent runs and emits `AgentEvent`s including the new `TextDelta` variant.

### UI Shell & Layout
- **D-04:** Fixed 2-column layout: session list sidebar (left) + chat pane (right). Sidebar always visible — no toggle or collapse needed for Phase 4.
- **D-05:** Model selector lives in the top bar of the chat pane, per-session. A dropdown showing the current model; changing it applies to the current session only. Implements UI-08.
- **D-06:** Cost/token display: per-turn cost as a small footnote below each assistant message; session running total in the chat top bar next to the model selector. Implements UI-09.
- **D-07:** Dark-only color scheme. No light/dark toggle in Phase 4.

### Rendering Stack
- **D-08:** Markdown + code blocks: `react-markdown` + `rehype-highlight` (highlight.js backend). Integrates with Tailwind prose styling and shadcn components. No shiki — acceptable quality for Phase 4, smaller bundle.
- **D-09:** File edit diffs (UI-04): unified diff format, single-column with green/red line-background coloring for added/removed lines. Familiar from git output.
- **D-10:** Diff computation: `diff` npm package (zero-deps, returns structured change objects). Custom rendering via Tailwind classes — not a pre-styled React diff component.

### Slash Command Palette
- **D-11:** Phase 4 ships four slash commands: `/clear` (reset current session thread), `/model` (open model picker from input), `/save` and `/load` (session management complementing sidebar), `/help` (list available commands).
- **D-12:** Palette UI: shadcn `Command` component (built on `cmdk`). Opens as a popover above the input when user types `/`. Keyboard-first, accessible.

### Claude's Discretion
- Exact sidebar width and chat pane proportions.
- Session auto-save vs explicit-save-only behavior (within the constraint that `/save` and `/load` exist).
- Tool block expand/collapse default state (collapsed or expanded).
- Exact bash output truncation threshold for UI-03.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §Chat UI — UI-01 through UI-11 (all Phase 4 requirements with full descriptions)
- `.planning/ROADMAP.md` §Phase 4 — Success criteria and plan count

### Existing IPC & Event Types
- `tauri-app/src/bindings.ts` — Generated TypeScript types for all `AgentEvent` variants, `AgentState`, and Tauri commands. **This is the contract** between Rust and React. Must be read before writing any IPC call.
- `tauri-app/src-tauri/src/commands.rs` — Existing Tauri command implementations (spawn_agent, list_agents, stop_agent, respond_to_permission)
- `tauri-app/src-tauri/src/lib.rs` — Plugin registration, managed state, event relay setup
- `tauri-app/src-tauri/src/permission_prompter.rs` — TauriPermissionPrompter implementation (permission flow already complete)

### Runtime Types (for TextDelta addition)
- `rust/crates/runtime/src/supervisor/` — AgentEvent enum definition (needs new TextDelta variant)
- `rust/crates/runtime/src/conversation.rs` — ConversationRuntime — where streaming tokens originate

### Architecture
- `.planning/codebase/ARCHITECTURE.md` — System architecture overview
- `.planning/codebase/STACK.md` — Technology stack (frontend decisions already locked: React 19, Zustand, Tailwind 4, shadcn/Radix, @tanstack/react-virtual)

### Open Code Review Items (carry into Phase 4)
- CR-01: `tauri-app/src-tauri/src/permission_prompter.rs` — use `.lock().map_err()` instead of `.unwrap()` on mutex
- CR-02: `tauri-app/src-tauri/src/commands.rs` `respond_to_permission` — use `HashMap::remove` not `.get()` to prevent double-resolve
- CR-04: `tauri-app/src-tauri/capabilities/default.json` — add path scope to `fs:default`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `tauri-app/src-tauri/src/commands.rs` `spawn_agent` command: already accepts agent config and returns agent ID. Extend to accept an initial message for the chat turn.
- `tauri-app/src-tauri/src/lib.rs` event relay: already listens on `AgentSupervisor` broadcast channel and calls `app.emit()`. Adding `TextDelta` to `AgentEvent` automatically flows through this relay.
- `tauri-app/src/bindings.ts`: all existing types ready for import. New `TextDelta` variant will need to be added manually (or via re-running specta generation once WebView2 DLL issue resolves).

### Established Patterns
- **Event relay pattern (Phase 3):** Rust emits `AgentEvent` → broadcast channel → Tauri event relay → frontend `listen()`. New `TextDelta` variant follows this exact same pattern — zero new infrastructure.
- **Permission flow (Phase 3):** Permission prompt surfaces as `AgentEvent::PermissionRequest` → frontend inline card → user responds → `respond_to_permission` command. The same inline-card pattern applies to Phase 4's UI-07 requirement.
- **MSVC toolchain (Phase 3):** Windows build uses MSVC. Any new native dependencies must be MSVC-compatible.
- **specta type generation:** `bindings.ts` is partially hand-updated due to WebView2 DLL issue. New types may need manual additions until the binary execution issue is resolved.

### Integration Points
- `AgentEvent` enum in `rust/crates/runtime/src/supervisor/` → add `TextDelta(String)` here
- `tauri-app/src-tauri/src/lib.rs` event relay → no change needed (picks up new variant automatically)
- `tauri-app/src/bindings.ts` → add `TextDelta` variant manually
- `tauri-app/src/App.tsx` → replace scaffold with full Chat UI shell
- Frontend state management: Zustand stores (not yet created — Phase 4 creates them from scratch)

</code_context>

<specifics>
## Specific Ideas

- The slash command palette should mirror the CLI commands the user already knows (`/clear`, `/model`, `/save`, `/load`, `/help`) — familiarity from the Phase 1 CLI is intentional.
- Tool blocks for bash output should be collapsible with a "show more" truncation — not just hidden (UI-03 explicit requirement).
- The stop button (UI-10) must preserve partial streaming output when clicked — not discard the in-progress message.

</specifics>

<deferred>
## Deferred Ideas

- Light/dark theme toggle — deferred, dark-only for Phase 4.
- `/cost` slash command — UI already shows cost in the top bar; a slash command version deferred unless needed.
- Collapsible/resizable sidebar — deferred to Phase 5 when the agent panel also needs space.
- Per-turn cost breakdown (input/output tokens separately) — deferred, running total is sufficient for Phase 4.

</deferred>

---

*Phase: 4-Chat UI*
*Context gathered: 2026-05-10*
