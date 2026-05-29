//! Process-driving LSP client (gated behind `--features lsp`).
//!
//! Launches a language server for a file, runs the `initialize` / `initialized`
//! / `didOpen` handshake, and collects `textDocument/publishDiagnostics` into a
//! digest. Not unit-tested offline (it requires a real language server); the
//! pure framing/protocol pieces it builds on are covered in their own modules.

use std::io::{BufReader, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde_json::json;

use crate::framing::{encode_frame, read_frame};
use crate::protocol::{
    format_diagnostics_digest, parse_publish_diagnostics, server_command_for_extension,
};

/// Launch the appropriate language server for `path`, open the file, and return a
/// digest of the diagnostics it reports within `total_timeout`.
///
/// Returns `Ok(String::new())` when the file is clean, `Ok(digest)` when there
/// are diagnostics, and `Err` when no server is available or the handshake fails.
///
/// # Errors
/// Returns an error if the extension is unsupported, the server binary is missing
/// or fails to spawn, or stdio cannot be wired up.
pub fn collect_diagnostics(path: &Path, total_timeout: Duration) -> Result<String, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .ok_or_else(|| "file has no extension".to_string())?;
    let (program, args) = server_command_for_extension(ext)
        .ok_or_else(|| format!("no language server for .{ext}"))?;

    let abs = std::fs::canonicalize(path)
        .map_err(|e| format!("cannot resolve {}: {e}", path.display()))?;
    let text =
        std::fs::read_to_string(&abs).map_err(|e| format!("cannot read {}: {e}", abs.display()))?;
    let uri = path_to_uri(&abs);
    let root = abs.parent().map_or_else(|| abs.clone(), Path::to_path_buf);

    let mut child = Command::new(program)
        .args(args)
        .current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to launch {program}: {e}"))?;

    let mut stdin = child.stdin.take().ok_or("no stdin on language server")?;
    let stdout = child.stdout.take().ok_or("no stdout on language server")?;

    // Reader thread: decode frames and forward to the main thread.
    let (tx, rx) = mpsc::channel::<String>();
    let reader_handle = std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        while let Ok(Some(body)) = read_frame(&mut reader) {
            if tx.send(body).is_err() {
                break;
            }
        }
    });

    let result = run_session(&mut stdin, &rx, &uri, &text, ext, &root, total_timeout);

    // Best-effort shutdown.
    let _ = send(
        &mut stdin,
        &json!({"jsonrpc":"2.0","id":99,"method":"shutdown"}),
    );
    let _ = send(&mut stdin, &json!({"jsonrpc":"2.0","method":"exit"}));
    drop(stdin);
    kill_child(&mut child);
    drop(reader_handle);

    result
}

fn run_session(
    stdin: &mut impl Write,
    rx: &mpsc::Receiver<String>,
    uri: &str,
    text: &str,
    ext: &str,
    root: &Path,
    total_timeout: Duration,
) -> Result<String, String> {
    let root_uri = path_to_uri(root);
    send(
        stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "processId": std::process::id(),
                "rootUri": root_uri,
                "capabilities": {"textDocument": {"publishDiagnostics": {}}}
            }
        }),
    )?;

    let deadline = Instant::now() + total_timeout;
    // Wait for the initialize response (a message with "id":1).
    wait_for(rx, deadline, |body| {
        serde_json::from_str::<serde_json::Value>(body)
            .ok()
            .and_then(|v| v.get("id").and_then(serde_json::Value::as_i64))
            == Some(1)
    })
    .ok_or("language server did not respond to initialize in time")?;

    send(
        stdin,
        &json!({"jsonrpc":"2.0","method":"initialized","params":{}}),
    )?;
    send(
        stdin,
        &json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didOpen",
            "params": {"textDocument": {"uri": uri, "languageId": language_id(ext), "version": 1, "text": text}}
        }),
    )?;

    // Collect the latest diagnostics for our uri until the deadline.
    let mut latest = None;
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match rx.recv_timeout(remaining.min(Duration::from_millis(500))) {
            Ok(body) => {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&body) {
                    if value.get("method").and_then(serde_json::Value::as_str)
                        == Some("textDocument/publishDiagnostics")
                    {
                        if let Some(params) = parse_publish_diagnostics(&value) {
                            if params.uri == uri {
                                latest = Some(params);
                            }
                        }
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if latest.is_some() {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    Ok(latest.map_or_else(String::new, |p| format_diagnostics_digest(&p, 20)))
}

fn wait_for(
    rx: &mpsc::Receiver<String>,
    deadline: Instant,
    pred: impl Fn(&str) -> bool,
) -> Option<String> {
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match rx.recv_timeout(remaining.min(Duration::from_millis(500))) {
            Ok(body) => {
                if pred(&body) {
                    return Some(body);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return None,
        }
    }
    None
}

fn send(stdin: &mut impl Write, message: &serde_json::Value) -> Result<(), String> {
    let body = message.to_string();
    stdin
        .write_all(&encode_frame(&body))
        .and_then(|()| stdin.flush())
        .map_err(|e| format!("write to language server failed: {e}"))
}

fn kill_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn language_id(ext: &str) -> &'static str {
    match ext {
        "rs" => "rust",
        "ts" | "mts" | "cts" => "typescript",
        "tsx" => "typescriptreact",
        "js" | "jsx" => "javascript",
        "py" | "pyi" => "python",
        _ => "plaintext",
    }
}

fn path_to_uri(path: &Path) -> String {
    let s = path.to_string_lossy().replace('\\', "/");
    if s.starts_with('/') {
        format!("file://{s}")
    } else {
        // Windows drive paths: file:///C:/...
        format!("file:///{s}")
    }
}
