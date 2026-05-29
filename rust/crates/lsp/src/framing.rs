//! LSP base-protocol message framing: `Content-Length: N\r\n\r\n` + JSON body.

use std::io::{self, BufRead};

/// Encode a JSON body as an LSP frame.
#[must_use]
pub fn encode_frame(body: &str) -> Vec<u8> {
    format!("Content-Length: {}\r\n\r\n{}", body.len(), body).into_bytes()
}

/// Read one LSP frame from `reader`, returning the JSON body, or `None` at EOF.
///
/// Parses `Content-Length` (case-insensitive) from the header block, skips other
/// headers, then reads exactly that many bytes of body.
///
/// # Errors
/// Returns an error if a read fails or the header block is malformed (missing or
/// non-numeric `Content-Length`).
pub fn read_frame<R: BufRead>(reader: &mut R) -> io::Result<Option<String>> {
    let mut content_length: Option<usize> = None;
    let mut saw_any_header = false;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line)?;
        if n == 0 {
            // EOF: clean if it happened before any header, else truncated.
            return if saw_any_header {
                Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "EOF inside LSP header block",
                ))
            } else {
                Ok(None)
            };
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break; // end of headers
        }
        saw_any_header = true;
        if let Some((name, value)) = trimmed.split_once(':') {
            if name.trim().eq_ignore_ascii_case("Content-Length") {
                content_length = value.trim().parse::<usize>().ok();
            }
        }
    }

    let length = content_length.ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "LSP frame missing Content-Length",
        )
    })?;

    let mut body = vec![0u8; length];
    read_exact_or_eof(reader, &mut body)?;
    Ok(Some(String::from_utf8_lossy(&body).into_owned()))
}

/// Read exactly `buf.len()` bytes, mapping EOF to a clear error.
fn read_exact_or_eof<R: BufRead>(reader: &mut R, buf: &mut [u8]) -> io::Result<()> {
    // `read_exact` comes from `Read`, available via the `BufRead` supertrait bound.
    reader.read_exact(buf).map_err(|error| {
        if error.kind() == io::ErrorKind::UnexpectedEof {
            io::Error::new(io::ErrorKind::UnexpectedEof, "EOF inside LSP frame body")
        } else {
            error
        }
    })
}

#[cfg(test)]
mod tests {
    use super::{encode_frame, read_frame};
    use std::io::Cursor;

    #[test]
    fn roundtrip_single_frame() {
        let body = "{\"jsonrpc\":\"2.0\",\"id\":1}";
        let frame = encode_frame(body);
        let mut cursor = Cursor::new(frame);
        let decoded = read_frame(&mut cursor).unwrap();
        assert_eq!(decoded.as_deref(), Some(body));
    }

    #[test]
    fn reads_two_back_to_back_frames() {
        let mut bytes = encode_frame("{\"a\":1}");
        bytes.extend(encode_frame("{\"b\":2}"));
        let mut cursor = Cursor::new(bytes);
        assert_eq!(
            read_frame(&mut cursor).unwrap().as_deref(),
            Some("{\"a\":1}")
        );
        assert_eq!(
            read_frame(&mut cursor).unwrap().as_deref(),
            Some("{\"b\":2}")
        );
        assert_eq!(read_frame(&mut cursor).unwrap(), None);
    }

    #[test]
    fn tolerates_extra_headers_and_case() {
        let body = "{\"ok\":true}";
        let raw = format!(
            "content-length: {}\r\nContent-Type: utf-8\r\n\r\n{body}",
            body.len()
        );
        let mut cursor = Cursor::new(raw.into_bytes());
        assert_eq!(read_frame(&mut cursor).unwrap().as_deref(), Some(body));
    }

    #[test]
    fn clean_eof_returns_none() {
        let mut cursor = Cursor::new(Vec::new());
        assert_eq!(read_frame(&mut cursor).unwrap(), None);
    }

    #[test]
    fn missing_content_length_is_error() {
        let mut cursor = Cursor::new(b"X-Header: 1\r\n\r\n".to_vec());
        assert!(read_frame(&mut cursor).is_err());
    }
}
