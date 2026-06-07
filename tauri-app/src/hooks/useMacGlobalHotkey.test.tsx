import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAC_PRODUCTIVITY_SETTINGS_CHANGED_EVENT,
  notifyMacProductivitySettingsChanged,
  useMacGlobalHotkey,
} from "./useMacGlobalHotkey";
import type { MacProductivitySettings } from "../bindings";

const commandMocks = vi.hoisted(() => ({
  getMacProductivitySettings: vi.fn(),
}));

const shortcutMocks = vi.hoisted(() => ({
  register: vi.fn(),
  unregister: vi.fn(),
}));

const windowMocks = vi.hoisted(() => ({
  show: vi.fn(() => Promise.resolve()),
  unminimize: vi.fn(() => Promise.resolve()),
  setFocus: vi.fn(() => Promise.resolve()),
}));

vi.mock("../bindings", () => ({
  commands: {
    getMacProductivitySettings: commandMocks.getMacProductivitySettings,
  },
}));

vi.mock("@tauri-apps/plugin-global-shortcut", () => ({
  register: shortcutMocks.register,
  unregister: shortcutMocks.unregister,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowMocks,
}));

function settings(enabled: boolean, shortcut = "CommandOrControl+Shift+Space"): MacProductivitySettings {
  return {
    external_editor: null,
    global_hotkey: { enabled, shortcut },
    notifications: {
      agent_finished: false,
      eval_finished: false,
      permission_required: false,
    },
  };
}

function HotkeyHarness() {
  useMacGlobalHotkey();
  return null;
}

describe("useMacGlobalHotkey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commandMocks.getMacProductivitySettings.mockResolvedValue(settings(false));
    shortcutMocks.register.mockResolvedValue(undefined);
    shortcutMocks.unregister.mockResolvedValue(undefined);
  });

  it("registers enabled settings and focuses the app on pressed events", async () => {
    commandMocks.getMacProductivitySettings.mockResolvedValue(settings(true, "CommandOrControl+Option+X"));
    render(<HotkeyHarness />);

    await waitFor(() => {
      expect(shortcutMocks.register).toHaveBeenCalledWith(
        "CommandOrControl+Option+X",
        expect.any(Function),
      );
    });

    const handler = shortcutMocks.register.mock.calls[0][1];
    handler({ shortcut: "CommandOrControl+Option+X", id: 1, state: "Released" });
    expect(windowMocks.show).not.toHaveBeenCalled();

    handler({ shortcut: "CommandOrControl+Option+X", id: 1, state: "Pressed" });
    await waitFor(() => expect(windowMocks.setFocus).toHaveBeenCalled());
    expect(windowMocks.show).toHaveBeenCalled();
    expect(windowMocks.unminimize).toHaveBeenCalled();
  });

  it("switches and unregisters when settings change", async () => {
    commandMocks.getMacProductivitySettings.mockResolvedValue(settings(true, "CommandOrControl+Option+X"));
    const { unmount } = render(<HotkeyHarness />);

    await waitFor(() => {
      expect(shortcutMocks.register).toHaveBeenCalledWith(
        "CommandOrControl+Option+X",
        expect.any(Function),
      );
    });

    notifyMacProductivitySettingsChanged(settings(true, "CommandOrControl+Shift+Space"));

    await waitFor(() => {
      expect(shortcutMocks.unregister).toHaveBeenCalledWith("CommandOrControl+Option+X");
      expect(shortcutMocks.register).toHaveBeenCalledWith(
        "CommandOrControl+Shift+Space",
        expect.any(Function),
      );
    });

    window.dispatchEvent(new CustomEvent(MAC_PRODUCTIVITY_SETTINGS_CHANGED_EVENT, { detail: settings(false) }));

    await waitFor(() => {
      expect(shortcutMocks.unregister).toHaveBeenCalledWith("CommandOrControl+Shift+Space");
    });

    unmount();
  });
});
