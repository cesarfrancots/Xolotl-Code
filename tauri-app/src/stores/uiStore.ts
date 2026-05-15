import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiState {
  sessionsCollapsed: boolean;
  agentsCollapsed: boolean;
  /** Names of skills the user has enabled. Persisted across sessions. */
  enabledSkills: string[];
  toggleSessions: () => void;
  toggleAgents: () => void;
  toggleSkill: (name: string) => void;
  setEnabledSkills: (names: string[]) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sessionsCollapsed: false,
      agentsCollapsed: false,
      enabledSkills: [],
      toggleSessions: () => set((s) => ({ sessionsCollapsed: !s.sessionsCollapsed })),
      toggleAgents: () => set((s) => ({ agentsCollapsed: !s.agentsCollapsed })),
      toggleSkill: (name) =>
        set((s) => ({
          enabledSkills: s.enabledSkills.includes(name)
            ? s.enabledSkills.filter((n) => n !== name)
            : [...s.enabledSkills, name],
        })),
      setEnabledSkills: (names) => set({ enabledSkills: names }),
    }),
    { name: "xolotl-ui-state" }
  )
);
