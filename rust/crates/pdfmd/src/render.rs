//! Render a [`PdfDocument`] to GitHub-flavoured Markdown.

use std::fmt::Write as _;

use crate::model::{Block, BlockKind, PdfDocument};

/// Render the whole document to Markdown. Pages are separated by a horizontal
/// rule so an agent can still tell where one ends and the next begins.
#[must_use]
pub fn render_markdown(doc: &PdfDocument) -> String {
    let mut out = String::new();
    let mut last_page = 0usize;
    for block in &doc.blocks {
        if last_page != 0 && block.page != last_page {
            out.push_str("\n---\n\n");
        }
        last_page = block.page;
        render_block(&mut out, block);
        out.push('\n');
    }
    let trimmed = out.trim_end();
    let mut result = trimmed.to_string();
    if !result.is_empty() {
        result.push('\n');
    }
    result
}

fn render_block(out: &mut String, block: &Block) {
    match block.kind {
        BlockKind::Heading => {
            let level = block.level.unwrap_or(2).clamp(1, 6) as usize;
            out.push_str(&"#".repeat(level));
            out.push(' ');
            out.push_str(block.text.trim());
            out.push('\n');
        }
        BlockKind::Paragraph => {
            out.push_str(block.text.trim());
            out.push('\n');
        }
        BlockKind::List => render_list(out, block),
        BlockKind::Table => render_table(out, block),
    }
}

fn render_list(out: &mut String, block: &Block) {
    let ordered = block.ordered.unwrap_or(false);
    let empty = Vec::new();
    let items = block.items.as_ref().unwrap_or(&empty);
    for (idx, item) in items.iter().enumerate() {
        if ordered {
            let _ = writeln!(out, "{}. {}", idx + 1, item.trim());
        } else {
            let _ = writeln!(out, "- {}", item.trim());
        }
    }
}

fn render_table(out: &mut String, block: &Block) {
    let Some(rows) = block.rows.as_ref() else {
        return;
    };
    if rows.is_empty() {
        return;
    }
    let columns = rows.iter().map(Vec::len).max().unwrap_or(0);
    if columns == 0 {
        return;
    }
    write_table_row(out, &rows[0], columns);
    out.push('|');
    for _ in 0..columns {
        out.push_str(" --- |");
    }
    out.push('\n');
    for row in &rows[1..] {
        write_table_row(out, row, columns);
    }
}

fn write_table_row(out: &mut String, row: &[String], columns: usize) {
    out.push('|');
    for col in 0..columns {
        let cell = row.get(col).map_or("", String::as_str);
        let _ = write!(out, " {} |", escape_cell(cell.trim()));
    }
    out.push('\n');
}

/// Escape characters that would break a Markdown table cell.
fn escape_cell(cell: &str) -> String {
    cell.replace('|', "\\|").replace('\n', " ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::structure::analyze_pages;

    fn render(page: &str) -> String {
        render_markdown(&analyze_pages(&[page.to_string()], None))
    }

    #[test]
    fn renders_heading_and_paragraph() {
        let md = render("INTRODUCTION\n\nSome body text that is long enough to keep.");
        assert!(md.contains("## INTRODUCTION"));
        assert!(md.contains("Some body text"));
    }

    #[test]
    fn renders_ordered_list() {
        let md = render("1. alpha\n2. beta\n3. gamma");
        assert!(md.contains("1. alpha"));
        assert!(md.contains("3. gamma"));
    }

    #[test]
    fn renders_gfm_table() {
        let md = render("Name    Age\nAlice   30\nBob     25");
        assert!(md.contains("| Name | Age |"));
        assert!(md.contains("| --- | --- |"));
        assert!(md.contains("| Alice | 30 |"));
    }

    #[test]
    fn separates_pages_with_rule() {
        let doc = analyze_pages(
            &["Page one text.".to_string(), "Page two text.".to_string()],
            None,
        );
        let md = render_markdown(&doc);
        assert!(md.contains("---"));
    }

    #[test]
    fn escapes_pipe_in_table_cell() {
        let md = render("Col A      Col B\na | b      value");
        assert!(md.contains("\\|"));
    }
}
