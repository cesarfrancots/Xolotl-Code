import { Folder, FolderPlus, X } from "lucide-react";
import { useProjectStore } from "../../stores/projectStore";

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
      <div className="flex items-center gap-1 px-2.5 pt-2 pb-1">
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-[oklch(0.56_0.012_220)]">
          Projects
        </span>
        <button
          type="button"
          title="Open folder…"
          aria-label="Open a folder"
          onClick={() => void openFolderDialog()}
          className="flex items-center gap-1 rounded-md border border-[oklch(0.26_0.012_205)] bg-[oklch(0.13_0.006_210)] px-1.5 py-0.5 text-[10px] font-medium text-[oklch(0.70_0.040_190)] hover:bg-[oklch(0.16_0.010_205)] hover:text-[oklch(0.82_0.050_190)]"
        >
          <FolderPlus className="h-3 w-3" />
          Open
        </button>
      </div>

      {projects.length === 0 ? (
        <button
          type="button"
          onClick={() => void openFolderDialog()}
          className="mx-2 mb-1.5 rounded-lg border border-dashed border-[oklch(0.26_0.012_210)] bg-[oklch(0.115_0.004_245)] px-3 py-2.5 text-left transition-colors hover:border-[oklch(0.34_0.025_195)] hover:bg-[oklch(0.135_0.006_220)]"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[oklch(0.74_0.030_195)]">
            <FolderPlus className="h-3.5 w-3.5" />
            Open a folder
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-[oklch(0.50_0.010_225)]">
            Pick a working directory to chat about. It's saved here for quick access.
          </p>
        </button>
      ) : (
        <ul className="flex flex-col gap-0.5 px-1.5 pb-1">
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
                  title={project.path}
                  className={[
                    "group relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[oklch(0.55_0.04_195)]",
                    isActive
                      ? "bg-[oklch(0.16_0.012_195)] shadow-[inset_0_0_0_1px_oklch(0.40_0.025_195)]"
                      : "hover:bg-[oklch(0.155_0.004_240)]",
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
                    <p className="truncate text-[10px] leading-tight text-[oklch(0.46_0.010_225)]">
                      {project.path}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeProject(project.path);
                    }}
                    title="Remove from quick access"
                    aria-label={`Remove ${project.name} from quick access`}
                    className="grid h-5 w-5 flex-none place-items-center rounded text-[oklch(0.40_0_0)] opacity-0 transition-opacity hover:text-[oklch(0.62_0.18_25)] group-hover:opacity-100"
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
