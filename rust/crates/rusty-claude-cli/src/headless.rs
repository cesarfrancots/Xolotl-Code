//! Headless NDJSON protocol.
//!
//! Renders a completed conversation turn as a stable, newline-delimited JSON
//! event stream over stdout. Each line is one JSON object tagged by `"type"`.
//! The streamed assistant deltas are suppressed on stdout (see
//! [`crate::set_stream_output`]) so the stream stays purely machine-readable;
//! this module re-emits the captured content as structured events once the turn
//! completes. The schema is documented in `docs/headless-protocol.md`.

use std::collections::{HashMap, HashSet};

use runtime::{ContentBlock, TurnSummary};
use serde::Serialize;

/// A single event in the headless NDJSON stream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HeadlessEvent {
    /// A natural-language text block authored by the assistant.
    Text { text: String },
    /// A chain-of-thought / reasoning block from the assistant.
    Reasoning { reasoning: String },
    /// The assistant requested a tool call. `input` is the raw JSON arguments
    /// string exactly as produced by the model (callers parse it themselves).
    ToolUse {
        id: String,
        name: String,
        input: String,
    },
    /// The result of a tool call, emitted immediately after its `tool_use`
    /// (matched by `tool_use_id`).
    ToolResult {
        tool_use_id: String,
        tool_name: String,
        output: String,
        is_error: bool,
    },
    /// Token usage for the completed turn.
    Usage {
        input_tokens: u32,
        output_tokens: u32,
        cache_creation_input_tokens: u32,
        cache_read_input_tokens: u32,
    },
    /// Terminal success event: the turn finished after `iterations` round-trips.
    TurnComplete { iterations: usize },
    /// The turn aborted with an error. `message` is human-readable.
    Error { message: String },
}

impl HeadlessEvent {
    /// Build a [`HeadlessEvent::ToolResult`] from a `ToolResult` content block.
    fn tool_result_from_block(block: &ContentBlock) -> Option<Self> {
        if let ContentBlock::ToolResult {
            tool_use_id,
            tool_name,
            output,
            is_error,
        } = block
        {
            Some(Self::ToolResult {
                tool_use_id: tool_use_id.clone(),
                tool_name: tool_name.clone(),
                output: output.clone(),
                is_error: *is_error,
            })
        } else {
            None
        }
    }
}

/// Convert a completed turn into an ordered list of headless events.
///
/// Assistant content blocks are emitted in order; each `tool_use` is followed
/// immediately by its matching `tool_result` (matched by id). Any tool result
/// without a matching `tool_use` is appended after the assistant content in
/// arrival order. The stream ends with a `usage` event then `turn_complete`.
#[must_use]
pub fn events_from_turn(summary: &TurnSummary) -> Vec<HeadlessEvent> {
    // Index tool results by tool_use_id, preserving arrival order for leftovers.
    let mut results: HashMap<String, HeadlessEvent> = HashMap::new();
    let mut result_order: Vec<String> = Vec::new();
    for message in &summary.tool_results {
        for block in &message.blocks {
            if let ContentBlock::ToolResult { tool_use_id, .. } = block {
                if let Some(event) = HeadlessEvent::tool_result_from_block(block) {
                    if results.insert(tool_use_id.clone(), event).is_none() {
                        result_order.push(tool_use_id.clone());
                    }
                }
            }
        }
    }

    let mut events = Vec::new();
    let mut consumed: HashSet<String> = HashSet::new();

    for message in &summary.assistant_messages {
        for block in &message.blocks {
            match block {
                ContentBlock::Text { text } => {
                    if !text.is_empty() {
                        events.push(HeadlessEvent::Text { text: text.clone() });
                    }
                }
                ContentBlock::Thinking { thinking, .. } => {
                    if !thinking.is_empty() {
                        events.push(HeadlessEvent::Reasoning {
                            reasoning: thinking.clone(),
                        });
                    }
                }
                ContentBlock::ToolUse { id, name, input } => {
                    events.push(HeadlessEvent::ToolUse {
                        id: id.clone(),
                        name: name.clone(),
                        input: input.clone(),
                    });
                    if let Some(result) = results.get(id) {
                        if consumed.insert(id.clone()) {
                            events.push(result.clone());
                        }
                    }
                }
                // Images are not part of the assistant text stream; tool results
                // never appear inside assistant messages.
                ContentBlock::Image { .. } | ContentBlock::ToolResult { .. } => {}
            }
        }
    }

    // Append any tool results that had no matching tool_use (defensive).
    for id in &result_order {
        if !consumed.contains(id) {
            if let Some(result) = results.get(id) {
                events.push(result.clone());
            }
        }
    }

    let usage = &summary.usage;
    events.push(HeadlessEvent::Usage {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens,
    });
    events.push(HeadlessEvent::TurnComplete {
        iterations: summary.iterations,
    });

    events
}

/// Render events as NDJSON: one compact JSON object per line, trailing newline.
#[must_use]
pub fn to_ndjson(events: &[HeadlessEvent]) -> String {
    let mut out = String::new();
    for event in events {
        // HeadlessEvent contains only strings, integers and bools, so
        // serialization is infallible; guard defensively regardless.
        if let Ok(line) = serde_json::to_string(event) {
            out.push_str(&line);
            out.push('\n');
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{events_from_turn, to_ndjson, HeadlessEvent};
    use runtime::{ContentBlock, ConversationMessage, MessageRole, TokenUsage, TurnSummary};

    fn assistant(blocks: Vec<ContentBlock>) -> ConversationMessage {
        ConversationMessage {
            role: MessageRole::Assistant,
            blocks,
            usage: None,
        }
    }

    fn tool_message(blocks: Vec<ContentBlock>) -> ConversationMessage {
        ConversationMessage {
            role: MessageRole::Tool,
            blocks,
            usage: None,
        }
    }

    #[test]
    fn golden_ndjson_stream() {
        let summary = TurnSummary {
            assistant_messages: vec![
                assistant(vec![
                    ContentBlock::Text {
                        text: "Let me read the file.".to_string(),
                    },
                    ContentBlock::ToolUse {
                        id: "toolu_1".to_string(),
                        name: "read_file".to_string(),
                        input: r#"{"path":"a.txt"}"#.to_string(),
                    },
                ]),
                assistant(vec![ContentBlock::Text {
                    text: "The file says hello.".to_string(),
                }]),
            ],
            tool_results: vec![tool_message(vec![ContentBlock::ToolResult {
                tool_use_id: "toolu_1".to_string(),
                tool_name: "read_file".to_string(),
                output: "hello".to_string(),
                is_error: false,
            }])],
            iterations: 2,
            usage: TokenUsage {
                input_tokens: 120,
                output_tokens: 45,
                cache_creation_input_tokens: 10,
                cache_read_input_tokens: 100,
            },
        };

        let ndjson = to_ndjson(&events_from_turn(&summary));
        let lines: Vec<&str> = ndjson.lines().collect();

        assert_eq!(
            lines,
            vec![
                r#"{"type":"text","text":"Let me read the file."}"#,
                r#"{"type":"tool_use","id":"toolu_1","name":"read_file","input":"{\"path\":\"a.txt\"}"}"#,
                r#"{"type":"tool_result","tool_use_id":"toolu_1","tool_name":"read_file","output":"hello","is_error":false}"#,
                r#"{"type":"text","text":"The file says hello."}"#,
                r#"{"type":"usage","input_tokens":120,"output_tokens":45,"cache_creation_input_tokens":10,"cache_read_input_tokens":100}"#,
                r#"{"type":"turn_complete","iterations":2}"#,
            ]
        );
    }

    #[test]
    fn empty_text_and_reasoning_are_skipped() {
        let summary = TurnSummary {
            assistant_messages: vec![assistant(vec![
                ContentBlock::Text {
                    text: String::new(),
                },
                ContentBlock::Thinking {
                    thinking: String::new(),
                    signature: None,
                },
                ContentBlock::Thinking {
                    thinking: "pondering".to_string(),
                    signature: None,
                },
            ])],
            tool_results: vec![],
            iterations: 1,
            usage: TokenUsage::default(),
        };

        let events = events_from_turn(&summary);
        assert_eq!(
            events,
            vec![
                HeadlessEvent::Reasoning {
                    reasoning: "pondering".to_string(),
                },
                HeadlessEvent::Usage {
                    input_tokens: 0,
                    output_tokens: 0,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0,
                },
                HeadlessEvent::TurnComplete { iterations: 1 },
            ]
        );
    }

    #[test]
    fn unmatched_tool_result_is_appended() {
        let summary = TurnSummary {
            assistant_messages: vec![assistant(vec![ContentBlock::Text {
                text: "hi".to_string(),
            }])],
            tool_results: vec![tool_message(vec![ContentBlock::ToolResult {
                tool_use_id: "orphan".to_string(),
                tool_name: "bash".to_string(),
                output: "done".to_string(),
                is_error: false,
            }])],
            iterations: 1,
            usage: TokenUsage::default(),
        };

        let events = events_from_turn(&summary);
        assert_eq!(
            events[0],
            HeadlessEvent::Text {
                text: "hi".to_string()
            }
        );
        assert_eq!(
            events[1],
            HeadlessEvent::ToolResult {
                tool_use_id: "orphan".to_string(),
                tool_name: "bash".to_string(),
                output: "done".to_string(),
                is_error: false,
            }
        );
    }
}
