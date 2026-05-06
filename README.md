# Xolotl Code

```
      ▓▓      ▓▓
     ▓▓▓    ▓▓▓
      ▓▓▓▓▓▓▓
     ▓◉▓▓▓▓◉▓
      ▓▓▓▓▓▓▓
     ▓▓▓▓▓▓▓▓
    ▓▓▓▓▓▓▓▓▓▓
   ▓▓▓▓▓▓▓▓▓▓▓▓
   ▓▓▓▓▓▓▓▓▓▓▓▓
    ▓▓▓▓▓▓▓▓▓▓
     ▓▓▓▓▓▓▓
```

**Xolotl** is a multi-provider AI coding agent harness. Talk to Claude, Kimi, MiniMax, GLM, Qwen, or OpenAI models from a single terminal interface with built-in tool use, session management, and REPL workflow.

## Features

- **Multi-Provider** — Switch between Anthropic (Claude), Kimi, MiniMax, GLM, Qwen, and OpenAI models mid-session
- **Tool Use** — Built-in file operations, bash execution, web fetch, todo lists, and MCP server support
- **Session Management** — Auto-save conversations, resume later, rollback turns
- **Planning Mode** — `/plan` and `/ultra-plan` for multi-phase architectural planning
- **Memory System** — Persistent vault for session notes and project context
- **Dual Model** — Planner + executor pairs (e.g., Opus plans, Sonnet executes)
- **Pixel Art Welcome** — Because every CLI deserves a mascot

## Quick Start

```bash
# Install
 cargo install --path rust/crates/rusty-claude-cli

# Start interactive REPL
 xolotl

# Start with auto-accept (skip permission prompts)
 xolotl -y

# One-shot prompt
 xolotl prompt "refactor the auth module"

# Setup API keys
 xolotl setup
```

## Supported Models

| Alias | Provider | Context | Thinking |
|-------|----------|---------|----------|
| `sonnet` | AWS Bedrock | 200K | Yes |
| `opus` | AWS Bedrock | 200K | Yes |
| `kimi-coding` | Kimi | 256K | Yes (32K) |
| `kimi2.6` | Moonshot | 256K | Yes |
| `minimax2.7` | MiniMax | 1M | Yes |
| `glm5.1` | Zhipu GLM | 128K | Yes |
| `qwen3.6` | Alibaba Qwen | 128K | Yes |

```bash
# Switch models mid-session
› /model minimax2.7

# Dual model mode
› /model opus+sonnet
```

## Configuration

API keys are stored in `~/.xolotl-code/config.json` and loaded automatically:

```bash
# Interactive setup
 xolotl setup

# Or set environment variables
 export ANTHROPIC_API_KEY="sk-..."
 export KIMI_CODING_API_KEY="..."
 export MINIMAX_API_KEY="..."
```

## REPL Commands

```
› /help              Show all commands
› /plan <desc>       Create a multi-phase plan
› /status            Show session status and cost
› /save              Save session to disk
› /load <file>       Load a saved session
› /model <alias>     Switch model
› /connect <provider> Configure a new provider
› /compact           Compact session context
› /clear             Clear screen
› /exit              Quit
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `↑ / ↓` | Browse history |
| `Shift+Enter` | Insert newline |
| `Ctrl+T` | Toggle thinking display |
| `Ctrl+E` | Cycle effort level |
| `Ctrl+M` | Quick model switch |
| `Ctrl+S` | Save session |
| `Ctrl+R` | Retry last prompt |
| `Ctrl+C` | Cancel input |

## Project Structure

```
.
├── rust/                    # Rust implementation (primary)
│   ├── crates/
│   │   ├── rusty-claude-cli/   # CLI binary
│   │   ├── runtime/            # Conversation, tools, session
│   │   ├── api/                # Provider clients
│   │   ├── commands/           # Slash command handlers
│   │   └── tools/              # Tool implementations
│   └── Cargo.toml
├── src/                     # Python port (archived)
├── tests/                   # Test suites
└── graphify-out/            # Knowledge graph
```

## Development

```bash
cd rust

# Build
cargo build --workspace

# Test
cargo test --workspace --exclude compat-harness

# Lint
cargo clippy --workspace --all-features -- -D warnings
cargo fmt --all -- --check
```

## License

MIT

---

*Named after the axolotl — the eternally youthful salamander that regenerates. May your code do the same.*
