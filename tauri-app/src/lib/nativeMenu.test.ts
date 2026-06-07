import { describe, expect, it } from "vitest";
import { nativeMenuActionFromPayload } from "./nativeMenu";

describe("nativeMenuActionFromPayload", () => {
  it("normalizes native Tauri menu ids to frontend actions", () => {
    expect(nativeMenuActionFromPayload("xolotl:new-chat")).toBe("new-chat");
    expect(nativeMenuActionFromPayload("xolotl:open-folder")).toBe("open-folder");
    expect(nativeMenuActionFromPayload("xolotl:terminal-new-tab")).toBe("terminal-new");
    expect(nativeMenuActionFromPayload("xolotl:tab-civ")).toBe("tab-civ");
  });

  it("accepts already-normalized frontend actions", () => {
    expect(nativeMenuActionFromPayload("commands")).toBe("commands");
    expect(nativeMenuActionFromPayload("toggle-terminal")).toBe("toggle-terminal");
  });

  it("rejects unknown or malformed payloads", () => {
    expect(nativeMenuActionFromPayload("xolotl:quit")).toBeNull();
    expect(nativeMenuActionFromPayload({ action: "settings" })).toBeNull();
  });
});
