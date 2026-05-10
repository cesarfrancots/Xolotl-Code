import { Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import type { SessionMeta } from "../../bindings";

interface SessionItemProps {
  session: SessionMeta;
  isActive: boolean;
  onResume: () => void;
  onDelete: () => void;
}

/**
 * Single session row in the sidebar.
 * 40px min-height, hover shows delete button.
 * Active session has accent left border.
 * Per 04-UI-SPEC.md §Session Sidebar.
 */
export function SessionItem({ session, isActive, onResume, onDelete }: SessionItemProps) {
  const date = new Date(session.created_at * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    <div
      className={[
        "group relative flex items-start gap-2 px-4 py-2 cursor-pointer min-h-[40px]",
        "hover:bg-[oklch(0.20_0_0)] transition-colors",
        isActive ? "bg-[oklch(0.20_0_0)] border-l-2 border-[oklch(0.65_0.18_250)]" : "border-l-2 border-transparent",
      ].join(" ")}
      onClick={onResume}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[oklch(0.92_0_0)] truncate">
          {session.title || `Session ${session.id.slice(0, 8)}`}
        </p>
        <p className="text-xs text-[oklch(0.55_0_0)]">{date}</p>
      </div>
      {/* Delete button — visible on hover only */}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 opacity-0 group-hover:opacity-100 flex-none text-[oklch(0.38_0_0)] hover:text-[oklch(0.60_0.20_25)] transition-opacity"
        title="Delete session"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
