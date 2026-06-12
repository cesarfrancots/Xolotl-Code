import { describe, expect, it, vi } from "vitest";

// Phaser needs a real canvas; jsdom has none. The view only needs the
// component to exist for these helper tests.
vi.mock("./PondCanvas", () => ({ PondCanvas: () => null }));

import { formatAmount, formatDuration, villageHasPendingWork } from "./PondView";
import { createVillage } from "../../lib/pond/village";

const T0 = 1_750_000_000_000;

describe("formatDuration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(45 * 60 * 1000)).toBe("45m");
    expect(formatDuration(2 * 3600 * 1000 + 5 * 60 * 1000)).toBe("2h 5m");
  });

  it("never goes negative", () => {
    expect(formatDuration(-5000)).toBe("0s");
  });
});

describe("formatAmount", () => {
  it("abbreviates large values", () => {
    expect(formatAmount(950)).toBe("950");
    expect(formatAmount(12_500)).toBe("13k");
    expect(formatAmount(1_400_000)).toBe("1.4M");
  });
});

describe("villageHasPendingWork", () => {
  it("is true for a fresh village (collectors keep producing)", () => {
    expect(villageHasPendingWork(createVillage("P", T0))).toBe(true);
  });

  it("is false without collectors, jobs or training", () => {
    const village = createVillage("P", T0);
    village.buildings = village.buildings.filter(
      (b) => b.kind !== "kelpFarm" && b.kind !== "shardMine",
    );
    expect(villageHasPendingWork(village)).toBe(false);
  });
});
