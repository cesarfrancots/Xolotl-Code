import { describe, expect, it } from "vitest";
import { assessBlindReviewGate, assessGoalEvalReadiness } from "./evalReadiness";

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

  it("allows a comparison run while warning about non-blocking review settings", () => {
    const readiness = assessGoalEvalReadiness({
      goal: "Refactor the auth middleware without changing its public API",
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
