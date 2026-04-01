/// MCP (Model Context Protocol) client.
///
/// Reads `mcpServers` from `~/.claude/settings.json` (same format as Claude Code /
/// OpenCode), spawns each server as a child process communicating over stdio
/// using JSON-RPC 2.0, performs `initialize` + `tools/list` at startup, and
/// routes `tools/call` requests when the model uses an `mcp__<server>__<tool>` name.
///
/// # Config format (inside `~/.claude/settings.json`)
/// ```json
/// {
///   "mcpServers": {
///     "filesystem": {
///       "command": "npx",
///       "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/projects"],
///       "env": {}
///     },
///     "github": {
///       "command": "npx",
///       "args": ["-y", "@modelcontextprotocol/server-github"],
///       "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." }
///     }
///   }
/// }
/// ```
///
/// Tool names exposed to the model use the prefix `mcp__<server>__<tool>`.
/// This mirrors the Claude Code / OpenCode convention.
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

// ── JSON-RPC 2.0 types ────────────────────────────────────────────────────────

#[derive(Serialize)]
struct JsonRpcRequest<'a> {
    jsonrpc: &'static str,
    id: u64,
    method: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

#[derive(Deserialize, Debug)]
struct JsonRpcResponse {
    #[allow(dead_code)]
    id: Option<Value>,
    result: Option<Value>,
    error: Option<Value>,
}

#[allow(dead_code)]
#[derive(Deserialize, Debug)]
struct JsonRpcNotification {
    method: String,
    #[serde(default)]
    params: Value,
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn next_id() -> u64 {
    NEXT_ID.fetch_add(1, Ordering::Relaxed)
}

// ── MCP tool descriptor ───────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct McpToolSpec {
    /// Qualified name: `mcp__<server>__<original_name>`
    pub qualified_name: String,
    /// Server this tool belongs to.
    pub server_name: String,
    pub description: String,
    pub input_schema: Value,
}

// ── MCP server connection ─────────────────────────────────────────────────────

struct McpConnection {
    server_name: String,
    child: Child,
    stdin: ChildStdin,
    reader: BufReader<ChildStdout>,
}

impl McpConnection {
    fn spawn(
        server_name: &str,
        command: &str,
        args: &[String],
        env: &HashMap<String, String>,
    ) -> Result<Self, String> {
        let mut cmd = Command::new(command);
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit()); // let server errors appear in claw's stderr

        for (k, v) in env {
            cmd.env(k, v);
        }

        let mut child = cmd.spawn().map_err(|e| {
            format!(
                "Failed to start MCP server '{}' (command: {}): {}",
                server_name, command, e
            )
        })?;

        let stdin = child.stdin.take().ok_or("No stdin on MCP server process")?;
        let stdout = child
            .stdout
            .take()
            .ok_or("No stdout on MCP server process")?;

        Ok(Self {
            server_name: server_name.to_string(),
            child,
            stdin,
            reader: BufReader::new(stdout),
        })
    }

    /// Send a JSON-RPC request and wait for the matching response.
    /// Skips notifications (no `id` field) and reads until the id matches.
    fn call(&mut self, method: &str, params: Option<Value>) -> Result<Value, String> {
        let id = next_id();
        let req = JsonRpcRequest {
            jsonrpc: "2.0",
            id,
            method,
            params,
        };
        let mut line = serde_json::to_string(&req).map_err(|e| format!("Serialize error: {e}"))?;
        line.push('\n');
        self.stdin
            .write_all(line.as_bytes())
            .map_err(|e| format!("Write to '{}' stdin failed: {e}", self.server_name))?;
        self.stdin
            .flush()
            .map_err(|e| format!("Flush '{}' stdin failed: {e}", self.server_name))?;

        // Read lines until we get a response with our id
        loop {
            let mut buf = String::new();
            let n = self
                .reader
                .read_line(&mut buf)
                .map_err(|e| format!("Read from '{}' stdout failed: {e}", self.server_name))?;
            if n == 0 {
                return Err(format!(
                    "MCP server '{}' closed connection unexpectedly",
                    self.server_name
                ));
            }
            let trimmed = buf.trim();
            if trimmed.is_empty() {
                continue;
            }

            // Try to parse as a response (has `id`)
            if let Ok(resp) = serde_json::from_str::<JsonRpcResponse>(trimmed) {
                match resp.id {
                    Some(Value::Number(ref n)) if n.as_u64() == Some(id) => {
                        if let Some(err) = resp.error {
                            return Err(format!("MCP error from '{}': {err}", self.server_name));
                        }
                        return Ok(resp.result.unwrap_or(Value::Null));
                    }
                    _ => continue, // different id or notification — skip
                }
            }
            // Silently skip unparseable lines (e.g., server startup messages)
        }
    }

    /// Send a JSON-RPC notification (no response expected).
    fn notify(&mut self, method: &str, params: Option<Value>) -> Result<(), String> {
        #[derive(Serialize)]
        struct Notification<'a> {
            jsonrpc: &'static str,
            method: &'a str,
            #[serde(skip_serializing_if = "Option::is_none")]
            params: Option<Value>,
        }
        let notif = Notification {
            jsonrpc: "2.0",
            method,
            params,
        };
        let mut line =
            serde_json::to_string(&notif).map_err(|e| format!("Serialize error: {e}"))?;
        line.push('\n');
        self.stdin
            .write_all(line.as_bytes())
            .map_err(|e| format!("Write to '{}' stdin failed: {e}", self.server_name))?;
        self.stdin
            .flush()
            .map_err(|e| format!("Flush '{}' stdin failed: {e}", self.server_name))?;
        Ok(())
    }

    /// Run the MCP handshake and return the list of tools.
    fn initialize_and_list_tools(&mut self) -> Result<Vec<McpToolSpec>, String> {
        // initialize
        let result = self.call(
            "initialize",
            Some(json!({
                "protocolVersion": "2024-11-05",
                "capabilities": { "tools": {} },
                "clientInfo": { "name": "claw", "version": "0.1" }
            })),
        )?;

        // Send initialized notification
        let _ = self.notify("notifications/initialized", None);

        // Confirm we got a valid result
        if result.get("protocolVersion").is_none() {
            return Err(format!(
                "MCP server '{}' returned unexpected initialize response: {result}",
                self.server_name
            ));
        }

        // tools/list
        let tools_result = self.call("tools/list", Some(json!({})))?;
        let tools_array = tools_result
            .get("tools")
            .and_then(|v| v.as_array())
            .ok_or_else(|| {
                format!(
                    "MCP server '{}' tools/list returned no 'tools' array",
                    self.server_name
                )
            })?;

        let mut specs = Vec::new();
        for tool in tools_array {
            let original_name = tool
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if original_name.is_empty() {
                continue;
            }
            let description = tool
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let input_schema = tool
                .get("inputSchema")
                .cloned()
                .unwrap_or_else(|| json!({"type": "object", "properties": {}}));

            let qualified_name = format!("mcp__{}__{}", self.server_name, original_name);
            specs.push(McpToolSpec {
                qualified_name,
                server_name: self.server_name.clone(),
                description,
                input_schema,
            });
        }

        Ok(specs)
    }

    /// Call a tool on this server.
    fn call_tool(&mut self, tool_name: &str, arguments: Value) -> Result<String, String> {
        let result = self.call(
            "tools/call",
            Some(json!({ "name": tool_name, "arguments": arguments })),
        )?;

        // Extract text content from the result
        if let Some(content) = result.get("content").and_then(|v| v.as_array()) {
            let text_parts: Vec<&str> = content
                .iter()
                .filter_map(|block| {
                    if block.get("type").and_then(|v| v.as_str()) == Some("text") {
                        block.get("text").and_then(|v| v.as_str())
                    } else {
                        None
                    }
                })
                .collect();
            if !text_parts.is_empty() {
                return Ok(text_parts.join("\n"));
            }
        }

        // Fallback: return the raw JSON
        serde_json::to_string_pretty(&result).map_err(|e| format!("Serialize tool result: {e}"))
    }
}

impl Drop for McpConnection {
    fn drop(&mut self) {
        // Best-effort: send shutdown, then kill
        let _ = self.call("shutdown", None);
        let _ = self.child.kill();
    }
}

// ── MCP server config (from settings.json) ───────────────────────────────────

#[derive(Debug, Clone)]
struct McpServerConfig {
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
}

/// Load `mcpServers` from `~/.claude/settings.json` (and optionally from the
/// project `.claude/settings.json`).
fn load_mcp_configs() -> HashMap<String, McpServerConfig> {
    let mut configs = HashMap::new();

    // Try user settings first, then project settings
    let paths: Vec<PathBuf> = {
        let config_home = std::env::var_os("CLAUDE_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME")
                    .or_else(|| std::env::var_os("USERPROFILE"))
                    .map(|home| PathBuf::from(home).join(".claude"))
            })
            .unwrap_or_else(|| PathBuf::from(".claude"));

        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

        vec![
            config_home.join("settings.json"),
            cwd.join(".claude").join("settings.json"),
            cwd.join(".claude").join("settings.local.json"),
        ]
    };

    for path in &paths {
        let Ok(text) = std::fs::read_to_string(path) else {
            continue;
        };
        let Ok(val) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let Some(servers) = val.get("mcpServers").and_then(|v| v.as_object()) else {
            continue;
        };

        for (name, server) in servers {
            let Some(command) = server.get("command").and_then(|v| v.as_str()) else {
                eprintln!(
                    "  \x1b[33m⚠ MCP server '{}' missing 'command' field, skipping\x1b[0m",
                    name
                );
                continue;
            };
            let args = server
                .get("args")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str())
                        .map(str::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let env = server
                .get("env")
                .and_then(|v| v.as_object())
                .map(|obj| {
                    obj.iter()
                        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                        .collect::<HashMap<_, _>>()
                })
                .unwrap_or_default();

            configs.insert(
                name.clone(),
                McpServerConfig {
                    command: command.to_string(),
                    args,
                    env,
                },
            );
        }
    }

    configs
}

// ── Public McpManager ─────────────────────────────────────────────────────────

/// Manages all MCP server connections for a CLI session.
pub struct McpManager {
    connections: HashMap<String, McpConnection>,
    /// All tools discovered across all connected servers.
    pub tools: Vec<McpToolSpec>,
}

impl McpManager {
    /// Load MCP server configs, spawn servers, run handshakes, and collect tools.
    /// Logs warnings for servers that fail to start but does not abort.
    pub fn connect() -> Self {
        let configs = load_mcp_configs();
        if configs.is_empty() {
            return Self {
                connections: HashMap::new(),
                tools: Vec::new(),
            };
        }

        let mut connections = HashMap::new();
        let mut tools = Vec::new();

        for (name, cfg) in &configs {
            match McpConnection::spawn(name, &cfg.command, &cfg.args, &cfg.env) {
                Ok(mut conn) => match conn.initialize_and_list_tools() {
                    Ok(server_tools) => {
                        let count = server_tools.len();
                        tools.extend(server_tools);
                        connections.insert(name.clone(), conn);
                        eprintln!(
                            "  \x1b[32m✔\x1b[0m MCP \x1b[36m{name}\x1b[0m  {count} tool{}",
                            if count == 1 { "" } else { "s" }
                        );
                    }
                    Err(e) => {
                        eprintln!("  \x1b[33m⚠ MCP '{name}' init failed: {e}\x1b[0m");
                    }
                },
                Err(e) => {
                    eprintln!("  \x1b[33m⚠ MCP '{name}' spawn failed: {e}\x1b[0m");
                }
            }
        }

        Self { connections, tools }
    }

    /// Returns true if there are any connected MCP servers.
    pub fn is_empty(&self) -> bool {
        self.connections.is_empty()
    }

    /// Execute a tool call. `qualified_name` is `mcp__<server>__<tool>`.
    pub fn execute(&mut self, qualified_name: &str, input_json: &str) -> Result<String, String> {
        // Parse the qualified name
        let parts: Vec<&str> = qualified_name.splitn(3, "__").collect();
        if parts.len() != 3 || parts[0] != "mcp" {
            return Err(format!("Invalid MCP tool name: {qualified_name}"));
        }
        let server_name = parts[1];
        let tool_name = parts[2];

        let arguments: Value = serde_json::from_str(input_json).unwrap_or_else(|_| json!({}));

        let conn = self
            .connections
            .get_mut(server_name)
            .ok_or_else(|| format!("No MCP server named '{server_name}' is connected"))?;

        conn.call_tool(tool_name, arguments)
    }
}
