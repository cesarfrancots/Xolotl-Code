import type { CivPlayerTask } from "./civPlayerTasks";

export type CivPilotGoal = "tour" | "task" | "task-loop" | "task-fetch" | "task-trade" | "task-visit" | "task-repair" | "task-rescue" | "task-bridge" | "gather" | "greet" | "return" | "explore";

export type CivPilotTarget = {
  kind: "resource" | "building" | "npc" | "object" | "terrain";
  label: string;
  targetId?: string;
  action?: "mine_tile" | "place_tile" | "repair_object" | "rescue_object";
  resource?: string;
  x: number;
  y: number;
  tileX?: number;
  tileY?: number;
  distance?: number;
  amount?: number;
};

export type CivPilotDecision =
  | { action: "possess"; label: string }
  | { action: "advance_turn"; label: string }
  | { action: "interact"; label: string; target?: CivPilotTarget; tool?: "use" | "mine" | "build" }
  | { action: "move"; label: string; target: CivPilotTarget }
  | { action: "explore"; label: string; vector: { x: number; y: number } };

export type CivPilotCommand =
  | { kind: "move"; label: string; target: { x: number; y: number }; burst?: boolean }
  | { kind: "explore"; label: string; vector: { x: number; y: number } }
  | { kind: "interact"; label: string; nonce: number; target?: CivPilotTarget }
  | null;

export type CivPilotMemory = {
  interactions: Map<string, number>;
  taskCompletedAt?: number;
  oxygenRetreating?: boolean;
  preferredRequesterId?: string;
  loopRequesterCursor?: number;
  loopExhaustedRequesterIds?: Set<string>;
  loopTurn?: number;
  loopAdvanceRequestedAt?: number;
};

const RESCUE_READY_INTERACT_RANGE = 88;
const TASK_LOOP_RALLY_STEPS = 3;

type CivPilotVisibleEntity = {
  id: string;
  name?: string;
  kind: string;
  role?: string;
  morph?: string;
  stage?: string;
  activity?: string;
  target_x?: number | null;
  target_y?: number | null;
  x: number;
  y: number;
};

export type CivPilotTextState = {
  session?: {
    turn?: number;
  };
  player?: {
    possessedEntityId?: string | null;
    player?: {
      x: number;
      y: number;
      tile_x?: number;
      tile_y?: number;
      blocked?: { x?: number; y?: number; tile_x?: number; tile_y?: number; age_ms?: number; reason?: string } | null;
      hazard_contact?: {
        id: string;
        label: string;
        role?: string;
        x: number;
        y: number;
        tile_x: number;
        tile_y: number;
        distance: number;
        severity: number;
      } | null;
      oxygen?: {
        value: number;
        max: number;
        status: "stable" | "recovering" | "draining" | "low" | "critical";
        in_pocket: boolean;
        source: string | null;
      };
    } | null;
    lastInteraction?: CivPilotTarget | null;
    nearby_interactions?: CivPilotTarget[];
    task_interactions?: CivPilotTarget[];
  };
  player_task?: CivPlayerTask | null;
  visible_entities?: CivPilotVisibleEntity[];
  civs?: Array<{
    id: string;
    name: string;
    model: string;
    color: string;
    alive: boolean;
    population: number;
    era: string;
    score: { survival: number; ethics: number; intelligence: number; total: number };
    controller: string | null;
    resources: Record<string, number>;
  }>;
  leaderboard?: Array<{
    id: string;
    name: string;
    model: string;
    color: string;
    alive: boolean;
    score: { survival: number; ethics: number; intelligence: number; total: number };
    controller: string | null;
  }>;
  environment?: unknown;
};

export function createCivPilotMemory(): CivPilotMemory {
  return { interactions: new Map<string, number>() };
}

export function chooseCivPilotDecision(
  state: CivPilotTextState,
  goal: CivPilotGoal,
  stepIndex: number,
  memory: CivPilotMemory,
): CivPilotDecision {
  const player = playerOf(state);
  if (!player) return { action: "possess", label: "possess axolotl" };

  const resources = nearbyOf(state, "resource");
  const npcs = nearbyOf(state, "npc");
  const buildings = nearbyOf(state, "building");
  const taskResources = taskAwareOf(state, "resource");
  const taskBuildings = taskAwareOf(state, "building");
  const taskObjects = taskAwareOf(state, "object");
  const taskTerrain = taskAwareOf(state, "terrain");
  const taskNpcs = taskAwareOf(state, "npc");
  const task = state.player_task ?? null;
  syncLoopTurn(state, memory);
  if (task) {
    memory.loopExhaustedRequesterIds?.clear();
    delete memory.loopAdvanceRequestedAt;
  }
  const oxygenDecision = oxygenRetreatDecision(state, stepIndex, memory);
  if (oxygenDecision) return oxygenDecision;

  if (goal.startsWith("task") || task) {
    if (goal === "task-loop" && !task && typeof memory.loopAdvanceRequestedAt === "number" && stepIndex - memory.loopAdvanceRequestedAt < 12) {
      return exploreDecision(stepIndex, "waiting for next turn");
    }
    if (!task && typeof memory.taskCompletedAt === "number") {
      if (goal === "task-loop" && stepIndex - memory.taskCompletedAt > TASK_LOOP_RALLY_STEPS) {
        delete memory.taskCompletedAt;
        const nextRequesterId = nextLoopRequesterId(state, memory);
        if (nextRequesterId) {
          memory.preferredRequesterId = nextRequesterId;
        } else {
          delete memory.preferredRequesterId;
        }
      } else {
        const escape = blockedEscapeDecision(state, stepIndex, "task done: swim over terrain");
        if (escape) return escape;
        const rally = taskCompleteRallyTarget(state) ?? pondTarget(state);
        if (rally) {
          const distance = rally.distance ?? (player ? distanceFromPlayer(player, rally) : 999);
          return {
            action: "move",
            target: rally,
            label: distance > 56 ? "task done: return to friends" : "task done: hold position",
          };
        }
        return exploreDecision(stepIndex, "task done: patrol pond");
      }
    }
    if (!task) {
      if (goal === "task-loop" && !memory.preferredRequesterId) {
        const nextRequesterId = nextLoopRequesterId(state, memory);
        if (nextRequesterId) memory.preferredRequesterId = nextRequesterId;
      }
      let forced = memory.preferredRequesterId
        ? visibleEntityTarget(state, memory.preferredRequesterId, "npc")
        : null;
      if (goal === "task-loop" && forced && recentlyInteracted(memory, forced, stepIndex, 5)) {
        const exhaustedRequesterId = memory.preferredRequesterId;
        if (exhaustedRequesterId) rememberLoopExhaustedRequester(memory, exhaustedRequesterId);
        if (loopRequestersExhausted(state, memory)) {
          memory.loopAdvanceRequestedAt = stepIndex;
          return { action: "advance_turn", label: "advance turn for more tasks" };
        }
        const nextRequesterId = nextLoopRequesterId(state, memory, exhaustedRequesterId);
        if (nextRequesterId) {
          memory.preferredRequesterId = nextRequesterId;
          forced = visibleEntityTarget(state, nextRequesterId, "npc");
        } else {
          delete memory.preferredRequesterId;
          forced = null;
        }
      }
      const preferred = preferredTaskRequester(state, goal);
      return forced
        ? targetOrExplore(forced, `request task from ${forced.label}`, stepIndex, 34, "use")
        : preferred
        ? targetOrExplore(preferred, "request task", stepIndex, 34, "use")
        : targetOrExplore(nearest(npcs), "request task", stepIndex, undefined, "use");
    }
    if (task.kind === "visit_building") {
      const target = nearest(taskBuildings, (item) => item.targetId === task.buildingId)
        ?? visibleEntityTarget(state, task.buildingId, "building");
      return targetOrExplore(target, `check ${task.buildingName || "building"}`, stepIndex, undefined, "use");
    }
    if (task.kind === "repair_object" && task.status === "ready") {
      const target = nearest(taskObjects, (item) => item.targetId === task.objectId)
        ?? visibleEntityTarget(state, task.objectId, "object");
      return targetOrExplore(target, `repair ${task.objectName || "object"}`, stepIndex, undefined, "use");
    }
    if (task.kind === "rescue_object") {
      if (task.status === "ready") {
        const target = nearest(taskObjects, (item) => item.targetId === task.objectId)
          ?? visibleEntityTarget(state, task.objectId, "object");
        if (target && (target.distance ?? distanceFromPlayer(player, target)) <= RESCUE_READY_INTERACT_RANGE) {
          return { action: "interact", target, label: `rescue ${task.objectName || "axolotl"}`, tool: "use" };
        }
        const blocker = blockedTerrainTarget(state, taskTerrain, target);
        if (blocker) return targetOrExplore(blocker, "mine rescue path", stepIndex, 48, "mine");
        const approachTarget = rescueObjectApproachTarget(player, target);
        if (approachTarget && approachTarget !== target) {
          return { action: "move", target: approachTarget, label: `rescue ${task.objectName || "axolotl"}` };
        }
        return targetOrExplore(target, `rescue ${task.objectName || "axolotl"}`, stepIndex, RESCUE_READY_INTERACT_RANGE, "use");
      }
      const objectTarget = nearest(taskObjects, (item) => item.targetId === task.objectId)
        ?? visibleEntityTarget(state, task.objectId, "object");
      const objectTileX = objectTarget ? Math.floor(objectTarget.x / 16) : null;
      const objectTileY = objectTarget ? Math.floor(objectTarget.y / 16) : null;
      const rescueTiles = objectTileX !== null && objectTileY !== null
        ? rescueRubbleTileKeys(objectTileX, objectTileY)
        : null;
      const rubble = nearest(taskTerrain, (item) => (
        item.action === "mine_tile"
        && rescueTiles !== null
        && rescueTiles.has(`${item.tileX ?? Math.floor(item.x / 16)},${item.tileY ?? Math.floor(item.y / 16)}`)
      ));
      if (rubble) {
        const blocker = blockedTerrainTarget(state, taskTerrain, rubble);
        if (blocker) return targetOrExplore(blocker, "mine rescue path", stepIndex, 48, "mine");
        const trappedSideApproach = objectTarget && rubble.y - player.y > 64 && Math.abs(rubble.x - player.x) < 64
          ? {
              ...rubble,
              action: undefined,
              label: "rescue rubble approach",
              x: objectTarget.x + 42,
              y: Math.max(0, rubble.y - 18),
              distance: Math.hypot(objectTarget.x + 42 - player.x, Math.max(0, rubble.y - 18) - player.y),
            }
          : null;
        if (trappedSideApproach && (trappedSideApproach.distance ?? 999) > 34) {
          return { action: "move", target: trappedSideApproach, label: "reach rescue rubble" };
        }
        return targetOrExplore(rubble, "mine rescue rubble", stepIndex, 48, "mine");
      }
      const approachTarget = objectTarget && objectTarget.y - player.y > 64 && Math.abs(objectTarget.x - player.x) < 26
        ? {
            ...objectTarget,
            label: `${objectTarget.label} approach`,
            x: objectTarget.x + 32,
            distance: Math.hypot(objectTarget.x + 32 - player.x, objectTarget.y - player.y),
          }
        : objectTarget;
      return targetOrExplore(approachTarget, `reach ${task.objectName || "trapped axolotl"}`, stepIndex, 12);
    }
    if (task.kind === "build_bridge") {
      const objectTarget = nearest(taskObjects, (item) => item.targetId === task.objectId)
        ?? visibleEntityTarget(state, task.objectId, "object");
      const objectTileX = objectTarget ? Math.floor(objectTarget.x / 16) : null;
      const objectTileY = objectTarget ? Math.floor(objectTarget.y / 16) : null;
      const bridgeTile = nearest(taskTerrain, (item) => (
        item.action === "place_tile"
        && objectTileX !== null
        && objectTileY !== null
        && item.tileY === objectTileY + 1
        && Math.abs((item.tileX ?? Math.floor(item.x / 16)) - objectTileX) <= 1
      ));
      if (bridgeTile) return targetOrExplore(bridgeTile, "build bridge tile", stepIndex, 60, "build");
      const side = stepIndex % 6 < 3 ? -34 : 34;
      const approachTarget = objectTarget
        ? {
            ...objectTarget,
            label: `${objectTarget.label} approach`,
            x: objectTarget.x + side,
            y: objectTarget.y + 18,
            distance: Math.hypot(objectTarget.x + side - player.x, objectTarget.y + 18 - player.y),
          }
        : null;
      return approachTarget
        ? { action: "move", target: approachTarget, label: `reach ${task.objectName || "bridge gap"}` }
        : exploreDecision(stepIndex, "bridge gap: searching");
    }
    if (task.status === "ready") {
      return targetOrExplore(
        nearest(taskNpcs, (item) => item.targetId === task.npcId) ?? visibleEntityTarget(state, task.npcId, "npc"),
        task.kind === "trade_resource" ? `trade ${resourceLabel(task.resource)}` : `deliver ${resourceLabel(task.resource)}`,
        stepIndex,
        undefined,
        "use",
      );
    }
    const targetResource = nearest(taskResources, (item) => (
      (item.amount ?? 0) > 0
      && (item.resource === task.sourceResource || yieldResource(item.resource ?? "") === task.resource)
    ));
    const blocker = blockedTerrainTarget(state, taskTerrain, targetResource);
    if (blocker) {
      return targetOrExplore(blocker, `mine path to ${resourceLabel(task.sourceResource)}`, stepIndex, 48, "mine");
    }
    return targetOrExplore(targetResource, `gather ${resourceLabel(task.sourceResource)}`, stepIndex, undefined, "use");
  }

  if (goal === "greet") return targetOrExplore(nearest(npcs), "greet", stepIndex, undefined, "use");
  if (goal === "gather") return targetOrExplore(nearest(resources, (item) => (item.amount ?? 0) > 0), "gather", stepIndex, undefined, "use");
  if (goal === "return") {
    const escape = blockedEscapeDecision(state, stepIndex, "swim over terrain");
    if (escape) return escape;
    const closeBuilding = nearest(buildings, (item) => (item.distance ?? 999) <= 42);
    if (closeBuilding && !recentlyInteracted(memory, closeBuilding, stepIndex, 8)) {
      return targetOrExplore(closeBuilding, "use home", stepIndex, undefined, "use");
    }
    if (closeBuilding) return exploreDecision(stepIndex, "patrol home");
    return targetOrExplore(pondTarget(state) ?? nearest(buildings), "return home", stepIndex, undefined, "use");
  }
  if (goal === "explore") return exploreDecision(stepIndex, "explore");

  const closeNpc = nearest(npcs, (item) => (item.distance ?? 999) <= 42 && !recentlyInteracted(memory, item, stepIndex, 8));
  if (closeNpc) return { action: "interact", target: closeNpc, label: `greet ${closeNpc.label}`, tool: "use" };

  const closeResource = nearest(resources, (item) => (
    (item.distance ?? 999) <= 38
    && (item.amount ?? 0) > 0
    && !recentlyInteracted(memory, item, stepIndex, 2)
  ));
  if (closeResource) return { action: "interact", target: closeResource, label: `harvest ${closeResource.label}`, tool: "use" };

  const targetResource = nearest(resources, (item) => (item.amount ?? 0) > 0);
  if (targetResource && ((targetResource.distance ?? 999) < 420 || stepIndex % 9 < 5)) {
    return { action: "move", target: targetResource, label: "seek resource" };
  }
  if (stepIndex % 9 < 7 && npcs.length > 0) {
    return {
      action: "move",
      target: nearest(npcs, (item) => !recentlyInteracted(memory, item, stepIndex, 8)) ?? nearest(npcs)!,
      label: "visit npc",
    };
  }
  return exploreDecision(stepIndex, "explore");
}

export function rememberCivPilotInteraction(memory: CivPilotMemory, item: CivPilotTarget | null | undefined, stepIndex: number) {
  if (!item) return;
  memory.interactions.set(interactionKey(item), stepIndex);
}

export function readCivPilotTextState(): CivPilotTextState | null {
  const raw = window.render_game_to_text?.();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CivPilotTextState;
  } catch {
    return null;
  }
}

export function commandForCivPilotDecision(decision: CivPilotDecision, interactNonce: number): CivPilotCommand {
  if (decision.action === "move") {
    const moveTarget = decision.target.kind === "terrain" && decision.target.action === "mine_tile"
      ? { x: decision.target.x, y: Math.max(0, decision.target.y - 22) }
      : { x: decision.target.x, y: decision.target.y };
    return {
      kind: "move",
      label: decision.label,
      target: moveTarget,
      burst: (decision.target.distance ?? 0) > 220,
    };
  }
  if (decision.action === "explore") return { kind: "explore", label: decision.label, vector: decision.vector };
  if (decision.action === "interact") return { kind: "interact", label: decision.label, nonce: interactNonce, target: decision.target };
  return null;
}

function playerOf(state: CivPilotTextState) {
  return state.player?.player ?? null;
}

function nearbyOf(state: CivPilotTextState, kind: CivPilotTarget["kind"]): CivPilotTarget[] {
  const items = state.player?.nearby_interactions;
  if (!Array.isArray(items)) return [];
  return items.filter((item) => item.kind === kind);
}

function taskHintsOf(state: CivPilotTextState, kind: CivPilotTarget["kind"]): CivPilotTarget[] {
  const items = state.player?.task_interactions;
  if (!Array.isArray(items)) return [];
  return items.filter((item) => item.kind === kind);
}

function taskAwareOf(state: CivPilotTextState, kind: CivPilotTarget["kind"]): CivPilotTarget[] {
  const seen = new Set<string>();
  return [...nearbyOf(state, kind), ...taskHintsOf(state, kind)].filter((item) => {
    const key = interactionKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function nearest(items: CivPilotTarget[], predicate: (item: CivPilotTarget) => boolean = () => true): CivPilotTarget | null {
  return items
    .filter(predicate)
    .sort((a, b) => (a.distance ?? 999999) - (b.distance ?? 999999))[0] ?? null;
}

function distanceFromPlayer(player: NonNullable<ReturnType<typeof playerOf>>, target: CivPilotTarget) {
  return Math.hypot(target.x - player.x, target.y - player.y);
}

function targetOrExplore(
  target: CivPilotTarget | null,
  label: string,
  stepIndex: number,
  interactRangeOverride?: number,
  tool?: "use" | "mine" | "build",
): CivPilotDecision {
  if (!target) return exploreDecision(stepIndex, `${label}: searching`);
  const interactRange = interactRangeOverride ?? (target.kind === "resource" ? 38 : target.kind === "object" ? 46 : 42);
  if ((target.distance ?? 999) <= interactRange) return { action: "interact", target, label, tool };
  return { action: "move", target, label };
}

function rescueObjectApproachTarget(player: NonNullable<ReturnType<typeof playerOf>>, target: CivPilotTarget | null): CivPilotTarget | null {
  if (!target) return null;
  if (target.kind !== "object") return target;
  if (target.y - player.y <= 42 || Math.abs(target.x - player.x) > 160) return target;
  const x = target.x + 42;
  const y = target.y + 8;
  return {
    ...target,
    label: `${target.label} approach`,
    x,
    y,
    distance: Math.hypot(x - player.x, y - player.y),
  };
}

function rescueRubbleTileKeys(objectTileX: number, objectTileY: number) {
  const keys = new Set<string>();
  const shaftX = Math.max(0, objectTileX - 1);
  for (let tileY = Math.max(7, objectTileY - 3); tileY <= objectTileY; tileY += 1) {
    keys.add(`${shaftX},${tileY}`);
  }
  keys.add(`${objectTileX},${objectTileY + 1}`);
  return keys;
}

function blockedTerrainTarget(
  state: CivPilotTextState,
  terrain: CivPilotTarget[],
  target: CivPilotTarget | null,
): CivPilotTarget | null {
  const player = playerOf(state);
  const block = player?.blocked;
  if (!player || !target || !block || typeof block.age_ms !== "number" || block.age_ms > 1200) return null;
  const targetDx = target.x - player.x;
  if (Math.abs(targetDx) < 12) return null;
  const blockX = typeof block.x === "number"
    ? block.x
    : typeof block.tile_x === "number"
      ? block.tile_x * 16 + 8
      : player.x;
  if (Math.sign(blockX - player.x) !== Math.sign(targetDx)) return null;
  const blockTileX = typeof block.tile_x === "number" ? block.tile_x : Math.floor(blockX / 16);
  const blockTileY = typeof block.tile_y === "number" ? block.tile_y : Math.floor((block.y ?? player.y) / 16);
  const direct = nearest(terrain, (item) => (
    item.action === "mine_tile"
    && item.tileX === blockTileX
    && item.tileY === blockTileY
    && (item.distance ?? 999) <= 56
  ));
  if (direct) return direct;
  const x = blockTileX * 16 + 8;
  const y = blockTileY * 16 + 8;
  const distance = Math.hypot(x - player.x, y - player.y);
  if (distance > 72) return null;
  return {
    kind: "terrain",
    action: "mine_tile",
    label: "path blocker",
    targetId: `tile:${blockTileX},${blockTileY}`,
    x,
    y,
    tileX: blockTileX,
    tileY: blockTileY,
    distance,
  };
}

function pondTarget(state: CivPilotTextState): CivPilotTarget | null {
  const entity = (state.visible_entities ?? []).find((item) => item.kind === "building" && item.role === "pond")
    ?? (state.visible_entities ?? []).find((item) => item.kind === "building" && item.role === "nest");
  if (!entity) return null;
  const player = playerOf(state);
  const x = entity.x * 16 + 8;
  const y = entity.y * 16 - 8;
  return {
    kind: "building",
    label: entity.role || entity.id,
    targetId: entity.id,
    x,
    y,
    distance: player ? Math.hypot(x - player.x, y - player.y) : 999,
  };
}

function visibleEntityTarget(state: CivPilotTextState, entityId: string, kind: "npc" | "building" | "object"): CivPilotTarget | null {
  const entity = (state.visible_entities ?? []).find((item) => item.id === entityId);
  if (!entity) return null;
  const player = playerOf(state);
  const x = entity.x * 16 + 8;
  const y = kind === "building" ? entity.y * 16 - 8 : kind === "object" ? entity.y * 16 + 4 : entity.y * 16 + 2;
  return {
    kind,
    label: entity.name || entity.role || entity.id,
    targetId: entity.id,
    x,
    y,
    distance: player ? Math.hypot(x - player.x, y - player.y) : 999,
  };
}

function taskCompleteRallyTarget(state: CivPilotTextState): CivPilotTarget | null {
  const player = playerOf(state);
  const last = state.player?.lastInteraction;
  if (player && last?.kind === "npc") {
    return {
      ...last,
      distance: distanceFromPlayer(player, last),
    };
  }
  const nearbyNpc = nearest(nearbyOf(state, "npc"));
  if (nearbyNpc) return nearbyNpc;
  const possessedId = state.player?.possessedEntityId;
  const friends = (state.visible_entities ?? [])
    .filter((item) => item.kind === "axolotl" && item.stage !== "egg" && item.id !== possessedId)
    .map((item) => visibleEntityTarget(state, item.id, "npc"))
    .filter((item): item is CivPilotTarget => Boolean(item));
  return nearest(friends);
}

function requestKindForEntity(entity: CivPilotVisibleEntity) {
  const morph = entity?.morph ?? "";
  if (entity?.role === "builder") return "bridge";
  if (["gold", "copper", "firefly", "blue", "gfp"].includes(morph)) return "trade";
  if (entity?.role === "elder") return "repair";
  if (entity?.role === "scout") return "rescue";
  if (["melanoid", "axanthic", "mystic"].includes(morph)) return "visit";
  return "fetch";
}

function preferredTaskRequester(state: CivPilotTextState, goal: CivPilotGoal): CivPilotTarget | null {
  const desired = goal === "task-trade" ? "trade" : goal === "task-visit" ? "visit" : goal === "task-fetch" ? "fetch" : goal === "task-repair" ? "repair" : goal === "task-rescue" ? "rescue" : goal === "task-bridge" ? "bridge" : "";
  if (!desired) return null;
  const player = playerOf(state);
  const possessedId = state.player?.possessedEntityId;
  const candidates = (state.visible_entities ?? [])
    .filter((item) => item.kind === "axolotl" && item.stage !== "egg" && item.id !== possessedId)
    .filter((item) => requestKindForEntity(item) === desired)
    .map((item) => {
      const x = item.x * 16 + 8;
      const y = item.y * 16 + 2;
      return {
        kind: "npc" as const,
        label: item.name || item.id,
        targetId: item.id,
        x,
        y,
        distance: player ? Math.hypot(x - player.x, y - player.y) : 999,
      };
    });
  return nearest(candidates);
}

function nextLoopRequesterId(state: CivPilotTextState, memory: CivPilotMemory, excludeId?: string): string | undefined {
  const excluded = new Set(memory.loopExhaustedRequesterIds ?? []);
  if (excludeId) excluded.add(excludeId);
  const candidates = loopRequesterIds(state, excluded);
  if (!candidates.length) return undefined;
  const previous = typeof memory.loopRequesterCursor === "number" ? memory.loopRequesterCursor : -1;
  const next = (previous + 1) % candidates.length;
  memory.loopRequesterCursor = next;
  return candidates[next];
}

function loopRequesterIds(state: CivPilotTextState, excluded: Set<string> = new Set()): string[] {
  const possessedId = state.player?.possessedEntityId;
  return (state.visible_entities ?? [])
    .filter((item) => item.kind === "axolotl" && isLoopTaskRequester(state, item) && item.id !== possessedId)
    .map((item) => item.id)
    .filter((id) => !excluded.has(id))
    .sort((a, b) => a.localeCompare(b));
}

function rememberLoopExhaustedRequester(memory: CivPilotMemory, requesterId: string) {
  if (!memory.loopExhaustedRequesterIds) memory.loopExhaustedRequesterIds = new Set();
  memory.loopExhaustedRequesterIds.add(requesterId);
}

function loopRequestersExhausted(state: CivPilotTextState, memory: CivPilotMemory) {
  return loopRequesterIds(state, new Set(memory.loopExhaustedRequesterIds ?? [])).length === 0;
}

function syncLoopTurn(state: CivPilotTextState, memory: CivPilotMemory) {
  const turn = state.session?.turn;
  if (typeof turn !== "number" || memory.loopTurn === turn) return;
  memory.loopTurn = turn;
  memory.loopExhaustedRequesterIds?.clear();
  delete memory.loopAdvanceRequestedAt;
}

function isLoopTaskRequester(state: CivPilotTextState, entity: CivPilotVisibleEntity) {
  if (entity.stage !== "adult" && entity.stage !== "elder") return false;
  const entities = state.visible_entities ?? [];
  if (entity.role === "builder") {
    const bridge = entities.find((item) => item.kind === "object" && item.role === "bridge");
    return !bridge || bridge.activity !== "built";
  }
  if (entity.role === "scout") {
    const trapped = entities.find((item) => item.kind === "object" && item.role === "trapped");
    return !trapped || trapped.activity !== "rescued";
  }
  if (entity.role === "elder") {
    const breach = entities.find((item) => item.kind === "object" && item.role === "breach");
    return !breach || breach.activity !== "repaired";
  }
  return true;
}

function exploreDecision(stepIndex: number, label: string): CivPilotDecision {
  const pattern = [
    { x: 1, y: 0 },
    { x: 0.5, y: 0.8 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
    { x: 0.7, y: 0.25 },
    { x: 1, y: 0 },
  ];
  return { action: "explore", label, vector: pattern[stepIndex % pattern.length] };
}

function oxygenRetreatDecision(state: CivPilotTextState, stepIndex: number, memory: CivPilotMemory): CivPilotDecision | null {
  const player = playerOf(state);
  const oxygen = player?.oxygen;
  if (!player || !oxygen) return null;
  const inPocket = oxygen.in_pocket || player.hazard_contact?.role === "oxygen";
  const value = typeof oxygen.value === "number" ? oxygen.value : 100;
  const status = oxygen.status ?? "stable";
  if ((inPocket && value <= 88) || value <= 42 || status === "critical") {
    memory.oxygenRetreating = true;
  } else if (!inPocket && value >= 88 && status !== "draining") {
    memory.oxygenRetreating = false;
  }
  if (!memory.oxygenRetreating) return null;
  const escape = blockedEscapeDecision(state, stepIndex, "oxygen retreat: swim over terrain");
  if (escape) return escape;
  const target = oxygenRetreatTarget(state);
  if (target) {
    return {
      action: "move",
      target,
      label: value <= 34 ? "oxygen critical: retreat" : "retreat for oxygen",
    };
  }
  return exploreDecision(stepIndex, "retreat for oxygen");
}

function oxygenRetreatTarget(state: CivPilotTextState): CivPilotTarget | null {
  const player = playerOf(state);
  if (!player) return null;
  const contact = player.hazard_contact?.role === "oxygen" ? player.hazard_contact : null;
  if (contact) {
    const awayX = player.x >= contact.x ? 1 : -1;
    const x = player.x + awayX * 112;
    const y = Math.max(96, player.y - 156);
    return {
      kind: "building",
      label: "oxygen retreat",
      x,
      y,
      distance: Math.hypot(x - player.x, y - player.y),
    };
  }
  return pondTarget(state);
}

function blockedEscapeDecision(state: CivPilotTextState, stepIndex: number, label: string): CivPilotDecision | null {
  const player = playerOf(state);
  const block = player?.blocked;
  if (!player || !block || typeof block.age_ms !== "number" || block.age_ms > 850) return null;
  const blockX = typeof block.x === "number"
    ? block.x
    : typeof block.tile_x === "number"
      ? block.tile_x * 16 + 8
      : player.x;
  const awayX = blockX <= player.x ? 0.55 : -0.55;
  return {
    action: "explore",
    label,
    vector: stepIndex % 2 === 0 ? { x: 0, y: -1 } : { x: awayX, y: -0.85 },
  };
}

function yieldResource(resource: string) {
  return resource === "moss" ? "food" : resource;
}

function resourceLabel(resource: string) {
  return resource ? resource.replace(/_/g, " ") : "resource";
}

function interactionKey(item: CivPilotTarget) {
  return item.targetId ? `${item.targetId}:${item.action ?? item.kind}` : `${item.kind}:${item.action ?? ""}:${item.label}`;
}

function recentlyInteracted(memory: CivPilotMemory, item: CivPilotTarget, stepIndex: number, cooldownSteps: number) {
  const last = memory.interactions.get(interactionKey(item));
  return typeof last === "number" && stepIndex - last < cooldownSteps;
}
