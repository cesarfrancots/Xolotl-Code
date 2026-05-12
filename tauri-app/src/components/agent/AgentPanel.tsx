import { useState } from "react";
import { Plus, Users } from "lucide-react";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { useAgentStore } from "../../stores/agentStore";
import { useGroupWatcher } from "../../hooks/useGroupWatcher";
import { AgentCard } from "./AgentCard";
import { SpawnAgentDialog } from "./SpawnAgentDialog";
import { LaunchTeamDialog } from "./LaunchTeamDialog";

/**
 * Right column: agent roster + "+" button to spawn new agents.
 * Width: 320px (w-80) fixed per D-02.
 * Always visible alongside the center pane (D-01).
 */
export function AgentPanel() {
  const agents = useAgentStore((s) => s.agents);
  const groups = useAgentStore((s) => s.groups);
  const openMergeCheckpoint = useAgentStore((s) => s.openMergeCheckpoint);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);

  // Mount group watcher — auto-triggers merge checkpoint when all group agents complete
  useGroupWatcher();

  // Compute group → agents map and ungrouped agents
  const agentsByGroupId = new Map<string, typeof agents[0][]>();
  const ungroupedAgents: typeof agents[0][] = [];
  for (const agent of agents) {
    if (agent.groupId) {
      const arr = agentsByGroupId.get(agent.groupId) ?? [];
      arr.push(agent);
      agentsByGroupId.set(agent.groupId, arr);
    } else {
      ungroupedAgents.push(agent);
    }
  }

  const hasAnyContent = agents.length > 0 || groups.length > 0;

  return (
    <aside className="w-80 flex-none flex flex-col border-l border-neutral-800 bg-[oklch(0.16_0_0)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 flex-none border-b border-neutral-800">
        <span className="text-xs font-normal text-[oklch(0.55_0_0)]">AGENTS</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Launch team or swarm"
            aria-label="Launch team or swarm"
            onClick={() => setTeamDialogOpen(true)}
          >
            <Users className="h-4 w-4" />
          </Button>
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
      </div>

      {/* Agent roster */}
      <ScrollArea className="flex-1">
        {!hasAnyContent ? (
          <div className="flex flex-col items-center justify-center h-40 px-4 gap-2 text-center">
            <p className="text-sm font-semibold text-[oklch(0.92_0_0)]">No agents yet</p>
            <p className="text-xs text-[oklch(0.55_0_0)]">Click + to spawn one.</p>
          </div>
        ) : (
          <div className="flex flex-col py-2">
            {/* Grouped agents */}
            {groups.map((group) => {
              const groupAgents = agentsByGroupId.get(group.id) ?? [];
              const doneCount = groupAgents.filter(
                (a) => a.state === "Done" || a.state === "Failed"
              ).length;
              return (
                <div key={group.id}>
                  {/* Group header */}
                  <div className="flex items-center justify-between px-3 py-2 mx-2 mt-2 rounded-t-md bg-[oklch(0.18_0_0)] border border-neutral-800 border-b-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-semibold text-[oklch(0.92_0_0)] truncate">{group.name}</span>
                      <span className="text-xs text-[oklch(0.55_0_0)] flex-none">
                        {doneCount}/{groupAgents.length} Done
                      </span>
                    </div>
                    {(group.mergeState === "AllDone" || group.mergeState === "CheckpointOpen") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs px-2 flex-none"
                        onClick={() => openMergeCheckpoint(group.id)}
                      >
                        View Checkpoint
                      </Button>
                    )}
                  </div>
                  {/* Agent cards in group envelope */}
                  <div className="mx-2 border-x border-b border-neutral-800 rounded-b-md">
                    {groupAgents.map((agent) => (
                      <AgentCard key={agent.id} agent={agent} />
                    ))}
                  </div>
                </div>
              );
            })}
            {/* Ungrouped agents */}
            {ungroupedAgents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </ScrollArea>

      <SpawnAgentDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <LaunchTeamDialog open={teamDialogOpen} onOpenChange={setTeamDialogOpen} />
    </aside>
  );
}
