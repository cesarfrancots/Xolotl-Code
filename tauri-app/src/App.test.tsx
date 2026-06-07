import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { NATIVE_MENU_EVENT } from "./lib/nativeMenu";
import { useProjectStore } from "./stores/projectStore";
import { useTerminalStore } from "./stores/terminalStore";
import { useUiStore } from "./stores/uiStore";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
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

describe("App tab navigation", () => {
  beforeEach(() => {
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
});
