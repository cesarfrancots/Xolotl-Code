import { create } from "zustand";
import { commands } from "../bindings";
import type { DirListing, Project } from "../bindings";
import { readStorageItem, removeStorageItem, writeStorageItem } from "../lib/browserStorage";

const ACTIVE_KEY = "xolotl-active-project";

function readActive(): string | null {
  return readStorageItem(ACTIVE_KEY);
}

function persistActive(path: string | null) {
  if (path) writeStorageItem(ACTIVE_KEY, path);
  else removeStorageItem(ACTIVE_KEY);
}

function refreshNativeMenu() {
  void commands.refreshNativeMenu().catch(() => undefined);
}

export interface ProjectState {
  /** Quick-access working directories, most-recently-opened first. */
  projects: Project[];
  /** Directory the current chat is scoped to. null = app launch cwd. */
  activeProjectPath: string | null;
  loading: boolean;
  error: string | null;

  /** Current directory shown in the in-app file browser. */
  listing: DirListing | null;
  browseLoading: boolean;
  browseError: string | null;

  loadProjects: () => Promise<void>;
  /** Native folder picker → add → activate. */
  openFolderDialog: () => Promise<void>;
  addProjectPath: (path: string) => Promise<void>;
  removeProject: (path: string) => Promise<void>;
  setActiveProject: (path: string | null) => void;
  browse: (path: string) => Promise<void>;
  refreshBrowse: () => Promise<void>;
  setProjectError: (error: string | null) => void;
  clearProjectError: () => void;
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  projects: [],
  activeProjectPath: readActive(),
  loading: false,
  error: null,
  listing: null,
  browseLoading: false,
  browseError: null,

  loadProjects: async () => {
    set({ loading: true, error: null });
    try {
      const projects = await commands.listProjects();
      set({ projects, loading: false, error: null });
      refreshNativeMenu();
      const active = get().activeProjectPath;
      if (active && !get().listing) {
        void get().browse(active);
      }
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  openFolderDialog: async () => {
    set({ error: null });
    const res = await commands.pickDirectory();
    if (res.status === "error") {
      set({ error: res.error });
      return;
    }
    if (res.data) await get().addProjectPath(res.data);
  },

  addProjectPath: async (path) => {
    set({ error: null });
    const res = await commands.addProject(path);
    if (res.status === "error") {
      set({ error: res.error });
      return;
    }
    set({ projects: res.data, error: null });
    refreshNativeMenu();
    // The command sorts most-recently-opened first, so the freshly added (or
    // re-touched) project is at the top with its canonical path.
    const canonical = res.data[0]?.path ?? path;
    get().setActiveProject(canonical);
  },

  removeProject: async (path) => {
    set({ error: null });
    const res = await commands.removeProject(path);
    if (res.status === "error") {
      set({ error: res.error });
      return;
    }
    set({ projects: res.data, error: null });
    refreshNativeMenu();
    if (get().activeProjectPath === path) get().setActiveProject(null);
  },

  setActiveProject: (path) => {
    persistActive(path);
    set({ activeProjectPath: path, listing: null, browseError: null });
    if (path) {
      void commands
        .touchProject(path)
        .then((res) => {
          if (res.status === "ok") refreshNativeMenu();
        })
        .catch(() => undefined);
      void get().browse(path);
    }
  },

  browse: async (path) => {
    set({ browseLoading: true, browseError: null });
    const res = await commands.browseDirectory(path);
    if (res.status === "error") {
      set({ browseError: res.error, browseLoading: false });
      return;
    }
    set({ listing: res.data, browseLoading: false });
  },

  refreshBrowse: async () => {
    const current = get().listing?.path ?? get().activeProjectPath;
    if (current) await get().browse(current);
  },

  setProjectError: (error) => set({ error }),

  clearProjectError: () => set({ error: null }),
}));

/** Display name for a project path (its last path component). */
export function projectDisplayName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}
