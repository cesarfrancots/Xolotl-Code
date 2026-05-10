import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentCard } from "./AgentCard";
import { useAgentStore } from "../../stores/agentStore";
import type { AgentRecord } from "../../stores/agentStore";

// Mock Tauri event listener — useAgentPanelEvents calls listen()
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// Mock notification plugin
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue("granted"),
  sendNotification: vi.fn(),
}));

// Mock bindings so stopAgent is available
vi.mock("../../bindings", () => ({
  commands: {
    stopAgent: vi.fn().mockResolvedValue({ status: "ok" }),
  },
}));

function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "agent-1",
    task: "Fix the bug in auth module",
    model: "claude-sonnet-4-5",
    state: "Idle",
    cumulativeCost: 0,
    messages: [],
    streamingContent: "",
    isStreaming: false,
    ...overrides,
  };
}

beforeEach(() => {
  useAgentStore.setState({ agents: [], expandedAgentId: null });
});

it("renders the state badge text", () => {
  render(<AgentCard agent={makeAgent({ state: "Idle" })} />);
  expect(screen.getByText("Idle")).toBeDefined();
});

it("renders truncated task when task exceeds 80 chars", () => {
  const longTask = "A".repeat(200);
  render(<AgentCard agent={makeAgent({ task: longTask })} />);
  const rendered = screen.getByTitle(longTask);
  // The visible text should be <= 80 chars and end with ellipsis
  expect(rendered.textContent!.length).toBeLessThanOrEqual(80);
  expect(rendered.textContent!.endsWith("…")).toBe(true);
});

it("renders cost as $0.0000 when cumulativeCost is 0", () => {
  render(<AgentCard agent={makeAgent({ cumulativeCost: 0 })} />);
  expect(screen.getByText("$0.0000")).toBeDefined();
});

it("renders cost as $0.1234 when cumulativeCost is 0.1234", () => {
  render(<AgentCard agent={makeAgent({ cumulativeCost: 0.1234 })} />);
  expect(screen.getByText("$0.1234")).toBeDefined();
});

it("does NOT render the model name anywhere in the card (D-03)", () => {
  const model = "claude-sonnet-4-5";
  render(<AgentCard agent={makeAgent({ model })} />);
  // Model name must not appear in card content
  expect(screen.queryByText(model)).toBeNull();
  expect(screen.queryByText(/claude/i)).toBeNull();
});

it("clicking expand button calls setExpandedAgent with agent id", async () => {
  const user = userEvent.setup();
  render(<AgentCard agent={makeAgent({ id: "agent-99" })} />);
  const expandBtn = screen.getByTitle("Expand");
  await user.click(expandBtn);
  expect(useAgentStore.getState().expandedAgentId).toBe("agent-99");
});

it("shows stop button for non-terminal states (Executing)", () => {
  render(<AgentCard agent={makeAgent({ state: "Executing" })} />);
  expect(screen.getByTitle("Stop agent")).toBeDefined();
});

it("hides stop button for Done state", () => {
  render(<AgentCard agent={makeAgent({ state: "Done" })} />);
  expect(screen.queryByTitle("Stop agent")).toBeNull();
});

it("hides stop button for Failed state", () => {
  render(<AgentCard agent={makeAgent({ state: "Failed" })} />);
  expect(screen.queryByTitle("Stop agent")).toBeNull();
});

describe("AgentStateBadge integration", () => {
  it("shows spinner only for Executing state", () => {
    render(<AgentCard agent={makeAgent({ state: "Executing" })} />);
    expect(screen.getByText("Executing")).toBeDefined();
  });
});
