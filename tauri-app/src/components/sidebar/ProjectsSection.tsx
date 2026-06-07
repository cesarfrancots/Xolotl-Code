import { useState } from "react";
import { ClipboardList, Code2, Copy, ExternalLink, Folder, FolderPlus, Link2, TerminalSquare, X } from "lucide-react";
import { useProjectStore } from "../../stores/projectStore";
import { macPathLabel } from "../../lib/fileBrowser";
import { macFileAccessRecovery } from "../../lib/macFileRecovery";
import {
  copyProjectAutomationHandoff,
  copyProjectContextHandoff,
  copyTextToClipboard,
  copyXolotlCodeOpenShellCommand,
  copyXolotlCodeOpenUrl,
  openPathInExternalEditor,
  openPathInExternalTerminal,
  revealPathInFinder,
} from "../../lib/pathActions";
import {
  SidebarHandoffStatus,
  sidebarHandoffRecoveryHint,
  type SidebarHandoffKind,
  type SidebarHandoffStatusState,
} from "./SidebarHandoffStatus";

/**
 * Codex-style quick-access list of working directories. "Open folder" launches
 * the native picker and persists the choice; clicking a project scopes the chat
 * to it (and starts a fresh conversation there).
 */
export function ProjectsSection({ onOpenProject }: { onOpenProject: (path: string) => void }) {
  const projects = useProjectStore((s) => s.projects);
  const activePath = useProjectStore((s) => s.activeProjectPath);
  const projectError = useProjectStore((s) => s.error);
  const openFolderDialog = useProjectStore((s) => s.openFolderDialog);
  const removeProject = useProjectStore((s) => s.removeProject);
  const clearProjectError = useProjectStore((s) => s.clearProjectError);
  const [handoffStatus, setHandoffStatus] = useState<SidebarHandoffStatusState | null>(null);

  async function runHandoff(
    label: string,
    action: () => Promise<void>,
    successMessage: string,
    kind: SidebarHandoffKind,
    target: string,
  ) {
    try {
      await action();
      setHandoffStatus({ tone: "ok", message: successMessage });
    } catch (error) {
      setHandoffStatus({
        tone: "error",
        message: `${label} failed.`,
        hint: sidebarHandoffRecoveryHint(kind, error, target),
      });
    }
  }

  return (
    <div className="flex flex-col">
      <div className="xolotl-sidebar-section-header">
        <span className="xolotl-sidebar-section-title">Projects</span>
        {projects.length > 0 && (
          <span className="xolotl-sidebar-section-count" aria-label={`${projects.length} saved projects`}>
            {projects.length}
          </span>
        )}
        <button
          type="button"
          title="Open folder…"
          aria-label="Open a folder"
          onClick={() => void openFolderDialog()}
          className="xolotl-sidebar-section-action"
        >
          <FolderPlus className="h-3 w-3" />
          Open
        </button>
      </div>

      {handoffStatus && (
        <SidebarHandoffStatus
          status={handoffStatus}
          onDismiss={() => setHandoffStatus(null)}
          dismissLabel="Dismiss project status"
        />
      )}

      {projectError && (
        <SidebarHandoffStatus
          status={projectOpenErrorStatus(projectError)}
          onDismiss={clearProjectError}
          dismissLabel="Dismiss project open error"
          action={{
            label: "Open Folder",
            ariaLabel: "Open Folder to retry project access",
            onClick: () => void openFolderDialog(),
          }}
        />
      )}

      {projects.length === 0 ? (
        <button
          type="button"
          onClick={() => void openFolderDialog()}
          className="xolotl-sidebar-empty-action"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[oklch(0.76_0.034_195)]">
            <FolderPlus className="h-3.5 w-3.5" />
            Open a folder
          </div>
        </button>
      ) : (
        <ul className="flex flex-col gap-0.5 px-1 pb-1">
          {projects.map((project) => {
            const isActive = project.path === activePath;
            return (
              <li key={project.path}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => onOpenProject(project.path)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenProject(project.path);
                    }
                  }}
                  title={macPathLabel(project.path)}
                  aria-label={`Open project ${project.name}`}
                  className={[
                    "xolotl-project-row",
                    isActive ? "xolotl-project-row-active" : "",
                  ].join(" ")}
                >
                  <Folder
                    className={[
                      "h-3.5 w-3.5 flex-none",
                      isActive ? "text-[oklch(0.74_0.050_190)]" : "text-[oklch(0.56_0.030_195)]",
                    ].join(" ")}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={[
                        "truncate text-[13px] leading-tight",
                        isActive ? "text-[oklch(0.92_0.015_220)]" : "text-[oklch(0.80_0.012_222)]",
                      ].join(" ")}
                    >
                      {project.name}
                    </p>
                    <p className="truncate text-[10px] leading-tight text-[oklch(0.48_0.010_225)]">
                      {macPathLabel(project.path)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void runHandoff(
                        `Reveal ${project.name} in Finder`,
                        () => revealPathInFinder(project.path),
                        `${project.name} revealed in Finder.`,
                        "finder",
                        "project folder",
                      );
                    }}
                    title="Reveal in Finder"
                    aria-label={`Reveal ${project.name} in Finder`}
                    className="xolotl-row-action-button"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void runHandoff(
                        `Copy POSIX path for ${project.name}`,
                        () => copyTextToClipboard(project.path),
                        `POSIX path copied for ${project.name}.`,
                        "clipboard",
                        "path",
                      );
                    }}
                    title="Copy POSIX path"
                    aria-label={`Copy POSIX path for ${project.name}`}
                    className="xolotl-row-action-button"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void runHandoff(
                        `Copy Xolotl link for ${project.name}`,
                        () => copyXolotlCodeOpenUrl(project.path),
                        `Xolotl link copied for ${project.name}.`,
                        "clipboard",
                        "path",
                      );
                    }}
                    title="Copy Xolotl link"
                    aria-label={`Copy Xolotl link for ${project.name}`}
                    className="xolotl-row-action-button"
                  >
                    <Link2 className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void runHandoff(
                        `Copy shell open command for ${project.name}`,
                        () => copyXolotlCodeOpenShellCommand(project.path),
                        `Shell open command copied for ${project.name}.`,
                        "clipboard",
                        "path",
                      );
                    }}
                    title="Copy shell open command"
                    aria-label={`Copy shell open command for ${project.name}`}
                    className="xolotl-row-action-button"
                  >
                    <TerminalSquare className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void runHandoff(
                        `Copy context prompt for ${project.name}`,
                        () => copyProjectContextHandoff(project.path, project.name),
                        `Context prompt copied for ${project.name}.`,
                        "clipboard",
                        "path",
                      );
                    }}
                    title="Copy context prompt"
                    aria-label={`Copy context prompt for ${project.name}`}
                    className="xolotl-row-action-button"
                  >
                    <ClipboardList className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void runHandoff(
                        `Copy Shortcuts JSON for ${project.name}`,
                        () => copyProjectAutomationHandoff(project.path, project.name),
                        `Shortcuts JSON copied for ${project.name}.`,
                        "clipboard",
                        "path",
                      );
                    }}
                    title="Copy Shortcuts JSON"
                    aria-label={`Copy Shortcuts JSON for ${project.name}`}
                    className="xolotl-row-action-button"
                  >
                    <ClipboardList className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void runHandoff(
                        `Open ${project.name} in external editor`,
                        () => openPathInExternalEditor(project.path),
                        `${project.name} opened in the external editor.`,
                        "editor",
                        "project folder",
                      );
                    }}
                    title="Open in external editor"
                    aria-label={`Open ${project.name} in external editor`}
                    className="xolotl-row-action-button"
                  >
                    <Code2 className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void runHandoff(
                        `Open ${project.name} in external terminal`,
                        () => openPathInExternalTerminal(project.path),
                        `${project.name} opened in the external terminal.`,
                        "terminal",
                        "project folder",
                      );
                    }}
                    title="Open in external terminal"
                    aria-label={`Open ${project.name} in external terminal`}
                    className="xolotl-row-action-button"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeProject(project.path);
                    }}
                    title="Remove from quick access"
                    aria-label={`Remove ${project.name} from quick access`}
                    className="xolotl-row-action-button xolotl-row-action-button-danger"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function projectOpenErrorStatus(error: string): SidebarHandoffStatusState {
  const lower = error.toLowerCase();
  if (lower.includes("drag and drop unavailable")) {
    return {
      tone: "error",
      message: "Project drag and drop unavailable.",
      hint: `Restart Xolotl Code and try dragging the folder again. ${error}`,
    };
  }
  if (lower.includes("project open listener unavailable")) {
    return {
      tone: "error",
      message: "Project URL open unavailable.",
      hint: `Restart Xolotl Code and try the xolotl-code link again. ${error}`,
    };
  }
  if (lower.includes("restore launch project paths")) {
    return {
      tone: "error",
      message: "Could not restore launch project folders.",
      hint: `Use Open Folder to add the folder again. ${error}`,
    };
  }
  if (lower.includes("restore last active project")) {
    return {
      tone: "error",
      message: "Could not restore last active project.",
      hint: `Use Open Folder or choose another recent project. If macOS moved or denied this folder, grant access in System Settings and open it again. ${error}`,
    };
  }
  const recovery = macFileAccessRecovery(error, "project-open");
  return {
    tone: "error",
    message: recovery.message,
    hint: recovery.hint,
  };
}
