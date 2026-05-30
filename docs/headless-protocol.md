# Headless NDJSON protocol

`xolotl agent --protocol ndjson` runs a single autonomous turn and streams the
result to **stdout** as newline-delimited JSON (NDJSON): one JSON object per
line, each tagged by a `"type"` field. This lets editors, MCP servers, and other
tools drive Xolotl programmatically without scraping the human-facing REPL
output.

## Invocation

```bash
# Prompt as trailing arguments:
xolotl agent --protocol ndjson "refactor the auth module"

# Or piped on stdin (the whole of stdin becomes the prompt):
echo "refactor the auth module" | xolotl agent --protocol ndjson

# Pick a model like any other command:
xolotl --model kimi-coding agent --protocol ndjson "fix the failing test"
```

Headless mode runs **autonomously**: tool calls are auto-accepted (an
interactive permission prompt would block an editor-driven session).

> ⚠️ **Trust boundary.** Headless mode auto-approves every tool call and does
> **not** enable the CP 5.3 destructive-command sandbox (it is opt-in and off by
> default). Run `xolotl agent` only with prompts and workspaces you trust. The
> interactive `ask_user` tool is disabled in headless mode (it would block on
> stdin); the model is told to proceed without asking.

## Output guarantees

- **stdout is pure NDJSON.** Inline streaming of assistant text is suppressed;
  every byte on stdout is part of the event stream. Human-readable diagnostics
  (MCP connection warnings, permission notices) go to **stderr**.
- Each line is a complete, compact JSON object terminated by `\n`.
- Events for a turn are emitted **after** the turn completes, in a deterministic
  order (see below). The last event is always `turn_complete` (success) or
  `error` (failure; process also exits non-zero).

## Event types

| `type`          | Fields                                                                                  | Meaning |
|-----------------|-----------------------------------------------------------------------------------------|---------|
| `text`          | `text`                                                                                  | A natural-language block authored by the assistant. |
| `reasoning`     | `reasoning`                                                                              | A chain-of-thought / reasoning block. |
| `tool_use`      | `id`, `name`, `input`                                                                    | The assistant requested a tool call. `input` is the **raw JSON arguments string** exactly as the model produced it — parse it yourself. |
| `tool_result`   | `tool_use_id`, `tool_name`, `output`, `is_error`                                         | Result of a tool call. Emitted immediately after its matching `tool_use` (matched by `id` → `tool_use_id`). |
| `usage`         | `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` | Token usage for the whole turn. |
| `turn_complete` | `iterations`                                                                            | Terminal success event. `iterations` = model round-trips taken. |
| `error`         | `message`                                                                               | Terminal failure event. The process exits with code 1. |

## Ordering

1. Assistant content blocks are emitted **in order**. Each `tool_use` is
   immediately followed by its matching `tool_result`.
2. A `tool_result` with no matching `tool_use` (rare/defensive) is appended after
   all assistant content.
3. The stream ends with a `usage` event, then `turn_complete` (or a single
   `error` event if the turn failed).

Empty `text`/`reasoning` blocks are omitted.

## Example

```ndjson
{"type":"text","text":"Let me read the file."}
{"type":"tool_use","id":"toolu_1","name":"read_file","input":"{\"path\":\"a.txt\"}"}
{"type":"tool_result","tool_use_id":"toolu_1","tool_name":"read_file","output":"hello","is_error":false}
{"type":"text","text":"The file says hello."}
{"type":"usage","input_tokens":120,"output_tokens":45,"cache_creation_input_tokens":10,"cache_read_input_tokens":100}
{"type":"turn_complete","iterations":2}
```

## Stability

The event `type` tags and their fields are a stable contract. New event types or
optional fields may be added over time; consumers should ignore unknown `type`
values and unknown fields rather than failing.
