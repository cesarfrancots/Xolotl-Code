# Phase 2: Orchestration Layer - Research

**Researched:** 2026-05-08
**Domain:** Rust async orchestration — tokio channels, git worktrees, actor model, MockRuntime testing
**Confidence:** HIGH

## Summary

Phase 2 builds the actor-model supervision layer that lets multiple `ConversationRuntime` instances run concurrently on isolated git worktrees. All 11 implementation decisions (D-01 through D-11) are already locked from the CONTEXT.md discussion phase, so this research focuses on verifying the correct Rust/tokio idioms for those decisions rather than exploring alternatives.

The core insight from code inspection: `ConversationRuntime::run_turn()` is fully synchronous — it uses `std::thread::spawn` internally for parallel tool execution. This means the D-10 invariant (run inside `tokio::task::spawn_blocking`) is what bridges the existing sync runtime into the async tokio world. The supervisor's job is to manage that boundary cleanly.

The existing `TaskRegistry` (Arc<Mutex<HashMap>>) and `SubAgentSpawner` (std::process::Command) are the correct starting points. The new `AgentSupervisor` extends the registry pattern with broadcast channels for fan-out and a worktree assignment layer.

**Primary recommendation:** New code goes in `runtime/src/supervisor/` as a new module, extending (not replacing) the subagent infrastructure. Use `tokio::sync::broadcast` for the `AgentHandle::subscribe()` fan-out path and `tokio::sync::mpsc` for the worker-to-supervisor event reporting path.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Workers stream events to `AgentSupervisor` via tokio broadcast/mpsc channel — supervisor owns the Sender side, workers hold Sender clones. No NDJSON parsing in-process; channels are the in-process event bus.
- **D-02:** `AgentEvent` enum variants: `StateChanged(AgentState)`, `ToolCallStarted { tool: String, input: String }`, `ToolCallCompleted { tool: String, output: String }`, `TurnCompleted { usage: TokenUsage }`, `Error { message: String }`. This set is the contract Phase 3 (Tauri) subscribes to.
- **D-03:** `AgentHandle` exposes **both**: `subscribe() -> broadcast::Receiver<AgentEvent>` for consumers (Phase 3 Tauri layer will use this), plus `stop()` / `pause()` control methods. Supervisor holds the corresponding Sender.
- **D-04:** NDJSON lines emitted by child-process workers are **serde-serialized `AgentEvent` JSON** — same enum as in-process events. Supervisor deserializes directly into `AgentEvent` variants. One schema for both transports.
- **D-05:** **Extend the existing `SubAgentSpawner` struct** (do not wrap it). Add `--working-dir` flag and NDJSON stdout streaming to `SubAgentSpawner`. Existing CLI behavior preserved via the same struct; new fields are opt-in.
- **D-06:** **Keyed pull-on-demand** — agents call `publish(key: &str, snapshot: &str)` to write named snapshots. Any agent calls `pull(key: &str) -> Option<String>` to read. Internally a `HashMap<String, String>` behind an `Arc<RwLock<...>>`.
- **D-07:** `publish()` **returns `Err(TooLarge)`** if the snapshot exceeds 1000 tokens. Token counting uses a simple whitespace tokenizer (no tiktoken dependency). Callers must trim before publishing — no silent truncation.
- **D-08:** `WorktreeManager` is **owned by `AgentSupervisor`**. Supervisor assigns a worktree at agent spawn time and releases it when the agent stops.
- **D-09:** Phase 2 headless verification uses **`cargo test` with a stub/mock runtime** — `MockRuntime` returns instant canned responses, no real API calls. Load test spawns N concurrent agents and asserts tokio thread pool stays bounded (no starvation). Fast, deterministic, no API key dependency.
- **D-10:** `ConversationRuntime::run_turn()` MUST always execute inside `tokio::task::spawn_blocking`. This is a day-one invariant — the ORC-03 load test validates it is not violated.
- **D-11:** Orchestrator runs in-process. Worker sub-agents continue to use child-process `SubAgentSpawner` (D-05 extends it, does not replace it).

### Claude's Discretion
None declared.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ORC-01 | Agent state machine with typed states (Idle, Planning, Executing, Waiting, Done, Failed) and `AgentEvent` enum | Rust enum state machine pattern; `SubAgentStatus` extends to `AgentState` |
| ORC-02 | `AgentSupervisor` registry holds all running agents; `AgentHandle` provides typed control per agent | `TaskRegistry` (Arc<Mutex<HashMap>>) is the starting model; extend with broadcast Sender |
| ORC-03 | Each agent's conversation loop runs inside `tokio::task::spawn_blocking` — synchronous `run_turn()` never touches the tokio thread pool directly | `run_turn()` is fully synchronous (verified in source); spawn_blocking wraps it |
| ORC-04 | `SharedContextStore` allows agents to publish and pull text snapshots (500–1000 tokens max) without sharing mutable session objects | Arc<RwLock<HashMap<String,String>>>; whitespace tokenizer for D-07 |
| ORC-05 | `WorktreeManager` can create, list, and delete git worktrees via shell commands; each agent is assigned exactly one worktree | `git worktree add/list/remove/prune`; verified git 2.53.0 is installed |
| ORC-06 | `SubAgentSpawner` extended with `--working-dir` flag, NDJSON event streaming via stdout, and `AgentSupervisor` registration | Extend existing `SubAgentConfig` + `SubAgentSpawner`; stdout currently suppressed (Stdio::null) |
| ORC-07 | Git operation queue serializes git writes per-repo to prevent `index.lock` conflicts between parallel agents | Channel-based queue per repo root; tokio::sync::Mutex or mpsc oneshot pattern |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Agent lifecycle (spawn/stop/pause) | Rust runtime | — | In-process supervisor owns agent handles |
| Event fan-out to observers | Rust runtime | Tauri layer (Phase 3) | broadcast::Sender in supervisor; Phase 3 subscribes |
| Worktree isolation | Rust runtime | OS/git | WorktreeManager shells out to git |
| Shared context (cross-agent data) | Rust runtime | — | Arc<RwLock<HashMap>> is in-process only |
| Git write serialization | Rust runtime | OS/git | Queue per repo root prevents index.lock |
| NDJSON event streaming | Child process stdout | Rust runtime parser | Child writes; supervisor reads line-by-line |
| State persistence | Rust runtime | — | In-memory only for Phase 2; Phase 3 adds Tauri state |

---

## Standard Stack

### Core (all already in Cargo.toml)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tokio | 1.x (workspace) | Async runtime, broadcast, mpsc, spawn_blocking | Already in workspace; all features enabled |
| serde + serde_json | 1.x (workspace) | AgentEvent serialization to NDJSON | Already used for SubAgentResult |
| std::process::Command | stdlib | git worktree shell-outs, child process spawning | Already used in SubAgentSpawner |
| Arc<RwLock> / Arc<Mutex> | stdlib | SharedContextStore, git queue | Pattern already established in registry.rs |

### New Dependencies Required
None — all primitives needed are either in tokio (already in workspace with "full" features) or in std.

**Verified:** `tokio = { version = "1", features = ["full"] }` is in workspace Cargo.toml. `tokio::sync::broadcast` and `tokio::sync::mpsc` are included in the "full" feature set. [VERIFIED: claw-code/rust/Cargo.toml]

### No New Dependencies Needed
The decision to use a whitespace tokenizer (D-07) instead of tiktoken for `SharedContextStore` is correct — tiktoken already exists in the crate for `estimate_tokens()` but D-07 explicitly specifies whitespace counting, which needs zero new dependencies.

---

## Architecture Patterns

### System Architecture Diagram

```
                        ┌─────────────────────────────────┐
                        │         AgentSupervisor          │
                        │  ┌──────────────────────────┐   │
     spawn_agent()  ──► │  │  HashMap<AgentId,         │   │
                        │  │    AgentHandle>           │   │
                        │  └──────────────────────────┘   │
                        │  ┌──────────────┐ ┌──────────┐  │
                        │  │WorktreeManager│ │SharedCtx │  │
                        │  └──────────────┘ │  Store   │  │
                        │  ┌──────────────┐ └──────────┘  │
                        │  │ GitOpQueue   │               │
                        │  │ per-repo     │               │
                        └──┴──────────────┴───────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
    ┌─────▼──────┐         ┌──────▼─────┐         ┌──────▼─────┐
    │AgentHandle │         │AgentHandle │         │AgentHandle │
    │  agent-1   │         │  agent-2   │         │  agent-N   │
    │            │         │            │         │            │
    │event_tx    │         │event_tx    │         │event_tx    │
    │(mpsc::Sndr)│         │(mpsc::Sndr)│         │(mpsc::Sndr)│
    │broadcast   │         │broadcast   │         │broadcast   │
    │::Sender    │         │::Sender    │         │::Sender    │
    └──────┬─────┘         └──────┬─────┘         └──────┬─────┘
           │ event_tx clone        │                      │
           │ (events up)           │                      │
    ┌──────▼─────┐                 │                      │
    │spawn_block │                 │                      │
    │ing task    │                 │                      │
    │            │                 │                      │
    │ConvRuntime │                 │                      │
    │::run_turn()│                 │                      │
    └────────────┘                 │                      │
                                   │                      │
                     [Phase 3: Tauri event bridge]        │
                     subscribe() → broadcast::Receiver ◄──┘
```

**Data flow for in-process agent:**
1. Supervisor calls `spawn_blocking(|| runtime.run_turn(...))` in a tokio task
2. Worker task sends `AgentEvent` via `handle.event_tx.clone()` to supervisor's re-broadcast loop
3. Re-broadcast loop forwards via `broadcast::Sender` on the `AgentHandle`
4. Phase 3 Tauri layer calls `handle.subscribe()` to get a `broadcast::Receiver`

**Data flow for child-process agent (D-05/D-11):**
1. `SubAgentSpawner` starts child process with `Stdio::piped()` stdout
2. Supervisor reads stdout line-by-line with `BufReader` + async `lines()`
3. Each line is `serde_json::from_str::<AgentEvent>()` — same schema
4. Deserialized event is re-broadcast via the handle's `broadcast::Sender`

### Recommended Project Structure

```
runtime/src/
├── subagent/           # existing — SubAgentSpawner extended here (D-05)
│   ├── mod.rs
│   ├── spawner.rs      # add working_dir: Option<PathBuf>, ndjson_stdout: bool
│   ├── registry.rs
│   └── result.rs
└── supervisor/         # new module — all Phase 2 types live here
    ├── mod.rs          # pub use re-exports
    ├── agent_state.rs  # AgentState enum + AgentEvent enum (ORC-01)
    ├── handle.rs       # AgentHandle: subscribe(), stop(), pause() (ORC-02, D-03)
    ├── supervisor.rs   # AgentSupervisor: spawn_agent(), list(), stop_all() (ORC-02)
    ├── context_store.rs # SharedContextStore: publish(), pull() (ORC-04, D-06, D-07)
    ├── worktree.rs     # WorktreeManager: add/list/remove via Command (ORC-05, D-08)
    └── git_queue.rs    # GitOpQueue: serialized writes per repo root (ORC-07)
```

**Visibility decisions:**
- `supervisor/` is a new `mod supervisor` in `runtime/src/lib.rs`
- All public types re-exported from `runtime::supervisor::*`
- `AgentEvent` and `AgentState` must be `pub` because Phase 3 Tauri layer imports them
- All supervisor types must be `Send + Sync` (required for Tauri managed state in Phase 3)

### Pattern 1: Dual-Channel Event Architecture (D-01, D-03)

**What:** Workers send events up to supervisor via `mpsc`; supervisor fans out to subscribers via `broadcast`.

**Why two channels:** `mpsc` with backpressure is correct for worker→supervisor (ensures supervisor keeps up). `broadcast` is correct for supervisor→UI subscribers (non-blocking fan-out; UI lag does not block worker).

**Implementation:**

```rust
// Source: tokio docs — https://docs.rs/tokio/latest/tokio/sync/broadcast/index.html
// Source: tokio docs — https://docs.rs/tokio/latest/tokio/sync/mpsc/index.html

pub struct AgentHandle {
    /// Workers send AgentEvent into this; supervisor reads it.
    /// MUST be stored as a field — dropping it closes the mpsc channel
    /// and the re-broadcast loop exits immediately (no events flow).
    pub event_tx: mpsc::Sender<AgentEvent>,
    /// Supervisor broadcasts via this; Phase 3 subscribes via receiver.
    broadcast_tx: broadcast::Sender<AgentEvent>,
    /// Cancel token for stop() control.
    cancel_tx: mpsc::Sender<AgentControl>,
    pub agent_id: AgentId,
    pub worktree_path: PathBuf,
}

impl AgentHandle {
    pub fn subscribe(&self) -> broadcast::Receiver<AgentEvent> {
        self.broadcast_tx.subscribe()
    }

    pub async fn stop(&self) {
        let _ = self.cancel_tx.send(AgentControl::Stop).await;
    }

    pub async fn pause(&self) {
        let _ = self.cancel_tx.send(AgentControl::Pause).await;
    }
}
```

**Broadcast capacity:** Use `broadcast::channel(64)`. AgentEvent volume is low (one event per tool call / turn). 64 slots provides ample headroom before `RecvError::Lagged` is possible. [VERIFIED: tokio broadcast docs — lagged receiver gets `RecvError::Lagged`, auto-advances to oldest available message, never blocks sender]

### Pattern 2: AgentState Machine (ORC-01)

**What:** Typed enum preventing invalid transitions at compile time via match exhaustion.

**Key insight:** The existing `SubAgentStatus` enum (Pending/Running/Completed/Failed/Cancelled) covers terminal states but lacks the intermediate planning/executing/waiting states needed for ORC-01. `AgentState` replaces it for the supervisor layer while `SubAgentStatus` remains for the existing registry.

```rust
// Source: [ASSUMED] — standard Rust state machine pattern
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AgentState {
    Idle,
    Planning,
    Executing,
    Waiting,  // blocked on permission / context pull
    Done,
    Failed,
}

impl AgentState {
    /// Returns false for terminal states — prevents re-transition.
    pub fn can_transition_to(&self, next: &AgentState) -> bool {
        match (self, next) {
            (AgentState::Done | AgentState::Failed, _) => false,
            (AgentState::Idle, AgentState::Planning | AgentState::Executing) => true,
            (AgentState::Planning, AgentState::Executing | AgentState::Failed) => true,
            (AgentState::Executing, AgentState::Waiting | AgentState::Done | AgentState::Failed) => true,
            (AgentState::Waiting, AgentState::Executing | AgentState::Failed) => true,
            _ => false,
        }
    }
}
```

**Send+Sync:** All variants are `Copy`-compatible types — `AgentState` derives `Clone` and is `Send + Sync` automatically (no non-Send fields). [VERIFIED: Rust stdlib — enums with only Copy fields are Send+Sync]

### Pattern 3: spawn_blocking Wrapper (ORC-03, D-10)

**What:** The synchronous `run_turn()` runs on tokio's blocking thread pool, not the async scheduler.

**Critical finding from code inspection:** `ConversationRuntime::run_turn()` is 100% synchronous. It calls `std::thread::spawn` internally for parallel tool execution and uses `std::thread::sleep` for backoff. Calling it directly from an async task would block the tokio worker thread. [VERIFIED: runtime/src/conversation.rs lines 356-543]

```rust
// Source: https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html
// [ASSUMED] wrapper pattern — standard Rust idiom
pub async fn run_agent_turn(
    runtime: Arc<Mutex<ConversationRuntime<C, T>>>,
    event_tx: mpsc::Sender<AgentEvent>,
    input: String,
) -> Result<TurnSummary, RuntimeError>
where
    C: ApiClient + Send + 'static,
    T: ToolExecutor + Send + Clone + 'static,
{
    // runtime must be moved into the blocking closure
    let runtime_clone = runtime.clone();
    tokio::task::spawn_blocking(move || {
        let mut rt = runtime_clone.lock().unwrap();
        rt.run_turn(input, None)
    })
    .await
    .map_err(|e| RuntimeError::new(format!("spawn_blocking panicked: {e}")))?
}
```

**Thread pool behavior:** tokio's blocking pool expands dynamically. Default max is 512 threads. For N concurrent agents, each occupying one blocking thread during a turn, this is not a problem at any realistic N. [CITED: https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html]

**ORC-03 test strategy:** The load test uses `tokio::runtime::Builder::new_multi_thread().max_blocking_threads(16)` to bound the blocking pool at a known value and confirm 8 concurrent agents fit without exhaustion. `MockApiClient` returns instantly with canned response (no real API). [ASSUMED — tokio Builder API; test pattern from D-09]

### Pattern 4: SharedContextStore (ORC-04, D-06, D-07)

```rust
// Source: [ASSUMED] — standard Arc<RwLock> pattern; verified pattern in registry.rs
#[derive(Debug, Clone, Default)]
pub struct SharedContextStore {
    inner: Arc<RwLock<HashMap<String, String>>>,
}

#[derive(Debug, thiserror::Error)]
pub enum ContextError {
    #[error("snapshot exceeds 1000-token limit ({0} tokens)")]
    TooLarge(usize),
}

impl SharedContextStore {
    pub fn publish(&self, key: &str, snapshot: &str) -> Result<(), ContextError> {
        let token_count = snapshot.split_whitespace().count();
        if token_count > 1000 {
            return Err(ContextError::TooLarge(token_count));
        }
        let mut map = self.inner.write().unwrap();
        map.insert(key.to_string(), snapshot.to_string());
        Ok(())
    }

    pub fn pull(&self, key: &str) -> Option<String> {
        let map = self.inner.read().unwrap();
        map.get(key).cloned()
    }
}
```

**D-07 tokenizer:** Whitespace split (`.split_whitespace().count()`) is specified. This differs from the existing `estimate_tokens()` in `tokenizer.rs` (which uses tiktoken cl100k_base). The whitespace tokenizer is intentionally simpler — no new dependency, conservative count (whitespace tokens >= actual BPE tokens for most prose). [VERIFIED: runtime/src/tokenizer.rs — tiktoken exists but D-07 explicitly chooses whitespace]

### Pattern 5: WorktreeManager (ORC-05, D-08)

**What:** Shell commands via `std::process::Command` — consistent with existing spawner.rs pattern.

**Key finding:** Each git worktree has its own `HEAD` and `index` file in `$GIT_DIR/worktrees/<id>/`. Worktrees do NOT share index files. The `index.lock` concern addressed by ORC-07 is about git _write_ operations (commit, add, fetch) touching shared refs, not about index files themselves. [VERIFIED: https://git-scm.com/docs/git-worktree]

```rust
// Source: [ASSUMED] — pattern consistent with spawner.rs existing Command usage
pub struct WorktreeManager {
    repo_root: PathBuf,
    worktrees_base: PathBuf,  // e.g., repo_root/.xolotl-worktrees/
    active: Arc<Mutex<HashMap<AgentId, PathBuf>>>,
}

impl WorktreeManager {
    pub fn add(&self, agent_id: &AgentId, branch: &str) -> Result<PathBuf, WorktreeError> {
        let path = self.worktrees_base.join(agent_id.to_string());
        let output = std::process::Command::new("git")
            .args(["worktree", "add", "-b", branch, path.to_str().unwrap()])
            .current_dir(&self.repo_root)
            .output()?;
        if !output.status.success() {
            return Err(WorktreeError::GitFailed(
                String::from_utf8_lossy(&output.stderr).into_owned()
            ));
        }
        let mut active = self.active.lock().unwrap();
        active.insert(agent_id.clone(), path.clone());
        Ok(path)
    }

    pub fn remove(&self, agent_id: &AgentId) -> Result<(), WorktreeError> {
        let path = {
            let mut active = self.active.lock().unwrap();
            active.remove(agent_id)
        };
        if let Some(path) = path {
            std::process::Command::new("git")
                .args(["worktree", "remove", "--force", path.to_str().unwrap()])
                .current_dir(&self.repo_root)
                .output()?;
        }
        Ok(())
    }

    pub fn list(&self) -> Vec<(AgentId, PathBuf)> {
        let active = self.active.lock().unwrap();
        active.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    /// Cleanup on crash: called at supervisor startup to prune stale worktrees.
    pub fn prune(&self) -> Result<(), WorktreeError> {
        std::process::Command::new("git")
            .args(["worktree", "prune"])
            .current_dir(&self.repo_root)
            .output()?;
        Ok(())
    }
}
```

**Crash safety:** If the process panics with a worktree checked out, `git worktree prune` at next startup recovers the git state (removes stale `$GIT_DIR/worktrees/<id>/` directories). The worktree _directories_ may need manual cleanup — log paths on creation so the supervisor can clean up on next start. [VERIFIED: git-scm.com/docs/git-worktree — prune removes stale admin files]

**Windows path consideration:** `git worktree add` on Windows accepts forward-slash and backslash paths. Use `path.to_str()` — Windows git (git 2.53.0 confirmed installed) handles both. [VERIFIED: git --version output = 2.53.0.windows.1]

### Pattern 6: Git Operation Queue (ORC-07)

**What:** Serialize git writes per repo root to prevent concurrent `git commit`/`git add` from creating `index.lock` conflicts.

**Why channel-based over Mutex:** A `tokio::sync::Mutex` per repo would work but requires every git-writing caller to be async. A dedicated queue task is simpler: callers send a oneshot request, the queue task runs git operations sequentially, sends back result. No risk of holding the mutex across an await point.

```rust
// Source: [ASSUMED] — tokio oneshot + mpsc queue pattern
use tokio::sync::{mpsc, oneshot};

pub struct GitOp {
    pub command: Vec<String>,
    pub cwd: PathBuf,
    pub result_tx: oneshot::Sender<Result<std::process::Output, std::io::Error>>,
}

pub struct GitOpQueue {
    sender: mpsc::Sender<GitOp>,
}

impl GitOpQueue {
    pub fn start() -> Self {
        let (tx, mut rx) = mpsc::channel::<GitOp>(32);
        tokio::spawn(async move {
            while let Some(op) = rx.recv().await {
                // Runs sequentially — no concurrent git writes
                let result = tokio::task::spawn_blocking(move || {
                    std::process::Command::new("git")
                        .args(&op.command)
                        .current_dir(&op.cwd)
                        .output()
                })
                .await
                .unwrap_or_else(|e| Err(std::io::Error::other(e)));
                let _ = op.result_tx.send(result);
            }
        });
        Self { sender: tx }
    }

    pub async fn run(&self, command: Vec<String>, cwd: PathBuf)
        -> Result<std::process::Output, std::io::Error>
    {
        let (result_tx, result_rx) = oneshot::channel();
        self.sender.send(GitOp { command, cwd, result_tx }).await
            .map_err(|_| std::io::Error::other("git queue closed"))?;
        result_rx.await
            .map_err(|_| std::io::Error::other("git queue dropped result"))?
    }
}
```

**One queue per repo root:** `AgentSupervisor` holds `HashMap<PathBuf, GitOpQueue>` keyed by canonical repo root. Agents in the same repo share a queue; agents in different repos get separate queues (no unnecessary serialization). [ASSUMED]

### Pattern 7: SubAgentSpawner Extension (D-05, ORC-06)

**Key finding from code:** `SubAgentSpawner::spawn_once()` currently sets stdout to `Stdio::null()`. NDJSON extension requires switching to `Stdio::piped()` when `ndjson_stdout` is set. [VERIFIED: runtime/src/subagent/spawner.rs lines 182-184]

```rust
// Source: [ASSUMED] — extension to existing SubAgentSpawner pattern
// Add to SubAgentConfig:
pub struct SubAgentConfig {
    // ... existing fields ...
    /// Optional working directory for the child process.
    pub working_dir: Option<PathBuf>,
    /// When true, supervisor reads NDJSON AgentEvent lines from stdout.
    pub ndjson_stdout: bool,
}

// In SubAgentSpawner::spawn_once(), conditional stdout:
if config.ndjson_stdout {
    cmd.stdout(std::process::Stdio::piped());
} else {
    cmd.stdout(std::process::Stdio::null());  // preserves existing behavior
}
```

**Async stdout reading (child process):** Use `tokio::io::BufReader` + `AsyncBufReadExt::lines()` on `child.stdout`. Each line is `serde_json::from_str::<AgentEvent>()`. Since `spawn_once()` is currently synchronous (uses `std::thread::sleep` polling), the NDJSON extension for the supervisor path should be in a new async method, not modifying the synchronous polling loop. [ASSUMED — confirmed from spawner.rs: lines 198-216 use polling loop]

### Anti-Patterns to Avoid

- **Calling `run_turn()` from an async context without `spawn_blocking`:** This blocks a tokio worker thread. The existing code uses `std::thread::sleep` inside `run_turn()`. Confirmed by reading conversation.rs lines 424-430. [VERIFIED]
- **Using `broadcast` for worker→supervisor event reporting:** broadcast has no backpressure; a slow supervisor would silently drop events. Use `mpsc` for the worker→supervisor path (guaranteed delivery) and `broadcast` only for supervisor→UI fan-out.
- **Naming event_tx as `_event_tx` in spawn_agent():** Prefixing with `_` causes immediate drop, closing the mpsc channel. The re-broadcast loop exits immediately (event_rx returns None). event_tx MUST be stored in AgentHandle as a named field.
- **Global git queue (single queue for all repos):** Serializes operations across unrelated repos. Key by repo root.
- **Sharing `TaskRegistry` between supervisor and subagent module:** The existing `TaskRegistry` uses `Arc<Mutex<HashMap>>`. The new `AgentSupervisor` needs a similar structure but with `broadcast::Sender` per entry — don't reuse `TaskRegistry` directly, model after it.
- **`unwrap()` on broadcast send when no subscribers exist:** `broadcast::Sender::send()` returns `Err` when there are no receivers. This is normal (Phase 3 not yet subscribed). Use `let _ = tx.send(event)` to silently discard when no subscribers.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Async fan-out with multiple subscribers | Custom pub/sub | `tokio::sync::broadcast` | Handles lagged receivers, atomic subscription |
| Worker-to-supervisor event delivery | Custom ring buffer | `tokio::sync::mpsc` | Backpressure, bounded, async-aware |
| Blocking-in-async bridge | Custom thread management | `tokio::task::spawn_blocking` | Correct thread pool, JoinHandle, panic capture |
| NDJSON line parsing | Custom line parser | `std::io::BufRead::lines()` / `tokio::io::AsyncBufReadExt::lines()` | Handles partial reads, UTF-8 |
| Git worktree cleanup | Custom git state tracking | `git worktree prune` | Git-native, handles stale state |
| Oneshot request/reply | Custom sync primitives | `tokio::sync::oneshot` | Zero-cost, cancellation-safe |

---

## Common Pitfalls

### Pitfall 1: Holding Mutex Across Await Point
**What goes wrong:** `let _guard = registry.lock().unwrap(); some_async_fn().await;` — tokio detects this and panics in debug mode, or deadlocks in release.
**Why it happens:** `std::sync::Mutex` guards are not `Send`; tokio cannot park a task holding a std Mutex.
**How to avoid:** Use `tokio::sync::Mutex` for any lock held across `.await`, or structure code to drop the guard before awaiting. In `AgentSupervisor`, the registry lookup and event dispatch are separate operations — do the lookup, clone the Sender, drop the lock, then send.
**Warning signs:** Compiler error "MutexGuard cannot be sent between threads safely" or test deadlock.

### Pitfall 2: Broadcast RecvError::Lagged Causes Silent Event Loss
**What goes wrong:** A slow Phase 3 UI subscriber falls behind; old events are overwritten; the subscriber gets `RecvError::Lagged(n)` — n events were dropped.
**Why it happens:** broadcast channel overwrites oldest messages when at capacity. Senders never block.
**How to avoid:** Choose capacity (64) larger than worst-case burst. In Phase 3, handle `RecvError::Lagged` explicitly — emit a synthetic "events lost" notification to the UI rather than silently skipping.
**Warning signs:** Missing state change events in Phase 3 UI.

### Pitfall 3: git worktree on Windows with Spaces in Path
**What goes wrong:** `git worktree add "C:\path with spaces\worktree-1"` — shell quoting may fail if using `Command::new("sh").arg("-c")` form.
**Why it happens:** `std::process::Command` with individual `.arg()` calls handles spaces correctly (no shell quoting). Using `.arg("-c").arg("git worktree add ...")` with string concatenation does not.
**How to avoid:** Always use `Command::new("git").args(["worktree", "add", path_str])` form — one arg per array element. Already the pattern in spawner.rs.
**Warning signs:** `git` errors like "fatal: invalid path" on paths with spaces.

### Pitfall 4: Synchronous git Commands Block Tokio Worker
**What goes wrong:** `GitOpQueue` runs `std::process::Command::new("git").output()` directly in an async task without `spawn_blocking`.
**Why it happens:** `Command::output()` blocks the calling thread; in an async task this blocks a tokio worker thread.
**How to avoid:** Use `tokio::task::spawn_blocking` inside the queue task for the `Command::output()` call. Shown in Pattern 6 above.
**Warning signs:** Tokio warns "task is blocking" in tests with `TOKIO_WORKER_THREADS=1`.

### Pitfall 5: AgentState Transition Not Enforced at Runtime
**What goes wrong:** Code calls `state.transition_to(AgentState::Done)` from `Idle` — a logically invalid transition silently succeeds.
**Why it happens:** If transitions are just state reassignments without validation.
**How to avoid:** Implement `can_transition_to()` and assert/return error in the supervisor when transitions are invalid. State changes always go through supervisor methods, never direct field mutation.
**Warning signs:** Agent stuck in `Done` then receives another event.

### Pitfall 6: Worktree Not Released on Agent Panic
**What goes wrong:** Agent task panics inside `spawn_blocking`; worktree entry stays in `WorktreeManager.active` permanently; that worktree path is never reused.
**Why it happens:** `spawn_blocking` returns `Err(JoinError)` on panic — the supervisor must handle this path.
**How to avoid:** In the supervisor's agent task loop, match on `Err(join_error)` from spawn_blocking and call `worktree_manager.remove(agent_id)` in all error paths. Use a cleanup guard pattern (RAII struct that releases worktree on drop).
**Warning signs:** Worktree count grows monotonically; `git worktree list` shows entries for dead agents.

---

## Code Examples

### AgentEvent Enum (D-02)
```rust
// Source: 02-CONTEXT.md D-02 (locked decision)
use serde::{Deserialize, Serialize};
use crate::usage::TokenUsage;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AgentEvent {
    StateChanged(AgentState),
    ToolCallStarted { tool: String, input: String },
    ToolCallCompleted { tool: String, output: String },
    TurnCompleted { usage: TokenUsage },
    Error { message: String },
}
```

### Supervisor spawn_agent skeleton
```rust
// Source: [ASSUMED] — synthesized from D-01 through D-11 decisions
pub fn spawn_agent(
    &self,
    branch: &str,
) -> Result<AgentId, SupervisorError> {
    let agent_id = AgentId::new();
    let worktree_path = self.worktrees.add(&agent_id, branch)?;

    // event_tx stored in AgentHandle — NOT dropped here
    let (event_tx, mut event_rx) = mpsc::channel::<AgentEvent>(64);
    let (broadcast_tx, _) = broadcast::channel::<AgentEvent>(64);
    let (control_tx, _control_rx) = mpsc::channel::<AgentControl>(8);

    let handle = AgentHandle {
        agent_id: agent_id.clone(),
        event_tx,              // stored in handle — keeps channel open
        broadcast_tx: broadcast_tx.clone(),
        cancel_tx: control_tx,
        worktree_path,
    };

    // Re-broadcast loop: mpsc events → broadcast fan-out
    let broadcast_tx_clone = broadcast_tx.clone();
    tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            let _ = broadcast_tx_clone.send(event);
        }
        // Loop exits only when all event_tx senders are dropped (agent stopped)
    });

    // Register before spawning so handle is available immediately
    let mut registry = self.registry.lock().unwrap();
    registry.insert(agent_id.clone(), handle);
    drop(registry);

    // Actual agent task launched separately
    // (run_turn via spawn_blocking, handle.event_tx.clone() for reporting)
    Ok(agent_id)
}
```

### MockRuntime for ORC-03 load test
```rust
// Source: [ASSUMED] — design from D-09 context decision
struct MockApiClient {
    delay: Duration,
}

impl ApiClient for MockApiClient {
    fn stream(&mut self, _request: ApiRequest) -> Result<Vec<AssistantEvent>, RuntimeError> {
        std::thread::sleep(self.delay);  // simulates blocking API call
        Ok(vec![
            AssistantEvent::TextDelta("done".to_string()),
            AssistantEvent::Usage(TokenUsage::default()),
            AssistantEvent::MessageStop,
        ])
    }
}

// ORC-03 load test uses a bounded runtime — NOT #[tokio::test(flavor = "multi_thread")]
// Bounded pool makes thread exhaustion detectable.
#[test]
fn orc03_run_turn_inside_spawn_blocking_8_concurrent_agents() {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(4)
        .max_blocking_threads(16)
        .build()
        .unwrap();
    rt.block_on(async {
        const N: usize = 8;
        let mut handles = Vec::new();
        for _ in 0..N {
            let handle = tokio::task::spawn_blocking(|| {
                let mut runtime = ConversationRuntime::new(
                    Session::new(),
                    MockApiClient { delay: Duration::from_millis(10) },
                    StaticToolExecutor::new(),
                    PermissionPolicy::new(PermissionMode::Allow),
                    vec!["system".to_string()],
                );
                runtime.run_turn("test", None)
            });
            handles.push(handle);
        }
        for h in handles {
            h.await.expect("no panic").ok(); // mock may return error — that's fine
        }
    });
}
```

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Rust built-in test framework (`#[test]`, `#[tokio::test]`) |
| Config file | `rust/Cargo.toml` workspace with `[profile.test]` defaults |
| Quick run command | `cargo test --manifest-path rust/Cargo.toml -p runtime supervisor` |
| Full suite command | `cargo test --manifest-path rust/Cargo.toml --workspace` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ORC-01 | AgentState transitions: valid and invalid paths | unit | `cargo test -p runtime agent_state` | ❌ Wave 0 |
| ORC-01 | AgentEvent serde round-trip (serialize → deserialize → same value) | unit | `cargo test -p runtime agent_event_serde` | ❌ Wave 0 |
| ORC-02 | AgentSupervisor: spawn N agents, list returns N entries, stop removes entry | unit | `cargo test -p runtime supervisor_registry` | ❌ Wave 0 |
| ORC-02 | AgentHandle::subscribe() returns receiver that sees events (via event_tx→broadcast path) | unit | `cargo test -p runtime agent_handle_subscribe` | ❌ Wave 0 |
| ORC-03 | run_turn() inside spawn_blocking: 8 concurrent agents complete without deadlock; bounded pool (max_blocking_threads=16) | load test | `cargo test -p runtime orc03_` | ❌ Wave 0 |
| ORC-04 | publish() accepts ≤1000 token snapshot, returns Ok | unit | `cargo test -p runtime context_store_publish_ok` | ❌ Wave 0 |
| ORC-04 | publish() rejects >1000 token snapshot, returns Err(TooLarge) | unit | `cargo test -p runtime context_store_too_large` | ❌ Wave 0 |
| ORC-04 | pull() returns None for missing key, Some for existing key | unit | `cargo test -p runtime context_store_pull` | ❌ Wave 0 |
| ORC-05 | WorktreeManager::add() shells out to git worktree add, returns path | unit (requires git) | `cargo test -p runtime worktree_add` | ❌ Wave 0 |
| ORC-05 | WorktreeManager::remove() removes worktree from active map | unit (requires git) | `cargo test -p runtime worktree_remove` | ❌ Wave 0 |
| ORC-05 | WorktreeManager::list() returns all active worktrees | unit | `cargo test -p runtime worktree_list` | ❌ Wave 0 |
| ORC-06 | SubAgentConfig with working_dir set passes --working-dir flag to child | unit | `cargo test -p runtime spawner_working_dir` | ❌ Wave 0 |
| ORC-06 | NDJSON AgentEvent round-trip: serialize to line, deserialize back | unit | `cargo test -p runtime ndjson_roundtrip` | ❌ Wave 0 |
| ORC-07 | GitOpQueue serializes two concurrent writes: second runs after first completes | unit | `cargo test -p runtime git_queue_serialization` | ❌ Wave 0 |

**ORC-05 worktree tests:** These require a real git repo. Use `tempfile::TempDir` with `git init` as test fixture. Since `tempfile` is not in workspace dependencies, add it as a `[dev-dependencies]` in `runtime/Cargo.toml`.

**ORC-03 load test strategy:** Use `tokio::runtime::Builder::new_multi_thread().max_blocking_threads(16)` to bound the blocking pool at a known value and confirm 8 concurrent agents fit without exhaustion. `MockApiClient` returns instantly with canned response (no real API). [ASSUMED — tokio Builder API; test pattern from D-09]

### Sampling Rate
- **Per task commit:** `cargo test --manifest-path rust/Cargo.toml -p runtime`
- **Per wave merge:** `cargo test --manifest-path rust/Cargo.toml --workspace`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `rust/crates/runtime/src/supervisor/mod.rs` — new module, all stubs
- [ ] `rust/crates/runtime/src/supervisor/agent_state.rs` — covers ORC-01 tests
- [ ] `rust/crates/runtime/src/supervisor/handle.rs` — covers ORC-02 handle tests
- [ ] `rust/crates/runtime/src/supervisor/supervisor.rs` — covers ORC-02 registry tests
- [ ] `rust/crates/runtime/src/supervisor/context_store.rs` — covers ORC-04 tests
- [ ] `rust/crates/runtime/src/supervisor/worktree.rs` — covers ORC-05 tests
- [ ] `rust/crates/runtime/src/supervisor/git_queue.rs` — covers ORC-07 tests
- [ ] `[dev-dependencies] tempfile = "3"` in `rust/crates/runtime/Cargo.toml` — for worktree git fixture tests
- [ ] `tokio = { version = "1", features = ["full"] }` already in runtime Cargo.toml — CONFIRMED, no change needed

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| git CLI | WorktreeManager (ORC-05), GitOpQueue (ORC-07) | ✓ | 2.53.0.windows.1 | — |
| cargo / rustc | All tests | ✓ | verified (build succeeded) | — |
| tokio broadcast | D-01, D-03 | ✓ | in workspace (features = ["full"]) | — |
| tokio mpsc | D-01 | ✓ | in workspace (features = ["full"]) | — |
| tokio spawn_blocking | D-10 | ✓ | in workspace (features = ["full"]) | — |
| tempfile (dev dep) | ORC-05 git fixture tests | ✗ | — | Manual tmpdir cleanup (weaker) |

**Missing dependencies with no fallback:** None — git is installed, tokio is in workspace.

**Missing dependencies with fallback:**
- `tempfile`: needed for clean test isolation in worktree tests. Fallback is using a hardcoded path under `std::env::temp_dir()` — acceptable but produces dirtier tests.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | partial | `SubAgentConfig.allowed_tools` list — existing pattern |
| V5 Input Validation | yes | `SharedContextStore::publish()` validates token count; NDJSON deserialization uses serde (type-safe) |
| V6 Cryptography | no | — |

### Known Threat Patterns for Rust async + subprocess

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal in worktree paths | Tampering | Canonicalize all paths via `std::fs::canonicalize()` before passing to git; reject paths that escape repo root |
| NDJSON injection from child process | Tampering | `serde_json::from_str::<AgentEvent>()` is type-safe — unknown fields are rejected by default; use `#[serde(deny_unknown_fields)]` on AgentEvent |
| Unbounded child process stdout | DoS | Set a max line length when reading NDJSON; discard oversized lines with an `Error` event |
| git worktree left behind after panic | Elevation | RAII guard releases worktree in Drop; supervisor calls `prune()` at startup |

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|-----------------|--------|
| Polling child process exit status (spawner.rs current) | Async stdout line reading for NDJSON | D-05 extension must add async read path alongside existing sync poll path |
| Global `TaskRegistry` with `Arc<Mutex>` | Per-agent `AgentHandle` with broadcast | Better fan-out; multiple Phase 3 subscribers per agent |
| `SubAgentStatus` (5 states) | `AgentState` (6 states with Waiting) | Waiting state represents permission-blocked or context-pull-blocked agent |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `broadcast::channel(64)` capacity is sufficient for AgentEvent fan-out | Pattern 1 | If agents emit >64 events before Phase 3 subscribes, RecvError::Lagged on first subscription. Mitigate: subscriber handles Lagged gracefully |
| A2 | One `GitOpQueue` per repo root is sufficient serialization | Pattern 6 | If two repos share a git common-dir, they'd need a shared queue. For typical single-repo development this is safe |
| A3 | `AgentState::can_transition_to()` transition table covers all valid workflows | Pattern 2 | If Waiting→Planning is needed (agent replanned mid-wait), the transition table needs expansion |
| A4 | `split_whitespace().count()` as token estimator stays conservative vs. actual BPE count | Pattern 4 | Whitespace tokens <= actual tokens for code (code has many short tokens). 1000-whitespace-word snapshot could be >1000 BPE tokens. Acceptable per D-07 decision |
| A5 | `tempfile` crate for dev-dependencies has no version conflicts | Validation Architecture | Unlikely — tempfile is a stable, widely-used crate |
| A6 | `tokio::task::spawn_blocking` default max (512) is never hit in realistic load | Pattern 3 | For >512 concurrent agents this would be a problem. Not a v1 concern |

---

## Open Questions (RESOLVED)

1. **AgentId type definition**
   - What we know: The supervisor needs a stable identifier per agent; `String` or a newtype wrapping UUID.
   - What's unclear: Whether `AgentId` should be a newtype (`struct AgentId(Uuid)`) or a plain `String` alias.
   - Recommendation: Use `struct AgentId(String)` with a `Display` impl — avoids pulling in uuid unless already present. UUID is already in workspace deps, so `struct AgentId(Uuid)` is equally viable. Planner decides.
   - **RESOLVED (02-01):** Uses `struct AgentId(String)` with counter-based ID generation.

2. **WorktreeManager: base directory location**
   - What we know: Worktrees should be sibling directories to the repo root.
   - What's unclear: Should the base dir be `.xolotl-worktrees/` inside the repo, or a temp dir, or configurable?
   - Recommendation: Use `<repo_root>/.xolotl-worktrees/` as default, add to `.gitignore`. This keeps worktrees near the repo for editor tools that respect relative paths.
   - **RESOLVED (02-03):** Uses `<repo_root>/.xolotl-worktrees/` as the base directory.

3. **Pause semantics for AgentHandle::pause()**
   - What we know: D-03 specifies `pause()` control method.
   - What's unclear: What does pause mean for a synchronous `run_turn()` call already in-flight inside `spawn_blocking`? You cannot interrupt it mid-turn.
   - Recommendation: Implement pause as "don't start the next turn" — a `paused: Arc<AtomicBool>` flag checked before each `spawn_blocking` call. Document that pause takes effect at turn boundaries, not mid-turn.
   - **RESOLVED (02-04):** Uses `Arc<AtomicBool>` checked before each `spawn_blocking` call — turn-boundary pause only.

---

## Sources

### Primary (HIGH confidence)
- `rust/crates/runtime/src/conversation.rs` — run_turn() is synchronous, uses std::thread::spawn/sleep internally [VERIFIED]
- `rust/crates/runtime/src/subagent/spawner.rs` — stdout currently Stdio::null, sync polling loop [VERIFIED]
- `rust/crates/runtime/src/subagent/registry.rs` — Arc<Mutex<HashMap>> pattern established [VERIFIED]
- `rust/crates/runtime/src/tokenizer.rs` — tiktoken exists; whitespace tokenizer is new and different [VERIFIED]
- `rust/Cargo.toml` — tokio features = ["full"] confirmed; all sync primitives available [VERIFIED]
- `https://docs.rs/tokio/latest/tokio/sync/broadcast/index.html` — RecvError::Lagged behavior, no backpressure on send [CITED]
- `https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html` — thread pool expansion, correct usage patterns [CITED]
- `https://git-scm.com/docs/git-worktree` — worktree commands, prune behavior, per-worktree index isolation [CITED]

### Secondary (MEDIUM confidence)
- git version output: 2.53.0.windows.1 — confirmed git installed on target machine [VERIFIED via Bash]
- cargo build output — workspace builds successfully with current deps, no missing feature flags [VERIFIED via Bash]

### Tertiary (LOW confidence)
- Broadcast capacity 64 recommendation — heuristic, not from official docs
- GitOpQueue per-repo-root design — synthesized pattern, not from an official source

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all tokio primitives verified in workspace Cargo.toml; no new dependencies required
- Architecture: HIGH — patterns derived from verified source code + official tokio/git docs
- Pitfalls: HIGH for concurrency pitfalls (verified tokio docs); MEDIUM for git-on-Windows (tested git version, pattern consistent with existing spawner.rs)

**Research date:** 2026-05-08
**Valid until:** 2026-06-08 (tokio 1.x API is stable; git worktree API is stable)
