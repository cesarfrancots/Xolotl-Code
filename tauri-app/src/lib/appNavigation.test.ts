import { describe, expect, it } from "vitest";
import { centerTabFromSearch, urlForCenterTab } from "./appNavigation";

describe("centerTabFromSearch", () => {
  it("opens chat unless the eval tab is explicitly requested", () => {
    expect(centerTabFromSearch("")).toBe("chat");
    expect(centerTabFromSearch("?tab=chat")).toBe("chat");
    expect(centerTabFromSearch("?tab=eval")).toBe("eval");
  });
});

describe("urlForCenterTab", () => {
  it("sets the eval tab query while preserving other URL parts", () => {
    expect(urlForCenterTab("http://localhost:5173/workbench?foo=1#top", "eval")).toBe("/workbench?foo=1&tab=eval#top");
  });

  it("removes the tab query for the default chat tab", () => {
    expect(urlForCenterTab("http://localhost:5173/?tab=eval&foo=1", "chat")).toBe("/?foo=1");
  });
});
