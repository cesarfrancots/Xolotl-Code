import { useEffect, useMemo, useState, type ReactNode } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  Activity,
  AlertTriangle,
  Brain,
  Eye,
  EyeOff,
  FastForward,
  FlaskConical,
  Gift,
  Hammer,
  Leaf,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Shield,
  Sparkles,
  Sprout,
  Trash2,
  Waves,
  X,
} from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { CivilizationGameCanvas } from "./CivilizationGameCanvas";
import { useCivStore } from "../../stores/civStore";
import type { CivIntervention, CivLogEntry, CivModifier, CivSessionSnapshot } from "../../bindings";

const RESOURCES = ["food", "clean_water", "wood", "stone", "clay", "fiber", "tools", "glowshards"];
const BUFFS = ["abundant_moss", "clear_water", "cooperation_aura", "curiosity_spark"];
const DEBUFFS = ["drought", "cold_snap", "food_rot", "fatigue", "quarrel_pressure"];

type CivEventPayload = {
  type: string;
  snapshot?: CivSessionSnapshot;
  error?: string;
};

export function CivilizationView() {
  const sessions = useCivStore((s) => s.sessions);
  const activeSessionId = useCivStore((s) => s.activeSessionId);
  const snapshot = useCivStore((s) => s.activeSnapshot);
  const models = useCivStore((s) => s.models);
  const loading = useCivStore((s) => s.loading);
  const turnRunning = useCivStore((s) => s.turnRunning);
  const error = useCivStore((s) => s.error);
  const loadModels = useCivStore((s) => s.loadModels);
  const loadSessions = useCivStore((s) => s.loadSessions);
  const createSession = useCivStore((s) => s.createSession);
  const loadSession = useCivStore((s) => s.loadSession);
  const deleteSession = useCivStore((s) => s.deleteSession);
  const advanceTurn = useCivStore((s) => s.advanceTurn);
  const applyIntervention = useCivStore((s) => s.applyIntervention);
  const hydrateSnapshot = useCivStore((s) => s.hydrateSnapshot);
  const setError = useCivStore((s) => s.setError);

  const [name, setName] = useState("Axolotl Colony");
  const [selectedModel, setSelectedModel] = useState("");
  const [resource, setResource] = useState("food");
  const [amount, setAmount] = useState(10);
  const [modifier, setModifier] = useState("abundant_moss");
  const [autoplay, setAutoplay] = useState(false);
  const [uiHidden, setUiHidden] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  useEffect(() => {
    void loadModels();
    void loadSessions();
  }, [loadModels, loadSessions]);

  useEffect(() => {
    if (!selectedModel && models.length > 0) {
      setSelectedModel(models.includes("kimi-coding") ? "kimi-coding" : models[0]);
    }
  }, [models, selectedModel]);

  useEffect(() => {
    if (!activeSessionId && sessions && sessions.length > 0) {
      void loadSession(sessions[0].id);
    }
  }, [activeSessionId, sessions, loadSession]);

  useEffect(() => {
    if (!activeSessionId) return;
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    listen<CivEventPayload>(`civ-event:${activeSessionId}`, (event) => {
      const payload = event.payload;
      if (payload.snapshot) hydrateSnapshot(payload.snapshot, payload.type);
      if (payload.error) setError(payload.error);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [activeSessionId, hydrateSnapshot, setError]);

  useEffect(() => {
    if (!autoplay || turnRunning || !snapshot) return;
    const timer = window.setTimeout(() => {
      void advanceTurn();
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [autoplay, turnRunning, snapshot?.turn, advanceTurn, snapshot]);

  const recentLog = useMemo(() => [...(snapshot?.log ?? [])].reverse().slice(0, 12), [snapshot?.log]);

  async function handleCreate() {
    const model = selectedModel || models[0] || "kimi-coding";
    await createSession({ name, model, seed: null });
    setLeftOpen(false);
  }

  function sendIntervention(intervention: CivIntervention) {
    void applyIntervention(intervention);
  }

  const isBuff = BUFFS.includes(modifier);

  return (
    <main className="civ-view">
      {/* ── fullscreen world stage ─────────────────────────────────────── */}
      <div className="civ-stage">
        {snapshot ? (
          <CivilizationGameCanvas snapshot={snapshot} turnRunning={turnRunning} />
        ) : (
          <div className="civ-welcome">
            <div className="civ-glass civ-welcome-card">
              <div className="mb-1 flex items-center gap-2 text-[oklch(0.86_0.05_175)]">
                <Sprout className="h-5 w-5" />
                <span className="text-sm font-semibold">Axolotl Civilization Lab</span>
              </div>
              <p className="mb-3 text-xs leading-relaxed text-[oklch(0.62_0.014_225)]">
                Found a pixel axolotl colony and watch a model govern it turn by turn. You observe,
                grant resources, and apply buffs or debuffs.
              </p>
              <div className="space-y-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Colony name" />
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="civ-select"
                >
                  {(models.length ? models : ["kimi-coding"]).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <Button className="w-full" disabled={loading || !selectedModel} onClick={() => void handleCreate()}>
                  <Sprout className="h-3.5 w-3.5" />
                  Found Colony
                </Button>
                {sessions && sessions.length > 0 && (
                  <button type="button" className="civ-link" onClick={() => setLeftOpen(true)}>
                    or load a saved colony →
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── persistent corner control: hide / reveal the HUD ───────────── */}
      <button
        type="button"
        className="civ-eye"
        onClick={() => setUiHidden((v) => !v)}
        title={uiHidden ? "Show interface" : "Hide interface"}
        aria-pressed={uiHidden}
      >
        {uiHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        <span>{uiHidden ? "Show UI" : "Hide UI"}</span>
      </button>

      {/* ── top-left status HUD ────────────────────────────────────────── */}
      {!uiHidden && snapshot && (
        <div className="civ-hud civ-hud-tl civ-glass">
          <div className="flex items-center gap-2">
            <span className="civ-hud-mark"><Sprout className="h-3.5 w-3.5" /></span>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-[oklch(0.90_0.018_220)]">{snapshot.name}</div>
              <div className="truncate text-[10px] uppercase tracking-[0.14em] text-[oklch(0.55_0.014_220)]">
                {snapshot.model} · {snapshot.civilization.era.replace(/_/g, " ")}
              </div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Metric icon={<RotateCcw className="h-3 w-3" />} label="Turn" value={String(snapshot.turn)} />
            <Metric icon={<Activity className="h-3 w-3" />} label="Pop" value={String(snapshot.civilization.population)} />
            <Metric icon={<Shield className="h-3 w-3" />} label="HP" value={formatScore(snapshot.civilization.health)} />
            <Metric icon={<Sprout className="h-3 w-3" />} label="Mood" value={formatScore(snapshot.civilization.morale)} />
            <Metric icon={<FlaskConical className="h-3 w-3" />} label="Score" value={formatScore(snapshot.civilization.score.total)} tone />
          </div>
          {turnRunning && (
            <div className="civ-thinking">
              <Brain className="h-3 w-3" />
              <span>Model is deciding…</span>
            </div>
          )}
        </div>
      )}

      {/* ── edge tabs that open the drawers ────────────────────────────── */}
      {!uiHidden && (
        <>
          <button
            type="button"
            className="civ-edge-tab civ-edge-left"
            onClick={() => setLeftOpen((v) => !v)}
            aria-expanded={leftOpen}
          >
            <Leaf className="h-3.5 w-3.5" />
            <span>Colonies</span>
          </button>
          {snapshot && (
            <button
              type="button"
              className="civ-edge-tab civ-edge-right"
              onClick={() => setRightOpen((v) => !v)}
              aria-expanded={rightOpen}
            >
              <Hammer className="h-3.5 w-3.5" />
              <span>Observer</span>
            </button>
          )}
        </>
      )}

      {/* ── LEFT drawer: sessions + create ─────────────────────────────── */}
      {!uiHidden && (
        <aside className={["civ-drawer civ-drawer-left civ-glass", leftOpen ? "is-open" : ""].join(" ")}>
          <DrawerHeader title="Colonies" icon={<Leaf className="h-3.5 w-3.5" />} onClose={() => setLeftOpen(false)} />
          <div className="civ-drawer-body">
            <Section label="New colony" icon={<Plus className="h-3.5 w-3.5" />}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Colony name" />
              <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} className="civ-select mt-2">
                {(models.length ? models : ["kimi-coding"]).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <Button size="sm" className="mt-2 w-full" disabled={loading || !selectedModel} onClick={() => void handleCreate()}>
                <Sprout className="h-3.5 w-3.5" />
                Found Colony
              </Button>
            </Section>
            <Section label="Saved" icon={<RotateCcw className="h-3.5 w-3.5" />}>
              <div className="space-y-1.5">
                {sessions && sessions.length > 0 ? sessions.map((session) => (
                  <div
                    key={session.id}
                    className={[
                      "group flex w-full items-center gap-2 rounded-md border px-2 py-2 transition-colors",
                      session.id === activeSessionId
                        ? "border-[oklch(0.42_0.032_175)] bg-[oklch(0.16_0.014_170)]"
                        : "border-[oklch(0.24_0.008_240)] bg-[oklch(0.11_0.004_245)]/70 hover:bg-[oklch(0.15_0.006_240)]",
                    ].join(" ")}
                  >
                    <button type="button" onClick={() => { void loadSession(session.id); setLeftOpen(false); }} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <span className="grid h-7 w-7 flex-none place-items-center rounded bg-[oklch(0.16_0.010_190)] text-[oklch(0.72_0.055_180)]">
                        <Leaf className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-[oklch(0.85_0.014_220)]">{session.name}</span>
                        <span className="block truncate text-[10px] text-[oklch(0.54_0.012_225)]">Turn {session.turn} · {formatScore(session.score)}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-[oklch(0.44_0.012_230)] opacity-0 transition-opacity hover:text-[oklch(0.78_0.055_28)] group-hover:opacity-100"
                      onClick={() => void deleteSession(session.id)}
                      title="Delete colony"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )) : (
                  <div className="rounded-md border border-[oklch(0.24_0.008_240)] bg-[oklch(0.11_0.004_245)]/70 px-3 py-4 text-xs text-[oklch(0.54_0.012_225)]">
                    No colonies yet. Found one above.
                  </div>
                )}
              </div>
            </Section>
          </div>
        </aside>
      )}

      {/* ── RIGHT drawer: observer panels ──────────────────────────────── */}
      {!uiHidden && snapshot && (
        <aside className={["civ-drawer civ-drawer-right civ-glass", rightOpen ? "is-open" : ""].join(" ")}>
          <DrawerHeader title="Observer" icon={<Hammer className="h-3.5 w-3.5" />} onClose={() => setRightOpen(false)} />
          <div className="civ-drawer-body">
            <Section label="Score" icon={<FlaskConical className="h-3.5 w-3.5" />}>
              <ScorePanel snapshot={snapshot} />
            </Section>
            <Section label="Resources" icon={<Hammer className="h-3.5 w-3.5" />}>
              <ResourcesPanel snapshot={snapshot} />
            </Section>
            <Section label="Intervene" icon={<Gift className="h-3.5 w-3.5" />}>
              <div className="grid gap-2">
                <div className="flex items-center gap-1.5">
                  <select value={resource} onChange={(e) => setResource(e.target.value)} className="civ-select flex-1">
                    {RESOURCES.map((item) => <option key={item} value={item}>{resourceLabel(item)}</option>)}
                  </select>
                  <Input type="number" min={1} max={99} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="w-16" />
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <Button size="xs" variant="outline" onClick={() => sendIntervention({ kind: "grant_resource", target: resource, amount })}>Grant</Button>
                  <Button size="xs" variant="outline" onClick={() => sendIntervention({ kind: "remove_resource", target: resource, amount })}>Remove</Button>
                  <Button size="xs" variant="outline" onClick={() => sendIntervention({ kind: "spawn_resource", target: resource, amount, x: 34, y: 25 })}>Spawn</Button>
                </div>
                <select value={modifier} onChange={(e) => setModifier(e.target.value)} className="civ-select">
                  <optgroup label="Buffs">{BUFFS.map((item) => <option key={item} value={item}>{modifierLabel(item)}</option>)}</optgroup>
                  <optgroup label="Debuffs">{DEBUFFS.map((item) => <option key={item} value={item}>{modifierLabel(item)}</option>)}</optgroup>
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => sendIntervention({
                    kind: isBuff ? "apply_buff" : "apply_debuff",
                    target: modifier,
                    duration: 4,
                    intensity: 1,
                  })}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Apply {isBuff ? "Buff" : "Debuff"}
                </Button>
              </div>
            </Section>
            <Section label="Modifiers" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
              <ModifiersPanel modifiers={snapshot.modifiers} />
            </Section>
            <Section label="Log" icon={<Waves className="h-3.5 w-3.5" />}>
              <LogPanel entries={recentLog} />
            </Section>
          </div>
        </aside>
      )}

      {/* ── error toast ────────────────────────────────────────────────── */}
      {error && (
        <div className="civ-error civ-glass">
          <AlertTriangle className="h-3.5 w-3.5 flex-none" />
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error" title="Dismiss error" className="flex-none opacity-70 hover:opacity-100"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* ── minimal floating toolbelt (always visible) ─────────────────── */}
      {snapshot && (
        <div className="civ-toolbelt civ-glass">
          <button className="civ-slot civ-slot-primary" disabled={turnRunning} onClick={() => void advanceTurn()} title="Advance one turn">
            <FastForward className="h-4 w-4" />
            <span>{turnRunning ? "Thinking…" : "Next Turn"}</span>
          </button>
          <button
            className={["civ-slot", autoplay ? "is-active" : ""].join(" ")}
            disabled={turnRunning}
            aria-pressed={autoplay}
            onClick={() => setAutoplay((v) => !v)}
            title={autoplay ? "Pause auto turns" : "Run turns automatically"}
          >
            {autoplay ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            <span>Auto</span>
          </button>
          <span className="civ-toolbelt-div" />
          <select value={resource} onChange={(e) => setResource(e.target.value)} className="civ-slot-select" title="Resource">
            {RESOURCES.map((item) => <option key={item} value={item}>{resourceLabel(item)}</option>)}
          </select>
          <button className="civ-slot" onClick={() => sendIntervention({ kind: "grant_resource", target: resource, amount })} title={`Grant ${amount} ${resourceLabel(resource)}`}>
            <Plus className="h-4 w-4" /><span>Grant</span>
          </button>
          <button className="civ-slot" onClick={() => sendIntervention({ kind: "remove_resource", target: resource, amount })} title={`Remove ${amount} ${resourceLabel(resource)}`}>
            <Minus className="h-4 w-4" /><span>Remove</span>
          </button>
          <button className="civ-slot" onClick={() => sendIntervention({ kind: "spawn_resource", target: resource, amount, x: 34, y: 25 })} title={`Spawn ${resourceLabel(resource)} in the world`}>
            <Sprout className="h-4 w-4" /><span>Spawn</span>
          </button>
          <span className="civ-toolbelt-div" />
          <select value={modifier} onChange={(e) => setModifier(e.target.value)} className="civ-slot-select civ-slot-select-wide" title="Modifier">
            <optgroup label="Buffs">{BUFFS.map((item) => <option key={item} value={item}>{modifierLabel(item)}</option>)}</optgroup>
            <optgroup label="Debuffs">{DEBUFFS.map((item) => <option key={item} value={item}>{modifierLabel(item)}</option>)}</optgroup>
          </select>
          <button
            className={["civ-slot", isBuff ? "is-buff" : "is-debuff"].join(" ")}
            onClick={() => sendIntervention({ kind: isBuff ? "apply_buff" : "apply_debuff", target: modifier, duration: 4, intensity: 1 })}
            title={`Apply ${modifierLabel(modifier)}`}
          >
            <Sparkles className="h-4 w-4" /><span>{isBuff ? "Buff" : "Debuff"}</span>
          </button>
        </div>
      )}
    </main>
  );
}

function Section({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="civ-section">
      <div className="civ-section-title">{icon}{label}</div>
      {children}
    </section>
  );
}

function DrawerHeader({ title, icon, onClose }: { title: string; icon: ReactNode; onClose: () => void }) {
  return (
    <div className="civ-drawer-head">
      <span className="flex items-center gap-1.5">{icon}{title}</span>
      <button type="button" onClick={onClose} className="opacity-70 hover:opacity-100" title="Close"><X className="h-3.5 w-3.5" /></button>
    </div>
  );
}

function Metric({ icon, label, value, tone = false }: { icon: ReactNode; label: string; value: string; tone?: boolean }) {
  return (
    <div className={["civ-metric", tone ? "civ-metric-tone" : ""].join(" ")}>
      {icon}
      <span className="civ-metric-label">{label}</span>
      <span className="civ-metric-value">{value}</span>
    </div>
  );
}

function ScorePanel({ snapshot }: { snapshot: CivSessionSnapshot }) {
  const score = snapshot.civilization.score;
  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between">
        <span className="text-3xl font-semibold tabular-nums text-[oklch(0.84_0.050_175)]">{formatScore(score.total)}</span>
        <span className="pb-1 text-[11px] text-[oklch(0.50_0.012_225)]">total</span>
      </div>
      <ScoreBar label="Survival" value={score.survival ?? 0} tone="oklch(0.70 0.070 155)" />
      <ScoreBar label="Ethics" value={score.ethics ?? 0} tone="oklch(0.74 0.055 190)" />
      <ScoreBar label="Intelligence" value={score.intelligence ?? 0} tone="oklch(0.76 0.060 285)" />
    </div>
  );
}

function ResourcesPanel({ snapshot }: { snapshot: CivSessionSnapshot }) {
  const resources = snapshot.civilization.resources;
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {RESOURCES.map((item) => (
        <div key={item} className="rounded-md border border-[oklch(0.24_0.008_240)] bg-[oklch(0.10_0.004_245)]/70 px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-[0.10em] text-[oklch(0.48_0.012_225)]">{resourceLabel(item)}</div>
          <div className="mt-0.5 text-sm font-semibold tabular-nums text-[oklch(0.85_0.018_220)]">{resources[item] ?? 0}</div>
        </div>
      ))}
    </div>
  );
}

function ModifiersPanel({ modifiers }: { modifiers: CivModifier[] }) {
  if (modifiers.length === 0) return <div className="text-xs text-[oklch(0.52_0.012_225)]">No active modifiers.</div>;
  return (
    <div className="space-y-1.5">
      {modifiers.map((item) => (
        <div key={item.id} className="flex items-center justify-between gap-2 rounded-md border border-[oklch(0.24_0.008_240)] bg-[oklch(0.10_0.004_245)]/70 px-2 py-1.5">
          <div className="min-w-0">
            <div className={["truncate text-xs font-semibold", item.polarity === "buff" ? "text-[oklch(0.76_0.060_155)]" : "text-[oklch(0.78_0.065_45)]"].join(" ")}>
              {item.label}
            </div>
            <div className="text-[10px] text-[oklch(0.48_0.012_225)]">{item.polarity}</div>
          </div>
          <span className="text-xs tabular-nums text-[oklch(0.62_0.018_220)]">{item.remaining_turns}t</span>
        </div>
      ))}
    </div>
  );
}

function LogPanel({ entries }: { entries: CivLogEntry[] }) {
  if (entries.length === 0) return <div className="text-xs text-[oklch(0.52_0.012_225)]">No events yet.</div>;
  return (
    <div className="space-y-2">
      {entries.map((entry, index) => (
        <article key={`${entry.created_at}-${index}`} className="rounded-md border border-[oklch(0.24_0.008_240)] bg-[oklch(0.10_0.004_245)]/70 px-2.5 py-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="truncate text-xs font-semibold text-[oklch(0.85_0.018_220)]">{entry.title}</span>
            <span className="text-[10px] tabular-nums text-[oklch(0.44_0.012_225)]">T{entry.turn}</span>
          </div>
          <p className="text-[11px] leading-relaxed text-[oklch(0.58_0.014_225)]">{entry.body}</p>
        </article>
      ))}
    </div>
  );
}

function ScoreBar({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-[oklch(0.60_0.014_225)]">{label}</span>
        <span className="tabular-nums text-[oklch(0.74_0.020_220)]">{formatScore(value)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[oklch(0.20_0.006_240)]">
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: tone }} />
      </div>
    </div>
  );
}

function formatScore(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value.toFixed(value >= 10 ? 0 : 1);
}

function resourceLabel(value: string) {
  return value.replace(/_/g, " ");
}

function modifierLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
