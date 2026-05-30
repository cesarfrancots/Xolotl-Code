//! MCP (Model Context Protocol) **server**.
//!
//! Exposes Xolotl's tools — and agent-spawn (the `task` tool) — to any MCP
//! client (Claude Desktop, another agent, an editor) over stdio using JSON-RPC
//! 2.0. This is the mirror image of the MCP *client* in
//! `rusty-claude-cli/src/mcp.rs`: same newline-delimited JSON-RPC framing, same
//! `2024-11-05` protocol version, opposite role.
//!
//! Run it with `xolotl mcp-serve`. Running it inside the `xolotl` binary (rather
//! than a standalone executable) is deliberate: the `task` tool spawns a
//! sub-agent via `current_exe()`, so the host process must be the full CLI for
//! agent-spawn to work.
//!
//! # Transport invariants
//! - **stdin** is the request channel — one JSON-RPC message per line.
//! - **stdout** is the response channel and MUST stay pure JSON-RPC. Nothing
//!   else may write to it. (The CLI sets `XOLOTL_HEADLESS=1` and disables inline
//!   streaming before calling [`serve`].) For this reason `ask_user` — which
//!   reads stdin and prints to stdout — is **not** exposed; see
//!   [`exposed_tool_specs`].
//! - Diagnostics, if any, go to **stderr**.
//!
//! # Methods
//! `initialize`, `notifications/initialized` (and any other `notifications/*`),
//! `ping`, `tools/list`, `tools/call`, `shutdown`. Unknown request methods get a
//! JSON-RPC `-32601` error; unknown notifications are ignored. Tool *execution*
//! failures are returned as a successful response whose result has
//! `isError: true` (the MCP convention), not as a JSON-RPC error.

use std::io::{BufRead, Write};

use serde_json::{json, Value};
use tools::{execute_tool, mvp_tool_specs, ToolSpec};

/// MCP protocol version implemented here (matches the client).
pub const PROTOCOL_VERSION: &str = "2024-11-05";
/// Server identity reported in `initialize`.
pub const SERVER_NAME: &str = "xolotl";
/// Server version reported in `initialize`.
pub const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

// JSON-RPC 2.0 error codes.
const PARSE_ERROR: i64 = -32700;
const INVALID_REQUEST: i64 = -32600;
const METHOD_NOT_FOUND: i64 = -32601;
const INVALID_PARAMS: i64 = -32602;

/// Default wall-clock cap (ms) injected for `bash` when the caller omits one.
/// The serve loop is single-threaded, so an unbounded command would wedge the
/// whole server; `execute_bash` only enforces a timeout when one is supplied.
const DEFAULT_BASH_TIMEOUT_MS: u64 = 120_000;

/// The single tool intentionally withheld from MCP: it reads stdin (the
/// JSON-RPC transport) and writes a prompt to stdout, so exposing it would
/// corrupt the stream.
const WITHHELD_TOOL: &str = "ask_user";

/// Tools exposed over MCP: every MVP tool except [`WITHHELD_TOOL`]. Includes
/// `task` (agent-spawn), which works because the server runs inside the `xolotl`
/// binary.
#[must_use]
pub fn exposed_tool_specs() -> Vec<ToolSpec> {
    mvp_tool_specs()
        .into_iter()
        .filter(|spec| spec.name != WITHHELD_TOOL)
        .collect()
}

fn is_exposed(name: &str) -> bool {
    name != WITHHELD_TOOL && mvp_tool_specs().iter().any(|spec| spec.name == name)
}

/// Outcome of handling one incoming message.
struct Handled {
    /// JSON-RPC response to write back, or `None` for notifications.
    reply: Option<Value>,
    /// Stop the serve loop after writing any reply.
    stop: bool,
}

impl Handled {
    fn none() -> Self {
        Self {
            reply: None,
            stop: false,
        }
    }
}

/// Serve MCP over the given reader/writer until EOF, `shutdown`, or `exit`.
///
/// Generic over the streams so tests can drive it with in-memory buffers; the
/// CLI passes a locked stdin/stdout.
pub fn serve<R: BufRead, W: Write>(mut reader: R, mut writer: W) -> std::io::Result<()> {
    let mut line = String::new();
    loop {
        line.clear();
        let read = reader.read_line(&mut line)?;
        if read == 0 {
            break; // EOF — the client closed the connection.
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let handled = match serde_json::from_str::<Value>(trimmed) {
            Ok(message) => handle_message(&message),
            Err(error) => Handled {
                reply: Some(error_response(
                    &Value::Null,
                    PARSE_ERROR,
                    &format!("Parse error: {error}"),
                )),
                stop: false,
            },
        };

        if let Some(reply) = handled.reply {
            write_message(&mut writer, &reply)?;
        }
        if handled.stop {
            break;
        }
    }
    Ok(())
}

fn handle_message(message: &Value) -> Handled {
    // JSON-RPC over MCP stdio carries one object per line. Arrays (batches —
    // unsupported in 2024-11-05) and bare scalars are Invalid Requests; answering
    // beats silence so a non-conforming client fails fast instead of hanging.
    if !message.is_object() {
        return Handled {
            reply: Some(error_response(
                &Value::Null,
                INVALID_REQUEST,
                "Invalid Request: expected a single JSON-RPC object",
            )),
            stop: false,
        };
    }

    let id = message.get("id").cloned();
    let Some(method) = message.get("method").and_then(Value::as_str) else {
        // No method. A stray response (carries result/error) or id-less garbage is
        // ignored; an id-bearing message without a method is an Invalid Request.
        let is_response = message.get("result").is_some() || message.get("error").is_some();
        return match id {
            Some(id) if !is_response => Handled {
                reply: Some(error_response(
                    &id,
                    INVALID_REQUEST,
                    "Invalid Request: missing method",
                )),
                stop: false,
            },
            _ => Handled::none(),
        };
    };
    let params = message.get("params");

    match method {
        "initialize" => respond(id, &initialize_result()),
        "ping" => respond(id, &json!({})),
        "tools/list" => respond(id, &json!({ "tools": tool_list_json() })),
        "tools/call" => handle_tools_call(id, params),
        "shutdown" => Handled {
            reply: id.map(|id| success(&id, &Value::Null)),
            stop: true,
        },
        "exit" => Handled {
            reply: None,
            stop: true,
        },
        // A genuine notification (no id) is silently accepted; an id-bearing
        // `notifications/*` is a malformed request → fall through to -32601.
        _ if method.starts_with("notifications/") && id.is_none() => Handled::none(),
        other => match id {
            // Request → error. Notification → ignored (JSON-RPC: never reply).
            Some(id) => Handled {
                reply: Some(error_response(
                    &id,
                    METHOD_NOT_FOUND,
                    &format!("Method not found: {other}"),
                )),
                stop: false,
            },
            None => Handled::none(),
        },
    }
}

fn handle_tools_call(id: Option<Value>, params: Option<&Value>) -> Handled {
    // `tools/call` is always a request; ignore it if it arrives as a notification.
    let Some(id) = id else {
        return Handled::none();
    };

    let Some(name) = params.and_then(|p| p.get("name")).and_then(Value::as_str) else {
        return Handled {
            reply: Some(error_response(
                &id,
                INVALID_PARAMS,
                "Invalid params: 'name' is required",
            )),
            stop: false,
        };
    };

    if !is_exposed(name) {
        // Unknown or intentionally-withheld tool (e.g. ask_user). Report as a
        // tool error so the client stays robust — and never execute it.
        return Handled {
            reply: Some(success(
                &id,
                &tool_result(&format!("tool '{name}' is not available over MCP"), true),
            )),
            stop: false,
        };
    }

    let arguments = with_tool_defaults(
        name,
        params
            .and_then(|p| p.get("arguments"))
            .cloned()
            .unwrap_or_else(|| json!({})),
    );

    let result = match execute_tool(name, &arguments) {
        Ok(text) => tool_result(&text, false),
        Err(error) => tool_result(&error, true),
    };
    Handled {
        reply: Some(success(&id, &result)),
        stop: false,
    }
}

/// Apply MCP-layer argument defaults that the shared tool layer doesn't impose.
/// Currently: cap `bash` at [`DEFAULT_BASH_TIMEOUT_MS`] when no `timeout` is
/// given, so an unbounded command can't wedge the single-threaded serve loop.
fn with_tool_defaults(name: &str, mut arguments: Value) -> Value {
    if name == "bash" {
        if let Some(object) = arguments.as_object_mut() {
            object
                .entry("timeout")
                .or_insert_with(|| json!(DEFAULT_BASH_TIMEOUT_MS));
        }
    }
    arguments
}

fn respond(id: Option<Value>, result: &Value) -> Handled {
    Handled {
        reply: id.map(|id| success(&id, result)),
        stop: false,
    }
}

fn initialize_result() -> Value {
    json!({
        "protocolVersion": PROTOCOL_VERSION,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": { "name": SERVER_NAME, "version": SERVER_VERSION }
    })
}

fn tool_list_json() -> Vec<Value> {
    exposed_tool_specs()
        .iter()
        .map(|spec| {
            json!({
                "name": spec.name,
                "description": spec.description,
                "inputSchema": spec.input_schema,
            })
        })
        .collect()
}

fn tool_result(text: &str, is_error: bool) -> Value {
    json!({
        "content": [{ "type": "text", "text": text }],
        "isError": is_error
    })
}

fn success(id: &Value, result: &Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn error_response(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn write_message<W: Write>(writer: &mut W, message: &Value) -> std::io::Result<()> {
    let mut serialized = serde_json::to_string(message).map_err(std::io::Error::other)?;
    serialized.push('\n');
    writer.write_all(serialized.as_bytes())?;
    writer.flush()
}

#[cfg(test)]
mod tests {
    use super::{serve, PROTOCOL_VERSION};
    use serde_json::{json, Value};
    use std::io::{BufReader, Cursor};

    /// Encode one JSON-RPC message as a transport line.
    fn line(message: &Value) -> String {
        serde_json::to_string(message).expect("serialize request")
    }

    /// Drive the server with a script of newline-delimited requests and return
    /// the parsed response messages (notifications produce none).
    fn drive(input: &str) -> Vec<Value> {
        let reader = BufReader::new(Cursor::new(input.as_bytes().to_vec()));
        let mut out: Vec<u8> = Vec::new();
        serve(reader, &mut out).expect("serve loop");
        String::from_utf8(out)
            .expect("utf8 output")
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| serde_json::from_str::<Value>(l).expect("parse response"))
            .collect()
    }

    #[test]
    fn initialize_list_call_roundtrip() {
        // A deterministic file for the read_file round-trip.
        let path = std::env::temp_dir().join("xolotl_mcp_roundtrip_probe.txt");
        std::fs::write(&path, "hello-mcp-roundtrip").expect("write probe");
        let path_str = path.to_string_lossy().into_owned();

        let input = [
            line(&json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": { "protocolVersion": PROTOCOL_VERSION, "capabilities": {},
                            "clientInfo": { "name": "test-client", "version": "0" } }
            })),
            line(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })),
            line(&json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" })),
            line(&json!({
                "jsonrpc": "2.0", "id": 3, "method": "tools/call",
                "params": { "name": "read_file", "arguments": { "path": path_str } }
            })),
            line(&json!({ "jsonrpc": "2.0", "id": 4, "method": "shutdown" })),
        ]
        .join("\n")
            + "\n";

        let responses = drive(&input);
        // The `initialized` notification yields no reply → 4 responses (ids 1-4).
        assert_eq!(responses.len(), 4, "got: {responses:?}");

        // initialize
        assert_eq!(responses[0]["id"], json!(1));
        assert_eq!(
            responses[0]["result"]["protocolVersion"],
            json!(PROTOCOL_VERSION)
        );
        assert_eq!(
            responses[0]["result"]["serverInfo"]["name"],
            json!("xolotl")
        );

        // tools/list
        assert_eq!(responses[1]["id"], json!(2));
        let names: Vec<String> = responses[1]["result"]["tools"]
            .as_array()
            .expect("tools array")
            .iter()
            .map(|t| t["name"].as_str().unwrap_or_default().to_string())
            .collect();
        assert!(names.iter().any(|n| n == "read_file"));
        assert!(names.iter().any(|n| n == "bash"));
        assert!(
            names.iter().any(|n| n == "task"),
            "agent-spawn tool must be exposed"
        );
        assert!(
            !names.iter().any(|n| n == "ask_user"),
            "ask_user must be withheld (it reads the stdin transport)"
        );

        // tools/call read_file
        assert_eq!(responses[2]["id"], json!(3));
        assert_eq!(responses[2]["result"]["isError"], json!(false));
        let text = responses[2]["result"]["content"][0]["text"]
            .as_str()
            .expect("tool text");
        assert!(
            text.contains("hello-mcp-roundtrip"),
            "unexpected tool text: {text}"
        );

        // shutdown
        assert_eq!(responses[3]["id"], json!(4));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn unknown_method_returns_method_not_found() {
        let input = line(&json!({ "jsonrpc": "2.0", "id": 9, "method": "frobnicate" })) + "\n";
        let responses = drive(&input);
        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0]["error"]["code"], json!(-32601));
    }

    #[test]
    fn ask_user_is_withheld_and_never_executed() {
        // ask_user would read the JSON-RPC stdin stream — it must be refused as a
        // tool error, never run.
        let input = line(&json!({
            "jsonrpc": "2.0", "id": 10, "method": "tools/call",
            "params": { "name": "ask_user", "arguments": { "question": "hi?" } }
        })) + "\n";
        let responses = drive(&input);
        assert_eq!(responses[0]["result"]["isError"], json!(true));
        let text = responses[0]["result"]["content"][0]["text"]
            .as_str()
            .unwrap_or_default();
        assert!(text.contains("not available"), "unexpected: {text}");
    }

    #[test]
    fn malformed_line_returns_parse_error() {
        let responses = drive("{ not json }\n");
        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0]["error"]["code"], json!(-32700));
        assert_eq!(responses[0]["id"], Value::Null);
    }

    #[test]
    fn notifications_produce_no_reply() {
        let input =
            line(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })) + "\n";
        assert!(drive(&input).is_empty());
    }

    #[test]
    fn missing_tool_name_is_invalid_params() {
        let input = line(&json!({
            "jsonrpc": "2.0", "id": 11, "method": "tools/call", "params": { "arguments": {} }
        })) + "\n";
        let responses = drive(&input);
        assert_eq!(responses[0]["error"]["code"], json!(-32602));
    }

    #[test]
    fn id_bearing_request_without_method_is_invalid_request() {
        let input = line(&json!({ "jsonrpc": "2.0", "id": 42 })) + "\n";
        let responses = drive(&input);
        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0]["id"], json!(42));
        assert_eq!(responses[0]["error"]["code"], json!(-32600));
    }

    #[test]
    fn string_id_is_echoed_exactly() {
        let input = line(&json!({ "jsonrpc": "2.0", "id": "abc-1", "method": "ping" })) + "\n";
        let responses = drive(&input);
        assert_eq!(responses[0]["id"], json!("abc-1"));
    }

    #[test]
    fn stray_response_is_ignored() {
        // An object with an id and a result but no method is a response, not a
        // request — the server must ignore it, not reply with an error.
        let input = line(&json!({ "jsonrpc": "2.0", "id": 5, "result": {} })) + "\n";
        assert!(drive(&input).is_empty());
    }

    #[test]
    fn array_batch_is_invalid_request() {
        let input = line(&json!([
            { "jsonrpc": "2.0", "id": 1, "method": "ping" },
            { "jsonrpc": "2.0", "id": 2, "method": "ping" }
        ])) + "\n";
        let responses = drive(&input);
        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0]["error"]["code"], json!(-32600));
        assert_eq!(responses[0]["id"], Value::Null);
    }

    #[test]
    fn id_bearing_notification_method_is_method_not_found() {
        // A `notifications/*` method that carries an id is a malformed request.
        let input = line(&json!({
            "jsonrpc": "2.0", "id": 12, "method": "notifications/initialized"
        })) + "\n";
        let responses = drive(&input);
        assert_eq!(responses[0]["error"]["code"], json!(-32601));
    }

    #[test]
    fn bash_gets_a_default_timeout_when_omitted() {
        let with = super::with_tool_defaults("bash", json!({ "command": "echo hi" }));
        assert_eq!(with["timeout"], json!(super::DEFAULT_BASH_TIMEOUT_MS));
        // A caller-supplied timeout is preserved.
        let kept = super::with_tool_defaults("bash", json!({ "command": "x", "timeout": 5 }));
        assert_eq!(kept["timeout"], json!(5));
        // Non-bash tools are untouched.
        let other = super::with_tool_defaults("read_file", json!({ "path": "x" }));
        assert!(other.get("timeout").is_none());
    }
}
