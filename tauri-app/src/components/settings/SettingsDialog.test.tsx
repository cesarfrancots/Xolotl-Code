import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "./SettingsDialog";

const commandMocks = vi.hoisted(() => ({
  getApiKeyStatus: vi.fn(() => Promise.resolve({})),
  getMacProductivitySettings: vi.fn(() => Promise.resolve({ external_editor: "Cursor" })),
  setExternalEditor: vi.fn((editor: string) => Promise.resolve({
    status: "ok" as const,
    data: { external_editor: editor || null },
  })),
}));

vi.mock("../../bindings", () => ({
  commands: {
    getApiKeyStatus: commandMocks.getApiKeyStatus,
    getMacProductivitySettings: commandMocks.getMacProductivitySettings,
    setExternalEditor: commandMocks.setExternalEditor,
  },
}));

describe("SettingsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
