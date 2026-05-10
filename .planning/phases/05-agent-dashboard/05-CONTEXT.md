# Phase 5: Agent Dashboard - Context

**Gathered:** 2026-05-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Make multi-agent orchestration visible and controllable inside the Tauri app: spawn agents with model/task/budget, monitor their live streams, and receive OS-level notifications on completion. Builds on the AgentSupervisor from Phase 2 and the IPC/event infrastructure from Phase 3. Does NOT include parallel worktrees, role-based teams, or swarm strategies (Phase 6).

</domain>

<decisions>
## Implementation Decisions

### Layout (AGT-01)
- **D-01:** 3-column layout: `SessionSidebar` (256px fixed, unchanged from Phase 4) | `ChatPane` (flex-1, replaces center depending on state) | `AgentPanel` (320px fixed right, always visible). `App.tsx` gains a third column.
- **D-02:** `AgentPanel` is fixed at 320px — no resize handle. Matches the established sidebar pattern.
- **D-03:** Each agent card in the roster shows: colored status badge (maps to `AgentState` variants), task description (truncated), cumulative cost in dollars, and an expand button. Model name is NOT shown on the card — card stays compact.

### Agent Output Expansion (AGT-02)
- **D-04:** Clicking expand on an agent card **replaces the center `ChatPane`** with that agent's read-only conversation view. All existing `Message`, `ToolBlock`, `DiffView`, `MarkdownRenderer`, `MessageList` components are reused directly — no new rendering infrastructure.
- **D-05:** The agent view is **read-only** — no `MessageInput`. Observation only. Human chat = chat sessions; agent view = monitoring panel. The distinction is intentional.
- **D-06:** When no agent is selected (or user closes agent view), the center pane shows the regular human chat session. Closing agent view returns to chat seamlessly.

### Spawn Dialog (AGT-03, AGT-05)
- **D-07:** The "New Agent" dialog collects three fields: **Model** (dropdown via existing `list_models` command, same list as Phase 4 model selector), **Task** (text area — the initial prompt/objective), **Budget** (optional dollar amount; empty = unlimited). No worktree field in the dialog — worktree is auto-assigned from a slug of the task name.
- **D-08:** Worktree is created automatically when the agent spawns. The branch name is derived from the task description (slugified, e.g., "Refactor auth module" → `agent/refactor-auth-module`). No branch picker in the dialog.
- **D-09:** Model picker is a `<Select>` dropdown populated from `list_models` — same component pattern as Phase 4 chat top bar.

### Budget Enforcement (AGT-06)
- **D-10:** Budget enforcement lives in the **Rust backend**. `spawn_agent` is extended to accept an optional `budget_dollars: Option<f64>` parameter. The runtime halts the agent when cumulative cost exceeds the budget — same mechanism as the CLI `--budget` flag already implemented in Phase 1. On budget exceeded: emits `AgentEvent::StateChanged(Failed)` and an `AgentEvent::Error { message: "Budget exceeded: $X.XXXX" }`.
- **D-11:** The budget value is passed through the new `spawn_agent` signature and stored in the agent's runtime context. No frontend polling or cost accumulation needed for enforcement — the backend handles it.

### OS Notifications (AGT-04)
- **D-12:** Use the **Tauri notification plugin** (`@tauri-apps/plugin-notification`) for OS-native notifications. This requires adding the plugin to `tauri-app/src-tauri/Cargo.toml` and registering it in `lib.rs` and `capabilities/`.
- **D-13:** Notification content: **title** = agent task description (truncated to ~60 chars), **body** = "Done — $X.XXXX" or "Failed — $X.XXXX". Informative without being verbose.
- **D-14:** Notification fires on **every** `AgentEvent::StateChanged(Done)` or `AgentEvent::StateChanged(Failed)` — always, regardless of window focus. No focus-detection logic needed. Simple and reliable.

### Claude's Discretion
- Exact color for each `AgentState` badge (Idle/Planning/Executing/Waiting/Done/Failed).
- Animation/spinner for `Executing` state in the agent card.
- Exact truncation threshold for task description in the card.
- Agent panel header design (title, "New Agent" button placement).
- Transition animation when switching between chat view and agent view.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §Agent Dashboard — AGT-01 through AGT-06 (all Phase 5 requirements with full descriptions)
- `.planning/ROADMAP.md` §Phase 5 — Goal, success criteria, dependencies

### Existing IPC & Event Types
- `tauri-app/src/bindings.ts` — TypeScript types for all `AgentEvent` variants, `AgentState`, and Tauri commands. **Must read before any new IPC.** `spawn_agent` signature will need to be updated here for budget param.
- `tauri-app/src-tauri/src/commands.rs` — Existing command implementations; `spawn_agent` will be extended here.
- `tauri-app/src-tauri/src/lib.rs` — Plugin registration and event relay; new notification plugin registered here.
- `tauri-app/src-tauri/capabilities/default.json` — Capability grants; notification capability must be added.

### Phase 4 Components (reuse in agent output view)
- `tauri-app/src/components/chat/MessageList.tsx` — Virtualized message list; reuse directly for agent output view.
- `tauri-app/src/components/chat/Message.tsx` — Message rendering with tool blocks; reuse unchanged.
- `tauri-app/src/components/chat/ToolBlock.tsx` — Tool call display; reuse unchanged.
- `tauri-app/src/components/chat/DiffView.tsx` — File diff rendering; reuse unchanged.
- `tauri-app/src/hooks/useAgentEvents.ts` — Per-agent event subscription; extend or clone for per-agent stream in the panel.

### Stores & State (Phase 4 patterns)
- `tauri-app/src/stores/chatStore.ts` — Zustand pattern with rAF streaming buffer; new `agentStore.ts` should follow this pattern.

### Runtime Types (for spawn_agent extension)
- `rust/crates/runtime/src/supervisor/supervisor.rs` — `AgentSupervisor::spawn_agent()` — add `budget_dollars: Option<f64>` param here.
- `rust/crates/runtime/src/supervisor/agent_state.rs` — `AgentState` and `AgentEvent` enum definitions.

### Prior Phase Context
- `.planning/phases/04-chat-ui/04-CONTEXT.md` — Phase 4 decisions (layout, rendering stack, IPC patterns). Phase 5 must be consistent.

### Open Code Review Items (carry forward from Phase 4)
- CR-01: `tauri-app/src-tauri/src/permission_prompter.rs` — use `.lock().map_err()` instead of `.unwrap()`
- CR-02: `tauri-app/src-tauri/src/commands.rs` `respond_to_permission` — use `HashMap::remove` not `.get()`
- CR-04: `tauri-app/src-tauri/capabilities/default.json` — add path scope to `fs:default`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `tauri-app/src/components/chat/MessageList.tsx` — Virtualized scroll via `@tanstack/react-virtual`; plug into agent output view directly.
- `tauri-app/src/components/chat/Message.tsx`, `ToolBlock.tsx`, `DiffView.tsx` — Full rendering stack reusable as-is; agent view is the same event types rendered read-only.
- `tauri-app/src/hooks/useAgentEvents.ts` — `listen()` subscription hook for per-agent events; the new agent panel needs per-agent subscriptions (one per card, plus one for the expanded view).
- `tauri-app/src/stores/chatStore.ts` — Zustand store with streaming buffer + rAF flush pattern; new `agentStore.ts` follows the same pattern for the roster state.

### Established Patterns
- **Event relay (Phase 3):** Rust emits `AgentEvent` → broadcast → Tauri emit → `listen()` on frontend. All new agent events follow this same relay — zero new infrastructure.
- **Dark-only scheme (Phase 4 D-07):** All new components inherit the dark palette. No light mode.
- **shadcn Dialog:** Already used in Phase 4 (permission card); spawn dialog reuses this component.
- **MSVC toolchain (Phase 3):** All new Rust dependencies must be MSVC-compatible.
- **Zustand store pattern:** `create()` with typed `State + Actions` interface; no class components.
- **specta type generation:** `bindings.ts` is partially hand-updated. After extending `spawn_agent` signature, the binding for that command must be updated manually until WebView2 DLL issue resolves.

### Integration Points
- `tauri-app/src/App.tsx` — Add third `AgentPanel` column. Currently: `SessionSidebar + ChatPane`. Becomes: `SessionSidebar + CenterPane (ChatPane or AgentOutputView) + AgentPanel`.
- `tauri-app/src-tauri/src/commands.rs` `spawn_agent` — Add `model: String`, `task: String`, `budget_dollars: Option<f64>` params. Currently only takes `branch: String`.
- `tauri-app/src-tauri/src/lib.rs` — Register `plugin-notification`; fire OS notification from event relay when `StateChanged(Done|Failed)` is received.
- `tauri-app/src/stores/` — New `agentStore.ts` to hold roster state (list of agents, their tasks, costs, states, expanded agent ID).

</code_context>

<specifics>
## Specific Ideas

- Worktree branch naming: auto-derive from task description as `agent/{slugified-task}` — no user input required.
- Status badge color convention (suggestion for Claude): Idle=gray, Planning=blue, Executing=green (pulsing), Waiting=yellow, Done=emerald, Failed=red.
- Budget field placeholder text: "e.g. 0.10 (leave blank for unlimited)" — makes the optional nature clear.
- Notification title should be the task description as entered by the user (not slugified) — human-readable.

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope.

</deferred>

---

*Phase: 5-Agent Dashboard*
*Context gathered: 2026-05-10*
