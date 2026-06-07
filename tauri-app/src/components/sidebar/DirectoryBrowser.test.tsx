import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DirectoryBrowser } from "./DirectoryBrowser";
import { copyPathContextHandoff, copyTextToClipboard, openPathInExternalTerminal, quickLookPath, revealPathInFinder } from "../../lib/pathActions";
import { useProjectStore } from "../../stores/projectStore";

const terminalActionMocks = vi.hoisted(() => ({
  openTerminalAtPath: vi.fn(),
}));

vi.mock("../../lib/pathActions", async () => {
  const actual = await vi.importActual<typeof import("../../lib/pathActions")>("../../lib/pathActions");
  return {
    ...actual,
    copyPathContextHandoff: vi.fn(() => Promise.resolve()),
    copyTextToClipboard: vi.fn(() => Promise.resolve()),
    openPathInExternalTerminal: vi.fn(() => Promise.resolve()),
    quickLookPath: vi.fn(() => Promise.resolve()),
    revealPathInFinder: vi.fn(() => Promise.resolve()),
  };
});

vi.mock("../../lib/terminalActions", () => terminalActionMocks);

describe("DirectoryBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({
      activeProjectPath: "/Users/cesar/Documents/Xolotl",
      browseLoading: false,
      browseError: null,
      browse: vi.fn(() => Promise.resolve()),
      refreshBrowse: vi.fn(() => Promise.resolve()),
      listing: {
        path: "/Users/cesar/Documents/Xolotl",
        parent: "/Users/cesar/Documents",
        children: [
          {
            name: "src",
            path: "/Users/cesar/Documents/Xolotl/src",
            is_dir: true,
            is_hidden: false,
            is_symlink: false,
            is_package: false,
            is_pdf: false,
          },
          {
            name: "README.md",
            path: "/Users/cesar/Documents/Xolotl/README.md",
            is_dir: false,
            is_hidden: false,
            is_symlink: false,
            is_package: false,
            is_pdf: false,
          },
          {
            name: ".env",
            path: "/Users/cesar/Documents/Xolotl/.env",
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

  it("renders compact file rows while preserving hidden toggle and path actions", () => {
    render(<DirectoryBrowser />);

    expect(screen.getByLabelText("2 visible items").textContent).toBe("2");
    expect(screen.queryByText(".env")).toBeNull();

    const hiddenToggle = screen.getByLabelText("Show hidden files");
    expect(hiddenToggle.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(hiddenToggle);

    expect(screen.getByText(".env")).toBeTruthy();
    expect(screen.getByLabelText("3 visible items").textContent).toBe("3");
    expect(hiddenToggle.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByLabelText("Copy relative path for README.md"));
    expect(copyTextToClipboard).toHaveBeenCalledWith("README.md");

    fireEvent.click(screen.getByLabelText("Copy context prompt for README.md"));
    expect(copyPathContextHandoff).toHaveBeenCalledWith(
      "/Users/cesar/Documents/Xolotl/README.md",
      { label: "README.md", kind: "File", relativePath: "README.md" },
    );

    fireEvent.click(screen.getByLabelText("Reveal src in Finder"));
    expect(revealPathInFinder).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl/src");

    fireEvent.click(screen.getByLabelText("Copy context prompt for src"));
    expect(copyPathContextHandoff).toHaveBeenCalledWith(
      "/Users/cesar/Documents/Xolotl/src",
      { label: "src", kind: "Folder", relativePath: "src" },
    );

    fireEvent.click(screen.getByLabelText("Copy current folder context prompt"));
    expect(copyPathContextHandoff).toHaveBeenCalledWith(
      "/Users/cesar/Documents/Xolotl",
      { label: "Xolotl", kind: "Folder", relativePath: "." },
    );

    fireEvent.click(screen.getByLabelText("Quick Look README.md"));
    expect(quickLookPath).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl/README.md");

    fireEvent.click(screen.getByLabelText("New terminal in current folder"));
    expect(terminalActionMocks.openTerminalAtPath).toHaveBeenCalledWith(
      "/Users/cesar/Documents/Xolotl",
      "Xolotl",
    );

    fireEvent.click(screen.getByLabelText("Open current folder in external terminal"));
    expect(openPathInExternalTerminal).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");

    fireEvent.click(screen.getByLabelText("New terminal in src"));
    expect(terminalActionMocks.openTerminalAtPath).toHaveBeenCalledWith(
      "/Users/cesar/Documents/Xolotl/src",
      "src",
    );

    fireEvent.click(screen.getByLabelText("Open src in external terminal"));
    expect(openPathInExternalTerminal).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl/src");
  });

  it("shows recovery guidance when revealing the current folder fails", async () => {
    vi.mocked(revealPathInFinder).mockRejectedValueOnce(new Error("Folder missing"));

    render(<DirectoryBrowser />);
    fireEvent.click(screen.getByLabelText("Reveal current folder in Finder"));

    expect(await screen.findByText("Reveal current folder in Finder failed.")).toBeTruthy();
    expect(screen.getByText(/Check that the folder still exists/)).toBeTruthy();
    expect(screen.getByText(/Folder missing/)).toBeTruthy();
  });

  it("shows recovery guidance when opening a folder in the external terminal fails", async () => {
    vi.mocked(openPathInExternalTerminal).mockRejectedValueOnce(new Error("Terminal missing"));

    render(<DirectoryBrowser />);
    fireEvent.click(screen.getByLabelText("Open src in external terminal"));

    expect(await screen.findByText("Open src in external terminal failed.")).toBeTruthy();
    expect(screen.getByText(/Check the preferred external terminal in macOS Settings/)).toBeTruthy();
    expect(screen.getByText(/Terminal missing/)).toBeTruthy();
  });

  it("shows macOS recovery guidance when folder browsing is blocked", () => {
    useProjectStore.setState({
      browseError: "Operation not permitted",
      listing: null,
    });

    render(<DirectoryBrowser />);

    expect(screen.getByText("Folder access blocked by macOS.")).toBeTruthy();
    expect(screen.getByText(/Privacy & Security/)).toBeTruthy();
    expect(screen.getByText(/Operation not permitted/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Dismiss file browser error"));

    expect(useProjectStore.getState().browseError).toBeNull();
  });

  it("shows stale-folder recovery when the browsed folder is missing", () => {
    useProjectStore.setState({
      browseError: "Not a directory: /Users/cesar/Documents/Moved",
      listing: null,
    });

    render(<DirectoryBrowser />);

    expect(screen.getByText("Folder unavailable.")).toBeTruthy();
    expect(screen.getByText(/Project root, Open Folder, or Refresh/)).toBeTruthy();
  });

  it("shows recovery guidance when Quick Look fails for a file", async () => {
    vi.mocked(quickLookPath).mockRejectedValueOnce(new Error("Preview blocked"));

    render(<DirectoryBrowser />);
    fireEvent.click(screen.getByLabelText("Quick Look README.md"));

    expect(await screen.findByText("Quick Look README.md failed.")).toBeTruthy();
    expect(screen.getByText(/can be previewed by Quick Look/)).toBeTruthy();
    expect(screen.getByText(/Preview blocked/)).toBeTruthy();
  });
});
