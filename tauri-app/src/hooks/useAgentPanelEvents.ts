import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type { AgentEvent } from "../bindings";
import { useAgentStore } from "../stores/agentStore";

/**
 * Per-agent event subscription hook — mirrors useAgentEvents.ts but writes
 * into agentStore instead of chatStore.
 *
 * Subscribes to the `agent-event:{agentId}` channel and handles:
 * - TextDelta  → buffered via rAF, flushed into appendAgentStreamingContent
 * - ToolCallStarted → generates client-side id, calls startAgentToolCall
 * - ToolCallCompleted → resolves pending tool call by tool name via stored mapping
 * - TurnCompleted → flushes rAF buffer, calls finalizeAgentStream
 * - StateChanged → calls updateAgentState
 * - Error → calls appendAgentError
 *
 * Cleanup on unmount: cancels pending rAF, calls all unlisten functions.
 *
 * T-5-07: rAF cancellation in cleanup prevents buffer leak on unmount.
 */
export function useAgentPanelEvents(agentId: string): void {
  const deltaBuffer = useRef<string>("");
  const rafId = useRef<number | null>(null);
  // Maps tool name → queue of client-side toolCallIds for pending (loading) tool calls.
  // WR-01: queue (array) per tool name prevents identity collision when the same tool
  // is called concurrently — FIFO resolution on ToolCallCompleted.
  const pendingToolIds = useRef<Map<string, string[]>>(new Map());

  useEffect(() => {
    // CR-04: cancellation flag + captured unlisten handle to close the timing gap
    // where the component unmounts before listen() resolves. Without this, the
    // unlisten function is permanently lost and the Tauri listener leaks for the
    // lifetime of the app window.
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;
    const channel = `agent-event:${agentId}`;

    listen<AgentEvent>(channel, (event) => {
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
        // Generate a client-side id — ToolCallStarted does not include one.
        const toolCallId = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        // WR-01: use queue per tool name so concurrent same-tool calls don't overwrite each other
        const existing = pendingToolIds.current.get(tool) ?? [];
        pendingToolIds.current.set(tool, [...existing, toolCallId]);
        useAgentStore.getState().startAgentToolCall(agentId, toolCallId, tool, input);
        return;
      }

      if ("ToolCallCompleted" in payload && payload.ToolCallCompleted) {
        const { tool, output } = payload.ToolCallCompleted;
        // WR-01: dequeue the oldest pending id for this tool name (FIFO)
        const queue = pendingToolIds.current.get(tool) ?? [];
        const resolvedId = queue[0] ?? tool;
        pendingToolIds.current.set(tool, queue.slice(1));
        useAgentStore.getState().completeAgentToolCall(agentId, resolvedId, output);
        return;
      }

      if ("TurnCompleted" in payload && payload.TurnCompleted) {
        // Flush any pending rAF before finalizing so content is committed atomically.
        if (rafId.current !== null) {
          cancelAnimationFrame(rafId.current);
          rafId.current = null;
          const delta = deltaBuffer.current;
          deltaBuffer.current = "";
          if (delta) {
            useAgentStore.getState().appendAgentStreamingContent(agentId, delta);
          }
        }
        useAgentStore.getState().finalizeAgentStream(agentId, payload.TurnCompleted.usage);
        return;
      }

      if ("StateChanged" in payload && payload.StateChanged) {
        const state = payload.StateChanged;
        useAgentStore.getState().updateAgentState(agentId, state);
        return;
      }

      if ("Error" in payload && payload.Error) {
        useAgentStore.getState().appendAgentError(agentId, payload.Error.message);
        return;
      }
    }).then((fn) => {
      if (cancelled) {
        fn(); // component already unmounted — immediately unlisten
      } else {
        unlistenFn = fn;
      }
    }).catch((err) => {
      console.error(`useAgentPanelEvents listen() failed for ${agentId}:`, err);
    });

    return () => {
      cancelled = true;
      // T-5-07: cancel pending rAF to prevent buffer leak on unmount.
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      unlistenFn?.();
    };
  }, [agentId]);
}
