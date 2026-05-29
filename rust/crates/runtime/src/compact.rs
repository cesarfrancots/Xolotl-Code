use crate::model_hints::{ModelFamily, ModelHints};
use crate::session::{ContentBlock, ConversationMessage, MessageRole, Session};
use crate::{estimate_tokens, estimate_tokens_for_family};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CompactionConfig {
    pub preserve_recent_messages: usize,
    pub max_estimated_tokens: usize,
}

impl Default for CompactionConfig {
    fn default() -> Self {
        Self {
            preserve_recent_messages: 4,
            max_estimated_tokens: 10_000,
        }
    }
}

impl CompactionConfig {
    /// Build a config whose compaction threshold scales with the model's context
    /// window — `max_context * compaction_ratio`, the same value as
    /// [`ModelHints::context_near_limit`] — instead of a fixed global limit.
    ///
    /// This is why a 1M-context model does not compact at the legacy 120K global:
    /// its threshold is derived from its own window.
    #[must_use]
    pub fn from_model_hints(hints: &ModelHints) -> Self {
        #[allow(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            clippy::cast_precision_loss
        )]
        let max_estimated_tokens = (hints.max_context as f32 * hints.compaction_ratio) as usize;
        Self {
            preserve_recent_messages: 6,
            max_estimated_tokens,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompactionResult {
    pub summary: String,
    pub compacted_session: Session,
    pub removed_message_count: usize,
}

#[must_use]
pub fn estimate_session_tokens(session: &Session) -> usize {
    session.messages.iter().map(estimate_message_tokens).sum()
}

/// Like [`estimate_session_tokens`] but using `family`'s encoder for the estimate
/// (e.g. `o200k_base` for OpenAI). For families that map to `cl100k_base` — which
/// includes Claude — this is byte-identical to [`estimate_session_tokens`].
#[must_use]
pub fn estimate_session_tokens_for_family(session: &Session, family: ModelFamily) -> usize {
    session
        .messages
        .iter()
        .map(|message| estimate_message_tokens_for_family(message, family))
        .sum()
}

fn estimate_message_tokens_for_family(message: &ConversationMessage, family: ModelFamily) -> usize {
    message
        .blocks
        .iter()
        .map(|block| estimate_block_tokens_for_family(block, family))
        .sum()
}

fn estimate_block_tokens_for_family(block: &ContentBlock, family: ModelFamily) -> usize {
    let est = |text: &str| estimate_tokens_for_family(text, family);
    match block {
        ContentBlock::Text { text } => est(text),
        ContentBlock::Thinking { thinking, .. } => est(thinking),
        ContentBlock::Image { source } => match source {
            crate::session::ImageSource::Base64 { data, .. } => est(data),
        },
        ContentBlock::ToolUse { name, input, .. } => est(name) + est(input),
        ContentBlock::ToolResult {
            tool_name, output, ..
        } => est(tool_name) + est(output),
    }
}

#[must_use]
pub fn should_compact(session: &Session, config: CompactionConfig) -> bool {
    session.messages.len() > config.preserve_recent_messages
        && estimate_session_tokens(session) >= config.max_estimated_tokens
}

#[must_use]
pub fn format_compact_summary(summary: &str) -> String {
    let without_analysis = strip_tag_block(summary, "analysis");
    let formatted = if let Some(content) = extract_tag_block(&without_analysis, "summary") {
        without_analysis.replace(
            &format!("<summary>{content}</summary>"),
            &format!("Summary:\n{}", content.trim()),
        )
    } else {
        without_analysis
    };

    collapse_blank_lines(&formatted).trim().to_string()
}

#[must_use]
pub fn get_compact_continuation_message(
    summary: &str,
    suppress_follow_up_questions: bool,
    recent_messages_preserved: bool,
) -> String {
    let mut base = format!(
        "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\n{}",
        format_compact_summary(summary)
    );

    if recent_messages_preserved {
        base.push_str("\n\nRecent messages are preserved verbatim.");
    }

    if suppress_follow_up_questions {
        base.push_str("\nContinue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, and do not preface with continuation text.");
    }

    base
}

#[must_use]
pub fn compact_session(session: &Session, config: CompactionConfig) -> CompactionResult {
    if !should_compact(session, config) {
        return CompactionResult {
            summary: String::new(),
            compacted_session: session.clone(),
            removed_message_count: 0,
        };
    }

    let keep_from = session
        .messages
        .len()
        .saturating_sub(config.preserve_recent_messages);
    let removed = &session.messages[..keep_from];
    let preserved = session.messages[keep_from..].to_vec();
    let summary = summarize_messages(removed);
    let continuation = get_compact_continuation_message(&summary, true, !preserved.is_empty());

    let mut compacted_messages = vec![ConversationMessage {
        role: MessageRole::System,
        blocks: vec![ContentBlock::Text { text: continuation }],
        usage: None,
    }];
    compacted_messages.extend(preserved);

    CompactionResult {
        summary,
        compacted_session: Session {
            version: session.version,
            messages: compacted_messages,
        },
        removed_message_count: removed.len(),
    }
}

fn summarize_messages(messages: &[ConversationMessage]) -> String {
    let mut lines = vec!["<summary>".to_string(), "Conversation summary:".to_string()];
    for message in messages {
        let role = match message.role {
            MessageRole::System => "system",
            MessageRole::User => "user",
            MessageRole::Assistant => "assistant",
            MessageRole::Tool => "tool",
        };
        let content = message
            .blocks
            .iter()
            .map(summarize_block)
            .collect::<Vec<_>>()
            .join(" | ");
        lines.push(format!("- {role}: {content}"));
    }
    lines.push("</summary>".to_string());
    lines.join("\n")
}

fn summarize_block(block: &ContentBlock) -> String {
    let raw = match block {
        ContentBlock::Text { text } => text.clone(),
        ContentBlock::Thinking { thinking, .. } => {
            format!("[thinking: {}]", truncate_summary(thinking, 80))
        }
        ContentBlock::Image { .. } => "[image]".to_string(),
        ContentBlock::ToolUse { name, input, .. } => format!("tool_use {name}({input})"),
        ContentBlock::ToolResult {
            tool_name,
            output,
            is_error,
            ..
        } => format!(
            "tool_result {tool_name}: {}{output}",
            if *is_error { "error " } else { "" }
        ),
    };
    truncate_summary(&raw, 160)
}

fn truncate_summary(content: &str, max_chars: usize) -> String {
    if content.chars().count() <= max_chars {
        return content.to_string();
    }
    let mut truncated = content.chars().take(max_chars).collect::<String>();
    truncated.push('…');
    truncated
}

fn estimate_message_tokens(message: &ConversationMessage) -> usize {
    message.blocks.iter().map(estimate_block_tokens).sum()
}

fn estimate_block_tokens(block: &ContentBlock) -> usize {
    match block {
        ContentBlock::Text { text } => estimate_tokens(text),
        ContentBlock::Thinking { thinking, .. } => estimate_tokens(thinking),
        ContentBlock::Image { source } => match source {
            crate::session::ImageSource::Base64 { data, .. } => estimate_tokens(data),
        },
        ContentBlock::ToolUse { name, input, .. } => estimate_tokens(name) + estimate_tokens(input),
        ContentBlock::ToolResult {
            tool_name, output, ..
        } => estimate_tokens(tool_name) + estimate_tokens(output),
    }
}

fn extract_tag_block(content: &str, tag: &str) -> Option<String> {
    let start = format!("<{tag}>");
    let end = format!("</{tag}>");
    let start_index = content.find(&start)? + start.len();
    let end_index = content[start_index..].find(&end)? + start_index;
    Some(content[start_index..end_index].to_string())
}

fn strip_tag_block(content: &str, tag: &str) -> String {
    let start = format!("<{tag}>");
    let end = format!("</{tag}>");
    if let (Some(start_index), Some(end_index_rel)) = (content.find(&start), content.find(&end)) {
        let end_index = end_index_rel + end.len();
        let mut stripped = String::new();
        stripped.push_str(&content[..start_index]);
        stripped.push_str(&content[end_index..]);
        stripped
    } else {
        content.to_string()
    }
}

fn collapse_blank_lines(content: &str) -> String {
    let mut result = String::new();
    let mut last_blank = false;
    for line in content.lines() {
        let is_blank = line.trim().is_empty();
        if is_blank && last_blank {
            continue;
        }
        result.push_str(line);
        result.push('\n');
        last_blank = is_blank;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::{
        compact_session, estimate_session_tokens, estimate_session_tokens_for_family,
        format_compact_summary, should_compact, CompactionConfig,
    };
    use crate::model_hints::{ModelFamily, ModelHints};
    use crate::session::{ContentBlock, ConversationMessage, MessageRole, Session};

    /// A session of `messages` assistant turns, each `tokens_each` tokens.
    fn session_with(messages: usize, tokens_each: usize) -> Session {
        Session {
            version: 1,
            messages: (0..messages)
                .map(|_| {
                    ConversationMessage::assistant(vec![ContentBlock::Text {
                        // "word " is ~1 token under cl100k.
                        text: "word ".repeat(tokens_each),
                    }])
                })
                .collect(),
        }
    }

    #[test]
    fn compaction_threshold_scales_to_model_context_window() {
        // T-4.3.1: the threshold derives from the model's own window, not 120K.
        let large = CompactionConfig::from_model_hints(&ModelHints::for_model("minimax"));
        let small = CompactionConfig::from_model_hints(&ModelHints::for_model("claude-opus-4-8"));
        assert!(
            large.max_estimated_tokens > 120_000,
            "1M-context model must not be capped at the legacy 120K global"
        );
        assert!(
            large.max_estimated_tokens > small.max_estimated_tokens,
            "1M-context model gets a higher threshold than a 200K-context model"
        );
    }

    #[test]
    fn large_context_model_keeps_a_session_the_default_would_compact() {
        // ~20K tokens across 10 messages: above the 10K default and the message
        // floor, but far below a 1M-context model's window.
        let session = session_with(10, 2_000);
        let estimated = estimate_session_tokens(&session);
        assert!(estimated > 10_000 && estimated < 120_000);

        // Default config compacts it; the model-aware config does not.
        assert!(should_compact(&session, CompactionConfig::default()));
        let model_config = CompactionConfig::from_model_hints(&ModelHints::for_model("minimax"));
        assert!(!should_compact(&session, model_config));
    }

    #[test]
    fn family_estimate_matches_default_for_cl100k_families() {
        let session = session_with(3, 50);
        // Claude maps to cl100k, so its family estimate equals the default estimate.
        assert_eq!(
            estimate_session_tokens_for_family(&session, ModelFamily::Claude),
            estimate_session_tokens(&session)
        );
        // OpenAI uses o200k; the estimate is still a positive count.
        assert!(estimate_session_tokens_for_family(&session, ModelFamily::OpenAI) > 0);
    }

    #[test]
    fn formats_compact_summary_like_upstream() {
        let summary = "<analysis>scratch</analysis>\n<summary>Kept work</summary>";
        assert_eq!(format_compact_summary(summary), "Summary:\nKept work");
    }

    #[test]
    fn leaves_small_sessions_unchanged() {
        let session = Session {
            version: 1,
            messages: vec![ConversationMessage::user_text("hello")],
        };

        let result = compact_session(&session, CompactionConfig::default());
        assert_eq!(result.removed_message_count, 0);
        assert_eq!(result.compacted_session, session);
        assert!(result.summary.is_empty());
    }

    #[test]
    fn compacts_older_messages_into_a_system_summary() {
        let session = Session {
            version: 1,
            messages: vec![
                ConversationMessage::user_text("one ".repeat(200)),
                ConversationMessage::assistant(vec![ContentBlock::Text {
                    text: "two ".repeat(200),
                }]),
                ConversationMessage::tool_result("1", "bash", "ok ".repeat(200), false),
                ConversationMessage {
                    role: MessageRole::Assistant,
                    blocks: vec![ContentBlock::Text {
                        text: "recent".to_string(),
                    }],
                    usage: None,
                },
            ],
        };

        let result = compact_session(
            &session,
            CompactionConfig {
                preserve_recent_messages: 2,
                max_estimated_tokens: 1,
            },
        );

        assert_eq!(result.removed_message_count, 2);
        assert_eq!(
            result.compacted_session.messages[0].role,
            MessageRole::System
        );
        assert!(matches!(
            &result.compacted_session.messages[0].blocks[0],
            ContentBlock::Text { text } if text.contains("Summary:")
        ));
        assert!(should_compact(
            &session,
            CompactionConfig {
                preserve_recent_messages: 2,
                max_estimated_tokens: 1,
            }
        ));
        assert!(
            estimate_session_tokens(&result.compacted_session) < estimate_session_tokens(&session)
        );
    }

    #[test]
    fn truncates_long_blocks_in_summary() {
        let summary = super::summarize_block(&ContentBlock::Text {
            text: "x".repeat(400),
        });
        assert!(summary.ends_with('…'));
        assert!(summary.chars().count() <= 161);
    }
}
