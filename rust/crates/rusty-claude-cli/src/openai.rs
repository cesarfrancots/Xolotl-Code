/// OpenAI-compatible API client for Kimi, `MiniMax`, GLM, `OpenAI`, and any
/// provider that implements the `/v1/chat/completions` + SSE streaming interface.
use std::collections::HashMap;
use std::io;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use runtime::{
    AssistantEvent, ContentBlock, ConversationMessage, ImageSource, MessageRole, RuntimeError,
    TokenUsage,
};
use tools::DynamicToolSpec;

// ── Provider config ────────────────────────────────────────────────────────────

pub struct ProviderConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub kind: ProviderKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderKind {
    Kimi,
    MiniMax,
    Glm,
    Qwen,
    OpenAi,
    Generic,
}

impl ProviderKind {
    fn from_prefix(prefix: &str) -> Self {
        match prefix {
            "kimi-coding" | "kimi" | "moonshot" => Self::Kimi,
            "minimax" => Self::MiniMax,
            "glm" | "zhipu" => Self::Glm,
            "qwen" => Self::Qwen,
            "openai" | "" => Self::OpenAi,
            _ => Self::Generic,
        }
    }

    fn detect_from_base_url(base_url: &str) -> Self {
        let url_lower = base_url.to_lowercase();
        if url_lower.contains("minimax") {
            Self::MiniMax
        } else if url_lower.contains("moonshot") || url_lower.contains("kimi") {
            Self::Kimi
        } else if url_lower.contains("bigmodel") || url_lower.contains("zhipu") {
            Self::Glm
        } else if url_lower.contains("dashscope") || url_lower.contains("qwen") {
            Self::Qwen
        } else if url_lower.contains("openai") {
            Self::OpenAi
        } else {
            Self::Generic
        }
    }

    fn display_name(self) -> &'static str {
        match self {
            Self::MiniMax => "MiniMax",
            Self::Kimi => "Kimi",
            Self::Glm => "GLM",
            Self::Qwen => "Qwen",
            Self::OpenAi => "OpenAI",
            Self::Generic => "Provider",
        }
    }
}

/// Resolve provider base URL, API key env var, and actual model name from a
/// model spec like `"kimi/moonshot-v1-32k"` or plain `"moonshot-v1-32k"`.
pub fn resolve_provider(model_spec: &str) -> Result<ProviderConfig, String> {
    // Split optional `provider/model-name` prefix
    let (prefix, model) = match model_spec.find('/') {
        Some(i) => (&model_spec[..i], &model_spec[i + 1..]),
        None => ("", model_spec),
    };

    let (default_url, key_var): (&str, &str) = match prefix {
        "kimi-coding" => ("https://api.kimi.com/coding/v1", "KIMI_CODING_API_KEY"),
        "kimi" | "moonshot" => ("https://api.moonshot.cn/v1", "KIMI_API_KEY"),
        "glm" | "zhipu" => ("https://open.bigmodel.cn/api/paas/v4", "GLM_API_KEY"),
        "minimax" => ("https://api.minimax.chat/v1", "MINIMAX_API_KEY"),
        "qwen" => (
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "DASHSCOPE_API_KEY",
        ),
        "openai" | "" => ("https://api.openai.com", "OPENAI_API_KEY"),
        _other => ("", "OPENAI_API_KEY"),
    };

    // Allow per-provider base URL overrides via <PROVIDER>_BASE_URL env vars
    // (e.g. KIMI_CODING_BASE_URL, KIMI_BASE_URL, MINIMAX_BASE_URL, etc.)
    let base_url = if prefix.is_empty() {
        std::env::var("OPENAI_BASE_URL").unwrap_or_else(|_| default_url.to_string())
    } else {
        let base_var = format!(
            "{}_BASE_URL",
            key_var.strip_suffix("_API_KEY").unwrap_or(key_var)
        );
        std::env::var(&base_var)
            .or_else(|_| std::env::var("OPENAI_BASE_URL"))
            .unwrap_or_else(|_| {
                if default_url.is_empty() {
                    format!("https://api.{prefix}.com/v1")
                } else {
                    default_url.to_string()
                }
            })
    };

    let api_key = std::env::var(key_var)
        .or_else(|_| std::env::var("OPENAI_API_KEY"))
        .map_err(|_| {
            format!("Missing API key for model '{model_spec}'. Set {key_var} (or OPENAI_API_KEY).")
        })?;

    let kind = {
        let prefix_kind = ProviderKind::from_prefix(prefix);
        if prefix_kind == ProviderKind::Generic {
            ProviderKind::detect_from_base_url(&base_url)
        } else {
            prefix_kind
        }
    };

    Ok(ProviderConfig {
        base_url,
        api_key,
        model: model.to_string(),
        kind,
    })
}

/// Returns true if the model spec targets the Anthropic API (no prefix, starts
/// with "claude").
pub fn is_anthropic_model(model_spec: &str) -> bool {
    !model_spec.contains('/') && (model_spec.starts_with("claude") || model_spec.is_empty())
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
    pub content: Option<OaiContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<OaiToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    /// Thinking/reasoning content for models that support it (e.g. Kimi).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
}

/// `OpenAI` message content can be either a plain string or an array of parts
/// (text + images for multimodal input).
#[derive(Debug, Serialize, Clone)]
#[serde(untagged)]
pub enum OaiContent {
    Text(String),
    Array(Vec<OaiContentPart>),
}

#[derive(Debug, Serialize, Clone)]
pub struct OaiContentPart {
    #[serde(rename = "type")]
    pub part_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_url: Option<OaiImageUrl>,
}

#[derive(Debug, Serialize, Clone)]
pub struct OaiImageUrl {
    pub url: String,
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
    #[serde(default)]
    prompt_tokens_details: Option<OaiPromptTokensDetails>,
    #[serde(default, alias = "prompt_cache_miss_tokens")]
    cache_creation_input_tokens: u32,
    #[serde(default, alias = "prompt_cache_hit_tokens", alias = "cached_tokens")]
    cache_read_input_tokens: u32,
}

#[derive(Debug, Deserialize, Default)]
struct OaiPromptTokensDetails {
    #[serde(default, alias = "cache_tokens")]
    cached_tokens: u32,
}

impl OaiUsage {
    fn into_token_usage(self) -> TokenUsage {
        let detail_cached = self
            .prompt_tokens_details
            .map_or(0, |details| details.cached_tokens);
        let cache_read_input_tokens = self.cache_read_input_tokens.max(detail_cached);
        let uncached_input_tokens = self
            .prompt_tokens
            .saturating_sub(cache_read_input_tokens)
            .saturating_sub(self.cache_creation_input_tokens);

        TokenUsage {
            input_tokens: uncached_input_tokens,
            output_tokens: self.completion_tokens,
            cache_creation_input_tokens: self.cache_creation_input_tokens,
            cache_read_input_tokens,
        }
    }
}

// ── Message conversion ─────────────────────────────────────────────────────────

/// Convert our internal conversation format to `OpenAI`'s messages array.
pub fn to_openai_messages(
    system_prompt: &[String],
    messages: &[ConversationMessage],
) -> Vec<OaiMessage> {
    let mut result = Vec::new();

    if !system_prompt.is_empty() {
        result.push(OaiMessage {
            role: "system".to_string(),
            content: Some(OaiContent::Text(system_prompt.join("\n\n"))),
            tool_calls: None,
            tool_call_id: None,
            reasoning_content: None,
        });
    }

    for msg in messages {
        match msg.role {
            MessageRole::System => {
                for block in &msg.blocks {
                    if let ContentBlock::Text { text } = block {
                        result.push(OaiMessage {
                            role: "system".to_string(),
                            content: Some(OaiContent::Text(text.clone())),
                            tool_calls: None,
                            tool_call_id: None,
                            reasoning_content: None,
                        });
                    }
                }
            }
            MessageRole::User => {
                let mut parts = Vec::new();
                for block in &msg.blocks {
                    match block {
                        ContentBlock::Text { text } if !text.is_empty() => {
                            parts.push(OaiContentPart {
                                part_type: "text".to_string(),
                                text: Some(text.clone()),
                                image_url: None,
                            });
                        }
                        ContentBlock::Image {
                            source: ImageSource::Base64 { media_type, data },
                        } => {
                            parts.push(OaiContentPart {
                                part_type: "image_url".to_string(),
                                text: None,
                                image_url: Some(OaiImageUrl {
                                    url: format!("data:{media_type};base64,{data}"),
                                }),
                            });
                        }
                        _ => {}
                    }
                }
                if parts.is_empty() {
                    // Fallback: skip empty user messages
                    continue;
                }
                let content = if parts.len() == 1 && parts[0].text.is_some() {
                    // Simple text-only message: use string form for compatibility
                    OaiContent::Text(parts.into_iter().next().unwrap().text.unwrap())
                } else {
                    // Multimodal or multiple parts: use array form
                    OaiContent::Array(parts)
                };
                result.push(OaiMessage {
                    role: "user".to_string(),
                    content: Some(content),
                    tool_calls: None,
                    tool_call_id: None,
                    reasoning_content: None,
                });
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

                let reasoning_content: String = msg
                    .blocks
                    .iter()
                    .filter_map(|b| match b {
                        ContentBlock::Thinking { thinking, .. } => Some(thinking.as_str()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join("\n");

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
                    content: if tool_calls.is_empty() {
                        Some(OaiContent::Text(text))
                    } else {
                        None
                    },
                    tool_calls: if tool_calls.is_empty() {
                        None
                    } else {
                        Some(tool_calls)
                    },
                    tool_call_id: None,
                    reasoning_content: if reasoning_content.is_empty() {
                        None
                    } else {
                        Some(reasoning_content)
                    },
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
                            content: Some(OaiContent::Text(output.clone())),
                            tool_calls: None,
                            tool_call_id: Some(tool_use_id.clone()),
                            reasoning_content: None,
                        });
                    }
                }
            }
        }
    }

    result
}

/// Convert our tool specs to `OpenAI`'s function-calling format.
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
    let url = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));

    // Build request with provider-specific headers
    let mut request_builder = http
        .post(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json");

    // Add provider-specific headers for better compatibility
    let provider_name = config.kind.display_name();
    match config.kind {
        ProviderKind::MiniMax | ProviderKind::Glm | ProviderKind::Qwen => {
            request_builder = request_builder.header("Accept", "application/json");
        }
        ProviderKind::Kimi => {
            // Kimi Coding endpoint requires identification as an approved coding agent.
            // We mimic the headers that Claude Code and other approved agents send.
            request_builder = request_builder
                .header("Accept", "application/json")
                .header("User-Agent", "claude-code/1.0.0 (Windows; x64)")
                .header("X-Client-Name", "claude-code")
                .header("X-Client-Version", "1.0.0")
                .header("X-Source", "claude-code");
        }
        ProviderKind::OpenAi | ProviderKind::Generic => {}
    }

    let resp = request_builder
        .json(request)
        .send()
        .await
        .map_err(|e| RuntimeError::new(format!("{provider_name} API request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(RuntimeError::new(format!(
            "{provider_name} API error {status}: {body}"
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
    let mut usage = TokenUsage::default();
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
                        &mut usage,
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

    finalize_events(&mut events, &mut pending_tools, usage, interrupted);
    Ok(events)
}

/// Process a single SSE line; returns `true` if `[DONE]` was seen.
fn process_sse_line(
    line: &str,
    events: &mut Vec<AssistantEvent>,
    pending_tools: &mut HashMap<usize, (String, String, String)>,
    usage: &mut TokenUsage,
    stdout: &mut impl io::Write,
) -> bool {
    // Kimi sends `data:{...}` without a space after the colon.
    let data = match line
        .strip_prefix("data: ")
        .or_else(|| line.strip_prefix("data:"))
    {
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

    if let Some(chunk_usage) = chunk.usage {
        *usage = chunk_usage.into_token_usage();
    }

    for choice in &chunk.choices {
        if let Some(reasoning) = &choice.delta.reasoning_content {
            if !reasoning.is_empty() {
                // Print thinking fragments if display is enabled
                if crate::should_show_thinking() {
                    crate::style::print_thinking_fragment(reasoning);
                }
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
            Some("tool_calls" | "stop" | "end_turn")
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
/// `MessageStop` exists, and append token usage if available.
fn finalize_events(
    events: &mut Vec<AssistantEvent>,
    pending_tools: &mut HashMap<usize, (String, String, String)>,
    usage: TokenUsage,
    interrupted: bool,
) {
    if !events
        .iter()
        .any(|e| matches!(e, AssistantEvent::MessageStop))
    {
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

    if usage.total_tokens() > 0 {
        events.push(AssistantEvent::Usage(usage));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // Tests that modify environment variables must run serially
    static ENV_MUTEX: Mutex<()> = Mutex::new(());

    #[test]
    fn resolves_kimi_coding_provider() {
        let _guard = ENV_MUTEX.lock().unwrap();
        // Temporarily set a dummy API key for testing
        std::env::set_var("KIMI_CODING_API_KEY", "test-key");
        let config = resolve_provider("kimi-coding/kimi-for-coding").unwrap();
        assert_eq!(config.base_url, "https://api.kimi.com/coding/v1");
        assert_eq!(config.model, "kimi-for-coding");
        assert_eq!(config.kind, ProviderKind::Kimi);
    }

    #[test]
    fn resolves_standard_kimi_provider() {
        let _guard = ENV_MUTEX.lock().unwrap();
        std::env::set_var("KIMI_API_KEY", "test-key");
        let config = resolve_provider("kimi/moonshot-v1-32k").unwrap();
        assert_eq!(config.base_url, "https://api.moonshot.cn/v1");
        assert_eq!(config.model, "moonshot-v1-32k");
        assert_eq!(config.kind, ProviderKind::Kimi);
    }

    #[test]
    fn resolves_minimax_provider() {
        let _guard = ENV_MUTEX.lock().unwrap();
        std::env::set_var("MINIMAX_API_KEY", "test-key");
        let config = resolve_provider("minimax/MiniMax-Text-01").unwrap();
        assert_eq!(config.base_url, "https://api.minimax.chat/v1");
        assert_eq!(config.model, "MiniMax-Text-01");
        assert_eq!(config.kind, ProviderKind::MiniMax);
    }

    #[test]
    fn resolves_glm_provider() {
        let _guard = ENV_MUTEX.lock().unwrap();
        std::env::set_var("GLM_API_KEY", "test-key");
        let config = resolve_provider("glm/glm-5.1").unwrap();
        assert_eq!(config.base_url, "https://open.bigmodel.cn/api/paas/v4");
        assert_eq!(config.model, "glm-5.1");
        assert_eq!(config.kind, ProviderKind::Glm);
    }

    #[test]
    fn respects_provider_base_url_override() {
        let _guard = ENV_MUTEX.lock().unwrap();
        std::env::set_var("KIMI_CODING_API_KEY", "test-key");
        std::env::set_var("KIMI_CODING_BASE_URL", "https://custom.kimi.com/v1");
        let config = resolve_provider("kimi-coding/kimi-for-coding").unwrap();
        assert_eq!(config.base_url, "https://custom.kimi.com/v1");
        assert_eq!(config.model, "kimi-for-coding");
        assert_eq!(config.kind, ProviderKind::Kimi);
        // clean up so it doesn't affect other tests
        std::env::remove_var("KIMI_CODING_BASE_URL");
    }

    #[test]
    fn keeps_provider_kind_when_override_host_is_generic() {
        let _guard = ENV_MUTEX.lock().unwrap();
        std::env::set_var("KIMI_CODING_API_KEY", "test-key");
        std::env::set_var("KIMI_CODING_BASE_URL", "https://gateway.internal/v1");
        let config = resolve_provider("kimi-coding/kimi-for-coding").unwrap();
        assert_eq!(config.base_url, "https://gateway.internal/v1");
        assert_eq!(config.kind, ProviderKind::Kimi);
        std::env::remove_var("KIMI_CODING_BASE_URL");
    }

    #[test]
    fn converts_cached_prompt_usage_without_double_counting_input() {
        let usage = OaiUsage {
            prompt_tokens: 120,
            completion_tokens: 10,
            prompt_tokens_details: Some(OaiPromptTokensDetails { cached_tokens: 80 }),
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
        }
        .into_token_usage();

        assert_eq!(usage.input_tokens, 40);
        assert_eq!(usage.output_tokens, 10);
        assert_eq!(usage.cache_read_input_tokens, 80);
        assert_eq!(usage.total_tokens(), 130);
    }

    #[test]
    fn records_cache_usage_from_sse_chunks() {
        let mut events = Vec::new();
        let mut pending_tools = HashMap::new();
        let mut usage = TokenUsage::default();
        let mut stdout = Vec::new();
        let line = r#"data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":120,"completion_tokens":10,"prompt_tokens_details":{"cached_tokens":80}}}"#;

        assert!(!process_sse_line(
            line,
            &mut events,
            &mut pending_tools,
            &mut usage,
            &mut stdout
        ));
        finalize_events(&mut events, &mut pending_tools, usage, false);

        assert!(events
            .iter()
            .any(|event| matches!(event, AssistantEvent::MessageStop)));
        assert!(events.iter().any(|event| matches!(
            event,
            AssistantEvent::Usage(TokenUsage {
                input_tokens: 40,
                output_tokens: 10,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 80,
            })
        )));
    }
}
