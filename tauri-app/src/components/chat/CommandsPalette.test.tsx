import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandsPalette } from "./CommandsPalette";
import { NATIVE_MENU_EVENT, type NativeMenuAction } from "../../lib/nativeMenu";
import { useProjectStore } from "../../stores/projectStore";

const pathActionMocks = vi.hoisted(() => ({
  copyTextToClipboard: vi.fn(() => Promise.resolve()),
  revealPathInFinder: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../lib/pathActions", async () => {
  const actual = await vi.importActual<typeof import("../../lib/pathActions")>("../../lib/pathActions");
  return {
    ...actual,
    copyTextToClipboard: pathActionMocks.copyTextToClipboard,
    revealPathInFinder: pathActionMocks.revealPathInFinder,
  };
});

describe("CommandsPalette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({
      projects: [
        { name: "Xolotl", path: "/Users/cesar/Documents/Xolotl", added_at: 1, last_opened_at: 10 },
      ],
      activeProjectPath: "/Users/cesar/Documents/Xolotl",
    });
  });

  it("renders Mac shortcut symbols and project-aware commands", () => {
    render(<CommandsPalette open onOpenChange={vi.fn()} />);

    expect(screen.getAllByText("⌘K").length).toBeGreaterThan(0);
    expect(screen.getByText("⌘N")).toBeTruthy();
    expect(screen.getByText("⌘T")).toBeTruthy();
    expect(screen.getByText("Reveal Active Project in Finder")).toBeTruthy();
    expect(screen.getByText("Copy Active Project Path")).toBeTruthy();
    expect(screen.getByText("Open Recent: Xolotl")).toBeTruthy();
  });

  it("dispatches native menu actions from actionable command rows", () => {
    const onOpenChange = vi.fn();
    const actions: NativeMenuAction[] = [];
    const onAction = (event: Event) => actions.push((event as CustomEvent<NativeMenuAction>).detail);
    window.addEventListener(NATIVE_MENU_EVENT, onAction);

    try {
      render(<CommandsPalette open onOpenChange={onOpenChange} />);

      fireEvent.click(screen.getByRole("button", { name: /Toggle Terminal/ }));

      expect(actions).toContain("toggle-terminal");
      expect(onOpenChange).toHaveBeenCalledWith(false);
    } finally {
      window.removeEventListener(NATIVE_MENU_EVENT, onAction);
    }
  });

  it("runs active project path actions from the palette", () => {
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: /Copy Active Project Path/ }));

    expect(pathActionMocks.copyTextToClipboard).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("can disable its global command shortcut for secondary palette instances", () => {
    const onOpenChange = vi.fn();
    render(<CommandsPalette open={false} onOpenChange={onOpenChange} enableGlobalShortcut={false} />);

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
