import { describe, expect, it } from "vitest";
import { assessGoalEvalReadiness } from "./evalReadiness";

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
