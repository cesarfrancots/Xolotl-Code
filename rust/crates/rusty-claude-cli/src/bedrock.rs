/// AWS Bedrock runtime client.
///
/// Supports two authentication modes:
///
/// **Simple API key** (recommended): Set `BEDROCK_API_KEY` — uses Bearer token auth,
/// no AWS credentials needed. Create a key in the Bedrock console.
///
/// **IAM / Sig V4**: Set `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (+ optional
/// `AWS_SESSION_TOKEN` and `AWS_DEFAULT_REGION`).

use std::io::{self, Write};

use reqwest::Client;
use ring::{digest, hmac};

use runtime::{ApiClient, ApiRequest, AssistantEvent, RuntimeError, TokenUsage};
use tools::mvp_tool_specs;

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

/// Parse a `bedrock/anthropic.claude-opus-4-5-20251101` model spec and choose
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

// ── Client ────────────────────────────────────────────────────────────────────

pub struct BedrockRuntimeClient {
    runtime: tokio::runtime::Runtime,
    http: Client,
    config: BedrockConfig,
    enable_tools: bool,
}

impl BedrockRuntimeClient {
    pub fn new(
        model_spec: &str,
        enable_tools: bool,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let config = resolve_bedrock(model_spec)
            .map_err(|e| Box::<dyn std::error::Error>::from(e))?;
        Ok(Self {
            runtime: tokio::runtime::Runtime::new()?,
            http: Client::new(),
            config,
            enable_tools,
        })
    }
}

impl ApiClient for BedrockRuntimeClient {
    fn stream(&mut self, request: ApiRequest) -> Result<Vec<AssistantEvent>, RuntimeError> {
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
            body.insert(
                "system".to_string(),
                serde_json::json!(request.system_prompt.join("\n\n")),
            );
        }

        if self.enable_tools {
            let tools: Vec<serde_json::Value> = mvp_tool_specs()
                .into_iter()
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

        let body_bytes = serde_json::to_vec(&serde_json::Value::Object(body))
            .map_err(|e| RuntimeError::new(format!("serialize error: {e}")))?;

        let host = format!(
            "bedrock-runtime.{}.amazonaws.com",
            self.config.region
        );
        let path = format!("/model/{}/invoke", self.config.model_id);
        let url = format!("https://{host}{path}");

        // Build the request with the appropriate auth
        let builder = match &self.config.auth {
            BedrockAuth::ApiKey(key) => self
                .http
                .post(&url)
                .header("Content-Type", "application/json")
                .header("Authorization", format!("Bearer {key}"))
                .body(body_bytes),

            BedrockAuth::SigV4 {
                access_key,
                secret_key,
                session_token,
            } => {
                let datetime = utc_compact();
                let sig = sign_request(
                    "POST",
                    &host,
                    &path,
                    &body_bytes,
                    access_key,
                    secret_key,
                    session_token.as_deref(),
                    &self.config.region,
                    &datetime,
                );
                let mut b = self
                    .http
                    .post(&url)
                    .header("Content-Type", "application/json")
                    .header("Authorization", &sig.authorization)
                    .header("x-amz-date", &sig.x_amz_date)
                    .header("x-amz-content-sha256", &sig.x_amz_content_sha256)
                    .body(body_bytes);
                if let Some(ref tok) = sig.x_amz_security_token {
                    b = b.header("x-amz-security-token", tok);
                }
                b
            }
        };

        self.runtime.block_on(async {
            let resp = tokio::select! {
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

            let resp_val: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| RuntimeError::new(format!("Failed to parse Bedrock response: {e}")))?;

            let mut events: Vec<AssistantEvent> = Vec::new();
            let mut stdout = io::stdout();

            if let Some(content) = resp_val.get("content").and_then(|v| v.as_array()) {
                for block in content {
                    match block.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                        "text" => {
                            let text = block.get("text").and_then(|v| v.as_str()).unwrap_or("");
                            if !text.is_empty() {
                                let _ = write!(stdout, "{text}");
                                let _ = stdout.flush();
                                events.push(AssistantEvent::TextDelta(text.to_string()));
                            }
                        }
                        "tool_use" => {
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
                            let input = block
                                .get("input")
                                .map(|v| v.to_string())
                                .unwrap_or_default();
                            events.push(AssistantEvent::ToolUse { id, name, input });
                        }
                        _ => {}
                    }
                }
            }

            let usage = resp_val.get("usage");
            let get_u32 = |key: &str| -> u32 {
                usage
                    .and_then(|u| u.get(key))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as u32
            };
            events.push(AssistantEvent::Usage(TokenUsage {
                input_tokens: get_u32("input_tokens"),
                output_tokens: get_u32("output_tokens"),
                cache_creation_input_tokens: get_u32("cache_creation_input_tokens"),
                cache_read_input_tokens: get_u32("cache_read_input_tokens"),
            }));
            events.push(AssistantEvent::MessageStop);

            Ok(events)
        })
    }
}
