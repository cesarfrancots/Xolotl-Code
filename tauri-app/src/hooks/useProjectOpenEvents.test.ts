import { render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { projectOpenPathFromPayload, useProjectOpenEvents } from "./useProjectOpenEvents";
import { useProjectStore } from "../stores/projectStore";

const commandMocks = vi.hoisted(() => ({
  launchProjectPaths: vi.fn<() => Promise<string[]>>(() => Promise.resolve([])),
}));

const eventMocks = vi.hoisted(() => ({
  listen: vi.fn((_eventName: string, _handler?: unknown) => Promise.resolve(() => undefined)),
}));

vi.mock("../bindings", () => ({
  commands: commandMocks,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: eventMocks.listen,
}));

function ProjectOpenEventsHarness() {
  useProjectOpenEvents();
  return null;
}

function setTauriRuntime(enabled: boolean) {
  const target = window as Window & { __TAURI_INTERNALS__?: unknown };
  if (enabled) target.__TAURI_INTERNALS__ = {};
  else delete target.__TAURI_INTERNALS__;
}

describe("projectOpenPathFromPayload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTauriRuntime(false);
  });

  it("normalizes string project paths", () => {
    expect(projectOpenPathFromPayload(" /Users/cesar/Code/Xolotl ")).toBe("/Users/cesar/Code/Xolotl");
  });

  it("rejects empty and malformed payloads", () => {
    expect(projectOpenPathFromPayload(" ")).toBeNull();
    expect(projectOpenPathFromPayload({ path: "/Users/cesar/Code" })).toBeNull();
  });
});

describe("useProjectOpenEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTauriRuntime(true);
    commandMocks.launchProjectPaths.mockResolvedValue([]);
    useProjectStore.setState({
      addProjectPath: vi.fn(() => Promise.resolve()),
      restoreActiveProject: vi.fn(() => Promise.resolve(true)),
      setProjectError: vi.fn(),
    });
  });

  it("restores the last active project when launch did not provide a path", async () => {
    const restoreActiveProject = vi.fn(() => Promise.resolve(true));
    useProjectStore.setState({ restoreActiveProject });

    render(createElement(ProjectOpenEventsHarness));

    await waitFor(() => {
      expect(restoreActiveProject).toHaveBeenCalledTimes(1);
    });
    expect(useProjectStore.getState().addProjectPath).not.toHaveBeenCalled();
  });

  it("lets Finder and Open With launch paths override last active project restore", async () => {
    const addProjectPath = vi.fn(() => Promise.resolve());
    const restoreActiveProject = vi.fn(() => Promise.resolve(true));
    commandMocks.launchProjectPaths.mockResolvedValue(["/Users/cesar/Code/Xolotl Project"]);
    useProjectStore.setState({ addProjectPath, restoreActiveProject });

    render(createElement(ProjectOpenEventsHarness));

    await waitFor(() => {
      expect(addProjectPath).toHaveBeenCalledWith("/Users/cesar/Code/Xolotl Project");
    });
    expect(restoreActiveProject).not.toHaveBeenCalled();
  });

  it("reports restore failures as last-active-project recovery", async () => {
    const setProjectError = vi.fn();
    useProjectStore.setState({
      restoreActiveProject: vi.fn(() => Promise.reject(new Error("bookmark denied"))),
      setProjectError,
    });

    render(createElement(ProjectOpenEventsHarness));

    await waitFor(() => {
      expect(setProjectError).toHaveBeenCalledWith("Could not restore last active project. bookmark denied");
    });
  });
});
