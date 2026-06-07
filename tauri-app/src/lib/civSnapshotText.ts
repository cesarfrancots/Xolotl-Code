import type { CivSessionSnapshot } from "../bindings";
import { primaryCiv } from "../stores/civStore";
import { activeCivPlayerTask } from "./civPlayerTasks";

export type CivTextPlayerTool = "use" | "mine" | "build";

export type CivTextPlayerInteraction = {
  entityId: string;
  kind: "resource" | "building" | "npc" | "terrain" | "object" | "empty";
  action?: "mine_tile" | "place_tile" | "repair_object" | "rescue_object";
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
  locked?: boolean;
  cycle_index?: number;
  cycle_count?: number;
};

export type CivPlayerTextState = {
  possessedEntityId: string | null;
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

export function renderSnapshotToText(snapshot: CivSessionSnapshot, playerState?: CivPlayerTextState): string {
  const civ = primaryCiv(snapshot);
  const possessedPlayer = playerState?.possessedEntityId && playerState.player
    ? { id: playerState.possessedEntityId, player: playerState.player }
    : null;
  return JSON.stringify({
    coordinate_system: "origin top-left; x right; y down; tiles are 16px",
    session: { id: snapshot.id, turn: snapshot.turn, model: civ.model ?? "unknown" },
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
    player: playerState ?? {
      possessedEntityId: null,
      control_mode: "released",
      pilot_active: false,
      player_tool: "use",
      player: null,
      active_target: null,
      target_lock: null,
      lastInteraction: null,
      nearby_interactions: [],
      task_interactions: [],
    },
    player_task: activeCivPlayerTask(snapshot, civ),
    visible_entities: snapshot.world.entities.map((entity) => {
      const livePlayer = possessedPlayer?.id === entity.id ? possessedPlayer.player : null;
      return {
        id: entity.id,
        name: entity.name,
        kind: entity.kind,
        role: entity.role,
        morph: entity.morph,
        pattern: entity.pattern,
        stage: entity.stage,
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
