import { beforeEach, describe, expect, it } from "vitest";
import {
  centerTabFromSearch,
  explicitCenterTabFromSearch,
  initialCenterTabFromSearch,
  persistCenterTab,
  restoreCenterTabFromStorage,
  urlForCenterTab,
} from "./appNavigation";

function installTestStorage() {
  const items = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => Array.from(items.keys())[index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
}

beforeEach(() => {
  installTestStorage();
});

describe("centerTabFromSearch", () => {
  it("opens chat unless a known workspace tab is explicitly requested", () => {
    expect(centerTabFromSearch("")).toBe("chat");
    expect(centerTabFromSearch("?tab=chat")).toBe("chat");
    expect(centerTabFromSearch("?tab=eval")).toBe("eval");
    expect(centerTabFromSearch("?tab=civ")).toBe("civ");
    expect(centerTabFromSearch("?tab=unknown")).toBe("chat");
  });
});

describe("explicitCenterTabFromSearch", () => {
  it("returns null when no workspace tab is explicitly requested", () => {
    expect(explicitCenterTabFromSearch("")).toBeNull();
    expect(explicitCenterTabFromSearch("?foo=1")).toBeNull();
  });

  it("treats unknown explicit tab values as chat", () => {
    expect(explicitCenterTabFromSearch("?tab=unknown")).toBe("chat");
  });
});

describe("workbench tab restoration", () => {
  it("restores the last persisted tab when the URL does not request a tab", () => {
    localStorage.clear();
    persistCenterTab("civ");

    expect(restoreCenterTabFromStorage()).toBe("civ");
    expect(initialCenterTabFromSearch("")).toBe("civ");
  });

  it("lets explicit URL tab requests override persisted state", () => {
    localStorage.clear();
    persistCenterTab("civ");

    expect(initialCenterTabFromSearch("?tab=eval")).toBe("eval");
    expect(initialCenterTabFromSearch("?tab=chat")).toBe("chat");
  });

  it("falls back to chat when persisted state is missing or invalid", () => {
    localStorage.clear();
    expect(restoreCenterTabFromStorage()).toBe("chat");

    localStorage.setItem("xolotl-last-workbench-tab", "unknown");
    expect(restoreCenterTabFromStorage()).toBe("chat");
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

  it("keeps a slash path when clearing a tab from the Tauri custom scheme", () => {
    expect(urlForCenterTab("tauri://localhost?tab=civ", "chat")).toBe("/");
  });
});
