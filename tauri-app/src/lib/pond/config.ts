// Pondfall — balance tables and asset mapping.
//
// Numbers follow the Clash of Clans curve shape (steep exponential costs,
// timers that start instant and stretch to hours) but compressed so a
// desktop side-game stays playable in real sessions.

import type {
  BuildingKind,
  ObstacleKind,
  ResourceKind,
  SpellKind,
  TargetPreference,
  TroopKind,
} from "./types";

export const GRID_SIZE = 36;
export const MAX_TOWN_HALL_LEVEL = 6;
export const BATTLE_DURATION_MS = 3 * 60 * 1000;
export const MAX_RAID_LOG = 12;

/** Hours of production a collector buffers before it stops accruing. */
export const COLLECTOR_BUFFER_HOURS = 4;

export const LEAGUES = [
  { name: "Tadpole Puddle", minTrophies: 0 },
  { name: "Brook League", minTrophies: 200 },
  { name: "Lagoon League", minTrophies: 500 },
  { name: "Reef League", minTrophies: 900 },
  { name: "Tide League", minTrophies: 1400 },
  { name: "Abyss League", minTrophies: 2000 },
] as const;

export function leagueFor(trophies: number): string {
  let name: string = LEAGUES[0].name;
  for (const league of LEAGUES) {
    if (trophies >= league.minTrophies) name = league.name;
  }
  return name;
}

function geometric(base: number, factor: number, levels: number): number[] {
  return Array.from({ length: levels }, (_, i) => Math.round(base * factor ** i));
}

/** Build/upgrade duration in ms for reaching `level` (index level-1). */
const BUILD_TIMES_S = [15, 60, 300, 900, 2700, 7200];

export interface BuildingLevelStats {
  cost: number;
  buildTimeMs: number;
  hp: number;
  /** Collectors: units produced per hour. */
  ratePerHour?: number;
  /** Storages and the Pondheart: capacity added to the village bank. */
  capacity?: number;
  /** Defenses. */
  dps?: number;
  rangeTiles?: number;
  attackPeriodMs?: number;
  splashRadiusTiles?: number;
  /** Mortar-style defenses cannot hit troops closer than this (blind spot). */
  minRangeTiles?: number;
  /** Traps: damage dealt to every troop in the blast when triggered. */
  trapDamage?: number;
  /** Army camps: housing provided. Hatchery: queue slots. */
  housing?: number;
}

export interface BuildingConfig {
  kind: BuildingKind;
  name: string;
  description: string;
  sprite: string;
  /** Footprint in tiles (square). */
  size: number;
  costResource: ResourceKind;
  /** Resource a collector produces, if any. */
  produces?: ResourceKind;
  /** Resource a storage banks, if any (Pondheart banks both). */
  stores?: ResourceKind;
  isDefense: boolean;
  /** Hidden one-shot traps: invisible to attackers until triggered. */
  isTrap?: boolean;
  /** Max simultaneous copies, indexed by Pondheart level (index 0 = TH1). */
  maxCount: number[];
  levels: BuildingLevelStats[];
  /** Weight of this building in destruction % (walls are 0). */
  destructionWeight: number;
}

function levels(
  count: number,
  make: (level: number) => Omit<BuildingLevelStats, "buildTimeMs"> & { buildTimeMs?: number },
): BuildingLevelStats[] {
  return Array.from({ length: count }, (_, i) => {
    const stats = make(i + 1);
    return { buildTimeMs: BUILD_TIMES_S[i] * 1000, ...stats };
  });
}

const COSTS = {
  collector: geometric(150, 2.4, 6),
  storage: geometric(300, 2.6, 6),
  hatchery: geometric(200, 2.5, 6),
  camp: geometric(250, 2.6, 6),
  geyser: geometric(120, 2.5, 6),
  spire: geometric(400, 2.5, 6),
  den: geometric(1500, 2.5, 6),
  pondheart: [0, 1000, 4000, 15000, 60000, 200000],
};

export const BUILDINGS: Record<BuildingKind, BuildingConfig> = {
  pondheart: {
    kind: "pondheart",
    name: "Pondheart",
    description: "The glowing heart of your colony. Upgrading it unlocks everything else.",
    sprite: "bld-pondheart",
    size: 4,
    costResource: "kelp",
    isDefense: false,
    maxCount: [1, 1, 1, 1, 1, 1],
    destructionWeight: 4,
    levels: levels(6, (level) => ({
      cost: COSTS.pondheart[level - 1],
      buildTimeMs: [0, 60, 600, 2700, 7200, 21600][level - 1] * 1000,
      hp: 1200 + 700 * (level - 1),
      capacity: 1000 * level,
    })),
  },
  kelpFarm: {
    kind: "kelpFarm",
    name: "Kelp Farm",
    description: "Grows kelp over time. Tap to harvest before raiders do.",
    sprite: "bld-farm",
    size: 3,
    costResource: "shards",
    produces: "kelp",
    isDefense: false,
    maxCount: [1, 2, 3, 4, 5, 6],
    destructionWeight: 1,
    levels: levels(6, (level) => ({
      cost: COSTS.collector[level - 1],
      hp: 220 + 90 * (level - 1),
      ratePerHour: 500 + 350 * (level - 1),
    })),
  },
  shardMine: {
    kind: "shardMine",
    name: "Shard Mine",
    description: "A glowshard outcrop worked around the clock. Tap to collect.",
    sprite: "res-glowshards",
    size: 3,
    costResource: "kelp",
    produces: "shards",
    isDefense: false,
    maxCount: [1, 2, 3, 4, 5, 6],
    destructionWeight: 1,
    levels: levels(6, (level) => ({
      cost: COSTS.collector[level - 1],
      hp: 220 + 90 * (level - 1),
      ratePerHour: 500 + 350 * (level - 1),
    })),
  },
  kelpVat: {
    kind: "kelpVat",
    name: "Kelp Vat",
    description: "Banks harvested kelp. Bigger vats survive bigger raids.",
    sprite: "bld-storage",
    size: 3,
    costResource: "shards",
    stores: "kelp",
    isDefense: false,
    maxCount: [1, 1, 2, 2, 3, 3],
    destructionWeight: 2,
    levels: levels(6, (level) => ({
      cost: COSTS.storage[level - 1],
      hp: 500 + 250 * (level - 1),
      capacity: [1500, 5000, 12000, 30000, 70000, 150000][level - 1],
    })),
  },
  shardVault: {
    kind: "shardVault",
    name: "Shard Vault",
    description: "Banks mined glowshards behind thick clay walls.",
    sprite: "bld-storage",
    size: 3,
    costResource: "kelp",
    stores: "shards",
    isDefense: false,
    maxCount: [1, 1, 2, 2, 3, 3],
    destructionWeight: 2,
    levels: levels(6, (level) => ({
      cost: COSTS.storage[level - 1],
      hp: 500 + 250 * (level - 1),
      capacity: [1500, 5000, 12000, 30000, 70000, 150000][level - 1],
    })),
  },
  hatchery: {
    kind: "hatchery",
    name: "Hatchery",
    description: "Hatches and trains your raiding axolotls. Higher levels unlock new morphs.",
    sprite: "bld-nest",
    size: 3,
    costResource: "kelp",
    isDefense: false,
    maxCount: [1, 1, 1, 1, 1, 1],
    destructionWeight: 1,
    levels: levels(6, (level) => ({
      cost: COSTS.hatchery[level - 1],
      hp: 320 + 120 * (level - 1),
      // Hatching-queue slots; roomy enough to queue a wave in one sitting.
      housing: 4 + 2 * level,
    })),
  },
  armyCamp: {
    kind: "armyCamp",
    name: "Mossy Camp",
    description: "A soft moss clearing where trained axolotls wait for the next raid.",
    sprite: "tile-moss",
    size: 4,
    costResource: "kelp",
    isDefense: false,
    maxCount: [1, 2, 2, 3, 3, 4],
    destructionWeight: 1,
    levels: levels(6, (level) => ({
      cost: COSTS.camp[level - 1],
      hp: 260 + 80 * (level - 1),
      housing: [20, 30, 40, 50, 65, 80][level - 1],
    })),
  },
  sovereignThrone: {
    kind: "sovereignThrone",
    name: "Sovereign Throne",
    description: "A gilded spring that summons the Supreme Axolotl, your village hero.",
    sprite: "bld-pondheart",
    size: 3,
    costResource: "kelp",
    isDefense: false,
    maxCount: [0, 0, 1, 1, 1, 1],
    destructionWeight: 1,
    levels: levels(1, () => ({
      cost: 5000,
      buildTimeMs: 60_000,
      hp: 800,
    })),
  },
  spellSpring: {
    kind: "spellSpring",
    name: "Spell Spring",
    description: "Brews battle spells from charged pond water. Higher levels hold more.",
    sprite: "bld-storage",
    size: 3,
    costResource: "kelp",
    isDefense: false,
    maxCount: [0, 0, 1, 1, 1, 1],
    destructionWeight: 1,
    levels: levels(6, (level) => ({
      cost: geometric(800, 2.4, 6)[level - 1],
      hp: 340 + 120 * (level - 1),
      /** housing here = spell storage capacity. */
      housing: Math.min(4, 1 + Math.floor(level / 2)),
    })),
  },
  lab: {
    kind: "lab",
    name: "Glow Lab",
    description: "Research stronger morphs. Each lab level raises the troop level cap.",
    sprite: "bld-workshop",
    size: 2,
    costResource: "kelp",
    isDefense: false,
    maxCount: [0, 1, 1, 1, 1, 1],
    destructionWeight: 1,
    levels: levels(6, (level) => ({
      cost: geometric(500, 2.5, 6)[level - 1],
      hp: 300 + 110 * (level - 1),
    })),
  },
  workshop: {
    kind: "workshop",
    name: "Builder Workshop",
    description: "Each workshop houses one builder crew. More crews, more parallel projects.",
    sprite: "bld-workshop",
    size: 2,
    costResource: "shards",
    isDefense: false,
    maxCount: [1, 2, 2, 3, 3, 3],
    destructionWeight: 1,
    levels: levels(1, () => ({
      cost: 0, // real cost comes from WORKSHOP_COSTS by count
      buildTimeMs: 15_000,
      hp: 250,
    })),
  },
  bubbleGeyser: {
    kind: "bubbleGeyser",
    name: "Bubble Geyser",
    description: "A pressurised spring that blasts single raiders with scalding bubbles.",
    sprite: "res-water",
    size: 3,
    costResource: "shards",
    isDefense: true,
    maxCount: [0, 1, 2, 2, 3, 4],
    destructionWeight: 1,
    levels: levels(6, (level) => ({
      cost: COSTS.geyser[level - 1],
      hp: 420 + 160 * (level - 1),
      dps: 9 + 4 * (level - 1),
      rangeTiles: 4.5,
      attackPeriodMs: 1000,
    })),
  },
  crystalSpire: {
    kind: "crystalSpire",
    name: "Crystal Spire",
    description: "A charged glowshard spire that snipes raiders from far away.",
    sprite: "res-glowshards",
    size: 2,
    costResource: "shards",
    isDefense: true,
    maxCount: [0, 0, 1, 2, 3, 4],
    destructionWeight: 1,
    levels: levels(6, (level) => ({
      cost: COSTS.spire[level - 1],
      hp: 360 + 140 * (level - 1),
      dps: 7 + 3 * (level - 1),
      rangeTiles: 6,
      attackPeriodMs: 600,
    })),
  },
  elderDen: {
    kind: "elderDen",
    name: "Elder Den",
    description: "A wise elder hurls slow, devastating splashes at clustered raiders.",
    sprite: "elder",
    size: 3,
    costResource: "shards",
    isDefense: true,
    maxCount: [0, 0, 0, 1, 2, 3],
    destructionWeight: 1,
    levels: levels(6, (level) => ({
      cost: COSTS.den[level - 1],
      hp: 520 + 180 * (level - 1),
      dps: 12 + 5 * (level - 1),
      rangeTiles: 4,
      attackPeriodMs: 1500,
      splashRadiusTiles: 1.3,
    })),
  },
  mudspitter: {
    kind: "mudspitter",
    name: "Mudspitter",
    description: "Lobs heavy mud globs across the pond. Devastating far away, blind up close.",
    sprite: "res-clay",
    size: 3,
    costResource: "shards",
    isDefense: true,
    maxCount: [0, 0, 1, 1, 2, 2],
    destructionWeight: 1,
    levels: levels(6, (level) => ({
      cost: geometric(900, 2.5, 6)[level - 1],
      hp: 450 + 150 * (level - 1),
      dps: 11 + 4 * (level - 1),
      rangeTiles: 9,
      minRangeTiles: 3,
      attackPeriodMs: 4000,
      splashRadiusTiles: 1.5,
    })),
  },
  tideTrap: {
    kind: "tideTrap",
    name: "Tide Trap",
    description: "A buried surge charge. Invisible to raiders until it erupts — once.",
    sprite: "res-water",
    size: 1,
    costResource: "kelp",
    isDefense: false,
    isTrap: true,
    maxCount: [0, 2, 3, 4, 5, 6],
    destructionWeight: 0,
    levels: [
      { cost: 150, buildTimeMs: 0, hp: 1, trapDamage: 120, splashRadiusTiles: 1.8 },
      { cost: 600, buildTimeMs: 0, hp: 1, trapDamage: 220, splashRadiusTiles: 1.9 },
      { cost: 2000, buildTimeMs: 0, hp: 1, trapDamage: 360, splashRadiusTiles: 2.0 },
    ],
  },
  wall: {
    kind: "wall",
    name: "Canal Wall",
    description: "Stone canal segments that slow raiders down. Upgrades are instant.",
    sprite: "bld-canal",
    size: 1,
    costResource: "shards",
    isDefense: false,
    maxCount: [0, 25, 50, 75, 100, 125],
    destructionWeight: 0,
    levels: [
      { cost: 25, buildTimeMs: 0, hp: 300 },
      { cost: 200, buildTimeMs: 0, hp: 900 },
      { cost: 1000, buildTimeMs: 0, hp: 2700 },
    ],
  },
};

/** Pearl cost of the Nth workshop (index = number already owned) — gems in CoC. */
export const WORKSHOP_PEARL_COSTS = [0, 250, 500];

// ── Tadpole workers ───────────────────────────────────────────────────────

export const WORKER_NAMES = ["Squirt", "Bubbles", "Pip", "Mudge", "Sprout", "Dot"];
export const MAX_WORKER_LEVEL = 5;
/** Shards to reach level index+2 (level 2 costs 150, … level 5 costs 2500). */
export const WORKER_UPGRADE_COSTS = [150, 400, 1000, 2500];

/** Construction speed multiplier: level 5 tadpoles build ~60% faster. */
export function workerSpeedMultiplier(level: number): number {
  return 1 + 0.15 * (Math.max(1, level) - 1);
}

export function workerUpgradeCost(level: number): number {
  return WORKER_UPGRADE_COSTS[level - 1] ?? Number.POSITIVE_INFINITY;
}

export const WORKER_SPRITE = "/civ/stages/baby.png";

// ── Pearls (premium currency) ─────────────────────────────────────────────

export const STARTING_PEARLS = 30;

/** Pearls to finish a running timer instantly: ~1 pearl per 3 minutes. */
export function finishNowCost(remainingMs: number): number {
  return Math.max(1, Math.ceil(remainingMs / (3 * 60 * 1000)));
}

/** Pearls earned for an attack: one per star, doubled on a 3-star. */
export function battlePearls(stars: number): number {
  return stars >= 3 ? 6 : stars;
}

// ── Research (Glow Lab) ───────────────────────────────────────────────────

export const MAX_TROOP_LEVEL = 5;
/** hp/dps/heal multiply by this per troop level above 1. */
export const TROOP_LEVEL_GROWTH = 1.18;

export function troopLevelCap(labLevel: number): number {
  return labLevel === 0 ? 1 : Math.min(MAX_TROOP_LEVEL, labLevel + 1);
}

export function researchCost(troop: TroopKind, toLevel: number): number {
  return Math.round(TROOPS[troop].cost * 10 * 2.2 ** (toLevel - 2));
}

const RESEARCH_TIMES_S = [90, 480, 1800, 5400];

export function researchTimeMs(toLevel: number): number {
  return (RESEARCH_TIMES_S[toLevel - 2] ?? RESEARCH_TIMES_S[RESEARCH_TIMES_S.length - 1]) * 1000;
}

export function troopStatMultiplier(level: number): number {
  return TROOP_LEVEL_GROWTH ** (Math.max(1, level) - 1);
}

// ── Obstacles ─────────────────────────────────────────────────────────────

export interface ObstacleConfig {
  kind: ObstacleKind;
  name: string;
  sprite: string;
  size: number;
  clearCost: number;
  clearTimeMs: number;
  rewardKelp: number;
  /** Pearls granted on clear (CoC-style gem drip). */
  rewardPearls: number;
}

export const OBSTACLES: Record<ObstacleKind, ObstacleConfig> = {
  driftwood: {
    kind: "driftwood",
    name: "Driftwood",
    sprite: "res-wood",
    size: 2,
    clearCost: 60,
    clearTimeMs: 10_000,
    rewardKelp: 30,
    rewardPearls: 1,
  },
  boulder: {
    kind: "boulder",
    name: "Mossy Boulder",
    sprite: "res-stone",
    size: 2,
    clearCost: 120,
    clearTimeMs: 15_000,
    rewardKelp: 50,
    rewardPearls: 2,
  },
  glowbloom: {
    kind: "glowbloom",
    name: "Glowbloom",
    sprite: "tile-crystal",
    size: 2,
    clearCost: 200,
    clearTimeMs: 20_000,
    rewardKelp: 80,
    rewardPearls: 4,
  },
};

export const OBSTACLE_SPAWN_INTERVAL_MS = 6 * 3600 * 1000;
export const MAX_OBSTACLES = 6;

// ── Hero (Supreme Axolotl) ────────────────────────────────────────────────

export const HERO_CROWN_SPRITE = "/civ/accessories/acc-crown.png";
/** Regeneration after being knocked out in a raid. */
export const HERO_REGEN_MS = 10 * 60 * 1000;

/** Hero level cap scales with the Pondheart, like CoC hero/TH gating. */
export function heroLevelCap(townHallLevel: number): number {
  return Math.max(2, townHallLevel * 2);
}

export function heroUpgradeCost(toLevel: number): number {
  return Math.round(1500 * 1.6 ** (toLevel - 2));
}

const HERO_UPGRADE_TIMES_S = [120, 300, 900, 1800, 3600, 5400, 7200, 10800, 14400, 21600, 28800];

export function heroUpgradeTimeMs(toLevel: number): number {
  return (
    (HERO_UPGRADE_TIMES_S[toLevel - 2] ?? HERO_UPGRADE_TIMES_S[HERO_UPGRADE_TIMES_S.length - 1]) *
    1000
  );
}

/** Sovereign Wrath: fires once when the hero drops low. */
export const HERO_ABILITY = {
  triggerHpFraction: 0.4,
  healFraction: 0.35,
  rageMs: 5000,
  damageMultiplier: 2,
};

// ── Spells ────────────────────────────────────────────────────────────────

export interface SpellConfig {
  kind: SpellKind;
  name: string;
  description: string;
  /** Icon shown on cards and as the casting ghost. */
  icon: string;
  cost: number;
  brewTimeMs: number;
  radiusTiles: number;
  durationMs: number;
  /** Heal spell: HP restored per second to troops in the radius. */
  healPerSec?: number;
  /** Surge spell: damage and speed multipliers for troops in the radius. */
  damageMultiplier?: number;
  speedMultiplier?: number;
  /** Spell Spring level required to brew. */
  unlockLevel: number;
}

export const SPELLS: Record<SpellKind, SpellConfig> = {
  heal: {
    kind: "heal",
    name: "Heal Rain",
    description: "A soothing drizzle that mends every axolotl beneath it.",
    icon: "/civ/resources/res-water.png",
    cost: 400,
    brewTimeMs: 60_000,
    radiusTiles: 3.2,
    durationMs: 5_000,
    healPerSec: 55,
    unlockLevel: 1,
  },
  surge: {
    kind: "surge",
    name: "Tide Surge",
    description: "A crackling current that makes raiders hit harder and swim faster.",
    icon: "/civ/resources/res-glowshards.png",
    cost: 600,
    brewTimeMs: 90_000,
    radiusTiles: 3.2,
    durationMs: 7_000,
    damageMultiplier: 1.6,
    speedMultiplier: 1.5,
    unlockLevel: 2,
  },
};

export const SPELL_ORDER: SpellKind[] = ["heal", "surge"];

// ── Battle QoL ────────────────────────────────────────────────────────────

/** Shards to skip the current enemy and scout another pond. */
export function nextEnemyCost(enemyTownHallLevel: number): number {
  return 20 * enemyTownHallLevel;
}

/** Max level a non-Pondheart building may reach at a given Pondheart level. */
export function maxBuildingLevel(kind: BuildingKind, townHallLevel: number): number {
  const config = BUILDINGS[kind];
  if (kind === "pondheart") return config.levels.length;
  return Math.min(config.levels.length, townHallLevel);
}

// ── Troops ────────────────────────────────────────────────────────────────

export interface TroopConfig {
  kind: TroopKind;
  name: string;
  description: string;
  sprite: string;
  housing: number;
  cost: number;
  trainTimeMs: number;
  hp: number;
  dps: number;
  rangeTiles: number;
  speedTilesPerSec: number;
  preference: TargetPreference;
  splashRadiusTiles?: number;
  /** Healers: HP restored per second instead of damage dealt. */
  healPerSec?: number;
  /** Hatchery level required to train. */
  unlockLevel: number;
  /** Damage multiplier against resource buildings (Pilfer's specialty). */
  lootMultiplier?: number;
  /** Wall-breakers: dies on its first attack, which is one huge blast. */
  suicide?: boolean;
  /** Damage multiplier when the blast hits walls (Boomtail's specialty). */
  wallDamageMultiplier?: number;
}

export const TROOPS: Record<TroopKind, TroopConfig> = {
  wildling: {
    kind: "wildling",
    name: "Wildling",
    description: "A scrappy wild-type brawler. Cheap, fast to hatch, fearless.",
    sprite: "axo-wild",
    housing: 1,
    cost: 30,
    trainTimeMs: 8_000,
    hp: 95,
    dps: 14,
    rangeTiles: 0.7,
    speedTilesPerSec: 2.0,
    preference: "any",
    unlockLevel: 1,
  },
  finling: {
    kind: "finling",
    name: "Finling",
    description: "A golden sharpshooter that spits pond pebbles from range.",
    sprite: "axo-gold",
    housing: 1,
    cost: 50,
    trainTimeMs: 10_000,
    hp: 48,
    dps: 11,
    rangeTiles: 3.5,
    speedTilesPerSec: 2.2,
    preference: "any",
    unlockLevel: 2,
  },
  pilfer: {
    kind: "pilfer",
    name: "Pilfer",
    description: "A pale little thief that beelines for farms, mines and storages.",
    sprite: "axo-leucistic",
    housing: 1,
    cost: 40,
    trainTimeMs: 9_000,
    hp: 62,
    dps: 10,
    rangeTiles: 0.7,
    speedTilesPerSec: 2.8,
    preference: "resources",
    lootMultiplier: 2,
    unlockLevel: 3,
  },
  boomtail: {
    kind: "boomtail",
    name: "Boomtail",
    description: "An axanthic daredevil hauling a glowshard charge. Blasts walls open — once.",
    sprite: "axo-axanthic",
    housing: 2,
    cost: 120,
    trainTimeMs: 15_000,
    hp: 70,
    dps: 30,
    rangeTiles: 0.7,
    speedTilesPerSec: 2.4,
    preference: "walls",
    splashRadiusTiles: 1.4,
    suicide: true,
    wallDamageMultiplier: 40,
    unlockLevel: 3,
  },
  pebbleback: {
    kind: "pebbleback",
    name: "Pebbleback",
    description: "A melanoid bruiser that shrugs off hits and smashes defenses first.",
    sprite: "axo-melanoid",
    housing: 5,
    cost: 250,
    trainTimeMs: 30_000,
    hp: 720,
    dps: 22,
    rangeTiles: 0.8,
    speedTilesPerSec: 1.2,
    preference: "defenses",
    unlockLevel: 4,
  },
  riptide: {
    kind: "riptide",
    name: "Riptide",
    description: "A cool-headed blue marksman that picks off defenses from way out.",
    sprite: "axo-blue",
    housing: 3,
    cost: 200,
    trainTimeMs: 20_000,
    hp: 90,
    dps: 16,
    rangeTiles: 5.5,
    speedTilesPerSec: 1.8,
    preference: "defenses",
    unlockLevel: 4,
  },
  sparkfin: {
    kind: "sparkfin",
    name: "Sparkfin",
    description: "A firefly morph crackling with energy. Splash damage from range.",
    sprite: "axo-firefly",
    housing: 4,
    cost: 350,
    trainTimeMs: 30_000,
    hp: 135,
    dps: 30,
    rangeTiles: 3,
    speedTilesPerSec: 1.7,
    preference: "any",
    splashRadiusTiles: 1.1,
    unlockLevel: 5,
  },
  glowmender: {
    kind: "glowmender",
    name: "Glowmender",
    description: "A gentle GFP healer that keeps the raiding party glowing.",
    sprite: "axo-gfp",
    housing: 5,
    cost: 500,
    trainTimeMs: 40_000,
    hp: 240,
    dps: 0,
    healPerSec: 35,
    rangeTiles: 2.5,
    speedTilesPerSec: 1.6,
    preference: "any",
    unlockLevel: 5,
  },
  tidelord: {
    kind: "tidelord",
    name: "Tidelord",
    description: "A mystic leviathan-in-miniature. Very slow, very unstoppable.",
    sprite: "axo-mystic",
    housing: 10,
    cost: 1200,
    trainTimeMs: 90_000,
    hp: 2600,
    dps: 120,
    rangeTiles: 0.9,
    speedTilesPerSec: 1.1,
    preference: "any",
    unlockLevel: 6,
  },
  // The hero. Never trainable (unlockLevel 99) — summoned at the Sovereign
  // Throne and carried into battle outside the housing budget.
  sovereign: {
    kind: "sovereign",
    name: "Supreme Axolotl",
    description: "Your crowned champion. Wades into battle and rages when wounded.",
    sprite: "axo-piebald",
    housing: 0,
    cost: 0,
    trainTimeMs: 0,
    hp: 650,
    dps: 50,
    rangeTiles: 0.8,
    speedTilesPerSec: 1.6,
    preference: "any",
    unlockLevel: 99,
  },
};

export const TROOP_ORDER: TroopKind[] = [
  "wildling",
  "finling",
  "pilfer",
  "boomtail",
  "pebbleback",
  "riptide",
  "sparkfin",
  "glowmender",
  "tidelord",
];

// ── Asset paths ───────────────────────────────────────────────────────────

const BUILDING_SPRITES: Record<string, string> = {
  "bld-pondheart": "/civ/buildings/bld-pondheart.png",
  "bld-farm": "/civ/buildings/bld-farm.png",
  "bld-storage": "/civ/buildings/bld-storage.png",
  "bld-nest": "/civ/buildings/bld-nest.png",
  "bld-workshop": "/civ/buildings/bld-workshop.png",
  "bld-canal": "/civ/buildings/bld-canal.png",
  "res-glowshards": "/civ/resources/res-glowshards.png",
  "res-water": "/civ/resources/res-water.png",
  "res-wood": "/civ/resources/res-wood.png",
  "res-stone": "/civ/resources/res-stone.png",
  "res-clay": "/civ/resources/res-clay.png",
  "tile-moss": "/civ/tiles/tile-moss.png",
  "tile-crystal": "/civ/tiles/tile-crystal.png",
  elder: "/civ/stages/elder.png",
};

export const PEARL_ICON = "/civ/stages/egg-single.png";

export function buildingSpritePath(sprite: string): string {
  return BUILDING_SPRITES[sprite] ?? `/civ/buildings/${sprite}.png`;
}

export function troopSpritePath(kind: TroopKind): string {
  return `/civ/axolotls/${TROOPS[kind].sprite}.png`;
}

export const RESOURCE_ICONS: Record<ResourceKind, string> = {
  kelp: "/civ/resources/res-fiber.png",
  shards: "/civ/resources/res-glowshards.png",
};

export const TILE_TEXTURES = {
  ground: "/civ/tiles/tile-moss.png",
  shore: "/civ/tiles/tile-sand.png",
  water: "/civ/tiles/tile-water.png",
  deepwater: "/civ/tiles/tile-deepwater.png",
} as const;
