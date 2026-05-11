import { useState, useRef } from "react";
import { Send } from "lucide-react";
import { Button } from "../ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover";
import {
  Command,
  CommandList,
  CommandItem,
  CommandEmpty,
} from "../ui/command";
import { useChatStore } from "../../stores/chatStore";
import { commands } from "../../bindings";
import { useSessionStore, serializeSession } from "../../stores/sessionStore";

/**
 * Chat input: textarea + send button + slash palette.
 * Per D-11, D-12 (locked): 5 slash commands, shadcn Command as popover.
 * Per 04-UI-SPEC.md §Input Bar: min-h-[48px] max-h-[192px] auto-resize textarea.
 */
export function MessageInput() {
  const [value, setValue] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { agentId, isStreaming, setAgentId } = useChatStore();
  const { activeSessionId } = useSessionStore();

  // Slash commands with descriptions per D-11 and 04-UI-SPEC.md
  const SLASH_COMMANDS = [
    { command: "/clear", description: "Reset current session thread" },
    { command: "/model", description: "Switch model" },
    { command: "/save", description: "Save this session" },
    { command: "/load", description: "Load a saved session" },
    { command: "/help", description: "List all commands" },
  ];

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    setValue(v);
    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 192)}px`;
    }
    // Open slash palette when input starts with "/"
    setPaletteOpen(v.startsWith("/") && v.length >= 1);
  }

  // Filter commands by what the user has typed after "/"
  const filteredCommands = value.startsWith("/")
    ? SLASH_COMMANDS.filter((c) =>
        c.command.toLowerCase().startsWith(value.toLowerCase())
      )
    : SLASH_COMMANDS;

  function executeSlashCommand(cmd: string) {
    setValue("");
    setPaletteOpen(false);
    const chatStore = useChatStore.getState();
    switch (cmd) {
      case "/clear":
        chatStore.clearSession();
        break;
      case "/model":
        // Model picker is in the top bar — this just closes palette
        break;
      case "/help": {
        chatStore.appendItem({
          id: `${Date.now()}-help`,
          role: "assistant",
          content: SLASH_COMMANDS.map(
            (c) => `**${c.command}** — ${c.description}`
          ).join("\n\n"),
          toolCalls: [],
        });
        break;
      }
      case "/save": {
        const saveId = activeSessionId ?? globalThis.crypto.randomUUID();
        commands.saveSession(
          saveId,
          serializeSession(saveId, chatStore.model, chatStore.items as Parameters<typeof serializeSession>[2], chatStore.sessionUsage)
        )
          .then((result) => {
            if (result.status === "error") {
              console.error("save_session failed:", result.error);
            }
          })
          .catch((err) => console.error("save_session threw:", err));
        break;
      }
      case "/load":
        // Wave 3 wiring: trigger session sidebar focus — no-op for now
        break;
    }
  }

  async function handleSend() {
    const msg = value.trim();
    if (!msg || isStreaming) return;
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    // Append the user message to the chat immediately
    useChatStore.getState().appendItem({
      id: `${Date.now()}-user`,
      role: "user",
      content: msg,
      toolCalls: [],
    });

    // Spawn agent if not yet spawned, then run the turn
    let currentAgentId = agentId;
    if (!currentAgentId) {
      const currentModel = useChatStore.getState().model;
      const spawnResult = await commands.spawnAgent(msg, currentModel, null);
      if (spawnResult.status === "error") {
        console.error("spawn_agent error:", spawnResult.error);
        return;
      }
      currentAgentId = spawnResult.data;
      setAgentId(currentAgentId);
    }

    const turnResult = await commands.runAgentTurn(currentAgentId, msg);
    if (turnResult.status === "error") {
      console.error("run_agent_turn error:", turnResult.error);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      setPaletteOpen(false);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !paletteOpen) {
      e.preventDefault();
      void handleSend();
    }
  }

  const canSend = value.trim().length > 0 && !isStreaming;

  return (
    <div className="flex-none px-4 py-3 border-t border-neutral-800">
      <Popover open={paletteOpen} onOpenChange={setPaletteOpen}>
        <PopoverAnchor asChild>
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Message xolotl..."
              rows={1}
              className={[
                "flex-1 resize-none rounded-lg border border-neutral-700 bg-[oklch(0.20_0_0)]",
                "px-3 py-2 text-sm text-[oklch(0.92_0_0)] placeholder:text-[oklch(0.38_0_0)]",
                "min-h-[48px] max-h-[192px] overflow-y-auto",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.65_0.18_250)]",
              ].join(" ")}
              style={{ height: "48px" }}
            />
            <Button
              size="sm"
              className={[
                "h-10 w-10 flex-none",
                canSend
                  ? "bg-[oklch(0.65_0.18_250)] hover:bg-[oklch(0.60_0.18_250)] text-white"
                  : "opacity-40 cursor-not-allowed",
              ].join(" ")}
              disabled={!canSend}
              title="Send message"
              onClick={() => void handleSend()}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </PopoverAnchor>
        {/* Slash command palette (D-12) — opens above input when "/" typed */}
        <PopoverContent side="top" align="start" className="p-0 w-72 border-neutral-700">
          <Command shouldFilter={false}>
            <CommandList>
              {filteredCommands.length === 0 ? (
                <CommandEmpty className="text-xs text-[oklch(0.55_0_0)] px-4 py-3">
                  No commands match &lsquo;{value}&rsquo;.
                </CommandEmpty>
              ) : (
                filteredCommands.map((item) => (
                  <CommandItem
                    key={item.command}
                    value={item.command}
                    onSelect={() => executeSlashCommand(item.command)}
                    className="flex justify-between px-4 py-2 cursor-pointer"
                  >
                    <span className="text-sm text-[oklch(0.65_0.18_250)] font-medium">
                      {item.command}
                    </span>
                    <span className="text-xs text-[oklch(0.55_0_0)]">{item.description}</span>
                  </CommandItem>
                ))
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
