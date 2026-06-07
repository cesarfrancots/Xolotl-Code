import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildMacStatusEvalSummary, buildMacStatusItemState, useMacStatusItem } from "./useMacStatusItem";
import type { Project } from "../bindings";
import { MAC_APP_STATUS_EVENT, type MacAppStatus } from "../lib/macAppStatus";
import type { AgentRecord } from "../stores/agentStore";
import { useAgentStore } from "../stores/agentStore";
import { useEvalStore } from "../stores/evalStore";
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
  useEvalStore.setState({
    activeEval: null,
    humanScores: {},
    manualReviews: {},
    scoresDirty: false,
    reviewDirty: false,
    evalOpen: false,
    blindMode: true,
    activeSuite: null,
  });
});

describe("buildMacStatusItemState", () => {
  it("summarizes the active project and active agent counts", () => {
    expect(buildMacStatusItemState({
      activeProjectPath: "/Users/cesar/Work/Xolotl Code",
      projects: [project("/Users/cesar/Work/Xolotl Code", "Xolotl Code")],
      agents: [agent("Planning"), agent("Executing"), agent("Waiting"), agent("Done"), agent("Failed")],
      evalSummary: {
        running_eval_models: 1,
        pending_eval_models: 1,
        completed_eval_models: 2,
        failed_eval_models: 0,
        total_eval_models: 4,
        active_eval_complete: false,
      },
    })).toEqual({
      active_project_name: "Xolotl Code",
      active_project_path: "/Users/cesar/Work/Xolotl Code",
      running_agents: 2,
      waiting_agents: 1,
      completed_agents: 1,
      failed_agents: 1,
      total_agents: 5,
      running_eval_models: 1,
      pending_eval_models: 1,
      completed_eval_models: 2,
      failed_eval_models: 0,
      total_eval_models: 4,
      active_eval_complete: false,
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

describe("buildMacStatusEvalSummary", () => {
  it("summarizes the active eval model counts", () => {
    useEvalStore.getState().startEval("eval-status", "Ship a Mac feature", ["model-a", "model-b", "model-c"]);
    useEvalStore.getState().setModelRunning("eval-status", "model-a");
    useEvalStore.getState().completeModel("eval-status", "model-b", {
      input_tokens: 10,
      output_tokens: 20,
      duration_ms: 1000,
    });
    useEvalStore.getState().completeModel("eval-status", "model-a", {
      input_tokens: 12,
      output_tokens: 24,
      duration_ms: 1100,
    });
    useEvalStore.getState().completeModel("eval-status", "model-c", {
      input_tokens: 0,
      output_tokens: 0,
      duration_ms: 0,
      error: "provider failed",
    });
    useEvalStore.getState().finalizeEval("eval-status");

    expect(buildMacStatusEvalSummary(useEvalStore.getState().activeEval)).toEqual({
      running_eval_models: 0,
      pending_eval_models: 0,
      completed_eval_models: 2,
      failed_eval_models: 1,
      total_eval_models: 3,
      active_eval_complete: true,
    });
  });
});

describe("useMacStatusItem", () => {
  it("sends active eval counts without updating for streaming-only changes", async () => {
    const { unmount } = renderHook(() => useMacStatusItem());

    try {
      await waitFor(() => {
        expect(commandMocks.updateMacStatusItem).toHaveBeenCalledTimes(1);
      });

      useEvalStore.getState().startEval("eval-live", "Ship a Mac feature", ["model-a", "model-b"]);

      await waitFor(() => {
        expect(commandMocks.updateMacStatusItem).toHaveBeenLastCalledWith(expect.objectContaining({
          pending_eval_models: 2,
          running_eval_models: 0,
          total_eval_models: 2,
        }));
      });

      useEvalStore.getState().setModelRunning("eval-live", "model-a");

      await waitFor(() => {
        expect(commandMocks.updateMacStatusItem).toHaveBeenLastCalledWith(expect.objectContaining({
          pending_eval_models: 1,
          running_eval_models: 1,
          total_eval_models: 2,
        }));
      });

      const callCountAfterStatusChange = commandMocks.updateMacStatusItem.mock.calls.length;
      useEvalStore.getState().appendModelDelta("eval-live", "model-a", "streamed token");
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(commandMocks.updateMacStatusItem).toHaveBeenCalledTimes(callCountAfterStatusChange);
    } finally {
      unmount();
    }
  });

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
