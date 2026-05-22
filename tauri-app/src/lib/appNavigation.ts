export type CenterTab = "chat" | "eval";

export function centerTabFromSearch(search: string): CenterTab {
  return new URLSearchParams(search).get("tab") === "eval" ? "eval" : "chat";
}

export function urlForCenterTab(currentHref: string, tab: CenterTab): string {
  const url = new URL(currentHref);
  if (tab === "eval") {
    url.searchParams.set("tab", "eval");
  } else {
    url.searchParams.delete("tab");
  }

  return `${url.pathname}${url.search}${url.hash}`;
}
