//! The structured document model produced from a PDF.
//!
//! A [`PdfDocument`] is an ordered list of [`Block`]s. Each block carries the
//! page it came from and a [`BlockKind`] describing what it is. This is the JSON
//! shape agents (and the UI) consume, and the source the Markdown renderer walks.

use serde::{Deserialize, Serialize};

/// A converted PDF as an ordered list of typed blocks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PdfDocument {
    /// Optional source path / file name, for provenance.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Number of pages the extractor saw.
    pub page_count: usize,
    /// Ordered content blocks across all pages.
    pub blocks: Vec<Block>,
}

impl PdfDocument {
    #[must_use]
    pub fn new(source: Option<String>, page_count: usize, blocks: Vec<Block>) -> Self {
        Self {
            source,
            page_count,
            blocks,
        }
    }

    /// `true` when no textual content was recovered (e.g. a scanned/image-only
    /// PDF, which deterministic extraction cannot read without OCR).
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.blocks.iter().all(Block::is_blank)
    }
}

/// What a [`Block`] represents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BlockKind {
    Heading,
    Paragraph,
    List,
    Table,
}

/// One unit of content: a heading, paragraph, list, or table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Block {
    /// 1-based page number this block was extracted from.
    pub page: usize,
    #[serde(rename = "type")]
    pub kind: BlockKind,
    /// Heading depth (1-6). Only set for [`BlockKind::Heading`].
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<u8>,
    /// Flattened text. For headings/paragraphs this is the content; for lists
    /// and tables it is a human-readable fallback (the structured form lives in
    /// `items` / `rows`).
    pub text: String,
    /// List items, when `kind == List`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub items: Option<Vec<String>>,
    /// `true` when the list is ordered (1. 2. 3.). Only meaningful for lists.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ordered: Option<bool>,
    /// Table rows (first row treated as header), when `kind == Table`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rows: Option<Vec<Vec<String>>>,
}

impl Block {
    #[must_use]
    pub fn heading(page: usize, level: u8, text: impl Into<String>) -> Self {
        Self {
            page,
            kind: BlockKind::Heading,
            level: Some(level.clamp(1, 6)),
            text: text.into(),
            items: None,
            ordered: None,
            rows: None,
        }
    }

    #[must_use]
    pub fn paragraph(page: usize, text: impl Into<String>) -> Self {
        Self {
            page,
            kind: BlockKind::Paragraph,
            level: None,
            text: text.into(),
            items: None,
            ordered: None,
            rows: None,
        }
    }

    #[must_use]
    pub fn list(page: usize, ordered: bool, items: Vec<String>) -> Self {
        let text = items.join("\n");
        Self {
            page,
            kind: BlockKind::List,
            level: None,
            text,
            items: Some(items),
            ordered: Some(ordered),
            rows: None,
        }
    }

    #[must_use]
    pub fn table(page: usize, rows: Vec<Vec<String>>) -> Self {
        let text = rows
            .iter()
            .map(|row| row.join(" | "))
            .collect::<Vec<_>>()
            .join("\n");
        Self {
            page,
            kind: BlockKind::Table,
            level: None,
            text,
            items: None,
            ordered: None,
            rows: Some(rows),
        }
    }

    #[must_use]
    fn is_blank(&self) -> bool {
        self.text.trim().is_empty()
    }
}
