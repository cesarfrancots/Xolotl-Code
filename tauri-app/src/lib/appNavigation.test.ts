import { describe, expect, it } from "vitest";
import { centerTabFromSearch, urlForCenterTab } from "./appNavigation";

describe("centerTabFromSearch", () => {
  it("opens chat unless a known workspace tab is explicitly requested", () => {
    expect(centerTabFromSearch("")).toBe("chat");
    expect(centerTabFromSearch("?tab=chat")).toBe("chat");
    expect(centerTabFromSearch("?tab=eval")).toBe("eval");
    expect(centerTabFromSearch("?tab=civ")).toBe("civ");
    expect(centerTabFromSearch("?tab=unknown")).toBe("chat");
  });
});

describe("urlForCenterTab", () => {
  it("sets the eval tab query while preserving other URL parts", () => {
    expect(urlForCenterTab("http://localhost:5173/workbench?foo=1#top", "eval")).toBe("/workbench?foo=1&tab=eval#top");
  });

  it("sets the civilization tab query while preserving other URL parts", () => {
    expect(urlForCenterTab("http://localhost:5173/workbench?foo=1#top", "civ")).toBe("/workbench?foo=1&tab=civ#top");
  });

  it("removes the tab query for the default chat tab", () => {
    expect(urlForCenterTab("http://localhost:5173/?tab=civ&foo=1", "chat")).toBe("/?foo=1");
  });
});
