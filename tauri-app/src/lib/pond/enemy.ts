// Pondfall — procedural enemy villages and away-time raid simulation.

import { BUILDINGS, GRID_SIZE } from "./config";
import type {
  BattleBuilding,
  BuildingKind,
  RaidReport,
  VillageState,
} from "./types";
import { townHallLevel } from "./village";

export type Rng = () => number;

/** Deterministic xorshift RNG so enemy layouts are reproducible in tests. */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

const ENEMY_NAMES = [
  "Mudwhisker Cove",
  "Gloomgill Hollow",
  "Saltfin Shoal",
  "Bramblebrook Den",
  "Duskpond Warren",
  "Glimmerreed Bank",
  "Coldwater Burrow",
  "Pebblemarsh Keep",
];

interface Placement {
  kind: BuildingKind;
  x: number;
  y: number;
  level: number;
}

function lootPools(thLevel: number): { kelp: number; shards: number } {
  const pool = Math.round(600 * 2.2 ** (thLevel - 1));
  return { kelp: pool, shards: pool };
}

function clampLevel(kind: BuildingKind, level: number): number {
  return Math.max(1, Math.min(BUILDINGS[kind].levels.length, level));
}

/**
 * Lays out a compact CoC-style base: Pondheart and storages in a walled
 * core, defenses on the corners, collectors exposed outside the walls.
 */
function layoutEnemyBase(thLevel: number, rng: Rng): Placement[] {
  const placements: Placement[] = [];
  const c = Math.floor(GRID_SIZE / 2);
  const level = (kind: BuildingKind, delta = 0) => clampLevel(kind, thLevel + delta);

  placements.push({ kind: "pondheart", x: c - 2, y: c - 2, level: clampLevel("pondheart", thLevel) });
  placements.push({ kind: "kelpVat", x: c - 6, y: c - 2, level: level("kelpVat") });
  placements.push({ kind: "shardVault", x: c + 3, y: c - 2, level: level("shardVault") });

  const defenseRing: Array<{ kind: BuildingKind; x: number; y: number }> = [
    { kind: "bubbleGeyser", x: c - 6, y: c - 6 },
    { kind: "bubbleGeyser", x: c + 3, y: c + 3 },
    { kind: "crystalSpire", x: c + 3, y: c - 6 },
    { kind: "crystalSpire", x: c - 6, y: c + 3 },
    { kind: "elderDen", x: c - 2, y: c + 3 },
    { kind: "mudspitter", x: c - 2, y: c - 6 },
  ];
  const defenseCounts: Partial<Record<BuildingKind, number>> = {};
  for (const spot of defenseRing) {
    const allowed = BUILDINGS[spot.kind].maxCount[thLevel - 1] ?? 0;
    const used = defenseCounts[spot.kind] ?? 0;
    if (used >= allowed) continue;
    defenseCounts[spot.kind] = used + 1;
    placements.push({ kind: spot.kind, x: spot.x, y: spot.y, level: level(spot.kind, -1) });
  }

  // Hidden tide traps sprinkled inside the core (TH2+).
  if (thLevel >= 2) {
    const trapSpots = [
      { x: c - 4, y: c },
      { x: c + 2, y: c + 1 },
      { x: c, y: c - 4 },
    ];
    const trapCount = Math.min(trapSpots.length, thLevel - 1);
    for (let i = 0; i < trapCount; i += 1) {
      const jitter = Math.floor(rng() * 2);
      placements.push({
        kind: "tideTrap",
        x: trapSpots[i].x + jitter,
        y: trapSpots[i].y,
        level: clampLevel("tideTrap", Math.ceil(thLevel / 2)),
      });
    }
  }

  // Wall ring around the core (only at TH2+, mirroring unlock rules).
  if (thLevel >= 2) {
    const left = c - 8;
    const right = c + 7;
    const top = c - 8;
    const bottom = c + 7;
    for (let x = left; x <= right; x += 1) {
      placements.push({ kind: "wall", x, y: top, level: level("wall", -3) });
      placements.push({ kind: "wall", x, y: bottom, level: level("wall", -3) });
    }
    for (let y = top + 1; y <= bottom - 1; y += 1) {
      placements.push({ kind: "wall", x: left, y, level: level("wall", -3) });
      placements.push({ kind: "wall", x: right, y, level: level("wall", -3) });
    }
  }

  // Collectors scattered outside the walls, slightly jittered.
  const farmCount = Math.min(thLevel, 4);
  for (let i = 0; i < farmCount; i += 1) {
    const side = i % 2 === 0 ? -1 : 1;
    const jitter = Math.floor(rng() * 3);
    placements.push({
      kind: "kelpFarm",
      x: c + side * (11 + jitter),
      y: c - 8 + i * 4,
      level: level("kelpFarm", -1),
    });
    placements.push({
      kind: "shardMine",
      x: c - 2 + side * 3,
      y: c + side * (11 + jitter),
      level: level("shardMine", -1),
    });
  }

  return placements.filter(
    (p) =>
      p.x >= 0 &&
      p.y >= 0 &&
      p.x + BUILDINGS[p.kind].size <= GRID_SIZE &&
      p.y + BUILDINGS[p.kind].size <= GRID_SIZE,
  );
}

export interface EnemyVillage {
  name: string;
  townHallLevel: number;
  buildings: BattleBuilding[];
  trophyReward: number;
  trophyRisk: number;
}

export function generateEnemyVillage(player: VillageState, seed: number): EnemyVillage {
  const rng = seededRng(seed);
  const playerTh = townHallLevel(player);
  const drift = rng() < 0.3 ? 1 : rng() < 0.15 ? -1 : 0;
  const thLevel = Math.max(1, Math.min(BUILDINGS.pondheart.levels.length, playerTh + drift));
  const name = ENEMY_NAMES[Math.floor(rng() * ENEMY_NAMES.length)];

  const placements = layoutEnemyBase(thLevel, rng);
  const pools = lootPools(thLevel);

  const storages = placements.filter((p) => p.kind === "kelpVat" || p.kind === "shardVault");
  const collectors = placements.filter((p) => p.kind === "kelpFarm" || p.kind === "shardMine");

  const buildings: BattleBuilding[] = placements.map((placement, index) => {
    const stats = BUILDINGS[placement.kind].levels[placement.level - 1];
    const loot = { kelp: 0, shards: 0 };
    if (placement.kind === "kelpVat") loot.kelp = Math.round((pools.kelp * 0.45) / Math.max(1, storages.length / 2));
    if (placement.kind === "shardVault") loot.shards = Math.round((pools.shards * 0.45) / Math.max(1, storages.length / 2));
    if (placement.kind === "kelpFarm") loot.kelp = Math.round((pools.kelp * 0.35) / Math.max(1, collectors.length / 2));
    if (placement.kind === "shardMine") loot.shards = Math.round((pools.shards * 0.35) / Math.max(1, collectors.length / 2));
    if (placement.kind === "pondheart") {
      loot.kelp = Math.round(pools.kelp * 0.2);
      loot.shards = Math.round(pools.shards * 0.2);
    }
    return {
      id: `e-${index}`,
      kind: placement.kind,
      level: placement.level,
      x: placement.x,
      y: placement.y,
      hp: stats.hp,
      maxHp: stats.hp,
      loot,
      destroyed: false,
      cooldownMs: 0,
    };
  });

  return {
    name,
    townHallLevel: thLevel,
    buildings,
    trophyReward: 18 + thLevel * 4 + Math.floor(rng() * 8),
    trophyRisk: 10 + Math.floor(rng() * 6),
  };
}

// ── Away-time defense raids ───────────────────────────────────────────────

const AWAY_RAID_THRESHOLD_MS = 4 * 3600 * 1000;

/**
 * While the player is away their village may get raided. Rather than run a
 * full sim we compare defensive strength against an attacker scaled to the
 * player's trophies and roll the outcome.
 */
export function simulateAwayRaid(
  village: VillageState,
  now: number,
  rng: Rng = seededRng(now),
): RaidReport | null {
  const awayMs = now - village.lastSeenAt;
  if (awayMs < AWAY_RAID_THRESHOLD_MS) return null;
  if (village.shieldUntil > village.lastSeenAt + awayMs / 2) return null;

  let defensePower = 0;
  for (const building of village.buildings) {
    const config = BUILDINGS[building.kind];
    if (building.level === 0) continue;
    const stats = config.levels[building.level - 1];
    if (config.isDefense) defensePower += (stats.dps ?? 0) * (1 + building.level * 0.2);
    if (config.isTrap) defensePower += (stats.trapDamage ?? 0) * 0.08;
  }
  defensePower += village.buildings.filter((b) => b.kind === "wall").length * 1.5;

  const attackPower = 25 + village.trophies * 0.15 + rng() * 40;
  const defended = defensePower >= attackPower;
  const lossRate = defended ? 0.04 : 0.14;

  return {
    id: `raid-${now}`,
    at: now,
    attackerName: ENEMY_NAMES[Math.floor(rng() * ENEMY_NAMES.length)],
    lostKelp: defended ? 0 : Math.round(village.resources.kelp * lossRate),
    lostShards: defended ? 0 : Math.round(village.resources.shards * lossRate),
    trophyDelta: defended ? 8 : -12,
    defended,
  };
}
