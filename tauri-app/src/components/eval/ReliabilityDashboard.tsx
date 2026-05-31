import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Gauge, RefreshCw, TrendingDown, TrendingUp, AlertTriangle, Bookmark, Sparkles,
} from "lucide-react";
import { Button } from "../ui/button";
import { commands } from "../../bindings";
import type { ReliabilityProfile, HintProposal } from "../../bindings";
import {
  detectRegressions, regressionsOnly, summarizeChanges, type MetricChange,
} from "../../lib/profileRegression";

const BASELINE_KEY = "xolotl.reliabilityBaseline";

function loadBaseline(): ReliabilityProfile[] {
  try {
    const raw = localStorage.getItem(BASELINE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Returns false when the write was rejected (e.g. quota) so the caller can be honest. */
function saveBaseline(profiles: ReliabilityProfile[]): boolean {
  try {
    localStorage.setItem(BASELINE_KEY, JSON.stringify(profiles));
    return true;
  } catch {
    return false;
  }
}

const pct = (v: number) => `${Math.round((v ?? 0) * 100)}%`;
const fmtCost = (p: ReliabilityProfile) =>
  p.cost_known && typeof p.total_cost_usd === "number" ? `$${p.total_cost_usd.toFixed(4)}` : "—";
const fmtTps = (v: number) => (v > 0 ? `${Math.round(v).toLocaleString("en-US")} tok/s` : "—");

function metricValue(change: MetricChange, value: number): string {
  return change.metric === "mean_tokens_per_sec" ? `${Math.round(value)}` : pct(value);
}

export function ReliabilityDashboard() {
  const [profiles, setProfiles] = useState<ReliabilityProfile[]>([]);
  const [proposals, setProposals] = useState<HintProposal[]>([]);
  const [baseline, setBaseline] = useState<ReliabilityProfile[]>(() => loadBaseline());
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [p, pr] = await Promise.all([
        commands.listReliabilityProfiles(),
        commands.listHintProposals(),
      ]);
      setProfiles(p);
      setProposals(pr);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const rebuild = useCallback(async () => {
    setBuilding(true);
    setNotice(null);
    setError(null);
    try {
      const prof = await commands.buildReliabilityProfiles();
      if (prof.status === "error") {
        setError(prof.error);
        return;
      }
      const prop = await commands.buildHintProposals();
      // Reflect the newly-written profiles regardless of whether the (separate)
      // proposal build succeeded, so the panel never shows pre-rebuild data.
      await reload();
      if (prop.status === "error") {
        setError(prop.error);
        return;
      }
      setNotice(
        `Aggregated ${prof.data.evals_scanned} eval${prof.data.evals_scanned === 1 ? "" : "s"} into ${prof.data.models} profile${prof.data.models === 1 ? "" : "s"}; produced ${prop.data.overrides} hint proposal${prop.data.overrides === 1 ? "" : "s"}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(false);
    }
  }, [reload]);

  const changes = useMemo(() => detectRegressions(baseline, profiles), [baseline, profiles]);
  const regressions = useMemo(() => regressionsOnly(changes), [changes]);
  const summary = useMemo(() => summarizeChanges(changes), [changes]);
  const regressionsByModel = useMemo(() => {
    const map = new Map<string, MetricChange[]>();
    for (const c of regressions) {
      const list = map.get(c.model) ?? [];
      list.push(c);
      map.set(c.model, list);
    }
    return map;
  }, [regressions]);

  const proposalsByModel = useMemo(() => {
    const map = new Map<string, HintProposal>();
    for (const p of proposals) map.set(p.model, p);
    return map;
  }, [proposals]);

  const setAsBaseline = useCallback(() => {
    const persisted = saveBaseline(profiles);
    setBaseline(profiles);
    setNotice(
      persisted
        ? "Saved the current profiles as the regression baseline."
        : "Baseline set for this session only — could not persist it (storage full).",
    );
  }, [profiles]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5">
      <header className="flex flex-col gap-3 rounded-md border border-[oklch(0.20_0.006_245)] bg-[oklch(0.108_0.004_245)] px-4 py-4 md:flex-row md:items-center">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[oklch(0.56_0.020_205)]">
            <Sparkles className="h-3.5 w-3.5" />
            Self-calibrating flywheel
          </div>
          <h2 className="text-xl font-semibold tracking-normal text-[oklch(0.90_0.012_220)]">Model reliability profiles</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[oklch(0.58_0.014_230)]">
            Aggregated cost, throughput, and token-calibration per model across every recorded eval, plus
            propose-only hint overrides. Rebuild after new evals; compare against a saved baseline to catch regressions.
          </p>
        </div>
        <div className="ml-auto flex flex-none items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void rebuild()}
            disabled={building}
            className="h-8 gap-1 text-xs text-[oklch(0.70_0.055_190)]"
            title="Aggregate eval history into profiles + hint proposals"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${building ? "animate-spin" : ""}`} />
            {building ? "Building..." : "Rebuild"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={setAsBaseline}
            disabled={profiles.length === 0 || building}
            className="h-8 gap-1 text-xs text-[oklch(0.58_0.025_230)]"
            title="Snapshot the current profiles as the regression baseline"
          >
            <Bookmark className="h-3.5 w-3.5" /> Set baseline
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-[oklch(0.34_0.035_28)] bg-[oklch(0.13_0.010_28)] px-3 py-2 text-xs text-[oklch(0.78_0.060_28)]">
          {error}
        </div>
      )}
      {notice && !error && (
        <div className="rounded-md border border-[oklch(0.30_0.018_165)] bg-[oklch(0.12_0.008_170)] px-3 py-2 text-xs text-[oklch(0.74_0.050_160)]">
          {notice}
        </div>
      )}

      {/* Regression banner (hidden while reloading so it never shows a stale diff) */}
      {baseline.length > 0 && !loading && (
        <div
          className={`flex items-center gap-3 rounded-md border px-4 py-3 ${
            summary.regressions > 0
              ? "border-[oklch(0.34_0.035_28)] bg-[oklch(0.12_0.010_28)]"
              : "border-[oklch(0.30_0.018_165)] bg-[oklch(0.11_0.008_170)]"
          }`}
        >
          {summary.regressions > 0 ? (
            <AlertTriangle className="h-4 w-4 flex-none text-[oklch(0.74_0.060_28)]" />
          ) : (
            <TrendingUp className="h-4 w-4 flex-none text-[oklch(0.72_0.060_160)]" />
          )}
          <div className="text-xs text-[oklch(0.70_0.018_220)]">
            {summary.regressions > 0
              ? `${summary.regressions} regression${summary.regressions === 1 ? "" : "s"} across ${summary.regressedModels} model${summary.regressedModels === 1 ? "" : "s"} vs the saved baseline.`
              : "No regressions vs the saved baseline."}
            {summary.improvements > 0 && ` ${summary.improvements} improvement${summary.improvements === 1 ? "" : "s"}.`}
          </div>
        </div>
      )}

      {loading ? (
        <div className="rounded-md border border-[oklch(0.20_0.006_245)] bg-[oklch(0.108_0.004_245)] px-4 py-10 text-center text-sm text-[oklch(0.55_0.012_230)]">
          Loading profiles...
        </div>
      ) : profiles.length === 0 ? (
        <div className="rounded-md border border-[oklch(0.20_0.006_245)] bg-[oklch(0.108_0.004_245)] px-4 py-10 text-center">
          <Gauge className="mx-auto h-6 w-6 text-[oklch(0.50_0.020_205)]" />
          <div className="mt-2 text-sm font-medium text-[oklch(0.80_0.014_225)]">No reliability profiles yet</div>
          <div className="mt-1 text-xs text-[oklch(0.52_0.012_230)]">
            Run some evals, then press Rebuild to aggregate them into per-model profiles.
          </div>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {profiles.map((p) => {
            const modelRegressions = regressionsByModel.get(p.model) ?? [];
            const proposal = proposalsByModel.get(p.model);
            return (
              <div key={p.model} className="rounded-md border border-[oklch(0.18_0.006_245)] bg-[oklch(0.096_0.003_245)] p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-[oklch(0.86_0.014_222)]">{p.model}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-[0.13em] text-[oklch(0.48_0.012_230)]">
                    {p.runs} run{p.runs === 1 ? "" : "s"}
                  </span>
                  {modelRegressions.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded border border-[oklch(0.34_0.035_28)] bg-[oklch(0.13_0.010_28)] px-1.5 py-0.5 text-[10px] font-semibold text-[oklch(0.76_0.060_28)]">
                      <TrendingDown className="h-3 w-3" /> {modelRegressions.length}
                    </span>
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                  <Stat label="Calibration" value={pct(p.token_calibration_rate)} regressed={modelRegressions.some((c) => c.metric === "token_calibration_rate")} />
                  <Stat label="Error rate" value={pct(p.error_rate)} regressed={modelRegressions.some((c) => c.metric === "error_rate")} />
                  <Stat label="Throughput" value={fmtTps(p.mean_tokens_per_sec)} regressed={modelRegressions.some((c) => c.metric === "mean_tokens_per_sec")} />
                  <Stat label="Total cost" value={fmtCost(p)} />
                  <Stat label="Mean out tok" value={Math.round(p.mean_output_tokens).toLocaleString("en-US")} />
                  <Stat label="Token error" value={pct(p.mean_token_count_error)} />
                </dl>

                {modelRegressions.length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-[oklch(0.16_0.006_245)] pt-2">
                    {modelRegressions.map((c) => (
                      <div key={c.metric} className="flex items-center gap-1.5 text-[11px] text-[oklch(0.72_0.050_30)]">
                        <TrendingDown className="h-3 w-3 flex-none" />
                        {c.label}: {metricValue(c, c.before)} → {metricValue(c, c.after)}
                      </div>
                    ))}
                  </div>
                )}

                {proposal && proposal.proposals.length > 0 && (
                  <div className="mt-2 space-y-1.5 border-t border-[oklch(0.16_0.006_245)] pt-2">
                    <div className="text-[10px] uppercase tracking-[0.13em] text-[oklch(0.50_0.018_205)]">Proposed hints (review only)</div>
                    {proposal.proposals.map((o) => (
                      <div key={o.field} className="rounded border border-[oklch(0.20_0.010_235)] bg-[oklch(0.085_0.003_245)] px-2 py-1.5">
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="font-mono text-[oklch(0.74_0.040_195)]">{o.field}</span>
                          <span className="font-mono text-[oklch(0.56_0.012_230)]">{o.current}</span>
                          <span className="text-[oklch(0.48_0.012_230)]">→</span>
                          <span className="font-mono text-[oklch(0.82_0.040_150)]">{o.proposed}</span>
                        </div>
                        <div className="mt-0.5 text-[10px] leading-snug text-[oklch(0.52_0.012_230)]">{o.rationale}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, regressed = false }: { label: string; value: string; regressed?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-[11px] text-[oklch(0.52_0.012_230)]">{label}</dt>
      <dd className={`font-mono text-[11px] tabular-nums ${regressed ? "text-[oklch(0.78_0.060_30)]" : "text-[oklch(0.82_0.016_220)]"}`}>
        {value}
      </dd>
    </div>
  );
}

export default ReliabilityDashboard;
