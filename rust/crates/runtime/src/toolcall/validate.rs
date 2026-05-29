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

    let required: Vec<&str> = schema
        .get("required")
        .and_then(Value::as_array)
        .map(|r| r.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();

    if let Some(props) = schema.get("properties").and_then(Value::as_object) {
        for (key, value) in obj {
            // Explicit JSON null for a non-required field is valid: serde
            // deserializes it to `Option::None`, so rejecting it would bounce a
            // call that would otherwise have executed (control regression).
            if value.is_null() && !required.contains(&key.as_str()) {
                continue;
            }
            let Some(prop) = props.get(key) else {
                continue;
            };
            if let Some(expected) = prop.get("type").and_then(Value::as_str) {
                if !json_matches_type(value, expected) {
                    return Err(format!(
                        "tool '{tool_name}': field '{key}' should be {expected}, got {}",
                        value_kind(value)
                    ));
                }
            }
            // Honor a numeric `minimum` (the tool schemas use it to mark
            // unsigned fields). A negative value would fail deserialization into
            // usize/u64 anyway, so reject it here with a clearer message.
            if let (Some(min), Some(actual)) =
                (prop.get("minimum").and_then(Value::as_f64), value.as_f64())
            {
                if actual < min {
                    return Err(format!(
                        "tool '{tool_name}': field '{key}' must be >= {min}, got {actual}"
                    ));
                }
            }
        }
    }

    Ok(())
}

/// Whether `value` satisfies a JSON-schema primitive `type`. An `integer`
/// expectation requires an actual integer (not a float): the downstream tool
/// structs use `u64`/`usize`, into which serde refuses to deserialize a float,
/// so accepting `120000.0` here would only defer the failure. Unknown type
/// names never reject.
fn json_matches_type(value: &Value, expected: &str) -> bool {
    match expected {
        "string" => value.is_string(),
        "integer" => value.is_i64() || value.is_u64(),
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
    fn null_for_optional_field_is_accepted() {
        // serde deserializes JSON null into Option::None, so this must NOT be
        // rejected (control-regression guard).
        let schema = json!({
            "type": "object",
            "properties": {"command": {"type": "string"}, "timeout": {"type": "integer"}},
            "required": ["command"]
        });
        let args = json!({"command": "ls", "timeout": null});
        assert!(validate_against_schema("bash", &args, &schema).is_ok());
    }

    #[test]
    fn float_for_integer_field_is_rejected() {
        // would fail serde deserialization into u64/usize, so reject early.
        let schema = json!({"type": "object", "properties": {"timeout": {"type": "integer"}}, "required": []});
        let args = json!({"timeout": 120000.0});
        assert!(validate_against_schema("bash", &args, &schema).is_err());
    }

    #[test]
    fn negative_below_minimum_is_rejected() {
        let schema = json!({
            "type": "object",
            "properties": {"offset": {"type": "integer", "minimum": 0}},
            "required": []
        });
        let args = json!({"offset": -1});
        assert!(validate_against_schema("read_file", &args, &schema).is_err());
    }

    #[test]
    fn non_object_args_against_object_schema_is_error() {
        let err =
            validate_against_schema("edit_file", &json!("a string"), &edit_schema()).unwrap_err();
        assert!(err.contains("must be a JSON object"), "{err}");
    }
}
