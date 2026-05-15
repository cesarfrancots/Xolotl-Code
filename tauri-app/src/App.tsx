import { useState } from "react";
import "./styles.css";
import { SessionSidebar } from "./components/sidebar/SessionSidebar";
import { ChatPane } from "./components/chat/ChatPane";
import { AgentPanel } from "./components/agent/AgentPanel";
import { AgentOutputView } from "./components/agent/AgentOutputView";
import { MergeCheckpointView } from "./components/agent/MergeCheckpointView";
import { EvalView } from "./components/eval/EvalView";
import { useAgentStore } from "./stores/agentStore";
import { MessageSquare, FlaskConical } from "lucide-react";

type CenterTab = "chat" | "eval";

export default function App() {
  const [centerTab, setCenterTab] = useState<CenterTab>("chat");
  const expandedAgentId = useAgentStore((s) => s.expandedAgentId);
  const mergeCheckpointGroupId = useAgentStore((s) => s.mergeCheckpointGroupId);

  // Agent views take priority over the tab selection
  const showAgentView = expandedAgentId || mergeCheckpointGroupId;

  function renderCenter() {
    if (mergeCheckpointGroupId) {
      return <MergeCheckpointView groupId={mergeCheckpointGroupId} />;
    }
    if (expandedAgentId) {
      return <AgentOutputView agentId={expandedAgentId} />;
    }
    if (centerTab === "eval") {
      return <EvalView />;
    }
    return <ChatPane />;
  }

  return (
    <div className="h-screen w-screen flex flex-row overflow-hidden bg-[oklch(0.11_0_0)]">
      <SessionSidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Tab bar (hidden when agent views are showing) */}
        {!showAgentView && (
          <div className="flex-none flex items-center gap-0 border-b border-neutral-800 bg-[oklch(0.12_0_0)] px-2">
            <TabButton
              active={centerTab === "chat"}
              onClick={() => setCenterTab("chat")}
              icon={<MessageSquare className="w-3.5 h-3.5" />}
              label="Chat"
            />
            <TabButton
              active={centerTab === "eval"}
              onClick={() => setCenterTab("eval")}
              icon={<FlaskConical className="w-3.5 h-3.5" />}
              label="Eval"
            />
          </div>
        )}
        <div className="flex-1 min-h-0 flex flex-col">
          {renderCenter()}
        </div>
      </div>
      <AgentPanel />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors",
        active
          ? "border-[oklch(0.65_0.18_250)] text-[oklch(0.88_0_0)]"
          : "border-transparent text-[oklch(0.45_0_0)] hover:text-[oklch(0.70_0_0)]",
      ].join(" ")}
    >
      {icon}
      {label}
    </button>
  );
}
