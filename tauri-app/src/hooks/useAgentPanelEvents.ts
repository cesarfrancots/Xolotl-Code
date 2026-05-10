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
 * Per-agent event subscription hook — mirrors useAgentEvents.ts but writes
 * into agentStore instead of chatStore.
 *
 * Subscribes to the `agent-event:{agentId}` channel and handles:
 * - TextDelta  → buffered via rAF, flushed into appendAgentStreamingContent
 * - ToolCallStarted → generates client-side id, calls startAgentToolCall
 * - ToolCallCompleted → resolves pending tool call by tool name via stored mapping
 * - TurnCompleted → flushes rAF buffer, calls finalizeAgentStream
 * - StateChanged → calls updateAgentState; fires OS notification on Done/Failed
 * - Error → calls appendAgentError
 *
 * Cleanup on unmount: cancels pending rAF, calls all unlisten functions.
 *
 * T-5-07: rAF cancellation in cleanup prevents buffer leak on unmount.
 */
export function useAgentPanelEvents(agentId: string): void {
  const deltaBuffer = useRef<string>("");
  const rafId = useRef<number | null>(null);
  // Maps tool name → client-side toolCallId for pending (loading) tool calls.
  // Used to resolve ToolCallCompleted (which only provides tool name, not id).
  const pendingToolIds = useRef<Map<string, string>>(new Map());

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
        // Generate a client-side id — ToolCallStarted does not include one.
        const toolCallId = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        pendingToolIds.current.set(tool, toolCallId);
        useAgentStore.getState().startAgentToolCall(agentId, toolCallId, tool, input);
        return;
      }

      if ("ToolCallCompleted" in payload && payload.ToolCallCompleted) {
        const { tool, output } = payload.ToolCallCompleted;
        const toolCallId = pendingToolIds.current.get(tool) ?? tool;
        pendingToolIds.current.delete(tool);
        useAgentStore.getState().completeAgentToolCall(agentId, toolCallId, output);
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
        if (state === "Done" || state === "Failed") {
          void fireDoneNotification(agentId, state);
        }
        return;
      }

      if ("Error" in payload && payload.Error) {
        useAgentStore.getState().appendAgentError(agentId, payload.Error.message);
        return;
      }
    });

    promise
      .then((unlistenFn) => {
        unlisteners.push(unlistenFn);
      })
      .catch((err) => {
        console.error(`useAgentPanelEvents listen() failed for ${agentId}:`, err);
      });

    return () => {
      // T-5-07: cancel pending rAF to prevent buffer leak on unmount.
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

// ---------------------------------------------------------------------------
// Notification helpers
// ---------------------------------------------------------------------------

/** Lazy permission grant cache — request once, reuse across invocations. */
let notifPermissionGranted: boolean | null = null;

/**
 * Fire an OS notification when an agent transitions to Done or Failed.
 * T-5-03: title is capped at 60 chars before passing to sendNotification.
 * T-5-08: fires regardless of window focus (D-14).
 */
async function fireDoneNotification(
  agentId: string,
  state: "Done" | "Failed"
): Promise<void> {
  try {
    if (notifPermissionGranted === null) {
      const granted = await isPermissionGranted();
      notifPermissionGranted =
        granted || (await requestPermission()) === "granted";
    }
    if (!notifPermissionGranted) return;

    const record = useAgentStore.getState().agents.find((a) => a.id === agentId);
    if (!record) return;

    // T-5-03 mitigation: cap title at 60 chars (task is user-controlled input).
    const title = record.task.slice(0, 60);
    const cost = record.cumulativeCost.toFixed(4);
    await sendNotification({ title, body: `${state} — $${cost}` });
  } catch (err) {
    console.warn("notification send failed:", err);
  }
}
