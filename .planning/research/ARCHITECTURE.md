# Architecture Patterns: Multi-Agent Tauri Desktop App

**Domain:** Tauri desktop app orchestrating multiple AI coding agents on parallel git worktrees
**Researched:** 2026-05-07
**Confidence:** HIGH (grounded in actual codebase; Tauri 2/tokio/actor patterns are well-established)

---

## Recommended Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         React Frontend (Tauri WebView)                        │
│                                                                                │
│  ChatPanel  │  AgentRoster  │  WorktreeMap  │  PermissionPrompt  │  CostMeter │
│             │               │               │                     │            │
│       ◄── tauri Channel per agent ── one Channel<AgentEvent> per agent_id ──► │
└──────────────────────────────────────────────────────────────────────────────┘
          ▲                       ▲                        ▲
          │ tauri::command         │ tauri::command          │ tauri::command
          │ (user actions)        │ (control)               │ (permission)
          ▼                       ▼                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Tauri Command Layer  (src-tauri/src/)                 │
│                                                                                │
│  agent_commands.rs       worktree_commands.rs        permission_commands.rs   │
│  spawn_agent()           create_worktree()           approve_tool()           │
│  kill_agent()            list_worktrees()            deny_tool()              │
│  send_message()          delete_worktree()           set_policy()             │
│  get_agent_list()                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
          │ Arc<AgentSupervisor> (Tauri managed state)
          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         AgentSupervisor  (new crate: orchestrator/)           │
│                                                                                │
│  AgentSupervisor                                                               │
│  ├── agents: HashMap<AgentId, AgentHandle>                                    │
│  ├── team_config: TeamConfig (roles, routing rules, cost budgets)             │
│  ├── context_store: Arc<SharedContextStore>                                   │
│  └── worktree_manager: WorktreeManager                                        │
│                                                                                │
│  AgentHandle                                                                   │
│  ├── state: Arc<RwLock<AgentState>>   (Idle/Running/Waiting/Done/Failed)     │
│  ├── inbox: mpsc::Sender<OrchestratorMsg>                                     │
│  ├── event_tx: tauri::Channel<AgentEvent>  (forwarded to UI)                 │
│  └── process: Option<Arc<Mutex<Child>>>   (for child-process agents)         │
└──────────────────────────────────────────────────────────────────────────────┘
          │
          │  OrchestratorMsg  (per-agent tokio task)
          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Agent Runtime  (tokio::task per agent)                │
│                                                                                │
│  For in-process agents (orchestrator, lightweight roles):                     │
│    tokio::spawn → ConversationRuntime<C,T> runs on tokio thread pool         │
│    async wrapper over the existing sync ApiClient::stream()                   │
│    Permission requests → mpsc back to AgentSupervisor → UI channel           │
│                                                                                │
│  For isolated agents (coder, tester — full tool access):                     │
│    Child process via SubAgentSpawner (existing)                               │
│    stdout/stderr streamed line-by-line → parsed → forwarded as AgentEvents   │
│    WorktreeManager ensures each child process has CWD = its worktree path    │
└──────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                    External (unchanged from current codebase)                  │
│  AnthropicClient · OpenAiClient · BedrockClient · MCP stdio servers          │
│  Filesystem · Git worktrees · Shell                                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Boundaries

| Component | Responsibility | Boundary | Communicates With |
|-----------|---------------|----------|-------------------|
| React Frontend | Display, user input, permission prompts | WebView JS sandbox | Tauri command layer via `invoke()`, receives `AgentEvent` via `Channel` |
| Tauri Command Layer | Translate frontend actions to Rust calls, forward events to frontend | `#[tauri::command]` fn signatures | AgentSupervisor (via `State<Arc<AgentSupervisor>>`), Tauri app handle |
| AgentSupervisor | Spawn/kill agents, route messages, maintain agent list, hold shared context | `Arc<AgentSupervisor>` in Tauri managed state | Tauri commands, Agent tokio tasks, WorktreeManager, SharedContextStore |
| AgentHandle | Per-agent control channel + state + UI event pipe | Internal struct, not exported | AgentSupervisor owns it; agent task sends events through it |
| Agent tokio task | Drives one ConversationRuntime turn loop, sends events, listens for messages | `tokio::spawn` | ConversationRuntime, AgentHandle.event_tx, SharedContextStore |
| SharedContextStore | Snapshot store for context sharing between agents | `Arc<RwLock<HashMap<String, ContextSnapshot>>>` | Written by agents (via orchestrator gates), read by any agent at turn start |
| WorktreeManager | Create/list/delete/switch git worktrees; map agent_id → worktree path | Wraps `git2` or `std::process::Command git worktree` | AgentSupervisor (create at spawn), Agent tasks (CWD injection) |
| SubAgentSpawner (existing) | Child-process agent execution with retry | Already in `runtime/src/subagent/spawner.rs` | Extended: add `--worktree-path` arg, stream stdout events |
| TaskRegistry (existing) | Track task status | Already in `runtime/src/subagent/registry.rs` | AgentSupervisor replaces this as the primary registry; TaskRegistry retained for child-process bookkeeping |

---

## Data Flow

### 1. User Spawns an Agent

```
User clicks "New Agent" in AgentRoster
  → invoke("spawn_agent", { role: "coder", model: "haiku", task: "...", worktree: "feat/x" })
  → Tauri command: agent_commands::spawn_agent()
  → AgentSupervisor::spawn(SpawnRequest)
      → WorktreeManager::create_or_get("feat/x") → git worktree add
      → AgentHandle created: state=Idle, inbox=mpsc, event_tx=Channel
      → tokio::spawn(agent_loop(handle, config, context_store))
  → Returns AgentId to frontend
  → Frontend subscribes to channel for that AgentId
```

### 2. Agent Produces a Token (streaming)

```
agent_loop:
  ConversationRuntime::run_turn()
    → ApiClient::stream() → SSE bytes
    → AssistantEvent::TextDelta(s)
    → event_tx.send(AgentEvent::Token { agent_id, text: s })
  → Tauri Channel forwards to frontend WebView
  → React: appends to message buffer for that agent_id
```

### 3. Agent Needs Tool Permission

```
agent_loop:
  PermissionPrompter::prompt(tool_name, input) called
  → sends OrchestratorMsg::PermissionRequest { tool_name, input, reply_tx } to supervisor inbox
  → event_tx.send(AgentEvent::PermissionRequired { agent_id, tool_name, input_preview })
  → Frontend shows inline permission card in AgentRoster
  → User clicks Allow/Deny → invoke("approve_tool", { agent_id, decision })
  → AgentSupervisor routes decision → reply_tx.send(PermissionOutcome::Allow)
  → agent_loop unblocks, tool dispatches
```

**Key:** The agent's tokio task blocks on a oneshot channel waiting for the permission reply. The UI event loop is unblocked because this is async. No polling.

### 4. Context Sharing Between Agents

```
Orchestrator agent finishes analysis turn:
  → calls SharedContextStore::publish(ContextSnapshot { agent_id, role, content, timestamp })
  → write lock held < 1ms (snapshot is pre-serialized string, not live session)
  
Worker agent starts new turn:
  → calls SharedContextStore::read_relevant(role_filter) at turn start
  → injects snapshot summaries into system prompt (same way CLAUDE.md is injected)
  → read lock released immediately
  
Race condition prevention:
  → No agent writes to another agent's worktree files directly
  → Context sharing is snapshot-only (pull model, not push)
  → Orchestrator controls when snapshots are published via tool: publish_context
```

### 5. Git Worktree Management

```
WorktreeManager::create(branch_name, base_branch):
  → runs: git worktree add .worktrees/{branch_name} -b {branch_name} {base_branch}
  → records worktree_path in HashMap<AgentId, PathBuf>
  → agent child processes get --working-dir flag set to worktree_path

WorktreeManager::list():
  → runs: git worktree list --porcelain
  → parses output → returns Vec<WorktreeInfo { path, branch, head_sha, is_bare }>

WorktreeManager::delete(agent_id):
  → waits for agent to reach Done/Failed state first
  → runs: git worktree remove {path} --force
  → removes from HashMap
```

**Recommendation:** Use `std::process::Command` for git worktree operations, not `git2`. The `git2` crate's worktree API (via `libgit2`) has historically lagged git's CLI worktree support. The CLI approach is two lines of code and always current.

---

## Multi-Agent Coordination Pattern: Modified Actor Model

**Recommendation: Modified Actor Model over message bus or shared state.**

Rationale for this project specifically:

- **Message bus (pub/sub):** Adds a broker dependency (NATS, Redis, or custom). Overkill for a single desktop process. Race conditions still exist if agents subscribe to the same topic.
- **Shared mutable state:** `Arc<Mutex<SharedSession>>` across agents causes lock contention and makes turn ordering undefined. The existing `ConversationRuntime` is not designed for concurrent mutation.
- **Actor model (winner):** Each agent is an isolated tokio task with its own `ConversationRuntime` instance. Communication is via typed channels (`mpsc`, `oneshot`). This maps directly to what `SubAgentSpawner` already does, but promoted to in-process tasks for the orchestrator role.

The actor model also means the existing `ConversationRuntime<C,T>` requires zero changes — each actor gets its own instance.

**Hybrid process model:**

```
Orchestrator agent  →  in-process tokio task
  (uses smart model: Sonnet/Opus, needs fast context sharing)

Worker agents (Coder, Tester)  →  child processes (keep existing SubAgentSpawner)
  (full tool access, OS-level isolation, separate CWD, crash-safe)

Reviewer agent  →  in-process tokio task
  (read-only tools, lightweight, needs access to worktree diff)
```

This is not an either/or — it's a tiered model. The orchestrator needs low-latency context access (in-process). Workers need crash isolation (child process). The UI needs a unified view of both (AgentSupervisor abstracts this).

---

## Agent State Machine

```
                 spawn()
                    │
                    ▼
              ┌──────────┐
              │  Idle    │ ◄─────────────────────────────┐
              └──────────┘                               │
                    │ run_turn() called                   │ user sends msg
                    ▼                                    │ (background agent)
              ┌──────────┐
              │ Planning │  (model produces first response, no tools yet)
              └──────────┘
                    │ tool_use in response
                    ▼
              ┌──────────┐
              │Executing │  (ToolExecutor::execute() running, parallel up to 5)
              └──────────┘
                    │ permission needed
                    ▼
              ┌──────────┐
              │ Waiting  │  (blocked on oneshot permission reply from UI)
              └──────────┘
                    │ permission granted
                    ▼ (back to Executing or Planning)

         max_iterations or no tools │ agent decides done
                                    ▼
              ┌──────────┐
              │   Done   │  (final output emitted, cost accounted)
              └──────────┘

         runtime error / budget exceeded │ kill signal
                                         ▼
              ┌──────────┐
              │  Failed  │  (error stored, retry logic consulted)
              └──────────┘
```

**State representation:**
```rust
pub enum AgentState {
    Idle,
    Planning { turn: u32 },
    Executing { turn: u32, active_tools: Vec<String> },
    Waiting { for_permission: String },  // tool name
    Done { output_preview: String },
    Failed { error: String, retryable: bool },
}
```

---

## Tauri IPC for Multiple Concurrent Agent Streams

**Use one `Channel<AgentEvent>` per agent, not a single multiplexed channel.**

Rationale:
- Tauri 2 `Channel` is a typed, zero-copy pipe from Rust to the WebView. Creating N of them is cheap.
- A single multiplexed channel requires the frontend to demultiplex by `agent_id` on every event — correct, but creates a single sequential buffer that can back up if one agent produces fast output.
- Per-agent channels let the frontend independently buffer/throttle/pause individual agent streams.
- React can key channels to a `useAgentStream(agentId)` hook — clean component model.

**AgentEvent enum:**

```rust
#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    Token { text: String },
    Thinking { text: String },
    ToolStart { tool_name: String, input_preview: String },
    ToolResult { tool_name: String, result_preview: String, success: bool },
    PermissionRequired { tool_name: String, input_preview: String },
    TurnComplete { usage: TokenUsageSummary, cost_usd: f64 },
    StateChanged { state: AgentStateSummary },
    Error { message: String, retryable: bool },
    Done { final_output: String },
}
```

**Channel lifecycle:**
- Channel created in `spawn_agent` command, stored in `AgentHandle.event_tx`
- Channel handle (the JS-side callback) passed in from frontend at spawn time
- On `kill_agent`: channel dropped → frontend's `onmessage` receives `null` / close signal

**Commands:**

```rust
// Spawn agent, returns agent_id + binds the channel
#[tauri::command]
async fn spawn_agent(
    supervisor: State<'_, Arc<AgentSupervisor>>,
    request: SpawnRequest,
    channel: Channel<AgentEvent>,
) -> Result<AgentId, String>

// Send a message to a running agent (continues conversation)
#[tauri::command]
async fn send_message(
    supervisor: State<'_, Arc<AgentSupervisor>>,
    agent_id: AgentId,
    text: String,
) -> Result<(), String>

// Approve or deny a pending permission
#[tauri::command]
async fn respond_to_permission(
    supervisor: State<'_, Arc<AgentSupervisor>>,
    agent_id: AgentId,
    decision: PermissionDecision,
) -> Result<(), String>
```

---

## Patterns to Follow

### Pattern 1: AgentSupervisor as Tauri Managed State

```rust
// src-tauri/src/main.rs
fn main() {
    let supervisor = Arc::new(AgentSupervisor::new());
    tauri::Builder::default()
        .manage(supervisor)
        .invoke_handler(tauri::generate_handler![
            spawn_agent, kill_agent, send_message,
            respond_to_permission, list_worktrees, ...
        ])
        .run(tauri::generate_context!())
        .expect("tauri app failed");
}
```

The supervisor is the single source of truth for all agent state. Commands take it via `State<'_, Arc<AgentSupervisor>>`. No global statics beyond the existing `SUBAGENT_COUNTER`.

### Pattern 2: Async Wrapper for Sync ConversationRuntime

The existing `ConversationRuntime::run_turn()` is synchronous (blocking threads). In the Tauri context it must not block the tokio runtime:

```rust
async fn agent_loop(handle: AgentHandle, mut runtime: ConversationRuntime<impl ApiClient, impl ToolExecutor>) {
    loop {
        let msg = handle.inbox.recv().await;
        match msg {
            OrchestratorMsg::RunTurn(text) => {
                // Run blocking code on a blocking thread pool, not tokio worker
                let result = tokio::task::spawn_blocking(move || {
                    runtime.run_turn(&text)
                }).await;
                // ... handle result, emit events
            }
            OrchestratorMsg::Kill => break,
        }
    }
}
```

`spawn_blocking` is the correct primitive here. The existing `ConversationRuntime` stays synchronous — no async rewrite needed.

### Pattern 3: Permission Prompting via Oneshot Channel

The `PermissionPrompter` trait already exists in `permissions.rs`. Implement a `TauriPermissionPrompter`:

```rust
pub struct TauriPermissionPrompter {
    agent_id: AgentId,
    event_tx: Channel<AgentEvent>,
    request_tx: mpsc::Sender<OrchestratorMsg>,
}

impl PermissionPrompter for TauriPermissionPrompter {
    fn prompt(&mut self, tool: &str, input: &str) -> PermissionOutcome {
        let (reply_tx, reply_rx) = std::sync::mpsc::channel();
        // Send request to supervisor (non-async, we're in spawn_blocking)
        self.request_tx.blocking_send(OrchestratorMsg::PermissionRequest {
            tool_name: tool.to_string(),
            input_preview: input.chars().take(200).collect(),
            reply_tx,
        }).unwrap();
        reply_rx.recv().unwrap_or(PermissionOutcome::Deny)
    }
}
```

This requires no change to `PermissionPrompter` trait — it's already trait-abstract.

### Pattern 4: Context Snapshot (pull model, not push)

```rust
pub struct ContextSnapshot {
    pub agent_id: AgentId,
    pub role: AgentRole,
    pub timestamp: DateTime<Utc>,
    pub summary: String,          // compact text, not full session
    pub relevant_files: Vec<PathBuf>,
}

pub struct SharedContextStore {
    snapshots: RwLock<HashMap<AgentId, ContextSnapshot>>,
}

impl SharedContextStore {
    /// Agent calls this to publish its current understanding
    pub fn publish(&self, snapshot: ContextSnapshot) {
        self.snapshots.write().unwrap().insert(snapshot.agent_id.clone(), snapshot);
    }

    /// Agent calls this at turn start to build its context injection
    pub fn read_for_role(&self, requesting_role: AgentRole) -> Vec<&ContextSnapshot> {
        // return snapshots from roles this agent cares about
        // e.g., Coder reads Planner snapshots; Reviewer reads Coder snapshots
    }
}
```

Snapshots are text strings, not live `ConversationRuntime` references. No shared mutable session state across agents.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Shared ConversationRuntime Across Agents

**What goes wrong:** Wrapping a single `ConversationRuntime` in `Arc<Mutex<...>>` and having multiple agents call `run_turn()` concurrently.

**Why bad:** `run_turn()` builds and mutates the session message list during each turn. Concurrent access would interleave messages from different agents into the same session, producing nonsense context for the model. The session is designed for one conversation thread.

**Instead:** Each agent gets its own `ConversationRuntime` instance. Shared context is via `SharedContextStore` snapshots, not shared session objects.

### Anti-Pattern 2: Blocking tokio Thread with ApiClient::stream()

**What goes wrong:** Calling `ApiClient::stream()` (which blocks waiting for HTTP SSE) directly in an `async fn` spawned with `tokio::spawn`.

**Why bad:** Blocks a tokio worker thread during the entire API call. With 5 concurrent agents each doing 30-second API calls, this saturates tokio's default 4-8 worker threads, causing the Tauri UI to become unresponsive.

**Instead:** Always use `tokio::task::spawn_blocking` for `ConversationRuntime::run_turn()` calls. The existing sync model is fine — just don't put it on a tokio worker.

### Anti-Pattern 3: One Channel for All Agents

**What goes wrong:** Routing all agent events through a single `Channel<AgentEventWithId>` and demultiplexing in JS.

**Why bad:** A slow frontend consumer (e.g., React re-rendering with a large message list) creates backpressure on the entire channel. One fast agent can starve other agents' UI updates. Error handling and cleanup is tied to one channel lifecycle.

**Instead:** One `Channel<AgentEvent>` per agent. Per-agent lifecycle, per-agent backpressure.

### Anti-Pattern 4: Worktree Path Hardcoded in Agent

**What goes wrong:** Agent task hardcodes or assumes its working directory from `std::env::current_dir()`.

**Why bad:** Child-process agents inherit the parent's CWD. If the parent process CWD is the repo root, all agents write to the same worktree and conflict.

**Instead:** `WorktreeManager` provides the worktree path; it is passed explicitly to child processes via a `--working-dir` flag and to in-process agents via a `working_dir: PathBuf` field in `AgentHandle`. The agent sets its tool execution context from this field, not from the process CWD.

### Anti-Pattern 5: Using git2 for Worktree Management

**What goes wrong:** Using the `git2` crate's worktree API.

**Why bad:** `libgit2`'s worktree support has historically been incomplete. Specifically: worktree locking, pruning, and move operations have had bugs in `git2-rs`. The CLI git tool always works correctly and is on the PATH.

**Instead:** `std::process::Command::new("git").args(["worktree", "add", ...])`. Parse `git worktree list --porcelain` for listing. Simpler, always correct.

---

## Scalability Considerations

| Concern | At 3 agents (initial target) | At 10 agents | At 50 agents |
|---------|------------------------------|--------------|--------------|
| tokio threads | 3 `spawn_blocking` threads fine | 10 threads fine (tokio blocking pool auto-scales) | May need explicit blocking thread limit |
| Tauri Channels | 3 channels, trivial | 10 channels, fine | 50 channels: frontend rendering becomes the bottleneck, not the channel |
| SharedContextStore | RwLock uncontended | Occasional contention at turn starts | Consider partitioned stores or versioning |
| Worktrees | 3 worktrees, fast git ops | 10 worktrees, disk I/O matters | 50 worktrees: disk space and branch management overhead |
| Permission prompts | Easy to track | Need queuing UI | Need priority/batching UI |
| Cost | Easy to display | Aggregate dashboard needed | Cost budgets per team needed |

Initial target of 3-5 simultaneous agents is comfortably within all limits with no special work.

---

## Build Order (Component Dependencies)

Dependencies flow top-to-bottom. Build in this order:

```
Phase A: Foundation (no new Tauri yet)
  1. AgentState enum + AgentEvent enum  (new types, no deps)
  2. WorktreeManager  (deps: std::process::Command, no crate deps)
  3. SharedContextStore  (deps: tokio RwLock, AgentState)
  4. OrchestratorMsg + AgentHandle  (deps: above types + tauri::Channel stub)
  5. AgentSupervisor skeleton  (deps: all above)

Phase B: Tauri Shell
  6. src-tauri crate (Tauri project scaffold)
  7. Tauri managed state wiring (AgentSupervisor into app state)
  8. Tauri commands (agent_commands.rs, worktree_commands.rs)
  9. TauriPermissionPrompter  (deps: existing PermissionPrompter trait + Channel)

Phase C: Agent Loop Integration
  10. async agent_loop  (deps: spawn_blocking + ConversationRuntime + AgentHandle)
  11. In-process orchestrator agent  (deps: agent_loop + SharedContextStore)
  12. Child-process worker agents with worktree path injection  (deps: SubAgentSpawner extension)

Phase D: Frontend
  13. Channel subscription hooks (useAgentStream)
  14. AgentRoster component (reads AgentHandle state)
  15. PermissionPrompt component (inline in AgentRoster)
  16. WorktreeMap component (uses list_worktrees command)
```

**Critical path:** Steps 1-5 can be built and unit-tested entirely in Rust before writing any Tauri or frontend code. This is the recommended approach — validate the orchestrator logic headlessly first.

---

## How subagent/spawner.rs Should Evolve

The existing `SubAgentSpawner` is a good foundation. Three targeted changes needed:

**Change 1: Add `--working-dir` flag support.**
Child agents need to run in a specific worktree path. Add `working_dir: Option<PathBuf>` to `SubAgentConfig`. In `spawn_once()`, add:
```rust
if let Some(dir) = &config.working_dir {
    cmd.current_dir(dir);
}
```

**Change 2: Stream stdout events instead of polling temp file.**
Currently: child writes JSON to temp file, parent polls every 50ms.
For the UI, we need incremental token events, not just final output.
Add `progress_tx: Option<tokio::sync::mpsc::Sender<AgentEvent>>` to config.
Child process writes NDJSON lines to stdout; parent reads stdout line-by-line via `BufReader` and parses them as `AgentEvent` structs to forward to the UI channel.

This is a medium-complexity change. The child binary needs a `--stream-events` flag that changes its output format from "write final JSON to file" to "write NDJSON events to stdout." The child already has all the hook machinery (`PostTurn`, `ToolUse`) to produce these events.

**Change 3: Register handles in AgentSupervisor, not just TaskRegistry.**
`GLOBAL_REGISTRY` static is fine for pure CLI use. For Tauri, `AgentSupervisor` becomes the authoritative registry. `TaskRegistry` is kept but scoped to child-process bookkeeping only. The supervisor's `HashMap<AgentId, AgentHandle>` is the source of truth for the UI.

These three changes are additive — they do not break existing CLI behavior.

---

## Sources

- Codebase analysis: `rust/crates/runtime/src/subagent/spawner.rs`, `registry.rs`, `result.rs`, `mod.rs`
- Codebase analysis: `rust/crates/runtime/src/conversation.rs` (sync ApiClient::stream pattern)
- Project context: `.planning/PROJECT.md`, `.planning/codebase/ARCHITECTURE.md`
- Tauri 2 Channel API: HIGH confidence — Channel is the primary Tauri 2 pattern for streaming from Rust to frontend, introduced in Tauri 2.0 specifically to replace the old event system for high-frequency streaming
- tokio `spawn_blocking`: HIGH confidence — standard pattern for running blocking Rust code from async context, documented in tokio 1.x
- Actor model for multi-agent Rust: HIGH confidence — well-established pattern; each actor = tokio::task + mpsc inbox
- git worktree CLI vs git2: MEDIUM confidence — based on known historical gaps in libgit2 worktree support; verify against current git2-rs changelog before choosing
