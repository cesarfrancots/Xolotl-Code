import { describe, expect, it } from "vitest";
import { SPELLS, TROOPS } from "./config";
import { castSpell, createBattle, deployTroop, spellsSpent, stepBattle } from "./battle";
import type { BattleBuilding, VillageState } from "./types";
import { brewSpell, createVillage, settleVillage, spellCapacity, spellsHeld } from "./village";

const T0 = 1_750_000_000_000;

function withSpring(level: number): VillageState {
  const village = createVillage("P", T0);
  return {
    ...village,
    resources: { kelp: 9999, shards: 9999 },
    buildings: [
      ...village.buildings.map((b) => (b.kind === "pondheart" ? { ...b, level: 3 } : b)),
      { id: "spring", kind: "spellSpring", level, x: 1, y: 1, job: null },
    ],
  };
}

function arena(buildings: BattleBuilding[], spells: Record<string, number>) {
  return createBattle({
    enemyName: "X",
    enemyTownHallLevel: 2,
    buildings,
    army: { wildling: 2 },
    spells: spells as never,
    trophyReward: 1,
    trophyRisk: 1,
  });
}

function tower(hp: number): BattleBuilding {
  return {
    id: "tower",
    kind: "bubbleGeyser",
    level: 6,
    x: 16,
    y: 16,
    hp,
    maxHp: hp,
    loot: { kelp: 0, shards: 0 },
    destroyed: false,
    cooldownMs: 0,
  };
}

describe("brewing", () => {
  it("requires a spring, respects unlock level and capacity", () => {
    expect(brewSpell(createVillage("P", T0), "heal", T0).ok).toBe(false);

    const v1 = withSpring(1); // capacity 1, surge locked
    expect(spellCapacity(v1)).toBe(1);
    expect(brewSpell(v1, "surge", T0).ok).toBe(false);

    const brewed = brewSpell(v1, "heal", T0);
    expect(brewed.ok).toBe(true);
    if (!brewed.ok) return;
    expect(brewed.village.resources.kelp).toBe(9999 - SPELLS.heal.cost);
    expect(spellsHeld(brewed.village)).toBe(1);
    // Capacity full.
    expect(brewSpell(brewed.village, "heal", T0).ok).toBe(false);

    const done = settleVillage(brewed.village, T0 + SPELLS.heal.brewTimeMs + 1);
    expect(done.spells.heal).toBe(1);
    expect(done.brewQueue).toHaveLength(0);
  });

  it("unlocks surge at spring level 2 with more capacity", () => {
    const v2 = withSpring(2);
    expect(spellCapacity(v2)).toBe(2);
    const brewed = brewSpell(v2, "surge", T0);
    expect(brewed.ok).toBe(true);
  });
});

describe("casting", () => {
  it("consumes reserve and reports spent spells", () => {
    const state = arena([tower(100000)], { heal: 1 });
    expect(castSpell(state, "heal", 10, 10)).toBe(true);
    expect(castSpell(state, "heal", 10, 10)).toBe(false); // reserve empty
    expect(state.activeSpells).toHaveLength(1);
    expect(spellsSpent(state, { heal: 1 })).toEqual({ heal: 1 });
  });

  it("heal rain restores troop hp inside the radius only", () => {
    const state = arena([tower(100000)], { heal: 1 });
    deployTroop(state, "wildling", 4, 4); // inside
    deployTroop(state, "wildling", 30, 30); // far outside
    const [near, far] = state.troops;
    near.hp = far.hp = 10;
    castSpell(state, "heal", 4, 4);
    stepBattle(state, 1000);
    expect(near.hp).toBeGreaterThan(10 + SPELLS.heal.healPerSec! * 0.8);
    // The far troop only changed by tower damage, never healed above 10.
    expect(far.hp).toBeLessThanOrEqual(10);
  });

  it("surge boosts damage while active and expires after its duration", () => {
    // A harmless high-HP building so the troop survives past the surge.
    const target: BattleBuilding = { ...tower(1_000_000), kind: "kelpFarm" };
    const state = arena([target], { surge: 1 });
    deployTroop(state, "wildling", 16.5, 15); // one tile out; walks in, then swings
    castSpell(state, "surge", 17, 17);
    let elapsed = 0;
    while (target.hp === target.maxHp && elapsed < 5000) {
      stepBattle(state, 100);
      elapsed += 100;
    }
    const surgedDamage = target.maxHp - target.hp;
    expect(surgedDamage).toBeCloseTo(TROOPS.wildling.dps * SPELLS.surge.damageMultiplier!, 3);

    // Run past the spell duration; the next swing is unboosted.
    while (elapsed < SPELLS.surge.durationMs + 100) {
      stepBattle(state, 100);
      elapsed += 100;
    }
    expect(state.activeSpells).toHaveLength(0);
    const before = target.hp;
    // Advance one full attack cooldown.
    for (let i = 0; i < 10; i += 1) stepBattle(state, 100);
    const plainDamage = before - target.hp;
    expect(plainDamage).toBeCloseTo(TROOPS.wildling.dps, 3);
  });
});
