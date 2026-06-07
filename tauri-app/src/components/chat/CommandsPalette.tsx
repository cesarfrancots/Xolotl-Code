import { useEffect, useMemo, useState } from "react";
import {
  RotateCcw, Cpu, Save, FolderOpen, HelpCircle, Search,
  Hash, Keyboard, Paperclip, FlaskConical, GitBranch, Users, FileText, Settings2,
  DollarSign, GitPullRequest, Wrench, ListChecks, ClipboardList, BookOpen, Archive, Gauge,
  MessageSquare, TerminalSquare, TestTubeDiagonal, Sprout, Settings, FolderPlus, ExternalLink, Copy,
  AlertCircle, CheckCircle, Clipboard, Code2, CornerDownRight, CornerLeftUp, Eye, Folder, Link2, RefreshCw,
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
import { directoryChildBadges, macPathLabel, visibleDirectoryChildren } from "../../lib/fileBrowser";
import { MAC_COMMANDS, type MacCommandId, type MacCommandSpec } from "../../lib/macCommandModel";
import { formatMacShortcut } from "../../lib/macShortcuts";
import { dispatchNativeMenuAction, type NativeMenuAction } from "../../lib/nativeMenu";
import { copyProjectContextHandoff, copyTextToClipboard, copyXolotlCodeOpenShellCommand, copyXolotlCodeOpenUrl, openPathInExternalEditor, openPathInExternalTerminal, quickLookPath, readTextFromClipboard, relativePathFromRoot, revealPathInFinder } from "../../lib/pathActions";
import { openTerminalAtPath } from "../../lib/terminalActions";
import { useMacDialogDismissal } from "../../hooks/useMacDialogDismissal";

type CommandAction = () => void | Promise<void>;
type CommandKind = "slash" | "shortcut" | "file" | "action";
type PaletteStatusTone = "working" | "ok" | "error";

export const SEED_COMPOSER_PROMPT_EVENT = "xolotl:seed-composer-prompt";
const MAX_CLIPBOARD_PROMPT_CHARS = 24_000;
export type ClipboardPromptMode = "chat" | "explain";

interface PaletteSecondaryAction {
  id: string;
  label: string;
  title?: string;
  icon: React.ComponentType<{ className?: string }>;
  run: CommandAction;
}

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
  secondaryActions?: PaletteSecondaryAction[];
}

interface PaletteStatus {
  tone: PaletteStatusTone;
  message: string;
  hint?: string;
}

type MacHandoffHintKey = "clipboard" | "editor" | "finder" | "quick-look" | "terminal";

const MAC_COMMAND_ICONS: Record<MacCommandId, React.ComponentType<{ className?: string }>> = {
  "new-chat": MessageSquare,
  "open-folder": FolderPlus,
  settings: Settings,
  commands: Keyboard,
  "toggle-terminal": TerminalSquare,
  "tab-chat": MessageSquare,
  "tab-eval": TestTubeDiagonal,
  "tab-civ": Sprout,
  "terminal-new": TerminalSquare,
  "terminal-close": TerminalSquare,
  "terminal-prev": TerminalSquare,
  "terminal-next": TerminalSquare,
};

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
  const [status, setStatus] = useState<PaletteStatus | null>(null);
  const activeProjectPath = useProjectStore((s) => s.activeProjectPath);
  const projects = useProjectStore((s) => s.projects);
  const listing = useProjectStore((s) => s.listing);
  const browse = useProjectStore((s) => s.browse);
  const refreshBrowse = useProjectStore((s) => s.refreshBrowse);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  useMacDialogDismissal(open, onOpenChange);

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
  useEffect(() => {
    if (open) {
      setQuery("");
      setStatus(null);
    }
  }, [open]);

  const cmds: PaletteCommand[] = useMemo(() => {
    const runNativeAction = (action: NativeMenuAction) => {
      dispatchNativeMenuAction(action);
      onOpenChange(false);
    };
    const seedPrompt = (prompt: string) => {
      if (onUsePrompt) {
        onUsePrompt(prompt);
      } else {
        dispatchNativeMenuAction("tab-chat");
        window.dispatchEvent(new CustomEvent(SEED_COMPOSER_PROMPT_EVENT, { detail: { prompt } }));
      }
      onOpenChange(false);
    };
    const runClipboardPrompt = async (mode: ClipboardPromptMode) => {
      try {
        seedPrompt(buildClipboardPrompt(mode, await readTextFromClipboard()));
      } catch (err) {
        setStatus({
          tone: "error",
          message: "Could not read the clipboard.",
          hint: macHandoffRecoveryHint("clipboard", err),
        });
      }
    };
    const runMacHandoff = async (
      label: string,
      action: () => void | Promise<void>,
      hintKey: MacHandoffHintKey,
    ) => {
      setStatus({ tone: "working", message: `${label}...` });
      try {
        await action();
        onOpenChange(false);
      } catch (err) {
        setStatus({
          tone: "error",
          message: `${label} failed.`,
          hint: macHandoffRecoveryHint(hintKey, err),
        });
      }
    };

    const nativeCommands: PaletteCommand[] = MAC_COMMANDS
      .filter((command) => command.id !== "commands")
      .map((command) => paletteCommandFromMacCommand(command, runNativeAction, activeProjectPath));

    const activeProject = activeProjectPath
      ? projects.find((project) => project.path === activeProjectPath)
      : null;
    const projectCommands: PaletteCommand[] = [
      ...(activeProjectPath ? [
        { id: "project-reveal", kind: "action" as const, label: "Reveal Active Project in Finder", description: macPathLabel(activeProjectPath), icon: ExternalLink, run: () => runMacHandoff("Reveal in Finder", () => revealPathInFinder(activeProjectPath), "finder") },
        { id: "project-terminal", kind: "action" as const, label: "New Terminal in Active Project", description: macPathLabel(activeProjectPath), icon: TerminalSquare, run: () => { openTerminalAtPath(activeProjectPath, activeProject?.name); onOpenChange(false); } },
        { id: "project-copy-path", kind: "action" as const, label: "Copy Active Project Path", description: macPathLabel(activeProjectPath), icon: Copy, run: () => runMacHandoff("Copy project path", () => copyTextToClipboard(activeProjectPath), "clipboard") },
        { id: "project-copy-link", kind: "action" as const, label: "Copy Active Project Xolotl Link", description: macPathLabel(activeProjectPath), icon: Link2, run: () => runMacHandoff("Copy Xolotl link", () => copyXolotlCodeOpenUrl(activeProjectPath), "clipboard") },
        { id: "project-copy-shell-open", kind: "action" as const, label: "Copy Active Project Shell Open Command", description: "Terminal/Raycast/Alfred command for opening this project in Xolotl Code.", icon: TerminalSquare, run: () => runMacHandoff("Copy shell open command", () => copyXolotlCodeOpenShellCommand(activeProjectPath), "clipboard") },
        { id: "project-copy-context", kind: "action" as const, label: "Copy Active Project Context Prompt", description: "Path and Xolotl link for Shortcuts, Raycast, Alfred, or shell handoff.", icon: ClipboardList, run: () => runMacHandoff("Copy project context", () => copyProjectContextHandoff(activeProjectPath, activeProject?.name), "clipboard") },
        { id: "project-open-editor", kind: "action" as const, label: "Open Active Project in Editor", description: macPathLabel(activeProjectPath), icon: Code2, run: () => runMacHandoff("Open in editor", () => openPathInExternalEditor(activeProjectPath), "editor") },
        { id: "project-open-terminal", kind: "action" as const, label: "Open Active Project in External Terminal", description: macPathLabel(activeProjectPath), icon: TerminalSquare, run: () => runMacHandoff("Open in external terminal", () => openPathInExternalTerminal(activeProjectPath), "terminal") },
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
        secondaryActions: [
          {
            id: "reveal",
            label: `Reveal recent project ${project.name} in Finder`,
            title: "Reveal in Finder",
            icon: ExternalLink,
            run: () => runMacHandoff("Reveal in Finder", () => revealPathInFinder(project.path), "finder"),
          },
          {
            id: "terminal",
            label: `New terminal in recent project ${project.name}`,
            title: "New Terminal Here",
            icon: TerminalSquare,
            run: () => { openTerminalAtPath(project.path, project.name); onOpenChange(false); },
          },
          {
            id: "copy-posix",
            label: `Copy POSIX path for recent project ${project.name}`,
            title: "Copy POSIX path",
            icon: Copy,
            run: () => runMacHandoff("Copy project path", () => copyTextToClipboard(project.path), "clipboard"),
          },
          {
            id: "copy-link",
            label: `Copy Xolotl link for recent project ${project.name}`,
            title: "Copy Xolotl link",
            icon: Link2,
            run: () => runMacHandoff("Copy Xolotl link", () => copyXolotlCodeOpenUrl(project.path), "clipboard"),
          },
          {
            id: "copy-shell-open",
            label: `Copy shell open command for recent project ${project.name}`,
            title: "Copy shell open command",
            icon: TerminalSquare,
            run: () => runMacHandoff("Copy shell open command", () => copyXolotlCodeOpenShellCommand(project.path), "clipboard"),
          },
          {
            id: "copy-context",
            label: `Copy context prompt for recent project ${project.name}`,
            title: "Copy context prompt",
            icon: ClipboardList,
            run: () => runMacHandoff("Copy project context", () => copyProjectContextHandoff(project.path, project.name), "clipboard"),
          },
        ],
      })),
    ];

    const currentBrowserPath = listing?.path ?? activeProjectPath;
    const visibleChildren = listing ? visibleDirectoryChildren(listing.children, false).slice(0, 8) : [];
    const fileBrowserCommands: PaletteCommand[] = activeProjectPath && currentBrowserPath ? [
      { id: "browser-reveal-current", kind: "file", label: "Reveal Current Folder in Finder", syntax: "Folder", description: macPathLabel(currentBrowserPath), icon: ExternalLink, run: () => runMacHandoff("Reveal in Finder", () => revealPathInFinder(currentBrowserPath), "finder") },
      { id: "browser-copy-current", kind: "file", label: "Copy Current Folder Path", syntax: "Path", description: macPathLabel(currentBrowserPath), icon: Copy, run: () => runMacHandoff("Copy folder path", () => copyTextToClipboard(currentBrowserPath), "clipboard") },
      { id: "browser-copy-current-link", kind: "file", label: "Copy Current Folder Xolotl Link", syntax: "Link", description: macPathLabel(currentBrowserPath), icon: Link2, run: () => runMacHandoff("Copy Xolotl link", () => copyXolotlCodeOpenUrl(currentBrowserPath), "clipboard") },
      { id: "browser-copy-current-shell-open", kind: "file", label: "Copy Current Folder Shell Open Command", syntax: "Shell", description: macPathLabel(currentBrowserPath), icon: TerminalSquare, run: () => runMacHandoff("Copy shell open command", () => copyXolotlCodeOpenShellCommand(currentBrowserPath), "clipboard") },
      { id: "browser-terminal-current", kind: "file", label: "New Terminal in Current Folder", syntax: "Terminal", description: macPathLabel(currentBrowserPath), icon: TerminalSquare, run: () => { openTerminalAtPath(currentBrowserPath); onOpenChange(false); } },
      { id: "browser-external-terminal-current", kind: "file", label: "Open Current Folder in External Terminal", syntax: "Terminal", description: macPathLabel(currentBrowserPath), icon: TerminalSquare, run: () => runMacHandoff("Open in external terminal", () => openPathInExternalTerminal(currentBrowserPath), "terminal") },
      ...(currentBrowserPath !== activeProjectPath ? [
        { id: "browser-copy-current-relative", kind: "file" as const, label: "Copy Current Folder Relative Path", syntax: "Relative", description: relativePathFromRoot(currentBrowserPath, activeProjectPath), icon: CornerDownRight, run: () => runMacHandoff("Copy relative path", () => copyTextToClipboard(relativePathFromRoot(currentBrowserPath, activeProjectPath)), "clipboard") },
      ] : []),
      { id: "browser-refresh", kind: "file", label: "Refresh File Browser", syntax: "Files", description: macPathLabel(currentBrowserPath), icon: RefreshCw, run: () => { void refreshBrowse(); onOpenChange(false); } },
      ...(listing?.parent ? [
        { id: "browser-parent", kind: "file" as const, label: "Browse Parent Folder", syntax: "Up", description: macPathLabel(listing.parent), icon: CornerLeftUp, run: () => { void browse(listing.parent!); onOpenChange(false); } },
      ] : []),
      ...(currentBrowserPath !== activeProjectPath ? [
        { id: "browser-project-root", kind: "file" as const, label: "Back to Project Root", syntax: "Root", description: macPathLabel(activeProjectPath), icon: CornerDownRight, run: () => { void browse(activeProjectPath); onOpenChange(false); } },
      ] : []),
      ...visibleChildren.map((child) => {
        const relativePath = relativePathFromRoot(child.path, activeProjectPath);
        const badges = directoryChildBadges(child);
        const syntax = [child.is_dir ? "Folder" : child.is_pdf ? "PDF" : "File", ...badges].join(" · ");
        return {
          id: `browser-entry-${child.path}`,
          kind: "file" as const,
          label: `${child.is_dir ? "Open Folder" : "Quick Look File"}: ${child.name}`,
          syntax,
          description: relativePath,
          icon: child.is_dir ? Folder : Eye,
          run: () => {
            if (child.is_dir) void browse(child.path);
            else void runMacHandoff("Quick Look", () => quickLookPath(child.path), "quick-look");
            if (child.is_dir) onOpenChange(false);
          },
          secondaryActions: [
            ...(child.is_dir ? [{
              id: "terminal",
              label: `New terminal in ${child.name}`,
              title: "New Terminal Here",
              icon: TerminalSquare,
              run: () => { openTerminalAtPath(child.path, child.name); onOpenChange(false); },
            },
            {
              id: "external-terminal",
              label: `Open ${child.name} in external terminal`,
              title: "Open in external terminal",
              icon: ExternalLink,
              run: () => runMacHandoff("Open in external terminal", () => openPathInExternalTerminal(child.path), "terminal"),
            }] : []),
            {
              id: "reveal",
              label: `Reveal ${child.name} in Finder`,
              title: "Reveal in Finder",
              icon: ExternalLink,
              run: () => runMacHandoff("Reveal in Finder", () => revealPathInFinder(child.path), "finder"),
            },
            {
              id: "copy-posix",
              label: `Copy POSIX path for ${child.name}`,
              title: "Copy POSIX path",
              icon: Copy,
              run: () => runMacHandoff("Copy POSIX path", () => copyTextToClipboard(child.path), "clipboard"),
            },
            {
              id: "copy-link",
              label: `Copy Xolotl link for ${child.name}`,
              title: "Copy Xolotl link",
              icon: Link2,
              run: () => runMacHandoff("Copy Xolotl link", () => copyXolotlCodeOpenUrl(child.path), "clipboard"),
            },
            {
              id: "copy-shell-open",
              label: `Copy shell open command for ${child.name}`,
              title: "Copy shell open command",
              icon: TerminalSquare,
              run: () => runMacHandoff("Copy shell open command", () => copyXolotlCodeOpenShellCommand(child.path), "clipboard"),
            },
            {
              id: "copy-relative",
              label: `Copy relative path for ${child.name}`,
              title: "Copy relative path",
              icon: CornerDownRight,
              run: () => runMacHandoff("Copy relative path", () => copyTextToClipboard(relativePath), "clipboard"),
            },
          ],
        };
      }),
    ] : [];

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
      ...fileBrowserCommands,

      { id: "clipboard-chat", kind: "action", label: "Start Chat With Clipboard", description: "Seed the composer with the current text clipboard.", icon: Clipboard, run: () => runClipboardPrompt("chat") },
      { id: "clipboard-explain", kind: "action", label: "Explain Clipboard Snippet", description: "Ask Xolotl to explain the code or text currently on the clipboard.", icon: BookOpen, run: () => runClipboardPrompt("explain") },

      // Workflows point users at features they may not know exist.
      { id: "agents", kind: "action", label: "Spawn an agent", description: "Right sidebar: plus button. Agents work in isolated git worktrees.", icon: GitBranch },
      { id: "team", kind: "action", label: "Launch a team", description: "Right sidebar: people icon. Define roles and tasks for parallel agents.", icon: Users },
      { id: "eval", kind: "action", label: "Compare models", description: "Eval tab. Compare models on one concrete goal with blind review.", icon: FlaskConical },
      { id: "skills", kind: "action", label: "Manage skills & MCP", description: "Settings: Skills & MCP. Discovers skills from ~/.xolotl-code/skills/.", icon: Settings2 },
      { id: "files", kind: "action", label: "Attach a file", description: "Paperclip in the chat composer, or drag-drop. Supports 40+ text file types.", icon: FileText },
    ];
  }, [activeProjectPath, browse, customCommands, listing, onOpenChange, onUsePrompt, projects, refreshBrowse, setActiveProject]);

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
    const g: Record<CommandKind, PaletteCommand[]> = { slash: [], shortcut: [], file: [], action: [] };
    for (const c of filtered) g[c.kind].push(c);
    return g;
  }, [filtered]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="xolotl-mac-dialog xolotl-command-palette w-full max-w-xl gap-0 overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Commands & shortcuts</DialogTitle>
          <DialogDescription>Searchable list of every command and keyboard shortcut.</DialogDescription>
        </DialogHeader>

        {/* Search bar */}
        <div className="xolotl-command-palette-search flex items-center gap-2 px-4 py-3">
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

        {status && <PaletteStatusBanner status={status} onDismiss={() => setStatus(null)} />}

        <div className="xolotl-mac-dialog-scroll max-h-[60vh] overflow-y-auto">
          <Section title="Slash Commands" icon={Hash} items={grouped.slash} />
          <Section title="Keyboard Shortcuts" icon={Keyboard} items={grouped.shortcut} />
          <Section title="File Browser" icon={FolderOpen} items={grouped.file} />
          <Section title="Actions & Workflows" icon={GitBranch} items={grouped.action} />
          {filtered.length === 0 && (
            <div className="px-4 py-12 text-center text-sm text-[oklch(0.50_0_0)]">
              No commands match <span className="text-[oklch(0.78_0_0)]">"{query}"</span>.
            </div>
          )}
        </div>

        <div className="xolotl-command-palette-footer flex items-center justify-between px-4 py-2 text-[11px] text-[oklch(0.48_0.012_230)]">
          <span>Click a command to run it</span>
          <span><kbd className="xolotl-keycap">{formatMacShortcut("Cmd+K")}</kbd> to reopen</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function paletteCommandFromMacCommand(
  command: MacCommandSpec,
  runNativeAction: (action: NativeMenuAction) => void,
  activeProjectPath: string | null,
): PaletteCommand {
  const isNewTerminal = command.id === "terminal-new";
  return {
    id: `native-${command.id}`,
    kind: "action",
    label: isNewTerminal && activeProjectPath ? "New Terminal Here" : command.label,
    shortcut: command.shortcut,
    description: isNewTerminal && activeProjectPath ? macPathLabel(activeProjectPath) : command.description,
    icon: MAC_COMMAND_ICONS[command.id],
    run: () => runNativeAction(command.action),
  };
}

function trimClipboardForPrompt(text: string): { text: string; truncated: boolean } {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= MAX_CLIPBOARD_PROMPT_CHARS) {
    return { text: normalized, truncated: false };
  }
  return {
    text: normalized.slice(0, MAX_CLIPBOARD_PROMPT_CHARS),
    truncated: true,
  };
}

export function buildClipboardPrompt(mode: ClipboardPromptMode, clipboardText: string): string {
  const { text, truncated } = trimClipboardForPrompt(clipboardText);
  const header = mode === "explain"
    ? "Explain this clipboard snippet clearly. Identify what it does, call out any important assumptions, and mention risks or improvements if you see them."
    : "Start from this clipboard text:";
  const emptyHint = mode === "explain"
    ? "The clipboard does not currently contain text to explain."
    : "The clipboard does not currently contain text.";
  if (!text) return emptyHint;
  return [
    header,
    "",
    "```",
    text,
    "```",
    truncated ? "" : null,
    truncated ? `Clipboard text was truncated to ${MAX_CLIPBOARD_PROMPT_CHARS.toLocaleString()} characters.` : null,
  ].filter((line): line is string => line !== null).join("\n");
}

function macHandoffRecoveryHint(kind: MacHandoffHintKey, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  const suffix = detail ? ` ${detail}` : "";
  switch (kind) {
    case "editor":
      return `Check the preferred editor in macOS Settings, or use an installed app name or executable path.${suffix}`;
    case "finder":
      return `Check that the path still exists and that macOS has allowed Xolotl Code to access it.${suffix}`;
    case "quick-look":
      return `Check that the file still exists and can be previewed by Quick Look.${suffix}`;
    case "terminal":
      return `Check the preferred external terminal in macOS Settings, or use Terminal, iTerm, Warp, an app bundle path, or executable path.${suffix}`;
    case "clipboard":
      return `Check macOS clipboard access and try the copy action again.${suffix}`;
  }
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

function PaletteStatusBanner({
  status,
  onDismiss,
}: {
  status: PaletteStatus;
  onDismiss: () => void;
}) {
  const Icon = status.tone === "error" ? AlertCircle : CheckCircle;
  const classes = status.tone === "error"
    ? "border-[oklch(0.34_0.055_25)] bg-[oklch(0.145_0.018_25)]/65 text-[oklch(0.78_0.090_25)]"
    : status.tone === "working"
      ? "border-[oklch(0.30_0.030_205)] bg-[oklch(0.145_0.012_205)]/60 text-[oklch(0.72_0.055_205)]"
      : "border-[oklch(0.32_0.045_155)] bg-[oklch(0.145_0.018_155)]/55 text-[oklch(0.74_0.080_155)]";

  return (
    <div className={`mx-3 mt-3 rounded-md border px-3 py-2 text-xs ${classes}`}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-3.5 w-3.5 flex-none" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{status.message}</div>
          {status.hint && (
            <div className="mt-1 leading-relaxed text-[oklch(0.67_0.045_45)]">{status.hint}</div>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded px-1 text-[oklch(0.55_0.012_225)] hover:bg-[oklch(0.18_0.008_245)] hover:text-[oklch(0.86_0.016_220)]"
          aria-label="Dismiss command status"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
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
            <div
              key={c.id}
              className={[
                "flex items-stretch gap-1 px-3 py-1 transition-colors",
                interactive
                  ? "hover:bg-[oklch(0.16_0.006_245)] cursor-pointer"
                  : "cursor-default",
              ].join(" ")}
            >
              <button
                type="button"
                onClick={() => { void c.run?.(); }}
                disabled={!interactive}
                aria-label={c.label}
                className={[
                  "flex min-w-0 flex-1 items-start gap-3 rounded-md px-1 py-1 text-left",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[oklch(0.55_0.04_195)]",
                  interactive ? "" : "cursor-default",
                ].join(" ")}
              >
                <Cmd className="w-4 h-4 mt-0.5 text-[oklch(0.62_0.035_190)] flex-none" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-[oklch(0.90_0_0)]">{c.label}</span>
                    {c.syntax && (
                      <code className="xolotl-command-chip flex-none">
                        {c.syntax}
                      </code>
                    )}
                    {c.shortcut && (
                      <kbd className="xolotl-keycap flex-none" title={c.shortcut}>
                        {formatMacShortcut(c.shortcut)}
                      </kbd>
                    )}
                  </div>
                  <div className="truncate text-xs text-[oklch(0.55_0_0)] mt-0.5 leading-relaxed">{c.description}</div>
                </div>
              </button>
              {c.secondaryActions && c.secondaryActions.length > 0 && (
                <div className="flex flex-none items-center gap-0.5 pr-1">
                  {c.secondaryActions.map((action) => {
                    const Secondary = action.icon;
                    return (
                      <button
                        key={action.id}
                        type="button"
                        aria-label={action.label}
                        title={action.title ?? action.label}
                        onClick={() => { void action.run(); }}
                        className="xolotl-palette-row-action"
                      >
                        <Secondary className="h-3.5 w-3.5" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
