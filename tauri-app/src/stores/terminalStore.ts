import { create } from "zustand";

/** A terminal tab in the bottom dock. */
export interface TerminalTab {
  /** Stable client-side key — React identity + tab id before the PTY exists. */
  key: string;
  /** Backend PTY id, assigned once `terminal_spawn` resolves. */
  backendId: string | null;
  title: string;
  /** Resolved shell executable path once the backend PTY exists. */
  shell: string | null;
  /** Short shell display name, for example zsh, bash, fish, or PowerShell. */
  shellName: string | null;
  /** Directory the shell was launched in. Null means app launch cwd. */
  cwd: string | null;
  /** How the shell/environment profile was resolved. */
  envSource: string | null;
  /** The shell process has exited (read-only scrollback remains). */
  exited: boolean;
}

interface TerminalBackendInfo {
  id: string;
  shell: string;
  shell_name: string;
  cwd: string;
  env_source: string;
}

interface TerminalState {
  tabs: TerminalTab[];
  activeKey: string | null;
  /** Create a new tab and make it active. Returns its key. */
  addTab: (title?: string, cwd?: string | null) => string;
  setBackendInfo: (key: string, info: TerminalBackendInfo) => void;
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
  addTab: (title, cwd = null) => {
    const key = newKey();
    nextTerminalNum += 1;
    set((s) => ({
      tabs: [
        ...s.tabs,
        {
          key,
          backendId: null,
          title: title ?? `Terminal ${nextTerminalNum}`,
          shell: null,
          shellName: null,
          cwd,
          envSource: null,
          exited: false,
        },
      ],
      activeKey: key,
    }));
    return key;
  },
  setBackendInfo: (key, info) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (
        t.key === key
          ? {
            ...t,
            backendId: info.id,
            shell: info.shell,
            shellName: info.shell_name,
            cwd: info.cwd || t.cwd,
            envSource: info.env_source,
          }
          : t
      )),
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
