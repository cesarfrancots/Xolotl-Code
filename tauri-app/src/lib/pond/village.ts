// Pondfall — pure village logic: economy, construction, training.
//
// Every function here is pure and takes `now` explicitly so the whole
// economy is unit-testable without fake timers. Mutating actions return a
// new VillageState (or an error string) and never touch the input.

import {
  BUILDINGS,
  COLLECTOR_BUFFER_HOURS,
  GRID_SIZE,
  MAX_OBSTACLES,
  MAX_RAID_LOG,
  OBSTACLES,
  OBSTACLE_SPAWN_INTERVAL_MS,
  MAX_WORKER_LEVEL,
  SPELLS,
  STARTING_PEARLS,
  TROOPS,
  WORKER_NAMES,
  WORKSHOP_PEARL_COSTS,
  finishNowCost,
  heroLevelCap,
  heroUpgradeCost,
  heroUpgradeTimeMs,
  maxBuildingLevel,
  researchCost,
  researchTimeMs,
  troopLevelCap,
  workerSpeedMultiplier,
  workerUpgradeCost,
} from "./config";
import type {
  BuildingKind,
  BuildingState,
  ObstacleKind,
  RaidReport,
  ResourceKind,
  SpellKind,
  TroopKind,
  VillageState,
} from "./types";

export type ActionResult = { ok: true; village: VillageState } | { ok: false; error: string };

function fail(error: string): ActionResult {
  return { ok: false, error };
}

function clone(village: VillageState): VillageState {
  return JSON.parse(JSON.stringify(village)) as VillageState;
}

function claimId(village: VillageState, prefix: string): string {
  const id = `${prefix}-${village.nextId}`;
  village.nextId += 1;
  return id;
}

// ── Creation ──────────────────────────────────────────────────────────────

export function createVillage(name: string, now: number): VillageState {
  const village: VillageState = {
    version: 2,
    name,
    createdAt: now,
    lastSeenAt: now,
    // Enough for the natural opening (hatchery + camp + first troops)
    // without a dead wait on the level-1 farm.
    resources: { kelp: 900, shards: 600 },
    pearls: STARTING_PEARLS,
    trophies: 0,
    buildings: [],
    obstacles: [
      { id: "obs-a", kind: "driftwood", x: 5, y: 5, clearingUntil: null },
      { id: "obs-b", kind: "boulder", x: 28, y: 28, clearingUntil: null },
      { id: "obs-c", kind: "glowbloom", x: 28, y: 5, clearingUntil: null },
    ],
    lastObstacleAt: now,
    army: {},
    research: {},
    researchJob: null,
    hero: null,
    spells: {},
    brewQueue: [],
    trainQueue: [],
    shieldUntil: now + 12 * 3600 * 1000,
    raidLog: [],
    battlesWon: 0,
    battlesLost: 0,
    nextId: 1,
  };
  const center = Math.floor(GRID_SIZE / 2);
  const starters: Array<{ kind: BuildingKind; x: number; y: number }> = [
    { kind: "pondheart", x: center - 2, y: center - 2 },
    { kind: "kelpFarm", x: center - 7, y: center - 1 },
    { kind: "shardMine", x: center + 4, y: center - 1 },
    { kind: "kelpVat", x: center - 2, y: center + 4 },
    { kind: "shardVault", x: center - 2, y: center - 7 },
    { kind: "workshop", x: center + 4, y: center + 4 },
  ];
  for (const starter of starters) {
    village.buildings.push({
      id: claimId(village, starter.kind),
      kind: starter.kind,
      level: 1,
      x: starter.x,
      y: starter.y,
      job: null,
      ...(BUILDINGS[starter.kind].produces ? { collectedAt: now } : {}),
      ...(starter.kind === "workshop" ? { worker: { name: WORKER_NAMES[0], level: 1 } } : {}),
    });
  }
  return village;
}

/** Gives every operational workshop a resident tadpole (also save migration). */
export function ensureWorkers(village: VillageState): VillageState {
  const next = clone(village);
  let index = 0;
  for (const building of next.buildings) {
    if (building.kind !== "workshop") continue;
    if (building.level > 0 && !building.worker) {
      building.worker = { name: WORKER_NAMES[index % WORKER_NAMES.length], level: 1 };
    }
    index += 1;
  }
  return next;
}

// ── Derived state ─────────────────────────────────────────────────────────

export function townHallLevel(village: VillageState): number {
  const pondheart = village.buildings.find((b) => b.kind === "pondheart");
  return Math.max(1, pondheart?.level ?? 1);
}

export function builderCount(village: VillageState): number {
  return village.buildings.filter((b) => b.kind === "workshop" && b.level > 0 && b.worker).length;
}

export function busyBuilders(village: VillageState): number {
  return (
    village.buildings.filter((b) => b.job && b.kind !== "wall").length +
    village.obstacles.filter((o) => o.clearingUntil !== null).length
  );
}

/** Workshop ids whose tadpole is currently on a job. */
export function busyWorkerIds(village: VillageState): Set<string> {
  const busy = new Set<string>();
  for (const building of village.buildings) {
    if (building.job?.workerId) busy.add(building.job.workerId);
  }
  for (const obstacle of village.obstacles) {
    if (obstacle.clearingUntil !== null && obstacle.clearingWorkerId) {
      busy.add(obstacle.clearingWorkerId);
    }
  }
  return busy;
}

/** The workshop housing a free tadpole, or null when all crews are busy. */
export function idleWorker(village: VillageState): BuildingState | null {
  const busy = busyWorkerIds(village);
  for (const building of village.buildings) {
    if (building.kind !== "workshop" || building.level === 0 || !building.worker) continue;
    if (!busy.has(building.id)) return building;
  }
  return null;
}

export function labLevel(village: VillageState): number {
  const lab = village.buildings.find((b) => b.kind === "lab" && b.level > 0);
  return lab?.level ?? 0;
}

export function spellSpringLevel(village: VillageState): number {
  const spring = village.buildings.find((b) => b.kind === "spellSpring" && b.level > 0);
  return spring?.level ?? 0;
}

export function spellCapacity(village: VillageState): number {
  const level = spellSpringLevel(village);
  if (level === 0) return 0;
  return BUILDINGS.spellSpring.levels[level - 1].housing ?? 0;
}

export function spellsHeld(village: VillageState, includeQueue = true): number {
  let held = 0;
  for (const count of Object.values(village.spells)) held += count ?? 0;
  if (includeQueue) held += village.brewQueue.length;
  return held;
}

export function troopLevel(village: VillageState, troop: TroopKind): number {
  return village.research[troop] ?? 1;
}

export function storageCapacity(village: VillageState, resource: ResourceKind): number {
  let capacity = 0;
  for (const building of village.buildings) {
    if (building.level === 0) continue;
    const config = BUILDINGS[building.kind];
    const stats = config.levels[building.level - 1];
    if (!stats?.capacity) continue;
    if (building.kind === "pondheart" || config.stores === resource) capacity += stats.capacity;
  }
  return capacity;
}

export function armyHousingCapacity(village: VillageState): number {
  let housing = 0;
  for (const building of village.buildings) {
    if (building.kind !== "armyCamp" || building.level === 0) continue;
    housing += BUILDINGS.armyCamp.levels[building.level - 1].housing ?? 0;
  }
  return housing;
}

export function armyHousingUsed(village: VillageState, includeQueue = true): number {
  let used = 0;
  for (const [kind, count] of Object.entries(village.army)) {
    used += TROOPS[kind as TroopKind].housing * (count ?? 0);
  }
  if (includeQueue) {
    for (const job of village.trainQueue) used += TROOPS[job.troop].housing;
  }
  return used;
}

export function hatcheryLevel(village: VillageState): number {
  const hatchery = village.buildings.find((b) => b.kind === "hatchery" && b.level > 0);
  return hatchery?.level ?? 0;
}

/** Uncollected production sitting in a collector, capped by its buffer. */
export function pendingProduction(building: BuildingState, now: number): number {
  const config = BUILDINGS[building.kind];
  if (!config.produces || building.level === 0) return 0;
  const stats = config.levels[building.level - 1];
  const rate = stats.ratePerHour ?? 0;
  const elapsedHours = Math.max(0, now - (building.collectedAt ?? now)) / 3_600_000;
  return Math.floor(rate * Math.min(elapsedHours, COLLECTOR_BUFFER_HOURS));
}

export function countByKind(village: VillageState, kind: BuildingKind): number {
  return village.buildings.filter((b) => b.kind === kind).length;
}

// ── Grid helpers ──────────────────────────────────────────────────────────

export function footprintFree(
  village: VillageState,
  x: number,
  y: number,
  size: number,
  ignoreId?: string,
): boolean {
  if (x < 0 || y < 0 || x + size > GRID_SIZE || y + size > GRID_SIZE) return false;
  for (const building of village.buildings) {
    if (building.id === ignoreId) continue;
    const otherSize = BUILDINGS[building.kind].size;
    const overlapX = x < building.x + otherSize && building.x < x + size;
    const overlapY = y < building.y + otherSize && building.y < y + size;
    if (overlapX && overlapY) return false;
  }
  for (const obstacle of village.obstacles) {
    const otherSize = OBSTACLES[obstacle.kind].size;
    const overlapX = x < obstacle.x + otherSize && obstacle.x < x + size;
    const overlapY = y < obstacle.y + otherSize && obstacle.y < y + size;
    if (overlapX && overlapY) return false;
  }
  return true;
}

/** Deterministic spawn-spot search; mirrors xorshift in enemy.ts. */
function obstacleRng(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

function spawnObstacles(village: VillageState, now: number): void {
  const elapsed = now - village.lastObstacleAt;
  const intervals = Math.floor(elapsed / OBSTACLE_SPAWN_INTERVAL_MS);
  if (intervals <= 0) return;
  village.lastObstacleAt += intervals * OBSTACLE_SPAWN_INTERVAL_MS;
  const rng = obstacleRng(village.lastObstacleAt);
  const budget = Math.min(intervals, MAX_OBSTACLES - village.obstacles.length);
  for (let i = 0; i < budget; i += 1) {
    const roll = rng();
    const kind: ObstacleKind = roll < 0.5 ? "driftwood" : roll < 0.85 ? "boulder" : "glowbloom";
    const size = OBSTACLES[kind].size;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const x = Math.floor(rng() * (GRID_SIZE - size));
      const y = Math.floor(rng() * (GRID_SIZE - size));
      if (footprintFree(village, x, y, size)) {
        village.obstacles.push({ id: claimId(village, kind), kind, x, y, clearingUntil: null });
        break;
      }
    }
  }
}

// ── Time progression ──────────────────────────────────────────────────────

/** Completes finished construction/training/research jobs. Call before any action. */
export function settleVillage(village: VillageState, now: number): VillageState {
  const next = clone(village);
  let workerNameIndex = next.buildings.filter((b) => b.kind === "workshop").length;
  for (const building of next.buildings) {
    if (building.job && building.job.finishesAt <= now) {
      building.level = building.job.toLevel;
      building.job = null;
      if (BUILDINGS[building.kind].produces && building.collectedAt === undefined) {
        building.collectedAt = now;
      }
      // A freshly finished workshop welcomes its resident tadpole.
      if (building.kind === "workshop" && !building.worker) {
        building.worker = {
          name: WORKER_NAMES[(workerNameIndex - 1 + WORKER_NAMES.length) % WORKER_NAMES.length],
          level: 1,
        };
        workerNameIndex += 1;
      }
      // The finished throne summons the Supreme Axolotl.
      if (building.kind === "sovereignThrone" && !next.hero) {
        next.hero = { level: 1, upgradeJob: null, regenUntil: 0 };
      }
    }
  }
  if (next.hero?.upgradeJob && next.hero.upgradeJob.finishesAt <= now) {
    next.hero = { ...next.hero, level: next.hero.upgradeJob.toLevel, upgradeJob: null };
  }
  // Training advances sequentially: each job's finishesAt was computed when
  // queued, so completed heads simply move into the army (housing allowing).
  while (next.trainQueue.length > 0 && next.trainQueue[0].finishesAt <= now) {
    const job = next.trainQueue.shift();
    if (!job) break;
    next.army[job.troop] = (next.army[job.troop] ?? 0) + 1;
  }
  if (next.researchJob && next.researchJob.finishesAt <= now) {
    next.research[next.researchJob.troop] = next.researchJob.toLevel;
    next.researchJob = null;
  }
  while (next.brewQueue.length > 0 && next.brewQueue[0].finishesAt <= now) {
    const brew = next.brewQueue.shift();
    if (!brew) break;
    next.spells[brew.spell] = (next.spells[brew.spell] ?? 0) + 1;
  }
  // Finished obstacle clears pay out, then new clutter drifts in.
  next.obstacles = next.obstacles.filter((obstacle) => {
    if (obstacle.clearingUntil === null || obstacle.clearingUntil > now) return true;
    const config = OBSTACLES[obstacle.kind];
    next.resources.kelp = Math.min(
      storageCapacity(next, "kelp"),
      next.resources.kelp + config.rewardKelp,
    );
    next.pearls += config.rewardPearls;
    return false;
  });
  spawnObstacles(next, now);
  next.lastSeenAt = now;
  return next;
}

// ── Actions ───────────────────────────────────────────────────────────────

/** Workshops are bought with pearls (gems in CoC); everything else with resources. */
export function buildingCost(village: VillageState, kind: BuildingKind, toLevel: number): number {
  if (kind === "workshop" && toLevel === 1) {
    return WORKSHOP_PEARL_COSTS[
      Math.min(countByKind(village, "workshop"), WORKSHOP_PEARL_COSTS.length - 1)
    ];
  }
  return BUILDINGS[kind].levels[toLevel - 1]?.cost ?? Number.POSITIVE_INFINITY;
}

export function placeBuilding(
  village: VillageState,
  kind: BuildingKind,
  x: number,
  y: number,
  now: number,
): ActionResult {
  const config = BUILDINGS[kind];
  const thLevel = townHallLevel(village);
  const allowed = config.maxCount[thLevel - 1] ?? 0;
  if (countByKind(village, kind) >= allowed) {
    return fail(
      allowed === 0
        ? `${config.name} unlocks at a higher Pondheart level.`
        : `All ${config.name} slots are used at Pondheart level ${thLevel}.`,
    );
  }
  if (!footprintFree(village, x, y, config.size)) return fail("That spot is blocked.");
  const cost = buildingCost(village, kind, 1);
  const paysWithPearls = kind === "workshop";
  if (paysWithPearls) {
    if (village.pearls < cost) return fail(`A new workshop costs ${cost} pearls.`);
  } else if (village.resources[config.costResource] < cost) {
    return fail(`Not enough ${config.costResource === "kelp" ? "kelp" : "glowshards"}.`);
  }
  const instant = kind === "wall" || Boolean(config.isTrap);
  const worker = instant ? null : idleWorker(village);
  if (!instant && !worker) return fail("All tadpole crews are busy.");

  const next = clone(village);
  if (paysWithPearls) next.pearls -= cost;
  else next.resources[config.costResource] -= cost;
  const buildTime = Math.round(
    config.levels[0].buildTimeMs / workerSpeedMultiplier(worker?.worker?.level ?? 1),
  );
  next.buildings.push({
    id: claimId(next, kind),
    kind,
    level: instant ? 1 : 0,
    x,
    y,
    job: instant
      ? null
      : { toLevel: 1, startedAt: now, finishesAt: now + buildTime, workerId: worker?.id },
    ...(config.produces ? { collectedAt: now } : {}),
  });
  return { ok: true, village: next };
}

export function moveBuilding(
  village: VillageState,
  id: string,
  x: number,
  y: number,
): ActionResult {
  const building = village.buildings.find((b) => b.id === id);
  if (!building) return fail("Unknown building.");
  if (!footprintFree(village, x, y, BUILDINGS[building.kind].size, id)) {
    return fail("That spot is blocked.");
  }
  const next = clone(village);
  const moved = next.buildings.find((b) => b.id === id);
  if (moved) {
    moved.x = x;
    moved.y = y;
  }
  return { ok: true, village: next };
}

export function upgradeBuilding(village: VillageState, id: string, now: number): ActionResult {
  const building = village.buildings.find((b) => b.id === id);
  if (!building) return fail("Unknown building.");
  if (building.job) return fail("Already under construction.");
  const config = BUILDINGS[building.kind];
  const toLevel = building.level + 1;
  const cap =
    building.kind === "wall"
      ? Math.min(config.levels.length, Math.ceil(townHallLevel(village) / 2))
      : maxBuildingLevel(building.kind, townHallLevel(village));
  if (toLevel > cap) {
    return fail(
      building.kind === "pondheart"
        ? "The Pondheart is at its peak."
        : "Upgrade the Pondheart first.",
    );
  }
  const cost = buildingCost(village, building.kind, toLevel);
  if (village.resources[config.costResource] < cost) {
    return fail(`Not enough ${config.costResource === "kelp" ? "kelp" : "glowshards"}.`);
  }
  const instant = building.kind === "wall";
  const worker = instant ? null : idleWorker(village);
  if (!instant && !worker) return fail("All tadpole crews are busy.");

  const next = clone(village);
  next.resources[config.costResource] -= cost;
  const upgraded = next.buildings.find((b) => b.id === id);
  if (!upgraded) return fail("Unknown building.");
  if (instant) {
    upgraded.level = toLevel;
  } else {
    const buildTime = Math.round(
      config.levels[toLevel - 1].buildTimeMs / workerSpeedMultiplier(worker?.worker?.level ?? 1),
    );
    upgraded.job = { toLevel, startedAt: now, finishesAt: now + buildTime, workerId: worker?.id };
  }
  return { ok: true, village: next };
}

export function collectFrom(village: VillageState, id: string, now: number): ActionResult {
  const building = village.buildings.find((b) => b.id === id);
  if (!building) return fail("Unknown building.");
  const config = BUILDINGS[building.kind];
  if (!config.produces) return fail("Nothing to collect here.");
  const pending = pendingProduction(building, now);
  if (pending <= 0) return fail("Nothing to collect yet.");

  const next = clone(village);
  const collected = next.buildings.find((b) => b.id === id);
  if (!collected) return fail("Unknown building.");
  const resource = config.produces;
  const capacity = storageCapacity(next, resource);
  next.resources[resource] = Math.min(capacity, next.resources[resource] + pending);
  collected.collectedAt = now;
  return { ok: true, village: next };
}

export function trainTroop(village: VillageState, troop: TroopKind, now: number): ActionResult {
  const config = TROOPS[troop];
  const hatchery = hatcheryLevel(village);
  if (hatchery === 0) return fail("Build a Hatchery first.");
  if (config.unlockLevel > hatchery) {
    return fail(`${config.name} unlocks at Hatchery level ${config.unlockLevel}.`);
  }
  if (armyHousingUsed(village) + config.housing > armyHousingCapacity(village)) {
    return fail("Not enough camp space. Build or upgrade a Mossy Camp.");
  }
  if (village.resources.kelp < config.cost) return fail("Not enough kelp.");
  const queueCap = BUILDINGS.hatchery.levels[hatchery - 1].housing ?? 4;
  if (village.trainQueue.length >= queueCap) return fail("The hatching queue is full.");

  const next = clone(village);
  next.resources.kelp -= config.cost;
  const queueTail = next.trainQueue[next.trainQueue.length - 1];
  const startsAt = queueTail ? queueTail.finishesAt : now;
  next.trainQueue.push({ troop, finishesAt: startsAt + config.trainTimeMs });
  return { ok: true, village: next };
}

export function cancelTraining(village: VillageState, index: number, now: number): ActionResult {
  if (index < 0 || index >= village.trainQueue.length) return fail("Nothing to cancel.");
  const next = clone(village);
  const [removed] = next.trainQueue.splice(index, 1);
  next.resources.kelp = Math.min(
    storageCapacity(next, "kelp"),
    next.resources.kelp + TROOPS[removed.troop].cost,
  );
  // Re-chain finish times. If the head was cancelled the new head restarts
  // from `now`; otherwise the in-progress head keeps its schedule.
  let cursor = now;
  for (let i = 0; i < next.trainQueue.length; i += 1) {
    const job = next.trainQueue[i];
    if (i === 0 && index > 0) {
      cursor = job.finishesAt;
      continue;
    }
    job.finishesAt = cursor + TROOPS[job.troop].trainTimeMs;
    cursor = job.finishesAt;
  }
  return { ok: true, village: next };
}

export function brewSpell(village: VillageState, spell: SpellKind, now: number): ActionResult {
  const spring = spellSpringLevel(village);
  if (spring === 0) return fail("Build a Spell Spring first.");
  const config = SPELLS[spell];
  if (config.unlockLevel > spring) {
    return fail(`${config.name} unlocks at Spell Spring level ${config.unlockLevel}.`);
  }
  if (spellsHeld(village) >= spellCapacity(village)) {
    return fail("The Spell Spring is full. Upgrade it or cast some spells.");
  }
  if (village.resources.kelp < config.cost) return fail("Not enough kelp.");

  const next = clone(village);
  next.resources.kelp -= config.cost;
  const tail = next.brewQueue[next.brewQueue.length - 1];
  const startsAt = tail ? tail.finishesAt : now;
  next.brewQueue.push({ spell, finishesAt: startsAt + config.brewTimeMs });
  return { ok: true, village: next };
}

export function startResearch(village: VillageState, troop: TroopKind, now: number): ActionResult {
  const lab = labLevel(village);
  if (lab === 0) return fail("Build a Glow Lab first.");
  if (village.researchJob) return fail("The lab is already researching.");
  const config = TROOPS[troop];
  if (config.unlockLevel > hatcheryLevel(village)) {
    return fail(`Unlock ${config.name} in the Hatchery first.`);
  }
  const toLevel = troopLevel(village, troop) + 1;
  if (toLevel > troopLevelCap(lab)) {
    return fail(
      toLevel > troopLevelCap(6)
        ? `${config.name} is fully researched.`
        : "Upgrade the Glow Lab to research further.",
    );
  }
  const cost = researchCost(troop, toLevel);
  if (village.resources.kelp < cost) return fail("Not enough kelp.");

  const next = clone(village);
  next.resources.kelp -= cost;
  next.researchJob = {
    troop,
    toLevel,
    startedAt: now,
    finishesAt: now + researchTimeMs(toLevel),
  };
  return { ok: true, village: next };
}

/** Spend pearls to complete a building job or the research job instantly. */
export function finishNow(
  village: VillageState,
  target: { type: "building"; id: string } | { type: "research" } | { type: "hero" },
  now: number,
): ActionResult {
  const next = clone(village);
  let remaining: number;
  if (target.type === "building") {
    const building = next.buildings.find((b) => b.id === target.id);
    if (!building?.job) return fail("Nothing to finish here.");
    remaining = building.job.finishesAt - now;
    const cost = finishNowCost(remaining);
    if (next.pearls < cost) return fail(`Needs ${cost} pearls.`);
    next.pearls -= cost;
    building.level = building.job.toLevel;
    building.job = null;
    if (BUILDINGS[building.kind].produces && building.collectedAt === undefined) {
      building.collectedAt = now;
    }
  } else if (target.type === "hero") {
    if (!next.hero?.upgradeJob) return fail("Nothing to finish here.");
    remaining = next.hero.upgradeJob.finishesAt - now;
    const cost = finishNowCost(remaining);
    if (next.pearls < cost) return fail(`Needs ${cost} pearls.`);
    next.pearls -= cost;
    next.hero = { ...next.hero, level: next.hero.upgradeJob.toLevel, upgradeJob: null };
  } else {
    if (!next.researchJob) return fail("Nothing to finish here.");
    remaining = next.researchJob.finishesAt - now;
    const cost = finishNowCost(remaining);
    if (next.pearls < cost) return fail(`Needs ${cost} pearls.`);
    next.pearls -= cost;
    next.research[next.researchJob.troop] = next.researchJob.toLevel;
    next.researchJob = null;
  }
  return { ok: true, village: next };
}

export function clearObstacle(village: VillageState, id: string, now: number): ActionResult {
  const obstacle = village.obstacles.find((o) => o.id === id);
  if (!obstacle) return fail("Unknown obstacle.");
  if (obstacle.clearingUntil !== null) return fail("Already being cleared.");
  const config = OBSTACLES[obstacle.kind];
  if (village.resources.kelp < config.clearCost) return fail("Not enough kelp.");
  const worker = idleWorker(village);
  if (!worker) return fail("All tadpole crews are busy.");

  const next = clone(village);
  next.resources.kelp -= config.clearCost;
  const clearing = next.obstacles.find((o) => o.id === id);
  if (clearing) {
    clearing.clearingUntil =
      now + Math.round(config.clearTimeMs / workerSpeedMultiplier(worker.worker?.level ?? 1));
    clearing.clearingWorkerId = worker.id;
  }
  return { ok: true, village: next };
}

/** The hero can join a raid: summoned, not upgrading, not knocked out. */
export function heroReady(village: VillageState, now: number): boolean {
  return Boolean(village.hero && !village.hero.upgradeJob && village.hero.regenUntil <= now);
}

export function startHeroUpgrade(village: VillageState, now: number): ActionResult {
  if (!village.hero) return fail("Build the Sovereign Throne first.");
  if (village.hero.upgradeJob) return fail("The Supreme Axolotl is already training.");
  const toLevel = village.hero.level + 1;
  if (toLevel > heroLevelCap(townHallLevel(village))) {
    return fail("Upgrade the Pondheart to train the Sovereign further.");
  }
  const cost = heroUpgradeCost(toLevel);
  if (village.resources.kelp < cost) return fail("Not enough kelp.");

  const next = clone(village);
  next.resources.kelp -= cost;
  next.hero = {
    ...next.hero!,
    upgradeJob: { toLevel, startedAt: now, finishesAt: now + heroUpgradeTimeMs(toLevel) },
  };
  return { ok: true, village: next };
}

/** Marks the hero knocked out after a raid; it regenerates over time. */
export function knockOutHero(village: VillageState, now: number, regenMs: number): VillageState {
  if (!village.hero) return village;
  const next = clone(village);
  next.hero = { ...next.hero!, regenUntil: now + regenMs };
  return next;
}

/** Raises a workshop's tadpole one level for shards (instant, like CoC gems). */
export function upgradeWorker(village: VillageState, workshopId: string): ActionResult {
  const workshop = village.buildings.find((b) => b.id === workshopId && b.kind === "workshop");
  if (!workshop?.worker) return fail("No tadpole lives there yet.");
  if (workshop.worker.level >= MAX_WORKER_LEVEL) {
    return fail(`${workshop.worker.name} is already a master builder.`);
  }
  const cost = workerUpgradeCost(workshop.worker.level);
  if (village.resources.shards < cost) return fail("Not enough glowshards.");

  const next = clone(village);
  next.resources.shards -= cost;
  const upgraded = next.buildings.find((b) => b.id === workshopId);
  if (upgraded?.worker) upgraded.worker = { ...upgraded.worker, level: upgraded.worker.level + 1 };
  return { ok: true, village: next };
}

/** Applies a finished attack back onto the player's village. */
export function applyBattleOutcome(
  village: VillageState,
  outcome: {
    victory: boolean;
    lootWon: Record<ResourceKind, number>;
    trophyDelta: number;
    pearlsWon: number;
    troopsSpent: Partial<Record<TroopKind, number>>;
    spellsSpent: Partial<Record<SpellKind, number>>;
  },
): VillageState {
  const next = clone(village);
  for (const resource of ["kelp", "shards"] as ResourceKind[]) {
    next.resources[resource] = Math.min(
      storageCapacity(next, resource),
      next.resources[resource] + (outcome.lootWon[resource] ?? 0),
    );
  }
  next.trophies = Math.max(0, next.trophies + outcome.trophyDelta);
  next.pearls += outcome.pearlsWon;
  for (const [kind, spent] of Object.entries(outcome.troopsSpent)) {
    const troop = kind as TroopKind;
    const remaining = (next.army[troop] ?? 0) - (spent ?? 0);
    if (remaining > 0) next.army[troop] = remaining;
    else delete next.army[troop];
  }
  for (const [kind, spent] of Object.entries(outcome.spellsSpent)) {
    const spell = kind as SpellKind;
    const remaining = (next.spells[spell] ?? 0) - (spent ?? 0);
    if (remaining > 0) next.spells[spell] = remaining;
    else delete next.spells[spell];
  }
  if (outcome.victory) next.battlesWon += 1;
  else next.battlesLost += 1;
  return next;
}

export function recordRaid(village: VillageState, report: RaidReport): VillageState {
  const next = clone(village);
  next.resources.kelp = Math.max(0, next.resources.kelp - report.lostKelp);
  next.resources.shards = Math.max(0, next.resources.shards - report.lostShards);
  next.trophies = Math.max(0, next.trophies + report.trophyDelta);
  next.raidLog = [report, ...next.raidLog].slice(0, MAX_RAID_LOG);
  if (!report.defended) next.shieldUntil = report.at + 12 * 3600 * 1000;
  return next;
}
