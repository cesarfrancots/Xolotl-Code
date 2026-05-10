import { describe, it, expect } from "vitest";
import { computeLineDiff } from "./diff";

describe("computeLineDiff", () => {
  it("detects added and removed lines", () => {
    const changes = computeLineDiff("a\nb\nc", "a\nd\nc");
    const added = changes.filter((c) => c.added);
    const removed = changes.filter((c) => c.removed);
    expect(added.length).toBeGreaterThan(0);
    expect(removed.length).toBeGreaterThan(0);
    expect(added[0].value).toContain("d");
    expect(removed[0].value).toContain("b");
  });

  it("returns empty array for empty inputs", () => {
    expect(computeLineDiff("", "")).toHaveLength(0);
  });

  it("returns unchanged part when inputs are identical", () => {
    const changes = computeLineDiff("x", "x");
    expect(changes.every((c) => !c.added && !c.removed)).toBe(true);
  });
});
