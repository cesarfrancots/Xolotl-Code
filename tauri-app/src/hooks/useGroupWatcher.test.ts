import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGroupWatcher } from "./useGroupWatcher";
import { useAgentStore } from "../stores/agentStore";

// Mock Tauri event listener (not available in jsdom)
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

beforeEach(() => {
  useAgentStore.setState({
    agents: [],
    groups: [],
    mergeCheckpointGroupId: null,
    expandedAgentId: null,
  });
});

describe("useGroupWatcher", () => {
  it("transitions Pending group to AllDone when all agents are Done", async () => {
    // Setup: one group with two Done agents
    useAgentStore.getState().addAgent("a1", "task1", "model", "agent/0-task1", "g1");
    useAgentStore.getState().addAgent("a2", "task2", "model", "agent/1-task2", "g1");
    useAgentStore.getState().addGroup("g1", ["a1", "a2"], "team", "Test Team");
    useAgentStore.getState().updateAgentState("a1", "Done");
    useAgentStore.getState().updateAgentState("a2", "Done");

    renderHook(() => useGroupWatcher());

    await act(async () => {});

    const store = useAgentStore.getState();
    expect(store.groups[0].mergeState).toBe("AllDone");
    expect(store.mergeCheckpointGroupId).toBe("g1");
  });

  it("does not transition when group has no agents yet", () => {
    useAgentStore.getState().addGroup("g1", ["a1"], "team", "Empty Team");

    renderHook(() => useGroupWatcher());

    expect(useAgentStore.getState().groups[0].mergeState).toBe("Pending");
  });

  it("does not re-trigger for non-Pending groups", () => {
    useAgentStore.getState().addAgent("a1", "task", "model", "agent/0-task", "g1");
    useAgentStore.getState().addGroup("g1", ["a1"], "team", "Team");
    useAgentStore.getState().updateGroupMergeState("g1", "CheckpointOpen");
    useAgentStore.getState().updateAgentState("a1", "Done");

    renderHook(() => useGroupWatcher());

    // mergeState stays CheckpointOpen, not reset to AllDone
    expect(useAgentStore.getState().groups[0].mergeState).toBe("CheckpointOpen");
  });
});
