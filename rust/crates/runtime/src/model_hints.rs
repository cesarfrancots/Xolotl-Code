use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ModelFamily {
    MiniMax,
    Glm,
    Qwen,
    Claude,
    BedrockAnthropic,
    OpenAI,
    Generic,
}

#[derive(Debug, Clone)]
pub struct ModelHints {
    pub family: ModelFamily,
    pub thinking_budget: u32,
    pub max_context: usize,
    pub aggressive_read: bool,
    pub aggressive_read_threshold: usize,
    pub compaction_ratio: f32,
    pub system_prompt_addition: Option<String>,
}

impl ModelHints {
    pub fn for_model(model: &str) -> Self {
        let model_lower = model.to_lowercase();

        if model_lower.contains("minimax") || model_lower.contains("minimax-text-01") {
            Self {
                family: ModelFamily::MiniMax,
                thinking_budget: 24_000,
                max_context: 1_000_000,
                aggressive_read: true,
                aggressive_read_threshold: 10,
                compaction_ratio: 0.8,
                system_prompt_addition: Some(
                    "You are running on MiniMax with extended 1M token context. \
                    Read thoroughly before implementing - context is not a constraint. \
                    Prefer comprehensive initial research over incremental approaches.".into(),
                ),
            }
        } else if model_lower.contains("glm") || model_lower.contains("GLM") {
            Self {
                family: ModelFamily::Glm,
                thinking_budget: 16_000,
                max_context: 128_000,
                aggressive_read: false,
                aggressive_read_threshold: 5,
                compaction_ratio: 0.6,
                system_prompt_addition: Some(
                    "You are running on GLM. Follow standard SDD practices - \
                    read relevant files before implementing.".into(),
                ),
            }
        } else if model_lower.contains("qwen") {
            Self {
                family: ModelFamily::Qwen,
                thinking_budget: 12_000,
                max_context: 128_000,
                aggressive_read: true,
                aggressive_read_threshold: 7,
                compaction_ratio: 0.6,
                system_prompt_addition: Some(
                    "You are running on Qwen. Read what's necessary for the task at hand. \
                    Qwen performs well with focused context.".into(),
                ),
            }
        } else if model_lower.contains("opus") {
            Self {
                family: ModelFamily::Claude,
                thinking_budget: 32_000,
                max_context: 200_000,
                aggressive_read: false,
                aggressive_read_threshold: 5,
                compaction_ratio: 0.5,
                system_prompt_addition: Some(
                    "You are running on Claude Opus. Excellent for complex reasoning. \
                    Use thinking blocks for complex logic.".into(),
                ),
            }
        } else if model_lower.contains("sonnet") {
            Self {
                family: ModelFamily::Claude,
                thinking_budget: 16_000,
                max_context: 200_000,
                aggressive_read: false,
                aggressive_read_threshold: 5,
                compaction_ratio: 0.5,
                system_prompt_addition: Some(
                    "You are running on Claude Sonnet. Good balance of speed and capability. \
                    Use thinking blocks for complex reasoning.".into(),
                ),
            }
        } else if model_lower.contains("haiku") {
            Self {
                family: ModelFamily::Claude,
                thinking_budget: 8_000,
                max_context: 200_000,
                aggressive_read: false,
                aggressive_read_threshold: 3,
                compaction_ratio: 0.5,
                system_prompt_addition: Some(
                    "You are running on Claude Haiku. Fast iteration. \
                    Stay focused on the immediate task.".into(),
                ),
            }
        } else if model_lower.contains("bedrock") || model_lower.contains("anthropic") {
            Self {
                family: ModelFamily::BedrockAnthropic,
                thinking_budget: 16_000,
                max_context: 200_000,
                aggressive_read: false,
                aggressive_read_threshold: 5,
                compaction_ratio: 0.5,
                system_prompt_addition: None,
            }
        } else if model_lower.contains("gpt") || model_lower.contains("openai") {
            Self {
                family: ModelFamily::OpenAI,
                thinking_budget: 8_000,
                max_context: 128_000,
                aggressive_read: false,
                aggressive_read_threshold: 4,
                compaction_ratio: 0.5,
                system_prompt_addition: None,
            }
        } else {
            Self {
                family: ModelFamily::Generic,
                thinking_budget: 12_000,
                max_context: 128_000,
                aggressive_read: false,
                aggressive_read_threshold: 5,
                compaction_ratio: 0.6,
                system_prompt_addition: None,
            }
        }
    }

    pub fn should_use_thinking(&self) -> bool {
        matches!(
            self.family,
            ModelFamily::Claude | ModelFamily::MiniMax | ModelFamily::Glm | ModelFamily::Qwen
        ) && self.thinking_budget > 0
    }

    pub fn context_near_limit(&self, used_tokens: usize) -> bool {
        let threshold = (self.max_context as f32 * self.compaction_ratio) as usize;
        used_tokens >= threshold
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_minimax_hints() {
        let hints = ModelHints::for_model("minimax/MiniMax-Text-01");
        assert_eq!(hints.family, ModelFamily::MiniMax);
        assert_eq!(hints.thinking_budget, 24_000);
        assert_eq!(hints.max_context, 1_000_000);
        assert!(hints.aggressive_read);
        assert!(hints.should_use_thinking());
    }

    #[test]
    fn test_glm_hints() {
        let hints = ModelHints::for_model("glm/glm-5.1");
        assert_eq!(hints.family, ModelFamily::Glm);
        assert_eq!(hints.thinking_budget, 16_000);
        assert!(!hints.aggressive_read);
    }

    #[test]
    fn test_qwen_hints() {
        let hints = ModelHints::for_model("qwen/qwen-3.6-plus");
        assert_eq!(hints.family, ModelFamily::Qwen);
        assert!(hints.aggressive_read);
    }

    #[test]
    fn test_opus_hints() {
        let hints = ModelHints::for_model("bedrock/us.anthropic.claude-opus-4-6-v1");
        assert_eq!(hints.family, ModelFamily::Claude);
        assert_eq!(hints.thinking_budget, 32_000);
        assert!(hints.should_use_thinking());
    }

    #[test]
    fn test_sonnet_hints() {
        let hints = ModelHints::for_model("sonnet4.6");
        assert_eq!(hints.family, ModelFamily::Claude);
        assert_eq!(hints.thinking_budget, 16_000);
    }

    #[test]
    fn test_haiku_hints() {
        let hints = ModelHints::for_model("haiku");
        assert_eq!(hints.family, ModelFamily::Claude);
        assert_eq!(hints.thinking_budget, 8_000);
    }

    #[test]
    fn test_context_near_limit() {
        let hints = ModelHints::for_model("minimax/MiniMax-Text-01");
        assert!(!hints.context_near_limit(100_000));
        assert!(hints.context_near_limit(850_000));
    }
}
