import { create } from "zustand";
import type { AgentState, TokenUsage } from "../bindings";
import type { ChatItem, Message, ToolCall } from "./chatStore";

/** A single supervised agent in the roster. */
export interface AgentRecord {
  id: string;
  task: string;
  model: string;
  state: AgentState;
  cumulativeCost: number;
  messages: ChatItem[];
  streamingContent: string;
  isStreaming: boolean;
}

export interface AgentStoreState {
  agents: AgentRecord[];
  expandedAgentId: string | null;
  addAgent: (id: string, task: string, model: string) => void;
  updateAgentState: (id: string, state: AgentState) => void;
  appendAgentStreamingContent: (id: string, delta: string) => void;
  finalizeAgentStream: (id: string, usage: TokenUsage) => void;
  startAgentToolCall: (id: string, toolCallId: string, tool: string, input: string) => void;
  completeAgentToolCall: (id: string, toolCallId: string, output: string) => void;
  appendAgentError: (id: string, message: string) => void;
  setExpandedAgent: (id: string | null) => void;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const RATES: Record<string, { in: number; out: number }> = {
  "claude-sonnet-4-5": { in: 3, out: 15 },
  "claude-sonnet-4": { in: 3, out: 15 },
  "claude-opus-4": { in: 15, out: 75 },
  "kimi-k2": { in: 0.15, out: 2.5 },
  "minimax-m1": { in: 0.3, out: 1.65 },
};

function estimateTurnCost(usage: TokenUsage, model: string): number {
  const rate = RATES[model] ?? { in: 3, out: 15 };
  return (usage.input_tokens * rate.in + usage.output_tokens * rate.out) / 1_000_000;
}

export const useAgentStore = create<AgentStoreState>()((set) => ({
  agents: [],
  expandedAgentId: null,

  addAgent: (id, task, model) =>
    set((s) => ({
      agents: [
        ...s.agents,
        {
          id,
          task,
          model,
          state: "Idle",
          cumulativeCost: 0,
          messages: [],
          streamingContent: "",
          isStreaming: false,
        },
      ],
    })),

  updateAgentState: (id, state) =>
    set((s) => ({
      agents: s.agents.map((a) => (a.id === id ? { ...a, state } : a)),
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
        const toolCall: ToolCall = { id: toolCallId, tool, input, loading: true };
        const messages = [...a.messages];
        const lastIdx = messages.length - 1;
        if (lastIdx >= 0 && (messages[lastIdx] as Message).role === "assistant") {
          const lastMsg = { ...(messages[lastIdx] as Message) };
          lastMsg.toolCalls = [...lastMsg.toolCalls, toolCall];
          messages[lastIdx] = lastMsg;
          return { ...a, messages };
        }
        const placeholder: Message = {
          id: generateId(),
          role: "assistant",
          content: "",
          toolCalls: [toolCall],
        };
        return { ...a, messages: [...messages, placeholder] };
      }),
    })),

  completeAgentToolCall: (id, toolCallId, output) =>
    set((s) => ({
      agents: s.agents.map((a) => {
        if (a.id !== id) return a;
        const messages = a.messages.map((item) => {
          if ((item as Message).role !== "assistant") return item;
          const msg = item as Message;
          const toolCalls = msg.toolCalls.map((tc) =>
            tc.id === toolCallId && tc.loading ? { ...tc, output, loading: false } : tc
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
        const errorMsg: Message = {
          id: generateId(),
          role: "assistant",
          content: `⚠ Error: ${message}`,
          toolCalls: [],
          stopped: true,
        };
        return { ...a, messages: [...a.messages, errorMsg] };
      }),
    })),

  setExpandedAgent: (id) => set({ expandedAgentId: id }),
}));
