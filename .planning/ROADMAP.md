# Roadmap: xolotl

**Created:** 2026-05-07
**Granularity:** standard
**Mode:** yolo
**Core Value:** A developer can spawn, monitor, and coordinate multiple AI agents working in parallel on a single project — from a chat-first desktop app — without being locked into OpenAI or Anthropic.

---

## Phases

- [x] **Phase 1: CLI Completion** — Finish CLI gaps and lock down open-model tool-calling so the headless agent is production-ready before any UI work. *(complete 2026-05-08)*
- [x] **Phase 2: Orchestration Layer** — Build the Rust-only actor model (supervisor, worktrees, shared context, git serialization) and validate headlessly. *(complete 2026-05-08)*
- [x] **Phase 3: Tauri Shell** — Stand up the Tauri 2.x desktop shell with capability config, managed state, and TypeScript-typed IPC to the Rust core. *(complete 2026-05-09)*
- [x] **Phase 4: Chat UI** — Deliver the table-stakes chat experience: streaming, tool blocks, diffs, sessions, permissions, model selector, slash commands. *(complete 2026-05-10)*
- [ ] **Phase 5: Agent Dashboard** — Make multi-agent orchestration visible: spawn, monitor, budget, and notify across multiple concurrent agents.
- [ ] **Phase 6: Parallel Worktrees + Team Orchestration** — Enable parallel agents on isolated worktrees with role-based teams, swarm strategies, and merge checkpoints.

---

## Phase Details

### Phase 1: CLI Completion
**Goal**: A user can run a complete, cost-aware, resumable agent session from the CLI against Anthropic, Kimi K2, and MiniMax M1 with safe, interactive tool gating.
**Depends on**: Nothing (foundation work on the existing Rust CLI).
**Requirements**: CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, CLI-06
**Success Criteria** (what must be TRUE):
  1. User can approve/deny/always-allow tool calls interactively in the REPL and the choice is honored for the rest of the session.
  2. User can run `/help`, `/clear`, `/model`, `/cost`, `/save`, and `/load` slash commands and see their effects in the REPL.
  3. User sees per-turn and session-total token counts and dollar cost printed after each turn.
  4. User can resume a previous session via `--resume <id>` and continues with full prior context.
  5. Kimi K2 and MiniMax M1 complete a tool-call round-trip against real endpoints without falling back to text-only output, and the agent loop refuses a new turn when the configured cost budget is exceeded.
**Plans**: 4 plans

Plans:
**Wave 1:** - [x] 01-01-PLAN.md — Permission prompt: 120-char preview + [y]/[n]/[a] choices (CLI-01) *(complete 2026-05-08)*
**Wave 2** *(blocked on Wave 1)*: - [x] 01-02-PLAN.md — Cost footer D-05 format + --budget flag + D-10 error message (CLI-03, CLI-06) *(complete 2026-05-08)*
**Wave 3** *(blocked on Wave 2)*: - [x] 01-03-PLAN.md — --resume opens interactive REPL with loaded session (CLI-04) *(complete 2026-05-08)*
**Wave 4** *(blocked on Wave 3)*: - [x] 01-04-PLAN.md — Slash command verification + Kimi/MiniMax live endpoint validation (CLI-02, CLI-05) *(complete 2026-05-08)*

Cross-cutting constraint: All plans target `main.rs` / `LiveCli` exclusively — `app.rs` is dead code.

### Phase 2: Orchestration Layer
**Goal**: The Rust core can supervise multiple isolated agents running in parallel on separate git worktrees with safe blocking semantics and serialized git writes — verifiable headlessly.
**Depends on**: Phase 1
**Requirements**: ORC-01, ORC-02, ORC-03, ORC-04, ORC-05, ORC-06, ORC-07
**Success Criteria** (what must be TRUE):
  1. `AgentSupervisor` can start, list, and stop agents through a typed API, and each agent emits `AgentEvent`s through its registered `AgentHandle`.
  2. A load test running multiple concurrent agents passes without freezing the runtime, proving every `run_turn()` executes inside `tokio::task::spawn_blocking`.
  3. `WorktreeManager` creates, lists, and deletes git worktrees on demand, and each spawned agent runs against exactly one assigned worktree.
  4. Two or more agents writing to the same repo through the git operation queue complete without `index.lock` corruption, and the existing `SubAgentSpawner` CLI behavior still works while also streaming NDJSON events to the supervisor.
  5. Agents can publish and pull bounded (500–1000 token) snapshots through `SharedContextStore` without sharing mutable session objects.
**Plans**: 6 plans

Plans:
**Wave 1:**
- [x] 02-01-PLAN.md — Core types: AgentId, AgentState, AgentEvent, AgentControl; supervisor module scaffold (ORC-01) *(complete 2026-05-08)*

**Wave 2** *(blocked on Wave 1 — parallel execution within wave)*:
- [x] 02-02-PLAN.md — SharedContextStore (ORC-04) + GitOpQueue (ORC-07); tempfile dev-dep added *(complete 2026-05-08)*
- [x] 02-03-PLAN.md — WorktreeManager: add/list/remove/prune via git CLI (ORC-05) *(complete 2026-05-08)*

**Wave 3** *(blocked on Wave 2)*:
- [x] 02-04-PLAN.md — AgentHandle (subscribe/stop/pause) + AgentSupervisor registry (ORC-02, ORC-03) *(complete 2026-05-08)*

**Wave 4** *(blocked on Wave 3)*:
- [x] 02-05-PLAN.md — SubAgentSpawner extended: --working-dir + NDJSON stdout streaming (ORC-06) *(complete 2026-05-08)*

**Wave 5** *(blocked on Wave 4)*:
- [x] 02-06-PLAN.md — ORC integration tests + spawn_blocking load test with MockApiClient (ORC-01 through ORC-07) *(complete 2026-05-08)*

Cross-cutting constraints: All new code lives in `runtime/src/supervisor/`; `AgentSupervisor` must be `Send + Sync` (Phase 3 Tauri managed state); `run_turn()` always in `tokio::task::spawn_blocking` (D-10 invariant enforced by ORC-03 load test with `max_blocking_threads(16)`).

### Phase 3: Tauri Shell
**Goal**: A Tauri 2.x desktop app launches and can drive the Rust orchestrator end-to-end through typed IPC, with permission prompts surfacing as UI events.
**Depends on**: Phase 2
**Requirements**: TAU-01, TAU-02, TAU-03, TAU-04, TAU-05
**Success Criteria** (what must be TRUE):
  1. The Tauri app launches a window on Windows and a smoke-test `invoke()` command from the frontend returns a value from the Rust backend.
  2. Agent lifecycle commands (spawn/list/stop) issued from the frontend reach `AgentSupervisor` held as Tauri managed state and return without blocking the WebView.
  3. A tool-call permission request originating in the Rust runtime surfaces in the frontend as a typed `AgentEvent` via `TauriPermissionPrompter`, and the user's response flows back to unblock the agent.
  4. `specta` + `tauri-specta` regenerate TypeScript definitions for every `AgentEvent`, `AgentState`, and command on build, and the frontend imports them without hand-written types.
  5. `window-state`, `clipboard-manager`, and `fs` plugins are installed and capability-granted, and a smoke test exercises each from the frontend.
**Plans**: 5 plans

Plans:
**Wave 1:**
- [x] 03-01-PLAN.md — MSVC toolchain switch + tauri-app scaffold + runtime path dep (TAU-01 partial) *(complete 2026-05-08)*

**Wave 2** *(blocked on Wave 1)*:
- [x] 03-02-PLAN.md — specta::Type derives on runtime types + AlwaysAllow + minimal lib.rs + bindings.ts generation (TAU-01, TAU-04) *(complete 2026-05-08)*

**Wave 3** *(blocked on Wave 2)*:
- [x] 03-03-PLAN.md — AgentSupervisor managed state + lifecycle commands + event relay with Lagged handling (TAU-02) *(complete 2026-05-09)*

**Wave 4** *(blocked on Wave 3)*:
- [x] 03-04-PLAN.md — TauriPermissionPrompter + respond_to_permission + PendingPrompts managed state (TAU-03) *(complete 2026-05-09)*

**Wave 5** *(blocked on Wave 4)*:
- [x] 03-05-PLAN.md — Plugins registered + capability grants + final tsc check + human smoke test checkpoint (TAU-04, TAU-05) *(complete 2026-05-09)*

Cross-cutting constraints: tauri-app/src-tauri/ is a separate Cargo workspace from rust/ (D-04); specta pinned at "=2.0.0-rc.25" in both Cargo.toml files; TauriPermissionPrompter lives in tauri-app/src-tauri/src/ only — runtime crate must not import tauri.

### Phase 4: Chat UI
**Goal**: A user can run a complete streamed chat session in the Tauri app with every table-stakes coding-assistant feature working.
**Depends on**: Phase 3
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, UI-08, UI-09, UI-10, UI-11
**Success Criteria** (what must be TRUE):
  1. User sees AI responses stream token-by-token without UI jank at 60–100 events/sec, with markdown, syntax-highlighted code blocks, and copy buttons rendering correctly.
  2. User sees tool-call blocks (bash, file ops, grep, glob) as collapsible cards with truncated bash output and inline before/after diffs for file edits.
  3. User can browse, resume, or delete saved sessions from a sidebar, and a 200+ turn session scrolls smoothly via virtualization.
  4. User can switch model per session, see per-turn and session-total token/dollar cost, cancel an in-flight turn while preserving partial output, and approve/deny/always-allow permission prompts as inline cards.
  5. User can open a slash-command palette with `/`, see described commands, and execute them inline in the chat input.
**Plans**: 7 plans

Plans:
**Wave 1:**
- [x] 04-01-PLAN.md — Bootstrap: TextDelta Rust variant, bindings.ts patch, npm install, shadcn init, Tailwind v4, vitest, run_agent_turn + session commands, CR fixes (UI-01, UI-06, UI-08) *(complete 2026-05-10)*

**Wave 2** *(parallel — no file overlap between 04-02 and 04-03)*:
- [x] 04-02-PLAN.md — Zustand stores (chatStore, sessionStore) + utility libs (diff.ts, cost.ts) with unit tests (UI-01, UI-04, UI-09) *(complete 2026-05-10)*
- [x] 04-03-PLAN.md — App shell layout + SessionSidebar + ChatPane skeleton + MessageInput + slash palette (UI-06, UI-08, UI-10, UI-11) *(complete 2026-05-10)*

**Wave 3** *(sequential — Message.tsx overlap between 04-04 and 04-05)*:
- [x] 04-04-PLAN.md — MessageList (virtualized) + Message + MarkdownRenderer + streaming cursor (UI-01, UI-02, UI-05, UI-09) *(complete 2026-05-10)*
- [x] 04-05-PLAN.md — ToolBlock + DiffView + PermissionCard + Message.tsx updates (UI-03, UI-04, UI-07) *(complete 2026-05-10)*

**Wave 4** *(blocked on Wave 3)*:
- [x] 04-06-PLAN.md — useAgentEvents hook: rAF buffer, tool calls, permission events, session auto-save; mount in ChatPane (UI-01 through UI-11) *(complete 2026-05-10)*

**Wave 5** *(blocked on Wave 4)*:
- [x] 04-07-PLAN.md — Human smoke test checkpoint: verify all 5 success criteria in live Tauri window (UI-01 through UI-11) *(complete 2026-05-10)*

Cross-cutting constraints: bindings.ts is manually maintained (D-13); run_agent_turn uses stub echo in Wave 1 — full ConversationRuntime wiring is a Wave 4 TODO; all frontend state via Zustand; rAF buffer is mandatory for TextDelta (D-02); virtualizer requires #root height:100%.

### Phase 5: Agent Dashboard
**Goal**: A user can spawn, monitor, budget, and be notified about multiple concurrent agents from a live dashboard inside the Tauri app.
**Depends on**: Phase 4 (and Phase 2 supervisor)
**Requirements**: AGT-01, AGT-02, AGT-03, AGT-04, AGT-05, AGT-06
**Success Criteria** (what must be TRUE):
  1. User can spawn 2+ agents from a dialog (model + task + worktree) and see each appear in a roster panel with status badge, task description, and cumulative cost.
  2. User can expand any agent to watch its live conversation and tool activity stream independently of the others.
  3. User can launch an agent in background mode and receive an OS-level notification when it completes.
  4. User can assign a different model per agent so that the orchestrator and workers run on different providers in the same session.
  5. User can set a per-agent dollar budget, and the agent halts and reports its status the moment that budget is exceeded.
**Plans**: TBD
**UI hint**: yes

### Phase 6: Parallel Worktrees + Team Orchestration
**Goal**: A user can compose role-based agent teams or swarms running in parallel on separate worktrees, with file-conflict protection and reviewable merge checkpoints.
**Depends on**: Phase 5 (and Phase 2 worktree + git queue)
**Requirements**: WRK-01, WRK-02, WRK-03, WRK-04, WRK-05
**Success Criteria** (what must be TRUE):
  1. User can run 2+ agents concurrently on parallel git worktrees without index corruption or file-write conflicts, and the worktree panel shows which agent owns which branch with live activity indicators.
  2. User can compose and launch a role-based team (Planner, Coder, Reviewer, Tester) with per-role model and task description from the UI.
  3. User can configure a swarm strategy (agent count, shared objective, result aggregation method) and execute it from the UI.
  4. When two agents attempt to write the same file, the file-ownership protocol prevents corruption and surfaces the conflict in the UI.
  5. When parallel agents complete, a merge checkpoint UI lets the user review per-worktree changes and approve the merge.
**Plans**: TBD
**UI hint**: yes

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. CLI Completion | 4/4 | Complete | 2026-05-08 |
| 2. Orchestration Layer | 6/6 | Complete | 2026-05-08 |
| 3. Tauri Shell | 5/5 | Complete | 2026-05-09 |
| 4. Chat UI | 0/7 | In progress | — |
| 5. Agent Dashboard | 0/0 | Not started | — |
| 6. Parallel Worktrees + Team Orchestration | 0/0 | Not started | — |

---

## Coverage

- **v1 requirements:** 40
- **Mapped:** 40 / 40
- **Orphans:** 0
- **Duplicates:** 0

| Phase | Requirement IDs | Count |
|-------|-----------------|-------|
| 1 | CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, CLI-06 | 6 |
| 2 | ORC-01, ORC-02, ORC-03, ORC-04, ORC-05, ORC-06, ORC-07 | 7 |
| 3 | TAU-01, TAU-02, TAU-03, TAU-04, TAU-05 | 5 |
| 4 | UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, UI-08, UI-09, UI-10, UI-11 | 11 |
| 5 | AGT-01, AGT-02, AGT-03, AGT-04, AGT-05, AGT-06 | 6 |
| 6 | WRK-01, WRK-02, WRK-03, WRK-04, WRK-05 | 5 |

---
*Roadmap created: 2026-05-07*
*Last updated: 2026-05-10 — Phase 4 planned (7 plans across 5 waves)*
