import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore } from "./agentStore";
import type { TokenUsage } from "../bindings";

const ZERO_USAGE: TokenUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

const SOME_USAGE: TokenUsage = {
  input_tokens: 1000,
  output_tokens: 500,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

beforeEach(() => {
  useAgentStore.setState({ agents: [], expandedAgentId: null });
});

describe("addAgent", () => {
  it("creates a record with initial defaults", () => {
    useAgentStore.getState().addAgent("a1", "fix bug", "claude-sonnet-4");
    const state = useAgentStore.getState();
    expect(state.agents).toHaveLength(1);
    const agent = state.agents[0];
    expect(agent.id).toBe("a1");
    expect(agent.task).toBe("fix bug");
    expect(agent.model).toBe("claude-sonnet-4");
    expect(agent.state).toBe("Idle");
    expect(agent.cumulativeCost).toBe(0);
    expect(agent.messages).toEqual([]);
    expect(agent.streamingContent).toBe("");
    expect(agent.isStreaming).toBe(false);
  });

  it("preserves per-agent model isolation (AGT-05)", () => {
    useAgentStore.getState().addAgent("a1", "task one", "claude-sonnet-4");
    useAgentStore.getState().addAgent("a2", "task two", "claude-opus-4");
    const { agents } = useAgentStore.getState();
    expect(agents).toHaveLength(2);
    expect(agents[0].model).toBe("claude-sonnet-4");
    expect(agents[1].model).toBe("claude-opus-4");
  });
});

describe("updateAgentState", () => {
  it("mutates only the matching agent's state", () => {
    useAgentStore.getState().addAgent("a1", "task one", "claude-sonnet-4");
    useAgentStore.getState().addAgent("a2", "task two", "claude-opus-4");
    useAgentStore.getState().updateAgentState("a1", "Executing");
    const { agents } = useAgentStore.getState();
    expect(agents[0].state).toBe("Executing");
    expect(agents[1].state).toBe("Idle");
  });
});

describe("appendAgentStreamingContent", () => {
  it("accumulates content and sets isStreaming", () => {
    useAgentStore.getState().addAgent("a1", "task", "claude-sonnet-4");
    useAgentStore.getState().appendAgentStreamingContent("a1", "Hello");
    useAgentStore.getState().appendAgentStreamingContent("a1", " world");
    const agent = useAgentStore.getState().agents[0];
    expect(agent.streamingContent).toBe("Hello world");
    expect(agent.isStreaming).toBe(true);
  });

  it("does not alter other agents' streamingContent", () => {
    useAgentStore.getState().addAgent("a1", "task one", "claude-sonnet-4");
    useAgentStore.getState().addAgent("a2", "task two", "claude-opus-4");
    useAgentStore.getState().appendAgentStreamingContent("a1", "only for a1");
    const { agents } = useAgentStore.getState();
    expect(agents[0].streamingContent).toBe("only for a1");
    expect(agents[1].streamingContent).toBe("");
  });
});

describe("finalizeAgentStream", () => {
  it("commits streamingContent as an assistant message and resets streaming state", () => {
    useAgentStore.getState().addAgent("a1", "task", "claude-sonnet-4");
    useAgentStore.getState().appendAgentStreamingContent("a1", "Hello");
    useAgentStore.getState().appendAgentStreamingContent("a1", " world");
    useAgentStore.getState().finalizeAgentStream("a1", ZERO_USAGE);
    const agent = useAgentStore.getState().agents[0];
    expect(agent.streamingContent).toBe("");
    expect(agent.isStreaming).toBe(false);
    expect(agent.messages).toHaveLength(1);
    const msg = agent.messages[0] as any;
    expect(msg.role).toBe("assistant");
    expect(msg.content).toBe("Hello world");
  });

  it("increases cumulativeCost by estimateTurnCost after finalize", () => {
    useAgentStore.getState().addAgent("a1", "task", "claude-sonnet-4");
    useAgentStore.getState().appendAgentStreamingContent("a1", "content");
    useAgentStore.getState().finalizeAgentStream("a1", SOME_USAGE);
    const agent = useAgentStore.getState().agents[0];
    // claude-sonnet-4: in=$3/1M, out=$15/1M
    // 1000 * 3 / 1_000_000 + 500 * 15 / 1_000_000 = 0.003 + 0.0075 = 0.0105
    expect(agent.cumulativeCost).toBeCloseTo(0.0105, 6);
  });

  it("is a no-op when nothing was streaming", () => {
    useAgentStore.getState().addAgent("a1", "task", "claude-sonnet-4");
    useAgentStore.getState().finalizeAgentStream("a1", ZERO_USAGE);
    const agent = useAgentStore.getState().agents[0];
    expect(agent.messages).toHaveLength(0);
    expect(agent.cumulativeCost).toBe(0);
  });
});

describe("startAgentToolCall / completeAgentToolCall", () => {
  it("appends a ToolCall to the last assistant message", () => {
    useAgentStore.getState().addAgent("a1", "task", "claude-sonnet-4");
    // Start a tool call — no existing assistant message, creates placeholder
    useAgentStore.getState().startAgentToolCall("a1", "tc1", "bash", "ls -la");
    const agent = useAgentStore.getState().agents[0];
    expect(agent.messages).toHaveLength(1);
    const msg = agent.messages[0] as any;
    expect(msg.role).toBe("assistant");
    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.toolCalls[0].id).toBe("tc1");
    expect(msg.toolCalls[0].tool).toBe("bash");
    expect(msg.toolCalls[0].loading).toBe(true);
  });

  it("completes a tool call by id — sets loading false and output", () => {
    useAgentStore.getState().addAgent("a1", "task", "claude-sonnet-4");
    useAgentStore.getState().startAgentToolCall("a1", "tc1", "bash", "ls -la");
    useAgentStore.getState().completeAgentToolCall("a1", "tc1", "file1.txt\nfile2.txt");
    const agent = useAgentStore.getState().agents[0];
    const tc = (agent.messages[0] as any).toolCalls[0];
    expect(tc.loading).toBe(false);
    expect(tc.output).toBe("file1.txt\nfile2.txt");
  });
});

describe("appendAgentError", () => {
  it("appends an assistant message with error content and stopped=true", () => {
    useAgentStore.getState().addAgent("a1", "task", "claude-sonnet-4");
    useAgentStore.getState().appendAgentError("a1", "boom");
    const agent = useAgentStore.getState().agents[0];
    expect(agent.messages).toHaveLength(1);
    const msg = agent.messages[0] as any;
    expect(msg.role).toBe("assistant");
    expect(msg.content).toContain("boom");
    expect(msg.stopped).toBe(true);
  });
});

describe("setExpandedAgent", () => {
  it("toggles expandedAgentId correctly", () => {
    useAgentStore.getState().setExpandedAgent("a1");
    expect(useAgentStore.getState().expandedAgentId).toBe("a1");
    useAgentStore.getState().setExpandedAgent(null);
    expect(useAgentStore.getState().expandedAgentId).toBeNull();
  });
});
