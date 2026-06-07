export const MAC_APP_STATUS_EVENT = "xolotl:mac-app-status";

export type MacAppStatusTone = "ok" | "error";

export interface MacAppStatus {
  tone: MacAppStatusTone;
  message: string;
  hint?: string;
}

export function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

export function notifyMacAppStatus(status: MacAppStatus) {
  window.dispatchEvent(new CustomEvent<MacAppStatus>(MAC_APP_STATUS_EVENT, { detail: status }));
}
