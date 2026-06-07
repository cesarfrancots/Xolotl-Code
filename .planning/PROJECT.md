# xolotl

## What This Is

xolotl is a personal AI development ecosystem — a Tauri desktop app plus a CLI — built for multi-agent orchestration and best-in-class open model support. The core bet: a chat-first UI with an agent swarm layer underneath, where an intelligent orchestrator coordinates cheaper specialized agents across parallel worktrees, role-based teams, and background tasks. Purpose-built for Kimi K2, MiniMax M1, and Anthropic models equally.

## Core Value

A developer can spawn, monitor, and coordinate multiple AI agents working in parallel on a single project — from a chat-first desktop app — without being locked into OpenAI or Anthropic.

## Current Milestone: v2.1 Living World & Economy

**Goal:** Turn the multi-civ simulation into a fully playable, understandable, and enjoyable axolotl civilization game — an infinite procedural world rich with content, a deep resource→currency→shop economy, true human takeover of a civ, NPCs, and a game-native UI — where every human-play feature also deepens agentic playability.

**Target features:**
- **Infinite procedural world** — replace the fixed world with procedurally-generated, explorable/expandable terrain (fBm terrain, caves, prospecting, terraform/place — the deferred W10.3–W10.7), seeded with more buildings, mineable items, and resources throughout.
- **Items & gathering** — tools/items for mining, digging, harvesting, and growing more & better vegetation/resources; a richer resource taxonomy.
- **Economy & currency** — civs and axolotls gather resources and sell them at fixed prices for currency; **at least 5 distinct currencies** with different uses (shells + others, ocean/pond-themed); researched acquisition rates and sinks so the economy is balanced and fun.
- **Shop / store with full UI** — buy buffs, resources, buildings, items, and more; a game-native store UI primarily for human takeovers; catalog + prices grounded in economy research.
- **True human takeover (Game B)** — possessing a civ makes it fully player-controlled and bypasses the LLM; richer human-play controls that also expand the agentic control surface.
- **NPCs** — interactable non-civ characters (traders / quest-givers / fauna handlers) the world and players engage with.
- **Asset generation (Gemini)** — generate game images/sprites/resource art via the Gemini image API (`GEMINI_API_KEY`) rather than placeholder art.
- **Game-native UI refinement** — the Civ UI should read as a game, not as part of the harness app; restyle to fit.

**Guiding constraints (carry into every phase):**
- Every human-play feature should also benefit agentic playability — keep the arena bridge (`render_game_to_text()`, `civPilotControls`, `codex-play-civ.mjs`) extended, never broken.
- Keep the engine deterministic/seeded; backend untestable on Windows (WebView2) → verify via `cargo check`/`clippy`/`test --no-run` + frontend `tsc`/vitest.
- Single-player mechanics are duplicated in `civilization.rs` and `tauriBrowserFallback.ts` — keep in lockstep where touched.
- v2.0 live UAT is still pending (providers + WebView2) — see MILESTONES.md.

**Spec-of-record:** extends `civ-multi-civ-world-plan.md` (W10.3–W10.7 procedural world) plus new economy / shop / possession / NPC / asset workstreams defined in v2.1 `REQUIREMENTS.md`.

## Requirements

### Validated

These capabilities are already implemented in the Rust codebase (`rust/` folder):

- ✓ Streaming Anthropic API client with SSE parser — existing (`rust/crates/api/`)
- ✓ Full agentic conversation loop with parallel tool dispatch — existing (`runtime/src/conversation.rs`)
- ✓ Session save/load (JSON) + auto-compaction — existing (`runtime/src/session.rs`, `compact.rs`)
- ✓ File ops: read/write/edit/glob/grep — existing (`runtime/src/file_ops.rs`)
- ✓ Bash execution with timeout + background process tracking — existing (`runtime/src/bash.rs`)
- ✓ Permission system (Allow/Deny/Prompt per tool) — existing (`runtime/src/permissions.rs`)
- ✓ Interactive REPL with multi-line input + markdown rendering — existing (`rusty-claude-cli/`)
- ✓ Token usage tracking + per-model pricing — existing (`runtime/src/usage.rs`)
- ✓ Three-tier config file loading — existing (`runtime/src/config.rs`)
- ✓ OpenAI-compatible client (Kimi, MiniMax, GLM, Qwen, OpenAI, Generic) — existing (`rusty-claude-cli/src/openai.rs`)
- ✓ AWS Bedrock client with SigV4 auth — existing (`rusty-claude-cli/src/bedrock.rs`)
- ✓ MCP stdio client (JSON-RPC 2.0, tool discovery) — existing (`rusty-claude-cli/src/mcp.rs`)
- ✓ Hooks system (PreTool, PostTool, ToolError, PostTurn) — existing (`runtime/src/hooks.rs`)
- ✓ Sub-agent spawning via child process — existing (`runtime/src/subagent/`)
- ✓ CLAUDE.md discovery and system prompt injection — existing (`runtime/src/prompt.rs`)
- ✓ SDD (Spec-Driven Development) state machine — existing (`runtime/src/sdd/`)
- ✓ Web fetch + web search tools — existing (`runtime/src/web_fetch.rs`)

### Validated in Phase 1: CLI Completion *(2026-05-08)*

- ✓ Permission prompt: 120-char preview, `[y] Allow  [n] Deny  [a] Always allow` choices — `main.rs:ReplPermissionPrompter`
- ✓ `/help`, `/clear`, `/model`, `/cost`, `/save`, `/load` slash commands — `run_repl_loop()`
- ✓ Per-turn + session cost footer: `in: X | out: Y | $Z.ZZZZ  [session: $N.NNNN]` — `format_cost_footer()`
- ✓ `--budget <dollars>` startup flag with D-10 budget-exceeded error — `parse_args()` + `LiveCli::set_budget()`
- ✓ `--resume <id>` opens interactive REPL with loaded session — `run_repl_resumed()` + `run_repl_loop()`
- ✓ Kimi K2 and MiniMax M1 tool-call round-trips verified against live endpoints

### Validated in Phase 2: Orchestration Layer *(2026-05-08)*

- ✓ `AgentId` newtype + `AgentState` (6-variant state machine) + `AgentEvent` (5 variants, serde-safe) — `supervisor/agent_state.rs`
- ✓ `AgentHandle` dual-channel design: mpsc inbound + broadcast outbound, `paused: Arc<AtomicBool>` — `supervisor/handle.rs`
- ✓ `AgentSupervisor` registry: `spawn_agent()` / `list()` / `stop_agent()` / `stop_all()` — `supervisor/supervisor.rs`
- ✓ `SharedContextStore` (Arc<RwLock<HashMap>>, 1000-token TooLarge limit, no silent truncation) — `supervisor/context_store.rs`
- ✓ `GitOpQueue` (serialized git writes via tokio mpsc + spawn_blocking) — `supervisor/git_queue.rs`
- ✓ `WorktreeManager` (add/remove/list/prune at `.xolotl-worktrees/`, per-element args, Windows-safe) — `supervisor/worktree.rs`
- ✓ `SubAgentConfig` extended with `working_dir` + `ndjson_stdout` + `spawn_ndjson_reader()` — `subagent/spawner.rs`
- ✓ 151 runtime tests green; ORC-03 bounded-runtime load test (8 agents, max_blocking_threads=16) passes

### Validated in Phase 3: Tauri Shell *(2026-05-09)*

- ✓ Tauri 2.x app scaffolded with MSVC toolchain; `smoke_test` invoke() returns `"smoke_test_ok"` — `tauri-app/src-tauri/`
- ✓ `AgentSupervisor` as Tauri managed state; `spawn_agent`/`list_agents`/`stop_agent` IPC commands — `lib.rs`, `commands.rs`
- ✓ `TauriPermissionPrompter` with `std::sync::mpsc` + 60s `recv_timeout`; `respond_to_permission` round-trip — `permission_prompter.rs`
- ✓ `specta` + `tauri-specta` type generation to `bindings.ts`; `tsc --noEmit` passes — `bindings.ts`
- ✓ `window-state`, `clipboard-manager`, `fs` plugins registered + capability-granted; all smoke-tested in live window — `lib.rs`, `capabilities/default.json`

### Validated in v1.0: Chat UI, Dashboard & Teams *(Phases 4-6, 2026-05-11)*

- ✓ Tauri shell wrapping the Rust core via IPC — v1.0
- ✓ Chat-first UI: message thread, streaming responses, tool-use display, inline diffs — v1.0
- ✓ Agent spawning from UI (model/task selection) + live agent status panel — v1.0
- ✓ Parallel worktree support (agents on separate git branches, per-worktree activity) — v1.0
- ✓ Role-based agent teams (Planner/Coder/Reviewer/Tester) + shared-context collaboration — v1.0
- ✓ Background agents, per-agent model selector, orchestration/team config — v1.0

### Validated in v2.0: Civ Simulation *(Phases 1-5, 2026-06-07)*

- ✓ Multi-model world creation (1-3 AI-model civs, per-civ color/controller) + live leaderboard — CIV-01/02/03
- ✓ Harness arena: full text state via `render_game_to_text()` + `civPilotControls` drive on a shared scoreboard — ARENA-01/02/03
- ✓ Renderer multi-civ identity (per-civ color tints) + multi-colony / focus-a-civ camera — REN-01/02
- ✓ Environment engine: seasons drift temperature, disasters reshape terrain, renewable-only regrowth — ENV-01/02/03
- ✓ Combat, raids, territory ownership, diplomacy/trades, wild predators (all deterministic/seeded) — WAR-01/02/03/04
- ✓ Expanded visible Mendelian genetics + environmental selection with measurable evolution — GEN-01/02

*(Implemented + automated-verified; live human UAT of the running sim still pending — see MILESTONES.md verification status.)*

### Active

Defined per milestone — current milestone requirements live in `.planning/REQUIREMENTS.md` (see **Current Milestone** above).

### Out of Scope

- Python rewrite of the agent core — Rust is the implementation, Python stubs are reference only
- Browser-based web app (no local daemon) — desktop-native via Tauri only
- Remote/SSH agent execution — future milestone after local multi-agent is solid
- IDE plugin (VS Code extension, JetBrains) — too much scope divergence from the core product
- Voice interface — not a coding tool priority

## Context

The Rust codebase (`rust/crates/`) is production-ready as a headless CLI agent with a full orchestration layer (Phases 1–3 complete). The Tauri 2.x shell is live on Windows with a fully typed IPC surface: agent lifecycle commands, permission round-trip, and plugin bundle all smoke-tested in a running window. Phase 4 builds the chat UI on top of this foundation.

**Last updated:** 2026-05-09

The Tauri layer needs to be added on top — the Rust core becomes the backend, and a React/Svelte frontend communicates via Tauri's command/event IPC. This is the same architecture used by Codex (Electron) and OpenCode (Tauri-like).

The multi-agent system needs a protocol layer: agents need to communicate task state, share context snapshots, and be coordinated by an orchestrator agent that routes work. The existing `subagent/` spawner is a child-process model — the team collaboration model requires an in-process coordination layer or a message-passing bus.

**Current build issue (Windows):** Git's `link.exe` shadows MSVC linker. Fix: install WinLibs + set `rustup override set stable-x86_64-pc-windows-gnu` in `rust/`.

## Constraints

- **Platform**: Windows 11 primary target for development; Tauri should build for Windows/Mac/Linux
- **Personal use**: Not publishing or monetizing — decisions optimize for capability over safety margins
- **Rust core**: No rewriting the agent loop or API client — extend only
- **Open models**: Kimi K2 and MiniMax M1 must work as first-class citizens, not afterthoughts
- **Cost**: Orchestrator uses smart model (Sonnet/Opus), worker agents use cheap models (Haiku/Kimi)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Rust as primary implementation, not Python | Already ~70% done; streaming, SSE, and agentic loop are proven | ✓ Good |
| Tauri for desktop app (not Electron) | Leverages existing Rust backend directly via `#[tauri::command]`; lighter than Electron | — Pending |
| CLI and desktop app coexist | Matches opencode/Codex pattern; CLI stays for scripting and headless use | — Pending |
| Chat-first UI (not IDE-lite) | Orchestration view > editing view; agents do the editing | — Pending |
| Both combined moat: multi-agent + open models | Neither Cursor nor Codex handles both well; the combo is differentiated | — Pending |
| Child-process sub-agents for isolation | Existing `subagent/spawner.rs` — safe, isolated, simple. Shared-context teams need additional in-process layer | — Pending |
| Civ sim doubles as a harness eval/arena (v2.0) | One artifact is both a watchable game and a harness scoreboard; arena interface kept strictly additive | ✓ Good |
| Deterministic, seeded sim engine — combat/env/genetics (v2.0) | Reproducible runs + unit-testable on Windows via `cargo test --no-run` despite WebView2 blocking live backend tests | ✓ Good |
| v2.0 reset phase numbering (Civ sim = Phases 1-5) | Each milestone's phases stay self-contained; prior milestone archived to `milestones/` | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-07 after v2.0 Civ Simulation milestone (code-complete; live UAT pending)*
