import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TerminalPanel } from "./TerminalPanel";
import { useTerminalStore } from "../../stores/terminalStore";
import { useUiStore } from "../../stores/uiStore";

// Stub the xterm-backed view so the test never touches the real terminal.
vi.mock("./TerminalView", () => ({
  TerminalView: ({ tabKey, visible }: { tabKey: string; visible: boolean }) => (
    <div data-testid={`view-${tabKey}`} data-visible={String(visible)} />
  ),
}));

beforeEach(() => {
  useTerminalStore.setState({ tabs: [], activeKey: null });
  useUiStore.setState({ terminalPanelOpen: true });
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
