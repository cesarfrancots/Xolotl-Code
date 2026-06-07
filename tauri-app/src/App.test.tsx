import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { persistCenterTab } from "./lib/appNavigation";
import { MAC_APP_STATUS_EVENT } from "./lib/macAppStatus";
import { NATIVE_MENU_EVENT } from "./lib/nativeMenu";
import { useAgentStore } from "./stores/agentStore";
import { useProjectStore } from "./stores/projectStore";
import { useTerminalStore } from "./stores/terminalStore";
import { useUiStore } from "./stores/uiStore";

type CommandResult<T> = { status: "ok"; data: T } | { status: "error"; error: string };

const tauriEventMocks = vi.hoisted(() => ({
  listen: vi.fn((_eventName: string, _handler?: unknown) => Promise.resolve(() => {})),
}));
const commandMocks = vi.hoisted(() => ({
  getAgentWorktreePath: vi.fn<(agentId: string) => Promise<CommandResult<string>>>((_agentId) => Promise.resolve({
    status: "ok",
    data: "/Users/cesar/Documents/Xolotl/.xolotl-worktrees/agent-executing",
  })),
}));
const pathActionMocks = vi.hoisted(() => ({
  copyPathContextHandoff: vi.fn((_path: string, _options?: unknown) => Promise.resolve()),
  copyProjectContextHandoff: vi.fn((_path: string, _name?: string | null) => Promise.resolve()),
  copyTextToClipboard: vi.fn((_text: string) => Promise.resolve()),
  copyXolotlCodeOpenShellCommand: vi.fn((_path: string) => Promise.resolve()),
  copyXolotlCodeOpenUrl: vi.fn((_path: string) => Promise.resolve()),
  openPathInExternalEditor: vi.fn((_path: string) => Promise.resolve()),
  openPathInExternalTerminal: vi.fn((_path: string) => Promise.resolve()),
  revealPathInFinder: vi.fn((_path: string) => Promise.resolve()),
}));
const agentStoreMocks = vi.hoisted(() => {
  const state = {
    agents: [] as Array<{ id: string; state: string; task?: string }>,
    expandedAgentId: null as string | null,
    mergeCheckpointGroupId: null as string | null,
    setExpandedAgent: vi.fn((id: string | null) => {
      state.expandedAgentId = id;
    }),
  };
  return { state };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: tauriEventMocks.listen,
}));

vi.mock("./bindings", () => ({
  commands: commandMocks,
}));

vi.mock("./lib/pathActions", () => pathActionMocks);

vi.mock("./hooks/useMacGlobalHotkey", () => ({
  MAC_PRODUCTIVITY_SETTINGS_CHANGED_EVENT: "xolotl:mac-productivity-settings-changed",
  useMacGlobalHotkey: () => undefined,
}));

vi.mock("./hooks/useMacStatusItem", () => ({
  useMacStatusItem: () => undefined,
}));

vi.mock("./components/sidebar/SessionSidebar", () => ({
  SessionSidebar: () => <aside>Sessions</aside>,
}));

vi.mock("./components/chat/ChatPane", () => ({
  ChatPane: () => <main>Chat workspace</main>,
}));

vi.mock("./components/agent/AgentPanel", () => ({
  AgentPanel: () => <aside>Agents</aside>,
}));

vi.mock("./components/agent/AgentOutputView", () => ({
  AgentOutputView: () => <main>Agent output</main>,
}));

vi.mock("./components/agent/MergeCheckpointView", () => ({
  MergeCheckpointView: () => <main>Merge checkpoint</main>,
}));

vi.mock("./components/eval/EvalView", () => ({
  EvalView: () => <main>Eval workspace</main>,
}));

vi.mock("./components/civilization/CivilizationView", () => ({
  CivilizationView: () => <main>Civilization workspace</main>,
}));

vi.mock("./components/terminal/TerminalDock", () => ({
  TerminalDock: () => <div>Terminal dock</div>,
}));

vi.mock("./stores/agentStore", () => ({
  useAgentStore: Object.assign(
    (selector: (state: typeof agentStoreMocks.state) => unknown) => selector(agentStoreMocks.state),
    {
      getState: () => agentStoreMocks.state,
    },
  ),
}));

function installTestStorage() {
  const items = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => Array.from(items.keys())[index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
}

describe("App tab navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installTestStorage();
    localStorage.clear();
    window.history.replaceState(null, "", "/");
    useUiStore.setState({
      sessionsCollapsed: false,
      agentsCollapsed: false,
      enabledSkills: [],
      terminalPanelOpen: false,
      terminalPanelHeight: 280,
    });
    useTerminalStore.setState({ tabs: [], activeKey: null });
    useProjectStore.setState({ activeProjectPath: null, projects: [], listing: null });
    agentStoreMocks.state.agents = [];
    agentStoreMocks.state.expandedAgentId = null;
    agentStoreMocks.state.mergeCheckpointGroupId = null;
    agentStoreMocks.state.setExpandedAgent.mockClear();
    commandMocks.getAgentWorktreePath.mockResolvedValue({
      status: "ok",
      data: "/Users/cesar/Documents/Xolotl/.xolotl-worktrees/agent-executing",
    });
    tauriEventMocks.listen.mockImplementation((_eventName: string, _handler?: unknown) => Promise.resolve(() => {}));
  });

  it("keeps the app shell constrained to the visible viewport", () => {
    const { container } = render(<App />);

    const shell = container.firstElementChild;
    expect(shell).toBeTruthy();
    expect(shell?.classList.contains("xolotl-shell")).toBe(true);
    expect(shell?.classList.contains("min-h-0")).toBe(true);
    expect(shell?.classList.contains("overflow-hidden")).toBe(true);
  });

  it("opens the eval workspace from the tab query", async () => {
    window.history.replaceState(null, "", "/?tab=eval");

    render(<App />);

    expect(await screen.findByText("Eval workspace")).toBeTruthy();
  });

  it("restores the last workbench tab when the URL has no explicit tab", async () => {
    persistCenterTab("civ");

    render(<App />);

    expect(await screen.findByText("Civilization workspace")).toBeTruthy();
    expect(window.location.search).toBe("");
  });

  it("lets explicit tab URLs override the restored workbench tab", async () => {
    persistCenterTab("civ");
    window.history.replaceState(null, "", "/?tab=eval");

    render(<App />);

    expect(await screen.findByText("Eval workspace")).toBeTruthy();
  });

  it("opens the civilization workspace from the tab query", async () => {
    window.history.replaceState(null, "", "/?tab=civ");

    render(<App />);

    expect(await screen.findByText("Civilization workspace")).toBeTruthy();
  });

  it("keeps the tab query in sync with workspace selection", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/?tab=eval");
    render(<App />);

    await user.click(screen.getByRole("button", { name: /chat/i }));

    expect(screen.getByText("Chat workspace")).toBeTruthy();
    expect(window.location.search).toBe("");

    await user.click(screen.getByRole("button", { name: /eval/i }));

    expect(await screen.findByText("Eval workspace")).toBeTruthy();
    expect(window.location.search).toBe("?tab=eval");

    await user.click(screen.getByRole("button", { name: /civ/i }));

    expect(await screen.findByText("Civilization workspace")).toBeTruthy();
    expect(window.location.search).toBe("?tab=civ");
  });

  it("switches workspace tabs from native menu actions", async () => {
    render(<App />);

    fireEvent(window, new CustomEvent(NATIVE_MENU_EVENT, { detail: "tab-eval" }));
    expect(await screen.findByText("Eval workspace")).toBeTruthy();
    expect(window.location.search).toBe("?tab=eval");

    fireEvent(window, new CustomEvent(NATIVE_MENU_EVENT, { detail: "tab-chat" }));
    expect(screen.getByText("Chat workspace")).toBeTruthy();
    expect(window.location.search).toBe("");
  });

  it("runs active project handoffs from menu bar status item actions", async () => {
    useProjectStore.setState({ activeProjectPath: "/Users/cesar/Documents/Xolotl" });
    render(<App />);

    fireEvent(window, new CustomEvent(NATIVE_MENU_EVENT, { detail: "status-reveal-active-project" }));

    await waitFor(() => {
      expect(pathActionMocks.revealPathInFinder).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
    });
    expect(await screen.findByText("Active project revealed in Finder.")).toBeTruthy();
  });

  it("copies active project automation commands from the menu bar status item", async () => {
    useProjectStore.setState({ activeProjectPath: "/Users/cesar/Documents/Xolotl" });
    render(<App />);

    fireEvent(window, new CustomEvent(NATIVE_MENU_EVENT, { detail: "status-copy-active-project-link" }));

    await waitFor(() => {
      expect(pathActionMocks.copyXolotlCodeOpenUrl).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
    });
    expect(await screen.findByText("Active project Xolotl link copied.")).toBeTruthy();

    fireEvent(window, new CustomEvent(NATIVE_MENU_EVENT, { detail: "status-copy-active-project-shell-open" }));

    await waitFor(() => {
      expect(pathActionMocks.copyXolotlCodeOpenShellCommand).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
    });
    expect(await screen.findByText("Active project shell open command copied.")).toBeTruthy();
  });

  it("copies active project context prompts from native active project actions", async () => {
    useProjectStore.setState({
      activeProjectPath: "/Users/cesar/Documents/Xolotl",
      projects: [{
        path: "/Users/cesar/Documents/Xolotl",
        name: "Xolotl Code",
        added_at: 1,
        last_opened_at: 2,
      }],
    });
    render(<App />);

    fireEvent(window, new CustomEvent(NATIVE_MENU_EVENT, { detail: "copy-active-project-context" }));

    await waitFor(() => {
      expect(pathActionMocks.copyProjectContextHandoff).toHaveBeenCalledWith(
        "/Users/cesar/Documents/Xolotl",
        "Xolotl Code",
      );
    });
    expect(await screen.findByText("Active project context prompt copied.")).toBeTruthy();
  });

  it("copies only the active project POSIX path from native active project actions", async () => {
    useProjectStore.setState({
      activeProjectPath: "/Users/cesar/Documents/Xolotl",
      projects: [{
        path: "/Users/cesar/Documents/Xolotl",
        name: "Xolotl Code",
        added_at: 1,
        last_opened_at: 2,
      }],
    });
    render(<App />);

    fireEvent(window, new CustomEvent(NATIVE_MENU_EVENT, { detail: "copy-active-project-path" }));

    await waitFor(() => {
      expect(pathActionMocks.copyTextToClipboard).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl");
    });
    expect(pathActionMocks.copyTextToClipboard.mock.calls[0]).toHaveLength(1);
    expect(await screen.findByText("Active project POSIX path copied.")).toBeTruthy();
  });

  it("opens an embedded terminal tab at the active project from native active project actions", async () => {
    useProjectStore.setState({ activeProjectPath: "/Users/cesar/Documents/Xolotl" });
    render(<App />);

    fireEvent(window, new CustomEvent(NATIVE_MENU_EVENT, { detail: "new-active-project-terminal-tab" }));

    expect(await screen.findByText("Terminal dock")).toBeTruthy();
    const tabs = useTerminalStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].cwd).toBe("/Users/cesar/Documents/Xolotl");
    expect(useTerminalStore.getState().activeKey).toBe(tabs[0].key);
    expect(await screen.findByText("Embedded terminal opened at the active project.")).toBeTruthy();
  });

  it("shows recovery when native active project actions have no active project", async () => {
    render(<App />);

    fireEvent(window, new CustomEvent(NATIVE_MENU_EVENT, { detail: "status-open-active-project-editor" }));

    expect(await screen.findByText("No active project is available.")).toBeTruthy();
    expect(screen.getByText("Open a project before using active project actions.")).toBeTruthy();
    expect(pathActionMocks.openPathInExternalEditor).not.toHaveBeenCalled();
  });

  it("shows recovery when menu bar external terminal handoff fails", async () => {
    pathActionMocks.openPathInExternalTerminal.mockRejectedValueOnce(new Error("Warp missing"));
    useProjectStore.setState({ activeProjectPath: "/Users/cesar/Documents/Xolotl" });
    render(<App />);

    fireEvent(window, new CustomEvent(NATIVE_MENU_EVENT, { detail: "status-open-active-project-terminal" }));

    expect(await screen.findByText("Open active project in external terminal failed.")).toBeTruthy();
    expect(screen.getByText(/Check the preferred external terminal in macOS Settings/)).toBeTruthy();
    expect(screen.getByText(/Warp missing/)).toBeTruthy();
  });

  it("shows recovery when menu bar copy automation fails", async () => {
    pathActionMocks.copyXolotlCodeOpenUrl.mockRejectedValueOnce(new Error("clipboard denied"));
    useProjectStore.setState({ activeProjectPath: "/Users/cesar/Documents/Xolotl" });
    render(<App />);

    fireEvent(window, new CustomEvent(NATIVE_MENU_EVENT, { detail: "status-copy-active-project-link" }));

    expect(await screen.findByText("Copy active project Xolotl link failed.")).toBeTruthy();
    expect(screen.getByText(/Check clipboard permissions and try again/)).toBeTruthy();
    expect(screen.getByText(/clipboard denied/)).toBeTruthy();
  });

  it("opens the most relevant agent output from native menu actions", async () => {
    agentStoreMocks.state.agents = [
      { id: "agent-done", state: "Done", task: "Polish old Mac menu" },
      { id: "agent-waiting", state: "Waiting", task: "Wait for Mac QA" },
      { id: "agent-executing", state: "Executing", task: "Implement Mac handoffs" },
    ];
    render(<App />);

    fireEvent(window, new CustomEvent(NATIVE_MENU_EVENT, { detail: "open-latest-agent" }));

    await waitFor(() => {
      expect(agentStoreMocks.state.setExpandedAgent).toHaveBeenCalledWith("agent-executing");
    });
    expect(useAgentStore.getState().expandedAgentId).toBe("agent-executing");
    expect(await screen.findByText("Latest agent output opened.")).toBeTruthy();
    expect(await screen.findByText("Agent output")).toBeTruthy();
  });

  it("shows recovery when native menu agent output actions have no agent output", async () => {
    render(<App />);

    fireEvent(window, new CustomEvent(NATIVE_MENU_EVENT, { detail: "open-latest-agent" }));

    expect(await screen.findByText("No agent output is available.")).toBeTruthy();
    expect(screen.getByText("Start an agent run before using latest agent actions.")).toBeTruthy();
    expect(agentStoreMocks.state.setExpandedAgent).not.toHaveBeenCalled();
  });

  it("runs latest agent worktree handoffs from native menu actions", async () => {
    agentStoreMocks.state.agents = [
      { id: "agent-done", state: "Done", task: "Polish old Mac menu" },
      { id: "agent-waiting", state: "Waiting", task: "Wait for Mac QA" },
      { id: "agent-executing", state: "Executing", task: "Implement Mac handoffs" },
    ];
    render(<App />);

    fireEvent(window, new CustomEvent(NATIVE_MENU_EVENT, { detail: "reveal-latest-agent-worktree" }));

    await waitFor(() => {
      expect(commandMocks.getAgentWorktreePath).toHaveBeenCalledWith("agent-executing");
      expect(pathActionMocks.revealPathInFinder).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl/.xolotl-worktrees/agent-executing");
    });
    expect(await screen.findByText("Latest agent worktree revealed in Finder.")).toBeTruthy();

    fireEvent(window, new CustomEvent(NATIVE_MENU_EVENT, { detail: "new-latest-agent-worktree-terminal-tab" }));

    expect(await screen.findByText("Terminal dock")).toBeTruthy();
    const tabs = useTerminalStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].cwd).toBe("/Users/cesar/Documents/Xolotl/.xolotl-worktrees/agent-executing");
    expect(useTerminalStore.getState().activeKey).toBe(tabs[0].key);
    expect(await screen.findByText("Embedded terminal opened at the latest agent worktree.")).toBeTruthy();

    fireEvent(window, new CustomEvent(NATIVE_MENU_EVENT, { detail: "copy-latest-agent-worktree-shell-open" }));

    await waitFor(() => {
      expect(pathActionMocks.copyXolotlCodeOpenShellCommand).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl/.xolotl-worktrees/agent-executing");
    });
    expect(await screen.findByText("Latest agent worktree shell open command copied.")).toBeTruthy();

    fireEvent(window, new CustomEvent(NATIVE_MENU_EVENT, { detail: "copy-latest-agent-worktree-context" }));

    await waitFor(() => {
      expect(pathActionMocks.copyPathContextHandoff).toHaveBeenCalledWith(
        "/Users/cesar/Documents/Xolotl/.xolotl-worktrees/agent-executing",
        { label: "Implement Mac handoffs", kind: "Agent worktree" },
      );
    });
    expect(await screen.findByText("Latest agent worktree context prompt copied.")).toBeTruthy();
  });

  it("shows recovery when the latest agent worktree cannot be resolved", async () => {
    commandMocks.getAgentWorktreePath.mockResolvedValueOnce({
      status: "error",
      error: "no worktree path for agent agent-done",
    });
    agentStoreMocks.state.agents = [{ id: "agent-done", state: "Done" }];
    render(<App />);

    fireEvent(window, new CustomEvent(NATIVE_MENU_EVENT, { detail: "open-latest-agent-worktree-editor" }));

    expect(await screen.findByText("Open latest agent worktree in editor failed.")).toBeTruthy();
    expect(screen.getByText(/latest agent still has a worktree/)).toBeTruthy();
    expect(screen.getByText(/no worktree path for agent agent-done/)).toBeTruthy();
    expect(pathActionMocks.openPathInExternalEditor).not.toHaveBeenCalled();
  });

  it("shows recovery when native latest agent worktree actions have no agent output", async () => {
    render(<App />);

    fireEvent(window, new CustomEvent(NATIVE_MENU_EVENT, { detail: "reveal-latest-agent-worktree" }));

    expect(await screen.findByText("No agent output is available.")).toBeTruthy();
    expect(screen.getByText("Start an agent run before using latest agent actions.")).toBeTruthy();
    expect(commandMocks.getAgentWorktreePath).not.toHaveBeenCalled();
  });

  it("marks the active workbench segment and exposes Mac shortcut hints", async () => {
    const user = userEvent.setup();
    render(<App />);

    const chat = screen.getByRole("button", { name: "Chat" });
    const evalTab = screen.getByRole("button", { name: "Eval" });
    const civ = screen.getByRole("button", { name: "Civ" });

    expect(chat.getAttribute("aria-pressed")).toBe("true");
    expect(evalTab.getAttribute("aria-pressed")).toBe("false");
    expect(chat.getAttribute("title")).toBe("Chat (⌘1)");
    expect(evalTab.getAttribute("title")).toBe("Eval (⌘2)");
    expect(civ.getAttribute("title")).toBe("Civ (⌘3)");

    await user.click(evalTab);

    expect(chat.getAttribute("aria-pressed")).toBe("false");
    expect(evalTab.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("xolotl-last-workbench-tab")).toBe("eval");
  });

  it("exposes overlay-titlebar drag regions in the workbench toolbar", () => {
    const { container } = render(<App />);

    const workbench = container.querySelector(".xolotl-workbench");
    const toolbar = container.querySelector(".xolotl-workbench-bar");
    const dragRegions = toolbar?.querySelectorAll("[data-tauri-drag-region]");

    expect(workbench).toBeTruthy();
    expect(toolbar).toBeTruthy();
    expect(dragRegions?.length).toBe(2);
    expect(container.querySelector(".xolotl-workspace-content")).toBeTruthy();
  });

  it("supports Mac command-number shortcuts for workspace tabs", async () => {
    render(<App />);

    fireEvent.keyDown(window, { key: "3", metaKey: true });

    expect(await screen.findByText("Civilization workspace")).toBeTruthy();
    expect(window.location.search).toBe("?tab=civ");
  });

  it("dispatches shared Mac global shortcuts through the native action bridge", () => {
    const actions: string[] = [];
    const onAction = (event: Event) => actions.push((event as CustomEvent<string>).detail);
    window.addEventListener(NATIVE_MENU_EVENT, onAction);

    try {
      render(<App />);

      fireEvent.keyDown(window, { key: "n", metaKey: true });
      fireEvent.keyDown(window, { key: "o", metaKey: true });
      fireEvent.keyDown(window, { key: ",", metaKey: true });
      fireEvent.keyDown(window, { key: "k", metaKey: true });
      fireEvent.keyDown(window, { key: "j", metaKey: true });
      fireEvent.keyDown(window, { key: "`", code: "Backquote", ctrlKey: true });

      expect(actions).toEqual([
        "new-chat",
        "open-folder",
        "settings",
        "commands",
        "toggle-terminal",
        "toggle-terminal",
      ]);
    } finally {
      window.removeEventListener(NATIVE_MENU_EVENT, onAction);
    }
  });

  it("shows and dismisses app-level Mac status events", async () => {
    render(<App />);

    fireEvent(window, new CustomEvent(MAC_APP_STATUS_EVENT, {
      detail: {
        tone: "error",
        message: "Global hotkey registration failed.",
        hint: "Pick a different shortcut.",
      },
    }));

    expect(await screen.findByText("Global hotkey registration failed.")).toBeTruthy();
    expect(screen.getByText("Pick a different shortcut.")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Dismiss Mac app status"));

    expect(screen.queryByText("Global hotkey registration failed.")).toBeNull();
  });

  it("shows recovery when the native menu bridge listener fails", async () => {
    tauriEventMocks.listen.mockImplementation((eventName: string) => {
      if (eventName === "xolotl://menu") return Promise.reject(new Error("listener denied"));
      return Promise.resolve(() => {});
    });

    render(<App />);

    expect(await screen.findByText("Native menu bridge unavailable.")).toBeTruthy();
    expect(screen.getByText(/Restart Xolotl Code if menu commands stop responding/)).toBeTruthy();
    expect(screen.getByText(/listener denied/)).toBeTruthy();
  });

  it("returns to chat for the native new chat action", async () => {
    window.history.replaceState(null, "", "/?tab=eval");
    render(<App />);
    expect(await screen.findByText("Eval workspace")).toBeTruthy();

    fireEvent(window, new CustomEvent(NATIVE_MENU_EVENT, { detail: "new-chat" }));

    expect(screen.getByText("Chat workspace")).toBeTruthy();
    expect(window.location.search).toBe("");
  });

  it("handles Mac terminal tab shortcuts globally when the dock is open", async () => {
    useUiStore.setState({ terminalPanelOpen: true });
    useProjectStore.setState({ activeProjectPath: "/Users/cesar/work" });
    render(<App />);
    expect(await screen.findByText("Terminal dock")).toBeTruthy();

    fireEvent.keyDown(window, { key: "t", metaKey: true });

    const tabs = useTerminalStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].cwd).toBe("/Users/cesar/work");
    expect(useTerminalStore.getState().activeKey).toBe(tabs[0].key);

    fireEvent.keyDown(window, { key: "w", metaKey: true });
    expect(useTerminalStore.getState().tabs).toHaveLength(0);
    expect(useUiStore.getState().terminalPanelOpen).toBe(false);
  });

  it("does not reserve terminal tab shortcuts while the dock is closed", () => {
    render(<App />);

    fireEvent.keyDown(window, { key: "t", metaKey: true });
    fireEvent.keyDown(window, { key: "w", metaKey: true });

    expect(useTerminalStore.getState().tabs).toHaveLength(0);
    expect(useUiStore.getState().terminalPanelOpen).toBe(false);
  });
});
