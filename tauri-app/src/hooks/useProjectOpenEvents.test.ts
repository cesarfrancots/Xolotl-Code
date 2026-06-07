import { describe, expect, it } from "vitest";
import { projectOpenPathFromPayload } from "./useProjectOpenEvents";

describe("projectOpenPathFromPayload", () => {
  it("normalizes string project paths", () => {
    expect(projectOpenPathFromPayload(" /Users/cesar/Code/Xolotl ")).toBe("/Users/cesar/Code/Xolotl");
  });

  it("rejects empty and malformed payloads", () => {
    expect(projectOpenPathFromPayload(" ")).toBeNull();
    expect(projectOpenPathFromPayload({ path: "/Users/cesar/Code" })).toBeNull();
  });
});
