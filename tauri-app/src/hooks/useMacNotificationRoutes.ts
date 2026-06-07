import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CenterTab } from "../lib/appNavigation";
import { errorDetail, notifyMacAppStatus } from "../lib/macAppStatus";
import { useAgentStore } from "../stores/agentStore";

export const MAC_PRODUCTIVITY_NOTIFICATION_EVENT = "xolotl://mac-productivity-notification";
export const MAC_APP_REOPEN_EVENT = "xolotl://app-reopen";
export const OPEN_EVAL_FROM_NOTIFICATION_EVENT = "xolotl:open-eval-from-notification";
export const PENDING_EVAL_NOTIFICATION_KEY = "xolotl.pendingEvalNotificationId";

const ROUTE_TTL_MS = 15 * 60 * 1000;

export type MacNotificationRoute =
  | { view: "chat" }
  | { view: "eval"; eval_id?: string | null }
  | { view: "agent"; agent_id: string }
  | { view: "permission"; prompt_id: string };

type SelectCenterTab = (tab: CenterTab) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function storePendingEvalNotificationId(evalId: string | null) {
  if (!evalId || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      PENDING_EVAL_NOTIFICATION_KEY,
      JSON.stringify({ evalId, at: Date.now() }),
    );
  } catch {
    // Private browsing or restricted WebViews can disable sessionStorage.
  }
}

export function consumePendingEvalNotificationId(now = Date.now()): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_EVAL_NOTIFICATION_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(PENDING_EVAL_NOTIFICATION_KEY);
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    const evalId = optionalString(parsed.evalId);
    const at = typeof parsed.at === "number" ? parsed.at : 0;
    if (!evalId || now - at > ROUTE_TTL_MS) return null;
    return evalId;
  } catch {
    return null;
  }
}

export function macNotificationRouteFromPayload(payload: unknown): MacNotificationRoute | null {
  const candidate = isRecord(payload) && "route" in payload ? payload.route : payload;
  if (!isRecord(candidate) || typeof candidate.view !== "string") return null;

  if (candidate.view === "chat") return { view: "chat" };
  if (candidate.view === "eval") {
    return { view: "eval", eval_id: optionalString(candidate.eval_id) };
  }
  if (candidate.view === "agent") {
    const agentId = optionalString(candidate.agent_id);
    return agentId ? { view: "agent", agent_id: agentId } : null;
  }
  if (candidate.view === "permission") {
    const promptId = optionalString(candidate.prompt_id);
    return promptId ? { view: "permission", prompt_id: promptId } : null;
  }
  return null;
}

export function macNotificationRouteFromAction(notification: unknown): MacNotificationRoute | null {
  if (!isRecord(notification)) return null;
  const extra = notification.extra;
  if (!isRecord(extra)) return null;
  return macNotificationRouteFromPayload(extra.xolotlRoute ?? extra.route ?? extra);
}

export function applyMacNotificationRoute(route: MacNotificationRoute, selectCenterTab: SelectCenterTab) {
  const agentStore = useAgentStore.getState();
  agentStore.openMergeCheckpoint(null);

  if (route.view === "agent") {
    agentStore.setExpandedAgent(route.agent_id);
    return;
  }

  agentStore.setExpandedAgent(null);
  if (route.view === "eval") {
    const evalId = route.eval_id ?? null;
    storePendingEvalNotificationId(evalId);
    selectCenterTab("eval");
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent(OPEN_EVAL_FROM_NOTIFICATION_EVENT, {
            detail: { evalId },
          }),
        );
      }, 0);
    }
    return;
  }

  selectCenterTab("chat");
}

export function useMacNotificationRoutes(selectCenterTab: SelectCenterTab) {
  const selectCenterTabRef = useRef(selectCenterTab);
  const latestRouteRef = useRef<{ route: MacNotificationRoute; at: number } | null>(null);

  useEffect(() => {
    selectCenterTabRef.current = selectCenterTab;
  }, [selectCenterTab]);

  useEffect(() => {
    let cancelled = false;
    let unlistenNotification: UnlistenFn | null = null;
    let unlistenReopen: UnlistenFn | null = null;
    let unlistenAction: (() => void) | null = null;

    const rememberRoute = (route: MacNotificationRoute | null) => {
      if (!route) return;
      latestRouteRef.current = { route, at: Date.now() };
    };

    const routeLatest = () => {
      const latest = latestRouteRef.current;
      if (!latest || Date.now() - latest.at > ROUTE_TTL_MS) return;
      latestRouteRef.current = null;
      applyMacNotificationRoute(latest.route, selectCenterTabRef.current);
    };

    listen<unknown>(MAC_PRODUCTIVITY_NOTIFICATION_EVENT, (event) => {
      rememberRoute(macNotificationRouteFromPayload(event.payload));
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlistenNotification = fn;
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("mac notification route listener failed:", err);
        notifyMacAppStatus({
          tone: "error",
          message: "Mac notification routing unavailable.",
          hint: `Notifications may still appear, but opening them may not return to the related Xolotl view. Restart Xolotl Code if this repeats. ${errorDetail(err)}`,
        });
      });

    listen<unknown>(MAC_APP_REOPEN_EVENT, () => {
      routeLatest();
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlistenReopen = fn;
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("mac app reopen listener failed:", err);
        notifyMacAppStatus({
          tone: "error",
          message: "Mac app reopen routing unavailable.",
          hint: `Dock and notification reopen events may not restore the latest Xolotl context. Restart Xolotl Code if this repeats. ${errorDetail(err)}`,
        });
      });

    void import("@tauri-apps/plugin-notification")
      .then(({ onAction }) => onAction((notification) => {
        const route = macNotificationRouteFromAction(notification);
        if (route) applyMacNotificationRoute(route, selectCenterTabRef.current);
      }))
      .then((listener) => {
        const unregister = () => {
          void listener.unregister();
        };
        if (cancelled) unregister();
        else unlistenAction = unregister;
      })
      .catch(() => {
        // The current desktop notification plugin does not emit click payloads.
        // Reopen routing above is the supported macOS fallback.
      });

    return () => {
      cancelled = true;
      unlistenNotification?.();
      unlistenReopen?.();
      unlistenAction?.();
    };
  }, []);
}
