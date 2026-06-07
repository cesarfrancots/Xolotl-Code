# Agents & teams

The right sidebar of the desktop app spawns sub-agents that work in **isolated git worktrees**, so their changes can be reviewed and merged on your terms.

## Spawn a single agent

Click **+** in the agent panel and give it:

- a **task** (what to do),
- a **model** (route by alias — see [Providers & models](../providers.md)),
- an optional **budget cap**.

The agent runs in its own worktree under `.xolotl-worktrees/`. Per-agent state is persisted; the panel survives app restarts.

## Launch a team / swarm

Click the **team** (people) icon to launch a multi-agent swarm with named **roles** and **tasks**. When all members finish, a **merge checkpoint** view opens so you can review and merge each worktree.

## Cost model

The orchestrator runs a smart model (Opus / Sonnet) while worker agents run cheap ones (Haiku / Kimi) — capability where it matters, low cost on the bulk work.

## Under the hood

- Sub-agents are spawned as isolated processes; worktrees serialise git writes so parallel agents don't collide.
- Shared context is available to team members for collaboration.

See [Architecture](../architecture.md) for the engine and supervisor details.
