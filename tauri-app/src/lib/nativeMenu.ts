export const TAURI_MENU_EVENT = "xolotl://menu";
export const TAURI_RECENT_PROJECT_MENU_EVENT = "xolotl://recent-project-menu";
export const NATIVE_MENU_EVENT = "xolotl:native-menu";

const MENU_ACTION_BY_ID = {
  "xolotl:new-chat": "new-chat",
  "xolotl:open-folder": "open-folder",
  "xolotl:settings": "settings",
  "xolotl:commands": "commands",
  "xolotl:toggle-terminal": "toggle-terminal",
  "xolotl:terminal-new-tab": "terminal-new",
  "xolotl:terminal-close-tab": "terminal-close",
  "xolotl:terminal-prev-tab": "terminal-prev",
  "xolotl:terminal-next-tab": "terminal-next",
  "xolotl:tab-chat": "tab-chat",
  "xolotl:tab-eval": "tab-eval",
  "xolotl:tab-civ": "tab-civ",
  "xolotl:status-reveal-active-project": "status-reveal-active-project",
  "xolotl:status-open-active-project-editor": "status-open-active-project-editor",
  "xolotl:status-open-active-project-terminal": "status-open-active-project-terminal",
  "xolotl:status-open-latest-agent": "open-latest-agent",
  "xolotl:open-latest-agent": "open-latest-agent",
  "xolotl:reveal-latest-agent-worktree": "reveal-latest-agent-worktree",
  "xolotl:open-latest-agent-worktree-editor": "open-latest-agent-worktree-editor",
  "xolotl:open-latest-agent-worktree-terminal": "open-latest-agent-worktree-terminal",
  "xolotl:new-latest-agent-worktree-terminal-tab": "new-latest-agent-worktree-terminal-tab",
  "xolotl:copy-latest-agent-worktree-path": "copy-latest-agent-worktree-path",
  "xolotl:copy-latest-agent-worktree-link": "copy-latest-agent-worktree-link",
  "xolotl:copy-latest-agent-worktree-shell-open": "copy-latest-agent-worktree-shell-open",
  "xolotl:copy-latest-agent-worktree-context": "copy-latest-agent-worktree-context",
  "xolotl:copy-latest-agent-worktree-shortcuts-json": "copy-latest-agent-worktree-shortcuts-json",
  "xolotl:status-copy-active-project-link": "status-copy-active-project-link",
  "xolotl:status-copy-active-project-shell-open": "status-copy-active-project-shell-open",
  "xolotl:new-active-project-terminal-tab": "new-active-project-terminal-tab",
  "xolotl:copy-active-project-path": "copy-active-project-path",
  "xolotl:copy-active-project-context": "copy-active-project-context",
  "xolotl:copy-active-project-shortcuts-json": "copy-active-project-shortcuts-json",
} as const;

export type NativeMenuAction = (typeof MENU_ACTION_BY_ID)[keyof typeof MENU_ACTION_BY_ID];

const MENU_ACTIONS = new Set<NativeMenuAction>(Object.values(MENU_ACTION_BY_ID));

const RECENT_PROJECT_MENU_ACTIONS = new Set([
  "reveal",
  "open-editor",
  "open-external-terminal",
  "new-terminal",
  "copy-path",
  "copy-link",
  "copy-shell-open",
  "copy-context",
  "copy-shortcuts-json",
] as const);

export type NativeRecentProjectMenuAction =
  | "reveal"
  | "open-editor"
  | "open-external-terminal"
  | "new-terminal"
  | "copy-path"
  | "copy-link"
  | "copy-shell-open"
  | "copy-context"
  | "copy-shortcuts-json";

export interface NativeRecentProjectMenuPayload {
  action: NativeRecentProjectMenuAction;
  path: string;
}

export function nativeMenuActionFromPayload(payload: unknown): NativeMenuAction | null {
  if (typeof payload !== "string") return null;
  if (payload in MENU_ACTION_BY_ID) {
    return MENU_ACTION_BY_ID[payload as keyof typeof MENU_ACTION_BY_ID];
  }
  if (MENU_ACTIONS.has(payload as NativeMenuAction)) {
    return payload as NativeMenuAction;
  }
  return null;
}

export function dispatchNativeMenuAction(action: NativeMenuAction) {
  window.dispatchEvent(new CustomEvent<NativeMenuAction>(NATIVE_MENU_EVENT, { detail: action }));
}

export function nativeRecentProjectMenuActionFromPayload(payload: unknown): NativeRecentProjectMenuPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as { action?: unknown; path?: unknown };
  if (typeof candidate.action !== "string" || typeof candidate.path !== "string") return null;
  if (!RECENT_PROJECT_MENU_ACTIONS.has(candidate.action as NativeRecentProjectMenuAction)) return null;
  if (!candidate.path.trim()) return null;
  return {
    action: candidate.action as NativeRecentProjectMenuAction,
    path: candidate.path,
  };
}

export function listenForNativeMenuActions(
  handler: (action: NativeMenuAction) => void,
  options: { dedupeMs?: number } = {},
) {
  const dedupeMs = options.dedupeMs ?? 150;
  let lastAction: NativeMenuAction | null = null;
  let lastHandledAt = 0;

  const onAction = (event: Event) => {
    const action = nativeMenuActionFromPayload((event as CustomEvent<unknown>).detail);
    if (!action) return;

    const now = performance.now();
    if (action === lastAction && now - lastHandledAt < dedupeMs) return;
    lastAction = action;
    lastHandledAt = now;
    handler(action);
  };

  window.addEventListener(NATIVE_MENU_EVENT, onAction);
  return () => window.removeEventListener(NATIVE_MENU_EVENT, onAction);
}
