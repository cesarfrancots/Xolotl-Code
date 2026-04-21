use std::fmt::Write;
use std::path::PathBuf;

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
    pub fn summary(&self) -> String {
        let mut lines = Vec::new();

        lines.push(format!("# Internal Spec: {}", self.task));
        lines.push(String::new());

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
                format!(
                    "Task: {}. Requirements: {}. Files: {} to read, {} to create.",
                    self.task,
                    self.inferred_requirements.join(", "),
                    self.files_to_read.len(),
                    self.files_to_create.len()
                )
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
                    let _ = write!(
                        ctx,
                        "Will create: {}. ",
                        self.files_to_create.join(", ")
                    );
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
