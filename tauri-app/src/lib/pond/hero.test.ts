import { describe, expect, it } from "vitest";
import {
  BUILDINGS,
  HERO_ABILITY,
  HERO_REGEN_MS,
  TROOPS,
  WORKSHOP_PEARL_COSTS,
  heroLevelCap,
  heroUpgradeCost,
  troopStatMultiplier,
} from "./config";
import { createBattle, deployTroop, stepBattle } from "./battle";
import { generateEnemyVillage } from "./enemy";
import type { BattleBuilding, VillageState } from "./types";
import {
  createVillage,
  finishNow,
  heroReady,
  knockOutHero,
  placeBuilding,
  settleVillage,
  startHeroUpgrade,
} from "./village";

const T0 = 1_750_000_000_000;

function thronedVillage(thLevel = 3): VillageState {
  const village = createVillage("P", T0);
  return {
    ...village,
    resources: { kelp: 99_999, shards: 99_999 },
    pearls: 2000,
    buildings: [
      ...village.buildings.map((b) => (b.kind === "pondheart" ? { ...b, level: thLevel } : b)),
      { id: "throne", kind: "sovereignThrone", level: 1, x: 1, y: 1, job: null },
    ],
    hero: { level: 1, upgradeJob: null, regenUntil: 0 },
  };
}

function building(kind: BattleBuilding["kind"], x: number, y: number, level = 1): BattleBuilding {
  const hp = BUILDINGS[kind].levels[level - 1].hp;
  return {
    id: `b-${kind}-${x}-${y}`,
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

describe("hero acquisition", () => {
  it("building the throne summons a level-1 Supreme Axolotl", () => {
    let village = { ...createVillage("P", T0), resources: { kelp: 99_999, shards: 99_999 } };
    village.buildings = village.buildings.map((b) =>
      b.kind === "pondheart" ? { ...b, level: 3 } : b,
    );
    expect(village.hero).toBeNull();
    const placed = placeBuilding(village, "sovereignThrone", 1, 1, T0);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const throne = placed.village.buildings.find((b) => b.kind === "sovereignThrone")!;
    const done = settleVillage(placed.village, throne.job!.finishesAt + 1);
    expect(done.hero).toEqual({ level: 1, upgradeJob: null, regenUntil: 0 });
    expect(heroReady(done, throne.job!.finishesAt + 1)).toBe(true);
  });

  it("hero level cap follows the Pondheart (2× TH level)", () => {
    let village = thronedVillage(3); // cap 6
    village.hero = { level: 6, upgradeJob: null, regenUntil: 0 };
    expect(heroLevelCap(3)).toBe(6);
    const blocked = startHeroUpgrade(village, T0);
    expect(blocked.ok).toBe(false);

    village.hero = { level: 2, upgradeJob: null, regenUntil: 0 };
    const started = startHeroUpgrade(village, T0);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.village.resources.kelp).toBe(99_999 - heroUpgradeCost(3));
    expect(heroReady(started.village, T0)).toBe(false); // training = unavailable

    const done = settleVillage(started.village, started.village.hero!.upgradeJob!.finishesAt + 1);
    expect(done.hero?.level).toBe(3);
    expect(done.hero?.upgradeJob).toBeNull();
  });

  it("finishNow completes hero training with pearls", () => {
    const village = thronedVillage();
    const started = startHeroUpgrade(village, T0);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const finished = finishNow(started.village, { type: "hero" }, T0);
    expect(finished.ok).toBe(true);
    if (!finished.ok) return;
    expect(finished.village.hero?.level).toBe(2);
    expect(finished.village.pearls).toBeLessThan(2000);
  });

  it("a knocked-out hero regenerates over time", () => {
    const village = thronedVillage();
    const down = knockOutHero(village, T0, HERO_REGEN_MS);
    expect(heroReady(down, T0)).toBe(false);
    expect(heroReady(down, T0 + HERO_REGEN_MS + 1)).toBe(true);
  });
});

describe("hero in battle", () => {
  it("deploys with level-scaled stats and rages when wounded", () => {
    const tower = building("bubbleGeyser", 16, 16, 6);
    tower.hp = tower.maxHp = 1_000_000;
    const state = createBattle({
      enemyName: "X",
      enemyTownHallLevel: 3,
      buildings: [tower],
      army: { sovereign: 1 },
      troopLevels: { sovereign: 4 },
      trophyReward: 1,
      trophyRisk: 1,
    });
    deployTroop(state, "sovereign", 14, 16);
    const hero = state.troops[0];
    expect(hero.level).toBe(4);
    expect(hero.maxHp).toBe(Math.round(TROOPS.sovereign.hp * troopStatMultiplier(4)));

    // Let the tower chew the hero down to the wrath threshold.
    let elapsed = 0;
    while (!hero.abilityUsed && !hero.dead && elapsed < 120_000) {
      stepBattle(state, 100);
      elapsed += 100;
    }
    expect(hero.abilityUsed).toBe(true);
    // The ability healed it back above the trigger line.
    expect(hero.hp).toBeGreaterThan(hero.maxHp * HERO_ABILITY.triggerHpFraction);
  });
});

describe("new structures", () => {
  it("tide traps stay untargeted, then erupt on proximity and die", () => {
    const farm = building("kelpFarm", 24, 16);
    const trap = building("tideTrap", 18, 16);
    const state = createBattle({
      enemyName: "X",
      enemyTownHallLevel: 2,
      buildings: [farm, trap],
      army: { wildling: 1 },
      trophyReward: 1,
      trophyRisk: 1,
    });
    deployTroop(state, "wildling", 14, 16.5);
    stepBattle(state, 100);
    expect(state.troops[0].targetId).toBe(farm.id); // never the trap
    let elapsed = 0;
    while (!trap.destroyed && elapsed < 30_000) {
      stepBattle(state, 100);
      elapsed += 100;
    }
    expect(trap.destroyed).toBe(true);
    // 120 trap damage one-shots a 95 hp wildling.
    expect(BUILDINGS.tideTrap.levels[0].trapDamage!).toBeGreaterThan(TROOPS.wildling.hp);
    expect(state.troops[0].dead).toBe(true);
    // Traps never count toward destruction.
    expect(state.destructionPct).toBe(0);
  });

  it("mudspitter cannot hit troops inside its blind spot", () => {
    const mortar = building("mudspitter", 16, 16, 1);
    mortar.hp = mortar.maxHp = 1_000_000;
    const state = createBattle({
      enemyName: "X",
      enemyTownHallLevel: 3,
      buildings: [mortar],
      army: { wildling: 1 },
      trophyReward: 1,
      trophyRisk: 1,
    });
    // Hugging the mortar: 2.6 tiles from its center, inside the minRange-3 blind spot.
    deployTroop(state, "wildling", 17.5, 14.9);
    for (let i = 0; i < 100; i += 1) stepBattle(state, 100);
    expect(state.troops[0].hp).toBe(state.troops[0].maxHp);
  });

  it("enemy bases hide traps and add mortars at higher town halls", () => {
    const player = createVillage("P", T0);
    player.buildings = player.buildings.map((b) =>
      b.kind === "pondheart" ? { ...b, level: 4 } : b,
    );
    const enemy = generateEnemyVillage(player, 7);
    if (enemy.townHallLevel >= 3) {
      expect(enemy.buildings.some((b) => b.kind === "mudspitter")).toBe(true);
    }
    if (enemy.townHallLevel >= 2) {
      expect(enemy.buildings.some((b) => b.kind === "tideTrap")).toBe(true);
    }
  });
});

describe("pearl-priced workshops", () => {
  it("the second workshop costs 250 pearls, like CoC builders cost gems", () => {
    let village = { ...createVillage("P", T0), resources: { kelp: 99_999, shards: 99_999 } };
    village.buildings = village.buildings.map((b) =>
      b.kind === "pondheart" ? { ...b, level: 2 } : b,
    );
    village.pearls = 100; // can't afford
    const poor = placeBuilding(village, "workshop", 1, 1, T0);
    expect(poor.ok).toBe(false);
    if (!poor.ok) expect(poor.error).toMatch(/pearls/);

    village.pearls = 300;
    const bought = placeBuilding(village, "workshop", 1, 1, T0);
    expect(bought.ok).toBe(true);
    if (!bought.ok) return;
    expect(bought.village.pearls).toBe(300 - WORKSHOP_PEARL_COSTS[1]);
    // Resources untouched.
    expect(bought.village.resources.shards).toBe(99_999);
  });
});
