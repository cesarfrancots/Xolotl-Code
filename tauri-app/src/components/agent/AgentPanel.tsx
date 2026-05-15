import { useState } from "react";
import { CirclePlus, UsersRound, PanelRightClose, PanelRightOpen, BotMessageSquare, Bot } from "lucide-react";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { useAgentStore } from "../../stores/agentStore";
import { useUiStore } from "../../stores/uiStore";
import { useGroupWatcher } from "../../hooks/useGroupWatcher";
import { AgentCard } from "./AgentCard";
import { SpawnAgentDialog } from "./SpawnAgentDialog";
import { LaunchTeamDialog } from "./LaunchTeamDialog";

/**
 * Right column: agent roster + spawn buttons.
 * Expanded: 320px (w-80). Collapsed: 48px icon-rail.
 */
export function AgentPanel() {
  const agents = useAgentStore((s) => s.agents);
  const groups = useAgentStore((s) => s.groups);
  const openMergeCheckpoint = useAgentStore((s) => s.openMergeCheckpoint);
  const setExpandedAgent = useAgentStore((s) => s.setExpandedAgent);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const collapsed = useUiStore((s) => s.agentsCollapsed);
  const toggleCollapsed = useUiStore((s) => s.toggleAgents);

  useGroupWatcher();

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
  const runningCount = agents.filter((a) => a.state === "Executing" || a.state === "Planning").length;

  return (
    <aside
      className={[
        "flex-none flex flex-col border-l border-neutral-800 bg-[oklch(0.155_0_0)]",
        "transition-[width] duration-200 ease-out",
        collapsed ? "w-12" : "w-80",
      ].join(" ")}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-2 h-12 flex-none border-b border-neutral-800">
        {collapsed ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 mx-auto text-[oklch(0.65_0.18_250)] relative"
            title="Expand agents"
            onClick={toggleCollapsed}
          >
            <BotMessageSquare className="h-4 w-4" />
            {runningCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            )}
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="Collapse sidebar"
              onClick={toggleCollapsed}
            >
              <PanelRightClose className="h-3.5 w-3.5" />
            </Button>
            <div className="flex items-center gap-1.5 pr-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[oklch(0.55_0_0)]">
              Agents
              {runningCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono normal-case tracking-normal">
                  {runningCount} live
                </span>
              )}
              <BotMessageSquare className="h-3.5 w-3.5" />
            </div>
          </>
        )}
      </div>

      {/* Action row */}
      <div className={["flex-none flex items-center border-b border-neutral-800/60", collapsed ? "flex-col gap-1 py-2" : "gap-1 px-2 py-1.5"].join(" ")}>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="New agent"
          onClick={() => setDialogOpen(true)}
        >
          <CirclePlus className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="Launch team or swarm"
          onClick={() => setTeamDialogOpen(true)}
        >
          <UsersRound className="h-4 w-4" />
        </Button>
        {collapsed && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 mt-1 text-[oklch(0.45_0_0)]"
            title="Expand sidebar"
            onClick={toggleCollapsed}
          >
            <PanelRightOpen className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Roster */}
      {collapsed ? (
        <div className="flex-1 flex flex-col items-center gap-1 py-2 overflow-y-auto">
          {agents.slice(0, 12).map((agent) => {
            const dotClass =
              agent.state === "Executing" || agent.state === "Planning" ? "bg-blue-500 animate-pulse" :
              agent.state === "Done"      ? "bg-green-500" :
              agent.state === "Failed"    ? "bg-red-500" :
              agent.state === "Waiting"   ? "bg-yellow-400" :
                                            "bg-neutral-500";
            return (
              <button
                key={agent.id}
                onClick={() => setExpandedAgent(agent.id)}
                title={agent.task}
                className="w-8 h-8 flex-none rounded-md text-[oklch(0.50_0_0)] hover:bg-[oklch(0.20_0_0)] hover:text-[oklch(0.85_0_0)] flex items-center justify-center relative"
              >
                <Bot className="h-3.5 w-3.5" />
                <span className={`absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full ${dotClass}`} />
              </button>
            );
          })}
        </div>
      ) : (
        <ScrollArea className="flex-1">
          {!hasAnyContent ? (
            <EmptyState />
          ) : (
            <div className="flex flex-col py-2">
              {groups.map((group) => {
                const groupAgents = agentsByGroupId.get(group.id) ?? [];
                const doneCount = groupAgents.filter(
                  (a) => a.state === "Done" || a.state === "Failed"
                ).length;
                return (
                  <div key={group.id}>
                    <div className="flex items-center justify-between px-3 py-2 mx-2 mt-2 rounded-t-md bg-[oklch(0.18_0_0)] border border-neutral-800 border-b-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <UsersRound className="w-3 h-3 text-[oklch(0.55_0_0)] flex-none" />
                        <span className="text-xs font-semibold text-[oklch(0.92_0_0)] truncate">{group.name}</span>
                        <span className="text-xs text-[oklch(0.55_0_0)] flex-none">
                          {doneCount}/{groupAgents.length}
                        </span>
                      </div>
                      {(group.mergeState === "AllDone" || group.mergeState === "CheckpointOpen") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs px-2 flex-none"
                          onClick={() => openMergeCheckpoint(group.id)}
                        >
                          Checkpoint
                        </Button>
                      )}
                    </div>
                    <div className="mx-2 border-x border-b border-neutral-800 rounded-b-md">
                      {groupAgents.map((agent) => (
                        <AgentCard key={agent.id} agent={agent} />
                      ))}
                    </div>
                  </div>
                );
              })}
              {ungroupedAgents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          )}
        </ScrollArea>
      )}

      <SpawnAgentDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <LaunchTeamDialog open={teamDialogOpen} onOpenChange={setTeamDialogOpen} />
    </aside>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-44 px-6 gap-2 text-center">
      <div className="w-10 h-10 rounded-full bg-[oklch(0.20_0_0)] flex items-center justify-center mb-1">
        <BotMessageSquare className="w-5 h-5 text-[oklch(0.45_0_0)]" />
      </div>
      <p className="text-sm font-medium text-[oklch(0.85_0_0)]">No agents yet</p>
      <p className="text-xs text-[oklch(0.50_0_0)] leading-relaxed">
        Spawn one with <CirclePlus className="inline w-3 h-3" /> or launch a team with <UsersRound className="inline w-3 h-3" />.
      </p>
    </div>
  );
}
