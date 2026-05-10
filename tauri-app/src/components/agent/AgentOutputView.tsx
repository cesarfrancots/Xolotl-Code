import { X } from "lucide-react";
import { Button } from "../ui/button";
import { useAgentStore } from "../../stores/agentStore";
import { AgentMessageList } from "./AgentMessageList";
import { AgentStateBadge } from "./AgentStateBadge";

/**
 * Read-only center pane takeover for an expanded agent's conversation.
 * Replaces ChatPane when expandedAgentId is non-null (D-04).
 * No input bar — observation only per D-05.
 *
 * Top bar: colored state badge + task description + cumulative cost + close button.
 * Body: AgentMessageList (virtualized).
 * Close button sets expandedAgentId to null, returning to ChatPane (D-06).
 */
export function AgentOutputView({ agentId }: { agentId: string }) {
  const record = useAgentStore((s) => s.agents.find((a) => a.id === agentId));
  const setExpanded = useAgentStore((s) => s.setExpandedAgent);

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-[oklch(0.11_0_0)]">
      {/* Top bar: state badge, task description, cost, close button */}
      <div className="h-12 flex-none flex items-center justify-between px-4 border-b border-neutral-800 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {record && <AgentStateBadge state={record.state} />}
          <span
            className="text-sm text-[oklch(0.92_0_0)] truncate"
            title={record?.task ?? ""}
          >
            {record?.task ?? "Unknown agent"}
          </span>
          {record && (
            <span className="text-xs text-[oklch(0.55_0_0)] font-mono flex-none">
              ${record.cumulativeCost.toFixed(4)}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 flex-none"
          title="Close agent view"
          onClick={() => setExpanded(null)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Agent message list — virtualized, read-only */}
      <div className="flex-1 min-h-0">
        <AgentMessageList agentId={agentId} />
      </div>
    </div>
  );
}
