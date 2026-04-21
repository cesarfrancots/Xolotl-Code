//! Result types for sub-agent execution.

use crate::usage::TokenUsage;
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Categorizes errors to determine if a retry should be attempted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ErrorCategory {
    /// Transient error that may succeed on retry (network, timeout, rate limit).
    Retryable,
    /// Permanent error that will not succeed on retry (invalid input, logic error).
    Permanent,
    /// Unknown error category — treat as retryable by default.
    Unknown,
}

impl ErrorCategory {
    /// Determine if an error message indicates a retryable condition.
    #[must_use]
    pub fn from_message(error: &str) -> Self {
        let lower = error.to_lowercase();
        if lower.contains("timeout")
            || lower.contains("timed out")
            || lower.contains("connection")
            || lower.contains("network")
            || lower.contains("rate limit")
            || lower.contains("too many requests")
            || lower.contains("unavailable")
            || lower.contains("internal server error")
            || lower.contains("temporarily")
        {
            Self::Retryable
        } else if lower.contains("invalid")
            || lower.contains("not found")
            || lower.contains("forbidden")
            || lower.contains("unauthorized")
            || lower.contains("bad request")
        {
            Self::Permanent
        } else {
            Self::Unknown
        }
    }

    /// Returns true if this error category should be retried.
    #[must_use]
    pub fn should_retry(&self) -> bool {
        matches!(self, Self::Retryable | Self::Unknown)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubAgentResult {
    pub task_id: String,
    pub description: String,
    pub success: bool,
    pub output: String,
    pub token_usage: Option<TokenUsage>,
    pub elapsed_ms: u64,
    pub error: Option<String>,
    pub error_category: Option<ErrorCategory>,
    pub budget_tokens: Option<u32>,
    pub exceeded_budget: bool,
    /// Number of retry attempts made before this result.
    pub retry_count: u32,
    /// History of outputs from previous retry attempts.
    pub retry_history: Vec<String>,
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
            elapsed_ms: u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX),
            error: None,
            error_category: None,
            budget_tokens: None,
            exceeded_budget: false,
            retry_count: 0,
            retry_history: Vec::new(),
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
        let actual = token_usage.as_ref().map_or(0, |u| u.total_tokens());
        Self {
            task_id,
            description,
            success: true,
            output,
            token_usage,
            elapsed_ms: u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX),
            error: None,
            error_category: None,
            budget_tokens: Some(budget_tokens),
            exceeded_budget: actual > budget_tokens,
            retry_count: 0,
            retry_history: Vec::new(),
        }
    }

    #[must_use]
    pub fn failure(task_id: String, description: String, error: String, elapsed: Duration) -> Self {
        let category = ErrorCategory::from_message(&error);
        Self {
            task_id,
            description,
            success: false,
            output: String::new(),
            token_usage: None,
            elapsed_ms: u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX),
            error: Some(error),
            error_category: Some(category),
            budget_tokens: None,
            exceeded_budget: false,
            retry_count: 0,
            retry_history: Vec::new(),
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
        let actual = token_usage.as_ref().map_or(0, |u| u.total_tokens());
        Self {
            task_id,
            description,
            success: false,
            output,
            token_usage,
            elapsed_ms: u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX),
            error: Some(format!(
                "Token budget exceeded: {actual} tokens used > {budget_tokens} budget"
            )),
            error_category: Some(ErrorCategory::Permanent),
            budget_tokens: Some(budget_tokens),
            exceeded_budget: true,
            retry_count: 0,
            retry_history: Vec::new(),
        }
    }

    /// Create a retried result that preserves history from a previous attempt.
    #[must_use]
    pub fn with_retry(self, new_output: String, new_error: Option<String>, elapsed: Duration) -> Self {
        let mut retry_history = self.retry_history;
        retry_history.push(self.output);
        
        let error_category = new_error.as_ref().map(|e| ErrorCategory::from_message(e));
        
        Self {
            task_id: self.task_id,
            description: self.description,
            success: new_error.is_none(),
            output: new_output,
            token_usage: self.token_usage, // Preserve token usage from original
            elapsed_ms: u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX),
            error: new_error,
            error_category,
            budget_tokens: self.budget_tokens,
            exceeded_budget: self.exceeded_budget,
            retry_count: self.retry_count + 1,
            retry_history,
        }
    }

    /// Returns true if this result indicates a retryable failure.
    #[must_use]
    pub fn is_retryable(&self) -> bool {
        !self.success
            && self.error_category.as_ref().map_or(true, |c| c.should_retry())
            && !self.exceeded_budget
    }

    /// Get a summary of this result including retry information.
    #[must_use]
    pub fn summary(&self) -> String {
        let mut parts = vec![format!("Task: {}", self.description)];
        
        if self.success {
            parts.push("Status: SUCCESS".to_string());
        } else if self.exceeded_budget {
            parts.push("Status: BUDGET EXCEEDED".to_string());
        } else {
            parts.push("Status: FAILED".to_string());
        }
        
        if self.retry_count > 0 {
            parts.push(format!("Retries: {}", self.retry_count));
        }
        
        if let Some(ref error) = self.error {
            parts.push(format!("Error: {error}"));
        }
        
        if let Some(ref usage) = self.token_usage {
            parts.push(format!(
                "Tokens: {} input, {} output",
                usage.input_tokens, usage.output_tokens
            ));
        }
        
        parts.push(format!("Elapsed: {}ms", self.elapsed_ms));
        parts.join(" | ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_category_detection() {
        assert_eq!(
            ErrorCategory::from_message("Connection refused"),
            ErrorCategory::Retryable
        );
        assert_eq!(
            ErrorCategory::from_message("Request timed out"),
            ErrorCategory::Retryable
        );
        assert_eq!(
            ErrorCategory::from_message("Rate limit exceeded"),
            ErrorCategory::Retryable
        );
        assert_eq!(
            ErrorCategory::from_message("Invalid API key"),
            ErrorCategory::Permanent
        );
        assert_eq!(
            ErrorCategory::from_message("Unknown error"),
            ErrorCategory::Unknown
        );
    }

    #[test]
    fn retryable_check() {
        let result = SubAgentResult::failure(
            "t1".to_string(),
            "test".to_string(),
            "Connection refused".to_string(),
            Duration::from_secs(1),
        );
        assert!(result.is_retryable());

        let result = SubAgentResult::failure(
            "t2".to_string(),
            "test".to_string(),
            "Invalid API key".to_string(),
            Duration::from_secs(1),
        );
        assert!(!result.is_retryable());
    }

    #[test]
    fn retry_history_tracking() {
        let result = SubAgentResult::failure(
            "t1".to_string(),
            "test".to_string(),
            "First attempt failed".to_string(),
            Duration::from_secs(1),
        );
        
        let retried = result.with_retry(
            "Second output".to_string(),
            None,
            Duration::from_secs(2),
        );
        
        assert_eq!(retried.retry_count, 1);
        assert!(retried.success);
        assert_eq!(retried.retry_history.len(), 1);
        assert_eq!(retried.retry_history[0], "");
    }

    #[test]
    fn summary_generation() {
        let result = SubAgentResult::success(
            "t1".to_string(),
            "test task".to_string(),
            "output".to_string(),
            Some(TokenUsage {
                input_tokens: 100,
                output_tokens: 50,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
            }),
            Duration::from_secs(1),
        );
        
        let summary = result.summary();
        assert!(summary.contains("test task"));
        assert!(summary.contains("SUCCESS"));
        assert!(summary.contains("100 input"));
    }
}
