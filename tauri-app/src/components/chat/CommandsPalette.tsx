import { useEffect, useMemo, useState } from "react";
import {
  RotateCcw, Cpu, Save, FolderOpen, HelpCircle, Search,
  Hash, Keyboard, Paperclip, Sparkles, FlaskConical, GitBranch, Users, FileText,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader } from "../ui/dialog";
import { useChatStore } from "../../stores/chatStore";
import { useSessionStore, serializeSession } from "../../stores/sessionStore";
import { commands } from "../../bindings";

type CommandAction = () => void | Promise<void>;
type CommandKind = "slash" | "shortcut" | "action";

interface PaletteCommand {
  id: string;
  kind: CommandKind;
  /** Human label shown first */
  label: string;
  /** Command syntax (e.g. "/clear" or "Cmd+Enter") */
  syntax?: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  run?: CommandAction;
}

export function CommandsPalette({
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [query, setQuery] = useState("");

  // Global Cmd+K / Ctrl+K binding.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(true);
      }
      if (e.key === "Escape" && open) onOpenChange(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Reset query when dialog opens.
  useEffect(() => { if (open) setQuery(""); }, [open]);

  const cmds: PaletteCommand[] = useMemo(() => [
    // Slash commands — operate on the current chat session
    {
      id: "clear", kind: "slash", label: "Clear conversation", syntax: "/clear",
      description: "Reset the current thread. Existing session file remains.",
      icon: RotateCcw,
      run: () => { useChatStore.getState().clearSession(); onOpenChange(false); },
    },
    {
      id: "model", kind: "slash", label: "Switch model", syntax: "/model",
      description: "Open the model picker in the chat top bar. Per-turn model switching works mid-conversation.",
      icon: Cpu,
      run: () => onOpenChange(false),
    },
    {
      id: "save", kind: "slash", label: "Save session", syntax: "/save",
      description: "Persist the current chat to ~/.xolotl-code/sessions/.",
      icon: Save,
      run: () => {
        const sessionStore = useSessionStore.getState();
        const chat = useChatStore.getState();
        const id = sessionStore.activeSessionId ?? globalThis.crypto.randomUUID();
        void commands.saveSession(
          id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          serializeSession(id, chat.model, chat.items as any, chat.sessionUsage)
        );
        onOpenChange(false);
      },
    },
    {
      id: "load", kind: "slash", label: "Load session", syntax: "/load",
      description: "Resume a saved session — pick one from the left sidebar.",
      icon: FolderOpen,
      run: () => onOpenChange(false),
    },
    {
      id: "help", kind: "slash", label: "Show help", syntax: "/help",
      description: "Print all commands inline as a chat message.",
      icon: HelpCircle,
      run: () => {
        useChatStore.getState().appendItem({
          id: `${Date.now()}-help`,
          role: "assistant",
          content: cmds.filter((c) => c.kind === "slash").map((c) => `**${c.syntax}** — ${c.description}`).join("\n\n"),
          toolCalls: [],
        });
        onOpenChange(false);
      },
    },

    // Keyboard shortcuts — informational, no run action
    { id: "kbd-send", kind: "shortcut", label: "Send message", syntax: "Enter", description: "Submit the composer. Shift+Enter inserts a newline instead.", icon: Keyboard },
    { id: "kbd-newline", kind: "shortcut", label: "New line", syntax: "Shift+Enter", description: "Insert a line break without sending.", icon: Keyboard },
    { id: "kbd-palette", kind: "shortcut", label: "Open commands", syntax: "Ctrl+K", description: "Open this palette from anywhere.", icon: Keyboard },
    { id: "kbd-attach", kind: "shortcut", label: "Attach files", syntax: "Drag & drop", description: "Drop text files onto the composer to attach them as fenced code blocks.", icon: Paperclip },

    // Workflows — point users at features they may not know exist
    { id: "agents", kind: "action", label: "Spawn an agent", description: "Right sidebar → '+' button. Agents work in isolated git worktrees.", icon: GitBranch },
    { id: "team", kind: "action", label: "Launch a team", description: "Right sidebar → people icon. Define roles + tasks for parallel agents.", icon: Users },
    { id: "eval", kind: "action", label: "Compare models", description: "Top tabs → Eval. Race N models on the same prompt with auto-grade + HIL scoring.", icon: FlaskConical },
    { id: "skills", kind: "action", label: "Manage skills & MCP", description: "Settings → Skills & MCP. Discovers skills from ~/.xolotl-code/skills/.", icon: Sparkles },
    { id: "files", kind: "action", label: "Attach a file", description: "Paperclip in the chat composer, or drag-drop. Supports 40+ text file types.", icon: FileText },
  ], [onOpenChange]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cmds;
    return cmds.filter((c) =>
      c.label.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      (c.syntax?.toLowerCase().includes(q) ?? false)
    );
  }, [cmds, query]);

  const grouped = useMemo(() => {
    const g: Record<CommandKind, PaletteCommand[]> = { slash: [], shortcut: [], action: [] };
    for (const c of filtered) g[c.kind].push(c);
    return g;
  }, [filtered]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl w-full p-0 overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>Commands & shortcuts</DialogTitle>
          <DialogDescription>Searchable list of every command and keyboard shortcut.</DialogDescription>
        </DialogHeader>

        {/* Search bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-800">
          <Search className="w-4 h-4 text-[oklch(0.50_0_0)] flex-none" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands, shortcuts, or features…"
            className="flex-1 bg-transparent outline-none text-sm text-[oklch(0.92_0_0)] placeholder:text-[oklch(0.40_0_0)]"
          />
          <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[oklch(0.18_0_0)] border border-neutral-700 text-[oklch(0.50_0_0)]">ESC</kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          <Section title="Slash Commands" icon={Hash} items={grouped.slash} />
          <Section title="Keyboard Shortcuts" icon={Keyboard} items={grouped.shortcut} />
          <Section title="Workflows" icon={Sparkles} items={grouped.action} />
          {filtered.length === 0 && (
            <div className="px-4 py-12 text-center text-sm text-[oklch(0.50_0_0)]">
              No commands match <span className="text-[oklch(0.78_0_0)]">"{query}"</span>.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-t border-neutral-800 text-[11px] text-[oklch(0.45_0_0)] bg-[oklch(0.115_0_0)]">
          <span>Click a command to run it</span>
          <span><kbd className="font-mono px-1 py-0.5 rounded bg-[oklch(0.18_0_0)] border border-neutral-700">Ctrl+K</kbd> to reopen</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title, icon: Icon, items,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: PaletteCommand[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="py-2">
      <div className="px-4 py-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-[oklch(0.50_0_0)]">
        <Icon className="w-3 h-3" />
        {title}
      </div>
      <div className="flex flex-col">
        {items.map((c) => {
          const Cmd = c.icon;
          const interactive = !!c.run;
          return (
            <button
              key={c.id}
              onClick={() => c.run?.()}
              disabled={!interactive}
              className={[
                "flex items-start gap-3 px-4 py-2 text-left transition-colors",
                interactive
                  ? "hover:bg-[oklch(0.18_0_0)] cursor-pointer"
                  : "cursor-default",
              ].join(" ")}
            >
              <Cmd className="w-4 h-4 mt-0.5 text-[oklch(0.65_0.18_250)] flex-none" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[oklch(0.90_0_0)]">{c.label}</span>
                  {c.syntax && (
                    <code className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[oklch(0.18_0_0)] border border-neutral-700/60 text-[oklch(0.65_0.18_250)]">
                      {c.syntax}
                    </code>
                  )}
                </div>
                <div className="text-xs text-[oklch(0.55_0_0)] mt-0.5 leading-relaxed">{c.description}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
