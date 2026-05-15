import { useEffect, useState } from "react";
import { SquarePen, Settings, PanelLeftClose, PanelLeftOpen, MessageCircle, FolderClock, Command } from "lucide-react";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { useSessionStore } from "../../stores/sessionStore";
import type { SessionSnapshot } from "../../stores/sessionStore";
import { useChatStore } from "../../stores/chatStore";
import { useUiStore } from "../../stores/uiStore";
import { SessionItem } from "./SessionItem";
import { commands } from "../../bindings";
import { SettingsDialog } from "../settings/SettingsDialog";
import { CommandsPalette } from "../chat/CommandsPalette";

/**
 * Left column: session list + "New session" button.
 * Expanded: 256px (w-64).  Collapsed: 48px icon-rail.
 */
export function SessionSidebar() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const { sessions, activeSessionId, loadSessions, deleteSession, setActiveSessionId } =
    useSessionStore();
  const clearSession = useChatStore((s) => s.clearSession);
  const hydrateSession = useChatStore((s) => s.hydrateSession);
  const collapsed = useUiStore((s) => s.sessionsCollapsed);
  const toggleCollapsed = useUiStore((s) => s.toggleSessions);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  function handleNewSession() {
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
        className={[
          "flex-none flex flex-col border-r border-neutral-800 bg-[oklch(0.155_0_0)]",
          "transition-[width] duration-200 ease-out",
          collapsed ? "w-12" : "w-64",
        ].join(" ")}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-2 h-12 flex-none border-b border-neutral-800">
          {collapsed ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 mx-auto text-[oklch(0.65_0.18_250)]"
              title="Expand sessions"
              onClick={toggleCollapsed}
            >
              <FolderClock className="h-4 w-4" />
            </Button>
          ) : (
            <>
              <div className="flex items-center gap-1.5 pl-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[oklch(0.55_0_0)]">
                <FolderClock className="h-3.5 w-3.5" />
                Sessions
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

        {/* Action row — new session only */}
        <div className={["flex-none flex items-center border-b border-neutral-800/60", collapsed ? "flex-col gap-1 py-2" : "gap-1 px-2 py-1.5"].join(" ")}>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="New session"
            onClick={handleNewSession}
          >
            <SquarePen className="h-4 w-4" />
          </Button>
          {collapsed && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-[oklch(0.45_0_0)]"
              title="Expand sidebar"
              onClick={toggleCollapsed}
            >
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Session list — collapsed rail = first 8 sessions as tiny circles */}
        {collapsed ? (
          <div className="flex-1 flex flex-col items-center gap-1 py-2 overflow-y-auto">
            {(sessions ?? []).slice(0, 8).map((session) => (
              <button
                key={session.id}
                onClick={() => void handleResumeSession(session.id)}
                className={[
                  "w-8 h-8 flex-none flex items-center justify-center rounded-md transition-colors",
                  session.id === activeSessionId
                    ? "bg-[oklch(0.65_0.18_250)]/15 text-[oklch(0.78_0.18_250)] border border-[oklch(0.65_0.18_250)]/40"
                    : "text-[oklch(0.50_0_0)] hover:bg-[oklch(0.20_0_0)] hover:text-[oklch(0.85_0_0)]",
                ].join(" ")}
                title={session.title || `Session ${session.id.slice(0, 6)}`}
              >
                <MessageCircle className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
        ) : (
          <ScrollArea className="flex-1">
            {!sessions || sessions.length === 0 ? (
              <EmptyState
                title="No sessions yet"
                hint="Start a conversation to create your first session."
              />
            ) : (
              <div className="flex flex-col py-1.5">
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
            )}
          </ScrollArea>
        )}

        {/* Footer — Commands palette + Settings, pinned to bottom */}
        <div
          className={[
            "flex-none border-t border-neutral-800 bg-[oklch(0.13_0_0)]",
            collapsed ? "flex flex-col items-center gap-1 py-2" : "flex items-center justify-between px-2 py-1.5",
          ].join(" ")}
        >
          {collapsed ? (
            <>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-[oklch(0.60_0_0)] hover:text-[oklch(0.85_0_0)]" title="Commands & shortcuts" onClick={() => setCommandsOpen(true)}>
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
                className="flex items-center gap-2 px-2 py-1 rounded-md text-xs text-[oklch(0.60_0_0)] hover:text-[oklch(0.88_0_0)] hover:bg-[oklch(0.18_0_0)] transition-colors"
                title="Commands & shortcuts"
              >
                <Command className="h-3.5 w-3.5" />
                <span>Commands</span>
                <kbd className="ml-1 text-[10px] font-mono px-1 py-0.5 rounded bg-[oklch(0.20_0_0)] border border-neutral-700 text-[oklch(0.55_0_0)]">⌘K</kbd>
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

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-44 px-6 gap-2 text-center">
      <div className="w-10 h-10 rounded-full bg-[oklch(0.20_0_0)] flex items-center justify-center mb-1">
        <MessageCircle className="w-5 h-5 text-[oklch(0.45_0_0)]" />
      </div>
      <p className="text-sm font-medium text-[oklch(0.85_0_0)]">{title}</p>
      <p className="text-xs text-[oklch(0.50_0_0)] leading-relaxed">{hint}</p>
    </div>
  );
}
