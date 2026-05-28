import { describe, expect, it } from "vitest";
import {
  assessBlindResultsGate,
  assessBlindReviewGate,
  assessGoalEvalReadiness,
  assessGoalWorkflowSteps,
  canShowHumanScoreAggregate,
  determineEvalReviewMode,
  evalReviewModeBadge,
  resolveVisibleEvalStage,
  shouldShowHumanReviewStage,
} from "./evalReadiness";

describe("assessGoalEvalReadiness", () => {
  it("blocks goal evals until a goal and at least two models are selected", () => {
    expect(assessGoalEvalReadiness({
      goal: "",
      modelCount: 2,
      blindMode: true,
      liveSupervisor: true,
    }).canRun).toBe(false);

    const singleModel = assessGoalEvalReadiness({
      goal: "Refactor the auth middleware without changing its public API",
      modelCount: 1,
      blindMode: true,
      liveSupervisor: true,
    });

    expect(singleModel.canRun).toBe(false);
    expect(singleModel.items.find((item) => item.id === "models")?.state).toBe("blocked");
  });

  it("blocks vague short goals before a model comparison can start", () => {
    const readiness = assessGoalEvalReadiness({
      goal: "Fix auth",
      modelCount: 2,
      blindMode: true,
      liveSupervisor: true,
    });

    expect(readiness.canRun).toBe(false);
    expect(readiness.items.find((item) => item.id === "goal")?.state).toBe("blocked");
  });

  it("requires a scoped target and success criteria before a goal eval can start", () => {
    const broad = assessGoalEvalReadiness({
      goal: "Improve reviewer confidence and ensure the results stay objective",
      modelCount: 2,
      blindMode: true,
      liveSupervisor: true,
    });

    expect(broad.canRun).toBe(false);
    expect(broad.items.find((item) => item.id === "scope")?.state).toBe("blocked");
    expect(broad.items.find((item) => item.id === "criteria")?.state).toBe("ready");
  });

  it("allows a comparison run while warning about non-blocking review settings", () => {
    const readiness = assessGoalEvalReadiness({
      goal: "Refactor src/auth/middleware.ts without changing its public API",
      modelCount: 3,
      blindMode: false,
      liveSupervisor: false,
    });

    expect(readiness.canRun).toBe(true);
    expect(readiness.items.find((item) => item.id === "blind")?.state).toBe("attention");
    expect(readiness.items.find((item) => item.id === "supervisor")?.state).toBe("attention");
  });
});

describe("assessBlindReviewGate", () => {
  it("routes objective suite evals directly to automatic review", () => {
    expect(determineEvalReviewMode({
      suiteId: "reasoning",
      prompt: "A bat and ball cost $1.10. How much does the ball cost?",
      isGoalEval: false,
    })).toBe("automatic");

    expect(determineEvalReviewMode({
      suiteId: null,
      prompt: "Create a single HTML file with an animation of a forest being painted",
      isGoalEval: false,
    })).toBe("human");

    expect(determineEvalReviewMode({
      suiteId: null,
      prompt: "Write a flash fiction story about debugging at 3am",
      isGoalEval: false,
    })).toBe("human");
  });

  it("keeps completed coding benchmarks out of the human scoring flow", () => {
    const reviewMode = determineEvalReviewMode({
      suiteId: "coding",
      prompt: "Write a Rust function `fn fib(n: u32) -> u64` using iteration (not recursion). Return 0 for n=0. Include a #[test] with cases for n=0, 1, 10, 50.",
      isGoalEval: false,
    });
    const visibleStage = resolveVisibleEvalStage({
      activeEvalComplete: true,
      evalStage: "review",
      reviewMode,
    });

    expect(reviewMode).toBe("automatic");
    expect(visibleStage).toBe("results");
    expect(shouldShowHumanReviewStage({
      activeEvalComplete: true,
      visibleEvalStage: visibleStage,
      reviewMode,
    })).toBe(false);
  });

  it("routes SWE-Pro style suites to automatic scoring and frontend design to human review", () => {
    expect(determineEvalReviewMode({
      suiteId: "swe-pro",
      prompt: "Patch this TypeScript TTL cache.",
      isGoalEval: false,
    })).toBe("automatic");

    expect(determineEvalReviewMode({
      suiteId: "frontend-design",
      prompt: "Create a single-file HTML/CSS/JS benchmark leaderboard.",
      isGoalEval: false,
    })).toBe("human");
  });

  it("labels history items by review mode before loading them", () => {
    expect(evalReviewModeBadge({ suiteId: "reasoning", prompt: "A bat and ball cost $1.10", isGoalEval: false })).toEqual({
      label: "Auto scored",
      detail: "Objective eval: opens directly to answers and AI/KPI ranking.",
      mode: "automatic",
    });

    expect(evalReviewModeBadge({ suiteId: null, prompt: "Create a single HTML game", isGoalEval: false })).toMatchObject({
      label: "Human review",
      mode: "human",
    });
  });

  it("locks machine review for blind goal evals until human scores are complete", () => {
    const gate = assessBlindReviewGate({
      isGoalEval: true,
      blindMode: true,
      reviewComplete: false,
      scoresDirty: false,
    });

    expect(gate.machineReviewLocked).toBe(true);
    expect(gate.reason).toBe("score");
  });

  it("keeps machine review available for automatic objective evals", () => {
    const gate = assessBlindReviewGate({
      isGoalEval: false,
      blindMode: true,
      reviewComplete: false,
      scoresDirty: false,
      reviewMode: "automatic",
    });

    expect(gate.machineReviewLocked).toBe(false);
    expect(gate.label).toBe("Automatic review");
  });

  it("keeps machine review locked until completed blind scores are saved", () => {
    const gate = assessBlindReviewGate({
      isGoalEval: true,
      blindMode: true,
      reviewComplete: true,
      scoresDirty: true,
    });

    expect(gate.machineReviewLocked).toBe(true);
    expect(gate.reason).toBe("save");
  });

  it("unlocks machine review after the blind goal review is saved", () => {
    const gate = assessBlindReviewGate({
      isGoalEval: true,
      blindMode: true,
      reviewComplete: true,
      scoresDirty: false,
    });

    expect(gate.machineReviewLocked).toBe(false);
    expect(gate.label).toBe("Blind review saved");
  });

  it("does not gate non-goal or unblinded evals", () => {
    expect(assessBlindReviewGate({
      isGoalEval: false,
      blindMode: true,
      reviewComplete: false,
      scoresDirty: true,
    }).machineReviewLocked).toBe(false);

    expect(assessBlindReviewGate({
      isGoalEval: true,
      blindMode: false,
      reviewComplete: false,
      scoresDirty: true,
    }).machineReviewLocked).toBe(false);
  });
});

describe("assessBlindResultsGate", () => {
  it("hides aggregate rankings until blind goal scores are complete", () => {
    const gate = assessBlindResultsGate({
      isGoalEval: true,
      blindMode: true,
      reviewComplete: false,
      scoresDirty: false,
    });

    expect(gate.resultsLocked).toBe(true);
    expect(gate.reason).toBe("score");
  });

  it("shows aggregate rankings immediately for automatic objective evals", () => {
    const gate = assessBlindResultsGate({
      isGoalEval: false,
      blindMode: true,
      reviewComplete: false,
      scoresDirty: false,
      reviewMode: "automatic",
    });

    expect(gate.resultsLocked).toBe(false);
    expect(gate.label).toBe("Automatic ranking");
  });

  it("keeps rankings hidden until completed blind scores are saved", () => {
    const gate = assessBlindResultsGate({
      isGoalEval: true,
      blindMode: true,
      reviewComplete: true,
      scoresDirty: true,
    });

    expect(gate.resultsLocked).toBe(true);
    expect(gate.reason).toBe("save");
  });

  it("shows rankings after saved blind review or outside blind goal mode", () => {
    expect(assessBlindResultsGate({
      isGoalEval: true,
      blindMode: true,
      reviewComplete: true,
      scoresDirty: false,
    }).resultsLocked).toBe(false);

    expect(assessBlindResultsGate({
      isGoalEval: false,
      blindMode: true,
      reviewComplete: false,
      scoresDirty: true,
    }).resultsLocked).toBe(false);
  });
});

describe("canShowHumanScoreAggregate", () => {
  it("hides human score aggregates while blind results are locked", () => {
    expect(canShowHumanScoreAggregate({ aggregate: 7.5, resultsLocked: true })).toBe(false);
  });

  it("shows human score aggregates only when present and unlocked", () => {
    expect(canShowHumanScoreAggregate({ aggregate: 0, resultsLocked: false })).toBe(false);
    expect(canShowHumanScoreAggregate({ aggregate: 7.5, resultsLocked: false })).toBe(true);
  });
});

describe("assessGoalWorkflowSteps", () => {
  it("starts on setup until the goal eval is runnable", () => {
    const steps = assessGoalWorkflowSteps({
      canRun: false,
      hasActiveEval: false,
      evalComplete: false,
      reviewComplete: false,
      scoresDirty: false,
      blindMode: true,
    });

    expect(steps.map((step) => [step.id, step.state])).toEqual([
      ["setup", "current"],
      ["run", "locked"],
      ["score", "locked"],
      ["save", "locked"],
      ["review", "locked"],
    ]);
  });

  it("moves to blind scoring after model outputs complete", () => {
    const steps = assessGoalWorkflowSteps({
      canRun: true,
      hasActiveEval: true,
      evalComplete: true,
      reviewComplete: false,
      scoresDirty: false,
      blindMode: true,
    });

    expect(steps.map((step) => [step.id, step.state])).toEqual([
      ["setup", "done"],
      ["run", "done"],
      ["score", "current"],
      ["save", "locked"],
      ["review", "locked"],
    ]);
  });

  it("skips human score and save steps for automatic objective evals", () => {
    const steps = assessGoalWorkflowSteps({
      canRun: true,
      hasActiveEval: true,
      evalComplete: true,
      reviewComplete: false,
      scoresDirty: false,
      blindMode: false,
      reviewMode: "automatic",
    });

    expect(steps.map((step) => [step.id, step.state])).toEqual([
      ["setup", "done"],
      ["run", "done"],
      ["score", "done"],
      ["save", "done"],
      ["review", "done"],
    ]);
  });

  it("requires saving completed blind scores before review tools unlock", () => {
    const steps = assessGoalWorkflowSteps({
      canRun: true,
      hasActiveEval: true,
      evalComplete: true,
      reviewComplete: true,
      scoresDirty: true,
      blindMode: true,
    });

    expect(steps.find((step) => step.id === "save")?.state).toBe("current");
    expect(steps.find((step) => step.id === "review")?.state).toBe("locked");
  });

  it("unlocks review after saved blind scores and marks it done after reveal", () => {
    const blindSteps = assessGoalWorkflowSteps({
      canRun: true,
      hasActiveEval: true,
      evalComplete: true,
      reviewComplete: true,
      scoresDirty: false,
      blindMode: true,
    });

    expect(blindSteps.find((step) => step.id === "review")?.state).toBe("current");

    const revealedSteps = assessGoalWorkflowSteps({
      canRun: true,
      hasActiveEval: true,
      evalComplete: true,
      reviewComplete: true,
      scoresDirty: false,
      blindMode: false,
    });

    expect(revealedSteps.find((step) => step.id === "review")?.state).toBe("done");
  });
});
