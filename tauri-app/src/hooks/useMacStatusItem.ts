import { useEffect, useMemo } from "react";
import { commands, type AgentState, type MacStatusItemState, type Project } from "../bindings";
import { errorDetail, notifyMacAppStatus } from "../lib/macAppStatus";
import { useAgentStore, type AgentRecord } from "../stores/agentStore";
import { projectDisplayName, useProjectStore } from "../stores/projectStore";
import { MAC_PRODUCTIVITY_SETTINGS_CHANGED_EVENT } from "./useMacGlobalHotkey";

const RUNNING_AGENT_STATES = new Set<AgentState>(["Planning", "Executing"]);

export function buildMacStatusItemState({
  activeProjectPath,
  projects,
  agents,
}: {
  activeProjectPath: string | null;
  projects: Project[];
  agents: AgentRecord[];
}): MacStatusItemState {
  const activeProject = activeProjectPath
    ? projects.find((project) => project.path === activeProjectPath)
    : null;
  const runningAgents = agents.filter((agent) => RUNNING_AGENT_STATES.has(agent.state)).length;
  const waitingAgents = agents.filter((agent) => agent.state === "Waiting").length;

  return {
    active_project_name: activeProject?.name ?? (activeProjectPath ? projectDisplayName(activeProjectPath) : null),
    active_project_path: activeProjectPath,
    running_agents: runningAgents,
    waiting_agents: waitingAgents,
    total_agents: agents.length,
  };
}

export function useMacStatusItem() {
  const agents = useAgentStore((state) => state.agents) ?? [];
  const activeProjectPath = useProjectStore((state) => state.activeProjectPath);
  const projects = useProjectStore((state) => state.projects);

  const statusState = useMemo(
    () => buildMacStatusItemState({ activeProjectPath, projects, agents }),
    [activeProjectPath, projects, agents],
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
