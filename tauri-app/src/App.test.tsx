import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("./components/sidebar/SessionSidebar", () => ({
  SessionSidebar: () => <aside>Sessions</aside>,
}));

vi.mock("./components/chat/ChatPane", () => ({
  ChatPane: () => <main>Chat workspace</main>,
}));

vi.mock("./components/agent/AgentPanel", () => ({
  AgentPanel: () => <aside>Agents</aside>,
}));

vi.mock("./components/agent/AgentOutputView", () => ({
  AgentOutputView: () => <main>Agent output</main>,
}));

vi.mock("./components/agent/MergeCheckpointView", () => ({
  MergeCheckpointView: () => <main>Merge checkpoint</main>,
}));

vi.mock("./components/eval/EvalView", () => ({
  EvalView: () => <main>Eval workspace</main>,
}));

vi.mock("./stores/agentStore", () => ({
  useAgentStore: (selector: (state: { expandedAgentId: null; mergeCheckpointGroupId: null }) => unknown) =>
    selector({ expandedAgentId: null, mergeCheckpointGroupId: null }),
}));

describe("App tab navigation", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("opens the eval workspace from the tab query", async () => {
    window.history.replaceState(null, "", "/?tab=eval");

    render(<App />);

    expect(await screen.findByText("Eval workspace")).toBeTruthy();
  });

  it("keeps the tab query in sync with workspace selection", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/?tab=eval");
    render(<App />);

    await user.click(screen.getByRole("button", { name: /chat/i }));

    expect(screen.getByText("Chat workspace")).toBeTruthy();
    expect(window.location.search).toBe("");

    await user.click(screen.getByRole("button", { name: /eval/i }));

    expect(await screen.findByText("Eval workspace")).toBeTruthy();
    expect(window.location.search).toBe("?tab=eval");
  });
});
