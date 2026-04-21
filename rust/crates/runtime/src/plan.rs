use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::todo::{TodoItem, TodoPriority, TodoStatus};

// ── Risk Assessment Types ─────────────────────────────────────────────────────

/// Risk level for a task, phase, or the overall plan.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    #[default]
    Low,
    Medium,
    High,
    Critical,
}

impl RiskLevel {
    /// Return a numeric score for the risk level (higher = more risky).
    #[must_use]
    pub fn score(&self) -> u8 {
        match self {
            RiskLevel::Low => 1,
            RiskLevel::Medium => 2,
            RiskLevel::High => 3,
            RiskLevel::Critical => 4,
        }
    }

    /// Return a display label for the risk level.
    #[must_use]
    pub fn label(&self) -> &'static str {
        match self {
            RiskLevel::Low => "Low",
            RiskLevel::Medium => "Medium",
            RiskLevel::High => "High",
            RiskLevel::Critical => "Critical",
        }
    }
}

// ── Milestone Types ───────────────────────────────────────────────────────────

/// A milestone marks the completion of a significant phase or group of phases.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanMilestone {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The phase index at which this milestone is reached (0-based).
    pub phase_index: usize,
    /// Criteria that must be met for this milestone to be considered complete.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub criteria: Option<String>,
}

// ── Rollback Types ────────────────────────────────────────────────────────────

/// A rollback point identifies a safe state to revert to if execution fails.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RollbackPoint {
    pub task_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Files or state snapshots to preserve for rollback.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preserve: Option<Vec<String>>,
}

// ── Parallelization Types ─────────────────────────────────────────────────────

/// Analysis of which tasks can be executed in parallel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParallelizationAnalysis {
    /// Groups of task IDs that can be executed in parallel within a phase.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parallel_groups: Option<Vec<Vec<String>>>,
    /// Overall assessment of how much of the plan can be parallelized.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assessment: Option<String>,
}

// ── Risk Assessment ───────────────────────────────────────────────────────────

/// Overall risk assessment for the plan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskAssessment {
    pub overall_risk: RiskLevel,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// Key risks identified in the plan.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_risks: Option<Vec<String>>,
    /// Mitigation strategies for identified risks.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mitigations: Option<Vec<String>>,
}

// ── Core Plan Types ───────────────────────────────────────────────────────────

/// A single task within a plan phase.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanTask {
    /// Unique identifier for this task (used for dependency tracking).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_input: Option<serde_json::Value>,
    /// IDs of tasks that must complete before this task can start.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dependencies: Option<Vec<String>>,
    /// Risk level for this specific task.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub risk: Option<RiskLevel>,
    /// Whether this task can be executed in parallel with other tasks in the same phase.
    #[serde(default = "default_parallelizable")]
    pub parallelizable: bool,
    /// Estimated effort (e.g., "5 min", "1 hour", "complex").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_effort: Option<String>,
    /// Whether this task serves as a safe rollback point.
    #[serde(default)]
    pub rollback_point: bool,
}

fn default_parallelizable() -> bool {
    false
}

/// A phase in an implementation plan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanPhase {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub tasks: Vec<PlanTask>,
    /// Milestone associated with completing this phase.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub milestone: Option<String>,
    /// Risk level for this phase.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub risk: Option<RiskLevel>,
    /// Whether tasks in this phase can generally be parallelized.
    #[serde(default = "default_parallelizable")]
    pub parallelizable: bool,
}

/// A structured implementation plan generated by the planner model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanArtifact {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Schema version for forward compatibility.
    #[serde(default = "default_version")]
    pub version: String,
    pub phases: Vec<PlanPhase>,
    /// Explicit milestones for the plan.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub milestones: Option<Vec<PlanMilestone>>,
    /// Rollback points for safe recovery.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rollback_points: Option<Vec<RollbackPoint>>,
    /// Overall risk assessment.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub risk_assessment: Option<RiskAssessment>,
    /// Parallelization analysis.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parallelization_analysis: Option<ParallelizationAnalysis>,
}

fn default_version() -> String {
    "2.0".to_string()
}

impl PlanArtifact {
    /// Convert the plan into todo items for tracking progress.
    ///
    /// Includes dependency info, risk, and effort estimates in todo content.
    #[must_use]
    pub fn to_todos(&self) -> Vec<TodoItem> {
        let mut todos = Vec::new();
        for (phase_idx, phase) in self.phases.iter().enumerate() {
            for (task_idx, task) in phase.tasks.iter().enumerate() {
                let task_id = task
                    .id
                    .clone()
                    .unwrap_or_else(|| format!("plan-{phase_idx}-{task_idx}"));

                // Build rich content with metadata
                let mut content = format!("[{}] {}", phase.name, task.description);

                if let Some(ref deps) = task.dependencies {
                    if !deps.is_empty() {
                        content.push_str(&format!(" [deps: {}]", deps.join(", ")));
                    }
                }

                if let Some(ref risk) = task.risk {
                    content.push_str(&format!(" [risk: {}]", risk.label()));
                }

                if let Some(ref effort) = task.estimated_effort {
                    content.push_str(&format!(" [effort: {effort}]"));
                }

                if task.rollback_point {
                    content.push_str(" [rollback]");
                }

                todos.push(TodoItem {
                    id: task_id,
                    content,
                    status: TodoStatus::Pending,
                    priority: match task.risk {
                        Some(RiskLevel::Critical) | Some(RiskLevel::High) => TodoPriority::High,
                        Some(RiskLevel::Medium) => TodoPriority::Medium,
                        _ => TodoPriority::Low,
                    },
                });
            }
        }
        todos
    }

    /// Count total tasks across all phases.
    #[must_use]
    pub fn total_tasks(&self) -> usize {
        self.phases.iter().map(|p| p.tasks.len()).sum()
    }

    /// Count completed tasks (those not pending) based on todo status.
    #[must_use]
    pub fn completed_tasks(&self, todos: &[TodoItem]) -> usize {
        todos
            .iter()
            .filter(|t| t.status != TodoStatus::Pending && t.status != TodoStatus::InProgress)
            .count()
    }

    /// Get all rollback points in the plan.
    #[must_use]
    pub fn rollback_tasks(&self) -> Vec<&PlanTask> {
        let mut rollback_tasks = Vec::new();
        for phase in &self.phases {
            for task in &phase.tasks {
                if task.rollback_point {
                    rollback_tasks.push(task);
                }
            }
        }
        rollback_tasks
    }

    /// Get the overall risk score for the plan (0-100, higher = riskier).
    #[must_use]
    pub fn overall_risk_score(&self) -> u8 {
        if let Some(ref assessment) = self.risk_assessment {
            return assessment.overall_risk.score() * 25;
        }

        // Calculate average risk from phases and tasks
        let mut total_score = 0u32;
        let mut count = 0u32;

        for phase in &self.phases {
            if let Some(ref risk) = phase.risk {
                total_score += u32::from(risk.score());
                count += 1;
            }
            for task in &phase.tasks {
                if let Some(ref risk) = task.risk {
                    total_score += u32::from(risk.score());
                    count += 1;
                }
            }
        }

        if count == 0 {
            return 25; // Default: low risk
        }

        ((total_score / count) * 25) as u8
    }

    /// Get tasks that are ready to execute (all dependencies met).
    #[must_use]
    pub fn ready_tasks(&self, completed_ids: &[String]) -> Vec<&PlanTask> {
        let mut ready = Vec::new();
        for phase in &self.phases {
            for task in &phase.tasks {
                let task_id = task.id.as_deref().unwrap_or("");
                if task_id.is_empty() {
                    continue;
                }
                let deps_met = match &task.dependencies {
                    None => true,
                    Some(deps) => deps.iter().all(|dep| completed_ids.contains(dep)),
                };
                if deps_met && !completed_ids.contains(&task_id.to_string()) {
                    ready.push(task);
                }
            }
        }
        ready
    }

    /// Save the plan to a JSON file.
    pub fn save(&self, path: &Path) -> Result<(), std::io::Error> {
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        std::fs::write(path, json)
    }

    /// Load a plan from a JSON file.
    pub fn load(path: &Path) -> Result<Self, std::io::Error> {
        let json = std::fs::read_to_string(path)?;
        serde_json::from_str(&json)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
    }
}

// ── JSON Extraction ───────────────────────────────────────────────────────────

/// Extract JSON from a markdown code block in assistant text.
#[must_use]
pub fn extract_json_from_response(text: &str) -> Option<String> {
    // Look for ```json ... ``` block
    if let Some(start) = text.find("```json") {
        let after_start = &text[start + 7..];
        if let Some(end) = after_start.find("```") {
            return Some(after_start[..end].trim().to_string());
        }
    }
    // Fallback: look for ``` ... ``` block
    if let Some(start) = text.find("```") {
        let after_start = &text[start + 3..];
        if let Some(end) = after_start.find("```") {
            return Some(after_start[..end].trim().to_string());
        }
    }
    // Fallback: try to find JSON object directly
    if let Some(start) = text.find('{') {
        if let Some(end) = text.rfind('}') {
            if end > start {
                return Some(text[start..=end].to_string());
            }
        }
    }
    None
}

// ── Prompt Builders ───────────────────────────────────────────────────────────

/// Build the planning prompt that asks the model to generate a structured plan.
#[must_use]
pub fn build_plan_prompt(description: &str) -> String {
    format!(
        r#"You are an expert software architect and planner. Create a detailed implementation plan for the following task.

Task: {description}

Output your plan as a single JSON object inside a ```json code block. Use this exact structure:

{{
  "title": "Short title for the plan",
  "description": "One-sentence summary of the overall approach",
  "version": "2.0",
  "phases": [
    {{
      "name": "Phase 1: Research and Analysis",
      "description": "What this phase accomplishes",
      "risk": "low",
      "parallelizable": false,
      "milestone": "Research complete — all files understood",
      "tasks": [
        {{
          "id": "p1-t1",
          "description": "Specific actionable task description",
          "tool": "optional_tool_name like read_file or bash",
          "tool_input": {{}},
          "dependencies": [],
          "risk": "low",
          "parallelizable": false,
          "estimated_effort": "5 min",
          "rollback_point": false
        }}
      ]
    }}
  ],
  "milestones": [
    {{
      "name": "Research Milestone",
      "description": "All relevant files have been read and understood",
      "phase_index": 0,
      "criteria": "All target files read and their structure documented"
    }}
  ],
  "rollback_points": [
    {{
      "task_id": "p1-t1",
      "description": "Before modifying files",
      "preserve": ["original_file.rs"]
    }}
  ],
  "risk_assessment": {{
    "overall_risk": "low",
    "summary": "Straightforward refactoring with good test coverage",
    "key_risks": ["Risk 1", "Risk 2"],
    "mitigations": ["Mitigation 1", "Mitigation 2"]
  }},
  "parallelization_analysis": {{
    "parallel_groups": [["p2-t1", "p2-t2"]],
    "assessment": "Tasks in phase 2 can be done in parallel after phase 1 completes"
  }}
}}

Guidelines:
- Break the work into 2-5 phases
- Each phase should have 1-5 specific tasks
- Assign unique IDs to each task (e.g., "p1-t1", "p1-t2")
- Tasks should be actionable and concrete
- Only include "tool" and "tool_input" when you know the exact tool and parameters
- Use "dependencies" to specify task ordering when tasks depend on each other
- Use "risk" (low/medium/high/critical) to flag risky tasks
- Set "parallelizable": true for tasks that can run in parallel with others in the same phase
- Set "rollback_point": true for tasks that represent a safe state to revert to
- Include estimated_effort for each task (e.g., "5 min", "30 min", "1 hour", "complex")
- Define milestones at key completion points
- Identify rollback points before destructive operations
- Assess overall risk and provide mitigations
- Analyze parallelization opportunities
- Do NOT use any tools — just return the JSON plan
- Ensure the JSON is valid and parseable
- Focus on code changes, file operations, and verification steps"#
    )
}

/// Build an ultra-planning prompt that asks for deeper analysis.
#[must_use]
pub fn build_ultra_plan_prompt(description: &str, context: Option<&str>) -> String {
    let context_section = context.map_or_else(
        String::new,
        |c| format!("\n## Additional Context\n{c}\n"),
    );

    format!(
        r#"You are an elite software architect and systems planner. Create a comprehensive ultra-plan for the following complex task.

Task: {description}{context_section}

## Ultra-Plan Requirements

This plan must include:

1. **Deep Dependency Analysis** — Map all task dependencies explicitly. Identify critical path tasks.
2. **Risk Assessment** — Evaluate each task and phase for risk (low/medium/high/critical). Identify failure modes.
3. **Parallelization Opportunities** — Identify which tasks can execute in parallel and which must be sequential.
4. **Milestones** — Define clear milestones with completion criteria.
5. **Rollback Points** — Identify safe rollback points before destructive operations.
6. **Effort Estimation** — Estimate effort for each task.
7. **Resource Requirements** — Note any special tools, files, or knowledge needed.

Output your plan as a single JSON object inside a ```json code block. Use the expanded schema from the standard plan prompt with all optional fields populated.

Guidelines:
- Be exhaustive — break complex tasks into smaller, verifiable steps
- Identify the critical path through the dependency graph
- Flag high-risk tasks with mitigations
- Define rollback points before any destructive file edits
- Estimate effort realistically
- Consider model-specific capabilities (thinking, tool use, context limits)
- Do NOT use any tools — just return the JSON plan
- Ensure the JSON is valid and parseable"#
    )
}

// ── Formatting ────────────────────────────────────────────────────────────────

/// Build a concise plan summary for display.
#[must_use]
pub fn format_plan_summary(plan: &PlanArtifact) -> String {
    let mut lines = vec![format!("## Plan: {}\n", plan.title)];
    if let Some(ref desc) = plan.description {
        lines.push(format!("{desc}\n"));
    }

    // Risk summary
    if let Some(ref risk) = plan.risk_assessment {
        lines.push(format!(
            "**Overall Risk:** {} ({}/100)\n",
            risk.overall_risk.label(),
            plan.overall_risk_score()
        ));
    }

    for (i, phase) in plan.phases.iter().enumerate() {
        lines.push(format!("\n**Phase {}: {}**", i + 1, phase.name));
        if let Some(ref desc) = phase.description {
            lines.push(format!("  {desc}"));
        }
        if let Some(ref risk) = phase.risk {
            lines.push(format!("  Risk: {}", risk.label()));
        }
        if let Some(ref milestone) = phase.milestone {
            lines.push(format!("  Milestone: {milestone}"));
        }
        for (j, task) in phase.tasks.iter().enumerate() {
            let task_id = task.id.as_deref().unwrap_or("");
            let tool_hint = task
                .tool
                .as_ref()
                .map(|t| format!(" (`{t}`)"))
                .unwrap_or_default();
            let risk_hint = task
                .risk
                .as_ref()
                .map(|r| format!(" [{r}]", r = r.label()))
                .unwrap_or_default();
            let effort_hint = task
                .estimated_effort
                .as_ref()
                .map(|e| format!(" ({e})"))
                .unwrap_or_default();
            let rollback_hint = if task.rollback_point {
                " [rollback]"
            } else {
                ""
            };
            lines.push(format!(
                "  {task_id} {j}. {}{}{}{}{}",
                task.description, tool_hint, risk_hint, effort_hint, rollback_hint
            ));
            if let Some(ref deps) = task.dependencies {
                if !deps.is_empty() {
                    lines.push(format!("    → depends on: {}", deps.join(", ")));
                }
            }
        }
    }

    // Milestones summary
    if let Some(ref milestones) = plan.milestones {
        lines.push("\n**Milestones:**".to_string());
        for m in milestones {
            lines.push(format!("  • {} (after phase {})", m.name, m.phase_index + 1));
        }
    }

    // Rollback points
    let rollback_tasks = plan.rollback_tasks();
    if !rollback_tasks.is_empty() {
        lines.push("\n**Rollback Points:**".to_string());
        for task in rollback_tasks {
            let id = task.id.as_deref().unwrap_or("?");
            lines.push(format!("  • {id}: {}", task.description));
        }
    }

    lines.push(format!(
        "\n*Total: {} tasks in {} phases*",
        plan.total_tasks(),
        plan.phases.len()
    ));
    lines.join("\n")
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_json_from_markdown_block() {
        let text = r#"Here is the plan:

```json
{"title": "Test", "phases": []}
```

Hope this helps!"#;
        let json = extract_json_from_response(text).unwrap();
        assert!(json.contains("\"title\": \"Test\""));
    }

    #[test]
    fn extracts_json_without_language_tag() {
        let text = r#"```
{"title": "Test", "phases": []}
```"#;
        let json = extract_json_from_response(text).unwrap();
        assert!(json.contains("\"title\": \"Test\""));
    }

    #[test]
    fn extracts_bare_json() {
        let text = r#"Some text before {"title": "Test", "phases": []} and after"#;
        let json = extract_json_from_response(text).unwrap();
        assert!(json.contains("\"title\": \"Test\""));
    }

    #[test]
    fn plan_to_todos_conversion() {
        let plan = PlanArtifact {
            title: "Fix bug".to_string(),
            description: None,
            version: "2.0".to_string(),
            phases: vec![
                PlanPhase {
                    name: "Research".to_string(),
                    description: None,
                    tasks: vec![PlanTask {
                        id: Some("p1-t1".to_string()),
                        description: "Read source file".to_string(),
                        tool: Some("read_file".to_string()),
                        tool_input: None,
                        dependencies: None,
                        risk: Some(RiskLevel::Low),
                        parallelizable: false,
                        estimated_effort: Some("5 min".to_string()),
                        rollback_point: false,
                    }],
                    milestone: None,
                    risk: None,
                    parallelizable: false,
                },
                PlanPhase {
                    name: "Fix".to_string(),
                    description: None,
                    tasks: vec![PlanTask {
                        id: Some("p2-t1".to_string()),
                        description: "Edit file".to_string(),
                        tool: Some("edit_file".to_string()),
                        tool_input: None,
                        dependencies: Some(vec!["p1-t1".to_string()]),
                        risk: Some(RiskLevel::High),
                        parallelizable: false,
                        estimated_effort: Some("15 min".to_string()),
                        rollback_point: true,
                    }],
                    milestone: Some("Fix complete".to_string()),
                    risk: Some(RiskLevel::Medium),
                    parallelizable: false,
                },
            ],
            milestones: None,
            rollback_points: None,
            risk_assessment: None,
            parallelization_analysis: None,
        };
        let todos = plan.to_todos();
        assert_eq!(todos.len(), 2);
        assert_eq!(todos[0].content, "[Research] Read source file [risk: Low] [effort: 5 min]");
        assert_eq!(todos[0].status, TodoStatus::Pending);
        assert_eq!(todos[0].priority, TodoPriority::Low);
        assert_eq!(
            todos[1].content,
            "[Fix] Edit file [deps: p1-t1] [risk: High] [effort: 15 min] [rollback]"
        );
        assert_eq!(todos[1].priority, TodoPriority::High);
    }

    #[test]
    fn plan_with_risk_assessment() {
        let plan = PlanArtifact {
            title: "Risky refactor".to_string(),
            description: None,
            version: "2.0".to_string(),
            phases: vec![PlanPhase {
                name: "Phase 1".to_string(),
                description: None,
                tasks: vec![PlanTask {
                    id: Some("p1-t1".to_string()),
                    description: "Task".to_string(),
                    tool: None,
                    tool_input: None,
                    dependencies: None,
                    risk: Some(RiskLevel::Critical),
                    parallelizable: false,
                    estimated_effort: None,
                    rollback_point: false,
                }],
                milestone: None,
                risk: None,
                parallelizable: false,
            }],
            milestones: None,
            rollback_points: None,
            risk_assessment: Some(RiskAssessment {
                overall_risk: RiskLevel::High,
                summary: Some("High risk due to core changes".to_string()),
                key_risks: Some(vec!["Breaking API changes".to_string()]),
                mitigations: Some(vec!["Comprehensive tests".to_string()]),
            }),
            parallelization_analysis: None,
        };

        assert_eq!(plan.overall_risk_score(), 75); // High = 3 * 25
        assert_eq!(plan.rollback_tasks().len(), 0);
    }

    #[test]
    fn ready_tasks_with_dependencies() {
        let plan = PlanArtifact {
            title: "Deps test".to_string(),
            description: None,
            version: "2.0".to_string(),
            phases: vec![PlanPhase {
                name: "Phase 1".to_string(),
                description: None,
                tasks: vec![
                    PlanTask {
                        id: Some("t1".to_string()),
                        description: "First".to_string(),
                        tool: None,
                        tool_input: None,
                        dependencies: None,
                        risk: None,
                        parallelizable: false,
                        estimated_effort: None,
                        rollback_point: false,
                    },
                    PlanTask {
                        id: Some("t2".to_string()),
                        description: "Second".to_string(),
                        tool: None,
                        tool_input: None,
                        dependencies: Some(vec!["t1".to_string()]),
                        risk: None,
                        parallelizable: false,
                        estimated_effort: None,
                        rollback_point: false,
                    },
                ],
                milestone: None,
                risk: None,
                parallelizable: false,
            }],
            milestones: None,
            rollback_points: None,
            risk_assessment: None,
            parallelization_analysis: None,
        };

        let ready = plan.ready_tasks(&[]);
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].id, Some("t1".to_string()));

        let ready = plan.ready_tasks(&["t1".to_string()]);
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].id, Some("t2".to_string()));
    }

    #[test]
    fn plan_save_and_load() {
        let plan = PlanArtifact {
            title: "Test".to_string(),
            description: Some("Description".to_string()),
            version: "2.0".to_string(),
            phases: vec![PlanPhase {
                name: "Phase".to_string(),
                description: None,
                tasks: vec![PlanTask {
                    id: Some("p1-t1".to_string()),
                    description: "Task".to_string(),
                    tool: None,
                    tool_input: None,
                    dependencies: None,
                    risk: Some(RiskLevel::Medium),
                    parallelizable: true,
                    estimated_effort: Some("10 min".to_string()),
                    rollback_point: true,
                }],
                milestone: Some("Milestone".to_string()),
                risk: Some(RiskLevel::Low),
                parallelizable: false,
            }],
            milestones: Some(vec![PlanMilestone {
                name: "M1".to_string(),
                description: Some("Desc".to_string()),
                phase_index: 0,
                criteria: Some("Done".to_string()),
            }]),
            rollback_points: Some(vec![RollbackPoint {
                task_id: "p1-t1".to_string(),
                description: Some("Before change".to_string()),
                preserve: Some(vec!["file.rs".to_string()]),
            }]),
            risk_assessment: Some(RiskAssessment {
                overall_risk: RiskLevel::Low,
                summary: Some("Low risk".to_string()),
                key_risks: None,
                mitigations: None,
            }),
            parallelization_analysis: Some(ParallelizationAnalysis {
                parallel_groups: Some(vec![vec!["p1-t1".to_string()]]),
                assessment: Some("Can parallelize".to_string()),
            }),
        };

        let temp_file = std::env::temp_dir().join("test-plan.json");
        plan.save(&temp_file).unwrap();
        let loaded = PlanArtifact::load(&temp_file).unwrap();

        assert_eq!(loaded.title, plan.title);
        assert_eq!(loaded.version, "2.0");
        assert_eq!(loaded.phases.len(), 1);
        assert_eq!(loaded.phases[0].tasks[0].risk, Some(RiskLevel::Medium));
        assert!(loaded.phases[0].tasks[0].parallelizable);
        assert_eq!(loaded.milestones.as_ref().unwrap().len(), 1);
        assert_eq!(
            loaded.rollback_points.as_ref().unwrap()[0].task_id,
            "p1-t1"
        );

        std::fs::remove_file(&temp_file).unwrap();
    }
}
