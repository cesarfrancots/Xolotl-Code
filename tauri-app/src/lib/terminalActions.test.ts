import { beforeEach, describe, expect, it } from "vitest";
import { useTerminalStore } from "../stores/terminalStore";
import { useUiStore } from "../stores/uiStore";
import { openTerminalAtPath } from "./terminalActions";

describe("openTerminalAtPath", () => {
  beforeEach(() => {
    useTerminalStore.setState({ tabs: [], activeKey: null });
    useUiStore.setState({ terminalPanelOpen: false });
  });

  it("opens the terminal dock and creates an active tab scoped to the folder", () => {
    const key = openTerminalAtPath("/Users/cesar/Documents/Xolotl/docs", "docs");
    const terminal = useTerminalStore.getState();

    expect(useUiStore.getState().terminalPanelOpen).toBe(true);
    expect(terminal.activeKey).toBe(key);
    expect(terminal.tabs).toMatchObject([
      {
        key,
        title: "docs",
        cwd: "/Users/cesar/Documents/Xolotl/docs",
      },
    ]);
  });

  it("falls back to the final path component for the terminal title", () => {
    openTerminalAtPath("/Users/cesar/Documents/Xolotl/src/");

    expect(useTerminalStore.getState().tabs[0].title).toBe("src");
  });
});
