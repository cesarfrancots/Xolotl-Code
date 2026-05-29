//! Recover a tool call from assistant *text* (P2 CP 2.3). Some open models with
//! weak native function-calling describe the call in prose instead of emitting
//! a structured tool-use block. This parser extracts the intent from the common
//! shapes and normalizes it to a [`ParsedToolCall`]:
//!
//! - a fenced ```tool / ```json block containing `{"name": ..., "arguments": ...}`;
//! - an XML-ish `<tool_use>…</tool_use>` / `<tool_call>…</tool_call>` wrapper;
//! - a bare JSON object carrying a tool name + arguments.
//!
//! It is deliberately conservative: plain prose with no tool-call structure
//! returns `None`. It never fabricates arguments — the arguments object is taken
//! verbatim (after JSON repair) from the text.

use crate::toolcall::repair_json;

/// A tool call recovered from assistant text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedToolCall {
    pub name: String,
    /// The arguments object as a JSON string (ready for the tool executor).
    pub input: String,
}

const NAME_KEYS: &[&str] = &["name", "tool", "tool_name", "function"];
const ARG_KEYS: &[&str] = &["arguments", "input", "parameters", "args", "params"];

/// Try to recover a tool call from assistant `text`. Returns `None` when no
/// tool-call structure is present.
#[must_use]
pub fn parse_tool_call_from_text(text: &str) -> Option<ParsedToolCall> {
    // 1. Fenced code block (```tool / ```json / ```), then any candidate JSON.
    for candidate in candidate_json_blocks(text) {
        if let Some(call) = from_json_str(&candidate) {
            return Some(call);
        }
    }
    None
}

/// Yield JSON-ish substrings worth trying, most-specific first: fenced blocks,
/// XML-tag bodies, then the first balanced `{…}` object in the text.
fn candidate_json_blocks(text: &str) -> Vec<String> {
    let mut candidates = Vec::new();

    // Fenced blocks.
    let mut rest = text;
    while let Some(open) = rest.find("```") {
        let after = &rest[open + 3..];
        // skip an optional language tag up to newline
        let body_start = after.find('\n').map_or(after.len(), |i| i + 1);
        let body = &after[body_start..];
        if let Some(close) = body.find("```") {
            candidates.push(body[..close].trim().to_string());
            rest = &body[close + 3..];
        } else {
            break;
        }
    }

    // XML-ish wrappers.
    for (open, close) in [
        ("<tool_use>", "</tool_use>"),
        ("<tool_call>", "</tool_call>"),
    ] {
        if let Some(start) = text.find(open) {
            let after = &text[start + open.len()..];
            if let Some(end) = after.find(close) {
                candidates.push(after[..end].trim().to_string());
            }
        }
    }

    // First balanced top-level object anywhere in the text.
    if let Some(object) = first_balanced_object(text) {
        candidates.push(object);
    }

    candidates
}

/// Extract the first balanced `{ … }` substring (string-aware), if any.
fn first_balanced_object(text: &str) -> Option<String> {
    let start = text.find('{')?;
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escape = false;
    for (idx, ch) in text[start..].char_indices() {
        if in_string {
            if escape {
                escape = false;
            } else if ch == '\\' {
                escape = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        match ch {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(text[start..start + idx + ch.len_utf8()].to_string());
                }
            }
            _ => {}
        }
    }
    None
}

/// Parse a candidate JSON string into a tool call (with repair), pulling the
/// name from any of [`NAME_KEYS`] and the arguments from any of [`ARG_KEYS`].
fn from_json_str(candidate: &str) -> Option<ParsedToolCall> {
    let repaired = repair_json(candidate)?;
    let value: serde_json::Value = serde_json::from_str(&repaired).ok()?;
    let object = value.as_object()?;

    let name = NAME_KEYS
        .iter()
        .find_map(|key| object.get(*key).and_then(serde_json::Value::as_str))?
        .to_string();
    if name.is_empty() {
        return None;
    }

    let arguments = ARG_KEYS
        .iter()
        .find_map(|key| object.get(*key))
        .cloned()
        .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
    let input = arguments.to_string();

    Some(ParsedToolCall { name, input })
}

#[cfg(test)]
mod tests {
    use super::parse_tool_call_from_text;

    #[test]
    fn parses_fenced_tool_block() {
        let text = "Sure, I'll do that.\n```tool\n{\"name\": \"read_file\", \"arguments\": {\"path\": \"a.txt\"}}\n```";
        let call = parse_tool_call_from_text(text).expect("parse");
        assert_eq!(call.name, "read_file");
        assert_eq!(call.input, r#"{"path":"a.txt"}"#);
    }

    #[test]
    fn parses_xml_tool_use_tag() {
        let text = "<tool_use>{\"tool\": \"bash\", \"input\": {\"command\": \"ls\"}}</tool_use>";
        let call = parse_tool_call_from_text(text).expect("parse");
        assert_eq!(call.name, "bash");
        assert_eq!(call.input, r#"{"command":"ls"}"#);
    }

    #[test]
    fn parses_bare_json_object() {
        let text = "I'll call: {\"name\": \"glob_search\", \"parameters\": {\"pattern\": \"**/*.rs\"}} now.";
        let call = parse_tool_call_from_text(text).expect("parse");
        assert_eq!(call.name, "glob_search");
        assert_eq!(call.input, r#"{"pattern":"**/*.rs"}"#);
    }

    #[test]
    fn repairs_malformed_arguments() {
        let text = "```json\n{\"name\": \"edit_file\", \"arguments\": {\"path\": \"x\",}}\n```";
        let call = parse_tool_call_from_text(text).expect("parse");
        assert_eq!(call.name, "edit_file");
        assert_eq!(call.input, r#"{"path":"x"}"#);
    }

    #[test]
    fn missing_arguments_defaults_to_empty_object() {
        let text = "```tool\n{\"name\": \"todo_read\"}\n```";
        let call = parse_tool_call_from_text(text).expect("parse");
        assert_eq!(call.name, "todo_read");
        assert_eq!(call.input, "{}");
    }

    #[test]
    fn plain_prose_returns_none() {
        assert_eq!(
            parse_tool_call_from_text("I think we should read the config file next."),
            None
        );
    }

    #[test]
    fn json_without_a_tool_name_returns_none() {
        assert_eq!(
            parse_tool_call_from_text("Here is data: {\"path\": \"x\", \"value\": 1}"),
            None
        );
    }
}
