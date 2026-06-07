export type MacFileAccessContext = "project-open" | "folder-browse";

export interface MacFileAccessRecovery {
  message: string;
  hint: string;
}

const MAC_PRIVACY_HINT =
  "For folders under Documents, Desktop, Downloads, iCloud Drive, external drives, or network volumes, open macOS System Settings > Privacy & Security > Files and Folders or Full Disk Access, allow Xolotl Code, then choose the folder again with Open Folder.";

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
        MAC_PRIVACY_HINT,
        detail,
      ),
    };
  }

  if (
    lower.includes("security scoped")
    || lower.includes("security-scoped")
    || lower.includes("bookmark")
    || lower.includes("stale access")
    || lower.includes("scope")
  ) {
    return {
      message: isProjectOpen ? "Project folder permission needs refresh." : "Folder permission needs refresh.",
      hint: withDetail(
        "macOS may have invalidated the saved folder permission. Use Open Folder to choose the folder again; if it still fails, grant Xolotl Code access in Privacy & Security.",
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
      "Check that the folder still exists, choose it again with Open Folder, and confirm macOS has allowed Xolotl Code to access it.",
      detail,
    ),
  };
}
