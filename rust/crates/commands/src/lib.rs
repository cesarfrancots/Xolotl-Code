use std::fmt::Write;

use runtime::{compact_session, CompactionConfig, Session};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandManifestEntry {
    pub name: String,
    pub source: CommandSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandSource {
    Builtin,
    InternalOnly,
    FeatureGated,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CommandRegistry {
    entries: Vec<CommandManifestEntry>,
}

impl CommandRegistry {
    #[must_use]
    pub fn new(entries: Vec<CommandManifestEntry>) -> Self {
        Self { entries }
    }

    #[must_use]
    pub fn entries(&self) -> &[CommandManifestEntry] {
        &self.entries
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlashCommandResult {
    pub message: String,
    pub session: Session,
}

pub struct TaskInfo {
    pub task_id: String,
    pub description: String,
    pub status: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub output_preview: Option<String>,
}

pub struct TaskStatusInfo {
    pub pending: usize,
    pub running: usize,
    pub completed: usize,
    pub failed: usize,
    pub cancelled: usize,
    pub tasks: Vec<TaskInfo>,
}

#[must_use] 
pub fn get_task_status() -> TaskStatusInfo {
    TaskStatusInfo {
        pending: 0,
        running: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        tasks: Vec::new(),
    }
}

#[must_use]
pub fn format_task_status(status: &TaskStatusInfo) -> String {
    let mut output = String::new();
    output.push_str("## Sub-Agent Task Status\n\n");

    if status.tasks.is_empty() {
        output.push_str("No tasks recorded.\n");
        return output;
    }

    let _ = write!(
        output,
        "**Summary:** {} pending, {} running, {} completed, {} failed, {} cancelled\n\n",
        status.pending, status.running, status.completed, status.failed, status.cancelled
    );

    output.push_str("| Task ID | Description | Status | Started | Completed |\n");
    output.push_str("|---------|-------------|--------|---------|----------|\n");

    for task in &status.tasks {
        let _ = writeln!(
            output,
            "| {} | {} | {} | {} | {} |",
            task.task_id,
            task.description.chars().take(30).collect::<String>(),
            task.status,
            task.started_at.as_deref().unwrap_or("-"),
            task.completed_at.as_deref().unwrap_or("-")
        );
    }

    output
}

#[must_use]
pub fn handle_slash_command(
    input: &str,
    session: &Session,
    compaction: CompactionConfig,
) -> Option<SlashCommandResult> {
    let trimmed = input.trim();
    if !trimmed.starts_with('/') {
        return None;
    }

    match trimmed.split_whitespace().next() {
        Some("/compact") => {
            let result = compact_session(session, compaction);
            let message = if result.removed_message_count == 0 {
                "Compaction skipped: session is below the compaction threshold.".to_string()
            } else {
                format!(
                    "Compacted {} messages into a resumable system summary.",
                    result.removed_message_count
                )
            };
            Some(SlashCommandResult {
                message,
                session: result.compacted_session,
            })
        }
        Some("/tasks") => {
            let status = get_task_status();
            let message = format_task_status(&status);
            Some(SlashCommandResult {
                message,
                session: session.clone(),
            })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::handle_slash_command;
    use runtime::{CompactionConfig, ContentBlock, ConversationMessage, MessageRole, Session};

    #[test]
    fn compacts_sessions_via_slash_command() {
        let session = Session {
            version: 1,
            messages: vec![
                ConversationMessage::user_text("a ".repeat(200)),
                ConversationMessage::assistant(vec![ContentBlock::Text {
                    text: "b ".repeat(200),
                }]),
                ConversationMessage::tool_result("1", "bash", "ok ".repeat(200), false),
                ConversationMessage::assistant(vec![ContentBlock::Text {
                    text: "recent".to_string(),
                }]),
            ],
        };

        let result = handle_slash_command(
            "/compact",
            &session,
            CompactionConfig {
                preserve_recent_messages: 2,
                max_estimated_tokens: 1,
            },
        )
        .expect("slash command should be handled");

        assert!(result.message.contains("Compacted 2 messages"));
        assert_eq!(result.session.messages[0].role, MessageRole::System);
    }

    #[test]
    fn ignores_unknown_slash_commands() {
        let session = Session::new();
        assert!(handle_slash_command("/unknown", &session, CompactionConfig::default()).is_none());
    }

    #[test]
    fn tasks_command_returns_status() {
        let session = Session::new();
        let result = handle_slash_command("/tasks", &session, CompactionConfig::default())
            .expect("tasks command should be handled");
        assert!(result.message.contains("Sub-Agent Task Status"));
    }
}
