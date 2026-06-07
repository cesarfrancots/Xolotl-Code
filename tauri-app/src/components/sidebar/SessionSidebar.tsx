import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  Command,
  Folder,
  FolderPlus,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  SquarePen,
} from "lucide-react";
import { Button } from "../ui/button";
import { useSessionStore } from "../../stores/sessionStore";
import type { SessionSnapshot } from "../../stores/sessionStore";
import { useChatStore } from "../../stores/chatStore";
import { useUiStore } from "../../stores/uiStore";
import { useProjectStore } from "../../stores/projectStore";
import { SessionItem } from "./SessionItem";
import { ProjectsSection } from "./ProjectsSection";
import { DirectoryBrowser } from "./DirectoryBrowser";
import { commands } from "../../bindings";
import { SettingsDialog } from "../settings/SettingsDialog";
import { CommandsPalette } from "../chat/CommandsPalette";
import { listenForNativeMenuActions } from "../../lib/nativeMenu";
import { formatMacShortcut, shortcutTitle } from "../../lib/macShortcuts";

/**
 * Left column — the workbench navigator.
 * Expanded (256px): New chat · Projects (quick access) · file browser · history.
 * Collapsed (48px): an icon rail of the same actions.
 */
export function SessionSidebar({ forceCollapsed = false }: { forceCollapsed?: boolean }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const { sessions, activeSessionId, loadSessions, deleteSession, setActiveSessionId } =
    useSessionStore();
  const clearSession = useChatStore((s) => s.clearSession);
  const hydrateSession = useChatStore((s) => s.hydrateSession);
  const storedCollapsed = useUiStore((s) => s.sessionsCollapsed);
  const toggleCollapsed = useUiStore((s) => s.toggleSessions);
  const collapsed = forceCollapsed || storedCollapsed;

  const projects = useProjectStore((s) => s.projects);
  const activeProjectPath = useProjectStore((s) => s.activeProjectPath);
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const openFolderDialog = useProjectStore((s) => s.openFolderDialog);

  useEffect(() => {
    void loadSessions();
    void loadProjects();
  }, [loadSessions, loadProjects]);

  const handleNewSession = useCallback(() => {
    setActiveSessionId(null);
    clearSession();
  }, [clearSession, setActiveSessionId]);

  useEffect(() => {
    return listenForNativeMenuActions((action) => {
      if (action === "new-chat") {
        handleNewSession();
        return;
      }
      if (action === "open-folder") {
        void openFolderDialog();
        return;
      }
      if (action === "settings") {
        setSettingsOpen(true);
        return;
      }
      if (action === "commands") {
        setCommandsOpen(true);
      }
    });
  }, [handleNewSession, openFolderDialog]);

  function handleOpenProject(path: string) {
    setActiveProject(path);
    setActiveSessionId(null);
    clearSession();
  }

  async function handleResumeSession(id: string) {
    setActiveSessionId(id);
    const result = await commands.loadSession(id);
    if (result.status === "error") return;
    try {
      const snapshot = JSON.parse(result.data) as SessionSnapshot;
      hydrateSession(snapshot.messages, snapshot.model, snapshot.usage);
    } catch {
      // Malformed session — leave chat pane blank rather than crashing
    }
  }

  function handleDeleteSession(id: string) {
    void deleteSession(id);
  }

  return (
    <>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <aside
        data-collapsed={collapsed ? "true" : "false"}
        data-force-collapsed={forceCollapsed ? "true" : "false"}
        className={[
          "xolotl-sidebar xolotl-left-sidebar flex-none flex min-h-0 flex-col border-r border-[oklch(0.22_0.008_240)]",
          "transition-[width] duration-200 ease-out",
          collapsed ? "w-12" : "w-64",
        ].join(" ")}
      >
        {/* Header */}
        <div className="xolotl-sidebar-header">
          {collapsed ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 mx-auto text-[oklch(0.64_0.035_190)] hover:text-[oklch(0.78_0.040_190)]"
              title={forceCollapsed ? "Widen window to expand" : "Expand sidebar"}
              onClick={forceCollapsed ? undefined : toggleCollapsed}
            >
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
          ) : (
            <>
              <div className="xolotl-sidebar-title" data-tauri-drag-region>
                <Folder className="h-3.5 w-3.5 text-[oklch(0.62_0.035_192)]" />
                Workspace
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Collapse sidebar"
                onClick={toggleCollapsed}
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>

        {collapsed ? (
          <CollapsedRail
            forceCollapsed={forceCollapsed}
            projects={projects}
            activeProjectPath={activeProjectPath}
            onNewSession={handleNewSession}
            onOpenFolder={() => void openFolderDialog()}
            onOpenProject={handleOpenProject}
            onExpand={toggleCollapsed}
            onCommands={() => setCommandsOpen(true)}
            onSettings={() => setSettingsOpen(true)}
          />
        ) : (
          <>
            {/* New chat — scoped to the active project */}
            <div className="flex-none px-2 py-2 border-b border-[oklch(0.20_0.006_245)]/70">
              <button
                type="button"
                onClick={handleNewSession}
                className="flex w-full items-center gap-2 rounded-md border border-[oklch(0.26_0.012_205)] bg-[oklch(0.135_0.008_205)] px-2.5 py-1.5 text-[13px] font-medium text-[oklch(0.84_0.020_200)] transition-colors hover:bg-[oklch(0.16_0.012_205)] hover:text-[oklch(0.92_0.030_195)]"
              >
                <SquarePen className="h-3.5 w-3.5 flex-none text-[oklch(0.70_0.045_190)]" />
                New chat
                {activeProjectPath && (
                  <span className="ml-auto max-w-[110px] truncate text-[10px] font-normal text-[oklch(0.52_0.020_195)]">
                    in {projectName(activeProjectPath)}
                  </span>
                )}
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <div className="flex-none border-b border-[oklch(0.20_0.006_245)]/60">
                <ProjectsSection onOpenProject={handleOpenProject} />
              </div>

              {activeProjectPath && (
                <div className="flex-none border-b border-[oklch(0.20_0.006_245)]/60">
                  <DirectoryBrowser />
                </div>
              )}

              {/* History */}
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => setHistoryOpen((v) => !v)}
                  className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-[oklch(0.56_0.012_220)] hover:text-[oklch(0.72_0.020_215)]"
                >
                  <History className="h-3.5 w-3.5" />
                  History
                  {sessions && sessions.length > 0 && (
                    <span className="text-[oklch(0.44_0.010_225)]">{sessions.length}</span>
                  )}
                  <ChevronDown
                    className={[
                      "ml-auto h-3.5 w-3.5 transition-transform",
                      historyOpen ? "" : "-rotate-90",
                    ].join(" ")}
                  />
                </button>
                {historyOpen &&
                  (!sessions || sessions.length === 0 ? (
                    <p className="px-3 pb-2 text-[11px] text-[oklch(0.48_0.010_225)]">
                      Saved chats will appear here.
                    </p>
                  ) : (
                    <div className="flex flex-col pb-1">
                      {sessions.map((session) => (
                        <SessionItem
                          key={session.id}
                          session={session}
                          isActive={session.id === activeSessionId}
                          onResume={() => void handleResumeSession(session.id)}
                          onDelete={() => handleDeleteSession(session.id)}
                        />
                      ))}
                    </div>
                  ))}
              </div>
            </div>
          </>
        )}

        {/* Footer — Commands palette + Settings, pinned to bottom */}
        <div
          className={[
            "flex-none border-t border-[oklch(0.22_0.008_240)] bg-[oklch(0.105_0.004_245)]",
            collapsed
              ? "flex flex-col items-center gap-1 py-2"
              : "flex items-center justify-between px-2 py-1.5",
          ].join(" ")}
        >
          {collapsed ? (
            <>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-[oklch(0.60_0_0)] hover:text-[oklch(0.85_0_0)]" title={shortcutTitle("Commands & shortcuts", "Cmd+K")} onClick={() => setCommandsOpen(true)}>
                <Command className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-[oklch(0.60_0_0)] hover:text-[oklch(0.85_0_0)]" title="Settings" onClick={() => setSettingsOpen(true)}>
                <Settings className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <button
                onClick={() => setCommandsOpen(true)}
                className="flex items-center gap-2 px-2 py-1 rounded-md text-xs text-[oklch(0.58_0.010_225)] hover:text-[oklch(0.86_0.015_220)] hover:bg-[oklch(0.16_0.004_240)] transition-colors"
                title={shortcutTitle("Commands & shortcuts", "Cmd+K")}
              >
                <Command className="h-3.5 w-3.5" />
                <span>Commands</span>
                <kbd className="xolotl-keycap ml-1">{formatMacShortcut("Cmd+K")}</kbd>
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-[oklch(0.60_0_0)] hover:text-[oklch(0.88_0_0)]"
                title="Settings"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </aside>
      <CommandsPalette open={commandsOpen} onOpenChange={setCommandsOpen} />
    </>
  );
}

function projectName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

interface CollapsedRailProps {
  forceCollapsed: boolean;
  projects: { path: string; name: string }[];
  activeProjectPath: string | null;
  onNewSession: () => void;
  onOpenFolder: () => void;
  onOpenProject: (path: string) => void;
  onExpand: () => void;
  onCommands: () => void;
  onSettings: () => void;
}

function CollapsedRail({
  forceCollapsed,
  projects,
  activeProjectPath,
  onNewSession,
  onOpenFolder,
  onOpenProject,
  onExpand,
}: CollapsedRailProps) {
  return (
    <div className="flex flex-1 min-h-0 flex-col items-center gap-1 overflow-y-auto py-2">
      <Button variant="ghost" size="icon" className="h-8 w-8" title="New chat" onClick={onNewSession}>
        <SquarePen className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-[oklch(0.64_0.035_190)]"
        title="Open folder…"
        onClick={onOpenFolder}
      >
        <FolderPlus className="h-4 w-4" />
      </Button>
      <div className="my-1 h-px w-5 bg-[oklch(0.24_0.010_235)]" />
      {projects.slice(0, 7).map((project) => {
        const isActive = project.path === activeProjectPath;
        return (
          <button
            key={project.path}
            type="button"
            onClick={() => onOpenProject(project.path)}
            title={project.name}
            aria-label={`Open ${project.name}`}
            aria-current={isActive ? "true" : undefined}
            className={[
              "grid h-8 w-8 flex-none place-items-center rounded-md transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[oklch(0.55_0.04_195)]",
              isActive
                ? "bg-[oklch(0.16_0.012_195)] text-[oklch(0.76_0.040_190)] border border-[oklch(0.42_0.025_195)]/70"
                : "text-[oklch(0.50_0.006_230)] hover:bg-[oklch(0.16_0.004_240)] hover:text-[oklch(0.82_0.015_220)]",
            ].join(" ")}
          >
            <Folder className="h-3.5 w-3.5" />
          </button>
        );
      })}
      {!forceCollapsed && (
        <Button
          variant="ghost"
          size="icon"
          className="mt-1 h-8 w-8 text-[oklch(0.45_0_0)]"
          title="Expand sidebar"
          onClick={onExpand}
        >
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
