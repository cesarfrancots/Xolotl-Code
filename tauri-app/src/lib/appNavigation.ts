export type CenterTab = "chat" | "eval" | "civ";

export function centerTabFromSearch(search: string): CenterTab {
  const tab = new URLSearchParams(search).get("tab");
  if (tab === "eval" || tab === "civ") return tab;
  return "chat";
}

export function urlForCenterTab(currentHref: string, tab: CenterTab): string {
  const url = new URL(currentHref);
  if (tab === "eval" || tab === "civ") {
    url.searchParams.set("tab", tab);
  } else {
    url.searchParams.delete("tab");
  }

  return `${url.pathname}${url.search}${url.hash}`;
}
