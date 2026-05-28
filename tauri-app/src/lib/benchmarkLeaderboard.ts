import type { EvalResult, HumanScores, ManualReview } from "../bindings";
import type { ActiveEval, EvalModelState } from "../stores/evalStore";
import { HUMAN_SCORE_KEYS } from "../stores/evalStore";
import {
  buildEvalComparison,
  type ComparisonKpiKey,
  type ModelComparisonResult,
} from "./evalComparison";

export type BenchmarkAreaKey =
  | "overall"
  | "swe_pro"
  | "reasoning"
  | "instruction"
  | "safety"
  | "speed_cost"
  | "frontend_design";

export type BenchmarkAreaIcon = "emperor" | "architect" | "design" | "speed";

export type BenchmarkAreaDefinition = {
  key: BenchmarkAreaKey;
  label: string;
  shortLabel: string;
  detail: string;
  icon: BenchmarkAreaIcon;
};

export type BenchmarkLeaderboardEntry = {
  model: string;
  rank: number;
  averageScore: number;
  trialCount: number;
  winCount: number;
  evalCount: number;
  lastSeenAt: number | null;
  sourceLabel: string;
};

export type BenchmarkAreaSummary = {
  area: BenchmarkAreaDefinition;
  entries: BenchmarkLeaderboardEntry[];
  evalCount: number;
  trialCount: number;
};

export type BenchmarkLeaderboard = {
  areas: BenchmarkAreaSummary[];
  evalCount: number;
  lastUpdatedAt: number | null;
};

type AreaContribution = {
  score: number;
  sourceLabel: string;
};

type AreaAccumulator = {
  model: string;
  scoreSum: number;
  trialCount: number;
  winCount: number;
  evalIds: Set<string>;
  lastSeenAt: number | null;
  sourceCounts: Map<string, number>;
};

export const BENCHMARK_AREAS: BenchmarkAreaDefinition[] = [
  {
    key: "overall",
    label: "Overall",
    shortLabel: "Overall",
    detail: "Blended ranking across every saved eval with a score signal.",
    icon: "emperor",
  },
  {
    key: "swe_pro",
    label: "SWE-Pro Style",
    shortLabel: "SWE",
    detail: "Repository-scale coding prompts, patch discipline, and deterministic correctness.",
    icon: "architect",
  },
  {
    key: "reasoning",
    label: "Reasoning",
    shortLabel: "Reasoning",
    detail: "Logic, goal decomposition, self-correction, and plan coherence.",
    icon: "emperor",
  },
  {
    key: "instruction",
    label: "Instruction + JSON",
    shortLabel: "Format",
    detail: "Strict formatting, schema adherence, and constrained outputs.",
    icon: "architect",
  },
  {
    key: "safety",
    label: "Safety",
    shortLabel: "Safety",
    detail: "Refusal behavior for harmful requests without procedural leakage.",
    icon: "emperor",
  },
  {
    key: "speed_cost",
    label: "Speed + Cost",
    shortLabel: "Speed",
    detail: "Latency, throughput, token efficiency, and estimated spend.",
    icon: "speed",
  },
  {
    key: "frontend_design",
    label: "Human Frontend + Design",
    shortLabel: "Design",
    detail: "Human-scored visual polish, layout judgment, and creative execution.",
    icon: "design",
  },
];

export function buildBenchmarkLeaderboard(results: EvalResult[]): BenchmarkLeaderboard {
  const comparisons = results
    .map((result) => {
      const activeEval = activeEvalFromResult(result);
      const comparison = buildEvalComparison({
        activeEval,
        humanScores: result.human_scores ?? {},
        manualReviews: result.manual_reviews ?? {},
      });
      return { result, comparison };
    })
    .filter(({ comparison }) => comparison.models.length > 0);

  const areaMaps = new Map<BenchmarkAreaKey, Map<string, AreaAccumulator>>();
  const areaEvalIds = new Map<BenchmarkAreaKey, Set<string>>();

  for (const { result, comparison } of comparisons) {
    for (const area of BENCHMARK_AREAS) {
      const scored = comparison.models
        .map((model) => ({
          model,
          contribution: contributionForArea(area.key, result, model),
        }))
        .filter((item): item is { model: ModelComparisonResult; contribution: AreaContribution } =>
          item.contribution !== null
        );

      if (scored.length === 0) continue;
      const topScore = Math.max(...scored.map((item) => item.contribution.score));
      const topModels = scored.filter((item) => Math.abs(item.contribution.score - topScore) <= 0.05);
      const topModelKeys = new Set(topModels.map((item) => item.model.model));
      const modelMap = getAreaMap(areaMaps, area.key);
      getEvalSet(areaEvalIds, area.key).add(result.id);

      for (const { model, contribution } of scored) {
        const acc = getAccumulator(modelMap, model.model);
        acc.scoreSum += contribution.score;
        acc.trialCount += 1;
        acc.evalIds.add(result.id);
        acc.lastSeenAt = Math.max(acc.lastSeenAt ?? 0, result.created_at ?? 0);
        acc.sourceCounts.set(
          contribution.sourceLabel,
          (acc.sourceCounts.get(contribution.sourceLabel) ?? 0) + 1
        );
        if (topModelKeys.has(model.model)) acc.winCount += 1;
      }
    }
  }

  const areas = BENCHMARK_AREAS.map((area) => {
    const modelMap = areaMaps.get(area.key) ?? new Map<string, AreaAccumulator>();
    const entries = Array.from(modelMap.values())
      .map((acc) => ({
        model: acc.model,
        rank: 0,
        averageScore: acc.scoreSum / Math.max(1, acc.trialCount),
        trialCount: acc.trialCount,
        winCount: acc.winCount,
        evalCount: acc.evalIds.size,
        lastSeenAt: acc.lastSeenAt,
        sourceLabel: dominantSource(acc.sourceCounts),
      }))
      .sort((a, b) => b.averageScore - a.averageScore || b.trialCount - a.trialCount || a.model.localeCompare(b.model));

    assignRanks(entries);

    return {
      area,
      entries,
      evalCount: areaEvalIds.get(area.key)?.size ?? 0,
      trialCount: entries.reduce((sum, entry) => sum + entry.trialCount, 0),
    };
  });

  return {
    areas,
    evalCount: comparisons.length,
    lastUpdatedAt: comparisons.reduce<number | null>(
      (latest, { result }) => latest === null ? result.created_at : Math.max(latest, result.created_at),
      null
    ),
  };
}

export function benchmarkAreaByKey(key: BenchmarkAreaKey): BenchmarkAreaDefinition {
  return BENCHMARK_AREAS.find((area) => area.key === key) ?? BENCHMARK_AREAS[0];
}

function contributionForArea(
  area: BenchmarkAreaKey,
  result: EvalResult,
  model: ModelComparisonResult,
): AreaContribution | null {
  if (area === "overall") return contribution(model.finalScore, "final score");

  if (area === "swe_pro") {
    if (result.suite_id !== "swe-pro" && result.suite_id !== "coding") return null;
    return contribution(model.finalScore, result.suite_id === "swe-pro" ? "SWE-Pro style" : "coding suite");
  }

  if (area === "reasoning") {
    if (result.suite_id === "reasoning") return contribution(model.finalScore, "reasoning suite");
    if (result.is_goal_eval) {
      const reasoning = kpiScore(model, "reasoning");
      const quality = kpiScore(model, "quality");
      return contribution(averageNumbers([reasoning, quality]), "goal reasoning");
    }
    return null;
  }

  if (area === "instruction") {
    if (result.suite_id !== "instruction" && result.suite_id !== "json") return null;
    return contribution(model.finalScore, result.suite_id === "json" ? "JSON suite" : "instruction suite");
  }

  if (area === "safety") {
    if (result.suite_id !== "refusal") return null;
    return contribution(model.finalScore, "refusal suite");
  }

  if (area === "speed_cost") {
    return contribution(
      averageNumbers([
        kpiScore(model, "speed"),
        kpiScore(model, "efficiency"),
        kpiScore(model, "cost"),
      ]),
      "telemetry"
    );
  }

  if (area === "frontend_design") {
    if (!isFrontendDesignEval(result)) return null;
    const scores = result.human_scores?.[model.model];
    return contribution(humanFrontendScore(scores), "human visual");
  }

  return null;
}

function activeEvalFromResult(result: EvalResult): ActiveEval {
  const byModel = new Map(result.results.map((item) => [item.model, item]));
  const modelStates: Record<string, EvalModelState> = {};

  for (const model of result.models) {
    const item = byModel.get(model);
    modelStates[model] = {
      model,
      status: item?.error ? "error" : "done",
      content: item?.content ?? "",
      reasoning: result.reasoning_traces?.[model] ?? "",
      flags: result.goal_grades?.[model]?.flags ?? [],
      input_tokens: item?.input_tokens ?? 0,
      output_tokens: item?.output_tokens ?? 0,
      duration_ms: item?.duration_ms ?? 0,
      error: item?.error ?? undefined,
      auto: result.auto_scores?.[model],
      goalGrade: result.goal_grades?.[model],
    };
  }

  return {
    id: result.id,
    prompt: result.prompt,
    models: result.models,
    blindLabels: Object.fromEntries(result.models.map((model) => [model, model])),
    modelStates,
    complete: true,
    created_at: result.created_at * 1000,
    suite_id: result.suite_id ?? null,
    suite_run_id: result.suite_run_id ?? null,
    suite_prompt_id: result.suite_prompt_id ?? null,
    judge: result.judge ?? null,
    is_goal_eval: result.is_goal_eval ?? false,
    live_supervisor: false,
  };
}

function isFrontendDesignEval(result: EvalResult): boolean {
  if (result.suite_id === "frontend-design") return true;
  if (result.suite_id && result.suite_id !== "creative") return false;
  return /\b(?:frontend|front-end|design|visual|ui|ux|layout|aesthetic|website|landing|dashboard|component|prototype|html|css|animation|responsive)\b/i
    .test(result.prompt);
}

function humanFrontendScore(scores: Partial<HumanScores> | undefined): number | null {
  if (!scores) return null;
  return averageNumbers([
    cleanScore(scores.design),
    cleanScore(scores.aesthetics),
    cleanScore(scores.creativity),
  ]);
}

function kpiScore(model: ModelComparisonResult, key: ComparisonKpiKey): number | null {
  return model.kpis.find((kpi) => kpi.key === key)?.score ?? null;
}

function contribution(score: number | null, sourceLabel: string): AreaContribution | null {
  const cleaned = cleanScore(score);
  return cleaned === null ? null : { score: cleaned, sourceLabel };
}

function averageNumbers(values: Array<number | null | undefined>): number | null {
  const cleaned = values
    .map(cleanScore)
    .filter((value): value is number => value !== null);
  if (cleaned.length === 0) return null;
  return cleaned.reduce((sum, value) => sum + value, 0) / cleaned.length;
}

function cleanScore(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.max(1, Math.min(10, value));
}

function getAreaMap(
  maps: Map<BenchmarkAreaKey, Map<string, AreaAccumulator>>,
  key: BenchmarkAreaKey,
): Map<string, AreaAccumulator> {
  let map = maps.get(key);
  if (!map) {
    map = new Map();
    maps.set(key, map);
  }
  return map;
}

function getEvalSet(
  maps: Map<BenchmarkAreaKey, Set<string>>,
  key: BenchmarkAreaKey,
): Set<string> {
  let set = maps.get(key);
  if (!set) {
    set = new Set();
    maps.set(key, set);
  }
  return set;
}

function getAccumulator(map: Map<string, AreaAccumulator>, model: string): AreaAccumulator {
  let acc = map.get(model);
  if (!acc) {
    acc = {
      model,
      scoreSum: 0,
      trialCount: 0,
      winCount: 0,
      evalIds: new Set(),
      lastSeenAt: null,
      sourceCounts: new Map(),
    };
    map.set(model, acc);
  }
  return acc;
}

function dominantSource(sourceCounts: Map<string, number>): string {
  return Array.from(sourceCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "score";
}

function assignRanks(entries: BenchmarkLeaderboardEntry[]) {
  let previousScore: number | null = null;
  let previousRank = 0;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (previousScore !== null && Math.abs(previousScore - entry.averageScore) <= 0.05) {
      entry.rank = previousRank;
    } else {
      entry.rank = index + 1;
    }
    previousScore = entry.averageScore;
    previousRank = entry.rank;
  }
}

export function hasHumanScoreSignal(scores: Record<string, Partial<HumanScores>>): boolean {
  return Object.values(scores).some((modelScores) =>
    HUMAN_SCORE_KEYS.some((key) => cleanScore(modelScores[key]) !== null)
  );
}

export function manualReviewCount(manualReviews: Record<string, ManualReview> | undefined): number {
  return Object.values(manualReviews ?? {}).filter((review) =>
    cleanScore(review.score) !== null || review.notes.trim().length > 0
  ).length;
}
