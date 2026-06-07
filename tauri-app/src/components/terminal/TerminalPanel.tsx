import { useEffect } from "react";
import { Plus, TerminalSquare, X } from "lucide-react";
import { useTerminalStore } from "../../stores/terminalStore";
import { useUiStore } from "../../stores/uiStore";
import { TerminalView } from "./TerminalView";

/**
 * The terminal dock's contents: a tab bar over a stack of {@link TerminalView}s.
 * All views stay mounted (inactive ones hidden) so their scrollback and live
 * PTYs survive tab switches.
 */
export function TerminalPanel() {
  const tabs = useTerminalStore((s) => s.tabs);
  const activeKey = useTerminalStore((s) => s.activeKey);
  const terminalPanelOpen = useUiStore((s) => s.terminalPanelOpen);

  // Open with one terminal ready to go.
  useEffect(() => {
    if (useTerminalStore.getState().tabs.length === 0) {
      useTerminalStore.getState().addTab();
    }
  }, []);

  function handleClose(key: string) {
    useTerminalStore.getState().closeTab(key);
    // Closing the last terminal collapses the dock (VS Code behaviour).
    if (useTerminalStore.getState().tabs.length === 0) {
      useUiStore.getState().setTerminalPanelOpen(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[oklch(0.085_0.004_250)]">
      <div className="flex-none flex items-center gap-1.5 border-b border-[oklch(0.20_0.008_240)] bg-[oklch(0.10_0.004_248)] px-2 h-9">
        <TerminalSquare className="h-3.5 w-3.5 flex-none text-[oklch(0.52_0.02_205)]" />
        <div role="tablist" aria-label="Terminal tabs" className="flex items-center gap-1 overflow-x-auto min-w-0">
          {tabs.map((tab) => {
            const isActive = tab.key === activeKey;
            return (
              <div
                key={tab.key}
                role="tab"
                tabIndex={0}
                aria-selected={isActive}
                onClick={() => useTerminalStore.getState().setActive(tab.key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    useTerminalStore.getState().setActive(tab.key);
                  }
                }}
                className={[
                  "group flex items-center gap-1.5 rounded-md pl-2.5 pr-1 py-1 text-xs cursor-pointer transition-colors select-none",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[oklch(0.55_0.04_195)]",
                  isActive
                    ? "bg-[oklch(0.15_0.010_205)] text-[oklch(0.80_0.04_195)] shadow-[inset_0_0_0_1px_oklch(0.40_0.025_195)]"
                    : "text-[oklch(0.55_0.012_235)] hover:text-[oklch(0.82_0.015_220)] hover:bg-[oklch(0.14_0.006_245)]",
                ].join(" ")}
              >
                <span className="truncate max-w-[140px]">
                  {tab.title}
                  {tab.exited ? " (exited)" : ""}
                </span>
                <button
                  type="button"
                  aria-label={`Close ${tab.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClose(tab.key);
                  }}
                  className="flex-none rounded p-0.5 text-[oklch(0.5_0.01_235)] opacity-0 group-hover:opacity-100 hover:bg-[oklch(0.22_0.02_25)] hover:text-[oklch(0.82_0.06_28)] transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          aria-label="New terminal"
          title="New terminal"
          onClick={() => useTerminalStore.getState().addTab()}
          className="flex-none ml-1 rounded-md p-1 text-[oklch(0.55_0.012_235)] hover:text-[oklch(0.82_0.04_195)] hover:bg-[oklch(0.15_0.008_245)] transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="relative flex-1 min-h-0">
        {tabs.map((tab) => (
          <div
            key={tab.key}
            className={tab.key === activeKey ? "absolute inset-0 p-1" : "hidden"}
          >
            <TerminalView
              tabKey={tab.key}
              active={tab.key === activeKey}
              visible={terminalPanelOpen && tab.key === activeKey}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
