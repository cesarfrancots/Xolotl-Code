//! Deterministic, marker-inspired layout heuristics.
//!
//! Turns the raw per-page text from [`crate::extract`] into a structured
//! [`PdfDocument`]. No machine learning and no network: every decision here is a
//! plain rule over whitespace, casing, and punctuation. The goal is "good enough
//! structure to read cheaply", not pixel-perfect reconstruction.
//!
//! Pipeline per page: split into blank-line-separated blocks, then classify each
//! block as a table, list, heading, or paragraph (in that priority order).

use std::sync::OnceLock;

use regex::Regex;

use crate::model::{Block, PdfDocument};

/// Maximum character width for a line to still be considered a heading.
const HEADING_MAX_CHARS: usize = 90;
/// Maximum word count for a heading candidate.
const HEADING_MAX_WORDS: usize = 12;

/// Build a [`PdfDocument`] from already-extracted per-page text.
///
/// This is the pure, testable core — it never touches the filesystem or the PDF
/// parser, so the heuristics can be exercised directly.
#[must_use]
pub fn analyze_pages(pages: &[String], source: Option<String>) -> PdfDocument {
    let mut blocks = Vec::new();
    for (idx, page_text) in pages.iter().enumerate() {
        let page_no = idx + 1;
        for raw_block in split_blocks(page_text) {
            if let Some(block) = classify_block(page_no, &raw_block) {
                blocks.push(block);
            }
        }
    }
    PdfDocument::new(source, pages.len(), blocks)
}

/// Split a page into blocks of consecutive non-empty lines, separated by blank
/// lines. Trailing whitespace is trimmed; fully blank lines act as separators.
fn split_blocks(page: &str) -> Vec<Vec<String>> {
    let mut blocks = Vec::new();
    let mut current: Vec<String> = Vec::new();
    for raw in page.replace('\r', "").lines() {
        let line = raw.trim_end();
        if line.trim().is_empty() {
            if !current.is_empty() {
                blocks.push(std::mem::take(&mut current));
            }
        } else {
            current.push(line.to_string());
        }
    }
    if !current.is_empty() {
        blocks.push(current);
    }
    blocks
}

/// Classify one block. Returns `None` for blocks that hold no usable text.
fn classify_block(page: usize, lines: &[String]) -> Option<Block> {
    if lines.iter().all(|l| l.trim().is_empty()) {
        return None;
    }
    if let Some(rows) = detect_table(lines) {
        return Some(Block::table(page, rows));
    }
    if let Some((ordered, items)) = detect_list(lines) {
        return Some(Block::list(page, ordered, items));
    }
    if lines.len() == 1 {
        if let Some(level) = heading_level(lines[0].trim()) {
            return Some(Block::heading(page, level, lines[0].trim()));
        }
    }
    let text = reflow_paragraph(lines);
    if text.is_empty() {
        None
    } else {
        Some(Block::paragraph(page, text))
    }
}

// ── Tables ──────────────────────────────────────────────────────────────────

/// Detect a column-aligned table. A block qualifies when at least two lines
/// split into two-or-more cells on runs of 2+ spaces, and those tabular lines
/// make up at least half the block.
fn detect_table(lines: &[String]) -> Option<Vec<Vec<String>>> {
    if lines.len() < 2 {
        return None;
    }
    let split: Vec<Vec<String>> = lines.iter().map(|l| split_columns(l)).collect();
    let tabular = split.iter().filter(|cells| cells.len() >= 2).count();
    if tabular < 2 || tabular * 2 < lines.len() {
        return None;
    }
    let width = split.iter().map(Vec::len).max().unwrap_or(0);
    if width < 2 {
        return None;
    }
    let rows = split
        .into_iter()
        .map(|mut cells| {
            cells.resize(width, String::new());
            cells
        })
        .collect();
    Some(rows)
}

/// Split a line into cells on runs of two or more spaces.
fn split_columns(line: &str) -> Vec<String> {
    column_splitter()
        .split(line.trim())
        .map(str::trim)
        .filter(|cell| !cell.is_empty())
        .map(ToString::to_string)
        .collect()
}

// ── Lists ───────────────────────────────────────────────────────────────────

/// Detect a bullet or ordered list. Requires at least two lines, every one of
/// which carries a list marker. Returns `(ordered, items)`.
fn detect_list(lines: &[String]) -> Option<(bool, Vec<String>)> {
    if lines.len() < 2 {
        return None;
    }
    let mut items = Vec::with_capacity(lines.len());
    let mut ordered_hits = 0usize;
    for line in lines {
        let trimmed = line.trim();
        if let Some(rest) = strip_bullet(trimmed) {
            items.push(rest.to_string());
        } else if let Some(rest) = strip_ordered(trimmed) {
            ordered_hits += 1;
            items.push(rest.to_string());
        } else {
            return None;
        }
    }
    Some((ordered_hits * 2 >= lines.len(), items))
}

/// Strip a leading bullet marker (`-`, `*`, `•`, …). Returns the remaining text.
fn strip_bullet(line: &str) -> Option<&str> {
    let mut chars = line.chars();
    let first = chars.next()?;
    if matches!(first, '-' | '*' | '•' | '·' | '–' | '‣' | '▪' | '◦' | '●') {
        let rest = chars.as_str();
        if rest.starts_with(' ') || rest.starts_with('\t') {
            return Some(rest.trim_start());
        }
    }
    None
}

/// Strip a leading ordered marker (`1.`, `2)`, `a.`, `iv)` …).
fn strip_ordered(line: &str) -> Option<&str> {
    let caps = ordered_marker().captures(line)?;
    let full = caps.get(0)?;
    Some(line[full.end()..].trim_start())
}

// ── Headings ────────────────────────────────────────────────────────────────

/// Heading depth for a single line, or `None` if it does not look like one.
fn heading_level(line: &str) -> Option<u8> {
    let char_count = line.chars().count();
    if char_count == 0 || char_count > HEADING_MAX_CHARS {
        return None;
    }
    let words = line.split_whitespace().count();
    if words == 0 || words > HEADING_MAX_WORDS {
        return None;
    }

    if let Some(level) = numbered_heading_level(line) {
        return Some(level);
    }

    // A line ending in sentence punctuation is prose, not a heading.
    if line.ends_with(['.', ',', ';']) {
        return None;
    }
    if is_mostly_uppercase(line) {
        return Some(2);
    }
    if words <= 8 && is_title_case(line) {
        return Some(3);
    }
    None
}

/// Level for a numbered heading like `2.1 Methods`. The depth follows the dotted
/// number. Plain `1.`-style numbers only count when the trailing text reads like
/// a title (short and capitalised) so ordinary "1. buy milk" lines stay prose.
fn numbered_heading_level(line: &str) -> Option<u8> {
    let caps = numbered_heading().captures(line)?;
    let number = caps.get(1)?.as_str();
    let rest = caps.get(2)?.as_str().trim();
    if rest.is_empty() {
        return None;
    }
    let dots = number.matches('.').count();
    let title_like =
        rest.split_whitespace().count() <= 8 && rest.chars().next().is_some_and(char::is_uppercase);
    if dots == 0 && !title_like {
        return None;
    }
    let depth = (dots + 1).min(4);
    Some(u8::try_from(depth).unwrap_or(4))
}

/// `true` when at least 70% of the alphabetic characters are uppercase.
fn is_mostly_uppercase(line: &str) -> bool {
    let mut upper = 0usize;
    let mut letters = 0usize;
    for ch in line.chars().filter(|c| c.is_alphabetic()) {
        letters += 1;
        if ch.is_uppercase() {
            upper += 1;
        }
    }
    letters >= 2 && upper * 10 >= letters * 7
}

/// `true` when every significant word (length ≥ 4) starts uppercase — a decent
/// proxy for Title Case that tolerates lowercase function words (of, the, and…).
fn is_title_case(line: &str) -> bool {
    let mut significant = 0usize;
    for word in line.split_whitespace() {
        let first = word.chars().next();
        let Some(first) = first else { continue };
        if !first.is_alphabetic() {
            return false;
        }
        if word.chars().count() >= 4 {
            significant += 1;
            if !first.is_uppercase() {
                return false;
            }
        }
    }
    significant >= 1
}

// ── Paragraphs ──────────────────────────────────────────────────────────────

/// Join wrapped lines into a single paragraph, de-hyphenating across line breaks
/// and collapsing runs of whitespace.
fn reflow_paragraph(lines: &[String]) -> String {
    let mut out = String::new();
    for line in lines {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if out.is_empty() {
            out.push_str(trimmed);
            continue;
        }
        if ends_with_soft_hyphen(&out) && starts_lowercase(trimmed) {
            out.pop();
            out.push_str(trimmed);
        } else {
            out.push(' ');
            out.push_str(trimmed);
        }
    }
    collapse_whitespace(&out)
}

/// `true` when `text` ends with a hyphen that follows a letter (a wrapped word).
fn ends_with_soft_hyphen(text: &str) -> bool {
    let mut chars = text.chars().rev();
    chars.next() == Some('-') && chars.next().is_some_and(char::is_alphabetic)
}

fn starts_lowercase(text: &str) -> bool {
    text.chars().next().is_some_and(char::is_lowercase)
}

fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

// ── Cached regexes ──────────────────────────────────────────────────────────

fn column_splitter() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r" {2,}|\t+").expect("valid column regex"))
}

fn ordered_marker() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^(?:\(?\d{1,3}|[a-zA-Z]|[ivxIVX]{1,4})[.)]\s+").expect("valid ordered regex")
    })
}

fn numbered_heading() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^(\d+(?:\.\d+)*)[.)]?\s+(.+)$").expect("valid numbered regex"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::BlockKind;

    fn analyze_one(page: &str) -> Vec<Block> {
        analyze_pages(&[page.to_string()], None).blocks
    }

    #[test]
    fn detects_numbered_heading() {
        let blocks = analyze_one("2.1 Methods And Materials\n\nWe ran the assay.");
        assert_eq!(blocks[0].kind, BlockKind::Heading);
        assert_eq!(blocks[0].level, Some(2));
        assert_eq!(blocks[1].kind, BlockKind::Paragraph);
    }

    #[test]
    fn detects_all_caps_heading() {
        let blocks = analyze_one("INTRODUCTION\n\nbody text here that is long enough.");
        assert_eq!(blocks[0].kind, BlockKind::Heading);
        assert_eq!(blocks[0].text, "INTRODUCTION");
    }

    #[test]
    fn reflows_and_dehyphenates_paragraph() {
        let blocks =
            analyze_one("The quick brown fox jum-\nped over the lazy dog\nand kept running.");
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].kind, BlockKind::Paragraph);
        assert_eq!(
            blocks[0].text,
            "The quick brown fox jumped over the lazy dog and kept running."
        );
    }

    #[test]
    fn detects_bullet_list() {
        let blocks = analyze_one("- first item\n- second item\n- third item");
        assert_eq!(blocks[0].kind, BlockKind::List);
        assert_eq!(blocks[0].ordered, Some(false));
        assert_eq!(blocks[0].items.as_ref().unwrap().len(), 3);
    }

    #[test]
    fn detects_ordered_list() {
        let blocks = analyze_one("1. alpha\n2. beta\n3. gamma");
        assert_eq!(blocks[0].kind, BlockKind::List);
        assert_eq!(blocks[0].ordered, Some(true));
    }

    #[test]
    fn detects_table() {
        let blocks = analyze_one("Name    Age   City\nAlice   30    NYC\nBob     25    LA");
        assert_eq!(blocks[0].kind, BlockKind::Table);
        let rows = blocks[0].rows.as_ref().unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0], vec!["Name", "Age", "City"]);
        assert_eq!(rows[1], vec!["Alice", "30", "NYC"]);
    }

    #[test]
    fn lone_ordered_item_is_not_a_list() {
        // A single "1. Foo" line is a heading candidate, not a one-item list.
        let blocks = analyze_one("1. Introduction");
        assert_eq!(blocks[0].kind, BlockKind::Heading);
    }

    #[test]
    fn plain_prose_stays_paragraph() {
        let blocks = analyze_one("This is an ordinary sentence that should remain a paragraph.");
        assert_eq!(blocks[0].kind, BlockKind::Paragraph);
    }

    #[test]
    fn page_numbers_are_tracked() {
        let doc = analyze_pages(
            &["First page.".to_string(), "Second page.".to_string()],
            None,
        );
        assert_eq!(doc.page_count, 2);
        assert_eq!(doc.blocks[0].page, 1);
        assert_eq!(doc.blocks[1].page, 2);
    }
}
