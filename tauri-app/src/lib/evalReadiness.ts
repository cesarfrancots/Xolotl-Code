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

export interface BlindReviewGate {
  machineReviewLocked: boolean;
  reason: "score" | "save" | null;
  label: string;
  detail: string;
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

export function assessBlindReviewGate({
  isGoalEval,
  blindMode,
  reviewComplete,
  scoresDirty,
}: {
  isGoalEval: boolean;
  blindMode: boolean;
  reviewComplete: boolean;
  scoresDirty: boolean;
}): BlindReviewGate {
  if (!isGoalEval || !blindMode) {
    return {
      machineReviewLocked: false,
      reason: null,
      label: "Machine review available",
      detail: "Judge and goal-grade passes can run.",
    };
  }

  if (!reviewComplete) {
    return {
      machineReviewLocked: true,
      reason: "score",
      label: "Human review first",
      detail: "Complete blind scores before judge or goal-grade passes.",
    };
  }

  if (scoresDirty) {
    return {
      machineReviewLocked: true,
      reason: "save",
      label: "Save review first",
      detail: "Save the completed blind scores before machine review.",
    };
  }

  return {
    machineReviewLocked: false,
    reason: null,
    label: "Blind review saved",
    detail: "Judge and goal-grade passes can run.",
  };
}
