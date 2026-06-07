import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectsSection } from "./ProjectsSection";
import { copyTextToClipboard, copyXolotlCodeOpenUrl, openPathInExternalEditor } from "../../lib/pathActions";
import { useProjectStore } from "../../stores/projectStore";

vi.mock("../../lib/pathActions", async () => {
  const actual = await vi.importActual<typeof import("../../lib/pathActions")>("../../lib/pathActions");
  return {
    ...actual,
    copyTextToClipboard: vi.fn(() => Promise.resolve()),
    copyXolotlCodeOpenUrl: vi.fn(() => Promise.resolve()),
    openPathInExternalEditor: vi.fn(() => Promise.resolve()),
    revealPathInFinder: vi.fn(() => Promise.resolve()),
  };
});

describe("ProjectsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({
      projects: [
        { name: "Xolotl", path: "/Users/cesar/Documents/Xolotl", added_at: 1, last_opened_at: 10 },
        { name: "Pivot app", path: "/Users/cesar/Documents/Pivot app", added_at: 2, last_opened_at: 5 },
      ],
      activeProjectPath: "/Users/cesar/Documents/Xolotl",
      loading: false,
      error: null,
      openFolderDialog: vi.fn(() => Promise.resolve()),
      removeProject: vi.fn(() => Promise.resolve()),
    });
  });

  it("renders compact Mac project rows with count, active state, and path actions", () => {
    const onOpenProject = vi.fn();
    render(<ProjectsSection onOpenProject={onOpenProject} />);

    expect(screen.getByLabelText("2 saved projects").textContent).toBe("2");

    const activeProject = screen.getByRole("button", { name: "Open project Xolotl" });
    expect(activeProject.getAttribute("aria-current")).toBe("true");
    expect(activeProject.classList.contains("xolotl-project-row-active")).toBe(true);

    fireEvent.keyDown(activeProject, { key: " " });
    expect(onOpenProject).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");

    fireEvent.click(screen.getByLabelText("Copy POSIX path for Xolotl"));
    expect(copyTextToClipboard).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
    expect(onOpenProject).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("Copy Xolotl link for Xolotl"));
    expect(copyXolotlCodeOpenUrl).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
    expect(onOpenProject).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("Open Xolotl in external editor"));
    expect(openPathInExternalEditor).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
    expect(onOpenProject).toHaveBeenCalledTimes(1);
  });
});
