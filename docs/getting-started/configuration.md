# Configuration

Xolotl Code reads everything from `~/.xolotl-code/`. The desktop app and CLI share this directory, so a key set in either tool works in both.

## Setting API keys

Pick whichever is convenient:

- **Desktop app** — settings (gear icon) → **Providers** tab.
- **CLI** — `xolotl setup`, or `/connect <provider>` inside the REPL.
- **Environment variables** — export the matching var (see [Providers & models](../providers.md) for the full list):

```bash
export ANTHROPIC_API_KEY=...
export KIMI_CODING_API_KEY=...
export MINIMAX_API_KEY=...
export DEEPSEEK_API_KEY=...
```

Base URLs are overridable via the `*_BASE_URL` variants of each key.

## Where state lives

```text
~/.xolotl-code/
├── config.json                      # provider keys + defaults
├── sessions/<id>.json               # chat sessions
├── evals/<id>.json                  # eval runs + reasoning + grades
├── skills/<name>/SKILL.md           # user-defined skills
└── mcp.json                         # user-scoped MCP servers
```

> **`config.json` is a free-form map**, not a strict schema — it holds env-var-style keys (`ANTHROPIC_API_KEY`, `KIMI_CODING_BASE_URL`, `AWS_*`, …) shared between the app and CLI. Adding unknown keys is safe.

Legacy `~/.claw-code/config.json` is migrated automatically on first run.

## Project-scoped config

- **MCP servers** — a `.mcp.json` in your project root is discovered alongside the user-scoped `~/.xolotl-code/mcp.json`.
- See [Skills & MCP](../guides/skills-and-mcp.md).
