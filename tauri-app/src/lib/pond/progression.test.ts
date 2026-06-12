import { describe, expect, it } from "vitest";
import {
  MAX_OBSTACLES,
  OBSTACLES,
  OBSTACLE_SPAWN_INTERVAL_MS,
  STARTING_PEARLS,
  TROOPS,
  battlePearls,
  finishNowCost,
  researchCost,
  troopLevelCap,
  troopStatMultiplier,
} from "./config";
import { createBattle, deployTroop, stepBattle } from "./battle";
import { migrateVillage } from "./save";
import type { BattleBuilding, VillageState } from "./types";
import {
  busyBuilders,
  clearObstacle,
  createVillage,
  finishNow,
  footprintFree,
  placeBuilding,
  settleVillage,
  startResearch,
  troopLevel,
} from "./village";

const T0 = 1_750_000_000_000;

function withLab(level = 1): VillageState {
  const village = createVillage("P", T0);
  return {
    ...village,
    resources: { kelp: 50_000, shards: 50_000 },
    buildings: [
      ...village.buildings.map((b) => (b.kind === "pondheart" ? { ...b, level: 4 } : b)),
      { id: "lab", kind: "lab", level, x: 1, y: 1, job: null },
      { id: "hatch", kind: "hatchery", level: 4, x: 1, y: 30, job: null },
    ],
    // High caps so kelp costs are not clamped in assertions.
    obstacles: [],
  };
}

describe("research", () => {
  it("requires a lab and respects the level cap", () => {
    const noLab = createVillage("P", T0);
    expect(startResearch(noLab, "wildling", T0).ok).toBe(false);

    const village = withLab(1); // cap = 2
    const first = startResearch(village, "wildling", T0);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.village.researchJob?.toLevel).toBe(2);
    expect(first.village.resources.kelp).toBe(50_000 - researchCost("wildling", 2));

    // Only one research at a time.
    expect(startResearch(first.village, "finling", T0).ok).toBe(false);

    // Completion applies the level.
    const done = settleVillage(first.village, first.village.researchJob!.finishesAt + 1);
    expect(troopLevel(done, "wildling")).toBe(2);
    expect(done.researchJob).toBeNull();

    // Cap reached: lab 1 cannot research to level 3.
    expect(troopLevelCap(1)).toBe(2);
    const blocked = startResearch(done, "wildling", T0);
    expect(blocked.ok).toBe(false);
  });

  it("blocks researching troops the hatchery has not unlocked", () => {
    const village = withLab(5);
    expect(TROOPS.tidelord.unlockLevel).toBeGreaterThan(4);
    expect(startResearch(village, "tidelord", T0).ok).toBe(false);
  });

  it("scales battle stats with troop level", () => {
    const farm: BattleBuilding = {
      id: "f",
      kind: "kelpFarm",
      level: 1,
      x: 16,
      y: 16,
      hp: 220,
      maxHp: 220,
      loot: { kelp: 0, shards: 0 },
      destroyed: false,
      cooldownMs: 0,
    };
    const battle = createBattle({
      enemyName: "X",
      enemyTownHallLevel: 1,
      buildings: [farm],
      army: { wildling: 1 },
      troopLevels: { wildling: 3 },
      trophyReward: 1,
      trophyRisk: 1,
    });
    deployTroop(battle, "wildling", 2, 2);
    const troop = battle.troops[0];
    expect(troop.level).toBe(3);
    expect(troop.maxHp).toBe(Math.round(TROOPS.wildling.hp * troopStatMultiplier(3)));
    // First swing carries the level multiplier too.
    stepBattle(battle, 100);
    while (!battle.ended && farm.hp === farm.maxHp) stepBattle(battle, 100);
    const expectedDamage = TROOPS.wildling.dps * troopStatMultiplier(3);
    expect(farm.maxHp - farm.hp).toBeCloseTo(expectedDamage, 5);
  });
});

describe("pearls", () => {
  it("prices instant-finish by remaining time", () => {
    expect(finishNowCost(1)).toBe(1);
    expect(finishNowCost(3 * 60 * 1000)).toBe(1);
    expect(finishNowCost(30 * 60 * 1000)).toBe(10);
  });

  it("awards battle pearls per star with a 3-star bonus", () => {
    expect(battlePearls(0)).toBe(0);
    expect(battlePearls(1)).toBe(1);
    expect(battlePearls(2)).toBe(2);
    expect(battlePearls(3)).toBe(6);
  });

  it("finishNow completes a building job and charges pearls", () => {
    let village = { ...createVillage("P", T0), resources: { kelp: 5000, shards: 5000 } };
    const placed = placeBuilding(village, "hatchery", 1, 1, T0);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    village = placed.village;
    const hatchery = village.buildings.find((b) => b.kind === "hatchery")!;
    const cost = finishNowCost(hatchery.job!.finishesAt - T0);
    const finished = finishNow(village, { type: "building", id: hatchery.id }, T0);
    expect(finished.ok).toBe(true);
    if (!finished.ok) return;
    expect(finished.village.pearls).toBe(STARTING_PEARLS - cost);
    const done = finished.village.buildings.find((b) => b.kind === "hatchery")!;
    expect(done.level).toBe(1);
    expect(done.job).toBeNull();
  });

  it("finishNow fails without enough pearls", () => {
    const village = { ...withLab(3), pearls: 0 };
    const started = startResearch(village, "wildling", T0);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(finishNow(started.village, { type: "research" }, T0).ok).toBe(false);
  });
});

describe("obstacles", () => {
  it("starter obstacles block placement", () => {
    const village = createVillage("P", T0);
    const obstacle = village.obstacles[0];
    expect(footprintFree(village, obstacle.x, obstacle.y, 3)).toBe(false);
  });

  it("clearing uses a builder, costs kelp and pays out on settle", () => {
    const village = { ...createVillage("P", T0), resources: { kelp: 1000, shards: 1000 } };
    const obstacle = village.obstacles[0];
    const config = OBSTACLES[obstacle.kind];
    const started = clearObstacle(village, obstacle.id, T0);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.village.resources.kelp).toBe(1000 - config.clearCost);
    expect(busyBuilders(started.village)).toBe(1);

    // The busy builder blocks construction.
    const build = placeBuilding(started.village, "hatchery", 1, 1, T0);
    expect(build.ok).toBe(false);

    const done = settleVillage(started.village, T0 + config.clearTimeMs + 1);
    expect(done.obstacles.find((o) => o.id === obstacle.id)).toBeUndefined();
    expect(done.pearls).toBe(STARTING_PEARLS + config.rewardPearls);
    expect(done.resources.kelp).toBe(1000 - config.clearCost + config.rewardKelp);
  });

  it("spawns over time up to the cap, deterministically", () => {
    const village = { ...createVillage("P", T0), obstacles: [] };
    const later = T0 + 3 * OBSTACLE_SPAWN_INTERVAL_MS + 1;
    const a = settleVillage(village, later);
    const b = settleVillage(village, later);
    expect(a.obstacles).toEqual(b.obstacles);
    expect(a.obstacles.length).toBe(3);

    const far = settleVillage(village, T0 + 100 * OBSTACLE_SPAWN_INTERVAL_MS);
    expect(far.obstacles.length).toBeLessThanOrEqual(MAX_OBSTACLES);
  });
});

describe("save migration", () => {
  it("fills v2 fields into a v1 save", () => {
    const v1 = createVillage("Old", T0) as Partial<VillageState>;
    delete v1.pearls;
    delete v1.obstacles;
    delete v1.lastObstacleAt;
    delete v1.research;
    delete v1.researchJob;
    (v1 as { version: number }).version = 1;
    const migrated = migrateVillage(v1 as VillageState, T0 + 5);
    expect(migrated.version).toBe(2);
    expect(migrated.pearls).toBe(STARTING_PEARLS);
    expect(migrated.obstacles).toEqual([]);
    expect(migrated.lastObstacleAt).toBe(T0 + 5);
    expect(migrated.research).toEqual({});
    expect(migrated.researchJob).toBeNull();
  });
});
