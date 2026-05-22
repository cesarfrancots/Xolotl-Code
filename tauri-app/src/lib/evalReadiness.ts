export type GoalReadinessState = "ready" | "attention" | "blocked";

export interface GoalReadinessItem {
  id: "goal" | "scope" | "criteria" | "models" | "blind" | "supervisor";
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

export interface BlindResultsGate {
  resultsLocked: boolean;
  reason: "score" | "save" | null;
  label: string;
  detail: string;
}

export type GoalWorkflowStepId = "setup" | "run" | "score" | "save" | "review";
export type GoalWorkflowStepState = "done" | "current" | "locked";

export interface GoalWorkflowStep {
  id: GoalWorkflowStepId;
  label: string;
  detail: string;
  state: GoalWorkflowStepState;
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
  const hasEnoughDetail = trimmedGoal.length >= 40;
  const hasScopedTarget = hasScopeSignal(trimmedGoal);
  const hasSuccessCriteria = hasCriteriaSignal(trimmedGoal);
  const hasComparison = modelCount >= 2;

  const items: GoalReadinessItem[] = [
    {
      id: "goal",
      label: "Goal",
      state: hasEnoughDetail ? "ready" : "blocked",
      detail: !hasGoal
        ? "Add the production goal to evaluate."
        : hasEnoughDetail
          ? "Goal has enough detail for comparison."
          : "Add context before comparing models.",
    },
    {
      id: "scope",
      label: "Scope",
      state: hasScopedTarget ? "ready" : "blocked",
      detail: hasScopedTarget
        ? "Target area is named."
        : "Name the file, feature, workflow, or component.",
    },
    {
      id: "criteria",
      label: "Criteria",
      state: hasSuccessCriteria ? "ready" : "blocked",
      detail: hasSuccessCriteria
        ? "Outcome or constraint is explicit."
        : "Add success criteria, constraints, or verification.",
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
    canRun: hasEnoughDetail && hasScopedTarget && hasSuccessCriteria && hasComparison,
    items,
  };
}

function hasScopeSignal(goal: string): boolean {
  return /(?:\b(?:src|app|lib|components?|modules?|views?|screen|workflow|feature|endpoint|command|panel|store|hook|dialog|page|route|api|ui|ux)\b|[\\/]|[A-Za-z0-9_-]+\.(?:ts|tsx|js|jsx|rs|py|json|md)\b)/i.test(goal);
}

function hasCriteriaSignal(goal: string): boolean {
  return /\b(?:acceptance|criteria|done|ensure|preserve|without|verify|test|pass|must|should|so that|when|success|constraint|regression|public api|expected)\b/i.test(goal);
}

export function assessGoalWorkflowSteps({
  canRun,
  hasActiveEval,
  evalComplete,
  reviewComplete,
  scoresDirty,
  blindMode,
}: {
  canRun: boolean;
  hasActiveEval: boolean;
  evalComplete: boolean;
  reviewComplete: boolean;
  scoresDirty: boolean;
  blindMode: boolean;
}): GoalWorkflowStep[] {
  const setupDone = hasActiveEval || canRun;
  const runDone = hasActiveEval && evalComplete;
  const runCurrent = (!hasActiveEval && canRun) || (hasActiveEval && !evalComplete);
  const scoreDone = runDone && reviewComplete;
  const saveDone = scoreDone && !scoresDirty;
  const reviewUnlocked = saveDone;

  return [
    {
      id: "setup",
      label: "Setup",
      detail: setupDone ? "Goal and comparison set." : "Add a goal and select models.",
      state: setupDone ? "done" : "current",
    },
    {
      id: "run",
      label: "Run",
      detail: runDone ? "Model outputs are ready." : runCurrent ? "Run the selected models." : "Setup is required first.",
      state: runDone ? "done" : runCurrent ? "current" : "locked",
    },
    {
      id: "score",
      label: "Blind score",
      detail: scoreDone ? "Human scoring is complete." : runDone ? "Score every model while names are hidden." : "Outputs are required first.",
      state: scoreDone ? "done" : runDone ? "current" : "locked",
    },
    {
      id: "save",
      label: "Save",
      detail: saveDone ? "Blind scores are saved." : scoreDone ? "Save the completed blind scores." : "Finish blind scoring first.",
      state: saveDone ? "done" : scoreDone ? "current" : "locked",
    },
    {
      id: "review",
      label: "Review",
      detail: reviewUnlocked
        ? blindMode
          ? "Reveal names or run machine review."
          : "Names are revealed; machine review can run."
        : "Save blind scores first.",
      state: reviewUnlocked ? blindMode ? "current" : "done" : "locked",
    },
  ];
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

export function assessBlindResultsGate({
  isGoalEval,
  blindMode,
  reviewComplete,
  scoresDirty,
}: {
  isGoalEval: boolean;
  blindMode: boolean;
  reviewComplete: boolean;
  scoresDirty: boolean;
}): BlindResultsGate {
  if (!isGoalEval || !blindMode) {
    return {
      resultsLocked: false,
      reason: null,
      label: "Ranking available",
      detail: "Leaderboard and aggregate comparisons can be shown.",
    };
  }

  if (!reviewComplete) {
    return {
      resultsLocked: true,
      reason: "score",
      label: "Ranking hidden",
      detail: "Complete blind scores before seeing aggregate rankings.",
    };
  }

  if (scoresDirty) {
    return {
      resultsLocked: true,
      reason: "save",
      label: "Save review first",
      detail: "Save completed blind scores before showing aggregate rankings.",
    };
  }

  return {
    resultsLocked: false,
    reason: null,
    label: "Ranking available",
    detail: "Blind review is saved; aggregate comparisons can be shown.",
  };
}
