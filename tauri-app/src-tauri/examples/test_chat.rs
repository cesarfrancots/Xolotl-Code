//! Standalone smoke test for the chat streaming pipeline.
//!
//! Run with:
//!   cd tauri-app/src-tauri && cargo run --features dev-tools --example test_chat
//!
//! Reads KIMI_CODING_API_KEY (or KIMI_API_KEY) from env or
//! `~/.xolotl-code/config.json` (the same resolution order the Tauri command
//! uses), POSTs a streaming request to api.kimi.com/coding/v1, prints every
//! delta to stdout, and exits non-zero if no content came back.
//!
//! This bypasses Tauri so we can quickly verify whether the failure mode
//! "send message, no reply" is in the API call itself or in event routing.

use std::path::PathBuf;
use std::time::Duration;

fn home_config_path() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".xolotl-code").join("config.json")
}

fn resolve_key() -> Option<String> {
    if let Ok(k) = std::env::var("KIMI_CODING_API_KEY") {
        if !k.is_empty() {
            return Some(k);
        }
    }
    if let Ok(k) = std::env::var("KIMI_API_KEY") {
        if !k.is_empty() {
            return Some(k);
        }
    }
    let data = std::fs::read_to_string(home_config_path()).ok()?;
    let v: serde_json::Value = serde_json::from_str(&data).ok()?;
    let obj = v.as_object()?;
    for name in ["KIMI_CODING_API_KEY", "KIMI_API_KEY"] {
        if let Some(s) = obj.get(name).and_then(|x| x.as_str()) {
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    None
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let key = resolve_key().ok_or("no Kimi key in env or ~/.xolotl-code/config.json")?;
    eprintln!("[test_chat] key prefix: {}…", &key[..key.len().min(10)]);

    let prompt = std::env::args().nth(1).unwrap_or_else(|| "hi".to_string());

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()?;

    let body = serde_json::json!({
        "model": "kimi-k2-turbo-preview",
        "stream": true,
        "messages": [{"role": "user", "content": prompt}],
    });

    eprintln!("[test_chat] POST https://api.kimi.com/coding/v1/chat/completions");
    let resp = client
        .post("https://api.kimi.com/coding/v1/chat/completions")
        .header("Authorization", format!("Bearer {key}"))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .header("User-Agent", "claude-code/1.0.0 (Windows; x64)")
        .header("X-Client-Name", "claude-code")
        .header("X-Client-Version", "1.0.0")
        .header("X-Source", "claude-code")
        .json(&body)
        .send()
        .await?;

    let status = resp.status();
    eprintln!("[test_chat] response status: {status}");
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("non-success: {body}").into());
    }

    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();
    let mut content_chars = 0usize;
    let mut reasoning_chars = 0usize;
    let dump_raw = std::env::var("DUMP_RAW").is_ok();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        let s = String::from_utf8_lossy(&chunk);
        if dump_raw {
            eprintln!("[raw chunk] {s:?}");
        }
        buffer.push_str(&s);
        loop {
            let Some(pos) = buffer.find("\n\n") else {
                break;
            };
            let raw = buffer[..pos].to_string();
            buffer = buffer[pos + 2..].to_string();
            for line in raw.lines() {
                let Some(rest) = line.strip_prefix("data:") else {
                    continue;
                };
                let data = rest.trim_start();
                if data == "[DONE]" {
                    continue;
                }
                let v: serde_json::Value = match serde_json::from_str(data) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let delta = &v["choices"][0]["delta"];
                if let Some(r) = delta["reasoning_content"].as_str() {
                    if !r.is_empty() {
                        print!("{r}");
                        reasoning_chars += r.len();
                    }
                }
                if let Some(c) = delta["content"].as_str() {
                    if !c.is_empty() {
                        print!("{c}");
                        content_chars += c.len();
                    }
                }
            }
        }
    }
    println!();

    eprintln!(
        "[test_chat] done — reasoning={reasoning_chars} chars, content={content_chars} chars"
    );
    if content_chars == 0 && reasoning_chars == 0 {
        return Err("no content received".into());
    }
    Ok(())
}
