import { Loader2 } from "lucide-react";
import { Badge } from "../ui/badge";
import type { AgentState } from "../../bindings";

const STATE_CLASSES: Record<AgentState, string> = {
  Idle:      "bg-[oklch(0.16_0.004_240)] text-[oklch(0.54_0.010_225)] border-[oklch(0.24_0.010_235)]",
  Planning:  "bg-[oklch(0.15_0.010_195)] text-[oklch(0.72_0.040_190)] border-[oklch(0.32_0.020_195)]",
  Executing: "bg-[oklch(0.18_0.035_145)] text-[oklch(0.72_0.095_145)] border-[oklch(0.34_0.060_145)]",
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
