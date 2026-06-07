import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DirectoryBrowser } from "./DirectoryBrowser";
import { copyTextToClipboard, revealPathInFinder } from "../../lib/pathActions";
import { useProjectStore } from "../../stores/projectStore";

vi.mock("../../lib/pathActions", async () => {
  const actual = await vi.importActual<typeof import("../../lib/pathActions")>("../../lib/pathActions");
  return {
    ...actual,
    copyTextToClipboard: vi.fn(() => Promise.resolve()),
    revealPathInFinder: vi.fn(() => Promise.resolve()),
  };
});

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

    fireEvent.click(screen.getByLabelText("Reveal src in Finder"));
    expect(revealPathInFinder).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl/src");
  });
});
