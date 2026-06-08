import type { CivSessionSnapshot } from "../bindings";
import { primaryCiv } from "../stores/civStore";
import { activeCivPlayerTask } from "./civPlayerTasks";
import {
  axolotlLevel,
  axolotlRarity,
  EGG_INCUBATE_FOOD_COST,
  EGG_INCUBATE_PEARL_COST,
  genePotential,
  hatchProgressPercent,
  hatchTurnsRemaining,
  isEggEntity,
  rarityLabel,
} from "./civCreatureProgression";

export type CivTextPlayerTool = "use" | "mine" | "build";
export type CivTextViewMode = "play" | "observe" | "god";
export type CivAxoActionAnimation =
  | "idle"
  | "swim"
  | "walk"
  | "mine"
  | "gather"
  | "build"
  | "repair"
  | "rescue"
  | "feed"
  | "talk"
  | "hatch"
  | "dash"
  | "jump"
  | "wall_slide"
  | "rest"
  | "play"
  | "eat"
  | "use";

export type CivTextPlayerInteraction = {
  entityId: string;
  kind: "resource" | "building" | "npc" | "terrain" | "object" | "empty";
  action?: "mine_tile" | "place_tile" | "repair_object" | "rescue_object" | "feed_hatchling";
  label: string;
  x: number;
  y: number;
  tileX?: number;
  tileY?: number;
  amount?: number;
  distance?: number;
  targetId?: string;
  resource?: string;
  terrain?: string;
  buildResource?: string;
  yieldsResource?: string;
  objectRole?: string;
  stage?: string;
  locked?: boolean;
  cycle_index?: number;
  cycle_count?: number;
};

export type CivPlayerTextState = {
  possessedEntityId: string | null;
  view_mode?: CivTextViewMode;
  control_mode?: "released" | "manual" | "codex";
  pilot_active?: boolean;
  player_tool: CivTextPlayerTool;
  player: {
    x: number;
    y: number;
    tile_x: number;
    tile_y: number;
    activity: string;
    locomotion?: "swim" | "grounded" | "jump" | "wall_slide";
    animation?: CivAxoActionAnimation;
    action_ms_remaining?: number;
    floor_y?: number;
    wall_contact?: CivPlayerWallContactState | null;
    velocity_x?: number;
    velocity_y?: number;
    jump_velocity_y?: number;
    jump_buffer_ms?: number;
    coyote_ms?: number;
    dash_ready?: boolean;
    dash_cooldown_ms?: number;
    blocked?: CivPlayerBlockState | null;
    hazard_contact?: CivPlayerHazardState | null;
    oxygen?: CivPlayerOxygenState;
  } | null;
  animated_entities?: {
    id: string;
    x: number;
    y: number;
    tile_x: number;
    tile_y: number;
    activity: string;
    animation: CivAxoActionAnimation;
    target_x?: number;
    target_y?: number;
    target_kind?: string;
    moving: boolean;
  }[];
  active_target?: CivTextPlayerInteraction | null;
  target_lock?: CivPlayerTargetLockState | null;
  lastInteraction: CivTextPlayerInteraction | null;
  nearby_interactions: CivTextPlayerInteraction[];
  task_interactions: CivTextPlayerInteraction[];
};

export type CivPlayerTargetLockState = {
  key: string;
  kind: CivTextPlayerInteraction["kind"];
  label: string;
  targetId?: string;
  action?: CivTextPlayerInteraction["action"];
  index: number;
  count: number;
};

export type CivPlayerHazardState = {
  id: string;
  label: string;
  role: string;
  x: number;
  y: number;
  tile_x: number;
  tile_y: number;
  distance: number;
  severity: number;
};

export type CivPlayerOxygenState = {
  value: number;
  max: number;
  status: "stable" | "recovering" | "draining" | "low" | "critical";
  in_pocket: boolean;
  source: string | null;
};

export type CivPlayerBlockState = {
  x: number;
  y: number;
  tile_x: number;
  tile_y: number;
  reason: "solid_tile" | "steep_rise";
  age_ms?: number;
};

export type CivPlayerWallContactState = {
  direction: -1 | 1;
  x: number;
  y: number;
  tile_x: number;
  tile_y: number;
  age_ms?: number;
};

export function renderSnapshotToText(
  snapshot: CivSessionSnapshot,
  playerState?: CivPlayerTextState,
  viewMode: CivTextViewMode = "play",
): string {
  const civ = primaryCiv(snapshot);
  const possessedPlayer = playerState?.possessedEntityId && playerState.player
    ? { id: playerState.possessedEntityId, player: playerState.player }
    : null;
  const deathEvents = (snapshot.log ?? []).filter((entry) => (
    /\b(died|death|dead|collapsed|failure|failed|starved|perished)\b/i.test(`${entry.title} ${entry.body}`)
  )).length;
  const failedCivs = (snapshot.civs ?? []).filter((c) => c.alive === false || (c.population ?? 0) <= 0).length;
  const eggs = snapshot.world.entities.filter((entity) => isEggEntity(entity) && (!entity.civ_id || entity.civ_id === civ.id));
  const hatchlingCareTargets = snapshot.world.entities
    .filter((entity) => entity.kind === "axolotl" && entity.stage === "hatchling" && (!entity.civ_id || entity.civ_id === civ.id))
    .sort((a, b) => {
      const bHatching = (b.activity ?? "") === "hatch" ? 1 : 0;
      const aHatching = (a.activity ?? "") === "hatch" ? 1 : 0;
      return bHatching - aHatching || (a.age ?? 99) - (b.age ?? 99) || a.id.localeCompare(b.id);
    });
  const recentHatchLog = [...(snapshot.log ?? [])].reverse().find((entry) => entry.title === "Eggs hatched") ?? null;
  const recentCareLog = [...(snapshot.log ?? [])].reverse().find((entry) => entry.title === "Hatchling fed") ?? null;
  const recentGrowthLog = [...(snapshot.log ?? [])].reverse().find((entry) => entry.title === "Axolotl grew") ?? null;
  const recentDiscoveryLog = [...(snapshot.log ?? [])].reverse().find((entry) => entry.title === "Rare discovery") ?? null;
  return JSON.stringify({
    coordinate_system: "origin top-left; x right; y down; tiles are 16px",
    session: { id: snapshot.id, turn: snapshot.turn, model: civ.model ?? "unknown", view_mode: playerState?.view_mode ?? viewMode },
    run_tracking: {
      turns_elapsed: snapshot.turn,
      living_civs: Math.max(0, (snapshot.civs ?? []).length - failedCivs),
      failed_civs: failedCivs,
      death_events: deathEvents,
      no_turn_limit: true,
    },
    civilization: {
      id: civ.id,
      era: civ.era,
      population: civ.population,
      health: civ.health,
      morale: civ.morale,
      score: civ.score,
      resources: civ.resources,
      modifiers: snapshot.modifiers.map((modifier) => ({
        kind: modifier.kind,
        polarity: modifier.polarity,
        remaining_turns: modifier.remaining_turns,
      })),
    },
    economy: {
      currency_resource: "pearls",
      pearls: civ.resources?.pearls ?? 0,
      shop_goals: [
        { id: "common_egg", cost: 12 },
        { id: "rare_lure", cost: 10 },
        { id: "rare_egg", cost: 30 },
      ],
      recent_discovery: recentDiscoveryLog ? {
        turn: recentDiscoveryLog.turn,
        body: recentDiscoveryLog.body,
      } : null,
    },
    player: playerState ?? {
      possessedEntityId: null,
      view_mode: viewMode,
      control_mode: "released",
      pilot_active: false,
      player_tool: "use",
      player: null,
      animated_entities: [],
      active_target: null,
      target_lock: null,
      lastInteraction: null,
      nearby_interactions: [],
      task_interactions: [],
    },
    player_task: activeCivPlayerTask(snapshot, civ),
    hatchery: {
      recent_hatch: recentHatchLog ? {
        turn: recentHatchLog.turn,
        body: recentHatchLog.body,
      } : null,
      recent_care: recentCareLog ? {
        turn: recentCareLog.turn,
        body: recentCareLog.body,
      } : null,
      recent_growth: recentGrowthLog ? {
        turn: recentGrowthLog.turn,
        body: recentGrowthLog.body,
      } : null,
      eggs: eggs.map((entity) => {
        const hatchesIn = hatchTurnsRemaining(entity);
        return {
          id: entity.id,
          name: entity.name,
          morph: entity.morph,
          pattern: entity.pattern,
          rarity: axolotlRarity(entity),
          rarity_label: rarityLabel(axolotlRarity(entity)),
          level: axolotlLevel(entity),
          gene_potential: genePotential(entity),
          hatches_in: hatchesIn,
          hatch_progress: hatchProgressPercent(entity),
          incubation_cost: {
            pearls: EGG_INCUBATE_PEARL_COST,
            food: EGG_INCUBATE_FOOD_COST,
          },
          can_incubate: hatchesIn !== null
            && hatchesIn > 1
            && (civ.resources?.pearls ?? 0) >= EGG_INCUBATE_PEARL_COST
            && (civ.resources?.food ?? 0) >= EGG_INCUBATE_FOOD_COST,
          source: (entity.parents ?? []).includes("shop") ? "shop" : "nest",
          x: entity.x,
          y: entity.y,
        };
      }),
      care_targets: hatchlingCareTargets.slice(0, 5).map((entity) => {
        const fedThisTurn = hatchlingFedThisTurn(snapshot, entity.id);
        return {
          id: entity.id,
          name: entity.name,
          rarity: axolotlRarity(entity),
          rarity_label: rarityLabel(axolotlRarity(entity)),
          level: axolotlLevel(entity),
          health: Math.round(entity.health ?? 0),
          mood: Math.round(entity.mood ?? 0),
          activity: entity.activity,
          food_cost: 1,
          fed_this_turn: fedThisTurn,
          can_feed: !fedThisTurn && (civ.resources?.food ?? 0) >= 1,
          x: entity.x,
          y: entity.y,
        };
      }),
    },
    visible_entities: snapshot.world.entities.map((entity) => {
      const livePlayer = possessedPlayer?.id === entity.id ? possessedPlayer.player : null;
      const creature = entity.kind === "axolotl" || isEggEntity(entity);
      return {
        id: entity.id,
        name: entity.name,
        kind: entity.kind,
        role: entity.role,
        morph: entity.morph,
        pattern: entity.pattern,
        stage: entity.stage,
        rarity: creature ? axolotlRarity(entity) : null,
        level: creature ? axolotlLevel(entity) : null,
        gene_potential: creature ? genePotential(entity) : null,
        hatches_in: creature ? hatchTurnsRemaining(entity) : null,
        health: Math.round(entity.health ?? 0),
        sex: entity.sex,
        age: entity.age,
        accessories: entity.accessories,
        activity: livePlayer?.activity ?? entity.activity,
        target_x: entity.target_x,
        target_y: entity.target_y,
        x: livePlayer?.tile_x ?? entity.x,
        y: livePlayer?.tile_y ?? entity.y,
      };
    }),
    civs: (snapshot.civs ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      model: c.model,
      color: c.color,
      alive: c.alive,
      population: c.population,
      era: c.era,
      score: c.score,
      controller: c.controller ?? null,
      resources: c.resources,
    })),
    leaderboard: [...(snapshot.civs ?? [])]
      .sort((a, b) => (b.score.total ?? 0) - (a.score.total ?? 0))
      .map((c) => ({
        id: c.id,
        name: c.name,
        model: c.model,
        color: c.color,
        alive: c.alive,
        score: c.score,
        controller: c.controller ?? null,
      })),
    environment: snapshot.environment,
  });
}

function hatchlingFedThisTurn(snapshot: CivSessionSnapshot, entityId: string) {
  return (snapshot.log ?? []).some((entry) => (
    entry.turn === snapshot.turn
    && entry.title === "Hatchling fed"
    && entry.body.includes(`target=${entityId}`)
  ));
}
