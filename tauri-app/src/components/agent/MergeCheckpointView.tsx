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
  const [confirmArmed, setConfirmArmed] = useState(false);

  // Fetch diffs for all agents on mount
  useEffect(() => {
    if (!group || agentsInGroup.length === 0) return;

    const fetchAll = async () => {
      setLoadState("loading");
      setConfirmArmed(false);
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
    setConfirmArmed(false);
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
    <div className="flex h-full flex-col bg-[oklch(0.105_0.004_245)]">
      {/* Header */}
      <div className="flex h-12 flex-none items-center justify-between gap-3 border-b border-[oklch(0.22_0.008_240)] bg-[oklch(0.108_0.004_245)] px-4">
        <span className="text-sm font-semibold text-[oklch(0.90_0.015_220)]">Merge Checkpoint</span>
        <div className="flex items-center gap-2">
          {loadState === "loading" && (
            <>
              <Loader2 className="h-3 w-3 animate-spin text-[oklch(0.56_0.014_225)]" />
              <span className="text-xs text-[oklch(0.56_0.014_225)]">Loading...</span>
            </>
          )}
          {loadState === "merging" && (
            <>
              <Loader2 className="h-3 w-3 animate-spin text-[oklch(0.56_0.014_225)]" />
              <span className="text-xs text-[oklch(0.56_0.014_225)]">Merging...</span>
            </>
          )}
          {loadState === "merged" && (
            <span className="rounded-md border border-[oklch(0.34_0.025_170)] bg-[oklch(0.13_0.010_175)] px-2 py-1 text-xs text-[oklch(0.72_0.045_175)]">Merged</span>
          )}
          {loadState === "error" && (
            <span className="max-w-[240px] truncate rounded-md border border-[oklch(0.38_0.040_28)] bg-[oklch(0.13_0.014_28)] px-2 py-1 text-xs text-[oklch(0.72_0.060_28)]">{errorMessage}</span>
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
                  <code className="text-xs font-mono text-[oklch(0.84_0.015_220)]">{agent.branch}</code>
                  <span className="text-xs text-[oklch(0.42_0.010_235)]">/</span>
                  <span className="text-xs text-[oklch(0.54_0.012_225)]">
                    {diffs.length} file{diffs.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* File accordion or empty state */}
                {diffs.length === 0 ? (
                  <div className="flex items-center gap-2 px-3 py-4 text-xs text-[oklch(0.54_0.012_225)] italic">
                    No file changes in this worktree.
                  </div>
                ) : (
                  <Accordion type="multiple" className="flex flex-col gap-1">
                    {diffs.map((file) => (
                      <AccordionItem
                        key={file.path}
                        value={file.path}
                        className="rounded-md border border-[oklch(0.22_0.008_240)] bg-[oklch(0.125_0.004_245)]"
                      >
                        <AccordionTrigger className="rounded-md px-3 py-2 text-xs font-mono text-[oklch(0.86_0.015_220)] hover:bg-[oklch(0.15_0.006_245)] hover:no-underline">
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="truncate">{file.path}</span>
                            {conflictPaths.has(file.path) && (
                              <span className="flex-none rounded border border-[oklch(0.38_0.030_72)] bg-[oklch(0.13_0.010_72)] px-2 py-1 text-xs text-[oklch(0.70_0.045_72)]">
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
      <div className="flex flex-none items-center justify-between gap-3 border-t border-[oklch(0.22_0.008_240)] bg-[oklch(0.108_0.004_245)] px-4 py-3">
        <div className="min-w-0">
          {conflictPaths.size > 0 ? (
            <span className="text-xs text-[oklch(0.70_0.045_72)]">
              {conflictPaths.size} conflict{conflictPaths.size !== 1 ? "s" : ""} detected
            </span>
          ) : (
            <span className="text-xs text-[oklch(0.54_0.012_225)]">No conflicts detected</span>
          )}
          {confirmArmed && (
            <div className="mt-1 text-[11px] text-[oklch(0.64_0.035_72)]">
              Review the combined diff, then confirm merge.
            </div>
          )}
        </div>
        <Button
          disabled={loadState === "merging" || loadState === "merged" || anyAgentStillRunning}
          title={anyAgentStillRunning ? "All agents must finish before merging" : undefined}
          onClick={() => {
            if (!confirmArmed) {
              setConfirmArmed(true);
              return;
            }
            void handleMerge();
          }}
        >
          {loadState === "merging" ? "Merging..." : confirmArmed ? "Confirm Merge" : "Approve & Merge"}
        </Button>
      </div>
    </div>
  );
}
