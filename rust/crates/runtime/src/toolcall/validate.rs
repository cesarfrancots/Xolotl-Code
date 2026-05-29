//! Minimal, conservative tool-argument validation against a JSON schema.
//!
//! Per B5 the runtime cannot import the `tools` crate, so it validates against
//! the schema passed into it as data (`ConversationRuntime::with_tool_schemas`,
//! populated by the caller from `tools::mvp_tool_specs`). The check is
//! deliberately lenient: it flags only missing **required** fields and clear
//! type mismatches on present fields — i.e. exactly the calls that would fail
//! deserialization anyway — so it can never reject a call that would otherwise
//! have succeeded (no control-path regression). Unknown extra fields are
//! tolerated. The error message names the offending field for a precise
//! re-prompt (CP 2.2).

use serde_json::Value;

/// Validate `args` against `schema` for `tool_name`. `Ok(())` when the call is
/// at least structurally usable; `Err(message)` names the first problem.
pub fn validate_against_schema(
    tool_name: &str,
    args: &Value,
    schema: &Value,
) -> Result<(), String> {
    let schema_is_object = schema.get("type").and_then(Value::as_str) == Some("object");

    let Some(obj) = args.as_object() else {
        if schema_is_object {
            return Err(format!(
                "tool '{tool_name}': arguments must be a JSON object, got {}",
                value_kind(args)
            ));
        }
        return Ok(());
    };

    if let Some(required) = schema.get("required").and_then(Value::as_array) {
        for field in required {
            if let Some(name) = field.as_str() {
                if !obj.contains_key(name) {
                    return Err(format!(
                        "tool '{tool_name}': missing required field '{name}'"
                    ));
                }
            }
        }
    }

    if let Some(props) = schema.get("properties").and_then(Value::as_object) {
        for (key, value) in obj {
            if let Some(expected) = props
                .get(key)
                .and_then(|prop| prop.get("type"))
                .and_then(Value::as_str)
            {
                if !json_matches_type(value, expected) {
                    return Err(format!(
                        "tool '{tool_name}': field '{key}' should be {expected}, got {}",
                        value_kind(value)
                    ));
                }
            }
        }
    }

    Ok(())
}

/// Whether `value` satisfies a JSON-schema primitive `type`. Lenient: an integer
/// expectation also accepts a whole-valued float (e.g. `120000.0`), and unknown
/// type names never reject.
fn json_matches_type(value: &Value, expected: &str) -> bool {
    match expected {
        "string" => value.is_string(),
        "integer" => {
            value.is_i64() || value.is_u64() || value.as_f64().is_some_and(|f| f.fract() == 0.0)
        }
        "number" => value.is_number(),
        "boolean" => value.is_boolean(),
        "array" => value.is_array(),
        "object" => value.is_object(),
        "null" => value.is_null(),
        _ => true,
    }
}

/// A compact one-line description of a tool's argument schema, for inclusion in
/// a re-prompt (e.g. `path:string, old_string:string, new_string:string
/// [required: path, old_string, new_string]`).
#[must_use]
pub fn describe_schema(schema: &Value) -> String {
    let mut fields = Vec::new();
    if let Some(props) = schema.get("properties").and_then(Value::as_object) {
        for (key, prop) in props {
            let ty = prop.get("type").and_then(Value::as_str).unwrap_or("any");
            fields.push(format!("{key}:{ty}"));
        }
    }
    let required: Vec<&str> = schema
        .get("required")
        .and_then(Value::as_array)
        .map(|r| r.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let fields = fields.join(", ");
    if required.is_empty() {
        fields
    } else {
        format!("{fields} [required: {}]", required.join(", "))
    }
}

fn value_kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

#[cfg(test)]
mod tests {
    use super::validate_against_schema;
    use serde_json::json;

    fn edit_schema() -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "old_string": {"type": "string"},
                "new_string": {"type": "string"},
                "replace_all": {"type": "boolean"}
            },
            "required": ["path", "old_string", "new_string"],
            "additionalProperties": false
        })
    }

    #[test]
    fn accepts_valid_args() {
        let args = json!({"path": "a", "old_string": "x", "new_string": "y"});
        assert!(validate_against_schema("edit_file", &args, &edit_schema()).is_ok());
    }

    #[test]
    fn flags_missing_required_field() {
        let args = json!({"path": "a", "old_string": "x"});
        let err = validate_against_schema("edit_file", &args, &edit_schema()).unwrap_err();
        assert!(err.contains("new_string"), "{err}");
    }

    #[test]
    fn flags_wrong_type() {
        let args = json!({"path": "a", "old_string": "x", "new_string": "y", "replace_all": "yes"});
        let err = validate_against_schema("edit_file", &args, &edit_schema()).unwrap_err();
        assert!(
            err.contains("replace_all") && err.contains("boolean"),
            "{err}"
        );
    }

    #[test]
    fn tolerates_extra_fields() {
        let args = json!({"path": "a", "old_string": "x", "new_string": "y", "extra": 1});
        assert!(validate_against_schema("edit_file", &args, &edit_schema()).is_ok());
    }

    #[test]
    fn integer_accepts_whole_float() {
        let schema = json!({"type": "object", "properties": {"timeout": {"type": "integer"}}, "required": []});
        let args = json!({"timeout": 120000.0});
        assert!(validate_against_schema("bash", &args, &schema).is_ok());
    }

    #[test]
    fn non_object_args_against_object_schema_is_error() {
        let err =
            validate_against_schema("edit_file", &json!("a string"), &edit_schema()).unwrap_err();
        assert!(err.contains("must be a JSON object"), "{err}");
    }
}
