# Xolotl Code

A desktop **AI coding-agent platform** for evaluating, comparing, and _racing_ LLMs on real engineering work — built so Claude and the best open models (Kimi, MiniMax, DeepSeek, GLM, Qwen) are first-class citizens, side by side.

Xolotl Code ships as **two surfaces that share one engine and one config file**:

- **🖥️ Tauri desktop app** — the primary surface: a chat pane, an agent/team worktree orchestrator, an eval lab (including the flagship **Goal Eval**), and a living **Axolotl Civilization** arena.
- **⌨️ `xolotl` CLI** — the same engine without the UI: multi-provider routing, slash commands, sessions, planning, tools, and memory.

Both read `~/.xolotl-code/config.json`, so a key set in either tool works in both.

## Start here

| If you want to… | Go to |
| --- | --- |
| Install the app or CLI | [Installation](getting-started/installation.md) |
| Run your first chat / eval | [Quickstart](getting-started/quickstart.md) |
| Set API keys & defaults | [Configuration](getting-started/configuration.md) |

## Guides

- [Chat](guides/chat.md) — streaming responses + separate chain-of-thought
- [Agents & teams](guides/agents-and-teams.md) — sub-agents in isolated git worktrees
- [Eval lab](guides/eval-lab.md) — race, judge, blind human scoring, leaderboard
- [Goal Eval](guides/goal-eval.md) — grade the _reasoning process_, not just the answer
- [Skills & MCP](guides/skills-and-mcp.md) — extend the model with tools and skills

## Reference

- [Providers & models](providers.md)
- [CLI & REPL](cli.md)
- [Architecture](architecture.md)

## Integrations

- [Headless NDJSON protocol](headless-protocol.md) — drive Xolotl programmatically over stdout NDJSON
- [MCP server](mcp-server.md) — expose Xolotl's tools (incl. agent-spawn) to any MCP client

## The game

- [Axolotl Civilization](civilization.md) — a deterministic colony-sim that doubles as an LLM arena

---

> These docs are the single source for the project website. They render on GitHub today and are ready to sync to GitBook or build into a docs site (VitePress / Astro Starlight) when the website launches.
