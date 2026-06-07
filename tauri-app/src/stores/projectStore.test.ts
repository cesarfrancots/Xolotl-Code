import { beforeEach, describe, expect, it, vi } from "vitest";
import { commands } from "../bindings";
import { useProjectStore } from "./projectStore";

const commandMocks = vi.hoisted(() => ({
  addProject: vi.fn(),
  browseDirectory: vi.fn(),
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
    useProjectStore.setState({
      projects: [],
      activeProjectPath: null,
      loading: false,
      error: null,
      listing: null,
      browseLoading: false,
      browseError: null,
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
});
