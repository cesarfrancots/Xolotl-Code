import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import "./styles.css";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { SessionSidebar } from "./components/sidebar/SessionSidebar";
import { ChatPane } from "./components/chat/ChatPane";
import { AgentPanel } from "./components/agent/AgentPanel";
import { AgentOutputView } from "./components/agent/AgentOutputView";
import { MergeCheckpointView } from "./components/agent/MergeCheckpointView";
import { useAgentStore } from "./stores/agentStore";
import { useUiStore } from "./stores/uiStore";
import { useTerminalStore } from "./stores/terminalStore";
import { useProjectStore } from "./stores/projectStore";
import { useProjectDrop } from "./hooks/useProjectDrop";
import { useProjectOpenEvents } from "./hooks/useProjectOpenEvents";
import { Loader2, MessagesSquare, Sprout, Terminal as TerminalIcon, TestTubeDiagonal, Waves } from "lucide-react";
import { centerTabFromSearch, type CenterTab, urlForCenterTab } from "./lib/appNavigation";
import { macCommandActionForKeydown } from "./lib/macCommandModel";
import { shortcutTitle } from "./lib/macShortcuts";
import {
  dispatchNativeMenuAction,
  listenForNativeMenuActions,
  nativeMenuActionFromPayload,
  TAURI_MENU_EVENT,
  type NativeMenuAction,
} from "./lib/nativeMenu";

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
  const handledMenuActionRef = useRef<{ action: NativeMenuAction; at: number } | null>(null);

  useProjectDrop();
  useProjectOpenEvents();

  const selectCenterTab = useCallback((tab: CenterTab) => {
    setCenterTab(tab);
    const nextUrl = urlForCenterTab(window.location.href, tab);
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) {
      window.history.pushState(null, "", nextUrl);
    }
  }, []);

  const addTerminalTab = useCallback(() => {
    useUiStore.getState().setTerminalPanelOpen(true);
    useTerminalStore.getState().addTab(undefined, useProjectStore.getState().activeProjectPath);
  }, []);

  const closeActiveTerminalTab = useCallback(() => {
    const terminal = useTerminalStore.getState();
    if (!terminal.activeKey) return;
    terminal.closeTab(terminal.activeKey);
    if (useTerminalStore.getState().tabs.length === 0) {
      useUiStore.getState().setTerminalPanelOpen(false);
    }
  }, []);

  const selectAdjacentTerminalTab = useCallback((direction: -1 | 1) => {
    const terminal = useTerminalStore.getState();
    const activeIndex = terminal.tabs.findIndex((tab) => tab.key === terminal.activeKey);
    if (activeIndex === -1 || terminal.tabs.length < 2) return;
    const nextIndex = (activeIndex + direction + terminal.tabs.length) % terminal.tabs.length;
    terminal.setActive(terminal.tabs[nextIndex].key);
  }, []);

  const handleNativeMenuAction = useCallback((action: NativeMenuAction) => {
    const now = performance.now();
    const last = handledMenuActionRef.current;
    if (last && last.action === action && now - last.at < 150) return;
    handledMenuActionRef.current = { action, at: now };

    if (action === "new-chat") {
      selectCenterTab("chat");
      return;
    }
    if (action === "toggle-terminal") {
      useUiStore.getState().toggleTerminalPanel();
      return;
    }
    if (action === "terminal-new") {
      addTerminalTab();
      return;
    }
    if (action === "terminal-close") {
      closeActiveTerminalTab();
      return;
    }
    if (action === "terminal-prev") {
      selectAdjacentTerminalTab(-1);
      return;
    }
    if (action === "terminal-next") {
      selectAdjacentTerminalTab(1);
      return;
    }
    if (action === "tab-chat") {
      selectCenterTab("chat");
      return;
    }
    if (action === "tab-eval") {
      void loadEvalView();
      selectCenterTab("eval");
      return;
    }
    if (action === "tab-civ") {
      void loadCivilizationView();
      selectCenterTab("civ");
    }
  }, [addTerminalTab, closeActiveTerminalTab, selectAdjacentTerminalTab, selectCenterTab]);

  useEffect(() => listenForNativeMenuActions(handleNativeMenuAction), [handleNativeMenuAction]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    listen<string>(TAURI_MENU_EVENT, (event) => {
      const action = nativeMenuActionFromPayload(event.payload);
      if (action) dispatchNativeMenuAction(action);
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((err) => {
        console.error("native menu listener failed:", err);
      });

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
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
      const action = macCommandActionForKeydown(e, {
        terminalOpen: useUiStore.getState().terminalPanelOpen,
      });
      if (action) {
        e.preventDefault();
        dispatchNativeMenuAction(action);
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
      <div className="xolotl-workbench flex-1 min-w-0 min-h-0 flex flex-col">
        {!showAgentView && (
          <div className="xolotl-workbench-bar">
            <div className="xolotl-workbench-brand" data-tauri-drag-region>
              <div className="xolotl-mark flex-none" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold leading-none text-[oklch(0.92_0.015_230)]">xolotl</div>
                <div className="mt-0.5 flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-[oklch(0.55_0.018_205)]">
                  <Waves className="h-3 w-3" />
                  Workbench
                </div>
              </div>
            </div>
            <div className="xolotl-toolbar-drag-fill" data-tauri-drag-region />
            <div className="xolotl-segmented-control" aria-label="Workbench view">
              <PillTab
                active={centerTab === "chat"}
                onClick={() => selectCenterTab("chat")}
                icon={<MessagesSquare className="w-3.5 h-3.5" />}
                label="Chat"
                shortcut="Cmd+1"
              />
              <PillTab
                active={centerTab === "eval"}
                onClick={() => selectCenterTab("eval")}
                onPreload={loadEvalView}
                icon={<TestTubeDiagonal className="w-3.5 h-3.5" />}
                label="Eval"
                shortcut="Cmd+2"
              />
              <PillTab
                active={centerTab === "civ"}
                onClick={() => selectCenterTab("civ")}
                onPreload={loadCivilizationView}
                icon={<Sprout className="w-3.5 h-3.5" />}
                label="Civ"
                shortcut="Cmd+3"
              />
            </div>
            <button
              type="button"
              onClick={() => useUiStore.getState().toggleTerminalPanel()}
              title={shortcutTitle("Toggle terminal", "Cmd+J")}
              aria-label="Toggle terminal panel"
              aria-pressed={terminalPanelOpen}
              className={[
                "xolotl-toolbar-icon-button",
                terminalPanelOpen
                  ? "xolotl-toolbar-icon-button-active"
                  : "",
              ].join(" ")}
            >
              <TerminalIcon className="w-4 h-4" />
            </button>
          </div>
        )}
        <WorkspaceErrorBoundary key={`${centerTab}:${expandedAgentId ?? ""}:${mergeCheckpointGroupId ?? ""}`}>
          <div
            className={[
              "xolotl-workspace-content flex-1 min-h-0 flex flex-col",
              showAgentView ? "xolotl-workspace-content-titlebar-safe" : "",
            ].join(" ")}
          >
            {renderCenter()}
          </div>
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
  active, onClick, onPreload, icon, label, shortcut,
}: {
  active: boolean;
  onClick: () => void;
  onPreload?: () => void;
  icon: React.ReactNode;
  label: string;
  shortcut: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onFocus={onPreload}
      onMouseEnter={onPreload}
      aria-pressed={active}
      title={shortcutTitle(label, shortcut)}
      className={["xolotl-segment-tab", active ? "xolotl-segment-tab-active" : ""].join(" ")}
    >
      {icon}
      {label}
    </button>
  );
}
