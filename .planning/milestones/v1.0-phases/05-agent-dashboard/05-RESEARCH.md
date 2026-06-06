# Phase 5: Agent Dashboard - Research

**Researched:** 2026-05-10
**Domain:** Tauri multi-agent UI, Rust budget enforcement, OS notifications, Zustand multi-entity stores
**Confidence:** HIGH

## Summary

Phase 5 adds a 3-column dashboard to the existing 2-column Tauri shell. The architecture is
well-established by Phases 3 and 4: the event relay (one tokio task per agent) and the
`AgentEvent` broadcast system already handle everything Phase 5 needs. No new IPC
infrastructure is required — only extensions to existing patterns.

The two most complex areas are (1) budget enforcement in Rust and (2) the `agentStore`
design. Budget enforcement does NOT exist in `ConversationRuntime` today — the CLI check
lives in the REPL loop in `main.rs`, not in the runtime. For Phase 5's supervised agents
the check must be added to the `run_agent_turn` command in `commands.rs` (comparing
`handle.cumulative_cost_usd()` against the stored budget after each `TurnCompleted` event).
The `AgentHandle` will need a new optional `budget_dollars` field and a way to accumulate
cost. The `agentStore.ts` must track per-agent message lists independently of `chatStore.ts`,
using the same rAF buffer pattern.

The notification plugin is straightforward: `tauri-plugin-notification = "2.3.3"` /
`@tauri-apps/plugin-notification@2.3.3`, add `"notification:default"` to
`capabilities/default.json`, register the plugin in `lib.rs`, then call `sendNotification()`
from TypeScript in `useAgentEvents` when `StateChanged(Done|Failed)` arrives.

**Primary recommendation:** Build in this order: (1) Rust extension — budget field in
AgentHandle + extended `spawn_agent` signature; (2) `agentStore.ts`; (3) `AgentPanel` +
`AgentCard`; (4) spawn dialog; (5) `AgentOutputView`; (6) notification plugin wiring.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Layout (AGT-01)**
- D-01: 3-column layout: `SessionSidebar` (256px fixed) | `ChatPane`/`AgentOutputView` (flex-1 center) | `AgentPanel` (320px fixed right). `App.tsx` gains a third column.
- D-02: `AgentPanel` is fixed at 320px — no resize handle.
- D-03: Each agent card shows: colored status badge, task description (truncated), cumulative cost in dollars, and an expand button. Model name NOT shown on the card.

**Agent Output Expansion (AGT-02)**
- D-04: Clicking expand replaces the center `ChatPane` with that agent's read-only conversation view. All existing Message/ToolBlock/DiffView/MarkdownRenderer/MessageList components reused directly.
- D-05: Agent view is read-only — no MessageInput.
- D-06: When no agent is selected (or user closes), center pane shows regular human chat. Closing returns to chat seamlessly.

**Spawn Dialog (AGT-03, AGT-05)**
- D-07: Dialog collects three fields: Model (dropdown via `list_models`), Task (textarea), Budget (optional dollar amount; empty = unlimited). No worktree field.
- D-08: Worktree auto-assigned from slugified task description (`agent/{slug}`). No branch picker.
- D-09: Model picker is a `<Select>` dropdown from `list_models`.

**Budget Enforcement (AGT-06)**
- D-10: Budget enforcement in Rust backend. `spawn_agent` extended with `budget_dollars: Option<f64>`. Runtime halts when cumulative cost exceeds budget. On exceeded: emits `AgentEvent::StateChanged(Failed)` then `AgentEvent::Error { message: "Budget exceeded: $X.XXXX" }`.
- D-11: Budget stored in agent's runtime context. No frontend polling for enforcement.

**OS Notifications (AGT-04)**
- D-12: Use `@tauri-apps/plugin-notification`. Requires adding to Cargo.toml and registering in lib.rs and capabilities/.
- D-13: Notification title = task description (truncated ~60 chars); body = "Done — $X.XXXX" or "Failed — $X.XXXX".
- D-14: Fires on every `AgentEvent::StateChanged(Done|Failed)`. Always, regardless of window focus.

### Claude's Discretion
- Exact color for each AgentState badge (Idle/Planning/Executing/Waiting/Done/Failed).
- Animation/spinner for Executing state in the agent card.
- Exact truncation threshold for task description in the card.
- Agent panel header design (title, "New Agent" button placement).
- Transition animation when switching between chat view and agent view.

### Deferred Ideas (OUT OF SCOPE)
- None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AGT-01 | Agent roster panel shows all running and completed agents with status badge, task description, and cumulative cost | AgentPanel + AgentCard components; agentStore.agents array; badge color map |
| AGT-02 | Each agent has an expandable streaming output panel showing live conversation and tool activity | AgentOutputView reuses MessageList/Message/ToolBlock; agentStore.expandedAgentId; per-agent useAgentEvents hook |
| AGT-03 | User can spawn a new agent via dialog: choose model, enter task, assign worktree | Spawn dialog using shadcn Dialog; extended spawn_agent command; worktree slug derivation |
| AGT-04 | User can launch a background agent; receives OS-level notification when it completes | tauri-plugin-notification 2.3.3; sendNotification() called on StateChanged(Done/Failed) |
| AGT-05 | Each agent has its own model selector; orchestrator and workers can use different models | model: String param in extended spawn_agent; stored per-agent in agentStore |
| AGT-06 | User can set a cost budget per agent; agent stops when budget is reached | budget_dollars: Option<f64> in AgentHandle; cost check after TurnCompleted in event relay; Error event emitted |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Agent roster display | Frontend (React) | — | Pure UI — agentStore drives AgentPanel/AgentCard rendering |
| Agent spawn dialog | Frontend (React) + API/Backend | — | Dialog collects params; Rust spawn_agent creates worktree + agent handle |
| Per-agent event streaming | API/Backend (Tauri event relay) | Frontend (useAgentEvents) | Rust emits events; frontend subscribes per agent-id channel |
| Budget enforcement | API/Backend (Rust) | — | D-10 locked: Rust backend enforces, no frontend polling |
| OS notifications | Frontend (Tauri plugin) | — | sendNotification() called from TypeScript event handler |
| Agent output view | Frontend (React) | — | Reuses Phase 4 rendering stack; agentStore provides per-agent message lists |
| Worktree creation | API/Backend (Rust WorktreeManager) | — | Already implemented in supervisor.rs spawn_agent() |
| Cost accumulation | API/Backend (Rust UsageTracker) | Frontend (agentStore) | Backend tracks per TurnCompleted; frontend mirrors for display |

---

## Standard Stack

### Core (all verified against current codebase)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `tauri-plugin-notification` | 2.3.3 | OS-native notifications | Only Tauri 2.x notification plugin [VERIFIED: cargo search] |
| `@tauri-apps/plugin-notification` | 2.3.3 | JS notification API | Paired with Rust plugin [VERIFIED: npm registry] |
| `zustand` | 5.0.13 | Agent roster state | Already in project; chatStore pattern to follow [VERIFIED: package.json] |
| `@tanstack/react-virtual` | 3.13.24 | Virtualized agent output | Already used in MessageList; reuse for agent output [VERIFIED: package.json] |
| shadcn `dialog` | already installed | Spawn dialog | Already in ui/ from Phase 4 [VERIFIED: component list] |
| shadcn `badge` | already installed | Status badges | Already in ui/ [VERIFIED: component list] |
| `lucide-react` | 1.14.0 | Icons (spinner, expand, close) | Already in project [VERIFIED: package.json] |

### No New Dependencies Needed
All required frontend dependencies are already installed. The only new dependency is the
notification plugin (Rust + JS).

**Installation (new only):**
```bash
# In tauri-app/src-tauri/Cargo.toml — add:
# tauri-plugin-notification = "2.3.3"

# In tauri-app/:
npm install @tauri-apps/plugin-notification@2.3.3
```

---

## Architecture Patterns

### System Architecture Diagram

```
User clicks "New Agent"
        │
        ▼
  SpawnDialog (React)
  [model, task, budget]
        │
        │ commands.spawnAgent(branch, model, task, budget_dollars)
        ▼
  spawn_agent (commands.rs)                AgentHandle { budget_dollars, task, model,
        │                                               cumulative_cost: AtomicF64 }
        │ supervisor.spawn_agent_with_config()          │
        ▼                                               │
  AgentSupervisor.spawn_agent()            registry.insert(id, handle)
        │                                               │
        │ spawn_event_relay(app, id, handle)            │
        ▼                                               │
  Event Relay Task (tokio) ◄─────────────── handle.subscribe()
        │                                               │
        │ app.emit("agent-event:{id}", event)     TurnCompleted
        │                                         → accumulate cost
        │                                         → if cost > budget: emit Error + StateChanged(Failed)
        ▼
  Frontend listen("agent-event:{id}")
        │
        ├─► agentStore.updateAgent(id, {state, cost, ...})  → AgentPanel re-renders
        ├─► agentStore.appendAgentMessage(id, item)          → AgentOutputView (if expanded)
        └─► on Done/Failed: sendNotification()               → OS toast
```

### Recommended Project Structure
```
tauri-app/src/
├── stores/
│   ├── chatStore.ts        # unchanged (Phase 4)
│   └── agentStore.ts       # NEW: roster state + per-agent message lists
├── hooks/
│   ├── useAgentEvents.ts   # unchanged (Phase 4 chat session)
│   └── useAgentPanelEvents.ts  # NEW: per-agent events for the panel
├── components/
│   ├── agent/
│   │   ├── AgentPanel.tsx        # NEW: right column (320px)
│   │   ├── AgentCard.tsx         # NEW: one card per agent in roster
│   │   ├── AgentOutputView.tsx   # NEW: center pane takeover (read-only)
│   │   └── SpawnAgentDialog.tsx  # NEW: spawn dialog
│   ├── chat/               # unchanged from Phase 4
│   └── sidebar/            # unchanged from Phase 4
└── App.tsx                 # extended: 3-column layout
```

### Pattern 1: Extended spawn_agent Rust Command

The current `spawn_agent` signature only takes `branch: String`. Phase 5 extends it to
accept `model`, `task`, and `budget_dollars`. The branch is derived from the task slug —
the frontend does NOT send a branch; the Rust side derives it.

**CRITICAL: AgentHandle must store budget + task + model.** Currently `AgentHandle` has
no such fields. They need to be added to `AgentHandle` in
`rust/crates/runtime/src/supervisor/handle.rs`.

**New Rust signature:**
```rust
// Source: derived from commands.rs pattern [VERIFIED: codebase]
#[tauri::command]
#[specta::specta]
pub fn spawn_agent(
    supervisor: tauri::State<'_, Arc<AgentSupervisor>>,
    app_handle: AppHandle,
    task: String,
    model: String,
    budget_dollars: Option<f64>,
) -> Result<String, String> {
    let branch = slugify_task(&task);  // "Refactor auth" → "agent/refactor-auth"
    let agent_id = supervisor
        .spawn_agent_with_config(&branch, &task, &model, budget_dollars)
        .map_err(|e| e.to_string())?;
    if let Some(handle) = supervisor.get_handle(&agent_id) {
        spawn_event_relay(app_handle, agent_id.clone(), handle);
    }
    Ok(agent_id.0)
}

fn slugify_task(task: &str) -> String {
    let slug: String = task
        .chars()
        .map(|c| if c.is_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    format!("agent/{}", &slug[..slug.len().min(40)])
}
```

### Pattern 2: Budget Enforcement in Event Relay

The CLI implements budget checking **before** each turn in the REPL loop in `main.rs`:
`is_over_budget()` calls `runtime.usage().cost_usd(model)`. The same logic must run in the
Tauri event relay after each `TurnCompleted` event. [VERIFIED: main.rs lines 1177-1184,
2716-2725]

The `UsageTracker::cost_usd(model)` method is on the runtime's `UsageTracker`. In the Tauri
event relay, there is no `ConversationRuntime` — the relay just relays events. Therefore:

**Option A (recommended):** Store a `cumulative_cost: f64` in `AgentHandle` (as `AtomicU64`
bit-cast from f64, or wrapped in `Mutex<f64>`). In `spawn_event_relay`, accumulate
`TurnCompleted` usage into this field after each event. If it exceeds `budget_dollars`,
inject synthetic `Error` and `StateChanged(Failed)` events into the broadcast channel.

**Example pattern:**
```rust
// Source: derived from CLI budget pattern + event relay pattern [VERIFIED: codebase]
// In spawn_event_relay, after emitting TurnCompleted:
if let AgentEvent::TurnCompleted { usage } = &event {
    let new_cost = handle.accumulate_cost(usage, &handle.model);
    if let Some(budget) = handle.budget_dollars {
        if new_cost >= budget {
            let _ = handle.event_tx.send(AgentEvent::StateChanged(AgentState::Failed)).await;
            let _ = handle.event_tx.send(AgentEvent::Error {
                message: format!("Budget exceeded: ${:.4}", new_cost),
            }).await;
        }
    }
}
```

**Cost calculation uses `UsageTracker::cost_usd()`** — the method already exists in
`rust/crates/runtime/src/usage.rs` and accepts a model name string. [VERIFIED: usage.rs
lines 77-93]

### Pattern 3: agentStore.ts Design

The `agentStore` manages a collection of `AgentRecord` objects (one per spawned agent) plus
per-agent message lists. It follows the `chatStore.ts` pattern with rAF buffering.

```typescript
// Source: derived from chatStore.ts pattern [VERIFIED: codebase]
export interface AgentRecord {
  id: string;
  task: string;
  model: string;
  state: AgentState;
  cumulativeCost: number;  // computed client-side from TurnCompleted events
  messages: ChatItem[];    // same types as chatStore — reuse Message/PermissionItem/ToolCall
  streamingContent: string;
  isStreaming: boolean;
}

interface AgentStoreState {
  agents: AgentRecord[];
  expandedAgentId: string | null;  // which agent occupies the center pane
  
  addAgent: (id: string, task: string, model: string) => void;
  updateAgentState: (id: string, state: AgentState) => void;
  appendAgentStreamingContent: (id: string, delta: string) => void;
  finalizeAgentStream: (id: string, usage: TokenUsage) => void;
  appendAgentItem: (id: string, item: ChatItem) => void;
  setExpandedAgent: (id: string | null) => void;
}
```

**Key difference from chatStore:** `agentStore` holds N independent per-agent buffers.
Each agent has its own `deltaBuffer` ref in its `useAgentPanelEvents` hook instance.

### Pattern 4: Per-Agent Event Subscription (useAgentPanelEvents)

The existing `useAgentEvents` hook writes to `chatStore`. For the agent panel we need a
separate hook that writes to `agentStore` instead. The event subscription mechanism is
identical — `listen("agent-event:{agentId}", ...)` — but the state target differs.

**The hook is called once per AgentCard (when the card mounts).** It does NOT need to be
called again for the expanded view because the expanded view reads from `agentStore.agents[id].messages`.

```typescript
// Source: derived from useAgentEvents.ts pattern [VERIFIED: codebase]
export function useAgentPanelEvents(agentId: string) {
  const deltaBuffer = useRef<string>("");
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    const channel = `agent-event:${agentId}`;
    const promise = listen<AgentEvent>(channel, (event) => {
      const payload = event.payload;
      if ("TextDelta" in payload) {
        deltaBuffer.current += payload.TextDelta;
        if (rafId.current === null) {
          rafId.current = requestAnimationFrame(() => {
            const delta = deltaBuffer.current;
            deltaBuffer.current = "";
            rafId.current = null;
            if (delta) useAgentStore.getState().appendAgentStreamingContent(agentId, delta);
          });
        }
        return;
      }
      if ("StateChanged" in payload) {
        const state = payload.StateChanged;
        useAgentStore.getState().updateAgentState(agentId, state);
        // OS notification
        if (state === "Done" || state === "Failed") {
          const record = useAgentStore.getState().agents.find(a => a.id === agentId);
          if (record) {
            const title = record.task.slice(0, 60);
            const cost = record.cumulativeCost.toFixed(4);
            void sendNotification({ title, body: `${state} — $${cost}` });
          }
        }
        return;
      }
      if ("TurnCompleted" in payload) {
        const { usage } = payload.TurnCompleted;
        useAgentStore.getState().finalizeAgentStream(agentId, usage);
        return;
      }
      // ToolCallStarted, ToolCallCompleted, Error handled similarly to useAgentEvents
    });
    promise.then(fn => { /* store unlisten fn */ });
    return () => { /* cancel rAF + unlisten */ };
  }, [agentId]);
}
```

### Pattern 5: Tauri Notification Plugin Setup

```rust
// Source: tauri-plugin-notification GitHub README [CITED: github.com/tauri-apps/tauri-plugin-notification]
// In tauri-app/src-tauri/Cargo.toml:
tauri-plugin-notification = "2.3.3"

// In tauri-app/src-tauri/src/lib.rs (in tauri::Builder chain):
.plugin(tauri_plugin_notification::init())

// In tauri-app/src-tauri/capabilities/default.json — add to "permissions":
"notification:default"
```

```typescript
// Source: tauri-plugin-notification README [CITED: github.com/tauri-apps/tauri-plugin-notification]
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

// Request permission once (e.g., on first agent spawn):
let granted = await isPermissionGranted();
if (!granted) {
  const permission = await requestPermission();
  granted = permission === 'granted';
}
if (granted) {
  sendNotification({ title: 'Task complete', body: 'Done — $0.0042' });
}
```

**Windows behavior:** In development, notifications show with PowerShell identity (the
launcher). In production (installed app), they show as proper WinRT toast notifications
with the app's registered identity. No additional WinRT configuration is needed for dev
builds. [VERIFIED: v2.tauri.app/plugin/notification]

### Pattern 6: bindings.ts Manual Update

After extending `spawn_agent` in Rust, the `commands.spawnAgent` binding must be updated
manually. The specta type generation binary cannot run due to the WebView2 DLL issue
established in Phase 3/4. [VERIFIED: CONTEXT.md code_context]

**Current binding:**
```typescript
spawnAgent: (branch: string) => typedError<string, string>(...)
```

**New binding (manual update):**
```typescript
spawnAgent: (task: string, model: string, budgetDollars: number | null) =>
  typedError<string, string>(__TAURI_INVOKE("spawn_agent", { task, model, budgetDollars }))
```

**Note:** Tauri converts Rust `snake_case` parameter names to `camelCase` in the invoke
payload automatically. `budget_dollars` → `budgetDollars`. [VERIFIED: existing bindings.ts
pattern — all existing params use camelCase in the JS invoke call]

### Pattern 7: AgentOutputView Center Pane Takeover

`App.tsx` switches the center column based on `agentStore.expandedAgentId`:

```tsx
// Source: derived from App.tsx + chatStore/agentStore design [VERIFIED: codebase]
export default function App() {
  const expandedAgentId = useAgentStore(s => s.expandedAgentId);
  return (
    <div className="h-screen w-screen flex flex-row overflow-hidden bg-[oklch(0.11_0_0)]">
      <SessionSidebar />
      {expandedAgentId ? (
        <AgentOutputView agentId={expandedAgentId} />
      ) : (
        <ChatPane />
      )}
      <AgentPanel />
    </div>
  );
}
```

`AgentOutputView` renders:
- Top bar with task description + close button (sets `expandedAgentId` to null)
- `<MessageList />` but sourced from `agentStore.agents[id].messages` instead of `chatStore.items`

**Reuse MessageList:** `MessageList` currently reads from `useChatStore`. Two options:
(A) Pass items as props, refactoring MessageList to accept optional prop override.
(B) Create a thin `AgentMessageList` wrapper that renders the same virtualizer with agent messages.

Option B is simpler — no changes to Phase 4's MessageList. [ASSUMED]

### Anti-Patterns to Avoid

- **Sharing chatStore with agent output:** AgentOutputView must NOT read from chatStore. It reads from agentStore.agents[id].messages. Mixing them causes human chat messages to appear in agent views.
- **Single global event listener for all agents:** Do NOT try to demux a single listener by parsing agent IDs from payloads. The established pattern (Phase 3) is one relay task per agent on a channel named `agent-event:{id}`. Subscribe per-agent.
- **Budget check on frontend:** D-10 locked: enforcement is Rust-side. The frontend shows the cost from cumulative TurnCompleted events, but does NOT halts the agent.
- **Calling `run_agent_turn` for agents:** Agents run themselves once spawned (when ConversationRuntime wiring is complete). The `run_agent_turn` command is for the human chat session, not supervised agents. Agent task is passed at spawn time.
- **Forgetting to cancel rAF on unmount for each AgentCard:** Each card's `useAgentPanelEvents` hook must clean up its own rAF ref. Cards unmount when the AgentPanel re-renders (e.g., user scrolls). Missing cleanup causes stale rAF loops writing to unmounted store state.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OS notifications | Custom IPC + native APIs | `tauri-plugin-notification` | WinRT toast, macOS UNUserNotificationCenter, Linux libnotify — each has edge cases |
| Slug generation | Custom regex | Simple map + split (5 lines) | Already solved inline in commands.rs; no dep needed |
| Cost calculation | Duplicate pricing table | `UsageTracker::cost_usd()` in usage.rs | Already exists, already tested |
| Virtualized scroll | Custom windowing | `@tanstack/react-virtual` | Already installed, used in MessageList |
| Dialog component | Custom modal | shadcn `dialog` | Already installed in ui/ |
| Badge component | Inline span with class | shadcn `badge` | Already installed in ui/ |

**Key insight:** Every primitive for Phase 5 exists in the codebase or the installed plugin
ecosystem. This phase is plumbing and composition, not new infrastructure.

---

## Common Pitfalls

### Pitfall 1: AgentHandle Missing budget_dollars / task / model Fields
**What goes wrong:** `spawn_agent` stores these values nowhere; they are lost after the call returns. Budget enforcement and notification content cannot retrieve them.
**Why it happens:** `AgentHandle` currently only holds `agent_id`, `worktree_path`, `event_tx`, `broadcast_tx`, `cancel_tx`. [VERIFIED: handle.rs]
**How to avoid:** Add `task: String`, `model: String`, `budget_dollars: Option<f64>`, and `cumulative_cost: Arc<Mutex<f64>>` fields to `AgentHandle` before wiring the relay.
**Warning signs:** `spawn_event_relay` cannot access budget values at check time.

### Pitfall 2: run_agent_turn vs Agent Self-Execution Confusion
**What goes wrong:** Plan attempts to wire `run_agent_turn` to drive agent conversations in the dashboard, but that command is for the human chat session only.
**Why it happens:** The Phase 4 stub in `run_agent_turn` echoes the message — it looks like an agent executor.
**How to avoid:** Supervised agents receive their task at spawn time and self-execute via `ConversationRuntime`. The `spawn_agent` command is extended to accept `task: String`. The agent's conversation loop (when wired) reads the task from the handle's initial state. `run_agent_turn` is for the human ↔ chat session only.
**Warning signs:** Plan routes `SpawnAgentDialog`'s task field through `run_agent_turn`.

### Pitfall 3: Stale Closure in rAF Buffer (per-agent)
**What goes wrong:** Delta buffer accumulates but never flushes because the rAF callback captures a stale `agentId` closure.
**Why it happens:** `useAgentPanelEvents` uses `agentId` inside the rAF callback.
**How to avoid:** Capture `agentId` in the closure at hook mount time — it is stable (from props, not store state). Same pattern as `useAgentEvents.ts`. [VERIFIED: useAgentEvents.ts lines 63-68]

### Pitfall 4: Tauri invoke param naming (snake_case vs camelCase)
**What goes wrong:** Rust command fails because the TypeScript invoke sends `budget_dollars` but the Rust handler expects `budget_dollars` — or vice versa.
**Why it happens:** Tauri's invoke system expects camelCase keys in the JS `invoke()` payload that map to snake_case Rust param names.
**How to avoid:** In bindings.ts manual update, always use `budgetDollars` (camelCase) as the key in `__TAURI_INVOKE("spawn_agent", { task, model, budgetDollars })`. [VERIFIED: existing bindings.ts pattern — all existing calls use camelCase]

### Pitfall 5: notification:default vs individual permission grants
**What goes wrong:** Build fails or notifications silently do nothing because the capability grants individual `notification:allow-notify` but not `notification:default`.
**Why it happens:** Plugin README recommends `"notification:default"` but some examples show individual permission strings.
**How to avoid:** Use `"notification:default"` in `capabilities/default.json`. This is the bundled default permission set that includes all standard capabilities. [VERIFIED: github.com/tauri-apps/tauri-plugin-notification README]

### Pitfall 6: AgentPanel width conflicts with ChatPane on narrow screens
**What goes wrong:** With SessionSidebar (256px) + AgentPanel (320px) + ChatPane (flex-1), the minimum viable ChatPane width is whatever remains. On standard 1280px screens: 1280 - 256 - 320 = 704px, which is fine. On 1024px laptops: 1024 - 256 - 320 = 448px — tight but workable.
**Why it happens:** Three fixed columns.
**How to avoid:** D-02 locked: no resize handle. Accept 448px minimum. Use `min-w-0` on ChatPane.

### Pitfall 7: Agents stay in agentStore after stop_agent
**What goes wrong:** Stopped agents accumulate in the roster. Cards for dead agents show stale state.
**Why it happens:** `stop_agent` removes from Rust registry but frontend agentStore is not updated.
**How to avoid:** After `StateChanged(Done)` or `StateChanged(Failed)`, keep the record in agentStore (completed agents remain visible per D-03 — "running and completed agents"). Do NOT remove on stop. The `Stop` button can emit a `StateChanged(Failed)` event via the relay to mark it visually.

---

## Code Examples

### Notification Plugin Registration in lib.rs
```rust
// Source: tauri-plugin-notification README [CITED: github.com/tauri-apps/tauri-plugin-notification]
tauri::Builder::default()
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_notification::init())   // ADD THIS
    .manage(Arc::new(AgentSupervisor::new(repo_root)))
    // ...
```

### capabilities/default.json Addition
```json
{
  "permissions": [
    "core:default",
    "window-state:default",
    "clipboard-manager:allow-read-text",
    "clipboard-manager:allow-write-text",
    "fs:default",
    "notification:default"
  ]
}
```

### AgentHandle New Fields (handle.rs addition)
```rust
// Source: derived from existing AgentHandle + UsageTracker patterns [VERIFIED: codebase]
pub struct AgentHandle {
    pub agent_id: AgentId,
    pub worktree_path: std::path::PathBuf,
    pub event_tx: mpsc::Sender<AgentEvent>,
    broadcast_tx: broadcast::Sender<AgentEvent>,
    cancel_tx: mpsc::Sender<AgentControl>,
    // Phase 5 additions:
    pub task: String,
    pub model: String,
    pub budget_dollars: Option<f64>,
    pub cumulative_cost: Arc<Mutex<f64>>,
}

impl AgentHandle {
    pub fn accumulate_cost(&self, usage: &TokenUsage, model: &str) -> f64 {
        // Use UsageTracker for per-turn cost calculation
        let mut tracker = UsageTracker::new();
        tracker.record(*usage);
        let turn_cost = tracker.cost_usd(model);
        let mut cost = self.cumulative_cost.lock().unwrap();
        *cost += turn_cost;
        *cost
    }
}
```

### Budget Check in spawn_event_relay
```rust
// Source: derived from CLI is_over_budget() pattern + event relay pattern [VERIFIED: codebase]
// In the relay loop, after emitting TurnCompleted:
Ok(event) => {
    let _ = app_handle.emit(&channel, &event);
    // Budget enforcement (D-10, D-11)
    if let AgentEvent::TurnCompleted { ref usage } = event {
        if let Some(budget) = handle.budget_dollars {
            let new_cost = handle.accumulate_cost(usage, &handle.model);
            if new_cost >= budget {
                let _ = handle.event_tx.try_send(
                    AgentEvent::StateChanged(AgentState::Failed)
                );
                let _ = handle.event_tx.try_send(AgentEvent::Error {
                    message: format!("Budget exceeded: ${:.4}", new_cost),
                });
            }
        }
    }
}
```

### AgentStore Zustand Slice (skeleton)
```typescript
// Source: derived from chatStore.ts pattern [VERIFIED: codebase]
import { create } from "zustand";
import type { AgentState, TokenUsage } from "../bindings";
import type { ChatItem } from "./chatStore";

export interface AgentRecord {
  id: string;
  task: string;
  model: string;
  state: AgentState;
  cumulativeCost: number;
  messages: ChatItem[];
  streamingContent: string;
  isStreaming: boolean;
}

interface AgentStoreState {
  agents: AgentRecord[];
  expandedAgentId: string | null;
  addAgent: (id: string, task: string, model: string) => void;
  updateAgentState: (id: string, state: AgentState) => void;
  appendAgentStreamingContent: (id: string, delta: string) => void;
  finalizeAgentStream: (id: string, usage: TokenUsage) => void;
  startAgentToolCall: (id: string, toolCallId: string, tool: string, input: string) => void;
  completeAgentToolCall: (id: string, tool: string, output: string) => void;
  appendAgentError: (id: string, message: string) => void;
  setExpandedAgent: (id: string | null) => void;
}

export const useAgentStore = create<AgentStoreState>()((set) => ({
  agents: [],
  expandedAgentId: null,
  addAgent: (id, task, model) =>
    set((s) => ({
      agents: [...s.agents, {
        id, task, model,
        state: "Idle",
        cumulativeCost: 0,
        messages: [],
        streamingContent: "",
        isStreaming: false,
      }],
    })),
  updateAgentState: (id, state) =>
    set((s) => ({
      agents: s.agents.map(a =>
        a.id === id ? { ...a, state } : a
      ),
    })),
  appendAgentStreamingContent: (id, delta) =>
    set((s) => ({
      agents: s.agents.map(a =>
        a.id === id
          ? { ...a, streamingContent: a.streamingContent + delta, isStreaming: true }
          : a
      ),
    })),
  finalizeAgentStream: (id, usage) =>
    set((s) => ({
      agents: s.agents.map(a => {
        if (a.id !== id) return a;
        const msg = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
          role: "assistant" as const,
          content: a.streamingContent,
          toolCalls: [],
          usage,
        };
        // cost_usd equivalent: rough estimate client-side (sonnet rate)
        const turnCost = (usage.input_tokens * 3 + usage.output_tokens * 15) / 1_000_000;
        return {
          ...a,
          messages: [...a.messages, msg],
          streamingContent: "",
          isStreaming: false,
          cumulativeCost: a.cumulativeCost + turnCost,
        };
      }),
    })),
  setExpandedAgent: (id) => set({ expandedAgentId: id }),
  // startAgentToolCall, completeAgentToolCall, appendAgentError: mirror chatStore patterns
}));
```

**Note on cost in agentStore:** The `cumulativeCost` accumulated in the store is a
client-side estimate (for display). The authoritative enforcement is Rust-side per D-10/D-11.
The client-side value uses simplified rates. This is acceptable for display purposes.
[ASSUMED — no requirement for exact match between display and enforcement values]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `spawn_agent(branch: String)` | `spawn_agent(task, model, budget_dollars)` | Phase 5 | Enables per-agent model and budget |
| 2-column App.tsx | 3-column App.tsx | Phase 5 | AgentPanel always visible |
| Single chatStore | chatStore + agentStore | Phase 5 | Each agent has isolated message list |
| Budget check in CLI REPL loop | Budget check in Tauri event relay | Phase 5 | Consistent enforcement regardless of UI |

**Deprecated/outdated:**
- Phase 4 `spawn_agent` signature (single `branch` param): replaced by task+model+budget signature. Old `branch` field derived internally from task slug.
- Phase 4 hardcoded cost `formatCostBar(0, ...)`: Phase 5 should fix this as part of connecting real ConversationRuntime. Not a Phase 5 blocker but a known debt item.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | AgentOutputView should use a new AgentMessageList component rather than refactoring MessageList to accept props | Architecture Patterns §Pattern 7 | If wrong, MessageList needs a prop-based refactor. Low impact — either approach works |
| A2 | Client-side cost accumulation in agentStore uses simplified per-model rates (acceptable for display) | Code Examples §AgentStore | If exact display accuracy required, must call into Rust cost_usd or replicate the full pricing table in TS |
| A3 | useAgentPanelEvents is called once per AgentCard (not once per expanded view) and the expanded view reads from store | Architecture Patterns §Pattern 4 | If cards unmount when panel collapses, subscriptions are lost. Cards must stay mounted (CSS hidden, not unmounted) or subscription must re-attach |
| A4 | `try_send` in budget enforcement (non-blocking) is safe because the channel has capacity 64 | Code Examples §Budget Check | If channel is full at budget exceeded moment, enforcement events are silently dropped. Consider `send().await` in a spawned task instead |

---

## Open Questions

1. **When does ConversationRuntime wiring happen for supervised agents?** (RESOLVED in plan 05-03 Task 3, 2026-05-10)
   - What we know: `run_agent_turn` is currently a stub. The agent does nothing after spawn until `ConversationRuntime` is wired.
   - What's unclear: Phase 5 describes agents "running" — but the runtime wiring is Phase 4 carryover. Is real AI execution in scope for Phase 5, or do agents still show stub behavior?
   - Recommendation: Plan should include wiring `ConversationRuntime` in `spawn_agent` (the agent self-runs on the initial task). Budget enforcement requires real token events to trigger. If left as stub, budget/cost display shows $0.
   - **Resolution:** Plan 05-03 Task 3 wires `spawn_agent_executor` which spawns the existing CLI binary as a child process with `--task-prompt --model --working-dir` and streams NDJSON `AgentEvent` lines from stdout into `handle.event_tx`. Chosen over in-process `ConversationRuntime` because the Tauri layer does not yet construct ApiClient/ToolExecutor/Session and `SubAgentSpawner` (Phase 2, ORC-06) already encapsulates the subprocess pattern. Real TextDelta + TurnCompleted events now flow, making AGT-02 and AGT-06 verifiable end-to-end.

2. **AgentCards persistence: should completed agents survive app restart?** (RESOLVED — in-memory only per recommendation; no persistence in Phase 5)
   - What we know: AGT-01 says "all running and completed agents." No persistence requirement stated.
   - What's unclear: Does the roster reset on app restart?
   - Recommendation: In-memory only for Phase 5 (store resets on app close). No persistence requirement stated in CONTEXT.md or REQUIREMENTS.md.

3. **Notification permission request timing** (RESOLVED — useAgentPanelEvents calls requestPermission() lazily on first Done/Failed)
   - What we know: `requestPermission()` must be called before `sendNotification()`. On Windows in dev, notifications fire but show PowerShell identity.
   - What's unclear: Where to call `requestPermission()`? On first agent spawn? On app start?
   - Recommendation: Call `requestPermission()` lazily on first `StateChanged(Done|Failed)` event, cache result in agentStore or module-level variable.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `tauri-plugin-notification` (Rust) | AGT-04 OS notifications | ✗ (not in Cargo.toml yet) | 2.3.3 available on crates.io | None — required |
| `@tauri-apps/plugin-notification` (JS) | AGT-04 | ✗ (not in package.json yet) | 2.3.3 on npm | None — required |
| `git worktree add` (CLI) | D-08 worktree creation | ✓ | git already used in supervisor.rs | — |
| Tauri app build toolchain | All | ✓ | MSVC, phase 3+ established | — |
| Windows toast notifications (dev) | AGT-04 | ✓ (with PowerShell identity) | WinRT available on Windows 11 | Dev shows as PowerShell toast — acceptable |

**Missing dependencies with no fallback:**
- `tauri-plugin-notification` (Rust + JS): must be installed as part of Wave 0 setup.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.5 |
| Config file | `tauri-app/vitest.config.ts` |
| Quick run command | `npm test` (in tauri-app/) |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AGT-01 | AgentCard renders state badge, truncated task, cost | unit | `npm test -- agentStore` | ❌ Wave 0 |
| AGT-02 | AgentOutputView shows messages from agentStore | unit | `npm test -- agentStore` | ❌ Wave 0 |
| AGT-03 | SpawnAgentDialog collects model/task/budget fields | unit | `npm test -- spawnDialog` | ❌ Wave 0 |
| AGT-04 | Notification fires on Done/Failed events | manual-only | N/A — requires running OS | N/A |
| AGT-05 | Each AgentRecord stores independent model | unit | `npm test -- agentStore` | ❌ Wave 0 |
| AGT-06 | Budget enforcement: cost accumulation + halt logic | unit (Rust) + unit (TS) | `cargo test -p runtime` + `npm test` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test` (in tauri-app/)
- **Per wave merge:** `npm test` + `cargo test -p runtime`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tauri-app/src/stores/agentStore.test.ts` — covers AGT-01, AGT-02, AGT-05, AGT-06 (TS cost accumulation)
- [ ] `rust/crates/runtime/src/supervisor/tests.rs` — add budget enforcement test to existing test file (AGT-06 Rust side)
- [ ] `tauri-app/src/components/agent/AgentCard.test.tsx` — renders badge + truncated task
- [ ] `tauri-app/src/lib/slug.test.ts` — covers slugify_task (or inline test in Rust)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | Budget field: parse as f64, reject negative/NaN. Task field: used as slug — strip non-alphanumeric. Path traversal prevention: already in commands.rs for session IDs (same pattern). |
| V6 Cryptography | no | — |

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Task description → branch name injection | Tampering | slugify_task() strips all non-alphanumeric chars before passing to git worktree add; add explicit length cap |
| Negative/NaN budget bypasses enforcement | Tampering | Validate `budget_dollars > 0.0` before storing; reject NaN/infinity |
| Notification content injection | Spoofing | Truncate task string before use in title (already planned as 60 chars); no HTML rendering in WinRT toasts |
| Path traversal via branch name | Tampering | Already mitigated: WorktreeManager uses the slugified path; existing session ID validation pattern applies |

---

## Sources

### Primary (HIGH confidence)
- `tauri-app/src-tauri/src/commands.rs` — existing spawn_agent, run_agent_turn, event relay [VERIFIED: codebase]
- `rust/crates/runtime/src/supervisor/supervisor.rs` — AgentSupervisor.spawn_agent() [VERIFIED: codebase]
- `rust/crates/runtime/src/supervisor/agent_state.rs` — AgentEvent, AgentState enums [VERIFIED: codebase]
- `rust/crates/runtime/src/usage.rs` — UsageTracker.cost_usd() [VERIFIED: codebase]
- `rust/crates/rusty-claude-cli/src/main.rs` — is_over_budget() CLI pattern [VERIFIED: codebase]
- `tauri-app/src/stores/chatStore.ts` — Zustand pattern with rAF buffer [VERIFIED: codebase]
- `tauri-app/src/hooks/useAgentEvents.ts` — event subscription pattern [VERIFIED: codebase]
- `tauri-app/src/bindings.ts` — TypeScript type contract [VERIFIED: codebase]
- `tauri-app/src-tauri/Cargo.toml` — existing plugin deps [VERIFIED: codebase]
- `tauri-app/src-tauri/capabilities/default.json` — capability structure [VERIFIED: codebase]
- cargo search tauri-plugin-notification — version 2.3.3 [VERIFIED: cargo registry]
- npm view @tauri-apps/plugin-notification — version 2.3.3 [VERIFIED: npm registry]

### Secondary (MEDIUM confidence)
- [v2.tauri.app/plugin/notification/](https://v2.tauri.app/plugin/notification/) — capability grant `notification:default`, Windows dev behavior [CITED]
- [github.com/tauri-apps/tauri-plugin-notification](https://github.com/tauri-apps/tauri-plugin-notification) — Cargo dep string, JS API signatures, capability identifier [CITED]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies verified against codebase and registries
- Architecture: HIGH — derived directly from existing Phase 3/4 patterns in codebase
- Budget enforcement: HIGH — CLI pattern verified, extension path clear
- Notification plugin: MEDIUM — API verified from docs; Windows production behavior untested in this project
- Pitfalls: HIGH — derived from codebase reading, not speculation

**Research date:** 2026-05-10
**Valid until:** 2026-06-10 (Tauri plugin versions; 30-day estimate for stable ecosystem)
