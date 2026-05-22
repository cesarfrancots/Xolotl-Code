import { beforeEach, describe, expect, it } from "vitest";
import type { EvalResult } from "../bindings";
import { HUMAN_SCORE_KEYS, buildBlindLabels, getBlindReviewProgress, getReviewOrder, useEvalStore } from "./evalStore";

const MODELS = ["kimi-coding", "minimax2.7", "claude-sonnet-4-6"];

beforeEach(() => {
  useEvalStore.setState({
    activeEval: null,
    humanScores: {},
    evalOpen: false,
    blindMode: true,
    activeSuite: null,
  });
});

describe("buildBlindLabels", () => {
  it("creates stable randomized labels for a given eval id", () => {
    const first = buildBlindLabels("eval-123", MODELS);
    const second = buildBlindLabels("eval-123", MODELS);

    expect(second).toEqual(first);
    expect(Object.keys(first).sort()).toEqual([...MODELS].sort());
    expect(Object.values(first).sort()).toEqual(["Model A", "Model B", "Model C"]);
    expect(
      MODELS.every((model, index) => first[model] === `Model ${String.fromCharCode(65 + index)}`)
    ).toBe(false);
  });
});

describe("getReviewOrder", () => {
  it("sorts by anonymous label only while blind mode is active", () => {
    const labels = {
      "kimi-coding": "Model C",
      "minimax2.7": "Model A",
      "claude-sonnet-4-6": "Model B",
    };

    expect(getReviewOrder(MODELS, labels, true)).toEqual([
      "minimax2.7",
      "claude-sonnet-4-6",
      "kimi-coding",
    ]);
    expect(getReviewOrder(MODELS, labels, false)).toEqual(MODELS);
  });
});

describe("getBlindReviewProgress", () => {
  it("requires every score dimension on every model before review is complete", () => {
    const partial = getBlindReviewProgress(MODELS, {
      "kimi-coding": { accuracy: 8, helpfulness: 7 },
      "minimax2.7": Object.fromEntries(HUMAN_SCORE_KEYS.map((key) => [key, 8])),
    });

    expect(partial.totalScores).toBe(MODELS.length * HUMAN_SCORE_KEYS.length);
    expect(partial.completedModels).toBe(1);
    expect(partial.complete).toBe(false);

    const full = getBlindReviewProgress(
      MODELS,
      Object.fromEntries(
        MODELS.map((model) => [model, Object.fromEntries(HUMAN_SCORE_KEYS.map((key) => [key, 8]))])
      )
    );

    expect(full.completedScores).toBe(full.totalScores);
    expect(full.completedModels).toBe(MODELS.length);
    expect(full.complete).toBe(true);
  });
});

describe("eval blind review state", () => {
  it("stores blind labels when starting an eval", () => {
    useEvalStore.getState().startEval("eval-live", "Ship a feature", MODELS, { is_goal_eval: true });

    const activeEval = useEvalStore.getState().activeEval;
    expect(activeEval?.blindLabels).toEqual(buildBlindLabels("eval-live", MODELS));
    expect(useEvalStore.getState().blindMode).toBe(true);
  });

  it("rebuilds the same blind labels when loading a stored eval", () => {
    const result: EvalResult = {
      id: "eval-stored",
      prompt: "Ship a feature",
      models: MODELS,
      results: MODELS.map((model) => ({
        model,
        content: `${model} output`,
        input_tokens: 10,
        output_tokens: 20,
        duration_ms: 1000,
        error: null,
      })),
      human_scores: {},
      created_at: 123,
      is_goal_eval: true,
    };

    useEvalStore.getState().loadEval(result);

    expect(useEvalStore.getState().activeEval?.blindLabels).toEqual(buildBlindLabels("eval-stored", MODELS));
  });
});
