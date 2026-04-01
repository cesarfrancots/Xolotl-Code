/// Centralized CLI styling — ANSI colors, box-drawing, and formatting helpers.
///
/// Inspired by Claude Code's visual language: clean typography, subtle box
/// drawing, consistent color semantics, and breathable layout.

// ── ANSI escape helpers ───────────────────────────────────────────────────────

/// Reset all formatting.
pub const RESET: &str = "\x1b[0m";
/// Dim / faint text (alias for MUTED).
#[allow(dead_code)]
pub const DIM: &str = "\x1b[2m";
/// Bold text.
pub const BOLD: &str = "\x1b[1m";
/// Italic text.
#[allow(dead_code)]
pub const ITALIC: &str = "\x1b[3m";

// ── Semantic colors ───────────────────────────────────────────────────────────

/// Primary accent — used for the brand name, active elements, headings.
pub const ACCENT: &str = "\x1b[38;2;139;92;246m"; // Purple #8B5CF6
/// Secondary accent — used for key names, commands, labels.
pub const CYAN: &str = "\x1b[36m";
/// Success — checkmarks, confirmations.
pub const GREEN: &str = "\x1b[32m";
/// Warning — non-fatal issues.
pub const YELLOW: &str = "\x1b[33m";
/// Error — failures, denials.
pub const RED: &str = "\x1b[31m";
/// Muted — secondary info, paths, tips.
pub const MUTED: &str = "\x1b[2m";
/// White bold — emphasis within body text.
pub const WHITE_BOLD: &str = "\x1b[1;37m";

// ── Box-drawing characters ────────────────────────────────────────────────────

#[allow(dead_code)]
pub const DIVIDER: &str = "────────────────────────────────────────────────────────";
pub const DIVIDER_SHORT: &str = "──────────────────────────────────";
pub const CHECK: &str = "✔";
pub const CROSS: &str = "✘";
pub const WARN: &str = "⚠";
pub const DOT: &str = "·";
pub const ARROW_UP: &str = "↑";
pub const ARROW_DOWN: &str = "↓";
pub const ARROW_RIGHT: &str = "→";

// ── Formatting helpers ────────────────────────────────────────────────────────

/// Print a section header (bold, with divider below).
pub fn print_header(title: &str) {
    println!();
    println!("  {WHITE_BOLD}{title}{RESET}");
    println!("  {MUTED}{DIVIDER_SHORT}{RESET}");
}

/// Print a labeled value pair.
pub fn print_kv(key: &str, value: &str) {
    println!("  {CYAN}{key:<14}{RESET}{value}");
}

/// Print a success message.
pub fn print_ok(msg: &str) {
    println!("\n  {GREEN}{CHECK}{RESET} {msg}\n");
}

/// Print a warning message.
pub fn print_warn(msg: &str) {
    println!("  {YELLOW}{WARN}{RESET} {msg}");
}

/// Print an error message.
pub fn print_err(msg: &str) {
    println!("\n  {RED}{CROSS}{RESET} {msg}\n");
}

/// Print a muted/dim line.
pub fn print_muted(msg: &str) {
    println!("  {MUTED}{msg}{RESET}");
}

/// Format a model name for display (strips `bedrock/` prefix for cleanliness).
pub fn format_model(model: &str) -> String {
    model.strip_prefix("bedrock/").unwrap_or(model).to_string()
}
