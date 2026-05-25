import { describe, expect, it } from "vitest";
import type { ActiveEval } from "../stores/evalStore";
import type { GoalGrade, HumanScores, ManualReview } from "../bindings";
import { buildEvalComparison } from "./evalComparison";

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

function evalFixture(): ActiveEval {
  return {
    id: "eval-test",
    prompt: "Build a small playable game.",
    models: ["model-a", "model-b"],
    blindLabels: { "model-a": "Model A", "model-b": "Model B" },
    complete: true,
    created_at: 1,
    modelStates: {
      "model-a": {
        model: "model-a",
        status: "done",
        content: "A",
        reasoning: "",
        flags: [],
        input_tokens: 100,
        output_tokens: 200,
        duration_ms: 5000,
        auto: {
          ai_slop_score: 8,
          brevity_score: 7,
          json_valid: null,
          code_block_count: 1,
          em_dash_count: 0,
          word_count: 100,
          char_count: 500,
          slop_hits: [],
        },
      },
      "model-b": {
        model: "model-b",
        status: "done",
        content: "B",
        reasoning: "",
        flags: [],
        input_tokens: 100,
        output_tokens: 200,
        duration_ms: 5000,
      },
    },
  };
}

describe("buildEvalComparison", () => {
  it("keeps AI KPI, human visual, blended, and personal review scores separate", () => {
    const activeEval = evalFixture();
    const humanScores = {
      "model-a": scores(8, { design: 6 }),
      "model-b": scores(7, { design: 10 }),
    };
    const manualReviews: Record<string, ManualReview> = {
      "model-a": { score: 4, notes: "I would not use this one.", updated_at: 10 },
    };

    const comparison = buildEvalComparison({ activeEval, humanScores, manualReviews });

    expect(comparison.models[0]).toMatchObject({
      model: "model-a",
      displayName: "model-a",
      generalSource: "blend",
      manualScore: 4,
    });
    expect(comparison.models[0].aiScore).toBeGreaterThan(0);
    expect(comparison.models[0].humanScore).toBeCloseTo(7.75, 2);
    expect(comparison.models[0].finalScore).toBeCloseTo(
      (comparison.models[0].aiScore ?? 0) * 0.65 + 7.75 * 0.35,
      2
    );
    expect(comparison.models[0].manualScore).not.toBe(comparison.models[0].generalScore);
    expect(comparison.models[0].kpis.map((kpi) => kpi.key)).toEqual([
      "quality",
      "reasoning",
      "speed",
      "efficiency",
      "cost",
    ]);
  });

  it("identifies the best model by scoring area and keeps blind labels when requested", () => {
    const activeEval = evalFixture();
    activeEval.judge = {
      judge_model: "judge",
      scores: {
        "model-a": scores(6, { accuracy: 9, creativity: 5 }),
        "model-b": scores(6, { accuracy: 7, creativity: 10 }),
      },
      rationale: {
        "model-a": "More accurate implementation.",
        "model-b": "More creative visual design.",
      },
    };

    const comparison = buildEvalComparison({
      activeEval,
      humanScores: {},
      manualReviews: {},
      blindNames: activeEval.blindLabels,
    });

    expect(comparison.areaLeaders.find((area) => area.key === "accuracy")).toMatchObject({
      displayName: "Model A",
      score: 9,
    });
    expect(comparison.areaLeaders.find((area) => area.key === "creativity")).toMatchObject({
      displayName: "Model B",
      score: 10,
    });
    expect(comparison.models.find((model) => model.model === "model-b")?.why).toContain("More creative visual design.");
  });

  it("uses goal grades as a fallback score when output rubric scores are absent", () => {
    const activeEval = evalFixture();
    const grade: GoalGrade = {
      judge_model: "judge",
      axes: {
        goal_decomposition: { score: 5, evidence: "Clear plan" },
        assumption_quality: { score: 4, evidence: "Names assumptions" },
        self_correction: { score: 3, evidence: "Corrects once" },
        plan_action_coherence: { score: 4, evidence: "Actions follow plan" },
        goal_achievement: { score: 5, evidence: "Finished" },
      },
      flags: [],
      summary: "Strong goal completion.",
    };
    activeEval.modelStates["model-b"].goalGrade = grade;

    const comparison = buildEvalComparison({ activeEval, humanScores: {}, manualReviews: {} });

    expect(comparison.models.find((model) => model.model === "model-b")).toMatchObject({
      generalSource: "kpi",
    });
    expect(comparison.models.find((model) => model.model === "model-b")?.why).toContain("Strong goal completion.");
    expect(comparison.models.find((model) => model.model === "model-b")?.aiScore).toBeGreaterThan(8);
  });

  it("keeps tied models on the same rank instead of inventing a winner", () => {
    const activeEval = evalFixture();
    activeEval.modelStates["model-a"].auto = undefined;

    const comparison = buildEvalComparison({
      activeEval,
      humanScores: {
        "model-a": scores(8),
        "model-b": scores(8),
      },
    });

    expect(comparison.models.map((model) => [model.model, model.rank])).toEqual([
      ["model-a", 1],
      ["model-b", 1],
    ]);
    expect(comparison.decision).toBe("tie");
    expect(comparison.winnerMargin).toBe(0);
    expect(comparison.models[0].confidence).toBe("tie");
  });

  it("marks objective reasoning answers as correct or incorrect", () => {
    const activeEval = evalFixture();
    activeEval.suite_id = "reasoning";
    activeEval.prompt = "A bat and ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost?";
    activeEval.modelStates["model-a"].content = "The ball costs $0.05.";
    activeEval.modelStates["model-b"].content = "The ball costs ten cents.";

    const comparison = buildEvalComparison({ activeEval, humanScores: {} });

    expect(comparison.models.find((model) => model.model === "model-a")?.correctness).toMatchObject({
      verdict: "correct",
    });
    expect(comparison.models.find((model) => model.model === "model-b")?.correctness).toMatchObject({
      verdict: "incorrect",
    });
  });

  it("extracts objective answers for automatic result review", () => {
    const activeEval = evalFixture();
    activeEval.suite_id = "reasoning";
    activeEval.prompt = "A bat and ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost?";
    activeEval.modelStates["model-a"].content = "The ball costs $0.05.";
    activeEval.modelStates["model-b"].content = "The ball costs ten cents.";

    const comparison = buildEvalComparison({ activeEval, humanScores: {} });

    expect(comparison.models.find((model) => model.model === "model-a")?.correctness).toMatchObject({
      expectedAnswer: "$0.05",
      observedAnswer: "$0.05",
    });
    expect(comparison.models.find((model) => model.model === "model-b")?.correctness).toMatchObject({
      expectedAnswer: "$0.05",
      observedAnswer: "$0.10",
    });
  });

  it("weights objective correctness above speed and cost for final ranking", () => {
    const activeEval = evalFixture();
    activeEval.suite_id = "reasoning";
    activeEval.prompt = "A bat and ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost?";
    activeEval.modelStates["model-a"] = {
      ...activeEval.modelStates["model-a"],
      content: "The ball costs $0.05.",
      auto: undefined,
      input_tokens: 900,
      output_tokens: 900,
      duration_ms: 9000,
    };
    activeEval.modelStates["model-b"] = {
      ...activeEval.modelStates["model-b"],
      content: "The ball costs ten cents.",
      auto: undefined,
      input_tokens: 20,
      output_tokens: 20,
      duration_ms: 400,
    };

    const comparison = buildEvalComparison({ activeEval, humanScores: {} });

    expect(comparison.winner?.model).toBe("model-a");
    expect(comparison.models.find((model) => model.model === "model-a")?.kpis[0]).toMatchObject({
      key: "correctness",
      score: 10,
    });
    expect(comparison.models.find((model) => model.model === "model-b")?.kpis[0]).toMatchObject({
      key: "correctness",
      score: 1,
    });
  });
});
