import type { ReliabilityProfile } from "../bindings";

/**
 * Regression detection for the self-calibrating eval flywheel (P6.4).
 *
 * Compares a baseline snapshot of per-model reliability profiles against the
 * current ones and flags meaningful movements. Pure + deterministic so the
 * dashboard can diff "this build" vs "last build" and surface regressions.
 */

export type RegressionDirection = "regression" | "improvement";

export type RegressionMetric = "token_calibration_rate" | "error_rate" | "mean_tokens_per_sec";

export interface MetricChange {
  model: string;
  metric: RegressionMetric;
  label: string;
  before: number;
  after: number;
  /** after - before (signed, raw units). */
  delta: number;
  direction: RegressionDirection;
}

/** Calibration rate (0–1) must drop by at least this to count as a regression. */
export const CALIBRATION_DELTA = 0.1;
/** Error rate (0–1) must rise by at least this to count as a regression. */
export const ERROR_RATE_DELTA = 0.1;
/** Throughput must move by at least this fraction of the baseline to count. */
export const THROUGHPUT_FRACTION = 0.2;

interface MetricSpec {
  metric: RegressionMetric;
  label: string;
  higherIsBetter: boolean;
  /** Does an absolute move of (after-before) clear the notability threshold? */
  notable: (before: number, after: number) => boolean;
}

const SPECS: MetricSpec[] = [
  {
    metric: "token_calibration_rate",
    label: "Token calibration",
    higherIsBetter: true,
    notable: (b, a) => Math.abs(a - b) >= CALIBRATION_DELTA,
  },
  {
    metric: "error_rate",
    label: "Error rate",
    higherIsBetter: false,
    notable: (b, a) => Math.abs(a - b) >= ERROR_RATE_DELTA,
  },
  {
    metric: "mean_tokens_per_sec",
    label: "Throughput",
    higherIsBetter: true,
    notable: (b, a) => b > 0 && Math.abs(a - b) >= b * THROUGHPUT_FRACTION,
  },
];

/**
 * Diff baseline vs current profiles and return every notable metric movement,
 * each tagged as a regression or an improvement. Models absent from the
 * baseline (newly profiled) produce no entries. Order is stable: by model in
 * `current` order, then by the fixed metric order.
 */
export function detectRegressions(
  baseline: ReliabilityProfile[],
  current: ReliabilityProfile[],
): MetricChange[] {
  const baseByModel = new Map(baseline.map((p) => [p.model, p]));
  const changes: MetricChange[] = [];

  for (const cur of current) {
    const base = baseByModel.get(cur.model);
    if (!base) continue;

    for (const spec of SPECS) {
      const before = base[spec.metric];
      const after = cur[spec.metric];
      if (!spec.notable(before, after)) continue;

      const wentUp = after > before;
      const isImprovement = spec.higherIsBetter ? wentUp : !wentUp;
      changes.push({
        model: cur.model,
        metric: spec.metric,
        label: spec.label,
        before,
        after,
        delta: after - before,
        direction: isImprovement ? "improvement" : "regression",
      });
    }
  }

  return changes;
}

/** Just the regressions from {@link detectRegressions}. */
export function regressionsOnly(changes: MetricChange[]): MetricChange[] {
  return changes.filter((c) => c.direction === "regression");
}

export interface RegressionSummary {
  regressions: number;
  improvements: number;
  /** Distinct models with at least one regression. */
  regressedModels: number;
}

export function summarizeChanges(changes: MetricChange[]): RegressionSummary {
  const regressedModels = new Set<string>();
  let regressions = 0;
  let improvements = 0;
  for (const c of changes) {
    if (c.direction === "regression") {
      regressions += 1;
      regressedModels.add(c.model);
    } else {
      improvements += 1;
    }
  }
  return { regressions, improvements, regressedModels: regressedModels.size };
}
