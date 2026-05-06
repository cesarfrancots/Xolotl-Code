# Xolotl Code

Xolotl Code is a Rust-based, multi-provider coding agent harness for large codebases. It gives you one terminal workflow for model switching, tool use, planning, sub-agents, persistent sessions, memory, and provider setup across Claude, Kimi, MiniMax, GLM, Qwen, OpenAI-compatible APIs, and AWS Bedrock.

The current focus is practical agentic coding: read the codebase, plan when needed, use tools safely, run tests, preserve context, and keep token usage under control for long-running work.

## What It Does

- Multi-provider model routing with friendly aliases such as `kimi-coding`, `minimax2.7`, `glm5.1`, `qwen3.6`, `sonnet`, and `opus`.
- OpenAI-compatible provider support for Kimi Coding, Moonshot/Kimi, MiniMax, GLM, Qwen, OpenAI, and custom compatible endpoints.
- Bedrock and Anthropic clients for Claude-family models.
- Interactive REPL with slash commands, auto-save sessions, rollback, compaction, model switching, and provider setup.
- Built-in tools for file operations, shell commands, web fetch/search, todo management, image reads, git inspection, and sub-agent tasks.
- Model-aware behavior for large context windows, thinking budgets, aggressive read thresholds, prompt caching, and ultra-planning.
- Prompt cache accounting for compatible streaming providers so cache hits are visible in usage and cost summaries.
- Persistent memory hooks for session notes and project context.
- Graphify support for local code knowledge graphs in `graphify-out/`.

## Install

```bash
cd rust
cargo install --path crates/rusty-claude-cli --force
```

After install, `xolotl --version` should print the current CLI version.

## Quick Start

```bash
# Interactive coding session
xolotl

# Start with tool calls auto-approved
xolotl -y

# One-shot prompt
xolotl prompt "inspect the runtime crate and summarize the agent loop"

# Configure API keys interactively
xolotl setup
```

Configuration is stored in `~/.xolotl-code/config.json`. Existing `~/.claw-code/config.json` files are migrated automatically when possible.

## Provider Setup

Inside the REPL, use `/connect <provider>`:

```text
/connect kimi-coding
/connect kimi
/connect minimax
/connect glm
/connect qwen
/connect anthropic
/connect bedrock
/connect openai
```

Supported environment variables:

| Variable | Purpose |
| --- | --- |
| `KIMI_CODING_API_KEY` | Kimi K2.6 Coding endpoint |
| `KIMI_API_KEY` | Moonshot/Kimi endpoint |
| `MINIMAX_API_KEY` | MiniMax endpoint |
| `GLM_API_KEY` | Zhipu GLM endpoint |
| `DASHSCOPE_API_KEY` | Alibaba Qwen endpoint |
| `ANTHROPIC_API_KEY` | Anthropic direct API |
| `BEDROCK_API_KEY` | AWS Bedrock API key flow |
| `OPENAI_API_KEY` | OpenAI or compatible fallback |

Provider base URLs can be overridden with variables such as `KIMI_CODING_BASE_URL`, `MINIMAX_BASE_URL`, or `OPENAI_BASE_URL`.

## Model Aliases

| Alias | Provider | Notes |
| --- | --- | --- |
| `kimi-coding` | Kimi Coding | Coding-optimized, 256K context, prompt cache enabled |
| `kimi2.6` | Moonshot/Kimi | General Kimi route |
| `minimax2.7` | MiniMax | 1M context for broad codebase reads |
| `glm5.1` | Zhipu GLM | 128K context |
| `qwen3.6` | Alibaba Qwen | Qwen compatible route |
| `sonnet` | AWS Bedrock | Claude Sonnet alias |
| `opus` | AWS Bedrock | Claude Opus alias |
| `haiku` | AWS Bedrock | Fast Claude Haiku alias |

Dual-model mode is supported with `planner+executor` syntax:

```text
/model opus+sonnet
/model opus+kimi-coding
```

## REPL Commands

```text
/help                  Show commands
/status                Show session, model, usage, memory, and SDD state
/cost                  Show token and cache cost breakdown
/model <alias>         Switch models
/connect <provider>    Save provider API key
/plan <description>    Generate a structured implementation plan
/ultra-plan <desc>     Generate a deeper plan with risk and dependency tracking
/compact               Compact session context
/save                  Save the current session
/load <session>        Load a saved session
/rollback <n>          Roll back recent assistant turns
/diff                  Show files touched during the session
/memory                Show memory status
/mcp                   Show connected MCP tools
/accept-all            Toggle auto-approval for tool calls
/doctor                Check local configuration
/exit                  Quit
```

Keyboard shortcuts:

| Key | Action |
| --- | --- |
| Up / Down | Browse input history |
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
|-- rust/
|   |-- Cargo.toml
|   `-- crates/
|       |-- api/                 # Anthropic API types/client/SSE support
|       |-- commands/            # Slash command handling
|       |-- compat-harness/      # Compatibility harness utilities
|       |-- runtime/             # Conversation loop, prompts, memory, tools, SDD
|       |-- rusty-claude-cli/    # xolotl binary
|       `-- tools/               # Built-in tool specs and dispatch
|-- graphify-out/                # Local knowledge graph output
|-- assets/                      # Project images/assets
|-- src/                         # Archived Python-era source
`-- tests/                       # Legacy/compat test assets
```

## Development

```bash
cd rust

cargo build --workspace
cargo test --workspace --exclude compat-harness
cargo fmt --all -- --check
cargo clippy --workspace --all-features --exclude compat-harness -- -D warnings
```

After modifying code files, update the local graph:

```bash
graphify update .
```

## Verification Checklist

Before pushing changes:

```bash
cd rust
cargo fmt --all -- --check
cargo test --workspace --exclude compat-harness
cargo clippy --workspace --all-features --exclude compat-harness -- -D warnings
cargo run -p rusty-claude-cli -- --version
```

For the installed command:

```bash
cargo install --path rust/crates/rusty-claude-cli --force
xolotl --version
```

## Design Goals

- Work well on large repositories without wasting context.
- Prefer cache-friendly prompts and accurate token accounting.
- Make open-source and OpenAI-compatible coding models first-class.
- Keep agentic tool loops reliable, testable, and recoverable.
- Preserve project instructions without leaking unrelated global context into tests.
- Make it easy to commit only after the CLI is green.

## License

MIT
