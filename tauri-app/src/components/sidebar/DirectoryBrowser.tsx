import { useState } from "react";
import {
  CornerLeftUp,
  Eye,
  EyeOff,
  File as FileIcon,
  FileText,
  Folder,
  Link2,
  Loader2,
  Package,
  RefreshCw,
  Wand2,
} from "lucide-react";
import { commands } from "../../bindings";
import { useProjectStore, projectDisplayName } from "../../stores/projectStore";
import { directoryChildBadges, macPathLabel, visibleDirectoryChildren } from "../../lib/fileBrowser";

/**
 * Lightweight file browser for the active project. Folders are navigable;
 * `.pdf` files get a one-click "convert to Markdown" action that drops the
 * extracted text straight into the chat composer — so the model reads cheap
 * structured text instead of an unreadable binary.
 */
export function DirectoryBrowser() {
  const listing = useProjectStore((s) => s.listing);
  const loading = useProjectStore((s) => s.browseLoading);
  const error = useProjectStore((s) => s.browseError);
  const activePath = useProjectStore((s) => s.activeProjectPath);
  const browse = useProjectStore((s) => s.browse);
  const refreshBrowse = useProjectStore((s) => s.refreshBrowse);
  const [converting, setConverting] = useState<string | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  if (!activePath) return null;

  const atRoot = listing?.path === activePath;
  const here = listing ? projectDisplayName(listing.path) : "";
  const visibleChildren = listing ? visibleDirectoryChildren(listing.children, showHidden) : [];
  const hiddenCount = listing ? listing.children.length - visibleChildren.length : 0;

  async function convertPdf(path: string, name: string) {
    setConverting(path);
    setConvertError(null);
    try {
      const res = await commands.convertPdf(path, "md");
      if (res.status === "error") {
        setConvertError(res.error);
        return;
      }
      window.dispatchEvent(
        new CustomEvent("xolotl:insert-text", {
          detail: {
            text: `Content of **${name}** (converted from PDF — no AI/OCR):\n\n${res.data}`,
          },
        }),
      );
    } finally {
      setConverting(null);
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 px-2.5 pt-2 pb-1">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-[oklch(0.56_0.012_220)]">
          <Folder className="h-3.5 w-3.5 flex-none" />
          <span className="truncate" title={listing?.path ? macPathLabel(listing.path) : undefined}>{here || "Files"}</span>
        </span>
        <button
          type="button"
          title={showHidden ? "Hide hidden files" : hiddenCount > 0 ? `Show ${hiddenCount} hidden item${hiddenCount === 1 ? "" : "s"}` : "Show hidden files"}
          aria-label={showHidden ? "Hide hidden files" : "Show hidden files"}
          aria-pressed={showHidden}
          onClick={() => setShowHidden((value) => !value)}
          className={[
            "grid h-6 w-6 flex-none place-items-center rounded hover:bg-[oklch(0.16_0.004_240)] hover:text-[oklch(0.82_0.015_220)]",
            showHidden ? "text-[oklch(0.70_0.045_190)]" : "text-[oklch(0.46_0.010_225)]",
          ].join(" ")}
        >
          {showHidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
        </button>
        <button
          type="button"
          title="Up one folder"
          aria-label="Up one folder"
          disabled={!listing?.parent}
          onClick={() => listing?.parent && void browse(listing.parent)}
          className="grid h-6 w-6 flex-none place-items-center rounded text-[oklch(0.55_0.012_225)] hover:bg-[oklch(0.16_0.004_240)] hover:text-[oklch(0.82_0.015_220)] disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <CornerLeftUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Refresh"
          aria-label="Refresh files"
          onClick={() => void refreshBrowse()}
          className="grid h-6 w-6 flex-none place-items-center rounded text-[oklch(0.55_0.012_225)] hover:bg-[oklch(0.16_0.004_240)] hover:text-[oklch(0.82_0.015_220)]"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      {!atRoot && (
        <button
          type="button"
          onClick={() => void browse(activePath)}
          className="mx-2 mb-1 rounded px-1.5 py-0.5 text-left text-[10px] text-[oklch(0.50_0.010_225)] hover:text-[oklch(0.72_0.035_190)]"
          title={`Back to ${macPathLabel(activePath)}`}
        >
          ↳ back to project root
        </button>
      )}

      {convertError && (
        <p className="mx-2.5 mb-1 rounded bg-[oklch(0.16_0.04_28)] px-2 py-1 text-[11px] text-[oklch(0.74_0.07_28)]">
          Convert failed: {convertError}
        </p>
      )}

      <div className="max-h-[34vh] overflow-y-auto px-1.5 pb-1">
        {loading && !listing ? (
          <div className="flex items-center gap-2 px-2 py-2 text-xs text-[oklch(0.52_0.012_230)]">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        ) : error ? (
          <p className="px-2 py-2 text-[11px] text-[oklch(0.62_0.06_28)]">{error}</p>
        ) : listing && visibleChildren.length === 0 ? (
          <p className="px-2 py-2 text-[11px] text-[oklch(0.46_0.010_225)]">
            {listing.children.length === 0 ? "Empty folder" : "Only hidden items"}
          </p>
        ) : (
          <ul className="flex flex-col">
            {visibleChildren.map((child) => {
              const isConverting = converting === child.path;
              const badges = directoryChildBadges(child);
              return (
                <li key={child.path}>
                  {child.is_dir ? (
                    <button
                      type="button"
                      onClick={() => void browse(child.path)}
                      className={[
                        "group flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[13px] hover:bg-[oklch(0.155_0.004_240)] hover:text-[oklch(0.90_0.012_220)]",
                        child.is_hidden ? "text-[oklch(0.50_0.010_225)]" : "text-[oklch(0.74_0.010_225)]",
                      ].join(" ")}
                      title={macPathLabel(child.path)}
                    >
                      {child.is_package ? (
                        <Package className="h-3.5 w-3.5 flex-none text-[oklch(0.72_0.050_260)]" />
                      ) : (
                        <Folder className="h-3.5 w-3.5 flex-none text-[oklch(0.62_0.045_195)]" />
                      )}
                      {child.is_symlink && <Link2 className="h-3 w-3 flex-none text-[oklch(0.58_0.035_205)]" />}
                      <span className="min-w-0 flex-1 truncate">{child.name}</span>
                      <EntryBadges badges={badges} />
                    </button>
                  ) : (
                    <div
                      className={[
                        "flex w-full items-center gap-2 rounded px-2 py-1 text-[13px]",
                        child.is_pdf
                          ? "text-[oklch(0.80_0.012_220)]"
                          : child.is_hidden
                            ? "text-[oklch(0.42_0.010_228)]"
                            : "text-[oklch(0.52_0.010_228)]",
                      ].join(" ")}
                      title={macPathLabel(child.path)}
                    >
                      {child.is_pdf ? (
                        <FileText className="h-3.5 w-3.5 flex-none text-[oklch(0.70_0.10_60)]" />
                      ) : (
                        <FileIcon className="h-3.5 w-3.5 flex-none text-[oklch(0.42_0.008_230)]" />
                      )}
                      {child.is_symlink && <Link2 className="h-3 w-3 flex-none text-[oklch(0.50_0.025_205)]" />}
                      <span className="min-w-0 flex-1 truncate">{child.name}</span>
                      <EntryBadges badges={badges} />
                      {child.is_pdf && (
                        <button
                          type="button"
                          onClick={() => void convertPdf(child.path, child.name)}
                          disabled={isConverting}
                          title="Convert PDF → Markdown into the chat"
                          aria-label={`Convert ${child.name} to Markdown`}
                          className="flex flex-none items-center gap-1 rounded border border-[oklch(0.32_0.05_60)] bg-[oklch(0.16_0.02_60)] px-1.5 py-0.5 text-[10px] font-medium text-[oklch(0.78_0.09_65)] hover:bg-[oklch(0.20_0.03_60)] disabled:opacity-50"
                        >
                          {isConverting ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Wand2 className="h-3 w-3" />
                          )}
                          MD
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function EntryBadges({ badges }: { badges: string[] }) {
  if (badges.length === 0) return null;
  return (
    <span className="flex flex-none items-center gap-1">
      {badges.map((badge) => (
        <span
          key={badge}
          className="rounded border border-[oklch(0.24_0.010_235)] bg-[oklch(0.13_0.004_245)] px-1 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[oklch(0.50_0.012_225)]"
        >
          {badge}
        </span>
      ))}
    </span>
  );
}
