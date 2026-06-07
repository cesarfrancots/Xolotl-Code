import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandsPalette, SEED_COMPOSER_PROMPT_EVENT, buildClipboardPrompt } from "./CommandsPalette";
import { NATIVE_MENU_EVENT, type NativeMenuAction } from "../../lib/nativeMenu";
import { useProjectStore } from "../../stores/projectStore";

const pathActionMocks = vi.hoisted(() => ({
  copyTextToClipboard: vi.fn(() => Promise.resolve()),
  copyXolotlCodeOpenUrl: vi.fn(() => Promise.resolve()),
  openPathInExternalEditor: vi.fn(() => Promise.resolve()),
  quickLookPath: vi.fn(() => Promise.resolve()),
  readTextFromClipboard: vi.fn(() => Promise.resolve("const answer = 42;")),
  revealPathInFinder: vi.fn(() => Promise.resolve()),
}));
const terminalActionMocks = vi.hoisted(() => ({
  openTerminalAtPath: vi.fn(),
}));

vi.mock("../../lib/pathActions", async () => {
  const actual = await vi.importActual<typeof import("../../lib/pathActions")>("../../lib/pathActions");
  return {
    ...actual,
    copyTextToClipboard: pathActionMocks.copyTextToClipboard,
    copyXolotlCodeOpenUrl: pathActionMocks.copyXolotlCodeOpenUrl,
    openPathInExternalEditor: pathActionMocks.openPathInExternalEditor,
    quickLookPath: pathActionMocks.quickLookPath,
    readTextFromClipboard: pathActionMocks.readTextFromClipboard,
    revealPathInFinder: pathActionMocks.revealPathInFinder,
  };
});

vi.mock("../../lib/terminalActions", () => terminalActionMocks);

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
    expect(screen.getByText("Copy Active Project Xolotl Link")).toBeTruthy();
    expect(screen.getByText("Open Active Project in Editor")).toBeTruthy();
    expect(screen.getByText("Start Chat With Clipboard")).toBeTruthy();
    expect(screen.getByText("Explain Clipboard Snippet")).toBeTruthy();
    expect(screen.getByText("Open Recent: Xolotl")).toBeTruthy();
  });

  it("renders file-browser commands for the current folder and visible entries", () => {
    render(<CommandsPalette open onOpenChange={vi.fn()} />);

    expect(screen.getByText("File Browser")).toBeTruthy();
    expect(screen.getByText("Reveal Current Folder in Finder")).toBeTruthy();
    expect(screen.getByText("Copy Current Folder Xolotl Link")).toBeTruthy();
    expect(screen.getByText("New Terminal in Current Folder")).toBeTruthy();
    expect(screen.getByText("Copy Current Folder Relative Path")).toBeTruthy();
    expect(screen.getByText("Browse Parent Folder")).toBeTruthy();
    expect(screen.getByText("Back to Project Root")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Folder: src" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quick Look File: README.md" })).toBeTruthy();
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

  it("runs active project path actions from the palette", async () => {
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: /Copy Active Project Path/ }));

    await waitFor(() => {
      expect(pathActionMocks.copyTextToClipboard).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("copies active project Xolotl links from the palette", async () => {
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy Active Project Xolotl Link" }));

    await waitFor(() => {
      expect(pathActionMocks.copyXolotlCodeOpenUrl).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("runs active project editor actions from the palette", async () => {
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Open Active Project in Editor" }));

    await waitFor(() => {
      expect(pathActionMocks.openPathInExternalEditor).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("shows recovery guidance when an active project editor handoff fails", async () => {
    pathActionMocks.openPathInExternalEditor.mockRejectedValueOnce(new Error("No configured editor"));
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Open Active Project in Editor" }));

    expect(await screen.findByText("Open in editor failed.")).toBeTruthy();
    expect(screen.getByText(/Check the preferred editor in macOS Settings/)).toBeTruthy();
    expect(screen.getByText(/No configured editor/)).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("runs file-browser current folder path actions from the palette", async () => {
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy Current Folder Relative Path" }));

    await waitFor(() => {
      expect(pathActionMocks.copyTextToClipboard).toHaveBeenCalledWith("docs");
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("copies current folder Xolotl links from the palette", async () => {
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy Current Folder Xolotl Link" }));

    await waitFor(() => {
      expect(pathActionMocks.copyXolotlCodeOpenUrl).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl/docs");
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("runs file-browser row actions from the palette", async () => {
    const browse = vi.fn(() => Promise.resolve());
    const onOpenChange = vi.fn();
    useProjectStore.setState({ browse });
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Open Folder: src" }));
    expect(browse).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl/docs/src");
    expect(onOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "New terminal in src" }));
    expect(terminalActionMocks.openTerminalAtPath).toHaveBeenCalledWith(
      "/Users/cesar/Documents/Xolotl/docs/src",
      "src",
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy relative path for src" }));
    await waitFor(() => {
      expect(pathActionMocks.copyTextToClipboard).toHaveBeenCalledWith("docs/src");
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy Xolotl link for src" }));
    await waitFor(() => {
      expect(pathActionMocks.copyXolotlCodeOpenUrl).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl/docs/src");
    });

    fireEvent.click(screen.getByRole("button", { name: "Quick Look File: README.md" }));
    await waitFor(() => {
      expect(pathActionMocks.quickLookPath).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl/docs/README.md");
    });
  });

  it("shows recovery guidance when Quick Look fails", async () => {
    pathActionMocks.quickLookPath.mockRejectedValueOnce(new Error("Unsupported file"));
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Quick Look File: README.md" }));

    expect(await screen.findByText("Quick Look failed.")).toBeTruthy();
    expect(screen.getByText(/Check that the file still exists and can be previewed by Quick Look/)).toBeTruthy();
    expect(screen.getByText(/Unsupported file/)).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("opens a terminal from the current file browser folder", () => {
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "New Terminal in Current Folder" }));

    expect(terminalActionMocks.openTerminalAtPath).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl/docs");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("seeds clipboard prompts through the composer callback", async () => {
    const onUsePrompt = vi.fn();
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} onUsePrompt={onUsePrompt} />);

    fireEvent.click(screen.getByRole("button", { name: "Explain Clipboard Snippet" }));

    await waitFor(() => {
      expect(pathActionMocks.readTextFromClipboard).toHaveBeenCalled();
      expect(onUsePrompt).toHaveBeenCalledWith(expect.stringContaining("const answer = 42;"));
    });
    expect(onUsePrompt.mock.calls[0][0]).toContain("Explain this clipboard snippet clearly.");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("dispatches clipboard prompt events when no composer callback is provided", async () => {
    const events: string[] = [];
    const actions: NativeMenuAction[] = [];
    const onSeed = (event: Event) => {
      events.push((event as CustomEvent<{ prompt: string }>).detail.prompt);
    };
    const onAction = (event: Event) => actions.push((event as CustomEvent<NativeMenuAction>).detail);
    window.addEventListener(SEED_COMPOSER_PROMPT_EVENT, onSeed);
    window.addEventListener(NATIVE_MENU_EVENT, onAction);

    try {
      render(<CommandsPalette open onOpenChange={vi.fn()} />);

      fireEvent.click(screen.getByRole("button", { name: "Start Chat With Clipboard" }));

      await waitFor(() => {
        expect(events[0]).toContain("const answer = 42;");
      });
      expect(actions).toContain("tab-chat");
    } finally {
      window.removeEventListener(SEED_COMPOSER_PROMPT_EVENT, onSeed);
      window.removeEventListener(NATIVE_MENU_EVENT, onAction);
    }
  });

  it("can disable its global command shortcut for secondary palette instances", () => {
    const onOpenChange = vi.fn();
    render(<CommandsPalette open={false} onOpenChange={onOpenChange} enableGlobalShortcut={false} />);

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("buildClipboardPrompt", () => {
  it("formats empty and explain clipboard prompts", () => {
    expect(buildClipboardPrompt("chat", "   ")).toBe("The clipboard does not currently contain text.");
    expect(buildClipboardPrompt("explain", "const x = 1;")).toContain("Explain this clipboard snippet clearly.");
  });
});
