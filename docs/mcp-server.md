# Xolotl MCP server

`xolotl mcp-serve` runs Xolotl as a **Model Context Protocol (MCP) server** over
stdio, exposing its built-in tools — and agent-spawn — to any MCP client (Claude
Desktop, an editor, another agent). It is the mirror image of the MCP *client*
in `rusty-claude-cli/src/mcp.rs`: the same newline-delimited JSON-RPC 2.0
framing and the same `2024-11-05` protocol version, in the opposite role.

The protocol logic lives in the `mcp-server` crate
(`rust/crates/mcp-server/`); the `xolotl` binary hosts it so that the `task`
tool (agent-spawn) can re-invoke the full CLI via `current_exe()`.

## Running it

```jsonc
// ~/.claude/settings.json (or any MCP client's server config)
{
  "mcpServers": {
    "xolotl": {
      "command": "xolotl",
      "args": ["mcp-serve"]
    }
  }
}
```

`xolotl mcp-server` is accepted as an alias. The server reads one JSON-RPC
message per line on **stdin** and writes one response per line on **stdout**.

## Transport invariants

- **stdin** — request channel, one JSON-RPC message per line.
- **stdout** — response channel; kept **pure JSON-RPC**. Before serving, the CLI
  disables inline streaming and sets `XOLOTL_HEADLESS=1` so no tool writes stray
  bytes to stdout (same posture as `agent --protocol ndjson`).
- **stderr** — diagnostics only.

## Methods

| Method | Behaviour |
|--------|-----------|
| `initialize` | Returns `protocolVersion`, `capabilities.tools`, and `serverInfo` (`xolotl` + version). |
| `notifications/initialized` (and any `notifications/*`) | Accepted, no reply. |
| `ping` | Returns `{}`. |
| `tools/list` | Returns every exposed tool with its `inputSchema`. |
| `tools/call` | Runs the named tool. The result is `{ content: [{ type: "text", text }], isError }`. |
| `shutdown` | Replies, then the server exits. (Closing stdin / `exit` also stops it.) |

Unknown **request** methods return a JSON-RPC `-32601` (method not found);
unknown **notifications** are ignored. A malformed line returns `-32700` (parse
error) with `id: null`. A `tools/call` without a `name` returns `-32602`
(invalid params).

Tool **execution** failures are not JSON-RPC errors — they come back as a normal
response whose result has `isError: true` and the error text in `content`. This
is the MCP convention and keeps clients robust.

## Exposed tools

Every Xolotl MVP tool is exposed **except `ask_user`**. `ask_user` reads stdin
and prints a prompt to stdout — both of which are the JSON-RPC transport — so
exposing it would corrupt the stream. A `tools/call` for `ask_user` (or any
unknown tool) returns an `isError: true` result and is never executed.

The exposed set includes `task` (**agent-spawn**): a client can ask the Xolotl
server to run a sub-agent. Sub-agents run as detached child processes with their
stdout/stderr discarded and their result returned via a temp file, so they never
touch the MCP stream.

> **Security.** The server exposes powerful tools (`bash`, `write_file`,
> `edit_file`, `git_commit`, `task`) and, unlike the interactive CLI and the
> autonomous agent, applies **no permission prompts and no destructive-command
> deny-list** — the CP 5.3 `SandboxPolicy` is *not* enforced here, so `bash`,
> `git_commit`, and `write_file` run unfiltered. Treat connecting a client to
> this server as equivalent to giving that client an unrestricted shell in the
> working directory. Only connect clients you trust, the same way you would any
> filesystem/shell MCP server. (`bash` calls are capped at a 120 s default
> timeout when the caller omits one, so a single command can't wedge the
> single-threaded server — but that is a liveness guard, not a security
> boundary.)

## Example session

```
→ {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"c","version":"0"}}}
← {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"xolotl","version":"0.1.0"}}}
→ {"jsonrpc":"2.0","method":"notifications/initialized"}
→ {"jsonrpc":"2.0","id":2,"method":"tools/list"}
← {"jsonrpc":"2.0","id":2,"result":{"tools":[ ... ]}}
→ {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"read_file","arguments":{"path":"README.md"}}}
← {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"..."}],"isError":false}}
→ {"jsonrpc":"2.0","id":4,"method":"shutdown"}
← {"jsonrpc":"2.0","id":4,"result":null}
```
