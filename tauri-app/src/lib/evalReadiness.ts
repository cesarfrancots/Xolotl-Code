export type GoalReadinessState = "ready" | "attention" | "blocked";
export type EvalReviewMode = "human" | "automatic";
export type EvalFlowStage = "battle" | "review" | "results";

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

const AUTOMATIC_REVIEW_SUITES = new Set([
  "reasoning",
  "instruction",
  "json",
  "coding",
  "refusal",
]);

const VISUAL_REVIEW_PROMPT_RE = /\b(?:html|browser|visual|ui|ux|design|aesthetic|animation|animated|game|playable|canvas|svg|css|website|page|screen|mockup|prototype|layout|component)\b/i;
const OBJECTIVE_PROMPT_RE = /\b(?:how much|how many|are all|must some|must all|which switch|correct|incorrect|bug|fixed function|write a .*function|return only|output only|json|exactly|list \d+|prime numbers?|test cases?|no prose|one sentence each)\b/i;

export function determineEvalReviewMode({
  suiteId,
  prompt,
  isGoalEval,
}: {
  suiteId?: string | null;
  prompt: string;
  isGoalEval?: boolean;
}): EvalReviewMode {
  if (suiteId && AUTOMATIC_REVIEW_SUITES.has(suiteId)) return "automatic";
  if (!isGoalEval && OBJECTIVE_PROMPT_RE.test(prompt) && !VISUAL_REVIEW_PROMPT_RE.test(prompt)) return "automatic";
  return "human";
}

export function evalReviewModeBadge(input: {
  suiteId?: string | null;
  prompt: string;
  isGoalEval?: boolean;
}): {
  mode: EvalReviewMode;
  label: string;
  detail: string;
} {
  const mode = determineEvalReviewMode(input);
  return mode === "automatic"
    ? {
      mode,
      label: "Auto scored",
      detail: "Objective eval: opens directly to answers and AI/KPI ranking.",
    }
    : {
      mode,
      label: "Human review",
      detail: "Subjective or visual eval: opens to blind human scoring when scores are missing.",
    };
}

export function resolveVisibleEvalStage({
  activeEvalComplete,
  evalStage,
  reviewMode,
}: {
  activeEvalComplete: boolean;
  evalStage: EvalFlowStage;
  reviewMode: EvalReviewMode;
}): EvalFlowStage {
  return activeEvalComplete && reviewMode === "automatic" ? "results" : evalStage;
}

export function shouldShowHumanReviewStage({
  activeEvalComplete,
  visibleEvalStage,
  reviewMode,
}: {
  activeEvalComplete: boolean;
  visibleEvalStage: EvalFlowStage;
  reviewMode: EvalReviewMode;
}): boolean {
  return activeEvalComplete && visibleEvalStage === "review" && reviewMode === "human";
}

export function canShowHumanScoreAggregate({
  aggregate,
  resultsLocked,
}: {
  aggregate: number;
  resultsLocked: boolean;
}): boolean {
  return aggregate > 0 && !resultsLocked;
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
  reviewMode = "human",
}: {
  canRun: boolean;
  hasActiveEval: boolean;
  evalComplete: boolean;
  reviewComplete: boolean;
  scoresDirty: boolean;
  blindMode: boolean;
  reviewMode?: EvalReviewMode;
}): GoalWorkflowStep[] {
  const setupDone = hasActiveEval || canRun;
  const runDone = hasActiveEval && evalComplete;
  const runCurrent = (!hasActiveEval && canRun) || (hasActiveEval && !evalComplete);
  const automatic = reviewMode === "automatic";
  const scoreDone = runDone && (automatic || reviewComplete);
  const saveDone = scoreDone && !scoresDirty;
  const reviewUnlocked = automatic ? runDone : saveDone;

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
      label: automatic ? "Auto score" : "Blind score",
      detail: automatic
        ? runDone ? "AI/KPI scoring is available." : "Outputs are required first."
        : scoreDone ? "Human scoring is complete." : runDone ? "Score every model while names are hidden." : "Outputs are required first.",
      state: scoreDone ? "done" : runDone ? "current" : "locked",
    },
    {
      id: "save",
      label: "Save",
      detail: automatic
        ? runDone ? "No manual score save is required." : "Outputs are required first."
        : saveDone ? "Blind scores are saved." : scoreDone ? "Save the completed blind scores." : "Finish blind scoring first.",
      state: saveDone ? "done" : scoreDone ? "current" : "locked",
    },
    {
      id: "review",
      label: "Review",
      detail: automatic
        ? runDone ? "Review answers, correctness, and AI/KPI ranking." : "Run outputs first."
        : reviewUnlocked
        ? blindMode
          ? "Reveal names or run machine review."
          : "Names are revealed; machine review can run."
        : "Save blind scores first.",
      state: reviewUnlocked ? automatic ? "done" : blindMode ? "current" : "done" : "locked",
    },
  ];
}

export function assessBlindReviewGate({
  isGoalEval,
  blindMode,
  reviewComplete,
  scoresDirty,
  reviewMode = "human",
}: {
  isGoalEval: boolean;
  blindMode: boolean;
  reviewComplete: boolean;
  scoresDirty: boolean;
  reviewMode?: EvalReviewMode;
}): BlindReviewGate {
  if (reviewMode === "automatic") {
    return {
      machineReviewLocked: false,
      reason: null,
      label: "Automatic review",
      detail: "Objective evals use AI/KPI scoring and do not require manual blind scores.",
    };
  }

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
  reviewMode = "human",
}: {
  isGoalEval: boolean;
  blindMode: boolean;
  reviewComplete: boolean;
  scoresDirty: boolean;
  reviewMode?: EvalReviewMode;
}): BlindResultsGate {
  if (reviewMode === "automatic") {
    return {
      resultsLocked: false,
      reason: null,
      label: "Automatic ranking",
      detail: "Objective evals reveal answers, correctness signals, and AI/KPI scores immediately.",
    };
  }

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
