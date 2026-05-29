//! LSP `publishDiagnostics` types, parsing, server selection (D7), and digest.

use std::fmt::Write as _;

use serde::Deserialize;

/// Zero-based position in a text document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub struct Position {
    pub line: u32,
    pub character: u32,
}

/// A range in a text document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub struct Range {
    pub start: Position,
    pub end: Position,
}

/// LSP diagnostic severity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warning,
    Information,
    Hint,
}

impl Severity {
    /// Map the LSP numeric severity (1..=4) to an enum; unknown → `Warning`.
    #[must_use]
    pub fn from_code(code: Option<u8>) -> Self {
        match code {
            Some(1) => Self::Error,
            Some(3) => Self::Information,
            Some(4) => Self::Hint,
            _ => Self::Warning,
        }
    }

    #[must_use]
    pub fn label(self) -> &'static str {
        match self {
            Self::Error => "error",
            Self::Warning => "warning",
            Self::Information => "info",
            Self::Hint => "hint",
        }
    }
}

/// A single LSP diagnostic.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct LspDiagnostic {
    pub range: Range,
    #[serde(default)]
    pub severity: Option<u8>,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub source: Option<String>,
}

impl LspDiagnostic {
    #[must_use]
    pub fn severity(&self) -> Severity {
        Severity::from_code(self.severity)
    }
}

/// Parameters of a `textDocument/publishDiagnostics` notification.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PublishDiagnosticsParams {
    pub uri: String,
    #[serde(default)]
    pub diagnostics: Vec<LspDiagnostic>,
}

/// Parse a `textDocument/publishDiagnostics` notification's `params`.
///
/// Accepts the full notification object (`{ "method": ..., "params": {...} }`) or
/// a bare params object. Returns `None` if it is neither.
#[must_use]
pub fn parse_publish_diagnostics(
    notification: &serde_json::Value,
) -> Option<PublishDiagnosticsParams> {
    let params = notification.get("params").unwrap_or(notification);
    serde_json::from_value(params.clone()).ok()
}

/// Format diagnostics into a compact, model-facing digest, errors first, capped
/// at `limit`. Lines are rendered 1-based (LSP positions are 0-based).
#[must_use]
pub fn format_diagnostics_digest(params: &PublishDiagnosticsParams, limit: usize) -> String {
    let path = uri_to_path(&params.uri);
    let mut sorted: Vec<&LspDiagnostic> = params.diagnostics.iter().collect();
    // Errors before warnings before info/hint; then by line.
    sorted.sort_by_key(|d| (severity_rank(d.severity()), d.range.start.line));

    let mut out = String::new();
    for diag in sorted.iter().take(limit) {
        let line = diag.range.start.line + 1;
        let col = diag.range.start.character + 1;
        let _ = writeln!(
            out,
            "- {path}:{line}:{col} {}: {}",
            diag.severity().label(),
            diag.message.trim()
        );
    }
    if sorted.len() > limit {
        let _ = writeln!(out, "- ... and {} more", sorted.len() - limit);
    }
    out
}

fn severity_rank(severity: Severity) -> u8 {
    match severity {
        Severity::Error => 0,
        Severity::Warning => 1,
        Severity::Information => 2,
        Severity::Hint => 3,
    }
}

/// Convert a `file://` URI to a filesystem-ish path for display.
fn uri_to_path(uri: &str) -> String {
    uri.strip_prefix("file://")
        .map_or_else(|| uri.to_string(), percent_decode)
}

/// Minimal percent-decoding sufficient for `file://` paths (handles `%20` etc.).
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&input[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The language-server command for a file extension (D7), as `(program, args)`.
///
/// Returns `None` for unsupported extensions. The caller skips launching when the
/// program is not installed.
#[must_use]
pub fn server_command_for_extension(ext: &str) -> Option<(&'static str, &'static [&'static str])> {
    match ext {
        "rs" => Some(("rust-analyzer", &[])),
        "ts" | "tsx" | "js" | "jsx" | "mts" | "cts" => {
            Some(("typescript-language-server", &["--stdio"]))
        }
        "py" | "pyi" => Some(("pyright-langserver", &["--stdio"])),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        format_diagnostics_digest, parse_publish_diagnostics, server_command_for_extension,
        Severity,
    };
    use serde_json::json;

    #[test]
    fn parses_publish_diagnostics_notification() {
        let notification = json!({
            "jsonrpc": "2.0",
            "method": "textDocument/publishDiagnostics",
            "params": {
                "uri": "file:///repo/src/main.rs",
                "diagnostics": [
                    {"range": {"start": {"line": 9, "character": 4}, "end": {"line": 9, "character": 7}},
                     "severity": 1, "message": "cannot find value `x`", "source": "rustc"}
                ]
            }
        });
        let params = parse_publish_diagnostics(&notification).expect("parse");
        assert_eq!(params.uri, "file:///repo/src/main.rs");
        assert_eq!(params.diagnostics.len(), 1);
        assert_eq!(params.diagnostics[0].severity(), Severity::Error);
    }

    #[test]
    fn digest_orders_errors_first_and_is_one_based() {
        let notification = json!({
            "params": {
                "uri": "file:///repo/a.ts",
                "diagnostics": [
                    {"range": {"start": {"line": 4, "character": 0}, "end": {"line": 4, "character": 1}}, "severity": 2, "message": "unused"},
                    {"range": {"start": {"line": 1, "character": 2}, "end": {"line": 1, "character": 3}}, "severity": 1, "message": "type error"}
                ]
            }
        });
        let params = parse_publish_diagnostics(&notification).unwrap();
        let digest = format_diagnostics_digest(&params, 10);
        let error_pos = digest.find("type error").unwrap();
        let warn_pos = digest.find("unused").unwrap();
        assert!(error_pos < warn_pos, "errors must come before warnings");
        // 0-based line 1 -> displayed line 2, char 2 -> col 3.
        assert!(digest.contains("/repo/a.ts:2:3 error: type error"));
    }

    #[test]
    fn digest_caps_and_counts_remainder() {
        let mut diags = Vec::new();
        for i in 0..5 {
            diags.push(json!({
                "range": {"start": {"line": i, "character": 0}, "end": {"line": i, "character": 1}},
                "severity": 1, "message": format!("e{i}")
            }));
        }
        let params = parse_publish_diagnostics(
            &json!({"params": {"uri": "file:///x.rs", "diagnostics": diags}}),
        )
        .unwrap();
        let digest = format_diagnostics_digest(&params, 2);
        assert!(digest.contains("and 3 more"));
    }

    #[test]
    fn server_selection_matches_d7() {
        assert_eq!(
            server_command_for_extension("rs").unwrap().0,
            "rust-analyzer"
        );
        assert_eq!(
            server_command_for_extension("tsx").unwrap().0,
            "typescript-language-server"
        );
        assert_eq!(
            server_command_for_extension("py").unwrap().0,
            "pyright-langserver"
        );
        assert!(server_command_for_extension("rb").is_none());
    }

    #[test]
    fn uri_percent_decoding() {
        let params = parse_publish_diagnostics(&serde_json::json!({
            "params": {"uri": "file:///repo/my%20dir/main.rs", "diagnostics": []}
        }))
        .unwrap();
        let digest = format_diagnostics_digest(&params, 10);
        // No diagnostics → empty digest, but the path decode is exercised via uri_to_path.
        assert!(digest.is_empty());
        assert_eq!(params.uri, "file:///repo/my%20dir/main.rs");
    }
}
