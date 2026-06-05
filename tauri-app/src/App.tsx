import React, { lazy, Suspense, useCallback, useEffect, useState } from "react";
import "./styles.css";
import { SessionSidebar } from "./components/sidebar/SessionSidebar";
import { ChatPane } from "./components/chat/ChatPane";
import { AgentPanel } from "./components/agent/AgentPanel";
import { AgentOutputView } from "./components/agent/AgentOutputView";
import { MergeCheckpointView } from "./components/agent/MergeCheckpointView";
import { useAgentStore } from "./stores/agentStore";
import { useUiStore } from "./stores/uiStore";
import { useTerminalStore } from "./stores/terminalStore";
import { Loader2, MessagesSquare, Sprout, Terminal as TerminalIcon, TestTubeDiagonal, Waves } from "lucide-react";
import { centerTabFromSearch, type CenterTab, urlForCenterTab } from "./lib/appNavigation";

const loadEvalView = () => import("./components/eval/EvalView");
const loadCivilizationView = () => import("./components/civilization/CivilizationView");

const LazyEvalView = lazy(async () => {
  const module = await loadEvalView();
  return { default: module.EvalView };
});

const LazyCivilizationView = lazy(async () => {
  const module = await loadCivilizationView();
  return { default: module.CivilizationView };
});

const LazyTerminalDock = lazy(async () => {
  const module = await import("./components/terminal/TerminalDock");
  return { default: module.TerminalDock };
});

const COMPACT_SHELL_QUERY = "(max-width: 899px)";

function isCompactShell() {
  return typeof window.matchMedia === "function" && window.matchMedia(COMPACT_SHELL_QUERY).matches;
}

export default function App() {
  const [centerTab, setCenterTab] = useState<CenterTab>(() => centerTabFromSearch(window.location.search));
  const [compactShell, setCompactShell] = useState(isCompactShell);
  const expandedAgentId = useAgentStore((s) => s.expandedAgentId);
  const mergeCheckpointGroupId = useAgentStore((s) => s.mergeCheckpointGroupId);
  const showAgentView = expandedAgentId || mergeCheckpointGroupId;
  const terminalPanelOpen = useUiStore((s) => s.terminalPanelOpen);
  const terminalTabCount = useTerminalStore((s) => s.tabs.length);
  // Keep the dock mounted (and shells alive) while it is open or has tabs.
  const terminalDockMounted = terminalPanelOpen || terminalTabCount > 0;

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

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(COMPACT_SHELL_QUERY);
    const syncCompactShell = () => setCompactShell(query.matches);
    syncCompactShell();
    query.addEventListener("change", syncCompactShell);
    return () => query.removeEventListener("change", syncCompactShell);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "`" || e.code === "Backquote")) {
        e.preventDefault();
        useUiStore.getState().toggleTerminalPanel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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
    if (centerTab === "civ") {
      return (
        <Suspense fallback={<CivLoading />}>
          <LazyCivilizationView />
        </Suspense>
      );
    }
    return <ChatPane />;
  }

  return (
    <div className="min-h-0 w-screen flex flex-row overflow-hidden xolotl-shell">
      <SessionSidebar forceCollapsed={compactShell} />
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
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
              <PillTab
                active={centerTab === "civ"}
                onClick={() => selectCenterTab("civ")}
                onPreload={loadCivilizationView}
                icon={<Sprout className="w-3.5 h-3.5" />}
                label="Civ"
              />
            </div>
            <button
              type="button"
              onClick={() => useUiStore.getState().toggleTerminalPanel()}
              title="Toggle terminal (Ctrl+`)"
              aria-label="Toggle terminal panel"
              aria-pressed={terminalPanelOpen}
              className={[
                "flex items-center justify-center h-8 w-8 rounded-md border transition-all",
                terminalPanelOpen
                  ? "border-[oklch(0.42_0.025_195)] bg-[oklch(0.14_0.010_205)] text-[oklch(0.74_0.045_195)]"
                  : "border-[oklch(0.24_0.010_235)] bg-[oklch(0.10_0.004_250)] text-[oklch(0.54_0.012_235)] hover:text-[oklch(0.82_0.015_220)] hover:bg-[oklch(0.16_0.006_245)]",
              ].join(" ")}
            >
              <TerminalIcon className="w-4 h-4" />
            </button>
          </div>
        )}
        <WorkspaceErrorBoundary key={`${centerTab}:${expandedAgentId ?? ""}:${mergeCheckpointGroupId ?? ""}`}>
          <div className="flex-1 min-h-0 flex flex-col">{renderCenter()}</div>
        </WorkspaceErrorBoundary>
        {terminalDockMounted && (
          <Suspense fallback={null}>
            <LazyTerminalDock />
          </Suspense>
        )}
      </div>
      <AgentPanel forceCollapsed={compactShell} />
    </div>
  );
}

class WorkspaceErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex flex-1 items-center justify-center bg-[oklch(0.105_0.004_250)] p-6">
        <div className="max-w-xl rounded-md border border-[oklch(0.36_0.035_28)] bg-[oklch(0.13_0.010_28)] px-4 py-3 text-sm text-[oklch(0.76_0.055_28)]">
          <div className="font-semibold text-[oklch(0.82_0.060_28)]">Workspace view failed</div>
          <div className="mt-1 text-xs leading-relaxed text-[oklch(0.68_0.045_28)]">
            {this.state.error.message}
          </div>
        </div>
      </div>
    );
  }
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

function CivLoading() {
  return (
    <div className="flex flex-1 items-center justify-center bg-[oklch(0.105_0.004_250)]">
      <div className="flex items-center gap-3 rounded-md border border-[oklch(0.24_0.010_235)] bg-[oklch(0.12_0.004_245)] px-4 py-3 text-sm text-[oklch(0.66_0.025_210)] shadow-[0_18px_48px_oklch(0_0_0_/_0.18)]">
        <div className="xolotl-mark scale-90" aria-hidden="true" />
        <div>
          <div className="font-semibold text-[oklch(0.88_0.025_220)]">Preparing Civilization Lab</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[oklch(0.55_0.018_205)]">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading simulator
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
