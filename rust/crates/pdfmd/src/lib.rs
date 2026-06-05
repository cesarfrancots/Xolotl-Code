//! Deterministic PDF → Markdown / JSON conversion.
//!
//! The point of this crate is to let coding agents read PDFs **cheaply**. Instead
//! of handing a model thousands of unreadable binary bytes (or paying for OCR /
//! a vision model), we extract the embedded text with the pure-Rust
//! [`pdf-extract`](https://crates.io/crates/pdf-extract) crate and apply a set of
//! marker-inspired layout heuristics to recover headings, lists, tables, and
//! reflowed paragraphs. The result is compact Markdown (or a structured JSON
//! document model) that costs a fraction of the tokens.
//!
//! No machine learning, no network calls, no OCR — every step is a plain rule.
//!
//! ```no_run
//! let bytes = std::fs::read("paper.pdf").unwrap();
//! let markdown = pdfmd::pdf_to_markdown(&bytes).unwrap();
//! println!("{markdown}");
//! ```

mod extract;
mod model;
mod render;
mod structure;

use std::path::Path;

pub use extract::extract_pdf_pages;
pub use model::{Block, BlockKind, PdfDocument};
pub use render::render_markdown;
pub use structure::analyze_pages;

/// Errors that can occur while converting a PDF.
#[derive(Debug, thiserror::Error)]
pub enum PdfError {
    #[error("could not read PDF file: {0}")]
    Io(#[from] std::io::Error),
    #[error("PDF text extraction failed: {0}")]
    Extract(String),
    #[error("the PDF parser panicked while reading the document (likely malformed or encrypted)")]
    Panic,
    #[error("failed to serialize document to JSON: {0}")]
    Json(#[from] serde_json::Error),
}

/// Output format for the convenience converters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputFormat {
    Markdown,
    Json,
}

impl OutputFormat {
    /// Parse a format from a string (`"md"`/`"markdown"` or `"json"`),
    /// defaulting to Markdown.
    #[must_use]
    pub fn parse(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "json" => Self::Json,
            _ => Self::Markdown,
        }
    }
}

/// Parse a PDF (raw bytes) into the structured [`PdfDocument`] model.
pub fn pdf_to_document(bytes: &[u8], source: Option<String>) -> Result<PdfDocument, PdfError> {
    let pages = extract_pdf_pages(bytes)?;
    Ok(analyze_pages(&pages, source))
}

/// Convert a PDF (raw bytes) to Markdown.
pub fn pdf_to_markdown(bytes: &[u8]) -> Result<String, PdfError> {
    let doc = pdf_to_document(bytes, None)?;
    Ok(render_markdown(&doc))
}

/// Convert a PDF (raw bytes) to a pretty-printed JSON document model.
pub fn pdf_to_json(bytes: &[u8]) -> Result<String, PdfError> {
    let doc = pdf_to_document(bytes, None)?;
    Ok(serde_json::to_string_pretty(&doc)?)
}

/// Convert raw bytes to the requested format, tagging the document with `source`.
pub fn convert_bytes(
    bytes: &[u8],
    source: Option<String>,
    format: OutputFormat,
) -> Result<String, PdfError> {
    let doc = pdf_to_document(bytes, source)?;
    match format {
        OutputFormat::Markdown => Ok(render_markdown(&doc)),
        OutputFormat::Json => Ok(serde_json::to_string_pretty(&doc)?),
    }
}

/// Read a PDF file from disk and convert it. The file name is recorded as the
/// document `source`.
pub fn convert_file(path: &Path, format: OutputFormat) -> Result<String, PdfError> {
    let bytes = std::fs::read(path)?;
    let source = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(ToString::to_string);
    convert_bytes(&bytes, source, format)
}

/// `true` when `path` has a `.pdf` extension (case-insensitive).
#[must_use]
pub fn is_pdf_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
}

/// `true` when `bytes` begin with the `%PDF-` signature.
#[must_use]
pub fn looks_like_pdf(bytes: &[u8]) -> bool {
    bytes.starts_with(b"%PDF-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_parse_defaults_to_markdown() {
        assert_eq!(OutputFormat::parse("json"), OutputFormat::Json);
        assert_eq!(OutputFormat::parse("JSON"), OutputFormat::Json);
        assert_eq!(OutputFormat::parse("md"), OutputFormat::Markdown);
        assert_eq!(OutputFormat::parse("anything"), OutputFormat::Markdown);
    }

    #[test]
    fn pdf_path_detection() {
        assert!(is_pdf_path(Path::new("/tmp/report.pdf")));
        assert!(is_pdf_path(Path::new("REPORT.PDF")));
        assert!(!is_pdf_path(Path::new("/tmp/report.txt")));
    }

    #[test]
    fn pdf_signature_detection() {
        assert!(looks_like_pdf(b"%PDF-1.7\n..."));
        assert!(!looks_like_pdf(b"not a pdf"));
    }
}
