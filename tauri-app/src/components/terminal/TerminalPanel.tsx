import { useEffect, useState, type KeyboardEvent } from "react";
import { AlertCircle, CheckCircle, ClipboardList, Copy, ExternalLink, Link2, MoreHorizontal, Plus, TerminalSquare, X } from "lucide-react";
import { useTerminalStore } from "../../stores/terminalStore";
import { useUiStore } from "../../stores/uiStore";
import { projectDisplayName, useProjectStore } from "../../stores/projectStore";
import { macPathLabel } from "../../lib/fileBrowser";
import { shortcutTitle } from "../../lib/macShortcuts";
import {
  copyPathContextHandoff,
  copyTextToClipboard,
  copyXolotlCodeOpenShellCommand,
  copyXolotlCodeOpenUrl,
  openPathInExternalTerminal,
  relativePathFromRoot,
  revealPathInFinder,
} from "../../lib/pathActions";
import { TerminalView } from "./TerminalView";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

type TerminalStatusTone = "ok" | "error";

interface TerminalStatus {
  tone: TerminalStatusTone;
  message: string;
  hint?: string;
}

/**
 * The terminal dock's contents: a tab bar over a stack of {@link TerminalView}s.
 * All views stay mounted (inactive ones hidden) so their scrollback and live
 * PTYs survive tab switches.
 */
export function TerminalPanel() {
  const tabs = useTerminalStore((s) => s.tabs);
  const activeKey = useTerminalStore((s) => s.activeKey);
  const terminalPanelOpen = useUiStore((s) => s.terminalPanelOpen);
  const activeProjectPath = useProjectStore((s) => s.activeProjectPath);
  const [status, setStatus] = useState<TerminalStatus | null>(null);
  const activeTab = tabs.find((tab) => tab.key === activeKey) ?? null;

  // Open with one terminal ready to go.
  useEffect(() => {
    if (useTerminalStore.getState().tabs.length === 0) {
      useTerminalStore.getState().addTab(undefined, useProjectStore.getState().activeProjectPath);
    }
  }, []);

  useEffect(() => {
    setStatus(null);
  }, [activeKey]);

  function handleClose(key: string) {
    useTerminalStore.getState().closeTab(key);
    // Closing the last terminal collapses the dock (VS Code behaviour).
    if (useTerminalStore.getState().tabs.length === 0) {
      useUiStore.getState().setTerminalPanelOpen(false);
    }
  }

  function handleNewTerminal() {
    setStatus(null);
    useTerminalStore.getState().addTab(undefined, useProjectStore.getState().activeProjectPath);
  }

  async function runCwdHandoff(
    label: string,
    action: () => Promise<void>,
    successMessage: string,
    hint: string,
  ) {
    try {
      await action();
      setStatus({ tone: "ok", message: successMessage });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err ?? "");
      setStatus({
        tone: "error",
        message: `${label} failed.`,
        hint: detail ? `${hint} ${detail}` : hint,
      });
    }
  }

  function selectAdjacentTab(direction: -1 | 1) {
    const state = useTerminalStore.getState();
    const index = state.tabs.findIndex((tab) => tab.key === state.activeKey);
    if (index === -1 || state.tabs.length < 2) return;
    const nextIndex = (index + direction + state.tabs.length) % state.tabs.length;
    state.setActive(state.tabs[nextIndex].key);
  }

  function selectTabByIndex(index: number) {
    const tab = useTerminalStore.getState().tabs[index];
    if (tab) useTerminalStore.getState().setActive(tab.key);
  }

  function handleTabKeyDown(e: KeyboardEvent<HTMLDivElement>, key: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      useTerminalStore.getState().setActive(key);
      return;
    }
    if (e.metaKey || e.altKey || e.ctrlKey) return;

    const state = useTerminalStore.getState();
    const index = state.tabs.findIndex((tab) => tab.key === key);
    if (index === -1 || state.tabs.length < 2) return;

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      selectTabByIndex((index - 1 + state.tabs.length) % state.tabs.length);
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      selectTabByIndex((index + 1) % state.tabs.length);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      selectTabByIndex(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      selectTabByIndex(state.tabs.length - 1);
    }
  }

  function handlePanelKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!e.metaKey || e.altKey || e.ctrlKey) return;
    if (!terminalPanelOpen) return;
    const key = e.key.toLowerCase();
    if (!e.shiftKey && key === "t") {
      e.preventDefault();
      handleNewTerminal();
      return;
    }
    if (!e.shiftKey && key === "w" && activeKey) {
      e.preventDefault();
      handleClose(activeKey);
      return;
    }
    if (e.shiftKey && e.key === "ArrowLeft") {
      e.preventDefault();
      selectAdjacentTab(-1);
      return;
    }
    if (e.shiftKey && e.key === "ArrowRight") {
      e.preventDefault();
      selectAdjacentTab(1);
    }
  }

  return (
    <div
      role="region"
      aria-label="Terminal dock"
      onKeyDownCapture={handlePanelKeyDown}
      className="xolotl-terminal-panel flex h-full min-h-0 flex-col"
    >
      <div className="xolotl-terminal-toolbar flex-none flex items-center gap-1.5 px-2 h-9">
        <TerminalSquare className="h-3.5 w-3.5 flex-none text-[oklch(0.52_0.02_205)]" />
        {activeProjectPath && (
          <div
            className="hidden max-w-[160px] truncate rounded border border-[oklch(0.22_0.010_235)] bg-[oklch(0.12_0.004_245)] px-2 py-0.5 text-[10px] font-medium text-[oklch(0.58_0.018_205)] md:block"
            title={`New terminals start in ${activeProjectPath}`}
          >
            {projectDisplayName(activeProjectPath)}
          </div>
        )}
        <div role="tablist" aria-label="Terminal tabs" className="xolotl-terminal-tablist">
          {tabs.map((tab) => {
            const isActive = tab.key === activeKey;
            return (
              <div
                key={tab.key}
                role="tab"
                tabIndex={0}
                aria-selected={isActive}
                data-active={isActive ? "true" : "false"}
                data-exited={tab.exited ? "true" : "false"}
                onClick={() => useTerminalStore.getState().setActive(tab.key)}
                onKeyDown={(e) => handleTabKeyDown(e, tab.key)}
                className={[
                  "group xolotl-terminal-tab flex items-center gap-1.5 rounded-md pl-2.5 pr-1 py-1 text-xs cursor-pointer transition-colors select-none",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[oklch(0.55_0.04_195)]",
                  isActive
                    ? "bg-[oklch(0.15_0.010_205)] text-[oklch(0.80_0.04_195)] shadow-[inset_0_0_0_1px_oklch(0.40_0.025_195)]"
                    : "text-[oklch(0.55_0.012_235)] hover:text-[oklch(0.82_0.015_220)] hover:bg-[oklch(0.14_0.006_245)]",
                ].join(" ")}
              >
                <span className="xolotl-terminal-tab-title truncate">
                  {tab.title}
                  {tab.exited ? " (exited)" : ""}
                </span>
                <button
                  type="button"
                  aria-label={`Close ${tab.title}`}
                  title={shortcutTitle(`Close ${tab.title}`, "Cmd+W")}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClose(tab.key);
                  }}
                  className="xolotl-terminal-tab-close flex-none rounded p-0.5 text-[oklch(0.5_0.01_235)] hover:bg-[oklch(0.22_0.02_25)] hover:text-[oklch(0.82_0.06_28)] transition-opacity"
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
          title={activeProjectPath ? shortcutTitle(`New terminal in ${projectDisplayName(activeProjectPath)}`, "Cmd+T") : shortcutTitle("New terminal", "Cmd+T")}
          onClick={handleNewTerminal}
          className="flex-none ml-1 rounded-md p-1 text-[oklch(0.55_0.012_235)] hover:text-[oklch(0.82_0.04_195)] hover:bg-[oklch(0.15_0.008_245)] transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        {activeTab && (activeTab.shellName || activeTab.cwd || activeTab.envSource) && (
          <div className="ml-auto hidden min-w-0 items-center gap-1.5 text-[10px] text-[oklch(0.54_0.010_225)] lg:flex">
            {activeTab.shellName && (
              <span
                className="max-w-[90px] truncate rounded border border-[oklch(0.22_0.010_235)] bg-[oklch(0.12_0.004_245)] px-1.5 py-0.5"
                title={activeTab.shell ?? activeTab.shellName}
              >
                {activeTab.shellName}
              </span>
            )}
            {activeTab.cwd && (
              <span className="flex min-w-0 items-center gap-0.5">
                <span
                  className="max-w-[180px] truncate rounded border border-[oklch(0.22_0.010_235)] bg-[oklch(0.12_0.004_245)] px-1.5 py-0.5"
                  title={activeTab.cwd}
                >
                  {macPathLabel(activeTab.cwd)}
                </span>
                <button
                  type="button"
                  title="Open terminal cwd in external terminal"
                  aria-label="Open terminal cwd in external terminal"
                  onClick={() => {
                    if (activeTab.cwd) {
                      void runCwdHandoff(
                        "Open terminal cwd in external terminal",
                        () => openPathInExternalTerminal(activeTab.cwd!),
                        "Terminal cwd opened in external terminal.",
                        "Check the external terminal setting in macOS Settings, or use Terminal, iTerm, Warp, an app bundle path, or executable path.",
                      );
                    }
                  }}
                  className="grid h-5 w-5 place-items-center rounded text-[oklch(0.45_0.010_225)] hover:bg-[oklch(0.16_0.006_245)] hover:text-[oklch(0.78_0.040_195)]"
                >
                  <TerminalSquare className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  title="Reveal terminal cwd in Finder"
                  aria-label="Reveal terminal cwd in Finder"
                  onClick={() => {
                    if (activeTab.cwd) {
                      void runCwdHandoff(
                        "Reveal terminal cwd in Finder",
                        () => revealPathInFinder(activeTab.cwd!),
                        "Terminal cwd revealed in Finder.",
                        "Check that the terminal folder still exists and that macOS allows Xolotl Code to access it.",
                      );
                    }
                  }}
                  className="grid h-5 w-5 place-items-center rounded text-[oklch(0.45_0.010_225)] hover:bg-[oklch(0.16_0.006_245)] hover:text-[oklch(0.78_0.040_195)]"
                >
                  <ExternalLink className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  title="Copy terminal cwd POSIX path"
                  aria-label="Copy terminal cwd POSIX path"
                  onClick={() => {
                    if (activeTab.cwd) {
                      void runCwdHandoff(
                        "Copy terminal cwd path",
                        () => copyTextToClipboard(activeTab.cwd!),
                        "Terminal cwd path copied.",
                        "Check macOS clipboard access and try copying the path again.",
                      );
                    }
                  }}
                  className="grid h-5 w-5 place-items-center rounded text-[oklch(0.45_0.010_225)] hover:bg-[oklch(0.16_0.006_245)] hover:text-[oklch(0.78_0.040_195)]"
                >
                  <Copy className="h-3 w-3" />
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      title="Terminal cwd automation actions"
                      aria-label="Terminal cwd automation actions"
                      className="grid h-5 w-5 place-items-center rounded text-[oklch(0.45_0.010_225)] hover:bg-[oklch(0.16_0.006_245)] hover:text-[oklch(0.78_0.040_195)]"
                    >
                      <MoreHorizontal className="h-3 w-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[240px] border-[oklch(0.22_0.010_235)] bg-[oklch(0.105_0.004_245)] text-[oklch(0.78_0.014_225)]">
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.14em] text-[oklch(0.52_0.014_230)]">
                      Terminal cwd
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      onClick={() => {
                        if (activeTab.cwd) {
                          void runCwdHandoff(
                            "Copy terminal cwd Xolotl link",
                            () => copyXolotlCodeOpenUrl(activeTab.cwd!),
                            "Terminal cwd Xolotl link copied.",
                            "Check macOS clipboard access and try copying the Xolotl link again.",
                          );
                        }
                      }}
                      className="gap-2 text-xs"
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      Copy terminal cwd Xolotl link
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        if (activeTab.cwd) {
                          void runCwdHandoff(
                            "Copy terminal cwd shell open command",
                            () => copyXolotlCodeOpenShellCommand(activeTab.cwd!),
                            "Terminal cwd shell open command copied.",
                            "Check macOS clipboard access and try copying the shell open command again.",
                          );
                        }
                      }}
                      className="gap-2 text-xs"
                    >
                      <TerminalSquare className="h-3.5 w-3.5" />
                      Copy terminal cwd shell open command
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        if (activeTab.cwd) {
                          void runCwdHandoff(
                            "Copy terminal cwd context prompt",
                            () => copyPathContextHandoff(activeTab.cwd!, {
                              label: macPathLabel(activeTab.cwd!),
                              kind: "Terminal cwd",
                              relativePath: activeProjectPath ? relativePathFromRoot(activeTab.cwd!, activeProjectPath) : null,
                            }),
                            "Terminal cwd context prompt copied.",
                            "Check macOS clipboard access and try copying the terminal context prompt again.",
                          );
                        }
                      }}
                      className="gap-2 text-xs"
                    >
                      <ClipboardList className="h-3.5 w-3.5" />
                      Copy terminal cwd context prompt
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
            )}
            {activeTab.envSource && (
              <span
                className="max-w-[210px] truncate rounded border border-[oklch(0.22_0.010_235)] bg-[oklch(0.12_0.004_245)] px-1.5 py-0.5"
                title={activeTab.envSource}
              >
                {activeTab.envSource}
              </span>
            )}
          </div>
        )}
      </div>
      {status && <TerminalStatusBanner status={status} onDismiss={() => setStatus(null)} />}
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
              cwd={tab.cwd}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function TerminalStatusBanner({
  status,
  onDismiss,
}: {
  status: TerminalStatus;
  onDismiss: () => void;
}) {
  const Icon = status.tone === "error" ? AlertCircle : CheckCircle;
  const classes = status.tone === "error"
    ? "border-[oklch(0.34_0.055_25)] bg-[oklch(0.145_0.018_25)]/65 text-[oklch(0.78_0.090_25)]"
    : "border-[oklch(0.32_0.045_155)] bg-[oklch(0.145_0.018_155)]/55 text-[oklch(0.74_0.080_155)]";

  return (
    <div className={`flex flex-none items-start gap-2 border-b px-3 py-2 text-xs ${classes}`}>
      <Icon className="mt-0.5 h-3.5 w-3.5 flex-none" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{status.message}</div>
        {status.hint && <div className="mt-0.5 leading-relaxed text-[oklch(0.67_0.045_45)]">{status.hint}</div>}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded px-1 text-[oklch(0.55_0.012_225)] hover:bg-[oklch(0.18_0.008_245)] hover:text-[oklch(0.86_0.016_220)]"
        aria-label="Dismiss terminal status"
      >
        Dismiss
      </button>
    </div>
  );
}
