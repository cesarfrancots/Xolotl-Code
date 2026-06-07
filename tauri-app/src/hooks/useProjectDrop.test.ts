import { describe, expect, it } from "vitest";
import { firstDroppedProjectPath } from "./useProjectDrop";

describe("firstDroppedProjectPath", () => {
  it("uses the first non-empty dropped path", () => {
    expect(firstDroppedProjectPath(["", "   ", " /Users/cesar/Project "])).toBe("/Users/cesar/Project");
  });

  it("returns null when the drop has no usable paths", () => {
    expect(firstDroppedProjectPath([])).toBeNull();
    expect(firstDroppedProjectPath([" "])).toBeNull();
  });
});
