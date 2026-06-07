import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { getPersistStorage } from "../lib/browserStorage";

interface UiState {
  sessionsCollapsed: boolean;
  agentsCollapsed: boolean;
  /** Names of skills the user has enabled. Persisted across sessions. */
  enabledSkills: string[];
  /** Whether the bottom terminal dock is open. */
  terminalPanelOpen: boolean;
  /** Height of the terminal dock in pixels. */
  terminalPanelHeight: number;
  toggleSessions: () => void;
  toggleAgents: () => void;
  toggleSkill: (name: string) => void;
  setEnabledSkills: (names: string[]) => void;
  toggleTerminalPanel: () => void;
  setTerminalPanelOpen: (open: boolean) => void;
  setTerminalPanelHeight: (height: number) => void;
}

const MIN_TERMINAL_HEIGHT = 140;
const MAX_TERMINAL_HEIGHT = 720;

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sessionsCollapsed: false,
      agentsCollapsed: false,
      enabledSkills: [],
      terminalPanelOpen: false,
      terminalPanelHeight: 280,
      toggleSessions: () => set((s) => ({ sessionsCollapsed: !s.sessionsCollapsed })),
      toggleAgents: () => set((s) => ({ agentsCollapsed: !s.agentsCollapsed })),
      toggleSkill: (name) =>
        set((s) => ({
          enabledSkills: s.enabledSkills.includes(name)
            ? s.enabledSkills.filter((n) => n !== name)
            : [...s.enabledSkills, name],
        })),
      setEnabledSkills: (names) => set({ enabledSkills: names }),
      toggleTerminalPanel: () => set((s) => ({ terminalPanelOpen: !s.terminalPanelOpen })),
      setTerminalPanelOpen: (open) => set({ terminalPanelOpen: open }),
      setTerminalPanelHeight: (height) =>
        set({
          terminalPanelHeight: Math.min(
            MAX_TERMINAL_HEIGHT,
            Math.max(MIN_TERMINAL_HEIGHT, Math.round(height))
          ),
        }),
    }),
    {
      name: "xolotl-ui-state",
      storage: createJSONStorage(getPersistStorage),
    }
  )
);
