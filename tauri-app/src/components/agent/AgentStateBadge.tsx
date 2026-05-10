import { Loader2 } from "lucide-react";
import { Badge } from "../ui/badge";
import type { AgentState } from "../../bindings";

const STATE_CLASSES: Record<AgentState, string> = {
  Idle:      "bg-neutral-800 text-[oklch(0.55_0_0)] border-neutral-700",
  Planning:  "bg-blue-900/40 text-blue-400 border-blue-800",
  Executing: "bg-green-900/40 text-green-400 border-green-800",
  Waiting:   "bg-amber-900/40 text-amber-400 border-amber-800",
  Done:      "bg-emerald-900/40 text-emerald-400 border-emerald-800",
  Failed:    "bg-red-900/40 text-red-400 border-red-800",
};

export function AgentStateBadge({ state }: { state: AgentState }) {
  const cls = STATE_CLASSES[state];
  return (
    <Badge className={`${cls} gap-1 text-xs font-normal`}>
      {state === "Executing" && <Loader2 className="h-3 w-3 animate-spin" />}
      {state}
    </Badge>
  );
}
