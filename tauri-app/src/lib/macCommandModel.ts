import type { NativeMenuAction } from "./nativeMenu";

export type MacCommandId =
  | "new-chat"
  | "open-folder"
  | "settings"
  | "commands"
  | "toggle-terminal"
  | "tab-chat"
  | "tab-eval"
  | "tab-civ"
  | "terminal-new"
  | "terminal-close"
  | "terminal-prev"
  | "terminal-next";

export type MacCommandContext = "global" | "terminal-open";

export interface MacCommandSpec {
  id: MacCommandId;
  action: NativeMenuAction;
  label: string;
  shortcut: string;
  description: string;
  context: MacCommandContext;
}

export const MAC_COMMANDS = [
  {
    id: "new-chat",
    action: "new-chat",
    label: "New Chat",
    shortcut: "Cmd+N",
    description: "Start a fresh chat in the current workspace.",
    context: "global",
  },
  {
    id: "open-folder",
    action: "open-folder",
    label: "Open Folder",
    shortcut: "Cmd+O",
    description: "Choose a project folder with the native picker.",
    context: "global",
  },
  {
    id: "settings",
    action: "settings",
    label: "Settings",
    shortcut: "Cmd+Comma",
    description: "Open provider, skill, and app settings.",
    context: "global",
  },
  {
    id: "commands",
    action: "commands",
    label: "Commands",
    shortcut: "Cmd+K",
    description: "Open the command palette from anywhere.",
    context: "global",
  },
  {
    id: "toggle-terminal",
    action: "toggle-terminal",
    label: "Toggle Terminal",
    shortcut: "Cmd+J",
    description: "Show or hide the terminal dock.",
    context: "global",
  },
  {
    id: "tab-chat",
    action: "tab-chat",
    label: "Go to Chat",
    shortcut: "Cmd+1",
    description: "Switch the center workbench to Chat.",
    context: "global",
  },
  {
    id: "tab-eval",
    action: "tab-eval",
    label: "Go to Eval",
    shortcut: "Cmd+2",
    description: "Switch the center workbench to Eval.",
    context: "global",
  },
  {
    id: "tab-civ",
    action: "tab-civ",
    label: "Go to Civ",
    shortcut: "Cmd+3",
    description: "Switch the center workbench to Civ.",
    context: "global",
  },
  {
    id: "terminal-new",
    action: "terminal-new",
    label: "New Terminal",
    shortcut: "Cmd+T",
    description: "Create a terminal tab in the active project.",
    context: "terminal-open",
  },
  {
    id: "terminal-close",
    action: "terminal-close",
    label: "Close Terminal Tab",
    shortcut: "Cmd+W",
    description: "Close the active terminal tab when the dock is open.",
    context: "terminal-open",
  },
  {
    id: "terminal-prev",
    action: "terminal-prev",
    label: "Previous Terminal Tab",
    shortcut: "Cmd+Shift+ArrowLeft",
    description: "Switch to the previous terminal tab.",
    context: "terminal-open",
  },
  {
    id: "terminal-next",
    action: "terminal-next",
    label: "Next Terminal Tab",
    shortcut: "Cmd+Shift+ArrowRight",
    description: "Switch to the next terminal tab.",
    context: "terminal-open",
  },
] as const satisfies readonly MacCommandSpec[];

export function macCommandById(id: MacCommandId): MacCommandSpec {
  return MAC_COMMANDS.find((command) => command.id === id)!;
}

export function macCommandByAction(action: NativeMenuAction): MacCommandSpec | null {
  return MAC_COMMANDS.find((command) => command.action === action) ?? null;
}

export function macCommandActionForKeydown(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "defaultPrevented">,
  options: { terminalOpen: boolean },
): NativeMenuAction | null {
  if (event.defaultPrevented) return null;

  if (event.metaKey && !event.ctrlKey && !event.altKey) {
    const key = event.key.toLowerCase();

    if (!event.shiftKey) {
      if (options.terminalOpen) {
        if (key === "t") return "terminal-new";
        if (key === "w") return "terminal-close";
      }

      const globalActionByKey: Partial<Record<string, NativeMenuAction>> = {
        ",": "settings",
        "1": "tab-chat",
        "2": "tab-eval",
        "3": "tab-civ",
        j: "toggle-terminal",
        k: "commands",
        n: "new-chat",
        o: "open-folder",
      };
      return globalActionByKey[key] ?? null;
    }

    if (options.terminalOpen) {
      if (event.key === "ArrowLeft") return "terminal-prev";
      if (event.key === "ArrowRight") return "terminal-next";
    }
  }

  if (event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "`" || event.code === "Backquote")) {
    return "toggle-terminal";
  }

  return null;
}
