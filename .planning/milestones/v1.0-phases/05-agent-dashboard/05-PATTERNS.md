# Phase 5: Agent Dashboard - Pattern Map

**Mapped:** 2026-05-10
**Files analyzed:** 13 (6 new, 7 modified)
**Analogs found:** 13 / 13

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `tauri-app/src/stores/agentStore.ts` | store | event-driven | `tauri-app/src/stores/chatStore.ts` | exact |
| `tauri-app/src/hooks/useAgentPanelEvents.ts` | hook | event-driven | `tauri-app/src/hooks/useAgentEvents.ts` | exact |
| `tauri-app/src/components/agent/AgentPanel.tsx` | component | request-response | `tauri-app/src/components/sidebar/SessionSidebar.tsx` | role-match |
| `tauri-app/src/components/agent/AgentCard.tsx` | component | request-response | `tauri-app/src/components/sidebar/SessionItem.tsx` (inferred from SessionSidebar) + `PermissionCard.tsx` | role-match |
| `tauri-app/src/components/agent/AgentOutputView.tsx` | component | streaming | `tauri-app/src/components/chat/ChatPane.tsx` | role-match |
| `tauri-app/src/components/agent/SpawnAgentDialog.tsx` | component | request-response | `tauri-app/src/components/chat/PermissionCard.tsx` (shadcn Card/Button) | partial |
| `tauri-app/src/App.tsx` | config | request-response | `tauri-app/src/App.tsx` (self — extend) | exact |
| `tauri-app/src-tauri/src/commands.rs` | controller | request-response | `tauri-app/src-tauri/src/commands.rs` (self — extend spawn_agent) | exact |
| `tauri-app/src-tauri/src/lib.rs` | config | request-response | `tauri-app/src-tauri/src/lib.rs` (self — extend plugin chain) | exact |
| `tauri-app/src-tauri/Cargo.toml` | config | — | existing plugin entries in Cargo.toml | exact |
| `tauri-app/src-tauri/capabilities/default.json` | config | — | `tauri-app/src-tauri/capabilities/default.json` (self — extend) | exact |
| `tauri-app/src/bindings.ts` | config | — | `tauri-app/src/bindings.ts` (self — manual update) | exact |
| `rust/crates/runtime/src/supervisor/handle.rs` | model | event-driven | `rust/crates/runtime/src/supervisor/handle.rs` (self — extend) | exact |

---

## Pattern Assignments

### `tauri-app/src/stores/agentStore.ts` (store, event-driven)

**Analog:** `tauri-app/src/stores/chatStore.ts`

**Imports pattern** (chatStore.ts lines 1-2):
```typescript
import { create } from "zustand";
import type { TokenUsage } from "../bindings";
```

**Interface/type pattern** (chatStore.ts lines 4-39):
```typescript
export interface ToolCall {
  id: string;
  tool: string;
  input: string;
  output?: string;
  loading: boolean;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls: ToolCall[];
  usage?: TokenUsage;
  stopped?: boolean;
}

export type ChatItem = Message | PermissionItem;
```
> For agentStore, define `AgentRecord` and `AgentStoreState` instead of `ChatState`. Reuse `ToolCall`, `Message`, `ChatItem` types by importing from `chatStore.ts`.

**Store creation pattern** (chatStore.ts lines 143-151):
```typescript
export const useChatStore = create<ChatState>()((set, _get) => ({
  agentId: null,
  items: [],
  streamingContent: "",
  isStreaming: false,
  model: DEFAULT_MODEL,
  sessionUsage: EMPTY_USAGE,
  alwaysAllowedTools: new Set(),
```
> For agentStore: `export const useAgentStore = create<AgentStoreState>()((set) => ({ agents: [], expandedAgentId: null, ...actions }))`.

**Streaming buffer action pattern** (chatStore.ts lines 157-176):
```typescript
appendStreamingContent: (delta) =>
  set((state) => ({ streamingContent: state.streamingContent + delta, isStreaming: true })),

finalizeStream: (usage) =>
  set((state) => {
    if (!state.streamingContent && !state.isStreaming) return state;
    const assistantMessage: Message = {
      id: generateId(),
      role: "assistant",
      content: state.streamingContent,
      toolCalls: [],
      usage,
    };
    return {
      items: [...state.items, assistantMessage],
      streamingContent: "",
      isStreaming: false,
      sessionUsage: addUsage(state.sessionUsage, usage),
    };
  }),
```
> For agentStore: wrap each action to target `agents.find(a => a.id === id)` then return updated `agents` array via `.map()`.

**Tool call pattern** (chatStore.ts lines 196-231):
```typescript
startToolCall: (toolCallId, tool, input) =>
  set((state) => {
    const toolCall: ToolCall = { id: toolCallId, tool, input, loading: true };
    const items = [...state.items];
    const lastIdx = items.length - 1;
    if (lastIdx >= 0 && (items[lastIdx] as Message).role === "assistant") {
      const lastMsg = { ...(items[lastIdx] as Message) };
      lastMsg.toolCalls = [...lastMsg.toolCalls, toolCall];
      items[lastIdx] = lastMsg;
      return { items };
    }
    const placeholder: Message = { id: generateId(), role: "assistant", content: "", toolCalls: [toolCall] };
    return { items: [...items, placeholder] };
  }),
```
> For agentStore: same logic, but scoped to `agents.map(a => a.id === id ? { ...a, messages: updatedMessages } : a)`.

**ID helper** (chatStore.ts line 139-141):
```typescript
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
```
> Copy directly into agentStore.ts.

---

### `tauri-app/src/hooks/useAgentPanelEvents.ts` (hook, event-driven)

**Analog:** `tauri-app/src/hooks/useAgentEvents.ts`

**Imports + signature pattern** (useAgentEvents.ts lines 1-6, 42-44):
```typescript
import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type { AgentEvent } from "../bindings";
import { useChatStore } from "../stores/chatStore";
// ...

export function useAgentEvents(agentId: string | null) {
  const deltaBuffer = useRef<string>("");
  const rafId = useRef<number | null>(null);
```
> For useAgentPanelEvents: replace `useChatStore` import with `useAgentStore` from `../stores/agentStore`. Signature takes `agentId: string` (not nullable — cards only mount with a real id).

**rAF buffer + TextDelta pattern** (useAgentEvents.ts lines 46-74):
```typescript
useEffect(() => {
  if (!agentId) return;
  const unlisteners: Array<() => void> = [];
  const agentChannel = `agent-event:${agentId}`;

  const agentUnlistenPromise = listen<AgentEvent>(agentChannel, (event) => {
    const payload = event.payload;

    if ("TextDelta" in payload) {
      deltaBuffer.current += payload.TextDelta;
      if (rafId.current === null) {
        rafId.current = requestAnimationFrame(() => {
          const delta = deltaBuffer.current;
          deltaBuffer.current = "";
          rafId.current = null;
          if (delta) {
            useChatStore.getState().appendStreamingContent(delta);
          }
        });
      }
      return;
    }
```
> Replace `useChatStore.getState().appendStreamingContent(delta)` with `useAgentStore.getState().appendAgentStreamingContent(agentId, delta)`.

**TurnCompleted + rAF flush pattern** (useAgentEvents.ts lines 90-117):
```typescript
if ("TurnCompleted" in payload && payload.TurnCompleted) {
  const { usage } = payload.TurnCompleted;
  // Cancel any pending rAF before finalizing
  if (rafId.current !== null) {
    cancelAnimationFrame(rafId.current);
    rafId.current = null;
    const delta = deltaBuffer.current;
    deltaBuffer.current = "";
    if (delta) useChatStore.getState().appendStreamingContent(delta);
  }
  useChatStore.getState().finalizeStream(usage);
  return;
}
```
> Replace store calls with `useAgentStore.getState().finalizeAgentStream(agentId, usage)`. Remove session-save logic (agents don't persist to session files).

**OS notification on StateChanged** — add after the existing `StateChanged` handler (no analog in useAgentEvents.ts — new code):
```typescript
if ("StateChanged" in payload) {
  const state = payload.StateChanged;
  useAgentStore.getState().updateAgentState(agentId, state);
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
```

**Cleanup pattern** (useAgentEvents.ts lines 179-188):
```typescript
return () => {
  if (rafId.current !== null) {
    cancelAnimationFrame(rafId.current);
    rafId.current = null;
  }
  for (const unlisten of unlisteners) {
    unlisten();
  }
};
```
> Copy exactly. Called when AgentCard unmounts.

---

### `tauri-app/src/components/agent/AgentPanel.tsx` (component, request-response)

**Analog:** `tauri-app/src/components/sidebar/SessionSidebar.tsx`

**Panel shell pattern** (SessionSidebar.tsx lines 16-87, condensed key structure):
```tsx
export function SessionSidebar() {
  // ...store hooks...
  return (
    <aside className="w-64 flex-none flex flex-col border-r border-neutral-800 bg-[oklch(0.16_0_0)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 flex-none border-b border-neutral-800">
        <span className="text-xs font-normal text-[oklch(0.55_0_0)]">SESSIONS</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="New session" onClick={...}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        {/* list items */}
      </ScrollArea>
    </aside>
  );
}
```
> For AgentPanel: `w-80` (320px) instead of `w-64`, `border-l` instead of `border-r`, label "AGENTS", button opens SpawnAgentDialog. List `useAgentStore(s => s.agents)` and render one `<AgentCard>` per agent.

**Empty state pattern** (SessionSidebar.tsx lines 65-73):
```tsx
{!sessions || sessions.length === 0 ? (
  <div className="flex flex-col items-center justify-center h-40 px-4 gap-2 text-center">
    <p className="text-sm font-semibold text-[oklch(0.92_0_0)]">No sessions yet</p>
    <p className="text-xs text-[oklch(0.55_0_0)]">...</p>
  </div>
) : (
  <div className="flex flex-col py-2">
    {sessions.map((session) => ( ... ))}
  </div>
)}
```
> For AgentPanel: same structure, empty state text "No agents yet. Click + to spawn one."

---

### `tauri-app/src/components/agent/AgentCard.tsx` (component, request-response)

**Analog:** `tauri-app/src/components/chat/PermissionCard.tsx` (Badge + Button pattern) + SessionSidebar list item structure

**Badge import pattern** (PermissionCard.tsx lines 1-13):
```tsx
import { ShieldAlert, Check, X, Lock } from "lucide-react";
import { Card, CardHeader, CardContent, CardFooter } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { commands } from "../../bindings";
import { useChatStore } from "../../stores/chatStore";
```
> For AgentCard: import `Badge` from `../ui/badge`, `Button` from `../ui/button`, icons from `lucide-react` (use `ChevronRight` for expand, `Loader2` for executing spinner). Import `useAgentStore` and `AgentRecord`.

**Badge variant pattern** (PermissionCard.tsx lines 108-128):
```tsx
function ResolvedBadge({ decision }: { decision: "Allow" | "Deny" | "AlwaysAllow" }) {
  if (decision === "Allow") {
    return (
      <Badge className="bg-green-900/30 text-[oklch(0.60_0.16_145)] border-green-800">
        <Check className="h-3 w-3 mr-1" /> Allowed
      </Badge>
    );
  }
  // ...
}
```
> For AgentCard: define `AgentStateBadge({ state: AgentState })` with color map:
> - Idle → `bg-neutral-800 text-[oklch(0.55_0_0)]`
> - Planning → `bg-blue-900/40 text-blue-400 border-blue-800`
> - Executing → `bg-green-900/40 text-green-400 border-green-800` (+ `animate-pulse` on the dot)
> - Waiting → `bg-amber-900/40 text-amber-400 border-amber-800`
> - Done → `bg-emerald-900/40 text-emerald-400 border-emerald-800`
> - Failed → `bg-red-900/40 text-red-400 border-red-800`

**Async button handler pattern** (PermissionCard.tsx lines 29-40):
```tsx
async function handleDecision(decision: "Allow" | "Deny" | "AlwaysAllow") {
  resolvePermission(item.promptId, decision);
  if (decision === "AlwaysAllow") {
    addAlwaysAllow(item.toolName);
  }
  const result = await commands.respondToPermission(item.promptId, decision);
  if (result.status === "error") {
    console.error("respondToPermission error:", result.error);
  }
}
```
> For AgentCard expand button: `onClick={() => useAgentStore.getState().setExpandedAgent(record.id)}`. For stop button: `await commands.stopAgent(record.id)`.

---

### `tauri-app/src/components/agent/AgentOutputView.tsx` (component, streaming)

**Analog:** `tauri-app/src/components/chat/ChatPane.tsx`

**Pane shell pattern** (ChatPane.tsx lines 21-84, condensed):
```tsx
export function ChatPane() {
  const { model, setModel, isStreaming, sessionUsage } = useChatStore();
  const agentId = useChatStore((s) => s.agentId);
  useAgentEvents(agentId);

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-[oklch(0.11_0_0)]">
      {/* Top bar */}
      <div className="h-12 flex-none flex items-center justify-between px-4 border-b border-neutral-800">
        {/* ... model selector, cost ... */}
      </div>
      {/* Message list */}
      <div className="flex-1 min-h-0">
        <MessageList />
      </div>
      {/* Input bar */}
      <MessageInput />
    </div>
  );
}
```
> For AgentOutputView: `flex-1 min-w-0` identical. Replace top bar content with task description + close button (sets `expandedAgentId` to null). Replace `<MessageList />` with `<AgentMessageList agentId={agentId} />`. **Omit `<MessageInput />`** entirely (D-05: read-only). No model selector — agent model was set at spawn.

**Stop button / action button pattern** (ChatPane.tsx lines 87-111):
```tsx
function StopButton() {
  const { agentId, cancelStream } = useChatStore();
  async function handleStop() {
    if (agentId) {
      cancelStream();
      const result = await commands.stopAgent(agentId);
      if (result.status === "error") {
        console.error("stop_agent error:", result.error);
      }
    }
  }
  return (
    <Button variant="outline" size="icon"
      className="h-8 w-8 border-[oklch(0.60_0.20_25)] text-[oklch(0.60_0.20_25)] hover:bg-[oklch(0.60_0.20_25)]/10"
      onClick={() => void handleStop()}>
      <Square className="h-4 w-4 fill-current" />
    </Button>
  );
}
```
> For AgentOutputView close button: same `Button variant="ghost"` with `X` icon from lucide-react, `onClick={() => setExpandedAgent(null)}`.

**MessageList virtualizer approach** — AgentMessageList is a thin wrapper reusing the same virtualizer logic (MessageList.tsx lines 15-97):
```tsx
export function MessageList() {
  const { items, streamingContent, isStreaming } = useChatStore();
  const parentRef = useRef<HTMLDivElement>(null);
  // ...
  const virtualizer = useVirtualizer({
    count: totalCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    measureElement: (el) => el?.getBoundingClientRect().height ?? 80,
    overscan: 5,
  });
```
> Create `AgentMessageList({ agentId }: { agentId: string })` that reads `useAgentStore(s => s.agents.find(a => a.id === agentId))` and renders the identical virtualizer structure. Reuse `<MessageItem>` and `<StreamingMessage>` components from `./Message` unchanged.

---

### `tauri-app/src/components/agent/SpawnAgentDialog.tsx` (component, request-response)

**Analog:** shadcn Dialog + `PermissionCard.tsx` Button/Card pattern

**shadcn Dialog import pattern** (derived from existing shadcn usage in project):
```tsx
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../ui/dialog";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
```

**listModels + state pattern** (ChatPane.tsx lines 25-31):
```tsx
const [availableModels, setAvailableModels] = useState<string[]>([model]);

useEffect(() => {
  void commands.listModels().then((models) => {
    if (models.length > 0) setAvailableModels(models);
  });
}, []);
```
> Copy exactly into SpawnAgentDialog for populating the model dropdown.

**Async command call + error check pattern** (PermissionCard.tsx lines 36-40):
```tsx
const result = await commands.respondToPermission(item.promptId, decision);
if (result.status === "error") {
  console.error("respondToPermission error:", result.error);
}
```
> For spawn: `const result = await commands.spawnAgent(task, model, budgetDollars); if (result.status === "error") { setError(result.error); return; }`. On success: `useAgentStore.getState().addAgent(result.data, task, model); onClose();`.

**Button pattern** (PermissionCard.tsx lines 71-99):
```tsx
<Button variant="outline" size="sm"
  className="border-green-700 text-[oklch(0.60_0.16_145)] hover:bg-green-900/20 h-8"
  onClick={() => void handleDecision("Allow")}>
  <Check className="h-3.5 w-3.5 mr-1" />
  Allow
</Button>
```
> For spawn submit: `<Button onClick={() => void handleSpawn()}>Spawn Agent</Button>`. Use `variant="default"` or match the green-border style from PermissionCard.

---

### `tauri-app/src/App.tsx` (config, request-response)

**Analog:** `tauri-app/src/App.tsx` (self — extend)

**Current pattern** (App.tsx lines 1-17 — full file):
```tsx
import "./styles.css";
import { SessionSidebar } from "./components/sidebar/SessionSidebar";
import { ChatPane } from "./components/chat/ChatPane";

export default function App() {
  return (
    <div className="h-screen w-screen flex flex-row overflow-hidden bg-[oklch(0.11_0_0)]">
      <SessionSidebar />
      <ChatPane />
    </div>
  );
}
```

**Extended 3-column pattern:**
```tsx
import "./styles.css";
import { SessionSidebar } from "./components/sidebar/SessionSidebar";
import { ChatPane } from "./components/chat/ChatPane";
import { AgentPanel } from "./components/agent/AgentPanel";
import { AgentOutputView } from "./components/agent/AgentOutputView";
import { useAgentStore } from "./stores/agentStore";

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
> Add `min-w-0` to center column wrapper if needed (D-02 / Pitfall 6).

---

### `tauri-app/src-tauri/src/commands.rs` (controller, request-response)

**Analog:** `tauri-app/src-tauri/src/commands.rs` (self — extend `spawn_agent` and `spawn_event_relay`)

**Current spawn_agent signature** (commands.rs lines 16-29):
```rust
#[tauri::command]
#[specta::specta]
pub fn spawn_agent(
    supervisor: tauri::State<'_, Arc<AgentSupervisor>>,
    app_handle: AppHandle,
    branch: String,
) -> Result<String, String> {
    let agent_id = supervisor.spawn_agent(&branch).map_err(|e| e.to_string())?;
    if let Some(handle) = supervisor.get_handle(&agent_id) {
        spawn_event_relay(app_handle, agent_id.clone(), handle);
    }
    Ok(agent_id.0)
}
```
> Extend to: `task: String, model: String, budget_dollars: Option<f64>` (remove `branch`). Derive branch via `slugify_task(&task)`. Call `supervisor.spawn_agent_with_config(&branch, &task, &model, budget_dollars)`.

**Current event relay** (commands.rs lines 267-292):
```rust
pub(crate) fn spawn_event_relay(
    app_handle: AppHandle,
    agent_id: AgentId,
    handle: AgentHandle,
) {
    let mut rx = handle.subscribe();
    let channel = format!("agent-event:{}", agent_id.0);
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let _ = app_handle.emit(&channel, &event);
                }
                Err(RecvError::Lagged(n)) => {
                    let _ = app_handle.emit(
                        &channel,
                        serde_json::json!({ "type": "EventsLost", "count": n }),
                    );
                }
                Err(RecvError::Closed) => break,
            }
        }
    });
}
```
> Insert budget enforcement after `Ok(event) => { let _ = app_handle.emit(...); }`:
```rust
Ok(event) => {
    let _ = app_handle.emit(&channel, &event);
    // Budget enforcement (D-10)
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

**Command registration pattern** (lib.rs lines 18-32):
```rust
Builder::<tauri::Wry>::new()
    .commands(collect_commands![
        smoke_test,
        spawn_agent,
        // ... other commands
    ])
```
> No new commands needed for Phase 5 beyond updating `spawn_agent` signature.

**Input validation pattern** (commands.rs lines 213-215):
```rust
if !id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
    return Err("invalid session id".to_string());
}
```
> For budget_dollars: validate `budget_dollars.map(|b| b > 0.0 && b.is_finite()).unwrap_or(true)` before storing. Reject negative/NaN/infinite budgets.

---

### `tauri-app/src-tauri/src/lib.rs` (config, request-response)

**Analog:** `tauri-app/src-tauri/src/lib.rs` (self — extend plugin chain)

**Current plugin chain** (lib.rs lines 66-78):
```rust
tauri::Builder::default()
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_fs::init())
    .manage(Arc::new(AgentSupervisor::new(repo_root)))
    .manage(PendingPrompts::default())
    .invoke_handler(builder.invoke_handler())
    .setup(move |app| {
        builder.mount_events(app);
        Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```
> Add `.plugin(tauri_plugin_notification::init())` after `tauri_plugin_fs::init()`. No other changes to lib.rs.

---

### `tauri-app/src-tauri/capabilities/default.json` (config)

**Analog:** `tauri-app/src-tauri/capabilities/default.json` (self — extend)

**Current permissions array** (default.json lines 6-12):
```json
"permissions": [
  "core:default",
  "window-state:default",
  "clipboard-manager:allow-read-text",
  "clipboard-manager:allow-write-text",
  "fs:default"
]
```
> Add `"notification:default"` as the last entry. No other changes.

---

### `tauri-app/src/bindings.ts` (config — manual update)

**Analog:** `tauri-app/src/bindings.ts` (self — manual update)

**Current spawnAgent binding** (bindings.ts line 12):
```typescript
spawnAgent: (branch: string) => typedError<string, string>(__TAURI_INVOKE("spawn_agent", { branch })),
```

**Updated binding** (replace line 12):
```typescript
/** spawn_agent: spawns a new agent with task, model, and optional budget. Returns agent ID. */
spawnAgent: (task: string, model: string, budgetDollars: number | null) =>
  typedError<string, string>(__TAURI_INVOKE("spawn_agent", { task, model, budgetDollars })),
```
> Note: Tauri maps Rust `budget_dollars` param to JS `budgetDollars` key automatically. `number | null` maps to Rust `Option<f64>`.

---

### `rust/crates/runtime/src/supervisor/handle.rs` (model, event-driven)

**Analog:** `rust/crates/runtime/src/supervisor/handle.rs` (self — extend)

**Current AgentHandle struct** (handle.rs lines 31-49):
```rust
#[derive(Clone)]
pub struct AgentHandle {
    pub agent_id: AgentId,
    pub worktree_path: PathBuf,
    pub event_tx: mpsc::Sender<AgentEvent>,
    broadcast_tx: broadcast::Sender<AgentEvent>,
    cancel_tx: mpsc::Sender<AgentControl>,
    pub paused: Arc<AtomicBool>,
    pub state: Arc<std::sync::Mutex<AgentState>>,
}
```
> Add three fields (Phase 5):
```rust
pub task: String,
pub model: String,
pub budget_dollars: Option<f64>,
pub cumulative_cost: Arc<std::sync::Mutex<f64>>,
```

**Current `new()` constructor** (handle.rs lines 51-71):
```rust
pub(crate) fn new(
    agent_id: AgentId,
    worktree_path: PathBuf,
    event_tx: mpsc::Sender<AgentEvent>,
    broadcast_tx: broadcast::Sender<AgentEvent>,
    cancel_tx: mpsc::Sender<AgentControl>,
) -> Self {
    Self {
        agent_id,
        worktree_path,
        event_tx,
        broadcast_tx,
        cancel_tx,
        paused: Arc::new(AtomicBool::new(false)),
        state: Arc::new(std::sync::Mutex::new(AgentState::Idle)),
    }
}
```
> Extend to accept `task: String, model: String, budget_dollars: Option<f64>` and initialize `cumulative_cost: Arc::new(std::sync::Mutex::new(0.0_f64))`.

**New method to add** (`accumulate_cost` — no existing analog, derived from usage.rs):
```rust
pub fn accumulate_cost(&self, usage: &crate::usage::TokenUsage, model: &str) -> f64 {
    let mut tracker = crate::usage::UsageTracker::new();
    tracker.record(*usage);
    let turn_cost = tracker.cost_usd(model);
    let mut cost = self.cumulative_cost.lock().unwrap();
    *cost += turn_cost;
    *cost
}
```
> `UsageTracker::cost_usd()` exists at `rust/crates/runtime/src/usage.rs` lines 77-93 and accepts `&str` model name. Per-turn cost = `tracker.cost_usd(model)` on a fresh tracker with only the turn's usage recorded.

---

## Shared Patterns

### Dark Palette (all new components)
**Source:** `tauri-app/src/components/sidebar/SessionSidebar.tsx` and `ChatPane.tsx`
**Apply to:** All new React components
```tsx
// Background tiers:
bg-[oklch(0.11_0_0)]   // page/pane background (same as ChatPane)
bg-[oklch(0.16_0_0)]   // sidebar/panel background (same as SessionSidebar)
bg-[oklch(0.20_0_0)]   // card/hover background

// Text:
text-[oklch(0.92_0_0)] // primary text
text-[oklch(0.55_0_0)] // muted/label text

// Borders:
border-neutral-800     // all dividers
```

### Tauri Command Call + Error Check
**Source:** `tauri-app/src/components/chat/PermissionCard.tsx` lines 36-40
**Apply to:** `SpawnAgentDialog.tsx`, `AgentCard.tsx` (stop button)
```typescript
const result = await commands.someCommand(args);
if (result.status === "error") {
  console.error("command error:", result.error);
  return; // or setError(result.error)
}
// use result.data
```

### rAF Delta Buffer + Cleanup
**Source:** `tauri-app/src/hooks/useAgentEvents.ts` lines 43-44, 63-68, 179-188
**Apply to:** `useAgentPanelEvents.ts`
```typescript
const deltaBuffer = useRef<string>("");
const rafId = useRef<number | null>(null);
// ... inside listen callback for TextDelta:
deltaBuffer.current += payload.TextDelta;
if (rafId.current === null) {
  rafId.current = requestAnimationFrame(() => {
    const delta = deltaBuffer.current;
    deltaBuffer.current = "";
    rafId.current = null;
    if (delta) { /* write to store */ }
  });
}
// ... cleanup:
return () => {
  if (rafId.current !== null) { cancelAnimationFrame(rafId.current); rafId.current = null; }
  for (const unlisten of unlisteners) { unlisten(); }
};
```

### Zustand Functional Update (no stale closure)
**Source:** `tauri-app/src/stores/chatStore.ts` lines 157-158
**Apply to:** `agentStore.ts` all set() calls
```typescript
// Always use functional update form: set((state) => ({ ... }))
// Never capture state from outer scope inside set() callbacks.
appendStreamingContent: (delta) =>
  set((state) => ({ streamingContent: state.streamingContent + delta, isStreaming: true })),
```

### Rust Command #[tauri::command] Pattern
**Source:** `tauri-app/src-tauri/src/commands.rs` lines 8-9, 16-18
**Apply to:** Extended `spawn_agent` in commands.rs
```rust
#[tauri::command]
#[specta::specta]
pub fn spawn_agent(
    supervisor: tauri::State<'_, Arc<AgentSupervisor>>,
    app_handle: AppHandle,
    // params...
) -> Result<String, String> {
    // ... map_err(|e| e.to_string())
}
```

### AgentHandle lock → clone → drop → await (no lock across .await)
**Source:** `rust/crates/runtime/src/supervisor/supervisor.rs` lines 136-144
**Apply to:** `supervisor.rs` when extending `spawn_agent_with_config`
```rust
let handle = {
    let registry = self.registry.lock().unwrap();
    registry.get(agent_id).cloned().ok_or_else(|| ...)?
}; // lock released before any .await
handle.stop().await;
```

---

## No Analog Found

All files have close matches in the codebase. No files require falling back to RESEARCH.md-only patterns.

| File | Note |
|------|------|
| `tauri-app/src/components/agent/SpawnAgentDialog.tsx` | No existing Dialog component in the codebase to read from directly, but shadcn `dialog` is already installed. Use RESEARCH.md Pattern 5 for Dialog shell; Button/Badge patterns come from PermissionCard.tsx. |

---

## Metadata

**Analog search scope:** `tauri-app/src/`, `tauri-app/src-tauri/src/`, `rust/crates/runtime/src/supervisor/`, `rust/crates/runtime/src/`
**Files scanned:** 14 source files read
**Pattern extraction date:** 2026-05-10
