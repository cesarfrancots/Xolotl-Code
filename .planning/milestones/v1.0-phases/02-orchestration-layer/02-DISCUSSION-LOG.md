# Discussion Log — Phase 2: Orchestration Layer

**Date:** 2026-05-08
**Areas discussed:** AgentEvent channel design, NDJSON / SubAgentResult contract, SharedContextStore access model, WorktreeManager coupling

---

## Area 1: AgentEvent Channel Design

**Q1: How should workers stream events to the supervisor?**
Options: tokio broadcast channel / NDJSON stdout parsing / Shared Arc<Mutex<EventQueue>>
**Selected:** tokio broadcast channel

**Q2: What AgentEvent variants does the supervisor need?**
Options: State + tool activity + output / State transitions only / Let Claude decide
**Selected:** State transitions + tool activity + output (StateChanged, ToolCallStarted, ToolCallCompleted, TurnCompleted, Error)

**Q3: Should AgentHandle expose subscribe() + control, or control only?**
Options: Both subscribe() + control / Control only
**Selected:** Both — subscribe() -> broadcast::Receiver<AgentEvent> + stop()/pause()

---

## Area 2: NDJSON / SubAgentResult Contract

**Q1: What should NDJSON lines look like during streaming?**
Options: Typed AgentEvent JSON / Simple progress + final / Log-level + footer
**Selected:** Typed AgentEvent JSON lines (same serde enum as in-process)

**Q2: Extend SubAgentSpawner or wrap with SupervisedSpawner?**
Options: Extend SubAgentSpawner / Wrap with SupervisedSpawner
**Selected:** Extend SubAgentSpawner — keeps one type, preserves existing CLI behavior

---

## Area 3: SharedContextStore Access Model

**Q1: How should agents share context snapshots?**
Options: Keyed pull-on-demand / Broadcast all-to-all / Directed agent-to-agent
**Selected:** Keyed pull-on-demand (publish(key, snapshot) / pull(key))

**Q2: How to enforce 500-1000 token limit?**
Options: publish() returns Err(TooLarge) / Silent truncation / Advisory warning
**Selected:** publish() returns Err if > 1000 tokens; caller must trim

---

## Area 4: WorktreeManager Coupling

**Q1: Owned by AgentSupervisor or standalone service?**
Options: Owned by AgentSupervisor / Standalone / injected
**Selected:** Owned by AgentSupervisor — enforces one-worktree-per-agent invariant centrally

**Q2: Headless verification strategy for ORC-03?**
Options: cargo test with stub model / Integration test vs real API / Let Claude decide
**Selected:** cargo test with stub model (MockRuntime, no API keys, deterministic)

---

## Deferred Ideas

None.
