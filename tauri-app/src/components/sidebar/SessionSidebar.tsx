import { useEffect } from "react";
import { Plus } from "lucide-react";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { useSessionStore } from "../../stores/sessionStore";
import type { SessionSnapshot } from "../../stores/sessionStore";
import { useChatStore } from "../../stores/chatStore";
import { SessionItem } from "./SessionItem";
import { commands } from "../../bindings";

/**
 * Left column: session list + "New session" button.
 * Width: 256px (w-64) fixed per D-04.
 * Background: --color-surface (#222222) per 04-UI-SPEC.md.
 */
export function SessionSidebar() {
  const { sessions, activeSessionId, loadSessions, deleteSession, setActiveSessionId } =
    useSessionStore();
  const clearSession = useChatStore((s) => s.clearSession);
  const hydrateSession = useChatStore((s) => s.hydrateSession);

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
    <aside className="w-64 flex-none flex flex-col border-r border-neutral-800 bg-[oklch(0.16_0_0)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 flex-none border-b border-neutral-800">
        <span className="text-xs font-normal text-[oklch(0.55_0_0)]">SESSIONS</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="New session"
          onClick={handleNewSession}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Session list */}
      <ScrollArea className="flex-1">
        {!sessions || sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 px-4 gap-2 text-center">
            <p className="text-sm font-semibold text-[oklch(0.92_0_0)]">No sessions yet</p>
            <p className="text-xs text-[oklch(0.55_0_0)]">
              Start a conversation to create your first session.
            </p>
          </div>
        ) : (
          <div className="flex flex-col py-2">
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
    </aside>
  );
}
