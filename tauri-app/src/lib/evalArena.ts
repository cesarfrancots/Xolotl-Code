export type ArenaModelStatus = "pending" | "running" | "done" | "error";

export function arenaCreatureClass(status: ArenaModelStatus): string {
  const stateClass =
    status === "running" ? "eval-creature-active" :
    status === "done" ? "eval-creature-done" :
    status === "error" ? "eval-creature-failed" :
    "eval-creature-pending";
  return `eval-creature ${stateClass}`;
}

export function arenaCreatureStatusLabel(status: ArenaModelStatus): string {
  if (status === "running") return "working";
  if (status === "done") return "finished";
  if (status === "error") return "stopped";
  return "queued";
}
