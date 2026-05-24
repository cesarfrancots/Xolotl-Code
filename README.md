# Xolotl Code

A desktop coding agent platform for evaluating, comparing, and racing LLMs on real engineering work. Ships as a Tauri desktop app plus a Rust CLI that share the same provider config and model routing.

The desktop app is the primary surface. It gives you:

- A conversational chat pane with streaming responses and separate chain-of-thought.
- An agent panel that spawns sub-agents in isolated git worktrees, individually or as a team/swarm with a merge checkpoint.
- An eval lab that races N models on the same prompt or whole suites, with auto-grading, blind human scoring, and an LLM-judge.
- A **Goal Eval** mode that scores how a model *reasons* toward a goal — not just the final answer — with a live supervisor that flags issues as the model thinks.
- Settings for provider API keys, Claude-Code-compatible skills, and MCP servers (local + project-scoped).

The Rust CLI (`xolotl`) is the same engine without the UI: multi-provider routing, slash commands, sessions, planning, tools, memory.

## Install

### Desktop app (recommended)

Prerequisites: Node.js 20+, Rust toolchain, and the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS (WebView2 on Windows, WebKitGTK on Linux, none on macOS).

```bash
cd tauri-app
npm install
npm run tauri dev      # development with hot-reload
npm run tauri build    # production binary in src-tauri/target/release
```

On first launch click the gear icon in the left sidebar to set API keys, or export the matching env var (`ANTHROPIC_API_KEY`, `KIMI_API_KEY`, `KIMI_CODING_API_KEY`, `MINIMAX_API_KEY`, `DEEPSEEK_API_KEY`, etc.). The app reads from the same `~/.xolotl-code/config.json` that the CLI uses, so keys configured in either tool are picked up by both.

### CLI

```bash
cd rust
cargo install --path crates/rusty-claude-cli --force
xolotl --version
```

## Goal Eval

Goal Eval is the distinctive eval mode. Instead of judging just the final answer, it grades the *reasoning process* a model uses to reach a goal.

1. Open the **Eval** tab in the desktop app and switch to **Goal Eval**.
2. Type a goal — e.g. *"Refactor src/auth/middleware.ts to use jose instead of jsonwebtoken, preserving the public API."*
3. Pick models to race. Toggle **Live reasoning supervisor** to flag issues as the model thinks (uses a small judge model on each ~1200-char window of reasoning; adds ~2× cost).
4. Hit **Run Goal Eval**. Each model streams its chain-of-thought into a per-card reasoning trace with inline flag highlights.
5. After the run, click **Grade Goal** for a 5-axis scorecard:

| Axis | What it measures |
| --- | --- |
| Goal Decomposition | Does the model break the goal into the right sub-tasks? |
| Assumption Quality | Are assumptions explicit and reasonable? |
| Self-Correction | Does it catch and fix its own mistakes mid-trace? |
| Plan ↔ Action | Do the actions match the stated plan? |
| Goal Achievement | Was the goal actually reached? |

Each axis is scored 1–5 with a verbatim evidence quote from the trace. Supervisor flags are categorised (`bad_assumption`, `goal_drift`, `premature_commit`, `no_verification`, `contradiction`, `good_decomposition`, `good_self_correction`) and rendered as colour-coded highlights anchored to the original reasoning text.

The supervisor is opt-in. The post-hoc grader works on any completed eval — single prompt, suite, or goal — that has a reasoning trace.

## Standard Eval (Race + Judge + HIL)

Beside Goal Eval, the lab also supports:

- **Single Prompt**: one prompt, N models in parallel, live race-track with tok/s, cost, and tokens.
- **Eval Suite**: pre-defined prompt sets graded by per-prompt rules (`ai_slop`, `brevity`, `json_mode`, `code`, `refusal`).
- **LLM-as-judge**: anonymises responses as A/B/C, asks a judge model to score them on an 8-axis rubric (accuracy, helpfulness, quality, creativity, design, aesthetics, anti-slop, brevity).
- **Blind human scoring**: hide model names so you can rate without bias; sliders write back to the saved eval.
- **Leaderboard**: composite score blending quality, cost, and speed with adjustable weights.

All runs are persisted to `~/.xolotl-code/evals/<id>.json` and reloadable from the History sidebar.

## Agents & Teams

The right sidebar of the desktop app spawns sub-agents that work in isolated git worktrees so their changes can be reviewed and merged on your terms.

- **Spawn agent** (+): a single agent with task, model, and optional budget cap.
- **Launch team** (people icon): multi-agent swarm with named roles and tasks; a merge checkpoint view opens when all members finish.

Per-agent state is persisted; the agent panel survives app restarts.

## Skills & MCP

The Settings dialog has tabs for:

- **Skills**: Claude-Code-compatible markdown skills discovered from `~/.xolotl-code/skills/<name>/SKILL.md`. Toggle them on to advertise them to the model on every chat turn.
- **MCP servers**: discovered from `~/.xolotl-code/mcp.json` (user) and `.mcp.json` (project). The dialog reachability-tests each server with latency reporting.

## CLI Quick Start

```bash
xolotl                                # interactive REPL
xolotl -y                             # auto-approve tool calls
xolotl prompt "summarize the runtime crate"
xolotl setup                          # configure API keys
```

Inside the REPL, `/connect <provider>` saves a key. Supported providers: `kimi-coding`, `kimi`, `minimax`, `deepseek`, `glm`, `qwen`, `anthropic`, `bedrock`, `openai`.

## Provider Setup

| Variable | Provider |
| --- | --- |
| `KIMI_CODING_API_KEY` | Kimi K2.6 Coding |
| `KIMI_API_KEY` | Moonshot/Kimi |
| `MINIMAX_API_KEY` | MiniMax |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `GLM_API_KEY` | Zhipu GLM |
| `DASHSCOPE_API_KEY` | Alibaba Qwen |
| `ANTHROPIC_API_KEY` | Anthropic direct |
| `BEDROCK_API_KEY` | AWS Bedrock |
| `OPENAI_API_KEY` | OpenAI or compatible fallback |

Base URLs are overridable via `*_BASE_URL` variants.

## Model Aliases

| Alias | Provider | Notes |
| --- | --- | --- |
| `kimi-coding` | Kimi Coding | Coding-tuned, 256K context, exposes `reasoning_content`, prompt cache enabled |
| `kimi2.6` | Moonshot/Kimi | General Kimi route |
| `minimax2.7` | MiniMax | 1M context for broad reads |
| `deepseek`, `deepseek-v4-pro` | DeepSeek | DeepSeek V4 Pro, 1M context, thinking mode |
| `deepseek-flash`, `deepseek-v4-flash` | DeepSeek | DeepSeek V4 Flash, 1M context, lower cost |
| `glm5.1` | Zhipu GLM | 128K context |
| `qwen3.6` | Alibaba Qwen | Qwen compatible route |
| `claude-sonnet-4-6`, `sonnet` | Anthropic / Bedrock | Claude Sonnet |
| `claude-opus-4-7`, `opus` | Anthropic / Bedrock | Claude Opus |
| `claude-haiku-4-5-20251001`, `haiku` | Anthropic / Bedrock | Fast Haiku, cheap default judge |
| `bedrock-nova-pro`, `bedrock-nova-lite`, `bedrock-llama-3.3-70b` | AWS Bedrock | Non-Claude Bedrock options |

Dual-model planner+executor in the CLI:

```text
/model opus+sonnet
/model opus+kimi-coding
```

## REPL Commands

```text
/help                  Show commands
/status                Session, model, usage, memory state
/cost                  Token + cache cost breakdown
/model <alias>         Switch models
/connect <provider>    Save provider API key
/plan <description>    Structured implementation plan
/ultra-plan <desc>     Deeper plan with risk + dependency tracking
/compact               Compact session context
/save                  Save the current session
/load <session>        Load a saved session
/rollback <n>          Roll back recent assistant turns
/diff                  Files touched during the session
/memory                Show memory status
/mcp                   Show connected MCP tools
/accept-all            Toggle tool-call auto-approval
/doctor                Check local configuration
/exit                  Quit
```

| Key | Action |
| --- | --- |
| ↑ / ↓ | Browse input history |
| Shift+Enter | Insert newline |
| Ctrl+T | Toggle thinking display |
| Ctrl+E | Cycle effort level |
| Ctrl+M | Quick model switch |
| Ctrl+S | Save session |
| Ctrl+R | Retry last prompt |
| Ctrl+C | Cancel input |

## Project Layout

```text
.
├── rust/                            # Rust workspace (engine + CLI)
│   └── crates/
│       ├── api/                     # Anthropic API types, client, SSE
│       ├── commands/                # Slash command handling
│       ├── compat-harness/          # External compatibility checks
│       ├── runtime/                 # Conversation loop, prompts, memory,
│       │                            #   tools, agent supervisor, events
│       │                            #   (TextDelta / ReasoningDelta / …)
│       ├── rusty-claude-cli/        # `xolotl` binary
│       └── tools/                   # Built-in tool specs + dispatch
├── tauri-app/                       # Desktop app (React + Tauri v2)
│   ├── src-tauri/                   # Rust side: commands, MCP, skills,
│   │                                #   eval runner, goal-grade judge
│   └── src/
│       ├── components/
│       │   ├── chat/                # Chat pane, message input, palette
│       │   ├── agent/               # Agent roster, spawn, team launcher
│       │   ├── eval/                # Eval lab + Goal Eval mode
│       │   ├── settings/            # Providers / Skills / MCP tabs
│       │   └── sidebar/             # Session sidebar
│       └── stores/                  # Zustand stores (chat, eval, agent, ui)
├── .planning/                       # Phase plans, UAT, state, decisions
└── assets/                          # Project images
```

## Configuration & Persistence

Everything lives under `~/.xolotl-code/`:

```text
~/.xolotl-code/
├── config.json                      # provider keys + defaults
├── sessions/<id>.json               # chat sessions
├── evals/<id>.json                  # eval runs + reasoning + grades
├── skills/<name>/SKILL.md           # user-defined skills
└── mcp.json                         # user-scoped MCP servers
```

Legacy `~/.claw-code/config.json` is migrated automatically on first run.

## Development

```bash
# Rust workspace
cd rust
cargo build --workspace
cargo test --workspace --exclude compat-harness
cargo fmt --all -- --check
cargo clippy --workspace --all-features --exclude compat-harness -- -D warnings

# Tauri app
cd tauri-app
npm install
npm run tauri dev
npx tsc --noEmit                     # type-check without building
```

The `rust/` workspace runs on CI (Linux + Windows + macOS, Rust 1.95.0): fmt, clippy with `-D warnings`, build, and tests excluding the compat harness. The Tauri TypeScript layer is checked locally; bindings regenerate from `#[specta::specta]` Rust commands on each debug build.

## Design Goals

- Make multi-model coding workflows first-class — Claude *and* the open-source coding models (Kimi, MiniMax, GLM, Qwen) on equal footing.
- Treat reasoning as a first-class artifact: surface it, persist it, judge it.
- Keep agentic tool loops reliable, testable, and recoverable in worktrees.
- Cache-friendly prompts and accurate token/cost accounting across providers.
- Don't waste context on large repositories.

## License

MIT
