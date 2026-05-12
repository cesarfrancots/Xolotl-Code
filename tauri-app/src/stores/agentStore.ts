import { create } from "zustand";
import type { AgentState, TokenUsage } from "../bindings";
import type { ChatItem, Message, ToolCall } from "./chatStore";

/** A group of agents launched together (team or swarm). */
export interface AgentGroup {
  id: string;
  agentIds: string[];
  mode: "team" | "swarm";
  /** State machine: Pending → AllDone → CheckpointOpen → Merged */
  mergeState: "Pending" | "AllDone" | "CheckpointOpen" | "Merged";
  name: string;
}

/** A single agent entry in the agent roster. */
export interface AgentRecord {
  id: string;
  task: string;
  model: string;
  state: AgentState;
  /** Running dollar cost accumulated from TurnCompleted events (client-side estimate). */
  cumulativeCost: number;
  /** Committed messages and tool calls for this agent. */
  messages: ChatItem[];
  /** Accumulated TextDelta content not yet committed. Flushed on TurnCompleted. */
  streamingContent: string;
  /** True while a TextDelta stream is in progress. */
  isStreaming: boolean;
  /** Worktree branch name (e.g. "agent/0-refactor-auth"). Empty string for solo agents. */
  branch: string;
  /** Group this agent belongs to, or null if spawned solo. */
  groupId: string | null;
}

export interface AgentStoreState {
  agents: AgentRecord[];
  /** ID of the agent whose output is expanded in the center pane. null = show ChatPane. */
  expandedAgentId: string | null;
  /** All active groups (teams or swarms). */
  groups: AgentGroup[];
  /** Group whose merge checkpoint is open in the center pane. null = no checkpoint open. */
  mergeCheckpointGroupId: string | null;

  /** Append a new agent to the roster with initial Idle state. */
  addAgent: (id: string, task: string, model: string, branch?: string, groupId?: string | null) => void;

  /** Create a new group with Pending mergeState. */
  addGroup: (id: string, agentIds: string[], mode: "team" | "swarm", name: string) => void;

  /** Update the mergeState of the matching group. */
  updateGroupMergeState: (groupId: string, state: AgentGroup["mergeState"]) => void;

  /** Set (or clear) the group whose merge checkpoint is open. */
  openMergeCheckpoint: (groupId: string | null) => void;

  /** Update only the state field of the matching agent. */
  updateAgentState: (id: string, state: AgentState) => void;

  /** Append a TextDelta to the agent's streaming buffer. */
  appendAgentStreamingContent: (id: string, delta: string) => void;

  /**
   * Commit streamingContent as a final assistant message.
   * Increments cumulativeCost by estimateTurnCost(usage, model).
   * No-op if nothing was streaming.
   */
  finalizeAgentStream: (id: string, usage: TokenUsage) => void;

  /**
   * Insert a ToolCall into the last assistant message's toolCalls.
   * If no assistant message exists yet, creates a placeholder.
   */
  startAgentToolCall: (id: string, toolCallId: string, tool: string, input: string) => void;

  /**
   * Resolve a ToolCall by id — set loading: false and output.
   */
  completeAgentToolCall: (id: string, toolCallId: string, output: string) => void;

  /** Append an assistant message with error content and stopped: true. */
  appendAgentError: (id: string, message: string) => void;

  /** Set (or clear) the agent displayed in the center pane. */
  setExpandedAgent: (id: string | null) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Simplified per-model cost estimate for display purposes.
 * Rates are per-1M tokens (USD). Default falls back to Sonnet pricing.
 * Authoritative enforcement is Rust-side (D-10 / AGT-06).
 */
const RATES: Record<string, { in: number; out: number }> = {
  "claude-opus-4-5": { in: 15, out: 75 },
  "claude-sonnet-4-5": { in: 3, out: 15 },
  "claude-haiku-3-5": { in: 0.8, out: 4 },
  "kimi-coding": { in: 0.15, out: 2.5 },
  "kimi2.6": { in: 0.15, out: 2.5 },
  "minimax2.7": { in: 0.3, out: 1.65 },
};

function estimateTurnCost(usage: TokenUsage, model: string): number {
  const rate = RATES[model] ?? { in: 3, out: 15 };
  return (usage.input_tokens * rate.in + usage.output_tokens * rate.out) / 1_000_000;
}

function makeInitialRecord(
  id: string,
  task: string,
  model: string,
  branch = "",
  groupId: string | null = null
): AgentRecord {
  return {
    id,
    task,
    model,
    state: "Idle",
    cumulativeCost: 0,
    messages: [],
    streamingContent: "",
    isStreaming: false,
    branch,
    groupId,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAgentStore = create<AgentStoreState>()((set) => ({
  agents: [],
  expandedAgentId: null,
  groups: [],
  mergeCheckpointGroupId: null,

  addAgent: (id, task, model, branch = "", groupId = null) =>
    set((s) => ({
      agents: [...s.agents, makeInitialRecord(id, task, model, branch, groupId)],
    })),

  addGroup: (id, agentIds, mode, name) =>
    set((s) => ({
      groups: [...s.groups, { id, agentIds, mode, mergeState: "Pending", name }],
    })),

  updateGroupMergeState: (groupId, state) =>
    set((s) => ({
      groups: s.groups.map((g) => g.id === groupId ? { ...g, mergeState: state } : g),
    })),

  openMergeCheckpoint: (groupId) => set({ mergeCheckpointGroupId: groupId }),

  updateAgentState: (id, state) =>
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === id ? { ...a, state } : a
      ),
    })),

  appendAgentStreamingContent: (id, delta) =>
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === id
          ? { ...a, streamingContent: a.streamingContent + delta, isStreaming: true }
          : a
      ),
    })),

  finalizeAgentStream: (id, usage) =>
    set((s) => ({
      agents: s.agents.map((a) => {
        if (a.id !== id) return a;
        if (!a.streamingContent && !a.isStreaming) return a;
        const assistantMessage: Message = {
          id: generateId(),
          role: "assistant",
          content: a.streamingContent,
          toolCalls: [],
          usage,
        };
        return {
          ...a,
          messages: [...a.messages, assistantMessage],
          streamingContent: "",
          isStreaming: false,
          cumulativeCost: a.cumulativeCost + estimateTurnCost(usage, a.model),
        };
      }),
    })),

  startAgentToolCall: (id, toolCallId, tool, input) =>
    set((s) => ({
      agents: s.agents.map((a) => {
        if (a.id !== id) return a;
        const newToolCall: ToolCall = { id: toolCallId, tool, input, loading: true };
        const messages = [...a.messages];
        const lastIdx = messages.length - 1;
        if (lastIdx >= 0 && (messages[lastIdx] as Message).role === "assistant") {
          const lastMsg = { ...(messages[lastIdx] as Message) };
          lastMsg.toolCalls = [...lastMsg.toolCalls, newToolCall];
          messages[lastIdx] = lastMsg;
          return { ...a, messages };
        }
        // No existing assistant message — create a placeholder to hold the tool call.
        const placeholder: Message = {
          id: generateId(),
          role: "assistant",
          content: "",
          toolCalls: [newToolCall],
        };
        return { ...a, messages: [...messages, placeholder] };
      }),
    })),

  completeAgentToolCall: (id, toolCallId, output) =>
    set((s) => ({
      agents: s.agents.map((a) => {
        if (a.id !== id) return a;
        const messages = a.messages.map((item) => {
          const msg = item as Message;
          if (msg.role !== "assistant") return item;
          const toolCalls = msg.toolCalls.map((tc) =>
            tc.id === toolCallId ? { ...tc, output, loading: false } : tc
          );
          return { ...msg, toolCalls };
        });
        return { ...a, messages };
      }),
    })),

  appendAgentError: (id, message) =>
    set((s) => ({
      agents: s.agents.map((a) => {
        if (a.id !== id) return a;
        const errorMessage: Message = {
          id: generateId(),
          role: "assistant",
          content: `⚠ Error: ${message}`,
          toolCalls: [],
          stopped: true,
        };
        return { ...a, messages: [...a.messages, errorMessage] };
      }),
    })),

  setExpandedAgent: (id) => set({ expandedAgentId: id }),
}));
