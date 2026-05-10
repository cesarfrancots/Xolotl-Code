import { create } from "zustand";
import { commands } from "../bindings";
import type { SessionMeta } from "../bindings";
import type { Message } from "./chatStore";
import type { TokenUsage } from "../bindings";

/** Canonical session JSON format written to disk. */
export interface SessionSnapshot {
  id: string;
  model: string;
  messages: Message[];
  usage: TokenUsage;
  savedAt: string;
}

/**
 * Serialize session state to the canonical disk JSON format.
 * Both Plan 03 (sessionStore auto-save action) and Plan 06 (TurnCompleted handler)
 * call this helper — ensures both write the same shape to disk.
 * Canonical format: { id, model, messages, usage, savedAt }
 */
export function serializeSession(
  id: string,
  model: string,
  messages: Message[],
  usage: TokenUsage,
): string {
  const snapshot: SessionSnapshot = {
    id,
    model,
    messages,
    usage,
    savedAt: new Date().toISOString(),
  };
  return JSON.stringify(snapshot);
}

export interface SessionState {
  /** List of saved sessions, newest first. null while loading. */
  sessions: SessionMeta[] | null;
  /** Currently active session id. null for a new unsaved session. */
  activeSessionId: string | null;
  loading: boolean;
  error: string | null;

  /** Load session list from Tauri backend. */
  loadSessions: () => Promise<void>;

  /** Set the active session id (after loading or creating). */
  setActiveSessionId: (id: string | null) => void;

  /** Delete a session by id and reload the list. */
  deleteSession: (id: string) => Promise<void>;

  /** Save the current session JSON blob to disk. */
  saveSession: (id: string, json: string) => Promise<void>;
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  sessions: null,
  activeSessionId: null,
  loading: false,
  error: null,

  loadSessions: async () => {
    set({ loading: true, error: null });
    try {
      const metas = await commands.listSessions();
      set({ sessions: metas, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  setActiveSessionId: (id) => set({ activeSessionId: id }),

  deleteSession: async (id) => {
    const result = await commands.deleteSession(id);
    if (result.status === "error") {
      set({ error: result.error });
      return;
    }
    await get().loadSessions();
    if (get().activeSessionId === id) {
      set({ activeSessionId: null });
    }
  },

  saveSession: async (id, json) => {
    const result = await commands.saveSession(id, json);
    if (result.status === "error") {
      set({ error: result.error });
      return;
    }
    await get().loadSessions();
  },
}));
