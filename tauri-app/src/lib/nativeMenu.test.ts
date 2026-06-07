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
    expect(nativeMenuActionFromPayload("xolotl:status-copy-active-project-link")).toBe("status-copy-active-project-link");
    expect(nativeMenuActionFromPayload("xolotl:status-copy-active-project-shell-open")).toBe("status-copy-active-project-shell-open");
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
