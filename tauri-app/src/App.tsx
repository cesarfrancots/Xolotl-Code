import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import "./styles.css";
import { SessionSidebar } from "./components/sidebar/SessionSidebar";
import { ChatPane } from "./components/chat/ChatPane";
import { AgentPanel } from "./components/agent/AgentPanel";
import { AgentOutputView } from "./components/agent/AgentOutputView";
import { MergeCheckpointView } from "./components/agent/MergeCheckpointView";
import { useAgentStore } from "./stores/agentStore";
import { Loader2, MessagesSquare, TestTubeDiagonal, Waves } from "lucide-react";
import { centerTabFromSearch, type CenterTab, urlForCenterTab } from "./lib/appNavigation";

const loadEvalView = () => import("./components/eval/EvalView");

const LazyEvalView = lazy(async () => {
  const module = await loadEvalView();
  return { default: module.EvalView };
});

export default function App() {
  const [centerTab, setCenterTab] = useState<CenterTab>(() => centerTabFromSearch(window.location.search));
  const expandedAgentId = useAgentStore((s) => s.expandedAgentId);
  const mergeCheckpointGroupId = useAgentStore((s) => s.mergeCheckpointGroupId);
  const showAgentView = expandedAgentId || mergeCheckpointGroupId;

  const selectCenterTab = useCallback((tab: CenterTab) => {
    setCenterTab(tab);
    const nextUrl = urlForCenterTab(window.location.href, tab);
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) {
      window.history.pushState(null, "", nextUrl);
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => setCenterTab(centerTabFromSearch(window.location.search));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function renderCenter() {
    if (mergeCheckpointGroupId) return <MergeCheckpointView groupId={mergeCheckpointGroupId} />;
    if (expandedAgentId) return <AgentOutputView agentId={expandedAgentId} />;
    if (centerTab === "eval") {
      return (
        <Suspense fallback={<EvalLoading />}>
          <LazyEvalView />
        </Suspense>
      );
    }
    return <ChatPane />;
  }

  return (
    <div className="h-screen w-screen flex flex-row overflow-hidden xolotl-shell">
      <SessionSidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        {!showAgentView && (
          <div className="flex-none flex items-center gap-3 border-b border-[oklch(0.22_0.008_240)] bg-[oklch(0.108_0.004_245)]/94 px-3 h-12 shadow-[0_1px_0_oklch(1_0_0_/_0.025)]">
            <div className="flex items-center gap-2 min-w-0">
              <div className="xolotl-mark flex-none" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold leading-none text-[oklch(0.92_0.015_230)]">xolotl</div>
                <div className="mt-0.5 flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-[oklch(0.55_0.018_205)]">
                  <Waves className="h-3 w-3" />
                  Workbench
                </div>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-1 rounded-md border border-[oklch(0.24_0.010_235)] bg-[oklch(0.10_0.004_250)] p-1">
              <PillTab
                active={centerTab === "chat"}
                onClick={() => selectCenterTab("chat")}
                icon={<MessagesSquare className="w-3.5 h-3.5" />}
                label="Chat"
              />
              <PillTab
                active={centerTab === "eval"}
                onClick={() => selectCenterTab("eval")}
                onPreload={loadEvalView}
                icon={<TestTubeDiagonal className="w-3.5 h-3.5" />}
                label="Eval"
              />
            </div>
          </div>
        )}
        <div className="flex-1 min-h-0 flex flex-col">{renderCenter()}</div>
      </div>
      <AgentPanel />
    </div>
  );
}

function EvalLoading() {
  return (
    <div className="flex flex-1 items-center justify-center bg-[oklch(0.105_0.004_250)]">
      <div className="flex items-center gap-3 rounded-md border border-[oklch(0.24_0.010_235)] bg-[oklch(0.12_0.004_245)] px-4 py-3 text-sm text-[oklch(0.66_0.025_210)] shadow-[0_18px_48px_oklch(0_0_0_/_0.18)]">
        <div className="xolotl-mark scale-90" aria-hidden="true" />
        <div>
          <div className="font-semibold text-[oklch(0.88_0.025_220)]">Preparing Eval Lab</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[oklch(0.55_0.018_205)]">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading review tools
          </div>
        </div>
      </div>
    </div>
  );
}

function PillTab({
  active, onClick, onPreload, icon, label,
}: {
  active: boolean;
  onClick: () => void;
  onPreload?: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      onFocus={onPreload}
      onMouseEnter={onPreload}
      className={[
        "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all",
        active
          ? "bg-[oklch(0.14_0.010_205)] text-[oklch(0.74_0.045_195)] shadow-[inset_0_0_0_1px_oklch(0.42_0.025_195)]"
          : "text-[oklch(0.54_0.012_235)] hover:text-[oklch(0.82_0.015_220)] hover:bg-[oklch(0.16_0.006_245)]",
      ].join(" ")}
    >
      {icon}
      {label}
    </button>
  );
}
