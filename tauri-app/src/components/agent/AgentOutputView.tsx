import { useState } from "react";
import { Code2, Copy, FolderOpen, X } from "lucide-react";
import { Button } from "../ui/button";
import { commands } from "../../bindings";
import { useAgentStore } from "../../stores/agentStore";
import { AgentMessageList } from "./AgentMessageList";
import { AgentStateBadge } from "./AgentStateBadge";
import { copyTextToClipboard, openPathInExternalEditor, revealPathInFinder } from "../../lib/pathActions";

type AgentWorktreeHandoffState = "idle" | "working" | "ok" | "error";

function agentWorktreeRecoveryHint(error: unknown, action: "finder" | "clipboard" | "editor"): string {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  const suffix = detail ? ` ${detail}` : "";
  switch (action) {
    case "finder":
      return `Check that the agent is still active and that macOS has allowed Xolotl Code to access the worktree folder.${suffix}`;
    case "clipboard":
      return `Check macOS clipboard access, then try copying the worktree path again.${suffix}`;
    case "editor":
      return `Check the preferred editor in macOS Settings, or use an installed app name or executable path.${suffix}`;
  }
}

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
  const [handoffState, setHandoffState] = useState<AgentWorktreeHandoffState>("idle");
  const [handoffMessage, setHandoffMessage] = useState("");
  const [handoffHint, setHandoffHint] = useState<string | undefined>(undefined);

  const runAgentWorktreeHandoff = async (
    action: "finder" | "clipboard" | "editor",
    perform: (path: string) => Promise<void>,
    successMessage: string,
    failureMessage: string,
  ) => {
    if (!record || handoffState === "working") return;
    setHandoffState("working");
    setHandoffMessage("");
    setHandoffHint(undefined);
    try {
      const pathResult = await commands.getAgentWorktreePath(record.id);
      if (pathResult.status === "error") throw new Error(pathResult.error);
      await perform(pathResult.data);
      setHandoffState("ok");
      setHandoffMessage(successMessage);
      setHandoffHint(undefined);
    } catch (error) {
      setHandoffState("error");
      setHandoffMessage(failureMessage);
      setHandoffHint(agentWorktreeRecoveryHint(error, action));
    }
  };

  const handoffWorking = handoffState === "working";

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
          {record?.branch && (
            <code className="hidden max-w-[220px] truncate text-xs font-mono text-[oklch(0.50_0.010_230)] md:block">
              {record.branch}
            </code>
          )}
        </div>
        <div className="flex flex-none items-center gap-1">
          {record && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title={handoffMessage || "Reveal agent worktree in Finder"}
                aria-label="Reveal agent worktree in Finder"
                disabled={handoffWorking}
                onClick={() => void runAgentWorktreeHandoff(
                  "finder",
                  revealPathInFinder,
                  "Agent worktree revealed in Finder.",
                  "Reveal agent worktree in Finder failed.",
                )}
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title={handoffMessage || "Copy agent worktree path"}
                aria-label="Copy agent worktree path"
                disabled={handoffWorking}
                onClick={() => void runAgentWorktreeHandoff(
                  "clipboard",
                  copyTextToClipboard,
                  "Agent worktree path copied.",
                  "Copy agent worktree path failed.",
                )}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title={handoffMessage || "Open agent worktree in editor"}
                aria-label="Open agent worktree in editor"
                disabled={handoffWorking}
                onClick={() => void runAgentWorktreeHandoff(
                  "editor",
                  openPathInExternalEditor,
                  "Agent worktree opened in the external editor.",
                  "Open agent worktree in editor failed.",
                )}
              >
                <Code2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
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
      </div>

      {handoffMessage && (
        <div
          className={[
            "flex-none border-b px-4 py-2 text-xs",
            handoffState === "error"
              ? "border-[oklch(0.34_0.035_28)] bg-[oklch(0.13_0.010_28)] text-[oklch(0.78_0.055_28)]"
              : "border-[oklch(0.24_0.020_170)] bg-[oklch(0.12_0.010_175)] text-[oklch(0.72_0.045_175)]",
          ].join(" ")}
        >
          <div className="font-medium">{handoffMessage}</div>
          {handoffHint && (
            <div className="mt-1 leading-relaxed text-[oklch(0.66_0.035_28)]">{handoffHint}</div>
          )}
        </div>
      )}

      {/* Agent message list — virtualized, read-only */}
      <div className="flex-1 min-h-0">
        <AgentMessageList agentId={agentId} />
      </div>
    </div>
  );
}
