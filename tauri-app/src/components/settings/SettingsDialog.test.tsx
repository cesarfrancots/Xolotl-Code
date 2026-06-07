import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "./SettingsDialog";
import type {
  MacGlobalHotkeySettings,
  MacProductivitySettings,
} from "../../bindings";

type CommandResult<T> = Promise<{ status: "ok"; data: T } | { status: "error"; error: string }>;

const commandMocks = vi.hoisted(() => ({
  getApiKeyStatus: vi.fn(() => Promise.resolve({})),
  getMacProductivitySettings: vi.fn(() => Promise.resolve({
    external_editor: "Cursor",
    external_terminal: "Warp",
    global_hotkey: {
      enabled: false,
      shortcut: "CommandOrControl+Shift+Space",
    },
    status_item: {
      enabled: false,
    },
    notifications: {
      agent_finished: false,
      eval_finished: false,
      permission_required: false,
    },
  })),
  setExternalEditor: vi.fn((editor: string) => Promise.resolve({
    status: "ok" as const,
    data: {
      external_editor: editor || null,
      external_terminal: "Warp",
      global_hotkey: {
        enabled: false,
        shortcut: "CommandOrControl+Shift+Space",
      },
      status_item: {
        enabled: false,
      },
      notifications: {
        agent_finished: false,
        eval_finished: false,
        permission_required: false,
      },
    },
  })),
  setExternalTerminal: vi.fn((terminal: string) => Promise.resolve({
    status: "ok" as const,
    data: {
      external_editor: "Cursor",
      external_terminal: terminal || null,
      global_hotkey: {
        enabled: false,
        shortcut: "CommandOrControl+Shift+Space",
      },
      status_item: {
        enabled: false,
      },
      notifications: {
        agent_finished: false,
        eval_finished: false,
        permission_required: false,
      },
    },
  })),
  setMacGlobalHotkeySettings: vi.fn((global_hotkey: MacGlobalHotkeySettings): CommandResult<MacProductivitySettings> => Promise.resolve({
    status: "ok" as const,
    data: {
      external_editor: "Cursor",
      external_terminal: "Warp",
      global_hotkey,
      status_item: {
        enabled: false,
      },
      notifications: {
        agent_finished: false,
        eval_finished: false,
        permission_required: false,
      },
    },
  })),
  setMacNotificationSettings: vi.fn((notifications: {
    agent_finished: boolean;
    eval_finished: boolean;
    permission_required: boolean;
  }) => Promise.resolve({
    status: "ok" as const,
    data: {
      external_editor: "Cursor",
      external_terminal: "Warp",
      global_hotkey: {
        enabled: false,
        shortcut: "CommandOrControl+Shift+Space",
      },
      status_item: {
        enabled: false,
      },
      notifications,
    },
  })),
  setMacStatusItemSettings: vi.fn((status_item: {
    enabled: boolean;
  }) => Promise.resolve({
    status: "ok" as const,
    data: {
      external_editor: "Cursor",
      external_terminal: "Warp",
      global_hotkey: {
        enabled: false,
        shortcut: "CommandOrControl+Shift+Space",
      },
      status_item,
      notifications: {
        agent_finished: false,
        eval_finished: false,
        permission_required: false,
      },
    },
  })),
}));

const notificationMocks = vi.hoisted(() => ({
  getNotificationPermissionState: vi.fn(() => Promise.resolve("granted")),
  requestNotificationPermissionState: vi.fn(() => Promise.resolve("granted")),
  sendSettingsTestNotification: vi.fn(),
}));

vi.mock("../../bindings", () => ({
  commands: {
    getApiKeyStatus: commandMocks.getApiKeyStatus,
    getMacProductivitySettings: commandMocks.getMacProductivitySettings,
    setExternalEditor: commandMocks.setExternalEditor,
    setExternalTerminal: commandMocks.setExternalTerminal,
    setMacGlobalHotkeySettings: commandMocks.setMacGlobalHotkeySettings,
    setMacStatusItemSettings: commandMocks.setMacStatusItemSettings,
    setMacNotificationSettings: commandMocks.setMacNotificationSettings,
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    show: vi.fn(),
    unminimize: vi.fn(),
    setFocus: vi.fn(),
  }),
}));

vi.mock("@tauri-apps/plugin-global-shortcut", () => ({
  register: vi.fn(),
  unregister: vi.fn(),
}));

vi.mock("../../lib/notificationActions", () => ({
  getNotificationPermissionState: notificationMocks.getNotificationPermissionState,
  requestNotificationPermissionState: notificationMocks.requestNotificationPermissionState,
  sendSettingsTestNotification: notificationMocks.sendSettingsTestNotification,
}));

describe("SettingsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationMocks.getNotificationPermissionState.mockResolvedValue("granted");
    notificationMocks.requestNotificationPermissionState.mockResolvedValue("granted");
  });

  it("shows a compact macOS status summary", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "macOS" }));

    expect(await screen.findByText("Editor")).toBeTruthy();
    expect(screen.getAllByText("Cursor").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Terminal").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Warp").length).toBeGreaterThan(0);
    expect(screen.getByText("Global Hotkey")).toBeTruthy();
    expect(screen.getAllByText("Disabled").length).toBeGreaterThan(0);
    expect(screen.getByText("Menu Bar")).toBeTruthy();
    expect(screen.getByText("Hidden")).toBeTruthy();
    expect(screen.getByText("Granted")).toBeTruthy();
  });

  it("loads and saves the macOS external editor preference", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "macOS" }));

    const editorInput = await screen.findByPlaceholderText("Visual Studio Code, Cursor, Zed, or /usr/local/bin/code");
    expect((editorInput as HTMLInputElement).value).toBe("Cursor");

    await user.clear(editorInput);
    await user.type(editorInput, "Visual Studio Code");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(commandMocks.setExternalEditor).toHaveBeenCalledWith("Visual Studio Code");
    expect(await screen.findByText("External editor saved.")).toBeTruthy();
  });

  it("loads and saves the macOS external terminal preference", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "macOS" }));

    const terminalInput = await screen.findByPlaceholderText("Terminal, iTerm, Warp, or /Applications/Warp.app");
    expect((terminalInput as HTMLInputElement).value).toBe("Warp");

    await user.clear(terminalInput);
    await user.type(terminalInput, "Terminal");
    await user.click(screen.getByRole("button", { name: "Save Terminal" }));

    expect(commandMocks.setExternalTerminal).toHaveBeenCalledWith("Terminal");
    expect(await screen.findByText("External terminal saved.")).toBeTruthy();
  });

  it("saves macOS notification preferences", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "macOS" }));
    await user.click(await screen.findByRole("checkbox", { name: "Agent finished" }));

    expect(commandMocks.setMacNotificationSettings).toHaveBeenCalledWith({
      agent_finished: true,
      eval_finished: false,
      permission_required: false,
    });
    expect(await screen.findByText("Notification settings saved.")).toBeTruthy();
  });

  it("saves the opt-in macOS global hotkey preference", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "macOS" }));
    await user.click(await screen.findByRole("checkbox", { name: "Enable global hotkey" }));

    expect(commandMocks.setMacGlobalHotkeySettings).toHaveBeenCalledWith({
      enabled: true,
      shortcut: "CommandOrControl+Shift+Space",
    });
    expect(await screen.findByText("Global hotkey saved.")).toBeTruthy();

    const shortcutInput = screen.getByRole("textbox", { name: "Global hotkey shortcut" });
    await user.clear(shortcutInput);
    await user.type(shortcutInput, "CommandOrControl+Option+X");
    await user.click(screen.getByRole("button", { name: "Save Hotkey" }));

    expect(commandMocks.setMacGlobalHotkeySettings).toHaveBeenLastCalledWith({
      enabled: true,
      shortcut: "CommandOrControl+Option+X",
    });
  });

  it("shows recovery guidance when macOS rejects a global hotkey", async () => {
    commandMocks.setMacGlobalHotkeySettings.mockResolvedValueOnce({
      status: "error",
      error: "Global hotkey already registered by another app.",
    });
    const user = userEvent.setup();
    render(<SettingsDialog open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "macOS" }));
    await user.click(await screen.findByRole("checkbox", { name: "Enable global hotkey" }));

    expect(await screen.findByText("Global hotkey already registered by another app.")).toBeTruthy();
    expect(screen.getByText("Pick a different shortcut, save again, or disable the global hotkey if another Mac app owns it.")).toBeTruthy();
  });

  it("saves the opt-in macOS menu bar status item preference", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "macOS" }));
    await user.click(await screen.findByRole("checkbox", { name: "Show menu bar status item" }));

    expect(commandMocks.setMacStatusItemSettings).toHaveBeenCalledWith({
      enabled: true,
    });
    expect(await screen.findByText("Menu bar status item enabled.")).toBeTruthy();
  });

  it("shows recovery guidance when macOS notifications are blocked", async () => {
    notificationMocks.getNotificationPermissionState.mockResolvedValue("denied");
    notificationMocks.requestNotificationPermissionState.mockResolvedValue("denied");
    const user = userEvent.setup();
    render(<SettingsDialog open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "macOS" }));
    expect(await screen.findByText("Blocked")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Request Permission" }));

    expect(await screen.findByText("Notifications are blocked in macOS System Settings.")).toBeTruthy();
    expect(screen.getByText("Open macOS System Settings > Notifications and allow Xolotl Code, then return here and retry.")).toBeTruthy();
  });
});
