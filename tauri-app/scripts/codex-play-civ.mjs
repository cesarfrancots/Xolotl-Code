#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_URL = "http://127.0.0.1:1420/?tab=civ";

function parseArgs(argv) {
  const args = {
    url: DEFAULT_URL,
    goal: "tour",
    steps: 18,
    headless: false,
    keepOpenMs: 2000,
    screenshotDir: "",
    slowMo: 0,
    continueAfterTask: false,
    possessId: "",
    requesterId: "",
    inAppPilot: false,
    failOnIncomplete: false,
    failOnCriticalOxygen: false,
    maxNoProgressSteps: 0,
    sampleMs: 620,
    stopAfterCompletions: 0,
    screenshotEvery: 1,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--url" && next) {
      args.url = next;
      i += 1;
    } else if (arg === "--goal" && next) {
      args.goal = next;
      i += 1;
    } else if (arg === "--steps" && next) {
      args.steps = Math.max(1, Number.parseInt(next, 10) || args.steps);
      i += 1;
    } else if (arg === "--headless") {
      args.headless = true;
    } else if (arg === "--headed") {
      args.headless = false;
    } else if (arg === "--keep-open" && next) {
      args.keepOpenMs = Math.max(0, Math.round(Number.parseFloat(next) * 1000));
      i += 1;
    } else if (arg === "--screenshot-dir" && next) {
      args.screenshotDir = next;
      i += 1;
    } else if (arg === "--slow-mo" && next) {
      args.slowMo = Math.max(0, Number.parseInt(next, 10) || 0);
      i += 1;
    } else if (arg === "--continue-after-task") {
      args.continueAfterTask = true;
    } else if ((arg === "--possess" || arg === "--possess-id") && next) {
      args.possessId = next;
      i += 1;
    } else if ((arg === "--requester" || arg === "--requester-id") && next) {
      args.requesterId = next;
      i += 1;
    } else if (arg === "--in-app-pilot") {
      args.inAppPilot = true;
    } else if (arg === "--fail-on-incomplete") {
      args.failOnIncomplete = true;
    } else if (arg === "--fail-on-critical-oxygen") {
      args.failOnCriticalOxygen = true;
    } else if (arg === "--max-no-progress" && next) {
      args.maxNoProgressSteps = Math.max(0, Number.parseInt(next, 10) || 0);
      i += 1;
    } else if (arg === "--sample-ms" && next) {
      args.sampleMs = Math.max(120, Number.parseInt(next, 10) || args.sampleMs);
      i += 1;
    } else if (arg === "--stop-after-completions" && next) {
      args.stopAfterCompletions = Math.max(0, Number.parseInt(next, 10) || 0);
      i += 1;
    } else if (arg === "--screenshot-every" && next) {
      args.screenshotEvery = Math.max(1, Number.parseInt(next, 10) || args.screenshotEvery);
      i += 1;
    }
  }
  return args;
}

function assertGoal(goal) {
  const allowed = new Set(["tour", "gather", "greet", "explore", "return", "task", "task-loop", "task-fetch", "task-trade", "task-visit", "task-repair", "task-rescue", "task-bridge"]);
  if (!allowed.has(goal)) {
    throw new Error(`Unknown goal "${goal}". Use one of: ${[...allowed].join(", ")}`);
  }
}

async function loadPlaywright() {
  try {
    return normalizePlaywrightModule(await import("playwright"));
  } catch (primaryError) {
    const attempted = [];
    for (const candidate of bundledPlaywrightCandidates()) {
      attempted.push(candidate);
      try {
        return normalizePlaywrightModule(await import(pathToFileURL(candidate).href));
      } catch {
        // Keep trying candidates; the final error below reports all paths.
      }
    }
    console.error("Could not import Playwright. Run from a Codex environment with Playwright available, or install it for this app.");
    console.error(`Import error: ${primaryError?.message ?? primaryError}`);
    if (attempted.length) console.error(`Bundled candidates tried: ${attempted.join("; ")}`);
    process.exit(1);
  }
}

function normalizePlaywrightModule(module) {
  return module?.chromium ? module : module?.default ?? module;
}

function bundledPlaywrightCandidates() {
  const candidates = [];
  for (const envKey of ["PLAYWRIGHT_MODULE_PATH", "CODEX_PLAYWRIGHT_MODULE"]) {
    const value = process.env[envKey];
    if (!value) continue;
    candidates.push(playwrightEntryPath(value));
  }

  const home = process.env.USERPROFILE || process.env.HOME;
  if (home) {
    const pnpmRoot = path.join(home, ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", ".pnpm");
    if (fs.existsSync(pnpmRoot)) {
      for (const entry of fs.readdirSync(pnpmRoot)) {
        if (!entry.startsWith("playwright@")) continue;
        candidates.push(path.join(pnpmRoot, entry, "node_modules", "playwright", "index.js"));
      }
    }
  }

  return candidates.filter((candidate) => fs.existsSync(candidate));
}

function playwrightEntryPath(candidate) {
  if (!candidate) return candidate;
  try {
    const stat = fs.statSync(candidate);
    if (stat.isDirectory()) return path.join(candidate, "index.js");
  } catch {
    // Fall through to the original candidate; existence is checked later.
  }
  return candidate;
}

async function readState(page) {
  const raw = await page.evaluate(() => window.render_game_to_text?.() ?? null);
  if (!raw) throw new Error("window.render_game_to_text is not available on this page");
  return JSON.parse(raw);
}

function playerOf(state) {
  return state?.player?.player ?? null;
}

function taskOf(state) {
  return state?.player_task ?? null;
}

function progressSignature(state) {
  const player = playerOf(state);
  const task = taskOf(state);
  const last = state?.player?.lastInteraction;
  return JSON.stringify({
    tile: player ? `${player.tile_x},${player.tile_y}` : null,
    task: task ? {
      kind: task.kind,
      npcId: task.npcId,
      status: task.status,
      progress: task.progress,
      remaining: task.remaining,
      current: task.current,
    } : null,
    last: last ? `${last.kind}:${last.targetId ?? last.label}` : null,
    resources: state?.civilization?.resources ?? null,
  });
}

function criticalOxygenFailure(state, step) {
  const oxygen = playerOf(state)?.oxygen;
  if (!oxygen) return null;
  const value = typeof oxygen.value === "number" ? oxygen.value : 100;
  if (oxygen.status === "critical" || value <= 0) {
    return { type: "critical_oxygen", step, oxygen };
  }
  return null;
}

function nearbyOf(state, kind) {
  const items = state?.player?.nearby_interactions;
  if (!Array.isArray(items)) return [];
  return items.filter((item) => item.kind === kind);
}

function nearest(items, predicate = () => true) {
  return items
    .filter(predicate)
    .sort((a, b) => (a.distance ?? 999999) - (b.distance ?? 999999))[0] ?? null;
}

function distanceFromPlayer(player, target) {
  return Math.hypot(target.x - player.x, target.y - player.y);
}

function pondTarget(state) {
  const entity = (state.visible_entities ?? []).find((item) => item.kind === "building" && item.role === "pond")
    ?? (state.visible_entities ?? []).find((item) => item.kind === "building" && item.role === "nest");
  if (!entity) return null;
  const player = playerOf(state);
  const x = entity.x * 16 + 8;
  const y = entity.y * 16 - 8;
  const distance = player ? Math.hypot(x - player.x, y - player.y) : 999;
  return { kind: "building", label: entity.role, targetId: entity.id, x, y, distance };
}

function visibleEntityTarget(state, entityId, kind = "npc") {
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

function taskCompleteRallyTarget(state) {
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
    .filter(Boolean);
  return nearest(friends);
}

function requestKindForEntity(entity) {
  const morph = entity?.morph ?? "";
  if (entity?.role === "builder") return "bridge";
  if (["gold", "copper", "firefly", "blue", "gfp"].includes(morph)) return "trade";
  if (entity?.role === "elder") return "repair";
  if (entity?.role === "scout") return "rescue";
  if (["melanoid", "axanthic", "mystic"].includes(morph)) return "visit";
  return "fetch";
}

function preferredTaskRequester(state, goal) {
  const desired = goal === "task-trade" ? "trade" : goal === "task-visit" ? "visit" : goal === "task-fetch" ? "fetch" : goal === "task-repair" ? "repair" : goal === "task-rescue" ? "rescue" : goal === "task-bridge" ? "bridge" : "";
  if (!desired) return null;
  const player = playerOf(state);
  const candidates = (state.visible_entities ?? [])
    .filter((item) => item.kind === "axolotl" && item.stage !== "egg" && item.id !== state.player?.possessedEntityId)
    .filter((item) => requestKindForEntity(item) === desired)
    .map((item) => {
      const x = item.x * 16 + 8;
      const y = item.y * 16 + 2;
      return {
        kind: "npc",
        label: item.name || item.id,
        targetId: item.id,
        x,
        y,
        distance: player ? Math.hypot(x - player.x, y - player.y) : 999,
      };
    });
  return nearest(candidates);
}

function nextLoopRequesterId(state, memory, excludeId = undefined) {
  const excluded = new Set(memory.loopExhaustedRequesterIds ?? []);
  if (excludeId) excluded.add(excludeId);
  const candidates = loopRequesterIds(state, excluded);
  if (!candidates.length) return undefined;
  const previous = typeof memory.loopRequesterCursor === "number" ? memory.loopRequesterCursor : -1;
  const next = (previous + 1) % candidates.length;
  memory.loopRequesterCursor = next;
  return candidates[next];
}

function loopRequesterIds(state, excluded = new Set()) {
  const possessedId = state.player?.possessedEntityId;
  return (state.visible_entities ?? [])
    .filter((item) => item.kind === "axolotl" && isLoopTaskRequester(state, item) && item.id !== possessedId)
    .map((item) => item.id)
    .filter((id) => !excluded.has(id))
    .sort((a, b) => a.localeCompare(b));
}

function rememberLoopExhaustedRequester(memory, requesterId) {
  if (!memory.loopExhaustedRequesterIds) memory.loopExhaustedRequesterIds = new Set();
  memory.loopExhaustedRequesterIds.add(requesterId);
}

function loopRequestersExhausted(state, memory) {
  return loopRequesterIds(state, new Set(memory.loopExhaustedRequesterIds ?? [])).length === 0;
}

function syncLoopTurn(state, memory) {
  const turn = state?.session?.turn;
  if (typeof turn !== "number" || memory.loopTurn === turn) return;
  memory.loopTurn = turn;
  memory.loopExhaustedRequesterIds?.clear();
  delete memory.loopAdvanceRequestedAt;
}

function isLoopTaskRequester(state, entity) {
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

function yieldResource(resource) {
  return resource === "moss" ? "food" : resource;
}

const RESCUE_READY_INTERACT_RANGE = 88;
const TASK_LOOP_RALLY_STEPS = 3;

function chooseDecision(state, goal, stepIndex, memory) {
  const player = playerOf(state);
  if (!player) return { action: "possess", label: "possess" };

  const resources = nearbyOf(state, "resource");
  const npcs = nearbyOf(state, "npc");
  const buildings = nearbyOf(state, "building");
  const objects = nearbyOf(state, "object");
  const terrain = nearbyOf(state, "terrain");
  const task = taskOf(state);
  syncLoopTurn(state, memory);
  if (task) {
    memory.loopExhaustedRequesterIds?.clear();
    delete memory.loopAdvanceRequestedAt;
  }
  const oxygenDecision = oxygenRetreatDecision(state, stepIndex, memory);
  if (oxygenDecision) return oxygenDecision;

  if (goal.startsWith("task") || task) {
    if (goal === "task-loop" && !task && typeof memory.loopAdvanceRequestedAt === "number" && stepIndex - memory.loopAdvanceRequestedAt < 12) {
      return { action: "explore", label: "waiting for next turn" };
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
        const escape = blockedEscapeDecision(state, stepIndex, "task complete: swim over terrain");
        if (escape) return escape;
        const rally = taskCompleteRallyTarget(state) ?? pondTarget(state);
        if (rally) {
          const distance = rally.distance ?? (player ? distanceFromPlayer(player, rally) : 999);
          return {
            action: "move",
            target: rally,
            label: distance > 56 ? "task complete: return to friends" : "task complete: hold position",
          };
        }
        return { action: "explore", label: "task complete: patrol" };
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
        : targetOrExplore(nearest(npcs), "request task", stepIndex, null, "use");
    }
    if (task.kind === "visit_building") {
      const target = nearest(buildings, (item) => item.targetId === task.buildingId)
        ?? visibleEntityTarget(state, task.buildingId, "building");
      return targetOrExplore(target, `check ${task.buildingName ?? "building"}`, stepIndex, null, "use");
    }
    if (task.kind === "repair_object" && task.status === "ready") {
      const target = nearest(objects, (item) => item.targetId === task.objectId)
        ?? visibleEntityTarget(state, task.objectId, "object");
      return targetOrExplore(target, `repair ${task.objectName ?? "object"}`, stepIndex, null, "use");
    }
    if (task.kind === "rescue_object") {
      if (task.status === "ready") {
        const target = nearest(objects, (item) => item.targetId === task.objectId)
          ?? visibleEntityTarget(state, task.objectId, "object");
        if (target && (target.distance ?? distanceFromPlayer(player, target)) <= RESCUE_READY_INTERACT_RANGE) {
          return { action: "interact", target, label: `rescue ${task.objectName ?? "axolotl"}`, tool: "use" };
        }
        const blocker = blockedTerrainTarget(state, terrain, target);
        if (blocker) return targetOrExplore(blocker, "mine rescue path", stepIndex, 48, "mine");
        const approachTarget = rescueObjectApproachTarget(player, target);
        if (approachTarget && approachTarget !== target) {
          return { action: "move", target: approachTarget, label: `rescue ${task.objectName ?? "axolotl"}` };
        }
        return targetOrExplore(target, `rescue ${task.objectName ?? "axolotl"}`, stepIndex, RESCUE_READY_INTERACT_RANGE, "use");
      }
      const objectTarget = nearest(objects, (item) => item.targetId === task.objectId)
        ?? visibleEntityTarget(state, task.objectId, "object");
      const objectTileX = objectTarget ? Math.floor(objectTarget.x / 16) : null;
      const objectTileY = objectTarget ? Math.floor(objectTarget.y / 16) : null;
      const rescueTiles = objectTileX !== null && objectTileY !== null
        ? new Set([`${objectTileX - 1},${objectTileY}`, `${objectTileX - 1},${objectTileY + 1}`, `${objectTileX},${objectTileY + 1}`])
        : null;
      const rubble = nearest(terrain, (item) => (
        item.action === "mine_tile"
        && rescueTiles !== null
        && rescueTiles.has(`${item.tileX ?? Math.floor(item.x / 16)},${item.tileY ?? Math.floor(item.y / 16)}`)
      ));
      if (rubble) {
        const blocker = blockedTerrainTarget(state, terrain, rubble);
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
      return targetOrExplore(approachTarget, `reach ${task.objectName ?? "trapped axolotl"}`, stepIndex, 12);
    }
    if (task.kind === "build_bridge") {
      const objectTarget = nearest(objects, (item) => item.targetId === task.objectId)
        ?? visibleEntityTarget(state, task.objectId, "object");
      const objectTileX = objectTarget ? Math.floor(objectTarget.x / 16) : null;
      const objectTileY = objectTarget ? Math.floor(objectTarget.y / 16) : null;
      const bridgeTile = nearest(terrain, (item) => (
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
        ? { action: "move", target: approachTarget, label: `reach ${task.objectName ?? "bridge gap"}` }
        : { action: "explore", label: "bridge gap: searching" };
    }
    if (task.status === "ready") {
      return targetOrExplore(
        nearest(npcs, (item) => item.targetId === task.npcId) ?? visibleEntityTarget(state, task.npcId),
        task.kind === "trade_resource" ? `trade ${task.resource}` : `deliver ${task.resource}`,
        stepIndex,
        null,
        "use",
      );
    }
    const targetResource = nearest(resources, (item) => (
      (item.amount ?? 0) > 0
      && (item.resource === task.sourceResource || yieldResource(item.resource) === task.resource)
    ));
    const blocker = blockedTerrainTarget(state, terrain, targetResource);
    if (blocker) {
      return targetOrExplore(blocker, `mine path to ${task.sourceResource}`, stepIndex, 48, "mine");
    }
    return targetOrExplore(targetResource, `gather ${task.sourceResource}`, stepIndex, null, "use");
  }

  if (goal === "greet") {
    return targetOrExplore(nearest(npcs), "greet", stepIndex, null, "use");
  }
  if (goal === "gather") {
    return targetOrExplore(nearest(resources, (item) => (item.amount ?? 0) > 0), "gather", stepIndex, null, "use");
  }
  if (goal === "return") {
    const escape = blockedEscapeDecision(state, stepIndex, "swim over terrain");
    if (escape) return escape;
    const closeBuilding = nearest(buildings, (item) => (item.distance ?? 999) <= 42);
    if (closeBuilding && !recentlyInteracted(memory, closeBuilding, stepIndex, 8)) {
      return targetOrExplore(closeBuilding, "return", stepIndex, null, "use");
    }
    if (closeBuilding) return { action: "explore", label: "return: patrol home" };
    return targetOrExplore(pondTarget(state) ?? nearest(buildings), "return", stepIndex, null, "use");
  }
  if (goal === "explore") {
    return { action: "explore", label: "explore" };
  }

  const closeNpc = nearest(npcs, (item) => (item.distance ?? 999) <= 42 && !recentlyInteracted(memory, item, stepIndex, 8));
  if (closeNpc) return { action: "interact", target: closeNpc, label: `greet ${closeNpc.label}`, tool: "use" };
  const closeResource = nearest(resources, (item) => (item.distance ?? 999) <= 38 && (item.amount ?? 0) > 0 && !recentlyInteracted(memory, item, stepIndex, 2));
  if (closeResource) return { action: "interact", target: closeResource, label: `harvest ${closeResource.label}`, tool: "use" };
  const targetResource = nearest(resources, (item) => (item.amount ?? 0) > 0);
  if (targetResource && ((targetResource.distance ?? 999) < 420 || stepIndex % 9 < 5)) {
    return { action: "move", target: targetResource, label: "seek resource" };
  }
  if (stepIndex % 9 < 7 && npcs.length > 0) {
    return { action: "move", target: nearest(npcs, (item) => !recentlyInteracted(memory, item, stepIndex, 8)) ?? nearest(npcs), label: "visit npc" };
  }
  return { action: "explore", label: "explore" };
}

function interactionKey(item) {
  return item?.targetId ? `${item.targetId}:${item.action ?? item.kind}` : `${item?.kind}:${item?.action ?? ""}:${item?.label}`;
}

function recentlyInteracted(memory, item, stepIndex, cooldownSteps) {
  const last = memory.interactions.get(interactionKey(item));
  return typeof last === "number" && stepIndex - last < cooldownSteps;
}

function rememberInteraction(memory, item, stepIndex) {
  if (!item) return;
  memory.interactions.set(interactionKey(item), stepIndex);
}

function targetOrExplore(target, label, stepIndex, interactRangeOverride = null, tool = null) {
  if (!target) return { action: "explore", label: `${label}: no target`, stepIndex };
  const interactRange = interactRangeOverride ?? (target.kind === "resource" ? 38 : target.kind === "object" ? 46 : 42);
  if ((target.distance ?? 999) <= interactRange) return { action: "interact", target, label, tool };
  return { action: "move", target, label };
}

function rescueObjectApproachTarget(player, target) {
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

function blockedTerrainTarget(state, terrain, target) {
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

function oxygenRetreatDecision(state, stepIndex, memory) {
  const player = playerOf(state);
  const oxygen = player?.oxygen;
  if (!player || !oxygen) return null;
  const inPocket = Boolean(oxygen.in_pocket || player.hazard_contact?.role === "oxygen");
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
  return { action: "explore", label: "retreat for oxygen", vector: { x: stepIndex % 2 === 0 ? -1 : 1, y: -0.4 } };
}

function oxygenRetreatTarget(state) {
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

function blockedEscapeDecision(state, stepIndex, label) {
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

async function possessIfNeeded(page, desiredId = "") {
  const state = await readState(page);
  if (playerOf(state) && (!desiredId || state.player?.possessedEntityId === desiredId)) return state;
  if (desiredId) {
    const selected = await selectPlayerById(page, desiredId);
    if (selected) {
      await page.waitForTimeout(260);
      const selectedState = await readState(page);
      if (playerOf(selectedState) && selectedState.player?.possessedEntityId === desiredId) return selectedState;
    }
  }
  const button = page.locator("button[title='Possess an axolotl']");
  if (await button.isEnabled().catch(() => false)) {
    await button.click();
    await page.waitForTimeout(250);
    const possessedState = await readState(page);
    if (!desiredId || possessedState.player?.possessedEntityId === desiredId) return possessedState;
  }
  throw new Error(desiredId ? `Could not possess ${desiredId}` : "No playable axolotl is available to possess");
}

async function selectPlayerById(page, desiredId) {
  return page.evaluate((id) => {
    const select = document.querySelector("select[title='Choose player axolotl']");
    if (!(select instanceof HTMLSelectElement)) return false;
    if (!Array.from(select.options).some((option) => option.value === id)) return false;
    select.value = id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, desiredId);
}

async function holdKey(page, key, ms) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

async function holdKeys(page, keys, ms) {
  for (const key of keys) await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  for (const key of [...keys].reverse()) await page.keyboard.up(key);
}

async function moveToward(page, player, target) {
  const targetX = target.x ?? player.x;
  const targetY = target.action === "mine_tile"
    ? Math.max(0, (target.y ?? player.y) - 22)
    : (target.y ?? player.y);
  const dx = targetX - player.x;
  const dy = targetY - player.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < 18 && absY < 18) return false;
  const keys = [];
  const horizontalThreshold = absY > 48 ? 4 : 18;
  if (absX >= horizontalThreshold) {
    keys.push(dx >= 0 ? "ArrowRight" : "ArrowLeft");
  } else if (absY > 48 && player.locomotion === "grounded") {
    keys.push(dx >= 0 ? "ArrowRight" : "ArrowLeft");
  }
  if (absY >= 18) keys.push(dy >= 0 ? "ArrowDown" : "ArrowUp");
  if (Math.max(absX, absY) > 220) keys.push("Shift");
  const duration = Math.max(160, Math.min(720, Math.round(Math.max(absX, absY) * 1.05)));
  await holdKeys(page, keys, duration);
  return true;
}

async function explore(page, stepIndex, vector = null) {
  if (vector && (Math.abs(vector.x ?? 0) > 0.05 || Math.abs(vector.y ?? 0) > 0.05)) {
    const keys = [];
    if ((vector.x ?? 0) > 0.18) keys.push("ArrowRight");
    if ((vector.x ?? 0) < -0.18) keys.push("ArrowLeft");
    if ((vector.y ?? 0) > 0.18) keys.push("ArrowDown");
    if ((vector.y ?? 0) < -0.18) keys.push("ArrowUp");
    await holdKeys(page, keys.length ? keys : ["ArrowUp"], 420);
    return;
  }
  const pattern = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowRight"];
  await holdKey(page, pattern[stepIndex % pattern.length], 360);
}

async function interact(page) {
  await page.locator(".civ-canvas-host canvas").first().focus().catch(() => {});
  await page.keyboard.down("e");
  await page.waitForTimeout(180);
  await page.keyboard.up("e");
}

async function advanceTurn(page) {
  const button = page.locator("button[title='Advance one turn']").first();
  if (await button.isEnabled().catch(() => false)) {
    await button.click();
    await page.waitForTimeout(900);
    await page.locator(".civ-canvas-host canvas").first().focus().catch(() => {});
  }
}

async function setTool(page, tool) {
  if (!tool) return;
  const titleStart = tool === "mine"
    ? "Mine nearby terrain"
    : tool === "build"
      ? "Build with"
      : "Use:";
  const button = page.locator(`button[title^='${titleStart}']`).first();
  if (await button.isEnabled().catch(() => false)) {
    await button.click();
    await page.waitForTimeout(80);
    await page.locator(".civ-canvas-host canvas").first().focus().catch(() => {});
  }
}

async function maybeScreenshot(page, dir, stepIndex, every = 1) {
  if (!dir) return;
  if (stepIndex % every !== 0) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `codex-play-${String(stepIndex).padStart(2, "0")}.png`) });
}

function maybeWriteState(dir, stepIndex, state) {
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `codex-play-${String(stepIndex).padStart(2, "0")}.json`),
    `${JSON.stringify(state, null, 2)}\n`,
  );
}

async function startInAppPilot(page, options, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const started = await page.evaluate((pilotOptions) => {
      const controls = window.civPilotControls;
      if (!controls?.start) return false;
      controls.start(pilotOptions);
      return true;
    }, options);
    if (started) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

export async function runCodexCivPlayer(options = {}) {
  const args = {
    ...parseArgs(["node", "codex-play-civ.mjs"]),
    ...options,
  };
  assertGoal(args.goal);
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({
    headless: args.headless,
    slowMo: args.slowMo,
    args: ["--window-size=1280,820", "--window-position=80,80", "--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push({ type: "console", text: message.text() });
  });
  page.on("pageerror", (error) => errors.push({ type: "pageerror", text: String(error) }));
  let completed = false;
  let completedAtStep = null;
  let completedCount = 0;
  let stepsRun = 0;
  const failures = [];
  let lastProgressSignature = "";
  let noProgressSteps = 0;
  let finalState = null;

  try {
    await page.goto(args.url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1400);
    console.log(`Codex player connected: ${args.url}`);

    if (args.inAppPilot) {
      const started = await startInAppPilot(page, {
        goal: args.goal,
        possessId: args.possessId,
        requesterId: args.requesterId,
        continueAfterTask: args.continueAfterTask,
      });
      if (!started) {
        failures.push({ type: "missing_in_app_pilot_controls" });
      }
      await page.waitForTimeout(900);
      let wasTaskActive = false;
      for (let step = 0; step < args.steps && !failures.length; step += 1) {
        stepsRun = step + 1;
        const before = await readState(page);
        const beforeTask = taskOf(before);
        if (beforeTask) wasTaskActive = true;
        await page.waitForTimeout(args.sampleMs);
        const after = await readState(page);
        const afterPlayer = playerOf(after);
        const afterTask = taskOf(after);
        const last = after?.player?.lastInteraction;
        const taskCompletedNow = Boolean(wasTaskActive && !afterTask);
        const oxygenFailure = args.failOnCriticalOxygen ? criticalOxygenFailure(after, step) : null;
        if (oxygenFailure) failures.push(oxygenFailure);
        const signature = progressSignature(after);
        if (signature === lastProgressSignature) {
          noProgressSteps += 1;
        } else {
          lastProgressSignature = signature;
          noProgressSteps = 0;
        }
        if (args.maxNoProgressSteps > 0 && noProgressSteps >= args.maxNoProgressSteps) {
          failures.push({
            type: "no_progress",
            step,
            steps: noProgressSteps,
            signature: JSON.parse(signature),
          });
        }
        if (taskCompletedNow) {
          completedCount += 1;
          completed = true;
          if (completedAtStep === null) completedAtStep = step;
        }
        wasTaskActive = Boolean(afterTask);
        console.log(
          `[${step + 1}/${args.steps}] in-app pilot -> tile ${afterPlayer?.tile_x},${afterPlayer?.tile_y}`
          + (afterTask ? `; task ${afterTask.kind}:${afterTask.status}:${afterTask.progress}/${afterTask.amount}` : "; task none")
          + (last ? `; last ${last.kind}:${last.label}` : ""),
        );
        await maybeScreenshot(page, args.screenshotDir, step, args.screenshotEvery);
        maybeWriteState(args.screenshotDir, step, after);
        if (errors.length || failures.length) break;
        if (args.stopAfterCompletions > 0 && completedCount >= args.stopAfterCompletions) {
          console.log(`Completed ${completedCount} task(s); stopping.`);
          break;
        }
        if (taskCompletedNow && args.goal.startsWith("task") && args.goal !== "task-loop" && !args.continueAfterTask) {
          console.log(`Task goal complete at step ${step + 1}; stopping.`);
          break;
        }
      }
    } else {
      await possessIfNeeded(page, args.possessId);
      const memory = { interactions: new Map(), preferredRequesterId: args.requesterId || undefined };

      for (let step = 0; step < args.steps; step += 1) {
        stepsRun = step + 1;
        const state = await readState(page);
        const player = playerOf(state);
        const decision = chooseDecision(state, args.goal, step, memory);

        if (decision.action === "possess") {
          await possessIfNeeded(page, args.possessId);
        } else if (decision.action === "advance_turn") {
          await advanceTurn(page);
        } else if (decision.action === "interact") {
          await setTool(page, decision.tool);
          await interact(page);
        } else if (decision.action === "move" && player && decision.target) {
          await moveToward(page, player, decision.target);
        } else {
          await explore(page, step, decision.vector);
        }

        await page.waitForTimeout(280);
        const after = await readState(page);
        const afterPlayer = playerOf(after);
        const last = after?.player?.lastInteraction;
        const taskCompletedNow = Boolean(taskOf(state) && !taskOf(after));
        const oxygenFailure = args.failOnCriticalOxygen ? criticalOxygenFailure(after, step) : null;
        if (oxygenFailure) failures.push(oxygenFailure);
        const signature = progressSignature(after);
        if (signature === lastProgressSignature) {
          noProgressSteps += 1;
        } else {
          lastProgressSignature = signature;
          noProgressSteps = 0;
        }
        if (args.maxNoProgressSteps > 0 && noProgressSteps >= args.maxNoProgressSteps) {
          failures.push({
            type: "no_progress",
            step,
            steps: noProgressSteps,
            signature: JSON.parse(signature),
          });
        }
        if (taskCompletedNow) {
          memory.taskCompletedAt = step;
          completedCount += 1;
          completed = true;
          if (completedAtStep === null) completedAtStep = step;
        }
        if (decision.action === "interact") rememberInteraction(memory, decision.target, step);
        rememberInteraction(memory, last, step);
        console.log(
          `[${step + 1}/${args.steps}] ${decision.label} -> tile ${afterPlayer?.tile_x},${afterPlayer?.tile_y}`
          + (last ? `; last ${last.kind}:${last.label}` : ""),
        );
        await maybeScreenshot(page, args.screenshotDir, step, args.screenshotEvery);
        maybeWriteState(args.screenshotDir, step, after);
        if (errors.length || failures.length) break;
        if (args.stopAfterCompletions > 0 && completedCount >= args.stopAfterCompletions) {
          console.log(`Completed ${completedCount} task(s); stopping.`);
          break;
        }
        if (taskCompletedNow && args.goal.startsWith("task") && args.goal !== "task-loop" && !args.continueAfterTask) {
          console.log(`Task goal complete at step ${step + 1}; stopping.`);
          break;
        }
      }
    }

    if (errors.length) {
      console.error("Browser errors:", JSON.stringify(errors, null, 2));
      if (globalThis.process) globalThis.process.exitCode = 1;
    }
    if (!completed && args.failOnIncomplete && args.goal.startsWith("task")) {
      failures.push({ type: "incomplete", stepsRun, goal: args.goal });
    }
    if (failures.length) {
      console.error("Playability failures:", JSON.stringify(failures, null, 2));
      if (globalThis.process) globalThis.process.exitCode = 1;
    }
    finalState = await readState(page).catch((error) => ({ error: String(error?.message ?? error) }));
    if (args.screenshotDir) {
      fs.mkdirSync(args.screenshotDir, { recursive: true });
      await page.screenshot({ path: path.join(args.screenshotDir, "codex-play-final.png") }).catch(() => {});
      fs.writeFileSync(
        path.join(args.screenshotDir, "summary.json"),
        `${JSON.stringify({
          url: args.url,
          goal: args.goal,
          inAppPilot: args.inAppPilot,
          stepsRequested: args.steps,
          stepsRun,
          completed,
          completedAtStep,
          completedCount,
          errors,
          failures,
          finalState,
        }, null, 2)}\n`,
      );
    }
    if (args.keepOpenMs > 0) await page.waitForTimeout(args.keepOpenMs);
  } finally {
    await browser.close();
  }
  return { errors, failures, completed, completedAtStep, completedCount, stepsRun, finalState };
}

async function main() {
  await runCodexCivPlayer(parseArgs(globalThis.process?.argv ?? ["node", "codex-play-civ.mjs"]));
}

const argvEntry = globalThis.process?.argv?.[1] ? path.resolve(globalThis.process.argv[1]) : "";
if (argvEntry && path.resolve(fileURLToPath(import.meta.url)) === argvEntry) {
  main().catch((error) => {
    console.error(error);
    globalThis.process.exit(1);
  });
}
