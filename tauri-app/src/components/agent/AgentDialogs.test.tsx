import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LaunchTeamDialog } from "./LaunchTeamDialog";
import { SpawnAgentDialog } from "./SpawnAgentDialog";

const commandMocks = vi.hoisted(() => ({
  listModels: vi.fn(() => Promise.resolve(["gpt-5"])),
  launchSwarm: vi.fn(),
  launchTeam: vi.fn(),
  spawnAgent: vi.fn(),
}));

vi.mock("../../bindings", () => ({
  commands: commandMocks,
}));

describe("agent dialogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commandMocks.listModels.mockReturnValue(new Promise<string[]>(() => {}));
  });

  afterEach(() => {
    cleanup();
  });

  it("uses the shared Mac dialog surface for spawning agents and closes with Cmd+W", () => {
    const onOpenChange = vi.fn();
    render(<SpawnAgentDialog open onOpenChange={onOpenChange} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog.classList.contains("xolotl-mac-dialog")).toBe(true);
    expect(screen.getByRole("heading", { name: "Spawn Agent" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "w", metaKey: true });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("uses the shared Mac dialog surface for launching teams and closes with Cmd+W", () => {
    const onOpenChange = vi.fn();
    render(<LaunchTeamDialog open onOpenChange={onOpenChange} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog.classList.contains("xolotl-mac-dialog")).toBe(true);
    expect(screen.getByRole("heading", { name: "Launch Team" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "w", metaKey: true });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
