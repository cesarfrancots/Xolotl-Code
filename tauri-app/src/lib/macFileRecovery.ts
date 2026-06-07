export type MacFileAccessContext = "project-open" | "folder-browse";

export interface MacFileAccessRecovery {
  message: string;
  hint: string;
}

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

function withDetail(message: string, detail: string): string {
  return detail ? `${message} ${detail}` : message;
}

export function macFileAccessRecovery(
  error: unknown,
  context: MacFileAccessContext,
): MacFileAccessRecovery {
  const detail = detailFromError(error);
  const lower = detail.toLowerCase();
  const isProjectOpen = context === "project-open";

  if (
    lower.includes("permission denied")
    || lower.includes("operation not permitted")
    || lower.includes("not permitted")
    || lower.includes("eacces")
    || lower.includes("eperm")
    || lower.includes("privacy")
  ) {
    return {
      message: "Folder access blocked by macOS.",
      hint: withDetail(
        "Open macOS System Settings > Privacy & Security and allow Xolotl Code access to the folder, then retry.",
        detail,
      ),
    };
  }

  if (
    lower.includes("not a directory")
    || lower.includes("no such file or directory")
    || lower.includes("path does not exist")
    || lower.includes("folder missing")
    || lower.includes("missing")
    || lower.includes("moved")
    || lower.includes("deleted")
  ) {
    return {
      message: isProjectOpen ? "Project folder unavailable." : "Folder unavailable.",
      hint: withDetail(
        isProjectOpen
          ? "The folder may have moved or been deleted. Use Open Folder to add it again, or remove the stale project from quick access."
          : "The folder may have moved or been deleted. Use Project root, Open Folder, or Refresh after restoring it.",
        detail,
      ),
    };
  }

  return {
    message: isProjectOpen ? "Could not open project folder." : "Could not load folder contents.",
    hint: withDetail(
      "Check that the folder still exists and that macOS has allowed Xolotl Code to access it.",
      detail,
    ),
  };
}
