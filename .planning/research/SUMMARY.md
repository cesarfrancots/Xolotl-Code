# Research Summary — xolotl

*Synthesized from STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md*

---

## Executive Summary

xolotl is a chat-first multi-agent AI coding assistant: a Tauri 2.x desktop app wrapping an already ~70%-complete Rust CLI backend. The core bet is the combination of multi-agent orchestration (parallel agents on git worktrees, role-based teams, live dashboard) with first-class open model support (Kimi K2, MiniMax M1) — a combination neither Cursor nor Codex delivers.

The Rust core (streaming API, agentic loop, session management, permissions, MCP, sub-agent spawning) is production-quality and must not be rewritten. The work is: finish the CLI gaps, add an orchestration coordination layer, and build the Tauri UI on top.

---

## Recommended Stack

| Technology | Version | Rationale |
|------------|---------|-----------|
| Tauri (Rust crate) | 2.1.x | `Channel<T>` is the correct streaming primitive; zero FFI friction with existing Rust backend |
| @tauri-apps/api | 2.1.x | JS bindings; `invoke()` for commands, `Channel` for streams |
| React + TypeScript | 19.x / 5.5+ | `useTransition` addresses 60-100 events/sec streaming; mature ecosystem for agent dashboard |
| Zustand | 5.0.x | `subscribeWithSelector` enables per-agent subscriptions without full re-renders |
| Vite + plugin-react-swc | 6.x / 3.x | Fast HMR; Rust recompile is the bottleneck, frontend should reload in <100ms |
| pnpm | 9.x | Strict dep isolation aligns with Tauri's capability security model |
| Tailwind CSS | 4.x | Dark-mode-first dev tool aesthetic (verify stable; was RC at research time) |
| shadcn/ui + Radix UI | current | Copy-paste model = no lock-in; Dialog, Tooltip, ScrollArea match needed components |
| @tanstack/react-virtual | 3.x | Required for sessions with 200+ turns (10,000+ DOM nodes without virtualization) |
| react-markdown + rehype-highlight | 9.x | Handles partial code fences during active stream |
| specta + tauri-specta | 2.x | Generate TypeScript types from Rust structs — eliminates IPC type divergence bugs |

**Not recommended:** Electron, xterm.js (anti-feature — too heavy), Redux, XState on frontend.

---

## Table Stakes (users leave without these)

1. Streaming responses with markdown rendering and syntax-highlighted code blocks
2. Copy button on code blocks
3. Collapsible tool call blocks (bash output, file reads, diffs)
4. Inline diff display inside tool blocks
5. Session persistence + resumption (sidebar session list)
6. Permission prompt UI (wired to existing backend)
7. Model selector (per session, all configured providers)
8. Cost / token display per turn and session total
9. Cancel / stop generation button
10. Slash command palette (`/clear`, `/model`, `/save`, `/load`, `/help`)
11. Multiline input

---

## Differentiators (what makes xolotl better than Cursor/Codex)

1. **Agent orchestration dashboard** — live view of all running agents, status, task, cost. Nothing in Cursor/Codex has this.
2. **Parallel worktree agents** — spawn agents on separate git branches simultaneously. Both competitors are single-branch.
3. **Per-agent model selection** — orchestrator on Sonnet, workers on Haiku/Kimi. Cost-optimal by design.
4. **Open model first-class** — Kimi K2, MiniMax M1 with per-model schema validation and capability flags, not a generic shim.
5. **Background agents with notifications** — fire-and-forget with system completion alerts.
6. **SDD mode** — spec-first workflow baked into the agent loop. No competitor has opinionated spec-first flow.

---

## Architecture Decision

**Modified Actor Model.** Each agent is an isolated tokio task with its own `ConversationRuntime` instance. Communication via typed mpsc channels. `AgentSupervisor` is the single registry held as Tauri managed state. One `Channel<AgentEvent>` per agent (not multiplexed). Hybrid process model: orchestrator in-process, worker agents via existing `SubAgentSpawner` child processes. Context sharing via snapshot-only pull model (`SharedContextStore`) — no shared mutable session objects. Git worktrees managed via `std::process::Command` CLI (not `git2` crate).

**Critical constraint:** `ConversationRuntime::run_turn()` is synchronous and must always run in `tokio::task::spawn_blocking`. This is a day-one architectural invariant — violating it freezes the Tauri window.

---

## Critical Pitfalls

1. **Blocking tokio with `run_turn()`** — Any `MutexGuard<ConversationRuntime>` held across an await or blocking HTTP call freezes the window. Use `spawn_blocking` from day one. *(Phase 3 — must be correct before writing command handlers.)*

2. **Agent loop cost runaway** — 10 agents × 32 iterations × expensive model = thousands of dollars. Add `budget_exceeded()` to `UsageTracker` and a global agent count ceiling before any long-running multi-agent experiments. *(Phase 1 deliverable.)*

3. **Open model tool-call schema failures** — Kimi K2/MiniMax M1 schemas diverge at edge cases (`$defs`, `anyOf`, `additionalProperties`). Must be validated against real endpoints before multi-agent. *(Phase 1 deliverable — already in Active requirements.)*

4. **IPC payload size freezing WebView** — Never return `Vec<ConversationMessage>` in full from a Tauri command. Use paginated slices + streaming events. *(Phase 3 — architectural decision.)*

5. **Tauri 2.x capability config** — Missing capability = silent permission denial at runtime (no error, no-op). `invoke` itself requires `core:default` grant. Start from Tauri 2.x docs, not 1.x examples. *(Phase 3 — day one.)*

Supporting: React streaming re-renders at 60-100 events/sec (buffer in `useRef`, flush via `requestAnimationFrame`); git worktree `index.lock` conflicts with concurrent agents (git operation queue per repo); orchestrator context window accumulation (structured 500-1000 token summaries only, never full session dumps).

---

## Build Order

**Phase 1 — CLI Completion**
Finish CLI gaps and fix open model schemas before any UI. Establishes stable foundation and resolves multi-agent blocker.
- Interactive permission prompting, slash commands, cost display, session resumption
- Kimi K2 / MiniMax M1 tool-call schema validation and fixes
- `UsageTracker::budget_exceeded()` + agent count ceiling

**Phase 2 — Orchestration Layer (Rust only, no Tauri)**
Build and unit-test the actor model entirely in Rust before any frontend. Validate headlessly.
- `AgentState`, `AgentEvent`, `WorktreeManager`, `SharedContextStore`
- `AgentSupervisor`, `AgentHandle`, `OrchestratorMsg`
- `agent_loop` with `spawn_blocking`, in-process orchestrator
- Three targeted `SubAgentSpawner` changes (working-dir, NDJSON stdout, supervisor registration)
- Git operation queue, structured `SubAgentResult` contract

**Phase 3 — Tauri Shell + Core IPC**
Establish Tauri wiring before building UI features. Capability config and IPC payload strategy must be right from day one.
- `src-tauri` scaffold, Tauri 2.x capability config
- `AgentSupervisor` as managed state, Tauri command layer
- `TauriPermissionPrompter`, specta + tauri-specta type generation
- Core plugins: `window-state`, `clipboard-manager`, `fs`

**Phase 4 — Chat UI Baseline**
Table-stakes features. Must ship before any differentiator work.
- Streaming chat with `requestAnimationFrame` buffering
- Tool call blocks, inline diffs, markdown rendering, virtualized message list
- Session sidebar, permission prompt, model selector, cost display, slash commands

**Phase 5 — Agent Dashboard**
Primary differentiator. Requires Phases 2 and 4.
- `AgentRoster`, per-agent streaming panels, `SpawnAgentDialog`
- Background agent launch + completion notifications
- Per-agent model selection, cost budget controls

**Phase 6 — Parallel Worktrees + Team Orchestration**
Most complex differentiator. Deferred until foundation is stable.
- Parallel worktree visualization, role-based team composition UI
- Swarm strategy configuration, file ownership protocol, merge checkpoints

---

## Open Questions (resolve before relevant phase)

1. **GNU toolchain + Tauri compatibility** — Does `stable-x86_64-pc-windows-gnu` work with Tauri's Windows build scripts, or is MSVC required? *(Phase 3 blocker.)*
2. **Kimi K2 / MiniMax M1 schema specifics** — Run round-trip schema tests against real endpoints. *(Phase 1 deliverable.)*
3. **specta + tauri-specta maintenance** — Confirm active maintenance and Tauri 2.1.x compatibility. *(Phase 3 decision.)*
4. **Tailwind 4 stable release** — Confirm v4 is stable. *(Phase 4 decision.)*
5. **`SubAgentResult` structured format** — Define the contract before multi-round orchestration. *(Phase 2 deliverable.)*
6. **Orchestrator prompt design for worker models** — Empirical testing needed for Haiku/Kimi K2 reliability. *(Phase 5.)*
