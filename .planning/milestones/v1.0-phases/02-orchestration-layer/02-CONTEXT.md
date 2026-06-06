# Phase 2: Orchestration Layer - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the Rust actor model that lets multiple AI agents run in parallel on isolated git worktrees, supervised by a centralized `AgentSupervisor`. Verifiable headlessly via `cargo test` with a stub model — no UI, no Tauri, no frontend. Phase 3 builds on top of this.

</domain>

<decisions>
## Implementation Decisions

### AgentEvent Channel Design
- **D-01:** Workers stream events to `AgentSupervisor` via **tokio broadcast/mpsc channel** — supervisor owns the Sender side, workers hold Sender clones. No NDJSON parsing in-process; channels are the in-process event bus.
- **D-02:** `AgentEvent` enum variants: `StateChanged(AgentState)`, `ToolCallStarted { tool: String, input: String }`, `ToolCallCompleted { tool: String, output: String }`, `TurnCompleted { usage: TokenUsage }`, `Error { message: String }`. This set is the contract Phase 3 (Tauri) subscribes to.
- **D-03:** `AgentHandle` exposes **both**: `subscribe() -> broadcast::Receiver<AgentEvent>` for consumers (Phase 3 Tauri layer will use this), plus `stop()` / `pause()` control methods. Supervisor holds the corresponding Sender.

### NDJSON / SubAgentResult Contract (ORC-06)
- **D-04:** NDJSON lines emitted by child-process workers are **serde-serialized `AgentEvent` JSON** — same enum as in-process events. Supervisor deserializes directly into `AgentEvent` variants. One schema for both transports.
- **D-05:** **Extend the existing `SubAgentSpawner` struct** (do not wrap it). Add `--working-dir` flag and NDJSON stdout streaming to `SubAgentSpawner`. Existing CLI behavior preserved via the same struct; new fields are opt-in.

### SharedContextStore Access Model (ORC-04)
- **D-06:** **Keyed pull-on-demand** — agents call `publish(key: &str, snapshot: &str)` to write named snapshots (e.g., `"agent-1-summary"`, `"shared-plan"`). Any agent calls `pull(key: &str) -> Option<String>` to read. Internally a `HashMap<String, String>` behind an `Arc<RwLock<...>>`.
- **D-07:** `publish()` **returns `Err(TooLarge)`** if the snapshot exceeds 1000 tokens. Token counting uses a simple whitespace tokenizer (no tiktoken dependency). Callers must trim before publishing — no silent truncation.

### WorktreeManager Coupling (ORC-05)
- **D-08:** `WorktreeManager` is **owned by `AgentSupervisor`**. Supervisor assigns a worktree at agent spawn time and releases it when the agent stops. This enforces the "exactly one worktree per agent" invariant centrally.
- **D-09:** Phase 2 headless verification uses **`cargo test` with a stub/mock runtime** — `MockRuntime` returns instant canned responses, no real API calls. Load test spawns N concurrent agents and asserts tokio thread pool stays bounded (no starvation). Fast, deterministic, no API key dependency.

### Carried Forward from Phase 1
- **D-10:** `ConversationRuntime::run_turn()` MUST always execute inside `tokio::task::spawn_blocking`. This is a day-one invariant — the ORC-03 load test validates it is not violated.
- **D-11:** Orchestrator runs in-process. Worker sub-agents continue to use child-process `SubAgentSpawner` (D-05 extends it, does not replace it).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Orchestration Code (starting point)
- `rust/crates/runtime/src/subagent/mod.rs` — existing SubAgentStatus enum, SubAgentInfo struct; extend here
- `rust/crates/runtime/src/subagent/spawner.rs` — SubAgentSpawner + SubAgentConfig; D-05 extends this file
- `rust/crates/runtime/src/subagent/registry.rs` — TaskRegistry; review before designing AgentSupervisor registry
- `rust/crates/runtime/src/subagent/result.rs` — SubAgentResult; this becomes the structured NDJSON footer

### Phase Requirements
- `.planning/REQUIREMENTS.md` §Orchestration Layer — ORC-01 through ORC-07 (7 requirements, all Phase 2)
- `.planning/ROADMAP.md` §Phase 2 — success criteria and dependency on Phase 1

### Architecture Decisions (from STATE.md)
- `.planning/STATE.md` §Key Decisions — tokio::task::spawn_blocking invariant (D-10), in-process orchestrator (D-11)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `SubAgentSpawner` (`runtime/src/subagent/spawner.rs`) — child process spawning with retry; extend with `--working-dir` and NDJSON stdout for D-05
- `TaskRegistry` (`runtime/src/subagent/registry.rs`) — HashMap-based task tracking; review as starting point for `AgentSupervisor` registry
- `SubAgentStatus` enum — Pending/Running/Completed/Failed/Cancelled already defined; `AgentState` enum (ORC-01) extends or replaces this
- `SubAgentResult` (`runtime/src/subagent/result.rs`) — structured result type; becomes the final NDJSON line on completion

### Established Patterns
- Tokio async runtime is already in use throughout `runtime/` — use `tokio::sync::broadcast` or `mpsc` for D-01 channels
- `Arc<Mutex<...>>` pattern used in `registry.rs` — `SharedContextStore` uses `Arc<RwLock<HashMap<...>>>` (RwLock preferred for read-heavy workload)
- Child process spawning via `std::process::Command` in spawner.rs — NDJSON extension reads stdout line-by-line

### Integration Points
- New `AgentSupervisor` module likely lives in `runtime/src/supervisor/` or `runtime/src/orchestration/`
- `AgentSupervisor` holds: `WorktreeManager`, `SharedContextStore`, registry of `AgentHandle`s
- Phase 3 (Tauri) will call `AgentSupervisor` as Tauri managed state — keep it `Send + Sync`

</code_context>

<specifics>
## Specific Ideas

- `AgentHandle::subscribe()` should return `broadcast::Receiver<AgentEvent>` — Phase 3 Tauri layer wraps this in a Tauri event emitter
- MockRuntime for ORC-03 load test: returns a fixed `TurnCompleted { usage: TokenUsage::default() }` event after a small `tokio::time::sleep`

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 2-Orchestration Layer*
*Context gathered: 2026-05-08*
