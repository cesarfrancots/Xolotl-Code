//! Self-calibrating eval flywheel — Phase 6.2 reliability profiles.
//!
//! Aggregates the per-run reliability records the eval-lab captures (P6.1) into
//! a per-model reliability profile, then persists each profile to
//! `~/.xolotl-code/profiles/<model>.json`.
//!
//! The aggregation is **pure and deterministic** (same records → byte-identical
//! profile) so it is offline-gateable and shared by the desktop app and the CLI.
//! The file-walking writer is tolerant: eval files that don't parse or lack a
//! `reliability_metrics` block are skipped, never fatal.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// One model's reliability metrics from a single eval run.
///
/// Mirrors the `ReliabilityMetrics` the Tauri eval-lab persists, kept as an
/// independent type so `runtime` does not depend on the desktop crate. Every
/// field defaults so older/partial eval files still load.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReliabilityRecord {
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub input_tokens: u32,
    #[serde(default)]
    pub output_tokens: u32,
    #[serde(default)]
    pub duration_ms: u64,
    #[serde(default)]
    pub tokens_per_sec: f64,
    #[serde(default)]
    pub cost_usd: f64,
    #[serde(default)]
    pub cost_known: bool,
    #[serde(default)]
    pub estimated_output_tokens: u32,
    #[serde(default)]
    pub token_count_error: f64,
    #[serde(default)]
    pub reasoning_chars: u32,
    #[serde(default)]
    pub had_error: bool,
}

/// Aggregate reliability profile for one model, computed from many runs.
///
/// Means are taken over *successful* runs only (a provider error yields zero
/// tokens/duration and would otherwise skew throughput and calibration). Cost
/// is summed across all runs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct ReliabilityProfile {
    pub model: String,
    /// Total runs aggregated (successful + errored).
    pub runs: u32,
    /// Runs that did not return a provider error.
    pub successful_runs: u32,
    /// Fraction of runs that returned a provider error (0.0–1.0).
    pub error_rate: f64,
    /// Mean output throughput over successful runs (tok/s).
    pub mean_tokens_per_sec: f64,
    /// Mean relative token-count error over successful runs (0.0+).
    pub mean_token_count_error: f64,
    /// Fraction of successful runs whose token-count error ≤ 5% (the §5 target).
    pub token_calibration_rate: f64,
    /// True only if every aggregated run had verified pricing.
    pub cost_known: bool,
    /// Total computed dollar cost across all aggregated runs.
    pub total_cost_usd: f64,
    /// Mean reported output tokens over successful runs.
    pub mean_output_tokens: f64,
    /// Mean reasoning-trace length (chars) over successful runs.
    pub mean_reasoning_chars: f64,
}

/// §5 token-count-error target: a run is "calibrated" when the estimate is
/// within 5% of the provider-reported output.
const TOKEN_CALIBRATION_THRESHOLD: f64 = 0.05;

/// Lossless `usize` → `f64` for small counts (eval-run counts never approach
/// `u32::MAX`); avoids the precision-loss lint on a direct `as` cast.
fn count_to_f64(n: usize) -> f64 {
    f64::from(u32::try_from(n).unwrap_or(u32::MAX))
}

/// Aggregate a model's reliability records into a single profile.
///
/// Pure and deterministic. An empty slice yields a zeroed profile (`runs = 0`).
#[must_use]
pub fn aggregate_profile(model: &str, records: &[ReliabilityRecord]) -> ReliabilityProfile {
    let runs = records.len();
    let successful: Vec<&ReliabilityRecord> = records.iter().filter(|r| !r.had_error).collect();
    let succ = successful.len();
    let errored = runs - succ;

    let total_cost_usd: f64 = records.iter().map(|r| r.cost_usd).sum();
    let cost_known = runs > 0 && records.iter().all(|r| r.cost_known);

    let error_rate = if runs > 0 {
        count_to_f64(errored) / count_to_f64(runs)
    } else {
        0.0
    };

    // Means over successful runs; 0.0 when there are none.
    let mean = |sum: f64| {
        if succ > 0 {
            sum / count_to_f64(succ)
        } else {
            0.0
        }
    };

    let mean_tokens_per_sec = mean(successful.iter().map(|r| r.tokens_per_sec).sum());
    let mean_token_count_error = mean(successful.iter().map(|r| r.token_count_error).sum());
    let mean_output_tokens = mean(successful.iter().map(|r| f64::from(r.output_tokens)).sum());
    let mean_reasoning_chars = mean(
        successful
            .iter()
            .map(|r| f64::from(r.reasoning_chars))
            .sum(),
    );

    let calibrated = successful
        .iter()
        .filter(|r| r.token_count_error <= TOKEN_CALIBRATION_THRESHOLD)
        .count();
    let token_calibration_rate = if succ > 0 {
        count_to_f64(calibrated) / count_to_f64(succ)
    } else {
        0.0
    };

    ReliabilityProfile {
        model: model.to_string(),
        runs: u32::try_from(runs).unwrap_or(u32::MAX),
        successful_runs: u32::try_from(succ).unwrap_or(u32::MAX),
        error_rate,
        mean_tokens_per_sec,
        mean_token_count_error,
        token_calibration_rate,
        cost_known,
        total_cost_usd,
        mean_output_tokens,
        mean_reasoning_chars,
    }
}

/// Summary of a profile-build pass.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileBuildSummary {
    /// Distinct models that got a profile written.
    pub models: u32,
    /// Total per-model records read across all eval files.
    pub records: u32,
    /// Eval files that contributed at least one reliability record.
    pub evals_scanned: u32,
}

/// Make a model id safe to use as a file stem (bedrock ids contain `/`, `:`, …).
pub(crate) fn sanitize_model_filename(model: &str) -> String {
    let cleaned: String = model
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "unknown".to_string()
    } else {
        cleaned
    }
}

/// Extract the per-model reliability records from one eval file's JSON.
///
/// Returns an empty vec for files without a `reliability_metrics` object. The
/// map key is authoritative for the model id (a record's own `model` may be
/// blank in hand-written fixtures).
fn records_from_eval_json(value: &serde_json::Value) -> Vec<ReliabilityRecord> {
    let Some(map) = value.get("reliability_metrics").and_then(|v| v.as_object()) else {
        return Vec::new();
    };
    map.iter()
        .filter_map(|(model, metric)| {
            serde_json::from_value::<ReliabilityRecord>(metric.clone())
                .ok()
                .map(|mut record| {
                    if record.model.is_empty() {
                        record.model.clone_from(model);
                    }
                    record
                })
        })
        .collect()
}

/// Scan an eval directory, aggregate per-model reliability profiles, and write
/// each to `profiles_dir/<model>.json`.
///
/// Tolerant: unreadable / non-JSON / field-less eval files are skipped. Returns
/// what was produced. Records are grouped in a `BTreeMap` so the set of profiles
/// written is deterministic regardless of directory iteration order.
///
/// # Errors
/// Returns an error only if `profiles_dir` cannot be created or a profile file
/// cannot be written.
pub fn build_profiles_from_dir(
    evals_dir: &Path,
    profiles_dir: &Path,
) -> std::io::Result<ProfileBuildSummary> {
    let mut by_model: BTreeMap<String, Vec<ReliabilityRecord>> = BTreeMap::new();
    let mut evals_scanned: u32 = 0;

    if let Ok(entries) = std::fs::read_dir(evals_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
                continue;
            };
            let records = records_from_eval_json(&value);
            if records.is_empty() {
                continue;
            }
            evals_scanned = evals_scanned.saturating_add(1);
            for record in records {
                by_model
                    .entry(record.model.clone())
                    .or_default()
                    .push(record);
            }
        }
    }

    let total_records: usize = by_model.values().map(Vec::len).sum();

    if !by_model.is_empty() {
        std::fs::create_dir_all(profiles_dir)?;
        for (model, records) in &by_model {
            let profile = aggregate_profile(model, records);
            let json = serde_json::to_string_pretty(&profile)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
            let file = profiles_dir.join(format!("{}.json", sanitize_model_filename(model)));
            std::fs::write(file, json)?;
        }
    }

    Ok(ProfileBuildSummary {
        models: u32::try_from(by_model.len()).unwrap_or(u32::MAX),
        records: u32::try_from(total_records).unwrap_or(u32::MAX),
        evals_scanned,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        aggregate_profile, build_profiles_from_dir, sanitize_model_filename, ReliabilityProfile,
        ReliabilityRecord,
    };

    fn record(
        model: &str,
        out: u32,
        tps: f64,
        err: f64,
        cost: f64,
        known: bool,
    ) -> ReliabilityRecord {
        ReliabilityRecord {
            model: model.to_string(),
            input_tokens: 100,
            output_tokens: out,
            duration_ms: 1000,
            tokens_per_sec: tps,
            cost_usd: cost,
            cost_known: known,
            estimated_output_tokens: out,
            token_count_error: err,
            reasoning_chars: 0,
            had_error: false,
        }
    }

    #[test]
    fn empty_records_yield_zeroed_profile() {
        let p = aggregate_profile("kimi", &[]);
        assert_eq!(p.runs, 0);
        assert_eq!(p.successful_runs, 0);
        assert_eq!(p.error_rate, 0.0);
        assert_eq!(p.mean_tokens_per_sec, 0.0);
        assert_eq!(p.token_calibration_rate, 0.0);
        assert!(!p.cost_known);
        assert_eq!(p.total_cost_usd, 0.0);
    }

    #[test]
    fn aggregates_means_over_successful_runs_only() {
        let mut errored = record("sonnet", 0, 0.0, 0.0, 0.0, true);
        errored.had_error = true;
        let records = vec![
            record("sonnet", 100, 200.0, 0.02, 0.01, true), // calibrated
            record("sonnet", 300, 100.0, 0.20, 0.03, true), // miscalibrated
            errored,                                        // skipped from means
        ];
        let p = aggregate_profile("sonnet", &records);
        assert_eq!(p.runs, 3);
        assert_eq!(p.successful_runs, 2);
        assert!((p.error_rate - (1.0 / 3.0)).abs() < 1e-9);
        // Means over the 2 successful runs.
        assert!((p.mean_tokens_per_sec - 150.0).abs() < 1e-9);
        assert!((p.mean_output_tokens - 200.0).abs() < 1e-9);
        assert!((p.mean_token_count_error - 0.11).abs() < 1e-9);
        // 1 of 2 successful runs within 5% error.
        assert!((p.token_calibration_rate - 0.5).abs() < 1e-9);
        // Cost sums ALL runs (errored run contributed 0).
        assert!((p.total_cost_usd - 0.04).abs() < 1e-9);
        assert!(p.cost_known);
    }

    #[test]
    fn cost_known_is_false_if_any_run_unpriced() {
        let records = vec![
            record("kimi", 100, 50.0, 0.0, 0.0, false),
            record("kimi", 120, 60.0, 0.0, 0.0, true),
        ];
        let p = aggregate_profile("kimi", &records);
        assert!(
            !p.cost_known,
            "one unpriced run must make the profile unpriced"
        );
    }

    #[test]
    fn aggregation_is_deterministic() {
        let records = vec![
            record("glm", 100, 80.0, 0.03, 0.0, false),
            record("glm", 140, 90.0, 0.07, 0.0, false),
        ];
        let a = aggregate_profile("glm", &records);
        let b = aggregate_profile("glm", &records);
        assert_eq!(a, b, "same records must produce an identical profile");
    }

    #[test]
    fn sanitizes_model_filenames() {
        assert_eq!(
            sanitize_model_filename("claude-sonnet-4-6"),
            "claude-sonnet-4-6"
        );
        assert_eq!(
            sanitize_model_filename("bedrock/us.anthropic.claude-sonnet"),
            "bedrock_us.anthropic.claude-sonnet"
        );
        assert_eq!(sanitize_model_filename("kimi:turbo"), "kimi_turbo");
        assert_eq!(sanitize_model_filename(""), "unknown");
    }

    #[test]
    fn builds_profiles_from_eval_files_and_skips_garbage() {
        let dir = tempfile::tempdir().expect("tempdir");
        let evals = dir.path().join("evals");
        let profiles = dir.path().join("profiles");
        std::fs::create_dir_all(&evals).unwrap();

        // Two real eval files, each with two models.
        std::fs::write(
            evals.join("e1.json"),
            r#"{
                "id": "e1",
                "reliability_metrics": {
                    "sonnet": { "model": "sonnet", "output_tokens": 100, "tokens_per_sec": 200.0, "token_count_error": 0.02, "cost_usd": 0.01, "cost_known": true },
                    "kimi":   { "model": "kimi",   "output_tokens": 80,  "tokens_per_sec": 50.0,  "token_count_error": 0.30, "cost_usd": 0.0,  "cost_known": false }
                }
            }"#,
        )
        .unwrap();
        std::fs::write(
            evals.join("e2.json"),
            r#"{
                "id": "e2",
                "reliability_metrics": {
                    "sonnet": { "model": "sonnet", "output_tokens": 120, "tokens_per_sec": 220.0, "token_count_error": 0.04, "cost_usd": 0.012, "cost_known": true }
                }
            }"#,
        )
        .unwrap();
        // Garbage / irrelevant files that must be skipped, not fatal.
        std::fs::write(evals.join("broken.json"), "{ not valid json").unwrap();
        std::fs::write(evals.join("old.json"), r#"{"id":"old","prompt":"hi"}"#).unwrap();
        std::fs::write(evals.join("notes.txt"), "ignore me").unwrap();

        let summary = build_profiles_from_dir(&evals, &profiles).expect("build ok");
        assert_eq!(summary.models, 2, "sonnet + kimi");
        assert_eq!(summary.records, 3, "two sonnet + one kimi record");
        assert_eq!(summary.evals_scanned, 2, "only the two files with metrics");

        let sonnet: ReliabilityProfile =
            serde_json::from_str(&std::fs::read_to_string(profiles.join("sonnet.json")).unwrap())
                .unwrap();
        assert_eq!(sonnet.runs, 2);
        assert!(sonnet.cost_known);
        assert!((sonnet.total_cost_usd - 0.022).abs() < 1e-9);

        let kimi: ReliabilityProfile =
            serde_json::from_str(&std::fs::read_to_string(profiles.join("kimi.json")).unwrap())
                .unwrap();
        assert_eq!(kimi.runs, 1);
        assert!(!kimi.cost_known);
    }
}
