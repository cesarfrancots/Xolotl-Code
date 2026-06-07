import { describe, expect, it } from "vitest";
import { MAC_COMMANDS } from "./macCommandModel";
import { nativeMenuActionFromPayload } from "./nativeMenu";

describe("nativeMenuActionFromPayload", () => {
  it("normalizes native Tauri menu ids to frontend actions", () => {
    expect(nativeMenuActionFromPayload("xolotl:new-chat")).toBe("new-chat");
    expect(nativeMenuActionFromPayload("xolotl:open-folder")).toBe("open-folder");
    expect(nativeMenuActionFromPayload("xolotl:terminal-new-tab")).toBe("terminal-new");
    expect(nativeMenuActionFromPayload("xolotl:tab-civ")).toBe("tab-civ");
    expect(nativeMenuActionFromPayload("xolotl:status-reveal-active-project")).toBe("status-reveal-active-project");
    expect(nativeMenuActionFromPayload("xolotl:status-open-active-project-editor")).toBe("status-open-active-project-editor");
    expect(nativeMenuActionFromPayload("xolotl:status-open-active-project-terminal")).toBe("status-open-active-project-terminal");
    expect(nativeMenuActionFromPayload("xolotl:status-open-latest-agent")).toBe("open-latest-agent");
    expect(nativeMenuActionFromPayload("xolotl:open-latest-agent")).toBe("open-latest-agent");
    expect(nativeMenuActionFromPayload("xolotl:reveal-latest-agent-worktree")).toBe("reveal-latest-agent-worktree");
    expect(nativeMenuActionFromPayload("xolotl:open-latest-agent-worktree-editor")).toBe("open-latest-agent-worktree-editor");
    expect(nativeMenuActionFromPayload("xolotl:open-latest-agent-worktree-terminal")).toBe("open-latest-agent-worktree-terminal");
    expect(nativeMenuActionFromPayload("xolotl:new-latest-agent-worktree-terminal-tab")).toBe("new-latest-agent-worktree-terminal-tab");
    expect(nativeMenuActionFromPayload("xolotl:copy-latest-agent-worktree-path")).toBe("copy-latest-agent-worktree-path");
    expect(nativeMenuActionFromPayload("xolotl:copy-latest-agent-worktree-link")).toBe("copy-latest-agent-worktree-link");
    expect(nativeMenuActionFromPayload("xolotl:copy-latest-agent-worktree-shell-open")).toBe("copy-latest-agent-worktree-shell-open");
    expect(nativeMenuActionFromPayload("xolotl:copy-latest-agent-worktree-context")).toBe("copy-latest-agent-worktree-context");
    expect(nativeMenuActionFromPayload("xolotl:status-copy-active-project-link")).toBe("status-copy-active-project-link");
    expect(nativeMenuActionFromPayload("xolotl:status-copy-active-project-shell-open")).toBe("status-copy-active-project-shell-open");
    expect(nativeMenuActionFromPayload("xolotl:new-active-project-terminal-tab")).toBe("new-active-project-terminal-tab");
    expect(nativeMenuActionFromPayload("xolotl:copy-active-project-path")).toBe("copy-active-project-path");
    expect(nativeMenuActionFromPayload("xolotl:copy-active-project-context")).toBe("copy-active-project-context");
    expect(nativeMenuActionFromPayload("xolotl:copy-active-project-shortcuts-json")).toBe("copy-active-project-shortcuts-json");
  });

  it("accepts already-normalized frontend actions", () => {
    for (const command of MAC_COMMANDS) {
      expect(nativeMenuActionFromPayload(command.action)).toBe(command.action);
    }
  });

  it("rejects unknown or malformed payloads", () => {
    expect(nativeMenuActionFromPayload("xolotl:quit")).toBeNull();
    expect(nativeMenuActionFromPayload({ action: "settings" })).toBeNull();
  });
});
