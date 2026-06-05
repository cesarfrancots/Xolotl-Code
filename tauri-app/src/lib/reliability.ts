import type { ReliabilityMetrics } from "../bindings";

/**
 * Display helpers for per-model reliability/calibration metrics (P6.1).
 *
 * The numbers themselves are computed authoritatively in the Rust backend
 * (`compute_reliability_metrics`) using the engine's pricing table + tokenizer,
 * then persisted into the eval file. This module only formats them for the UI —
 * it never re-derives cost or token estimates (which would drift from the engine).
 */

export type CalibrationTone = "good" | "warn" | "bad" | "none";

export interface CalibrationVerdict {
  label: string;
  tone: CalibrationTone;
}

/** §5 token-count-error target: estimate should be within 5% of reported. */
export const TOKEN_ERROR_GOOD = 0.05;
/** Beyond this the estimator is materially miscalibrated for the model. */
export const TOKEN_ERROR_WARN = 0.15;

/**
 * Token-count accuracy as a 0–100 percentage: 100 = the engine's estimate
 * matched the provider's reported output exactly. Returns 0 ("no data") when
 * there is no reported output, or when the run errored (a partial body before
 * an error is not a meaningful calibration sample) — matching
 * {@link calibrationVerdict} so the two never contradict each other.
 */
export function tokenAccuracyPct(m: ReliabilityMetrics): number {
  if (m.output_tokens <= 0 || m.had_error) return 0;
  return Math.max(0, Math.min(100, (1 - (m.token_count_error ?? 0)) * 100));
}

/**
 * Calibration verdict derived from the token-count error. This is the signal
 * P6.2 will aggregate into a per-model reliability profile.
 */
export function calibrationVerdict(m: ReliabilityMetrics): CalibrationVerdict {
  if (m.output_tokens <= 0 || m.had_error) return { label: "No data", tone: "none" };
  const err = m.token_count_error ?? 0;
  if (err <= TOKEN_ERROR_GOOD) return { label: "Well calibrated", tone: "good" };
  if (err <= TOKEN_ERROR_WARN) return { label: "Drifting", tone: "warn" };
  return { label: "Miscalibrated", tone: "bad" };
}

/**
 * Authoritative dollar cost, or an em-dash when the model has no verified
 * pricing (an honest "unknown", never an Opus-rate guess).
 */
export function formatReliabilityCost(m: ReliabilityMetrics): string {
  if (!m.cost_known) return "—";
  return `$${(m.cost_usd ?? 0).toFixed(4)}`;
}

/** Output throughput, or an em-dash when it could not be measured. */
export function formatTps(m: ReliabilityMetrics): string {
  const tokensPerSec = m.tokens_per_sec ?? 0;
  if (tokensPerSec <= 0) return "—";
  return `${Math.round(tokensPerSec).toLocaleString("en-US")} tok/s`;
}

export interface ReliabilityRow {
  key: string;
  label: string;
  value: string;
  title?: string;
}

/** Compact rows for a per-model reliability readout. */
export function reliabilityRows(m: ReliabilityMetrics): ReliabilityRow[] {
  return [
    {
      key: "cost",
      label: "Cost",
      value: formatReliabilityCost(m),
      title: m.cost_known
        ? `${m.input_tokens.toLocaleString("en-US")} in / ${m.output_tokens.toLocaleString("en-US")} out tok`
        : "No verified pricing for this model",
    },
    { key: "tps", label: "Throughput", value: formatTps(m) },
    {
      key: "accuracy",
      label: "Token accuracy",
      value: m.output_tokens > 0 && !m.had_error ? `${Math.round(tokenAccuracyPct(m))}%` : "—",
      title: `estimated ${m.estimated_output_tokens.toLocaleString("en-US")} vs reported ${m.output_tokens.toLocaleString("en-US")} tok`,
    },
    {
      key: "reasoning",
      label: "Reasoning",
      value: m.reasoning_chars > 0 ? `${m.reasoning_chars.toLocaleString("en-US")} chars` : "none",
    },
  ];
}
