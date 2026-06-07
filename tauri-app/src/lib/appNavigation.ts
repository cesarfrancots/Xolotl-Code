import { readStorageItem, writeStorageItem } from "./browserStorage";

export type CenterTab = "chat" | "eval" | "civ";

const LAST_CENTER_TAB_KEY = "xolotl-last-workbench-tab";

function parseCenterTab(value: string | null): CenterTab | null {
  if (value === "chat" || value === "eval" || value === "civ") return value;
  return null;
}

export function explicitCenterTabFromSearch(search: string): CenterTab | null {
  const params = new URLSearchParams(search);
  if (!params.has("tab")) return null;
  return parseCenterTab(params.get("tab")) ?? "chat";
}

export function centerTabFromSearch(search: string): CenterTab {
  return explicitCenterTabFromSearch(search) ?? "chat";
}

export function restoreCenterTabFromStorage(): CenterTab {
  return parseCenterTab(readStorageItem(LAST_CENTER_TAB_KEY)) ?? "chat";
}

export function initialCenterTabFromSearch(search: string): CenterTab {
  return explicitCenterTabFromSearch(search) ?? restoreCenterTabFromStorage();
}

export function persistCenterTab(tab: CenterTab): void {
  writeStorageItem(LAST_CENTER_TAB_KEY, tab);
}

export function urlForCenterTab(currentHref: string, tab: CenterTab): string {
  const url = new URL(currentHref);
  if (tab === "eval" || tab === "civ") {
    url.searchParams.set("tab", tab);
  } else {
    url.searchParams.delete("tab");
  }

  return `${url.pathname || "/"}${url.search}${url.hash}`;
}
