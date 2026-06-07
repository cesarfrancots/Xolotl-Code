import { beforeEach, describe, expect, it, vi } from "vitest";
import { commands } from "../bindings";
import { useProjectStore } from "./projectStore";

const commandMocks = vi.hoisted(() => ({
  addProject: vi.fn(),
  browseDirectory: vi.fn(),
  listProjects: vi.fn(),
  refreshNativeMenu: vi.fn(() => Promise.resolve({ status: "ok" as const, data: null })),
  touchProject: vi.fn(() => Promise.resolve({ status: "ok" as const, data: null })),
}));

vi.mock("../bindings", () => ({
  commands: commandMocks,
}));

describe("projectStore project errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commandMocks.addProject.mockResolvedValue({
      status: "ok",
      data: [
        {
          name: "Xolotl",
          path: "/Users/cesar/Documents/Xolotl",
          added_at: 1,
          last_opened_at: 2,
        },
      ],
    });
    commandMocks.browseDirectory.mockResolvedValue({
      status: "ok",
      data: {
        path: "/Users/cesar/Documents/Xolotl",
        parent: "/Users/cesar/Documents",
        children: [],
      },
    });
    commandMocks.listProjects.mockResolvedValue([]);
    useProjectStore.setState({
      projects: [],
      activeProjectPath: null,
      loading: false,
      error: null,
      listing: null,
      browseLoading: false,
      browseError: null,
      recentBrowserFolders: [],
    });
  });

  it("records add-project failures for visible Mac recovery UI", async () => {
    commandMocks.addProject.mockResolvedValueOnce({
      status: "error",
      error: "Folder missing",
    });

    await useProjectStore.getState().addProjectPath("/Users/cesar/Documents/Missing");

    expect(useProjectStore.getState().error).toBe("Folder missing");
    expect(useProjectStore.getState().activeProjectPath).toBeNull();
  });

  it("clears stale project errors after a successful add", async () => {
    useProjectStore.getState().setProjectError("Previous failure");

    await useProjectStore.getState().addProjectPath("/Users/cesar/Documents/Xolotl");

    expect(useProjectStore.getState().error).toBeNull();
    expect(useProjectStore.getState().activeProjectPath).toBe("/Users/cesar/Documents/Xolotl");
    expect(commands.addProject).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
  });

  it("clears file browser errors independently of project-open errors", () => {
    useProjectStore.setState({
      error: "Open failed",
      browseError: "Browse failed",
    });

    useProjectStore.getState().clearBrowseError();

    expect(useProjectStore.getState().error).toBe("Open failed");
    expect(useProjectStore.getState().browseError).toBeNull();
  });

  it("records successful file-browser folders for Mac recent-folder commands", async () => {
    commandMocks.browseDirectory.mockImplementation((path: string) => Promise.resolve({
      status: "ok",
      data: {
        path,
        parent: "/Users/cesar/Documents/Xolotl",
        children: [],
      },
    }));

    await useProjectStore.getState().browse("/Users/cesar/Documents/Xolotl/docs");
    await useProjectStore.getState().browse("/Users/cesar/Documents/Xolotl/src");
    await useProjectStore.getState().browse("/Users/cesar/Documents/Xolotl/docs");

    expect(useProjectStore.getState().recentBrowserFolders.slice(0, 2)).toEqual([
      "/Users/cesar/Documents/Xolotl/docs",
      "/Users/cesar/Documents/Xolotl/src",
    ]);
  });

  it("does not promote failed file-browser folders into recent-folder commands", async () => {
    useProjectStore.setState({
      recentBrowserFolders: ["/Users/cesar/Documents/Xolotl/docs"],
    });
    commandMocks.browseDirectory.mockResolvedValueOnce({
      status: "error",
      error: "Operation not permitted",
    });

    await useProjectStore.getState().browse("/Users/cesar/Documents/Xolotl/private");

    expect(useProjectStore.getState().recentBrowserFolders).toEqual([
      "/Users/cesar/Documents/Xolotl/docs",
    ]);
    expect(useProjectStore.getState().browseError).toBe("Operation not permitted");
  });

  it("restores and canonicalizes the last active project on Mac reopen", async () => {
    useProjectStore.setState({
      activeProjectPath: "/Users/cesar/Documents/Xolotl Link",
    });
    commandMocks.addProject.mockResolvedValueOnce({
      status: "ok",
      data: [
        {
          name: "Xolotl",
          path: "/Users/cesar/Documents/Xolotl",
          added_at: 1,
          last_opened_at: 3,
        },
      ],
    });

    const restored = await useProjectStore.getState().restoreActiveProject();

    expect(restored).toBe(true);
    expect(commandMocks.addProject).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl Link");
    expect(useProjectStore.getState().activeProjectPath).toBe("/Users/cesar/Documents/Xolotl");
    expect(useProjectStore.getState().projects[0]?.path).toBe("/Users/cesar/Documents/Xolotl");
    expect(commandMocks.browseDirectory).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
  });

  it("clears stale last active projects when macOS cannot reopen the folder", async () => {
    useProjectStore.setState({
      activeProjectPath: "/Users/cesar/Documents/Moved",
      listing: {
        path: "/Users/cesar/Documents/Moved",
        parent: "/Users/cesar/Documents",
        children: [],
      },
      browseError: "Previous browse failure",
      browseLoading: true,
    });
    commandMocks.addProject.mockResolvedValueOnce({
      status: "error",
      error: "Not a directory: /Users/cesar/Documents/Moved",
    });

    const restored = await useProjectStore.getState().restoreActiveProject();

    expect(restored).toBe(false);
    expect(useProjectStore.getState().activeProjectPath).toBeNull();
    expect(useProjectStore.getState().listing).toBeNull();
    expect(useProjectStore.getState().browseError).toBeNull();
    expect(useProjectStore.getState().browseLoading).toBe(false);
    expect(useProjectStore.getState().error).toBe("Could not restore last active project. Not a directory: /Users/cesar/Documents/Moved");
    expect(commandMocks.browseDirectory).not.toHaveBeenCalled();
  });
});
