import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  FlaskConical, Play, RotateCcw, ChevronDown, ChevronUp, Save, Clock, Coins, Hash,
  Eye, EyeOff, Trophy, Sparkles, History, ListChecks, Gavel, Trash2,
  Target, Brain, AlertTriangle, Activity,
} from "lucide-react";
import { Button } from "../ui/button";
import { commands } from "../../bindings";
import type { HumanScores, EvalSuite, EvalMeta, EvalResult, ReasoningFlag, GoalGrade } from "../../bindings";
import { useEvalStore } from "../../stores/evalStore";
import { MarkdownRenderer } from "../chat/MarkdownRenderer";

const GOAL_AXES: { key: string; label: string; color: string; hint: string }[] = [
  { key: "goal_decomposition",    label: "Goal Decomposition",  color: "oklch(0.72 0.18 250)", hint: "Does it break the goal into right sub-tasks?" },
  { key: "assumption_quality",    label: "Assumption Quality",  color: "oklch(0.72 0.18 195)", hint: "Are assumptions explicit and reasonable?" },
  { key: "self_correction",       label: "Self-Correction",     color: "oklch(0.72 0.18 142)", hint: "Does it catch and fix its own mistakes?" },
  { key: "plan_action_coherence", label: "Plan↔Action",         color: "oklch(0.72 0.18 60)",  hint: "Do actions match the stated plan?" },
  { key: "goal_achievement",      label: "Goal Achievement",    color: "oklch(0.72 0.18 30)",  hint: "Was the goal actually reached?" },
];

const FLAG_STYLES: Record<string, { color: string; bg: string; emoji: string }> = {
  bad_assumption:        { color: "oklch(0.72 0.18 30)",  bg: "oklch(0.20 0.10 30)/30",  emoji: "⚠" },
  goal_drift:            { color: "oklch(0.72 0.18 60)",  bg: "oklch(0.20 0.10 60)/30",  emoji: "↯" },
  premature_commit:      { color: "oklch(0.72 0.18 30)",  bg: "oklch(0.20 0.10 30)/30",  emoji: "⏩" },
  no_verification:       { color: "oklch(0.72 0.18 100)", bg: "oklch(0.20 0.10 100)/30", emoji: "?" },
  contradiction:         { color: "oklch(0.65 0.22 22)",  bg: "oklch(0.20 0.10 22)/30",  emoji: "✕" },
  good_decomposition:    { color: "oklch(0.72 0.18 142)", bg: "oklch(0.20 0.10 142)/30", emoji: "✓" },
  good_self_correction:  { color: "oklch(0.72 0.18 142)", bg: "oklch(0.20 0.10 142)/30", emoji: "↻" },
};
function flagStyle(kind: string) {
  return FLAG_STYLES[kind] ?? { color: "oklch(0.65 0 0)", bg: "oklch(0.18 0 0)", emoji: "•" };
}

const SCORE_DIMENSIONS: { key: keyof HumanScores; label: string; color: string }[] = [
  { key: "accuracy",    label: "Accuracy",    color: "oklch(0.72 0.18 142)" },
  { key: "helpfulness", label: "Helpfulness", color: "oklch(0.72 0.18 195)" },
  { key: "quality",     label: "Quality",     color: "oklch(0.72 0.18 250)" },
  { key: "creativity",  label: "Creativity",  color: "oklch(0.72 0.18 310)" },
  { key: "design",      label: "Design",      color: "oklch(0.72 0.18 30)" },
  { key: "aesthetics",  label: "Aesthetics",  color: "oklch(0.78 0.18 60)" },
  { key: "ai_slop",     label: "Anti-Slop",   color: "oklch(0.72 0.18 100)" },
  { key: "brevity",     label: "Brevity",     color: "oklch(0.72 0.18 340)" },
];

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6":           { input: 3,   output: 15 },
  "claude-haiku-4-5-20251001":   { input: 0.8, output: 4 },
  "claude-opus-4-7":             { input: 15,  output: 75 },
  "kimi2.6":                     { input: 1,   output: 2 },
  "kimi-coding":                 { input: 2,   output: 6 },
  "minimax2.7":                  { input: 0.5, output: 1.5 },
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
function fmtDur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Live tok/sec while streaming. Falls back to final-duration calc when done. */
function tokensPerSec(state: { output_tokens: number; duration_ms: number; status: string; started_at?: number; content: string }): number {
  if (state.status === "done" && state.duration_ms > 0 && state.output_tokens > 0) {
    return (state.output_tokens / state.duration_ms) * 1000;
  }
  if (state.status === "running" && state.started_at) {
    const elapsed = (Date.now() - state.started_at) / 1000;
    if (elapsed < 0.3) return 0;
    // Approximate live tokens from char count (1 tok ≈ 4 chars).
    return state.content.length / 4 / elapsed;
  }
  return 0;
}

// ════════════════════════════════════════════════════════════════════════════
// SCORE SLIDER
// ════════════════════════════════════════════════════════════════════════════
function ScoreSlider({ label, color, value, onChange }: { label: string; color: string; value: number; onChange: (v: number) => void; }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs">
        <span className="text-[oklch(0.65_0_0)]">{label}</span>
        <span style={{ color }} className="font-medium tabular-nums">
          {value > 0 ? value.toFixed(1) : "—"}
        </span>
      </div>
      <input
        type="range" min={1} max={10} step={0.5}
        value={value || 5}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 rounded appearance-none cursor-pointer"
        style={{ accentColor: color }}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// LIVE RACE-TRACK ROW: shows what each model is doing in real time
// ════════════════════════════════════════════════════════════════════════════
function RaceTrackRow({ model, displayName, color }: { model: string; displayName: string; color: string }) {
  const state = useEvalStore((s) => s.activeEval?.modelStates[model]);
  const [, forceRerender] = useState(0);

  // Tick while running so live tok/s updates smoothly.
  useEffect(() => {
    if (state?.status !== "running") return;
    const id = setInterval(() => forceRerender((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [state?.status]);

  if (!state) return null;

  const tps = tokensPerSec(state);
  const cost = calcCost(model, state.input_tokens, state.output_tokens);
  const previewText = state.content.slice(0, 220).replace(/\s+/g, " ");

  return (
    <div className="flex items-stretch gap-2 px-3 py-2 border-b border-neutral-800/50 last:border-0 hover:bg-[oklch(0.14_0_0)]/50">
      <div className="w-1 flex-none rounded" style={{ background: color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-[oklch(0.88_0_0)] truncate" style={{ maxWidth: "240px" }}>{displayName}</span>
          <StatusDot status={state.status} />
          <span className="ml-auto flex items-center gap-3 text-xs text-[oklch(0.50_0_0)] tabular-nums whitespace-nowrap">
            {state.status !== "pending" && (
              <>
                <span title="time"><Clock className="inline w-3 h-3" /> {fmtDur(state.duration_ms || (state.started_at ? Date.now() - state.started_at : 0))}</span>
                <span title="tokens">{state.output_tokens || Math.round(state.content.length / 4)} tok</span>
                <span title="tok/s" className={tps > 80 ? "text-[oklch(0.78_0.18_142)]" : ""}>{tps.toFixed(0)} t/s</span>
                <span title="cost">${cost.toFixed(4)}</span>
              </>
            )}
          </span>
        </div>
        {/* Streaming preview */}
        <div className="text-xs text-[oklch(0.55_0_0)] line-clamp-2 leading-relaxed font-mono">
          {state.status === "pending" && <span className="opacity-50">waiting…</span>}
          {state.status === "running" && !previewText && <span className="opacity-60 animate-pulse">▌</span>}
          {state.status === "running" && previewText && <>{previewText}<span className="animate-pulse">▌</span></>}
          {state.status === "done" && previewText}
          {state.status === "error" && <span className="text-red-400">{state.error}</span>}
        </div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const cls =
    status === "running" ? "bg-yellow-400 animate-pulse" :
    status === "done"    ? "bg-green-500" :
    status === "error"   ? "bg-red-500" :
                           "bg-neutral-600";
  return <div className={`w-2 h-2 rounded-full flex-none ${cls}`} />;
}

// ════════════════════════════════════════════════════════════════════════════
// MODEL RESPONSE CARD (full markdown rendering + HIL sliders)
// ════════════════════════════════════════════════════════════════════════════
function ResponseCard({ model, displayName }: { model: string; displayName: string }) {
  const state = useEvalStore((s) => s.activeEval?.modelStates[model]);
  const humanScores = useEvalStore((s) => s.humanScores[model] ?? {});
  const setHumanScore = useEvalStore((s) => s.setHumanScore);
  const judge = useEvalStore((s) => s.activeEval?.judge);
  const [expanded, setExpanded] = useState(false);
  const [scoring, setScoring] = useState(false);

  if (!state) return null;

  const cost = calcCost(model, state.input_tokens, state.output_tokens);
  const filledDims = SCORE_DIMENSIONS.filter((d) => (humanScores[d.key] ?? 0) > 0);
  const humanAvg = filledDims.length > 0
    ? filledDims.reduce((sum, d) => sum + (humanScores[d.key] ?? 0), 0) / filledDims.length
    : 0;

  const judgeScores = judge?.scores[model];
  const judgeAvg = judgeScores
    ? SCORE_DIMENSIONS.reduce((s, d) => s + (judgeScores[d.key] ?? 5), 0) / SCORE_DIMENSIONS.length
    : 0;

  return (
    <div className="flex flex-col border border-neutral-800 rounded-lg overflow-hidden bg-[oklch(0.13_0_0)]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800 bg-[oklch(0.155_0_0)]">
        <div className="flex items-center gap-2">
          <StatusDot status={state.status} />
          <span className="text-sm font-medium text-[oklch(0.88_0_0)]">{displayName}</span>
          {humanAvg > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-[oklch(0.65_0.18_250)]/20 text-[oklch(0.78_0.18_250)]" title="Human avg">
              ★ {humanAvg.toFixed(1)}
            </span>
          )}
          {judgeAvg > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-[oklch(0.65_0.18_100)]/20 text-[oklch(0.78_0.18_100)]" title="Judge avg">
              ⚖ {judgeAvg.toFixed(1)}
            </span>
          )}
          {state.auto && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-neutral-800 text-[oklch(0.6_0_0)]" title="Auto-graded">
              auto {state.auto.ai_slop_score?.toFixed(1) ?? "—"} / {state.auto.brevity_score?.toFixed(1) ?? "—"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-[oklch(0.50_0_0)] tabular-nums">
          {state.status !== "pending" && (
            <>
              <span><Clock className="inline w-3 h-3" /> {fmtDur(state.duration_ms)}</span>
              <span><Hash className="inline w-3 h-3" /> {state.input_tokens}↑ {state.output_tokens}↓</span>
              <span><Coins className="inline w-3 h-3" /> ${cost.toFixed(4)}</span>
            </>
          )}
          <button onClick={() => setScoring((v) => !v)} className="ml-1 text-[oklch(0.55_0_0)] hover:text-[oklch(0.85_0_0)]" title="Score">
            <Sparkles className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setExpanded((v) => !v)} className="text-[oklch(0.55_0_0)] hover:text-[oklch(0.85_0_0)]">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Response */}
      <div className="px-3 py-3 text-sm text-[oklch(0.84_0_0)] leading-relaxed overflow-y-auto" style={{ maxHeight: expanded ? "none" : "320px", minHeight: "60px" }}>
        {state.status === "pending" && <span className="text-[oklch(0.40_0_0)]">Waiting…</span>}
        {state.status === "running" && !state.content && <span className="text-[oklch(0.55_0_0)] animate-pulse">Generating…</span>}
        {state.content && <MarkdownRenderer content={state.content} />}
        {state.status === "error" && state.error && <span className="text-red-400 text-xs">{state.error}</span>}
      </div>

      {/* Auto + Judge details */}
      {state.auto && (state.status === "done" || state.status === "error") && (
        <div className="border-t border-neutral-800 px-3 py-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[oklch(0.55_0_0)] bg-[oklch(0.115_0_0)]">
          <span>{state.auto.word_count} words · {state.auto.char_count} chars</span>
          <span>· {state.auto.code_block_count} code blocks</span>
          <span>· {state.auto.em_dash_count} em-dashes</span>
          {state.auto.json_valid !== null && (
            <span className={state.auto.json_valid ? "text-green-400" : "text-red-400"}>
              · JSON {state.auto.json_valid ? "valid" : "INVALID"}
            </span>
          )}
          {state.auto.slop_hits.length > 0 && (
            <span className="text-[oklch(0.72_0.18_30)]">· slop: {state.auto.slop_hits.slice(0, 3).join(", ")}{state.auto.slop_hits.length > 3 ? "…" : ""}</span>
          )}
        </div>
      )}

      {/* Goal eval surface: reasoning trace + supervisor flags + 5-axis grade */}
      <ReasoningTrace model={model} />
      {state.flags.length > 0 && <FlagList flags={state.flags} />}
      {state.goalGrade && <GoalGradeCard grade={state.goalGrade} />}

      {judge?.rationale?.[model] && (
        <div className="border-t border-neutral-800 px-3 py-2 text-xs text-[oklch(0.65_0_0)] bg-[oklch(0.125_0_0)] italic">
          <Gavel className="inline w-3 h-3 mr-1 text-[oklch(0.65_0.18_100)]" /> {judge.rationale[model]}
        </div>
      )}

      {/* HIL panel */}
      {scoring && (state.status === "done" || state.status === "error") && (
        <div className="border-t border-neutral-800 px-3 py-3 grid grid-cols-2 gap-x-4 gap-y-2 bg-[oklch(0.10_0_0)]">
          <p className="col-span-2 text-xs text-[oklch(0.50_0_0)] font-medium uppercase tracking-wider mb-1">
            Human Evaluation (1–10)
          </p>
          {SCORE_DIMENSIONS.map((dim) => (
            <ScoreSlider
              key={dim.key}
              label={dim.label}
              color={dim.color}
              value={humanScores[dim.key] ?? 0}
              onChange={(v) => setHumanScore(model, dim.key, v)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// REASONING TRACE — collapsible chain-of-thought with inline flag highlights
// ════════════════════════════════════════════════════════════════════════════
function ReasoningTrace({ model }: { model: string }) {
  const state = useEvalStore((s) => s.activeEval?.modelStates[model]);
  const [open, setOpen] = useState(true);
  if (!state) return null;
  if (!state.reasoning && state.flags.length === 0) return null;

  return (
    <div className="border-t border-neutral-800 bg-[oklch(0.105_0_0)]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-[oklch(0.55_0_0)] hover:bg-[oklch(0.14_0_0)]"
      >
        <Brain className="w-3 h-3 text-[oklch(0.65_0.18_280)]" />
        <span>Reasoning trace</span>
        <span className="text-[oklch(0.40_0_0)] font-mono normal-case tracking-normal">
          {state.reasoning.length} chars
        </span>
        {state.flags.length > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-[oklch(0.65_0.18_30)]/20 text-[oklch(0.78_0.18_30)] text-[10px] normal-case tracking-normal">
            {state.flags.length} flag{state.flags.length === 1 ? "" : "s"}
          </span>
        )}
        <span className="ml-auto">{open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}</span>
      </button>
      {open && (
        <div className="px-3 py-2 max-h-[280px] overflow-y-auto text-xs font-mono text-[oklch(0.62_0_0)] leading-relaxed whitespace-pre-wrap">
          {state.reasoning ? <FlaggedText text={state.reasoning} flags={state.flags} /> : <span className="italic text-[oklch(0.40_0_0)]">no reasoning exposed by this model</span>}
        </div>
      )}
    </div>
  );
}

/**
 * Render `text` with `flags[].quote` substrings highlighted by severity colour.
 * Greedy single-pass: walks flags in order of their offset_chars, taking the
 * first matching occurrence after the cursor. Skips a flag if its quote can't
 * be located (judges occasionally paraphrase even when asked for verbatim).
 */
function FlaggedText({ text, flags }: { text: string; flags: ReasoningFlag[] }) {
  if (flags.length === 0) return <>{text}</>;
  const sorted = [...flags].sort((a, b) => a.offset_chars - b.offset_chars);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i];
    if (!f.quote) continue;
    const idx = text.indexOf(f.quote, cursor);
    if (idx < 0) continue;
    if (idx > cursor) parts.push(text.slice(cursor, idx));
    const st = flagStyle(f.kind);
    parts.push(
      <mark
        key={i}
        title={`${f.kind} · ${f.severity}: ${f.comment}`}
        className="rounded px-0.5"
        style={{ background: `color-mix(in oklch, ${st.color} 18%, transparent)`, color: st.color }}
      >
        {f.quote}
      </mark>
    );
    cursor = idx + f.quote.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function FlagList({ flags }: { flags: ReasoningFlag[] }) {
  if (flags.length === 0) return null;
  return (
    <div className="border-t border-neutral-800 px-3 py-2 bg-[oklch(0.115_0_0)] flex flex-col gap-1.5">
      <div className="text-[10px] uppercase tracking-wider text-[oklch(0.50_0_0)] flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" /> Supervisor flags
      </div>
      {flags.map((f, i) => {
        const st = flagStyle(f.kind);
        return (
          <div key={i} className="flex items-start gap-2 text-xs">
            <span style={{ color: st.color }} className="font-bold">{st.emoji}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span style={{ color: st.color }} className="text-[10px] uppercase tracking-wider font-medium">{f.kind.replace(/_/g, " ")}</span>
                <span className="text-[10px] text-[oklch(0.42_0_0)]">· {f.severity}</span>
              </div>
              <div className="text-[oklch(0.72_0_0)] leading-relaxed">{f.comment}</div>
              {f.quote && (
                <div className="text-[10px] italic text-[oklch(0.50_0_0)] font-mono truncate" title={f.quote}>
                  “{f.quote}”
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GoalGradeCard({ grade }: { grade: GoalGrade }) {
  const avg = useMemo(() => {
    const vals = GOAL_AXES.map((a) => grade.axes[a.key]?.score ?? 0).filter((v) => v > 0);
    return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  }, [grade]);

  return (
    <div className="border-t border-neutral-800 px-3 py-3 bg-[oklch(0.115_0_0)]">
      <div className="flex items-center gap-2 mb-2">
        <Target className="w-3.5 h-3.5 text-[oklch(0.78_0.18_60)]" />
        <span className="text-[10px] uppercase tracking-wider text-[oklch(0.55_0_0)] font-medium">Goal Grade</span>
        {avg > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-[oklch(0.78_0.18_60)]/20 text-[oklch(0.85_0.18_60)] tabular-nums">
            {avg.toFixed(1)}/5
          </span>
        )}
        <span className="ml-auto text-[10px] text-[oklch(0.40_0_0)] italic">judged by {grade.judge_model}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5">
        {GOAL_AXES.map((axis) => {
          const a = grade.axes[axis.key];
          const score = a?.score ?? 0;
          return (
            <div key={axis.key} className="flex flex-col gap-0.5" title={axis.hint}>
              <div className="flex items-center justify-between text-[10px]" style={{ color: axis.color }}>
                <span className="uppercase tracking-wider">{axis.label}</span>
                <span className="tabular-nums">{score > 0 ? score.toFixed(1) : "—"}/5</span>
              </div>
              <div className="h-1.5 bg-neutral-900 rounded overflow-hidden">
                <div
                  className="h-full rounded transition-[width] duration-200"
                  style={{ width: `${(score / 5) * 100}%`, background: axis.color }}
                />
              </div>
              {a?.evidence && (
                <div className="text-[10px] italic text-[oklch(0.45_0_0)] font-mono truncate" title={a.evidence}>
                  “{a.evidence}”
                </div>
              )}
            </div>
          );
        })}
      </div>
      {grade.summary && (
        <div className="mt-2 pt-2 border-t border-neutral-800 text-xs text-[oklch(0.72_0_0)] italic leading-relaxed">
          {grade.summary}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// LEADERBOARD: composite scores + per-dimension bar chart
// ════════════════════════════════════════════════════════════════════════════
function Leaderboard({ blindNames }: { blindNames: Record<string, string> }) {
  const activeEval = useEvalStore((s) => s.activeEval);
  const humanScores = useEvalStore((s) => s.humanScores);
  const [costWeight, setCostWeight] = useState(0);
  const [latencyWeight, setLatencyWeight] = useState(0);
  if (!activeEval) return null;

  const judge = activeEval.judge;

  // Composite per model: average of (filled human dims) blended with judge if present.
  const rows = activeEval.models.map((model) => {
    const state = activeEval.modelStates[model];
    const human = humanScores[model] ?? {};
    const humanFilled = SCORE_DIMENSIONS.filter((d) => (human[d.key] ?? 0) > 0);
    const humanAvg = humanFilled.length > 0
      ? humanFilled.reduce((s, d) => s + (human[d.key] ?? 0), 0) / humanFilled.length
      : 0;
    const jScores = judge?.scores[model];
    const judgeAvg = jScores
      ? SCORE_DIMENSIONS.reduce((s, d) => s + (jScores[d.key] ?? 5), 0) / SCORE_DIMENSIONS.length
      : 0;
    const cost = calcCost(model, state.input_tokens, state.output_tokens);
    const dur = state.duration_ms;

    // Pick best available quality signal: human > judge > auto.
    let quality = humanAvg || judgeAvg || 0;
    if (quality === 0 && state.auto) {
      quality = ((state.auto.ai_slop_score ?? 5) + (state.auto.brevity_score ?? 5)) / 2;
    }
    return { model, state, humanAvg, judgeAvg, cost, dur, quality, auto: state.auto };
  });

  // Normalize cost/latency for composite (higher is better → invert).
  const maxCost = Math.max(...rows.map((r) => r.cost), 0.0001);
  const maxDur = Math.max(...rows.map((r) => r.dur), 1);
  const composites = rows.map((r) => {
    const q = r.quality;
    const costScore = maxCost > 0 ? 10 * (1 - r.cost / maxCost) : 0;
    const speedScore = maxDur > 0 ? 10 * (1 - r.dur / maxDur) : 0;
    const w = 1 + costWeight + latencyWeight;
    const composite = (q + costScore * costWeight + speedScore * latencyWeight) / w;
    return { ...r, composite };
  });
  composites.sort((a, b) => b.composite - a.composite);
  const winner = composites[0];

  return (
    <div className="rounded-lg border border-neutral-800 overflow-hidden bg-[oklch(0.13_0_0)]">
      <div className="px-3 py-2 border-b border-neutral-800 bg-[oklch(0.155_0_0)] flex items-center gap-2">
        <Trophy className="w-4 h-4 text-[oklch(0.78_0.18_60)]" />
        <span className="text-xs font-semibold text-[oklch(0.88_0_0)] uppercase tracking-wider">Leaderboard</span>
        <div className="ml-auto flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1 text-[oklch(0.55_0_0)]">
            Cost weight
            <input type="range" min={0} max={2} step={0.25} value={costWeight} onChange={(e) => setCostWeight(Number(e.target.value))} className="w-16 accent-[oklch(0.65_0.18_30)]" />
            <span className="tabular-nums w-6 text-right">{costWeight.toFixed(1)}</span>
          </label>
          <label className="flex items-center gap-1 text-[oklch(0.55_0_0)]">
            Speed weight
            <input type="range" min={0} max={2} step={0.25} value={latencyWeight} onChange={(e) => setLatencyWeight(Number(e.target.value))} className="w-16 accent-[oklch(0.65_0.18_200)]" />
            <span className="tabular-nums w-6 text-right">{latencyWeight.toFixed(1)}</span>
          </label>
        </div>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-neutral-800 text-[oklch(0.45_0_0)]">
            <th className="px-3 py-1.5 text-left font-medium">#</th>
            <th className="px-3 py-1.5 text-left font-medium">Model</th>
            <th className="px-3 py-1.5 text-right font-medium">Quality</th>
            <th className="px-3 py-1.5 text-right font-medium">Cost</th>
            <th className="px-3 py-1.5 text-right font-medium">Time</th>
            <th className="px-3 py-1.5 text-right font-medium text-[oklch(0.78_0.18_60)]">Composite</th>
          </tr>
        </thead>
        <tbody>
          {composites.map((r, i) => (
            <tr key={r.model} className={`border-b border-neutral-800/40 last:border-0 ${r === winner ? "bg-[oklch(0.78_0.18_60)]/10" : ""}`}>
              <td className="px-3 py-1.5 text-[oklch(0.55_0_0)]">{i + 1}{r === winner ? " 🏆" : ""}</td>
              <td className="px-3 py-1.5 text-[oklch(0.85_0_0)]">{blindNames[r.model] ?? r.model}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-[oklch(0.72_0.18_250)]">{r.quality > 0 ? r.quality.toFixed(1) : "—"}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-[oklch(0.65_0_0)]">${r.cost.toFixed(4)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-[oklch(0.65_0_0)]">{fmtDur(r.dur)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-[oklch(0.78_0.18_60)]">{r.composite.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Per-dimension bar chart */}
      <DimensionBars blindNames={blindNames} />
    </div>
  );
}

function DimensionBars({ blindNames }: { blindNames: Record<string, string> }) {
  const activeEval = useEvalStore((s) => s.activeEval);
  const humanScores = useEvalStore((s) => s.humanScores);
  if (!activeEval) return null;
  const judge = activeEval.judge;
  const hasAnyScore = Object.values(humanScores).some((s) => Object.values(s).some((v) => (v ?? 0) > 0)) || !!judge;
  if (!hasAnyScore) return null;

  return (
    <div className="border-t border-neutral-800 p-3 bg-[oklch(0.12_0_0)]">
      <div className="text-xs text-[oklch(0.50_0_0)] uppercase tracking-wider mb-2">Per-dimension breakdown</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
        {SCORE_DIMENSIONS.map((dim) => {
          // For each model, prefer human; fall back to judge.
          const vals = activeEval.models.map((m) => {
            const h = (humanScores[m]?.[dim.key] ?? 0) as number;
            if (h > 0) return { model: m, v: h, src: "h" as const };
            const j = (judge?.scores[m]?.[dim.key] ?? 0) as number;
            return { model: m, v: j, src: "j" as const };
          });
          const max = Math.max(...vals.map((v) => v.v), 10);
          return (
            <div key={dim.key} className="flex flex-col gap-0.5">
              <div className="text-[10px] uppercase tracking-wider flex justify-between" style={{ color: dim.color }}>
                <span>{dim.label}</span>
              </div>
              {vals.map((v) => (
                <div key={v.model} className="flex items-center gap-1.5 text-[10px]">
                  <span className="text-[oklch(0.55_0_0)] truncate" style={{ width: "120px" }}>
                    {(blindNames[v.model] ?? v.model)}
                  </span>
                  <div className="flex-1 h-2 bg-neutral-900 rounded overflow-hidden">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${(v.v / max) * 100}%`,
                        background: dim.color,
                        opacity: v.src === "j" ? 0.6 : 1,
                      }}
                    />
                  </div>
                  <span className="tabular-nums w-7 text-right" style={{ color: dim.color }}>
                    {v.v > 0 ? v.v.toFixed(1) : "—"}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="text-[10px] text-[oklch(0.40_0_0)] mt-2">
        Solid bars = your human scores · faded = LLM-judge fallback
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// HISTORY SIDEBAR
// ════════════════════════════════════════════════════════════════════════════
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
    return <div className="text-xs text-[oklch(0.40_0_0)] p-3">No past evals.</div>;
  }
  return (
    <div className="flex flex-col gap-1 p-2 overflow-y-auto">
      {items.map((m) => (
        <div key={m.id} className="group flex items-start gap-2 px-2 py-2 rounded hover:bg-[oklch(0.15_0_0)] cursor-pointer">
          <button onClick={() => onLoad(m.id)} className="flex-1 text-left min-w-0">
            <div className="text-xs text-[oklch(0.82_0_0)] line-clamp-2">{m.prompt}</div>
            <div className="flex items-center gap-1.5 mt-1 text-[10px] text-[oklch(0.45_0_0)]">
              {m.suite_id && <span className="text-[oklch(0.65_0.18_250)]">[{m.suite_id}]</span>}
              <span>{m.models.length} models</span>
              <span>·</span>
              <span>{new Date(m.created_at * 1000).toLocaleString()}</span>
            </div>
          </button>
          <button onClick={() => del(m.id)} className="opacity-0 group-hover:opacity-100 text-[oklch(0.45_0_0)] hover:text-red-400 transition-opacity">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN VIEW
// ════════════════════════════════════════════════════════════════════════════
type Mode = "single" | "suite" | "goal";

export function EvalView() {
  const [mode, setMode] = useState<Mode>("single");
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

  const activeEval = useEvalStore((s) => s.activeEval);
  const humanScores = useEvalStore((s) => s.humanScores);
  const blindMode = useEvalStore((s) => s.blindMode);
  const toggleBlind = useEvalStore((s) => s.toggleBlind);
  const {
    startEval, setModelRunning, appendModelDelta, appendModelReasoning, pushReasoningFlag,
    completeModel, finalizeEval, setJudge, setGoalGrades,
  } = useEvalStore.getState();

  useEffect(() => {
    commands.listModels().then(setAllModels).catch(console.error);
    commands.listEvalSuites().then(setSuites).catch(console.error);
  }, []);

  // Map model -> display name (blind A/B/C or real name)
  const blindNames = useMemo<Record<string, string>>(() => {
    if (!blindMode || !activeEval) return {};
    const out: Record<string, string> = {};
    activeEval.models.forEach((m, i) => {
      out[m] = `Model ${String.fromCharCode(65 + i)}`;
    });
    return out;
  }, [blindMode, activeEval]);

  // Subscribe to streaming eval events; survives multiple consecutive runs.
  const unlistenRef = useRef<UnlistenFn | null>(null);
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
        case "EvalComplete":    finalizeEval(evalId); setRunning(false); if (un) un(); unlistenRef.current = null; break;
      }
    });
    unlistenRef.current = un;
  }

  const runSingleEval = useCallback(async () => {
    if (!prompt.trim() || selectedModels.length === 0 || running) return;
    setRunning(true);
    const result = await commands.startEval(prompt.trim(), selectedModels);
    if (result.status === "error") {
      console.error("start_eval error:", result.error);
      setRunning(false);
      return;
    }
    const evalId = result.data;
    startEval(evalId, prompt.trim(), selectedModels);
    await subscribeToEval(evalId);
  }, [prompt, selectedModels, running]);

  const runGoalEval = useCallback(async () => {
    if (!prompt.trim() || selectedModels.length === 0 || running) return;
    setRunning(true);
    const supervisor = liveSupervisor ? judgeModel : null;
    const result = await commands.startGoalEval(prompt.trim(), selectedModels, liveSupervisor, supervisor);
    if (result.status === "error") {
      console.error("start_goal_eval error:", result.error);
      setRunning(false);
      return;
    }
    const evalId = result.data;
    startEval(evalId, prompt.trim(), selectedModels, { is_goal_eval: true, live_supervisor: liveSupervisor });
    await subscribeToEval(evalId);
  }, [prompt, selectedModels, running, liveSupervisor, judgeModel]);

  const runSuiteEval = useCallback(async () => {
    if (selectedModels.length === 0 || running) return;
    setRunning(true);
    // Subscribe to suite-level events to track each prompt within the suite run.
    const result = await commands.runEvalSuite(selectedSuite, selectedModels);
    if (result.status === "error") {
      console.error("run_eval_suite error:", result.error);
      setRunning(false);
      return;
    }
    const suiteRunId = result.data;
    const channel = `suite-event:${suiteRunId}`;
    // Each prompt inside the suite emits its own eval-event with a new eval id —
    // we listen for SuitePromptStart so we can hook the per-prompt channel.
    const suiteUnlisten = await listen<any>(channel, async (event) => {
      const p = event.payload;
      if (p.type === "SuitePromptStart" && p.eval_id) {
        // Backend pre-generates eval_id and emits it before model events, plus a
        // 50ms grace delay so this listen() call wins the race.
        startEval(p.eval_id, p.prompt, selectedModels, { suite_run_id: suiteRunId, suite_prompt_id: p.prompt_id });
        await subscribeToEval(p.eval_id);
      } else if (p.type === "SuiteComplete") {
        setRunning(false);
        suiteUnlisten();
      }
    });
  }, [selectedSuite, selectedModels, running]);

  async function saveScores() {
    if (!activeEval) return;
    setSavingScores(true);
    const scoresMap: Record<string, HumanScores> = {};
    for (const [model, partial] of Object.entries(humanScores)) {
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
    const result = await commands.saveHumanScores(activeEval.id, JSON.stringify(scoresMap));
    if (result.status === "error") console.error("save_human_scores error:", result.error);
    setSavingScores(false);
  }

  async function runGoalGrade() {
    if (!activeEval || goalGrading) return;
    setGoalGrading(true);
    const result = await commands.runGoalGrade(activeEval.id, judgeModel);
    if (result.status === "error") {
      console.error("run_goal_grade:", result.error);
      alert(`Goal grade failed: ${result.error}`);
    } else {
      const loaded = await commands.loadEval(activeEval.id);
      if (loaded.status === "ok") {
        const r: EvalResult = JSON.parse(loaded.data);
        if (r.goal_grades) setGoalGrades(r.goal_grades);
      }
    }
    setGoalGrading(false);
  }

  async function runJudge() {
    if (!activeEval || judgeRunning) return;
    setJudgeRunning(true);
    const result = await commands.runLlmJudge(activeEval.id, judgeModel);
    if (result.status === "error") {
      console.error("run_llm_judge:", result.error);
      alert(`Judge failed: ${result.error}`);
    } else {
      // Reload the eval to pick up the saved judge scores.
      const loaded = await commands.loadEval(activeEval.id);
      if (loaded.status === "ok") {
        const r: EvalResult = JSON.parse(loaded.data);
        if (r.judge) setJudge(r.judge);
      }
    }
    setJudgeRunning(false);
  }

  function toggleModel(model: string) {
    setSelectedModels((prev) => prev.includes(model) ? prev.filter((m) => m !== model) : [...prev, model]);
  }

  const hasScores = Object.keys(humanScores).some((m) => Object.values(humanScores[m] ?? {}).some((v) => (v ?? 0) > 0));

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
    <div className="flex-1 flex h-full overflow-hidden bg-[oklch(0.105_0_0)]">
      {/* History sidebar */}
      {historyOpen && (
        <div className="w-72 flex-none border-r border-neutral-800 bg-[oklch(0.10_0_0)] flex flex-col">
          <div className="flex-none px-3 py-2 border-b border-neutral-800 flex items-center gap-2">
            <History className="w-4 h-4 text-[oklch(0.65_0.18_250)]" />
            <span className="text-xs font-semibold text-[oklch(0.85_0_0)] uppercase tracking-wider">History</span>
            <button onClick={() => setHistoryOpen(false)} className="ml-auto text-[oklch(0.45_0_0)] hover:text-[oklch(0.85_0_0)]">
              <ChevronUp className="w-3 h-3 rotate-90" />
            </button>
          </div>
          <HistoryPanel onLoad={async (id) => {
            const r = await commands.loadEval(id);
            if (r.status === "ok") {
              const parsed: EvalResult = JSON.parse(r.data);
              useEvalStore.getState().loadEval(parsed);
            }
          }} />
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex-none flex items-center gap-3 px-4 py-3 border-b border-neutral-800 bg-[oklch(0.12_0_0)]">
          <FlaskConical className="w-5 h-5 text-[oklch(0.65_0.18_250)]" />
          <span className="text-sm font-semibold text-[oklch(0.88_0_0)]">Model Eval Lab</span>
          <span className="text-xs text-[oklch(0.40_0_0)]">Race · score · judge</span>

          <div className="ml-auto flex items-center gap-1">
            {!historyOpen && (
              <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)} className="text-xs h-7 gap-1 text-[oklch(0.55_0_0)]">
                <History className="w-3.5 h-3.5" /> History
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={toggleBlind} className={`text-xs h-7 gap-1 ${blindMode ? "text-[oklch(0.78_0.18_250)]" : "text-[oklch(0.55_0_0)]"}`} title="Hide model names during scoring">
              {blindMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />} Blind
            </Button>
            {activeEval && hasScores && (
              <Button size="sm" variant="ghost" onClick={saveScores} disabled={savingScores} className="text-xs h-7 gap-1 text-[oklch(0.65_0.18_250)]">
                <Save className="w-3.5 h-3.5" /> {savingScores ? "Saving…" : "Save scores"}
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Mode + suite/prompt + models */}
          <div className="px-4 py-3 border-b border-neutral-800 flex flex-col gap-3">
            <div className="flex items-center gap-1 text-xs">
              <button onClick={() => setMode("single")}
                className={`px-3 py-1.5 rounded-l-md border ${mode === "single" ? "bg-[oklch(0.65_0.18_250)]/20 border-[oklch(0.65_0.18_250)] text-[oklch(0.85_0.15_250)]" : "bg-transparent border-neutral-700 text-[oklch(0.55_0_0)]"}`}>
                Single Prompt
              </button>
              <button onClick={() => setMode("suite")}
                className={`px-3 py-1.5 border -ml-px ${mode === "suite" ? "bg-[oklch(0.65_0.18_250)]/20 border-[oklch(0.65_0.18_250)] text-[oklch(0.85_0.15_250)]" : "bg-transparent border-neutral-700 text-[oklch(0.55_0_0)]"}`}>
                <ListChecks className="inline w-3 h-3 mr-1" /> Eval Suite
              </button>
              <button onClick={() => setMode("goal")}
                className={`px-3 py-1.5 rounded-r-md border -ml-px ${mode === "goal" ? "bg-[oklch(0.78_0.18_60)]/20 border-[oklch(0.78_0.18_60)] text-[oklch(0.88_0.15_60)]" : "bg-transparent border-neutral-700 text-[oklch(0.55_0_0)]"}`}>
                <Target className="inline w-3 h-3 mr-1" /> Goal Eval
              </button>
            </div>

            {mode === "single" ? (
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-[oklch(0.50_0_0)] font-medium uppercase tracking-wider">Prompt</label>
                <textarea
                  value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3}
                  placeholder="Enter a prompt to evaluate across all selected models…"
                  disabled={running}
                  className="bg-[oklch(0.155_0_0)] border border-neutral-800 rounded-lg px-3 py-2.5 text-sm text-[oklch(0.88_0_0)] placeholder:text-[oklch(0.38_0_0)] resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.65_0.18_250)] disabled:opacity-60"
                />
              </div>
            ) : mode === "goal" ? (
              <div className="flex flex-col gap-2">
                <label className="text-[10px] text-[oklch(0.50_0_0)] font-medium uppercase tracking-wider flex items-center gap-1.5">
                  <Target className="w-3 h-3 text-[oklch(0.78_0.18_60)]" /> Goal
                </label>
                <textarea
                  value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3}
                  placeholder="e.g. Refactor src/auth/middleware.ts to use the jose library instead of jsonwebtoken, preserving the same public API."
                  disabled={running}
                  className="bg-[oklch(0.155_0_0)] border border-neutral-800 rounded-lg px-3 py-2.5 text-sm text-[oklch(0.88_0_0)] placeholder:text-[oklch(0.38_0_0)] resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.78_0.18_60)] disabled:opacity-60"
                />
                <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-neutral-800 bg-[oklch(0.13_0_0)]">
                  <div className="flex items-start gap-2 min-w-0">
                    <Activity className="w-3.5 h-3.5 mt-0.5 text-[oklch(0.65_0.18_280)] flex-none" />
                    <div className="min-w-0">
                      <div className="text-xs text-[oklch(0.85_0_0)] font-medium">Live reasoning supervisor</div>
                      <div className="text-[10px] text-[oklch(0.50_0_0)] leading-relaxed">
                        Every ~1200 chars of reasoning, a judge call flags bad assumptions, goal drift, or contradictions. Adds ~2× cost.
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setLiveSupervisor((v) => !v)}
                    className={`w-9 h-5 flex-none rounded-full transition-colors relative ${liveSupervisor ? "bg-[oklch(0.65_0.18_280)]" : "bg-neutral-700"}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${liveSupervisor ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <label className="text-[10px] text-[oklch(0.50_0_0)] font-medium uppercase tracking-wider">Suite</label>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                  {suites.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSelectedSuite(s.id)}
                      disabled={running}
                      className={`text-left px-3 py-2 rounded-lg border transition-colors disabled:opacity-60 ${
                        selectedSuite === s.id
                          ? "bg-[oklch(0.65_0.18_250)]/15 border-[oklch(0.65_0.18_250)]"
                          : "bg-transparent border-neutral-800 hover:border-neutral-600"
                      }`}
                    >
                      <div className="text-xs font-semibold text-[oklch(0.88_0_0)]">{s.name}</div>
                      <div className="text-[10px] text-[oklch(0.50_0_0)] mt-0.5">{s.prompts.length} prompts · {s.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-[oklch(0.50_0_0)] font-medium uppercase tracking-wider">
                  Models to compare ({selectedModels.length})
                </label>
                <button onClick={() => setSelectedModels(selectedModels.length === allModels.length ? [] : [...allModels])} className="text-[10px] text-[oklch(0.45_0_0)] hover:text-[oklch(0.7_0_0)]">
                  {selectedModels.length === allModels.length ? "Clear all" : "Select all"}
                </button>
              </div>
              <div className="flex flex-col gap-1.5">
                {Object.entries(grouped).map(([provider, models]) => (
                  <div key={provider} className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-[oklch(0.42_0_0)] w-24 flex-none uppercase tracking-wider">{provider}</span>
                    {models.map((m) => (
                      <button
                        key={m}
                        onClick={() => toggleModel(m)}
                        disabled={running}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors disabled:opacity-60 ${
                          selectedModels.includes(m)
                            ? "bg-[oklch(0.65_0.18_250)]/20 border-[oklch(0.65_0.18_250)] text-[oklch(0.78_0.18_250)]"
                            : "bg-transparent border-neutral-700 text-[oklch(0.55_0_0)] hover:border-neutral-500"
                        }`}
                      >
                        {m.replace(/^bedrock-/, "")}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={
                  mode === "single" ? runSingleEval :
                  mode === "goal"   ? runGoalEval :
                                      runSuiteEval
                }
                disabled={running || selectedModels.length === 0 || ((mode === "single" || mode === "goal") && !prompt.trim())}
                className={`gap-1.5 text-white disabled:opacity-50 ${
                  mode === "goal"
                    ? "bg-[oklch(0.65_0.18_60)] hover:bg-[oklch(0.60_0.18_60)]"
                    : "bg-[oklch(0.65_0.18_250)] hover:bg-[oklch(0.60_0.18_250)]"
                }`}
              >
                {mode === "goal" ? <Target className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {running ? "Running…" : (mode === "single" ? "Run Eval" : mode === "goal" ? "Run Goal Eval" : "Run Suite")}
              </Button>

              {activeEval && !running && (
                <>
                  <select
                    value={judgeModel}
                    onChange={(e) => setJudgeModel(e.target.value)}
                    className="bg-[oklch(0.155_0_0)] border border-neutral-700 rounded text-xs px-2 py-1 text-[oklch(0.78_0_0)]"
                  >
                    {allModels.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <Button size="sm" variant="ghost" onClick={runJudge} disabled={judgeRunning}
                    className="gap-1 text-xs h-7 text-[oklch(0.78_0.18_100)]">
                    <Gavel className="w-3.5 h-3.5" /> {judgeRunning ? "Judging…" : "Run LLM Judge"}
                  </Button>
                  {(activeEval.is_goal_eval || mode === "goal") && (
                    <Button size="sm" variant="ghost" onClick={runGoalGrade} disabled={goalGrading}
                      className="gap-1 text-xs h-7 text-[oklch(0.85_0.18_60)]">
                      <Target className="w-3.5 h-3.5" /> {goalGrading ? "Grading…" : "Grade Goal"}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost"
                    onClick={() => { setPrompt(""); useEvalStore.setState({ activeEval: null, humanScores: {} }); }}
                    className="gap-1 text-xs h-7 text-[oklch(0.45_0_0)]">
                    <RotateCcw className="w-3 h-3" /> Reset
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Active eval body */}
          {activeEval && (
            <div className="px-4 py-4 flex flex-col gap-4">
              {/* Live race-track */}
              {!activeEval.complete && (
                <div className="rounded-lg border border-neutral-800 overflow-hidden bg-[oklch(0.12_0_0)]">
                  <div className="px-3 py-2 border-b border-neutral-800 bg-[oklch(0.14_0_0)] text-xs text-[oklch(0.55_0_0)] uppercase tracking-wider">
                    Live · {activeEval.models.length} models racing
                  </div>
                  {activeEval.models.map((m, i) => (
                    <RaceTrackRow
                      key={m}
                      model={m}
                      displayName={blindNames[m] ?? m}
                      color={SCORE_DIMENSIONS[i % SCORE_DIMENSIONS.length].color}
                    />
                  ))}
                </div>
              )}

              {/* Leaderboard */}
              {activeEval.complete && <Leaderboard blindNames={blindNames} />}

              {/* Response cards */}
              <div className={`grid gap-3 ${
                activeEval.models.length === 1 ? "grid-cols-1" :
                activeEval.models.length === 2 ? "grid-cols-1 lg:grid-cols-2" :
                "grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3"
              }`}>
                {activeEval.models.map((m) => (
                  <ResponseCard key={m} model={m} displayName={blindNames[m] ?? m} />
                ))}
              </div>

              {activeEval.suite_run_id && (
                <div className="text-[10px] text-[oklch(0.45_0_0)] text-center">
                  Suite run: <span className="font-mono">{activeEval.suite_run_id.slice(0, 8)}</span> · prompt {activeEval.suite_prompt_id}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

