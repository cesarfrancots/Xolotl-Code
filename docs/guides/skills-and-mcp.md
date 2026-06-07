# Skills & MCP

Extend the model with reusable skills and external tools.

## Skills

Claude-Code-compatible markdown skills discovered from `~/.xolotl-code/skills/<name>/SKILL.md`. Toggle them on in the **Settings → Skills** tab to advertise them to the model on every chat turn.

## MCP servers

Model Context Protocol servers are discovered from:

- `~/.xolotl-code/mcp.json` — user-scoped
- `.mcp.json` — project-scoped (in your project root)

The Settings → **MCP** tab reachability-tests each server and reports latency. Tools exposed by connected servers become available to the model.

## To write

- [ ] Authoring a SKILL.md (frontmatter + body conventions)
- [ ] Example `mcp.json` with a stdio server
- [ ] Troubleshooting unreachable servers
