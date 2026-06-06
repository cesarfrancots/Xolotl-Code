import type { CivCivilization, CivLogEntry, CivSessionSnapshot } from "../bindings";

export type CivPlayerTask = {
  kind: "fetch_resource" | "trade_resource" | "visit_building" | "repair_object" | "rescue_object" | "build_bridge";
  npcId: string;
  npcName: string;
  resource: string;
  sourceResource: string;
  amount: number;
  baseline: number;
  reward: string;
  rewardResource: string;
  rewardAmount: number;
  buildingId: string;
  buildingName: string;
  objectId: string;
  objectName: string;
  requestedTurn: number;
  current: number;
  progress: number;
  remaining: number;
  status: "open" | "ready";
};

const TASK_TITLES = new Set(["NPC request", "Task pending", "Task complete"]);

export function activeCivPlayerTask(snapshot: CivSessionSnapshot, civ: CivCivilization | null): CivPlayerTask | null {
  if (!civ) return null;
  const latest = [...(snapshot.log ?? [])]
    .reverse()
    .find((entry) => entry.kind === "player" && TASK_TITLES.has(entry.title));
  if (!latest || latest.title === "Task complete") return null;

  const kind = marker(latest.body, "task") as CivPlayerTask["kind"];
  const npcId = marker(latest.body, "npc");
  if (!["fetch_resource", "trade_resource", "visit_building", "repair_object", "rescue_object", "build_bridge"].includes(kind) || !npcId) return null;

  const resource = marker(latest.body, "resource");
  const amount = numberMarker(latest.body, "amount", kind === "visit_building" ? 0 : 1);
  const baseline = numberMarker(latest.body, "baseline", resource ? civ.resources?.[resource] ?? 0 : 0);
  const sourceResource = marker(latest.body, "source") || taskSourceResource(resource);
  const reward = marker(latest.body, "reward") || "morale";
  const rewardResource = marker(latest.body, "reward_resource");
  const rewardAmount = numberMarker(latest.body, "reward_amount", rewardResource ? 1 : 0);
  const buildingId = marker(latest.body, "building");
  const objectId = marker(latest.body, "object");
  const terrainRemaining = kind === "rescue_object"
    ? rescueRubbleRemaining(snapshot, objectId)
    : kind === "build_bridge"
      ? bridgeTilesRemaining(snapshot, objectId)
      : 0;
  const current = kind === "rescue_object" || kind === "build_bridge"
    ? Math.max(0, amount - terrainRemaining)
    : resource ? civ.resources?.[resource] ?? 0 : 0;
  const progress = kind === "visit_building"
    ? 0
    : kind === "rescue_object" || kind === "build_bridge"
      ? current
      : Math.min(amount, Math.max(0, current - baseline));
  const remaining = kind === "visit_building"
    ? 1
    : kind === "rescue_object" || kind === "build_bridge"
      ? terrainRemaining
      : Math.max(0, amount - progress);
  const npc = snapshot.world.entities.find((entity) => entity.id === npcId);
  const building = snapshot.world.entities.find((entity) => entity.id === buildingId);
  const object = snapshot.world.entities.find((entity) => entity.id === objectId);

  return {
    kind,
    npcId,
    npcName: npc?.name || "Axolotl",
    resource,
    sourceResource,
    amount,
    baseline,
    reward,
    rewardResource,
    rewardAmount,
    buildingId,
    buildingName: building?.name || building?.role || "building",
    objectId,
    objectName: object?.name || object?.role || "object",
    requestedTurn: latest.turn,
    current,
    progress,
    remaining,
    status: kind !== "visit_building" && remaining === 0 ? "ready" : "open",
  };
}

export function taskSourceResource(resource: string) {
  if (!resource) return "";
  if (resource === "food") return "moss";
  return resource;
}

export function taskYieldResource(resource: string) {
  if (resource === "moss") return "food";
  return resource;
}

export function cleanCivLogBody(entry: CivLogEntry) {
  let body = entry.body.replace(/^target=[^;]+;\s*/, "");
  body = body.replace(/\s*task=(fetch_resource|trade_resource|visit_building|repair_object|rescue_object|build_bridge);.*$/, "");
  return body.trim();
}

function rescueRubbleRemaining(snapshot: CivSessionSnapshot, objectId: string) {
  const object = snapshot.world.entities.find((entity) => entity.id === objectId);
  if (!object) return 1;
  return rescueRubbleTiles(object.x, object.y).filter((rubble) => snapshot.world.tiles.some((tile) => (
    tile.x === rubble.x
    && tile.y === rubble.y
    && tile.terrain !== "air"
    && tile.terrain !== "water"
    && tile.terrain !== "deepwater"
  ))).length;
}

function rescueRubbleTiles(x: number, y: number) {
  const shaftX = Math.max(0, x - 1);
  const shaftTop = Math.max(7, y - 3);
  const tiles = [];
  for (let tileY = shaftTop; tileY <= y; tileY += 1) {
    tiles.push({ x: shaftX, y: tileY });
  }
  tiles.push({ x, y: y + 1 });
  return tiles;
}

function bridgeTilesRemaining(snapshot: CivSessionSnapshot, objectId: string) {
  const object = snapshot.world.entities.find((entity) => entity.id === objectId);
  if (!object) return 1;
  if (object.activity === "built") return 0;
  const bridgeTiles = [
    { x: object.x - 1, y: object.y + 1 },
    { x: object.x, y: object.y + 1 },
    { x: object.x + 1, y: object.y + 1 },
  ];
  return bridgeTiles.filter((bridge) => snapshot.world.tiles.some((tile) => (
    tile.x === bridge.x
    && tile.y === bridge.y
    && (tile.terrain === "air" || tile.terrain === "water" || tile.terrain === "deepwater")
  ))).length;
}

function marker(body: string, key: string) {
  const match = body.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`));
  return match?.[1]?.trim() ?? "";
}

function numberMarker(body: string, key: string, fallback: number) {
  const value = Number.parseInt(marker(body, key), 10);
  return Number.isFinite(value) ? value : fallback;
}
