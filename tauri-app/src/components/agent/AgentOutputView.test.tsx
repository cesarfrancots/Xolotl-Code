import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentOutputView } from "./AgentOutputView";
import { useAgentStore, type AgentRecord } from "../../stores/agentStore";

type CommandResult<T> = { status: "ok"; data: T } | { status: "error"; error: string };

const commandMocks = vi.hoisted(() => ({
  getAgentWorktreePath: vi.fn<(agentId: string) => Promise<CommandResult<string>>>((_agentId) => Promise.resolve({
    status: "ok",
    data: "/Users/cesar/Documents/Xolotl/.xolotl-worktrees/agent-1",
  })),
}));

const pathActionMocks = vi.hoisted(() => ({
  copyTextToClipboard: vi.fn<(text: string) => Promise<void>>((_text) => Promise.resolve()),
  copyXolotlCodeOpenShellCommand: vi.fn<(path: string) => Promise<void>>((_path) => Promise.resolve()),
  copyXolotlCodeOpenUrl: vi.fn<(path: string) => Promise<void>>((_path) => Promise.resolve()),
  openPathInExternalEditor: vi.fn<(path: string) => Promise<void>>((_path) => Promise.resolve()),
  openPathInExternalTerminal: vi.fn<(path: string) => Promise<void>>((_path) => Promise.resolve()),
  revealPathInFinder: vi.fn<(path: string) => Promise<void>>((_path) => Promise.resolve()),
}));

vi.mock("../../bindings", () => ({
  commands: commandMocks,
}));

vi.mock("../../lib/pathActions", () => ({
  copyTextToClipboard: pathActionMocks.copyTextToClipboard,
  copyXolotlCodeOpenShellCommand: pathActionMocks.copyXolotlCodeOpenShellCommand,
  copyXolotlCodeOpenUrl: pathActionMocks.copyXolotlCodeOpenUrl,
  openPathInExternalEditor: pathActionMocks.openPathInExternalEditor,
  openPathInExternalTerminal: pathActionMocks.openPathInExternalTerminal,
  revealPathInFinder: pathActionMocks.revealPathInFinder,
}));

vi.mock("./AgentMessageList", () => ({
  AgentMessageList: ({ agentId }: { agentId: string }) => <div>Messages for {agentId}</div>,
}));

vi.mock("./AgentStateBadge", () => ({
  AgentStateBadge: ({ state }: { state: string }) => <span>{state}</span>,
}));

function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "agent-1",
    task: "Implement Mac handoffs",
    model: "claude-sonnet-4-5",
    state: "Done",
    cumulativeCost: 0.0123,
    messages: [],
    streamingContent: "",
    isStreaming: false,
    branch: "agent/implement-mac-handoffs",
    groupId: null,
    ...overrides,
  };
}

describe("AgentOutputView Mac worktree handoffs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commandMocks.getAgentWorktreePath.mockResolvedValue({
      status: "ok",
      data: "/Users/cesar/Documents/Xolotl/.xolotl-worktrees/agent-1",
    });
    pathActionMocks.copyTextToClipboard.mockResolvedValue(undefined);
    pathActionMocks.copyXolotlCodeOpenShellCommand.mockResolvedValue(undefined);
    pathActionMocks.copyXolotlCodeOpenUrl.mockResolvedValue(undefined);
    pathActionMocks.openPathInExternalEditor.mockResolvedValue(undefined);
    pathActionMocks.openPathInExternalTerminal.mockResolvedValue(undefined);
    pathActionMocks.revealPathInFinder.mockResolvedValue(undefined);
    useAgentStore.setState({
      agents: [makeAgent()],
      groups: [],
      mergeCheckpointGroupId: null,
      expandedAgentId: "agent-1",
    });
  });

  it("copies the active agent worktree path from the automation menu", async () => {
    const user = userEvent.setup();

    render(<AgentOutputView agentId="agent-1" />);
    await user.click(screen.getByLabelText("Agent worktree automation actions"));
    await user.click(await screen.findByRole("menuitem", { name: "Copy agent worktree path" }));

    await waitFor(() => {
      expect(commandMocks.getAgentWorktreePath).toHaveBeenCalledWith("agent-1");
      expect(pathActionMocks.copyTextToClipboard).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl/.xolotl-worktrees/agent-1");
    });
    expect(await screen.findByText("Agent worktree path copied.")).toBeTruthy();
  });

  it("copies the active agent worktree Xolotl link from the automation menu", async () => {
    const user = userEvent.setup();

    render(<AgentOutputView agentId="agent-1" />);
    await user.click(screen.getByLabelText("Agent worktree automation actions"));
    await user.click(await screen.findByRole("menuitem", { name: "Copy agent worktree Xolotl link" }));

    await waitFor(() => {
      expect(commandMocks.getAgentWorktreePath).toHaveBeenCalledWith("agent-1");
      expect(pathActionMocks.copyXolotlCodeOpenUrl).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl/.xolotl-worktrees/agent-1");
    });
    expect(await screen.findByText("Agent worktree Xolotl link copied.")).toBeTruthy();
  });

  it("copies the active agent worktree shell open command from the automation menu", async () => {
    const user = userEvent.setup();

    render(<AgentOutputView agentId="agent-1" />);
    await user.click(screen.getByLabelText("Agent worktree automation actions"));
    await user.click(await screen.findByRole("menuitem", { name: "Copy agent worktree shell open command" }));

    await waitFor(() => {
      expect(commandMocks.getAgentWorktreePath).toHaveBeenCalledWith("agent-1");
      expect(pathActionMocks.copyXolotlCodeOpenShellCommand).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl/.xolotl-worktrees/agent-1");
    });
    expect(await screen.findByText("Agent worktree shell open command copied.")).toBeTruthy();
  });

  it("opens the active agent worktree in the external terminal", async () => {
    const user = userEvent.setup();

    render(<AgentOutputView agentId="agent-1" />);
    await user.click(screen.getByLabelText("Open agent worktree in external terminal"));

    await waitFor(() => {
      expect(commandMocks.getAgentWorktreePath).toHaveBeenCalledWith("agent-1");
      expect(pathActionMocks.openPathInExternalTerminal).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl/.xolotl-worktrees/agent-1");
    });
    expect(await screen.findByText("Agent worktree opened in the external terminal.")).toBeTruthy();
  });

  it("shows recovery guidance when the agent worktree cannot be resolved", async () => {
    commandMocks.getAgentWorktreePath.mockResolvedValueOnce({
      status: "error",
      error: "no worktree path for agent agent-1",
    });
    const user = userEvent.setup();

    render(<AgentOutputView agentId="agent-1" />);
    await user.click(screen.getByLabelText("Reveal agent worktree in Finder"));

    expect(await screen.findByText("Reveal agent worktree in Finder failed.")).toBeTruthy();
    expect(screen.getByText(/agent is still active/)).toBeTruthy();
    expect(screen.getByText(/no worktree path for agent agent-1/)).toBeTruthy();
    expect(pathActionMocks.revealPathInFinder).not.toHaveBeenCalled();
  });

  it("shows recovery guidance when the preferred editor handoff fails", async () => {
    pathActionMocks.openPathInExternalEditor.mockRejectedValueOnce(new Error("Cursor missing"));
    const user = userEvent.setup();

    render(<AgentOutputView agentId="agent-1" />);
    await user.click(screen.getByLabelText("Open agent worktree in editor"));

    await waitFor(() => {
      expect(pathActionMocks.openPathInExternalEditor).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl/.xolotl-worktrees/agent-1");
    });
    expect(await screen.findByText("Open agent worktree in editor failed.")).toBeTruthy();
    expect(screen.getByText(/preferred editor in macOS Settings/)).toBeTruthy();
    expect(screen.getByText(/Cursor missing/)).toBeTruthy();
  });

  it("shows recovery guidance when the external terminal handoff fails", async () => {
    pathActionMocks.openPathInExternalTerminal.mockRejectedValueOnce(new Error("Warp missing"));
    const user = userEvent.setup();

    render(<AgentOutputView agentId="agent-1" />);
    await user.click(screen.getByLabelText("Open agent worktree in external terminal"));

    await waitFor(() => {
      expect(pathActionMocks.openPathInExternalTerminal).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl/.xolotl-worktrees/agent-1");
    });
    expect(await screen.findByText("Open agent worktree in external terminal failed.")).toBeTruthy();
    expect(screen.getByText(/preferred external terminal in macOS Settings/)).toBeTruthy();
    expect(screen.getByText(/Warp missing/)).toBeTruthy();
  });
});
