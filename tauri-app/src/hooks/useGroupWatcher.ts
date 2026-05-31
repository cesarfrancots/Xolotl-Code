import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAgentStore } from "../stores/agentStore";

/**
 * Watches agent states for group completion.
 * When all agents in a Pending group reach Done or Failed,
 * transitions the group to AllDone and opens the merge checkpoint.
 *
 * Also listens for "group-state-changed" Tauri events emitted
 * after merge_worktrees completes, to set mergeState "Merged" and close.
 *
 * Mount once in AgentPanel (Wave 3).
 */
export function useGroupWatcher(): void {
  const agents = useAgentStore((s) => s.agents);
  const groups = useAgentStore((s) => s.groups);

  // Watch agent states → trigger AllDone transition
  useEffect(() => {
    for (const group of groups) {
      if (group.mergeState !== "Pending") continue;
      const groupAgents = agents.filter((a) => group.agentIds.includes(a.id));
      if (groupAgents.length === 0) continue;
      const allTerminal = groupAgents.every(
        (a) => a.state === "Done" || a.state === "Failed"
      );
      if (allTerminal) {
        useAgentStore.getState().updateGroupMergeState(group.id, "AllDone");
        useAgentStore.getState().openMergeCheckpoint(group.id);
      }
    }
  }, [agents, groups]);

  // Listen for Rust merge completion event
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<{ groupId: string; state: string }>("group-state-changed", (event) => {
      const { groupId, state } = event.payload;
      if (state === "Merged") {
        useAgentStore.getState().updateGroupMergeState(groupId, "Merged");
        // Auto-close checkpoint after 1.5s (D-12)
        setTimeout(() => {
          useAgentStore.getState().openMergeCheckpoint(null);
        }, 1500);
      }
    }).then((fn) => {
      // If the effect was already cleaned up before listen() resolved, tear the
      // listener down immediately instead of leaking it.
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []); // mount once — event listener for group-state-changed
}
