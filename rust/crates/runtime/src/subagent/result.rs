//! Result types for sub-agent execution.

use crate::usage::TokenUsage;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubAgentResult {
    pub task_id: String,
    pub description: String,
    pub success: bool,
    pub output: String,
    pub token_usage: Option<TokenUsage>,
    pub elapsed_ms: u64,
    pub error: Option<String>,
    pub budget_tokens: Option<u32>,
    pub exceeded_budget: bool,
}

impl SubAgentResult {
    #[must_use]
    pub fn success(
        task_id: String,
        description: String,
        output: String,
        token_usage: Option<TokenUsage>,
        elapsed: Duration,
    ) -> Self {
        Self {
            task_id,
            description,
            success: true,
            output,
            token_usage,
            elapsed_ms: elapsed.as_millis() as u64,
            error: None,
            budget_tokens: None,
            exceeded_budget: false,
        }
    }

    #[must_use]
    pub fn success_with_budget(
        task_id: String,
        description: String,
        output: String,
        token_usage: Option<TokenUsage>,
        elapsed: Duration,
        budget_tokens: u32,
    ) -> Self {
        let actual = token_usage.as_ref().map(|u| u.total_tokens()).unwrap_or(0);
        Self {
            task_id,
            description,
            success: true,
            output,
            token_usage,
            elapsed_ms: elapsed.as_millis() as u64,
            error: None,
            budget_tokens: Some(budget_tokens),
            exceeded_budget: actual > budget_tokens,
        }
    }

    #[must_use]
    pub fn failure(
        task_id: String,
        description: String,
        error: String,
        elapsed: Duration,
    ) -> Self {
        Self {
            task_id,
            description,
            success: false,
            output: String::new(),
            token_usage: None,
            elapsed_ms: elapsed.as_millis() as u64,
            error: Some(error),
            budget_tokens: None,
            exceeded_budget: false,
        }
    }

    #[must_use]
    pub fn budget_exceeded(
        task_id: String,
        description: String,
        output: String,
        token_usage: Option<TokenUsage>,
        elapsed: Duration,
        budget_tokens: u32,
    ) -> Self {
        let actual = token_usage.as_ref().map(|u| u.total_tokens()).unwrap_or(0);
        Self {
            task_id,
            description,
            success: false,
            output,
            token_usage,
            elapsed_ms: elapsed.as_millis() as u64,
            error: Some(format!(
                "Token budget exceeded: {} tokens used > {} budget",
                actual, budget_tokens
            )),
            budget_tokens: Some(budget_tokens),
            exceeded_budget: true,
        }
    }
}
