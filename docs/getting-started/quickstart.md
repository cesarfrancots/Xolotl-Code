# Quickstart

This assumes you've [installed](installation.md) the app or CLI and set at least one provider key (see [Configuration](configuration.md)).

## Desktop app

1. Launch the app (`npm run tauri dev` from `tauri-app/`, or the built binary).
2. **Chat** — type a prompt in the chat pane. Responses stream live; reasoning models show their chain-of-thought in a separate track.
3. **Spawn an agent** — in the right sidebar, click **+** to run a sub-agent on a task in an isolated git worktree. See [Agents & teams](../guides/agents-and-teams.md).
4. **Run an eval** — open the **Eval** tab, pick models, and race them on a prompt; or switch to **Goal Eval** to grade the reasoning process. See [Eval lab](../guides/eval-lab.md) and [Goal Eval](../guides/goal-eval.md).

## CLI

```bash
xolotl                                # interactive REPL
xolotl -y                             # auto-approve tool calls
xolotl prompt "summarize the runtime crate"
xolotl setup                          # configure API keys
```

Inside the REPL, switch models and providers on the fly:

```text
/model opus            # switch model
/model opus+sonnet     # dual-model planner + executor
/connect kimi-coding   # save a provider key
/help                  # all commands
```

See the full [CLI & REPL reference](../cli.md).
