import { describe, expect, it } from "vitest";
import { BUILDINGS, TROOPS, maxBuildingLevel } from "./config";
import type { VillageState } from "./types";
import {
  armyHousingCapacity,
  armyHousingUsed,
  builderCount,
  buildingCost,
  cancelTraining,
  collectFrom,
  createVillage,
  footprintFree,
  moveBuilding,
  pendingProduction,
  placeBuilding,
  recordRaid,
  settleVillage,
  storageCapacity,
  townHallLevel,
  trainTroop,
  upgradeBuilding,
} from "./village";

const T0 = 1_750_000_000_000;

function freshVillage(): VillageState {
  return createVillage("Test Pond", T0);
}

function expectOk<T extends { ok: boolean }>(result: T): asserts result is T & { ok: true } {
  if (!result.ok) throw new Error(`expected ok, got: ${JSON.stringify(result)}`);
}

describe("village creation", () => {
  it("starts with a Pondheart, collectors, storages and one workshop", () => {
    const village = freshVillage();
    const kinds = village.buildings.map((b) => b.kind).sort();
    expect(kinds).toEqual(
      ["kelpFarm", "kelpVat", "pondheart", "shardMine", "shardVault", "workshop"].sort(),
    );
    expect(townHallLevel(village)).toBe(1);
    expect(builderCount(village)).toBe(1);
    expect(village.resources.kelp).toBeGreaterThan(0);
  });

  it("does not overlap any starter buildings", () => {
    const village = freshVillage();
    for (const building of village.buildings) {
      const others = { ...village, buildings: village.buildings.filter((b) => b.id !== building.id) };
      expect(
        footprintFree(others, building.x, building.y, BUILDINGS[building.kind].size),
      ).toBe(true);
    }
  });
});

describe("economy", () => {
  it("accrues collector production over time and caps at the buffer", () => {
    const village = freshVillage();
    const farm = village.buildings.find((b) => b.kind === "kelpFarm");
    if (!farm) throw new Error("no farm");
    const rate = BUILDINGS.kelpFarm.levels[0].ratePerHour ?? 0;
    expect(pendingProduction(farm, T0)).toBe(0);
    expect(pendingProduction(farm, T0 + 3_600_000)).toBe(rate);
    // 100 hours away still only yields the 4-hour buffer.
    expect(pendingProduction(farm, T0 + 100 * 3_600_000)).toBe(rate * 4);
  });

  it("collects into storage and respects capacity", () => {
    const village = freshVillage();
    const farm = village.buildings.find((b) => b.kind === "kelpFarm");
    if (!farm) throw new Error("no farm");
    const later = T0 + 2 * 3_600_000;
    const result = collectFrom(village, farm.id, later);
    expectOk(result);
    const rate = BUILDINGS.kelpFarm.levels[0].ratePerHour ?? 0;
    expect(result.village.resources.kelp).toBe(
      Math.min(storageCapacity(village, "kelp"), village.resources.kelp + rate * 2),
    );
    const collected = result.village.buildings.find((b) => b.id === farm.id);
    expect(collected?.collectedAt).toBe(later);
    expect(pendingProduction(collected as never, later)).toBe(0);
  });

  it("counts Pondheart capacity for both resources", () => {
    const village = freshVillage();
    const vatCapacity = BUILDINGS.kelpVat.levels[0].capacity ?? 0;
    const heartCapacity = BUILDINGS.pondheart.levels[0].capacity ?? 0;
    expect(storageCapacity(village, "kelp")).toBe(vatCapacity + heartCapacity);
  });
});

describe("construction", () => {
  it("places a building, spends resources and occupies a builder", () => {
    let village = freshVillage();
    village = { ...village, resources: { kelp: 5000, shards: 5000 } };
    const result = placeBuilding(village, "kelpFarm", 1, 1, T0);
    // TH1 allows only one farm, so this must fail first…
    expect(result.ok).toBe(false);

    // …but a hatchery is allowed.
    const hatched = placeBuilding(village, "hatchery", 1, 1, T0);
    expectOk(hatched);
    const hatchery = hatched.village.buildings.find((b) => b.kind === "hatchery");
    expect(hatchery?.level).toBe(0);
    expect(hatchery?.job?.toLevel).toBe(1);
    expect(hatched.village.resources.kelp).toBe(5000 - buildingCost(village, "hatchery", 1));

    // The single starter builder is now busy.
    const second = placeBuilding(hatched.village, "armyCamp", 8, 1, T0);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/busy/i);
  });

  it("finishes jobs when settled past their finish time", () => {
    let village = freshVillage();
    village = { ...village, resources: { kelp: 5000, shards: 5000 } };
    const placed = placeBuilding(village, "hatchery", 1, 1, T0);
    expectOk(placed);
    const finishesAt = placed.village.buildings.find((b) => b.kind === "hatchery")?.job?.finishesAt ?? 0;
    const settled = settleVillage(placed.village, finishesAt + 1);
    const hatchery = settled.buildings.find((b) => b.kind === "hatchery");
    expect(hatchery?.level).toBe(1);
    expect(hatchery?.job).toBeNull();
  });

  it("blocks overlapping placements and out-of-bounds moves", () => {
    const village = freshVillage();
    const heart = village.buildings.find((b) => b.kind === "pondheart");
    if (!heart) throw new Error("no pondheart");
    expect(placeBuilding(village, "wall", heart.x, heart.y, T0).ok).toBe(false);
    expect(moveBuilding(village, heart.id, -2, 0).ok).toBe(false);
    const moved = moveBuilding(village, heart.id, 0, 0);
    expectOk(moved);
    expect(moved.village.buildings.find((b) => b.id === heart.id)?.x).toBe(0);
  });

  it("gates upgrades on the Pondheart level", () => {
    let village = freshVillage();
    village = { ...village, resources: { kelp: 999_999, shards: 999_999 } };
    const farm = village.buildings.find((b) => b.kind === "kelpFarm");
    if (!farm) throw new Error("no farm");
    expect(maxBuildingLevel("kelpFarm", 1)).toBe(1);
    const blocked = upgradeBuilding(village, farm.id, T0);
    expect(blocked.ok).toBe(false);

    // Upgrade the Pondheart, then the farm upgrade unlocks.
    const heart = village.buildings.find((b) => b.kind === "pondheart");
    if (!heart) throw new Error("no pondheart");
    const heartUp = upgradeBuilding(village, heart.id, T0);
    expectOk(heartUp);
    const settled = settleVillage(heartUp.village, T0 + 10 * 24 * 3_600_000);
    expect(townHallLevel(settled)).toBe(2);
    const farmUp = upgradeBuilding(settled, farm.id, T0);
    expectOk(farmUp);
  });

  it("builds walls instantly without a builder", () => {
    let village = freshVillage();
    village = { ...village, resources: { kelp: 5000, shards: 5000 } };
    // Occupy the only builder first.
    const placed = placeBuilding(village, "hatchery", 1, 1, T0);
    expectOk(placed);
    // Walls need TH2; force it.
    const th2 = {
      ...placed.village,
      buildings: placed.village.buildings.map((b) =>
        b.kind === "pondheart" ? { ...b, level: 2 } : b,
      ),
    };
    const wall = placeBuilding(th2, "wall", 30, 30, T0);
    expectOk(wall);
    expect(wall.village.buildings.find((b) => b.kind === "wall")?.level).toBe(1);
  });
});

describe("training", () => {
  function villageWithArmyBuildings(): VillageState {
    const village = freshVillage();
    return {
      ...village,
      resources: { kelp: 999_999, shards: 999_999 },
      buildings: [
        ...village.buildings.map((b) => (b.kind === "pondheart" ? { ...b, level: 3 } : b)),
        { id: "hatch", kind: "hatchery", level: 3, x: 1, y: 1, job: null },
        { id: "camp", kind: "armyCamp", level: 1, x: 1, y: 8, job: null },
      ],
    };
  }

  it("queues troops sequentially and moves them into the army when done", () => {
    const village = villageWithArmyBuildings();
    const first = trainTroop(village, "wildling", T0);
    expectOk(first);
    const second = trainTroop(first.village, "finling", T0);
    expectOk(second);
    const [a, b] = second.village.trainQueue;
    expect(a.finishesAt).toBe(T0 + TROOPS.wildling.trainTimeMs);
    expect(b.finishesAt).toBe(a.finishesAt + TROOPS.finling.trainTimeMs);

    const midway = settleVillage(second.village, a.finishesAt + 1);
    expect(midway.army.wildling).toBe(1);
    expect(midway.trainQueue).toHaveLength(1);

    const done = settleVillage(second.village, b.finishesAt + 1);
    expect(done.army.finling).toBe(1);
    expect(done.trainQueue).toHaveLength(0);
  });

  it("enforces hatchery unlock levels and camp housing", () => {
    const village = villageWithArmyBuildings();
    expect(trainTroop(village, "tidelord", T0).ok).toBe(false);

    // Fill the camp to capacity with wildlings.
    let current = village;
    const capacity = armyHousingCapacity(village);
    for (let i = 0; i < capacity; i += 1) {
      const result = trainTroop(current, "wildling", T0);
      if (!result.ok) break;
      current = result.village;
    }
    expect(armyHousingUsed(current)).toBeLessThanOrEqual(capacity);
    expect(trainTroop(current, "wildling", T0).ok).toBe(false);
  });

  it("refunds and re-chains the queue when a job is cancelled", () => {
    // Keep kelp below storage capacity so the refund is not clamped.
    const village = { ...villageWithArmyBuildings(), resources: { kelp: 2000, shards: 2000 } };
    let current = village;
    for (const troop of ["wildling", "finling", "pilfer"] as const) {
      const result = trainTroop(current, troop, T0);
      expectOk(result);
      current = result.village;
    }
    const kelpBefore = current.resources.kelp;
    const cancelled = cancelTraining(current, 1, T0 + 1000);
    expectOk(cancelled);
    expect(cancelled.village.resources.kelp).toBe(kelpBefore + TROOPS.finling.cost);
    expect(cancelled.village.trainQueue.map((j) => j.troop)).toEqual(["wildling", "pilfer"]);
    const [head, tail] = cancelled.village.trainQueue;
    // Head keeps its schedule; the pilfer re-chains directly after it.
    expect(head.finishesAt).toBe(T0 + TROOPS.wildling.trainTimeMs);
    expect(tail.finishesAt).toBe(head.finishesAt + TROOPS.pilfer.trainTimeMs);
  });
});

describe("raids on the player", () => {
  it("applies losses, trophies and a shield", () => {
    const village = freshVillage();
    const raided = recordRaid(village, {
      id: "raid-1",
      at: T0 + 1000,
      attackerName: "Mudwhisker Cove",
      lostKelp: 100,
      lostShards: 50,
      trophyDelta: -12,
      defended: false,
    });
    expect(raided.resources.kelp).toBe(village.resources.kelp - 100);
    expect(raided.resources.shards).toBe(village.resources.shards - 50);
    expect(raided.trophies).toBe(0); // clamped at zero
    expect(raided.shieldUntil).toBe(T0 + 1000 + 12 * 3600 * 1000);
    expect(raided.raidLog).toHaveLength(1);
  });
});
