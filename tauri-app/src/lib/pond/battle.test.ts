import { describe, expect, it } from "vitest";
import { BUILDINGS, TROOPS } from "./config";
import {
  canDeployAt,
  createBattle,
  deployTroop,
  stepBattle,
  troopsSpent,
} from "./battle";
import { generateEnemyVillage, seededRng, simulateAwayRaid } from "./enemy";
import type { BattleBuilding, BattleState } from "./types";
import { createVillage } from "./village";

const T0 = 1_750_000_000_000;

function makeBuilding(partial: Partial<BattleBuilding> & { kind: BattleBuilding["kind"] }): BattleBuilding {
  const level = partial.level ?? 1;
  const hp = partial.hp ?? BUILDINGS[partial.kind].levels[level - 1].hp;
  return {
    id: partial.id ?? `b-${partial.kind}`,
    kind: partial.kind,
    level,
    x: partial.x ?? 16,
    y: partial.y ?? 16,
    hp,
    maxHp: hp,
    loot: partial.loot ?? { kelp: 0, shards: 0 },
    destroyed: false,
    cooldownMs: 0,
  };
}

function makeBattle(buildings: BattleBuilding[], army: Partial<Record<string, number>>): BattleState {
  return createBattle({
    enemyName: "Test Cove",
    enemyTownHallLevel: 2,
    buildings,
    army: army as never,
    trophyReward: 20,
    trophyRisk: 10,
  });
}

function runUntilEnd(state: BattleState, maxSimMs = 5 * 60 * 1000): void {
  let elapsed = 0;
  while (!state.ended && elapsed < maxSimMs) {
    stepBattle(state, 100);
    elapsed += 100;
  }
}

describe("deployment", () => {
  it("rejects drops on top of buildings and respects the reserve", () => {
    const state = makeBattle([makeBuilding({ kind: "pondheart", x: 16, y: 16 })], { wildling: 1 });
    expect(canDeployAt(state, 17, 17)).toBe(false);
    expect(canDeployAt(state, 2, 2)).toBe(true);
    expect(deployTroop(state, "wildling", 17, 17)).toBe(false);
    expect(deployTroop(state, "wildling", 2, 2)).toBe(true);
    // Reserve exhausted.
    expect(deployTroop(state, "wildling", 2, 3)).toBe(false);
    expect(state.troops).toHaveLength(1);
  });
});

describe("combat resolution", () => {
  it("a wildling walks to an undefended farm and razes it for loot", () => {
    const farm = makeBuilding({ kind: "kelpFarm", x: 16, y: 16, loot: { kelp: 120, shards: 0 } });
    const state = makeBattle([farm], { wildling: 1 });
    deployTroop(state, "wildling", 4, 17);
    runUntilEnd(state);
    expect(farm.destroyed).toBe(true);
    expect(state.lootWon.kelp).toBe(120);
    expect(state.destructionPct).toBe(100);
    expect(state.stars).toBeGreaterThanOrEqual(2); // 50% + 100% (no TH on the map)
    expect(state.victory).toBe(true);
  });

  it("defenses shoot back and can wipe the raid", () => {
    const geyser = makeBuilding({ kind: "bubbleGeyser", level: 6, x: 16, y: 16 });
    geyser.hp = geyser.maxHp = 100_000; // unkillable for the test
    const state = makeBattle([geyser], { wildling: 1 });
    deployTroop(state, "wildling", 14, 17);
    runUntilEnd(state);
    expect(state.troops[0].dead).toBe(true);
    expect(state.ended).toBe(true);
    expect(state.victory).toBe(false);
  });

  it("pebblebacks prefer defenses over closer resource buildings", () => {
    const farm = makeBuilding({ kind: "kelpFarm", x: 8, y: 16 });
    const geyser = makeBuilding({ kind: "bubbleGeyser", x: 24, y: 16, level: 1 });
    const state = makeBattle([farm, geyser], { pebbleback: 1 });
    deployTroop(state, "pebbleback", 4, 17);
    stepBattle(state, 100);
    expect(state.troops[0].targetId).toBe(geyser.id);
  });

  it("troops walk past walls that are beside, not blocking, their path", () => {
    const farm = makeBuilding({ kind: "kelpFarm", x: 24, y: 16 });
    // Wall sits one tile BELOW the troop's straight eastward path.
    const wall = makeBuilding({ kind: "wall", x: 18, y: 19, level: 3 });
    const state = makeBattle([farm, wall], { wildling: 1 });
    deployTroop(state, "wildling", 16, 17.5);
    runUntilEnd(state);
    expect(farm.destroyed).toBe(true);
    expect(wall.destroyed).toBe(false);
  });

  it("a full army razes a generated walled base well before the timer", () => {
    const player = createVillage("P", T0);
    player.buildings = player.buildings.map((b) =>
      b.kind === "pondheart" ? { ...b, level: 3 } : b,
    );
    for (let seed = 1; seed <= 10; seed += 1) {
      const enemy = generateEnemyVillage(player, seed);
      const state = makeBattle(enemy.buildings, { wildling: 14, finling: 6 });
      // Deploy in a ring on the west and north edges.
      for (let i = 0; i < 14; i += 1) deployTroop(state, "wildling", 2, 4 + i * 2);
      for (let i = 0; i < 6; i += 1) deployTroop(state, "finling", 6 + i * 4, 2);
      runUntilEnd(state);
      expect(state.ended).toBe(true);
      // Either the army died to defenses or the base fell — but no stalemate
      // where living troops idle out the clock.
      const alive = state.troops.some((t) => !t.dead);
      if (alive) expect(state.destructionPct).toBe(100);
    }
  });

  it("walls block the path and get smashed through", () => {
    const farm = makeBuilding({ kind: "kelpFarm", x: 20, y: 16 });
    const wall = makeBuilding({ kind: "wall", x: 16, y: 17, level: 1 });
    const state = makeBattle([farm, wall], { wildling: 1 });
    deployTroop(state, "wildling", 14.5, 17.5);
    runUntilEnd(state);
    expect(wall.destroyed).toBe(true);
    expect(farm.destroyed).toBe(true);
    // Walls never count toward destruction.
    expect(state.destructionPct).toBe(100);
  });

  it("town hall destruction awards the second star", () => {
    const heart = makeBuilding({ kind: "pondheart", x: 16, y: 16 });
    const farm = makeBuilding({ kind: "kelpFarm", x: 26, y: 26 });
    const state = makeBattle([heart, farm], { tidelord: 2 });
    deployTroop(state, "tidelord", 14, 17);
    runUntilEnd(state);
    expect(heart.destroyed).toBe(true);
    expect(state.stars).toBeGreaterThanOrEqual(2);
  });

  it("battle times out after three minutes", () => {
    const heart = makeBuilding({ kind: "pondheart", x: 16, y: 16 });
    heart.hp = heart.maxHp = 10_000_000;
    const state = makeBattle([heart], { wildling: 1 });
    deployTroop(state, "wildling", 2, 2);
    runUntilEnd(state, 4 * 60 * 1000);
    expect(state.ended).toBe(true);
    expect(state.timeLeftMs).toBe(0);
  });

  it("counts spent troops for the post-battle army update", () => {
    const farm = makeBuilding({ kind: "kelpFarm", x: 16, y: 16 });
    const state = makeBattle([farm], { wildling: 2, finling: 1 });
    deployTroop(state, "wildling", 2, 2);
    deployTroop(state, "finling", 3, 2);
    expect(troopsSpent(state)).toEqual({ wildling: 1, finling: 1 });
  });
});

describe("enemy generation", () => {
  it("is deterministic for a fixed seed and scales with the player", () => {
    const player = createVillage("P", T0);
    const a = generateEnemyVillage(player, 1234);
    const b = generateEnemyVillage(player, 1234);
    expect(a).toEqual(b);
    expect(a.townHallLevel).toBeGreaterThanOrEqual(1);
    expect(a.buildings.some((bld) => bld.kind === "pondheart")).toBe(true);
    // Total loot on the map is meaningful.
    const total = a.buildings.reduce((sum, bld) => sum + bld.loot.kelp + bld.loot.shards, 0);
    expect(total).toBeGreaterThan(200);
  });

  it("keeps every generated building inside the grid", () => {
    const player = createVillage("P", T0);
    for (let seed = 1; seed < 40; seed += 1) {
      const enemy = generateEnemyVillage(player, seed);
      for (const building of enemy.buildings) {
        expect(building.x).toBeGreaterThanOrEqual(0);
        expect(building.y).toBeGreaterThanOrEqual(0);
        expect(building.x + BUILDINGS[building.kind].size).toBeLessThanOrEqual(36);
        expect(building.y + BUILDINGS[building.kind].size).toBeLessThanOrEqual(36);
      }
    }
  });
});

describe("away raids", () => {
  it("never raids during the starter shield or short absences", () => {
    const village = createVillage("P", T0);
    expect(simulateAwayRaid({ ...village, lastSeenAt: T0 }, T0 + 3600 * 1000)).toBeNull();
    // 6h away but the 12h starter shield still covers most of it.
    expect(simulateAwayRaid({ ...village, lastSeenAt: T0 }, T0 + 6 * 3600 * 1000)).toBeNull();
  });

  it("produces a loss report for an undefended village", () => {
    const village = {
      ...createVillage("P", T0),
      shieldUntil: 0,
      trophies: 800,
      resources: { kelp: 10_000, shards: 10_000 },
    };
    const report = simulateAwayRaid(
      { ...village, lastSeenAt: T0 },
      T0 + 24 * 3600 * 1000,
      seededRng(7),
    );
    expect(report).not.toBeNull();
    if (!report) return;
    expect(report.defended).toBe(false);
    expect(report.lostKelp).toBeGreaterThan(0);
    expect(report.trophyDelta).toBeLessThan(0);
  });
});

describe("troop balance sanity", () => {
  it("every trainable troop has positive cost, housing and combat value", () => {
    for (const config of Object.values(TROOPS)) {
      if (config.kind === "sovereign") continue; // the hero is summoned, not trained
      expect(config.cost).toBeGreaterThan(0);
      expect(config.housing).toBeGreaterThan(0);
      expect(config.hp).toBeGreaterThan(0);
      expect(config.dps > 0 || (config.healPerSec ?? 0) > 0).toBe(true);
    }
  });
});
