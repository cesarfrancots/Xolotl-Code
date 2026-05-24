import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore, type Message } from "./chatStore";
import type { TokenUsage } from "../bindings";

const ZERO_USAGE: TokenUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

function msg(id: string, role: Message["role"], content: string): Message {
  return {
    id,
    role,
    content,
    toolCalls: [],
  };
}

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

describe("compactSession", () => {
  it("replaces older turns with a checkpoint and preserves recent messages", () => {
    useChatStore.setState({
      items: [
        msg("u1", "user", "We need to improve evals."),
        msg("a1", "assistant", "I inspected EvalView and found blind review gating."),
        msg("u2", "user", "Now improve chat context handling."),
        msg("a2", "assistant", "I will add compaction."),
        msg("u3", "user", "Keep the latest request intact."),
      ],
    });

    const result = useChatStore.getState().compactSession({ keepRecentMessages: 2 });

    const state = useChatStore.getState();
    expect(result.compacted).toBe(true);
    expect(result.compactedMessages).toBe(3);
    expect(state.items).toHaveLength(3);
    expect((state.items[0] as Message).content).toContain("Session checkpoint");
    expect((state.items[0] as Message).content).toContain("We need to improve evals.");
    expect(state.items.slice(1).map((item) => (item as Message).id)).toEqual(["a2", "u3"]);
    expect(state.isStreaming).toBe(false);
    expect(state.currentTurnId).toBeNull();
  });

  it("does not compact while a turn is streaming", () => {
    useChatStore.setState({
      items: [
        msg("u1", "user", "Older request"),
        msg("a1", "assistant", "Older answer"),
        msg("u2", "user", "Current request"),
      ],
    });
    useChatStore.getState().beginStream("turn-active");

    const result = useChatStore.getState().compactSession({ keepRecentMessages: 1 });

    const state = useChatStore.getState();
    expect(result).toMatchObject({ compacted: false, reason: "streaming" });
    expect(state.items.map((item) => (item as Message).id)).toEqual(["u1", "a1", "u2"]);
    expect(state.isStreaming).toBe(true);
    expect(state.currentTurnId).toBe("turn-active");
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
