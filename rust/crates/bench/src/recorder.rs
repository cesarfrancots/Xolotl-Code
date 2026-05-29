//! Concrete [`runtime::BenchRecorder`] that tallies parse and edit outcomes.
//!
//! Shared across the conversation loop's worker threads as `Arc<CountingRecorder>`,
//! so all counters are atomic. [`CountingRecorder::snapshot`] produces a plain,
//! serializable [`Metrics`] for the reporter.

use std::sync::atomic::{AtomicU64, Ordering};

use runtime::{BenchRecorder, EditOutcome};
use serde::{Deserialize, Serialize};

/// Thread-safe tally of the events a benchmark run produces.
#[derive(Debug, Default)]
pub struct CountingRecorder {
    tool_calls: AtomicU64,
    tool_calls_parsed_ok: AtomicU64,
    edits_total: AtomicU64,
    edits_applied: AtomicU64,
    edits_no_match: AtomicU64,
    edits_error: AtomicU64,
}

impl CountingRecorder {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Take a point-in-time snapshot of the counters.
    #[must_use]
    pub fn snapshot(&self) -> Metrics {
        Metrics {
            tool_calls: self.tool_calls.load(Ordering::Relaxed),
            tool_calls_parsed_ok: self.tool_calls_parsed_ok.load(Ordering::Relaxed),
            edits_total: self.edits_total.load(Ordering::Relaxed),
            edits_applied: self.edits_applied.load(Ordering::Relaxed),
            edits_no_match: self.edits_no_match.load(Ordering::Relaxed),
            edits_error: self.edits_error.load(Ordering::Relaxed),
        }
    }
}

impl BenchRecorder for CountingRecorder {
    fn record_tool_call(&self, _tool_name: &str, _raw_input: &str, parsed_ok: bool) {
        self.tool_calls.fetch_add(1, Ordering::Relaxed);
        if parsed_ok {
            self.tool_calls_parsed_ok.fetch_add(1, Ordering::Relaxed);
        }
    }

    fn record_edit(&self, outcome: EditOutcome, _detail: &str) {
        self.edits_total.fetch_add(1, Ordering::Relaxed);
        let counter = match outcome {
            EditOutcome::Applied => &self.edits_applied,
            EditOutcome::NoMatch => &self.edits_no_match,
            EditOutcome::Error => &self.edits_error,
        };
        counter.fetch_add(1, Ordering::Relaxed);
    }
}

/// A plain, serializable snapshot of a [`CountingRecorder`]'s counters and the
/// rates derived from them (the §5 success-metrics framework).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Metrics {
    pub tool_calls: u64,
    pub tool_calls_parsed_ok: u64,
    pub edits_total: u64,
    pub edits_applied: u64,
    pub edits_no_match: u64,
    pub edits_error: u64,
}

impl Metrics {
    /// Tool-call parse rate (§5): usable-on-first-parse / total tool calls.
    /// `None` when no tool calls were recorded (undefined, not zero).
    #[must_use]
    pub fn parse_rate(&self) -> Option<f64> {
        rate(self.tool_calls_parsed_ok, self.tool_calls)
    }

    /// Edit-apply success rate (§5): applied / total edit calls. `None` when no
    /// edits were attempted.
    #[must_use]
    pub fn edit_apply_rate(&self) -> Option<f64> {
        rate(self.edits_applied, self.edits_total)
    }

    /// Sum two snapshots — used to aggregate per-task metrics into a per-model
    /// total for the report.
    #[must_use]
    pub fn merged(self, other: Self) -> Self {
        Self {
            tool_calls: self.tool_calls + other.tool_calls,
            tool_calls_parsed_ok: self.tool_calls_parsed_ok + other.tool_calls_parsed_ok,
            edits_total: self.edits_total + other.edits_total,
            edits_applied: self.edits_applied + other.edits_applied,
            edits_no_match: self.edits_no_match + other.edits_no_match,
            edits_error: self.edits_error + other.edits_error,
        }
    }
}

#[allow(clippy::cast_precision_loss)]
fn rate(numerator: u64, denominator: u64) -> Option<f64> {
    if denominator == 0 {
        None
    } else {
        Some(numerator as f64 / denominator as f64)
    }
}

#[cfg(test)]
mod tests {
    use super::{CountingRecorder, Metrics};
    use runtime::{BenchRecorder, EditOutcome};

    #[test]
    fn snapshot_tallies_counts_and_rates() {
        let recorder = CountingRecorder::new();
        recorder.record_tool_call("edit_file", "{}", true);
        recorder.record_tool_call("bash", "not json", false);
        recorder.record_edit(EditOutcome::Applied, "applied");
        recorder.record_edit(EditOutcome::NoMatch, "old_string not found in file");

        let metrics = recorder.snapshot();
        assert_eq!(metrics.tool_calls, 2);
        assert_eq!(metrics.tool_calls_parsed_ok, 1);
        assert_eq!(metrics.edits_total, 2);
        assert_eq!(metrics.edits_applied, 1);
        assert_eq!(metrics.edits_no_match, 1);
        assert_eq!(metrics.edits_error, 0);
        assert!((metrics.parse_rate().expect("rate") - 0.5).abs() < 1e-9);
        assert!((metrics.edit_apply_rate().expect("rate") - 0.5).abs() < 1e-9);
    }

    #[test]
    fn empty_metrics_have_undefined_rates() {
        let metrics = Metrics::default();
        assert_eq!(metrics.parse_rate(), None);
        assert_eq!(metrics.edit_apply_rate(), None);
    }

    #[test]
    fn merged_sums_counters() {
        let a = Metrics {
            tool_calls: 3,
            tool_calls_parsed_ok: 2,
            edits_total: 1,
            edits_applied: 1,
            edits_no_match: 0,
            edits_error: 0,
        };
        let b = Metrics {
            tool_calls: 1,
            tool_calls_parsed_ok: 1,
            edits_total: 2,
            edits_applied: 1,
            edits_no_match: 1,
            edits_error: 0,
        };
        let merged = a.merged(b);
        assert_eq!(merged.tool_calls, 4);
        assert_eq!(merged.edits_total, 3);
        assert_eq!(merged.edits_applied, 2);
        assert_eq!(merged.edits_no_match, 1);
    }
}
