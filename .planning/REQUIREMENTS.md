# Requirements: xolotl

**Defined:** 2026-05-07
**Core Value:** A developer can spawn, monitor, and coordinate multiple AI agents working in parallel on a single project — from a chat-first desktop app — without being locked into OpenAI or Anthropic.

## v1 Requirements

### CLI Completion

- [ ] **CLI-01**: User can approve or deny tool calls interactively in the REPL (y/n/a/d with "always allow" per tool)
- [ ] **CLI-02**: User can run `/help`, `/clear`, `/model <name>`, `/cost`, `/save`, `/load <id>` slash commands in the REPL
- [ ] **CLI-03**: User sees dollar cost and token count after each turn and as a session total
- [ ] **CLI-04**: User can resume a previous session via `--resume <session-id>` flag
- [ ] **CLI-05**: Kimi K2 and MiniMax M1 tool-call schemas are validated against real endpoints and edge cases fixed (no silent text-only fallback)
- [ ] **CLI-06**: Agent loop refuses to run a new turn when cost budget is exceeded (`UsageTracker::budget_exceeded()`)

### Orchestration Layer

- [ ] **ORC-01**: Agent state machine with typed states (Idle, Planning, Executing, Waiting, Done, Failed) and `AgentEvent` enum
- [ ] **ORC-02**: `AgentSupervisor` registry holds all running agents; `AgentHandle` provides typed control per agent
- [ ] **ORC-03**: Each agent's conversation loop runs inside `tokio::task::spawn_blocking` — synchronous `run_turn()` never touches the tokio thread pool directly
- [ ] **ORC-04**: `SharedContextStore` allows agents to publish and pull text snapshots (500–1000 tokens max) without sharing mutable session objects
- [ ] **ORC-05**: `WorktreeManager` can create, list, and delete git worktrees via shell commands; each agent is assigned exactly one worktree
- [ ] **ORC-06**: `SubAgentSpawner` extended with `--working-dir` flag, NDJSON event streaming via stdout, and `AgentSupervisor` registration — existing CLI behavior preserved
- [ ] **ORC-07**: Git operation queue serializes git writes per-repo to prevent `index.lock` conflicts between parallel agents

### Tauri Shell

- [ ] **TAU-01**: `src-tauri` crate scaffolded with Tauri 2.x capability config; `core:default` grant established; `invoke()` verified working
- [ ] **TAU-02**: `AgentSupervisor` held as Tauri managed state; Tauri command layer exposes agent lifecycle operations to frontend
- [ ] **TAU-03**: `TauriPermissionPrompter` replaces REPL stdin prompter; permission requests surface as UI events to the frontend
- [ ] **TAU-04**: `specta` + `tauri-specta` type generation pipeline produces TypeScript types from all Rust `AgentEvent`, `AgentState`, and command types
- [ ] **TAU-05**: Core plugins installed and capability-granted: `window-state`, `clipboard-manager`, `fs`

### Chat UI

- [ ] **UI-01**: User sees AI responses streaming token-by-token; tokens buffered per `requestAnimationFrame` to avoid render storm at 60–100 events/sec
- [ ] **UI-02**: Code blocks render with syntax highlighting and a copy-to-clipboard button
- [ ] **UI-03**: Tool call blocks (bash, file read, glob, grep, write, edit) are collapsible; bash output is truncated with "show more"
- [ ] **UI-04**: File edits display an inline diff (before/after) inside the tool block
- [ ] **UI-05**: Message list is virtualized via `@tanstack/react-virtual`; sessions with 200+ turns remain performant
- [ ] **UI-06**: Session sidebar lists all saved sessions; user can resume or delete sessions
- [ ] **UI-07**: Permission prompt renders as an inline card in the chat thread; user approves, denies, or "always allows" per tool
- [ ] **UI-08**: Model selector lets user switch model per session from all configured providers
- [ ] **UI-09**: Token count and estimated dollar cost display per turn and as a running session total
- [ ] **UI-10**: User can cancel the current agent turn via a stop button; streaming halts and partial output is preserved
- [ ] **UI-11**: Slash command palette opens with `/`; shows available commands with descriptions; executes on enter

### Agent Dashboard

- [ ] **AGT-01**: Agent roster panel shows all running and completed agents with status badge, task description, and cumulative cost
- [ ] **AGT-02**: Each agent has an expandable streaming output panel showing its live conversation and tool activity
- [ ] **AGT-03**: User can spawn a new agent via a dialog: choose model, enter task, assign worktree
- [ ] **AGT-04**: User can launch a background agent; receives an OS-level notification when the agent completes
- [ ] **AGT-05**: Each agent has its own model selector; orchestrator and workers can use different models
- [ ] **AGT-06**: User can set a cost budget per agent; agent stops when budget is reached and reports status

### Parallel Worktrees + Team Orchestration

- [ ] **WRK-01**: Worktree panel shows which agent is running on which git branch with per-worktree activity indicators
- [ ] **WRK-02**: User can compose a role-based agent team (Planner, Coder, Reviewer, Tester) with per-role model selection and task description
- [ ] **WRK-03**: User can configure a swarm strategy: number of agents, shared objective, result aggregation method
- [ ] **WRK-04**: File ownership protocol prevents two agents from writing the same file simultaneously; conflict is surfaced in the UI
- [ ] **WRK-05**: Merge checkpoint UI appears when parallel agents are ready to merge their worktrees; user reviews and approves

## v2 Requirements

### Remote and Extended Execution

- **REM-01**: User can execute agents on a remote machine via SSH
- **REM-02**: User can configure agent persistence across machine restarts
- **REM-03**: Agent can send push notifications to mobile via webhook

### Local Model Support

- **LOC-01**: User can connect to a local Ollama instance for Llama/Qwen models
- **LOC-02**: Model capability flags (context window, tool support) displayed per model

### Skills System

- **SKL-01**: User can load a skill (markdown file) into a session via `/skill <name>`
- **SKL-02**: Skills stored in `~/.xolotl-code/skills/` and `.xolotl-code/skills/`

### Advanced Session Management

- **SES-01**: Sessions can be tagged and searched by tag
- **SES-02**: Session export to markdown or JSON

## Out of Scope

| Feature | Reason |
|---------|--------|
| Python rewrite of agent core | Rust is ~70% done and the hard parts are proven; duplication with no gain |
| Browser-based web app | Desktop-native only via Tauri; browser adds no value for local agents |
| IDE plugin (VS Code, JetBrains) | Separate product; agents-do-the-editing model makes this redundant |
| Voice interface | Not a coding tool priority |
| Tab autocomplete / inline completions | Cursor already does this; xolotl is agent-first not autocomplete-first |
| Inline editor (edit files directly in xolotl UI) | Anti-feature — pulls toward Cursor where Cursor wins; agents do the editing |
| Codebase embedding / semantic search | High complexity; agent file-reading tools are sufficient for v1 |
| Built-in terminal emulator (xterm.js) | 300 KB overhead for a feature the agent replaces; ANSI stripping is sufficient |

## Traceability

Populated by roadmapper.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CLI-01 | — | Pending |
| CLI-02 | — | Pending |
| CLI-03 | — | Pending |
| CLI-04 | — | Pending |
| CLI-05 | — | Pending |
| CLI-06 | — | Pending |
| ORC-01 | — | Pending |
| ORC-02 | — | Pending |
| ORC-03 | — | Pending |
| ORC-04 | — | Pending |
| ORC-05 | — | Pending |
| ORC-06 | — | Pending |
| ORC-07 | — | Pending |
| TAU-01 | — | Pending |
| TAU-02 | — | Pending |
| TAU-03 | — | Pending |
| TAU-04 | — | Pending |
| TAU-05 | — | Pending |
| UI-01 | — | Pending |
| UI-02 | — | Pending |
| UI-03 | — | Pending |
| UI-04 | — | Pending |
| UI-05 | — | Pending |
| UI-06 | — | Pending |
| UI-07 | — | Pending |
| UI-08 | — | Pending |
| UI-09 | — | Pending |
| UI-10 | — | Pending |
| UI-11 | — | Pending |
| AGT-01 | — | Pending |
| AGT-02 | — | Pending |
| AGT-03 | — | Pending |
| AGT-04 | — | Pending |
| AGT-05 | — | Pending |
| AGT-06 | — | Pending |
| WRK-01 | — | Pending |
| WRK-02 | — | Pending |
| WRK-03 | — | Pending |
| WRK-04 | — | Pending |
| WRK-05 | — | Pending |

**Coverage:**
- v1 requirements: 40 total
- Mapped to phases: 0 (pending roadmap)
- Unmapped: 40 ⚠️

---
*Requirements defined: 2026-05-07*
*Last updated: 2026-05-07 after initial definition*
