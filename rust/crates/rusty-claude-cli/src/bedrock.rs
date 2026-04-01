/// AWS Bedrock runtime client.
///
/// Supports two authentication modes:
///
/// **Simple API key** (recommended): Set `BEDROCK_API_KEY` — uses Bearer token auth,
/// no AWS credentials needed. Create a key in the Bedrock console.
///
/// **IAM / Sig V4**: Set `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (+ optional
/// `AWS_SESSION_TOKEN` and `AWS_DEFAULT_REGION`).
///
/// Uses the streaming `/invoke-with-response-stream` endpoint so tokens appear in
/// real time, exactly like the Anthropic and OpenAI clients.

use std::io::{self, Write};

use reqwest::Client;
use ring::{digest, hmac};

use runtime::{ApiClient, ApiRequest, AssistantEvent, RuntimeError, TokenUsage};
use tools::{DynamicToolSpec, mvp_tool_specs};

// ── Auth ──────────────────────────────────────────────────────────────────────

pub enum BedrockAuth {
    /// Bearer token from the Bedrock console — set `BEDROCK_API_KEY`.
    ApiKey(String),
    /// Traditional IAM credentials — AWS Sig V4.
    SigV4 {
        access_key: String,
        secret_key: String,
        session_token: Option<String>,
    },
}

pub struct BedrockConfig {
    pub region: String,
    pub model_id: String,
    pub auth: BedrockAuth,
}

/// Parse a `bedrock/global.anthropic.claude-sonnet-4-6-v1` model spec and choose
/// auth based on available env vars.
///
/// Priority:
/// 1. `BEDROCK_API_KEY` → Bearer token (simple, recommended)
/// 2. `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` → Sig V4
pub fn resolve_bedrock(model_spec: &str) -> Result<BedrockConfig, String> {
    let model_id = model_spec
        .strip_prefix("bedrock/")
        .unwrap_or(model_spec)
        .to_string();

    let region = std::env::var("AWS_DEFAULT_REGION")
        .or_else(|_| std::env::var("AWS_REGION"))
        .unwrap_or_else(|_| "us-east-1".to_string());

    let auth = if let Ok(key) = std::env::var("BEDROCK_API_KEY") {
        BedrockAuth::ApiKey(key)
    } else {
        let access_key = std::env::var("AWS_ACCESS_KEY_ID").map_err(|_| {
            "No Bedrock credentials found. Set BEDROCK_API_KEY (simple) \
             or AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (IAM)."
                .to_string()
        })?;
        let secret_key = std::env::var("AWS_SECRET_ACCESS_KEY").map_err(|_| {
            "AWS_SECRET_ACCESS_KEY is required when using IAM credentials.".to_string()
        })?;
        let session_token = std::env::var("AWS_SESSION_TOKEN").ok();
        BedrockAuth::SigV4 {
            access_key,
            secret_key,
            session_token,
        }
    };

    Ok(BedrockConfig {
        region,
        model_id,
        auth,
    })
}

pub fn is_bedrock_model(model_spec: &str) -> bool {
    model_spec.starts_with("bedrock/")
}

/// Percent-encode a path segment. Colons in model IDs like `v1:0` must be
/// encoded as `%3A` for the Bedrock REST URL to work.
fn url_encode_path_segment(s: &str) -> String {
    let mut encoded = String::with_capacity(s.len() * 2);
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => {
                encoded.push_str(&format!("%{byte:02X}"));
            }
        }
    }
    encoded
}

// ── AWS Signature V4 ──────────────────────────────────────────────────────────

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn sha256_hex(data: &[u8]) -> String {
    hex_encode(digest::digest(&digest::SHA256, data).as_ref())
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let k = hmac::Key::new(hmac::HMAC_SHA256, key);
    hmac::sign(&k, data).as_ref().to_vec()
}

struct SigV4Headers {
    authorization: String,
    x_amz_date: String,
    x_amz_content_sha256: String,
    x_amz_security_token: Option<String>,
}

fn sign_request(
    method: &str,
    host: &str,
    path: &str,
    body: &[u8],
    access_key: &str,
    secret_key: &str,
    session_token: Option<&str>,
    region: &str,
    datetime: &str, // YYYYMMDDTHHMMSSZ
) -> SigV4Headers {
    let service = "bedrock";
    let date = &datetime[..8];
    let body_hash = sha256_hex(body);

    let token_owned = session_token.map(str::to_string);
    let mut header_pairs: Vec<(&str, &str)> = vec![
        ("content-type", "application/json"),
        ("host", host),
        ("x-amz-content-sha256", &body_hash),
        ("x-amz-date", datetime),
    ];
    if let Some(ref tok) = token_owned {
        header_pairs.push(("x-amz-security-token", tok));
    }
    header_pairs.sort_by_key(|(k, _)| *k);

    let canonical_headers: String = header_pairs
        .iter()
        .map(|(k, v)| format!("{k}:{v}\n"))
        .collect();
    let signed_headers: String = header_pairs
        .iter()
        .map(|(k, _)| *k)
        .collect::<Vec<_>>()
        .join(";");

    let canonical_request = format!(
        "{method}\n{path}\n\n{canonical_headers}\n{signed_headers}\n{body_hash}"
    );

    let credential_scope = format!("{date}/{region}/{service}/aws4_request");
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{datetime}\n{credential_scope}\n{}",
        sha256_hex(canonical_request.as_bytes())
    );

    let k_date = hmac_sha256(format!("AWS4{secret_key}").as_bytes(), date.as_bytes());
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, service.as_bytes());
    let k_signing = hmac_sha256(&k_service, b"aws4_request");
    let signature = hex_encode(&hmac_sha256(&k_signing, string_to_sign.as_bytes()));

    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={access_key}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}"
    );

    SigV4Headers {
        authorization,
        x_amz_date: datetime.to_string(),
        x_amz_content_sha256: body_hash,
        x_amz_security_token: token_owned,
    }
}

fn utc_compact() -> String {
    let total_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let sec = total_secs % 60;
    let min = (total_secs / 60) % 60;
    let hour = (total_secs / 3600) % 24;
    let mut days = total_secs / 86400;

    let mut year = 1970_u32;
    loop {
        let in_year: u64 = if leap(year) { 366 } else { 365 };
        if days < in_year {
            break;
        }
        days -= in_year;
        year += 1;
    }
    let month_days: [u64; 12] = if leap(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut month = 1_u32;
    for &md in &month_days {
        if days < md {
            break;
        }
        days -= md;
        month += 1;
    }
    let day = days + 1;

    format!("{year:04}{month:02}{day:02}T{hour:02}{min:02}{sec:02}Z")
}

fn leap(year: u32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

// ── AWS event-stream frame decoder ────────────────────────────────────────────
//
// Bedrock's streaming endpoint returns a binary framing protocol:
//
//   [total_length: u32 BE]
//   [headers_length: u32 BE]
//   [prelude_crc: u32 BE]      ← crc32 of the first 8 bytes
//   [headers: bytes]
//   [payload: bytes]
//   [message_crc: u32 BE]      ← crc32 of everything before this field
//
// Each frame carries one JSON event. The `:event-type` header identifies the
// event. For Anthropic models the relevant event type is `chunk`, and the
// payload is the familiar Anthropic SSE JSON object
// (`{"type":"content_block_delta",...}`).

fn crc32(data: &[u8]) -> u32 {
    // CRC-32/ISO-HDLC (standard Ethernet CRC, same as used by AWS)
    const POLY: u32 = 0xEDB8_8320;
    let mut crc: u32 = 0xFFFF_FFFF;
    for &byte in data {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ POLY;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}

/// Extract the event-type value from the binary headers section.
/// Headers are encoded as: [name_len: u8][name: bytes][type: u8][value_len: u16 BE][value: bytes]
fn parse_event_type(headers: &[u8]) -> Option<String> {
    let mut pos = 0;
    while pos < headers.len() {
        if pos >= headers.len() {
            break;
        }
        let name_len = headers[pos] as usize;
        pos += 1;
        if pos + name_len > headers.len() {
            break;
        }
        let name = std::str::from_utf8(&headers[pos..pos + name_len]).ok()?;
        pos += name_len;
        // header value type byte
        if pos >= headers.len() {
            break;
        }
        let _hdr_type = headers[pos];
        pos += 1;
        // value length (u16 BE)
        if pos + 2 > headers.len() {
            break;
        }
        let val_len = u16::from_be_bytes([headers[pos], headers[pos + 1]]) as usize;
        pos += 2;
        if pos + val_len > headers.len() {
            break;
        }
        let value = std::str::from_utf8(&headers[pos..pos + val_len]).ok()?;
        pos += val_len;

        if name == ":event-type" {
            return Some(value.to_string());
        }
    }
    None
}

/// Decode one AWS event-stream frame from `buf` starting at `offset`.
/// Returns `(event_type, payload_bytes, next_offset)` or `None` if not enough data.
fn decode_frame(buf: &[u8], offset: usize) -> Option<(String, Vec<u8>, usize)> {
    if buf.len() < offset + 12 {
        return None; // need at least prelude + trailing crc
    }
    let total_len =
        u32::from_be_bytes([buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]])
            as usize;
    if buf.len() < offset + total_len {
        return None; // incomplete frame
    }
    let headers_len =
        u32::from_be_bytes([buf[offset + 4], buf[offset + 5], buf[offset + 6], buf[offset + 7]])
            as usize;

    // Verify prelude CRC (first 8 bytes)
    let prelude_crc_expected = u32::from_be_bytes([
        buf[offset + 8],
        buf[offset + 9],
        buf[offset + 10],
        buf[offset + 11],
    ]);
    let prelude_crc_actual = crc32(&buf[offset..offset + 8]);
    if prelude_crc_expected != prelude_crc_actual {
        // CRC mismatch — skip this frame (corrupt data)
        return None;
    }

    let headers_start = offset + 12;
    let headers_end = headers_start + headers_len;
    let payload_start = headers_end;
    let payload_end = offset + total_len - 4; // exclude trailing message CRC

    if payload_end > offset + total_len || headers_end > payload_end {
        return None;
    }

    let headers = &buf[headers_start..headers_end];
    let payload = buf[payload_start..payload_end].to_vec();
    let event_type = parse_event_type(headers).unwrap_or_default();

    Some((event_type, payload, offset + total_len))
}

// ── Streaming event processing ─────────────────────────────────────────────

/// Process a single Anthropic streaming event JSON object.
/// Mirrors the event types from the Anthropic Messages API SSE stream.
fn process_bedrock_chunk(
    chunk_json: &serde_json::Value,
    stdout: &mut impl Write,
    events: &mut Vec<AssistantEvent>,
    pending_tool: &mut Option<(String, String, String)>, // (id, name, accumulated_input)
    usage_out: &mut Option<TokenUsage>,
) -> Result<bool, RuntimeError> {
    // Returns true if this was a message_stop event
    let event_type = chunk_json
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    match event_type {
        "message_start" => {
            // May contain initial usage
            if let Some(usage) = chunk_json
                .pointer("/message/usage")
                .and_then(|u| parse_token_usage(u))
            {
                *usage_out = Some(usage);
            }
        }
        "content_block_start" => {
            let block = chunk_json.get("content_block");
            if let Some(block) = block {
                let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if block_type == "tool_use" {
                    let id = block
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let name = block
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    *pending_tool = Some((id, name, String::new()));
                } else if block_type == "text" {
                    // Initial text (usually empty)
                    if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                        if !text.is_empty() {
                            let _ = write!(stdout, "{text}");
                            let _ = stdout.flush();
                            events.push(AssistantEvent::TextDelta(text.to_string()));
                        }
                    }
                }
            }
        }
        "content_block_delta" => {
            let delta = chunk_json.get("delta");
            if let Some(delta) = delta {
                let delta_type = delta.get("type").and_then(|v| v.as_str()).unwrap_or("");
                match delta_type {
                    "text_delta" => {
                        if let Some(text) = delta.get("text").and_then(|v| v.as_str()) {
                            if !text.is_empty() {
                                let _ = write!(stdout, "{text}");
                                let _ = stdout.flush();
                                events.push(AssistantEvent::TextDelta(text.to_string()));
                            }
                        }
                    }
                    "input_json_delta" => {
                        if let Some(partial) =
                            delta.get("partial_json").and_then(|v| v.as_str())
                        {
                            if let Some((_, _, ref mut input)) = pending_tool.as_mut() {
                                input.push_str(partial);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        "content_block_stop" => {
            if let Some((id, name, input)) = pending_tool.take() {
                events.push(AssistantEvent::ToolUse { id, name, input });
            }
        }
        "message_delta" => {
            if let Some(usage) = chunk_json.get("usage").and_then(|u| parse_token_usage(u)) {
                *usage_out = Some(usage);
            }
        }
        "message_stop" => {
            return Ok(true);
        }
        _ => {}
    }
    Ok(false)
}

fn parse_token_usage(usage: &serde_json::Value) -> Option<TokenUsage> {
    let get_u32 = |key: &str| -> u32 {
        usage
            .get(key)
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32
    };
    Some(TokenUsage {
        input_tokens: get_u32("input_tokens"),
        output_tokens: get_u32("output_tokens"),
        cache_creation_input_tokens: get_u32("cache_creation_input_tokens"),
        cache_read_input_tokens: get_u32("cache_read_input_tokens"),
    })
}

// ── Client ────────────────────────────────────────────────────────────────────

pub struct BedrockRuntimeClient {
    runtime: tokio::runtime::Runtime,
    http: Client,
    config: BedrockConfig,
    tool_specs: Vec<DynamicToolSpec>,
    enable_tools: bool,
}

impl BedrockRuntimeClient {
    pub fn new(
        model_spec: &str,
        tool_specs: Vec<DynamicToolSpec>,
        enable_tools: bool,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let config = resolve_bedrock(model_spec)
            .map_err(|e| Box::<dyn std::error::Error>::from(e))?;
        Ok(Self {
            runtime: tokio::runtime::Runtime::new()?,
            http: Client::new(),
            config,
            tool_specs,
            enable_tools,
        })
    }

    /// Build the request body shared between streaming and non-streaming calls.
    fn build_body(
        &self,
        request: &ApiRequest,
    ) -> Result<Vec<u8>, RuntimeError> {
        let messages = crate::convert_messages(&request.messages);
        let messages_val = serde_json::to_value(&messages)
            .map_err(|e| RuntimeError::new(format!("message serialize error: {e}")))?;

        let mut body = serde_json::Map::new();
        body.insert(
            "anthropic_version".to_string(),
            serde_json::json!("bedrock-2023-05-31"),
        );
        body.insert(
            "max_tokens".to_string(),
            serde_json::json!(crate::DEFAULT_MAX_TOKENS),
        );
        body.insert("messages".to_string(), messages_val);

        if !request.system_prompt.is_empty() {
            let blocks = crate::build_cached_system_blocks(&request.system_prompt);
            let system_val: Vec<serde_json::Value> = blocks
                .iter()
                .map(|b| {
                    let mut obj = serde_json::json!({
                        "type": "text",
                        "text": b.text,
                    });
                    if let Some(ref cc) = b.cache_control {
                        obj.as_object_mut().unwrap().insert(
                            "cache_control".to_string(),
                            serde_json::json!({"type": cc.cache_type}),
                        );
                    }
                    obj
                })
                .collect();
            body.insert(
                "system".to_string(),
                serde_json::json!(system_val),
            );
        }

        if self.enable_tools {
            let specs = if self.tool_specs.is_empty() {
                // Fallback: use MVP specs (e.g. during tests or non-MCP builds)
                mvp_tool_specs()
                    .into_iter()
                    .map(|s| DynamicToolSpec {
                        name: s.name.to_string(),
                        description: s.description.to_string(),
                        input_schema: s.input_schema,
                    })
                    .collect::<Vec<_>>()
            } else {
                self.tool_specs.clone()
            };
            let tools: Vec<serde_json::Value> = specs
                .iter()
                .map(|spec| {
                    serde_json::json!({
                        "name": spec.name,
                        "description": spec.description,
                        "input_schema": spec.input_schema,
                    })
                })
                .collect();
            body.insert("tools".to_string(), serde_json::json!(tools));
            body.insert(
                "tool_choice".to_string(),
                serde_json::json!({"type": "auto"}),
            );
        }

        serde_json::to_vec(&serde_json::Value::Object(body))
            .map_err(|e| RuntimeError::new(format!("serialize error: {e}")))
    }

    /// Add authentication headers to a request builder.
    fn add_auth(
        &self,
        builder: reqwest::RequestBuilder,
        body_bytes: &[u8],
        host: &str,
        path: &str,
    ) -> reqwest::RequestBuilder {
        match &self.config.auth {
            BedrockAuth::ApiKey(key) => builder
                .header("Content-Type", "application/json")
                .header("Authorization", format!("Bearer {key}")),
            BedrockAuth::SigV4 {
                access_key,
                secret_key,
                session_token,
            } => {
                let datetime = utc_compact();
                let sig = sign_request(
                    "POST",
                    host,
                    path,
                    body_bytes,
                    access_key,
                    secret_key,
                    session_token.as_deref(),
                    &self.config.region,
                    &datetime,
                );
                let mut b = builder
                    .header("Content-Type", "application/json")
                    .header("Authorization", &sig.authorization)
                    .header("x-amz-date", &sig.x_amz_date)
                    .header("x-amz-content-sha256", &sig.x_amz_content_sha256);
                if let Some(ref tok) = sig.x_amz_security_token {
                    b = b.header("x-amz-security-token", tok);
                }
                b
            }
        }
    }
}

impl ApiClient for BedrockRuntimeClient {
    fn stream(&mut self, request: ApiRequest) -> Result<Vec<AssistantEvent>, RuntimeError> {
        let body_bytes = self.build_body(&request)?;

        let host = format!(
            "bedrock-runtime.{}.amazonaws.com",
            self.config.region
        );
        // Use the streaming endpoint — URL-encode model ID for IDs with colons (e.g. v1:0)
        let encoded_model = url_encode_path_segment(&self.config.model_id);
        let path = format!("/model/{encoded_model}/invoke-with-response-stream");
        let url = format!("https://{host}{path}");

        let builder = self
            .http
            .post(&url)
            .body(body_bytes.clone());
        let builder = self.add_auth(builder, &body_bytes, &host, &path);

        self.runtime.block_on(async {
            let mut resp = tokio::select! {
                result = builder.send() => {
                    result.map_err(|e| RuntimeError::new(format!("Bedrock request failed: {e}")))?
                }
                _ = tokio::signal::ctrl_c() => {
                    eprintln!("\nInterrupted.");
                    return Ok(vec![
                        AssistantEvent::TextDelta("[Interrupted]".to_string()),
                        AssistantEvent::MessageStop,
                    ]);
                }
            };

            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                return Err(RuntimeError::new(format!(
                    "Bedrock API error {status}: {text}"
                )));
            }

            // True incremental streaming: read chunks as they arrive from the
            // network and decode AWS event-stream frames on the fly, printing
            // tokens to stdout the moment they're available.
            let mut events: Vec<AssistantEvent> = Vec::new();
            let mut stdout = io::stdout();
            let mut pending_tool: Option<(String, String, String)> = None;
            let mut usage_acc: Option<TokenUsage> = None;
            let mut saw_stop = false;
            let mut frame_buf: Vec<u8> = Vec::with_capacity(16384);

            loop {
                let maybe_chunk = tokio::select! {
                    chunk = resp.chunk() => chunk,
                    _ = tokio::signal::ctrl_c() => {
                        eprintln!("\nInterrupted.");
                        if !events.iter().any(|e| matches!(e, AssistantEvent::TextDelta(_))) {
                            events.push(AssistantEvent::TextDelta("[Interrupted]".to_string()));
                        }
                        break;
                    }
                };

                match maybe_chunk {
                    Ok(Some(chunk)) => {
                        frame_buf.extend_from_slice(&chunk);
                        // Drain all complete frames from the buffer
                        let mut offset = 0;
                        while offset < frame_buf.len() {
                            match decode_frame(&frame_buf, offset) {
                                Some((event_type, payload, next_offset)) => {
                                    offset = next_offset;
                                    if event_type == "chunk" {
                                        if let Ok(chunk_json) = serde_json::from_slice::<serde_json::Value>(&payload) {
                                            let inner = if let Some(b64) = chunk_json.get("bytes").and_then(|v| v.as_str()) {
                                                use_base64_decode(b64)
                                                    .and_then(|decoded| serde_json::from_slice(&decoded).ok())
                                                    .unwrap_or(chunk_json)
                                            } else {
                                                chunk_json
                                            };
                                            if let Ok(true) = process_bedrock_chunk(&inner, &mut stdout, &mut events, &mut pending_tool, &mut usage_acc) {
                                                saw_stop = true;
                                            }
                                        }
                                    }
                                }
                                None => break, // incomplete frame — wait for more data
                            }
                        }
                        // Remove consumed bytes from the front of the buffer
                        if offset > 0 {
                            frame_buf.drain(..offset);
                        }
                    }
                    Ok(None) => break, // stream ended
                    Err(e) => {
                        return Err(RuntimeError::new(format!("Bedrock stream read error: {e}")));
                    }
                }
            }

            // Flush any pending tool that didn't get a content_block_stop
            if let Some((id, name, input)) = pending_tool.take() {
                events.push(AssistantEvent::ToolUse { id, name, input });
            }

            if let Some(usage) = usage_acc {
                events.push(AssistantEvent::Usage(usage));
            }

            if !saw_stop {
                events.push(AssistantEvent::MessageStop);
            } else {
                events.push(AssistantEvent::MessageStop);
            }

            Ok(events)
        })
    }
}

/// Minimal base64 decoder (standard alphabet, with padding).
/// Avoids adding a dependency — only used here for Bedrock chunk decoding.
fn use_base64_decode(input: &str) -> Option<Vec<u8>> {
    const TABLE: [u8; 128] = {
        let mut t = [0xff_u8; 128];
        let mut i = 0_u8;
        loop {
            let c = b'A' + i;
            if c > b'Z' { break; }
            t[c as usize] = i;
            i += 1;
        }
        let mut i = 0_u8;
        loop {
            let c = b'a' + i;
            if c > b'z' { break; }
            t[c as usize] = 26 + i;
            i += 1;
        }
        let mut i = 0_u8;
        loop {
            if i > 9 { break; }
            t[(b'0' + i) as usize] = 52 + i;
            i += 1;
        }
        t[b'+' as usize] = 62;
        t[b'/' as usize] = 63;
        t
    };

    let input = input.trim_end_matches('=');
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4 + 1);
    let mut i = 0;
    while i + 3 < bytes.len() {
        let b0 = bytes[i];
        let b1 = bytes[i + 1];
        let b2 = bytes[i + 2];
        let b3 = bytes[i + 3];
        if b0 > 127 || b1 > 127 || b2 > 127 || b3 > 127 {
            return None;
        }
        let v0 = TABLE[b0 as usize];
        let v1 = TABLE[b1 as usize];
        let v2 = TABLE[b2 as usize];
        let v3 = TABLE[b3 as usize];
        if v0 == 0xff || v1 == 0xff || v2 == 0xff || v3 == 0xff {
            return None;
        }
        let combined = (u32::from(v0) << 18)
            | (u32::from(v1) << 12)
            | (u32::from(v2) << 6)
            | u32::from(v3);
        out.push((combined >> 16) as u8);
        out.push((combined >> 8) as u8);
        out.push(combined as u8);
        i += 4;
    }
    // remaining 2 or 3 chars
    match bytes.len() - i {
        2 => {
            if bytes[i] > 127 || bytes[i + 1] > 127 { return None; }
            let v0 = TABLE[bytes[i] as usize];
            let v1 = TABLE[bytes[i + 1] as usize];
            if v0 == 0xff || v1 == 0xff { return None; }
            out.push(((u32::from(v0) << 2) | (u32::from(v1) >> 4)) as u8);
        }
        3 => {
            if bytes[i] > 127 || bytes[i + 1] > 127 || bytes[i + 2] > 127 { return None; }
            let v0 = TABLE[bytes[i] as usize];
            let v1 = TABLE[bytes[i + 1] as usize];
            let v2 = TABLE[bytes[i + 2] as usize];
            if v0 == 0xff || v1 == 0xff || v2 == 0xff { return None; }
            let combined = (u32::from(v0) << 10) | (u32::from(v1) << 4) | (u32::from(v2) >> 2);
            out.push((combined >> 8) as u8);
            out.push(combined as u8);
        }
        _ => {}
    }
    Some(out)
}
