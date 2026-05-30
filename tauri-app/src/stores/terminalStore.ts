import { create } from "zustand";

/** A terminal tab in the bottom dock. */
export interface TerminalTab {
  /** Stable client-side key — React identity + tab id before the PTY exists. */
  key: string;
  /** Backend PTY id, assigned once `terminal_spawn` resolves. */
  backendId: string | null;
  title: string;
  /** The shell process has exited (read-only scrollback remains). */
  exited: boolean;
}

interface TerminalState {
  tabs: TerminalTab[];
  activeKey: string | null;
  /** Create a new tab and make it active. Returns its key. */
  addTab: (title?: string) => string;
  setBackendId: (key: string, backendId: string) => void;
  markExited: (backendId: string) => void;
  closeTab: (key: string) => void;
  setActive: (key: string) => void;
}

function newKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `t-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

// Monotonic so default titles never repeat after a close (avoids two
// "Terminal 2" tabs — duplicate titles + ambiguous close-button labels).
let nextTerminalNum = 0;

export const useTerminalStore = create<TerminalState>((set) => ({
  tabs: [],
  activeKey: null,
  addTab: (title) => {
    const key = newKey();
    nextTerminalNum += 1;
    set((s) => ({
      tabs: [
        ...s.tabs,
        { key, backendId: null, title: title ?? `Terminal ${nextTerminalNum}`, exited: false },
      ],
      activeKey: key,
    }));
    return key;
  },
  setBackendId: (key, backendId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.key === key ? { ...t, backendId } : t)),
    })),
  markExited: (backendId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.backendId === backendId ? { ...t, exited: true } : t)),
    })),
  closeTab: (key) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.key !== key);
      let activeKey = s.activeKey;
      if (activeKey === key) {
        activeKey = tabs.length > 0 ? tabs[tabs.length - 1].key : null;
      }
      return { tabs, activeKey };
    }),
  setActive: (key) => set({ activeKey: key }),
}));
