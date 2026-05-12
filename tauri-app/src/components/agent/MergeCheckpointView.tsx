import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { DiffView } from "../chat/DiffView";
import { commands, type FileDiff } from "../../bindings";
import { useAgentStore } from "../../stores/agentStore";

/** Returns file paths touched by 2 or more agents. */
function findConflicts(diffs: { agentId: string; files: FileDiff[] }[]): Set<string> {
  const pathCounts = new Map<string, number>();
  for (const { files } of diffs) {
    for (const f of files) {
      pathCounts.set(f.path, (pathCounts.get(f.path) ?? 0) + 1);
    }
  }
  return new Set(
    [...pathCounts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([path]) => path)
  );
}

type LoadState = "loading" | "ready" | "merging" | "merged" | "error";

export function MergeCheckpointView({ groupId }: { groupId: string }) {
  const agents = useAgentStore((s) => s.agents);
  const groups = useAgentStore((s) => s.groups);
  const openMergeCheckpoint = useAgentStore((s) => s.openMergeCheckpoint);
  const updateGroupMergeState = useAgentStore((s) => s.updateGroupMergeState);

  const group = groups.find((g) => g.id === groupId);
  const agentsInGroup = agents.filter((a) => group?.agentIds.includes(a.id));

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [diffsMap, setDiffsMap] = useState<Record<string, FileDiff[]>>({});
  const [conflictPaths, setConflictPaths] = useState<Set<string>>(new Set());

  // Fetch diffs for all agents on mount
  useEffect(() => {
    if (!group || agentsInGroup.length === 0) return;

    const fetchAll = async () => {
      setLoadState("loading");
      const results = await Promise.all(
        agentsInGroup.map(async (agent) => {
          const result = await commands.getWorktreeDiff(agent.id);
          if (result.status === "error") {
            return { agentId: agent.id, files: [] as FileDiff[] };
          }
          return { agentId: agent.id, files: result.data };
        })
      );
      const newDiffsMap: Record<string, FileDiff[]> = {};
      for (const { agentId, files } of results) {
        newDiffsMap[agentId] = files;
      }
      setDiffsMap(newDiffsMap);
      setConflictPaths(findConflicts(results));
      setLoadState("ready");
    };

    void fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const anyAgentStillRunning = agentsInGroup.some(
    (a) => a.state !== "Done" && a.state !== "Failed"
  );

  async function handleMerge() {
    if (!group) return;
    setLoadState("merging");
    setErrorMessage("");
    const result = await commands.mergeWorktrees(group.id, group.agentIds);
    if (result.status === "error") {
      setLoadState("error");
      setErrorMessage(result.error);
      return;
    }
    setLoadState("merged");
    updateGroupMergeState(group.id, "Merged");
    // Auto-close after 1.5s (D-12)
    setTimeout(() => {
      openMergeCheckpoint(null);
    }, 1500);
  }

  return (
    <div className="flex flex-col h-full bg-[oklch(0.16_0_0)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 flex-none border-b border-neutral-800">
        <span className="text-sm font-semibold text-[oklch(0.92_0_0)]">Merge Checkpoint</span>
        <div className="flex items-center gap-2">
          {loadState === "loading" && (
            <>
              <Loader2 className="h-3 w-3 animate-spin text-[oklch(0.55_0_0)]" />
              <span className="text-xs text-[oklch(0.55_0_0)]">Loading…</span>
            </>
          )}
          {loadState === "merging" && (
            <>
              <Loader2 className="h-3 w-3 animate-spin text-[oklch(0.55_0_0)]" />
              <span className="text-xs text-[oklch(0.55_0_0)]">Merging…</span>
            </>
          )}
          {loadState === "merged" && (
            <span className="text-xs text-emerald-400">Merged</span>
          )}
          {loadState === "error" && (
            <span className="text-xs text-red-400">{errorMessage}</span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Close checkpoint"
            aria-label="Close checkpoint"
            onClick={() => openMergeCheckpoint(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Body: per-worktree accordion sections */}
      <ScrollArea className="flex-1">
        <div className="p-4 flex flex-col gap-4">
          {agentsInGroup.map((agent) => {
            const diffs = diffsMap[agent.id] ?? [];
            return (
              <div key={agent.id} className="flex flex-col">
                {/* Section heading */}
                <div className="flex items-center gap-2 mb-2">
                  <code className="text-xs font-mono text-[oklch(0.92_0_0)]">{agent.branch}</code>
                  <span className="text-xs text-[oklch(0.55_0_0)]">·</span>
                  <span className="text-xs text-[oklch(0.55_0_0)]">
                    {diffs.length} file{diffs.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* File accordion or empty state */}
                {diffs.length === 0 ? (
                  <div className="flex items-center gap-2 px-3 py-4 text-xs text-[oklch(0.55_0_0)] italic">
                    No file changes in this worktree.
                  </div>
                ) : (
                  <Accordion type="multiple" className="flex flex-col gap-1">
                    {diffs.map((file) => (
                      <AccordionItem
                        key={file.path}
                        value={file.path}
                        className="bg-[oklch(0.20_0_0)] rounded-md border border-neutral-800"
                      >
                        <AccordionTrigger className="px-3 py-2 text-xs font-mono text-[oklch(0.92_0_0)] hover:bg-[oklch(0.24_0_0)] rounded-md hover:no-underline">
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="truncate">{file.path}</span>
                            {conflictPaths.has(file.path) && (
                              <span className="flex-none text-xs bg-yellow-900/40 text-yellow-400 border border-yellow-800 px-2 py-1 rounded">
                                conflict
                              </span>
                            )}
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="px-0 pb-0">
                          <DiffView oldStr={file.old_content} newStr={file.new_content} />
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 flex-none border-t border-neutral-800">
        {conflictPaths.size > 0 ? (
          <span className="text-xs text-yellow-400">
            {conflictPaths.size} conflict{conflictPaths.size !== 1 ? "s" : ""} detected
          </span>
        ) : (
          <span className="text-xs text-[oklch(0.55_0_0)]">No conflicts</span>
        )}
        <Button
          disabled={loadState === "merging" || loadState === "merged" || anyAgentStillRunning}
          title={anyAgentStillRunning ? "All agents must finish before merging" : undefined}
          onClick={() => {
            if (!window.confirm("Merge all worktree branches? This cannot be undone.")) return;
            void handleMerge();
          }}
        >
          {loadState === "merging" ? "Merging…" : "Approve & Merge"}
        </Button>
      </div>
    </div>
  );
}
