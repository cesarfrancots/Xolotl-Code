import { AlertTriangle, CheckCircle2 } from "lucide-react";

export type SidebarHandoffTone = "ok" | "error";
export type SidebarHandoffKind = "finder" | "quick-look" | "editor" | "terminal" | "clipboard";

export interface SidebarHandoffStatusState {
  tone: SidebarHandoffTone;
  message: string;
  hint?: string;
}

export function sidebarHandoffRecoveryHint(
  kind: SidebarHandoffKind,
  error: unknown,
  target = "path",
): string {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  const suffix = detail ? ` ${detail}` : "";
  switch (kind) {
    case "finder":
      return `Check that the ${target} still exists and that macOS has allowed Xolotl Code to access it.${suffix}`;
    case "quick-look":
      return `Check that the file still exists and can be previewed by Quick Look.${suffix}`;
    case "editor":
      return `Check the preferred editor in macOS Settings, or use an installed app name or executable path.${suffix}`;
    case "terminal":
      return `Check the preferred external terminal in macOS Settings, or use Terminal, iTerm, Warp, an app bundle path, or executable path.${suffix}`;
    case "clipboard":
      return `Check macOS clipboard access and try the copy action again.${suffix}`;
  }
}

export function SidebarHandoffStatus({
  status,
  onDismiss,
  dismissLabel = "Dismiss sidebar status",
  action,
}: {
  status: SidebarHandoffStatusState;
  onDismiss: () => void;
  dismissLabel?: string;
  action?: {
    label: string;
    onClick: () => void;
    ariaLabel?: string;
  };
}) {
  const Icon = status.tone === "error" ? AlertTriangle : CheckCircle2;
  const classes = status.tone === "error"
    ? "border-[oklch(0.34_0.055_25)] bg-[oklch(0.145_0.018_25)] text-[oklch(0.76_0.080_25)]"
    : "border-[oklch(0.32_0.045_155)] bg-[oklch(0.14_0.016_155)] text-[oklch(0.72_0.070_155)]";

  return (
    <div
      role={status.tone === "error" ? "alert" : "status"}
      className={`mx-2 mb-1 flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-[11px] ${classes}`}
    >
      <Icon className="mt-0.5 h-3 w-3 flex-none" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{status.message}</div>
        {status.hint && <div className="mt-0.5 break-words leading-relaxed text-[oklch(0.67_0.045_45)]">{status.hint}</div>}
      </div>
      <div className="flex flex-none flex-col items-end gap-1">
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="whitespace-nowrap rounded border border-[oklch(0.30_0.018_230)] px-1.5 py-0.5 text-[oklch(0.78_0.030_210)] hover:border-[oklch(0.42_0.035_210)] hover:bg-[oklch(0.18_0.010_235)] hover:text-[oklch(0.90_0.018_220)]"
            aria-label={action.ariaLabel ?? action.label}
          >
            {action.label}
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="whitespace-nowrap rounded px-1 text-[oklch(0.55_0.012_225)] hover:bg-[oklch(0.18_0.008_245)] hover:text-[oklch(0.86_0.016_220)]"
          aria-label={dismissLabel}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
