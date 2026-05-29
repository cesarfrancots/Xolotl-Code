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
    let candidates = candidate_json_blocks(text);
    // Pass 1: prefer a candidate that carries an explicit arguments OBJECT. This
    // wins over a name-only example block (avoids selecting the wrong tool) and
    // is the only shape accepted for a *bare* (non-structural) prose object —
    // so incidental data JSON like `{"name":"x","role":"y"}` is NOT a tool call.
    for (candidate, _structural) in &candidates {
        if let Some(call) = from_json_str(candidate, true) {
            return Some(call);
        }
    }
    // Pass 2: a *structural* block (fenced / <tool_use>) with a name but no args
    // is still a legitimate no-argument call (e.g. ```tool {"name":"todo_read"}).
    for (candidate, structural) in &candidates {
        if *structural {
            if let Some(call) = from_json_str(candidate, false) {
                return Some(call);
            }
        }
    }
    None
}

/// Yield `(json_substring, is_structural)` candidates. Structural ones come from
/// an explicit tool-call wrapper (fenced block / XML tag); the trailing bare
/// balanced object from free prose is non-structural.
fn candidate_json_blocks(text: &str) -> Vec<(String, bool)> {
    let mut candidates = Vec::new();

    // Fenced blocks (structural).
    let mut rest = text;
    while let Some(open) = rest.find("```") {
        let after = &rest[open + 3..];
        // skip an optional language tag up to newline
        let body_start = after.find('\n').map_or(after.len(), |i| i + 1);
        let body = &after[body_start..];
        if let Some(close) = body.find("```") {
            candidates.push((body[..close].trim().to_string(), true));
            rest = &body[close + 3..];
        } else {
            break;
        }
    }

    // XML-ish wrappers (structural).
    for (open, close) in [
        ("<tool_use>", "</tool_use>"),
        ("<tool_call>", "</tool_call>"),
    ] {
        if let Some(start) = text.find(open) {
            let after = &text[start + open.len()..];
            if let Some(end) = after.find(close) {
                candidates.push((after[..end].trim().to_string(), true));
            }
        }
    }

    // First balanced top-level object anywhere in the text (non-structural).
    if let Some(object) = first_balanced_object(text) {
        candidates.push((object, false));
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

/// Parse a candidate JSON string into a tool call (with repair). Requires a
/// non-empty name from [`NAME_KEYS`]. The arguments must be a JSON *object*
/// taken from the first [`ARG_KEYS`] key whose value is an object (a scalar
/// `input`/`args` is ignored, so the real `parameters` object isn't shadowed).
/// When `require_args` is true, a candidate with no arguments object is
/// rejected.
fn from_json_str(candidate: &str, require_args: bool) -> Option<ParsedToolCall> {
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
        .find_map(|key| object.get(*key).filter(|value| value.is_object()))
        .cloned();
    match arguments {
        Some(arguments) => Some(ParsedToolCall {
            name,
            input: arguments.to_string(),
        }),
        None if require_args => None,
        None => Some(ParsedToolCall {
            name,
            input: "{}".to_string(),
        }),
    }
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

    #[test]
    fn prose_object_with_only_a_name_is_not_a_tool_call() {
        // Incidental data JSON in prose carrying a "name" key must NOT be taken
        // as a tool call (a bare object needs an arguments object).
        assert_eq!(
            parse_tool_call_from_text(
                "Here is the user record: {\"name\": \"delete_old_logs\", \"role\": \"admin\"}"
            ),
            None
        );
    }

    #[test]
    fn prefers_the_block_that_carries_arguments() {
        // An example block (name only) precedes the real call (name + args); the
        // real one must win.
        let text = "```json\n{\"name\": \"production\", \"function\": \"web-server\"}\n```\n\
                    ```tool\n{\"name\": \"bash\", \"arguments\": {\"command\": \"deploy\"}}\n```";
        let call = parse_tool_call_from_text(text).expect("parse");
        assert_eq!(call.name, "bash");
        assert_eq!(call.input, r#"{"command":"deploy"}"#);
    }

    #[test]
    fn picks_the_object_valued_argument_key_over_a_scalar() {
        let text = "{\"name\": \"search\", \"input\": \"user typed this\", \"parameters\": {\"q\": \"rust\"}}";
        let call = parse_tool_call_from_text(text).expect("parse");
        assert_eq!(call.name, "search");
        assert_eq!(call.input, r#"{"q":"rust"}"#);
    }
}
