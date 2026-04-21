/// Centralized CLI styling — ANSI colors, box-drawing, and formatting helpers.
///
/// Design language: purple/indigo primary accent, clean box-drawing containers,
/// semantic color coding (green=ok, yellow=warn, red=error, cyan=labels),
/// breathable layout with consistent 2-space left padding.
use std::io::Write;

pub const RESET: &str = "\x1b[0m";

// ── Text styles ───────────────────────────────────────────────────────────────

pub const BOLD: &str = "\x1b[1m";
#[allow(dead_code)]
pub const DIM: &str = "\x1b[2m";
pub const MUTED: &str = "\x1b[2m";
#[allow(dead_code)]
pub const ITALIC: &str = "\x1b[3m";
#[allow(dead_code)]
pub const UNDERLINE: &str = "\x1b[4m";

// ── Semantic colors ───────────────────────────────────────────────────────────

/// Primary brand accent — purple #8B5CF6.
pub const ACCENT: &str = "\x1b[38;2;139;92;246m";
/// Bright accent for highlights — indigo #6366F1.
pub const ACCENT2: &str = "\x1b[38;2;99;102;241m";
/// Tool call / label color.
pub const CYAN: &str = "\x1b[36m";
/// Bright cyan for emphasis.
#[allow(dead_code)]
pub const CYAN_BRIGHT: &str = "\x1b[96m";
/// Success / checkmarks.
pub const GREEN: &str = "\x1b[32m";
pub const GREEN_BRIGHT: &str = "\x1b[92m";
/// Warnings / auto-accept alerts.
pub const YELLOW: &str = "\x1b[33m";
#[allow(dead_code)]
pub const YELLOW_BRIGHT: &str = "\x1b[93m";
/// Errors / denials.
pub const RED: &str = "\x1b[31m";
pub const RED_BRIGHT: &str = "\x1b[91m";
/// Section headers and emphasis.
pub const WHITE_BOLD: &str = "\x1b[1;37m";
/// Body text (explicit white).
#[allow(dead_code)]
pub const WHITE: &str = "\x1b[37m";
/// Dim gray — secondary info, paths, hints.
pub const GRAY: &str = "\x1b[38;2;107;114;128m"; // #6B7280

// ── Box-drawing characters ────────────────────────────────────────────────────

pub const BOX_TL: &str = "╭";
pub const BOX_TR: &str = "╮";
pub const BOX_BL: &str = "╰";
pub const BOX_BR: &str = "╯";
pub const BOX_V: &str = "│";
pub const BOX_H: &str = "─";
pub const BOX_LM: &str = "├"; // left middle junction
#[allow(dead_code)]
pub const BOX_RM: &str = "┤"; // right middle junction

// ── Icon / glyph vocabulary ───────────────────────────────────────────────────

pub const CHECK: &str = "✔";
pub const CROSS: &str = "✘";
pub const WARN_SYM: &str = "⚠";
pub const DOT: &str = "·";
#[allow(dead_code)]
pub const BULLET: &str = "•";
pub const SPARKLE: &str = "✦";
pub const HOURGLASS: &str = "⏱";
pub const ARROW_UP: &str = "↑";
pub const ARROW_DOWN: &str = "↓";
pub const ARROW_RIGHT: &str = "→";
pub const CLAW_ICON: &str = "⚡";
#[allow(dead_code)]
pub const GEAR: &str = "⚙";
#[allow(dead_code)]
pub const CHAIN: &str = "⛓";
pub const PROMPT_ARROW: &str = "›";

// ── Dividers ──────────────────────────────────────────────────────────────────

#[allow(dead_code)]
pub const DIVIDER: &str = "────────────────────────────────────────────────────────";
pub const DIVIDER_SHORT: &str = "──────────────────────────────────";

// ── Number formatting ─────────────────────────────────────────────────────────

/// Format a number with thousands separators: 1234567 → "1,234,567".
pub fn fmt_num(n: u32) -> String {
    let s = n.to_string();
    let mut result = String::with_capacity(s.len() + s.len() / 3);
    for (i, ch) in s.chars().rev().enumerate() {
        if i > 0 && i % 3 == 0 {
            result.push(',');
        }
        result.push(ch);
    }
    result.chars().rev().collect()
}

// ── Model display names ───────────────────────────────────────────────────────

/// Convert a raw Bedrock model ID to a human-friendly display name.
/// E.g. "us.anthropic.claude-sonnet-4-6" → "Claude Sonnet 4.6"
pub fn friendly_model_name(model: &str) -> String {
    let id = model.strip_prefix("bedrock/").unwrap_or(model);
    let id = id
        .strip_prefix("us.")
        .or_else(|| id.strip_prefix("eu."))
        .or_else(|| id.strip_prefix("ap."))
        .unwrap_or(id);
    let id = id.strip_prefix("anthropic.").unwrap_or(id);

    // Pattern match known IDs → pretty names
    if id.contains("claude-sonnet-4-6") {
        return "Claude Sonnet 4.6".into();
    }
    if id.contains("claude-sonnet-4-5") {
        return "Claude Sonnet 4.5".into();
    }
    if id.contains("claude-sonnet-4") {
        return "Claude Sonnet 4".into();
    }
    if id.contains("claude-opus-4-6") {
        return "Claude Opus 4.6".into();
    }
    if id.contains("claude-opus-4-5") {
        return "Claude Opus 4.5".into();
    }
    if id.contains("claude-opus-4-1") {
        return "Claude Opus 4.1".into();
    }
    if id.contains("claude-opus-4") {
        return "Claude Opus 4".into();
    }
    if id.contains("claude-haiku-4-5") {
        return "Claude Haiku 4.5".into();
    }
    if id.contains("claude-haiku-4") {
        return "Claude Haiku 4".into();
    }
    if id.contains("claude-3-7-sonnet") {
        return "Claude 3.7 Sonnet".into();
    }
    if id.contains("claude-3-5-haiku") {
        return "Claude 3.5 Haiku".into();
    }
    if id.contains("claude-3-5-sonnet") {
        return "Claude 3.5 Sonnet".into();
    }
    if id.contains("claude-3-opus") {
        return "Claude 3 Opus".into();
    }

    // OpenAI / Kimi / etc. pass-through
    model.strip_prefix("bedrock/").unwrap_or(model).to_string()
}

/// Format a model spec for display, handling dual-model syntax.
pub fn format_model(model: &str) -> String {
    if let Some(plus) = model.find('+') {
        format!(
            "{} + {}",
            friendly_model_name(&model[..plus]),
            friendly_model_name(&model[plus + 1..])
        )
    } else {
        friendly_model_name(model)
    }
}

// ── Box builder ───────────────────────────────────────────────────────────────

/// Build a full-width bordered box (reserved for future use).
#[allow(dead_code)]
pub fn box_print(color: &str, title: &str, lines: &[String], footer: Option<&str>) {
    let inner_width = 52usize;
    let title_str = if title.is_empty() {
        BOX_H.repeat(inner_width)
    } else {
        let visible_title = format!("─ {title} ");
        let remaining = inner_width.saturating_sub(visible_title.chars().count());
        format!("{visible_title}{}", BOX_H.repeat(remaining))
    };

    println!("  {color}{BOX_TL}{title_str}{BOX_TR}{RESET}");
    for line in lines {
        // Strip ANSI to measure visible width for padding
        let visible_len = strip_ansi_len(line);
        let pad = inner_width.saturating_sub(2).saturating_sub(visible_len);
        println!(
            "  {color}{BOX_V}{RESET}  {line}{}{color}{BOX_V}{RESET}",
            " ".repeat(pad)
        );
    }
    if let Some(foot) = footer {
        let visible_foot = strip_ansi_len(foot);
        let bar_before = inner_width.saturating_sub(visible_foot).saturating_sub(1);
        println!(
            "  {color}{BOX_BL}{}{foot}{BOX_BR}{RESET}",
            BOX_H.repeat(bar_before)
        );
    } else {
        println!(
            "  {color}{BOX_BL}{}{BOX_BR}{RESET}",
            BOX_H.repeat(inner_width)
        );
    }
}

/// Count visible characters, skipping ANSI escape sequences.
pub fn strip_ansi_len(s: &str) -> usize {
    let mut len = 0usize;
    let mut in_esc = false;
    for ch in s.chars() {
        if ch == '\x1b' {
            in_esc = true;
            continue;
        }
        if in_esc {
            if ch.is_ascii_alphabetic() {
                in_esc = false;
            }
            continue;
        }
        len += 1;
    }
    len
}

// ── Print helpers ─────────────────────────────────────────────────────────────

/// Print a section header with title and thin divider.
pub fn print_header(title: &str) {
    println!();
    println!("  {WHITE_BOLD}{title}{RESET}");
    println!("  {MUTED}{DIVIDER_SHORT}{RESET}");
}

/// Print a labeled key-value row (key left-padded to 14 chars).
pub fn print_kv(key: &str, value: &str) {
    println!("  {CYAN}{key:<14}{RESET}{value}");
}

/// Print a key-value row with custom key width.
pub fn print_kv_w(key: &str, value: &str, width: usize) {
    println!(
        "  {CYAN}{key:<width$}{RESET}{value}"
    );
}

/// Print a success confirmation.
pub fn print_ok(msg: &str) {
    println!();
    println!("  {GREEN_BRIGHT}{CHECK}{RESET} {msg}");
    println!();
}

/// Print an inline warning (no blank lines).
pub fn print_warn(msg: &str) {
    println!("  {YELLOW}{WARN_SYM}{RESET} {msg}");
}

/// Print a block error with blank lines.
pub fn print_err(msg: &str) {
    println!();
    println!("  {RED_BRIGHT}{CROSS}{RESET} {msg}");
    println!();
}

/// Print a muted secondary line.
pub fn print_muted(msg: &str) {
    println!("  {MUTED}{msg}{RESET}");
}

/// Print an inline thinking fragment (muted, streaming-compatible).
pub fn print_thinking_fragment(text: &str) {
    print!("{MUTED}{text}{RESET}");
    let _ = std::io::stdout().flush();
}

// ── CWD shortening ────────────────────────────────────────────────────────────

/// Shorten a path by replacing the home directory with `~`.
pub fn shorten_path(path: &std::path::Path) -> String {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();
    let s = path.to_string_lossy().replace('\\', "/");
    if !home.is_empty() {
        let home_slash = home.replace('\\', "/");
        if let Some(rest) = s.strip_prefix(&home_slash) {
            return format!("~{rest}");
        }
    }
    s.clone()
}
