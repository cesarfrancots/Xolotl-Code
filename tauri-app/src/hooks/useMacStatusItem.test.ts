import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildMacStatusItemState, useMacStatusItem } from "./useMacStatusItem";
import type { Project } from "../bindings";
import { MAC_APP_STATUS_EVENT, type MacAppStatus } from "../lib/macAppStatus";
import type { AgentRecord } from "../stores/agentStore";
import { useAgentStore } from "../stores/agentStore";
import { useProjectStore } from "../stores/projectStore";

const commandMocks = vi.hoisted(() => ({
  updateMacStatusItem: vi.fn(),
}));

vi.mock("../bindings", () => ({
  commands: {
    updateMacStatusItem: commandMocks.updateMacStatusItem,
  },
}));

const project = (path: string, name: string): Project => ({
  path,
  name,
  added_at: 1,
  last_opened_at: 2,
});

const agent = (state: AgentRecord["state"]): AgentRecord => ({
  id: state,
  task: "Task",
  model: "claude-sonnet-4-6",
  state,
  cumulativeCost: 0,
  messages: [],
  streamingContent: "",
  isStreaming: false,
  branch: "",
  groupId: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  commandMocks.updateMacStatusItem.mockResolvedValue({ status: "ok", data: null });
  useAgentStore.setState({
    agents: [],
    expandedAgentId: null,
    groups: [],
    mergeCheckpointGroupId: null,
  });
  useProjectStore.setState({
    projects: [],
    activeProjectPath: null,
    listing: null,
    browseError: null,
  });
});

describe("buildMacStatusItemState", () => {
  it("summarizes the active project and active agent counts", () => {
    expect(buildMacStatusItemState({
      activeProjectPath: "/Users/cesar/Work/Xolotl Code",
      projects: [project("/Users/cesar/Work/Xolotl Code", "Xolotl Code")],
      agents: [agent("Planning"), agent("Executing"), agent("Waiting"), agent("Done")],
    })).toEqual({
      active_project_name: "Xolotl Code",
      active_project_path: "/Users/cesar/Work/Xolotl Code",
      running_agents: 2,
      waiting_agents: 1,
      total_agents: 4,
    });
  });

  it("falls back to the path basename when the active project is not in recents", () => {
    expect(buildMacStatusItemState({
      activeProjectPath: "/Users/cesar/Work/Detached Project",
      projects: [],
      agents: [],
    }).active_project_name).toBe("Detached Project");
  });
});

describe("useMacStatusItem", () => {
  it("emits recovery status when the native status item update fails", async () => {
    const statuses: MacAppStatus[] = [];
    const onStatus = (event: Event) => statuses.push((event as CustomEvent<MacAppStatus>).detail);
    window.addEventListener(MAC_APP_STATUS_EVENT, onStatus);
    commandMocks.updateMacStatusItem.mockResolvedValueOnce({
      status: "error",
      error: "status item unavailable",
    });
    useProjectStore.setState({
      activeProjectPath: "/Users/cesar/Work/Xolotl Code",
      projects: [project("/Users/cesar/Work/Xolotl Code", "Xolotl Code")],
    });

    const { unmount } = renderHook(() => useMacStatusItem());

    try {
      await waitFor(() => {
        expect(statuses[0]?.message).toBe("Menu bar status item could not update.");
      });
      expect(statuses[0]?.hint).toContain("turn the menu bar status item off and on again");
      expect(statuses[0]?.hint).toContain("status item unavailable");
    } finally {
      unmount();
      window.removeEventListener(MAC_APP_STATUS_EVENT, onStatus);
    }
  });
});
