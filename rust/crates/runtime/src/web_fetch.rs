/// Web fetch tool — fetches a URL and returns its content as text.
///
/// Uses the blocking reqwest client so it fits the synchronous tool executor
/// model without needing a separate tokio runtime.
use serde::{Deserialize, Serialize};

/// Maximum response body size to return (512 KB). Prevents the model context
/// from being flooded by huge pages.
const MAX_BYTES: usize = 512 * 1024;

/// Characters we accept as "probably text". Anything with a lot of null bytes
/// or other binary content gets rejected.
const BINARY_SAMPLE: usize = 512;

#[derive(Debug, Clone, Deserialize)]
pub struct WebFetchInput {
    /// The URL to fetch.
    pub url: String,
    /// Maximum number of characters to return (default: 20 000).
    pub max_length: Option<usize>,
    /// Character offset to start from (default: 0). Useful for paginating
    /// large pages across multiple calls.
    pub start_index: Option<usize>,
    /// If `true`, return raw HTML instead of converting to markdown-ish text.
    pub raw: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WebFetchOutput {
    pub url: String,
    pub content: String,
    /// Total characters in the full response (before slicing with `start_index/max_length`).
    pub total_length: usize,
    /// True if the content was truncated.
    pub truncated: bool,
}

/// Minimal HTML → readable-text converter.
/// Strips tags and decodes common HTML entities. Not a full parser — good
/// enough for extracting prose from documentation pages.
fn html_to_text(html: &str) -> String {
    // Remove <script>, <style>, <head> blocks entirely
    let mut text = html.to_string();

    // Remove script/style/head blocks
    for tag in &["script", "style", "head"] {
        let open = format!("<{tag}");
        let close = format!("</{tag}>");
        while let Some(start) = text.to_lowercase().find(&open) {
            if let Some(end) = text.to_lowercase()[start..].find(&close) {
                text.drain(start..start + end + close.len());
            } else {
                text.drain(start..);
                break;
            }
        }
    }

    // Replace block-level tags with newlines
    let block_tags = [
        "</p>", "</div>", "</li>", "</h1>", "</h2>", "</h3>", "</h4>", "</h5>", "</h6>", "</tr>",
        "</thead>", "</tbody>", "<br>", "<br/>", "<br />",
    ];
    for tag in &block_tags {
        text = text.replace(tag, "\n");
    }

    // Strip remaining tags
    let mut out = String::with_capacity(text.len());
    let mut in_tag = false;
    for c in text.chars() {
        match c {
            '<' => {
                in_tag = true;
            }
            '>' => {
                in_tag = false;
            }
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }

    // Decode common HTML entities
    let out = out
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
        .replace("&mdash;", "—")
        .replace("&ndash;", "–")
        .replace("&hellip;", "…");

    // Collapse excess whitespace / blank lines
    let mut result = String::with_capacity(out.len());
    let mut blank_lines = 0_usize;
    for line in out.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            blank_lines += 1;
            if blank_lines <= 2 {
                result.push('\n');
            }
        } else {
            blank_lines = 0;
            result.push_str(trimmed);
            result.push('\n');
        }
    }
    result
}

/// Returns true if the byte slice looks binary (too many non-text bytes).
fn is_binary(data: &[u8]) -> bool {
    let sample = &data[..data.len().min(BINARY_SAMPLE)];
    let non_text = sample
        .iter()
        .filter(|&&b| b == 0 || (b < 32 && b != b'\t' && b != b'\n' && b != b'\r'))
        .count();
    non_text > sample.len() / 10
}

pub fn web_fetch(input: &WebFetchInput) -> Result<WebFetchOutput, String> {
    // Reject non-http(s) schemes
    let url_lower = input.url.to_lowercase();
    if !url_lower.starts_with("http://") && !url_lower.starts_with("https://") {
        return Err(format!(
            "Only http:// and https:// URLs are supported, got: {}",
            input.url
        ));
    }

    let client = reqwest::blocking::Client::builder()
        .user_agent("claw/0.1 (AI coding agent)")
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let response = client
        .get(&input.url)
        .send()
        .map_err(|e| format!("Request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "HTTP {} {}",
            response.status().as_u16(),
            response.status().canonical_reason().unwrap_or("")
        ));
    }

    // Check content type
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    let is_html = content_type.contains("html");
    let is_json = content_type.contains("json");
    let raw = input.raw.unwrap_or(false);

    // Read with size cap
    let bytes = response
        .bytes()
        .map_err(|e| format!("Failed to read response body: {e}"))?;
    let capped = if bytes.len() > MAX_BYTES {
        &bytes[..MAX_BYTES]
    } else {
        &bytes[..]
    };

    if is_binary(capped) {
        return Err("Response appears to be binary content, not text".to_string());
    }

    let raw_text = String::from_utf8_lossy(capped).into_owned();

    let content = if !raw && is_html {
        html_to_text(&raw_text)
    } else if !raw && is_json {
        // Pretty-print JSON if we can parse it
        serde_json::from_str::<serde_json::Value>(&raw_text)
            .map(|v| serde_json::to_string_pretty(&v).unwrap_or(raw_text.clone()))
            .unwrap_or(raw_text)
    } else {
        raw_text
    };

    let total_length = content.len();
    let start = input.start_index.unwrap_or(0).min(total_length);
    let max_len = input.max_length.unwrap_or(20_000);
    let end = (start + max_len).min(total_length);
    let truncated = end < total_length || bytes.len() > MAX_BYTES;
    let sliced = content[start..end].to_string();

    Ok(WebFetchOutput {
        url: input.url.clone(),
        content: sliced,
        total_length,
        truncated,
    })
}
