import { create } from "zustand";
import { commands, type CivIntervention, type CivSessionMeta, type CivSessionSnapshot } from "../bindings";

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
  return JSON.parse(raw) as CivSessionSnapshot;
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
    const snapshot = parseCivSnapshot(result.data);
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
    const snapshot = parseCivSnapshot(result.data);
    set({
      activeSnapshot: snapshot,
      activeSessionId: snapshot.id,
      turnRunning: false,
      lastEventType: "TurnResolved",
    });
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
    const snapshot = parseCivSnapshot(result.data);
    set({
      activeSnapshot: snapshot,
      activeSessionId: snapshot.id,
      lastEventType: "InterventionApplied",
    });
    await get().loadSessions();
  },

  hydrateSnapshot: (snapshot, eventType = "StateSnapshot") =>
    set({
      activeSessionId: snapshot.id,
      activeSnapshot: snapshot,
      turnRunning: eventType === "TurnStarted",
      lastEventType: eventType,
    }),

  setError: (error) => set({ error }),
}));
