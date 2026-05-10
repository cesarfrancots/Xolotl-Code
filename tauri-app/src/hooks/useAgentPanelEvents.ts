import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type { AgentEvent } from "../bindings";
import { useAgentStore } from "../stores/agentStore";
import {
  sendNotification,
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";

/**
 * Subscribe to per-agent Tauri events and write into the agent store.
 *
 * Mirrors useAgentEvents.ts but targets agentStore instead of chatStore.
 * Mounted by AgentCard so the subscription lifetime matches the card's lifetime.
 *
 * Patterns applied:
 * - TextDelta buffered via rAF (Pitfall 3 from RESEARCH.md)
 * - Cleanup calls all unlisten functions on unmount
 * - No permission-request handling (agents don't use the chat permission flow)
 */
export function useAgentPanelEvents(agentId: string): void {
  const deltaBuffer = useRef<string>("");
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    const channel = `agent-event:${agentId}`;

    const promise = listen<AgentEvent>(channel, (event) => {
      const payload = event.payload;

      if ("TextDelta" in payload) {
        deltaBuffer.current += payload.TextDelta;
        if (rafId.current === null) {
          rafId.current = requestAnimationFrame(() => {
            const delta = deltaBuffer.current;
            deltaBuffer.current = "";
            rafId.current = null;
            if (delta) {
              useAgentStore.getState().appendAgentStreamingContent(agentId, delta);
            }
          });
        }
        return;
      }

      if ("ToolCallStarted" in payload && payload.ToolCallStarted) {
        const { tool, input } = payload.ToolCallStarted;
        const toolCallId = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        useAgentStore.getState().startAgentToolCall(agentId, toolCallId, tool, input);
        return;
      }

      if ("ToolCallCompleted" in payload && payload.ToolCallCompleted) {
        const { tool, output } = payload.ToolCallCompleted;
        // completeAgentToolCall uses toolCallId; fall back to tool name match in store
        useAgentStore.getState().completeAgentToolCall(agentId, tool, output);
        return;
      }

      if ("TurnCompleted" in payload && payload.TurnCompleted) {
        const { usage } = payload.TurnCompleted;
        // Flush any remaining rAF buffer before finalizing
        if (rafId.current !== null) {
          cancelAnimationFrame(rafId.current);
          rafId.current = null;
          const delta = deltaBuffer.current;
          deltaBuffer.current = "";
          if (delta) {
            useAgentStore.getState().appendAgentStreamingContent(agentId, delta);
          }
        }
        useAgentStore.getState().finalizeAgentStream(agentId, usage);
        return;
      }

      if ("StateChanged" in payload && payload.StateChanged !== undefined) {
        const state = payload.StateChanged;
        useAgentStore.getState().updateAgentState(agentId, state);
        if (state === "Done" || state === "Failed") {
          void (async () => {
            try {
              let granted = await isPermissionGranted();
              if (!granted) {
                const perm = await requestPermission();
                granted = perm === "granted";
              }
              if (granted) {
                const record = useAgentStore
                  .getState()
                  .agents.find((a) => a.id === agentId);
                if (record) {
                  const title = record.task.slice(0, 60);
                  const cost = record.cumulativeCost.toFixed(4);
                  sendNotification({ title, body: `${state} — $${cost}` });
                }
              }
            } catch {
              // Notification failure is non-fatal — log silently
            }
          })();
        }
        return;
      }

      if ("Error" in payload && payload.Error) {
        const { message } = payload.Error;
        // Flush any buffered delta
        if (deltaBuffer.current) {
          useAgentStore.getState().appendAgentStreamingContent(agentId, deltaBuffer.current);
          deltaBuffer.current = "";
        }
        if (rafId.current !== null) {
          cancelAnimationFrame(rafId.current);
          rafId.current = null;
        }
        useAgentStore.getState().appendAgentError(agentId, message);
        return;
      }
    });

    promise.then((fn) => unlisteners.push(fn));

    return () => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [agentId]);
}
