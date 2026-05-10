import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type { AgentEvent } from "../bindings";
import { useChatStore } from "../stores/chatStore";
import { commands } from "../bindings";
import { useSessionStore, serializeSession } from "../stores/sessionStore";

/**
 * Payload emitted on the "permission-request" Tauri event channel.
 * Must match PermissionRequestPayload in permission_prompter.rs.
 */
interface PermissionRequestPayload {
  prompt_id: string;
  tool_name: string;
  preview: string;
}

/**
 * Subscribe to all Tauri event channels for a given agent.
 *
 * Agent events: "agent-event:{agentId}"
 * Permission events: "permission-request" (global channel, not per-agent)
 *
 * CRITICAL PATTERNS (from RESEARCH.md):
 *
 * 1. TextDelta buffering (D-02, Pitfall 3):
 *    - Delta strings accumulate in deltaBuffer ref (NOT state).
 *    - A single rAF loop drains the buffer into Zustand via appendStreamingContent.
 *    - appendStreamingContent uses functional update — no stale closure.
 *    - Do NOT call appendStreamingContent directly from the event handler.
 *
 * 2. Listener cleanup (Pitfall 4):
 *    - listen() returns a Promise<UnlistenFn>.
 *    - Cleanup function calls unlisten() on every listener.
 *    - Two listeners: agent events + permission events.
 *
 * 3. AlwaysAllow auto-respond (Pitfall 6):
 *    - Before inserting a PermissionItem, check alwaysAllowedTools.
 *    - If the tool is in the set, call respondToPermission("AlwaysAllow") immediately.
 *    - Do NOT show the permission card for already-always-allowed tools.
 */
export function useAgentEvents(agentId: string | null) {
  const deltaBuffer = useRef<string>("");
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    if (!agentId) return;

    // Unlisten functions collected for cleanup
    const unlisteners: Array<() => void> = [];

    const agentChannel = `agent-event:${agentId}`;

    // --- Agent event listener ---
    // Synchronous event handler — no await inside
    const agentUnlistenPromise = listen<AgentEvent>(agentChannel, (event) => {
      const payload = event.payload;

      if ("TextDelta" in payload) {
        // Buffer delta; flush per rAF (D-02, Pitfall 3)
        deltaBuffer.current += payload.TextDelta;
        if (rafId.current === null) {
          rafId.current = requestAnimationFrame(() => {
            const delta = deltaBuffer.current;
            deltaBuffer.current = "";
            rafId.current = null;
            if (delta) {
              // Functional update inside appendStreamingContent — no stale closure
              useChatStore.getState().appendStreamingContent(delta);
            }
          });
        }
        return;
      }

      if ("ToolCallStarted" in payload && payload.ToolCallStarted) {
        const { tool, input } = payload.ToolCallStarted;
        // Generate a client-side id for the tool call to enable matching
        const toolCallId = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        useChatStore.getState().startToolCall(toolCallId, tool, input);
        return;
      }

      if ("ToolCallCompleted" in payload && payload.ToolCallCompleted) {
        const { tool, output } = payload.ToolCallCompleted;
        useChatStore.getState().completeToolCall(tool, output);
        return;
      }

      if ("TurnCompleted" in payload && payload.TurnCompleted) {
        const { usage } = payload.TurnCompleted;
        // Cancel any pending rAF before finalizing
        if (rafId.current !== null) {
          cancelAnimationFrame(rafId.current);
          rafId.current = null;
          // Flush remaining buffer
          const delta = deltaBuffer.current;
          deltaBuffer.current = "";
          if (delta) useChatStore.getState().appendStreamingContent(delta);
        }
        useChatStore.getState().finalizeStream(usage);

        // Auto-save session after every turn.
        const state = useChatStore.getState();
        const sessionStore = useSessionStore.getState();
        let sessionId = sessionStore.activeSessionId;
        if (!sessionId) {
          sessionId = generateSessionId();
          sessionStore.setActiveSessionId(sessionId);
        }
        void sessionStore.saveSession(
          sessionId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          serializeSession(sessionId, state.model, state.items as any, state.sessionUsage)
        );
        return;
      }

      if ("Error" in payload && payload.Error) {
        const { message } = payload.Error;
        // Commit partial content then add an error message
        if (deltaBuffer.current) {
          useChatStore.getState().appendStreamingContent(deltaBuffer.current);
          deltaBuffer.current = "";
        }
        if (rafId.current !== null) {
          cancelAnimationFrame(rafId.current);
          rafId.current = null;
        }
        useChatStore.getState().finalizeStream({
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        });
        useChatStore.getState().appendItem({
          id: `${Date.now()}-error`,
          role: "assistant",
          content: `Agent encountered an error. Check logs for details.\n\n> ${message}`,
          toolCalls: [],
        });
        return;
      }

      // StateChanged — no UI update needed beyond implicit streaming state
    });

    agentUnlistenPromise.then((fn) => unlisteners.push(fn));

    // --- Permission request listener ---
    const permUnlistenPromise = listen<PermissionRequestPayload>(
      "permission-request",
      (event) => {
        const { prompt_id, tool_name, preview } = event.payload;
        const { alwaysAllowedTools, insertPermissionItem, resolvePermission } =
          useChatStore.getState();

        // AlwaysAllow auto-respond (RESEARCH.md Pitfall 6)
        if (alwaysAllowedTools.has(tool_name)) {
          resolvePermission(prompt_id, "AlwaysAllow");
          void commands
            .respondToPermission(prompt_id, "AlwaysAllow")
            .then((result) => {
              if (result.status === "error") {
                console.error("auto respondToPermission error:", result.error);
              }
            });
          return;
        }

        // Show permission card
        insertPermissionItem(prompt_id, tool_name, preview);
      }
    );

    permUnlistenPromise.then((fn) => unlisteners.push(fn));

    // Cleanup: cancel rAF and call all unlisten functions
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

/**
 * Generates a session id without relying on crypto.randomUUID().
 * Compatible with all WebView2 versions and non-secure contexts.
 */
function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
