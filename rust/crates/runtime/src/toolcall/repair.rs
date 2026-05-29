//! Conservative JSON repair for malformed tool-call arguments (D5).
//!
//! Open models often emit *almost*-valid JSON: wrapped in ``` fences, with a
//! trailing comma, or truncated mid-structure. This module salvages such
//! payloads with a fixed, conservative pipeline — strip fences, drop trailing
//! commas, close unterminated strings/brackets — re-checking validity after
//! each step.
//!
//! Hard rule (R2): **never fabricate a value.** Repair only completes structural
//! delimiters and partial literals that are already present; it never invents a
//! missing field's value. Anything still unparseable returns `None` rather than
//! a guess. No external dependency (hand-rolled).

/// Attempt to turn `raw` into parseable JSON without inventing values. Returns
/// the repaired string when it parses as JSON, otherwise `None`.
#[must_use]
pub fn repair_json(raw: &str) -> Option<String> {
    if is_valid(raw) {
        return Some(raw.to_string());
    }
    let stripped = strip_code_fences(raw.trim());
    if is_valid(&stripped) {
        return Some(stripped);
    }
    let no_commas = remove_trailing_commas(&stripped);
    if is_valid(&no_commas) {
        return Some(no_commas);
    }
    let balanced = balance_delimiters(&no_commas);
    if is_valid(&balanced) {
        return Some(balanced);
    }
    // NOTE: we deliberately do NOT run remove_trailing_commas *after* balancing.
    // A payload truncated right after a separating comma (e.g. `{"xs":[1,2,`)
    // balances to `{"xs":[1,2,]}`; stripping that comma would silently assert
    // the collection was complete at 2 elements when the source signalled a 3rd
    // was coming — a fabrication (R2). Leaving it invalid returns `None`, which
    // is the correct "don't guess" outcome.
    None
}

fn is_valid(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text).is_ok()
}

/// Remove a wrapping markdown code fence (```json / ```tool / ```), if present.
///
/// Handles both multi-line fences (opening ``` on its own line) and single-line
/// fences (```json{...}```). The closing fence is only stripped when it is a
/// genuine trailing ``` — never via a content-blind search, so a literal ```
/// inside a JSON string value can't truncate the payload.
fn strip_code_fences(text: &str) -> String {
    let trimmed = text.trim();
    let Some(after_ticks) = trimmed.strip_prefix("```") else {
        return trimmed.to_string();
    };
    // The opening fence info (optional language tag) ends at the first newline;
    // for a single-line fence, skip just the leading language token.
    let body = match after_ticks.find('\n') {
        Some(nl) => &after_ticks[nl + 1..],
        None => after_ticks.trim_start_matches(|c: char| c.is_ascii_alphanumeric()),
    };
    // Strip a trailing closing fence only if it really is at the end.
    let body = body.trim();
    let body = body.strip_suffix("```").unwrap_or(body);
    body.trim().to_string()
}

/// Drop commas that immediately precede a closing `}` or `]` (ignoring
/// whitespace), respecting string literals so commas inside strings are kept.
fn remove_trailing_commas(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut in_string = false;
    let mut escape = false;
    for (i, &ch) in chars.iter().enumerate() {
        if in_string {
            out.push(ch);
            if escape {
                escape = false;
            } else if ch == '\\' {
                escape = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        if ch == '"' {
            in_string = true;
            out.push(ch);
            continue;
        }
        if ch == ',' {
            // Look ahead past whitespace for a closing bracket.
            let next = chars[i + 1..].iter().find(|c| !c.is_whitespace()).copied();
            if matches!(next, Some('}' | ']')) {
                continue; // skip this trailing comma
            }
        }
        out.push(ch);
    }
    out
}

/// Close an unterminated trailing string and any still-open `{`/`[` in the
/// correct order. Never adds keys or values — only structural closers.
fn balance_delimiters(text: &str) -> String {
    let mut stack: Vec<char> = Vec::new();
    let mut in_string = false;
    let mut escape = false;
    for ch in text.chars() {
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
            '{' | '[' => stack.push(ch),
            '}' | ']' => {
                stack.pop();
            }
            _ => {}
        }
    }
    let mut out = text.to_string();
    if in_string {
        out.push('"');
    }
    for opener in stack.iter().rev() {
        out.push(if *opener == '{' { '}' } else { ']' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::repair_json;

    #[test]
    fn passes_through_valid_json() {
        assert_eq!(repair_json(r#"{"a":1}"#).as_deref(), Some(r#"{"a":1}"#));
    }

    #[test]
    fn strips_code_fences() {
        let raw = "```json\n{\"path\": \"x\"}\n```";
        assert_eq!(repair_json(raw).as_deref(), Some(r#"{"path": "x"}"#));
    }

    #[test]
    fn removes_trailing_comma() {
        assert_eq!(
            repair_json(r#"{"a":1,"b":2,}"#).as_deref(),
            Some(r#"{"a":1,"b":2}"#)
        );
    }

    #[test]
    fn closes_truncated_object() {
        // truncated mid-structure: missing closing brace
        let repaired = repair_json(r#"{"a": 1, "b": 2"#).expect("repairable");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&repaired).unwrap(),
            serde_json::json!({"a": 1, "b": 2})
        );
    }

    #[test]
    fn closes_truncated_string_value() {
        let repaired = repair_json(r#"{"path": "src/lib"#).expect("repairable");
        let v: serde_json::Value = serde_json::from_str(&repaired).unwrap();
        assert_eq!(v["path"], "src/lib");
    }

    #[test]
    fn closes_nested_array_and_object() {
        let repaired = repair_json(r#"{"xs": [1, 2, 3"#).expect("repairable");
        let v: serde_json::Value = serde_json::from_str(&repaired).unwrap();
        assert_eq!(v["xs"], serde_json::json!([1, 2, 3]));
    }

    #[test]
    fn does_not_fabricate_value_for_dangling_key() {
        // a key with no value cannot be repaired without inventing a value.
        assert_eq!(repair_json(r#"{"path":"#), None);
    }

    #[test]
    fn irreparable_garbage_returns_none() {
        assert_eq!(repair_json("this is not json at all <<<"), None);
    }

    #[test]
    fn keeps_commas_inside_strings() {
        let repaired = repair_json(r#"{"msg": "a, b, c",}"#).expect("repairable");
        let v: serde_json::Value = serde_json::from_str(&repaired).unwrap();
        assert_eq!(v["msg"], "a, b, c");
    }

    #[test]
    fn embedded_backticks_in_value_are_not_truncated() {
        // A fenced payload whose value contains a literal ``` must keep that
        // value intact (the old content-blind rfind silently truncated it).
        let raw = "```\n{\"cmd\":\"run ```\"}";
        let repaired = repair_json(raw).expect("repairable");
        let v: serde_json::Value = serde_json::from_str(&repaired).unwrap();
        assert_eq!(v["cmd"], "run ```");
    }

    #[test]
    fn strips_single_line_fence() {
        assert_eq!(
            repair_json("```json{\"path\":\"x\"}```").as_deref(),
            Some(r#"{"path":"x"}"#)
        );
    }

    #[test]
    fn truncation_after_separator_is_not_silently_completed() {
        // `{"xs":[1,2,` signals a 3rd element was coming; repair must NOT assert
        // a complete 2-element array — it returns None (don't guess).
        assert_eq!(repair_json(r#"{"xs":[1,2,"#), None);
        assert_eq!(repair_json(r#"{"a":1,"#), None);
    }
}
