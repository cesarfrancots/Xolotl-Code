import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPEN_EVAL_FROM_NOTIFICATION_EVENT,
  applyMacNotificationRoute,
  consumePendingEvalNotificationId,
  macNotificationRouteFromAction,
  macNotificationRouteFromPayload,
  storePendingEvalNotificationId,
} from "./useMacNotificationRoutes";
import { useAgentStore } from "../stores/agentStore";

describe("mac notification route helpers", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    useAgentStore.setState({
      agents: [],
      groups: [],
      expandedAgentId: null,
      mergeCheckpointGroupId: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    window.sessionStorage.clear();
  });

  it("parses route metadata from backend notification payloads", () => {
    expect(macNotificationRouteFromPayload({
      route: { view: "eval", eval_id: "eval-1" },
    })).toEqual({ view: "eval", eval_id: "eval-1" });

    expect(macNotificationRouteFromPayload({
      route: { view: "agent" },
    })).toBeNull();
  });

  it("parses route metadata from future notification action payloads", () => {
    expect(macNotificationRouteFromAction({
      extra: { route: { view: "agent", agent_id: "agent-1" } },
    })).toEqual({ view: "agent", agent_id: "agent-1" });
  });

  it("consumes pending eval ids once", () => {
    storePendingEvalNotificationId("eval-2");

    expect(consumePendingEvalNotificationId()).toBe("eval-2");
    expect(consumePendingEvalNotificationId()).toBeNull();
  });

  it("routes agent notifications into the agent output view", () => {
    const selectCenterTab = vi.fn();
    useAgentStore.setState({
      expandedAgentId: "old-agent",
      mergeCheckpointGroupId: "group-1",
    });

    applyMacNotificationRoute({ view: "agent", agent_id: "agent-99" }, selectCenterTab);

    expect(useAgentStore.getState().expandedAgentId).toBe("agent-99");
    expect(useAgentStore.getState().mergeCheckpointGroupId).toBeNull();
    expect(selectCenterTab).not.toHaveBeenCalled();
  });

  it("routes eval notifications into the eval workspace and keeps the eval id for lazy views", () => {
    vi.useFakeTimers();
    const selectCenterTab = vi.fn();
    const events: Array<{ evalId: string | null }> = [];
    const onOpenEval = (event: Event) => {
      events.push((event as CustomEvent<{ evalId: string | null }>).detail);
    };
    window.addEventListener(OPEN_EVAL_FROM_NOTIFICATION_EVENT, onOpenEval);
    useAgentStore.setState({
      expandedAgentId: "agent-1",
      mergeCheckpointGroupId: "group-1",
    });

    try {
      applyMacNotificationRoute({ view: "eval", eval_id: "eval-3" }, selectCenterTab);
      vi.runAllTimers();
    } finally {
      window.removeEventListener(OPEN_EVAL_FROM_NOTIFICATION_EVENT, onOpenEval);
    }

    expect(selectCenterTab).toHaveBeenCalledWith("eval");
    expect(useAgentStore.getState().expandedAgentId).toBeNull();
    expect(useAgentStore.getState().mergeCheckpointGroupId).toBeNull();
    expect(consumePendingEvalNotificationId()).toBe("eval-3");
    expect(events).toEqual([{ evalId: "eval-3" }]);
  });

  it("routes permission notifications into chat", () => {
    const selectCenterTab = vi.fn();
    useAgentStore.setState({
      expandedAgentId: "agent-1",
      mergeCheckpointGroupId: "group-1",
    });

    applyMacNotificationRoute({ view: "permission", prompt_id: "prompt-1" }, selectCenterTab);

    expect(selectCenterTab).toHaveBeenCalledWith("chat");
    expect(useAgentStore.getState().expandedAgentId).toBeNull();
    expect(useAgentStore.getState().mergeCheckpointGroupId).toBeNull();
  });
});
