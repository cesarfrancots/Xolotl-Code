import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TerminalPanel } from "./TerminalPanel";
import { useTerminalStore } from "../../stores/terminalStore";
import { useUiStore } from "../../stores/uiStore";
import { useProjectStore } from "../../stores/projectStore";

const pathActionMocks = vi.hoisted(() => ({
  copyTextToClipboard: vi.fn().mockResolvedValue(undefined),
  copyXolotlCodeOpenShellCommand: vi.fn().mockResolvedValue(undefined),
  copyXolotlCodeOpenUrl: vi.fn().mockResolvedValue(undefined),
  openPathInExternalTerminal: vi.fn().mockResolvedValue(undefined),
  revealPathInFinder: vi.fn().mockResolvedValue(undefined),
}));

// Stub the xterm-backed view so the test never touches the real terminal.
vi.mock("./TerminalView", () => ({
  TerminalView: ({ tabKey, visible, cwd }: { tabKey: string; visible: boolean; cwd: string | null }) => (
    <div data-testid={`view-${tabKey}`} data-visible={String(visible)} data-cwd={cwd ?? ""} />
  ),
}));

vi.mock("../../lib/pathActions", () => pathActionMocks);

beforeEach(() => {
  useTerminalStore.setState({ tabs: [], activeKey: null });
  useUiStore.setState({ terminalPanelOpen: true });
  useProjectStore.setState({ activeProjectPath: null, projects: [], listing: null });
  vi.clearAllMocks();
});

it("auto-creates one terminal tab when opened empty", () => {
  render(<TerminalPanel />);
  expect(useTerminalStore.getState().tabs).toHaveLength(1);
});

it("adds a tab when the new-terminal button is clicked", async () => {
  const user = userEvent.setup();
  render(<TerminalPanel />);
  await user.click(screen.getByLabelText("New terminal"));
  expect(useTerminalStore.getState().tabs).toHaveLength(2);
});

it("launches new terminal tabs in the active project directory", async () => {
  const user = userEvent.setup();
  useProjectStore.setState({ activeProjectPath: "/Users/cesar/project-a" });

  render(<TerminalPanel />);
  expect(useTerminalStore.getState().tabs[0].cwd).toBe("/Users/cesar/project-a");
  expect(screen.getByLabelText("New terminal").getAttribute("title")).toBe("New terminal in project-a (⌘T)");

  useProjectStore.setState({ activeProjectPath: "/Users/cesar/project-b" });
  await user.click(screen.getByLabelText("New terminal"));

  const tabs = useTerminalStore.getState().tabs;
  expect(tabs[0].cwd).toBe("/Users/cesar/project-a");
  expect(tabs[1].cwd).toBe("/Users/cesar/project-b");
  expect(screen.getByTestId(`view-${tabs[1].key}`).getAttribute("data-cwd")).toBe("/Users/cesar/project-b");
});

it("shows active terminal shell profile metadata after spawn", () => {
  render(<TerminalPanel />);
  const tab = useTerminalStore.getState().tabs[0];

  act(() => {
    useTerminalStore.getState().setBackendInfo(tab.key, {
      id: "pty-1",
      shell: "/bin/zsh",
      shell_name: "zsh",
      cwd: "/Users/cesar/project-a",
      env_source: "Inherited app environment + $SHELL",
    });
  });

  expect(screen.getByText("zsh")).toBeTruthy();
  expect(screen.getByText("~/project-a")).toBeTruthy();
  expect(screen.getByText("Inherited app environment + $SHELL")).toBeTruthy();
});

it("offers external terminal, Finder, and automation copy actions for the active terminal cwd", async () => {
  const user = userEvent.setup();
  render(<TerminalPanel />);
  const tab = useTerminalStore.getState().tabs[0];

  act(() => {
    useTerminalStore.getState().setBackendInfo(tab.key, {
      id: "pty-1",
      shell: "/bin/zsh",
      shell_name: "zsh",
      cwd: "/Users/cesar/project-a",
      env_source: "Inherited app environment + $SHELL",
    });
  });

  await user.click(screen.getByLabelText("Reveal terminal cwd in Finder"));
  await waitFor(() => {
    expect(pathActionMocks.revealPathInFinder).toHaveBeenCalledWith("/Users/cesar/project-a");
    expect(screen.getByText("Terminal cwd revealed in Finder.")).toBeTruthy();
  });

  await user.click(screen.getByLabelText("Open terminal cwd in external terminal"));
  await waitFor(() => {
    expect(pathActionMocks.openPathInExternalTerminal).toHaveBeenCalledWith("/Users/cesar/project-a");
    expect(screen.getByText("Terminal cwd opened in external terminal.")).toBeTruthy();
  });

  await user.click(screen.getByLabelText("Copy terminal cwd POSIX path"));
  await waitFor(() => {
    expect(pathActionMocks.copyTextToClipboard).toHaveBeenCalledWith("/Users/cesar/project-a");
    expect(screen.getByText("Terminal cwd path copied.")).toBeTruthy();
  });

  await user.click(screen.getByLabelText("Copy terminal cwd Xolotl link"));
  await waitFor(() => {
    expect(pathActionMocks.copyXolotlCodeOpenUrl).toHaveBeenCalledWith("/Users/cesar/project-a");
    expect(screen.getByText("Terminal cwd Xolotl link copied.")).toBeTruthy();
  });

  await user.click(screen.getByLabelText("Copy terminal cwd shell open command"));
  await waitFor(() => {
    expect(pathActionMocks.copyXolotlCodeOpenShellCommand).toHaveBeenCalledWith("/Users/cesar/project-a");
    expect(screen.getByText("Terminal cwd shell open command copied.")).toBeTruthy();
  });
});

it("shows recovery guidance when revealing the terminal cwd fails", async () => {
  pathActionMocks.revealPathInFinder.mockRejectedValueOnce(new Error("Folder missing"));
  const user = userEvent.setup();
  render(<TerminalPanel />);
  const tab = useTerminalStore.getState().tabs[0];

  act(() => {
    useTerminalStore.getState().setBackendInfo(tab.key, {
      id: "pty-1",
      shell: "/bin/zsh",
      shell_name: "zsh",
      cwd: "/Users/cesar/project-a",
      env_source: "Inherited app environment + $SHELL",
    });
  });

  await user.click(screen.getByLabelText("Reveal terminal cwd in Finder"));

  expect(await screen.findByText("Reveal terminal cwd in Finder failed.")).toBeTruthy();
  expect(screen.getByText(/Check that the terminal folder still exists/)).toBeTruthy();
  expect(screen.getByText(/Folder missing/)).toBeTruthy();
});

it("shows recovery guidance when opening the terminal cwd in an external terminal fails", async () => {
  pathActionMocks.openPathInExternalTerminal.mockRejectedValueOnce(new Error("Terminal missing"));
  const user = userEvent.setup();
  render(<TerminalPanel />);
  const tab = useTerminalStore.getState().tabs[0];

  act(() => {
    useTerminalStore.getState().setBackendInfo(tab.key, {
      id: "pty-1",
      shell: "/bin/zsh",
      shell_name: "zsh",
      cwd: "/Users/cesar/project-a",
      env_source: "Inherited app environment + $SHELL",
    });
  });

  await user.click(screen.getByLabelText("Open terminal cwd in external terminal"));

  expect(await screen.findByText("Open terminal cwd in external terminal failed.")).toBeTruthy();
  expect(screen.getByText(/Check the external terminal setting in macOS Settings/)).toBeTruthy();
  expect(screen.getByText(/Terminal missing/)).toBeTruthy();
});

it("shows recovery guidance when copying the terminal cwd fails", async () => {
  pathActionMocks.copyTextToClipboard.mockRejectedValueOnce(new Error("Clipboard blocked"));
  const user = userEvent.setup();
  render(<TerminalPanel />);
  const tab = useTerminalStore.getState().tabs[0];

  act(() => {
    useTerminalStore.getState().setBackendInfo(tab.key, {
      id: "pty-1",
      shell: "/bin/zsh",
      shell_name: "zsh",
      cwd: "/Users/cesar/project-a",
      env_source: "Inherited app environment + $SHELL",
    });
  });

  await user.click(screen.getByLabelText("Copy terminal cwd POSIX path"));

  expect(await screen.findByText("Copy terminal cwd path failed.")).toBeTruthy();
  expect(screen.getByText(/Check macOS clipboard access/)).toBeTruthy();
  expect(screen.getByText(/Clipboard blocked/)).toBeTruthy();
});

it("shows recovery guidance when copying the terminal cwd Xolotl link fails", async () => {
  pathActionMocks.copyXolotlCodeOpenUrl.mockRejectedValueOnce(new Error("Clipboard blocked"));
  const user = userEvent.setup();
  render(<TerminalPanel />);
  const tab = useTerminalStore.getState().tabs[0];

  act(() => {
    useTerminalStore.getState().setBackendInfo(tab.key, {
      id: "pty-1",
      shell: "/bin/zsh",
      shell_name: "zsh",
      cwd: "/Users/cesar/project-a",
      env_source: "Inherited app environment + $SHELL",
    });
  });

  await user.click(screen.getByLabelText("Copy terminal cwd Xolotl link"));

  expect(await screen.findByText("Copy terminal cwd Xolotl link failed.")).toBeTruthy();
  expect(screen.getByText(/try copying the Xolotl link again/)).toBeTruthy();
  expect(screen.getByText(/Clipboard blocked/)).toBeTruthy();
});

it("shows recovery guidance when copying the terminal cwd shell open command fails", async () => {
  pathActionMocks.copyXolotlCodeOpenShellCommand.mockRejectedValueOnce(new Error("Clipboard blocked"));
  const user = userEvent.setup();
  render(<TerminalPanel />);
  const tab = useTerminalStore.getState().tabs[0];

  act(() => {
    useTerminalStore.getState().setBackendInfo(tab.key, {
      id: "pty-1",
      shell: "/bin/zsh",
      shell_name: "zsh",
      cwd: "/Users/cesar/project-a",
      env_source: "Inherited app environment + $SHELL",
    });
  });

  await user.click(screen.getByLabelText("Copy terminal cwd shell open command"));

  expect(await screen.findByText("Copy terminal cwd shell open command failed.")).toBeTruthy();
  expect(screen.getByText(/try copying the shell open command again/)).toBeTruthy();
  expect(screen.getByText(/Clipboard blocked/)).toBeTruthy();
});

it("dismisses terminal handoff status messages", async () => {
  const user = userEvent.setup();
  render(<TerminalPanel />);
  const tab = useTerminalStore.getState().tabs[0];

  act(() => {
    useTerminalStore.getState().setBackendInfo(tab.key, {
      id: "pty-1",
      shell: "/bin/zsh",
      shell_name: "zsh",
      cwd: "/Users/cesar/project-a",
      env_source: "Inherited app environment + $SHELL",
    });
  });

  await user.click(screen.getByLabelText("Copy terminal cwd POSIX path"));
  expect(await screen.findByText("Terminal cwd path copied.")).toBeTruthy();

  await user.click(screen.getByLabelText("Dismiss terminal status"));
  expect(screen.queryByText("Terminal cwd path copied.")).toBeNull();
});

it("closes a tab when its close button is clicked", async () => {
  const user = userEvent.setup();
  render(<TerminalPanel />);
  await user.click(screen.getByLabelText("New terminal"));
  expect(useTerminalStore.getState().tabs).toHaveLength(2);

  const firstTitle = useTerminalStore.getState().tabs[0].title;
  await user.click(screen.getByLabelText(`Close ${firstTitle}`));
  expect(useTerminalStore.getState().tabs).toHaveLength(1);
});

it("keeps titles unique after closing an earlier tab and adding a new one", async () => {
  const user = userEvent.setup();
  render(<TerminalPanel />); // auto-creates one tab
  await user.click(screen.getByLabelText("New terminal"));
  const firstTitle = useTerminalStore.getState().tabs[0].title;
  await user.click(screen.getByLabelText(`Close ${firstTitle}`));
  await user.click(screen.getByLabelText("New terminal"));

  const titles = useTerminalStore.getState().tabs.map((t) => t.title);
  expect(new Set(titles).size).toBe(titles.length);
});

it("collapses the dock when the last tab is closed", async () => {
  const user = userEvent.setup();
  render(<TerminalPanel />);
  const title = useTerminalStore.getState().tabs[0].title;
  await user.click(screen.getByLabelText(`Close ${title}`));
  expect(useTerminalStore.getState().tabs).toHaveLength(0);
  expect(useUiStore.getState().terminalPanelOpen).toBe(false);
});

it("marks the active terminal view visible only while the dock is open", () => {
  const { rerender } = render(<TerminalPanel />);
  const activeKey = useTerminalStore.getState().activeKey;
  expect(screen.getByTestId(`view-${activeKey}`).getAttribute("data-visible")).toBe("true");

  useUiStore.setState({ terminalPanelOpen: false });
  rerender(<TerminalPanel />);
  expect(screen.getByTestId(`view-${activeKey}`).getAttribute("data-visible")).toBe("false");

  useUiStore.setState({ terminalPanelOpen: true });
  rerender(<TerminalPanel />);
  expect(screen.getByTestId(`view-${activeKey}`).getAttribute("data-visible")).toBe("true");
});

it("supports Mac terminal dock shortcuts for tabs", () => {
  render(<TerminalPanel />);
  const dock = screen.getByRole("region", { name: "Terminal dock" });
  const firstKey = useTerminalStore.getState().activeKey;

  fireEvent.keyDown(dock, { key: "t", metaKey: true });
  fireEvent.keyDown(dock, { key: "t", metaKey: true });

  const tabsAfterAdd = useTerminalStore.getState().tabs;
  expect(tabsAfterAdd).toHaveLength(3);
  expect(useTerminalStore.getState().activeKey).toBe(tabsAfterAdd[2].key);

  fireEvent.keyDown(dock, { key: "ArrowLeft", metaKey: true, shiftKey: true });
  expect(useTerminalStore.getState().activeKey).toBe(tabsAfterAdd[1].key);

  fireEvent.keyDown(dock, { key: "ArrowRight", metaKey: true, shiftKey: true });
  expect(useTerminalStore.getState().activeKey).toBe(tabsAfterAdd[2].key);

  fireEvent.keyDown(dock, { key: "w", metaKey: true });
  expect(useTerminalStore.getState().tabs).toHaveLength(2);
  expect(useTerminalStore.getState().tabs.some((tab) => tab.key === firstKey)).toBe(true);
});

it("uses stable Mac tab strip classes and supports tablist arrow navigation", () => {
  render(<TerminalPanel />);
  const dock = screen.getByRole("region", { name: "Terminal dock" });

  fireEvent.keyDown(dock, { key: "t", metaKey: true });
  fireEvent.keyDown(dock, { key: "t", metaKey: true });

  const tablist = screen.getByRole("tablist", { name: "Terminal tabs" });
  expect(tablist.classList.contains("xolotl-terminal-tablist")).toBe(true);

  const tabs = screen.getAllByRole("tab");
  expect(tabs).toHaveLength(3);
  for (const tab of tabs) {
    expect(tab.classList.contains("xolotl-terminal-tab")).toBe(true);
  }
  expect(tabs[2].getAttribute("data-active")).toBe("true");
  expect(screen.getAllByLabelText(/Close Terminal/)[2].classList.contains("xolotl-terminal-tab-close")).toBe(true);

  fireEvent.keyDown(tabs[2], { key: "ArrowLeft" });
  expect(useTerminalStore.getState().activeKey).toBe(useTerminalStore.getState().tabs[1].key);

  fireEvent.keyDown(tabs[1], { key: "Home" });
  expect(useTerminalStore.getState().activeKey).toBe(useTerminalStore.getState().tabs[0].key);

  fireEvent.keyDown(tabs[0], { key: "End" });
  expect(useTerminalStore.getState().activeKey).toBe(useTerminalStore.getState().tabs[2].key);

  fireEvent.keyDown(tabs[2], { key: "ArrowRight" });
  expect(useTerminalStore.getState().activeKey).toBe(useTerminalStore.getState().tabs[0].key);
});
