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
import { commands, type RoleConfig } from "../../bindings";
import { useAgentStore } from "../../stores/agentStore";

type Mode = "team" | "swarm";

const ROLES = [
  { name: "Planner", placeholder: "e.g. Break the feature into subtasks and define acceptance criteria" },
  { name: "Coder",   placeholder: "e.g. Implement the feature based on the plan" },
  { name: "Reviewer",placeholder: "e.g. Review the implementation for bugs and code quality" },
  { name: "Tester",  placeholder: "e.g. Write tests to verify the implementation" },
] as const;

interface TeamRole {
  task: string;
  model: string;
}

export function LaunchTeamDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("team");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Team mode state: one entry per role.
  const [teamRoles, setTeamRoles] = useState<TeamRole[]>(
    ROLES.map(() => ({ task: "", model: "" }))
  );

  // Swarm mode state
  const [swarmCount, setSwarmCount] = useState<string>("2");
  const [swarmObjective, setSwarmObjective] = useState<string>("");
  const [swarmModel, setSwarmModel] = useState<string>("");

  useEffect(() => {
    commands
      .listModels()
      .then((list) => {
        if (list.length > 0) {
          setModels(list);
          setSwarmModel(list[0]);
          setTeamRoles((roles) => roles.map((r) => ({ ...r, model: list[0] })));
        }
      })
      .catch(() => setError("Failed to load model list."));
  }, []);

  function reset() {
    setMode("team");
    setError(null);
    setSwarmCount("2");
    setSwarmObjective("");
    setTeamRoles(ROLES.map(() => ({ task: "", model: models[0] ?? "" })));
  }

  function updateRoleTask(index: number, task: string) {
    setTeamRoles((roles) => roles.map((r, i) => i === index ? { ...r, task } : r));
  }

  function updateRoleModel(index: number, model: string) {
    setTeamRoles((roles) => roles.map((r, i) => i === index ? { ...r, model } : r));
  }

  async function handleLaunch() {
    setError(null);

    if (mode === "team") {
      const anyEmpty = teamRoles.some((r) => !r.task.trim());
      if (anyEmpty) {
        setError("All role tasks are required.");
        return;
      }
      const roles: RoleConfig[] = ROLES.map((roleDef, i) => ({
        role: roleDef.name,
        task: teamRoles[i].task.trim(),
        model: teamRoles[i].model,
      }));
      setSubmitting(true);
      const result = await commands.launchTeam(roles);
      setSubmitting(false);
      if (result.status === "error") {
        setError(`Failed to launch: ${result.error}`);
        return;
      }
      const { group_id, agent_ids, branches } = result.data;
      const groupName = roles[0].task.slice(0, 40) || "Team";
      useAgentStore.getState().addGroup(group_id, agent_ids, "team", groupName);
      agent_ids.forEach((id, i) => {
        useAgentStore.getState().addAgent(id, roles[i].task, roles[i].model, branches[i], group_id);
      });
    } else {
      const count = Number(swarmCount);
      if (!Number.isFinite(count) || count < 1 || count > 8) {
        setError("Agent count must be between 1 and 8.");
        return;
      }
      if (!swarmObjective.trim()) {
        setError("Objective is required.");
        return;
      }
      setSubmitting(true);
      const result = await commands.launchSwarm(count, swarmObjective.trim(), swarmModel);
      setSubmitting(false);
      if (result.status === "error") {
        setError(`Failed to launch: ${result.error}`);
        return;
      }
      const { group_id, agent_ids, branches } = result.data;
      const groupName = swarmObjective.slice(0, 40) || "Swarm";
      useAgentStore.getState().addGroup(group_id, agent_ids, "swarm", groupName);
      agent_ids.forEach((id, i) => {
        useAgentStore.getState().addAgent(id, swarmObjective.trim(), swarmModel, branches[i], group_id);
      });
    }

    reset();
    onOpenChange(false);
  }

  const teamLaunchDisabled = submitting || teamRoles.some((r) => !r.task.trim());
  const swarmLaunchDisabled = submitting || !swarmObjective.trim();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="border-[oklch(0.22_0.008_240)] bg-[oklch(0.112_0.004_245)] text-[oklch(0.90_0.015_220)] shadow-[0_28px_90px_oklch(0_0_0_/_0.32)] sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="text-[oklch(0.92_0.015_220)]">Launch Team</DialogTitle>
          <DialogDescription className="text-[oklch(0.56_0.014_225)]">
            Configure a role-based team or a parallel swarm.
          </DialogDescription>
        </DialogHeader>

        {/* Mode toggle */}
        <div className="flex w-fit gap-1 rounded-md border border-[oklch(0.24_0.010_235)] bg-[oklch(0.105_0.004_245)] p-1">
          <button
            type="button"
            aria-pressed={mode === "team"}
            className={`rounded-sm px-3 py-1 text-xs font-medium transition-colors ${
              mode === "team"
                ? "bg-[oklch(0.145_0.010_195)] text-[oklch(0.76_0.040_190)] shadow-[inset_0_0_0_1px_oklch(0.36_0.022_195)]"
                : "text-[oklch(0.56_0.014_225)] hover:text-[oklch(0.84_0.015_220)]"
            }`}
            onClick={() => setMode("team")}
          >
            Team
          </button>
          <button
            type="button"
            aria-pressed={mode === "swarm"}
            className={`rounded-sm px-3 py-1 text-xs font-medium transition-colors ${
              mode === "swarm"
                ? "bg-[oklch(0.145_0.010_195)] text-[oklch(0.76_0.040_190)] shadow-[inset_0_0_0_1px_oklch(0.36_0.022_195)]"
                : "text-[oklch(0.56_0.014_225)] hover:text-[oklch(0.84_0.015_220)]"
            }`}
            onClick={() => setMode("swarm")}
          >
            Swarm
          </button>
        </div>

        {/* Team form */}
        {mode === "team" && (
          <div className="flex flex-col gap-0 py-1 max-h-[60vh] overflow-y-auto">
            {ROLES.map((roleDef, i) => (
              <div key={roleDef.name} className="flex flex-col gap-2 border-b border-[oklch(0.22_0.008_240)] py-3 last:border-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[oklch(0.88_0.015_220)]">{roleDef.name}</span>
                  <Select
                    value={teamRoles[i].model}
                    onValueChange={(v) => updateRoleModel(i, v)}
                  >
                    <SelectTrigger className="w-44 h-7 border-[oklch(0.24_0.010_235)] bg-[oklch(0.13_0.004_245)] text-xs text-[oklch(0.84_0.012_220)]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-[oklch(0.24_0.010_235)] bg-[oklch(0.115_0.004_245)] text-[oklch(0.86_0.012_220)]">
                      {models.map((m) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <textarea
                  rows={2}
                  value={teamRoles[i].task}
                  onChange={(e) => updateRoleTask(i, e.target.value)}
                  placeholder={roleDef.placeholder}
                  className="w-full resize-none rounded-md border border-[oklch(0.24_0.010_235)] bg-[oklch(0.13_0.004_245)] px-3 py-2 text-sm text-[oklch(0.90_0.015_220)] placeholder:text-[oklch(0.42_0.012_235)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[oklch(0.52_0.030_195)]"
                />
              </div>
            ))}
          </div>
        )}

        {/* Swarm form */}
        {mode === "swarm" && (
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[oklch(0.56_0.014_225)]">Agent count</label>
              <input
                type="number"
                min="1"
                max="8"
                value={swarmCount}
                onChange={(e) => setSwarmCount(e.target.value)}
                placeholder="2"
                className="w-24 rounded-md border border-[oklch(0.24_0.010_235)] bg-[oklch(0.13_0.004_245)] px-3 py-2 text-sm text-[oklch(0.90_0.015_220)] placeholder:text-[oklch(0.42_0.012_235)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[oklch(0.52_0.030_195)]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[oklch(0.56_0.014_225)]">Shared objective</label>
              <textarea
                rows={4}
                value={swarmObjective}
                onChange={(e) => setSwarmObjective(e.target.value)}
                placeholder="e.g. Explore three different approaches to optimizing the query pipeline"
                className="resize-none rounded-md border border-[oklch(0.24_0.010_235)] bg-[oklch(0.13_0.004_245)] px-3 py-2 text-sm text-[oklch(0.90_0.015_220)] placeholder:text-[oklch(0.42_0.012_235)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[oklch(0.52_0.030_195)]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[oklch(0.56_0.014_225)]">Model (all agents)</label>
              <Select value={swarmModel} onValueChange={setSwarmModel}>
                <SelectTrigger className="border-[oklch(0.24_0.010_235)] bg-[oklch(0.13_0.004_245)] text-[oklch(0.84_0.012_220)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-[oklch(0.24_0.010_235)] bg-[oklch(0.115_0.004_245)] text-[oklch(0.86_0.012_220)]">
                  {models.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {error && (
          <p className="rounded-md border border-[oklch(0.38_0.040_28)] bg-[oklch(0.13_0.014_28)] px-3 py-2 text-xs text-[oklch(0.72_0.060_28)]" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" className="text-[oklch(0.58_0.012_230)] hover:text-[oklch(0.86_0.015_220)]" onClick={() => onOpenChange(false)}>
            Discard
          </Button>
          <Button
            className="bg-[oklch(0.46_0.040_190)] text-white hover:bg-[oklch(0.42_0.040_190)]"
            onClick={() => void handleLaunch()}
            disabled={mode === "team" ? teamLaunchDisabled : swarmLaunchDisabled}
          >
            {submitting ? "Launching..." : mode === "team" ? "Launch Team" : "Launch Swarm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
