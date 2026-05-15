import { useState } from "react";
import "./styles.css";
import { SessionSidebar } from "./components/sidebar/SessionSidebar";
import { ChatPane } from "./components/chat/ChatPane";
import { AgentPanel } from "./components/agent/AgentPanel";
import { AgentOutputView } from "./components/agent/AgentOutputView";
import { MergeCheckpointView } from "./components/agent/MergeCheckpointView";
import { EvalView } from "./components/eval/EvalView";
import { useAgentStore } from "./stores/agentStore";
import { MessagesSquare, TestTubeDiagonal } from "lucide-react";

type CenterTab = "chat" | "eval";

export default function App() {
  const [centerTab, setCenterTab] = useState<CenterTab>("chat");
  const expandedAgentId = useAgentStore((s) => s.expandedAgentId);
  const mergeCheckpointGroupId = useAgentStore((s) => s.mergeCheckpointGroupId);
  const showAgentView = expandedAgentId || mergeCheckpointGroupId;

  function renderCenter() {
    if (mergeCheckpointGroupId) return <MergeCheckpointView groupId={mergeCheckpointGroupId} />;
    if (expandedAgentId) return <AgentOutputView agentId={expandedAgentId} />;
    if (centerTab === "eval") return <EvalView />;
    return <ChatPane />;
  }

  return (
    <div className="h-screen w-screen flex flex-row overflow-hidden bg-[oklch(0.105_0_0)]">
      <SessionSidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        {!showAgentView && (
          <div className="flex-none flex items-center gap-1 border-b border-neutral-800 bg-[oklch(0.12_0_0)] px-3 h-11">
            <PillTab
              active={centerTab === "chat"}
              onClick={() => setCenterTab("chat")}
              icon={<MessagesSquare className="w-3.5 h-3.5" />}
              label="Chat"
            />
            <PillTab
              active={centerTab === "eval"}
              onClick={() => setCenterTab("eval")}
              icon={<TestTubeDiagonal className="w-3.5 h-3.5" />}
              label="Eval"
            />
          </div>
        )}
        <div className="flex-1 min-h-0 flex flex-col">{renderCenter()}</div>
      </div>
      <AgentPanel />
    </div>
  );
}

function PillTab({
  active, onClick, icon, label,
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
        "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all",
        active
          ? "bg-[oklch(0.65_0.18_250)]/15 text-[oklch(0.82_0.12_250)] shadow-[inset_0_0_0_1px_oklch(0.65_0.18_250_/_0.30)]"
          : "text-[oklch(0.50_0_0)] hover:text-[oklch(0.78_0_0)] hover:bg-[oklch(0.18_0_0)]",
      ].join(" ")}
    >
      {icon}
      {label}
    </button>
  );
}
