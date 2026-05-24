import type { AutoScores, GoalGrade, HumanScores, JudgeScores, ManualReview } from "../bindings";
import type { ActiveEval, EvalModelState } from "../stores/evalStore";
import { HUMAN_SCORE_KEYS } from "../stores/evalStore";

export type EvalScoreSource = "blend" | "human" | "judge" | "goal" | "auto" | "kpi" | "none";
export type ComparisonKpiKey = "quality" | "reasoning" | "speed" | "efficiency" | "cost";
export type ComparisonDecision = "clear" | "close" | "tie" | "single" | "unscored";

export type ComparisonKpi = {
  key: ComparisonKpiKey;
  label: string;
  score: number | null;
  detail: string;
};

export type ComparisonDimensionValue = {
  model: string;
  displayName: string;
  score: number | null;
  source: EvalScoreSource;
};

export type ComparisonDimensionRow = {
  key: keyof HumanScores;
  label: string;
  values: ComparisonDimensionValue[];
};

export type ComparisonAreaLeader = {
  key: keyof HumanScores;
  label: string;
  model: string;
  displayName: string;
  score: number;
  source: EvalScoreSource;
  margin: number | null;
};

export type ModelComparisonResult = {
  model: string;
  displayName: string;
  finalScore: number | null;
  aiScore: number | null;
  humanScore: number | null;
  generalScore: number | null;
  generalSource: EvalScoreSource;
  rank: number | null;
  scoreMargin: number | null;
  confidence: ComparisonDecision;
  why: string;
  manualScore: number | null;
  manualNotes: string;
  manualUpdatedAt: number | null;
  kpis: ComparisonKpi[];
  dimensions: Partial<Record<keyof HumanScores, ComparisonDimensionValue>>;
};

export type EvalComparison = {
  models: ModelComparisonResult[];
  dimensionRows: ComparisonDimensionRow[];
  areaLeaders: ComparisonAreaLeader[];
  winner: ModelComparisonResult | null;
  winnerMargin: number | null;
  decision: ComparisonDecision;
  hasScores: boolean;
};

export const FINAL_AI_WEIGHT = 0.65;
export const FINAL_HUMAN_WEIGHT = 0.35;

export const COMPARISON_DIMENSION_LABELS: Record<keyof HumanScores, string> = {
  accuracy: "Task Fit",
  helpfulness: "Usability",
  quality: "Result Quality",
  creativity: "Creativity",
  design: "Design",
  aesthetics: "Visual Polish",
  ai_slop: "Cleanliness",
  brevity: "Focus",
};

export const SCORE_SOURCE_LABELS: Record<EvalScoreSource, string> = {
  blend: "AI + human",
  human: "Human visual",
  judge: "LLM judge",
  goal: "Goal grade",
  auto: "Auto text",
  kpi: "AI KPI",
  none: "Unscored",
};

const KPI_LABELS: Record<ComparisonKpiKey, string> = {
  quality: "Output quality",
  reasoning: "Reasoning",
  speed: "Speed",
  efficiency: "Token efficiency",
  cost: "Cost efficiency",
};

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
  "claude-opus-4-7": { input: 15, output: 75 },
  "kimi2.6": { input: 1, output: 2 },
  "kimi-coding": { input: 2, output: 6 },
  "minimax2.7": { input: 0.5, output: 1.5 },
  "deepseek-v4-flash": { input: 0.14, output: 0.28 },
  "deepseek-v4-pro": { input: 0.435, output: 0.87 },
  "bedrock-claude-sonnet-4-5": { input: 3, output: 15 },
  "bedrock-claude-opus-4-5": { input: 15, output: 75 },
  "bedrock-claude-haiku-4-5": { input: 0.8, output: 4 },
  "bedrock-nova-pro": { input: 0.8, output: 3.2 },
  "bedrock-nova-lite": { input: 0.06, output: 0.24 },
  "bedrock-llama-3.3-70b": { input: 0.72, output: 0.72 },
};

type BuildEvalComparisonInput = {
  activeEval: ActiveEval;
  humanScores: Record<string, Partial<HumanScores>>;
  manualReviews?: Record<string, ManualReview>;
  blindNames?: Record<string, string>;
};

type ModelMetricContext = {
  model: string;
  state: EvalModelState;
  tokens: number;
  duration: number;
  throughput: number;
  cost: number;
};

export function buildEvalComparison({
  activeEval,
  humanScores,
  manualReviews = {},
  blindNames = {},
}: BuildEvalComparisonInput): EvalComparison {
  const models = activeEval.models.filter((model) => hasScoreableOutput(activeEval.modelStates[model]));
  const displayNameFor = (model: string) => blindNames[model] ?? model;
  const metricContext = models.map((model) => {
    const state = activeEval.modelStates[model];
    const duration = Math.max(1, state.duration_ms || 0);
    const tokens = Math.max(1, (state.input_tokens || 0) + (state.output_tokens || 0));
    return {
      model,
      state,
      tokens,
      duration,
      throughput: state.output_tokens > 0 ? state.output_tokens / (duration / 1000) : 0,
      cost: calcCost(model, state.input_tokens, state.output_tokens),
    };
  });
  const metricsByModel = Object.fromEntries(metricContext.map((ctx) => [ctx.model, ctx]));

  const dimensionRows = HUMAN_SCORE_KEYS.map((key) => ({
    key,
    label: COMPARISON_DIMENSION_LABELS[key],
    values: models.map((model) => dimensionValue(
      model,
      displayNameFor(model),
      key,
      humanScores[model],
      activeEval.judge,
      activeEval.modelStates[model]?.auto
    )),
  }));

  const areaLeaders = dimensionRows.flatMap((row) => {
    const scored = row.values
      .filter((value): value is ComparisonDimensionValue & { score: number } => value.score !== null)
      .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));
    if (scored.length === 0) return [];
    return [{
      key: row.key,
      label: row.label,
      model: scored[0].model,
      displayName: scored[0].displayName,
      score: scored[0].score,
      source: scored[0].source,
      margin: scored[1] ? scored[0].score - scored[1].score : null,
    }];
  });

  const modelResults: ModelComparisonResult[] = models.map((model) => {
    const state = activeEval.modelStates[model];
    const kpis = buildAiKpis(model, state, activeEval.judge, metricsByModel[model], metricContext);
    const aiScore = averageScores(kpis.map((kpi) => kpi.score));
    const humanScore = averageScores(HUMAN_SCORE_KEYS.map((key) => humanScores[model]?.[key] ?? null));
    const finalScore = blendScores(aiScore, humanScore);
    const review = manualReviews[model];
    const dimensions = Object.fromEntries(
      dimensionRows.map((row) => [row.key, row.values.find((value) => value.model === model)])
    ) as Partial<Record<keyof HumanScores, ComparisonDimensionValue>>;

    return {
      model,
      displayName: displayNameFor(model),
      finalScore,
      aiScore,
      humanScore,
      generalScore: finalScore,
      generalSource: finalScore === null ? "none" : aiScore !== null && humanScore !== null ? "blend" : aiScore !== null ? "kpi" : "human",
      rank: null,
      scoreMargin: null,
      confidence: "unscored",
      why: summarizeScore({ aiScore, humanScore, finalScore, kpis, human: humanScores[model] }),
      manualScore: cleanScore(review?.score ?? null),
      manualNotes: review?.notes ?? "",
      manualUpdatedAt: review?.updated_at ?? null,
      kpis,
      dimensions,
    };
  });

  modelResults.sort((a, b) => {
    const aScore = a.finalScore ?? -1;
    const bScore = b.finalScore ?? -1;
    return bScore - aScore || a.displayName.localeCompare(b.displayName);
  });

  assignRanksAndConfidence(modelResults);
  const winner = modelResults.find((model) => model.finalScore !== null) ?? null;

  return {
    models: modelResults,
    dimensionRows,
    areaLeaders,
    winner,
    winnerMargin: winner?.scoreMargin ?? null,
    decision: winner?.confidence ?? "unscored",
    hasScores: modelResults.some((model) => model.finalScore !== null),
  };
}

const SCORE_TIE_EPSILON = 0.05;
const CLOSE_MARGIN = 0.5;

function assignRanksAndConfidence(models: ModelComparisonResult[]) {
  let previousScore: number | null = null;
  let previousRank: number | null = null;

  for (let index = 0; index < models.length; index++) {
    const model = models[index];
    const score = model.finalScore;
    if (score === null) {
      model.rank = null;
      model.scoreMargin = null;
      model.confidence = "unscored";
      continue;
    }

    if (previousScore !== null && previousRank !== null && Math.abs(previousScore - score) <= SCORE_TIE_EPSILON) {
      model.rank = previousRank;
    } else {
      model.rank = index + 1;
    }
    previousScore = score;
    previousRank = model.rank;

    const above = models[index - 1]?.finalScore ?? null;
    const below = models[index + 1]?.finalScore ?? null;
    const margin = model.rank === 1
      ? below === null ? null : Math.max(0, score - below)
      : above === null ? null : Math.max(0, above - score);

    model.scoreMargin = margin;
    if (margin === null) {
      model.confidence = "single";
    } else if (margin <= SCORE_TIE_EPSILON) {
      model.confidence = "tie";
    } else if (margin < CLOSE_MARGIN) {
      model.confidence = "close";
    } else {
      model.confidence = "clear";
    }
  }
}

function hasScoreableOutput(state: EvalModelState | undefined): state is EvalModelState {
  if (!state || state.status === "error" || state.error) return false;
  return state.content.trim().length > 0 || state.reasoning.trim().length > 0;
}

function buildAiKpis(
  model: string,
  state: EvalModelState,
  judge: JudgeScores | null | undefined,
  ctx: ModelMetricContext,
  all: ModelMetricContext[]
): ComparisonKpi[] {
  const quality = qualityScore(model, state.auto, judge, state.goalGrade);
  const reasoning = reasoningScore(state);
  const latencyScore = relativeLowerIsBetter(ctx.duration, all.map((item) => item.duration));
  const throughputScore = relativeHigherIsBetter(ctx.throughput, all.map((item) => item.throughput));
  const speed = averageScores([latencyScore, throughputScore]);
  const tokenScore = relativeLowerIsBetter(ctx.tokens, all.map((item) => item.tokens));
  const costScore = relativeLowerIsBetter(ctx.cost, all.map((item) => item.cost));
  const efficiency = averageScores([tokenScore, costScore]);

  return [
    {
      key: "quality",
      label: KPI_LABELS.quality,
      score: quality.score,
      detail: quality.detail,
    },
    {
      key: "reasoning",
      label: KPI_LABELS.reasoning,
      score: reasoning.score,
      detail: reasoning.detail,
    },
    {
      key: "speed",
      label: KPI_LABELS.speed,
      score: speed,
      detail: `${formatMs(ctx.duration)} latency, ${ctx.throughput.toFixed(1)} tok/s`,
    },
    {
      key: "efficiency",
      label: KPI_LABELS.efficiency,
      score: efficiency,
      detail: `${ctx.tokens.toLocaleString()} total tokens`,
    },
    {
      key: "cost",
      label: KPI_LABELS.cost,
      score: costScore,
      detail: `$${ctx.cost.toFixed(4)} estimated`,
    },
  ];
}

function dimensionValue(
  model: string,
  displayName: string,
  key: keyof HumanScores,
  human: Partial<HumanScores> | undefined,
  judge: JudgeScores | null | undefined,
  auto: AutoScores | undefined
): ComparisonDimensionValue {
  const humanScore = cleanScore(human?.[key] ?? null);
  if (humanScore !== null) return { model, displayName, score: humanScore, source: "human" };

  const judgeScore = cleanScore(judge?.scores?.[model]?.[key] ?? null);
  if (judgeScore !== null) return { model, displayName, score: judgeScore, source: "judge" };

  const autoScore = autoScoreForDimension(key, auto);
  if (autoScore !== null) return { model, displayName, score: autoScore, source: "auto" };

  return { model, displayName, score: null, source: "none" };
}

function qualityScore(
  model: string,
  auto: AutoScores | undefined,
  judge: JudgeScores | null | undefined,
  grade: GoalGrade | undefined
): { score: number | null; detail: string } {
  const judgeScores = judge?.scores?.[model];
  const judgeAverage = averageScores(HUMAN_SCORE_KEYS.map((key) => judgeScores?.[key] ?? null));
  if (judgeAverage !== null) return { score: judgeAverage, detail: judge?.rationale?.[model] ?? "LLM judge rubric average" };

  const goal = goalGradeScore(grade);
  if (goal !== null) return { score: goal, detail: grade?.summary || "Goal grade average" };

  const autoAverage = averageScores([auto?.ai_slop_score ?? null, auto?.brevity_score ?? null]);
  if (autoAverage !== null) return { score: autoAverage, detail: "Auto anti-slop and brevity checks" };

  return { score: null, detail: "No AI quality signal yet" };
}

function reasoningScore(state: EvalModelState): { score: number | null; detail: string } {
  const goal = goalGradeScore(state.goalGrade);
  if (goal !== null) return { score: goal, detail: state.goalGrade?.summary || "Goal reasoning rubric" };

  if (!state.reasoning.trim()) return { score: null, detail: "No reasoning trace exposed" };
  const flagPenalty = state.flags.reduce((sum, flag) => {
    if (flag.severity === "error") return sum + 2;
    if (flag.severity === "warn") return sum + 1;
    return sum;
  }, 0);
  const lengthBonus = state.reasoning.length > 800 ? 1 : state.reasoning.length > 240 ? 0.5 : 0;
  return {
    score: Math.max(1, Math.min(10, 6.5 + lengthBonus - flagPenalty)),
    detail: `${state.reasoning.length.toLocaleString()} reasoning chars, ${state.flags.length} flags`,
  };
}

function goalGradeScore(grade: GoalGrade | undefined): number | null {
  if (!grade) return null;
  const values = Object.values(grade.axes).map((axis) => axis.score);
  const avg = averageScores(values);
  return avg === null ? null : (avg / 5) * 10;
}

function autoScoreForDimension(key: keyof HumanScores, auto: AutoScores | undefined): number | null {
  if (!auto) return null;
  if (key === "ai_slop") return cleanScore(auto.ai_slop_score);
  if (key === "brevity") return cleanScore(auto.brevity_score);
  return null;
}

function blendScores(aiScore: number | null, humanScore: number | null): number | null {
  if (aiScore !== null && humanScore !== null) {
    return aiScore * FINAL_AI_WEIGHT + humanScore * FINAL_HUMAN_WEIGHT;
  }
  return aiScore ?? humanScore ?? null;
}

function summarizeScore({
  aiScore,
  humanScore,
  finalScore,
  kpis,
  human,
}: {
  aiScore: number | null;
  humanScore: number | null;
  finalScore: number | null;
  kpis: ComparisonKpi[];
  human: Partial<HumanScores> | undefined;
}): string {
  if (finalScore === null) return "No saved scoring signal is available for this model yet.";
  const strongestKpi = [...kpis]
    .filter((kpi): kpi is ComparisonKpi & { score: number } => kpi.score !== null)
    .sort((a, b) => b.score - a.score)[0];
  const qualityDetail = kpis.find((kpi) => kpi.key === "quality" && kpi.score !== null)?.detail;
  const strongestHuman = strongestHumanDimension(human);
  const pieces = [];
  if (aiScore !== null) {
    const detail = qualityDetail && !qualityDetail.startsWith("Auto ") ? `; quality: ${qualityDetail}` : "";
    pieces.push(`AI KPI ${aiScore.toFixed(1)}${strongestKpi ? ` led by ${strongestKpi.label.toLowerCase()}` : ""}${detail}`);
  }
  if (humanScore !== null) pieces.push(`human visual ${humanScore.toFixed(1)}${strongestHuman ? ` strongest in ${strongestHuman.label.toLowerCase()}` : ""}`);
  return `${pieces.join("; ")}. Final score is ${finalScore.toFixed(1)}.`;
}

function strongestHumanDimension(scores: Partial<HumanScores> | undefined): { label: string; score: number } | null {
  const values = HUMAN_SCORE_KEYS
    .map((key) => ({
      label: COMPARISON_DIMENSION_LABELS[key],
      score: cleanScore(scores?.[key] ?? null),
    }))
    .filter((value): value is { label: string; score: number } => value.score !== null)
    .sort((a, b) => b.score - a.score);
  return values[0] ?? null;
}

function averageScores(values: Array<number | null | undefined>): number | null {
  const cleaned = values
    .map(cleanScore)
    .filter((value): value is number => value !== null);
  if (cleaned.length === 0) return null;
  return cleaned.reduce((sum, value) => sum + value, 0) / cleaned.length;
}

function relativeLowerIsBetter(value: number, values: number[]): number {
  const finite = values.filter((item) => Number.isFinite(item) && item > 0);
  if (finite.length <= 1) return 8;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (max === min) return 8;
  return 1 + 9 * ((max - value) / (max - min));
}

function relativeHigherIsBetter(value: number, values: number[]): number {
  const finite = values.filter((item) => Number.isFinite(item) && item >= 0);
  if (finite.length <= 1) return value > 0 ? 8 : 5;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (max === min) return max > 0 ? 8 : 5;
  return 1 + 9 * ((value - min) / (max - min));
}

function cleanScore(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.max(1, Math.min(10, value));
}

function calcCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? { input: 1, output: 3 };
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

function formatMs(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}
