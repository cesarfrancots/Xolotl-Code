// Pondfall — core data model for the axolotl base-builder.
//
// Everything in this file is plain serialisable data: the whole game state
// round-trips through JSON for localStorage persistence, so no class
// instances, Maps, or functions live here.

export type ResourceKind = "kelp" | "shards";

export type BuildingKind =
  | "pondheart"
  | "kelpFarm"
  | "shardMine"
  | "kelpVat"
  | "shardVault"
  | "hatchery"
  | "armyCamp"
  | "workshop"
  | "lab"
  | "spellSpring"
  | "sovereignThrone"
  | "bubbleGeyser"
  | "crystalSpire"
  | "elderDen"
  | "mudspitter"
  | "tideTrap"
  | "wall";

export type ObstacleKind = "driftwood" | "boulder" | "glowbloom";

export type SpellKind = "heal" | "surge";

export interface BrewJob {
  spell: SpellKind;
  finishesAt: number;
}

/** A spell effect active on the battlefield. */
export interface ActiveSpell {
  kind: SpellKind;
  x: number;
  y: number;
  expiresAt: number;
}

export interface ObstacleState {
  id: string;
  kind: ObstacleKind;
  x: number;
  y: number;
  /** Set while a builder crew is clearing it. */
  clearingUntil: number | null;
  /** Workshop id of the tadpole doing the clearing. */
  clearingWorkerId?: string | null;
}

export type TroopKind =
  | "wildling"
  | "finling"
  | "pilfer"
  | "boomtail"
  | "pebbleback"
  | "riptide"
  | "sparkfin"
  | "glowmender"
  | "tidelord"
  | "sovereign";

/** The Supreme Axolotl — the village hero summoned at the Sovereign Throne. */
export interface HeroState {
  level: number;
  upgradeJob: { toLevel: number; startedAt: number; finishesAt: number } | null;
  /** Knocked out in battle: unavailable until this timestamp. */
  regenUntil: number;
}

export type TargetPreference = "any" | "defenses" | "resources" | "walls";

/** A tadpole builder living in a Builder Workshop. */
export interface WorkerState {
  name: string;
  /** 1-5; higher levels finish construction faster. */
  level: number;
}

export interface ConstructionJob {
  /** Level the building reaches when the job finishes (1 = initial build). */
  toLevel: number;
  startedAt: number;
  finishesAt: number;
  /** Workshop id of the tadpole crew working this job. */
  workerId?: string;
}

export interface BuildingState {
  id: string;
  kind: BuildingKind;
  /** Current operational level. 0 while the initial construction runs. */
  level: number;
  /** Top-left tile of the footprint. */
  x: number;
  y: number;
  job: ConstructionJob | null;
  /** Collectors only: timestamp production was last collected from. */
  collectedAt?: number;
  /** Workshops only: the resident tadpole builder. */
  worker?: WorkerState | null;
}

export interface TrainingJob {
  troop: TroopKind;
  finishesAt: number;
}

export interface ResearchJob {
  troop: TroopKind;
  toLevel: number;
  startedAt: number;
  finishesAt: number;
}

export interface RaidReport {
  id: string;
  at: number;
  attackerName: string;
  /** Positive numbers: what the defender lost. */
  lostKelp: number;
  lostShards: number;
  trophyDelta: number;
  defended: boolean;
}

export interface VillageState {
  version: number;
  name: string;
  createdAt: number;
  /** Updated on every save; drives away-time (offline raid) simulation. */
  lastSeenAt: number;
  resources: Record<ResourceKind, number>;
  /** Premium currency (gems equivalent). Not capped by storages. */
  pearls: number;
  trophies: number;
  buildings: BuildingState[];
  obstacles: ObstacleState[];
  /** Timestamp of the last obstacle spawn check. */
  lastObstacleAt: number;
  army: Partial<Record<TroopKind, number>>;
  /** Troop research levels from the Glow Lab; absent = level 1. */
  research: Partial<Record<TroopKind, number>>;
  researchJob: ResearchJob | null;
  /** The Supreme Axolotl; null until the Sovereign Throne is built. */
  hero: HeroState | null;
  /** Brewed spells ready to take into battle. */
  spells: Partial<Record<SpellKind, number>>;
  /** Sequential brewing queue at the Spell Spring. */
  brewQueue: BrewJob[];
  /** Sequential training queue; head trains first. */
  trainQueue: TrainingJob[];
  shieldUntil: number;
  raidLog: RaidReport[];
  battlesWon: number;
  battlesLost: number;
  nextId: number;
}

// ── Battle ────────────────────────────────────────────────────────────────

export interface BattleBuilding {
  id: string;
  kind: BuildingKind;
  level: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Loot granted to the attacker when this building falls. */
  loot: Record<ResourceKind, number>;
  destroyed: boolean;
  /** Defenses only: ms until the next shot is ready. */
  cooldownMs: number;
}

export interface BattleTroop {
  id: string;
  kind: TroopKind;
  /** Research level; scales hp/dps/heal. */
  level: number;
  /** Continuous tile coordinates (not snapped to the grid). */
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Building id (or troop id for healers) currently targeted. */
  targetId: string | null;
  cooldownMs: number;
  dead: boolean;
  /** Heroes: Sovereign Wrath fired (once per battle). */
  abilityUsed?: boolean;
  /** Heroes: remaining rage time from the ability. */
  rageMsLeft?: number;
}

/** Transient combat events of one tick, for the renderer to animate. */
export interface BattleEvent {
  type: "shot" | "heal" | "destroyed" | "deploy";
  fromId?: string;
  toId?: string;
  x?: number;
  y?: number;
}

export interface BattleState {
  enemyName: string;
  enemyTownHallLevel: number;
  /** Trophy stakes: gained on win, lost on defeat. */
  trophyReward: number;
  trophyRisk: number;
  buildings: BattleBuilding[];
  troops: BattleTroop[];
  /** Troops still in hand, deployable. */
  reserve: Partial<Record<TroopKind, number>>;
  /** Research levels of the attacking army. */
  troopLevels: Partial<Record<TroopKind, number>>;
  /** Spells still in hand. */
  spellReserve: Partial<Record<SpellKind, number>>;
  /** Spells currently affecting the battlefield. */
  activeSpells: ActiveSpell[];
  timeLeftMs: number;
  /** 0..100, walls excluded. */
  destructionPct: number;
  stars: number;
  lootWon: Record<ResourceKind, number>;
  events: BattleEvent[];
  ended: boolean;
  /** Set once ended: did the attack earn at least one star? */
  victory: boolean;
  nextTroopId: number;
}
