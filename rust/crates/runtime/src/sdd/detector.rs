use std::path::PathBuf;
use std::sync::LazyLock;

use regex::Regex;

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
    ]
});

static FILE_PATH_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:[\w\-\.]+/)*[\w\-\.]+\.\w{1,10}").unwrap());

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
        let input_lower = input.to_lowercase();

        let file_count = Self::count_file_references(input);
        let has_complexity_keyword = Self::contains_keywords(&input_lower, &COMPLEXITY_KEYWORDS);
        let has_scope_keyword = Self::contains_keywords(&input_lower, &SCOPE_KEYWORDS);
        let mentions_existing = Self::mentions_existing_code(input);
        let has_multiple_files = file_count >= 2;

        let complexity_score = {
            let mut score = 0;

            if file_count >= 3 {
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

            score
        };

        match complexity_score {
            0..=2 => Complexity::Low,
            3..=5 => Complexity::Medium,
            _ => Complexity::High,
        }
    }

    pub fn extract_file_references(&self, input: &str) -> Vec<PathBuf> {
        let mut files: Vec<PathBuf> = Vec::new();
        let seen: &mut std::collections::HashSet<String> = &mut std::collections::HashSet::new();

        for cap in FILE_PATH_REGEX.captures_iter(input) {
            let path = cap.get(0).unwrap().as_str();
            let normalized = path.to_string();

            if seen.contains(&normalized) {
                continue;
            }
            seen.insert(normalized.clone());

            let path_buf = PathBuf::from(path);

            let is_code_file = matches!(
                path_buf.extension().and_then(|e| e.to_str()),
                Some("rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "go" | "java" | "cpp" | "c" |
"h" | "hpp" | "cs" | "rb" | "swift" | "kt" | "scala" | "md" | "json" | "yaml"
| "yml" | "toml" | "txt")
            );

            if is_code_file || path.contains('/') || path.contains('\\') {
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
}
