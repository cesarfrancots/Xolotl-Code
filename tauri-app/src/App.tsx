import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import "./styles.css";
import { SessionSidebar } from "./components/sidebar/SessionSidebar";
import { useAgentStore, type AgentRecord } from "./stores/agentStore";
import { useUiStore } from "./stores/uiStore";
import { useTerminalStore } from "./stores/terminalStore";
import { projectDisplayName, useProjectStore } from "./stores/projectStore";
import { Loader2, MessagesSquare, Sprout, Terminal as TerminalIcon, TestTubeDiagonal, Waves } from "lucide-react";
import { centerTabFromSearch, initialCenterTabFromSearch, persistCenterTab, type CenterTab, urlForCenterTab } from "./lib/appNavigation";
import { commands } from "./bindings";
import { errorDetail, MAC_APP_STATUS_EVENT, type MacAppStatus } from "./lib/macAppStatus";
import { macCommandActionForKeydown } from "./lib/macCommandModel";
import { shortcutTitle } from "./lib/macShortcuts";
import {
  dispatchNativeMenuAction,
  listenForNativeMenuActions,
  type NativeMenuAction,
  type NativeRecentProjectMenuPayload,
} from "./lib/nativeMenu";
import type { PathContextHandoffOptions } from "./lib/pathActions";

const loadEvalView = () => import("./components/eval/EvalView");
const loadPondView = () => import("./components/pond/PondView");
const loadChatPane = () => import("./components/chat/ChatPane");
const loadAgentPanel = () => import("./components/agent/AgentPanel");
const loadMacRuntimeBridge = () => import("./components/mac/MacRuntimeBridge");
const loadMacAppStatusBanner = () => import("./components/mac/MacAppStatusBanner");
const loadMacNativeMenuEventBridge = () => import("./components/mac/MacNativeMenuEventBridge");
const loadPathActions = () => import("./lib/pathActions");

const LazyChatPane = lazy(async () => {
  const module = await loadChatPane();
  return { default: module.ChatPane };
});

const LazyEvalView = lazy(async () => {
  const module = await loadEvalView();
  return { default: module.EvalView };
});

const LazyPondView = lazy(async () => {
  const module = await loadPondView();
  return { default: module.PondView };
});

const LazyTerminalDock = lazy(async () => {
  const module = await import("./components/terminal/TerminalDock");
  return { default: module.TerminalDock };
});

const LazyAgentPanel = lazy(async () => {
  const module = await loadAgentPanel();
  return { default: module.AgentPanel };
});

const LazyMacRuntimeBridge = lazy(async () => {
  const module = await loadMacRuntimeBridge();
  return { default: module.MacRuntimeBridge };
});

const LazyMacAppStatusBanner = lazy(async () => {
  const module = await loadMacAppStatusBanner();
  return { default: module.MacAppStatusBanner };
});

const LazyMacNativeMenuEventBridge = lazy(async () => {
  const module = await loadMacNativeMenuEventBridge();
  return { default: module.MacNativeMenuEventBridge };
});

const LazyAgentOutputView = lazy(async () => {
  const module = await import("./components/agent/AgentOutputView");
  return { default: module.AgentOutputView };
});

const LazyMergeCheckpointView = lazy(async () => {
  const module = await import("./components/agent/MergeCheckpointView");
  return { default: module.MergeCheckpointView };
});

const COMPACT_SHELL_QUERY = "(max-width: 899px)";
const STATUS_AGENT_STATE_PRIORITY: AgentRecord["state"][] = [
  "Executing",
  "Planning",
  "Waiting",
  "Failed",
  "Done",
  "Idle",
];

async function copyTextToClipboard(text: string) {
  const module = await loadPathActions();
  await module.copyTextToClipboard(text);
}

async function copyXolotlCodeOpenUrl(path: string) {
  const module = await loadPathActions();
  await module.copyXolotlCodeOpenUrl(path);
}

async function copyXolotlCodeOpenShellCommand(path: string) {
  const module = await loadPathActions();
  await module.copyXolotlCodeOpenShellCommand(path);
}

async function copyProjectContextHandoff(path: string, name?: string | null) {
  const module = await loadPathActions();
  await module.copyProjectContextHandoff(path, name);
}

async function copyProjectAutomationHandoff(path: string, name?: string | null) {
  const module = await loadPathActions();
  await module.copyProjectAutomationHandoff(path, name);
}

async function copyPathContextHandoff(path: string, options: PathContextHandoffOptions = {}) {
  const module = await loadPathActions();
  await module.copyPathContextHandoff(path, options);
}

async function copyPathAutomationHandoff(path: string, options: PathContextHandoffOptions = {}) {
  const module = await loadPathActions();
  await module.copyPathAutomationHandoff(path, options);
}

async function revealPathInFinder(path: string) {
  const module = await loadPathActions();
  await module.revealPathInFinder(path);
}

async function openPathInExternalEditor(path: string) {
  const module = await loadPathActions();
  await module.openPathInExternalEditor(path);
}

async function openPathInExternalTerminal(path: string) {
  const module = await loadPathActions();
  await module.openPathInExternalTerminal(path);
}

function isCompactShell() {
  return typeof window.matchMedia === "function" && window.matchMedia(COMPACT_SHELL_QUERY).matches;
}

function latestAgentForStatusMenu(agents: AgentRecord[]): AgentRecord | null {
  for (const state of STATUS_AGENT_STATE_PRIORITY) {
    for (let index = agents.length - 1; index >= 0; index -= 1) {
      if (agents[index].state === state) return agents[index];
    }
  }
  return agents.length > 0 ? agents[agents.length - 1] : null;
}

export default function App() {
  const [centerTab, setCenterTab] = useState<CenterTab>(() => initialCenterTabFromSearch(window.location.search));
  const [compactShell, setCompactShell] = useState(isCompactShell);
  const [macAppStatus, setMacAppStatus] = useState<MacAppStatus | null>(null);
  const expandedAgentId = useAgentStore((s) => s.expandedAgentId);
  const mergeCheckpointGroupId = useAgentStore((s) => s.mergeCheckpointGroupId);
  const showAgentView = expandedAgentId || mergeCheckpointGroupId;
  const terminalPanelOpen = useUiStore((s) => s.terminalPanelOpen);
  const gameFullscreen = useUiStore((s) => s.gameFullscreen);
  const terminalTabCount = useTerminalStore((s) => s.tabs.length);
  // Keep the dock mounted (and shells alive) while it is open or has tabs.
  const terminalDockMounted = terminalPanelOpen || terminalTabCount > 0;
  const handledMenuActionRef = useRef<{ action: NativeMenuAction; at: number } | null>(null);

  const showNoActiveProjectStatus = useCallback(() => {
    setMacAppStatus({
      tone: "error",
      message: "No active project is available.",
      hint: "Open a project before using active project actions.",
    });
  }, []);

  const showNoAgentStatus = useCallback(() => {
    setMacAppStatus({
      tone: "error",
      message: "No agent output is available.",
      hint: "Start an agent run before using latest agent actions.",
    });
  }, []);

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

  const addActiveProjectTerminalTab = useCallback(() => {
    const activeProjectPath = useProjectStore.getState().activeProjectPath;
    if (!activeProjectPath) {
      showNoActiveProjectStatus();
      return;
    }
    useUiStore.getState().setTerminalPanelOpen(true);
    useTerminalStore.getState().addTab(undefined, activeProjectPath);
    setMacAppStatus({ tone: "ok", message: "Embedded terminal opened at the active project." });
  }, [showNoActiveProjectStatus]);

  const openLatestAgentOutput = useCallback(() => {
    const agentStore = useAgentStore.getState();
    const latestAgent = latestAgentForStatusMenu(agentStore.agents);
    if (!latestAgent) {
      showNoAgentStatus();
      return;
    }
    agentStore.setExpandedAgent(latestAgent.id);
    setMacAppStatus({ tone: "ok", message: "Latest agent output opened." });
  }, [showNoAgentStatus]);

  const runLatestAgentWorktreeHandoff = useCallback((
    action: (path: string, agent: AgentRecord) => Promise<void>,
    successMessage: string,
    failureMessage: string,
    recoveryHint: string,
  ) => {
    const agentStore = useAgentStore.getState();
    const latestAgent = latestAgentForStatusMenu(agentStore.agents);
    if (!latestAgent) {
      showNoAgentStatus();
      return;
    }

    void commands.getAgentWorktreePath(latestAgent.id)
      .then(async (pathResult) => {
        if (pathResult.status === "error") throw new Error(pathResult.error);
        await action(pathResult.data, latestAgent);
        setMacAppStatus({ tone: "ok", message: successMessage });
      })
      .catch((err) => {
        setMacAppStatus({
          tone: "error",
          message: failureMessage,
          hint: `${recoveryHint} ${errorDetail(err)}`,
        });
    });
  }, [showNoAgentStatus]);

  const openEmbeddedTerminalAtPath = useCallback(async (path: string) => {
    useUiStore.getState().setTerminalPanelOpen(true);
    useTerminalStore.getState().addTab(undefined, path);
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

  const runActiveProjectHandoff = useCallback((
    action: (path: string, name?: string | null) => Promise<void>,
    successMessage: string,
    failureMessage: string,
    recoveryHint: string,
    options: { includeProjectName?: boolean } = {},
  ) => {
    const projectState = useProjectStore.getState();
    const activeProjectPath = projectState.activeProjectPath;
    if (!activeProjectPath) {
      showNoActiveProjectStatus();
      return;
    }
    const activeProjectName = projectState.projects.find((project) => project.path === activeProjectPath)?.name ?? null;

    const includeProjectName = options.includeProjectName && activeProjectName;

    void (includeProjectName ? action(activeProjectPath, activeProjectName) : action(activeProjectPath))
      .then(() => {
        setMacAppStatus({ tone: "ok", message: successMessage });
      })
      .catch((err) => {
        setMacAppStatus({
          tone: "error",
          message: failureMessage,
          hint: `${recoveryHint} ${errorDetail(err)}`,
        });
      });
  }, [showNoActiveProjectStatus]);

  const recentProjectNameForPath = useCallback((path: string) => {
    return useProjectStore.getState().projects.find((project) => project.path === path)?.name
      ?? projectDisplayName(path);
  }, []);

  const runRecentProjectMenuHandoff = useCallback((
    payload: NativeRecentProjectMenuPayload,
    action: (path: string, name: string) => Promise<void>,
    successMessage: string,
    failureMessage: string,
    recoveryHint: string,
  ) => {
    const projectName = recentProjectNameForPath(payload.path);
    void action(payload.path, projectName)
      .then(() => {
        setMacAppStatus({ tone: "ok", message: successMessage });
      })
      .catch((err) => {
        setMacAppStatus({
          tone: "error",
          message: failureMessage,
          hint: `${recoveryHint} ${errorDetail(err)}`,
        });
      });
  }, [recentProjectNameForPath]);

  const handleNativeRecentProjectMenuAction = useCallback((payload: NativeRecentProjectMenuPayload) => {
    const projectName = recentProjectNameForPath(payload.path);
    if (payload.action === "reveal") {
      runRecentProjectMenuHandoff(
        payload,
        (path) => revealPathInFinder(path),
        `${projectName} revealed in Finder.`,
        `Reveal ${projectName} in Finder failed.`,
        "Check that the recent project folder still exists and Finder can access it.",
      );
      return;
    }
    if (payload.action === "open-editor") {
      runRecentProjectMenuHandoff(
        payload,
        (path) => openPathInExternalEditor(path),
        `${projectName} opened in the external editor.`,
        `Open ${projectName} in external editor failed.`,
        "Check the preferred external editor in macOS Settings, or choose an installed editor app.",
      );
      return;
    }
    if (payload.action === "open-external-terminal") {
      runRecentProjectMenuHandoff(
        payload,
        (path) => openPathInExternalTerminal(path),
        `${projectName} opened in the external terminal.`,
        `Open ${projectName} in external terminal failed.`,
        "Check the preferred external terminal in macOS Settings, or choose an installed terminal app.",
      );
      return;
    }
    if (payload.action === "new-terminal") {
      runRecentProjectMenuHandoff(
        payload,
        (path) => openEmbeddedTerminalAtPath(path),
        `Embedded terminal opened at ${projectName}.`,
        `Open embedded terminal at ${projectName} failed.`,
        "Check that the recent project folder still exists and macOS can access it.",
      );
      return;
    }
    if (payload.action === "copy-path") {
      runRecentProjectMenuHandoff(
        payload,
        (path) => copyTextToClipboard(path),
        `${projectName} POSIX path copied.`,
        `Copy ${projectName} POSIX path failed.`,
        "Check clipboard permissions and try again.",
      );
      return;
    }
    if (payload.action === "copy-link") {
      runRecentProjectMenuHandoff(
        payload,
        (path) => copyXolotlCodeOpenUrl(path),
        `${projectName} Xolotl link copied.`,
        `Copy ${projectName} Xolotl link failed.`,
        "Check clipboard permissions and try again.",
      );
      return;
    }
    if (payload.action === "copy-shell-open") {
      runRecentProjectMenuHandoff(
        payload,
        (path) => copyXolotlCodeOpenShellCommand(path),
        `${projectName} shell open command copied.`,
        `Copy ${projectName} shell open command failed.`,
        "Check clipboard permissions and try again.",
      );
      return;
    }
    if (payload.action === "copy-context") {
      runRecentProjectMenuHandoff(
        payload,
        (path, name) => copyProjectContextHandoff(path, name),
        `${projectName} context prompt copied.`,
        `Copy ${projectName} context prompt failed.`,
        "Check clipboard permissions and try again.",
      );
      return;
    }
    if (payload.action === "copy-shortcuts-json") {
      runRecentProjectMenuHandoff(
        payload,
        (path, name) => copyProjectAutomationHandoff(path, name),
        `${projectName} Shortcuts JSON copied.`,
        `Copy ${projectName} Shortcuts JSON failed.`,
        "Check clipboard permissions and try again.",
      );
    }
  }, [openEmbeddedTerminalAtPath, recentProjectNameForPath, runRecentProjectMenuHandoff]);

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
    if (action === "status-reveal-active-project") {
      runActiveProjectHandoff(
        revealPathInFinder,
        "Active project revealed in Finder.",
        "Reveal active project in Finder failed.",
        "Check that the active project folder still exists and Finder can access it.",
      );
      return;
    }
    if (action === "status-open-active-project-editor") {
      runActiveProjectHandoff(
        openPathInExternalEditor,
        "Active project opened in the external editor.",
        "Open active project in external editor failed.",
        "Check the preferred external editor in macOS Settings, or choose an installed editor app.",
      );
      return;
    }
    if (action === "status-open-active-project-terminal") {
      runActiveProjectHandoff(
        openPathInExternalTerminal,
        "Active project opened in the external terminal.",
        "Open active project in external terminal failed.",
        "Check the preferred external terminal in macOS Settings, or choose an installed terminal app.",
      );
      return;
    }
    if (action === "open-latest-agent") {
      openLatestAgentOutput();
      return;
    }
    if (action === "reveal-latest-agent-worktree") {
      runLatestAgentWorktreeHandoff(
        (path) => revealPathInFinder(path),
        "Latest agent worktree revealed in Finder.",
        "Reveal latest agent worktree in Finder failed.",
        "Check that the latest agent still has a worktree and that macOS can access it.",
      );
      return;
    }
    if (action === "open-latest-agent-worktree-editor") {
      runLatestAgentWorktreeHandoff(
        (path) => openPathInExternalEditor(path),
        "Latest agent worktree opened in the external editor.",
        "Open latest agent worktree in editor failed.",
        "Check that the latest agent still has a worktree, then check the preferred external editor in macOS Settings or choose an installed editor app.",
      );
      return;
    }
    if (action === "open-latest-agent-worktree-terminal") {
      runLatestAgentWorktreeHandoff(
        (path) => openPathInExternalTerminal(path),
        "Latest agent worktree opened in the external terminal.",
        "Open latest agent worktree in external terminal failed.",
        "Check that the latest agent still has a worktree, then check the preferred external terminal in macOS Settings or choose an installed terminal app.",
      );
      return;
    }
    if (action === "new-latest-agent-worktree-terminal-tab") {
      runLatestAgentWorktreeHandoff(
        (path) => openEmbeddedTerminalAtPath(path),
        "Embedded terminal opened at the latest agent worktree.",
        "Open latest agent worktree in embedded terminal failed.",
        "Check that the latest agent still has a worktree and that macOS can access it.",
      );
      return;
    }
    if (action === "copy-latest-agent-worktree-path") {
      runLatestAgentWorktreeHandoff(
        (path) => copyTextToClipboard(path),
        "Latest agent worktree POSIX path copied.",
        "Copy latest agent worktree POSIX path failed.",
        "Check that the latest agent still has a worktree, then check clipboard permissions and try again.",
      );
      return;
    }
    if (action === "copy-latest-agent-worktree-link") {
      runLatestAgentWorktreeHandoff(
        (path) => copyXolotlCodeOpenUrl(path),
        "Latest agent worktree Xolotl link copied.",
        "Copy latest agent worktree Xolotl link failed.",
        "Check that the latest agent still has a worktree, then check clipboard permissions and try again.",
      );
      return;
    }
    if (action === "copy-latest-agent-worktree-shell-open") {
      runLatestAgentWorktreeHandoff(
        (path) => copyXolotlCodeOpenShellCommand(path),
        "Latest agent worktree shell open command copied.",
        "Copy latest agent worktree shell open command failed.",
        "Check that the latest agent still has a worktree, then check clipboard permissions and try again.",
      );
      return;
    }
    if (action === "copy-latest-agent-worktree-context") {
      runLatestAgentWorktreeHandoff(
        (path, agent) => copyPathContextHandoff(path, { label: agent.task, kind: "Agent worktree" }),
        "Latest agent worktree context prompt copied.",
        "Copy latest agent worktree context prompt failed.",
        "Check that the latest agent still has a worktree, then check clipboard permissions and try again.",
      );
      return;
    }
    if (action === "copy-latest-agent-worktree-shortcuts-json") {
      runLatestAgentWorktreeHandoff(
        (path, agent) => copyPathAutomationHandoff(path, { label: agent.task, kind: "Agent worktree" }),
        "Latest agent worktree Shortcuts JSON copied.",
        "Copy latest agent worktree Shortcuts JSON failed.",
        "Check that the latest agent still has a worktree, then check clipboard permissions and try again.",
      );
      return;
    }
    if (action === "new-active-project-terminal-tab") {
      addActiveProjectTerminalTab();
      return;
    }
    if (action === "status-copy-active-project-link") {
      runActiveProjectHandoff(
        copyXolotlCodeOpenUrl,
        "Active project Xolotl link copied.",
        "Copy active project Xolotl link failed.",
        "Check clipboard permissions and try again.",
      );
      return;
    }
    if (action === "status-copy-active-project-shell-open") {
      runActiveProjectHandoff(
        copyXolotlCodeOpenShellCommand,
        "Active project shell open command copied.",
        "Copy active project shell open command failed.",
        "Check clipboard permissions and try again.",
      );
      return;
    }
    if (action === "copy-active-project-path") {
      runActiveProjectHandoff(
        copyTextToClipboard,
        "Active project POSIX path copied.",
        "Copy active project POSIX path failed.",
        "Check clipboard permissions and try again.",
      );
      return;
    }
    if (action === "copy-active-project-context") {
      runActiveProjectHandoff(
        copyProjectContextHandoff,
        "Active project context prompt copied.",
        "Copy active project context prompt failed.",
        "Check clipboard permissions and try again.",
        { includeProjectName: true },
      );
      return;
    }
    if (action === "copy-active-project-shortcuts-json") {
      runActiveProjectHandoff(
        copyProjectAutomationHandoff,
        "Active project Shortcuts JSON copied.",
        "Copy active project Shortcuts JSON failed.",
        "Check clipboard permissions and try again.",
        { includeProjectName: true },
      );
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
      void loadPondView();
      selectCenterTab("civ");
    }
  }, [addActiveProjectTerminalTab, addTerminalTab, closeActiveTerminalTab, openEmbeddedTerminalAtPath, openLatestAgentOutput, runActiveProjectHandoff, runLatestAgentWorktreeHandoff, selectAdjacentTerminalTab, selectCenterTab]);

  useEffect(() => listenForNativeMenuActions(handleNativeMenuAction), [handleNativeMenuAction]);

  useEffect(() => {
    const onMacAppStatus = (event: Event) => {
      setMacAppStatus((event as CustomEvent<MacAppStatus>).detail);
    };
    window.addEventListener(MAC_APP_STATUS_EVENT, onMacAppStatus);
    return () => window.removeEventListener(MAC_APP_STATUS_EVENT, onMacAppStatus);
  }, []);

  useEffect(() => {
    const handlePopState = () => setCenterTab(centerTabFromSearch(window.location.search));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    persistCenterTab(centerTab);
  }, [centerTab]);

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
    if (mergeCheckpointGroupId) {
      return (
        <Suspense fallback={<AgentViewLoading label="Loading merge checkpoint" />}>
          <LazyMergeCheckpointView groupId={mergeCheckpointGroupId} />
        </Suspense>
      );
    }
    if (expandedAgentId) {
      return (
        <Suspense fallback={<AgentViewLoading label="Loading agent output" />}>
          <LazyAgentOutputView agentId={expandedAgentId} />
        </Suspense>
      );
    }
    if (centerTab === "eval") {
      return (
        <Suspense fallback={<EvalLoading />}>
          <LazyEvalView />
        </Suspense>
      );
    }
    if (centerTab === "civ") {
      return (
        <Suspense fallback={<PondLoading />}>
          <LazyPondView />
        </Suspense>
      );
    }
    return (
      <Suspense fallback={<ChatLoading />}>
        <LazyChatPane />
      </Suspense>
    );
  }

  // The Pond game can take over the whole window, hiding all app chrome.
  const immersiveGame = gameFullscreen && centerTab === "civ" && !showAgentView;

  return (
    <div className="min-h-0 w-screen flex flex-row overflow-hidden xolotl-shell">
      <Suspense fallback={null}>
        <LazyMacRuntimeBridge selectCenterTab={selectCenterTab} />
      </Suspense>
      <Suspense fallback={null}>
        <LazyMacNativeMenuEventBridge
          onRecentProjectMenuAction={handleNativeRecentProjectMenuAction}
          onBridgeStatus={setMacAppStatus}
        />
      </Suspense>
      {!immersiveGame && <SessionSidebar forceCollapsed={compactShell} />}
      <div className="xolotl-workbench flex-1 min-w-0 min-h-0 flex flex-col">
        {!showAgentView && !immersiveGame && (
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
                onPreload={loadPondView}
                icon={<Sprout className="w-3.5 h-3.5" />}
                label="Pond"
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
              showAgentView || immersiveGame ? "xolotl-workspace-content-titlebar-safe" : "",
            ].join(" ")}
          >
            {renderCenter()}
          </div>
        </WorkspaceErrorBoundary>
        {macAppStatus && (
          <Suspense fallback={null}>
            <LazyMacAppStatusBanner status={macAppStatus} onDismiss={() => setMacAppStatus(null)} />
          </Suspense>
        )}
        {terminalDockMounted && (
          <Suspense fallback={null}>
            <LazyTerminalDock />
          </Suspense>
        )}
      </div>
      {!immersiveGame && (
        <Suspense fallback={<AgentPanelLoading forceCollapsed={compactShell} />}>
          <LazyAgentPanel forceCollapsed={compactShell} />
        </Suspense>
      )}
    </div>
  );
}

function AgentViewLoading({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-[oklch(0.105_0.004_250)]">
      <div className="flex items-center gap-2 rounded-md border border-[oklch(0.24_0.010_235)] bg-[oklch(0.12_0.004_245)] px-3 py-2 text-sm text-[oklch(0.66_0.025_210)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {label}
      </div>
    </div>
  );
}

function AgentPanelLoading({ forceCollapsed }: { forceCollapsed: boolean }) {
  return (
    <aside
      className={[
        "xolotl-sidebar xolotl-right-sidebar flex-none flex min-h-0 flex-col border-l border-[oklch(0.22_0.008_240)]",
        forceCollapsed ? "w-12" : "w-80",
      ].join(" ")}
      aria-label="Loading agents"
    >
      <div className="xolotl-sidebar-header">
        <div className="mx-auto h-8 w-8 rounded-md bg-[oklch(0.14_0.004_245)]" />
      </div>
    </aside>
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

function ChatLoading() {
  return (
    <div className="flex flex-1 items-center justify-center bg-[oklch(0.105_0.004_250)]">
      <div className="flex items-center gap-3 rounded-md border border-[oklch(0.24_0.010_235)] bg-[oklch(0.12_0.004_245)] px-4 py-3 text-sm text-[oklch(0.66_0.025_210)] shadow-[0_18px_48px_oklch(0_0_0_/_0.18)]">
        <div className="xolotl-mark scale-90" aria-hidden="true" />
        <div>
          <div className="font-semibold text-[oklch(0.88_0.025_220)]">Preparing Chat</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[oklch(0.55_0.018_205)]">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading composer
          </div>
        </div>
      </div>
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

function PondLoading() {
  return (
    <div className="flex flex-1 items-center justify-center bg-[oklch(0.105_0.004_250)]">
      <div className="flex items-center gap-3 rounded-md border border-[oklch(0.24_0.010_235)] bg-[oklch(0.12_0.004_245)] px-4 py-3 text-sm text-[oklch(0.66_0.025_210)] shadow-[0_18px_48px_oklch(0_0_0_/_0.18)]">
        <div className="xolotl-mark scale-90" aria-hidden="true" />
        <div>
          <div className="font-semibold text-[oklch(0.88_0.025_220)]">Preparing the Pond</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[oklch(0.55_0.018_205)]">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading village
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
