use std::collections::HashSet;
use std::path::PathBuf;

pub mod detector;
pub mod spec;

pub use detector::{Complexity, ComplexityDetector};
pub use spec::InternalSpec;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SddPhase {
    Idle,
    Analyze,
    Speculate,
    Planify,
    Implement,
    Verify,
}

impl SddPhase {
    pub fn is_terminal(&self) -> bool {
        matches!(self, SddPhase::Idle | SddPhase::Verify)
    }

    pub fn suggested_tools(&self) -> &'static [&'static str] {
        match self {
            SddPhase::Idle => &["*"],
            SddPhase::Analyze => &["read_file", "glob", "grep", "web_fetch", "bash"],
            SddPhase::Speculate => &["read_file", "glob", "grep"],
            SddPhase::Planify => &["read_file", "bash"],
            SddPhase::Implement => &["read_file", "write_file", "edit_file", "bash", "task"],
            SddPhase::Verify => &["bash", "read_file", "glob"],
        }
    }

    pub fn description(&self) -> &'static str {
        match self {
            SddPhase::Idle => "Ready for new task",
            SddPhase::Analyze => "Analyzing codebase and requirements",
            SddPhase::Speculate => "Building internal specification",
            SddPhase::Planify => "Planning implementation approach",
            SddPhase::Implement => "Implementing changes",
            SddPhase::Verify => "Verifying changes",
        }
    }
}

#[derive(Debug, Clone)]
pub struct SddState {
    pub phase: SddPhase,
    pub complexity: Option<Complexity>,
    pub spec: Option<InternalSpec>,
    pub current_task: Option<String>,
    pub files_to_read: Vec<PathBuf>,
    pub files_to_create: Vec<String>,
    pub key_decisions: Vec<String>,
    pub tool_suggestion: Option<String>,
}

impl Default for SddState {
    fn default() -> Self {
        Self {
            phase: SddPhase::Idle,
            complexity: None,
            spec: None,
            current_task: None,
            files_to_read: Vec::new(),
            files_to_create: Vec::new(),
            key_decisions: Vec::new(),
            tool_suggestion: None,
        }
    }
}

impl SddState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn enter_analyze(&mut self, task: &str, files: Vec<PathBuf>) {
        self.phase = SddPhase::Analyze;
        self.current_task = Some(task.to_string());
        self.files_to_read = files;
        self.tool_suggestion = if self.files_to_read.is_empty() {
            None
        } else {
            Some(format_read_suggestion(&self.files_to_read))
        };
    }

    pub fn enter_speculate(&mut self, spec: InternalSpec) {
        self.phase = SddPhase::Speculate;
        let task = spec.task.clone();
        self.spec = Some(spec);
        self.tool_suggestion = Some(format!("Spec created: {}. Transitioning to planning...", task));
    }

    pub fn enter_planify(&mut self, approach: String) {
        self.phase = SddPhase::Planify;
        self.key_decisions.push(approach.clone());
        self.tool_suggestion = Some(format!("Planned approach: {approach}. Ready to implement."));
    }

    pub fn enter_implement(&mut self) {
        self.phase = SddPhase::Implement;
        self.tool_suggestion = Some(format!(
            "Files to create: {}. Begin implementation.",
            self.files_to_create.join(", ")
        ));
    }

    pub fn enter_verify(&mut self) {
        self.phase = SddPhase::Verify;
        self.tool_suggestion = Some("Run tests to verify changes.".to_string());
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }

    pub fn is_active(&self) -> bool {
        !matches!(self.phase, SddPhase::Idle)
    }
}

fn format_read_suggestion(files: &[PathBuf]) -> String {
    if files.is_empty() {
        return String::new();
    }

    if files.len() == 1 {
        return format!("I'll start by reading: {}", files[0].display());
    }

    if files.len() <= 3 {
        let names: Vec<_> = files.iter().map(|p| p.display().to_string()).collect();
        return format!("I'll start by reading: {}", names.join(", "));
    }

    format!(
        "I'll start by reading the key files: {} (and {} more)",
        files[0].display(),
        files.len() - 1
    )
}

#[derive(Debug, Clone)]
pub struct SddEngine {
    state: SddState,
    aggressive_read: bool,
}

impl SddEngine {
    pub fn new() -> Self {
        Self {
            state: SddState::new(),
            aggressive_read: false,
        }
    }

    pub fn with_aggressive_read(mut self, aggressive: bool) -> Self {
        self.aggressive_read = aggressive;
        self
    }

    pub fn state(&self) -> &SddState {
        &self.state
    }

    pub fn analyze(&mut self, input: &str) -> Option<String> {
        let detector = ComplexityDetector::new();
        let complexity = detector.detect(input);

        if complexity == Complexity::Low {
            return None;
        }

        self.state.complexity = Some(complexity);

        let files = detector.extract_file_references(input);
        self.state.enter_analyze(input, files);

        self.state.tool_suggestion.clone()
    }

    pub fn transition_to_speculate(&mut self, spec: InternalSpec) {
        self.state.enter_speculate(spec);
    }

    pub fn transition_to_planify(&mut self, approach: String) {
        self.state.enter_planify(approach);
    }

    pub fn transition_to_implement(&mut self) {
        self.state.enter_implement();
    }

    pub fn transition_to_verify(&mut self) {
        self.state.enter_verify();
    }

    pub fn complete(&mut self) {
        self.state.phase = SddPhase::Idle;
        self.state.tool_suggestion = None;
    }

    pub fn abort(&mut self) {
        self.state.reset();
    }

    pub fn suggest_next_tool(&self, last_tool_used: Option<&str>) -> Option<String> {
        if !self.state.is_active() {
            return None;
        }

        if let Some(ref suggestion) = self.state.tool_suggestion {
            return Some(suggestion.clone());
        }

        let suggested = self.state.phase.suggested_tools();
        if suggested.contains(&"*") {
            return None;
        }

        Some(format!(
            "In {} phase, consider: {}",
            self.state.phase.description(),
            suggested.join(", ")
        ))
    }
}

impl Default for SddEngine {
    fn default() -> Self {
        Self::new()
    }
}
