import { describe, expect, it } from "vitest";
import type { EvalResult, HumanScores } from "../bindings";
import { buildBenchmarkLeaderboard } from "./benchmarkLeaderboard";

const scores = (base: number, overrides: Partial<HumanScores> = {}): HumanScores => ({
  accuracy: base,
  helpfulness: base,
  quality: base,
  creativity: base,
  design: base,
  aesthetics: base,
  ai_slop: base,
  brevity: base,
  ...overrides,
});

function evalResult(overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    id: "eval-1",
    prompt: "Build a responsive frontend dashboard for benchmark rankings.",
    models: ["model-a", "model-b"],
    results: [
      {
        model: "model-a",
        content: "A",
        input_tokens: 100,
        output_tokens: 200,
        duration_ms: 1000,
        error: null,
      },
      {
        model: "model-b",
        content: "B",
        input_tokens: 140,
        output_tokens: 260,
        duration_ms: 1800,
        error: null,
      },
    ],
    human_scores: {},
    manual_reviews: {},
    auto_scores: {},
    judge: null,
    reasoning_traces: {},
    goal_grades: {},
    is_goal_eval: false,
    goal: null,
    suite_id: null,
    suite_run_id: null,
    suite_prompt_id: null,
    created_at: 100,
    ...overrides,
  };
}

describe("buildBenchmarkLeaderboard", () => {
  it("aggregates overall model ranking across saved evals", () => {
    const leaderboard = buildBenchmarkLeaderboard([
      evalResult({
        id: "eval-1",
        human_scores: {
          "model-a": scores(9),
          "model-b": scores(6),
        },
      }),
      evalResult({
        id: "eval-2",
        created_at: 200,
        human_scores: {
          "model-a": scores(8),
          "model-b": scores(7),
        },
      }),
    ]);

    const overall = leaderboard.areas.find((area) => area.area.key === "overall");

    expect(overall?.entries.map((entry) => [entry.model, entry.rank])).toEqual([
      ["model-a", 1],
      ["model-b", 2],
    ]);
    expect(overall?.entries[0]).toMatchObject({
      trialCount: 2,
      evalCount: 2,
      winCount: 2,
    });
    expect(leaderboard.lastUpdatedAt).toBe(200);
  });

  it("uses human design scores for the frontend design benchmark", () => {
    const leaderboard = buildBenchmarkLeaderboard([
      evalResult({
        id: "design-1",
        suite_id: "frontend-design",
        human_scores: {
          "model-a": scores(6, { design: 10, aesthetics: 9, creativity: 8 }),
          "model-b": scores(8, { design: 6, aesthetics: 6, creativity: 6 }),
        },
      }),
    ]);

    const design = leaderboard.areas.find((area) => area.area.key === "frontend_design");

    expect(design?.entries[0]).toMatchObject({
      model: "model-a",
      rank: 1,
      sourceLabel: "human visual",
    });
    expect(design?.entries[0].averageScore).toBeCloseTo(9, 2);
  });

  it("keeps unreviewed frontend outputs out of the human design benchmark", () => {
    const leaderboard = buildBenchmarkLeaderboard([
      evalResult({
        id: "design-1",
        suite_id: "frontend-design",
        human_scores: {},
      }),
    ]);

    const design = leaderboard.areas.find((area) => area.area.key === "frontend_design");

    expect(design?.entries).toEqual([]);
    expect(design?.trialCount).toBe(0);
  });
});
