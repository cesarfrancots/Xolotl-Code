//! Self-calibrating eval flywheel — Phase 6.3 hint tuning (propose-only).
//!
//! Turns a per-model [`ReliabilityProfile`] (P6.2) into a set of *proposed*
//! `ModelHints` overrides, written to a reviewable file under
//! `~/.xolotl-code/profiles/proposals/<model>.json`.
//!
//! **Propose-only by design.** Nothing here mutates the shipped `model_hints.rs`
//! defaults — a human ratifies each proposal. The mapping is deterministic
//! (same profile + same current hints → byte-identical proposal) so it is
//! offline-gateable and never surprises the reviewer.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::model_hints::ModelHints;
use crate::reliability_profile::{sanitize_model_filename, ReliabilityProfile};

/// Below this many successful runs a profile is too thin to propose changes;
/// we still emit a (empty) proposal documenting the insufficient sample.
const MIN_RUNS_FOR_PROPOSAL: u32 = 5;
/// Runs at which confidence saturates to 1.0.
const CONFIDENCE_FULL_RUNS: f64 = 20.0;
/// Propose a larger completion cap when the mean output is this close to it.
const NEAR_CAP_FRACTION: f64 = 0.85;
/// Below this calibration rate, token budgeting for the model is unreliable.
const LOW_CALIBRATION_RATE: f64 = 0.5;
/// Above this eval error rate, the model is flagged unstable (note only).
const HIGH_ERROR_RATE: f64 = 0.25;
/// Floor for a proposed compaction ratio (never compact more aggressively).
const COMPACTION_FLOOR: f32 = 0.5;

/// A single proposed override of one `ModelHints` field.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct ProposedOverride {
    /// `ModelHints` field name, e.g. `"max_completion_tokens"`.
    pub field: String,
    /// Current shipped value, rendered as a string.
    pub current: String,
    /// Proposed value, rendered as a string.
    pub proposed: String,
    /// Why the change is proposed, citing the observed signal.
    pub rationale: String,
}

/// Proposed hint overrides for one model. Empty `proposals` = no change advised.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct HintProposal {
    pub model: String,
    /// Total runs the profile aggregated.
    pub runs: u32,
    /// 0.0–1.0 confidence from the sample size (saturates at 20 runs).
    pub confidence: f64,
    pub proposals: Vec<ProposedOverride>,
    /// Human-facing summary (stability warnings, "no changes", etc.).
    pub note: String,
}

fn confidence_from_runs(runs: u32) -> f64 {
    (f64::from(runs) / CONFIDENCE_FULL_RUNS).min(1.0)
}

/// Round a token count up to the next 1000 for a tidy proposed cap.
fn round_up_1000(value: f64) -> u32 {
    let rounded = (value / 1000.0).ceil() * 1000.0;
    if rounded <= 0.0 {
        0
    } else if rounded >= f64::from(u32::MAX) {
        u32::MAX
    } else {
        // Safe: `rounded` is finite, a multiple of 1000, and within [0, u32::MAX).
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let v = rounded as u32;
        v
    }
}

/// Derive proposed `ModelHints` overrides from a reliability profile.
///
/// Pure and deterministic. Conservative: only proposes a field when the
/// observed signal clearly diverges from the current configuration, and never
/// proposes a more aggressive compaction than [`COMPACTION_FLOOR`].
#[must_use]
pub fn propose_hint_overrides(profile: &ReliabilityProfile, current: &ModelHints) -> HintProposal {
    let confidence = confidence_from_runs(profile.runs);

    if profile.successful_runs < MIN_RUNS_FOR_PROPOSAL {
        return HintProposal {
            model: profile.model.clone(),
            runs: profile.runs,
            confidence,
            proposals: Vec::new(),
            note: format!(
                "Insufficient data: {} successful run(s) (need {} to propose changes).",
                profile.successful_runs, MIN_RUNS_FOR_PROPOSAL
            ),
        };
    }

    let mut proposals = Vec::new();

    // 1) Completion cap: the model routinely emits near the current cap.
    let cap = f64::from(current.max_completion_tokens);
    if cap > 0.0 && profile.mean_output_tokens >= NEAR_CAP_FRACTION * cap {
        let proposed = round_up_1000(profile.mean_output_tokens * 1.5);
        if proposed > current.max_completion_tokens {
            proposals.push(ProposedOverride {
                field: "max_completion_tokens".to_string(),
                current: current.max_completion_tokens.to_string(),
                proposed: proposed.to_string(),
                rationale: format!(
                    "Mean output {:.0} tok is ≥{:.0}% of the {} cap across {} runs — raise headroom.",
                    profile.mean_output_tokens,
                    NEAR_CAP_FRACTION * 100.0,
                    current.max_completion_tokens,
                    profile.successful_runs
                ),
            });
        }
    }

    // 2) Compaction: token budgeting is unreliable for this model, so compact
    //    earlier (lower ratio) to avoid overflow from an undercounted estimate.
    if profile.token_calibration_rate < LOW_CALIBRATION_RATE
        && current.compaction_ratio > COMPACTION_FLOOR
    {
        let proposed = (current.compaction_ratio - 0.1).max(COMPACTION_FLOOR);
        if proposed < current.compaction_ratio {
            proposals.push(ProposedOverride {
                field: "compaction_ratio".to_string(),
                current: format!("{:.2}", current.compaction_ratio),
                proposed: format!("{proposed:.2}"),
                rationale: format!(
                    "Only {:.0}% of runs were within the 5% token-count target — compact earlier to avoid overflow from undercounting.",
                    profile.token_calibration_rate * 100.0
                ),
            });
        }
    }

    let mut note = if proposals.is_empty() {
        "No hint changes proposed — observed behavior matches the current configuration."
            .to_string()
    } else {
        format!("{} proposed override(s) for review.", proposals.len())
    };
    if profile.error_rate > HIGH_ERROR_RATE {
        let _ = write!(
            note,
            " ⚠ High eval error rate ({:.0}%) — investigate provider stability before ratifying.",
            profile.error_rate * 100.0
        );
    }

    HintProposal {
        model: profile.model.clone(),
        runs: profile.runs,
        confidence,
        proposals,
        note,
    }
}

/// Summary of a proposal-build pass.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProposalBuildSummary {
    /// Models a proposal file was written for.
    pub models: u32,
    /// Total field overrides proposed across all models.
    pub overrides: u32,
}

/// Read every profile in `profiles_dir`, derive a hint proposal against each
/// model's current shipped hints, and write each to `proposals_dir/<model>.json`.
///
/// Tolerant: profile files that don't parse are skipped. Deterministic.
///
/// # Errors
/// Returns an error only if `proposals_dir` cannot be created or a proposal
/// file cannot be written.
pub fn build_hint_proposals_from_dir(
    profiles_dir: &Path,
    proposals_dir: &Path,
) -> std::io::Result<ProposalBuildSummary> {
    let mut written: u32 = 0;
    let mut overrides: u32 = 0;
    let mut wrote_any = false;

    let Ok(entries) = std::fs::read_dir(profiles_dir) else {
        return Ok(ProposalBuildSummary {
            models: 0,
            overrides: 0,
        });
    };

    // Collect + sort paths so the build order (and thus output) is deterministic.
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("json"))
        .collect();
    paths.sort();

    for path in paths {
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(profile) = serde_json::from_str::<ReliabilityProfile>(&text) else {
            continue;
        };
        let current = ModelHints::for_model(&profile.model);
        let proposal = propose_hint_overrides(&profile, &current);

        if !wrote_any {
            std::fs::create_dir_all(proposals_dir)?;
            wrote_any = true;
        }
        let json = serde_json::to_string_pretty(&proposal)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        let file = proposals_dir.join(format!("{}.json", sanitize_model_filename(&profile.model)));
        std::fs::write(file, json)?;

        written = written.saturating_add(1);
        overrides =
            overrides.saturating_add(u32::try_from(proposal.proposals.len()).unwrap_or(u32::MAX));
    }

    Ok(ProposalBuildSummary {
        models: written,
        overrides,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        build_hint_proposals_from_dir, propose_hint_overrides, HintProposal, MIN_RUNS_FOR_PROPOSAL,
    };
    use crate::model_hints::ModelHints;
    use crate::reliability_profile::ReliabilityProfile;

    fn profile(model: &str) -> ReliabilityProfile {
        ReliabilityProfile {
            model: model.to_string(),
            runs: 10,
            successful_runs: 10,
            error_rate: 0.0,
            mean_tokens_per_sec: 100.0,
            mean_token_count_error: 0.02,
            token_calibration_rate: 1.0,
            cost_known: true,
            total_cost_usd: 0.1,
            mean_output_tokens: 100.0,
            mean_reasoning_chars: 0.0,
        }
    }

    #[test]
    fn thin_sample_proposes_nothing() {
        let mut p = profile("claude-sonnet-4-6");
        p.successful_runs = MIN_RUNS_FOR_PROPOSAL - 1;
        let hints = ModelHints::for_model("claude-sonnet-4-6");
        let proposal = propose_hint_overrides(&p, &hints);
        assert!(proposal.proposals.is_empty());
        assert!(proposal.note.contains("Insufficient data"));
    }

    #[test]
    fn well_behaved_model_proposes_no_changes() {
        let p = profile("claude-sonnet-4-6");
        let hints = ModelHints::for_model("claude-sonnet-4-6");
        let proposal = propose_hint_overrides(&p, &hints);
        assert!(
            proposal.proposals.is_empty(),
            "got {:?}",
            proposal.proposals
        );
        assert!(proposal.note.contains("No hint changes"));
    }

    #[test]
    fn near_cap_output_proposes_higher_completion_limit() {
        let hints = ModelHints::for_model("claude-sonnet-4-6");
        let mut p = profile("claude-sonnet-4-6");
        // Mean output hugs the cap.
        p.mean_output_tokens = f64::from(hints.max_completion_tokens) * 0.95;
        let proposal = propose_hint_overrides(&p, &hints);
        let cap = proposal
            .proposals
            .iter()
            .find(|o| o.field == "max_completion_tokens")
            .expect("should propose a higher cap");
        let proposed: u32 = cap.proposed.parse().unwrap();
        assert!(proposed > hints.max_completion_tokens);
    }

    #[test]
    fn poor_calibration_proposes_more_conservative_compaction() {
        let hints = ModelHints::for_model("claude-sonnet-4-6");
        let mut p = profile("claude-sonnet-4-6");
        p.token_calibration_rate = 0.2; // < 0.5
        let proposal = propose_hint_overrides(&p, &hints);
        if hints.compaction_ratio > 0.5 {
            let comp = proposal
                .proposals
                .iter()
                .find(|o| o.field == "compaction_ratio")
                .expect("should propose a lower compaction ratio");
            let proposed: f32 = comp.proposed.parse().unwrap();
            assert!(proposed < hints.compaction_ratio);
            assert!(proposed >= 0.5);
        }
    }

    #[test]
    fn high_error_rate_is_flagged_in_note() {
        let hints = ModelHints::for_model("claude-sonnet-4-6");
        let mut p = profile("claude-sonnet-4-6");
        p.error_rate = 0.4;
        let proposal = propose_hint_overrides(&p, &hints);
        assert!(proposal.note.contains("High eval error rate"));
    }

    #[test]
    fn proposal_is_deterministic() {
        let hints = ModelHints::for_model("claude-sonnet-4-6");
        let mut p = profile("claude-sonnet-4-6");
        p.token_calibration_rate = 0.2;
        p.mean_output_tokens = f64::from(hints.max_completion_tokens) * 0.95;
        let a = propose_hint_overrides(&p, &hints);
        let b = propose_hint_overrides(&p, &hints);
        assert_eq!(
            a, b,
            "same profile + hints must yield an identical proposal"
        );
    }

    #[test]
    fn builds_proposal_files_from_profiles_dir() {
        let dir = tempfile::tempdir().expect("tempdir");
        let profiles = dir.path().join("profiles");
        let proposals = dir.path().join("proposals");
        std::fs::create_dir_all(&profiles).unwrap();

        let mut p = profile("claude-sonnet-4-6");
        p.token_calibration_rate = 0.2;
        p.mean_output_tokens =
            f64::from(ModelHints::for_model("claude-sonnet-4-6").max_completion_tokens) * 0.95;
        std::fs::write(
            profiles.join("claude-sonnet-4-6.json"),
            serde_json::to_string(&p).unwrap(),
        )
        .unwrap();
        std::fs::write(profiles.join("broken.json"), "{ not json").unwrap();

        let summary = build_hint_proposals_from_dir(&profiles, &proposals).expect("build ok");
        assert_eq!(summary.models, 1);
        assert!(summary.overrides >= 1);

        let written: HintProposal = serde_json::from_str(
            &std::fs::read_to_string(proposals.join("claude-sonnet-4-6.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(written.model, "claude-sonnet-4-6");
        assert!(!written.proposals.is_empty());
    }

    #[test]
    fn nested_proposals_subdir_is_not_ingested_as_a_profile() {
        // Production layout: proposals/ lives INSIDE the profiles dir. A second
        // build pass must not try to read the proposals/ subdir's files as
        // profiles, and the subdir entry must not error the read.
        let dir = tempfile::tempdir().expect("tempdir");
        let profiles = dir.path().join("profiles");
        let proposals = profiles.join("proposals"); // nested, as in production
        std::fs::create_dir_all(&profiles).unwrap();

        std::fs::write(
            profiles.join("claude-sonnet-4-6.json"),
            serde_json::to_string(&profile("claude-sonnet-4-6")).unwrap(),
        )
        .unwrap();

        // First pass creates proposals/ inside profiles/.
        let first = build_hint_proposals_from_dir(&profiles, &proposals).expect("first ok");
        assert_eq!(first.models, 1);
        // Second pass must still see exactly one profile (the proposals/ subdir
        // and its *.json contents are not re-ingested).
        let second = build_hint_proposals_from_dir(&profiles, &proposals).expect("second ok");
        assert_eq!(second.models, 1, "proposals/ subdir must not be read as a profile");
    }
}
