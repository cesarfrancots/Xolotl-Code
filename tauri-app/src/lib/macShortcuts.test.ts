import { describe, expect, it } from "vitest";
import { formatMacShortcut, shortcutTitle } from "./macShortcuts";

describe("formatMacShortcut", () => {
  it("renders macOS modifier symbols for command-style shortcuts", () => {
    expect(formatMacShortcut("Cmd+K")).toBe("⌘K");
    expect(formatMacShortcut("CmdOrCtrl+Shift+ArrowLeft")).toBe("⌘⇧←");
    expect(formatMacShortcut("Ctrl+Backquote")).toBe("⌃`");
  });

  it("keeps readable labels for non-symbol keys", () => {
    expect(formatMacShortcut("Shift+Enter")).toBe("⇧↩");
    expect(formatMacShortcut("Escape")).toBe("Esc");
    expect(shortcutTitle("Open commands", "Cmd+K")).toBe("Open commands (⌘K)");
  });
});
