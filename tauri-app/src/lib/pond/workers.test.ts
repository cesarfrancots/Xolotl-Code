import { describe, expect, it } from "vitest";
import {
  BUILDINGS,
  MAX_WORKER_LEVEL,
  TROOPS,
  WORKER_NAMES,
  workerSpeedMultiplier,
  workerUpgradeCost,
} from "./config";
import { createBattle, deployTroop, stepBattle } from "./battle";
import { migrateVillage } from "./save";
import type { BattleBuilding, VillageState } from "./types";
import {
  builderCount,
  busyWorkerIds,
  clearObstacle,
  createVillage,
  ensureWorkers,
  idleWorker,
  placeBuilding,
  settleVillage,
  upgradeBuilding,
  upgradeWorker,
} from "./village";

const T0 = 1_750_000_000_000;

function rich(village: VillageState): VillageState {
  return { ...village, resources: { kelp: 50_000, shards: 50_000 }, pearls: 2000 };
}

describe("tadpole workers", () => {
  it("the starter workshop comes with a named level-1 tadpole", () => {
    const village = createVillage("P", T0);
    const workshop = village.buildings.find((b) => b.kind === "workshop");
    expect(workshop?.worker).toEqual({ name: WORKER_NAMES[0], level: 1 });
    expect(builderCount(village)).toBe(1);
    expect(idleWorker(village)?.id).toBe(workshop?.id);
  });

  it("jobs are stamped with the worker and make the tadpole busy", () => {
    const village = rich(createVillage("P", T0));
    const placed = placeBuilding(village, "hatchery", 1, 1, T0);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const workshop = placed.village.buildings.find((b) => b.kind === "workshop")!;
    const hatchery = placed.village.buildings.find((b) => b.kind === "hatchery")!;
    expect(hatchery.job?.workerId).toBe(workshop.id);
    expect(busyWorkerIds(placed.village).has(workshop.id)).toBe(true);
    expect(idleWorker(placed.village)).toBeNull();
    // No free crew → a second project is rejected.
    const second = placeBuilding(placed.village, "armyCamp", 8, 1, T0);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/tadpole/i);
  });

  it("higher-level tadpoles build faster", () => {
    const village = rich(createVillage("P", T0));
    const workshop = village.buildings.find((b) => b.kind === "workshop")!;
    workshop.worker = { name: "Squirt", level: 5 };
    const placed = placeBuilding(village, "hatchery", 1, 1, T0);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const job = placed.village.buildings.find((b) => b.kind === "hatchery")!.job!;
    const base = BUILDINGS.hatchery.levels[0].buildTimeMs;
    expect(job.finishesAt - T0).toBe(Math.round(base / workerSpeedMultiplier(5)));
    expect(job.finishesAt - T0).toBeLessThan(base);
  });

  it("a new workshop hatches its own tadpole when construction finishes", () => {
    // TH2 allows a second workshop.
    let village = rich(createVillage("P", T0));
    village = {
      ...village,
      buildings: village.buildings.map((b) =>
        b.kind === "pondheart" ? { ...b, level: 2 } : b,
      ),
    };
    const placed = placeBuilding(village, "workshop", 1, 1, T0);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    village = placed.village;
    const fresh = village.buildings.filter((b) => b.kind === "workshop").find((b) => b.level === 0)!;
    expect(fresh.worker).toBeUndefined();
    const done = settleVillage(village, fresh.job!.finishesAt + 1);
    const manned = done.buildings.find((b) => b.id === fresh.id)!;
    expect(manned.worker?.level).toBe(1);
    expect(manned.worker?.name).toBeTruthy();
    expect(builderCount(done)).toBe(2);
  });

  it("upgradeWorker charges shards and caps at the max level", () => {
    let village = rich(createVillage("P", T0));
    const workshop = village.buildings.find((b) => b.kind === "workshop")!;
    for (let level = 1; level < MAX_WORKER_LEVEL; level += 1) {
      const result = upgradeWorker(village, workshop.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const before = village.resources.shards;
      expect(result.village.resources.shards).toBe(before - workerUpgradeCost(level));
      village = result.village;
    }
    expect(village.buildings.find((b) => b.id === workshop.id)?.worker?.level).toBe(MAX_WORKER_LEVEL);
    expect(upgradeWorker(village, workshop.id).ok).toBe(false);
  });

  it("obstacle clearing occupies the tadpole and tracks who is working", () => {
    const village = rich(createVillage("P", T0));
    const obstacle = village.obstacles[0];
    const started = clearObstacle(village, obstacle.id, T0);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const workshop = started.village.buildings.find((b) => b.kind === "workshop")!;
    expect(started.village.obstacles.find((o) => o.id === obstacle.id)?.clearingWorkerId).toBe(
      workshop.id,
    );
    expect(upgradeBuilding(started.village, workshop.id, T0).ok).toBe(false); // crew busy
  });

  it("migration mans existing workshops with tadpoles", () => {
    const village = createVillage("P", T0);
    for (const building of village.buildings) {
      if (building.kind === "workshop") delete building.worker;
    }
    const migrated = migrateVillage(village, T0);
    const workshop = migrated.buildings.find((b) => b.kind === "workshop");
    expect(workshop?.worker?.level).toBe(1);
    expect(ensureWorkers(migrated)).toEqual(migrated);
  });
});

describe("new troops", () => {
  function field(buildings: BattleBuilding[], army: Record<string, number>) {
    return createBattle({
      enemyName: "X",
      enemyTownHallLevel: 3,
      buildings,
      army: army as never,
      trophyReward: 1,
      trophyRisk: 1,
    });
  }

  function building(kind: BattleBuilding["kind"], x: number, y: number, level = 1): BattleBuilding {
    const hp = BUILDINGS[kind].levels[level - 1].hp;
    return {
      id: `b-${kind}-${x}`,
      kind,
      level,
      x,
      y,
      hp,
      maxHp: hp,
      loot: { kelp: 0, shards: 0 },
      destroyed: false,
      cooldownMs: 0,
    };
  }

  it("boomtail beelines to a wall, blasts it open and dies doing it", () => {
    const farm = building("kelpFarm", 26, 16);
    const wall = building("wall", 16, 16, 2); // 900 hp — far beyond one wildling hit
    const state = field([farm, wall], { boomtail: 1 });
    deployTroop(state, "boomtail", 4, 16.5);
    stepBattle(state, 100);
    expect(state.troops[0].targetId).toBe(wall.id);
    let elapsed = 0;
    while (!state.troops[0].dead && elapsed < 30_000) {
      stepBattle(state, 100);
      elapsed += 100;
    }
    expect(wall.destroyed).toBe(true); // 30 dps × 40 wall multiplier one-shots it
    expect(state.troops[0].dead).toBe(true);
    expect(farm.destroyed).toBe(false); // it never went for the farm
  });

  it("boomtail falls back to ordinary buildings when no walls remain", () => {
    const farm = building("kelpFarm", 20, 16);
    const state = field([farm], { boomtail: 1 });
    deployTroop(state, "boomtail", 16, 17);
    stepBattle(state, 100);
    expect(state.troops[0].targetId).toBe(farm.id);
  });

  it("riptide outranges a bubble geyser and snipes it safely", () => {
    const geyser = building("bubbleGeyser", 16, 16, 1);
    const state = field([geyser], { riptide: 1 });
    // Geyser range 4.5; riptide range 5.5 — park just outside retaliation.
    deployTroop(state, "riptide", 16 + 1.5, 16 + 1.5 + 4.5 + 5.4);
    let elapsed = 0;
    while (!geyser.destroyed && elapsed < 60_000) {
      stepBattle(state, 100);
      elapsed += 100;
    }
    expect(geyser.destroyed).toBe(true);
    expect(state.troops[0].hp).toBe(state.troops[0].maxHp);
  });

  it("nine trainable troops plus the hero", () => {
    expect(Object.keys(TROOPS)).toHaveLength(10);
    expect(TROOPS.boomtail.unlockLevel).toBeLessThanOrEqual(6);
    expect(TROOPS.riptide.unlockLevel).toBeLessThanOrEqual(6);
    // The Sovereign is never trainable through the hatchery.
    expect(TROOPS.sovereign.unlockLevel).toBeGreaterThan(6);
  });
});
