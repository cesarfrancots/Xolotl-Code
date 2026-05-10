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
    isStreaming: false,
    model: "claude-sonnet-4-5",
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

describe("finalizeStream", () => {
  it("moves streamingContent to items and clears it", () => {
    useChatStore.getState().appendStreamingContent("hello world");
    useChatStore.getState().finalizeStream(ZERO_USAGE);
    const state = useChatStore.getState();
    expect(state.streamingContent).toBe("");
    expect(state.isStreaming).toBe(false);
    expect(state.items).toHaveLength(1);
    const msg = state.items[0] as any;
    expect(msg.role).toBe("assistant");
    expect(msg.content).toBe("hello world");
  });
});

describe("clearSession", () => {
  it("resets items, streaming state, and usage; preserves agentId and model", () => {
    useChatStore.setState({ agentId: "agent-123", model: "claude-opus-4-5" });
    useChatStore.getState().appendStreamingContent("partial");
    useChatStore.getState().clearSession();
    const state = useChatStore.getState();
    expect(state.items).toHaveLength(0);
    expect(state.streamingContent).toBe("");
    expect(state.isStreaming).toBe(false);
    expect(state.sessionUsage).toEqual(ZERO_USAGE);
    // agentId and model preserved
    expect(state.agentId).toBe("agent-123");
    expect(state.model).toBe("claude-opus-4-5");
  });
});
