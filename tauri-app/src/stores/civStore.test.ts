import { beforeEach, describe, expect, it } from "vitest";
import type { CivSessionSnapshot } from "../bindings";
import { parseCivSnapshot, useCivStore } from "./civStore";

const sampleSnapshot: CivSessionSnapshot = {
  id: "civ-1",
  name: "Test Pond",
  model: "kimi-coding",
  seed: 123,
  created_at: 1,
  updated_at: 2,
  turn: 4,
  world: {
    width: 64,
    height: 36,
    tiles: [{ x: 0, y: 0, terrain: "air", resource: null, amount: 0 }],
    entities: [{ id: "axo-1", kind: "axolotl", name: "Axo", x: 1, y: 2, health: 80, mood: 70, role: "worker" }],
  },
  civilization: {
    era: "pond_camp",
    population: 8,
    health: 80,
    morale: 70,
    resources: { food: 20, clean_water: 20 },
    techs: ["forage"],
    policies: [],
    score: { survival: 70, ethics: 65, intelligence: 30, total: 56.5 },
  },
  modifiers: [],
  log: [{ turn: 4, kind: "action", title: "Gathered", body: "Food gathered.", created_at: 2 }],
};

beforeEach(() => {
  useCivStore.setState({
    sessions: null,
    activeSessionId: null,
    activeSnapshot: null,
    models: [],
    loading: false,
    turnRunning: false,
    error: null,
    lastEventType: null,
  });
});

describe("parseCivSnapshot", () => {
  it("parses the persisted civilization session shape", () => {
    const parsed = parseCivSnapshot(JSON.stringify(sampleSnapshot));

    expect(parsed.id).toBe("civ-1");
    expect(parsed.civilization.resources.food).toBe(20);
    expect(parsed.world.entities[0].kind).toBe("axolotl");
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
