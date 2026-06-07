import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAC_PRODUCTIVITY_SETTINGS_CHANGED_EVENT,
  notifyMacProductivitySettingsChanged,
  useMacGlobalHotkey,
} from "./useMacGlobalHotkey";
import type { MacProductivitySettings } from "../bindings";
import { MAC_APP_STATUS_EVENT, type MacAppStatus } from "../lib/macAppStatus";

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
    external_terminal: null,
    detected_editors: [],
    detected_terminals: [],
    global_hotkey: { enabled, shortcut },
    status_item: { enabled: false },
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

  it("emits recovery status when global hotkey registration fails", async () => {
    const statuses: MacAppStatus[] = [];
    const onStatus = (event: Event) => statuses.push((event as CustomEvent<MacAppStatus>).detail);
    window.addEventListener(MAC_APP_STATUS_EVENT, onStatus);
    commandMocks.getMacProductivitySettings.mockResolvedValue(settings(true, "CommandOrControl+Option+X"));
    shortcutMocks.register.mockRejectedValueOnce(new Error("shortcut already owned"));

    try {
      render(<HotkeyHarness />);

      await waitFor(() => {
        expect(statuses[0]?.message).toBe("Global hotkey registration failed.");
      });
      expect(statuses[0]?.hint).toContain("Pick a different shortcut");
      expect(statuses[0]?.hint).toContain("shortcut already owned");
    } finally {
      window.removeEventListener(MAC_APP_STATUS_EVENT, onStatus);
    }
  });

  it("emits recovery status when a pressed global hotkey cannot focus the app", async () => {
    const statuses: MacAppStatus[] = [];
    const onStatus = (event: Event) => statuses.push((event as CustomEvent<MacAppStatus>).detail);
    window.addEventListener(MAC_APP_STATUS_EVENT, onStatus);
    commandMocks.getMacProductivitySettings.mockResolvedValue(settings(true, "CommandOrControl+Option+X"));
    windowMocks.setFocus.mockRejectedValueOnce(new Error("focus denied"));

    try {
      render(<HotkeyHarness />);

      await waitFor(() => {
        expect(shortcutMocks.register).toHaveBeenCalledWith(
          "CommandOrControl+Option+X",
          expect.any(Function),
        );
      });

      const handler = shortcutMocks.register.mock.calls[0][1];
      handler({ shortcut: "CommandOrControl+Option+X", id: 1, state: "Pressed" });

      await waitFor(() => {
        expect(statuses[0]?.message).toBe("Global hotkey could not focus Xolotl Code.");
      });
      expect(statuses[0]?.hint).toContain("Cmd+Tab");
      expect(statuses[0]?.hint).toContain("focus denied");
    } finally {
      window.removeEventListener(MAC_APP_STATUS_EVENT, onStatus);
    }
  });
});
