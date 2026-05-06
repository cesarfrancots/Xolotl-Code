use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ModelFamily {
    MiniMax,
    Glm,
    Qwen,
    Claude,
    BedrockAnthropic,
    OpenAI,
    KimiCoding,
    Generic,
}

/// Effort level controls how much reasoning/thinking the model applies.
/// Higher levels use more thinking tokens and more aggressive reading.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum EffortLevel {
    /// Minimal effort — fast responses, minimal thinking.
    Minimal,
    /// Low effort — slightly more thinking than minimal.
    Low,
    /// Standard effort — balanced thinking and speed (default).
    #[default]
    Standard,
    /// High effort — deep reasoning, more thorough analysis.
    High,
    /// Maximum effort — exhaustive thinking, maximum context usage.
    Maximum,
}

impl EffortLevel {
    /// Returns the multiplier for thinking budget.
    #[must_use]
    pub fn thinking_multiplier(self) -> f32 {
        match self {
            Self::Minimal => 0.25,
            Self::Low => 0.5,
            Self::Standard => 1.0,
            Self::High => 1.5,
            Self::Maximum => 2.0,
        }
    }

    /// Returns the multiplier for aggressive read threshold.
    /// Lower values = more aggressive reading.
    #[must_use]
    pub fn read_threshold_multiplier(self) -> f32 {
        match self {
            Self::Minimal => 2.0,
            Self::Low => 1.5,
            Self::Standard => 1.0,
            Self::High => 0.75,
            Self::Maximum => 0.5,
        }
    }

    /// Returns the max iterations multiplier.
    #[must_use]
    pub fn iteration_multiplier(self) -> f32 {
        match self {
            Self::Minimal => 0.5,
            Self::Low => 0.75,
            Self::Standard => 1.0,
            Self::High => 1.25,
            Self::Maximum => 1.5,
        }
    }

    /// Returns a human-readable label.
    #[must_use]
    pub fn label(self) -> &'static str {
        match self {
            Self::Minimal => "minimal",
            Self::Low => "low",
            Self::Standard => "standard",
            Self::High => "high",
            Self::Maximum => "maximum",
        }
    }

    /// Cycle to the next effort level.
    #[must_use]
    pub fn next(self) -> Self {
        match self {
            Self::Minimal => Self::Low,
            Self::Low => Self::Standard,
            Self::Standard => Self::High,
            Self::High => Self::Maximum,
            Self::Maximum => Self::Minimal,
        }
    }
}

#[derive(Debug, Clone)]
#[allow(clippy::struct_excessive_bools)]
pub struct ModelHints {
    pub family: ModelFamily,
    pub thinking_budget: u32,
    pub max_context: usize,
    pub max_completion_tokens: u32,
    pub aggressive_read: bool,
    pub aggressive_read_threshold: usize,
    pub compaction_ratio: f32,
    pub system_prompt_addition: Option<String>,
    pub supports_prompt_cache: bool,
    pub supports_images: bool,
    // Plan-mode / ultra-planning fields
    pub plan_thinking_budget: u32,
    pub supports_ultra_planning: bool,
    pub max_plan_phases: usize,
    pub plan_aggressive_read_threshold: usize,
    pub plan_mode_system_prompt_addition: Option<String>,
    /// Current effort level — controls thinking depth and reading aggressiveness.
    pub effort_level: EffortLevel,
}

impl ModelHints {
    /// Returns the effective thinking budget adjusted for effort level.
    #[must_use]
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        clippy::cast_precision_loss
    )]
    pub fn effective_thinking_budget(&self) -> u32 {
        (self.thinking_budget as f32 * self.effort_level.thinking_multiplier()) as u32
    }

    /// Returns the effective aggressive read threshold adjusted for effort level.
    #[must_use]
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        clippy::cast_precision_loss
    )]
    pub fn effective_read_threshold(&self) -> usize {
        (self.aggressive_read_threshold as f32 * self.effort_level.read_threshold_multiplier())
            as usize
    }

    /// Returns the effective max iterations adjusted for effort level.
    #[must_use]
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        clippy::cast_precision_loss
    )]
    pub fn effective_max_iterations(&self, base: usize) -> usize {
        (base as f32 * self.effort_level.iteration_multiplier()) as usize
    }

    #[must_use]
    #[allow(clippy::too_many_lines)]
    pub fn for_model(model: &str) -> Self {
        let model_lower = model.to_lowercase();

        if model_lower.contains("minimax")
            || model_lower.contains("minimax-text-01")
            || model_lower.contains("minimax2.7")
            || model_lower.contains("minimax-2.7")
        {
            Self {
                family: ModelFamily::MiniMax,
                thinking_budget: 24_000,
                max_context: 1_000_000,
                max_completion_tokens: 32_768,
                aggressive_read: true,
                aggressive_read_threshold: 10,
                compaction_ratio: 0.8,
                system_prompt_addition: Some(
                    "You are running on MiniMax with extended 1M token context. \
                    Read thoroughly before implementing - context is not a constraint. \
                    Prefer comprehensive initial research over incremental approaches."
                        .into(),
                ),
                supports_prompt_cache: false,
                supports_images: false,
                plan_thinking_budget: 40_000,
                supports_ultra_planning: true,
                max_plan_phases: 10,
                plan_aggressive_read_threshold: 15,
                plan_mode_system_prompt_addition: Some(
                    "PLAN MODE: With 1M token context, perform exhaustive research before planning. \
                    Create comprehensive multi-phase plans (up to 10 phases) with deep dependency analysis. \
                    Each phase must have verifiable deliverables. Consider edge cases, failure modes, \
                    and rollback strategies explicitly. Prefer breadth-first exploration before depth-first implementation."
                        .into(),
                ),
                effort_level: EffortLevel::Standard,
            }
        } else if model_lower.contains("glm")
            || model_lower.contains("glm5.1")
            || model_lower.contains("glm-5.1")
        {
            Self {
                family: ModelFamily::Glm,
                thinking_budget: 16_000,
                max_context: 128_000,
                max_completion_tokens: 16_384,
                aggressive_read: false,
                aggressive_read_threshold: 5,
                compaction_ratio: 0.6,
                system_prompt_addition: Some(
                    "You are running on GLM 5.1. Follow standard SDD practices - \
                    read relevant files before implementing. Focus on correctness and clarity."
                        .into(),
                ),
                supports_prompt_cache: false,
                supports_images: false,
                plan_thinking_budget: 24_000,
                supports_ultra_planning: true,
                max_plan_phases: 5,
                plan_aggressive_read_threshold: 6,
                plan_mode_system_prompt_addition: Some(
                    "PLAN MODE: Follow structured planning with 3-5 clearly defined phases. \
                    Focus on correctness over comprehensiveness. Identify key risks upfront and \
                    establish verification criteria for each phase before proceeding."
                        .into(),
                ),
                effort_level: EffortLevel::Standard,
            }
        } else if model_lower.contains("qwen") {
            Self {
                family: ModelFamily::Qwen,
                thinking_budget: 12_000,
                max_context: 128_000,
                max_completion_tokens: 16_384,
                aggressive_read: true,
                aggressive_read_threshold: 7,
                compaction_ratio: 0.6,
                system_prompt_addition: Some(
                    "You are running on Qwen. Read what's necessary for the task at hand. \
                    Qwen performs well with focused context."
                        .into(),
                ),
                supports_prompt_cache: false,
                supports_images: true,
                plan_thinking_budget: 20_000,
                supports_ultra_planning: true,
                max_plan_phases: 6,
                plan_aggressive_read_threshold: 9,
                plan_mode_system_prompt_addition: Some(
                    "PLAN MODE: Create structured 4-6 phase plans. Balance research depth with \
                    implementation efficiency. Each phase should produce a testable increment."
                        .into(),
                ),
                effort_level: EffortLevel::Standard,
            }
        } else if model_lower.contains("opus") {
            Self {
                family: ModelFamily::Claude,
                thinking_budget: 32_000,
                max_context: 200_000,
                max_completion_tokens: 16_384,
                aggressive_read: false,
                aggressive_read_threshold: 5,
                compaction_ratio: 0.5,
                system_prompt_addition: Some(
                    "You are running on Claude Opus. Excellent for complex reasoning. \
                    Use thinking blocks for complex logic."
                        .into(),
                ),
                supports_prompt_cache: false,
                supports_images: true,
                plan_thinking_budget: 48_000,
                supports_ultra_planning: true,
                max_plan_phases: 8,
                plan_aggressive_read_threshold: 7,
                plan_mode_system_prompt_addition: Some(
                    "PLAN MODE: Leverage deep reasoning for 5-8 phase architectural plans. \
                    Explicitly model dependencies, constraints, and trade-offs. \
                    Include verification and rollback steps."
                        .into(),
                ),
                effort_level: EffortLevel::Standard,
            }
        } else if model_lower.contains("sonnet") {
            Self {
                family: ModelFamily::Claude,
                thinking_budget: 16_000,
                max_context: 200_000,
                max_completion_tokens: 16_384,
                aggressive_read: false,
                aggressive_read_threshold: 5,
                compaction_ratio: 0.5,
                system_prompt_addition: Some(
                    "You are running on Claude Sonnet. Good balance of speed and capability. \
                    Use thinking blocks for complex reasoning."
                        .into(),
                ),
                supports_prompt_cache: false,
                supports_images: true,
                plan_thinking_budget: 24_000,
                supports_ultra_planning: true,
                max_plan_phases: 6,
                plan_aggressive_read_threshold: 6,
                plan_mode_system_prompt_addition: Some(
                    "PLAN MODE: Create efficient 4-6 phase plans. Balance thoroughness with speed. \
                    Identify critical path and parallelization opportunities."
                        .into(),
                ),
                effort_level: EffortLevel::Standard,
            }
        } else if model_lower.contains("haiku") {
            Self {
                family: ModelFamily::Claude,
                thinking_budget: 8_000,
                max_context: 200_000,
                max_completion_tokens: 8_192,
                aggressive_read: false,
                aggressive_read_threshold: 3,
                compaction_ratio: 0.5,
                system_prompt_addition: Some(
                    "You are running on Claude Haiku. Fast iteration. \
                    Stay focused on the immediate task."
                        .into(),
                ),
                supports_prompt_cache: false,
                supports_images: true,
                plan_thinking_budget: 12_000,
                supports_ultra_planning: false,
                max_plan_phases: 3,
                plan_aggressive_read_threshold: 4,
                plan_mode_system_prompt_addition: Some(
                    "PLAN MODE: Keep plans concise with 2-3 phases. Focus on immediate, \
                    high-impact actions with clear success criteria."
                        .into(),
                ),
                effort_level: EffortLevel::Standard,
            }
        } else if model_lower.contains("bedrock") || model_lower.contains("anthropic") {
            Self {
                family: ModelFamily::BedrockAnthropic,
                thinking_budget: 16_000,
                max_context: 200_000,
                max_completion_tokens: 16_384,
                aggressive_read: false,
                aggressive_read_threshold: 5,
                compaction_ratio: 0.5,
                system_prompt_addition: None,
                supports_prompt_cache: false,
                supports_images: true,
                plan_thinking_budget: 24_000,
                supports_ultra_planning: true,
                max_plan_phases: 6,
                plan_aggressive_read_threshold: 6,
                plan_mode_system_prompt_addition: Some(
                    "PLAN MODE: Create structured multi-phase plans with clear milestones. \
                    Document assumptions and validate with tests at each phase boundary."
                        .into(),
                ),
                effort_level: EffortLevel::Standard,
            }
        } else if model_lower.contains("gpt") || model_lower.contains("openai") {
            Self {
                family: ModelFamily::OpenAI,
                thinking_budget: 8_000,
                max_context: 128_000,
                max_completion_tokens: 16_384,
                aggressive_read: false,
                aggressive_read_threshold: 4,
                compaction_ratio: 0.5,
                system_prompt_addition: None,
                supports_prompt_cache: false,
                supports_images: true,
                plan_thinking_budget: 16_000,
                supports_ultra_planning: true,
                max_plan_phases: 5,
                plan_aggressive_read_threshold: 5,
                plan_mode_system_prompt_addition: Some(
                    "PLAN MODE: Create clear 3-5 phase implementation plans. \
                    Prioritize iterative delivery with verifiable outcomes."
                        .into(),
                ),
                effort_level: EffortLevel::Standard,
            }
        } else if model_lower.contains("kimi-coding")
            || model_lower == "k2.6"
            || model_lower.contains("kimi2.6")
            || model_lower.contains("kimi-2.6")
        {
            Self {
                family: ModelFamily::KimiCoding,
                thinking_budget: 32_000,
                max_context: 262_144,
                max_completion_tokens: 32_768,
                aggressive_read: true,
                aggressive_read_threshold: 12,
                compaction_ratio: 0.7,
                system_prompt_addition: Some(
                    "You are Kimi K2.6 Coding, an advanced coding-optimized model with extended reasoning. \
                    You excel at software engineering tasks including architecture design, \
                    code review, debugging, and complex refactoring. Use thinking blocks for \
                    deep analysis. You have 256K context - read extensively before implementing. \
                    Prefer writing complete, production-ready solutions over incremental changes. \
                    \
                    Key strengths:\
                    - Deep reasoning with up to 32K thinking budget\
                    - Aggressive file reading (read up to 12 files at once when needed)\
                    - Prompt caching support for efficient long-context sessions\
                    - Excellent at understanding large codebases and cross-file dependencies\
                    - Prefer comprehensive architectural analysis before implementation\
                    \
                    When given a task:\
                    1. First explore the codebase thoroughly to understand patterns and conventions\
                    2. Read all relevant files before making changes\
                    3. Use thinking blocks to reason through complex logic\
                    4. Write complete, well-tested solutions rather than minimal patches\
                    5. Consider edge cases, error handling, and performance implications"
                        .into(),
                ),
                supports_prompt_cache: true,
                supports_images: true,
                plan_thinking_budget: 48_000,
                supports_ultra_planning: true,
                max_plan_phases: 8,
                plan_aggressive_read_threshold: 15,
                plan_mode_system_prompt_addition: Some(
                    "PLAN MODE: Use your full reasoning capacity for deep architectural planning. \
                    Break complex tasks into 5-8 phases with explicit dependency graphs. \
                    Each phase must have verifiable deliverables and rollback procedures. \
                    Consider edge cases, failure modes, and performance implications. \
                    Leverage your 256K context for exhaustive codebase analysis before planning. \
                    Prefer comprehensive solutions that minimize future technical debt. \
                    \
                    Planning guidelines for Kimi K2.6:\
                    - Use up to 48K thinking budget for complex architectural decisions\
                    - Read all relevant source files before creating the plan\
                    - Identify cross-file dependencies and interfaces early\
                    - Include specific file paths and function signatures in plan tasks\
                    - Define clear verification criteria for each phase"
                        .into(),
                ),
                effort_level: EffortLevel::Standard,
            }
        } else if model_lower.contains("kimi") || model_lower.contains("moonshot") {
            Self {
                family: ModelFamily::OpenAI,
                thinking_budget: 16_000,
                max_context: 256_000,
                max_completion_tokens: 16_384,
                aggressive_read: true,
                aggressive_read_threshold: 8,
                compaction_ratio: 0.6,
                system_prompt_addition: Some(
                    "You are running on Kimi k2.6. Excellent reasoning with preserved thinking. \
                    Use thinking blocks for complex planning and architecture decisions."
                        .into(),
                ),
                supports_prompt_cache: true,
                supports_images: true,
                plan_thinking_budget: 32_000,
                supports_ultra_planning: true,
                max_plan_phases: 7,
                plan_aggressive_read_threshold: 10,
                plan_mode_system_prompt_addition: Some(
                    "PLAN MODE: Create thorough 4-7 phase plans. Use thinking blocks for \
                    complex architectural decisions. Validate assumptions with code analysis."
                        .into(),
                ),
                effort_level: EffortLevel::Standard,
            }
        } else {
            Self {
                family: ModelFamily::Generic,
                thinking_budget: 12_000,
                max_context: 128_000,
                max_completion_tokens: 16_384,
                aggressive_read: false,
                aggressive_read_threshold: 5,
                compaction_ratio: 0.6,
                system_prompt_addition: None,
                supports_prompt_cache: false,
                supports_images: false,
                plan_thinking_budget: 18_000,
                supports_ultra_planning: false,
                max_plan_phases: 4,
                plan_aggressive_read_threshold: 5,
                plan_mode_system_prompt_addition: Some(
                    "PLAN MODE: Create a simple 2-4 phase plan with clear steps and verification."
                        .into(),
                ),
                effort_level: EffortLevel::Standard,
            }
        }
    }

    #[must_use]
    pub fn should_use_thinking(&self) -> bool {
        matches!(
            self.family,
            ModelFamily::Claude
                | ModelFamily::MiniMax
                | ModelFamily::Glm
                | ModelFamily::Qwen
                | ModelFamily::KimiCoding
                | ModelFamily::BedrockAnthropic
                | ModelFamily::OpenAI
        ) && self.thinking_budget > 0
    }

    #[must_use]
    pub fn context_near_limit(&self, used_tokens: usize) -> bool {
        #[allow(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            clippy::cast_precision_loss
        )]
        {
            let threshold = (self.max_context as f32 * self.compaction_ratio) as usize;
            used_tokens >= threshold
        }
    }

    /// Returns the appropriate thinking budget based on whether we're in plan mode
    /// and the current effort level.
    #[must_use]
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        clippy::cast_precision_loss
    )]
    pub fn thinking_budget_for_mode(&self, is_planning: bool) -> u32 {
        let base = if is_planning && self.plan_thinking_budget > 0 {
            self.plan_thinking_budget
        } else {
            self.thinking_budget
        };
        (base as f32 * self.effort_level.thinking_multiplier()) as u32
    }

    /// Returns the appropriate aggressive read threshold based on whether we're in plan mode.
    #[must_use]
    pub fn aggressive_read_threshold_for_mode(&self, is_planning: bool) -> usize {
        if is_planning {
            self.plan_aggressive_read_threshold
        } else {
            self.aggressive_read_threshold
        }
    }

    /// Returns the appropriate system prompt addition based on whether we're in plan mode.
    #[must_use]
    pub fn system_prompt_addition_for_mode(&self, is_planning: bool) -> Option<&String> {
        if is_planning {
            self.plan_mode_system_prompt_addition
                .as_ref()
                .or(self.system_prompt_addition.as_ref())
        } else {
            self.system_prompt_addition.as_ref()
        }
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
        assert_eq!(hints.max_completion_tokens, 32_768);
        assert!(hints.aggressive_read);
        assert!(hints.should_use_thinking());
        assert!(hints.supports_ultra_planning);
        assert_eq!(hints.max_plan_phases, 10);
        assert_eq!(hints.plan_thinking_budget, 40_000);
        assert_eq!(hints.plan_aggressive_read_threshold, 15);
        assert!(hints.plan_mode_system_prompt_addition.is_some());
    }

    #[test]
    fn test_minimax_27_hints() {
        let hints = ModelHints::for_model("minimax2.7");
        assert_eq!(hints.family, ModelFamily::MiniMax);
        assert_eq!(hints.max_context, 1_000_000);
        assert!(hints.supports_ultra_planning);
    }

    #[test]
    fn test_glm_hints() {
        let hints = ModelHints::for_model("glm/glm-5.1");
        assert_eq!(hints.family, ModelFamily::Glm);
        assert_eq!(hints.thinking_budget, 16_000);
        assert!(!hints.aggressive_read);
        assert!(hints.supports_ultra_planning);
        assert_eq!(hints.max_plan_phases, 5);
        assert_eq!(hints.plan_thinking_budget, 24_000);
    }

    #[test]
    fn test_glm_51_hints() {
        let hints = ModelHints::for_model("glm5.1");
        assert_eq!(hints.family, ModelFamily::Glm);
        assert_eq!(hints.max_context, 128_000);
        assert!(hints.supports_ultra_planning);
    }

    #[test]
    fn test_qwen_hints() {
        let hints = ModelHints::for_model("qwen/qwen-3.6-plus");
        assert_eq!(hints.family, ModelFamily::Qwen);
        assert!(hints.aggressive_read);
        assert!(hints.supports_ultra_planning);
        assert_eq!(hints.max_plan_phases, 6);
    }

    #[test]
    fn test_opus_hints() {
        let hints = ModelHints::for_model("bedrock/us.anthropic.claude-opus-4-6-v1");
        assert_eq!(hints.family, ModelFamily::Claude);
        assert_eq!(hints.thinking_budget, 32_000);
        assert!(hints.should_use_thinking());
        assert!(hints.supports_ultra_planning);
        assert_eq!(hints.plan_thinking_budget, 48_000);
    }

    #[test]
    fn test_sonnet_hints() {
        let hints = ModelHints::for_model("sonnet4.6");
        assert_eq!(hints.family, ModelFamily::Claude);
        assert_eq!(hints.thinking_budget, 16_000);
        assert!(hints.supports_ultra_planning);
    }

    #[test]
    fn test_haiku_hints() {
        let hints = ModelHints::for_model("haiku");
        assert_eq!(hints.family, ModelFamily::Claude);
        assert_eq!(hints.thinking_budget, 8_000);
        assert!(!hints.supports_ultra_planning);
        assert_eq!(hints.max_plan_phases, 3);
    }

    #[test]
    fn test_bedrock_hints() {
        let hints = ModelHints::for_model("bedrock-claude-v2");
        assert_eq!(hints.family, ModelFamily::BedrockAnthropic);
        assert!(hints.should_use_thinking());
        assert!(hints.supports_ultra_planning);
        assert_eq!(hints.plan_thinking_budget, 24_000);
    }

    #[test]
    fn test_openai_hints() {
        let hints = ModelHints::for_model("gpt-4o");
        assert_eq!(hints.family, ModelFamily::OpenAI);
        assert!(hints.should_use_thinking());
        assert!(hints.supports_ultra_planning);
    }

    #[test]
    fn test_kimi_coding_hints() {
        let hints = ModelHints::for_model("kimi-coding/k2.6");
        assert_eq!(hints.family, ModelFamily::KimiCoding);
        assert_eq!(hints.thinking_budget, 32_000);
        assert_eq!(hints.max_context, 262_144);
        assert_eq!(hints.max_completion_tokens, 32_768);
        assert!(hints.aggressive_read);
        assert!(hints.should_use_thinking());
        assert!(hints.supports_prompt_cache);
        assert!(hints.supports_ultra_planning);
        assert_eq!(hints.max_plan_phases, 8);
        assert_eq!(hints.plan_thinking_budget, 48_000);
        assert_eq!(hints.plan_aggressive_read_threshold, 15);
        assert!(hints
            .plan_mode_system_prompt_addition
            .as_ref()
            .unwrap()
            .contains("PLAN MODE"));
    }

    #[test]
    fn test_kimi_26_hints() {
        let hints = ModelHints::for_model("kimi2.6");
        assert_eq!(hints.family, ModelFamily::KimiCoding);
        assert_eq!(hints.max_context, 262_144);
        assert!(hints.supports_ultra_planning);
    }

    #[test]
    fn test_kimi_moonshot_hints() {
        let hints = ModelHints::for_model("moonshot-v1");
        assert_eq!(hints.family, ModelFamily::OpenAI);
        assert_eq!(hints.thinking_budget, 16_000);
        assert!(hints.supports_ultra_planning);
    }

    #[test]
    fn test_context_near_limit() {
        let hints = ModelHints::for_model("minimax/MiniMax-Text-01");
        assert!(!hints.context_near_limit(100_000));
        assert!(hints.context_near_limit(850_000));
    }

    #[test]
    fn test_thinking_budget_for_mode() {
        let hints = ModelHints::for_model("kimi-coding/k2.6");
        assert_eq!(hints.thinking_budget_for_mode(false), 32_000);
        assert_eq!(hints.thinking_budget_for_mode(true), 48_000);

        let glm = ModelHints::for_model("glm5.1");
        assert_eq!(glm.thinking_budget_for_mode(false), 16_000);
        assert_eq!(glm.thinking_budget_for_mode(true), 24_000);
    }

    #[test]
    fn test_aggressive_read_threshold_for_mode() {
        let hints = ModelHints::for_model("minimax2.7");
        assert_eq!(hints.aggressive_read_threshold_for_mode(false), 10);
        assert_eq!(hints.aggressive_read_threshold_for_mode(true), 15);

        let glm = ModelHints::for_model("glm5.1");
        assert_eq!(glm.aggressive_read_threshold_for_mode(false), 5);
        assert_eq!(glm.aggressive_read_threshold_for_mode(true), 6);
    }

    #[test]
    fn test_system_prompt_addition_for_mode() {
        let hints = ModelHints::for_model("kimi-coding/k2.6");
        assert!(hints.system_prompt_addition_for_mode(false).is_some());
        assert!(hints.system_prompt_addition_for_mode(true).is_some());
        assert!(hints
            .system_prompt_addition_for_mode(true)
            .unwrap()
            .contains("PLAN MODE"));

        // Generic model should have plan mode fallback
        let generic = ModelHints::for_model("unknown-model");
        assert!(generic.system_prompt_addition_for_mode(true).is_some());
    }

    #[test]
    fn test_plan_mode_fallback_to_normal() {
        // If plan_thinking_budget is 0, should fall back to thinking_budget
        let mut hints = ModelHints::for_model("generic");
        hints.plan_thinking_budget = 0;
        assert_eq!(hints.thinking_budget_for_mode(true), hints.thinking_budget);
    }

    #[test]
    fn test_generic_hints() {
        let hints = ModelHints::for_model("some-random-model");
        assert_eq!(hints.family, ModelFamily::Generic);
        assert!(!hints.supports_ultra_planning);
        assert_eq!(hints.max_plan_phases, 4);
        assert_eq!(hints.plan_thinking_budget, 18_000);
    }

    #[test]
    fn test_effort_level_multipliers() {
        assert_eq!(EffortLevel::Minimal.thinking_multiplier(), 0.25);
        assert_eq!(EffortLevel::Low.thinking_multiplier(), 0.5);
        assert_eq!(EffortLevel::Standard.thinking_multiplier(), 1.0);
        assert_eq!(EffortLevel::High.thinking_multiplier(), 1.5);
        assert_eq!(EffortLevel::Maximum.thinking_multiplier(), 2.0);

        assert_eq!(EffortLevel::Minimal.read_threshold_multiplier(), 2.0);
        assert_eq!(EffortLevel::Maximum.read_threshold_multiplier(), 0.5);
    }

    #[test]
    fn test_effort_level_cycling() {
        assert_eq!(EffortLevel::Minimal.next(), EffortLevel::Low);
        assert_eq!(EffortLevel::Low.next(), EffortLevel::Standard);
        assert_eq!(EffortLevel::Standard.next(), EffortLevel::High);
        assert_eq!(EffortLevel::High.next(), EffortLevel::Maximum);
        assert_eq!(EffortLevel::Maximum.next(), EffortLevel::Minimal);
    }

    #[test]
    fn test_effective_thinking_budget() {
        let mut hints = ModelHints::for_model("kimi-coding/k2.6");
        // Default is Standard = 1.0x
        assert_eq!(hints.effective_thinking_budget(), hints.thinking_budget);

        hints.effort_level = EffortLevel::High;
        assert_eq!(hints.effective_thinking_budget(), 48_000); // 32_000 * 1.5

        hints.effort_level = EffortLevel::Minimal;
        assert_eq!(hints.effective_thinking_budget(), 8_000); // 32_000 * 0.25
    }

    #[test]
    fn test_thinking_budget_for_mode_with_effort() {
        let mut hints = ModelHints::for_model("kimi-coding/k2.6");
        // Standard effort, normal mode
        assert_eq!(hints.thinking_budget_for_mode(false), 32_000);

        hints.effort_level = EffortLevel::High;
        assert_eq!(hints.thinking_budget_for_mode(false), 48_000);
        assert_eq!(hints.thinking_budget_for_mode(true), 72_000); // 48_000 * 1.5
    }
}
