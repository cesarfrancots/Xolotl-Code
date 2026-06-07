import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { errorDetail, type MacAppStatus } from "../../lib/macAppStatus";
import {
  dispatchNativeMenuAction,
  nativeMenuActionFromPayload,
  nativeRecentProjectMenuActionFromPayload,
  TAURI_MENU_EVENT,
  TAURI_RECENT_PROJECT_MENU_EVENT,
  type NativeRecentProjectMenuPayload,
} from "../../lib/nativeMenu";

export function MacNativeMenuEventBridge({
  onRecentProjectMenuAction,
  onBridgeStatus,
}: {
  onRecentProjectMenuAction: (payload: NativeRecentProjectMenuPayload) => void;
  onBridgeStatus: (status: MacAppStatus) => void;
}) {
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    listen<string>(TAURI_MENU_EVENT, (event) => {
      const action = nativeMenuActionFromPayload(event.payload);
      if (action) dispatchNativeMenuAction(action);
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("native menu listener failed:", err);
        onBridgeStatus({
          tone: "error",
          message: "Native menu bridge unavailable.",
          hint: `Restart Xolotl Code if menu commands stop responding. Keyboard shortcuts inside the app still work. ${errorDetail(err)}`,
        });
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [onBridgeStatus]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    listen<unknown>(TAURI_RECENT_PROJECT_MENU_EVENT, (event) => {
      const payload = nativeRecentProjectMenuActionFromPayload(event.payload);
      if (payload) onRecentProjectMenuAction(payload);
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("recent project menu listener failed:", err);
        onBridgeStatus({
          tone: "error",
          message: "Recent project menu bridge unavailable.",
          hint: `Restart Xolotl Code if recent project handoff commands stop responding. Direct Open Recent entries still work. ${errorDetail(err)}`,
        });
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [onBridgeStatus, onRecentProjectMenuAction]);

  return null;
}
