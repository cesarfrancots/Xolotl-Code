import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import type { MacAppStatus } from "../../lib/macAppStatus";

export function MacAppStatusBanner({
  status,
  onDismiss,
}: {
  status: MacAppStatus;
  onDismiss: () => void;
}) {
  const Icon = status.tone === "error" ? AlertTriangle : CheckCircle2;
  const classes = status.tone === "error"
    ? "border-[oklch(0.34_0.055_25)] bg-[oklch(0.145_0.018_25)] text-[oklch(0.78_0.090_25)]"
    : "border-[oklch(0.32_0.045_155)] bg-[oklch(0.145_0.018_155)] text-[oklch(0.74_0.080_155)]";

  return (
    <div
      role={status.tone === "error" ? "alert" : "status"}
      className={`flex flex-none items-start gap-2 border-t px-3 py-2 text-xs ${classes}`}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 flex-none" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{status.message}</div>
        {status.hint && <div className="mt-0.5 break-words leading-relaxed text-[oklch(0.67_0.045_45)]">{status.hint}</div>}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="flex-none rounded px-1 text-[oklch(0.55_0.012_225)] hover:bg-[oklch(0.18_0.008_245)] hover:text-[oklch(0.86_0.016_220)]"
        aria-label="Dismiss Mac app status"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
