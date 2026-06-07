import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandsPalette, SEED_COMPOSER_PROMPT_EVENT, buildClipboardPrompt } from "./CommandsPalette";
import { NATIVE_MENU_EVENT, type NativeMenuAction } from "../../lib/nativeMenu";
import { useProjectStore } from "../../stores/projectStore";

const pathActionMocks = vi.hoisted(() => ({
  copyPathAutomationHandoff: vi.fn(() => Promise.resolve()),
  copyPathContextHandoff: vi.fn(() => Promise.resolve()),
  copyProjectAutomationHandoff: vi.fn(() => Promise.resolve()),
  copyProjectContextHandoff: vi.fn(() => Promise.resolve()),
  copyTextToClipboard: vi.fn(() => Promise.resolve()),
  copyXolotlCodeOpenShellCommand: vi.fn(() => Promise.resolve()),
  copyXolotlCodeOpenUrl: vi.fn(() => Promise.resolve()),
  openPathInExternalEditor: vi.fn(() => Promise.resolve()),
  openPathInExternalTerminal: vi.fn(() => Promise.resolve()),
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
    copyPathAutomationHandoff: pathActionMocks.copyPathAutomationHandoff,
    copyPathContextHandoff: pathActionMocks.copyPathContextHandoff,
    copyProjectAutomationHandoff: pathActionMocks.copyProjectAutomationHandoff,
    copyProjectContextHandoff: pathActionMocks.copyProjectContextHandoff,
    copyTextToClipboard: pathActionMocks.copyTextToClipboard,
    copyXolotlCodeOpenShellCommand: pathActionMocks.copyXolotlCodeOpenShellCommand,
    copyXolotlCodeOpenUrl: pathActionMocks.copyXolotlCodeOpenUrl,
    openPathInExternalEditor: pathActionMocks.openPathInExternalEditor,
    openPathInExternalTerminal: pathActionMocks.openPathInExternalTerminal,
    quickLookPath: pathActionMocks.quickLookPath,
    readTextFromClipboard: pathActionMocks.readTextFromClipboard,
    revealPathInFinder: pathActionMocks.revealPathInFinder,
  };
});

vi.mock("../../lib/terminalActions", () => terminalActionMocks);

const projectStoreActions = {
  browse: useProjectStore.getState().browse,
  clearRecentBrowserFolders: useProjectStore.getState().clearRecentBrowserFolders,
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
      recentBrowserFolders: [
        "/Users/cesar/Documents/Xolotl/examples",
        "/Users/cesar/Documents/Xolotl/docs/src",
        "/Users/cesar/Documents/Xolotl/docs",
        "/Users/cesar/Documents/Other",
      ],
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

    expect(screen.getByRole("dialog").classList.contains("xolotl-command-palette")).toBe(true);
    expect(screen.getAllByText("⌘K").length).toBeGreaterThan(0);
    expect(screen.getByText("⌘N")).toBeTruthy();
    expect(screen.getByText("⌘T")).toBeTruthy();
    expect(screen.getByText("Reveal Active Project in Finder")).toBeTruthy();
    expect(screen.getByText("New Terminal in Active Project")).toBeTruthy();
    expect(screen.getByText("Copy Active Project Path")).toBeTruthy();
    expect(screen.getByText("Copy Active Project Xolotl Link")).toBeTruthy();
    expect(screen.getByText("Copy Active Project Shell Open Command")).toBeTruthy();
    expect(screen.getByText("Copy Active Project Context Prompt")).toBeTruthy();
    expect(screen.getByText("Copy Active Project Shortcuts JSON")).toBeTruthy();
    expect(screen.getByText("Open Active Project in Editor")).toBeTruthy();
    expect(screen.getByText("Open Active Project in External Terminal")).toBeTruthy();
    expect(screen.getByText("Start Chat With Clipboard")).toBeTruthy();
    expect(screen.getByText("Explain Clipboard Snippet")).toBeTruthy();
    expect(screen.getByText("Open Recent: Xolotl")).toBeTruthy();
    expect(screen.getByLabelText("Open recent project Xolotl in editor")).toBeTruthy();
    expect(screen.getByLabelText("Open recent project Xolotl in external terminal")).toBeTruthy();
    expect(screen.getByLabelText("Copy context prompt for recent project Xolotl")).toBeTruthy();
    expect(screen.getByLabelText("Copy Shortcuts JSON for recent project Xolotl")).toBeTruthy();
  });

  it("renders file-browser commands for the current folder and visible entries", () => {
    render(<CommandsPalette open onOpenChange={vi.fn()} />);

    expect(screen.getByText("File Browser")).toBeTruthy();
    expect(screen.getByText("Reveal Current Folder in Finder")).toBeTruthy();
    expect(screen.getByText("Open Current Folder in Editor")).toBeTruthy();
    expect(screen.getByText("Copy Current Folder Xolotl Link")).toBeTruthy();
    expect(screen.getByText("Copy Current Folder Shell Open Command")).toBeTruthy();
    expect(screen.getByText("Copy Current Folder Context Prompt")).toBeTruthy();
    expect(screen.getByText("Copy Current Folder Shortcuts JSON")).toBeTruthy();
    expect(screen.getByText("New Terminal in Current Folder")).toBeTruthy();
    expect(screen.getByText("Open Current Folder in External Terminal")).toBeTruthy();
    expect(screen.getByText("Copy Current Folder Relative Path")).toBeTruthy();
    expect(screen.getByText("Browse Parent Folder")).toBeTruthy();
    expect(screen.getByText("Back to Project Root")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Browse Recent Folder: examples" })).toBeTruthy();
    expect(screen.getByLabelText("Copy Shortcuts JSON for recent folder examples")).toBeTruthy();
    expect(screen.queryByText("Browse Recent Folder: src")).toBeNull();
    expect(screen.queryByText("Browse Recent Folder: Other")).toBeNull();
    expect(screen.getByRole("button", { name: "Clear Recent File Browser Folders" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Folder: src" })).toBeTruthy();
    expect(screen.getByLabelText("Open src in editor")).toBeTruthy();
    expect(screen.getByLabelText("Copy Shortcuts JSON for src")).toBeTruthy();
    expect(screen.getByLabelText("Open README.md in editor")).toBeTruthy();
    expect(screen.getByLabelText("Copy Shortcuts JSON for README.md")).toBeTruthy();
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

  it("opens an embedded terminal from the active project command", () => {
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "New Terminal in Active Project" }));

    expect(terminalActionMocks.openTerminalAtPath).toHaveBeenCalledWith(
      "/Users/cesar/Documents/Xolotl",
      "Xolotl",
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("runs recent project secondary handoff actions from the palette", async () => {
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByLabelText("Reveal recent project Xolotl in Finder"));
    await waitFor(() => {
      expect(pathActionMocks.revealPathInFinder).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
    });

    fireEvent.click(screen.getByLabelText("New terminal in recent project Xolotl"));
    expect(terminalActionMocks.openTerminalAtPath).toHaveBeenCalledWith(
      "/Users/cesar/Documents/Xolotl",
      "Xolotl",
    );

    fireEvent.click(screen.getByLabelText("Open recent project Xolotl in editor"));
    await waitFor(() => {
      expect(pathActionMocks.openPathInExternalEditor).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
    });

    fireEvent.click(screen.getByLabelText("Open recent project Xolotl in external terminal"));
    await waitFor(() => {
      expect(pathActionMocks.openPathInExternalTerminal).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
    });

    fireEvent.click(screen.getByLabelText("Copy POSIX path for recent project Xolotl"));
    await waitFor(() => {
      expect(pathActionMocks.copyTextToClipboard).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
    });

    fireEvent.click(screen.getByLabelText("Copy Xolotl link for recent project Xolotl"));
    await waitFor(() => {
      expect(pathActionMocks.copyXolotlCodeOpenUrl).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
    });

    fireEvent.click(screen.getByLabelText("Copy shell open command for recent project Xolotl"));
    await waitFor(() => {
      expect(pathActionMocks.copyXolotlCodeOpenShellCommand).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
    });

    fireEvent.click(screen.getByLabelText("Copy context prompt for recent project Xolotl"));
    await waitFor(() => {
      expect(pathActionMocks.copyProjectContextHandoff).toHaveBeenCalledWith(
        "/Users/cesar/Documents/Xolotl",
        "Xolotl",
      );
    });

    fireEvent.click(screen.getByLabelText("Copy Shortcuts JSON for recent project Xolotl"));
    await waitFor(() => {
      expect(pathActionMocks.copyProjectAutomationHandoff).toHaveBeenCalledWith(
        "/Users/cesar/Documents/Xolotl",
        "Xolotl",
      );
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

  it("copies active project shell open commands from the palette", async () => {
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy Active Project Shell Open Command" }));

    await waitFor(() => {
      expect(pathActionMocks.copyXolotlCodeOpenShellCommand).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("copies active project context prompts from the palette", async () => {
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy Active Project Context Prompt" }));

    await waitFor(() => {
      expect(pathActionMocks.copyProjectContextHandoff).toHaveBeenCalledWith(
        "/Users/cesar/Documents/Xolotl",
        "Xolotl",
      );
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("copies active project Shortcuts JSON from the palette", async () => {
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy Active Project Shortcuts JSON" }));

    await waitFor(() => {
      expect(pathActionMocks.copyProjectAutomationHandoff).toHaveBeenCalledWith(
        "/Users/cesar/Documents/Xolotl",
        "Xolotl",
      );
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

  it("runs active project external terminal actions from the palette", async () => {
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Open Active Project in External Terminal" }));

    await waitFor(() => {
      expect(pathActionMocks.openPathInExternalTerminal).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("shows recovery guidance when an active project external terminal handoff fails", async () => {
    pathActionMocks.openPathInExternalTerminal.mockRejectedValueOnce(new Error("Terminal missing"));
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Open Active Project in External Terminal" }));

    expect(await screen.findByText("Open in external terminal failed.")).toBeTruthy();
    expect(screen.getByText(/Check the preferred external terminal in macOS Settings/)).toBeTruthy();
    expect(screen.getByText(/Terminal missing/)).toBeTruthy();
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

  it("copies current folder shell open commands from the palette", async () => {
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy Current Folder Shell Open Command" }));

    await waitFor(() => {
      expect(pathActionMocks.copyXolotlCodeOpenShellCommand).toHaveBeenCalledWith(
        "/Users/cesar/Documents/Xolotl/docs",
      );
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("copies current folder context prompts from the palette", async () => {
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy Current Folder Context Prompt" }));

    await waitFor(() => {
      expect(pathActionMocks.copyPathContextHandoff).toHaveBeenCalledWith(
        "/Users/cesar/Documents/Xolotl/docs",
        { kind: "Folder", relativePath: "docs" },
      );
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("copies current folder Shortcuts JSON from the palette", async () => {
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy Current Folder Shortcuts JSON" }));

    await waitFor(() => {
      expect(pathActionMocks.copyPathAutomationHandoff).toHaveBeenCalledWith(
        "/Users/cesar/Documents/Xolotl/docs",
        { kind: "Folder", relativePath: "docs" },
      );
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

    fireEvent.click(screen.getByRole("button", { name: "Open src in editor" }));
    await waitFor(() => {
      expect(pathActionMocks.openPathInExternalEditor).toHaveBeenCalledWith(
        "/Users/cesar/Documents/Xolotl/docs/src",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy relative path for src" }));
    await waitFor(() => {
      expect(pathActionMocks.copyTextToClipboard).toHaveBeenCalledWith("docs/src");
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy Xolotl link for src" }));
    await waitFor(() => {
      expect(pathActionMocks.copyXolotlCodeOpenUrl).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl/docs/src");
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy shell open command for src" }));
    await waitFor(() => {
      expect(pathActionMocks.copyXolotlCodeOpenShellCommand).toHaveBeenCalledWith(
        "/Users/cesar/Documents/Xolotl/docs/src",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy context prompt for src" }));
    await waitFor(() => {
      expect(pathActionMocks.copyPathContextHandoff).toHaveBeenCalledWith(
        "/Users/cesar/Documents/Xolotl/docs/src",
        { label: "src", kind: "Folder", relativePath: "docs/src" },
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy Shortcuts JSON for src" }));
    await waitFor(() => {
      expect(pathActionMocks.copyPathAutomationHandoff).toHaveBeenCalledWith(
        "/Users/cesar/Documents/Xolotl/docs/src",
        { label: "src", kind: "Folder", relativePath: "docs/src" },
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy context prompt for README.md" }));
    await waitFor(() => {
      expect(pathActionMocks.copyPathContextHandoff).toHaveBeenCalledWith(
        "/Users/cesar/Documents/Xolotl/docs/README.md",
        { label: "README.md", kind: "File", relativePath: "docs/README.md" },
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy Shortcuts JSON for README.md" }));
    await waitFor(() => {
      expect(pathActionMocks.copyPathAutomationHandoff).toHaveBeenCalledWith(
        "/Users/cesar/Documents/Xolotl/docs/README.md",
        { label: "README.md", kind: "File", relativePath: "docs/README.md" },
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Open README.md in editor" }));
    await waitFor(() => {
      expect(pathActionMocks.openPathInExternalEditor).toHaveBeenCalledWith(
        "/Users/cesar/Documents/Xolotl/docs/README.md",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Quick Look File: README.md" }));
    await waitFor(() => {
      expect(pathActionMocks.quickLookPath).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl/docs/README.md");
    });
  });

  it("runs recent file-browser folder commands from the palette", async () => {
    const browse = vi.fn(() => Promise.resolve());
    const onOpenChange = vi.fn();
    useProjectStore.setState({ browse });
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Browse Recent Folder: examples" }));
    expect(browse).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl/examples");
    expect(onOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "New terminal in recent folder examples" }));
    expect(terminalActionMocks.openTerminalAtPath).toHaveBeenCalledWith(
      "/Users/cesar/Documents/Xolotl/examples",
      "examples",
    );

    fireEvent.click(screen.getByRole("button", { name: "Open recent folder examples in external terminal" }));
    await waitFor(() => {
      expect(pathActionMocks.openPathInExternalTerminal).toHaveBeenCalledWith(
        "/Users/cesar/Documents/Xolotl/examples",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Open recent folder examples in editor" }));
    await waitFor(() => {
      expect(pathActionMocks.openPathInExternalEditor).toHaveBeenCalledWith(
        "/Users/cesar/Documents/Xolotl/examples",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Reveal recent folder examples in Finder" }));
    await waitFor(() => {
      expect(pathActionMocks.revealPathInFinder).toHaveBeenCalledWith(
        "/Users/cesar/Documents/Xolotl/examples",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy POSIX path for recent folder examples" }));
    await waitFor(() => {
      expect(pathActionMocks.copyTextToClipboard).toHaveBeenCalledWith(
        "/Users/cesar/Documents/Xolotl/examples",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy Xolotl link for recent folder examples" }));
    await waitFor(() => {
      expect(pathActionMocks.copyXolotlCodeOpenUrl).toHaveBeenCalledWith(
        "/Users/cesar/Documents/Xolotl/examples",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy shell open command for recent folder examples" }));
    await waitFor(() => {
      expect(pathActionMocks.copyXolotlCodeOpenShellCommand).toHaveBeenCalledWith(
        "/Users/cesar/Documents/Xolotl/examples",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy context prompt for recent folder examples" }));
    await waitFor(() => {
      expect(pathActionMocks.copyPathContextHandoff).toHaveBeenCalledWith(
        "/Users/cesar/Documents/Xolotl/examples",
        { label: "examples", kind: "Folder", relativePath: "examples" },
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy Shortcuts JSON for recent folder examples" }));
    await waitFor(() => {
      expect(pathActionMocks.copyPathAutomationHandoff).toHaveBeenCalledWith(
        "/Users/cesar/Documents/Xolotl/examples",
        { label: "examples", kind: "Folder", relativePath: "examples" },
      );
    });
  });

  it("clears recent file-browser folders for the active project from the palette", () => {
    const clearRecentBrowserFolders = vi.fn();
    const onOpenChange = vi.fn();
    useProjectStore.setState({ clearRecentBrowserFolders });
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Clear Recent File Browser Folders" }));

    expect(clearRecentBrowserFolders).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
    expect(onOpenChange).toHaveBeenCalledWith(false);
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

  it("opens the current file browser folder in the external terminal", async () => {
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Open Current Folder in External Terminal" }));

    await waitFor(() => {
      expect(pathActionMocks.openPathInExternalTerminal).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl/docs");
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("opens the current file browser folder in the external editor", async () => {
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Open Current Folder in Editor" }));

    await waitFor(() => {
      expect(pathActionMocks.openPathInExternalEditor).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl/docs");
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("shows recovery guidance when a file-browser editor handoff fails", async () => {
    pathActionMocks.openPathInExternalEditor.mockRejectedValueOnce(new Error("Zed missing"));
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Open README.md in editor" }));

    expect(await screen.findByText("Open in editor failed.")).toBeTruthy();
    expect(screen.getByText(/Check the preferred editor in macOS Settings/)).toBeTruthy();
    expect(screen.getByText(/Zed missing/)).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("opens a file-browser folder row in the external terminal", async () => {
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Open src in external terminal" }));

    await waitFor(() => {
      expect(pathActionMocks.openPathInExternalTerminal).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl/docs/src");
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
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

  it("closes with Cmd+W while the palette is open", () => {
    const onOpenChange = vi.fn();
    render(<CommandsPalette open onOpenChange={onOpenChange} />);

    fireEvent.keyDown(window, { key: "w", metaKey: true });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("buildClipboardPrompt", () => {
  it("formats empty and explain clipboard prompts", () => {
    expect(buildClipboardPrompt("chat", "   ")).toBe("The clipboard does not currently contain text.");
    expect(buildClipboardPrompt("explain", "const x = 1;")).toContain("Explain this clipboard snippet clearly.");
  });
});
