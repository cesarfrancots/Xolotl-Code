import { describe, expect, it } from "vitest";
import type { ReliabilityProfile } from "../bindings";
import {
  detectRegressions,
  regressionsOnly,
  summarizeChanges,
} from "./profileRegression";

function profile(model: string, over: Partial<ReliabilityProfile> = {}): ReliabilityProfile {
  return {
    model,
    runs: 10,
    successful_runs: 10,
    error_rate: 0.0,
    mean_tokens_per_sec: 100,
    mean_token_count_error: 0.02,
    token_calibration_rate: 1.0,
    cost_known: true,
    total_cost_usd: 0.1,
    mean_output_tokens: 200,
    mean_reasoning_chars: 0,
    ...over,
  };
}

describe("detectRegressions", () => {
  it("surfaces an injected calibration regression", () => {
    const baseline = [profile("kimi", { token_calibration_rate: 0.9 })];
    const current = [profile("kimi", { token_calibration_rate: 0.5 })]; // dropped 0.4
    const changes = detectRegressions(baseline, current);
    const cal = changes.find((c) => c.metric === "token_calibration_rate");
    expect(cal).toBeDefined();
    expect(cal?.direction).toBe("regression");
    expect(cal?.delta).toBeCloseTo(-0.4, 5);
  });

  it("flags a rising error rate as a regression and a falling one as improvement", () => {
    const worse = detectRegressions(
      [profile("glm", { error_rate: 0.05 })],
      [profile("glm", { error_rate: 0.3 })],
    );
    expect(worse.find((c) => c.metric === "error_rate")?.direction).toBe("regression");

    const better = detectRegressions(
      [profile("glm", { error_rate: 0.3 })],
      [profile("glm", { error_rate: 0.05 })],
    );
    expect(better.find((c) => c.metric === "error_rate")?.direction).toBe("improvement");
  });

  it("flags a large throughput drop as a regression (relative threshold)", () => {
    const changes = detectRegressions(
      [profile("deepseek", { mean_tokens_per_sec: 100 })],
      [profile("deepseek", { mean_tokens_per_sec: 70 })], // -30% > 20%
    );
    expect(changes.find((c) => c.metric === "mean_tokens_per_sec")?.direction).toBe("regression");
  });

  it("ignores movements below the notability threshold", () => {
    const changes = detectRegressions(
      [profile("kimi", { token_calibration_rate: 0.9, error_rate: 0.05, mean_tokens_per_sec: 100 })],
      [profile("kimi", { token_calibration_rate: 0.85, error_rate: 0.09, mean_tokens_per_sec: 95 })],
    );
    expect(changes).toHaveLength(0);
  });

  it("treats the threshold as inclusive (>=): a 0.1 move is flagged, 0.09 is not", () => {
    // 0.1 - 0.0 is exactly the float value of the 0.1 literal, so this pins the
    // inclusive boundary without IEEE-754 drift (0.9 - 0.8 would land just under).
    const atBoundary = detectRegressions(
      [profile("kimi", { error_rate: 0.0 })],
      [profile("kimi", { error_rate: 0.1 })],
    );
    expect(atBoundary.some((c) => c.metric === "error_rate")).toBe(true);

    const justUnder = detectRegressions(
      [profile("kimi", { token_calibration_rate: 0.9, error_rate: 0.05 })],
      [profile("kimi", { token_calibration_rate: 0.81, error_rate: 0.09 })], // 0.09 each
    );
    expect(justUnder).toHaveLength(0);
  });

  it("suppresses throughput changes when the baseline throughput is zero", () => {
    const changes = detectRegressions(
      [profile("only-errored", { mean_tokens_per_sec: 0 })],
      [profile("only-errored", { mean_tokens_per_sec: 200 })],
    );
    expect(changes.some((c) => c.metric === "mean_tokens_per_sec")).toBe(false);
  });

  it("ignores models absent from the baseline (newly profiled)", () => {
    const changes = detectRegressions([], [profile("brand-new", { token_calibration_rate: 0.1 })]);
    expect(changes).toHaveLength(0);
  });

  it("ignores models present in the baseline but absent from current (retired)", () => {
    const changes = detectRegressions(
      [profile("retired", { token_calibration_rate: 0.1, error_rate: 0.9 })],
      [profile("active")],
    );
    expect(changes.some((c) => c.model === "retired")).toBe(false);
  });
});

describe("summarizeChanges / regressionsOnly", () => {
  it("counts regressions, improvements, and distinct regressed models", () => {
    const baseline = [
      profile("a", { token_calibration_rate: 0.9, error_rate: 0.05 }),
      profile("b", { mean_tokens_per_sec: 100 }),
    ];
    const current = [
      profile("a", { token_calibration_rate: 0.5, error_rate: 0.4 }), // 2 regressions, model a
      profile("b", { mean_tokens_per_sec: 150 }), // throughput improvement
    ];
    const changes = detectRegressions(baseline, current);
    const summary = summarizeChanges(changes);
    expect(summary.regressions).toBe(2);
    expect(summary.improvements).toBe(1);
    expect(summary.regressedModels).toBe(1);
    expect(regressionsOnly(changes).every((c) => c.direction === "regression")).toBe(true);
  });
});
