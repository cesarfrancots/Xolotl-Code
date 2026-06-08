import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CivSessionConfig, CivSessionSnapshot } from "../bindings";
import { activeCivPlayerTask, cleanCivLogBody } from "../lib/civPlayerTasks";
import { parseCivSnapshot, primaryCiv, useCivStore } from "./civStore";

const createCivSession = vi.fn();
const loadCivSession = vi.fn();
const listCivSessions = vi.fn();

vi.mock("../bindings", () => ({
  commands: {
    createCivSession: (config: CivSessionConfig) => createCivSession(config),
    loadCivSession: (id: string) => loadCivSession(id),
    listCivSessions: () => listCivSessions(),
  },
}));

const sampleSnapshot: CivSessionSnapshot = {
  id: "civ-1",
  name: "Test Pond",
  seed: 123,
  version: 2,
  created_at: 1,
  updated_at: 2,
  turn: 4,
  world: {
    width: 64,
    height: 36,
    tiles: [{ x: 0, y: 0, terrain: "air", resource: null, amount: 0 }],
    entities: [{ id: "axo-1", kind: "axolotl", name: "Axo", x: 1, y: 2, health: 80, mood: 70, role: "worker" }],
  },
  civs: [
    {
      id: "civ-1",
      name: "Test Pond",
      model: "kimi-coding",
      color: "#6dd6a7",
      spawn_x: 1,
      home_region: "",
      alive: true,
      diplomacy: {},
      era: "pond_camp",
      population: 8,
      health: 80,
      morale: 70,
      resources: { food: 20, clean_water: 20 },
      techs: ["forage"],
      policies: [],
      score: { survival: 70, ethics: 65, intelligence: 30, total: 56.5 },
    },
  ],
  environment: {
    season: "spring",
    turn_of_season: 0,
    temperature: 14,
    water_level: 0,
    disasters: [],
    forecast: null,
  },
  modifiers: [],
  log: [{ turn: 4, kind: "action", title: "Gathered", body: "Food gathered.", created_at: 2 }],
};

beforeEach(() => {
  createCivSession.mockReset();
  loadCivSession.mockReset();
  listCivSessions.mockReset();
  listCivSessions.mockResolvedValue([]);
  loadCivSession.mockResolvedValue({ status: "ok", data: JSON.stringify(sampleSnapshot) });
  useCivStore.setState({
    sessions: null,
    activeSessionId: null,
    activeSnapshot: null,
    models: [],
    loading: false,
    turnRunning: false,
    error: null,
    lastEventType: null,
    selectedCivId: null,
  });
});

describe("parseCivSnapshot", () => {
  it("parses the persisted civilization session shape", () => {
    const parsed = parseCivSnapshot(JSON.stringify(sampleSnapshot));
    const civ = primaryCiv(parsed);

    expect(parsed.id).toBe("civ-1");
    expect(civ.resources.food).toBe(20);
    expect(civ.era).toBe("pond_camp");
    expect(parsed.world.entities[0].kind).toBe("axolotl");
  });

  it("migrates legacy single-civilization snapshots at the frontend boundary", () => {
    const legacySnapshot: Record<string, unknown> = {
      ...sampleSnapshot,
      model: "legacy-model",
      civilization: sampleSnapshot.civs?.[0],
    };
    delete legacySnapshot.civs;
    delete legacySnapshot.version;
    delete legacySnapshot.environment;

    const parsed = parseCivSnapshot(JSON.stringify(legacySnapshot));
    const civ = primaryCiv(parsed);

    expect(parsed.version).toBe(2);
    expect(parsed.civs).toHaveLength(1);
    expect(civ.model).toBe("kimi-coding");
    expect(civ.resources.food).toBe(20);
    expect(parsed.environment?.season).toBe("spring");
  });

  it("treats civs[] as the source of truth when mixed preview snapshots include both shapes", () => {
    const mixedSnapshot = {
      ...sampleSnapshot,
      civilization: {
        ...sampleSnapshot.civs![0],
        resources: { food: 99, clean_water: 99, pearls: 99 },
      },
    };

    const parsed = parseCivSnapshot(JSON.stringify(mixedSnapshot));
    const civ = primaryCiv(parsed);

    expect(civ.resources.food).toBe(20);
    expect(civ.resources.pearls).toBeUndefined();
  });
});

describe("activeCivPlayerTask", () => {
  it("parses repair-object requests with their visible target", () => {
    const civ = primaryCiv(sampleSnapshot);
    const snapshot: CivSessionSnapshot = {
      ...sampleSnapshot,
      world: {
        ...sampleSnapshot.world,
        entities: [
          { id: "axo-8", kind: "axolotl", name: "Elder", x: 3, y: 4, health: 80, mood: 70, role: "elder" },
          { id: "breach-1", kind: "object", name: "Nest Breach", x: 5, y: 6, health: 35, mood: 0, role: "breach", activity: "needs_repair" },
        ],
      },
      civs: [{
        ...civ,
        resources: { ...civ.resources, fiber: 14 },
      }],
      log: [{
        turn: 4,
        kind: "player",
        title: "NPC request",
        body: "target=axo-8; Elder asks you to repair Nest Breach. Gather 2 fiber and fix it; task=repair_object; npc=axo-8; object=breach-1; resource=fiber; source=fiber; amount=2; baseline=12; reward=nest_safety;",
        created_at: 4,
      }],
    };

    const task = activeCivPlayerTask(snapshot, primaryCiv(snapshot));

    expect(task?.kind).toBe("repair_object");
    expect(task?.objectId).toBe("breach-1");
    expect(task?.objectName).toBe("Nest Breach");
    expect(task?.status).toBe("ready");
    expect(cleanCivLogBody(snapshot.log[0])).toBe("Elder asks you to repair Nest Breach. Gather 2 fiber and fix it;");
  });

  it("parses repair-object requests that include nest leak hazard copy", () => {
    const civ = primaryCiv(sampleSnapshot);
    const snapshot: CivSessionSnapshot = {
      ...sampleSnapshot,
      world: {
        ...sampleSnapshot.world,
        entities: [
          { id: "axo-8", kind: "axolotl", name: "Elder", x: 3, y: 4, health: 80, mood: 70, role: "elder" },
          { id: "breach-1", kind: "object", name: "Nest Breach", x: 5, y: 6, health: 35, mood: 0, role: "breach", activity: "needs_repair" },
          { id: "leak-1", kind: "object", name: "Nest Leak", x: 6, y: 6, health: 62, mood: 0, role: "leak", activity: "active" },
        ],
      },
      civs: [{
        ...civ,
        resources: { ...civ.resources, fiber: 13 },
      }],
      log: [{
        turn: 4,
        kind: "player",
        title: "NPC request",
        body: "target=axo-8; Elder asks you to repair Nest Breach. Gather 2 fiber and fix it; a nest leak slows the repair site until sealed; task=repair_object; npc=axo-8; object=breach-1; resource=fiber; source=fiber; amount=2; baseline=12; reward=nest_safety;",
        created_at: 4,
      }],
    };

    const task = activeCivPlayerTask(snapshot, primaryCiv(snapshot));

    expect(task?.kind).toBe("repair_object");
    expect(task?.objectId).toBe("breach-1");
    expect(task?.remaining).toBe(1);
    expect(cleanCivLogBody(snapshot.log[0])).toBe("Elder asks you to repair Nest Breach. Gather 2 fiber and fix it; a nest leak slows the repair site until sealed;");
  });

  it("parses bridge requests that include silt hazard copy", () => {
    const civ = primaryCiv(sampleSnapshot);
    const snapshot: CivSessionSnapshot = {
      ...sampleSnapshot,
      world: {
        ...sampleSnapshot.world,
        tiles: [
          ...sampleSnapshot.world.tiles,
          { x: 10, y: 9, terrain: "water", resource: null, amount: 0 },
          { x: 11, y: 9, terrain: "water", resource: null, amount: 0 },
          { x: 12, y: 9, terrain: "water", resource: null, amount: 0 },
        ],
        entities: [
          { id: "axo-builder", kind: "axolotl", name: "Builder", x: 8, y: 8, health: 80, mood: 70, role: "builder" },
          { id: "bridge-1", kind: "object", name: "Bridge Gap", x: 11, y: 8, health: 20, mood: 0, role: "bridge", activity: "needed" },
          { id: "seep-1", kind: "object", name: "Silt Vent", x: 13, y: 8, health: 70, mood: 0, role: "seep", activity: "active" },
        ],
      },
      civs: [{
        ...civ,
        resources: { ...civ.resources, glowshards: 1 },
      }],
      log: [{
        turn: 4,
        kind: "player",
        title: "NPC request",
        body: "target=axo-builder; Builder asks you to build Bridge Gap. Place 3 bridge tiles using glowshards; a silt vent slows the crossing until the bridge is sealed; task=build_bridge; npc=axo-builder; object=bridge-1; resource=glowshards; source=glowshards; amount=3; baseline=1; reward=access;",
        created_at: 4,
      }],
    };

    const task = activeCivPlayerTask(snapshot, primaryCiv(snapshot));

    expect(task?.kind).toBe("build_bridge");
    expect(task?.objectId).toBe("bridge-1");
    expect(task?.remaining).toBe(3);
    expect(cleanCivLogBody(snapshot.log[0])).toBe("Builder asks you to build Bridge Gap. Place 3 bridge tiles using glowshards; a silt vent slows the crossing until the bridge is sealed;");
  });

  it("clamps ready resource task progress after extra matching resources are gathered", () => {
    const civ = primaryCiv(sampleSnapshot);
    const snapshot: CivSessionSnapshot = {
      ...sampleSnapshot,
      world: {
        ...sampleSnapshot.world,
        entities: [
          { id: "axo-5", kind: "axolotl", name: "Trader", x: 8, y: 8, health: 80, mood: 70, role: "worker" },
        ],
      },
      civs: [{
        ...civ,
        resources: { ...civ.resources, wood: 22, tools: 2 },
      }],
      log: [{
        turn: 4,
        kind: "player",
        title: "NPC request",
        body: "target=axo-5; Trader offers 1 tools for 2 wood; task=trade_resource; npc=axo-5; resource=wood; source=wood; amount=2; baseline=18; reward=resource; reward_resource=tools; reward_amount=1;",
        created_at: 4,
      }],
    };

    const task = activeCivPlayerTask(snapshot, primaryCiv(snapshot));

    expect(task?.kind).toBe("trade_resource");
    expect(task?.current).toBe(22);
    expect(task?.progress).toBe(2);
    expect(task?.remaining).toBe(0);
    expect(task?.status).toBe("ready");
  });
});

describe("useCivStore multi-participant createSession + selectedCivId", () => {
  it("forwards a multi-participant civs[] config to createCivSession", async () => {
    createCivSession.mockResolvedValue({ status: "ok", data: "civ-1" });

    await useCivStore.getState().createSession({
      name: "Test Pond",
      seed: null,
      civs: [
        { name: "Reed", model: "kimi", color: "#7fdfff" },
        { name: "Coral", model: "deepseek", color: "#ff9ec7" },
      ],
    });

    expect(createCivSession).toHaveBeenCalledTimes(1);
    const config = createCivSession.mock.calls[0][0] as CivSessionConfig;
    expect(config.civs).toHaveLength(2);
    expect(config.civs?.[0]).toMatchObject({ name: "Reed", model: "kimi", color: "#7fdfff" });
    expect(config.civs?.[1]).toMatchObject({ name: "Coral", model: "deepseek", color: "#ff9ec7" });
  });

  it("setSelectedCivId updates the selected civ", () => {
    useCivStore.getState().setSelectedCivId("civ-2");
    expect(useCivStore.getState().selectedCivId).toBe("civ-2");
    useCivStore.getState().setSelectedCivId(null);
    expect(useCivStore.getState().selectedCivId).toBeNull();
  });

  it("resets selectedCivId to null on createSession", async () => {
    useCivStore.setState({ selectedCivId: "civ-2" });
    createCivSession.mockResolvedValue({ status: "ok", data: "civ-1" });

    await useCivStore.getState().createSession({
      name: "Test Pond",
      seed: null,
      civs: [{ name: "Reed", model: "kimi" }],
    });

    expect(useCivStore.getState().selectedCivId).toBeNull();
  });

  it("resets selectedCivId to null on loadSession", async () => {
    useCivStore.setState({ selectedCivId: "civ-2" });

    await useCivStore.getState().loadSession("civ-1");

    expect(useCivStore.getState().selectedCivId).toBeNull();
  });
});

describe("normalizeCiv controller default", () => {
  it("defaults controller to null when absent", () => {
    const parsed = parseCivSnapshot(JSON.stringify(sampleSnapshot));
    expect(primaryCiv(parsed).controller).toBeNull();
  });

  it("preserves an explicit controller tag", () => {
    const withController = {
      ...sampleSnapshot,
      civs: [{ ...sampleSnapshot.civs![0], controller: "kimi-harness" }],
    };
    const parsed = parseCivSnapshot(JSON.stringify(withController));
    expect(primaryCiv(parsed).controller).toBe("kimi-harness");
  });
});

describe("useCivStore hydration", () => {
  it("hydrates snapshots and tracks turn-start state from events", () => {
    useCivStore.getState().hydrateSnapshot(sampleSnapshot, "TurnStarted");

    expect(useCivStore.getState().activeSessionId).toBe("civ-1");
    expect(useCivStore.getState().activeSnapshot?.turn).toBe(4);
    expect(useCivStore.getState().turnRunning).toBe(true);
    expect(useCivStore.getState().lastEventType).toBe("TurnStarted");

    useCivStore.getState().hydrateSnapshot({ ...sampleSnapshot, turn: 5 }, "TurnResolved");

    expect(useCivStore.getState().turnRunning).toBe(false);
    expect(useCivStore.getState().activeSnapshot?.turn).toBe(5);
  });
});
