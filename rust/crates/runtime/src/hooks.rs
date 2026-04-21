//! Lifecycle hook system for the conversation runtime.
//!
//! Hooks allow external code to observe and react to key events in the
//! agentic loop without modifying the core runtime logic.

use crate::session::ConversationMessage;
use crate::usage::TokenUsage;

/// Events that can trigger hooks.
#[derive(Debug, Clone)]
pub enum HookEvent<'a> {
    /// Fired before a tool is executed. Allows inspection and optional mutation.
    PreTool {
        tool_name: &'a str,
        tool_input: &'a str,
    },
    /// Fired after a tool completes successfully.
    PostTool {
        tool_name: &'a str,
        tool_input: &'a str,
        tool_output: &'a str,
    },
    /// Fired when a tool execution fails.
    ToolError {
        tool_name: &'a str,
        tool_input: &'a str,
        error: &'a str,
    },
    /// Fired at the end of a successful turn.
    PostTurn {
        assistant_messages: &'a [ConversationMessage],
        tool_results: &'a [ConversationMessage],
        usage: Option<TokenUsage>,
    },
}

/// A hook that can react to runtime events.
pub trait Hook: Send + Sync {
    fn on_event(&self, event: HookEvent);
}

/// Manages a collection of hooks and dispatches events to them.
#[derive(Default, Clone)]
pub struct HookManager {
    hooks: Vec<std::sync::Arc<dyn Hook + Send + Sync>>,
}

impl HookManager {
    #[must_use]
    pub fn new() -> Self {
        Self { hooks: Vec::new() }
    }

    pub fn register(&mut self, hook: std::sync::Arc<dyn Hook + Send + Sync>) {
        self.hooks.push(hook);
    }

    pub fn dispatch(&self, event: &HookEvent) {
        for hook in &self.hooks {
            hook.on_event(event.clone());
        }
    }
}

/// A built-in hook that logs tool usage to stderr for debugging.
pub struct LoggingHook;

impl Hook for LoggingHook {
    fn on_event(&self, event: HookEvent) {
        match event {
            HookEvent::PreTool { tool_name, .. } => {
                eprintln!("[hook] pre-tool: {tool_name}");
            }
            HookEvent::PostTool { tool_name, .. } => {
                eprintln!("[hook] post-tool: {tool_name}");
            }
            HookEvent::ToolError {
                tool_name, error, ..
            } => {
                eprintln!("[hook] tool-error: {tool_name} — {error}");
            }
            HookEvent::PostTurn { .. } => {}
        }
    }
}
