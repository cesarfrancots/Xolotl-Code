import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense, Component, type ReactNode } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  FlaskConical, Play, RotateCcw, ChevronDown, ChevronUp, Save,
  Eye, EyeOff, Trophy, History, ListChecks, Gavel, Trash2,
  Target, AlertTriangle, Activity, ShieldCheck, ScanSearch, Gauge,
  CheckCircle2, CircleDot, ExternalLink, MonitorPlay,
} from "lucide-react";
import { Button } from "../ui/button";
import { commands } from "../../bindings";
import type { HumanScores, EvalSuite, EvalMeta, EvalResult, ReasoningFlag, GoalGrade, JudgeScores, ManualReview, ReliabilityMetrics } from "../../bindings";
import { HUMAN_SCORE_KEYS, buildBlindLabels, getBlindReviewProgress, getReviewOrder, useEvalStore } from "../../stores/evalStore";
import { MarkdownRenderer } from "../chat/MarkdownRenderer";
import {
  assessBlindResultsGate,
  assessBlindReviewGate,
  determineEvalReviewMode,
  evalReviewModeBadge,
  resolveVisibleEvalStage,
  shouldShowHumanReviewStage,
  assessGoalEvalReadiness,
  assessGoalWorkflowSteps,
  type BlindResultsGate,
  type EvalFlowStage,
  type EvalReviewMode,
  type GoalEvalReadiness,
  type GoalReadinessState,
  type GoalWorkflowStep,
} from "../../lib/evalReadiness";
import { arenaCreatureClass, arenaCreatureStatusLabel } from "../../lib/evalArena";
import { calibrationVerdict, reliabilityRows, type CalibrationTone } from "../../lib/reliability";

const ReliabilityDashboard = lazy(() => import("./ReliabilityDashboard"));

/** Contains a crash in the lazy flywheel dashboard so it can't unmount the whole Eval Lab. */
class DashboardErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="px-4 py-10 text-center">
        <div className="mx-auto max-w-md rounded-md border border-[oklch(0.34_0.035_28)] bg-[oklch(0.13_0.010_28)] px-4 py-3 text-sm text-[oklch(0.78_0.055_28)]">
          <div className="font-semibold">Flywheel view failed</div>
          <div className="mt-1 text-xs leading-relaxed text-[oklch(0.68_0.045_28)]">{this.state.error.message}</div>
        </div>
      </div>
    );
  }
}
import { extractEvalArtifacts, type EvalArtifact } from "../../lib/evalArtifacts";
import { buildEvalComparison, FINAL_AI_WEIGHT, FINAL_HUMAN_WEIGHT, SCORE_SOURCE_LABELS, type EvalComparison } from "../../lib/evalComparison";
import {
  BENCHMARK_AREAS,
  benchmarkAreaByKey,
  buildBenchmarkLeaderboard,
  type BenchmarkAreaIcon,
  type BenchmarkAreaKey,
  type BenchmarkLeaderboard,
} from "../../lib/benchmarkLeaderboard";

const UI_ACCENT = "oklch(0.70 0.07 190)";
const UI_ACCENT_DIM = "oklch(0.58 0.045 205)";
const UI_WARNING = "oklch(0.72 0.08 72)";
const UI_SUCCESS = "oklch(0.70 0.07 155)";
const UI_MUTED = "oklch(0.62 0.012 230)";

const GOAL_AXES: { key: string; label: string; color: string; hint: string }[] = [
  { key: "goal_decomposition",    label: "Goal Decomposition",  color: UI_ACCENT, hint: "Does it break the goal into right sub-tasks?" },
  { key: "assumption_quality",    label: "Assumption Quality",  color: UI_ACCENT_DIM, hint: "Are assumptions explicit and reasonable?" },
  { key: "self_correction",       label: "Self-Correction",     color: UI_SUCCESS, hint: "Does it catch and fix its own mistakes?" },
  { key: "plan_action_coherence", label: "Planâ†”Action",         color: UI_WARNING,  hint: "Do actions match the stated plan?" },
  { key: "goal_achievement",      label: "Goal Achievement",    color: UI_MUTED,  hint: "Was the goal actually reached?" },
];

const SCORE_DIMENSIONS: { key: keyof HumanScores; label: string; color: string }[] = [
  { key: "accuracy",    label: "Accuracy",    color: UI_ACCENT },
  { key: "helpfulness", label: "Helpfulness", color: UI_ACCENT_DIM },
  { key: "quality",     label: "Quality",     color: UI_ACCENT },
  { key: "creativity",  label: "Creativity",  color: UI_MUTED },
  { key: "design",      label: "Design",      color: UI_ACCENT_DIM },
  { key: "aesthetics",  label: "Aesthetics",  color: UI_MUTED },
  { key: "ai_slop",     label: "Anti-Slop",   color: UI_WARNING },
  { key: "brevity",     label: "Brevity",     color: UI_SUCCESS },
];

const SCORE_DIMENSION_COUNT = HUMAN_SCORE_KEYS.length;
const EMPTY_HUMAN_SCORES: Partial<HumanScores> = {};

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6":           { input: 3,   output: 15 },
  "claude-haiku-4-5-20251001":   { input: 0.8, output: 4 },
  "claude-opus-4-7":             { input: 15,  output: 75 },
  "kimi2.6":                     { input: 1,   output: 2 },
  "kimi-coding":                 { input: 2,   output: 6 },
  "minimax2.7":                  { input: 0.5, output: 1.5 },
  "deepseek-v4-flash":           { input: 0.14, output: 0.28 },
  "deepseek-v4-pro":             { input: 0.435, output: 0.87 },
  "bedrock-claude-sonnet-4-5":   { input: 3,   output: 15 },
  "bedrock-claude-opus-4-5":     { input: 15,  output: 75 },
  "bedrock-claude-haiku-4-5":    { input: 0.8, output: 4 },
  "bedrock-nova-pro":            { input: 0.8, output: 3.2 },
  "bedrock-nova-lite":           { input: 0.06, output: 0.24 },
  "bedrock-llama-3.3-70b":       { input: 0.72, output: 0.72 },
};

const PROVIDER_OF: Record<string, string> = {
  "claude-sonnet-4-6": "Anthropic",
  "claude-haiku-4-5-20251001": "Anthropic",
  "claude-opus-4-7": "Anthropic",
  "kimi2.6": "Moonshot",
  "kimi-coding": "Kimi For Coding",
  "minimax2.7": "MiniMax",
  "deepseek-v4-flash": "DeepSeek",
  "deepseek-v4-pro": "DeepSeek",
  "bedrock-claude-sonnet-4-5": "AWS Bedrock",
  "bedrock-claude-opus-4-5": "AWS Bedrock",
  "bedrock-claude-haiku-4-5": "AWS Bedrock",
  "bedrock-nova-pro": "AWS Bedrock",
  "bedrock-nova-lite": "AWS Bedrock",
  "bedrock-llama-3.3-70b": "AWS Bedrock",
};

function calcCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? { input: 1, output: 3 };
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
/** Live tok/sec while streaming. Falls back to final-duration calc when done. */
function tokensPerSec(state: { output_tokens: number; duration_ms: number; status: string; started_at?: number; content: string }): number {
  if (state.status === "done" && state.duration_ms > 0 && state.output_tokens > 0) {
    return (state.output_tokens / state.duration_ms) * 1000;
  }
  if (state.status === "running" && state.started_at) {
    const elapsed = (Date.now() - state.started_at) / 1000;
    if (elapsed < 0.3) return 0;
    // Approximate live tokens from char count (1 tok â‰ˆ 4 chars).
    return state.content.length / 4 / elapsed;
  }
  return 0;
}

function hasScoreableOutput(state: { status: string; content: string; error?: string } | undefined): boolean {
  return Boolean(state && state.status === "done" && !state.error && state.content.trim().length > 0);
}

type ArtifactLaunchState = "idle" | "starting" | "ok" | "error";

type ModelAvatarMeta = {
  initials: string;
  provider: string;
  bg: string;
  fg: string;
};

function modelAvatarMeta(model: string): ModelAvatarMeta {
  const lower = model.toLowerCase();
  if (lower.includes("deepseek")) return { initials: "DS", provider: "DeepSeek", bg: "oklch(0.24 0.040 250)", fg: "oklch(0.84 0.060 250)" };
  if (lower.includes("claude") || lower.includes("anthropic")) return { initials: "C", provider: "Claude", bg: "oklch(0.25 0.045 38)", fg: "oklch(0.86 0.070 50)" };
  if (lower.includes("kimi") || lower.includes("moonshot")) return { initials: "K", provider: "Kimi", bg: "oklch(0.22 0.040 285)", fg: "oklch(0.84 0.070 300)" };
  if (lower.includes("minimax")) return { initials: "M", provider: "MiniMax", bg: "oklch(0.24 0.038 165)", fg: "oklch(0.82 0.065 165)" };
  if (lower.includes("qwen")) return { initials: "Q", provider: "Qwen", bg: "oklch(0.23 0.040 220)", fg: "oklch(0.84 0.060 220)" };
  if (lower.includes("glm")) return { initials: "G", provider: "GLM", bg: "oklch(0.23 0.036 145)", fg: "oklch(0.82 0.060 145)" };
  if (lower.includes("nova")) return { initials: "N", provider: "Nova", bg: "oklch(0.23 0.040 75)", fg: "oklch(0.86 0.070 75)" };
  return { initials: model.slice(0, 2).toUpperCase(), provider: "Model", bg: "oklch(0.22 0.018 235)", fg: "oklch(0.82 0.025 230)" };
}

function ModelAvatar({
  model,
  displayName,
  revealed,
  size = "md",
}: {
  model: string;
  displayName: string;
  revealed: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const meta = modelAvatarMeta(model);
  const initials = revealed ? meta.initials : displayName.replace(/^Model\s+/i, "").slice(0, 2).toUpperCase();
  const px = size === "lg" ? 96 : size === "sm" ? 40 : 58;
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="grid place-items-center rounded-full border border-[oklch(0.25_0.010_245)] shadow-[0_12px_30px_oklch(0.04_0_0_/_0.28)]"
        style={{ width: px, height: px, background: revealed ? meta.bg : "oklch(0.16 0.006 245)", color: revealed ? meta.fg : "oklch(0.78 0.035 205)" }}
        title={revealed ? `${meta.provider}: ${model}` : displayName}
        aria-hidden="true"
      >
        <span className={`${size === "lg" ? "text-2xl" : size === "sm" ? "text-xs" : "text-base"} font-semibold tracking-normal`}>
          {initials}
        </span>
      </div>
      {revealed && size !== "sm" && (
        <span className="max-w-[88px] truncate text-[10px] font-medium text-[oklch(0.48_0.010_230)]">{meta.provider}</span>
      )}
    </div>
  );
}

const REVIEW_SCORE_GROUPS: Array<{
  title: string;
  hint: string;
  keys: Array<keyof HumanScores>;
}> = [
  { title: "Result", hint: "Did the final outcome satisfy the task?", keys: ["accuracy", "helpfulness", "quality"] },
  { title: "Visual", hint: "What you can see, use, and judge in the preview.", keys: ["design", "aesthetics", "creativity"] },
  { title: "Presentation", hint: "How clean and focused the delivered answer feels.", keys: ["ai_slop", "brevity"] },
];

function formatHumanScore(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function ScoreSelector({
  id,
  label,
  color,
  value,
  onChange,
}: {
  id: string;
  label: string;
  color: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const isUnset = value <= 0;
  const scoreOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const scaleId = `${id}-scale`;
  return (
    <div className="rounded-md border border-[oklch(0.22_0.008_245)] bg-[oklch(0.095_0.004_245)] px-2.5 py-2">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-[oklch(0.82_0.014_220)]">{label}</span>
        <span
          style={{ color: isUnset ? undefined : color }}
          className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
            isUnset
              ? "border-[oklch(0.30_0.012_235)] text-[oklch(0.62_0.014_230)]"
              : "border-[oklch(0.32_0.018_210)] bg-[oklch(0.13_0.008_220)]"
          }`}
        >
          {isUnset ? "Not scored" : `${formatHumanScore(value)}/10`}
        </span>
      </div>
      <div
        className="grid grid-cols-10 gap-1"
        role="radiogroup"
        aria-label={`${label} score`}
        aria-describedby={scaleId}
      >
        {scoreOptions.map((score) => {
          const selected = value === score;
          return (
            <button
              key={score}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${label}: ${score} out of 10`}
              title={`Set ${label} to ${score}/10`}
              onClick={() => onChange(score)}
              className={`grid h-8 min-w-0 place-items-center rounded border text-xs font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[oklch(0.62_0.045_190)] ${
                selected
                  ? "border-[oklch(0.62_0.040_190)] bg-[oklch(0.22_0.026_205)] text-[oklch(0.92_0.018_210)]"
                  : "border-[oklch(0.30_0.012_235)] bg-[oklch(0.13_0.005_245)] text-[oklch(0.70_0.014_225)] hover:border-[oklch(0.42_0.020_210)] hover:bg-[oklch(0.16_0.008_235)] hover:text-[oklch(0.88_0.016_220)]"
              }`}
              style={selected ? { borderColor: color, boxShadow: `inset 0 -2px 0 ${color}` } : undefined}
            >
              {score}
            </button>
          );
        })}
      </div>
      <div
        id={scaleId}
        className="mt-1.5 grid grid-cols-3 text-[10px] text-[oklch(0.56_0.012_230)]"
      >
        <span>Low</span>
        <span className="text-center">5 = OK</span>
        <span className="text-right">10 = Excellent</span>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const cls =
    status === "running" ? "bg-[oklch(0.72_0.080_70)] animate-pulse" :
    status === "done"    ? "bg-[oklch(0.66_0.075_155)]" :
    status === "error"   ? "bg-red-500" :
                           "bg-[oklch(0.34_0.010_235)]";
  return <div className={`h-2 w-2 flex-none rounded-full ${cls}`} />;
}

function EvalArena({
  blindMode,
  onReadyForScores,
}: {
  blindMode: boolean;
  onReadyForScores: () => void;
}) {
  const activeEval = useEvalStore((s) => s.activeEval);
  const [, forceRerender] = useState(0);

  useEffect(() => {
    if (!activeEval || activeEval.complete) return;
    const id = setInterval(() => forceRerender((n) => n + 1), 450);
    return () => clearInterval(id);
  }, [activeEval?.id, activeEval?.complete]);

  if (!activeEval) return null;

  const done = activeEval.models.filter((model) => {
    const status = activeEval.modelStates[model]?.status;
    return status === "done" || status === "error";
  }).length;
  const runningCount = activeEval.models.filter((model) => activeEval.modelStates[model]?.status === "running").length;
  const percent = Math.round((done / Math.max(activeEval?.models.length ?? 0, 1)) * 100);
  const orderedModels = getReviewOrder(activeEval.models, activeEval.blindLabels, blindMode);
  const complete = activeEval.complete;

  return (
    <div className="min-h-0 overflow-hidden rounded-md border border-[oklch(0.20_0.006_245)] bg-[oklch(0.101_0.003_245)]">
      <div className="relative min-h-[420px] overflow-hidden px-5 py-5">
        <div className="eval-arena-grid" aria-hidden="true" />
        <div className="relative flex min-h-[380px] flex-col gap-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-[oklch(0.56_0.020_205)]">Blind battle</div>
              <div className="mt-1 text-2xl font-semibold tracking-normal text-[oklch(0.92_0.010_220)]">
                {complete ? "All models finished" : runningCount > 0 ? "Models are working" : "Waiting for model streams"}
              </div>
              <div className="mt-2 max-w-3xl line-clamp-2 text-sm leading-relaxed text-[oklch(0.58_0.014_230)]">{activeEval.prompt}</div>
            </div>
            <div className="min-w-[160px] text-right">
              <div className="text-[10px] uppercase tracking-[0.14em] text-[oklch(0.46_0.010_230)]">Progress</div>
              <div className="mt-1 font-mono text-xl text-[oklch(0.76_0.040_190)]">{done}/{activeEval?.models.length ?? 0}</div>
              <div className="mt-1 text-[10px] text-[oklch(0.46_0.010_230)]">
                Code and telemetry stay hidden during the battle.
              </div>
            </div>
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-[oklch(0.14_0.006_245)]">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,oklch(0.70_0.070_190),oklch(0.74_0.070_85),oklch(0.70_0.080_310))] transition-[width] duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>

          <div className="relative overflow-hidden rounded-md border border-[oklch(0.18_0.006_245)] bg-[oklch(0.086_0.003_245)] px-4 py-3">
            <div className="pointer-events-none absolute inset-x-0 bottom-10 h-px bg-[linear-gradient(90deg,transparent,oklch(0.34_0.020_205_/_0.45),transparent)]" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6" aria-label="Arena axolotls">
              {orderedModels.map((model, index) => {
                const state = activeEval.modelStates[model];
                const displayName = blindMode ? activeEval.blindLabels[model] ?? model : model;
                const statusLabel = arenaCreatureStatusLabel(state.status);
                return (
                  <div key={`creature-${model}`} className="min-w-0 rounded-md border border-[oklch(0.16_0.006_245)] bg-[oklch(0.102_0.004_245)]/72 px-2 py-2">
                    <div className="flex h-20 items-end justify-center">
                      <img
                        src="/xolotl.svg"
                        alt=""
                        aria-hidden="true"
                        className={`h-16 w-16 ${arenaCreatureClass(state.status)}`}
                        style={{ animationDelay: `${index * 90}ms` }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-center gap-1.5">
                      <StatusDot status={state.status} />
                      <span className="truncate text-xs font-semibold text-[oklch(0.82_0.014_220)]">{displayName}</span>
                    </div>
                    <div className="mt-0.5 text-center text-[10px] uppercase tracking-[0.12em] text-[oklch(0.48_0.012_230)]">{statusLabel}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid flex-1 content-center gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {orderedModels.map((model) => {
              const state = activeEval.modelStates[model];
              const displayName = blindMode ? activeEval.blindLabels[model] ?? model : model;
              const isScoreable = hasScoreableOutput(state);
              const tps = tokensPerSec(state);
              return (
                <div
                  key={model}
                  className={`relative overflow-hidden rounded-md border px-3 py-3 ${
                    state.status === "error"
                      ? "border-[oklch(0.34_0.035_28)] bg-[oklch(0.13_0.010_28)]"
                      : state.status === "done"
                        ? "border-[oklch(0.30_0.018_165)] bg-[oklch(0.12_0.008_170)]"
                        : state.status === "running"
                          ? "border-[oklch(0.36_0.020_195)] bg-[oklch(0.13_0.008_210)]"
                          : "border-[oklch(0.22_0.008_245)] bg-[oklch(0.108_0.004_245)]"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <ModelAvatar model={model} displayName={displayName} revealed={!blindMode} size="lg" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <StatusDot status={state.status} />
                        <span className="truncate text-sm font-semibold text-[oklch(0.88_0.014_220)]">{displayName}</span>
                      </div>
                      <div className="mt-1 text-xs text-[oklch(0.52_0.012_230)]">
                        {state.status === "pending" && "Queued for the arena"}
                        {state.status === "running" && (state.content ? "Drafting response" : "Thinking")}
                        {state.status === "done" && (isScoreable ? "Response ready for review" : "No usable output")}
                        {state.status === "error" && "Disqualified by provider error"}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[oklch(0.48_0.012_230)]">
                        {state.status === "running" && <span className="font-mono">{tps.toFixed(0)} tok/s</span>}
                        {state.output_tokens > 0 && <span className="font-mono">{state.output_tokens} out tok</span>}
                        {state.status === "error" && <span className="text-[oklch(0.72_0.060_28)]">No score</span>}
                      </div>
                    </div>
                  </div>
                  {state.status === "running" && (
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-[oklch(0.10_0.004_245)]">
                      <div className="eval-arena-runner h-full w-1/3 rounded-full bg-[oklch(0.72_0.055_190)]" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {complete && (
            <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-3 border-t border-[oklch(0.22_0.008_240)] pt-5 text-center">
              <div className="text-sm text-[oklch(0.60_0.012_230)]">
                The blind run is complete. Move to the review screen to inspect outcomes and score each anonymous model.
              </div>
              <Button
                onClick={onReadyForScores}
                className="h-10 rounded-md bg-[oklch(0.92_0.010_220)] px-5 text-sm font-semibold text-[oklch(0.12_0.004_245)] hover:bg-white"
              >
                Ready for scores
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OutcomePreview({
  model,
  displayName,
  showWrittenFallback = false,
}: {
  model: string;
  displayName: string;
  showWrittenFallback?: boolean;
}) {
  const state = useEvalStore((s) => s.activeEval?.modelStates[model]);
  const artifacts = useMemo(() => state?.content ? extractEvalArtifacts(state.content) : [], [state?.content]);
  const firstInlinePreview = artifacts.find((artifact) => artifact.canPreviewInline && artifact.previewHtml);
  const [launchStates, setLaunchStates] = useState<Record<string, { state: ArtifactLaunchState; message: string }>>({});
  const [showText, setShowText] = useState(false);

  if (!state) return null;

  const startArtifact = async (artifact: EvalArtifact) => {
    setLaunchStates((prev) => ({ ...prev, [artifact.id]: { state: "starting", message: "" } }));
    const result = await commands.startEvalArtifact({
      label: displayName,
      kind: artifact.kind,
      entry_path: artifact.entryPath,
      files: artifact.files.map((file) => ({ relative_path: file.relativePath, content: file.content })),
    });
    if (result.status === "ok") {
      setLaunchStates((prev) => ({ ...prev, [artifact.id]: { state: "ok", message: result.data.message } }));
    } else {
      setLaunchStates((prev) => ({ ...prev, [artifact.id]: { state: "error", message: result.error } }));
    }
  };

  return (
    <div className="overflow-hidden rounded-md border border-[oklch(0.22_0.008_240)] bg-[oklch(0.108_0.004_245)]">
      <div className="flex items-center gap-2 border-b border-[oklch(0.20_0.006_245)] px-3 py-2">
        <MonitorPlay className="h-3.5 w-3.5 text-[oklch(0.62_0.032_195)]" />
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[oklch(0.55_0.020_205)]">Outcome preview</span>
        {artifacts.length > 0 && (
          <span className="ml-auto text-[10px] text-[oklch(0.46_0.010_230)]">{artifacts.length} artifact{artifacts.length === 1 ? "" : "s"}</span>
        )}
      </div>

      {firstInlinePreview?.previewHtml ? (
        <iframe
          title={`${displayName} outcome preview`}
          srcDoc={firstInlinePreview.previewHtml}
          sandbox="allow-scripts allow-pointer-lock"
          className="h-[320px] w-full bg-white"
          tabIndex={0}
        />
      ) : (
        <div className="grid min-h-[220px] place-items-center px-4 py-6 text-center">
          <div>
            <div className="text-sm font-medium text-[oklch(0.78_0.014_225)]">No inline preview detected</div>
            <div className="mt-1 max-w-sm text-xs leading-relaxed text-[oklch(0.52_0.012_230)]">
              Runnable files can still be opened from here. Written output is hidden by default during scoring.
            </div>
          </div>
        </div>
      )}

      {artifacts.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-[oklch(0.20_0.006_245)] px-3 py-2">
          {artifacts.map((artifact) => {
            const launch = launchStates[artifact.id] ?? { state: "idle" as ArtifactLaunchState, message: "" };
            return (
              <button
                key={artifact.id}
                type="button"
                onClick={() => void startArtifact(artifact)}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[oklch(0.25_0.012_235)] px-2 text-[11px] text-[oklch(0.66_0.020_220)] hover:border-[oklch(0.34_0.018_205)] hover:text-[oklch(0.82_0.020_210)]"
                title={launch.message || artifact.title}
              >
                <ExternalLink className="h-3 w-3" />
                {launch.state === "starting" ? "Starting..." : artifact.kind === "python" ? "Start" : "Open"} {artifact.title}
              </button>
            );
          })}
        </div>
      )}

      {showWrittenFallback && (
        <div className="border-t border-[oklch(0.20_0.006_245)]">
          <button
            type="button"
            onClick={() => setShowText((value) => !value)}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] uppercase tracking-[0.13em] text-[oklch(0.50_0.012_230)] hover:bg-[oklch(0.125_0.004_245)]"
          >
            Written output
            {showText ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {showText && (
            <div className="max-h-[260px] overflow-auto px-3 py-3 text-sm leading-relaxed text-[oklch(0.80_0.012_220)]">
              <MarkdownRenderer content={state.content} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReviewScoreControls({ model }: { model: string }) {
  const humanScores = useEvalStore((s) => s.humanScores[model] ?? EMPTY_HUMAN_SCORES);
  const setHumanScore = useEvalStore((s) => s.setHumanScore);
  const scoreCount = HUMAN_SCORE_KEYS.filter((key) => (humanScores[key] ?? 0) > 0).length;
  const setGroupNeutral = (keys: Array<keyof HumanScores>) => {
    for (const key of keys) {
      if ((humanScores[key] ?? 0) <= 0) setHumanScore(model, key, 5);
    }
  };

  return (
    <div className="rounded-md border border-[oklch(0.22_0.008_240)] bg-[oklch(0.108_0.004_245)]">
      <div className="flex items-center justify-between border-b border-[oklch(0.20_0.006_245)] px-3 py-2">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[oklch(0.58_0.022_205)]">Human visual score</div>
          <div className="mt-0.5 text-xs text-[oklch(0.48_0.012_230)]">Score the outcome you can inspect, not provider speed.</div>
        </div>
        <span className="text-[10px] uppercase tracking-[0.13em] text-[oklch(0.52_0.012_230)]">{scoreCount}/{SCORE_DIMENSION_COUNT}</span>
      </div>
      <div className="grid gap-3 p-3">
        {REVIEW_SCORE_GROUPS.map((group) => (
          <div key={group.title} className="rounded-md border border-[oklch(0.18_0.006_245)] bg-[oklch(0.096_0.003_245)] p-3">
            <div className="mb-3 flex items-start gap-3">
              <div>
                <div className="text-xs font-semibold text-[oklch(0.82_0.014_220)]">{group.title}</div>
                <div className="mt-0.5 text-[10px] leading-relaxed text-[oklch(0.48_0.012_230)]">{group.hint}</div>
              </div>
              <button
                type="button"
                onClick={() => setGroupNeutral(group.keys)}
                className="ml-auto h-6 rounded border border-[oklch(0.24_0.010_235)] px-2 text-[10px] text-[oklch(0.52_0.014_230)] hover:text-[oklch(0.76_0.018_220)]"
              >
                Set 5
              </button>
            </div>
            <div className="grid gap-2">
              {group.keys.map((key) => {
                const dim = SCORE_DIMENSIONS.find((item) => item.key === key) ?? SCORE_DIMENSIONS[0];
                return (
                  <ScoreSelector
                    key={key}
                    id={`${model.replace(/[^a-zA-Z0-9_-]/g, "-")}-${key}`}
                    label={dim.label}
                    color={dim.color}
                    value={humanScores[key] ?? 0}
                    onChange={(value) => setHumanScore(model, key, value)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HumanReviewScreen({
  models,
  blindNames,
  progressLabel,
  canFinish,
  savingScores,
  onDone,
}: {
  models: string[];
  blindNames: Record<string, string>;
  progressLabel: string;
  canFinish: boolean;
  savingScores: boolean;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-md border border-[oklch(0.20_0.006_245)] bg-[oklch(0.108_0.004_245)] px-4 py-4 md:flex-row md:items-center">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-[oklch(0.56_0.020_205)]">Blind review</div>
          <h3 className="mt-1 text-xl font-semibold tracking-normal text-[oklch(0.90_0.012_220)]">Inspect outcomes and score the visual result</h3>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[oklch(0.56_0.014_230)]">
            Model names, speed, token usage, and AI judge details stay hidden until this review is finished.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="rounded-md border border-[oklch(0.25_0.012_235)] px-2 py-1 text-[10px] uppercase tracking-[0.13em] text-[oklch(0.58_0.018_220)]">{progressLabel}</span>
          <Button
            onClick={onDone}
            disabled={!canFinish || savingScores}
            className="h-9 rounded-md bg-[oklch(0.90_0.010_220)] px-4 text-xs font-semibold text-[oklch(0.12_0.004_245)] hover:bg-white disabled:opacity-45"
          >
            {savingScores ? "Saving..." : canFinish ? "Save scores and reveal" : "Finish all scores"}
          </Button>
        </div>
      </div>
      <div className="grid gap-4">
        {models.length === 0 && (
          <div className="rounded-md border border-[oklch(0.22_0.008_245)] bg-[oklch(0.108_0.004_245)] px-4 py-8 text-center">
            <div className="text-sm font-medium text-[oklch(0.80_0.014_225)]">No scoreable outputs were produced</div>
            <div className="mt-1 text-xs text-[oklch(0.52_0.012_230)]">Continue to the results screen to see provider errors and telemetry.</div>
          </div>
        )}
        {models.map((model) => (
          <section key={model} className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <ModelAvatar model={model} displayName={blindNames[model] ?? model} revealed={false} size="md" />
                <div>
                  <div className="text-base font-semibold text-[oklch(0.88_0.014_220)]">{blindNames[model] ?? model}</div>
                  <div className="text-xs text-[oklch(0.48_0.012_230)]">Anonymous outcome</div>
                </div>
              </div>
              <OutcomePreview model={model} displayName={blindNames[model] ?? model} showWrittenFallback />
            </div>
            <ReviewScoreControls model={model} />
          </section>
        ))}
      </div>
    </div>
  );
}

function RadarChart({ comparison }: { comparison: EvalComparison }) {
  const axes = [
    { key: "final", label: "Overall" },
    { key: "ai", label: "AI KPI" },
    { key: "human", label: "Human" },
    { key: "speed", label: "Speed" },
    { key: "efficiency", label: "Tokens" },
    { key: "reasoning", label: "Reasoning" },
  ] as const;
  const center = 150;
  const radius = 108;
  const topModels = comparison.models.slice(0, 4);
  const colorFor = (index: number) => ["#3159ff", "#ff5038", "#00a884", "#a855f7"][index % 4];
  const point = (axisIndex: number, value: number) => {
    const angle = -Math.PI / 2 + (axisIndex / axes.length) * Math.PI * 2;
    const r = (Math.max(0, Math.min(10, value)) / 10) * radius;
    return `${center + Math.cos(angle) * r},${center + Math.sin(angle) * r}`;
  };
  const valueFor = (model: EvalComparison["models"][number], key: typeof axes[number]["key"]): number => {
    if (key === "final") return model.finalScore ?? 0;
    if (key === "ai") return model.aiScore ?? 0;
    if (key === "human") return model.humanScore ?? 0;
    return model.kpis.find((kpi) => kpi.key === key)?.score ?? 0;
  };

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 300 300" className="h-[300px] w-full max-w-[360px]">
        {[0.25, 0.5, 0.75, 1].map((scale) => (
          <polygon
            key={scale}
            points={axes.map((_, index) => point(index, 10 * scale)).join(" ")}
            fill="none"
            stroke="oklch(0.80 0 0 / 0.18)"
            strokeWidth="1"
          />
        ))}
        {axes.map((axis, index) => {
          const [x, y] = point(index, 10).split(",").map(Number);
          return (
            <g key={axis.key}>
              <line x1={center} y1={center} x2={x} y2={y} stroke="oklch(0.80 0 0 / 0.13)" strokeWidth="1" />
              <text x={x} y={y} dy={y < center ? -8 : 14} textAnchor="middle" className="fill-[oklch(0.55_0.012_230)] text-[10px] uppercase tracking-wide">
                {axis.label}
              </text>
            </g>
          );
        })}
        {topModels.map((model, index) => {
          const color = colorFor(index);
          const points = axes.map((axis, axisIndex) => point(axisIndex, valueFor(model, axis.key))).join(" ");
          return (
            <g key={model.model}>
              <polygon points={points} fill={color} fillOpacity="0.22" stroke={color} strokeWidth="2" />
              {axes.map((axis, axisIndex) => {
                const [x, y] = point(axisIndex, valueFor(model, axis.key)).split(",").map(Number);
                return <circle key={axis.key} cx={x} cy={y} r="3" fill={color} />;
              })}
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap justify-center gap-3">
        {topModels.map((model, index) => (
          <div key={model.model} className="flex items-center gap-1.5 text-xs text-[oklch(0.58_0.014_230)]">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorFor(index) }} />
            {model.displayName}
          </div>
        ))}
      </div>
    </div>
  );
}

function comparisonDecisionCopy(
  decision: EvalComparison["decision"],
  margin: number | null,
): { label: string; detail: string } {
  const marginText = margin === null ? "No runner-up margin" : `${margin.toFixed(1)} point margin`;
  if (decision === "tie") return { label: "Tie", detail: "Scores are effectively equal." };
  if (decision === "close") return { label: "Close call", detail: marginText };
  if (decision === "clear") return { label: "Clear lead", detail: marginText };
  if (decision === "single") return { label: "Single model", detail: "Only one scored model is available." };
  return { label: "Unscored", detail: "No scored outputs are available." };
}

const CALIBRATION_TONE: Record<CalibrationTone, { color: string; bg: string; border: string }> = {
  good: { color: "oklch(0.80 0.075 155)", bg: "oklch(0.13 0.010 155)", border: "oklch(0.32 0.030 155)" },
  warn: { color: "oklch(0.82 0.085 72)",  bg: "oklch(0.13 0.012 72)",  border: "oklch(0.34 0.035 72)" },
  bad:  { color: "oklch(0.76 0.080 28)",  bg: "oklch(0.13 0.012 28)",  border: "oklch(0.34 0.035 28)" },
  none: { color: "oklch(0.60 0.012 230)", bg: "oklch(0.11 0.004 245)", border: "oklch(0.26 0.010 235)" },
};

/**
 * Per-model reliability & calibration readout (P6.1). Surfaces the
 * backend-captured signals — authoritative cost, throughput, token-count
 * accuracy, reasoning volume — that the P6.2 profile aggregator consumes.
 * Renders nothing until metrics are hydrated (after a run completes / reloads).
 */
function ReliabilityPanel({
  models,
  metrics,
  displayNameOf,
  revealed,
}: {
  models: string[];
  metrics: Record<string, ReliabilityMetrics>;
  displayNameOf: (model: string) => string;
  /** False in blind mode — keeps the avatar from leaking provider identity via color. */
  revealed: boolean;
}) {
  const present = models.filter((model) => metrics[model]);
  if (present.length === 0) return null;

  return (
    <section className="rounded-md border border-[oklch(0.20_0.006_245)] bg-[oklch(0.108_0.004_245)] p-4">
      <div className="mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[oklch(0.56_0.020_205)]">
        <Gauge className="h-3.5 w-3.5" />
        Reliability &amp; calibration
      </div>
      <div className="mb-3 text-xs text-[oklch(0.52_0.012_230)]">
        Engine-computed cost, throughput, and token-count accuracy per model. Calibration compares the engine&apos;s
        token estimate against the provider&apos;s reported usage (target within 5%).
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {present.map((model) => {
          const m = metrics[model];
          const verdict = calibrationVerdict(m);
          const tone = CALIBRATION_TONE[verdict.tone];
          const rows = reliabilityRows(m);
          return (
            <div key={`reliability-${model}`} className="rounded-md border border-[oklch(0.18_0.006_245)] bg-[oklch(0.096_0.003_245)] p-3">
              <div className="mb-2 flex items-center gap-2">
                <ModelAvatar model={model} displayName={displayNameOf(model)} revealed={revealed} size="sm" />
                <span className="truncate text-sm font-semibold text-[oklch(0.84_0.014_225)]">{displayNameOf(model)}</span>
                <span
                  className="ml-auto rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
                  style={{ color: tone.color, background: tone.bg, borderColor: tone.border }}
                  title={`Token-count error: ${(m.token_count_error * 100).toFixed(1)}%`}
                >
                  {verdict.label}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {rows.map((row) => (
                  <div key={row.key} className="flex items-center justify-between gap-2" title={row.title}>
                    <dt className="text-[11px] text-[oklch(0.52_0.012_230)]">{row.label}</dt>
                    <dd className="font-mono text-[11px] tabular-nums text-[oklch(0.82_0.016_220)]">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ComparisonResultsPanel({
  comparison,
  reviewMode,
  reviewDirty,
  savingReview,
  onManualReviewChange,
  onSaveManualReviews,
}: {
  comparison: EvalComparison;
  reviewMode: EvalReviewMode;
  reviewDirty: boolean;
  savingReview: boolean;
  onManualReviewChange: (model: string, review: Partial<ManualReview>) => void;
  onSaveManualReviews: () => void;
}) {
  const winner = comparison.winner;
  const scoreText = (score: number | null) => score === null ? "--" : score.toFixed(1);
  const scoreWidth = (score: number | null) => `${Math.max(0, Math.min(100, (score ?? 0) * 10))}%`;
  const automaticMode = reviewMode === "automatic";
  const weightLabel = automaticMode
    ? "AI/KPI only"
    : `${Math.round(FINAL_AI_WEIGHT * 100)}% AI KPI / ${Math.round(FINAL_HUMAN_WEIGHT * 100)}% human visual`;
  const decision = comparisonDecisionCopy(comparison.decision, comparison.winnerMargin);
  const kpiLeaders = ["quality", "reasoning", "speed", "efficiency", "cost"]
    .map((key) => {
      const candidates = comparison.models
        .map((model) => {
          const kpi = model.kpis.find((item) => item.key === key);
          return kpi && kpi.score !== null ? { model, kpi, score: kpi.score } : null;
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .sort((a, b) => b.score - a.score);
      const winner = candidates[0];
      return winner ? { key, label: winner.kpi.label, displayName: winner.model.displayName, score: winner.score, detail: winner.kpi.detail } : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-md border border-[oklch(0.20_0.006_245)] bg-[oklch(0.108_0.004_245)] px-4 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[oklch(0.56_0.020_205)]">
              <Trophy className="h-3.5 w-3.5" />
              Revealed leaderboard
            </div>
            <h3 className="mt-1 text-2xl font-semibold tracking-normal text-[oklch(0.92_0.010_220)]">
              {comparison.decision === "tie"
                ? "No clear winner"
                : winner
                  ? `${winner.displayName} leads overall`
                  : "No winner yet"}
            </h3>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[oklch(0.58_0.014_230)]">
              {automaticMode
                ? "Objective evals skip manual scoring. Review each model answer, deterministic correctness where available, and the final AI/KPI score."
                : "Final score blends automatic model KPIs with your blind visual review. Personal notes below are saved separately and never change the eval score."}
            </p>
          </div>
          <div className="grid min-w-[320px] grid-cols-4 gap-2 rounded-md border border-[oklch(0.22_0.008_245)] bg-[oklch(0.096_0.003_245)] p-2 text-center">
            <div>
              <div className="text-[10px] uppercase tracking-[0.13em] text-[oklch(0.46_0.010_230)]">Blend</div>
              <div className="mt-1 text-xs text-[oklch(0.72_0.020_210)]">{weightLabel}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.13em] text-[oklch(0.46_0.010_230)]">Decision</div>
              <div className="mt-1 text-xs font-semibold text-[oklch(0.72_0.040_190)]" title={decision.detail}>{decision.label}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.13em] text-[oklch(0.46_0.010_230)]">Models</div>
              <div className="mt-1 font-mono text-lg text-[oklch(0.82_0.016_220)]">{comparison.models.length}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.13em] text-[oklch(0.46_0.010_230)]">Areas</div>
              <div className="mt-1 font-mono text-lg text-[oklch(0.82_0.016_220)]">{comparison.areaLeaders.length}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="rounded-md border border-[oklch(0.20_0.006_245)] bg-[oklch(0.108_0.004_245)] p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-[oklch(0.56_0.020_205)]">Score shape</div>
            <div className="text-[10px] text-[oklch(0.46_0.010_230)]">Top 4 plotted</div>
          </div>
          <RadarChart comparison={comparison} />
        </div>

        <div className="rounded-md border border-[oklch(0.20_0.006_245)] bg-[oklch(0.108_0.004_245)] p-4">
          <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.16em] text-[oklch(0.56_0.020_205)]">Where each model performed best</div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-semibold text-[oklch(0.82_0.014_220)]">AI KPI leaders</div>
              <div className="space-y-2">
                {kpiLeaders.map((leader) => (
                  <div key={leader.key} className="rounded-md border border-[oklch(0.18_0.006_245)] bg-[oklch(0.096_0.003_245)] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-[oklch(0.72_0.018_220)]">{leader.label}</span>
                      <span className="font-mono text-xs text-[oklch(0.76_0.040_190)]">{leader.score.toFixed(1)}</span>
                    </div>
                    <div className="mt-1 truncate text-[11px] text-[oklch(0.52_0.012_230)]">{leader.displayName} / {leader.detail}</div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold text-[oklch(0.82_0.014_220)]">{automaticMode ? "Objective scoring" : "Human area leaders"}</div>
              <div className="space-y-2">
                {automaticMode ? (
                  <div className="rounded-md border border-[oklch(0.18_0.006_245)] bg-[oklch(0.096_0.003_245)] px-3 py-2 text-xs text-[oklch(0.52_0.012_230)]">Rankings are determined by correctness, AI quality signals, speed, token efficiency, and cost.</div>
                ) : comparison.areaLeaders.length === 0 ? (
                  <div className="rounded-md border border-[oklch(0.18_0.006_245)] bg-[oklch(0.096_0.003_245)] px-3 py-2 text-xs text-[oklch(0.52_0.012_230)]">Human scores are not set yet.</div>
                ) : comparison.areaLeaders.slice(0, 5).map((leader) => (
                  <div key={leader.key} className="rounded-md border border-[oklch(0.18_0.006_245)] bg-[oklch(0.096_0.003_245)] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-[oklch(0.72_0.018_220)]">{leader.label}</span>
                      <span className="font-mono text-xs text-[oklch(0.76_0.040_190)]">{leader.score.toFixed(1)}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-[oklch(0.52_0.012_230)]">
                      {leader.displayName}{leader.margin !== null ? ` won by ${leader.margin.toFixed(1)}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-md border border-[oklch(0.20_0.006_245)] bg-[oklch(0.108_0.004_245)] p-4">
        <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.16em] text-[oklch(0.56_0.020_205)]">Ranked scorecards</div>
        <div className="grid gap-3">
          {comparison.models.map((model) => (
            <div key={model.model} className="grid gap-4 rounded-md border border-[oklch(0.18_0.006_245)] bg-[oklch(0.096_0.003_245)] p-3 lg:grid-cols-[260px_minmax(0,1fr)]">
              <div className="flex items-center gap-3">
                <ModelAvatar model={model.model} displayName={model.displayName} revealed size="md" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold text-[oklch(0.90_0.012_220)]">#{model.rank ?? "-"}</span>
                    <span className="truncate text-sm font-semibold text-[oklch(0.84_0.014_225)]">{model.displayName}</span>
                  </div>
                  <div className="mt-1 text-[10px] uppercase tracking-[0.13em] text-[oklch(0.48_0.012_230)]">
                    {SCORE_SOURCE_LABELS[model.generalSource]} / {comparisonDecisionCopy(model.confidence, model.scoreMargin).label}
                  </div>
                  {automaticMode && (
                    <div
                      className={`mt-2 inline-flex w-fit items-center rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] ${
                        model.correctness.verdict === "correct"
                          ? "border-[oklch(0.34_0.035_155)] bg-[oklch(0.13_0.010_155)] text-[oklch(0.70_0.060_155)]"
                          : model.correctness.verdict === "incorrect"
                            ? "border-[oklch(0.36_0.040_28)] bg-[oklch(0.13_0.010_28)] text-[oklch(0.72_0.060_28)]"
                            : "border-[oklch(0.30_0.014_230)] bg-[oklch(0.12_0.005_240)] text-[oklch(0.58_0.014_230)]"
                      }`}
                      title={model.correctness.detail}
                    >
                      {model.correctness.verdict}
                    </div>
                  )}
                  <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-[oklch(0.58_0.014_230)]">{model.why}</p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {[
                  { label: "Final", score: model.finalScore, color: "oklch(0.72 0.055 190)" },
                  { label: "AI KPI", score: model.aiScore, color: "oklch(0.72 0.045 255)" },
                  automaticMode
                    ? { label: "Cost", score: model.kpis.find((kpi) => kpi.key === "cost")?.score ?? null, color: "oklch(0.72 0.060 88)" }
                    : { label: "Human visual", score: model.humanScore, color: "oklch(0.72 0.060 88)" },
                ].map((metric) => (
                  <div key={metric.label} className="min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] uppercase tracking-[0.13em] text-[oklch(0.46_0.010_230)]">{metric.label}</span>
                      <span className="font-mono text-sm text-[oklch(0.84_0.014_225)]">{scoreText(metric.score)}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[oklch(0.14_0.006_245)]">
                      <div className="h-full rounded-full" style={{ width: scoreWidth(metric.score), background: metric.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {automaticMode && (
        <section className="rounded-md border border-[oklch(0.20_0.006_245)] bg-[oklch(0.108_0.004_245)] p-4">
          <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.16em] text-[oklch(0.56_0.020_205)]">Answers and correctness</div>
          <div className="grid gap-3 xl:grid-cols-2">
            {comparison.models.map((model) => (
              <div key={`answer-${model.model}`} className="rounded-md border border-[oklch(0.18_0.006_245)] bg-[oklch(0.096_0.003_245)] p-3">
                <div className="mb-2 flex items-center gap-2">
                  <ModelAvatar model={model.model} displayName={model.displayName} revealed size="sm" />
                  <span className="truncate text-sm font-semibold text-[oklch(0.84_0.014_225)]">{model.displayName}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-[0.12em] text-[oklch(0.56_0.014_230)]">{model.correctness.verdict}</span>
                </div>
                <div className="mb-2 text-[11px] text-[oklch(0.56_0.012_230)]">{model.correctness.detail}</div>
                {(model.correctness.expectedAnswer || model.correctness.observedAnswer) && (
                  <div className="mb-3 grid gap-2 rounded-md border border-[oklch(0.16_0.006_245)] bg-[oklch(0.085_0.003_245)] p-2 sm:grid-cols-2">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-[0.13em] text-[oklch(0.46_0.010_230)]">Expected</div>
                      <div className="mt-1 truncate font-mono text-xs text-[oklch(0.74_0.020_210)]" title={model.correctness.expectedAnswer ?? "Not configured"}>
                        {model.correctness.expectedAnswer ?? "Not configured"}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-[0.13em] text-[oklch(0.46_0.010_230)]">Answered</div>
                      <div className="mt-1 truncate font-mono text-xs text-[oklch(0.84_0.014_225)]" title={model.correctness.observedAnswer ?? "Could not extract"}>
                        {model.correctness.observedAnswer ?? "Could not extract"}
                      </div>
                    </div>
                  </div>
                )}
                <OutcomePreview model={model.model} displayName={model.displayName} showWrittenFallback />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-md border border-[oklch(0.20_0.006_245)] bg-[oklch(0.108_0.004_245)] p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-[oklch(0.56_0.020_205)]">AI KPI details</div>
            <div className="mt-1 text-xs text-[oklch(0.52_0.012_230)]">Automatic score signals for quality, reasoning, speed, token efficiency, and cost.</div>
          </div>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          {comparison.models.map((model) => (
            <div key={`kpis-${model.model}`} className="rounded-md border border-[oklch(0.18_0.006_245)] bg-[oklch(0.096_0.003_245)] p-3">
              <div className="mb-3 flex items-center gap-2">
                <ModelAvatar model={model.model} displayName={model.displayName} revealed size="sm" />
                <span className="text-sm font-semibold text-[oklch(0.84_0.014_225)]">{model.displayName}</span>
              </div>
              <div className="grid gap-2">
                {model.kpis.map((kpi) => (
                  <div key={kpi.key} className="grid grid-cols-[118px_minmax(0,1fr)_42px] items-center gap-2 text-xs">
                    <span className="truncate text-[oklch(0.58_0.014_230)]">{kpi.label}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-[oklch(0.14_0.006_245)]">
                      <div className="h-full rounded-full bg-[oklch(0.68_0.040_205)]" style={{ width: scoreWidth(kpi.score) }} />
                    </div>
                    <span className="text-right font-mono text-[oklch(0.76_0.040_190)]">{scoreText(kpi.score)}</span>
                    <span className="col-span-3 truncate text-[10px] text-[oklch(0.45_0.010_230)]">{kpi.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {!automaticMode && <section className="rounded-md border border-[oklch(0.20_0.006_245)] bg-[oklch(0.108_0.004_245)] p-4">
        <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.16em] text-[oklch(0.56_0.020_205)]">Human visual breakdown</div>
        <div className="space-y-3">
          {comparison.dimensionRows.map((row) => {
            const dim = SCORE_DIMENSIONS.find((item) => item.key === row.key);
            return (
              <div key={row.key} className="grid gap-1.5">
                <div className="text-[10px] uppercase tracking-[0.13em]" style={{ color: dim?.color ?? UI_ACCENT }}>{row.label}</div>
                {row.values.map((value) => (
                  <div key={`${row.key}-${value.model}`} className="grid grid-cols-[132px_minmax(0,1fr)_40px] items-center gap-2 text-xs">
                    <span className="truncate text-[oklch(0.58_0.014_230)]">{value.displayName}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-[oklch(0.14_0.006_245)]">
                      <div className="h-full rounded-full" style={{ width: scoreWidth(value.score), background: dim?.color ?? UI_ACCENT }} />
                    </div>
                    <span className="text-right font-mono text-[oklch(0.76_0.040_190)]">{scoreText(value.score)}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </section>}

      {!automaticMode && <section className="rounded-md border border-[oklch(0.20_0.006_245)] bg-[oklch(0.108_0.004_245)] p-4">
        <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.16em] text-[oklch(0.56_0.020_205)]">Outcome previews</div>
        <div className="grid gap-4 xl:grid-cols-2">
          {comparison.models.map((model) => (
            <div key={`preview-${model.model}`} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <ModelAvatar model={model.model} displayName={model.displayName} revealed size="sm" />
                <span className="text-sm font-semibold text-[oklch(0.84_0.014_225)]">{model.displayName}</span>
              </div>
              <OutcomePreview model={model.model} displayName={model.displayName} showWrittenFallback />
            </div>
          ))}
        </div>
      </section>}

      {!automaticMode && <section className="rounded-md border border-[oklch(0.20_0.006_245)] bg-[oklch(0.108_0.004_245)] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-[oklch(0.56_0.020_205)]">Personal review</div>
            <div className="mt-1 text-xs text-[oklch(0.52_0.012_230)]">Separate notes for your records. These do not affect AI KPI, human visual, or final score.</div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={onSaveManualReviews}
            disabled={!reviewDirty || savingReview}
            className={`h-7 gap-1 text-xs ${reviewDirty ? "text-[oklch(0.70_0.055_190)]" : "text-[oklch(0.50_0.012_230)]"}`}
          >
            <Save className="h-3.5 w-3.5" /> {savingReview ? "Saving..." : reviewDirty ? "Save review" : "Review saved"}
          </Button>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {comparison.models.map((model) => (
            <div key={`review-${model.model}`} className="rounded-md border border-[oklch(0.18_0.006_245)] bg-[oklch(0.096_0.003_245)] p-3">
              <div className="mb-2 flex items-center gap-2">
                <ModelAvatar model={model.model} displayName={model.displayName} revealed size="sm" />
                <span className="truncate text-xs font-semibold text-[oklch(0.84_0.014_220)]">{model.displayName}</span>
                <span className="ml-auto text-[10px] tabular-nums text-[oklch(0.50_0.010_225)]">
                  {model.manualScore === null ? "unset" : `${model.manualScore.toFixed(1)}/10`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={0.5}
                  value={model.manualScore ?? 5}
                  onChange={(event) => onManualReviewChange(model.model, { score: Number(event.currentTarget.value) })}
                  className="min-w-0 flex-1 accent-[oklch(0.70_0.055_190)]"
                  aria-label={`${model.displayName} personal score`}
                />
                <input
                  type="number"
                  min={1}
                  max={10}
                  step={0.5}
                  value={model.manualScore ?? ""}
                  onChange={(event) => {
                    const next = event.currentTarget.value.trim();
                    const score = next ? Math.max(1, Math.min(10, Number(next))) : null;
                    onManualReviewChange(model.model, { score });
                  }}
                  className="h-7 w-16 rounded border border-[oklch(0.24_0.010_245)] bg-[oklch(0.10_0.004_245)] px-2 text-xs tabular-nums text-[oklch(0.82_0.012_220)] outline-none focus:border-[oklch(0.50_0.035_205)]"
                  aria-label={`${model.displayName} personal score input`}
                />
              </div>
              <textarea
                value={model.manualNotes}
                onChange={(event) => onManualReviewChange(model.model, { notes: event.currentTarget.value })}
                placeholder="Notes"
                rows={3}
                className="mt-2 w-full resize-y rounded border border-[oklch(0.24_0.010_245)] bg-[oklch(0.10_0.004_245)] px-2 py-1.5 text-xs leading-relaxed text-[oklch(0.82_0.012_220)] outline-none placeholder:text-[oklch(0.42_0.008_225)] focus:border-[oklch(0.50_0.035_205)]"
                aria-label={`${model.displayName} personal review notes`}
              />
            </div>
          ))}
        </div>
      </section>}
    </div>
  );
}

const BENCHMARK_ICON_SRC: Record<BenchmarkAreaIcon, string> = {
  emperor: "/benchmarks/axolotl-emperor.png",
  architect: "/benchmarks/axolotl-architect.png",
  design: "/benchmarks/axolotl-design.png",
  speed: "/benchmarks/axolotl-speed.png",
};

function BenchmarkLeaderboardPanel() {
  const [leaderboard, setLeaderboard] = useState<BenchmarkLeaderboard | null>(null);
  const [selectedArea, setSelectedArea] = useState<BenchmarkAreaKey>("overall");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const metas = await commands.listEvals();
      const loaded = await Promise.all(metas.map(async (meta) => {
        try {
          const result = await commands.loadEval(meta.id);
          return result.status === "ok" ? JSON.parse(result.data) as EvalResult : null;
        } catch {
          return null;
        }
      }));
      setLeaderboard(buildBenchmarkLeaderboard(loaded.filter((item): item is EvalResult => item !== null)));
    } catch (error) {
      setLeaderboard(buildBenchmarkLeaderboard([]));
      setLoadError(noticeDetail(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = leaderboard?.areas.find((area) => area.area.key === selectedArea) ?? {
    area: benchmarkAreaByKey(selectedArea),
    entries: [],
    evalCount: 0,
    trialCount: 0,
  };
  const champion = selected.entries[0] ?? null;
  const iconSrc = BENCHMARK_ICON_SRC[selected.area.icon];
  const populatedAreas = new Set((leaderboard?.areas ?? []).filter((area) => area.entries.length > 0).map((area) => area.area.key));
  const coverageLabel = leaderboard?.evalCount
    ? `${leaderboard.evalCount} saved eval${leaderboard.evalCount === 1 ? "" : "s"}`
    : "No saved evals";
  const updatedLabel = leaderboard?.lastUpdatedAt
    ? new Date(leaderboard.lastUpdatedAt * 1000).toLocaleDateString()
    : "No runs yet";

  return (
    <section className="border-b border-[oklch(0.22_0.008_245)] bg-[oklch(0.098_0.004_250)] px-4 py-5">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,0.92fr)_minmax(420px,1.08fr)]">
          <div className="relative overflow-hidden rounded-md border border-[oklch(0.22_0.008_245)] bg-[oklch(0.108_0.004_245)] px-4 py-4">
            <div className="absolute inset-0 benchmark-topography" aria-hidden="true" />
            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="benchmark-icon-shell flex-none">
                <img src={iconSrc} alt="" className="benchmark-champion-icon" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[oklch(0.56_0.020_205)]">
                  <Trophy className="h-3.5 w-3.5" />
                  Benchmark leaderboard
                </div>
                <h2 className="mt-1 text-2xl font-semibold tracking-normal text-[oklch(0.92_0.012_220)]">Axolotl model rankings</h2>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-[oklch(0.58_0.014_230)]">
                  Saved evals roll up into area-specific rankings for software work, reasoning, structured output, safety, speed, and human-scored frontend craft.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.13em]">
                  <span className="rounded border border-[oklch(0.30_0.014_220)] bg-[oklch(0.12_0.005_235)] px-2 py-1 text-[oklch(0.62_0.018_220)]">{coverageLabel}</span>
                  <span className="rounded border border-[oklch(0.30_0.014_220)] bg-[oklch(0.12_0.005_235)] px-2 py-1 text-[oklch(0.62_0.018_220)]">Updated {updatedLabel}</span>
                  {loadError && <span className="rounded border border-[oklch(0.36_0.035_28)] bg-[oklch(0.13_0.010_28)] px-2 py-1 text-[oklch(0.70_0.055_28)]">History unavailable</span>}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void refresh()}
                disabled={loading}
                className="h-8 flex-none gap-1 text-xs text-[oklch(0.62_0.025_205)]"
              >
                <RotateCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
            {BENCHMARK_AREAS.slice(0, 4).map((area) => {
              const summary = leaderboard?.areas.find((item) => item.area.key === area.key);
              const leader = summary?.entries[0];
              return (
                <button
                  key={area.key}
                  type="button"
                  onClick={() => setSelectedArea(area.key)}
                  className={`rounded-md border px-3 py-3 text-left transition-colors ${
                    selectedArea === area.key
                      ? "border-[oklch(0.42_0.026_195)] bg-[oklch(0.14_0.010_205)]"
                      : "border-[oklch(0.22_0.008_245)] bg-[oklch(0.108_0.004_245)] hover:border-[oklch(0.30_0.016_215)]"
                  }`}
                  title={area.detail}
                >
                  <div className="flex items-center gap-2">
                    <img src={BENCHMARK_ICON_SRC[area.icon]} alt="" className="h-8 w-8 rounded-md object-cover" />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-[oklch(0.84_0.014_225)]">{area.shortLabel}</div>
                      <div className="text-[10px] text-[oklch(0.48_0.012_230)]">{summary?.trialCount ?? 0} trials</div>
                    </div>
                  </div>
                  <div className="mt-3 truncate text-[11px] text-[oklch(0.60_0.014_225)]">
                    {leader ? `${leader.model} / ${leader.averageScore.toFixed(1)}` : "Awaiting runs"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-md border border-[oklch(0.20_0.006_245)] bg-[oklch(0.106_0.004_245)] p-3">
          <div className="mb-3 flex flex-wrap gap-1 pb-1" role="tablist" aria-label="Benchmark areas">
            {BENCHMARK_AREAS.map((area) => {
              const active = selectedArea === area.key;
              const populated = populatedAreas.has(area.key);
              return (
                <button
                  key={area.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelectedArea(area.key)}
                  className={`flex h-8 flex-none items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors ${
                    active
                      ? "border-[oklch(0.42_0.024_195)] bg-[oklch(0.15_0.010_205)] text-[oklch(0.82_0.030_205)]"
                      : "border-transparent text-[oklch(0.52_0.012_230)] hover:border-[oklch(0.24_0.010_245)] hover:bg-[oklch(0.12_0.004_245)] hover:text-[oklch(0.78_0.014_220)]"
                  }`}
                  title={area.detail}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${populated ? "bg-[oklch(0.68_0.045_190)]" : "bg-[oklch(0.28_0.010_245)]"}`} />
                  {area.label}
                </button>
              );
            })}
          </div>

          <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
            <div className="rounded-md border border-[oklch(0.18_0.006_245)] bg-[oklch(0.094_0.003_245)] p-3">
              <div className="flex items-start gap-3">
                <img src={iconSrc} alt="" className="h-14 w-14 flex-none rounded-md object-cover shadow-[0_12px_28px_oklch(0_0_0_/_0.30)]" />
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-[oklch(0.48_0.012_230)]">{selected.area.shortLabel}</div>
                  <div className="mt-1 text-sm font-semibold text-[oklch(0.86_0.016_225)]">{selected.area.label}</div>
                  <p className="mt-1 text-xs leading-relaxed text-[oklch(0.54_0.012_230)]">{selected.area.detail}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded border border-[oklch(0.18_0.006_245)] px-2 py-2">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-[oklch(0.42_0.010_230)]">Leader</div>
                  <div className="mt-1 truncate text-xs font-semibold text-[oklch(0.78_0.030_205)]" title={champion?.model ?? "No leader"}>{champion?.model ?? "--"}</div>
                </div>
                <div className="rounded border border-[oklch(0.18_0.006_245)] px-2 py-2">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-[oklch(0.42_0.010_230)]">Trials</div>
                  <div className="mt-1 font-mono text-sm text-[oklch(0.78_0.020_220)]">{selected.trialCount}</div>
                </div>
                <div className="rounded border border-[oklch(0.18_0.006_245)] px-2 py-2">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-[oklch(0.42_0.010_230)]">Evals</div>
                  <div className="mt-1 font-mono text-sm text-[oklch(0.78_0.020_220)]">{selected.evalCount}</div>
                </div>
              </div>
            </div>

            <div className="min-w-0 rounded-md border border-[oklch(0.18_0.006_245)] bg-[oklch(0.094_0.003_245)]">
              {selected.entries.length === 0 ? (
                <div className="flex min-h-[220px] flex-col items-center justify-center px-4 py-8 text-center">
                  <img src={iconSrc} alt="" className="h-16 w-16 rounded-md object-cover opacity-70" />
                  <div className="mt-3 text-sm font-semibold text-[oklch(0.82_0.014_225)]">No ranking data in this area</div>
                  <div className="mt-1 max-w-md text-xs leading-relaxed text-[oklch(0.52_0.012_230)]">
                    Run the matching suite and save any required human scores to populate this leaderboard.
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-[oklch(0.16_0.006_245)]">
                  {selected.entries.slice(0, 8).map((entry) => {
                    const scoreWidth = `${Math.max(0, Math.min(100, entry.averageScore * 10))}%`;
                    return (
                      <div key={entry.model} className="benchmark-rank-row grid gap-3 px-3 py-3 md:grid-cols-[54px_minmax(0,1fr)_140px_110px] md:items-center">
                        <div className="flex items-center gap-2">
                          <span className={`grid h-8 w-8 place-items-center rounded-md border font-mono text-sm ${
                            entry.rank === 1
                              ? "border-[oklch(0.62_0.055_88)] bg-[oklch(0.18_0.020_88)] text-[oklch(0.82_0.070_88)]"
                              : "border-[oklch(0.24_0.010_245)] bg-[oklch(0.11_0.004_245)] text-[oklch(0.58_0.014_230)]"
                          }`}>
                            {entry.rank}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-[oklch(0.86_0.014_225)]" title={entry.model}>{entry.model}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-[oklch(0.46_0.010_230)]">
                            <span>{entry.sourceLabel}</span>
                            <span>{entry.winCount} area win{entry.winCount === 1 ? "" : "s"}</span>
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] uppercase tracking-[0.12em] text-[oklch(0.46_0.010_230)]">Avg</span>
                            <span className="font-mono text-sm text-[oklch(0.82_0.018_220)]">{entry.averageScore.toFixed(1)}</span>
                          </div>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[oklch(0.14_0.006_245)]">
                            <div className="h-full rounded-full bg-[linear-gradient(90deg,oklch(0.62_0.050_190),oklch(0.72_0.055_88))]" style={{ width: scoreWidth }} />
                          </div>
                        </div>
                        <div className="text-xs text-[oklch(0.54_0.012_230)] md:text-right">
                          <div>{entry.trialCount} trial{entry.trialCount === 1 ? "" : "s"}</div>
                          <div className="mt-0.5 text-[10px] text-[oklch(0.42_0.010_230)]">{entry.evalCount} eval{entry.evalCount === 1 ? "" : "s"}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function HistoryPanel({ onLoad }: { onLoad: (id: string) => void }) {
  const [items, setItems] = useState<EvalMeta[]>([]);
  const refresh = useCallback(() => {
    commands.listEvals().then(setItems).catch(console.error);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function del(id: string) {
    await commands.deleteEval(id);
    refresh();
  }

  if (items.length === 0) {
    return <div className="text-xs text-[oklch(0.44_0.008_225)] p-3">No past evals.</div>;
  }
  return (
    <div className="flex flex-col gap-1 p-2 overflow-y-auto">
      {items.map((m) => {
        const reviewBadge = evalReviewModeBadge({
          suiteId: m.suite_id,
          prompt: m.prompt,
        });

        return (
          <div key={m.id} className="group flex items-start gap-2 px-2 py-2 rounded hover:bg-[oklch(0.135_0.004_245)] cursor-pointer">
            <button onClick={() => onLoad(m.id)} className="flex-1 text-left min-w-0">
              <div className="text-xs text-[oklch(0.82_0.012_220)] line-clamp-2">{m.prompt}</div>
              <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[10px] text-[oklch(0.46_0.010_225)]">
                <span
                  className={`rounded border px-1.5 py-0.5 leading-none ${
                    reviewBadge.mode === "automatic"
                      ? "border-[oklch(0.62_0.055_155)] bg-[oklch(0.16_0.018_155)] text-[oklch(0.75_0.060_155)]"
                      : "border-[oklch(0.62_0.040_72)] bg-[oklch(0.16_0.018_72)] text-[oklch(0.76_0.060_72)]"
                  }`}
                  title={reviewBadge.detail}
                >
                  {reviewBadge.label}
                </span>
                {m.suite_id && <span className="text-[oklch(0.68_0.040_205)]">[{m.suite_id}]</span>}
                <span>{m.models.length} models</span>
                <span>Â·</span>
                {(m.manual_review_count ?? 0) > 0 && (
                  <>
                    <span>{m.manual_review_count} reviewed</span>
                    <span>|</span>
                  </>
                )}
                <span>{new Date(m.created_at * 1000).toLocaleString()}</span>
              </div>
            </button>
            <button onClick={() => del(m.id)} className="opacity-0 group-hover:opacity-100 text-[oklch(0.45_0_0)] hover:text-red-400 transition-opacity">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MAIN VIEW
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
type Mode = "single" | "suite" | "goal";
type SetupStepId = "models" | "task" | "review";
type ReviewNotice = { title: string; detail: string };

function noticeDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const PREVIEW_GOAL_PROMPT = "Refactor src/components/eval/EvalView.tsx to clarify the blind review flow, preserve reveal gating, and verify tests pass.";

function isPreviewEvalId(id: string): boolean {
  return id.startsWith("preview-goal-");
}

function previewResponse(index: number, goal: string): string {
  const openings = [
    "Start with the review contract before touching layout details.",
    "Treat the goal as a workflow problem, then reduce the visual surface.",
    "Keep the comparison objective by separating human scoring from model identity.",
  ];
  const checks = [
    "Verify the blind labels remain stable through score entry and save.",
    "Confirm rankings, telemetry, and judge notes stay hidden before reveal.",
    "Run the focused tests, build the app, and smoke the eval tab in preview.",
  ];

  const artifact = index % 2 === 0
    ? [
        "### Runnable artifact",
        "```html",
        "<!doctype html><html><body><canvas id=\"game\" width=\"420\" height=\"240\"></canvas><script>const canvas=document.getElementById('game');const ctx=canvas.getContext('2d');ctx.fillStyle='#071114';ctx.fillRect(0,0,420,240);ctx.fillStyle='#7ee7d6';ctx.fillRect(24,80,10,70);ctx.fillRect(386,96,10,70);ctx.beginPath();ctx.arc(210,120,9,0,Math.PI*2);ctx.fill();</script></body></html>",
        "```",
      ]
    : [
        "### Runnable artifact",
        "Save as `preview_pong.py`.",
        "```python",
        "import pygame",
        "pygame.init()",
        "screen = pygame.display.set_mode((420, 240))",
        "pygame.display.set_caption('Preview Pong')",
        "```",
      ];

  return [
    "### Approach",
    openings[index % openings.length],
    "",
    "### Changes",
    `- Scope the work to: ${goal}`,
    "- Keep the primary path in the setup surface instead of adding another dashboard panel.",
    "- Preserve anonymous labels until human scores are complete and saved.",
    "",
    "### Verification",
    `- ${checks[index % checks.length]}`,
    "- Leave provider calls out of preview mode.",
    "",
    ...artifact,
  ].join("\n");
}

function previewReasoning(index: number, goal: string): string {
  return [
    `Goal: ${goal}`,
    "Need to keep provider identity out of the scoring pass.",
    index % 2 === 0
      ? "The safer path is a local preview trial that exercises the review UI without calling providers."
      : "The UI should expose the next review step without adding another prominent card.",
    "Verification should cover the browser preview and the normal test/build gates.",
  ].join("\n");
}

function previewGoalGrades(models: string[], judgeModel: string): Record<string, GoalGrade> {
  return Object.fromEntries(models.map((model, index) => {
    const base = 3 + (index % 3);
    return [model, {
      judge_model: judgeModel,
      axes: Object.fromEntries(GOAL_AXES.map((axis, axisIndex) => [
        axis.key,
        {
          score: Math.min(5, base + (axisIndex % 2)),
          evidence: axisIndex % 2 === 0 ? "Preserve reveal gating" : "Verify tests pass",
        },
      ])),
      flags: index === 0
        ? [{
            kind: "good_decomposition",
            severity: "info",
            quote: "Start with the review contract",
            comment: "The response scopes the work before changing UI.",
            offset_chars: 0,
          }]
        : [],
      summary: "Preview-only grade generated locally for review-flow testing.",
    }];
  }));
}

function previewJudgeScores(models: string[], judgeModel: string): JudgeScores {
  return {
    judge_model: judgeModel,
    scores: Object.fromEntries(models.map((model, index) => {
      const score = 6 + (index % 4);
      return [model, {
        accuracy: score,
        helpfulness: score,
        quality: Math.min(10, score + 1),
        creativity: Math.max(1, score - 1),
        design: score,
        aesthetics: score,
        ai_slop: Math.min(10, score + 1),
        brevity: score,
      }];
    })),
    rationale: Object.fromEntries(models.map((model) => [
      model,
      "Preview-only judge note generated locally after blind review is saved.",
    ])),
  };
}

function ModeButton({
  active, onClick, icon, title, hint, tone = "default",
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  hint: string;
  tone?: "default" | "goal";
}) {
  const iconClass = active && tone === "goal"
    ? "text-[oklch(0.74_0.045_195)]"
    : active
      ? "text-[oklch(0.72_0.030_220)]"
      : "text-[oklch(0.46_0.010_235)] group-hover:text-[oklch(0.66_0.018_220)]";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={title}
      title={hint}
      className={[
        "group flex min-w-0 flex-1 items-center gap-2 rounded px-2.5 py-1.5 text-left transition-colors sm:w-auto",
        active
          ? "bg-[oklch(0.148_0.008_220)] text-[oklch(0.88_0.018_220)] shadow-[inset_0_0_0_1px_oklch(0.30_0.014_220)]"
          : "text-[oklch(0.55_0.010_230)] hover:bg-[oklch(0.13_0.004_245)] hover:text-[oklch(0.80_0.014_220)]",
      ].join(" ")}
    >
      <span className={`flex h-6 w-6 flex-none items-center justify-center ${iconClass}`}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold">{title}</span>
        <span className="mt-0.5 hidden truncate text-[10px] leading-snug text-[oklch(0.52_0.012_230)] xl:block">{hint}</span>
      </span>
    </button>
  );
}

function BlindReviewBanner({
  blindMode,
  onToggle,
  hasActiveEval,
  revealLocked,
  revealLockTitle,
  progressLabel,
}: {
  blindMode: boolean;
  onToggle: () => void;
  hasActiveEval: boolean;
  revealLocked: boolean;
  revealLockTitle: string;
  progressLabel: string;
}) {
  const toggleDisabled = !hasActiveEval || revealLocked;
  const toggleTitle = !hasActiveEval
    ? "Goal evals start in blind mode"
    : revealLocked
      ? revealLockTitle
      : blindMode
        ? "Reveal model names"
        : "Hide model names";
  const toggleLabel = !hasActiveEval
    ? "Blind on"
    : revealLocked
      ? "Locked"
      : blindMode
        ? "Reveal names"
        : "Hide names";

  return (
    <div className="relative overflow-hidden rounded-md border border-[oklch(0.22_0.008_240)] bg-[oklch(0.108_0.004_245)] px-3 py-3">
      <div className="absolute inset-y-3 left-0 w-px bg-[oklch(0.62_0.035_190)]/55" aria-hidden="true" />
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-[oklch(0.28_0.012_235)] bg-[oklch(0.12_0.004_245)]">
            <ShieldCheck className="h-4 w-4 text-[oklch(0.62_0.030_195)]" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[oklch(0.90_0.025_220)]">Blind human review</div>
            <div className="mt-0.5 text-xs leading-relaxed text-[oklch(0.62_0.025_225)]">
              Responses get stable randomized labels while scoring. Reveal names only after the review pass.
            </div>
            <div className={`mt-2 inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${
              revealLocked
                ? "border-[oklch(0.32_0.030_72)] bg-[oklch(0.13_0.010_72)] text-[oklch(0.66_0.040_72)]"
                : "border-[oklch(0.30_0.018_175)] bg-[oklch(0.12_0.006_180)] text-[oklch(0.66_0.035_185)]"
            }`}>
              {revealLocked ? <AlertTriangle className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
              {progressLabel}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          disabled={toggleDisabled}
          aria-pressed={blindMode}
          aria-label={toggleTitle}
          className={[
            "flex h-7 flex-none items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
            toggleDisabled
              ? "cursor-not-allowed border-[oklch(0.27_0.010_240)] bg-[oklch(0.105_0.004_245)] text-[oklch(0.46_0.012_245)]"
            : blindMode
              ? "border-[oklch(0.34_0.018_190)] bg-[oklch(0.13_0.006_200)] text-[oklch(0.70_0.040_190)]"
              : "border-[oklch(0.32_0.012_245)] bg-[oklch(0.12_0.006_245)] text-[oklch(0.62_0.012_245)]",
          ].join(" ")}
          title={toggleTitle}
        >
          {blindMode ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {toggleLabel}
        </button>
      </div>
    </div>
  );
}

function readinessTone(state: GoalReadinessState): string {
  if (state === "ready") return "border-[oklch(0.34_0.020_170)] bg-[oklch(0.13_0.008_175)] text-[oklch(0.68_0.035_175)]";
  if (state === "blocked") return "border-[oklch(0.36_0.035_28)] bg-[oklch(0.13_0.010_28)] text-[oklch(0.68_0.045_28)]";
  return "border-[oklch(0.34_0.026_72)] bg-[oklch(0.13_0.010_72)] text-[oklch(0.68_0.040_72)]";
}

function readinessIcon(state: GoalReadinessState) {
  if (state === "ready") return <CheckCircle2 className="h-3 w-3" />;
  if (state === "blocked") return <AlertTriangle className="h-3 w-3" />;
  return <CircleDot className="h-3 w-3" />;
}

function GoalReadinessPanel({ readiness }: { readiness: GoalEvalReadiness }) {
  const blocked = readiness.items.filter((item) => item.state === "blocked").length;
  const readinessLabel = readiness.canRun ? "Goal brief ready" : `Goal brief has ${blocked} blocking item${blocked === 1 ? "" : "s"}`;

  return (
    <div
      role="group"
      aria-label={readinessLabel}
      className="rounded-md border border-[oklch(0.22_0.008_245)] bg-[oklch(0.108_0.004_245)] px-3 py-2"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[oklch(0.84_0.016_225)]">
          <Gauge className="h-3.5 w-3.5 flex-none text-[oklch(0.62_0.030_195)]" />
          <span>Goal brief</span>
          <span className="hidden text-[11px] font-normal text-[oklch(0.50_0.012_230)] sm:inline">
            Scope, criteria, comparison, then blind review.
          </span>
        </div>
        <span className="rounded border border-[oklch(0.28_0.012_235)] bg-[oklch(0.12_0.004_245)] px-2 py-0.5 text-[10px] uppercase tracking-[0.13em] text-[oklch(0.60_0.018_220)]">
          {readiness.canRun ? "Ready" : `${blocked} blocking`}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1.5 lg:grid-cols-3">
        {readiness.items.map((item) => (
          <div
            key={item.id}
            className="flex min-h-9 items-start gap-2 rounded px-1.5 py-1"
            title={`${item.label}: ${item.detail}`}
            aria-label={`${item.label}: ${item.state}. ${item.detail}`}
          >
            <div className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border ${readinessTone(item.state)}`}>
              {readinessIcon(item.state)}
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-[oklch(0.78_0.014_225)]">{item.label}</div>
              <div className="text-[10px] leading-snug text-[oklch(0.50_0.012_230)]">{item.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function workflowMarkerTone(state: GoalWorkflowStep["state"]): string {
  if (state === "done") return "border-[oklch(0.31_0.014_180)] bg-[oklch(0.13_0.006_190)] text-[oklch(0.68_0.030_185)]";
  if (state === "current") return "border-[oklch(0.42_0.022_195)] bg-[oklch(0.145_0.008_205)] text-[oklch(0.78_0.032_200)] shadow-[0_0_0_3px_oklch(0.16_0.010_205)]";
  return "border-[oklch(0.23_0.008_245)] bg-[oklch(0.105_0.004_245)] text-[oklch(0.42_0.010_235)]";
}

function workflowLabelTone(state: GoalWorkflowStep["state"]): string {
  if (state === "done") return "text-[oklch(0.70_0.022_190)]";
  if (state === "current") return "text-[oklch(0.86_0.018_210)]";
  return "text-[oklch(0.48_0.012_230)]";
}

function workflowIcon(step: GoalWorkflowStep) {
  if (step.state === "done") return <CheckCircle2 className="h-3.5 w-3.5" />;
  return <CircleDot className="h-3.5 w-3.5" />;
}

function GoalWorkflowStrip({ steps }: { steps: GoalWorkflowStep[] }) {
  const currentStep = steps.find((step) => step.state === "current") ?? steps.find((step) => step.state === "locked") ?? steps[steps.length - 1];

  return (
    <div className="rounded-md border border-[oklch(0.20_0.006_245)] bg-[oklch(0.104_0.003_245)] px-3 py-2.5">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.15em] text-[oklch(0.52_0.012_230)]">
          <ShieldCheck className="h-3 w-3 text-[oklch(0.58_0.025_195)]" />
          Review protocol
        </div>
        <div className="text-[11px] leading-snug text-[oklch(0.60_0.014_225)]">
          <span className="text-[oklch(0.72_0.020_210)]">{currentStep?.label}</span>
          <span className="text-[oklch(0.45_0.010_230)]"> / </span>
          {currentStep?.detail}
        </div>
      </div>
      <div className="relative mt-3">
        <div className="absolute left-3 right-3 top-3 hidden h-px bg-[oklch(0.22_0.008_245)] sm:block" aria-hidden="true" />
        <ol className="relative grid grid-cols-1 gap-2 sm:grid-cols-5" aria-label="Goal eval review protocol">
          {steps.map((step, index) => (
            <li
              key={step.id}
              className="relative z-10 flex min-w-0 items-center gap-2 sm:flex-col sm:gap-1.5 sm:text-center"
              aria-current={step.state === "current" ? "step" : undefined}
              aria-label={`${step.label}: ${step.detail}`}
              title={step.detail}
            >
              <span aria-hidden="true" className={`flex h-6 w-6 flex-none items-center justify-center rounded-full border text-[10px] transition-colors ${workflowMarkerTone(step.state)}`}>
                {step.state === "locked" ? <span className="font-mono text-[10px]">{index + 1}</span> : workflowIcon(step)}
              </span>
              <span className={`block min-w-0 truncate text-[11px] font-medium ${workflowLabelTone(step.state)}`}>
                {step.label}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function ReviewNoticeBanner({
  notice,
  onDismiss,
}: {
  notice: ReviewNotice;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-[oklch(0.38_0.040_28)] bg-[oklch(0.13_0.014_28)] px-3 py-2 text-xs text-[oklch(0.72_0.060_28)]" role="alert">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-[oklch(0.78_0.065_28)]">{notice.title}</div>
        <div className="mt-0.5 break-words leading-relaxed text-[oklch(0.68_0.045_28)]">{notice.detail}</div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="flex-none rounded px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[oklch(0.62_0.035_28)] transition-colors hover:bg-[oklch(0.18_0.020_28)] hover:text-[oklch(0.78_0.055_28)]"
      >
        Dismiss
      </button>
    </div>
  );
}

function BlindResultsLockPanel({
  gate,
  progressLabel,
}: {
  gate: BlindResultsGate;
  progressLabel: string;
}) {
  return (
    <div className="rounded-md border border-[oklch(0.24_0.010_245)] bg-[oklch(0.112_0.004_245)] px-3 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-md border border-[oklch(0.30_0.014_235)] bg-[oklch(0.10_0.004_245)] text-[oklch(0.62_0.030_195)]">
          <ShieldCheck className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[oklch(0.86_0.016_225)]">{gate.label}</span>
            <span className="rounded border border-[oklch(0.30_0.014_235)] bg-[oklch(0.12_0.004_245)] px-2 py-0.5 text-[10px] uppercase tracking-[0.13em] text-[oklch(0.58_0.018_220)]">
              {progressLabel}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[oklch(0.56_0.014_225)]">
            {gate.detail} Response cards stay available so each anonymous model can be scored without seeing a ranked summary.
          </p>
        </div>
      </div>
    </div>
  );
}

function EvalRunStrip({ blindMode }: { blindMode: boolean }) {
  const activeEval = useEvalStore((s) => s.activeEval);
  if (!activeEval) return null;

  const done = activeEval.models.filter((m) => {
    const status = activeEval.modelStates[m]?.status;
    return status === "done" || status === "error";
  }).length;
  const tokenTotal = activeEval.models.reduce((sum, model) => {
    const s = activeEval.modelStates[model];
    return sum + (s?.input_tokens ?? 0) + (s?.output_tokens ?? 0);
  }, 0);
  const costTotal = activeEval.models.reduce((sum, model) => {
    const s = activeEval.modelStates[model];
    return sum + calcCost(model, s?.input_tokens ?? 0, s?.output_tokens ?? 0);
  }, 0);

  const orderedBlindLabels = Object.entries(activeEval.blindLabels).sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_auto]">
      <div className="rounded-md border border-[oklch(0.24_0.010_245)] bg-[oklch(0.115_0.004_245)] px-3 py-2">
        <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-[oklch(0.54_0.016_220)]">
          <Gauge className="h-3 w-3" />
          Active trial
        </div>
        <div className="line-clamp-2 text-sm leading-relaxed text-[oklch(0.84_0.015_220)]">{activeEval.prompt}</div>
      </div>
      <div className="rounded-md border border-[oklch(0.24_0.010_245)] bg-[oklch(0.115_0.004_245)] px-3 py-2 text-xs">
        <div className="text-[10px] uppercase tracking-[0.15em] text-[oklch(0.52_0.012_230)]">Progress</div>
        <div className="mt-1 font-mono text-[oklch(0.76_0.040_190)]">{done}/{activeEval?.models.length ?? 0}</div>
      </div>
      <div className="rounded-md border border-[oklch(0.24_0.010_245)] bg-[oklch(0.115_0.004_245)] px-3 py-2 text-xs">
        <div className="text-[10px] uppercase tracking-[0.15em] text-[oklch(0.52_0.012_230)]">Telemetry</div>
        <div className={`mt-1 ${blindMode ? "text-[oklch(0.54_0.018_225)]" : "font-mono text-[oklch(0.76_0.040_190)]"}`}>
          {blindMode ? "hidden during blind review" : `${tokenTotal} tok / $${costTotal.toFixed(4)}`}
        </div>
      </div>
      {activeEval.complete && (
        <div className="md:col-span-3 rounded-md border border-[oklch(0.31_0.018_205)] bg-[oklch(0.13_0.008_220)] px-3 py-2 text-xs text-[oklch(0.66_0.035_195)]">
          {blindMode
            ? `Blind labels locked: ${orderedBlindLabels.map(([, label]) => label).join(", ")}`
            : `Revealed mapping: ${orderedBlindLabels.map(([model, label]) => `${label} = ${model}`).join(", ")}`}
        </div>
      )}
    </div>
  );
}

export function EvalView() {
  const [mode, setMode] = useState<Mode>("goal");
  const [prompt, setPrompt] = useState("");
  const [selectedModels, setSelectedModels] = useState<string[]>(["claude-haiku-4-5-20251001", "kimi2.6"]);
  const [allModels, setAllModels] = useState<string[]>([]);
  const [suites, setSuites] = useState<EvalSuite[]>([]);
  const [selectedSuite, setSelectedSuite] = useState<string>("reasoning");
  const [running, setRunning] = useState(false);
  const [savingScores, setSavingScores] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [judgeRunning, setJudgeRunning] = useState(false);
  const [judgeModel, setJudgeModel] = useState<string>("claude-sonnet-4-6");
  const [liveSupervisor, setLiveSupervisor] = useState(true);
  const [goalGrading, setGoalGrading] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [reviewNotice, setReviewNotice] = useState<ReviewNotice | null>(null);
  const [setupStep, setSetupStep] = useState<SetupStepId>("models");
  const [evalStage, setEvalStage] = useState<EvalFlowStage>("battle");
  const [showDashboard, setShowDashboard] = useState(false);
  const isBrowserPreview = typeof window !== "undefined" && Boolean(window.__XOLOTL_BROWSER_PREVIEW__);

  const activeEval = useEvalStore((s) => s.activeEval);
  const humanScores = useEvalStore((s) => s.humanScores);
  const manualReviews = useEvalStore((s) => s.manualReviews);
  const scoresDirty = useEvalStore((s) => s.scoresDirty);
  const reviewDirty = useEvalStore((s) => s.reviewDirty);
  const blindMode = useEvalStore((s) => s.blindMode);
  const toggleBlind = useEvalStore((s) => s.toggleBlind);
  const setBlindMode = useEvalStore((s) => s.setBlindMode);
  const {
    startEval, setModelRunning, appendModelDelta, appendModelReasoning, pushReasoningFlag,
    completeModel, finalizeEval, failEval, setJudge, setGoalGrades, markHumanScoresSaved,
    setManualReview, markManualReviewsSaved, setReliabilityMetrics,
  } = useEvalStore.getState();

  const reviewMode = useMemo<EvalReviewMode>(
    () => activeEval
      ? determineEvalReviewMode({
        suiteId: activeEval.suite_id,
        prompt: activeEval.prompt,
        isGoalEval: activeEval.is_goal_eval,
      })
      : mode === "suite"
        ? determineEvalReviewMode({ suiteId: selectedSuite, prompt: "", isGoalEval: false })
        : determineEvalReviewMode({ suiteId: null, prompt, isGoalEval: mode === "goal" }),
    [activeEval, mode, prompt, selectedSuite]
  );

  useEffect(() => {
    commands.listModels()
      .then(setAllModels)
      .catch((error) => setReviewNotice({ title: "Eval setup unavailable", detail: noticeDetail(error) }));
    commands.listEvalSuites()
      .then(setSuites)
      .catch((error) => setReviewNotice({ title: "Eval suites unavailable", detail: noticeDetail(error) }));
  }, []);

  useEffect(() => {
    if (activeEval && reviewMode === "automatic" && blindMode) {
      setBlindMode(false);
    }
  }, [activeEval, blindMode, reviewMode, setBlindMode]);

  // Map model -> display name (blind A/B/C or real name)
  const blindNames = useMemo<Record<string, string>>(() => {
    if (reviewMode === "automatic" || !blindMode || !activeEval) return {};
    return activeEval.blindLabels;
  }, [blindMode, activeEval, reviewMode]);

  const reviewModels = useMemo(
    () => activeEval ? getReviewOrder(activeEval.models, activeEval.blindLabels, blindMode) : [],
    [activeEval, blindMode]
  );
  const scoreableReviewModels = useMemo(
    () => activeEval ? activeEval.models.filter((model) => hasScoreableOutput(activeEval.modelStates[model])) : [],
    [activeEval]
  );
  const blindReviewProgress = useMemo(
    () => activeEval ? getBlindReviewProgress(scoreableReviewModels, humanScores) : null,
    [activeEval, scoreableReviewModels, humanScores]
  );
  const saveRequiredForReveal = Boolean(activeEval && blindMode && blindReviewProgress?.complete && scoresDirty);
  const revealLocked = Boolean(activeEval && blindMode && blindReviewProgress && (!blindReviewProgress.complete || scoresDirty));
  const blindProgressLabel = blindReviewProgress
    ? blindReviewProgress.complete
      ? scoresDirty
        ? "Review complete - save to reveal"
        : "Review saved"
      : `${blindReviewProgress.completedScores}/${blindReviewProgress.totalScores} scores complete`
    : mode === "goal"
      ? "Blind by default"
      : `${SCORE_DIMENSION_COUNT} score axes`;
  const canFinishHumanReview = !blindReviewProgress || blindReviewProgress.totalModels === 0 || blindReviewProgress.complete;
  const revealLockTitle = saveRequiredForReveal
    ? "Save blind scores before revealing model names"
    : "Finish blind scores before revealing model names";
  const blindToggleTitle = revealLocked
    ? revealLockTitle
    : blindMode
      ? "Reveal model names"
      : "Hide model names";
  const reviewGate = useMemo(
    () => assessBlindReviewGate({
      isGoalEval: Boolean(activeEval?.is_goal_eval),
      blindMode,
      reviewComplete: Boolean(blindReviewProgress?.complete),
      scoresDirty,
      reviewMode,
    }),
    [activeEval?.is_goal_eval, blindMode, blindReviewProgress?.complete, scoresDirty, reviewMode]
  );
  const resultsGate = useMemo(
    () => assessBlindResultsGate({
      isGoalEval: Boolean(activeEval?.is_goal_eval),
      blindMode,
      reviewComplete: Boolean(blindReviewProgress?.complete),
      scoresDirty,
      reviewMode,
    }),
    [activeEval?.is_goal_eval, blindMode, blindReviewProgress?.complete, scoresDirty, reviewMode]
  );
  const comparison = useMemo(
    () => activeEval
      ? buildEvalComparison({ activeEval, humanScores, manualReviews, blindNames })
      : null,
    [activeEval, humanScores, manualReviews, blindNames]
  );
  const handleBlindToggle = useCallback(() => {
    if (revealLocked) return;
    toggleBlind();
  }, [revealLocked, toggleBlind]);
  const goalReadiness = useMemo(
    () => assessGoalEvalReadiness({
      goal: prompt,
      modelCount: selectedModels.length,
      blindMode,
      liveSupervisor,
    }),
    [prompt, selectedModels.length, blindMode, liveSupervisor]
  );
  const goalWorkflowSteps = useMemo(
    () => assessGoalWorkflowSteps({
      canRun: goalReadiness.canRun,
      hasActiveEval: Boolean(activeEval),
      evalComplete: Boolean(activeEval?.complete),
      reviewComplete: Boolean(blindReviewProgress?.complete),
      scoresDirty,
      blindMode,
      reviewMode,
    }),
    [goalReadiness.canRun, activeEval, blindReviewProgress?.complete, scoresDirty, blindMode, reviewMode]
  );
  const goalBlindSurface = mode === "goal" || Boolean(activeEval?.is_goal_eval);
  const runDisabled =
    running ||
    (mode === "goal"
      ? !goalReadiness.canRun
      : selectedModels.length === 0 || (mode === "single" && !prompt.trim()));
  const goalRunDisabledTitle =
    mode === "goal" && !goalReadiness.canRun
      ? "Add a scoped target, success criteria, and at least two models."
      : undefined;
  const requiredModelCount = mode === "goal" ? 2 : 1;
  const modelStepComplete = selectedModels.length >= requiredModelCount;
  const taskStepComplete = mode === "suite"
    ? Boolean(selectedSuite)
    : mode === "goal"
      ? goalReadiness.items.slice(0, 3).every((item) => item.state === "ready")
      : prompt.trim().length > 0;
  const setupSteps = useMemo(() => [
    {
      id: "models" as const,
      label: "Pick models",
      detail: modelStepComplete
        ? `${selectedModels.length} selected`
        : `Select ${requiredModelCount} or more`,
      complete: modelStepComplete,
    },
    {
      id: "task" as const,
      label: mode === "suite" ? "Choose suite" : "Assign task",
      detail: taskStepComplete
        ? mode === "suite" ? selectedSuite : "Task is scoped"
        : mode === "goal" ? "Add scope and criteria" : "Add a prompt",
      complete: taskStepComplete,
    },
    {
      id: "review" as const,
      label: "Review & run",
      detail: runDisabled ? "Resolve setup blockers" : "Ready to start",
      complete: !runDisabled,
    },
  ], [modelStepComplete, mode, requiredModelCount, runDisabled, selectedModels.length, selectedSuite, taskStepComplete]);
  const currentSetupStep = setupSteps.find((step) => step.id === setupStep) ?? setupSteps[0];
  const selectedSuiteMeta = suites.find((suite) => suite.id === selectedSuite);
  const selectedModelGroups = useMemo(() => {
    const g: Record<string, string[]> = {};
    for (const model of selectedModels) {
      const provider = PROVIDER_OF[model] ?? "Other";
      (g[provider] ??= []).push(model);
    }
    return g;
  }, [selectedModels]);

  // Subscribe to streaming eval events; survives multiple consecutive runs.
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const suiteUnlistenRef = useRef<UnlistenFn | null>(null);
  useEffect(() => {
    return () => {
      if (unlistenRef.current) unlistenRef.current();
      if (suiteUnlistenRef.current) suiteUnlistenRef.current();
      void commands.cleanupEvalProcesses().catch((error) => {
        console.error("cleanup_eval_processes error:", error);
      });
    };
  }, []);

  async function subscribeToEval(evalId: string) {
    if (unlistenRef.current) { unlistenRef.current(); unlistenRef.current = null; }
    const channel = `eval-event:${evalId}`;
    const un = await listen<any>(channel, (event) => {
      const p = event.payload;
      switch (p.type) {
        case "ModelStart":      if (p.model) setModelRunning(evalId, p.model); break;
        case "ModelDelta":      if (p.model && p.text) appendModelDelta(evalId, p.model, p.text); break;
        case "ModelReasoningDelta": if (p.model && p.text) appendModelReasoning(evalId, p.model, p.text); break;
        case "ReasoningFlag":   if (p.model && p.flag) pushReasoningFlag(evalId, p.model, p.flag); break;
        case "ModelComplete":
          if (p.model) {
            completeModel(evalId, p.model, {
              input_tokens: p.input_tokens ?? 0,
              output_tokens: p.output_tokens ?? 0,
              duration_ms: p.duration_ms ?? 0,
              error: p.error ?? undefined,
              auto: p.auto_scores,
              reasoning: p.reasoning,
            });
          }
          break;
        case "EvalComplete": {
          finalizeEval(evalId);
          // During a suite run, each prompt fires its own EvalComplete; the run
          // is only finished on SuiteComplete. Clearing `running` per-prompt
          // would briefly re-enable the run button between prompts.
          if (!suiteUnlistenRef.current) setRunning(false);
          // Pull the just-persisted reliability metrics (cost / tok-s /
          // token-count error) into the store without disturbing the live
          // model states. Non-blocking and best-effort.
          void (async () => {
            try {
              const reloaded = await commands.loadEval(evalId);
              if (reloaded.status === "ok") {
                const parsed: EvalResult = JSON.parse(reloaded.data);
                if (parsed.reliability_metrics && Object.keys(parsed.reliability_metrics).length > 0) {
                  setReliabilityMetrics(evalId, parsed.reliability_metrics);
                }
              }
            } catch (error) {
              console.error("reliability hydrate error:", error);
            }
          })();
          const completedEval = useEvalStore.getState().activeEval;
          if (completedEval?.id === evalId) {
            const completedReviewMode = determineEvalReviewMode({
              suiteId: completedEval.suite_id,
              prompt: completedEval.prompt,
              isGoalEval: completedEval.is_goal_eval,
            });
            if (completedReviewMode === "automatic") {
              setBlindMode(false);
              setEvalStage("results");
            }
          }
          if (un) un();
          unlistenRef.current = null;
          break;
        }
        case "EvalError": {
          const detail = typeof p.error === "string" ? p.error : "The eval runner stopped before all model outputs completed.";
          console.error("eval run error:", p.error);
          failEval(evalId, detail);
          setReviewNotice({ title: "Eval run failed", detail });
          setRunning(false);
          if (un) un();
          unlistenRef.current = null;
          break;
        }
      }
    });
    unlistenRef.current = un;
  }

  const cleanupEvalProcessesQuietly = useCallback(async () => {
    try {
      await commands.cleanupEvalProcesses();
    } catch (error) {
      console.error("cleanup_eval_processes error:", error);
    }
  }, []);

  const resetEvalFlow = useCallback(async () => {
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
    if (suiteUnlistenRef.current) {
      suiteUnlistenRef.current();
      suiteUnlistenRef.current = null;
    }
    await cleanupEvalProcessesQuietly();
    setPrompt("");
    setReviewNotice(null);
    setShowDashboard(false);
    setEvalStage("battle");
    setSetupStep("models");
    setRunning(false);
    setSavingScores(false);
    setJudgeRunning(false);
    setGoalGrading(false);
    setSavingReview(false);
    useEvalStore.setState({
      activeEval: null,
      humanScores: {},
      manualReviews: {},
      scoresDirty: false,
      reviewDirty: false,
      activeSuite: null,
      blindMode: true,
    });
  }, [cleanupEvalProcessesQuietly]);

  const runSingleEval = useCallback(async () => {
    if (!prompt.trim() || selectedModels.length === 0 || running) return;
    setReviewNotice(null);
    await cleanupEvalProcessesQuietly();
    setEvalStage("battle");
    setBlindMode(true);
    setRunning(true);
    const result = await commands.startEval(prompt.trim(), selectedModels).catch((error) => ({ status: "error" as const, error: noticeDetail(error) }));
    if (result.status === "error") {
      setReviewNotice({ title: "Could not start eval", detail: noticeDetail(result.error) });
      setRunning(false);
      return;
    }
    const evalId = result.data;
    startEval(evalId, prompt.trim(), selectedModels);
    try {
      await subscribeToEval(evalId);
    } catch (error) {
      const detail = noticeDetail(error);
      failEval(evalId, detail);
      setReviewNotice({ title: "Could not subscribe to eval events", detail });
      setRunning(false);
    }
  }, [prompt, selectedModels, running, cleanupEvalProcessesQuietly]);

  const runGoalEval = useCallback(async () => {
    if (!goalReadiness.canRun || running) return;
    setReviewNotice(null);
    await cleanupEvalProcessesQuietly();
    setEvalStage("battle");
    setBlindMode(true);
    setRunning(true);
    const supervisor = liveSupervisor ? judgeModel : null;
    const result = await commands
      .startGoalEval(prompt.trim(), selectedModels, liveSupervisor, supervisor)
      .catch((error) => ({ status: "error" as const, error: noticeDetail(error) }));
    if (result.status === "error") {
      setReviewNotice({ title: "Could not start goal eval", detail: noticeDetail(result.error) });
      setRunning(false);
      return;
    }
    const evalId = result.data;
    startEval(evalId, prompt.trim(), selectedModels, { is_goal_eval: true, live_supervisor: liveSupervisor });
    try {
      await subscribeToEval(evalId);
    } catch (error) {
      const detail = noticeDetail(error);
      failEval(evalId, detail);
      setReviewNotice({ title: "Could not subscribe to eval events", detail });
      setRunning(false);
    }
  }, [goalReadiness.canRun, prompt, selectedModels, running, liveSupervisor, judgeModel, setBlindMode, cleanupEvalProcessesQuietly]);

  const runSuiteEval = useCallback(async () => {
    if (selectedModels.length === 0 || running) return;
    setReviewNotice(null);
    await cleanupEvalProcessesQuietly();
    setEvalStage("battle");
    setBlindMode(true);
    setRunning(true);
    // Subscribe to suite-level events to track each prompt within the suite run.
    const result = await commands
      .runEvalSuite(selectedSuite, selectedModels)
      .catch((error) => ({ status: "error" as const, error: noticeDetail(error) }));
    if (result.status === "error") {
      setReviewNotice({ title: "Could not start eval suite", detail: noticeDetail(result.error) });
      setRunning(false);
      return;
    }
    const suiteRunId = result.data;
    const channel = `suite-event:${suiteRunId}`;
    // Each prompt inside the suite emits its own eval-event with a new eval id â€”
    // we listen for SuitePromptStart so we can hook the per-prompt channel.
    try {
      const suiteUnlisten = await listen<any>(channel, async (event) => {
        suiteUnlistenRef.current = suiteUnlisten;
        const p = event.payload;
        if (p.type === "SuitePromptStart" && p.eval_id) {
          // Backend pre-generates eval_id and emits it before model events, plus a
          // 50ms grace delay so this listen() call wins the race.
          startEval(p.eval_id, p.prompt, selectedModels, { suite_id: selectedSuite, suite_run_id: suiteRunId, suite_prompt_id: p.prompt_id });
          try {
            await subscribeToEval(p.eval_id);
          } catch (error) {
            const detail = noticeDetail(error);
            failEval(p.eval_id, detail);
            setReviewNotice({ title: "Could not subscribe to suite prompt events", detail });
            setRunning(false);
          }
        } else if (p.type === "SuiteComplete") {
          setRunning(false);
          suiteUnlisten();
          suiteUnlistenRef.current = null;
        }
      });
      suiteUnlistenRef.current = suiteUnlisten;
    } catch (error) {
      setReviewNotice({ title: "Could not subscribe to suite events", detail: noticeDetail(error) });
      setRunning(false);
    }
  }, [selectedSuite, selectedModels, running, cleanupEvalProcessesQuietly]);

  const loadPreviewGoalEval = useCallback(async () => {
    if (!isBrowserPreview || running) return;
    await cleanupEvalProcessesQuietly();
    const previewModels = selectedModels.length >= 2
      ? selectedModels
      : allModels.length >= 2
        ? allModels.slice(0, 2)
        : ["preview-model-a", "preview-model-b"];
    const previewPrompt = prompt.trim() || PREVIEW_GOAL_PROMPT;
    const evalId = `preview-goal-${Date.now()}`;
    const createdAt = Date.now();
    const goalGrades = previewGoalGrades(previewModels, judgeModel);
    const modelStates = Object.fromEntries(previewModels.map((model, index) => {
      const content = previewResponse(index, previewPrompt);
      const reasoning = previewReasoning(index, previewPrompt);
      const flags: ReasoningFlag[] = liveSupervisor && index === 0
        ? [{
            kind: "good_decomposition",
            severity: "info",
            quote: "Start with the review contract",
            comment: "Preview supervisor flag generated locally for review-flow testing.",
            offset_chars: 0,
          }]
        : [];

      return [model, {
        model,
        status: "done" as const,
        content,
        reasoning,
        flags,
        input_tokens: Math.round(previewPrompt.length / 4),
        output_tokens: Math.round(content.length / 4),
        duration_ms: 900 + index * 240,
        started_at: createdAt - (900 + index * 240),
        goalGrade: goalGrades[model],
      }];
    }));

    setMode("goal");
    setPrompt(previewPrompt);
    setSelectedModels(previewModels);
    setReviewNotice(null);
    setEvalStage("battle");
    setRunning(false);
    useEvalStore.setState({
      activeEval: {
        id: evalId,
        prompt: previewPrompt,
        models: previewModels,
        blindLabels: buildBlindLabels(evalId, previewModels),
        modelStates,
        complete: true,
        created_at: createdAt,
        suite_id: null,
        suite_run_id: null,
        suite_prompt_id: null,
        judge: null,
        is_goal_eval: true,
        live_supervisor: liveSupervisor,
      },
      humanScores: {},
      manualReviews: {},
      scoresDirty: false,
      reviewDirty: false,
      evalOpen: true,
      blindMode: true,
    });
  }, [
    allModels,
    cleanupEvalProcessesQuietly,
    isBrowserPreview,
    judgeModel,
    liveSupervisor,
    prompt,
    running,
    selectedModels,
  ]);

  async function saveScores(): Promise<boolean> {
    if (!activeEval) return false;
    setReviewNotice(null);
    setSavingScores(true);
    if (isBrowserPreview && isPreviewEvalId(activeEval.id)) {
      markHumanScoresSaved();
      setSavingScores(false);
      return true;
    }
    const scoresMap: Record<string, HumanScores> = {};
    for (const [model, partial] of Object.entries(humanScores)) {
      if (!hasScoreableOutput(activeEval.modelStates[model])) continue;
      scoresMap[model] = {
        accuracy:    partial.accuracy    ?? 5,
        helpfulness: partial.helpfulness ?? 5,
        quality:     partial.quality     ?? 5,
        creativity:  partial.creativity  ?? 5,
        design:      partial.design      ?? 5,
        aesthetics:  partial.aesthetics  ?? 5,
        ai_slop:     partial.ai_slop     ?? 5,
        brevity:     partial.brevity     ?? 5,
      };
    }
    try {
      const result = await commands.saveHumanScores(activeEval.id, JSON.stringify(scoresMap));
      if (result.status === "error") {
        console.error("save_human_scores error:", result.error);
        setReviewNotice({ title: "Could not save blind scores", detail: result.error });
        return false;
      } else {
        markHumanScoresSaved();
        return true;
      }
    } catch (error) {
      console.error("save_human_scores error:", error);
      setReviewNotice({ title: "Could not save blind scores", detail: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      setSavingScores(false);
    }
  }

  async function finishHumanReview() {
    if (!activeEval) return;
    if (blindReviewProgress && !blindReviewProgress.complete) {
      setReviewNotice({
        title: "Human review is incomplete",
        detail: "Score every visible category for each anonymous model before revealing the final comparison.",
      });
      return;
    }

    const saved = scoresDirty ? await saveScores() : true;
    if (!saved) return;
    setBlindMode(false);
    setEvalStage("results");
  }

  async function saveManualReviews() {
    if (!activeEval) return;
    setReviewNotice(null);
    setSavingReview(true);
    const normalized: Record<string, ManualReview> = {};
    const now = Math.floor(Date.now() / 1000);
    for (const model of activeEval.models) {
      const review = manualReviews[model];
      if (!review) continue;
      const notes = review.notes ?? "";
      const score = typeof review.score === "number" && Number.isFinite(review.score)
        ? Math.max(1, Math.min(10, review.score))
        : null;
      if (score === null && notes.trim().length === 0) continue;
      normalized[model] = {
        score,
        notes,
        updated_at: review.updated_at || now,
      };
    }

    if (isBrowserPreview && isPreviewEvalId(activeEval.id)) {
      useEvalStore.setState({ manualReviews: normalized, reviewDirty: false });
      setSavingReview(false);
      return;
    }

    try {
      const result = await commands.saveManualReviews(activeEval.id, JSON.stringify(normalized));
      if (result.status === "error") {
        console.error("save_manual_reviews error:", result.error);
        setReviewNotice({ title: "Could not save review", detail: result.error });
      } else {
        useEvalStore.setState({ manualReviews: normalized });
        markManualReviewsSaved();
      }
    } catch (error) {
      console.error("save_manual_reviews error:", error);
      setReviewNotice({ title: "Could not save review", detail: error instanceof Error ? error.message : String(error) });
    } finally {
      setSavingReview(false);
    }
  }

  async function runGoalGrade() {
    if (!activeEval || goalGrading) return;
    if (reviewGate.machineReviewLocked) return;
    setReviewNotice(null);
    if (isBrowserPreview && isPreviewEvalId(activeEval.id)) {
      setGoalGrading(true);
      setGoalGrades(previewGoalGrades(activeEval.models, judgeModel));
      setGoalGrading(false);
      return;
    }
    setGoalGrading(true);
    try {
      const result = await commands.runGoalGrade(activeEval.id, judgeModel);
      if (result.status === "error") {
        console.error("run_goal_grade:", result.error);
        setReviewNotice({ title: "Goal grade failed", detail: result.error });
      } else {
        const loaded = await commands.loadEval(activeEval.id);
        if (loaded.status === "ok") {
          const r: EvalResult = JSON.parse(loaded.data);
          if (r.goal_grades) setGoalGrades(r.goal_grades);
        } else {
          setReviewNotice({ title: "Goal grade saved but could not reload", detail: loaded.error });
        }
      }
    } catch (error) {
      console.error("run_goal_grade:", error);
      setReviewNotice({ title: "Goal grade failed", detail: error instanceof Error ? error.message : String(error) });
    } finally {
      setGoalGrading(false);
    }
  }

  async function runJudge() {
    if (!activeEval || judgeRunning) return;
    if (reviewGate.machineReviewLocked) return;
    setReviewNotice(null);
    if (isBrowserPreview && isPreviewEvalId(activeEval.id)) {
      setJudgeRunning(true);
      setJudge(previewJudgeScores(activeEval.models, judgeModel));
      setJudgeRunning(false);
      return;
    }
    setJudgeRunning(true);
    try {
      const result = await commands.runLlmJudge(activeEval.id, judgeModel);
      if (result.status === "error") {
        console.error("run_llm_judge:", result.error);
        setReviewNotice({ title: "Judge pass failed", detail: result.error });
      } else {
        const loaded = await commands.loadEval(activeEval.id);
        if (loaded.status === "ok") {
          const r: EvalResult = JSON.parse(loaded.data);
          if (r.judge) setJudge(r.judge);
        } else {
          setReviewNotice({ title: "Judge pass saved but could not reload", detail: loaded.error });
        }
      }
    } catch (error) {
      console.error("run_llm_judge:", error);
      setReviewNotice({ title: "Judge pass failed", detail: error instanceof Error ? error.message : String(error) });
    } finally {
      setJudgeRunning(false);
    }
  }

  function toggleModel(model: string) {
    setSelectedModels((prev) => prev.includes(model) ? prev.filter((m) => m !== model) : [...prev, model]);
  }

  const hasScores = Object.keys(humanScores).some((m) => Object.values(humanScores[m] ?? {}).some((v) => (v ?? 0) > 0));
  const visibleEvalStage = resolveVisibleEvalStage({
    activeEvalComplete: Boolean(activeEval?.complete),
    evalStage,
    reviewMode,
  });

  // Group models by provider for the chip picker.
  const grouped = useMemo(() => {
    const g: Record<string, string[]> = {};
    for (const m of allModels) {
      const p = PROVIDER_OF[m] ?? "Other";
      (g[p] ??= []).push(m);
    }
    return g;
  }, [allModels]);

  return (
    <div className="flex-1 flex h-full min-h-0 overflow-hidden bg-[oklch(0.105_0.004_245)]">
      {/* History sidebar */}
      {historyOpen && (
        <div className="w-72 flex-none border-r border-[oklch(0.22_0.008_240)] bg-[oklch(0.102_0.003_245)] flex min-h-0 flex-col">
          <div className="flex-none px-3 py-2 border-b border-[oklch(0.22_0.008_240)] flex items-center gap-2">
            <History className="w-4 h-4 text-[oklch(0.68_0.040_205)]" />
            <span className="text-xs font-semibold text-[oklch(0.85_0_0)] uppercase tracking-wider">Eval History</span>
            <button onClick={() => setHistoryOpen(false)} className="ml-auto text-[oklch(0.45_0_0)] hover:text-[oklch(0.85_0_0)]">
              <ChevronUp className="w-3 h-3 rotate-90" />
            </button>
          </div>
          <HistoryPanel onLoad={async (id) => {
            const r = await commands.loadEval(id);
            if (r.status === "ok") {
              const parsed: EvalResult = JSON.parse(r.data);
              useEvalStore.getState().loadEval(parsed);
              const loadedReviewMode = determineEvalReviewMode({
                suiteId: parsed.suite_id,
                prompt: parsed.prompt,
                isGoalEval: parsed.is_goal_eval,
              });
              if (loadedReviewMode === "automatic") {
                setEvalStage("results");
                setBlindMode(false);
              } else {
                const scoreableModels = parsed.results
                  .filter((result) => !result.error && result.content.trim().length > 0)
                  .map((result) => result.model);
                const savedReview = getBlindReviewProgress(scoreableModels, parsed.human_scores);
                const reviewComplete = savedReview.totalModels === 0 || savedReview.complete;
                setEvalStage(reviewComplete ? "results" : "review");
                setBlindMode(!reviewComplete);
              }
              setReviewNotice(null);
            }
          }} />
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex-none flex items-center gap-3 px-4 py-3 border-b border-[oklch(0.22_0.008_240)] bg-[oklch(0.108_0.004_245)]">
          <div className="xolotl-mark scale-90" aria-hidden="true" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[oklch(0.91_0.012_220)]">Model Eval Lab</span>
              <span className="rounded border border-[oklch(0.38_0.018_205)] bg-[oklch(0.13_0.006_220)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[oklch(0.66_0.035_195)]">
                Blind first
              </span>
            </div>
            <div className="mt-0.5 text-xs text-[oklch(0.48_0.012_230)]">Goal trials, review scoring, and judge passes</div>
          </div>

          <div className="ml-auto flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowDashboard((v) => !v)}
              aria-pressed={showDashboard}
              className={`text-xs h-7 gap-1 ${showDashboard ? "text-[oklch(0.70_0.055_190)]" : "text-[oklch(0.58_0.025_230)]"}`}
              title="Per-model reliability profiles, hint proposals, and regressions"
            >
              <Gauge className="w-3.5 h-3.5" /> Flywheel
            </Button>
            {!historyOpen && (
              <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)} className="text-xs h-7 gap-1 text-[oklch(0.58_0.025_230)]">
                <History className="w-3.5 h-3.5" /> History
              </Button>
            )}
            {activeEval && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void resetEvalFlow()}
                className="text-xs h-7 gap-1 text-[oklch(0.68_0.040_205)]"
                title="Close this eval, stop launched previews, and return to setup."
              >
                <RotateCcw className="w-3.5 h-3.5" /> New eval
              </Button>
            )}
            {!goalBlindSurface && !activeEval && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleBlindToggle}
                disabled={revealLocked}
                aria-pressed={blindMode}
                aria-label={blindToggleTitle}
                className={`text-xs h-7 gap-1 ${blindMode ? "text-[oklch(0.70_0.055_190)]" : "text-[oklch(0.58_0.012_230)]"}`}
                title={blindToggleTitle}
              >
                {blindMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                {revealLocked ? "Blind" : blindMode ? "Reveal" : "Hide"}
              </Button>
            )}
            {activeEval && reviewMode === "human" && hasScores && visibleEvalStage === "review" && (
              <Button size="sm" variant="ghost" onClick={() => void saveScores()} disabled={savingScores || !scoresDirty} className={`text-xs h-7 gap-1 ${scoresDirty ? "text-[oklch(0.70_0.055_190)]" : "text-[oklch(0.50_0.012_230)]"}`}>
                <Save className="w-3.5 h-3.5" /> {savingScores ? "Saving..." : scoresDirty ? "Save scores" : "Scores saved"}
              </Button>
            )}
          </div>
        </div>

        {showDashboard && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <DashboardErrorBoundary>
              <Suspense fallback={<div className="px-4 py-10 text-center text-sm text-[oklch(0.55_0.012_230)]">Loading flywheel...</div>}>
                <ReliabilityDashboard />
              </Suspense>
            </DashboardErrorBoundary>
          </div>
        )}
        <div className={`flex-1 min-h-0 overflow-y-auto ${showDashboard ? "hidden" : ""}`}>
          {!activeEval && (
          <>
          <BenchmarkLeaderboardPanel />
          <div className="border-b border-[oklch(0.22_0.008_245)] bg-[oklch(0.102_0.004_250)] px-4 py-5">
            <div className="mx-auto flex max-w-6xl flex-col gap-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[oklch(0.54_0.018_210)]">
                    <ScanSearch className="h-3 w-3" />
                    Eval setup
                  </div>
                  <h2 className="text-xl font-semibold tracking-normal text-[oklch(0.90_0.012_220)]">Build a model comparison</h2>
                  <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[oklch(0.58_0.014_230)]">
                    Pick the models, assign the task, review the run settings, then start the eval.
                  </p>
                </div>
                <div className="flex w-full flex-col gap-1 rounded-md border border-[oklch(0.22_0.008_245)] bg-[oklch(0.108_0.004_245)] p-1 sm:flex-row lg:w-[560px]">
                  <ModeButton
                    active={mode === "goal"}
                    onClick={() => { setMode("goal"); setBlindMode(true); setSetupStep("task"); }}
                    icon={<Target className="h-4 w-4" />}
                    title="Goal Eval"
                    hint="Compare models on one production goal."
                    tone="goal"
                  />
                  <ModeButton
                    active={mode === "single"}
                    onClick={() => { setMode("single"); setSetupStep("task"); }}
                    icon={<FlaskConical className="h-4 w-4" />}
                    title="Single Prompt"
                    hint="Race a prompt and score output quality."
                  />
                  <ModeButton
                    active={mode === "suite"}
                    onClick={() => { setMode("suite"); setSetupStep("task"); }}
                    icon={<ListChecks className="h-4 w-4" />}
                    title="Eval Suite"
                    hint="Run a saved prompt set."
                  />
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_280px]">
                <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="Eval setup steps">
                  {setupSteps.map((step, index) => {
                    const active = setupStep === step.id;
                    return (
                      <button
                        key={step.id}
                        type="button"
                        onClick={() => setSetupStep(step.id)}
                        aria-current={active ? "step" : undefined}
                        className={`flex min-w-[170px] items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors lg:min-w-0 ${
                          active
                            ? "border-[oklch(0.38_0.020_195)] bg-[oklch(0.136_0.008_205)]"
                            : "border-transparent bg-transparent hover:border-[oklch(0.22_0.008_245)] hover:bg-[oklch(0.112_0.004_245)]"
                        }`}
                      >
                        <span className={`flex h-7 w-7 flex-none items-center justify-center rounded-full border text-[11px] ${
                          step.complete
                            ? "border-[oklch(0.32_0.018_175)] bg-[oklch(0.13_0.010_175)] text-[oklch(0.70_0.040_175)]"
                            : active
                              ? "border-[oklch(0.42_0.020_195)] bg-[oklch(0.16_0.010_205)] text-[oklch(0.78_0.035_200)]"
                              : "border-[oklch(0.25_0.008_240)] text-[oklch(0.48_0.012_230)]"
                        }`}>
                          {step.complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-[oklch(0.84_0.014_225)]">{step.label}</span>
                          <span className="block truncate text-[11px] text-[oklch(0.52_0.012_230)]">{step.detail}</span>
                        </span>
                      </button>
                    );
                  })}
                </nav>

                <section className="min-h-[330px] rounded-md border border-[oklch(0.22_0.008_245)] bg-[oklch(0.108_0.004_245)] p-4">
                  <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-[oklch(0.50_0.012_230)]">Step {setupSteps.findIndex((step) => step.id === currentSetupStep.id) + 1}</div>
                      <h3 className="mt-1 text-base font-semibold text-[oklch(0.88_0.014_220)]">{currentSetupStep.label}</h3>
                    </div>
                    <div className={`inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] uppercase tracking-[0.13em] ${
                      currentSetupStep.complete
                        ? "border-[oklch(0.32_0.018_175)] bg-[oklch(0.13_0.010_175)] text-[oklch(0.70_0.040_175)]"
                        : "border-[oklch(0.34_0.026_72)] bg-[oklch(0.13_0.010_72)] text-[oklch(0.68_0.040_72)]"
                    }`}>
                      {currentSetupStep.complete ? <CheckCircle2 className="h-3 w-3" /> : <CircleDot className="h-3 w-3" />}
                      {currentSetupStep.complete ? "Complete" : "Needs input"}
                    </div>
                  </div>

                  {setupStep === "models" && (
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div className="text-sm text-[oklch(0.62_0.014_230)]">
                          Select {requiredModelCount === 2 ? "at least two models" : "one or more models"} for this comparison.
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedModels(selectedModels.length === allModels.length ? [] : [...allModels])}
                          className="w-fit rounded-md border border-[oklch(0.24_0.010_235)] px-2.5 py-1 text-xs text-[oklch(0.62_0.016_225)] transition-colors hover:border-[oklch(0.34_0.016_205)] hover:text-[oklch(0.78_0.020_210)]"
                          title={selectedModels.length === allModels.length ? "Clear selected models" : "Select every available model"}
                        >
                          {selectedModels.length === allModels.length ? "Clear all" : "Select all"}
                        </button>
                      </div>
                      <div className="grid gap-3 xl:grid-cols-2">
                        {Object.entries(grouped).map(([provider, models]) => (
                          <div key={provider} className="rounded-md border border-[oklch(0.20_0.006_245)] bg-[oklch(0.102_0.003_245)] p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[oklch(0.48_0.012_230)]">{provider}</span>
                              <span className="text-[10px] text-[oklch(0.42_0.010_230)]">{models.filter((m) => selectedModels.includes(m)).length}/{models.length}</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {models.map((m) => {
                                const selected = selectedModels.includes(m);
                                const label = m.replace(/^bedrock-/, "");
                                return (
                                  <button
                                    key={m}
                                    type="button"
                                    onClick={() => toggleModel(m)}
                                    disabled={running}
                                    aria-pressed={selected}
                                    title={`${selected ? "Remove" : "Add"} ${m} ${selected ? "from" : "to"} this comparison`}
                                    className={`rounded-md border px-2.5 py-1.5 text-left text-xs font-medium transition-colors disabled:opacity-60 ${
                                      selected
                                        ? "border-[oklch(0.38_0.020_195)] bg-[oklch(0.14_0.010_205)] text-[oklch(0.76_0.032_195)]"
                                        : "border-[oklch(0.22_0.008_235)] bg-[oklch(0.108_0.004_245)] text-[oklch(0.56_0.012_225)] hover:border-[oklch(0.31_0.014_210)] hover:text-[oklch(0.76_0.016_220)]"
                                    }`}
                                  >
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {setupStep === "task" && (
                    <div className="flex flex-col gap-4">
                      {mode === "single" ? (
                        <div className="flex flex-col gap-2">
                          <label className="text-[10px] font-medium uppercase tracking-[0.14em] text-[oklch(0.50_0.012_230)]">Prompt</label>
                          <textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            rows={8}
                            placeholder="Enter the prompt to evaluate across the selected models."
                            disabled={running}
                            className="resize-none rounded-md border border-[oklch(0.24_0.010_245)] bg-[oklch(0.13_0.004_245)] px-3 py-2.5 text-sm leading-relaxed text-[oklch(0.88_0.01_220)] placeholder:text-[oklch(0.42_0.012_245)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[oklch(0.60_0.045_190)] disabled:opacity-60"
                          />
                        </div>
                      ) : mode === "goal" ? (
                        <div className="flex flex-col gap-3">
                          <div className="flex flex-col gap-2">
                            <label className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[oklch(0.50_0.012_230)]">
                              <Target className="h-3 w-3 text-[oklch(0.70_0.055_190)]" /> Goal
                            </label>
                            <textarea
                              value={prompt}
                              onChange={(e) => setPrompt(e.target.value)}
                              rows={8}
                              placeholder="e.g. Refactor src/auth/middleware.ts to use the jose library instead of jsonwebtoken, preserving the same public API and verifying existing auth tests pass."
                              disabled={running}
                              className="resize-none rounded-md border border-[oklch(0.25_0.012_220)] bg-[oklch(0.13_0.004_245)] px-3 py-2.5 text-sm leading-relaxed text-[oklch(0.88_0.01_220)] placeholder:text-[oklch(0.42_0.012_245)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[oklch(0.60_0.045_190)] disabled:opacity-60"
                            />
                          </div>
                          <GoalReadinessPanel readiness={goalReadiness} />
                        </div>
                      ) : (
                        <div className="flex flex-col gap-3">
                          <div className="text-sm text-[oklch(0.62_0.014_230)]">Choose the saved prompt set to run across the selected models.</div>
                          <div className="grid gap-2 md:grid-cols-2">
                            {suites.map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => setSelectedSuite(s.id)}
                                disabled={running}
                                className={`rounded-md border px-3 py-3 text-left transition-colors disabled:opacity-60 ${
                                  selectedSuite === s.id
                                    ? "border-[oklch(0.42_0.025_195)] bg-[oklch(0.14_0.010_205)]"
                                    : "border-[oklch(0.22_0.008_240)] bg-[oklch(0.108_0.004_245)] hover:border-[oklch(0.30_0.016_215)]"
                                }`}
                              >
                                <div className="text-sm font-semibold text-[oklch(0.88_0.015_220)]">{s.name}</div>
                                <div className="mt-1 text-xs leading-relaxed text-[oklch(0.54_0.012_225)]">{s.prompts.length} prompts / {s.description}</div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {setupStep === "review" && (
                    <div className="flex flex-col gap-4">
                      {mode === "goal" && (
                        <>
                          <GoalWorkflowStrip steps={goalWorkflowSteps} />
                          <BlindReviewBanner
                            blindMode={blindMode}
                            onToggle={handleBlindToggle}
                            hasActiveEval={Boolean(activeEval)}
                            revealLocked={revealLocked}
                            revealLockTitle={revealLockTitle}
                            progressLabel={blindProgressLabel}
                          />
                        </>
                      )}

                      {mode === "goal" && (
                        <div className="flex items-start gap-3 rounded-md border border-[oklch(0.22_0.008_245)] bg-[oklch(0.104_0.003_245)] px-3 py-3">
                          <Activity className="mt-0.5 h-4 w-4 flex-none text-[oklch(0.58_0.026_210)]" />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-[oklch(0.84_0.014_225)]">Live reasoning supervisor</div>
                            <div className="mt-0.5 text-xs leading-relaxed text-[oklch(0.52_0.014_235)]">
                              Flags assumptions, drift, and contradictions while the run streams. Adds about 2x judge cost.
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setLiveSupervisor((v) => !v)}
                            aria-label="Toggle live reasoning supervisor"
                            aria-pressed={liveSupervisor}
                            title={liveSupervisor ? "Disable live reasoning supervisor" : "Enable live reasoning supervisor"}
                            className={`relative mt-0.5 h-5 w-9 flex-none rounded-full transition-colors ${liveSupervisor ? "bg-[oklch(0.44_0.038_190)]" : "bg-[oklch(0.23_0.008_235)]"}`}
                          >
                            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-[oklch(0.88_0.012_220)] transition-transform ${liveSupervisor ? "translate-x-4" : "translate-x-0.5"}`} />
                          </button>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          onClick={
                            mode === "single" ? runSingleEval :
                            mode === "goal"   ? runGoalEval :
                                                runSuiteEval
                          }
                          disabled={runDisabled}
                          title={goalRunDisabledTitle}
                          className={`gap-1.5 text-white disabled:opacity-50 ${
                            mode === "goal"
                              ? "bg-[oklch(0.46_0.045_190)] hover:bg-[oklch(0.42_0.045_190)]"
                              : "bg-[oklch(0.40_0.020_235)] hover:bg-[oklch(0.36_0.020_235)]"
                          }`}
                        >
                          {mode === "goal" ? <Target className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                          {running ? "Running..." : (mode === "single" ? "Run Eval" : mode === "goal" ? "Run Goal Eval" : "Run Suite")}
                        </Button>
                        {isBrowserPreview && mode === "goal" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void loadPreviewGoalEval()}
                            disabled={running}
                            title="Load a local sample trial without provider calls"
                            className="h-7 gap-1 text-xs text-[oklch(0.58_0.025_205)]"
                          >
                            <ScanSearch className="h-3.5 w-3.5" /> Load sample trial
                          </Button>
                        )}

                        {activeEval && !running && (
                          <>
                            <select
                              value={judgeModel}
                              onChange={(e) => setJudgeModel(e.target.value)}
                              aria-label="Judge model"
                              title="Judge model"
                              className="rounded border border-[oklch(0.24_0.010_235)] bg-[oklch(0.125_0.004_245)] px-2 py-1 text-xs text-[oklch(0.78_0.012_220)]"
                            >
                              {allModels.map((m) => <option key={m} value={m}>{m}</option>)}
                            </select>
                            {reviewGate.machineReviewLocked && (
                              <span
                                role="status"
                                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[oklch(0.38_0.030_72)] bg-[oklch(0.13_0.010_72)] px-2 text-[10px] uppercase tracking-[0.13em] text-[oklch(0.70_0.045_72)]"
                                title={reviewGate.detail}
                              >
                                <ShieldCheck className="h-3 w-3" />
                                {reviewGate.label}
                              </span>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={runJudge}
                              disabled={judgeRunning || reviewGate.machineReviewLocked}
                              title={reviewGate.machineReviewLocked ? reviewGate.detail : "Run anonymized LLM judge"}
                              aria-label={reviewGate.machineReviewLocked ? reviewGate.detail : "Run anonymized LLM judge"}
                              className="h-7 gap-1 text-xs text-[oklch(0.68_0.040_205)]">
                              <Gavel className="h-3.5 w-3.5" /> {judgeRunning ? "Judging..." : "Judge"}
                            </Button>
                            {mode === "goal" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={runGoalGrade}
                                disabled={goalGrading || reviewGate.machineReviewLocked}
                                title={reviewGate.machineReviewLocked ? reviewGate.detail : "Run goal-grade pass"}
                                aria-label={reviewGate.machineReviewLocked ? reviewGate.detail : "Run goal-grade pass"}
                                className="h-7 gap-1 text-xs text-[oklch(0.70_0.055_190)]">
                                <Target className="h-3.5 w-3.5" /> {goalGrading ? "Grading..." : "Grade"}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void resetEvalFlow()}
                              className="h-7 gap-1 text-xs text-[oklch(0.45_0_0)]">
                              <RotateCcw className="h-3 w-3" /> Reset
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-[oklch(0.20_0.006_245)] pt-3">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSetupStep(setupStep === "review" ? "task" : "models")}
                      disabled={setupStep === "models"}
                      className="h-7 text-xs text-[oklch(0.54_0.014_230)] disabled:opacity-35"
                    >
                      Back
                    </Button>
                    {setupStep !== "review" ? (
                      <Button
                        size="sm"
                        onClick={() => setSetupStep(setupStep === "models" ? "task" : "review")}
                        disabled={setupStep === "models" ? !modelStepComplete : !taskStepComplete}
                        className="h-8 bg-[oklch(0.36_0.020_235)] text-xs text-white hover:bg-[oklch(0.32_0.020_235)] disabled:opacity-45"
                      >
                        Continue
                      </Button>
                    ) : (
                      <span className="text-xs text-[oklch(0.50_0.012_230)]">{runDisabled ? "Finish setup to run." : "Ready."}</span>
                    )}
                  </div>
                </section>

                <aside className="rounded-md border border-[oklch(0.22_0.008_245)] bg-[oklch(0.108_0.004_245)] p-4">
                  <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.16em] text-[oklch(0.50_0.012_230)]">Run summary</div>
                  <div className="flex flex-col gap-4">
                    <div>
                      <div className="mb-1 text-xs font-medium text-[oklch(0.78_0.014_225)]">Models</div>
                      {selectedModels.length === 0 ? (
                        <div className="text-xs text-[oklch(0.48_0.012_230)]">No models selected.</div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {Object.entries(selectedModelGroups).map(([provider, models]) => (
                            <div key={provider}>
                              <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-[oklch(0.42_0.010_230)]">{provider}</div>
                              <div className="flex flex-wrap gap-1">
                                {models.map((model) => (
                                  <span key={model} className="rounded border border-[oklch(0.25_0.010_235)] px-1.5 py-0.5 text-[10px] text-[oklch(0.64_0.016_225)]">
                                    {model.replace(/^bedrock-/, "")}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="mb-1 text-xs font-medium text-[oklch(0.78_0.014_225)]">Task</div>
                      <div className="line-clamp-5 text-xs leading-relaxed text-[oklch(0.54_0.012_230)]">
                        {mode === "suite"
                          ? selectedSuiteMeta
                            ? `${selectedSuiteMeta.name}: ${selectedSuiteMeta.prompts.length} prompts`
                            : "Choose a suite."
                          : prompt.trim() || "No task assigned yet."}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md border border-[oklch(0.20_0.006_245)] px-2 py-2">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-[oklch(0.42_0.010_230)]">Mode</div>
                        <div className="mt-1 text-[oklch(0.76_0.018_220)]">{mode === "goal" ? "Goal" : mode === "single" ? "Prompt" : "Suite"}</div>
                      </div>
                      <div className="rounded-md border border-[oklch(0.20_0.006_245)] px-2 py-2">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-[oklch(0.42_0.010_230)]">Review</div>
                        <div className="mt-1 text-[oklch(0.76_0.018_220)]">{blindMode ? "Blind" : "Open"}</div>
                      </div>
                    </div>
                  </div>
                </aside>
              </div>

              {reviewNotice && (
                <ReviewNoticeBanner notice={reviewNotice} onDismiss={() => setReviewNotice(null)} />
              )}
            </div>
          </div>
          </>
          )}


          {/* Active eval body */}
          {activeEval && (
            <div className="px-4 py-4 flex flex-col gap-4">
              <EvalRunStrip blindMode={blindMode} />
              {reviewNotice ? (
                <ReviewNoticeBanner notice={reviewNotice as ReviewNotice} onDismiss={() => setReviewNotice(null)} />
              ) : null}
              {visibleEvalStage === "battle" && (
                <EvalArena blindMode={blindMode} onReadyForScores={() => setEvalStage(reviewMode === "automatic" ? "results" : "review")} />
              )}

              {shouldShowHumanReviewStage({
                activeEvalComplete: activeEval.complete,
                visibleEvalStage,
                reviewMode,
              }) && (
                <HumanReviewScreen
                  models={reviewModels.filter((model) => scoreableReviewModels.includes(model))}
                  blindNames={blindNames}
                  progressLabel={blindProgressLabel}
                  canFinish={canFinishHumanReview}
                  savingScores={savingScores}
                  onDone={() => void finishHumanReview()}
                />
              )}

              {activeEval.complete && visibleEvalStage === "results" && (
                <>
                  <div className="flex flex-col gap-2 rounded-md border border-[oklch(0.20_0.006_245)] bg-[oklch(0.108_0.004_245)] px-3 py-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-[oklch(0.56_0.020_205)]">AI scoring controls</div>
                      <div className="mt-0.5 text-xs text-[oklch(0.52_0.012_230)]">Optional judge and goal-grade passes enrich the automatic score rationale.</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={judgeModel}
                        onChange={(e) => setJudgeModel(e.target.value)}
                        aria-label="Judge model"
                        title="Judge model"
                        className="h-8 rounded border border-[oklch(0.24_0.010_235)] bg-[oklch(0.125_0.004_245)] px-2 text-xs text-[oklch(0.78_0.012_220)]"
                      >
                        {allModels.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={runJudge}
                        disabled={judgeRunning || reviewGate.machineReviewLocked}
                        title={reviewGate.machineReviewLocked ? reviewGate.detail : "Run anonymized LLM judge"}
                        aria-label={reviewGate.machineReviewLocked ? reviewGate.detail : "Run anonymized LLM judge"}
                        className="h-8 gap-1 text-xs text-[oklch(0.68_0.040_205)]"
                      >
                        <Gavel className="h-3.5 w-3.5" /> {judgeRunning ? "Judging..." : "Run AI judge"}
                      </Button>
                      {(activeEval?.is_goal_eval || mode === "goal") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={runGoalGrade}
                          disabled={goalGrading || reviewGate.machineReviewLocked}
                          title={reviewGate.machineReviewLocked ? reviewGate.detail : "Run goal-grade pass"}
                          aria-label={reviewGate.machineReviewLocked ? reviewGate.detail : "Run goal-grade pass"}
                          className="h-8 gap-1 text-xs text-[oklch(0.70_0.055_190)]"
                        >
                          <Target className="h-3.5 w-3.5" /> {goalGrading ? "Grading..." : "Run goal grade"}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void resetEvalFlow()}
                        className="h-8 gap-1 text-xs text-[oklch(0.45_0_0)]"
                      >
                        <RotateCcw className="h-3 w-3" /> New eval
                      </Button>
                    </div>
                  </div>

                  {resultsGate.resultsLocked
                    ? <BlindResultsLockPanel gate={resultsGate} progressLabel={blindProgressLabel} />
                    : comparison && (
                      <>
                        <ComparisonResultsPanel
                          comparison={comparison}
                          reviewMode={reviewMode}
                          reviewDirty={reviewDirty}
                          savingReview={savingReview}
                          onManualReviewChange={setManualReview}
                          onSaveManualReviews={saveManualReviews}
                        />
                        {activeEval.reliabilityMetrics && (
                          <ReliabilityPanel
                            models={activeEval.models}
                            metrics={activeEval.reliabilityMetrics}
                            displayNameOf={(model) => (blindMode ? activeEval.blindLabels[model] ?? model : model)}
                            revealed={!blindMode}
                          />
                        )}
                      </>
                    )}
                </>
              )}

              {activeEval.suite_run_id && (
                <div className="text-[10px] text-[oklch(0.45_0_0)] text-center">
                  Suite run: <span className="font-mono">{activeEval.suite_run_id.slice(0, 8)}</span> Â· prompt {activeEval.suite_prompt_id}
                </div>
              )}
            </div>
          )}

          {!activeEval && <div className="h-4" aria-hidden="true" />}
        </div>
      </div>
    </div>
  );
}
