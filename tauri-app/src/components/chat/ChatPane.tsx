import { MessageInput } from "./MessageInput";
import { MessageList } from "./MessageList";
import { useChatStore } from "../../stores/chatStore";
import { useUiStore } from "../../stores/uiStore";
import { useAgentEvents } from "../../hooks/useAgentEvents";
import { formatCostBar, calcTurnCost } from "../../lib/cost";
import { BadgeCheck, Folder, MoreHorizontal, Square } from "lucide-react";
import { Button } from "../ui/button";
import { commands } from "../../bindings";
import { useProjectStore, projectDisplayName } from "../../stores/projectStore";

export function ChatPane() {
  const { model, isStreaming, sessionUsage, items } = useChatStore();
  const agentId = useChatStore((s) => s.agentId);
  const enabledSkills = useUiStore((s) => s.enabledSkills);
  const activeProjectPath = useProjectStore((s) => s.activeProjectPath);
  useAgentEvents(agentId);

  const totalTokens =
    sessionUsage.input_tokens +
    sessionUsage.output_tokens +
    sessionUsage.cache_creation_input_tokens +
    sessionUsage.cache_read_input_tokens;
  const costBarText = formatCostBar(calcTurnCost(sessionUsage, model), totalTokens);
  const firstUser = items.find((item) => "role" in item && item.role === "user");
  const title =
    firstUser && "content" in firstUser
      ? firstUser.content.split(/\s+/).slice(0, 7).join(" ")
      : "New chat";

  return (
    <div className="flex-1 min-w-0 flex flex-col xolotl-chat">
      <div className="h-11 flex-none flex items-center justify-between px-4 border-b border-[oklch(0.20_0.006_245)] bg-[oklch(0.108_0.004_245)]/70 backdrop-blur-sm">
        <div className="min-w-0 flex items-center gap-2">
          <h1 className="truncate text-sm font-semibold tracking-[-0.01em] text-[oklch(0.92_0.010_220)]">
            {title}
          </h1>
          {activeProjectPath && (
            <span
              className="flex flex-none items-center gap-1 rounded-full border border-[oklch(0.28_0.018_195)] bg-[oklch(0.135_0.008_200)] px-2 py-0.5 text-[11px] text-[oklch(0.72_0.035_190)]"
              title={`Working in ${activeProjectPath}`}
            >
              <Folder className="h-3 w-3" />
              <span className="max-w-[160px] truncate">{projectDisplayName(activeProjectPath)}</span>
            </span>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="More options" title="More options" className="h-7 w-7 flex-none text-[oklch(0.52_0.012_230)]">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-none items-center gap-3 pl-3">
          {enabledSkills.length > 0 && (
            <span
              className="flex flex-none items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-[oklch(0.30_0.018_195)] bg-[oklch(0.14_0.008_195)] text-[oklch(0.72_0.035_190)]"
              title={`Skills advertised to model: ${enabledSkills.join(", ")}`}
            >
              <BadgeCheck className="w-3 h-3" />
              {enabledSkills.length} {enabledSkills.length === 1 ? "skill" : "skills"}
            </span>
          )}
          <span className="whitespace-nowrap text-xs text-[oklch(0.50_0.012_230)] font-mono tabular-nums">{costBarText}</span>
          {isStreaming && <StopButton />}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <MessageList />
      </div>

      <MessageInput />
    </div>
  );
}

function StopButton() {
  const { agentId, cancelStream, currentTurnId } = useChatStore();
  async function handleStop() {
    if (currentTurnId) {
      await commands.cancelChatTurn(currentTurnId).catch((error) => {
        console.error("cancel_chat_turn error:", error);
      });
    }
    cancelStream();
    if (agentId) {
      const result = await commands.stopAgent(agentId);
      if (result.status === "error") console.error("stop_agent error:", result.error);
    }
  }
  return (
    <Button
      variant="outline"
      size="icon"
      className="h-8 w-8 border-[oklch(0.60_0.20_25)] text-[oklch(0.60_0.20_25)] hover:bg-[oklch(0.60_0.20_25)]/10"
      title="Stop generation"
      onClick={() => void handleStop()}
    >
      <Square className="h-4 w-4 fill-current" />
    </Button>
  );
}
