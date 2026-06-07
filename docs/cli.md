# CLI & REPL

The `xolotl` CLI is the same engine as the desktop app, without the UI.

## Invocation

```bash
xolotl                                # interactive REPL
xolotl -y                             # auto-approve tool calls
xolotl prompt "summarize the runtime crate"
xolotl setup                          # configure API keys
xolotl --resume <id>                  # resume a saved session in the REPL
xolotl --budget <dollars>            # stop when the budget is exceeded
```

## REPL commands

```text
/help                  Show commands
/status                Session, model, usage, memory state
/cost                  Token + cache cost breakdown
/model <alias>         Switch models (supports planner+executor, e.g. opus+sonnet)
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

Supported `/connect` providers: `kimi-coding`, `kimi`, `minimax`, `deepseek`, `glm`, `qwen`, `anthropic`, `bedrock`, `openai`.

## Keybindings

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

See [Providers & models](providers.md) for the full alias list.
