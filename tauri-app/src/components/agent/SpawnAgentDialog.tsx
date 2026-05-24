import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "../ui/dialog";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { commands } from "../../bindings";
import { useAgentStore } from "../../stores/agentStore";

export function SpawnAgentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState<string>("");
  const [task, setTask] = useState<string>("");
  const [budget, setBudget] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    commands.listModels()
      .then((list) => {
        if (list.length > 0) {
          setModels(list);
          setModel(list[0]);
        }
      })
      .catch(() => setError("Failed to load model list."));
  }, []);

  function reset() {
    setTask("");
    setBudget("");
    setError(null);
    setModel(models[0] ?? "");
  }

  async function handleSpawn() {
    setError(null);
    const trimmedTask = task.trim();
    if (!trimmedTask) {
      setError("Task is required.");
      return;
    }
    let budgetDollars: number | null = null;
    if (budget.trim() !== "") {
      const parsed = Number(budget);
      // T-5-01 client-side mirror: server still validates
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setError("Budget must be a positive number.");
        return;
      }
      budgetDollars = parsed;
    }
    setSubmitting(true);
    const result = await commands.spawnAgent(trimmedTask, model, budgetDollars, null);
    setSubmitting(false);
    if (result.status === "error") {
      // Create a synthetic Failed card so the user sees feedback in the roster.
      const failedId = `failed-${Date.now()}`;
      useAgentStore.getState().addAgent(failedId, trimmedTask, model, "", null);
      useAgentStore.getState().updateAgentState(failedId, "Failed");
      useAgentStore.getState().appendAgentError(failedId, result.error);
      reset();
      onOpenChange(false);
      return;
    }
    useAgentStore.getState().addAgent(result.data, trimmedTask, model, "", null);
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="border-[oklch(0.22_0.008_240)] bg-[oklch(0.112_0.004_245)] text-[oklch(0.90_0.015_220)] shadow-[0_28px_90px_oklch(0_0_0_/_0.32)]">
        <DialogHeader>
          <DialogTitle className="text-[oklch(0.92_0.015_220)]">Spawn Agent</DialogTitle>
          <DialogDescription className="text-[oklch(0.56_0.014_225)]">
            Pick a model, describe the task, and optionally cap spend.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[oklch(0.56_0.014_225)]">Model</label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="border-[oklch(0.24_0.010_235)] bg-[oklch(0.13_0.004_245)] text-[oklch(0.84_0.012_220)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-[oklch(0.24_0.010_235)] bg-[oklch(0.115_0.004_245)] text-[oklch(0.86_0.012_220)]">
                {models.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[oklch(0.56_0.014_225)]">Task</label>
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              rows={4}
              placeholder="e.g. Refactor the auth module to use jose"
              className="rounded-md border border-[oklch(0.24_0.010_235)] bg-[oklch(0.13_0.004_245)] px-3 py-2 text-sm text-[oklch(0.90_0.015_220)] placeholder:text-[oklch(0.42_0.012_235)] resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[oklch(0.52_0.030_195)]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[oklch(0.56_0.014_225)]">Budget (USD, optional)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="e.g. 0.10 (leave blank for unlimited)"
              className="rounded-md border border-[oklch(0.24_0.010_235)] bg-[oklch(0.13_0.004_245)] px-3 py-2 text-sm text-[oklch(0.90_0.015_220)] placeholder:text-[oklch(0.42_0.012_235)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[oklch(0.52_0.030_195)]"
            />
          </div>
          {error && (
            <p className="rounded-md border border-[oklch(0.38_0.040_28)] bg-[oklch(0.13_0.014_28)] px-3 py-2 text-xs text-[oklch(0.72_0.060_28)]" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" className="text-[oklch(0.58_0.012_230)] hover:text-[oklch(0.86_0.015_220)]" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="bg-[oklch(0.46_0.040_190)] text-white hover:bg-[oklch(0.42_0.040_190)]" onClick={() => void handleSpawn()} disabled={submitting}>
            {submitting ? "Spawning..." : "Spawn Agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
