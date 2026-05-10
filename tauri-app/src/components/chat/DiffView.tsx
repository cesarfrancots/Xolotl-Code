import { computeLineDiff } from "../../lib/diff";

interface DiffViewProps {
  /** Content before the edit. */
  oldStr: string;
  /** Content after the edit. */
  newStr: string;
}

/**
 * Renders a unified line diff between two strings.
 * Added lines: green background + "+" prefix.
 * Removed lines: red background + "-" prefix.
 * Unchanged lines: no background, muted text, " " prefix.
 *
 * Per D-09 (locked): unified diff format, single-column, green/red line-background.
 * Per D-10 (locked): diff npm package computeLineDiff().
 * Per RESEARCH.md anti-patterns: render as React children, NEVER dangerouslySetInnerHTML.
 * Per 04-UI-SPEC.md §DiffView: max-h-64 with overflow-y-auto, font-mono text-xs.
 */
export function DiffView({ oldStr, newStr }: DiffViewProps) {
  const changes = computeLineDiff(oldStr, newStr);

  if (changes.length === 0) {
    return null;
  }

  return (
    <div className="rounded-sm overflow-hidden border border-neutral-800 font-mono text-xs max-h-64 overflow-y-auto my-2">
      {changes.map((part, partIdx) =>
        part.value
          .split("\n")
          .filter((line, lineIdx, arr) => !(lineIdx === arr.length - 1 && line === ""))
          .map((line, lineIdx) => {
            const bg = part.added
              ? "bg-green-900/40"
              : part.removed
              ? "bg-red-900/40"
              : "";
            const prefixColor = part.added
              ? "text-green-400"
              : part.removed
              ? "text-red-400"
              : "text-[oklch(0.38_0_0)]";
            const textColor = part.added
              ? "text-green-300"
              : part.removed
              ? "text-red-400"
              : "text-[oklch(0.38_0_0)]";
            const prefix = part.added ? "+" : part.removed ? "-" : " ";

            return (
              <div
                key={`${partIdx}-${lineIdx}`}
                className={`flex px-2 py-0.5 ${bg}`}
              >
                <span className={`w-4 flex-none select-none ${prefixColor}`}>
                  {prefix}
                </span>
                <span className={`flex-1 whitespace-pre-wrap break-all ${textColor}`}>
                  {line}
                </span>
              </div>
            );
          })
      )}
    </div>
  );
}
