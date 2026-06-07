const TOKEN_LABELS: Record<string, string> = {
  cmd: "⌘",
  command: "⌘",
  commandorcontrol: "⌘",
  cmdorctrl: "⌘",
  ctrl: "⌃",
  control: "⌃",
  alt: "⌥",
  option: "⌥",
  shift: "⇧",
  enter: "↩",
  return: "↩",
  escape: "Esc",
  esc: "Esc",
  space: "Space",
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  backquote: "`",
  comma: ",",
};

export function formatMacShortcut(shortcut: string): string {
  return shortcut
    .split("+")
    .map((part) => {
      const trimmed = part.trim();
      const key = trimmed.toLowerCase().replace(/[^a-z0-9]/g, "");
      return TOKEN_LABELS[key] ?? trimmed;
    })
    .join("");
}

export function shortcutTitle(label: string, shortcut: string): string {
  return `${label} (${formatMacShortcut(shortcut)})`;
}
