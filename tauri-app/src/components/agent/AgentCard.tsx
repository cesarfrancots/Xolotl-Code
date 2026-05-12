import { ChevronRight, Square } from "lucide-react";
import { Button } from "../ui/button";
import { AgentStateBadge } from "./AgentStateBadge";
import { useAgentStore, type AgentRecord } from "../../stores/agentStore";
import { useAgentPanelEvents } from "../../hooks/useAgentPanelEvents";
import { commands } from "../../bindings";

const MAX_TASK_LEN = 80;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function AgentCard({ agent }: { agent: AgentRecord }) {
  // Mount per-agent event subscription. Card lifetime drives subscription lifetime.
  useAgentPanelEvents(agent.id);

  const setExpanded = useAgentStore((s) => s.setExpandedAgent);

  async function handleStop() {
    const result = await commands.stopAgent(agent.id);
    if (result.status === "error") {
      console.error("stop_agent error:", result.error);
    }
  }

  return (
    <div className="flex flex-col gap-1 px-3 py-2 mx-2 my-1 rounded-md bg-[oklch(0.20_0_0)] hover:bg-[oklch(0.24_0_0)] border border-neutral-800">
      <div className="flex items-center justify-between gap-2">
        <AgentStateBadge state={agent.state} />
        {agent.state === "Executing" && (
          <span className="relative flex h-2 w-2 ml-1">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
          </span>
        )}
        <span className="text-xs text-[oklch(0.55_0_0)] font-mono">
          ${agent.cumulativeCost.toFixed(4)}
        </span>
      </div>
      <p className="text-sm text-[oklch(0.92_0_0)] leading-snug" title={agent.task}>
        {truncate(agent.task, MAX_TASK_LEN)}
      </p>
      {agent.branch && (
        <code className="text-xs font-mono text-[oklch(0.45_0_0)] mt-1 truncate block max-w-full">
          {agent.branch}
        </code>
      )}
      <div className="flex items-center justify-end gap-1 mt-1">
        {agent.state !== "Done" && agent.state !== "Failed" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Stop agent"
            onClick={() => void handleStop()}
          >
            <Square className="h-3 w-3" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          title="Expand"
          onClick={() => setExpanded(agent.id)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
