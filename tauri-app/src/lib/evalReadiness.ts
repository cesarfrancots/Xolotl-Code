export type GoalReadinessState = "ready" | "attention" | "blocked";

export interface GoalReadinessItem {
  id: "goal" | "models" | "blind" | "supervisor";
  label: string;
  detail: string;
  state: GoalReadinessState;
}

export interface GoalEvalReadiness {
  canRun: boolean;
  items: GoalReadinessItem[];
}

export function assessGoalEvalReadiness({
  goal,
  modelCount,
  blindMode,
  liveSupervisor,
}: {
  goal: string;
  modelCount: number;
  blindMode: boolean;
  liveSupervisor: boolean;
}): GoalEvalReadiness {
  const trimmedGoal = goal.trim();
  const hasGoal = trimmedGoal.length > 0;
  const goalIsSpecific = trimmedGoal.length >= 24;
  const hasComparison = modelCount >= 2;

  const items: GoalReadinessItem[] = [
    {
      id: "goal",
      label: "Goal",
      state: !hasGoal ? "blocked" : goalIsSpecific ? "ready" : "attention",
      detail: !hasGoal
        ? "Add the production goal to evaluate."
        : goalIsSpecific
          ? "Specific enough to compare outcomes."
          : "Short goals work, but more context improves scoring.",
    },
    {
      id: "models",
      label: "Models",
      state: hasComparison ? "ready" : "blocked",
      detail: hasComparison
        ? `${modelCount} models selected for comparison.`
        : "Select at least two models for a goal eval.",
    },
    {
      id: "blind",
      label: "Blind Review",
      state: blindMode ? "ready" : "attention",
      detail: blindMode
        ? "Model names stay hidden during review."
        : "Blind mode will be enabled when the run starts.",
    },
    {
      id: "supervisor",
      label: "Supervisor",
      state: liveSupervisor ? "ready" : "attention",
      detail: liveSupervisor
        ? "Reasoning drift checks are enabled."
        : "Post-run grading still works without live checks.",
    },
  ];

  return {
    canRun: hasGoal && hasComparison,
    items,
  };
}
