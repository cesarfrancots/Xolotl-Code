import { create } from "zustand";
import {
  commands,
  type CivCivilization,
  type CivEnvironment,
  type CivIntervention,
  type CivSessionMeta,
  type CivSessionSnapshot,
  type CivWorld,
} from "../bindings";

const CIV_BROWSER_PREVIEW_SNAPSHOT_KEY = "xolotl-preview-civ-store-snapshot-v1";

export interface CivState {
  sessions: CivSessionMeta[] | null;
  activeSessionId: string | null;
  activeSnapshot: CivSessionSnapshot | null;
  models: string[];
  loading: boolean;
  turnRunning: boolean;
  error: string | null;
  lastEventType: string | null;

  loadModels: () => Promise<void>;
  loadSessions: () => Promise<void>;
  createSession: (config: { name: string; model: string; seed?: number | null }) => Promise<void>;
  loadSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  advanceTurn: () => Promise<void>;
  applyIntervention: (intervention: CivIntervention) => Promise<void>;
  hydrateSnapshot: (snapshot: CivSessionSnapshot, eventType?: string) => void;
  setError: (error: string | null) => void;
}

export function parseCivSnapshot(raw: string): CivSessionSnapshot {
  return normalizeCivSnapshot(JSON.parse(raw));
}

function readBrowserPreviewSnapshot(fallback: CivSessionSnapshot): CivSessionSnapshot | null {
  if (!browserPreviewStorageEnabled()) return null;
  try {
    const raw = window.localStorage.getItem(CIV_BROWSER_PREVIEW_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = normalizeCivSnapshot(JSON.parse(raw));
    if (parsed.id !== fallback.id) return null;
    return parsed.updated_at >= fallback.updated_at ? parsed : null;
  } catch {
    return null;
  }
}

function persistBrowserPreviewSnapshot(snapshot: CivSessionSnapshot) {
  if (!browserPreviewStorageEnabled()) return;
  try {
    window.localStorage.setItem(CIV_BROWSER_PREVIEW_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // Browser preview continuity is best-effort; native Tauri sessions are saved by the backend.
  }
}

function clearBrowserPreviewSnapshot(id?: string) {
  if (!browserPreviewStorageEnabled()) return;
  try {
    if (!id) {
      window.localStorage.removeItem(CIV_BROWSER_PREVIEW_SNAPSHOT_KEY);
      return;
    }
    const raw = window.localStorage.getItem(CIV_BROWSER_PREVIEW_SNAPSHOT_KEY);
    if (!raw) return;
    const parsed = normalizeCivSnapshot(JSON.parse(raw));
    if (parsed.id === id) window.localStorage.removeItem(CIV_BROWSER_PREVIEW_SNAPSHOT_KEY);
  } catch {
    window.localStorage.removeItem(CIV_BROWSER_PREVIEW_SNAPSHOT_KEY);
  }
}

function browserPreviewStorageEnabled() {
  return typeof window !== "undefined" && window.__XOLOTL_BROWSER_PREVIEW__ === true && Boolean(window.localStorage);
}

export function normalizeCivSnapshot(value: unknown): CivSessionSnapshot {
  const input = isRecord(value) ? value : {};
  const name = stringProp(input, "name", "Axolotl Colony");
  const legacyModel = stringProp(input, "model", "unknown");
  const legacyCiv = input.civilization;
  const civInputs = Array.isArray(input.civs) && input.civs.length > 0
    ? input.civs
    : legacyCiv
      ? [legacyCiv]
      : [];
  const civs = civInputs.length > 0
    ? civInputs.map((civ, index) => normalizeCiv(civ, name, legacyModel, index))
    : [normalizeCiv(null, name, legacyModel, 0)];

  return {
    id: stringProp(input, "id", "preview-civ"),
    name,
    seed: numberProp(input, "seed", 0),
    version: numberProp(input, "version", 2),
    created_at: numberProp(input, "created_at", 0),
    updated_at: numberProp(input, "updated_at", 0),
    turn: numberProp(input, "turn", 0),
    world: normalizeWorld(input.world),
    civs,
    environment: normalizeEnvironment(input.environment),
    modifiers: Array.isArray(input.modifiers) ? input.modifiers as CivSessionSnapshot["modifiers"] : [],
    log: Array.isArray(input.log) ? input.log as CivSessionSnapshot["log"] : [],
  };
}

export function primaryCiv(snapshot: CivSessionSnapshot): CivCivilization {
  return normalizeCiv(snapshot.civs?.[0], snapshot.name, "unknown", 0);
}

function normalizeCiv(value: unknown, fallbackName: string, fallbackModel: string, index: number): CivCivilization {
  const input = isRecord(value) ? value : {};
  return {
    id: stringProp(input, "id", index === 0 ? "civ-1" : `civ-${index + 1}`),
    name: stringProp(input, "name", fallbackName),
    model: stringProp(input, "model", fallbackModel),
    color: stringProp(input, "color", "#6dd6a7"),
    spawn_x: numberProp(input, "spawn_x", 0),
    home_region: stringProp(input, "home_region", ""),
    alive: booleanProp(input, "alive", true),
    diplomacy: stringMap(input.diplomacy),
    era: stringProp(input, "era", "pond_camp"),
    population: numberProp(input, "population", 0),
    health: numberProp(input, "health", 0),
    morale: numberProp(input, "morale", 0),
    resources: numberMap(input.resources),
    techs: stringArray(input.techs),
    policies: stringArray(input.policies),
    score: normalizeScore(input.score),
  };
}

function normalizeWorld(value: unknown): CivWorld {
  const input = isRecord(value) ? value : {};
  return {
    width: numberProp(input, "width", 64),
    height: numberProp(input, "height", 36),
    tiles: Array.isArray(input.tiles) ? input.tiles as CivWorld["tiles"] : [],
    entities: Array.isArray(input.entities) ? input.entities as CivWorld["entities"] : [],
    regions: Array.isArray(input.regions) ? input.regions as CivWorld["regions"] : [],
  };
}

function normalizeEnvironment(value: unknown): CivEnvironment {
  const input = isRecord(value) ? value : {};
  return {
    season: stringProp(input, "season", "spring"),
    turn_of_season: numberProp(input, "turn_of_season", 0),
    temperature: numberProp(input, "temperature", 14),
    water_level: numberProp(input, "water_level", 0),
    disasters: Array.isArray(input.disasters) ? input.disasters as CivEnvironment["disasters"] : [],
    forecast: isRecord(input.forecast) ? input.forecast as CivEnvironment["forecast"] : null,
  };
}

function normalizeScore(value: unknown): CivCivilization["score"] {
  const input = isRecord(value) ? value : {};
  return {
    survival: numberProp(input, "survival", 0),
    ethics: numberProp(input, "ethics", 0),
    intelligence: numberProp(input, "intelligence", 0),
    total: numberProp(input, "total", 0),
  };
}

function stringProp(input: Record<string, unknown>, key: string, fallback: string) {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberProp(input: Record<string, unknown>, key: string, fallback: number) {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanProp(input: Record<string, unknown>, key: string, fallback: boolean) {
  const value = input[key];
  return typeof value === "boolean" ? value : fallback;
}

function numberMap(value: unknown) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => (
      typeof entry[1] === "number" && Number.isFinite(entry[1])
    )),
  );
}

function stringMap(value: unknown) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const useCivStore = create<CivState>()((set, get) => ({
  sessions: null,
  activeSessionId: null,
  activeSnapshot: null,
  models: [],
  loading: false,
  turnRunning: false,
  error: null,
  lastEventType: null,

  loadModels: async () => {
    try {
      const models = await commands.listModels();
      set({ models });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  loadSessions: async () => {
    set({ loading: true, error: null });
    try {
      const sessions = await commands.listCivSessions();
      set({ sessions, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  createSession: async (config) => {
    set({ loading: true, error: null });
    const result = await commands.createCivSession(config);
    if (result.status === "error") {
      set({ error: result.error, loading: false });
      return;
    }
    await get().loadSessions();
    await get().loadSession(result.data);
  },

  loadSession: async (id) => {
    set({ loading: true, error: null });
    const result = await commands.loadCivSession(id);
    if (result.status === "error") {
      set({ error: result.error, loading: false });
      return;
    }
    let snapshot: CivSessionSnapshot;
    try {
      snapshot = parseCivSnapshot(result.data);
    } catch (err) {
      set({ error: `Invalid civilization snapshot: ${String(err)}`, loading: false });
      return;
    }
    snapshot = readBrowserPreviewSnapshot(snapshot) ?? snapshot;
    persistBrowserPreviewSnapshot(snapshot);
    set({
      activeSessionId: snapshot.id,
      activeSnapshot: snapshot,
      loading: false,
      lastEventType: "StateSnapshot",
    });
  },

  deleteSession: async (id) => {
    const result = await commands.deleteCivSession(id);
    if (result.status === "error") {
      set({ error: result.error });
      return;
    }
    clearBrowserPreviewSnapshot(id);
    if (get().activeSessionId === id) {
      set({ activeSessionId: null, activeSnapshot: null });
    }
    await get().loadSessions();
  },

  advanceTurn: async () => {
    const id = get().activeSessionId;
    if (!id || get().turnRunning) return;
    set({ turnRunning: true, error: null, lastEventType: "TurnStarted" });
    const result = await commands.advanceCivTurn(id);
    if (result.status === "error") {
      set({ turnRunning: false, error: result.error });
      return;
    }
    let snapshot: CivSessionSnapshot;
    try {
      snapshot = parseCivSnapshot(result.data);
    } catch (err) {
      set({ turnRunning: false, error: `Invalid civilization snapshot: ${String(err)}` });
      return;
    }
    set({
      activeSnapshot: snapshot,
      activeSessionId: snapshot.id,
      turnRunning: false,
      lastEventType: "TurnResolved",
    });
    persistBrowserPreviewSnapshot(snapshot);
    await get().loadSessions();
  },

  applyIntervention: async (intervention) => {
    const id = get().activeSessionId;
    if (!id) return;
    set({ error: null });
    const result = await commands.applyCivIntervention(id, intervention);
    if (result.status === "error") {
      set({ error: result.error });
      return;
    }
    let snapshot: CivSessionSnapshot;
    try {
      snapshot = parseCivSnapshot(result.data);
    } catch (err) {
      set({ error: `Invalid civilization snapshot: ${String(err)}` });
      return;
    }
    set({
      activeSnapshot: snapshot,
      activeSessionId: snapshot.id,
      lastEventType: "InterventionApplied",
    });
    persistBrowserPreviewSnapshot(snapshot);
    await get().loadSessions();
  },

  hydrateSnapshot: (snapshot, eventType = "StateSnapshot") => {
    const normalized = normalizeCivSnapshot(snapshot);
    set({
      activeSessionId: normalized.id,
      activeSnapshot: normalized,
      turnRunning: eventType === "TurnStarted",
      lastEventType: eventType,
    });
    persistBrowserPreviewSnapshot(normalized);
  },

  setError: (error) => set({ error }),
}));
