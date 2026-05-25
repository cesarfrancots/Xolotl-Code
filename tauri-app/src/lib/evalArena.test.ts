import { describe, expect, it } from "vitest";
import { arenaCreatureClass, arenaCreatureStatusLabel } from "./evalArena";

describe("eval arena creatures", () => {
  it("maps model stream states to visible axolotl states", () => {
    expect(arenaCreatureClass("pending")).toContain("eval-creature-pending");
    expect(arenaCreatureClass("running")).toContain("eval-creature-active");
    expect(arenaCreatureClass("done")).toContain("eval-creature-done");
    expect(arenaCreatureClass("error")).toContain("eval-creature-failed");
  });

  it("uses short status labels for the arena strip", () => {
    expect(arenaCreatureStatusLabel("pending")).toBe("queued");
    expect(arenaCreatureStatusLabel("running")).toBe("working");
    expect(arenaCreatureStatusLabel("done")).toBe("finished");
    expect(arenaCreatureStatusLabel("error")).toBe("stopped");
  });
});
