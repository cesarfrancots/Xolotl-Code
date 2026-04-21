use std::fmt::Write;
use std::path::PathBuf;

use crate::model_hints::ModelHints;
use crate::sdd::Complexity;

#[derive(Debug, Clone)]
pub struct InternalSpec {
    pub task: String,
    pub inferred_requirements: Vec<String>,
    pub constraints: Vec<String>,
    pub acceptance_criteria: Vec<String>,
    pub files_to_read: Vec<PathBuf>,
    pub files_to_create: Vec<String>,
    pub files_to_modify: Vec<PathBuf>,
    pub suggested_approach: String,
    pub complexity: Complexity,
    pub model_hints: Option<ModelHints>,
    pub estimated_tokens: usize,
}

impl InternalSpec {
    #[must_use]
    pub fn new(task: String) -> Self {
        Self {
            task,
            inferred_requirements: Vec::new(),
            constraints: Vec::new(),
            acceptance_criteria: Vec::new(),
            files_to_read: Vec::new(),
            files_to_create: Vec::new(),
            files_to_modify: Vec::new(),
            suggested_approach: String::new(),
            complexity: Complexity::Low,
            model_hints: None,
            estimated_tokens: 0,
        }
    }

    #[must_use]
    pub fn with_requirements(mut self, requirements: Vec<String>) -> Self {
        self.inferred_requirements = requirements;
        self
    }

    #[must_use]
    pub fn with_constraints(mut self, constraints: Vec<String>) -> Self {
        self.constraints = constraints;
        self
    }

    #[must_use]
    pub fn with_acceptance_criteria(mut self, criteria: Vec<String>) -> Self {
        self.acceptance_criteria = criteria;
        self
    }

    #[must_use]
    pub fn with_files_to_read(mut self, files: Vec<PathBuf>) -> Self {
        self.files_to_read = files;
        self
    }

    #[must_use]
    pub fn with_files_to_create(mut self, files: Vec<String>) -> Self {
        self.files_to_create = files;
        self
    }

    #[must_use]
    pub fn with_files_to_modify(mut self, files: Vec<PathBuf>) -> Self {
        self.files_to_modify = files;
        self
    }

    #[must_use]
    pub fn with_approach(mut self, approach: String) -> Self {
        self.suggested_approach = approach;
        self
    }

    #[must_use]
    pub fn with_complexity(mut self, complexity: Complexity) -> Self {
        self.complexity = complexity;
        self
    }

    #[must_use]
    pub fn with_model_hints(mut self, hints: ModelHints) -> Self {
        self.model_hints = Some(hints);
        self
    }

    #[must_use]
    pub fn with_estimated_tokens(mut self, tokens: usize) -> Self {
        self.estimated_tokens = tokens;
        self
    }

    #[must_use]
    pub fn summary(&self) -> String {
        let mut lines = Vec::new();

        lines.push(format!("# Internal Spec: {}", self.task));
        lines.push(String::new());

        if let Some(ref hints) = self.model_hints {
            lines.push("## Model Configuration".to_string());
            lines.push(format!("- Model family: {:?}", hints.family));
            lines.push(format!("- Context window: {} tokens", hints.max_context));
            lines.push(format!(
                "- Aggressive read threshold: {} files",
                hints.aggressive_read_threshold
            ));
            if hints.supports_ultra_planning {
                lines.push(format!(
                    "- Ultra-planning: up to {} phases",
                    hints.max_plan_phases
                ));
            }
            lines.push(String::new());
        }

        if !self.inferred_requirements.is_empty() {
            lines.push("## Requirements".to_string());
            for req in &self.inferred_requirements {
                lines.push(format!("- {req}"));
            }
            lines.push(String::new());
        }

        if !self.constraints.is_empty() {
            lines.push("## Constraints".to_string());
            for constraint in &self.constraints {
                lines.push(format!("- {constraint}"));
            }
            lines.push(String::new());
        }

        if !self.acceptance_criteria.is_empty() {
            lines.push("## Acceptance Criteria".to_string());
            for criterion in &self.acceptance_criteria {
                lines.push(format!("- [ ] {criterion}"));
            }
            lines.push(String::new());
        }

        if !self.files_to_read.is_empty() {
            lines.push("## Files to Read".to_string());
            for file in &self.files_to_read {
                lines.push(format!("- `{}`", file.display()));
            }
            lines.push(String::new());
        }

        if !self.files_to_create.is_empty() {
            lines.push("## Files to Create".to_string());
            for file in &self.files_to_create {
                lines.push(format!("- `{file}`"));
            }
            lines.push(String::new());
        }

        if !self.files_to_modify.is_empty() {
            lines.push("## Files to Modify".to_string());
            for file in &self.files_to_modify {
                lines.push(format!("- `{}`", file.display()));
            }
            lines.push(String::new());
        }

        if self.estimated_tokens > 0 {
            lines.push("## Token Estimate".to_string());
            lines.push(format!(
                "- Estimated context needed: ~{} tokens",
                self.estimated_tokens
            ));
            if let Some(ref hints) = self.model_hints {
                let max_effective = (hints.max_context as f32 * hints.compaction_ratio) as usize;
                if self.estimated_tokens > max_effective {
                    lines.push(format!(
                        "- WARNING: Exceeds effective context limit of {} tokens",
                        max_effective
                    ));
                } else {
                    lines.push(format!(
                        "- Within effective context limit of {} tokens",
                        max_effective
                    ));
                }
            }
            lines.push(String::new());
        }

        if !self.suggested_approach.is_empty() {
            lines.push("## Suggested Approach".to_string());
            lines.push(self.suggested_approach.clone());
            lines.push(String::new());
        }

        lines.join("\n")
    }

    #[must_use]
    pub fn phase_context(&self) -> String {
        match self.complexity {
            Complexity::Low => {
                format!("Simple task: {}. Direct implementation.", self.task)
            }
            Complexity::Medium => {
                if let Some(ref hints) = self.model_hints {
                    format!(
                        "Task: {}. Complexity: Medium. Model: {:?}. Files: {} to read, {} to create. Estimated tokens: {}.",
                        self.task,
                        hints.family,
                        self.files_to_read.len(),
                        self.files_to_create.len(),
                        self.estimated_tokens
                    )
                } else {
                    format!(
                        "Task: {}. Requirements: {}. Files: {} to read, {} to create.",
                        self.task,
                        self.inferred_requirements.join(", "),
                        self.files_to_read.len(),
                        self.files_to_create.len()
                    )
                }
            }
            Complexity::High => {
                let mut ctx = format!(
                    "Complex task: {}. Reading {} files to understand existing code. ",
                    self.task,
                    self.files_to_read.len()
                );
                if !self.inferred_requirements.is_empty() {
                    let _ = write!(
                        ctx,
                        "Requirements: {}. ",
                        self.inferred_requirements.join(", ")
                    );
                }
                if !self.files_to_create.is_empty() {
                    let _ = write!(ctx, "Will create: {}. ", self.files_to_create.join(", "));
                }
                if let Some(ref hints) = self.model_hints {
                    let _ = write!(ctx, "Model: {:?}. ", hints.family);
                    if self.estimated_tokens > 0 {
                        let _ = write!(ctx, "Estimated tokens: {}. ", self.estimated_tokens);
                    }
                }
                ctx
            }
        }
    }
}

impl std::fmt::Display for InternalSpec {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.summary())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sdd::Complexity;

    #[test]
    fn test_spec_with_model_hints() {
        let hints = ModelHints::for_model("kimi-coding/k2.6");
        let spec = InternalSpec::new("Implement auth".to_string())
            .with_complexity(Complexity::High)
            .with_model_hints(hints)
            .with_estimated_tokens(15_000)
            .with_files_to_read(vec![PathBuf::from("auth.rs"), PathBuf::from("models.rs")])
            .with_requirements(vec!["OAuth 2.0".to_string(), "JWT tokens".to_string()]);

        let summary = spec.summary();
        assert!(summary.contains("KimiCoding"));
        assert!(summary.contains("262144 tokens"));
        assert!(summary.contains("15000 tokens"));
        assert!(summary.contains("OAuth 2.0"));
    }

    #[test]
    fn test_spec_token_warning() {
        let hints = ModelHints::for_model("glm5.1");
        let spec = InternalSpec::new("Big task".to_string())
            .with_model_hints(hints)
            .with_estimated_tokens(100_000);

        let summary = spec.summary();
        assert!(summary.contains("WARNING"));
    }

    #[test]
    fn test_phase_context_with_model() {
        let hints = ModelHints::for_model("minimax2.7");
        let spec = InternalSpec::new("Refactor API".to_string())
            .with_complexity(Complexity::Medium)
            .with_model_hints(hints)
            .with_estimated_tokens(25_000)
            .with_files_to_read(vec![PathBuf::from("api.rs")]);

        let ctx = spec.phase_context();
        assert!(ctx.contains("MiniMax"));
        assert!(ctx.contains("25000"));
    }
}
