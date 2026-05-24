import { beforeEach, describe, expect, it } from "vitest";
import type { EvalResult } from "../bindings";
import { HUMAN_SCORE_KEYS, buildBlindLabels, getBlindReviewProgress, getReviewOrder, useEvalStore } from "./evalStore";

const MODELS = ["kimi-coding", "minimax2.7", "claude-sonnet-4-6"];

beforeEach(() => {
  useEvalStore.setState({
    activeEval: null,
    humanScores: {},
    scoresDirty: false,
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

  it("treats zero-valued dimensions as unset during blind review", () => {
    const progress = getBlindReviewProgress(["kimi-coding"], {
      "kimi-coding": Object.fromEntries(HUMAN_SCORE_KEYS.map((key) => [key, 0])),
    });

    expect(progress.completedScores).toBe(0);
    expect(progress.complete).toBe(false);
  });
});

describe("eval blind review state", () => {
  it("marks human score edits dirty until they are saved", () => {
    expect(useEvalStore.getState().scoresDirty).toBe(false);

    useEvalStore.getState().setHumanScore("kimi-coding", "accuracy", 8);

    expect(useEvalStore.getState().scoresDirty).toBe(true);
    useEvalStore.getState().markHumanScoresSaved();
    expect(useEvalStore.getState().scoresDirty).toBe(false);
  });

  it("stores blind labels when starting an eval", () => {
    useEvalStore.getState().startEval("eval-live", "Ship a feature", MODELS, { is_goal_eval: true });

    const activeEval = useEvalStore.getState().activeEval;
    expect(activeEval?.blindLabels).toEqual(buildBlindLabels("eval-live", MODELS));
    expect(useEvalStore.getState().blindMode).toBe(true);
  });

  it("marks unfinished model states as errored when a run-level eval failure occurs", () => {
    useEvalStore.getState().startEval("eval-failed", "Ship a feature", MODELS, { is_goal_eval: true });
    useEvalStore.getState().setModelRunning("eval-failed", "kimi-coding");
    useEvalStore.getState().completeModel("eval-failed", "minimax2.7", {
      input_tokens: 10,
      output_tokens: 20,
      duration_ms: 1000,
    });

    useEvalStore.getState().failEval("eval-failed", "Provider credentials missing");

    const activeEval = useEvalStore.getState().activeEval;
    expect(activeEval?.complete).toBe(true);
    expect(activeEval?.modelStates["kimi-coding"].status).toBe("error");
    expect(activeEval?.modelStates["kimi-coding"].error).toBe("Provider credentials missing");
    expect(activeEval?.modelStates["claude-sonnet-4-6"].status).toBe("error");
    expect(activeEval?.modelStates["minimax2.7"].status).toBe("done");
  });

  it("rebuilds the same blind labels when loading a stored eval", () => {
    useEvalStore.setState({ scoresDirty: true });

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
    expect(useEvalStore.getState().scoresDirty).toBe(false);
  });

  it("forces goal evals loaded from history back into blind mode", () => {
    useEvalStore.setState({ blindMode: false });

    useEvalStore.getState().loadEval({
      id: "eval-goal-history",
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
    });

    expect(useEvalStore.getState().blindMode).toBe(true);
  });

  it("preserves the current blind preference when loading a non-goal eval", () => {
    useEvalStore.setState({ blindMode: false });

    useEvalStore.getState().loadEval({
      id: "eval-free-history",
      prompt: "Compare these outputs",
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
      is_goal_eval: false,
    });

    expect(useEvalStore.getState().blindMode).toBe(false);
  });
});
