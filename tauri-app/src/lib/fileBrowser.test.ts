import { describe, expect, it } from "vitest";
import { directoryChildBadges, macPathLabel, visibleDirectoryChildren } from "./fileBrowser";

describe("macPathLabel", () => {
  it("collapses macOS user home paths to a tilde", () => {
    expect(macPathLabel("/Users/cesar/Documents/Xolotl")).toBe("~/Documents/Xolotl");
    expect(macPathLabel("/Users/cesar")).toBe("~");
  });

  it("leaves non-user paths unchanged", () => {
    expect(macPathLabel("/Applications/Xolotl Code.app")).toBe("/Applications/Xolotl Code.app");
  });
});

describe("visibleDirectoryChildren", () => {
  const children = [
    { name: "src" },
    { name: ".env", is_hidden: true },
    { name: ".git", is_hidden: true },
  ];

  it("hides dotfiles until the hidden toggle is enabled", () => {
    expect(visibleDirectoryChildren(children, false).map((child) => child.name)).toEqual(["src"]);
    expect(visibleDirectoryChildren(children, true).map((child) => child.name)).toEqual([
      "src",
      ".env",
      ".git",
    ]);
  });
});

describe("directoryChildBadges", () => {
  it("orders package, alias, and hidden badges consistently", () => {
    expect(directoryChildBadges({ name: ".Preview.app", is_package: true, is_symlink: true, is_hidden: true })).toEqual([
      "Package",
      "Alias",
      "Hidden",
    ]);
  });
});
