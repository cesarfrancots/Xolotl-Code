import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectsSection } from "./ProjectsSection";
import { copyProjectContextHandoff, copyTextToClipboard, copyXolotlCodeOpenShellCommand, copyXolotlCodeOpenUrl, openPathInExternalEditor, openPathInExternalTerminal, revealPathInFinder } from "../../lib/pathActions";
import { useProjectStore } from "../../stores/projectStore";

vi.mock("../../lib/pathActions", async () => {
  const actual = await vi.importActual<typeof import("../../lib/pathActions")>("../../lib/pathActions");
  return {
    ...actual,
    copyProjectContextHandoff: vi.fn(() => Promise.resolve()),
    copyTextToClipboard: vi.fn(() => Promise.resolve()),
    copyXolotlCodeOpenShellCommand: vi.fn(() => Promise.resolve()),
    copyXolotlCodeOpenUrl: vi.fn(() => Promise.resolve()),
    openPathInExternalEditor: vi.fn(() => Promise.resolve()),
    openPathInExternalTerminal: vi.fn(() => Promise.resolve()),
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

    fireEvent.click(screen.getByLabelText("Copy shell open command for Xolotl"));
    expect(copyXolotlCodeOpenShellCommand).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
    expect(onOpenProject).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("Copy context prompt for Xolotl"));
    expect(copyProjectContextHandoff).toHaveBeenCalledWith(
      "/Users/cesar/Documents/Xolotl",
      "Xolotl",
    );
    expect(onOpenProject).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("Open Xolotl in external editor"));
    expect(openPathInExternalEditor).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
    expect(onOpenProject).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("Open Xolotl in external terminal"));
    expect(openPathInExternalTerminal).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
    expect(onOpenProject).toHaveBeenCalledTimes(1);
  });

  it("shows recovery guidance when revealing a project fails", async () => {
    vi.mocked(revealPathInFinder).mockRejectedValueOnce(new Error("Project folder missing"));
    const onOpenProject = vi.fn();

    render(<ProjectsSection onOpenProject={onOpenProject} />);
    fireEvent.click(screen.getByLabelText("Reveal Xolotl in Finder"));

    expect(await screen.findByText("Reveal Xolotl in Finder failed.")).toBeTruthy();
    expect(screen.getByText(/Check that the project folder still exists/)).toBeTruthy();
    expect(screen.getByText(/Project folder missing/)).toBeTruthy();
    expect(onOpenProject).not.toHaveBeenCalled();
  });

  it("shows and dismisses project-open recovery from the project store", async () => {
    const onOpenProject = vi.fn();
    useProjectStore.setState({ error: "Folder is not accessible" });

    render(<ProjectsSection onOpenProject={onOpenProject} />);

    expect(screen.getByText("Could not open project folder.")).toBeTruthy();
    expect(screen.getByText(/Check that the folder still exists/)).toBeTruthy();
    expect(screen.getByText(/Folder is not accessible/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Dismiss project open error"));

    expect(useProjectStore.getState().error).toBeNull();
  });

  it("shows macOS permission recovery for blocked project folders", () => {
    const onOpenProject = vi.fn();
    useProjectStore.setState({ error: "Permission denied" });

    render(<ProjectsSection onOpenProject={onOpenProject} />);

    expect(screen.getByText("Folder access blocked by macOS.")).toBeTruthy();
    expect(screen.getByText(/Privacy & Security/)).toBeTruthy();
    expect(screen.getByText(/Permission denied/)).toBeTruthy();
  });

  it("uses specific recovery copy when drag and drop setup fails", () => {
    const onOpenProject = vi.fn();
    useProjectStore.setState({ error: "Project drag and drop unavailable. Listener missing" });

    render(<ProjectsSection onOpenProject={onOpenProject} />);

    expect(screen.getByText("Project drag and drop unavailable.")).toBeTruthy();
    expect(screen.getByText(/Restart Xolotl Code and try dragging the folder again/)).toBeTruthy();
  });

  it("uses specific recovery copy when the last active project cannot be restored", () => {
    const onOpenProject = vi.fn();
    useProjectStore.setState({ error: "Could not restore last active project. Not a directory: /Users/cesar/Documents/Moved" });

    render(<ProjectsSection onOpenProject={onOpenProject} />);

    expect(screen.getByText("Could not restore last active project.")).toBeTruthy();
    expect(screen.getByText(/Use Open Folder or choose another recent project/)).toBeTruthy();
    expect(screen.getByText(/Not a directory/)).toBeTruthy();
  });

  it("shows recovery guidance when the external editor handoff fails", async () => {
    vi.mocked(openPathInExternalEditor).mockRejectedValueOnce(new Error("Cursor missing"));
    const onOpenProject = vi.fn();

    render(<ProjectsSection onOpenProject={onOpenProject} />);
    fireEvent.click(screen.getByLabelText("Open Xolotl in external editor"));

    expect(await screen.findByText("Open Xolotl in external editor failed.")).toBeTruthy();
    expect(screen.getByText(/Check the preferred editor in macOS Settings/)).toBeTruthy();
    expect(screen.getByText(/Cursor missing/)).toBeTruthy();
    expect(onOpenProject).not.toHaveBeenCalled();
  });

  it("shows recovery guidance when the external terminal handoff fails", async () => {
    vi.mocked(openPathInExternalTerminal).mockRejectedValueOnce(new Error("Terminal missing"));
    const onOpenProject = vi.fn();

    render(<ProjectsSection onOpenProject={onOpenProject} />);
    fireEvent.click(screen.getByLabelText("Open Xolotl in external terminal"));

    expect(await screen.findByText("Open Xolotl in external terminal failed.")).toBeTruthy();
    expect(screen.getByText(/Check the preferred external terminal in macOS Settings/)).toBeTruthy();
    expect(screen.getByText(/Terminal missing/)).toBeTruthy();
    expect(onOpenProject).not.toHaveBeenCalled();
  });
});
