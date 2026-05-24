import { useEffect, useMemo, useState } from "react";
import {
  RotateCcw, Cpu, Save, FolderOpen, HelpCircle, Search,
  Hash, Keyboard, Paperclip, FlaskConical, GitBranch, Users, FileText, Settings2,
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
    // Slash commands operate on the current chat session.
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
      description: "Resume a saved session from the left sidebar.",
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
          content: cmds.filter((c) => c.kind === "slash").map((c) => `**${c.syntax}** - ${c.description}`).join("\n\n"),
          toolCalls: [],
        });
        onOpenChange(false);
      },
    },

    // Keyboard shortcuts are informational; they do not run actions.
    { id: "kbd-send", kind: "shortcut", label: "Send message", syntax: "Enter", description: "Submit the composer. Shift+Enter inserts a newline instead.", icon: Keyboard },
    { id: "kbd-newline", kind: "shortcut", label: "New line", syntax: "Shift+Enter", description: "Insert a line break without sending.", icon: Keyboard },
    { id: "kbd-palette", kind: "shortcut", label: "Open commands", syntax: "Ctrl+K", description: "Open this palette from anywhere.", icon: Keyboard },
    { id: "kbd-attach", kind: "shortcut", label: "Attach files", syntax: "Drag & drop", description: "Drop text files onto the composer to attach them as fenced code blocks.", icon: Paperclip },

    // Workflows point users at features they may not know exist.
    { id: "agents", kind: "action", label: "Spawn an agent", description: "Right sidebar: plus button. Agents work in isolated git worktrees.", icon: GitBranch },
    { id: "team", kind: "action", label: "Launch a team", description: "Right sidebar: people icon. Define roles and tasks for parallel agents.", icon: Users },
    { id: "eval", kind: "action", label: "Compare models", description: "Eval tab. Compare models on one concrete goal with blind review.", icon: FlaskConical },
    { id: "skills", kind: "action", label: "Manage skills & MCP", description: "Settings: Skills & MCP. Discovers skills from ~/.xolotl-code/skills/.", icon: Settings2 },
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
      <DialogContent className="max-w-xl w-full overflow-hidden border-[oklch(0.22_0.008_240)] bg-[oklch(0.115_0.004_245)] p-0 text-[oklch(0.90_0.015_220)]">
        <DialogHeader className="sr-only">
          <DialogTitle>Commands & shortcuts</DialogTitle>
          <DialogDescription>Searchable list of every command and keyboard shortcut.</DialogDescription>
        </DialogHeader>

        {/* Search bar */}
        <div className="flex items-center gap-2 border-b border-[oklch(0.22_0.008_240)] bg-[oklch(0.105_0.004_245)] px-4 py-3">
          <Search className="w-4 h-4 text-[oklch(0.54_0.018_205)] flex-none" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands, shortcuts, or features..."
            className="flex-1 bg-transparent outline-none text-sm text-[oklch(0.90_0.015_220)] placeholder:text-[oklch(0.42_0.012_235)]"
          />
          <kbd className="rounded border border-[oklch(0.24_0.010_235)] bg-[oklch(0.145_0.004_245)] px-1.5 py-0.5 font-mono text-[10px] text-[oklch(0.52_0.010_225)]">Esc</kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          <Section title="Slash Commands" icon={Hash} items={grouped.slash} />
          <Section title="Keyboard Shortcuts" icon={Keyboard} items={grouped.shortcut} />
          <Section title="Workflows" icon={GitBranch} items={grouped.action} />
          {filtered.length === 0 && (
            <div className="px-4 py-12 text-center text-sm text-[oklch(0.50_0_0)]">
              No commands match <span className="text-[oklch(0.78_0_0)]">"{query}"</span>.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[oklch(0.22_0.008_240)] bg-[oklch(0.105_0.004_245)] px-4 py-2 text-[11px] text-[oklch(0.48_0.012_230)]">
          <span>Click a command to run it</span>
          <span><kbd className="rounded border border-[oklch(0.24_0.010_235)] bg-[oklch(0.145_0.004_245)] px-1 py-0.5 font-mono">Ctrl+K</kbd> to reopen</span>
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
      <div className="px-4 py-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-[oklch(0.52_0.014_225)]">
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
                  ? "hover:bg-[oklch(0.16_0.006_245)] cursor-pointer"
                  : "cursor-default",
              ].join(" ")}
            >
              <Cmd className="w-4 h-4 mt-0.5 text-[oklch(0.62_0.035_190)] flex-none" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[oklch(0.90_0_0)]">{c.label}</span>
                  {c.syntax && (
                    <code className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[oklch(0.15_0.004_245)] border border-[oklch(0.24_0.010_235)] text-[oklch(0.66_0.040_190)]">
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
