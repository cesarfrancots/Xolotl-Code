import { describe, expect, it } from "vitest";
import {
  pathContextHandoffText,
  projectContextHandoffText,
  relativePathFromRoot,
  xolotlCodeOpenShellCommand,
  xolotlCodeOpenUrl,
} from "./pathActions";

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

describe("xolotlCodeOpenUrl", () => {
  it("encodes project paths for the macOS URL scheme", () => {
    expect(xolotlCodeOpenUrl("/Users/cesar/Documents/Pivot app")).toBe(
      "xolotl-code://open?path=%2FUsers%2Fcesar%2FDocuments%2FPivot+app",
    );
  });
});

describe("xolotlCodeOpenShellCommand", () => {
  it("formats a Terminal-safe open command for Mac automation", () => {
    expect(xolotlCodeOpenShellCommand("/Users/cesar/Documents/Pivot app")).toBe(
      "open 'xolotl-code://open?path=%2FUsers%2Fcesar%2FDocuments%2FPivot+app'",
    );
  });

  it("quotes URL arguments defensively for shell handoff", () => {
    expect(xolotlCodeOpenShellCommand("/Users/cesar/O'Hara/$HOME `test`")).toBe(
      "open 'xolotl-code://open?path=%2FUsers%2Fcesar%2FO%27Hara%2F%24HOME+%60test%60'",
    );
  });
});

describe("projectContextHandoffText", () => {
  it("formats a prompt-ready project context block for Mac automation", () => {
    expect(projectContextHandoffText("/Users/cesar/Documents/Pivot app", "Pivot app")).toBe([
      "Xolotl Code project context",
      "Project: Pivot app",
      "Path: /Users/cesar/Documents/Pivot app",
      "Open: xolotl-code://open?path=%2FUsers%2Fcesar%2FDocuments%2FPivot+app",
      "",
      "Use this as the active project context for Xolotl Code automation, Shortcuts, Raycast, Alfred, or shell handoff.",
    ].join("\n"));
  });

  it("falls back to the path basename when no project name is available", () => {
    expect(projectContextHandoffText("/Users/cesar/Documents/Xolotl").split("\n")[1]).toBe("Project: Xolotl");
  });
});

describe("pathContextHandoffText", () => {
  it("formats a prompt-ready folder context block with a relative path", () => {
    expect(pathContextHandoffText("/Users/cesar/Documents/Xolotl/docs", {
      kind: "Folder",
      label: "docs",
      relativePath: "docs",
    })).toBe([
      "Xolotl Code path context",
      "Folder: docs",
      "Path: /Users/cesar/Documents/Xolotl/docs",
      "Relative Path: docs",
      "Open: xolotl-code://open?path=%2FUsers%2Fcesar%2FDocuments%2FXolotl%2Fdocs",
      "",
      "Use this as the folder context for Xolotl Code automation, Shortcuts, Raycast, Alfred, or shell handoff.",
    ].join("\n"));
  });

  it("falls back to a path basename and omits blank relative paths", () => {
    const lines = pathContextHandoffText("/Users/cesar/Documents/Xolotl/README.md", {
      kind: "File",
      relativePath: " ",
    }).split("\n");

    expect(lines[1]).toBe("File: README.md");
    expect(lines).not.toContain("Relative Path: ");
  });
});
