//! Sub-agent spawning logic.

use super::SubAgentResult;
use crate::usage::TokenUsage;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

static SUBAGENT_COUNTER: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Clone)]
pub struct SubAgentConfig {
    pub description: String,
    pub prompt: String,
    pub model: Option<String>,
    pub token_budget: Option<u32>,
    pub allowed_tools: Option<Vec<String>>,
    pub timeout: Duration,
}

impl Default for SubAgentConfig {
    fn default() -> Self {
        Self {
            description: String::new(),
            prompt: String::new(),
            model: None,
            token_budget: None,
            allowed_tools: None,
            timeout: Duration::from_secs(300),
        }
    }
}

impl SubAgentConfig {
    pub fn new(description: impl Into<String>, prompt: impl Into<String>) -> Self {
        Self {
            description: description.into(),
            prompt: prompt.into(),
            ..Default::default()
        }
    }

    #[must_use]
    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        self.model = Some(model.into());
        self
    }

    #[must_use]
    pub fn with_token_budget(mut self, budget: u32) -> Self {
        self.token_budget = Some(budget);
        self
    }

    #[must_use]
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    #[must_use]
    pub fn with_allowed_tools(mut self, tools: Vec<String>) -> Self {
        self.allowed_tools = Some(tools);
        self
    }

    pub fn generate_task_id(&self) -> String {
        let counter = SUBAGENT_COUNTER.fetch_add(1, Ordering::Relaxed);
        format!("subagent-{counter}")
    }
}

pub struct SubAgentSpawner {
    results_dir: PathBuf,
    max_total_budget_tokens: Option<usize>,
}

impl SubAgentSpawner {
    #[must_use]
    pub fn new() -> Self {
        let results_dir = std::env::temp_dir().join("claw-subagents");
        let _ = std::fs::create_dir_all(&results_dir);
        Self {
            results_dir,
            max_total_budget_tokens: None,
        }
    }

    #[must_use]
    pub fn with_max_total_budget(mut self, budget: usize) -> Self {
        self.max_total_budget_tokens = Some(budget);
        self
    }

    #[must_use]
    pub fn spawn(&self, config: SubAgentConfig) -> SubAgentResult {
        let task_id = config.generate_task_id();
        let started = Instant::now();
        let result_path = self.results_dir.join(format!("{task_id}.json"));

        let exe = match std::env::current_exe() {
            Ok(exe) => exe,
            Err(e) => {
                return SubAgentResult::failure(
                    task_id,
                    config.description,
                    format!("failed to find executable: {e}"),
                    started.elapsed(),
                );
            }
        };

        let mut cmd = std::process::Command::new(&exe);
        cmd.arg("--print-output")
            .arg("--task-prompt")
            .arg(&config.prompt)
            .arg("--task-output")
            .arg(result_path.to_str().unwrap_or(""))
            .arg("--task-id")
            .arg(&task_id);

        if let Some(model) = &config.model {
            cmd.arg("--model").arg(model);
        }

        if let Some(budget) = config.token_budget {
            cmd.arg("--token-budget").arg(budget.to_string());
        }

        if let Some(tools) = &config.allowed_tools {
            for tool in tools {
                cmd.arg("--allowed-tool").arg(tool);
            }
        }

        cmd.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());

        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(e) => {
                return SubAgentResult::failure(
                    task_id,
                    config.description,
                    format!("failed to spawn sub-agent: {e}"),
                    started.elapsed(),
                );
            }
        };

        let start = Instant::now();
        while start.elapsed() < config.timeout {
            match child.try_wait() {
                Ok(None) => {
                    std::thread::sleep(Duration::from_millis(50));
                }
                Ok(Some(_)) | Err(_) => break,
            }
        }

        if child.try_wait().map(|w| w.is_none()).unwrap_or(true) {
            let _ = child.kill();
            return SubAgentResult::failure(
                task_id,
                config.description,
                "task timed out".to_string(),
                started.elapsed(),
            );
        }

        let output = if result_path.exists() {
            std::fs::read_to_string(&result_path).unwrap_or_default()
        } else {
            String::new()
        };

        let token_usage = Self::parse_token_usage_from_output(&output);
        let budget_tokens = config.token_budget;

        if let Some(budget) = budget_tokens {
            if let Some(usage) = &token_usage {
                if usage.total_tokens() > budget {
                    return SubAgentResult::budget_exceeded(
                        task_id,
                        config.description,
                        output,
                        token_usage,
                        started.elapsed(),
                        budget,
                    );
                }
            }
        }

        SubAgentResult::success_with_budget(
            task_id,
            config.description,
            output,
            token_usage,
            started.elapsed(),
            budget_tokens.unwrap_or(0),
        )
    }

    fn parse_token_usage_from_output(output: &str) -> Option<TokenUsage> {
        if let Ok(result) = serde_json::from_str::<serde_json::Value>(output) {
            if let Some(usage_obj) = result.get("token_usage").or(result.get("usage")) {
                if let (Some(input), Some(output_tok)) = (
                    usage_obj
                        .get("input_tokens")
                        .and_then(serde_json::Value::as_u64),
                    usage_obj
                        .get("output_tokens")
                        .and_then(serde_json::Value::as_u64),
                ) {
                    return Some(TokenUsage {
                        input_tokens: u32::try_from(input).unwrap_or(u32::MAX),
                        output_tokens: u32::try_from(output_tok).unwrap_or(u32::MAX),
                        cache_creation_input_tokens: usage_obj
                            .get("cache_creation_input_tokens")
                            .and_then(serde_json::Value::as_u64)
                            .map_or(0, |v| u32::try_from(v).unwrap_or(u32::MAX)),
                        cache_read_input_tokens: usage_obj
                            .get("cache_read_input_tokens")
                            .and_then(serde_json::Value::as_u64)
                            .map_or(0, |v| u32::try_from(v).unwrap_or(u32::MAX)),
                    });
                }
            }
        }
        None
    }
}

impl Default for SubAgentSpawner {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::SubAgentConfig;
    use std::time::Duration;

    #[test]
    fn sub_agent_config_builder() {
        let config = SubAgentConfig::new("test task", "do something")
            .with_model("sonnet")
            .with_token_budget(5000)
            .with_timeout(Duration::from_secs(60));

        assert_eq!(config.description, "test task");
        assert_eq!(config.prompt, "do something");
        assert_eq!(config.model, Some("sonnet".to_string()));
        assert_eq!(config.token_budget, Some(5000));
        assert_eq!(config.timeout, Duration::from_secs(60));
    }

    #[test]
    fn task_id_generation() {
        let config1 = SubAgentConfig::new("a", "b");
        let config2 = SubAgentConfig::new("c", "d");

        let id1 = config1.generate_task_id();
        let id2 = config2.generate_task_id();

        assert_ne!(id1, id2);
        assert!(id1.starts_with("subagent-"));
        assert!(id2.starts_with("subagent-"));
    }
}
