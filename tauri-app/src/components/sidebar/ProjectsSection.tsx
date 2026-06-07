import { Copy, ExternalLink, Folder, FolderPlus, X } from "lucide-react";
import { useProjectStore } from "../../stores/projectStore";
import { macPathLabel } from "../../lib/fileBrowser";
import { copyTextToClipboard, revealPathInFinder } from "../../lib/pathActions";

/**
 * Codex-style quick-access list of working directories. "Open folder" launches
 * the native picker and persists the choice; clicking a project scopes the chat
 * to it (and starts a fresh conversation there).
 */
export function ProjectsSection({ onOpenProject }: { onOpenProject: (path: string) => void }) {
  const projects = useProjectStore((s) => s.projects);
  const activePath = useProjectStore((s) => s.activeProjectPath);
  const openFolderDialog = useProjectStore((s) => s.openFolderDialog);
  const removeProject = useProjectStore((s) => s.removeProject);

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
                      void revealPathInFinder(project.path).catch((err) => console.error("reveal project failed:", err));
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
                      void copyTextToClipboard(project.path);
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
