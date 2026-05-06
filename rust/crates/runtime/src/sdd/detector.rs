use std::path::PathBuf;
use std::sync::LazyLock;

use regex::Regex;

use crate::model_hints::{ModelFamily, ModelHints};

static COMPLEXITY_KEYWORDS: LazyLock<Vec<&'static str>> = LazyLock::new(|| {
    vec![
        "implement",
        "build",
        "create",
        "refactor",
        "add feature",
        "restructure",
        "rewrite",
        "migrate",
        "design",
        "architect",
        "develop",
        "setup",
        "configure",
        "optimize",
        "improve",
        "enhance",
        "extend",
        "modify",
        "integrate",
        "extract",
        "abstract",
        "consolidate",
        "decouple",
    ]
});

static PLANNING_KEYWORDS: LazyLock<Vec<&'static str>> = LazyLock::new(|| {
    vec![
        "plan",
        "design",
        "architecture",
        "roadmap",
        "strategy",
        "blueprint",
        "specification",
        "estimate",
        "breakdown",
        "phases",
        "milestones",
        "dependencies",
    ]
});

static SCOPE_KEYWORDS: LazyLock<Vec<&'static str>> = LazyLock::new(|| {
    vec![
        "module",
        "system",
        "subsystem",
        "component",
        "service",
        "api",
        "library",
        "framework",
        "architecture",
        "pattern",
        "infrastructure",
    ]
});

static EXISTING_CODE_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        Regex::new(r"(?i)existing\s+(\w+)").unwrap(),
        Regex::new(r"(?i)current\s+(\w+)").unwrap(),
        Regex::new(r"(?i)the\s+\w+\s+code").unwrap(),
        Regex::new(r"(?i)before\s+we\s+can").unwrap(),
        Regex::new(r"(?i)look\s+at\s+the").unwrap(),
        Regex::new(r"(?i)understand\s+the\s+existing").unwrap(),
        Regex::new(r"(?i)refactor\s+the\s+current").unwrap(),
    ]
});

static FILE_PATH_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    // Match traditional files with extensions, and common extension-less files like Dockerfile, Makefile
    Regex::new(r"(?:[\w\-\.]+[/\\])*(?:[\w\-\.]+\.\w{1,10}|Dockerfile|Makefile|README|LICENSE|CHANGELOG|CONTRIBUTING)").unwrap()
});

/// Detailed breakdown of complexity scoring for diagnostics and tuning.
#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(clippy::struct_excessive_bools)]
pub struct ComplexityScore {
    pub raw_score: usize,
    pub file_count: usize,
    pub has_complexity_keyword: bool,
    pub has_scope_keyword: bool,
    pub mentions_existing: bool,
    pub has_multiple_files: bool,
    pub is_planning_task: bool,
    pub model_adjusted: bool,
}

impl ComplexityScore {
    #[must_use]
    pub fn to_complexity(&self) -> Complexity {
        match self.raw_score {
            0..=2 => Complexity::Low,
            3..=5 => Complexity::Medium,
            _ => Complexity::High,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Complexity {
    Low,
    Medium,
    High,
}

impl Complexity {
    #[must_use]
    pub fn is_complex(&self) -> bool {
        !matches!(self, Complexity::Low)
    }

    #[must_use]
    pub fn threshold(&self) -> usize {
        match self {
            Complexity::Low => 1,
            Complexity::Medium => 2,
            Complexity::High => 3,
        }
    }

    /// Returns a model-aware description of what this complexity level means.
    #[must_use]
    pub fn description_for_model(&self, hints: &ModelHints) -> &'static str {
        match (self, hints.family) {
            (Complexity::Low, _) => "Simple task with minimal files and clear scope.",
            (Complexity::Medium, ModelFamily::MiniMax) => {
                "Moderate complexity. MiniMax's 1M context easily accommodates this."
            }
            (Complexity::Medium, ModelFamily::KimiCoding) => {
                "Moderate complexity. Kimi's 256K context and coding optimization handle this well."
            }
            (Complexity::Medium, ModelFamily::Glm) => {
                "Moderate complexity. GLM's 128K context is sufficient with focused reading."
            }
            (Complexity::Medium, _) => "Moderate complexity requiring some research and planning.",
            (Complexity::High, ModelFamily::MiniMax) => {
                "High complexity with many files and dependencies. MiniMax can handle this with aggressive reading."
            }
            (Complexity::High, ModelFamily::KimiCoding) => {
                "High complexity coding task. Kimi's extended reasoning and large context are well-suited."
            }
            (Complexity::High, ModelFamily::Glm) => {
                "High complexity. Consider breaking into smaller phases to stay within GLM's context window."
            }
            (Complexity::High, _) => {
                "High complexity requiring extensive research, planning, and verification."
            }
        }
    }
}

pub struct ComplexityDetector {
    aggressive_read_threshold: usize,
}

impl ComplexityDetector {
    #[must_use]
    pub fn new() -> Self {
        Self {
            aggressive_read_threshold: 5,
        }
    }

    #[must_use]
    pub fn with_aggressive_threshold(mut self, threshold: usize) -> Self {
        self.aggressive_read_threshold = threshold;
        self
    }

    #[must_use]
    pub fn detect(&self, input: &str) -> Complexity {
        self.detect_with_score(input).to_complexity()
    }

    #[must_use]
    pub fn detect_with_score(&self, input: &str) -> ComplexityScore {
        let input_lower = input.to_lowercase();

        let file_count = Self::count_file_references(input);
        let has_complexity_keyword = Self::contains_keywords(&input_lower, &COMPLEXITY_KEYWORDS);
        let has_scope_keyword = Self::contains_keywords(&input_lower, &SCOPE_KEYWORDS);
        let mentions_existing = Self::mentions_existing_code(input);
        let has_multiple_files = file_count >= 2;
        let is_planning_task = Self::contains_keywords(&input_lower, &PLANNING_KEYWORDS);

        let complexity_score = {
            let mut score = 0;

            if file_count >= 5 {
                score += 4;
            } else if file_count >= 3 {
                score += 3;
            } else if file_count >= 2 {
                score += 2;
            } else if file_count >= 1 {
                score += 1;
            }

            if has_complexity_keyword {
                score += 2;
            }

            if has_scope_keyword {
                score += 2;
            }

            if mentions_existing {
                score += 1;
            }

            if has_multiple_files && has_complexity_keyword {
                score += 2;
            }

            if is_planning_task && has_scope_keyword {
                score += 1;
            }

            score
        };

        ComplexityScore {
            raw_score: complexity_score,
            file_count,
            has_complexity_keyword,
            has_scope_keyword,
            mentions_existing,
            has_multiple_files,
            is_planning_task,
            model_adjusted: false,
        }
    }

    pub fn extract_file_references(&self, input: &str) -> Vec<PathBuf> {
        let mut files: Vec<PathBuf> = Vec::new();
        let seen: &mut std::collections::HashSet<String> = &mut std::collections::HashSet::new();

        for cap in FILE_PATH_REGEX.captures_iter(input) {
            let path = cap.get(0).unwrap().as_str();
            let normalized = path.replace('\\', "/");

            if seen.contains(&normalized) {
                continue;
            }
            seen.insert(normalized.clone());

            let path_buf = PathBuf::from(&normalized);

            let is_code_file = matches!(
                path_buf.extension().and_then(|e| e.to_str()),
                Some(
                    "rs" | "ts"
                        | "tsx"
                        | "js"
                        | "jsx"
                        | "py"
                        | "go"
                        | "java"
                        | "cpp"
                        | "c"
                        | "h"
                        | "hpp"
                        | "cs"
                        | "rb"
                        | "swift"
                        | "kt"
                        | "scala"
                        | "md"
                        | "json"
                        | "yaml"
                        | "yml"
                        | "toml"
                        | "txt"
                        | "dockerfile"
                        | "makefile"
                        | "sh"
                        | "ps1"
                        | "sql"
                )
            );

            // Also match files without traditional extensions but with path separators
            let has_path_separator = path.contains('/') || path.contains('\\');

            if is_code_file || has_path_separator {
                files.push(path_buf);
            }
        }

        files
    }

    #[must_use]
    pub fn should_read_aggressively(&self, files: &[PathBuf]) -> bool {
        files.len() >= self.aggressive_read_threshold
    }

    fn count_file_references(input: &str) -> usize {
        FILE_PATH_REGEX.captures_iter(input).count()
    }

    fn contains_keywords(text: &str, keywords: &[&str]) -> bool {
        keywords.iter().any(|kw| text.contains(kw))
    }

    fn mentions_existing_code(input: &str) -> bool {
        EXISTING_CODE_PATTERNS.iter().any(|re| re.is_match(input))
    }
}

impl Default for ComplexityDetector {
    fn default() -> Self {
        Self::new()
    }
}

/// Model-aware complexity detector that calibrates thresholds and scoring
/// based on the target model's capabilities.
#[allow(dead_code)]
pub struct ModelAwareComplexityDetector {
    base_detector: ComplexityDetector,
    hints: ModelHints,
    is_planning_mode: bool,
}

#[allow(dead_code)]
impl ModelAwareComplexityDetector {
    #[must_use]
    pub fn new(hints: ModelHints) -> Self {
        let threshold = hints.aggressive_read_threshold_for_mode(false);
        Self {
            base_detector: ComplexityDetector::new().with_aggressive_threshold(threshold),
            hints,
            is_planning_mode: false,
        }
    }

    #[must_use]
    pub fn for_planning(hints: ModelHints) -> Self {
        let threshold = hints.aggressive_read_threshold_for_mode(true);
        Self {
            base_detector: ComplexityDetector::new().with_aggressive_threshold(threshold),
            hints,
            is_planning_mode: true,
        }
    }

    #[must_use]
    pub fn detect(&self, input: &str) -> Complexity {
        self.detect_with_score(input).to_complexity()
    }

    #[must_use]
    pub fn detect_with_score(&self, input: &str) -> ComplexityScore {
        let mut score = self.base_detector.detect_with_score(input);

        // Model-specific adjustments
        match self.hints.family {
            ModelFamily::MiniMax
                // MiniMax has 1M context - can handle more files without score penalty
                if score.file_count >= 3 && score.file_count <= 8 =>
            {
                score.raw_score = score.raw_score.saturating_sub(1);
            }
            ModelFamily::KimiCoding
                // Kimi K2.6 excels at coding with 256K context
                if score.has_complexity_keyword && score.file_count >= 3 =>
            {
                score.raw_score = score.raw_score.saturating_sub(1);
            }
            ModelFamily::Glm
                // GLM is more conservative - bump up complexity for large tasks
                if score.file_count >= 5 && score.raw_score >= 5 =>
            {
                score.raw_score += 1;
            }
            _ => {}
        }

        score.model_adjusted = true;
        score
    }

    pub fn extract_file_references(&self, input: &str) -> Vec<PathBuf> {
        self.base_detector.extract_file_references(input)
    }

    #[must_use]
    pub fn should_read_aggressively(&self, files: &[PathBuf]) -> bool {
        self.base_detector.should_read_aggressively(files)
    }

    /// Estimate how many tokens this task might need based on complexity and model.
    #[must_use]
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        clippy::cast_precision_loss
    )]
    pub fn estimated_context_tokens(&self, complexity: Complexity, file_count: usize) -> usize {
        let base_estimate = match complexity {
            Complexity::Low => 2_000,
            Complexity::Medium => 8_000,
            Complexity::High => 20_000,
        };

        let file_overhead = file_count * 1_500;
        let total = base_estimate + file_overhead;

        // Cap at model's effective context window
        let max_effective = (self.hints.max_context as f32 * self.hints.compaction_ratio) as usize;
        total.min(max_effective)
    }

    /// Get the recommended number of files to read before implementing.
    #[must_use]
    pub fn recommended_read_count(&self, detected_files: &[PathBuf]) -> usize {
        let max_read = self
            .hints
            .aggressive_read_threshold_for_mode(self.is_planning_mode);
        detected_files.len().min(max_read)
    }

    /// Get a model-aware assessment of whether this task should use planning mode.
    #[must_use]
    pub fn should_use_planning_mode(&self, complexity: Complexity, file_count: usize) -> bool {
        match self.hints.family {
            ModelFamily::MiniMax => complexity == Complexity::High || file_count >= 8,
            ModelFamily::KimiCoding => complexity == Complexity::High || file_count >= 6,
            ModelFamily::Glm => complexity == Complexity::High || file_count >= 4,
            _ => complexity == Complexity::High || file_count >= 5,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_low_complexity_simple_task() {
        let detector = ComplexityDetector::new();
        assert_eq!(detector.detect("fix typo in README"), Complexity::Low);
        assert_eq!(detector.detect("change variable name"), Complexity::Low);
    }

    #[test]
    fn test_medium_complexity_file_and_keyword() {
        let detector = ComplexityDetector::new();
        assert_eq!(
            detector.detect("read auth.rs and implement OAuth"),
            Complexity::Medium
        );
    }

    #[test]
    fn test_high_complexity_multiple_files() {
        let detector = ComplexityDetector::new();
        let task = "implement user authentication with OAuth in auth/handler.rs, auth/models.rs, and create auth/oauth.rs";
        assert_eq!(detector.detect(task), Complexity::High);
    }

    #[test]
    fn test_extract_file_references() {
        let detector = ComplexityDetector::new();
        let files =
            detector.extract_file_references("read src/main.rs and lib.rs, then update Cargo.toml");
        assert!(files.len() >= 2);
    }

    #[test]
    fn test_extract_windows_paths() {
        let detector = ComplexityDetector::new();
        let files = detector.extract_file_references("read src\\main.rs and lib.rs");
        assert_eq!(files.len(), 2);
        assert!(files[0].to_string_lossy().contains("main.rs"));
    }

    #[test]
    fn test_extract_config_files() {
        let detector = ComplexityDetector::new();
        let files = detector.extract_file_references("update Cargo.toml and package.json");
        assert_eq!(files.len(), 2);
        assert!(files
            .iter()
            .any(|f| f.to_string_lossy().contains("Cargo.toml")));
        assert!(files
            .iter()
            .any(|f| f.to_string_lossy().contains("package.json")));
    }

    #[test]
    fn test_aggressive_read_threshold() {
        let detector = ComplexityDetector::new();
        let files = vec![
            PathBuf::from("a.rs"),
            PathBuf::from("b.rs"),
            PathBuf::from("c.rs"),
            PathBuf::from("d.rs"),
            PathBuf::from("e.rs"),
            PathBuf::from("f.rs"),
        ];
        assert!(detector.should_read_aggressively(&files));
    }

    #[test]
    fn test_planning_keyword_boost() {
        let detector = ComplexityDetector::new();
        let task = "design the architecture for a new microservice with phases and milestones";
        let score = detector.detect_with_score(task);
        assert!(score.is_planning_task);
        assert!(score.has_scope_keyword);
    }

    #[test]
    fn test_model_aware_minimax() {
        let hints = ModelHints::for_model("minimax2.7");
        let detector = ModelAwareComplexityDetector::new(hints);
        let score =
            detector.detect_with_score("read file1.rs, file2.rs, file3.rs and implement feature");
        // MiniMax should reduce score for 3 files
        assert!(score.model_adjusted);
    }

    #[test]
    fn test_model_aware_kimi() {
        let hints = ModelHints::for_model("kimi-coding/k2.6");
        let detector = ModelAwareComplexityDetector::new(hints);
        let score = detector
            .detect_with_score("refactor the current auth module in auth.rs, models.rs, utils.rs");
        // Kimi should handle this well
        assert!(score.model_adjusted);
    }

    #[test]
    fn test_model_aware_glm() {
        let hints = ModelHints::for_model("glm5.1");
        let detector = ModelAwareComplexityDetector::new(hints);
        let score = detector.detect_with_score("implement user auth with OAuth in handler.rs, models.rs, service.rs, config.rs, tests.rs");
        // GLM should bump up score for many files
        assert!(score.model_adjusted);
    }

    #[test]
    fn test_estimated_context_tokens() {
        let hints = ModelHints::for_model("kimi-coding/k2.6");
        let detector = ModelAwareComplexityDetector::new(hints.clone());
        let low = detector.estimated_context_tokens(Complexity::Low, 2);
        let medium = detector.estimated_context_tokens(Complexity::Medium, 4);
        let high = detector.estimated_context_tokens(Complexity::High, 10);

        assert!(low < medium);
        assert!(medium < high);
        assert!(high <= (hints.max_context as f32 * hints.compaction_ratio) as usize);
    }

    #[test]
    fn test_recommended_read_count() {
        let hints = ModelHints::for_model("kimi-coding/k2.6");
        let detector = ModelAwareComplexityDetector::new(hints.clone());
        let files = vec![PathBuf::from("a.rs"); 20];
        let count = detector.recommended_read_count(&files);
        assert_eq!(count, hints.aggressive_read_threshold_for_mode(false));
    }

    #[test]
    fn test_recommended_read_count_for_planning_mode() {
        let hints = ModelHints::for_model("kimi-coding/k2.6");
        let detector = ModelAwareComplexityDetector::for_planning(hints.clone());
        let files = vec![PathBuf::from("a.rs"); 20];
        let count = detector.recommended_read_count(&files);
        assert_eq!(count, hints.aggressive_read_threshold_for_mode(true));
    }

    #[test]
    fn test_should_use_planning_mode() {
        let kimi = ModelHints::for_model("kimi-coding/k2.6");
        let kimi_detector = ModelAwareComplexityDetector::new(kimi);
        assert!(kimi_detector.should_use_planning_mode(Complexity::High, 3));
        assert!(kimi_detector.should_use_planning_mode(Complexity::Medium, 6));
        assert!(!kimi_detector.should_use_planning_mode(Complexity::Low, 2));

        let minimax = ModelHints::for_model("minimax2.7");
        let minimax_detector = ModelAwareComplexityDetector::new(minimax);
        assert!(minimax_detector.should_use_planning_mode(Complexity::Medium, 8));
        assert!(!minimax_detector.should_use_planning_mode(Complexity::Medium, 5));

        let glm = ModelHints::for_model("glm5.1");
        let glm_detector = ModelAwareComplexityDetector::new(glm);
        assert!(glm_detector.should_use_planning_mode(Complexity::Medium, 4));
    }

    #[test]
    fn test_complexity_description_for_model() {
        let kimi = ModelHints::for_model("kimi-coding/k2.6");
        let minimax = ModelHints::for_model("minimax2.7");
        let glm = ModelHints::for_model("glm5.1");

        assert!(Complexity::High
            .description_for_model(&kimi)
            .contains("Kimi"));
        assert!(Complexity::High
            .description_for_model(&minimax)
            .contains("MiniMax"));
        assert!(Complexity::High.description_for_model(&glm).contains("GLM"));
    }

    #[test]
    fn test_planning_detector_uses_plan_threshold() {
        let hints = ModelHints::for_model("kimi-coding/k2.6");
        let plan_detector = ModelAwareComplexityDetector::for_planning(hints.clone());
        let normal_detector = ModelAwareComplexityDetector::new(hints);

        // Normal threshold is 12, plan threshold is 15
        let files_14 = vec![PathBuf::from("a.rs"); 14];
        assert!(normal_detector.should_read_aggressively(&files_14));
        assert!(!plan_detector.should_read_aggressively(&files_14));

        let files_15 = vec![PathBuf::from("a.rs"); 15];
        assert!(plan_detector.should_read_aggressively(&files_15));
    }
}
