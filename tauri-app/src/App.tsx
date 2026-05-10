import "./styles.css";
import { SessionSidebar } from "./components/sidebar/SessionSidebar";
import { ChatPane } from "./components/chat/ChatPane";
import { AgentPanel } from "./components/agent/AgentPanel";
import { AgentOutputView } from "./components/agent/AgentOutputView";
import { useAgentStore } from "./stores/agentStore";

/**
 * App root: 3-column flex layout.
 * SessionSidebar (256px fixed) | center pane | AgentPanel (320px fixed).
 *
 * Center pane:
 * - expandedAgentId non-null → AgentOutputView (read-only agent conversation)
 * - expandedAgentId null → ChatPane (human chat session)
 *
 * Per D-01: all three columns always visible.
 * Per D-04/D-05/D-06: AgentOutputView is read-only; closing it returns to ChatPane.
 */
export default function App() {
  const expandedAgentId = useAgentStore((s) => s.expandedAgentId);
  return (
    <div className="h-screen w-screen flex flex-row overflow-hidden bg-[oklch(0.11_0_0)]">
      <SessionSidebar />
      {expandedAgentId ? (
        <AgentOutputView agentId={expandedAgentId} />
      ) : (
        <ChatPane />
      )}
      <AgentPanel />
    </div>
  );
}
