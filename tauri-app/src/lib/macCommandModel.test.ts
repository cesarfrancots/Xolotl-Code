import { describe, expect, it } from "vitest";
import {
  MAC_COMMANDS,
  macCommandActionForKeydown,
  macCommandByAction,
  macCommandById,
} from "./macCommandModel";

function keyEvent(
  overrides: Partial<Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "defaultPrevented">>,
) {
  return {
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    ...overrides,
  } as Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "defaultPrevented">;
}

describe("MAC_COMMANDS", () => {
  it("keeps command ids, actions, and shortcuts unique", () => {
    const ids = MAC_COMMANDS.map((command) => command.id);
    const actions = MAC_COMMANDS.map((command) => command.action);
    const shortcuts = MAC_COMMANDS.map((command) => command.shortcut);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(actions).size).toBe(actions.length);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
  });

  it("indexes commands by id and native action", () => {
    expect(macCommandById("settings").shortcut).toBe("Cmd+Comma");
    expect(macCommandByAction("toggle-terminal")?.shortcut).toBe("Cmd+J");
    expect(macCommandByAction("terminal-next")?.shortcut).toBe("Cmd+Shift+ArrowRight");
  });
});

describe("macCommandActionForKeydown", () => {
  it("resolves global Cmd-first shortcuts", () => {
    expect(macCommandActionForKeydown(keyEvent({ key: "n", metaKey: true }), { terminalOpen: false })).toBe("new-chat");
    expect(macCommandActionForKeydown(keyEvent({ key: "O", metaKey: true }), { terminalOpen: false })).toBe("open-folder");
    expect(macCommandActionForKeydown(keyEvent({ key: ",", metaKey: true }), { terminalOpen: false })).toBe("settings");
    expect(macCommandActionForKeydown(keyEvent({ key: "2", metaKey: true }), { terminalOpen: false })).toBe("tab-eval");
  });

  it("keeps terminal tab shortcuts scoped to an open terminal dock", () => {
    expect(macCommandActionForKeydown(keyEvent({ key: "t", metaKey: true }), { terminalOpen: false })).toBeNull();
    expect(macCommandActionForKeydown(keyEvent({ key: "t", metaKey: true }), { terminalOpen: true })).toBe("terminal-new");
    expect(macCommandActionForKeydown(keyEvent({ key: "w", metaKey: true }), { terminalOpen: true })).toBe("terminal-close");
    expect(macCommandActionForKeydown(keyEvent({ key: "ArrowLeft", metaKey: true, shiftKey: true }), { terminalOpen: true })).toBe("terminal-prev");
    expect(macCommandActionForKeydown(keyEvent({ key: "ArrowRight", metaKey: true, shiftKey: true }), { terminalOpen: true })).toBe("terminal-next");
  });

  it("preserves the web-compatible terminal toggle fallback", () => {
    expect(macCommandActionForKeydown(keyEvent({ key: "`", code: "Backquote", ctrlKey: true }), { terminalOpen: false })).toBe("toggle-terminal");
  });

  it("ignores modified or already-handled shortcuts", () => {
    expect(macCommandActionForKeydown(keyEvent({ key: "n", metaKey: true, altKey: true }), { terminalOpen: false })).toBeNull();
    expect(macCommandActionForKeydown(keyEvent({ key: "n", metaKey: true, defaultPrevented: true }), { terminalOpen: false })).toBeNull();
  });
});
