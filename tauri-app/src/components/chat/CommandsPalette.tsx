import { useEffect, useMemo, useState } from "react";
import {
  RotateCcw, Cpu, Save, FolderOpen, HelpCircle, Search,
  Hash, Keyboard, Paperclip, FlaskConical, GitBranch, Users, FileText, Settings2,
  DollarSign, GitPullRequest, Wrench, ListChecks, ClipboardList, BookOpen, Archive, Gauge,
  MessageSquare, TerminalSquare, TestTubeDiagonal, Sprout, Settings, FolderPlus, ExternalLink, Copy,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader } from "../ui/dialog";
import { useChatStore } from "../../stores/chatStore";
import { useSessionStore, serializeSession } from "../../stores/sessionStore";
import { useProjectStore } from "../../stores/projectStore";
import { commands } from "../../bindings";
import type { PromptCommand } from "../../bindings";
import {
  buildSlashHelpText,
  buildSessionContextReport,
  filterCustomPromptCommands,
  getWorkflowPrompt,
  slashCommandItems,
  type SlashCommandId,
} from "../../lib/chatCommands";
import { calcTurnCost, formatCostBar } from "../../lib/cost";
import { macPathLabel } from "../../lib/fileBrowser";
import { formatMacShortcut } from "../../lib/macShortcuts";
import { dispatchNativeMenuAction, type NativeMenuAction } from "../../lib/nativeMenu";
import { copyTextToClipboard, revealPathInFinder } from "../../lib/pathActions";

type CommandAction = () => void | Promise<void>;
type CommandKind = "slash" | "shortcut" | "action";

interface PaletteCommand {
  id: string;
  kind: CommandKind;
  /** Human label shown first */
  label: string;
  /** Command syntax (e.g. "/clear" or "Cmd+Enter") */
  syntax?: string;
  shortcut?: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  run?: CommandAction;
}

export function CommandsPalette({
  open, onOpenChange, onUsePrompt, customCommands = [], enableGlobalShortcut = true,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onUsePrompt?: (prompt: string) => void;
  customCommands?: PromptCommand[];
  enableGlobalShortcut?: boolean;
}) {
  const [query, setQuery] = useState("");
  const activeProjectPath = useProjectStore((s) => s.activeProjectPath);
  const projects = useProjectStore((s) => s.projects);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);

  // Global Cmd+K / Ctrl+K binding.
  useEffect(() => {
    if (!enableGlobalShortcut) return;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(true);
      }
      if (e.key === "Escape" && open) onOpenChange(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enableGlobalShortcut, open, onOpenChange]);

  // Reset query when dialog opens.
  useEffect(() => { if (open) setQuery(""); }, [open]);

  const cmds: PaletteCommand[] = useMemo(() => {
    const runNativeAction = (action: NativeMenuAction) => {
      dispatchNativeMenuAction(action);
      onOpenChange(false);
    };

    const nativeCommands: PaletteCommand[] = [
      { id: "native-new-chat", kind: "action", label: "New Chat", shortcut: "Cmd+N", description: "Start a fresh chat in the current workspace.", icon: MessageSquare, run: () => runNativeAction("new-chat") },
      { id: "native-open-folder", kind: "action", label: "Open Folder", shortcut: "Cmd+O", description: "Choose a project folder with the native picker.", icon: FolderPlus, run: () => runNativeAction("open-folder") },
      { id: "native-settings", kind: "action", label: "Settings", shortcut: "Cmd+Comma", description: "Open provider, skill, and app settings.", icon: Settings, run: () => runNativeAction("settings") },
      { id: "native-terminal-toggle", kind: "action", label: "Toggle Terminal", shortcut: "Cmd+J", description: "Show or hide the terminal dock.", icon: TerminalSquare, run: () => runNativeAction("toggle-terminal") },
      { id: "native-tab-chat", kind: "action", label: "Go to Chat", shortcut: "Cmd+1", description: "Switch the center workbench to Chat.", icon: MessageSquare, run: () => runNativeAction("tab-chat") },
      { id: "native-tab-eval", kind: "action", label: "Go to Eval", shortcut: "Cmd+2", description: "Switch the center workbench to Eval.", icon: TestTubeDiagonal, run: () => runNativeAction("tab-eval") },
      { id: "native-tab-civ", kind: "action", label: "Go to Civ", shortcut: "Cmd+3", description: "Switch the center workbench to Civ.", icon: Sprout, run: () => runNativeAction("tab-civ") },
      { id: "native-terminal-new", kind: "action", label: activeProjectPath ? "New Terminal Here" : "New Terminal", shortcut: "Cmd+T", description: activeProjectPath ? macPathLabel(activeProjectPath) : "Create a terminal tab from the current app directory.", icon: TerminalSquare, run: () => runNativeAction("terminal-new") },
      { id: "native-terminal-close", kind: "action", label: "Close Terminal Tab", shortcut: "Cmd+W", description: "Close the active terminal tab when the dock is open.", icon: TerminalSquare, run: () => runNativeAction("terminal-close") },
    ];

    const projectCommands: PaletteCommand[] = [
      ...(activeProjectPath ? [
        { id: "project-reveal", kind: "action" as const, label: "Reveal Active Project in Finder", description: macPathLabel(activeProjectPath), icon: ExternalLink, run: () => { void revealPathInFinder(activeProjectPath); onOpenChange(false); } },
        { id: "project-copy-path", kind: "action" as const, label: "Copy Active Project Path", description: macPathLabel(activeProjectPath), icon: Copy, run: () => { void copyTextToClipboard(activeProjectPath); onOpenChange(false); } },
      ] : []),
      ...projects.slice(0, 5).map((project) => ({
        id: `recent-project-${project.path}`,
        kind: "action" as const,
        label: `Open Recent: ${project.name}`,
        syntax: "Recent",
        description: macPathLabel(project.path),
        icon: FolderOpen,
        run: () => {
          setActiveProject(project.path);
          onOpenChange(false);
        },
      })),
    ];

    return [
      ...slashCommandItems.map((item) => ({
        id: item.id,
        kind: "slash" as const,
        label: slashLabel(item.id),
        syntax: item.command,
        description: item.description,
        icon: slashIcon(item.id),
        run: () => {
          runSlashCommand(item.id, onOpenChange, onUsePrompt);
        },
      })),
      ...filterCustomPromptCommands("/", customCommands).map((item) => ({
        id: `custom-${item.scope}-${item.source_path}`,
        kind: "slash" as const,
        label: item.command,
        syntax: item.scope,
        description: item.description,
        icon: FileText,
        run: () => {
          onUsePrompt?.(item.content);
          onOpenChange(false);
        },
      })),

      // Keyboard shortcuts are informational; matching actions are listed below.
      { id: "kbd-send", kind: "shortcut", label: "Send message", shortcut: "Enter", description: "Submit the composer. Shift+Enter inserts a newline instead.", icon: Keyboard },
      { id: "kbd-newline", kind: "shortcut", label: "New line", shortcut: "Shift+Enter", description: "Insert a line break without sending.", icon: Keyboard },
      { id: "kbd-palette", kind: "shortcut", label: "Open commands", shortcut: "Cmd+K", description: "Open this palette from anywhere.", icon: Keyboard },
      { id: "kbd-terminal-web", kind: "shortcut", label: "Toggle terminal fallback", shortcut: "Ctrl+Backquote", description: "Web-compatible terminal toggle for users coming from browser editors.", icon: Keyboard },
      { id: "kbd-attach", kind: "shortcut", label: "Attach files", syntax: "Drag & drop", description: "Drop text files onto the composer to attach them as fenced code blocks.", icon: Paperclip },

      ...nativeCommands,
      ...projectCommands,

      // Workflows point users at features they may not know exist.
      { id: "agents", kind: "action", label: "Spawn an agent", description: "Right sidebar: plus button. Agents work in isolated git worktrees.", icon: GitBranch },
      { id: "team", kind: "action", label: "Launch a team", description: "Right sidebar: people icon. Define roles and tasks for parallel agents.", icon: Users },
      { id: "eval", kind: "action", label: "Compare models", description: "Eval tab. Compare models on one concrete goal with blind review.", icon: FlaskConical },
      { id: "skills", kind: "action", label: "Manage skills & MCP", description: "Settings: Skills & MCP. Discovers skills from ~/.xolotl-code/skills/.", icon: Settings2 },
      { id: "files", kind: "action", label: "Attach a file", description: "Paperclip in the chat composer, or drag-drop. Supports 40+ text file types.", icon: FileText },
    ];
  }, [activeProjectPath, customCommands, onOpenChange, onUsePrompt, projects, setActiveProject]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cmds;
    return cmds.filter((c) =>
      c.label.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      (c.syntax?.toLowerCase().includes(q) ?? false) ||
      (c.shortcut?.toLowerCase().includes(q) ?? false) ||
      (c.shortcut ? formatMacShortcut(c.shortcut).toLowerCase().includes(q) : false)
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
          <kbd className="xolotl-keycap">{formatMacShortcut("Esc")}</kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          <Section title="Slash Commands" icon={Hash} items={grouped.slash} />
          <Section title="Keyboard Shortcuts" icon={Keyboard} items={grouped.shortcut} />
          <Section title="Actions & Workflows" icon={GitBranch} items={grouped.action} />
          {filtered.length === 0 && (
            <div className="px-4 py-12 text-center text-sm text-[oklch(0.50_0_0)]">
              No commands match <span className="text-[oklch(0.78_0_0)]">"{query}"</span>.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[oklch(0.22_0.008_240)] bg-[oklch(0.105_0.004_245)] px-4 py-2 text-[11px] text-[oklch(0.48_0.012_230)]">
          <span>Click a command to run it</span>
          <span><kbd className="xolotl-keycap">{formatMacShortcut("Cmd+K")}</kbd> to reopen</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function runSlashCommand(
  id: SlashCommandId,
  onOpenChange: (v: boolean) => void,
  onUsePrompt?: (prompt: string) => void,
) {
  const chat = useChatStore.getState();
  switch (id) {
    case "clear":
      chat.clearSession();
      break;
    case "model":
    case "load":
      break;
    case "save": {
      const sessionStore = useSessionStore.getState();
      const sessionId = sessionStore.activeSessionId ?? globalThis.crypto.randomUUID();
      void commands.saveSession(
        sessionId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serializeSession(sessionId, chat.model, chat.items as any, chat.sessionUsage)
      );
      break;
    }
    case "help":
      chat.appendItem({
        id: `${Date.now()}-help`,
        role: "assistant",
        content: buildSlashHelpText(),
        toolCalls: [],
      });
      break;
    case "cost": {
      const usage = chat.sessionUsage;
      const totalTokens =
        usage.input_tokens +
        usage.output_tokens +
        usage.cache_creation_input_tokens +
        usage.cache_read_input_tokens;
      chat.appendItem({
        id: `${Date.now()}-cost`,
        role: "assistant",
        content: [
          "**Session usage**",
          "",
          `Model: \`${chat.model}\``,
          `Tokens: \`${totalTokens.toLocaleString()}\``,
          `Estimate: \`${formatCostBar(calcTurnCost(usage, chat.model), totalTokens)}\``,
        ].join("\n"),
        toolCalls: [],
      });
      break;
    }
    case "context":
      chat.appendItem({
        id: `${Date.now()}-context`,
        role: "assistant",
        content: buildSessionContextReport({
          items: chat.items,
          model: chat.model,
          usage: chat.sessionUsage,
          isStreaming: chat.isStreaming,
        }),
        toolCalls: [],
      });
      break;
    case "compact": {
      const result = chat.compactSession();
      chat.appendItem({
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
    case "review":
    case "fix":
    case "test":
    case "plan":
    case "explain":
      onUsePrompt?.(getWorkflowPrompt(id));
      break;
  }
  onOpenChange(false);
}

function slashIcon(id: SlashCommandId): React.ComponentType<{ className?: string }> {
  switch (id) {
    case "clear":
      return RotateCcw;
    case "model":
      return Cpu;
    case "save":
      return Save;
    case "load":
      return FolderOpen;
    case "help":
      return HelpCircle;
    case "cost":
      return DollarSign;
    case "context":
      return Gauge;
    case "compact":
      return Archive;
    case "review":
      return GitPullRequest;
    case "fix":
      return Wrench;
    case "test":
      return ListChecks;
    case "plan":
      return ClipboardList;
    case "explain":
      return BookOpen;
  }
}

function slashLabel(id: SlashCommandId): string {
  switch (id) {
    case "clear":
      return "Clear conversation";
    case "model":
      return "Switch model";
    case "save":
      return "Save session";
    case "load":
      return "Load session";
    case "help":
      return "Show help";
    case "cost":
      return "Show usage";
    case "context":
      return "Inspect context";
    case "compact":
      return "Compact context";
    case "review":
      return "Review changes";
    case "fix":
      return "Fix a bug";
    case "test":
      return "Add tests";
    case "plan":
      return "Plan work";
    case "explain":
      return "Explain code";
  }
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
              onClick={() => { void c.run?.(); }}
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
                    <code className="xolotl-command-chip">
                      {c.syntax}
                    </code>
                  )}
                  {c.shortcut && (
                    <kbd className="xolotl-keycap" title={c.shortcut}>
                      {formatMacShortcut(c.shortcut)}
                    </kbd>
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
