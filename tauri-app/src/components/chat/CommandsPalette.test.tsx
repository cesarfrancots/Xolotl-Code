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

const projectStoreActions = {
  browse: useProjectStore.getState().browse,
  refreshBrowse: useProjectStore.getState().refreshBrowse,
  setActiveProject: useProjectStore.getState().setActiveProject,
};

describe("CommandsPalette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({
      ...projectStoreActions,
      projects: [
        { name: "Xolotl", path: "/Users/cesar/Documents/Xolotl", added_at: 1, last_opened_at: 10 },
      ],
      activeProjectPath: "/Users/cesar/Documents/Xolotl",
      listing: {
        path: "/Users/cesar/Documents/Xolotl/docs",
        parent: "/Users/cesar/Documents/Xolotl",
        children: [
          {
            name: "src",
            path: "/Users/cesar/Documents/Xolotl/docs/src",
            is_dir: true,
            is_hidden: false,
            is_symlink: false,
            is_package: false,
            is_pdf: false,
          },
          {
            name: "README.md",
            path: "/Users/cesar/Documents/Xolotl/docs/README.md",
            is_dir: false,
            is_hidden: false,
            is_symlink: false,
            is_package: false,
            is_pdf: false,
          },
          {
            name: "Manual.pdf",
            path: "/Users/cesar/Documents/Xolotl/docs/Manual.pdf",
            is_dir: false,
            is_hidden: false,
            is_symlink: false,
            is_package: false,
            is_pdf: true,
          },
          {
            name: ".env",
            path: "/Users/cesar/Documents/Xolotl/docs/.env",
            is_dir: false,
            is_hidden: true,
            is_symlink: false,
            is_package: false,
            is_pdf: false,
          },
        ],
      },
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

  it("renders file-browser commands for the current folder and visible entries", () => {
    render(<CommandsPalette open onOpenChange={vi.fn()} />);

    expect(screen.getByText("File Browser")).toBeTruthy();
    expect(screen.getByText("Reveal Current Folder in Finder")).toBeTruthy();
    expect(screen.getByText("Copy Current Folder Relative Path")).toBeTruthy();
    expect(screen.getByText("Browse Parent Folder")).toBeTruthy();
    expect(screen.getByText("Back to Project Root")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Folder: src" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reveal File: README.md" })).toBeTruthy();
    expect(screen.getByText("PDF")).toBeTruthy();
    expect(screen.queryByText(".env")).toBeNull();
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

  it("runs file-browser current folder path actions from the palette", () => {
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy Current Folder Relative Path" }));

    expect(pathActionMocks.copyTextToClipboard).toHaveBeenCalledWith("docs");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("runs file-browser row actions from the palette", () => {
    const browse = vi.fn(() => Promise.resolve());
    const onOpenChange = vi.fn();
    useProjectStore.setState({ browse });
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Open Folder: src" }));
    expect(browse).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl/docs/src");
    expect(onOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "Copy relative path for src" }));
    expect(pathActionMocks.copyTextToClipboard).toHaveBeenCalledWith("docs/src");
  });

  it("can disable its global command shortcut for secondary palette instances", () => {
    const onOpenChange = vi.fn();
    render(<CommandsPalette open={false} onOpenChange={onOpenChange} enableGlobalShortcut={false} />);

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
