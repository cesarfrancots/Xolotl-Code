//! Raw text extraction via the pure-Rust `pdf-extract` crate.
//!
//! `pdf-extract` decodes the PDF content streams and maps glyphs back to Unicode
//! entirely in Rust — no OCR, no native libraries, no network. We isolate it
//! behind [`std::panic::catch_unwind`] because malformed PDFs can make the parser
//! panic, and a single bad document must never take down the host agent.
//!
//! Note: `pdf-extract` prints occasional diagnostic lines (e.g. "Unicode
//! mismatch" for `fi`/`fl` ligatures) directly to the process stdout. Those go
//! to the host console only — they are never part of the [`String`] we return,
//! so the converted Markdown/JSON handed to agents stays clean.

use crate::PdfError;

/// Extract one string of text per page.
///
/// Image-only / scanned pages come back as empty strings (deterministic
/// extraction cannot read them without OCR, which is out of scope by design).
pub fn extract_pdf_pages(bytes: &[u8]) -> Result<Vec<String>, PdfError> {
    let owned = bytes.to_vec();
    let outcome =
        std::panic::catch_unwind(move || pdf_extract::extract_text_from_mem_by_pages(&owned));
    match outcome {
        Ok(Ok(pages)) => Ok(pages),
        Ok(Err(err)) => Err(PdfError::Extract(err.to_string())),
        Err(_) => Err(PdfError::Panic),
    }
}
