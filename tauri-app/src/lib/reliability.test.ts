import { describe, expect, it } from "vitest";
import type { ReliabilityMetrics } from "../bindings";
import {
  calibrationVerdict,
  formatReliabilityCost,
  formatTps,
  reliabilityRows,
  tokenAccuracyPct,
} from "./reliability";

function metrics(over: Partial<ReliabilityMetrics> = {}): ReliabilityMetrics {
  return {
    model: "claude-sonnet-4-6",
    input_tokens: 1000,
    output_tokens: 500,
    duration_ms: 2000,
    tokens_per_sec: 250,
    cost_usd: 0.0105,
    cost_known: true,
    estimated_output_tokens: 500,
    token_count_error: 0,
    reasoning_chars: 0,
    had_error: false,
    ...over,
  };
}

describe("tokenAccuracyPct", () => {
  it("is 100% when the estimate matched the reported count", () => {
    expect(tokenAccuracyPct(metrics({ token_count_error: 0 }))).toBe(100);
  });

  it("drops as error grows and clamps to 0", () => {
    expect(tokenAccuracyPct(metrics({ token_count_error: 0.1 }))).toBeCloseTo(90, 5);
    expect(tokenAccuracyPct(metrics({ token_count_error: 2 }))).toBe(0);
  });

  it("returns 0 (no data) when there is no reported output", () => {
    expect(tokenAccuracyPct(metrics({ output_tokens: 0 }))).toBe(0);
  });

  it("returns 0 (no data) for errored runs even with a partial body", () => {
    expect(tokenAccuracyPct(metrics({ had_error: true, output_tokens: 200 }))).toBe(0);
  });
});

describe("calibrationVerdict", () => {
  it("calls <=5% error well calibrated", () => {
    expect(calibrationVerdict(metrics({ token_count_error: 0.04 }))).toEqual({
      label: "Well calibrated",
      tone: "good",
    });
  });

  it("calls 5–15% error drifting", () => {
    expect(calibrationVerdict(metrics({ token_count_error: 0.1 })).tone).toBe("warn");
  });

  it("calls >15% error miscalibrated", () => {
    expect(calibrationVerdict(metrics({ token_count_error: 0.4 })).tone).toBe("bad");
  });

  it("reports no data for empty or errored runs", () => {
    expect(calibrationVerdict(metrics({ output_tokens: 0 })).tone).toBe("none");
    expect(calibrationVerdict(metrics({ had_error: true })).tone).toBe("none");
  });

  it("pins the inclusive boundaries (<=)", () => {
    // Exactly 5% is still "good"; exactly 15% is still "warn".
    expect(calibrationVerdict(metrics({ token_count_error: 0.05 })).tone).toBe("good");
    expect(calibrationVerdict(metrics({ token_count_error: 0.15 })).tone).toBe("warn");
  });
});

describe("formatReliabilityCost", () => {
  it("formats known pricing to 4 decimals", () => {
    expect(formatReliabilityCost(metrics({ cost_known: true, cost_usd: 0.0105 }))).toBe("$0.0105");
  });

  it("shows an em-dash for unknown pricing rather than a fake $0", () => {
    expect(formatReliabilityCost(metrics({ cost_known: false, cost_usd: 0 }))).toBe("—");
  });
});

describe("formatTps", () => {
  it("rounds throughput", () => {
    expect(formatTps(metrics({ tokens_per_sec: 249.6 }))).toBe("250 tok/s");
  });

  it("shows an em-dash when throughput is unmeasured", () => {
    expect(formatTps(metrics({ tokens_per_sec: 0 }))).toBe("—");
  });
});

describe("reliabilityRows", () => {
  it("produces the four readout rows with honest unknowns", () => {
    const rows = reliabilityRows(
      metrics({ cost_known: false, cost_usd: 0, output_tokens: 0, tokens_per_sec: 0, reasoning_chars: 0 }),
    );
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(byKey.cost).toBe("—");
    expect(byKey.tps).toBe("—");
    expect(byKey.accuracy).toBe("—");
    expect(byKey.reasoning).toBe("none");
  });

  it("renders populated values", () => {
    const rows = reliabilityRows(metrics({ reasoning_chars: 1234, token_count_error: 0 }));
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(byKey.cost).toBe("$0.0105");
    expect(byKey.accuracy).toBe("100%");
    expect(byKey.reasoning).toBe("1,234 chars");
  });

  it("hides token accuracy for errored runs (no contradiction with the verdict)", () => {
    // A partial body before an error must not show a numeric accuracy while the
    // calibration verdict says "No data".
    const m = metrics({ had_error: true, output_tokens: 120, token_count_error: 0.3 });
    const rows = reliabilityRows(m);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(byKey.accuracy).toBe("—");
    expect(calibrationVerdict(m).tone).toBe("none");
  });
});
