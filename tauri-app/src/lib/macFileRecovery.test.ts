import { describe, expect, it } from "vitest";
import { macFileAccessRecovery } from "./macFileRecovery";

describe("macFileAccessRecovery", () => {
  it("recognizes macOS privacy and filesystem permission failures", () => {
    const recovery = macFileAccessRecovery("Operation not permitted", "folder-browse");

    expect(recovery.message).toBe("Folder access blocked by macOS.");
    expect(recovery.hint).toContain("Privacy & Security");
    expect(recovery.hint).toContain("Files and Folders or Full Disk Access");
    expect(recovery.hint).toContain("Open Folder");
    expect(recovery.hint).toContain("Operation not permitted");
  });

  it("recognizes stale macOS saved folder permission failures", () => {
    const recovery = macFileAccessRecovery("Security-scoped bookmark is stale", "project-open");

    expect(recovery.message).toBe("Project folder permission needs refresh.");
    expect(recovery.hint).toContain("saved folder permission");
    expect(recovery.hint).toContain("Use Open Folder to choose the folder again");
    expect(recovery.hint).toContain("Security-scoped bookmark is stale");
  });

  it("recognizes stale project folder paths", () => {
    const recovery = macFileAccessRecovery("Not a directory: /Users/cesar/Moved", "project-open");

    expect(recovery.message).toBe("Project folder unavailable.");
    expect(recovery.hint).toContain("Use Open Folder to add it again");
  });

  it("falls back to generic folder recovery guidance", () => {
    const recovery = macFileAccessRecovery("Read failed", "folder-browse");

    expect(recovery.message).toBe("Could not load folder contents.");
    expect(recovery.hint).toContain("choose it again with Open Folder");
    expect(recovery.hint).toContain("macOS has allowed Xolotl Code");
  });
});
