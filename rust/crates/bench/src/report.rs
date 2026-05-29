//! Renders benchmark runs into the §5 per-model metrics table (Markdown + JSON)
//! and writes them to `results/<ts>.{md,json}`.
//!
//! The timestamp used for filenames and the `Generated:` line is injected by the
//! caller so rendering stays deterministic (and testable).

use std::fmt::Write as _;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::recorder::Metrics;
use crate::runner::RunOutcome;

/// One row of the report: every task outcome for a single model, aggregated.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelReport {
    pub model: String,
    pub tasks_total: usize,
    pub tasks_completed: usize,
    pub metrics: Metrics,
}

impl ModelReport {
    /// Aggregate every task outcome for one model into a single report row.
    #[must_use]
    pub fn aggregate(model: impl Into<String>, outcomes: &[RunOutcome]) -> Self {
        let tasks_total = outcomes.len();
        let tasks_completed = outcomes.iter().filter(|outcome| outcome.completed).count();
        let metrics = outcomes.iter().fold(Metrics::default(), |acc, outcome| {
            acc.merged(outcome.metrics)
        });
        Self {
            model: model.into(),
            tasks_total,
            tasks_completed,
            metrics,
        }
    }
}

/// A full benchmark report across all swept models.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchReport {
    pub generated_at: String,
    pub models: Vec<ModelReport>,
}

impl BenchReport {
    #[must_use]
    pub fn new(generated_at: impl Into<String>, models: Vec<ModelReport>) -> Self {
        Self {
            generated_at: generated_at.into(),
            models,
        }
    }

    /// Render the §5 per-model metrics table as Markdown.
    #[must_use]
    pub fn to_markdown(&self) -> String {
        let mut out = String::new();
        out.push_str("# Xolotl bench report\n\n");
        out.push_str("Generated: ");
        out.push_str(&self.generated_at);
        out.push_str("\n\n");
        out.push_str(
            "| Model | Tasks completed | Edit-apply rate | Tool-call parse rate | Edits applied/total | Tool calls |\n",
        );
        out.push_str("|---|---|---|---|---|---|\n");
        for model in &self.models {
            // Writing to a String is infallible.
            let _ = writeln!(
                out,
                "| {} | {}/{} | {} | {} | {}/{} | {} |",
                model.model,
                model.tasks_completed,
                model.tasks_total,
                fmt_rate(model.metrics.edit_apply_rate()),
                fmt_rate(model.metrics.parse_rate()),
                model.metrics.edits_applied,
                model.metrics.edits_total,
                model.metrics.tool_calls,
            );
        }
        out
    }

    /// Render the full report as pretty JSON.
    ///
    /// # Errors
    /// Propagates `serde_json` serialization failures.
    pub fn to_json(&self) -> serde_json::Result<String> {
        serde_json::to_string_pretty(self)
    }

    /// Write `<timestamp>.md` and `<timestamp>.json` into `dir`, returning their
    /// paths.
    ///
    /// # Errors
    /// Returns an error if the directory cannot be created, JSON serialization
    /// fails, or either file cannot be written.
    pub fn write_to(&self, dir: &Path, timestamp: &str) -> io::Result<(PathBuf, PathBuf)> {
        std::fs::create_dir_all(dir)?;
        let md_path = dir.join(format!("{timestamp}.md"));
        let json_path = dir.join(format!("{timestamp}.json"));
        std::fs::write(&md_path, self.to_markdown())?;
        let json = self.to_json().map_err(io::Error::other)?;
        std::fs::write(&json_path, json)?;
        Ok((md_path, json_path))
    }
}

fn fmt_rate(rate: Option<f64>) -> String {
    rate.map_or_else(|| "—".to_string(), |value| format!("{:.1}%", value * 100.0))
}

#[cfg(test)]
mod tests {
    use super::{BenchReport, ModelReport};
    use crate::recorder::Metrics;

    fn sample_report() -> BenchReport {
        BenchReport::new(
            "2026-05-28T00:00:00Z",
            vec![ModelReport {
                model: "sonnet".to_string(),
                tasks_total: 2,
                tasks_completed: 2,
                metrics: Metrics {
                    tool_calls: 20,
                    tool_calls_parsed_ok: 19,
                    edits_total: 10,
                    edits_applied: 9,
                    edits_no_match: 1,
                    edits_error: 0,
                },
            }],
        )
    }

    #[test]
    fn renders_expected_markdown_table() {
        let markdown = sample_report().to_markdown();
        assert!(markdown.contains("# Xolotl bench report"));
        assert!(markdown.contains("Generated: 2026-05-28T00:00:00Z"));
        // 9/10 applied = 90.0%, 19/20 parsed = 95.0%.
        assert!(
            markdown.contains("| sonnet | 2/2 | 90.0% | 95.0% | 9/10 | 20 |"),
            "unexpected row in:\n{markdown}"
        );
    }

    #[test]
    fn empty_rates_render_as_dash() {
        let report = BenchReport::new("ts", vec![ModelReport::aggregate("kimi", &[])]);
        let markdown = report.to_markdown();
        assert!(markdown.contains("| kimi | 0/0 | — | — | 0/0 | 0 |"));
    }

    #[test]
    fn json_round_trips() {
        let report = sample_report();
        let json = report.to_json().expect("serialize");
        let parsed: BenchReport = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed.models.len(), 1);
        assert_eq!(parsed.models[0].model, "sonnet");
        assert_eq!(parsed.models[0].metrics.edits_applied, 9);
    }
}
