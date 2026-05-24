import { create } from "zustand";
import type { TokenUsage } from "../bindings";

export type ReasoningEffort = "low" | "medium" | "high" | "max";

/** A single tool call within an assistant message. */
export interface ToolCall {
  /** Unique id for this tool call (generated client-side). */
  id: string;
  tool: string;
  input: string;
  /** Output is undefined while the tool is still running. */
  output?: string;
  /** true while ToolCallStarted received but ToolCallCompleted not yet received. */
  loading: boolean;
}

/** An inline permission prompt item in the message list. */
export interface PermissionItem {
  type: "permission";
  promptId: string;
  toolName: string;
  preview: string;
  /** undefined until user responds. */
  decision?: "Allow" | "Deny" | "AlwaysAllow";
}

/** A single message in the conversation. */
export interface Message {
  id: string;
  role: "user" | "assistant";
  /** Final committed text content. Empty string while streaming. */
  content: string;
  /** Chain-of-thought from reasoning models. Optional, rendered collapsed. */
  reasoning?: string;
  toolCalls: ToolCall[];
  usage?: TokenUsage;
  /** "(stopped)" suffix if turn was cancelled mid-stream. */
  stopped?: boolean;
}

/** A list item is either a Message or an inline PermissionItem. */
export type ChatItem = Message | PermissionItem;

export interface ChatState {
  /** ID of the agent backing the current session. null before first spawn. */
  agentId: string | null;
  /** Ordered list of committed messages and permission items. */
  items: ChatItem[];
  /**
   * Streaming delta buffer — accumulated TextDelta content not yet committed.
   * Rendered live as the streaming assistant message.
   * Per D-02: only updated via rAF flush in useAgentEvents hook.
   */
  streamingContent: string;
  /**
   * Streaming chain-of-thought buffer — accumulated ReasoningDelta content.
   * Rendered as a de-emphasized collapsible block alongside streamingContent.
   */
  streamingReasoning: string;
  /** True while an agent turn is in progress. */
  isStreaming: boolean;
  /** Backend chat_turn id for the currently streaming conversational turn. */
  currentTurnId: string | null;
  /** Currently selected model name (per-session, D-05). */
  model: string;
  /** Provider-specific thinking/reasoning effort where supported. */
  reasoningEffort: ReasoningEffort;
  /**
   * Running session-total token usage.
   * Accumulated from every TurnCompleted event.
   */
  sessionUsage: TokenUsage;
  /**
   * Per-session AlwaysAllow set (Pitfall 6 from RESEARCH.md).
   * When a permission-request arrives for a tool in this set,
   * the frontend auto-responds without showing a card.
   */
  alwaysAllowedTools: Set<string>;

  /** Set the agent ID after spawn_agent succeeds. */
  setAgentId: (id: string) => void;

  /** Append a committed user or assistant message to the list. */
  appendItem: (item: ChatItem) => void;

  /** Mark a model turn as started before the first network delta arrives. */
  beginStream: (turnId?: string | null) => void;

  /** Reset streaming state without committing an assistant message. */
  clearStreaming: () => void;

  /**
   * Append a streaming delta to streamingContent.
   * Uses functional update to avoid stale closure (Pitfall 3 from RESEARCH.md).
   * Call ONLY from the rAF callback in useAgentEvents — not directly from event handler.
   */
  appendStreamingContent: (delta: string) => void;
  /** Append a chain-of-thought delta to streamingReasoning. */
  appendStreamingReasoning: (delta: string) => void;

  /**
   * Called on TurnCompleted: commits streamingContent as a final assistant message,
   * records usage on that message, resets streaming state.
   */
  finalizeStream: (usage: TokenUsage) => void;

  /**
   * Called on Stop button press: commits partial streamingContent with stopped=true,
   * resets streaming state. Partial output is preserved (UI-10).
   */
  cancelStream: () => void;

  /** Insert a ToolCall loading placeholder when ToolCallStarted arrives. */
  startToolCall: (toolCallId: string, tool: string, input: string) => void;

  /**
   * Update a ToolCall with its output when ToolCallCompleted arrives.
   * Matches by tool name (ToolCallCompleted does not include the call id).
   */
  completeToolCall: (tool: string, output: string) => void;

  /** Insert a PermissionItem into the item list. */
  insertPermissionItem: (promptId: string, toolName: string, preview: string) => void;

  /** Mark a PermissionItem as resolved with the user's decision. */
  resolvePermission: (promptId: string, decision: "Allow" | "Deny" | "AlwaysAllow") => void;

  /** Add a tool to the alwaysAllowedTools set. */
  addAlwaysAllow: (toolName: string) => void;

  /** Set the model for the current session. */
  setModel: (model: string) => void;

  /** Set thinking/reasoning effort for providers that expose it. */
  setReasoningEffort: (effort: ReasoningEffort) => void;

  /** Clear the session: reset items, streaming state, and usage. Keeps agentId and model. */
  clearSession: () => void;

  /** Restore a previously saved session: replaces items, model, and usage. */
  hydrateSession: (items: Message[], model: string, usage: TokenUsage) => void;
}

// Default to kimi-coding because the most common setup uses a Kimi For
// Coding key (sk-kimi-…) which authenticates against api.kimi.com/coding/v1.
// kimi2.6 routes to Moonshot (api.moonshot.cn) and requires a separate key.
const DEFAULT_MODEL = "kimi-coding";

const EMPTY_USAGE: TokenUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_creation_input_tokens: a.cache_creation_input_tokens + b.cache_creation_input_tokens,
    cache_read_input_tokens: a.cache_read_input_tokens + b.cache_read_input_tokens,
  };
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useChatStore = create<ChatState>()((set, _get) => ({
  agentId: null,
  items: [],
  streamingContent: "",
  streamingReasoning: "",
  isStreaming: false,
  currentTurnId: null,
  model: localStorage.getItem("xolotl-selected-model") ?? DEFAULT_MODEL,
  reasoningEffort:
    (localStorage.getItem("xolotl-reasoning-effort") as ReasoningEffort | null) ?? "high",
  sessionUsage: EMPTY_USAGE,
  alwaysAllowedTools: new Set(),

  setAgentId: (id) => set({ agentId: id }),

  appendItem: (item) =>
    set((state) => ({ items: [...state.items, item] })),

  beginStream: (turnId = null) =>
    set({
      streamingContent: "",
      streamingReasoning: "",
      isStreaming: true,
      currentTurnId: turnId,
    }),

  clearStreaming: () =>
    set({
      streamingContent: "",
      streamingReasoning: "",
      isStreaming: false,
      currentTurnId: null,
    }),

  appendStreamingContent: (delta) =>
    set((state) => ({ streamingContent: state.streamingContent + delta, isStreaming: true })),

  appendStreamingReasoning: (delta) =>
    set((state) => ({
      streamingReasoning: state.streamingReasoning + delta,
      isStreaming: true,
    })),

  finalizeStream: (usage) =>
    set((state) => {
      if (!state.streamingContent && !state.streamingReasoning && !state.isStreaming) {
        return state;
      }
      if (!state.streamingContent && !state.streamingReasoning) {
        return {
          streamingContent: "",
          streamingReasoning: "",
          isStreaming: false,
          currentTurnId: null,
          sessionUsage: addUsage(state.sessionUsage, usage),
        };
      }
      const assistantMessage: Message = {
        id: generateId(),
        role: "assistant",
        content: state.streamingContent,
        reasoning: state.streamingReasoning || undefined,
        toolCalls: [],
        usage,
      };
      return {
        items: [...state.items, assistantMessage],
        streamingContent: "",
        streamingReasoning: "",
        isStreaming: false,
        currentTurnId: null,
        sessionUsage: addUsage(state.sessionUsage, usage),
      };
    }),

  cancelStream: () =>
    set((state) => {
      if (!state.streamingContent && !state.streamingReasoning && !state.isStreaming) {
        return state;
      }
      const partial = state.streamingContent + "\n\n— *generation stopped*";
      const assistantMessage: Message = {
        id: generateId(),
        role: "assistant",
        content: partial,
        reasoning: state.streamingReasoning || undefined,
        toolCalls: [],
        stopped: true,
      };
      return {
        items: [...state.items, assistantMessage],
        streamingContent: "",
        streamingReasoning: "",
        isStreaming: false,
        currentTurnId: null,
      };
    }),

  startToolCall: (toolCallId, tool, input) =>
    set((state) => {
      const toolCall: ToolCall = { id: toolCallId, tool, input, loading: true };
      // Find the last assistant message and append the tool call to it.
      // If there is no last assistant message, start streaming state.
      const items = [...state.items];
      const lastIdx = items.length - 1;
      if (lastIdx >= 0 && (items[lastIdx] as Message).role === "assistant") {
        const lastMsg = { ...(items[lastIdx] as Message) };
        lastMsg.toolCalls = [...lastMsg.toolCalls, toolCall];
        items[lastIdx] = lastMsg;
        return { items };
      }
      // No previous assistant message — this tool call came before text.
      // Create a placeholder assistant message to hold it.
      const placeholder: Message = {
        id: generateId(),
        role: "assistant",
        content: "",
        toolCalls: [toolCall],
      };
      return { items: [...items, placeholder] };
    }),

  completeToolCall: (tool, output) =>
    set((state) => {
      const items = state.items.map((item) => {
        if ((item as Message).role !== "assistant") return item;
        const msg = item as Message;
        const toolCalls = msg.toolCalls.map((tc) =>
          tc.tool === tool && tc.loading ? { ...tc, output, loading: false } : tc
        );
        return { ...msg, toolCalls };
      });
      return { items };
    }),

  insertPermissionItem: (promptId, toolName, preview) =>
    set((state) => ({
      items: [
        ...state.items,
        { type: "permission" as const, promptId, toolName, preview },
      ],
    })),

  resolvePermission: (promptId, decision) =>
    set((state) => ({
      items: state.items.map((item) => {
        if ((item as PermissionItem).type !== "permission") return item;
        const perm = item as PermissionItem;
        return perm.promptId === promptId ? { ...perm, decision } : perm;
      }),
    })),

  addAlwaysAllow: (toolName) =>
    set((state) => ({
      alwaysAllowedTools: new Set([...state.alwaysAllowedTools, toolName]),
    })),

  setModel: (model) => {
    localStorage.setItem("xolotl-selected-model", model);
    set({ model });
  },

  setReasoningEffort: (effort) => {
    localStorage.setItem("xolotl-reasoning-effort", effort);
    set({ reasoningEffort: effort });
  },

  clearSession: () =>
    set(() => ({
      agentId: null,
      items: [],
      streamingContent: "",
      streamingReasoning: "",
      isStreaming: false,
      currentTurnId: null,
      sessionUsage: EMPTY_USAGE,
      // Keep model — user's last-selected model carries to the new session
    })),

  hydrateSession: (items, model, usage) =>
    set(() => ({
      // Resuming a saved session needs a fresh agent backing it — the old
      // worktree/agent state is gone. Next user message will respawn.
      agentId: null,
      items,
      model,
      sessionUsage: usage,
      streamingContent: "",
      streamingReasoning: "",
      isStreaming: false,
      currentTurnId: null,
    })),
}));
