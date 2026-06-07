import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { persistCenterTab } from "./lib/appNavigation";
import { MAC_APP_STATUS_EVENT } from "./lib/macAppStatus";
import { NATIVE_MENU_EVENT } from "./lib/nativeMenu";
import { useProjectStore } from "./stores/projectStore";
import { useTerminalStore } from "./stores/terminalStore";
import { useUiStore } from "./stores/uiStore";

const tauriEventMocks = vi.hoisted(() => ({
  listen: vi.fn((_eventName: string, _handler?: unknown) => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: tauriEventMocks.listen,
}));

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
  useAgentStore: (selector: (state: { expandedAgentId: null; mergeCheckpointGroupId: null }) => unknown) =>
    selector({ expandedAgentId: null, mergeCheckpointGroupId: null }),
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
