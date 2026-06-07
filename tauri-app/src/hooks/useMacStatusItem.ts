import { useEffect, useMemo } from "react";
import { commands, type AgentState, type MacStatusItemState, type Project } from "../bindings";
import { errorDetail, notifyMacAppStatus } from "../lib/macAppStatus";
import { useAgentStore, type AgentRecord } from "../stores/agentStore";
import { type ActiveEval, useEvalStore } from "../stores/evalStore";
import { projectDisplayName, useProjectStore } from "../stores/projectStore";
import { MAC_PRODUCTIVITY_SETTINGS_CHANGED_EVENT } from "./useMacGlobalHotkey";

const RUNNING_AGENT_STATES = new Set<AgentState>(["Planning", "Executing"]);

export interface MacStatusEvalSummary {
  running_eval_models: number;
  pending_eval_models: number;
  completed_eval_models: number;
  failed_eval_models: number;
  total_eval_models: number;
  active_eval_complete: boolean;
}

const IDLE_EVAL_SUMMARY: MacStatusEvalSummary = {
  running_eval_models: 0,
  pending_eval_models: 0,
  completed_eval_models: 0,
  failed_eval_models: 0,
  total_eval_models: 0,
  active_eval_complete: false,
};

export function buildMacStatusEvalSummary(activeEval: ActiveEval | null): MacStatusEvalSummary {
  if (!activeEval) return IDLE_EVAL_SUMMARY;

  const modelStates = Object.values(activeEval.modelStates);
  return {
    running_eval_models: modelStates.filter((model) => model.status === "running").length,
    pending_eval_models: modelStates.filter((model) => model.status === "pending").length,
    completed_eval_models: modelStates.filter((model) => model.status === "done").length,
    failed_eval_models: modelStates.filter((model) => model.status === "error").length,
    total_eval_models: activeEval.models.length,
    active_eval_complete: activeEval.complete,
  };
}

function macStatusEvalSummaryKey(summary: MacStatusEvalSummary): string {
  return [
    summary.running_eval_models,
    summary.pending_eval_models,
    summary.completed_eval_models,
    summary.failed_eval_models,
    summary.total_eval_models,
    summary.active_eval_complete ? 1 : 0,
  ].join("|");
}

function macStatusEvalSummaryFromKey(key: string): MacStatusEvalSummary {
  const [
    runningEvalModels = "0",
    pendingEvalModels = "0",
    completedEvalModels = "0",
    failedEvalModels = "0",
    totalEvalModels = "0",
    activeEvalComplete = "0",
  ] = key.split("|");
  return {
    running_eval_models: Number(runningEvalModels) || 0,
    pending_eval_models: Number(pendingEvalModels) || 0,
    completed_eval_models: Number(completedEvalModels) || 0,
    failed_eval_models: Number(failedEvalModels) || 0,
    total_eval_models: Number(totalEvalModels) || 0,
    active_eval_complete: activeEvalComplete === "1",
  };
}

export function buildMacStatusItemState({
  activeProjectPath,
  projects,
  agents,
  evalSummary = IDLE_EVAL_SUMMARY,
}: {
  activeProjectPath: string | null;
  projects: Project[];
  agents: AgentRecord[];
  evalSummary?: MacStatusEvalSummary;
}): MacStatusItemState {
  const activeProject = activeProjectPath
    ? projects.find((project) => project.path === activeProjectPath)
    : null;
  const runningAgents = agents.filter((agent) => RUNNING_AGENT_STATES.has(agent.state)).length;
  const waitingAgents = agents.filter((agent) => agent.state === "Waiting").length;
  const completedAgents = agents.filter((agent) => agent.state === "Done").length;
  const failedAgents = agents.filter((agent) => agent.state === "Failed").length;

  return {
    active_project_name: activeProject?.name ?? (activeProjectPath ? projectDisplayName(activeProjectPath) : null),
    active_project_path: activeProjectPath,
    running_agents: runningAgents,
    waiting_agents: waitingAgents,
    completed_agents: completedAgents,
    failed_agents: failedAgents,
    total_agents: agents.length,
    ...evalSummary,
  };
}

export function useMacStatusItem() {
  const agents = useAgentStore((state) => state.agents) ?? [];
  const activeProjectPath = useProjectStore((state) => state.activeProjectPath);
  const projects = useProjectStore((state) => state.projects);
  const evalSummaryKey = useEvalStore((state) => macStatusEvalSummaryKey(buildMacStatusEvalSummary(state.activeEval)));
  const evalSummary = useMemo(() => macStatusEvalSummaryFromKey(evalSummaryKey), [evalSummaryKey]);

  const statusState = useMemo(
    () => buildMacStatusItemState({ activeProjectPath, projects, agents, evalSummary }),
    [activeProjectPath, projects, agents, evalSummary],
  );

  useEffect(() => {
    let cancelled = false;

    const showUpdateFailure = (err: unknown) => {
      if (cancelled) return;
      console.warn("mac status item update failed:", err);
      notifyMacAppStatus({
        tone: "error",
        message: "Menu bar status item could not update.",
        hint: `Open Settings and turn the menu bar status item off and on again, or restart Xolotl Code. ${errorDetail(err)}`,
      });
    };

    const updateStatusItem = () => {
      void commands
        .updateMacStatusItem(statusState)
        .then((result) => {
          if (result.status === "error") showUpdateFailure(result.error);
        })
        .catch(showUpdateFailure);
    };

    updateStatusItem();
    window.addEventListener(MAC_PRODUCTIVITY_SETTINGS_CHANGED_EVENT, updateStatusItem);

    return () => {
      cancelled = true;
      window.removeEventListener(MAC_PRODUCTIVITY_SETTINGS_CHANGED_EVENT, updateStatusItem);
    };
  }, [statusState]);
}
