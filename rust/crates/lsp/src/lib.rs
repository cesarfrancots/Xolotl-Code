//! Minimal LSP support for post-edit diagnostics (P3 CP 3.3, D6/D7).
//!
//! The pure pieces — `Content-Length` frame encoding/decoding ([`framing`]) and
//! `publishDiagnostics` parsing + digest ([`protocol`]) — are always compiled and
//! unit-tested. The process-driving [`client`] that launches real language
//! servers (rust-analyzer / typescript-language-server / pyright) is gated behind
//! `--features lsp` so the default workspace build is unaffected.

pub mod framing;
pub mod protocol;

#[cfg(feature = "lsp")]
pub mod client;

pub use framing::{encode_frame, read_frame};
pub use protocol::{
    format_diagnostics_digest, parse_publish_diagnostics, server_command_for_extension,
    LspDiagnostic, Position, PublishDiagnosticsParams, Range, Severity,
};
