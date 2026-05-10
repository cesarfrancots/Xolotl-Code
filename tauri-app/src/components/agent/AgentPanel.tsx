import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { useAgentStore } from "../../stores/agentStore";
import { AgentCard } from "./AgentCard";
import { SpawnAgentDialog } from "./SpawnAgentDialog";

/**
 * Right column: agent roster + "+" button to spawn new agents.
 * Width: 320px (w-80) fixed per D-02.
 * Always visible alongside the center pane (D-01).
 */
export function AgentPanel() {
  const agents = useAgentStore((s) => s.agents);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <aside className="w-80 flex-none flex flex-col border-l border-neutral-800 bg-[oklch(0.16_0_0)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 flex-none border-b border-neutral-800">
        <span className="text-xs font-normal text-[oklch(0.55_0_0)]">AGENTS</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="New agent"
          onClick={() => setDialogOpen(true)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Agent roster */}
      <ScrollArea className="flex-1">
        {agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 px-4 gap-2 text-center">
            <p className="text-sm font-semibold text-[oklch(0.92_0_0)]">No agents yet</p>
            <p className="text-xs text-[oklch(0.55_0_0)]">Click + to spawn one.</p>
          </div>
        ) : (
          <div className="flex flex-col py-2">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </ScrollArea>

      <SpawnAgentDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </aside>
  );
}
