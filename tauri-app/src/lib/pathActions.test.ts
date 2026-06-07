import { describe, expect, it } from "vitest";
import { relativePathFromRoot } from "./pathActions";

describe("relativePathFromRoot", () => {
  it("returns a project-relative path for children", () => {
    expect(relativePathFromRoot("/Users/cesar/Project/src/App.tsx", "/Users/cesar/Project")).toBe("src/App.tsx");
  });

  it("returns dot for the root itself", () => {
    expect(relativePathFromRoot("/Users/cesar/Project/", "/Users/cesar/Project")).toBe(".");
  });

  it("leaves paths outside the root unchanged", () => {
    expect(relativePathFromRoot("/Users/cesar/Other/file.ts", "/Users/cesar/Project")).toBe("/Users/cesar/Other/file.ts");
  });

  it("handles filesystem root as the project root", () => {
    expect(relativePathFromRoot("/Users/cesar/file.ts", "/")).toBe("Users/cesar/file.ts");
  });
});
