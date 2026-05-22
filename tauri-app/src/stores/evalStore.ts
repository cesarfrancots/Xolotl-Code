import { create } from "zustand";
import type { EvalResult, HumanScores, AutoScores, JudgeScores, ReasoningFlag, GoalGrade } from "../bindings";

export const HUMAN_SCORE_KEYS: (keyof HumanScores)[] = [
  "accuracy",
  "helpfulness",
  "quality",
  "creativity",
  "design",
  "aesthetics",
  "ai_slop",
  "brevity",
];

export interface EvalModelState {
  model: string;
  status: "pending" | "running" | "done" | "error";
  content: string;
  /** Streamed chain-of-thought (`reasoning_content`). Empty for non-reasoning models. */
  reasoning: string;
  /** Live flags raised by the reasoning supervisor while the model thinks. */
  flags: ReasoningFlag[];
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  error?: string;
  /** Time the model started; used to derive live tok/s while running. */
  started_at?: number;
  auto?: AutoScores;
  /** Post-hoc goal grade (5 axes + retrospective flags). */
  goalGrade?: GoalGrade;
}

export interface ActiveEval {
  id: string;
  prompt: string;
  models: string[];
  /** Stable per-eval anonymous labels used while human review is blinded. */
  blindLabels: Record<string, string>;
  modelStates: Record<string, EvalModelState>;
  complete: boolean;
  created_at: number;
  /** Suite linkage (if this eval is part of a suite run). */
  suite_id?: string | null;
  suite_run_id?: string | null;
  suite_prompt_id?: string | null;
  judge?: JudgeScores | null;
  /** True if this run was started via start_goal_eval. */
  is_goal_eval?: boolean;
  /** Live supervisor enabled for this run? Toggle persists for UI state. */
  live_supervisor?: boolean;
}

export interface SuiteRunState {
  suite_run_id: string;
  suite_id: string;
  prompt_count: number;
  current_index: number;
  /** Eval ids of every prompt-eval finished so far in this suite run. */
  finished_eval_ids: string[];
}

export interface EvalState {
  activeEval: ActiveEval | null;
  humanScores: Record<string, Partial<HumanScores>>;
  /** True when local human score edits have not been saved to disk yet. */
  scoresDirty: boolean;
  evalOpen: boolean;
  /** True if names are blinded (A, B, C) for unbiased human scoring. */
  blindMode: boolean;
  activeSuite: SuiteRunState | null;

  startEval: (id: string, prompt: string, models: string[], suiteInfo?: {
    suite_id?: string | null;
    suite_run_id?: string | null;
    suite_prompt_id?: string | null;
    is_goal_eval?: boolean;
    live_supervisor?: boolean;
  }) => void;
  setModelRunning: (evalId: string, model: string) => void;
  appendModelDelta: (evalId: string, model: string, text: string) => void;
  appendModelReasoning: (evalId: string, model: string, text: string) => void;
  pushReasoningFlag: (evalId: string, model: string, flag: ReasoningFlag) => void;
  completeModel: (
    evalId: string,
    model: string,
    stats: { input_tokens: number; output_tokens: number; duration_ms: number; error?: string; auto?: AutoScores; reasoning?: string }
  ) => void;
  finalizeEval: (evalId: string) => void;
  setJudge: (judge: JudgeScores) => void;
  setGoalGrades: (grades: Record<string, GoalGrade>) => void;
  loadEval: (result: EvalResult) => void;
  setHumanScore: (model: string, dimension: keyof HumanScores, value: number) => void;
  markHumanScoresSaved: () => void;
  clearHumanScores: () => void;
  openEval: () => void;
  closeEval: () => void;
  toggleBlind: () => void;
  setBlindMode: (blindMode: boolean) => void;
  startSuite: (run: SuiteRunState) => void;
  advanceSuite: (eval_id: string) => void;
  finishSuite: () => void;
}

function labelForIndex(index: number): string {
  let n = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `Model ${label}`;
}

function seedFrom(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextSeed(seed: number): number {
  let x = seed || 0x9e3779b9;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

export function buildBlindLabels(evalId: string, models: string[]): Record<string, string> {
  const shuffled = [...models];
  let seed = seedFrom(`${evalId}\u0000${models.join("\u0000")}`);
  for (let i = shuffled.length - 1; i > 0; i--) {
    seed = nextSeed(seed);
    const j = seed % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  if (shuffled.length > 1 && shuffled.every((model, index) => model === models[index])) {
    shuffled.push(shuffled.shift() as string);
  }

  return Object.fromEntries(shuffled.map((model, index) => [model, labelForIndex(index)]));
}

export function getReviewOrder(models: string[], blindLabels: Record<string, string>, blindMode: boolean): string[] {
  if (!blindMode) return models;
  return [...models].sort((a, b) => (blindLabels[a] ?? a).localeCompare(blindLabels[b] ?? b));
}

export function getBlindReviewProgress(
  models: string[],
  humanScores: Record<string, Partial<HumanScores>>
): {
  completedScores: number;
  totalScores: number;
  completedModels: number;
  totalModels: number;
  complete: boolean;
} {
  const totalScores = models.length * HUMAN_SCORE_KEYS.length;
  const completedByModel = models.map((model) => {
    const scores = humanScores[model] ?? {};
    return HUMAN_SCORE_KEYS.filter((key) => (scores[key] ?? 0) > 0).length;
  });
  const completedScores = completedByModel.reduce((sum, count) => sum + count, 0);
  const completedModels = completedByModel.filter((count) => count === HUMAN_SCORE_KEYS.length).length;

  return {
    completedScores,
    totalScores,
    completedModels,
    totalModels: models.length,
    complete: models.length > 0 && completedModels === models.length,
  };
}

export const useEvalStore = create<EvalState>()((set) => ({
  activeEval: null,
  humanScores: {},
  scoresDirty: false,
  evalOpen: false,
  blindMode: true,
  activeSuite: null,

  startEval: (id, prompt, models, suiteInfo) => {
    const modelStates: Record<string, EvalModelState> = {};
    for (const m of models) {
      modelStates[m] = {
        model: m,
        status: "pending",
        content: "",
        reasoning: "",
        flags: [],
        input_tokens: 0,
        output_tokens: 0,
        duration_ms: 0,
      };
    }
    set({
      activeEval: {
        id,
        prompt,
        models,
        blindLabels: buildBlindLabels(id, models),
        modelStates,
        complete: false,
        created_at: Date.now(),
        suite_id: suiteInfo?.suite_id ?? null,
        suite_run_id: suiteInfo?.suite_run_id ?? null,
        suite_prompt_id: suiteInfo?.suite_prompt_id ?? null,
        is_goal_eval: suiteInfo?.is_goal_eval ?? false,
        live_supervisor: suiteInfo?.live_supervisor ?? false,
      },
      humanScores: {},
      scoresDirty: false,
      evalOpen: true,
    });
  },

  setModelRunning: (evalId, model) =>
    set((s) => {
      if (!s.activeEval || s.activeEval.id !== evalId) return s;
      const prev = s.activeEval.modelStates[model];
      if (!prev) return s;
      return {
        activeEval: {
          ...s.activeEval,
          modelStates: {
            ...s.activeEval.modelStates,
            [model]: { ...prev, status: "running", started_at: Date.now() },
          },
        },
      };
    }),

  appendModelDelta: (evalId, model, text) =>
    set((s) => {
      if (!s.activeEval || s.activeEval.id !== evalId) return s;
      const prev = s.activeEval.modelStates[model];
      if (!prev) return s;
      return {
        activeEval: {
          ...s.activeEval,
          modelStates: {
            ...s.activeEval.modelStates,
            [model]: {
              ...prev,
              content: prev.content + text,
              status: "running",
              started_at: prev.started_at ?? Date.now(),
            },
          },
        },
      };
    }),

  appendModelReasoning: (evalId, model, text) =>
    set((s) => {
      if (!s.activeEval || s.activeEval.id !== evalId) return s;
      const prev = s.activeEval.modelStates[model];
      if (!prev) return s;
      return {
        activeEval: {
          ...s.activeEval,
          modelStates: {
            ...s.activeEval.modelStates,
            [model]: {
              ...prev,
              reasoning: prev.reasoning + text,
              status: "running",
              started_at: prev.started_at ?? Date.now(),
            },
          },
        },
      };
    }),

  pushReasoningFlag: (evalId, model, flag) =>
    set((s) => {
      if (!s.activeEval || s.activeEval.id !== evalId) return s;
      const prev = s.activeEval.modelStates[model];
      if (!prev) return s;
      return {
        activeEval: {
          ...s.activeEval,
          modelStates: {
            ...s.activeEval.modelStates,
            [model]: { ...prev, flags: [...prev.flags, flag] },
          },
        },
      };
    }),

  completeModel: (evalId, model, stats) =>
    set((s) => {
      if (!s.activeEval || s.activeEval.id !== evalId) return s;
      const prev = s.activeEval.modelStates[model];
      if (!prev) return s;
      return {
        activeEval: {
          ...s.activeEval,
          modelStates: {
            ...s.activeEval.modelStates,
            [model]: {
              ...prev,
              status: stats.error ? "error" : "done",
              input_tokens: stats.input_tokens,
              output_tokens: stats.output_tokens,
              duration_ms: stats.duration_ms,
              error: stats.error,
              auto: stats.auto,
              reasoning: stats.reasoning ?? prev.reasoning,
            },
          },
        },
      };
    }),

  finalizeEval: (evalId) =>
    set((s) => {
      if (!s.activeEval || s.activeEval.id !== evalId) return s;
      return { activeEval: { ...s.activeEval, complete: true } };
    }),

  setJudge: (judge) =>
    set((s) => (s.activeEval ? { activeEval: { ...s.activeEval, judge } } : s)),

  setGoalGrades: (grades) =>
    set((s) => {
      if (!s.activeEval) return s;
      const next = { ...s.activeEval.modelStates };
      for (const [model, grade] of Object.entries(grades)) {
        if (next[model]) next[model] = { ...next[model], goalGrade: grade };
      }
      return { activeEval: { ...s.activeEval, modelStates: next } };
    }),

  loadEval: (result) => {
    const modelStates: Record<string, EvalModelState> = {};
    for (const r of result.results) {
      modelStates[r.model] = {
        model: r.model,
        status: r.error ? "error" : "done",
        content: r.content,
        reasoning: result.reasoning_traces?.[r.model] ?? "",
        flags: result.goal_grades?.[r.model]?.flags ?? [],
        input_tokens: r.input_tokens,
        output_tokens: r.output_tokens,
        duration_ms: r.duration_ms,
        error: r.error ?? undefined,
        auto: result.auto_scores?.[r.model],
        goalGrade: result.goal_grades?.[r.model],
      };
    }
    const humanScores: Record<string, Partial<HumanScores>> = {};
    for (const [model, scores] of Object.entries(result.human_scores)) {
      humanScores[model] = scores;
    }
    set({
      activeEval: {
        id: result.id,
        prompt: result.prompt,
        models: result.models,
        blindLabels: buildBlindLabels(result.id, result.models),
        modelStates,
        complete: true,
        created_at: result.created_at * 1000,
        suite_id: result.suite_id ?? null,
        suite_run_id: result.suite_run_id ?? null,
        suite_prompt_id: result.suite_prompt_id ?? null,
        judge: result.judge ?? null,
        is_goal_eval: result.is_goal_eval ?? false,
      },
      humanScores,
      scoresDirty: false,
      evalOpen: true,
      ...(result.is_goal_eval ? { blindMode: true } : {}),
    });
  },

  setHumanScore: (model, dimension, value) =>
    set((s) => ({
      humanScores: {
        ...s.humanScores,
        [model]: { ...(s.humanScores[model] ?? {}), [dimension]: value },
      },
      scoresDirty: true,
    })),

  markHumanScoresSaved: () => set({ scoresDirty: false }),

  clearHumanScores: () => set({ humanScores: {}, scoresDirty: false }),

  openEval: () => set({ evalOpen: true }),
  closeEval: () => set({ evalOpen: false }),
  toggleBlind: () => set((s) => ({ blindMode: !s.blindMode })),
  setBlindMode: (blindMode) => set({ blindMode }),

  startSuite: (run) => set({ activeSuite: run }),
  advanceSuite: (eval_id) =>
    set((s) =>
      s.activeSuite
        ? {
            activeSuite: {
              ...s.activeSuite,
              current_index: s.activeSuite.current_index + 1,
              finished_eval_ids: [...s.activeSuite.finished_eval_ids, eval_id],
            },
          }
        : s
    ),
  finishSuite: () => set({ activeSuite: null }),
}));
