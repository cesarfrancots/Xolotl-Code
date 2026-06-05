import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { ArrowUp, Check, ChevronDown, Command as CommandIcon, FileText, Gauge, Paperclip, ShieldCheck, X } from "lucide-react";
import { CommandsPalette } from "./CommandsPalette";
import { listen } from "@tauri-apps/api/event";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover";
import {
  Command,
  CommandList,
  CommandItem,
  CommandEmpty,
} from "../ui/command";
import { useChatStore } from "../../stores/chatStore";
import { commands } from "../../bindings";
import type { AgentEvent, PromptCommand, TokenUsage } from "../../bindings";
import { useSessionStore, serializeSession } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { useProjectStore } from "../../stores/projectStore";
import { calcTurnCost, formatCostBar } from "../../lib/cost";
import {
  buildSlashHelpText,
  buildSessionContextReport,
  filterCustomPromptCommands,
  filterSlashCommands,
  findCustomPromptCommand,
  findSlashCommand,
  getWorkflowPrompt,
} from "../../lib/chatCommands";
import { extractThinkBlocks, stripThinkBlocks } from "../../lib/reasoning";
import type { Message, ReasoningEffort } from "../../stores/chatStore";

const ZERO_USAGE: TokenUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

const PROVIDER_OF: Record<string, string> = {
  "claude-sonnet-4-6": "Anthropic",
  "claude-haiku-4-5-20251001": "Anthropic",
  "claude-opus-4-7": "Anthropic",
  "kimi2.6": "Moonshot",
  "kimi-coding": "Kimi For Coding",
  "minimax2.7": "MiniMax",
  "deepseek-v4-pro": "DeepSeek",
  "deepseek-v4-flash": "DeepSeek",
  "bedrock-claude-sonnet-4-5": "AWS Bedrock",
  "bedrock-claude-opus-4-5": "AWS Bedrock",
  "bedrock-claude-haiku-4-5": "AWS Bedrock",
  "bedrock-nova-pro": "AWS Bedrock",
  "bedrock-nova-lite": "AWS Bedrock",
  "bedrock-llama-3.3-70b": "AWS Bedrock",
};
const PROVIDER_ORDER = ["Anthropic", "AWS Bedrock", "Moonshot", "Kimi For Coding", "MiniMax", "DeepSeek", "Other"];
const EFFORTS: ReasoningEffort[] = ["low", "medium", "high", "max"];

function isStandaloneGreeting(text: string): boolean {
  return /^(hi|hello|hey|yo|hiya|howdy|good morning|good afternoon|good evening)[!. ]*$/i.test(
    text.trim(),
  );
}

function assistantHistoryContent(item: Message, model: string): string {
  const extracted = extractThinkBlocks(item.content);
  const visible = stripThinkBlocks(item.content);
  const reasoning = [item.reasoning, extracted.reasoning]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (model.startsWith("minimax") && reasoning) {
    return `<think>\n${reasoning}\n</think>\n${visible}`;
  }

  return visible;
}

function modelLabel(model: string): string {
  return model
    .replace(/^bedrock-/, "")
    .replace(/^claude-/, "")
    .replace(/-20\d{6,}$/, "");
}

function effortLabel(effort: ReasoningEffort): string {
  return effort === "max" ? "Max" : effort[0].toUpperCase() + effort.slice(1);
}

/**
 * Stream one chat turn using the chat_turn Tauri command.
 *
 * Pre-subscribes to `chat-event:{turn_id}` BEFORE calling chat_turn so no
 * events are lost to a listener-not-ready race. Resolves when the backend
 * emits TurnCompleted or Error. Does NOT touch the agent/worktree system.
 */
async function streamChatTurn(
  turnId: string,
  messages: Array<{ role: string; content: string }>,
  model: string,
  enabledSkills: string[],
  reasoningEffort: ReasoningEffort,
  cwd: string | null,
): Promise<void> {
  const channel = `chat-event:${turnId}`;

  let contentBuffer = "";
  let reasoningBuffer = "";
  let rafId: number | null = null;
  let unlisten: (() => void) | null = null;

  function flush() {
    rafId = null;
    if (contentBuffer) {
      const d = contentBuffer;
      contentBuffer = "";
      useChatStore.getState().appendStreamingContent(d);
    }
    if (reasoningBuffer) {
      const d = reasoningBuffer;
      reasoningBuffer = "";
      useChatStore.getState().appendStreamingReasoning(d);
    }
  }

  function scheduleFlush() {
    if (rafId === null) rafId = requestAnimationFrame(flush);
  }

  function cleanup() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      flush();
    }
    if (unlisten) {
      unlisten();
      unlisten = null;
    }
  }

  return new Promise<void>((resolve, reject) => {
    listen<AgentEvent>(channel, (event) => {
      const payload = event.payload;
      if ("TextDelta" in payload) {
        contentBuffer += payload.TextDelta;
        scheduleFlush();
        return;
      }
      if ("ReasoningDelta" in payload) {
        reasoningBuffer += payload.ReasoningDelta;
        scheduleFlush();
        return;
      }
      if ("TurnCompleted" in payload && payload.TurnCompleted) {
        cleanup();
        useChatStore.getState().finalizeStream(payload.TurnCompleted.usage);
        // Auto-save the session after every successful turn.
        const state = useChatStore.getState();
        const sessionStore = useSessionStore.getState();
        let sessionId = sessionStore.activeSessionId;
        if (!sessionId) {
          sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          sessionStore.setActiveSessionId(sessionId);
        }
        void sessionStore.saveSession(
          sessionId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          serializeSession(sessionId, state.model, state.items as any, state.sessionUsage),
        );
        resolve();
        return;
      }
      if ("Error" in payload && payload.Error) {
        cleanup();
        const state = useChatStore.getState();
        if (state.streamingContent || state.streamingReasoning) {
          state.finalizeStream(ZERO_USAGE);
        } else {
          state.clearStreaming();
        }
        useChatStore.getState().appendItem({
          id: `${Date.now()}-err`,
          role: "assistant",
          content: `**Chat error**\n\n\`\`\`\n${payload.Error.message}\n\`\`\``,
          toolCalls: [],
        });
        resolve();
      }
    })
      .then(async (unlistenFn) => {
        unlisten = unlistenFn;
        // Subscription is live — now safe to start the turn.
        const result = await commands.chatTurn(
          turnId,
          messages,
          model,
          enabledSkills,
          reasoningEffort,
          cwd,
        );
        if (result.status === "error") {
          cleanup();
          useChatStore.getState().clearStreaming();
          reject(new Error(result.error));
        }
      })
      .catch((err) => {
        cleanup();
        useChatStore.getState().clearStreaming();
        reject(err);
      });
  });
}

/**
 * Chat input: textarea + send button + slash palette.
 * Per D-11, D-12 (locked): 5 slash commands, shadcn Command as popover.
 * Per 04-UI-SPEC.md §Input Bar: min-h-[48px] max-h-[192px] auto-resize textarea.
 */
interface Attachment {
  id: string;
  name: string;
  size: number;
  content: string;
  truncated: boolean;
}

const MAX_ATTACHMENT_BYTES = 250_000; // 250KB cap per file before truncation

const TEXT_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "kt", "swift",
  "c", "cc", "cpp", "h", "hpp", "rb", "php", "lua", "sh", "ps1",
  "json", "yaml", "yml", "toml", "ini", "env", "md", "txt", "log",
  "html", "css", "scss", "sass", "less", "xml", "sql", "graphql",
  "csv", "tsv", "vue", "svelte", "astro", "dockerfile", "gitignore",
]);

function langHint(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return "";
  return filename.slice(dot + 1).toLowerCase();
}

async function readFileAsText(file: File): Promise<Attachment> {
  const slice = file.size > MAX_ATTACHMENT_BYTES ? file.slice(0, MAX_ATTACHMENT_BYTES) : file;
  const content = await slice.text();
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: file.name,
    size: file.size,
    content,
    truncated: file.size > MAX_ATTACHMENT_BYTES,
  };
}

function buildAttachmentsBlock(atts: Attachment[]): string {
  if (atts.length === 0) return "";
  return atts.map((a) => {
    const lang = langHint(a.name);
    const header = `\`\`\`${lang}\n// ${a.name}${a.truncated ? `  (truncated to ${MAX_ATTACHMENT_BYTES / 1000}KB)` : ""}\n`;
    return `${header}${a.content}\n\`\`\``;
  }).join("\n\n");
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function MessageInput() {
  const [value, setValue] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    isStreaming,
    model,
    setModel,
    reasoningEffort,
    setReasoningEffort,
  } = useChatStore();
  const { activeSessionId } = useSessionStore();
  const [availableModels, setAvailableModels] = useState<string[]>([model]);
  const [customCommands, setCustomCommands] = useState<PromptCommand[]>([]);

  useEffect(() => {
    void commands.listModels().then((models) => {
      if (models.length > 0) setAvailableModels(models);
    });
    void commands.listPromptCommands().then(setCustomCommands).catch((error) => {
      console.error("list_prompt_commands error:", error);
    });
  }, []);

  const groupedModels = useMemo(() => {
    const grouped: Record<string, string[]> = {};
    for (const candidate of availableModels) {
      const provider = PROVIDER_OF[candidate] ?? "Other";
      (grouped[provider] ??= []).push(candidate);
    }
    return grouped;
  }, [availableModels]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const fileArr = Array.from(files);
    const accepted: Attachment[] = [];
    for (const f of fileArr) {
      const ext = langHint(f.name);
      const looksText = TEXT_EXTENSIONS.has(ext) || f.type.startsWith("text/") || (ext === "" && f.size < 100_000);
      if (!looksText) {
        console.warn(`Skipping non-text file: ${f.name}`);
        continue;
      }
      try {
        accepted.push(await readFileAsText(f));
      } catch (err) {
        console.error(`Failed to read ${f.name}:`, err);
      }
    }
    if (accepted.length > 0) setAttachments((prev) => [...prev, ...accepted]);
  }, []);

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    setValue(v);
    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
    // Open slash palette when input starts with "/"
    setPaletteOpen(v.startsWith("/") && v.length >= 1);
  }

  // Filter commands by what the user has typed after "/"
  const filteredCommands = filterSlashCommands(value);
  const filteredCustomCommands = filterCustomPromptCommands(value, customCommands);

  const seedWorkflowPrompt = useCallback((prompt: string) => {
    setValue(prompt);
    setPaletteOpen(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
      }
    });
  }, []);

  // Welcome-screen suggestion cards seed the input via a window event so the
  // empty state stays decoupled from this component's local state.
  useEffect(() => {
    const onSeed = (e: Event) => {
      const id = (e as CustomEvent<{ id?: Parameters<typeof getWorkflowPrompt>[0] }>).detail?.id;
      if (id) seedWorkflowPrompt(getWorkflowPrompt(id));
    };
    window.addEventListener("xolotl:seed-prompt", onSeed);
    return () => window.removeEventListener("xolotl:seed-prompt", onSeed);
  }, [seedWorkflowPrompt]);

  // The file browser inserts converted PDF text into the composer via this
  // event (keeps the browser decoupled from input internals).
  useEffect(() => {
    const onInsert = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text;
      if (!text) return;
      setValue((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")}\n\n${text}` : text));
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
        el.scrollTop = el.scrollHeight;
      });
    };
    window.addEventListener("xolotl:insert-text", onInsert);
    return () => window.removeEventListener("xolotl:insert-text", onInsert);
  }, []);

  function executeSlashCommand(cmd: string) {
    const command = findSlashCommand(cmd);
    const customCommand = findCustomPromptCommand(cmd, customCommands);
    if (!command && !customCommand) return;
    setValue("");
    setPaletteOpen(false);
    const chatStore = useChatStore.getState();
    if (customCommand) {
      seedWorkflowPrompt(customCommand.content);
      return;
    }
    if (!command) return;
    switch (command.id) {
      case "clear":
        chatStore.clearSession();
        break;
      case "model":
        // Model picker is in the top bar; this just closes the palette.
        break;
      case "help": {
        chatStore.appendItem({
          id: `${Date.now()}-help`,
          role: "assistant",
          content: buildSlashHelpText(),
          toolCalls: [],
        });
        break;
      }
      case "cost": {
        const usage = chatStore.sessionUsage;
        const totalTokens =
          usage.input_tokens +
          usage.output_tokens +
          usage.cache_creation_input_tokens +
          usage.cache_read_input_tokens;
        chatStore.appendItem({
          id: `${Date.now()}-cost`,
          role: "assistant",
          content: [
            "**Session usage**",
            "",
            `Model: \`${chatStore.model}\``,
            `Tokens: \`${totalTokens.toLocaleString()}\``,
            `Estimate: \`${formatCostBar(calcTurnCost(usage, chatStore.model), totalTokens)}\``,
          ].join("\n"),
          toolCalls: [],
        });
        break;
      }
      case "context": {
        chatStore.appendItem({
          id: `${Date.now()}-context`,
          role: "assistant",
          content: buildSessionContextReport({
            items: chatStore.items,
            model: chatStore.model,
            usage: chatStore.sessionUsage,
            isStreaming: chatStore.isStreaming,
          }),
          toolCalls: [],
        });
        break;
      }
      case "compact": {
        const result = chatStore.compactSession();
        chatStore.appendItem({
          id: `${Date.now()}-compact`,
          role: "assistant",
          content: result.compacted
            ? `**Session compacted**\n\nCheckpointed ${result.compactedMessages} older items and kept the latest ${result.preservedMessages}. Future turns will send the compacted context instead of the full transcript.`
            : result.reason === "streaming"
              ? "**Session not compacted**\n\nWait for the current response to finish or stop it before compacting context."
            : "**Session compacted**\n\nThere are not enough older messages to compact yet.",
          toolCalls: [],
        });
        break;
      }
      case "save": {
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
      case "load":
        // Wave 3 wiring: trigger session sidebar focus; no-op for now.
        break;
      case "review":
      case "fix":
      case "test":
      case "plan":
      case "explain":
        seedWorkflowPrompt(getWorkflowPrompt(command.id));
        break;
    }
  }

  async function handleSend() {
    const typed = value.trim();
    if ((!typed && attachments.length === 0) || isStreaming) return;

    // Compose final message: attachments first as fenced code blocks, then the
    // typed prose. If user typed nothing, the attachments stand on their own.
    const block = buildAttachmentsBlock(attachments);
    const msg = block && typed ? `${block}\n\n${typed}` : block || typed;

    setValue("");
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    // Append the user message to the chat immediately
    useChatStore.getState().appendItem({
      id: `${Date.now()}-user`,
      role: "user",
      content: msg,
      toolCalls: [],
    });

    const chatState = useChatStore.getState();
    const currentModel = chatState.model;
    const currentReasoningEffort = chatState.reasoningEffort;

    if (!block && isStandaloneGreeting(typed)) {
      useChatStore.getState().appendItem({
        id: `${Date.now()}-assistant`,
        role: "assistant",
        content: "Hi! How can I help?",
        toolCalls: [],
      });
      return;
    }

    const turnId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    useChatStore.getState().beginStream(turnId);

    function showInlineError(prefix: string, err: unknown) {
      const text = err instanceof Error ? err.message : String(err);
      console.error(`${prefix}:`, err);
      useChatStore.getState().clearStreaming();
      useChatStore.getState().appendItem({
        id: `${Date.now()}-err`,
        role: "assistant",
        content: `**${prefix}**\n\n\`\`\`\n${text}\n\`\`\``,
        toolCalls: [],
      });
    }

    // Build full message history to send to the LLM
    const historyMessages = chatState.items
      .filter((item): item is import("../../stores/chatStore").Message =>
        "role" in item && (item.role === "user" || item.role === "assistant")
      )
      .map((item) => ({
        role: item.role,
        content:
          item.role === "assistant"
            ? assistantHistoryContent(item, currentModel)
            : item.content,
      }));

    try {
      const enabledSkills = useUiStore.getState().enabledSkills;
      const cwd = useProjectStore.getState().activeProjectPath;
      await streamChatTurn(
        turnId,
        historyMessages,
        currentModel,
        enabledSkills,
        currentReasoningEffort,
        cwd,
      );
    } catch (err) {
      showInlineError("chat_turn error", err);
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

  const canSend = (value.trim().length > 0 || attachments.length > 0) && !isStreaming;

  return (
    <div
      className={[
        "flex-none px-4 pt-2 pb-4 transition-colors relative",
        dragOver
          ? "bg-[oklch(0.15_0.010_195)]/60"
          : "",
      ].join(" ")}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length > 0) void addFiles(e.dataTransfer.files);
      }}
    >
      {dragOver && (
        <div className="absolute inset-2 rounded-md border border-dashed border-[oklch(0.44_0.030_195)] flex items-center justify-center pointer-events-none bg-[oklch(0.11_0.004_245)]/88 z-10">
          <span className="text-sm text-[oklch(0.76_0.040_190)] font-medium">Drop to attach</span>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {attachments.map((a) => (
            <div
              key={a.id}
              className="group flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md bg-[oklch(0.14_0.004_245)] border border-[oklch(0.24_0.010_235)] text-xs"
              title={`${a.name} - ${fmtSize(a.size)}${a.truncated ? " (truncated)" : ""}`}
            >
              <FileText className="w-3 h-3 text-[oklch(0.62_0.035_190)] flex-none" />
              <span className="text-[oklch(0.85_0_0)] max-w-[160px] truncate">{a.name}</span>
              <span className="text-[10px] text-[oklch(0.50_0_0)] tabular-nums">{fmtSize(a.size)}</span>
              {a.truncated && <span className="text-[10px] text-[oklch(0.72_0.18_30)]">trunc</span>}
              <button
                onClick={() => removeAttachment(a.id)}
                className="w-4 h-4 rounded flex items-center justify-center text-[oklch(0.50_0_0)] hover:text-[oklch(0.85_0_0)] hover:bg-[oklch(0.25_0_0)]"
                title="Remove"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Popover open={paletteOpen} onOpenChange={setPaletteOpen}>
        <PopoverAnchor asChild>
          <div
            className={[
              "mx-auto max-w-[760px] rounded-[22px] border bg-[oklch(0.155_0.005_245)] transition-all shadow-[0_18px_45px_oklch(0_0_0_/_0.28)]",
              "focus-within:border-[oklch(0.46_0.045_195)] focus-within:shadow-[0_18px_50px_oklch(0_0_0_/_0.32),0_0_0_1px_oklch(0.46_0.045_195_/_0.32)]",
              dragOver ? "border-[oklch(0.55_0.075_190)]" : "border-[oklch(0.24_0.010_235)]",
            ].join(" ")}
          >
            <textarea
              ref={textareaRef}
              value={value}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={attachments.length > 0 ? "Add a message about these files..." : "Message xolotl..."}
              rows={1}
              className={[
                "w-full resize-none bg-transparent border-0",
                "px-3.5 pt-3 pb-1.5 text-sm text-[oklch(0.92_0.010_220)] placeholder:text-[oklch(0.42_0.010_235)]",
                "min-h-[44px] max-h-[200px] overflow-y-auto",
                "focus:outline-none",
              ].join(" ")}
              style={{ height: "44px" }}
            />
            {/* Action row */}
            <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
              <Button
                size="icon-sm" variant="ghost" type="button"
                className="text-[oklch(0.58_0.012_230)] hover:text-[oklch(0.86_0.012_220)]"
                title="Attach files (drag-drop also works)"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon-sm" variant="ghost" type="button"
                className="text-[oklch(0.58_0.012_230)] hover:text-[oklch(0.86_0.012_220)]"
                title="Commands & shortcuts (Ctrl+K)"
                onClick={() => setCommandsOpen(true)}
              >
                <CommandIcon className="h-3.5 w-3.5" />
              </Button>
              <button
                type="button"
                className="ml-0.5 flex h-7 items-center gap-1 rounded-md px-2 text-xs text-[oklch(0.68_0.050_158)] hover:bg-[oklch(0.15_0.012_180)]"
                title="Current permission mode"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Full access</span>
                <ChevronDown className="h-3 w-3" />
              </button>
              <div className="ml-auto flex min-w-0 items-center gap-1.5">
                <ModelMenu
                  model={model}
                  groupedModels={groupedModels}
                  onModel={setModel}
                />
                <EffortMenu
                  effort={reasoningEffort}
                  onEffort={setReasoningEffort}
                />
                <Button
                  size="sm"
                  className={[
                    "h-8 w-8 p-0 rounded-full transition-all",
                    canSend
                      ? "bg-[oklch(0.72_0.075_190)] hover:bg-[oklch(0.77_0.080_190)] text-[oklch(0.14_0.02_220)] shadow-[0_2px_10px_oklch(0.70_0.07_190_/_0.30)]"
                      : "bg-[oklch(0.22_0.008_240)] text-[oklch(0.45_0.010_235)] cursor-not-allowed",
                  ].join(" ")}
                  disabled={!canSend}
                  title="Send message"
                  onClick={() => void handleSend()}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </PopoverAnchor>
        {/* Slash command palette (D-12) — opens above input when "/" typed */}
        <PopoverContent side="top" align="start" className="p-0 w-72 border-[oklch(0.24_0.010_235)] bg-[oklch(0.115_0.004_245)]">
          <Command shouldFilter={false}>
            <CommandList>
              {filteredCommands.length === 0 && filteredCustomCommands.length === 0 ? (
                <CommandEmpty className="text-xs text-[oklch(0.55_0_0)] px-4 py-3">
                  No commands match &lsquo;{value}&rsquo;.
                </CommandEmpty>
              ) : (
                <>
                  {filteredCommands.map((item) => (
                    <CommandItem
                      key={item.command}
                      value={item.command}
                      onSelect={() => executeSlashCommand(item.command)}
                      className="flex justify-between px-4 py-2 cursor-pointer"
                    >
                      <span className="text-sm text-[oklch(0.66_0.040_190)] font-medium">
                        {item.command}
                      </span>
                      <span className="text-xs text-[oklch(0.55_0_0)]">{item.description}</span>
                    </CommandItem>
                  ))}
                  {filteredCustomCommands.map((item) => (
                    <CommandItem
                      key={`${item.scope}-${item.source_path}`}
                      value={item.command}
                      onSelect={() => executeSlashCommand(item.command)}
                      className="flex justify-between gap-3 px-4 py-2 cursor-pointer"
                    >
                      <span className="text-sm text-[oklch(0.76_0.040_190)] font-medium">
                        {item.command}
                      </span>
                      <span className="truncate text-xs text-[oklch(0.55_0_0)]">
                        {item.description} ({item.scope})
                      </span>
                    </CommandItem>
                  ))}
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <CommandsPalette
        open={commandsOpen}
        onOpenChange={setCommandsOpen}
        onUsePrompt={seedWorkflowPrompt}
        customCommands={customCommands}
      />
    </div>
  );
}

function ModelMenu({
  model,
  groupedModels,
  onModel,
}: {
  model: string;
  groupedModels: Record<string, string[]>;
  onModel: (model: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-7 min-w-0 max-w-[170px] items-center gap-1 overflow-hidden rounded-md px-2 text-xs text-[oklch(0.70_0.014_225)] hover:bg-[oklch(0.18_0.008_240)] hover:text-[oklch(0.88_0.012_220)]"
          title="Model"
        >
          <span className="truncate font-mono">{modelLabel(model)}</span>
          <ChevronDown className="h-3 w-3 flex-none text-[oklch(0.50_0.012_230)]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[280px]">
        {PROVIDER_ORDER.map((provider) => {
          const models = groupedModels[provider];
          if (!models || models.length === 0) return null;
          return (
            <div key={provider}>
              <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.14em] text-[oklch(0.52_0_0)]">
                {provider}
              </DropdownMenuLabel>
              {models.map((candidate) => (
                <DropdownMenuItem
                  key={candidate}
                  onClick={() => onModel(candidate)}
                  className="flex items-center justify-between gap-3 font-mono text-xs"
                >
                  <span className="truncate">{modelLabel(candidate)}</span>
                  {candidate === model && <Check className="h-3.5 w-3.5" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EffortMenu({
  effort,
  onEffort,
}: {
  effort: ReasoningEffort;
  onEffort: (effort: ReasoningEffort) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-[oklch(0.70_0.014_225)] hover:bg-[oklch(0.18_0.008_240)] hover:text-[oklch(0.88_0.012_220)]"
          title="Thinking effort"
        >
          <Gauge className="h-3.5 w-3.5" />
          <span>{effortLabel(effort)}</span>
          <ChevronDown className="h-3 w-3 text-[oklch(0.50_0.012_230)]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.14em] text-[oklch(0.52_0_0)]">
          Thinking effort
        </DropdownMenuLabel>
        {EFFORTS.map((candidate) => (
          <DropdownMenuItem
            key={candidate}
            onClick={() => onEffort(candidate)}
            className="flex items-center justify-between gap-3 text-xs"
          >
            <span>{effortLabel(candidate)}</span>
            {candidate === effort && <Check className="h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
