import { describe, it, expect } from "vitest";
import { calcTurnCost, formatCost, formatTokens } from "./cost";
import type { TokenUsage } from "../bindings";

describe("formatCost", () => {
  it("formats zero correctly", () => {
    expect(formatCost(0)).toBe("$0.0000");
  });

  it("formats small cost to 4 decimal places", () => {
    expect(formatCost(0.001234)).toBe("$0.0012");
  });

  it("formats large cost", () => {
    expect(formatCost(1.5)).toBe("$1.5000");
  });
});

describe("formatTokens", () => {
  it("formats with comma for 1000+", () => {
    expect(formatTokens(1240)).toBe("1,240 tok");
  });

  it("formats without comma below 1000", () => {
    expect(formatTokens(999)).toBe("999 tok");
  });
});

describe("calcTurnCost", () => {
  it("returns a positive number for non-zero usage", () => {
    const usage: TokenUsage = {
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
    expect(calcTurnCost(usage, "claude-sonnet-4-5")).toBeGreaterThan(0);
  });

  it("returns 0 for zero usage", () => {
    const usage: TokenUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
    expect(calcTurnCost(usage, "claude-sonnet-4-5")).toBe(0);
  });
});
