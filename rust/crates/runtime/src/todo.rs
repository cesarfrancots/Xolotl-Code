/// Todo list tools — TodoWrite and TodoRead.
///
/// Todos are stored in `~/.claw-code/todos.json` and persist across sessions.
/// The schema matches the OpenCode / Claude Code TodoWrite tool so models that
/// know those tools will use these correctly.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TodoItem {
    pub id: String,
    pub content: String,
    pub status: TodoStatus,
    pub priority: TodoPriority,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TodoStatus {
    Pending,
    InProgress,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TodoPriority {
    High,
    Medium,
    Low,
}

// ── Input / Output ────────────────────────────────────────────────────────────

/// Input for `todo_write` — replaces the entire todo list.
#[derive(Debug, Clone, Deserialize)]
pub struct TodoWriteInput {
    /// The new full todo list. Replaces everything currently stored.
    pub todos: Vec<TodoItem>,
}

/// Output for both `todo_write` and `todo_read`.
#[derive(Debug, Clone, Serialize)]
pub struct TodoOutput {
    pub todos: Vec<TodoItem>,
}

// ── Storage ───────────────────────────────────────────────────────────────────

fn todos_path() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    home.join(".claw-code").join("todos.json")
}

fn load_todos() -> Vec<TodoItem> {
    let path = todos_path();
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<TodoItem>>(&text).unwrap_or_default()
}

fn save_todos(todos: &[TodoItem]) -> Result<(), String> {
    let path = todos_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create todos directory: {e}"))?;
    }
    let json = serde_json::to_string_pretty(todos)
        .map_err(|e| format!("Failed to serialize todos: {e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to write todos: {e}"))
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Replace the entire todo list with the provided items.
pub fn todo_write(input: &TodoWriteInput) -> Result<TodoOutput, String> {
    save_todos(&input.todos)?;
    Ok(TodoOutput {
        todos: input.todos.clone(),
    })
}

/// Return the current todo list.
pub fn todo_read() -> Result<TodoOutput, String> {
    Ok(TodoOutput {
        todos: load_todos(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_todo_status_serialization() {
        let item = TodoItem {
            id: "1".to_string(),
            content: "test".to_string(),
            status: TodoStatus::InProgress,
            priority: TodoPriority::High,
        };
        let json = serde_json::to_string(&item).unwrap();
        assert!(json.contains("in_progress"));
        let back: TodoItem = serde_json::from_str(&json).unwrap();
        assert_eq!(back.status, TodoStatus::InProgress);
    }
}
