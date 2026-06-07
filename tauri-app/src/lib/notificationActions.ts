import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export type NotificationPermissionState = NotificationPermission | "unsupported" | "unknown";

function isBrowserPreview(): boolean {
  return typeof window !== "undefined"
    && (window as Window & { __XOLOTL_BROWSER_PREVIEW__?: boolean }).__XOLOTL_BROWSER_PREVIEW__ === true;
}

function browserNotificationPermission(): NotificationPermissionState | null {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (isBrowserPreview()) return null;
  return window.Notification.permission;
}

export async function getNotificationPermissionState(): Promise<NotificationPermissionState> {
  if (isBrowserPreview()) return "granted";
  const browserPermission = browserNotificationPermission();
  if (browserPermission === "unsupported") return "unsupported";
  if (browserPermission && browserPermission !== "default") return browserPermission;

  try {
    return (await isPermissionGranted()) ? "granted" : "default";
  } catch {
    return browserPermission ?? "unknown";
  }
}

export async function requestNotificationPermissionState(): Promise<NotificationPermissionState> {
  if (isBrowserPreview()) return "granted";
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  try {
    return await requestPermission();
  } catch {
    return getNotificationPermissionState();
  }
}

export function sendSettingsTestNotification() {
  if (isBrowserPreview()) return;
  sendNotification({
    title: "Xolotl Code",
    body: "macOS notifications are enabled.",
  });
}
