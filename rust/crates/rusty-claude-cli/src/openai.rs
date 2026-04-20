/// OpenAI-compatible API client for Kimi, MiniMax, GLM, OpenAI, and any
/// provider that implements the `/v1/chat/completions` + SSE streaming interface.

use std::collections::HashMap;
use std::io;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use runtime::{AssistantEvent, ContentBlock, ConversationMessage, MessageRole, RuntimeError, TokenUsage};
use tools::DynamicToolSpec;

// ── Provider config ────────────────────────────────────────────────────────────

pub struct ProviderConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

/// Resolve provider base URL, API key env var, and actual model name from a
/// model spec like `"kimi/moonshot-v1-32k"` or plain `"moonshot-v1-32k"`.
pub fn resolve_provider(model_spec: &str) -> Result<ProviderConfig, String> {
    // Split optional `provider/model-name` prefix
    let (prefix, model) = match model_spec.find('/') {
        Some(i) => (&model_spec[..i], &model_spec[i + 1..]),
        None => ("", model_spec),
    };

    let (base_url, key_var): (String, &str) = match prefix {
        "kimi" | "moonshot" => (
            "https://api.moonshot.cn/v1".into(),
            "KIMI_API_KEY",
        ),
        "glm" | "zhipu" => (
            "https://open.bigmodel.cn/api/paas/v4".into(),
            "GLM_API_KEY",
        ),
        "minimax" => (
            "https://api.minimax.chat/v1".into(),
            "MINIMAX_API_KEY",
        ),
        "qwen" => (
            "https://dashscope.aliyuncs.com/compatible-mode/v1".into(),
            "DASHSCOPE_API_KEY",
        ),
        "openai" | "" => (
            std::env::var("OPENAI_BASE_URL")
                .unwrap_or_else(|_| "https://api.openai.com".into()),
            "OPENAI_API_KEY",
        ),
        other => (
            std::env::var("OPENAI_BASE_URL")
                .unwrap_or_else(|_| format!("https://api.{other}.com/v1")),
            "OPENAI_API_KEY",
        ),
    };

    let api_key = std::env::var(key_var)
        .or_else(|_| std::env::var("OPENAI_API_KEY"))
        .map_err(|_| {
            format!(
                "Missing API key for model '{model_spec}'. Set {key_var} (or OPENAI_API_KEY)."
            )
        })?;

    Ok(ProviderConfig {
        base_url,
        api_key,
        model: model.to_string(),
    })
}

/// Returns true if the model spec targets the Anthropic API (no prefix, starts
/// with "claude").
pub fn is_anthropic_model(model_spec: &str) -> bool {
    !model_spec.contains('/')
        && (model_spec.starts_with("claude") || model_spec.is_empty())
}

// ── Wire types (request) ───────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct OaiRequest {
    pub model: String,
    pub messages: Vec<OaiMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<OaiTool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<&'static str>,
    pub stream: bool,
    /// Ask the provider to include token counts in the final SSE chunk.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_options: Option<OaiStreamOptions>,
    pub max_completion_tokens: u32,
    /// Kimi-specific: enable preserved thinking.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<serde_json::Value>,
    /// Kimi-specific: session-level cache key for prompt caching.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_cache_key: Option<String>,
    /// OpenAI/Kimi: force JSON output with optional schema.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_format: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct OaiStreamOptions {
    pub include_usage: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct OaiMessage {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<OaiToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OaiToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: OaiToolCallFn,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OaiToolCallFn {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct OaiTool {
    #[serde(rename = "type")]
    pub tool_type: String,
    pub function: OaiToolDef,
}

#[derive(Debug, Serialize, Clone)]
pub struct OaiToolDef {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub parameters: Value,
}

// ── Wire types (streaming response) ───────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct OaiChunk {
    choices: Vec<OaiChoice>,
    #[serde(default)]
    usage: Option<OaiUsage>,
}

#[derive(Debug, Deserialize)]
struct OaiChoice {
    delta: OaiDelta,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct OaiDelta {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Option<Vec<OaiToolCallDelta>>,
    #[serde(default)]
    reasoning_content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OaiToolCallDelta {
    index: usize,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    function: Option<OaiFnDelta>,
}

#[derive(Debug, Deserialize)]
struct OaiFnDelta {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    arguments: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OaiUsage {
    prompt_tokens: u32,
    completion_tokens: u32,
}

// ── Message conversion ─────────────────────────────────────────────────────────

/// Convert our internal conversation format to OpenAI's messages array.
pub fn to_openai_messages(
    system_prompt: &[String],
    messages: &[ConversationMessage],
) -> Vec<OaiMessage> {
    let mut result = Vec::new();

    if !system_prompt.is_empty() {
        result.push(OaiMessage {
            role: "system".to_string(),
            content: Some(system_prompt.join("\n\n")),
            tool_calls: None,
            tool_call_id: None,
        });
    }

    for msg in messages {
        match msg.role {
            MessageRole::System => {
                for block in &msg.blocks {
                    if let ContentBlock::Text { text } = block {
                        result.push(OaiMessage {
                            role: "system".to_string(),
                            content: Some(text.clone()),
                            tool_calls: None,
                            tool_call_id: None,
                        });
                    }
                }
            }
            MessageRole::User => {
                let text: String = msg
                    .blocks
                    .iter()
                    .filter_map(|b| match b {
                        ContentBlock::Text { text } => Some(text.as_str()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                if !text.is_empty() {
                    result.push(OaiMessage {
                        role: "user".to_string(),
                        content: Some(text),
                        tool_calls: None,
                        tool_call_id: None,
                    });
                }
            }
            MessageRole::Assistant => {
                let text: String = msg
                    .blocks
                    .iter()
                    .filter_map(|b| match b {
                        ContentBlock::Text { text } => Some(text.as_str()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join("");

                let tool_calls: Vec<OaiToolCall> = msg
                    .blocks
                    .iter()
                    .filter_map(|b| match b {
                        ContentBlock::ToolUse { id, name, input } => Some(OaiToolCall {
                            id: id.clone(),
                            call_type: "function".to_string(),
                            function: OaiToolCallFn {
                                name: name.clone(),
                                arguments: input.clone(),
                            },
                        }),
                        _ => None,
                    })
                    .collect();

                result.push(OaiMessage {
                    role: "assistant".to_string(),
                    // OpenAI requires content=null when tool_calls is present
                    content: if tool_calls.is_empty() { Some(text) } else { None },
                    tool_calls: if tool_calls.is_empty() {
                        None
                    } else {
                        Some(tool_calls)
                    },
                    tool_call_id: None,
                });
            }
            MessageRole::Tool => {
                // Each tool result becomes a separate "tool" role message
                for block in &msg.blocks {
                    if let ContentBlock::ToolResult {
                        tool_use_id,
                        output,
                        ..
                    } = block
                    {
                        result.push(OaiMessage {
                            role: "tool".to_string(),
                            content: Some(output.clone()),
                            tool_calls: None,
                            tool_call_id: Some(tool_use_id.clone()),
                        });
                    }
                }
            }
        }
    }

    result
}

/// Convert our tool specs to OpenAI's function-calling format.
pub fn to_openai_tools(specs: &[DynamicToolSpec]) -> Vec<OaiTool> {
    specs
        .iter()
        .map(|spec| OaiTool {
            tool_type: "function".to_string(),
            function: OaiToolDef {
                name: spec.name.clone(),
                description: Some(spec.description.clone()),
                parameters: spec.input_schema.clone(),
            },
        })
        .collect()
}

// ── HTTP + SSE streaming ───────────────────────────────────────────────────────

/// Send a streaming chat-completion request and return all `AssistantEvent`s.
/// Text tokens are printed to stdout as each SSE chunk arrives.
/// Ctrl+C during streaming stops the turn and returns a partial response.
pub async fn stream_completion(
    http: &Client,
    config: &ProviderConfig,
    request: &OaiRequest,
) -> Result<Vec<AssistantEvent>, RuntimeError> {
    let url = format!(
        "{}/chat/completions",
        config.base_url.trim_end_matches('/')
    );

    let resp = http
        .post(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .json(request)
        .send()
        .await
        .map_err(|e| RuntimeError::new(format!("OpenAI-compat request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(RuntimeError::new(format!(
            "OpenAI-compat API error {status}: {body}"
        )));
    }

    stream_sse_response(resp).await
}

/// Read the SSE response chunk-by-chunk, printing text deltas immediately.
async fn stream_sse_response(
    mut resp: reqwest::Response,
) -> Result<Vec<AssistantEvent>, RuntimeError> {
    let mut events: Vec<AssistantEvent> = Vec::new();
    let mut pending_tools: HashMap<usize, (String, String, String)> = HashMap::new();
    let mut input_tokens = 0u32;
    let mut output_tokens = 0u32;
    let mut stdout = io::stdout();
    // Partial line carried across chunk boundaries
    let mut line_buf = String::new();
    let mut interrupted = false;

    'outer: loop {
        tokio::select! {
            chunk_result = resp.chunk() => {
                let bytes = match chunk_result
                    .map_err(|e| RuntimeError::new(format!("SSE read error: {e}")))?
                {
                    Some(b) => b,
                    None => break 'outer, // connection closed
                };

                line_buf.push_str(&String::from_utf8_lossy(&bytes));

                // Process every complete line in the buffer
                while let Some(nl) = line_buf.find('\n') {
                    let line = line_buf[..nl].trim_end_matches('\r').to_string();
                    line_buf.drain(..=nl);

                    if process_sse_line(
                        &line,
                        &mut events,
                        &mut pending_tools,
                        &mut input_tokens,
                        &mut output_tokens,
                        &mut stdout,
                    ) {
                        break 'outer; // saw [DONE]
                    }
                }
            }
            _ = tokio::signal::ctrl_c() => {
                eprintln!("\nInterrupted.");
                interrupted = true;
                break 'outer;
            }
        }
    }

    finalize_events(
        &mut events,
        &mut pending_tools,
        input_tokens,
        output_tokens,
        interrupted,
    );
    Ok(events)
}

/// Process a single SSE line; returns `true` if `[DONE]` was seen.
fn process_sse_line(
    line: &str,
    events: &mut Vec<AssistantEvent>,
    pending_tools: &mut HashMap<usize, (String, String, String)>,
    input_tokens: &mut u32,
    output_tokens: &mut u32,
    stdout: &mut impl io::Write,
) -> bool {
    let data = match line.strip_prefix("data: ") {
        Some(d) => d,
        None => return false,
    };

    if data == "[DONE]" {
        return true;
    }

    let chunk: OaiChunk = match serde_json::from_str(data) {
        Ok(c) => c,
        Err(_) => return false,
    };

    if let Some(usage) = chunk.usage {
        *input_tokens = usage.prompt_tokens;
        *output_tokens = usage.completion_tokens;
    }

    for choice in &chunk.choices {
        if let Some(reasoning) = &choice.delta.reasoning_content {
            if !reasoning.is_empty() {
                events.push(AssistantEvent::ThinkingDelta(reasoning.clone()));
            }
        }

        if let Some(content) = &choice.delta.content {
            if !content.is_empty() {
                let _ = write!(stdout, "{content}");
                let _ = stdout.flush();
                events.push(AssistantEvent::TextDelta(content.clone()));
            }
        }

        if let Some(tool_calls) = &choice.delta.tool_calls {
            for tc in tool_calls {
                let entry = pending_tools
                    .entry(tc.index)
                    .or_insert_with(|| (String::new(), String::new(), String::new()));
                if let Some(id) = &tc.id {
                    if !id.is_empty() {
                        entry.0 = id.clone();
                    }
                }
                if let Some(f) = &tc.function {
                    if let Some(name) = &f.name {
                        if !name.is_empty() {
                            entry.1 = name.clone();
                        }
                    }
                    if let Some(args) = &f.arguments {
                        entry.2.push_str(args);
                    }
                }
            }
        }

        if matches!(
            choice.finish_reason.as_deref(),
            Some("tool_calls") | Some("stop") | Some("end_turn")
        ) {
            for (_, (id, name, input)) in pending_tools.drain() {
                events.push(AssistantEvent::ToolUse { id, name, input });
            }
            events.push(AssistantEvent::MessageStop);
        }
    }

    false
}

/// Seal off the event stream: flush any pending tool calls, ensure a
/// MessageStop exists, and append token usage if available.
fn finalize_events(
    events: &mut Vec<AssistantEvent>,
    pending_tools: &mut HashMap<usize, (String, String, String)>,
    input_tokens: u32,
    output_tokens: u32,
    interrupted: bool,
) {
    if !events.iter().any(|e| matches!(e, AssistantEvent::MessageStop)) {
        // Interrupted before a finish_reason arrived — ensure session stays valid
        if interrupted
            && !events
                .iter()
                .any(|e| matches!(e, AssistantEvent::TextDelta(_)))
        {
            events.push(AssistantEvent::TextDelta("[Interrupted]".to_string()));
        }
        for (_, (id, name, input)) in pending_tools.drain() {
            events.push(AssistantEvent::ToolUse { id, name, input });
        }
        events.push(AssistantEvent::MessageStop);
    }

    if input_tokens > 0 || output_tokens > 0 {
        events.push(AssistantEvent::Usage(TokenUsage {
            input_tokens,
            output_tokens,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
        }));
    }
}
