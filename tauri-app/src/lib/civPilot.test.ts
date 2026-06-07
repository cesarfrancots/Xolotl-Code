import { describe, expect, it, vi } from "vitest";
import { chooseCivPilotDecision, createCivPilotMemory, type CivPilotTextState } from "./civPilot";

// renderSnapshotToText lives in the canvas module, which imports Phaser at module
// load (Phaser's ESM init touches a canvas and crashes under jsdom). The render
// function itself is pure (no Phaser), so stub the module to import it safely.
vi.mock("phaser", () => {
  class Scene {}
  return { default: { Scene, Game: class {}, AUTO: 0, Scale: { RESIZE: 0, NO_CENTER: 0 } }, Scene };
});

import { renderSnapshotToText } from "../components/civilization/CivilizationGameCanvas";
import type { CivCivilization, CivSessionSnapshot } from "../bindings";

function fixtureCiv(overrides: Partial<CivCivilization> = {}): CivCivilization {
  return {
    id: "civ-1",
    name: "Pondfolk",
    model: "claude",
    color: "#6dd6a7",
    spawn_x: 0,
    home_region: "",
    alive: true,
    diplomacy: {},
    era: "pond_camp",
    population: 12,
    health: 80,
    morale: 70,
    resources: { food: 5, stone: 3 },
    techs: [],
    policies: [],
    score: { survival: 10, ethics: 5, intelligence: 8, total: 23 },
    controller: null,
    ...overrides,
  };
}

function multiCivSnapshot(civs: CivCivilization[]): CivSessionSnapshot {
  return {
    id: "sess-1",
    name: "Arena",
    seed: 1,
    version: 2,
    created_at: 0,
    updated_at: 0,
    turn: 3,
    world: { width: 64, height: 36, tiles: [], entities: [], regions: [] },
    civs,
    environment: {
      season: "spring",
      turn_of_season: 1,
      temperature: 14,
      water_level: 0,
      disasters: [],
      forecast: null,
    },
    modifiers: [],
    log: [],
  };
}

function rescueTask(overrides: Partial<NonNullable<CivPilotTextState["player_task"]>> = {}): NonNullable<CivPilotTextState["player_task"]> {
  return {
    kind: "rescue_object",
    npcId: "axo-7",
    npcName: "Axolotl 7",
    resource: "rubble",
    sourceResource: "rubble",
    amount: 3,
    baseline: 0,
    reward: "morale",
    rewardResource: "",
    rewardAmount: 0,
    buildingId: "",
    buildingName: "building",
    objectId: "trapped-1",
    objectName: "Trapped Juvenile",
    requestedTurn: 3,
    current: 3,
    progress: 3,
    remaining: 0,
    status: "ready",
    ...overrides,
  };
}

function bridgeTask(overrides: Partial<NonNullable<CivPilotTextState["player_task"]>> = {}): NonNullable<CivPilotTextState["player_task"]> {
  return {
    kind: "build_bridge",
    npcId: "axo-2",
    npcName: "Axolotl 2",
    resource: "stone",
    sourceResource: "stone",
    amount: 3,
    baseline: 0,
    reward: "glow_pocket",
    rewardResource: "",
    rewardAmount: 0,
    buildingId: "",
    buildingName: "building",
    objectId: "bridge-1",
    objectName: "Bridge Gap",
    requestedTurn: 3,
    current: 2,
    progress: 2,
    remaining: 1,
    status: "open",
    ...overrides,
  };
}

function fetchTask(overrides: Partial<NonNullable<CivPilotTextState["player_task"]>> = {}): NonNullable<CivPilotTextState["player_task"]> {
  return {
    kind: "fetch_resource",
    npcId: "rescued-trapped-1",
    npcName: "Rescued Juvenile",
    resource: "food",
    sourceResource: "moss",
    amount: 2,
    baseline: 45,
    reward: "morale",
    rewardResource: "",
    rewardAmount: 0,
    buildingId: "",
    buildingName: "building",
    objectId: "",
    objectName: "object",
    requestedTurn: 3,
    current: 45,
    progress: 0,
    remaining: 2,
    status: "open",
    ...overrides,
  };
}

describe("chooseCivPilotDecision", () => {
  it("mines a direct blocker while approaching a ready rescue target", () => {
    const state: CivPilotTextState = {
      player: {
        possessedEntityId: "axo-1",
        player: {
          x: 933,
          y: 728,
          tile_x: 58,
          tile_y: 45,
          blocked: { x: 952, tile_x: 59, tile_y: 45, age_ms: 0, reason: "solid_tile" },
        },
        nearby_interactions: [
          {
            kind: "object",
            action: "rescue_object",
            label: "Trapped Juvenile",
            targetId: "trapped-1",
            x: 1032,
            y: 788,
            tileX: 64,
            tileY: 49,
            distance: 116,
          },
          {
            kind: "terrain",
            action: "mine_tile",
            label: "moss",
            targetId: "tile:59,45",
            x: 952,
            y: 728,
            tileX: 59,
            tileY: 45,
            distance: 19,
          },
        ],
      },
      player_task: rescueTask(),
    };

    const decision = chooseCivPilotDecision(state, "task-rescue", 60, createCivPilotMemory());

    expect(decision.action).toBe("interact");
    if (decision.action !== "interact") return;
    expect(decision.tool).toBe("mine");
    expect(decision.target?.targetId).toBe("tile:59,45");
  });

  it("uses a ready rescue target once the trapped object is within rescue reach", () => {
    const state: CivPilotTextState = {
      player: {
        possessedEntityId: "axo-1",
        player: {
          x: 982,
          y: 728,
          tile_x: 61,
          tile_y: 45,
          blocked: { x: 1000, y: 744, tile_x: 62, tile_y: 46, age_ms: 0, reason: "solid_tile" },
        },
        nearby_interactions: [
          {
            kind: "object",
            action: "rescue_object",
            label: "Trapped Juvenile",
            targetId: "trapped-1",
            x: 1032,
            y: 788,
            tileX: 64,
            tileY: 49,
            distance: 78,
          },
          {
            kind: "terrain",
            action: "mine_tile",
            label: "mud",
            targetId: "tile:61,46",
            x: 984,
            y: 744,
            tileX: 61,
            tileY: 46,
            distance: 16,
          },
        ],
      },
      player_task: rescueTask(),
    };

    const decision = chooseCivPilotDecision(state, "task-rescue", 104, createCivPilotMemory());

    expect(decision.action).toBe("interact");
    if (decision.action !== "interact") return;
    expect(decision.tool).toBe("use");
    expect(decision.target?.targetId).toBe("trapped-1");
  });

  it("approaches a ready rescue target from a lower side when no blocker is present", () => {
    const state: CivPilotTextState = {
      player: {
        possessedEntityId: "axo-1",
        player: {
          x: 933,
          y: 728,
          tile_x: 58,
          tile_y: 45,
          blocked: null,
        },
        nearby_interactions: [
          {
            kind: "object",
            action: "rescue_object",
            label: "Trapped Juvenile",
            targetId: "trapped-1",
            x: 1032,
            y: 788,
            tileX: 64,
            tileY: 49,
            distance: 116,
          },
        ],
      },
      player_task: rescueTask(),
    };

    const decision = chooseCivPilotDecision(state, "task-rescue", 61, createCivPilotMemory());

    expect(decision.action).toBe("move");
    if (decision.action !== "move") return;
    expect(decision.target.targetId).toBe("trapped-1");
    expect(decision.target.x).toBe(1074);
    expect(decision.target.y).toBe(796);
  });

  it("mines visible rescue rubble once the forced rescue route is in reach", () => {
    const state: CivPilotTextState = {
      player: {
        possessedEntityId: "axo-1",
        player: {
          x: 1060,
          y: 792,
          tile_x: 66,
          tile_y: 49,
          blocked: null,
        },
        nearby_interactions: [
          {
            kind: "terrain",
            action: "mine_tile",
            label: "stone",
            targetId: "tile:64,50",
            x: 1032,
            y: 808,
            tileX: 64,
            tileY: 50,
            distance: 32,
          },
          {
            kind: "object",
            action: "rescue_object",
            label: "Trapped Juvenile",
            targetId: "trapped-1",
            x: 1032,
            y: 788,
            tileX: 64,
            tileY: 49,
            distance: 48,
          },
        ],
      },
      player_task: rescueTask({ current: 0, progress: 0, remaining: 3, status: "open" }),
    };

    const decision = chooseCivPilotDecision(state, "task-rescue", 96, createCivPilotMemory());

    expect(decision.action).toBe("interact");
    if (decision.action !== "interact") return;
    expect(decision.tool).toBe("mine");
    expect(decision.target?.targetId).toBe("tile:64,50");
  });

  it("mines an open-rescue path blocker before trying to reach lower rubble", () => {
    const state: CivPilotTextState = {
      player: {
        possessedEntityId: "axo-1",
        player: {
          x: 1042,
          y: 733,
          tile_x: 65,
          tile_y: 45,
          blocked: { x: 1016, y: 760, tile_x: 63, tile_y: 47, age_ms: 180, reason: "solid_tile" },
          hazard_contact: {
            id: "oxygen-1",
            label: "Low Oxygen Pocket",
            role: "oxygen",
            x: 1016,
            y: 788,
            tile_x: 63,
            tile_y: 49,
            distance: 61,
            severity: 0.1,
          },
          oxygen: {
            value: 100,
            max: 100,
            status: "draining",
            in_pocket: true,
            source: "Low Oxygen Pocket",
          },
        },
        nearby_interactions: [
          {
            kind: "terrain",
            action: "mine_tile",
            label: "earth",
            targetId: "tile:63,49",
            x: 1016,
            y: 792,
            tileX: 63,
            tileY: 49,
            distance: 65,
          },
          {
            kind: "terrain",
            action: "mine_tile",
            label: "mud",
            targetId: "tile:63,47",
            x: 1016,
            y: 760,
            tileX: 63,
            tileY: 47,
            distance: 38,
          },
          {
            kind: "object",
            action: "rescue_object",
            label: "Trapped Juvenile",
            targetId: "trapped-1",
            x: 1032,
            y: 788,
            tileX: 64,
            tileY: 49,
            distance: 56,
          },
        ],
      },
      player_task: rescueTask({ current: 0, progress: 0, remaining: 3, status: "open" }),
    };

    const decision = chooseCivPilotDecision(state, "task-rescue", 15, createCivPilotMemory());

    expect(decision.action).toBe("interact");
    if (decision.action !== "interact") return;
    expect(decision.tool).toBe("mine");
    expect(decision.target?.targetId).toBe("tile:63,47");
  });

  it("keeps mining the shortened upper rescue shaft after the bottom blocker is cleared", () => {
    const state: CivPilotTextState = {
      player: {
        possessedEntityId: "axo-1",
        player: {
          x: 1046,
          y: 769,
          tile_x: 65,
          tile_y: 48,
          blocked: null,
          oxygen: {
            value: 90,
            max: 100,
            status: "draining",
            in_pocket: true,
            source: "Low Oxygen Pocket",
          },
        },
        nearby_interactions: [
          {
            kind: "terrain",
            action: "mine_tile",
            label: "mud",
            targetId: "tile:63,47",
            x: 1016,
            y: 760,
            tileX: 63,
            tileY: 47,
            distance: 31,
          },
          {
            kind: "object",
            action: "rescue_object",
            label: "Trapped Juvenile",
            targetId: "trapped-1",
            x: 1032,
            y: 788,
            tileX: 64,
            tileY: 49,
            distance: 35,
          },
        ],
      },
      player_task: rescueTask({ amount: 5, current: 2, progress: 2, remaining: 3, status: "open" }),
    };

    const decision = chooseCivPilotDecision(state, "task-rescue", 67, createCivPilotMemory());

    expect(decision.action).toBe("interact");
    if (decision.action !== "interact") return;
    expect(decision.tool).toBe("mine");
    expect(decision.target?.targetId).toBe("tile:63,47");
  });

  it("builds the remaining center bridge tile instead of orbiting the bridge object", () => {
    const state: CivPilotTextState = {
      player: {
        possessedEntityId: "axo-1",
        player: {
          x: 1130,
          y: 807,
          tile_x: 70,
          tile_y: 50,
          blocked: { x: 1144, y: 808, tile_x: 71, tile_y: 50, age_ms: 0, reason: "solid_tile" },
        },
        nearby_interactions: [
          {
            kind: "object",
            label: "Bridge Gap",
            targetId: "bridge-1",
            x: 1128,
            y: 788,
            tileX: 70,
            tileY: 49,
            distance: 19,
          },
          {
            kind: "terrain",
            action: "place_tile",
            label: "stone",
            targetId: "tile:70,50",
            x: 1128,
            y: 808,
            tileX: 70,
            tileY: 50,
            distance: 2,
          },
        ],
      },
      player_task: bridgeTask(),
    };

    const decision = chooseCivPilotDecision(state, "task-bridge", 119, createCivPilotMemory());

    expect(decision.action).toBe("interact");
    if (decision.action !== "interact") return;
    expect(decision.tool).toBe("build");
    expect(decision.target?.targetId).toBe("tile:70,50");
  });

  it("builds the final bridge tile from the adjacent perch when the built tile blocks closer movement", () => {
    const state: CivPilotTextState = {
      player: {
        possessedEntityId: "axo-1",
        player: {
          x: 1097,
          y: 792,
          tile_x: 68,
          tile_y: 49,
          blocked: { x: 1112, y: 808, tile_x: 69, tile_y: 50, age_ms: 0, reason: "solid_tile" },
        },
        nearby_interactions: [
          {
            kind: "terrain",
            action: "place_tile",
            label: "stone",
            targetId: "tile:71,50",
            x: 1144,
            y: 808,
            tileX: 71,
            tileY: 50,
            distance: 49,
          },
          {
            kind: "object",
            label: "Bridge Gap",
            targetId: "bridge-1",
            x: 1128,
            y: 788,
            tileX: 70,
            tileY: 49,
            distance: 31,
          },
        ],
      },
      player_task: bridgeTask({ current: 2, progress: 2, remaining: 1, status: "open" }),
    };

    const decision = chooseCivPilotDecision(state, "task-bridge", 24, createCivPilotMemory());

    expect(decision.action).toBe("interact");
    if (decision.action !== "interact") return;
    expect(decision.tool).toBe("build");
    expect(decision.target?.targetId).toBe("tile:71,50");
  });

  it("mines a fresh path blocker when gathering for a fetch task stalls against terrain", () => {
    const state: CivPilotTextState = {
      player: {
        possessedEntityId: "axo-1",
        player: {
          x: 1023,
          y: 680,
          tile_x: 63,
          tile_y: 42,
          blocked: { x: 1016, y: 696, tile_x: 63, tile_y: 43, age_ms: 0, reason: "solid_tile" },
        },
        nearby_interactions: [
          {
            kind: "resource",
            label: "moss",
            resource: "moss",
            targetId: "tile:52,50",
            x: 840,
            y: 808,
            tileX: 52,
            tileY: 50,
            amount: 8,
            distance: 223,
          },
          {
            kind: "terrain",
            action: "mine_tile",
            label: "moss",
            targetId: "tile:63,43",
            x: 1016,
            y: 696,
            tileX: 63,
            tileY: 43,
            distance: 17,
          },
        ],
      },
      player_task: fetchTask(),
    };

    const decision = chooseCivPilotDecision(state, "task-loop", 108, createCivPilotMemory());

    expect(decision.action).toBe("interact");
    if (decision.action !== "interact") return;
    expect(decision.label).toBe("mine path to moss");
    expect(decision.tool).toBe("mine");
    expect(decision.target?.targetId).toBe("tile:63,43");
  });

  it("retreats from a draining low-oxygen pocket before oxygen becomes critical", () => {
    const state: CivPilotTextState = {
      player: {
        possessedEntityId: "axo-1",
        player: {
          x: 1074,
          y: 792,
          tile_x: 67,
          tile_y: 49,
          blocked: null,
          hazard_contact: {
            id: "oxygen-1",
            label: "Low Oxygen Pocket",
            role: "oxygen",
            x: 1016,
            y: 788,
            tile_x: 63,
            tile_y: 49,
            distance: 58,
            severity: 0.14,
          },
          oxygen: {
            value: 72,
            max: 100,
            status: "draining",
            in_pocket: true,
            source: "Low Oxygen Pocket",
          },
        },
        nearby_interactions: [],
      },
      visible_entities: [],
    };

    const decision = chooseCivPilotDecision(state, "explore", 88, createCivPilotMemory());

    expect(decision.action).toBe("move");
    if (decision.action !== "move") return;
    expect(decision.label).toBe("retreat for oxygen");
    expect(decision.target.label).toBe("oxygen retreat");
    expect(decision.target.x).toBeGreaterThan(state.player!.player!.x);
    expect(decision.target.y).toBeLessThan(state.player!.player!.y);
  });

  it("holds near the last NPC after a task completes instead of patrolling into deep terrain", () => {
    const state: CivPilotTextState = {
      player: {
        possessedEntityId: "axo-1",
        player: {
          x: 904,
          y: 720,
          tile_x: 56,
          tile_y: 45,
          blocked: null,
        },
        lastInteraction: {
          kind: "npc",
          label: "Axolotl 3",
          targetId: "axo-3",
          x: 840,
          y: 226,
          distance: 0,
        },
        nearby_interactions: [],
      },
      visible_entities: [
        { id: "pond-heart", kind: "building", role: "pond", x: 56, y: 45 },
      ],
    };
    const memory = createCivPilotMemory();
    memory.taskCompletedAt = 12;

    const decision = chooseCivPilotDecision(state, "task-trade", 24, memory);

    expect(decision.action).toBe("move");
    if (decision.action !== "move") return;
    expect(decision.label).toBe("task done: return to friends");
    expect(decision.target.targetId).toBe("axo-3");
    expect(decision.target.y).toBeLessThan(300);
  });

  it("rallies briefly after a loop task completes before requesting another task", () => {
    const state: CivPilotTextState = {
      player: {
        possessedEntityId: "axo-1",
        player: {
          x: 832,
          y: 226,
          tile_x: 52,
          tile_y: 14,
          blocked: null,
        },
        lastInteraction: {
          kind: "npc",
          label: "Axolotl 3",
          targetId: "axo-3",
          x: 840,
          y: 226,
          distance: 0,
        },
        nearby_interactions: [],
      },
      visible_entities: [
        { id: "axo-2", kind: "axolotl", role: "builder", morph: "wild", stage: "adult", x: 50, y: 13 },
        { id: "axo-3", kind: "axolotl", role: "worker", morph: "copper", stage: "adult", x: 52, y: 14 },
      ],
    };
    const memory = createCivPilotMemory();
    memory.taskCompletedAt = 20;

    const decision = chooseCivPilotDecision(state, "task-loop", 23, memory);

    expect(decision.action).toBe("move");
    if (decision.action !== "move") return;
    expect(decision.label).toBe("task done: hold position");
    expect(decision.target.targetId).toBe("axo-3");
    expect(memory.taskCompletedAt).toBe(20);
  });

  it("rotates loop mode to another visible requester after the post-task rally", () => {
    const state: CivPilotTextState = {
      player: {
        possessedEntityId: "axo-1",
        player: {
          x: 832,
          y: 226,
          tile_x: 52,
          tile_y: 14,
          blocked: null,
        },
        lastInteraction: {
          kind: "npc",
          label: "Axolotl 2",
          targetId: "axo-2",
          x: 808,
          y: 210,
          distance: 30,
        },
        nearby_interactions: [],
      },
      visible_entities: [
        { id: "axo-1", kind: "axolotl", role: "worker", morph: "leucistic", stage: "adult", x: 52, y: 14 },
        { id: "axo-2", kind: "axolotl", role: "builder", morph: "wild", stage: "adult", x: 50, y: 13 },
        { id: "axo-3", name: "Axolotl 3", kind: "axolotl", role: "worker", morph: "copper", stage: "adult", x: 54, y: 14 },
      ],
    };
    const memory = createCivPilotMemory();
    memory.taskCompletedAt = 10;
    memory.loopRequesterCursor = 0;
    memory.preferredRequesterId = "axo-2";

    const decision = chooseCivPilotDecision(state, "task-loop", 18, memory);

    expect(decision.action).toBe("move");
    if (decision.action !== "move") return;
    expect(decision.label).toBe("request task from Axolotl 3");
    expect(decision.target.targetId).toBe("axo-3");
    expect(memory.taskCompletedAt).toBeUndefined();
    expect(memory.preferredRequesterId).toBe("axo-3");
  });

  it("skips juveniles as autonomous loop task requesters", () => {
    const state: CivPilotTextState = {
      player: {
        possessedEntityId: "axo-1",
        player: {
          x: 856,
          y: 756,
          tile_x: 53,
          tile_y: 47,
          blocked: null,
        },
        lastInteraction: {
          kind: "object",
          label: "Nest Breach",
          targetId: "breach-1",
          x: 856,
          y: 756,
          distance: 0,
        },
        nearby_interactions: [],
      },
      visible_entities: [
        { id: "axo-1", kind: "axolotl", role: "worker", morph: "leucistic", stage: "adult", x: 53, y: 47 },
        { id: "axo-2", name: "Axolotl 2", kind: "axolotl", role: "builder", morph: "wild", stage: "adult", x: 50, y: 13 },
        { id: "axo-8", name: "Axolotl 8", kind: "axolotl", role: "elder", morph: "albino", stage: "elder", x: 62, y: 15 },
        { id: "rescued-trapped-1", name: "Rescued Juvenile", kind: "axolotl", role: "juvenile", morph: "leucistic", stage: "juvenile", x: 65, y: 49 },
      ],
    };
    const memory = createCivPilotMemory();
    memory.taskCompletedAt = 30;
    memory.loopRequesterCursor = 1;
    memory.preferredRequesterId = "axo-8";

    const decision = chooseCivPilotDecision(state, "task-loop", 35, memory);

    expect(decision.action).toBe("move");
    if (decision.action !== "move") return;
    expect(decision.label).toBe("request task from Axolotl 2");
    expect(decision.target.targetId).toBe("axo-2");
    expect(memory.preferredRequesterId).toBe("axo-2");
  });

  it("skips completed one-shot object requesters when loop mode wraps", () => {
    const state: CivPilotTextState = {
      player: {
        possessedEntityId: "axo-1",
        player: {
          x: 856,
          y: 756,
          tile_x: 53,
          tile_y: 47,
          blocked: null,
        },
        lastInteraction: {
          kind: "object",
          label: "Nest Breach",
          targetId: "breach-1",
          x: 856,
          y: 756,
          distance: 0,
        },
        nearby_interactions: [],
      },
      visible_entities: [
        { id: "axo-1", kind: "axolotl", role: "worker", morph: "leucistic", stage: "adult", x: 53, y: 47 },
        { id: "axo-2", name: "Axolotl 2", kind: "axolotl", role: "builder", morph: "wild", stage: "adult", x: 50, y: 13 },
        { id: "axo-3", name: "Axolotl 3", kind: "axolotl", role: "worker", morph: "gold", stage: "adult", x: 52, y: 14 },
        { id: "axo-7", name: "Axolotl 7", kind: "axolotl", role: "scout", morph: "melanoid", stage: "adult", x: 60, y: 14 },
        { id: "axo-8", name: "Axolotl 8", kind: "axolotl", role: "elder", morph: "albino", stage: "elder", x: 62, y: 15 },
        { id: "rescued-trapped-1", name: "Rescued Juvenile", kind: "axolotl", role: "juvenile", morph: "leucistic", stage: "juvenile", x: 65, y: 49 },
        { id: "bridge-1", kind: "object", role: "bridge", activity: "built", x: 70, y: 49 },
        { id: "trapped-1", kind: "object", role: "trapped", activity: "rescued", x: 64, y: 49 },
        { id: "breach-1", kind: "object", role: "breach", activity: "repaired", x: 53, y: 47 },
      ],
    };
    const memory = createCivPilotMemory();
    memory.taskCompletedAt = 30;
    memory.loopRequesterCursor = 6;
    memory.preferredRequesterId = "axo-8";

    const decision = chooseCivPilotDecision(state, "task-loop", 35, memory);

    expect(decision.action).toBe("move");
    if (decision.action !== "move") return;
    expect(decision.label).toBe("request task from Axolotl 3");
    expect(decision.target.targetId).toBe("axo-3");
    expect(memory.preferredRequesterId).toBe("axo-3");
  });

  it("rotates away from a loop requester that was just tried but produced no task", () => {
    const state: CivPilotTextState = {
      player: {
        possessedEntityId: "axo-1",
        player: {
          x: 832,
          y: 226,
          tile_x: 52,
          tile_y: 14,
          blocked: null,
        },
        lastInteraction: {
          kind: "npc",
          label: "Axolotl 4",
          targetId: "axo-4",
          x: 872,
          y: 242,
          distance: 40,
        },
        nearby_interactions: [],
      },
      visible_entities: [
        { id: "axo-1", kind: "axolotl", role: "worker", morph: "leucistic", stage: "adult", x: 52, y: 14 },
        { id: "axo-3", name: "Axolotl 3", kind: "axolotl", role: "worker", morph: "gold", stage: "adult", x: 52, y: 14 },
        { id: "axo-4", name: "Axolotl 4", kind: "axolotl", role: "worker", morph: "axanthic", stage: "adult", x: 54, y: 15 },
        { id: "axo-5", name: "Axolotl 5", kind: "axolotl", role: "worker", morph: "copper", stage: "adult", x: 56, y: 12 },
      ],
    };
    const memory = createCivPilotMemory();
    memory.loopRequesterCursor = 0;
    memory.preferredRequesterId = "axo-4";
    memory.interactions.set("axo-4:npc", 39);

    const decision = chooseCivPilotDecision(state, "task-loop", 40, memory);

    expect(decision.action).toBe("move");
    if (decision.action !== "move") return;
    expect(decision.target.targetId).toBe("axo-5");
    expect(memory.preferredRequesterId).toBe("axo-5");
  });

  it("advances the turn after all loop requesters are exhausted", () => {
    const state: CivPilotTextState = {
      session: { turn: 4 },
      player: {
        possessedEntityId: "axo-1",
        player: {
          x: 880,
          y: 210,
          tile_x: 55,
          tile_y: 13,
          blocked: null,
        },
        lastInteraction: {
          kind: "npc",
          label: "Axolotl 5",
          targetId: "axo-5",
          x: 904,
          y: 194,
          distance: 29,
        },
        nearby_interactions: [],
      },
      visible_entities: [
        { id: "axo-1", kind: "axolotl", role: "worker", morph: "leucistic", stage: "adult", x: 55, y: 13 },
        { id: "axo-3", name: "Axolotl 3", kind: "axolotl", role: "worker", morph: "gold", stage: "adult", x: 52, y: 14 },
        { id: "axo-5", name: "Axolotl 5", kind: "axolotl", role: "worker", morph: "copper", stage: "adult", x: 56, y: 12 },
      ],
    };
    const memory = createCivPilotMemory();
    memory.loopTurn = 4;
    memory.loopExhaustedRequesterIds = new Set(["axo-3"]);
    memory.preferredRequesterId = "axo-5";
    memory.interactions.set("axo-5:npc", 41);

    const decision = chooseCivPilotDecision(state, "task-loop", 42, memory);

    expect(decision.action).toBe("advance_turn");
    expect(decision.label).toBe("advance turn for more tasks");
    expect(memory.loopAdvanceRequestedAt).toBe(42);
  });

  it("requests a task from the preferred requester when one is configured", () => {
    const state: CivPilotTextState = {
      player: {
        possessedEntityId: "axo-3",
        player: {
          x: 832,
          y: 226,
          tile_x: 52,
          tile_y: 14,
          blocked: null,
        },
        nearby_interactions: [
          {
            kind: "npc",
            label: "Axolotl 2",
            targetId: "axo-2",
            x: 808,
            y: 210,
            distance: 29,
          },
        ],
      },
      visible_entities: [
        { id: "axo-1", kind: "axolotl", role: "worker", morph: "leucistic", stage: "adult", x: 48, y: 12 },
        { id: "axo-2", kind: "axolotl", role: "builder", morph: "wild", stage: "adult", x: 50, y: 13 },
      ],
    };
    const memory = createCivPilotMemory();
    memory.preferredRequesterId = "axo-1";

    const decision = chooseCivPilotDecision(state, "task-fetch", 1, memory);

    expect(decision.action).toBe("move");
    if (decision.action !== "move") return;
    expect(decision.label).toBe("request task from worker");
    expect(decision.target.targetId).toBe("axo-1");
  });

  it("interacts with a preferred requester once it is in practical NPC range", () => {
    const state: CivPilotTextState = {
      player: {
        possessedEntityId: "axo-3",
        player: {
          x: 792,
          y: 203,
          tile_x: 49,
          tile_y: 12,
          blocked: null,
        },
        nearby_interactions: [
          {
            kind: "npc",
            label: "Axolotl 1",
            targetId: "axo-1",
            x: 777,
            y: 193,
            distance: 18,
          },
          {
            kind: "npc",
            label: "Axolotl 2",
            targetId: "axo-2",
            x: 808,
            y: 210,
            distance: 18,
          },
        ],
      },
      visible_entities: [
        { id: "axo-1", kind: "axolotl", role: "worker", morph: "leucistic", stage: "adult", x: 48, y: 12 },
        { id: "axo-2", kind: "axolotl", role: "builder", morph: "wild", stage: "adult", x: 50, y: 13 },
      ],
    };
    const memory = createCivPilotMemory();
    memory.preferredRequesterId = "axo-1";

    const decision = chooseCivPilotDecision(state, "task-fetch", 4, memory);

    expect(decision.action).toBe("interact");
    if (decision.action !== "interact") return;
    expect(decision.tool).toBe("use");
    expect(decision.target?.targetId).toBe("axo-1");
  });
});

describe("renderSnapshotToText arena contract", () => {
  const civs = [
    fixtureCiv({ id: "civ-1", name: "Pondfolk", model: "claude", controller: null, score: { survival: 10, ethics: 5, intelligence: 8, total: 23 } }),
    fixtureCiv({ id: "civ-2", name: "Mudborn", model: "gpt", controller: "codex", color: "#d68a6d", resources: { food: 9 }, score: { survival: 20, ethics: 9, intelligence: 12, total: 41 } }),
    fixtureCiv({ id: "civ-3", name: "Reedkin", model: "kimi", controller: null, color: "#6d9fd6", resources: { stone: 2 }, score: { survival: 4, ethics: 2, intelligence: 3, total: 9 } }),
  ];

  it("preserves the legacy single-civ keys the codex harness parses", () => {
    const state = JSON.parse(renderSnapshotToText(multiCivSnapshot(civs))) as CivPilotTextState & {
      civilization?: { resources?: unknown };
    };

    // codex-play-civ.mjs contract (readState/progressSignature): civilization.resources object.
    expect(state.civilization?.resources).toBeTypeOf("object");
    expect((state.civilization as { resources: Record<string, number> }).resources).toMatchObject({ food: 5, stone: 3 });
    // player + player_task + visible_entities keys must remain present.
    expect(state.player).toBeDefined();
    expect("player_task" in state).toBe(true);
    expect(Array.isArray(state.visible_entities)).toBe(true);
  });

  it("additively exposes civs[], a score-sorted leaderboard, and environment", () => {
    const state = JSON.parse(renderSnapshotToText(multiCivSnapshot(civs))) as CivPilotTextState;

    expect(Array.isArray(state.civs)).toBe(true);
    expect(state.civs).toHaveLength(civs.length);
    const first = state.civs![0];
    expect(first).toMatchObject({ id: "civ-1", name: "Pondfolk", model: "claude", color: "#6dd6a7", controller: null });
    expect(typeof first.alive).toBe("boolean");
    expect(first.resources).toMatchObject({ food: 5, stone: 3 });
    expect(first.score).toMatchObject({ survival: 10, ethics: 5, intelligence: 8, total: 23 });

    expect(Array.isArray(state.leaderboard)).toBe(true);
    expect(state.leaderboard).toHaveLength(civs.length);
    const totals = state.leaderboard!.map((entry) => entry.score.total);
    expect(totals).toEqual([41, 23, 9]);
    expect(state.leaderboard![0].id).toBe("civ-2");
    expect(state.leaderboard![0].controller).toBe("codex");

    expect(state.environment).toBeDefined();
    expect((state.environment as { season: string }).season).toBe("spring");
  });

  it("never leaks provider config / key material into the text-state", () => {
    const raw = renderSnapshotToText(multiCivSnapshot(civs));
    expect(raw).not.toMatch(/API_KEY/i);
    expect(raw).not.toMatch(/ANTHROPIC|AWS_|BASE_URL/);
  });
});
