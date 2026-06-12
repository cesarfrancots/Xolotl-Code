// Pondfall — real-time battle simulation.
//
// The sim is a pure fixed-step state machine: the renderer calls
// stepBattle(state, dtMs) each frame and animates from the event list the
// tick produces. No Phaser types leak in here, so the whole combat model is
// unit-testable headless.

import {
  BATTLE_DURATION_MS,
  BUILDINGS,
  HERO_ABILITY,
  SPELLS,
  TROOPS,
  troopStatMultiplier,
} from "./config";
import type {
  BattleBuilding,
  BattleEvent,
  BattleState,
  BattleTroop,
  ResourceKind,
  SpellKind,
  TroopKind,
} from "./types";

const WALL_ATTACK_RANGE = 0.9;
/** Deployments must stay this many tiles clear of any standing building. */
export const DEPLOY_CLEARANCE_TILES = 1;

function center(building: BattleBuilding): { x: number; y: number } {
  const size = BUILDINGS[building.kind].size;
  return { x: building.x + size / 2, y: building.y + size / 2 };
}

function distanceToBuilding(x: number, y: number, building: BattleBuilding): number {
  const size = BUILDINGS[building.kind].size;
  const nearestX = Math.max(building.x, Math.min(x, building.x + size));
  const nearestY = Math.max(building.y, Math.min(y, building.y + size));
  return Math.hypot(x - nearestX, y - nearestY);
}

function isResourceBuilding(building: BattleBuilding): boolean {
  const config = BUILDINGS[building.kind];
  return Boolean(config.produces || config.stores || building.kind === "pondheart");
}

export function canDeployAt(state: BattleState, x: number, y: number): boolean {
  for (const building of state.buildings) {
    if (building.destroyed) continue;
    if (distanceToBuilding(x, y, building) < DEPLOY_CLEARANCE_TILES) return false;
  }
  return true;
}

export function deployTroop(
  state: BattleState,
  kind: TroopKind,
  x: number,
  y: number,
): boolean {
  if (state.ended) return false;
  if ((state.reserve[kind] ?? 0) <= 0) return false;
  if (!canDeployAt(state, x, y)) return false;
  const config = TROOPS[kind];
  const level = state.troopLevels[kind] ?? 1;
  const hp = Math.round(config.hp * troopStatMultiplier(level));
  state.reserve[kind] = (state.reserve[kind] ?? 0) - 1;
  state.troops.push({
    id: `t-${state.nextTroopId++}`,
    kind,
    level,
    x,
    y,
    hp,
    maxHp: hp,
    targetId: null,
    cooldownMs: 0,
    dead: false,
  });
  state.events.push({ type: "deploy", x, y });
  return true;
}

/**
 * Casts a spell anywhere on the field. Unlike troops, spells have no
 * placement restrictions. Returns false when none are left in reserve.
 */
export function castSpell(state: BattleState, kind: SpellKind, x: number, y: number): boolean {
  if (state.ended) return false;
  if ((state.spellReserve[kind] ?? 0) <= 0) return false;
  state.spellReserve[kind] = (state.spellReserve[kind] ?? 0) - 1;
  state.activeSpells.push({
    kind,
    x,
    y,
    expiresAt: BATTLE_DURATION_MS - state.timeLeftMs + SPELLS[kind].durationMs,
  });
  state.events.push({ type: "deploy", x, y });
  return true;
}

function spellsCovering(state: BattleState, troop: BattleTroop, kind: SpellKind): boolean {
  for (const spell of state.activeSpells) {
    if (spell.kind !== kind) continue;
    if (Math.hypot(troop.x - spell.x, troop.y - spell.y) <= SPELLS[kind].radiusTiles) return true;
  }
  return false;
}

function pickBuildingTarget(state: BattleState, troop: BattleTroop): BattleBuilding | null {
  const config = TROOPS[troop.kind];
  // Hidden traps are never targeted; they only trigger.
  const standing = state.buildings.filter(
    (b) => !b.destroyed && b.kind !== "wall" && !BUILDINGS[b.kind].isTrap,
  );
  if (standing.length === 0 && config.preference !== "walls") return null;
  const preferred =
    config.preference === "defenses"
      ? standing.filter((b) => BUILDINGS[b.kind].isDefense)
      : config.preference === "resources"
        ? standing.filter(isResourceBuilding)
        : config.preference === "walls"
          ? state.buildings.filter((b) => !b.destroyed && b.kind === "wall")
          : standing;
  const pool = preferred.length > 0 ? preferred : standing;
  if (pool.length === 0) return null;
  let best: BattleBuilding | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const building of pool) {
    const distance = distanceToBuilding(troop.x, troop.y, building);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = building;
    }
  }
  return best;
}

/**
 * The wall directly ahead on the troop's path, if any. Probing a point in
 * the movement direction (rather than any wall in arm's reach) lets troops
 * walk through gaps they already opened instead of grinding the whole ring.
 */
function blockingWall(
  state: BattleState,
  troop: BattleTroop,
  dirX: number,
  dirY: number,
): BattleBuilding | null {
  const probeX = troop.x + dirX * WALL_ATTACK_RANGE;
  const probeY = troop.y + dirY * WALL_ATTACK_RANGE;
  for (const building of state.buildings) {
    if (building.destroyed || building.kind !== "wall") continue;
    if (distanceToBuilding(probeX, probeY, building) <= 0.35) return building;
  }
  return null;
}

function pickHealTarget(state: BattleState, healer: BattleTroop): BattleTroop | null {
  let best: BattleTroop | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const troop of state.troops) {
    if (troop.dead || troop.id === healer.id || troop.kind === "glowmender") continue;
    const missing = troop.maxHp - troop.hp;
    if (missing <= 0) continue;
    const score = Math.hypot(troop.x - healer.x, troop.y - healer.y) - missing / 50;
    if (score < bestScore) {
      bestScore = score;
      best = troop;
    }
  }
  return best;
}

function damageBuilding(
  state: BattleState,
  building: BattleBuilding,
  amount: number,
  events: BattleEvent[],
): void {
  if (building.destroyed) return;
  building.hp -= amount;
  if (building.hp > 0) return;
  building.hp = 0;
  building.destroyed = true;
  state.lootWon.kelp += building.loot.kelp;
  state.lootWon.shards += building.loot.shards;
  const at = center(building);
  events.push({ type: "destroyed", toId: building.id, x: at.x, y: at.y });
}

function troopAttack(
  state: BattleState,
  troop: BattleTroop,
  target: BattleBuilding,
  dtMs: number,
  events: BattleEvent[],
): void {
  const config = TROOPS[troop.kind];
  troop.cooldownMs -= dtMs;
  if (troop.cooldownMs > 0) return;
  troop.cooldownMs = 1000;
  let damage = config.dps * troopStatMultiplier(troop.level);
  if (config.lootMultiplier && isResourceBuilding(target)) damage *= config.lootMultiplier;
  if (spellsCovering(state, troop, "surge")) damage *= SPELLS.surge.damageMultiplier ?? 1;
  if ((troop.rageMsLeft ?? 0) > 0) damage *= HERO_ABILITY.damageMultiplier;
  const at = center(target);
  events.push({ type: "shot", fromId: troop.id, toId: target.id, x: at.x, y: at.y });
  if (config.splashRadiusTiles) {
    for (const building of state.buildings) {
      if (building.destroyed) continue;
      const bc = center(building);
      if (Math.hypot(bc.x - at.x, bc.y - at.y) <= config.splashRadiusTiles + 0.6) {
        const multiplier =
          building.kind === "wall" && config.wallDamageMultiplier ? config.wallDamageMultiplier : 1;
        damageBuilding(state, building, damage * multiplier, events);
      }
    }
  } else {
    const multiplier =
      target.kind === "wall" && config.wallDamageMultiplier ? config.wallDamageMultiplier : 1;
    damageBuilding(state, target, damage * multiplier, events);
  }
  // Wall-breakers go out with their bang.
  if (config.suicide) {
    troop.hp = 0;
    troop.dead = true;
    events.push({ type: "destroyed", toId: troop.id, x: troop.x, y: troop.y });
  }
}

function stepTroop(state: BattleState, troop: BattleTroop, dtMs: number, events: BattleEvent[]): void {
  const config = TROOPS[troop.kind];
  const surged = spellsCovering(state, troop, "surge");
  const speedFactor = surged ? SPELLS.surge.speedMultiplier ?? 1 : 1;

  // Sovereign Wrath: the hero rallies once when badly hurt.
  if (troop.kind === "sovereign") {
    if (troop.rageMsLeft !== undefined && troop.rageMsLeft > 0) {
      troop.rageMsLeft = Math.max(0, troop.rageMsLeft - dtMs);
    }
    if (!troop.abilityUsed && troop.hp < troop.maxHp * HERO_ABILITY.triggerHpFraction) {
      troop.abilityUsed = true;
      troop.hp = Math.min(troop.maxHp, troop.hp + troop.maxHp * HERO_ABILITY.healFraction);
      troop.rageMsLeft = HERO_ABILITY.rageMs;
      events.push({ type: "heal", toId: troop.id, x: troop.x, y: troop.y });
    }
  }

  if (config.healPerSec) {
    const patient =
      (troop.targetId && state.troops.find((t) => t.id === troop.targetId && !t.dead && t.hp < t.maxHp)) ||
      pickHealTarget(state, troop);
    if (!patient) return;
    troop.targetId = patient.id;
    const distance = Math.hypot(patient.x - troop.x, patient.y - troop.y);
    if (distance > config.rangeTiles) {
      const step = (config.speedTilesPerSec * speedFactor * dtMs) / 1000;
      troop.x += ((patient.x - troop.x) / distance) * step;
      troop.y += ((patient.y - troop.y) / distance) * step;
      return;
    }
    troop.cooldownMs -= dtMs;
    if (troop.cooldownMs <= 0) {
      troop.cooldownMs = 500;
      const heal = (config.healPerSec / 2) * troopStatMultiplier(troop.level);
      patient.hp = Math.min(patient.maxHp, patient.hp + heal);
      events.push({ type: "heal", fromId: troop.id, toId: patient.id, x: patient.x, y: patient.y });
    }
    return;
  }

  let target =
    (troop.targetId && state.buildings.find((b) => b.id === troop.targetId && !b.destroyed)) || null;
  if (!target) {
    target = pickBuildingTarget(state, troop);
    troop.targetId = target?.id ?? null;
  }
  if (!target) return;

  const distance = distanceToBuilding(troop.x, troop.y, target);
  if (distance <= config.rangeTiles) {
    troopAttack(state, troop, target, dtMs, events);
    return;
  }

  const to = center(target);
  const length = Math.hypot(to.x - troop.x, to.y - troop.y) || 1;
  const dirX = (to.x - troop.x) / length;
  const dirY = (to.y - troop.y) / length;

  // Walls in the way get attacked instead of pathed around.
  const wall = blockingWall(state, troop, dirX, dirY);
  if (wall) {
    troopAttack(state, troop, wall, dtMs, events);
    return;
  }

  const step = (config.speedTilesPerSec * speedFactor * dtMs) / 1000;
  troop.x += dirX * step;
  troop.y += dirY * step;
}

function stepDefense(
  state: BattleState,
  building: BattleBuilding,
  dtMs: number,
  events: BattleEvent[],
): void {
  const stats = BUILDINGS[building.kind].levels[building.level - 1];
  if (!stats?.dps || !stats.rangeTiles || !stats.attackPeriodMs) return;
  building.cooldownMs -= dtMs;
  if (building.cooldownMs > 0) return;

  const from = center(building);
  let target: BattleTroop | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const troop of state.troops) {
    if (troop.dead) continue;
    const distance = Math.hypot(troop.x - from.x, troop.y - from.y);
    // Mortars cannot hit troops inside their blind spot.
    if (stats.minRangeTiles && distance < stats.minRangeTiles) continue;
    if (distance <= stats.rangeTiles && distance < bestDistance) {
      bestDistance = distance;
      target = troop;
    }
  }
  if (!target) return;

  building.cooldownMs = stats.attackPeriodMs;
  const damage = (stats.dps * stats.attackPeriodMs) / 1000;
  events.push({ type: "shot", fromId: building.id, toId: target.id, x: target.x, y: target.y });
  const victims = stats.splashRadiusTiles
    ? state.troops.filter(
        (t) => !t.dead && Math.hypot(t.x - target.x, t.y - target.y) <= (stats.splashRadiusTiles ?? 0),
      )
    : [target];
  for (const victim of victims) {
    victim.hp -= damage;
    if (victim.hp <= 0) {
      victim.hp = 0;
      victim.dead = true;
    }
  }
}

function updateProgress(state: BattleState): void {
  let total = 0;
  let destroyed = 0;
  let townHallDown = false;
  for (const building of state.buildings) {
    const weight = BUILDINGS[building.kind].destructionWeight;
    if (weight === 0) continue;
    total += weight;
    if (building.destroyed) {
      destroyed += weight;
      if (building.kind === "pondheart") townHallDown = true;
    }
  }
  state.destructionPct = total === 0 ? 0 : Math.round((destroyed / total) * 100);
  let stars = 0;
  if (state.destructionPct >= 50) stars += 1;
  if (townHallDown) stars += 1;
  if (state.destructionPct >= 100) stars += 1;
  state.stars = stars;
}

function reserveEmpty(state: BattleState): boolean {
  return Object.values(state.reserve).every((count) => (count ?? 0) === 0);
}

/** Advances the battle by dtMs. Returns the events produced this tick. */
export function stepBattle(state: BattleState, dtMs: number): BattleEvent[] {
  if (state.ended) return [];
  const events: BattleEvent[] = [];

  const elapsedMs = BATTLE_DURATION_MS - state.timeLeftMs;
  state.activeSpells = state.activeSpells.filter((spell) => spell.expiresAt > elapsedMs);
  for (const spell of state.activeSpells) {
    const config = SPELLS[spell.kind];
    if (!config.healPerSec) continue;
    for (const troop of state.troops) {
      if (troop.dead || troop.hp >= troop.maxHp) continue;
      if (Math.hypot(troop.x - spell.x, troop.y - spell.y) <= config.radiusTiles) {
        troop.hp = Math.min(troop.maxHp, troop.hp + (config.healPerSec * dtMs) / 1000);
      }
    }
  }

  for (const troop of state.troops) {
    if (!troop.dead) stepTroop(state, troop, dtMs, events);
  }
  for (const building of state.buildings) {
    if (!building.destroyed && BUILDINGS[building.kind].isDefense && building.level > 0) {
      stepDefense(state, building, dtMs, events);
    }
  }

  // Hidden traps erupt when a raider wanders over them.
  for (const trap of state.buildings) {
    const config = BUILDINGS[trap.kind];
    if (!config.isTrap || trap.destroyed) continue;
    const stats = config.levels[trap.level - 1];
    const at = center(trap);
    const triggered = state.troops.some(
      (t) => !t.dead && Math.hypot(t.x - at.x, t.y - at.y) <= 1.2,
    );
    if (!triggered) continue;
    trap.destroyed = true;
    trap.hp = 0;
    events.push({ type: "destroyed", toId: trap.id, x: at.x, y: at.y });
    const blast = stats.splashRadiusTiles ?? 1.8;
    for (const troop of state.troops) {
      if (troop.dead) continue;
      if (Math.hypot(troop.x - at.x, troop.y - at.y) <= blast) {
        troop.hp -= stats.trapDamage ?? 0;
        if (troop.hp <= 0) {
          troop.hp = 0;
          troop.dead = true;
        }
      }
    }
  }

  updateProgress(state);
  state.timeLeftMs = Math.max(0, state.timeLeftMs - dtMs);

  const allDead = state.troops.every((t) => t.dead);
  const armySpent = reserveEmpty(state) && state.troops.length > 0 && allDead;
  if (state.timeLeftMs <= 0 || state.destructionPct >= 100 || armySpent) {
    state.ended = true;
    state.victory = state.stars > 0;
  }

  state.events = events;
  return events;
}

/** Troops consumed by this battle (deployed axolotls do not come home). */
export function troopsSpent(state: BattleState): Partial<Record<TroopKind, number>> {
  const spent: Partial<Record<TroopKind, number>> = {};
  for (const troop of state.troops) {
    spent[troop.kind] = (spent[troop.kind] ?? 0) + 1;
  }
  return spent;
}

/** Spells consumed: everything brewed minus what is still in reserve. */
export function spellsSpent(
  state: BattleState,
  brought: Partial<Record<SpellKind, number>>,
): Partial<Record<SpellKind, number>> {
  const spent: Partial<Record<SpellKind, number>> = {};
  for (const [kind, count] of Object.entries(brought)) {
    const spell = kind as SpellKind;
    const used = (count ?? 0) - (state.spellReserve[spell] ?? 0);
    if (used > 0) spent[spell] = used;
  }
  return spent;
}

/** Loot still sitting in standing buildings — what the attacker can yet win. */
export function availableLoot(state: BattleState): Record<ResourceKind, number> {
  const remaining: Record<ResourceKind, number> = { kelp: 0, shards: 0 };
  for (const building of state.buildings) {
    if (building.destroyed) continue;
    remaining.kelp += building.loot.kelp;
    remaining.shards += building.loot.shards;
  }
  return remaining;
}

export function createBattle(options: {
  enemyName: string;
  enemyTownHallLevel: number;
  buildings: BattleBuilding[];
  army: Partial<Record<TroopKind, number>>;
  troopLevels?: Partial<Record<TroopKind, number>>;
  spells?: Partial<Record<SpellKind, number>>;
  trophyReward: number;
  trophyRisk: number;
}): BattleState {
  return {
    enemyName: options.enemyName,
    enemyTownHallLevel: options.enemyTownHallLevel,
    trophyReward: options.trophyReward,
    trophyRisk: options.trophyRisk,
    buildings: options.buildings,
    troops: [],
    reserve: { ...options.army },
    troopLevels: { ...(options.troopLevels ?? {}) },
    spellReserve: { ...(options.spells ?? {}) },
    activeSpells: [],
    timeLeftMs: BATTLE_DURATION_MS,
    destructionPct: 0,
    stars: 0,
    lootWon: { kelp: 0, shards: 0 },
    events: [],
    ended: false,
    victory: false,
    nextTroopId: 1,
  };
}
