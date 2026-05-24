import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "./chatStore";
import type { TokenUsage } from "../bindings";

const ZERO_USAGE: TokenUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

beforeEach(() => {
  // Reset store to initial state before each test
  useChatStore.setState({
    agentId: null,
    items: [],
    streamingContent: "",
    streamingReasoning: "",
    isStreaming: false,
    currentTurnId: null,
    model: "claude-sonnet-4-5",
    reasoningEffort: "high",
    sessionUsage: ZERO_USAGE,
    alwaysAllowedTools: new Set(),
  });
});

describe("appendStreamingContent", () => {
  it("accumulates deltas via functional update", () => {
    useChatStore.getState().appendStreamingContent("foo");
    useChatStore.getState().appendStreamingContent("bar");
    const state = useChatStore.getState();
    expect(state.streamingContent).toBe("foobar");
    expect(state.isStreaming).toBe(true);
  });
});

describe("beginStream", () => {
  it("tracks the active turn before the first model delta arrives", () => {
    useChatStore.getState().beginStream("turn-123");
    const state = useChatStore.getState();
    expect(state.isStreaming).toBe(true);
    expect(state.currentTurnId).toBe("turn-123");
    expect(state.streamingContent).toBe("");
    expect(state.streamingReasoning).toBe("");
  });
});

describe("finalizeStream", () => {
  it("moves streamingContent to items and clears it", () => {
    useChatStore.getState().appendStreamingContent("hello world");
    useChatStore.getState().finalizeStream(ZERO_USAGE);
    const state = useChatStore.getState();
    expect(state.streamingContent).toBe("");
    expect(state.isStreaming).toBe(false);
    expect(state.currentTurnId).toBeNull();
    expect(state.items).toHaveLength(1);
    const msg = state.items[0] as any;
    expect(msg.role).toBe("assistant");
    expect(msg.content).toBe("hello world");
  });

  it("does not commit an empty assistant message when no deltas arrived", () => {
    useChatStore.getState().beginStream();
    useChatStore.getState().finalizeStream(ZERO_USAGE);
    const state = useChatStore.getState();
    expect(state.isStreaming).toBe(false);
    expect(state.currentTurnId).toBeNull();
    expect(state.items).toHaveLength(0);
  });
});

describe("cancelStream", () => {
  it("clears the active turn id when a streaming turn is stopped", () => {
    useChatStore.getState().beginStream("turn-stop");
    useChatStore.getState().appendStreamingContent("partial");
    useChatStore.getState().cancelStream();

    const state = useChatStore.getState();
    expect(state.currentTurnId).toBeNull();
    expect(state.isStreaming).toBe(false);
    expect((state.items[0] as any).stopped).toBe(true);
  });
});

describe("clearSession", () => {
  it("resets items, streaming, usage, and agentId; preserves model", () => {
    useChatStore.setState({ agentId: "agent-123", model: "claude-opus-4-5" });
    useChatStore.getState().appendStreamingContent("partial");
    useChatStore.getState().clearSession();
    const state = useChatStore.getState();
    expect(state.items).toHaveLength(0);
    expect(state.streamingContent).toBe("");
    expect(state.isStreaming).toBe(false);
    expect(state.currentTurnId).toBeNull();
    expect(state.sessionUsage).toEqual(ZERO_USAGE);
    // agentId must reset — otherwise "New session" silently keeps using the
    // old agent's runtime state (worktree, logs, etc.).
    expect(state.agentId).toBeNull();
    // Model preference carries to the new session.
    expect(state.model).toBe("claude-opus-4-5");
  });
});
