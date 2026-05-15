import { MessageInput } from "./MessageInput";
import { MessageList } from "./MessageList";
import { useChatStore } from "../../stores/chatStore";
import { useUiStore } from "../../stores/uiStore";
import { useAgentEvents } from "../../hooks/useAgentEvents";
import { formatCostBar, calcTurnCost } from "../../lib/cost";
import { ChevronDown, Square, Sparkles, Check } from "lucide-react";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";
import { commands } from "../../bindings";
import { useEffect, useMemo, useState } from "react";

const PROVIDER_OF: Record<string, string> = {
  "claude-sonnet-4-6": "Anthropic",
  "claude-haiku-4-5-20251001": "Anthropic",
  "claude-opus-4-7": "Anthropic",
  "kimi2.6": "Moonshot",
  "kimi-coding": "Kimi For Coding",
  "minimax2.7": "MiniMax",
  "bedrock-claude-sonnet-4-5": "AWS Bedrock",
  "bedrock-claude-opus-4-5": "AWS Bedrock",
  "bedrock-claude-haiku-4-5": "AWS Bedrock",
  "bedrock-nova-pro": "AWS Bedrock",
  "bedrock-nova-lite": "AWS Bedrock",
  "bedrock-llama-3.3-70b": "AWS Bedrock",
};
const PROVIDER_ORDER = ["Anthropic", "AWS Bedrock", "Moonshot", "Kimi For Coding", "MiniMax", "Other"];

export function ChatPane() {
  const { model, setModel, isStreaming, sessionUsage } = useChatStore();
  const agentId = useChatStore((s) => s.agentId);
  const enabledSkills = useUiStore((s) => s.enabledSkills);
  useAgentEvents(agentId);
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
  const costBarText = formatCostBar(calcTurnCost(sessionUsage, model), totalTokens);
  const currentProvider = PROVIDER_OF[model] ?? "Other";

  const groupedModels = useMemo(() => {
    const g: Record<string, string[]> = {};
    for (const m of availableModels) {
      const p = PROVIDER_OF[m] ?? "Other";
      (g[p] ??= []).push(m);
    }
    return g;
  }, [availableModels]);

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-[oklch(0.11_0_0)]">
      <div className="h-12 flex-none flex items-center justify-between px-4 border-b border-neutral-800 bg-[oklch(0.12_0_0)]">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 gap-2 text-sm font-semibold text-[oklch(0.92_0_0)] px-2.5 -ml-2.5">
              <span className="text-[10px] uppercase tracking-wider text-[oklch(0.55_0_0)] font-normal">{currentProvider}</span>
              <span className="font-mono text-[13px]">{model.replace(/^bedrock-/, "")}</span>
              <ChevronDown className="h-3.5 w-3.5 text-[oklch(0.55_0_0)]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[280px]">
            {PROVIDER_ORDER.map((provider) => {
              const list = groupedModels[provider];
              if (!list || list.length === 0) return null;
              return (
                <div key={provider}>
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.15em] text-[oklch(0.50_0_0)] font-semibold">
                    {provider}
                  </DropdownMenuLabel>
                  {list.map((m) => (
                    <DropdownMenuItem
                      key={m}
                      onClick={() => setModel(m)}
                      className="font-mono text-xs flex items-center justify-between gap-2"
                    >
                      <span className={m === model ? "text-[oklch(0.92_0_0)]" : "text-[oklch(0.78_0_0)]"}>
                        {m.replace(/^bedrock-/, "")}
                      </span>
                      {m === model && <Check className="w-3 h-3 text-[oklch(0.65_0.18_250)]" />}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                </div>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center gap-3">
          {enabledSkills.length > 0 && (
            <span
              className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-[oklch(0.65_0.18_250)]/15 text-[oklch(0.78_0.18_250)] border border-[oklch(0.65_0.18_250)]/30"
              title={`Skills advertised to model: ${enabledSkills.join(", ")}`}
            >
              <Sparkles className="w-3 h-3" />
              {enabledSkills.length} {enabledSkills.length === 1 ? "skill" : "skills"}
            </span>
          )}
          <span className="text-xs text-[oklch(0.55_0_0)] font-mono tabular-nums">{costBarText}</span>
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
  const { agentId, cancelStream } = useChatStore();
  async function handleStop() {
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
