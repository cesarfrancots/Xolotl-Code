import { MessageInput } from "./MessageInput";
import { MessageList } from "./MessageList";
import { useChatStore } from "../../stores/chatStore";
import { formatCostBar } from "../../lib/cost";
import { ChevronDown, Square } from "lucide-react";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { commands } from "../../bindings";
import { useEffect, useState } from "react";

/**
 * Right pane: top bar + message list placeholder + input bar.
 * flex-1 min-w-0 flex flex-col per D-04.
 */
export function ChatPane() {
  const { model, setModel, isStreaming, sessionUsage } = useChatStore();
  const [availableModels, setAvailableModels] = useState<string[]>([model]);

  useEffect(() => {
    void commands.listModels().then((models) => {
      if (models.length > 0) setAvailableModels(models);
    });
  }, []);

  const totalTokens =
    sessionUsage.input_tokens +
    sessionUsage.output_tokens +
    sessionUsage.cache_creation_input_tokens +
    sessionUsage.cache_read_input_tokens;

  const costBarText = formatCostBar(0, totalTokens);

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-[oklch(0.11_0_0)]">
      {/* Top bar: model selector + session cost */}
      <div className="h-12 flex-none flex items-center justify-between px-4 border-b border-neutral-800">
        {/* Model selector (D-05) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 gap-1 text-sm font-semibold text-[oklch(0.92_0_0)]">
              {model}
              <ChevronDown className="h-3.5 w-3.5 text-[oklch(0.55_0_0)]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {availableModels.map((m) => (
              <DropdownMenuItem
                key={m}
                onClick={() => setModel(m)}
                className={m === model ? "font-semibold" : ""}
              >
                {m}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Session cost + stop button (D-06) */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[oklch(0.55_0_0)]">{costBarText}</span>
          {isStreaming && (
            <StopButton />
          )}
        </div>
      </div>

      {/* Message list — virtualized via MessageList (Plan 04) */}
      <div className="flex-1 min-h-0">
        <MessageList />
      </div>

      {/* Input bar */}
      <MessageInput />
    </div>
  );
}

/** Stop button shown in top bar during streaming. Calls stopAgent via Tauri. */
function StopButton() {
  const { agentId, cancelStream } = useChatStore();

  async function handleStop() {
    if (agentId) {
      cancelStream();
      const result = await commands.stopAgent(agentId);
      if (result.status === "error") {
        console.error("stop_agent error:", result.error);
      }
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
