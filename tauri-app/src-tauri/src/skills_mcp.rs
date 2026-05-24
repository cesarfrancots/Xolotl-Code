//! Skills + MCP support — matches the Claude Code format.
//!
//! Skills live in `~/.xolotl-code/skills/<name>/SKILL.md` (frontmatter + body).
//! MCP servers are declared in `~/.xolotl-code/mcp.json` *and* an optional
//! per-project `.mcp.json` at the repo root (same shape as Claude Code).
//!
//! This module is intentionally a *scaffold*:
//!   - SkillManifest / McpServerConfig types are wire-complete
//!   - Loaders + JSON-RPC stdio ping are implemented
//!   - HTTP MCP server reachability is implemented
//!   - **Tool invocation through the LLM's tool-use loop is NOT wired** — that's
//!     a future change to call_anthropic_streaming and the chat protocol.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct SkillManifest {
    /// Short kebab-case slug (also the directory name).
    pub name: String,
    /// One-line summary shown in the UI and prepended to the chat system prompt.
    pub description: String,
    /// Path to the SKILL.md on disk (for "open in editor" actions later).
    pub path: String,
    /// Body length in bytes (so the UI can warn about large skills).
    pub body_bytes: u32,
    /// Optional list of tools the skill says it needs — informational only for now.
    #[serde(default)]
    pub allowed_tools: Vec<String>,
    /// Optional invocation triggers — informational hints to the model.
    #[serde(default)]
    pub triggers: Vec<String>,
}

/// Single MCP server entry as stored in `mcp.json`.
/// Two transports: `stdio` (default — spawn a process) or `http` (remote SSE/HTTP).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct McpServerConfig {
    pub name: String,
    /// "stdio" | "http"  (defaults to stdio if absent in raw json).
    pub transport: String,
    /// For stdio: the executable. For http: ignored.
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    /// For http: the URL.
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    /// "user" | "project" — which config file declared this server.
    pub scope: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct McpTestResult {
    pub ok: bool,
    pub message: String,
    /// Round-trip latency in ms (None on failure).
    pub latency_ms: Option<u32>,
}

fn home_root() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".xolotl-code")
}

fn skills_dir() -> PathBuf {
    home_root().join("skills")
}

fn user_mcp_path() -> PathBuf {
    home_root().join("mcp.json")
}

// ── Skill loader ──────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn list_skills() -> Vec<SkillManifest> {
    let dir = skills_dir();
    if let Err(_) = std::fs::create_dir_all(&dir) {
        return Vec::new();
    }
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out: Vec<SkillManifest> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let skill_md = e.path().join("SKILL.md");
            if !skill_md.exists() {
                return None;
            }
            parse_skill_manifest(&skill_md).ok()
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[tauri::command]
#[specta::specta]
pub fn read_skill(name: String) -> Result<String, String> {
    // Strict: only single path-safe segment.
    if name.is_empty() || name.contains(['/', '\\', ':', '.']) {
        return Err("invalid skill name".to_string());
    }
    let path = skills_dir().join(&name).join("SKILL.md");
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

fn parse_skill_manifest(path: &Path) -> Result<SkillManifest, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let body_bytes = raw.len() as u32;

    // Frontmatter parse: --- ... ---  at the very top.
    let mut name = String::new();
    let mut description = String::new();
    let mut allowed_tools: Vec<String> = Vec::new();
    let mut triggers: Vec<String> = Vec::new();

    if raw.starts_with("---") {
        if let Some(end_idx) = raw[3..].find("\n---") {
            let fm = &raw[3..3 + end_idx];
            for line in fm.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let Some(colon) = line.find(':') else {
                    continue;
                };
                let key = line[..colon].trim().to_lowercase();
                let val = line[colon + 1..].trim();
                match key.as_str() {
                    "name" => name = strip_yaml_quotes(val).to_string(),
                    "description" => description = strip_yaml_quotes(val).to_string(),
                    "allowed-tools" | "allowed_tools" => {
                        allowed_tools = parse_yaml_inline_list(val);
                    }
                    "triggers" | "trigger" => {
                        triggers = parse_yaml_inline_list(val);
                    }
                    _ => {}
                }
            }
        }
    }

    // Fallback: derive name from directory.
    if name.is_empty() {
        if let Some(parent) = path.parent() {
            if let Some(s) = parent.file_name().and_then(|n| n.to_str()) {
                name = s.to_string();
            }
        }
    }

    if name.is_empty() {
        return Err(format!("skill at {path:?} has no name"));
    }

    Ok(SkillManifest {
        name,
        description,
        path: path.to_string_lossy().to_string(),
        body_bytes,
        allowed_tools,
        triggers,
    })
}

fn strip_yaml_quotes(s: &str) -> &str {
    let s = s.trim();
    let s = s.strip_prefix('"').unwrap_or(s);
    let s = s.strip_suffix('"').unwrap_or(s);
    let s = s.strip_prefix('\'').unwrap_or(s);
    s.strip_suffix('\'').unwrap_or(s)
}

fn parse_yaml_inline_list(val: &str) -> Vec<String> {
    let v = val.trim();
    if v.starts_with('[') && v.ends_with(']') {
        return v[1..v.len() - 1]
            .split(',')
            .map(|s| strip_yaml_quotes(s.trim()).to_string())
            .filter(|s| !s.is_empty())
            .collect();
    }
    // Single value or comma-separated.
    val.split(',')
        .map(|s| strip_yaml_quotes(s.trim()).to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

// ── MCP config ────────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn list_mcp_servers() -> Vec<McpServerConfig> {
    let mut out = Vec::new();
    // User-level config first.
    if let Ok(raw) = std::fs::read_to_string(user_mcp_path()) {
        out.extend(parse_mcp_json(&raw, "user"));
    }
    // Project-level config (next to whatever cwd is — best-effort).
    if let Ok(cwd) = std::env::current_dir() {
        let project_mcp = cwd.join(".mcp.json");
        if let Ok(raw) = std::fs::read_to_string(&project_mcp) {
            out.extend(parse_mcp_json(&raw, "project"));
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn parse_mcp_json(raw: &str, scope: &str) -> Vec<McpServerConfig> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) else {
        return Vec::new();
    };
    let Some(servers) = v.get("mcpServers").and_then(|x| x.as_object()) else {
        return Vec::new();
    };
    servers
        .iter()
        .map(|(name, def)| {
            let transport = def
                .get("type")
                .and_then(|t| t.as_str())
                .or_else(|| def.get("transport").and_then(|t| t.as_str()))
                .map(|s| s.to_string())
                .unwrap_or_else(|| {
                    if def.get("url").is_some() {
                        "http".to_string()
                    } else {
                        "stdio".to_string()
                    }
                });
            let command = def
                .get("command")
                .and_then(|c| c.as_str())
                .map(String::from);
            let args = def
                .get("args")
                .and_then(|a| a.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            let env = def
                .get("env")
                .and_then(|e| e.as_object())
                .map(|o| {
                    o.iter()
                        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                        .collect()
                })
                .unwrap_or_default();
            let url = def.get("url").and_then(|u| u.as_str()).map(String::from);
            let headers = def
                .get("headers")
                .and_then(|h| h.as_object())
                .map(|o| {
                    o.iter()
                        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                        .collect()
                })
                .unwrap_or_default();
            McpServerConfig {
                name: name.clone(),
                transport,
                command,
                args,
                env,
                url,
                headers,
                scope: scope.to_string(),
            }
        })
        .collect()
}

/// Test an MCP server's reachability. For stdio: spawn it and send a JSON-RPC
/// `initialize` ping (handshake required by the MCP spec). For http: GET / and
/// check for any response (200/404 both prove the host is up).
#[tauri::command]
#[specta::specta]
pub async fn test_mcp_server(name: String) -> McpTestResult {
    let servers = list_mcp_servers();
    let Some(server) = servers.iter().find(|s| s.name == name) else {
        return McpTestResult {
            ok: false,
            message: format!("Server '{name}' not found"),
            latency_ms: None,
        };
    };

    let started = std::time::Instant::now();
    match server.transport.as_str() {
        "http" => {
            let Some(url) = &server.url else {
                return McpTestResult {
                    ok: false,
                    message: "http server missing url".into(),
                    latency_ms: None,
                };
            };
            let client = reqwest::Client::new();
            let mut req = client.get(url);
            for (k, v) in &server.headers {
                req = req.header(k, v);
            }
            match req.timeout(std::time::Duration::from_secs(10)).send().await {
                Ok(resp) => {
                    let latency = started.elapsed().as_millis() as u32;
                    McpTestResult {
                        ok: true,
                        message: format!("Reachable ({})", resp.status()),
                        latency_ms: Some(latency),
                    }
                }
                Err(e) => McpTestResult {
                    ok: false,
                    message: format!("HTTP: {e}"),
                    latency_ms: None,
                },
            }
        }
        "stdio" | _ => {
            let Some(cmd) = &server.command else {
                return McpTestResult {
                    ok: false,
                    message: "stdio server missing command".into(),
                    latency_ms: None,
                };
            };
            // Spawn the process, send `initialize` JSON-RPC, wait briefly for any response.
            // We don't enforce a real MCP handshake (yet) — just prove the process starts
            // and writes *something* to stdout before its 3s deadline. Real init flow is
            // in the follow-up that actually invokes tools.
            let cmd_clone = cmd.clone();
            let args_clone = server.args.clone();
            let env_clone = server.env.clone();
            let res = tokio::task::spawn_blocking(move || {
                use std::io::{Read, Write};
                let mut command = std::process::Command::new(&cmd_clone);
                command.args(&args_clone);
                for (k, v) in &env_clone {
                    command.env(k, v);
                }
                command
                    .stdin(std::process::Stdio::piped())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped());
                let mut child = command.spawn().map_err(|e| e.to_string())?;

                let init_msg = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": { "name": "xolotl", "version": "0.1.0" }
                    }
                });
                let payload = format!("{init_msg}\n");

                if let Some(mut stdin) = child.stdin.take() {
                    stdin
                        .write_all(payload.as_bytes())
                        .map_err(|e| e.to_string())?;
                }

                // Best-effort: wait up to 3s for any stdout, then kill.
                let mut buf = [0u8; 4096];
                let mut got_bytes = 0usize;
                if let Some(mut stdout) = child.stdout.take() {
                    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
                    while std::time::Instant::now() < deadline {
                        match stdout.read(&mut buf) {
                            Ok(0) => break,
                            Ok(n) => {
                                got_bytes = n;
                                break;
                            }
                            Err(_) => break,
                        }
                    }
                }
                let _ = child.kill();
                let _ = child.wait();
                Ok::<usize, String>(got_bytes)
            })
            .await;

            match res {
                Ok(Ok(0)) => McpTestResult {
                    ok: false,
                    message: "Process started but no response in 3s".into(),
                    latency_ms: None,
                },
                Ok(Ok(n)) => McpTestResult {
                    ok: true,
                    message: format!("Responded with {n} bytes"),
                    latency_ms: Some(started.elapsed().as_millis() as u32),
                },
                Ok(Err(e)) => McpTestResult {
                    ok: false,
                    message: format!("Spawn failed: {e}"),
                    latency_ms: None,
                },
                Err(e) => McpTestResult {
                    ok: false,
                    message: format!("Join failed: {e}"),
                    latency_ms: None,
                },
            }
        }
    }
}

/// Convenience for the chat layer: build a system-prompt fragment listing every
/// skill the user has enabled. Returns "" if `enabled_names` is empty.
///
/// Format intentionally matches Claude Code's pattern of telling the model which
/// skills are *available*, leaving invocation to the model's own judgment.
pub fn build_skills_system_fragment(enabled_names: &[String]) -> String {
    let all = list_skills();
    let chosen: Vec<&SkillManifest> = all
        .iter()
        .filter(|s| enabled_names.contains(&s.name))
        .collect();
    if chosen.is_empty() {
        return String::new();
    }

    let mut out = String::from(
        "The following skills are available. When a user request matches a skill's description, you may apply that skill's approach.\n\n",
    );
    for s in chosen {
        out.push_str(&format!("- **{}** — {}\n", s.name, s.description));
    }
    out
}
