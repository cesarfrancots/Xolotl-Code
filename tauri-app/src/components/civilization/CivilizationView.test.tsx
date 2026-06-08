import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CivilizationView, hatchlingCareTarget, playerTargetPrompt } from "./CivilizationView";
import { normalizeCivSnapshot, useCivStore } from "../../stores/civStore";
import type { CivEntity, CivLogEntry, CivSessionConfig, CivSessionSnapshot } from "../../bindings";

const createCivSession = vi.fn();
const setCivController = vi.fn();

// Mock Tauri event listener — the view calls listen() for civ-event streams.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// Mock the IPC surface the view + store touch. createSession forwards here.
vi.mock("../../bindings", () => ({
  commands: {
    listModels: vi.fn().mockResolvedValue(["kimi", "deepseek", "gpt-5"]),
    listCivSessions: vi.fn().mockResolvedValue([]),
    createCivSession: (config: CivSessionConfig) => createCivSession(config),
    loadCivSession: vi.fn().mockResolvedValue({ status: "ok", data: "{}" }),
    setCivController: (id: string, civId: string, controller: string | null) =>
      setCivController(id, civId, controller),
  },
}));

// The canvas pulls in Phaser/WebGL; the creation card never renders it (snapshot null).
vi.mock("./CivilizationGameCanvas", () => ({
  CivilizationGameCanvas: () => null,
}));

function resetStore() {
  useCivStore.setState({
    sessions: null,
    activeSessionId: null,
    activeSnapshot: null,
    models: ["kimi", "deepseek", "gpt-5"],
    loading: false,
    turnRunning: false,
    error: null,
    lastEventType: null,
    selectedCivId: null,
  });
}

beforeEach(() => {
  createCivSession.mockReset();
  createCivSession.mockResolvedValue({ status: "ok", data: "civ-1" });
  resetStore();
});

afterEach(() => {
  cleanup();
});

// The creation form renders in both the welcome card and the left drawer (shared
// participant state). Scope every query to the welcome card for unambiguous matches.
function card() {
  return within(document.querySelector(".civ-welcome-card") as HTMLElement);
}

function participantRows() {
  return card().getAllByLabelText(/^Participant \d+ model$/);
}

describe("CivilizationView creation card", () => {
  it("renders a single participant row by default", () => {
    render(<CivilizationView />);
    expect(participantRows()).toHaveLength(1);
    expect(card().getByLabelText("Participant 1 name")).toBeDefined();
    expect(card().getByLabelText("Participant 1 color")).toBeDefined();
  });

  it("adds participant rows up to a maximum of 3", async () => {
    const user = userEvent.setup();
    render(<CivilizationView />);

    const addButton = card().getByRole("button", { name: /add civilization/i });
    await user.click(addButton);
    expect(participantRows()).toHaveLength(2);
    await user.click(addButton);
    expect(participantRows()).toHaveLength(3);
    // Capped at 3 — the add control disables.
    expect(addButton).toHaveProperty("disabled", true);
  });

  it("removes participant rows down to a minimum of 1", async () => {
    const user = userEvent.setup();
    render(<CivilizationView />);

    const addButton = card().getByRole("button", { name: /add civilization/i });
    await user.click(addButton);
    expect(participantRows()).toHaveLength(2);

    await user.click(card().getByRole("button", { name: /remove participant 2/i }));
    expect(participantRows()).toHaveLength(1);
    // Never goes below one row, so no remove control is offered.
    expect(card().queryByRole("button", { name: /remove participant/i })).toBeNull();
  });

  it("each row exposes an editable name, a model select, and a color chip", () => {
    render(<CivilizationView />);
    const model = card().getByLabelText("Participant 1 model") as HTMLSelectElement;
    expect(within(model).getAllByRole("option").map((o) => (o as HTMLOptionElement).value))
      .toEqual(["kimi", "deepseek", "gpt-5"]);
    expect(card().getByLabelText("Participant 1 name")).toBeDefined();
    expect(card().getByLabelText("Participant 1 color")).toBeDefined();
  });

  it("founds an N-civ world via createSession with per-row name/model/color", async () => {
    const user = userEvent.setup();
    render(<CivilizationView />);

    await user.click(card().getByRole("button", { name: /add civilization/i }));

    const name2 = card().getByLabelText("Participant 2 name");
    await user.clear(name2);
    await user.type(name2, "Coral");
    await user.selectOptions(card().getByLabelText("Participant 2 model"), "deepseek");

    await user.click(card().getByRole("button", { name: /found colony/i }));

    expect(createCivSession).toHaveBeenCalledTimes(1);
    const config = createCivSession.mock.calls[0][0] as CivSessionConfig;
    expect(config.civs).toHaveLength(2);
    expect(config.civs?.[1]).toMatchObject({ name: "Coral", model: "deepseek" });
    expect(typeof config.civs?.[0]?.color).toBe("string");
    expect(typeof config.civs?.[1]?.color).toBe("string");
  });

  it("founds a single-participant world (legacy single-model back-compat)", async () => {
    const user = userEvent.setup();
    render(<CivilizationView />);

    await user.click(card().getByRole("button", { name: /found colony/i }));

    expect(createCivSession).toHaveBeenCalledTimes(1);
    const config = createCivSession.mock.calls[0][0] as CivSessionConfig;
    expect(config.civs).toHaveLength(1);
    expect(config.civs?.[0]?.model).toBe("kimi");
  });
});

// ── Multi-civ observer fixtures (Plan 01-04) ─────────────────────────────────
// A snapshot with three civs (two living, one collapsed) plus per-civ ai_decision
// log entries — the shape leaderboard ranking, log filtering, and the reasoning
// toggle all consume.
function civ(over: Record<string, unknown>) {
  return {
    era: "pond_camp",
    population: 4,
    health: 80,
    morale: 70,
    resources: {},
    techs: [],
    policies: [],
    score: { survival: 0, ethics: 0, intelligence: 0, total: 0 },
    ...over,
  };
}

function decisionLog(over: Partial<CivLogEntry>): CivLogEntry {
  return {
    turn: 1,
    kind: "ai_decision",
    title: "intent",
    body: "rationale",
    created_at: Date.now(),
    civ_id: null,
    reasoning: null,
    ...over,
  };
}

function multiCivSnapshot(): CivSessionSnapshot {
  return normalizeCivSnapshot({
    id: "sess-1",
    name: "Arena",
    version: 2,
    turn: 3,
    world: { width: 64, height: 36, tiles: [], entities: [], regions: [] },
    civs: [
      civ({ id: "civ-1", name: "Reef", color: "#7fdfff", alive: true, score: { survival: 10, ethics: 10, intelligence: 10, total: 30 } }),
      civ({ id: "civ-2", name: "Coral", color: "#ff9ec7", alive: true, controller: "codex", score: { survival: 20, ethics: 20, intelligence: 20, total: 60 } }),
      civ({ id: "civ-3", name: "Bog", color: "#9bffa0", alive: false, score: { survival: 5, ethics: 5, intelligence: 5, total: 15 } }),
    ],
    log: [
      decisionLog({ turn: 1, title: "Reef intent: gather", body: "Reef gathers food.", civ_id: "civ-1", reasoning: "Reef private chain-of-thought." }),
      decisionLog({ turn: 2, title: "Coral intent: build", body: "Coral builds a nest.", civ_id: "civ-2", reasoning: "Coral private chain-of-thought." }),
      decisionLog({ turn: 3, title: "Coral intent: trade", body: "Coral trades kelp.", civ_id: "civ-2", reasoning: null }),
    ],
  });
}

function shopSnapshot(pearls: number): CivSessionSnapshot {
  return normalizeCivSnapshot({
    id: "shop-sess",
    name: "Shop Pond",
    version: 2,
    turn: 4,
    world: {
      width: 64,
      height: 36,
      tiles: [],
      entities: [],
      regions: [],
    },
    civs: [
      civ({
        id: "civ-1",
        name: "Shop Pond",
        color: "#7fdfff",
        alive: true,
        population: 8,
        resources: { food: 20, clean_water: 20, pearls },
        score: { survival: 30, ethics: 30, intelligence: 30, total: 90 },
      }),
    ],
  });
}

function hydrateMultiCiv(snapshot: CivSessionSnapshot = multiCivSnapshot()) {
  act(() => {
    useCivStore.setState({ activeSessionId: snapshot.id, activeSnapshot: snapshot, selectedCivId: null });
  });
}

function selectCiv(id: string | null) {
  act(() => {
    useCivStore.setState({ selectedCivId: id });
  });
}

function openObserver(user: ReturnType<typeof userEvent.setup>) {
  return user.click(document.querySelector(".civ-edge-right") as HTMLElement);
}

describe("CivilizationView leaderboard top-bar", () => {
  it("ranks living civs by score.total desc and greys collapsed civs at the bottom", () => {
    render(<CivilizationView />);
    hydrateMultiCiv();

    const board = document.querySelector(".civ-leaderboard") as HTMLElement;
    expect(board).not.toBeNull();
    const rows = within(board).getAllByRole("button");
    // Living first by score desc (Coral 60, Reef 30), then the collapsed civ (Bog).
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Coral"),
      expect.stringContaining("Reef"),
      expect.stringContaining("Bog"),
    ]);
    // The dead civ row is marked collapsed.
    const bogRow = rows[2];
    expect(bogRow.className).toContain("is-collapsed");
    expect(bogRow.textContent).toMatch(/collapsed/i);
  });

  it("shows a controller badge only on civs with a controller tag", () => {
    render(<CivilizationView />);
    hydrateMultiCiv();

    const board = document.querySelector(".civ-leaderboard") as HTMLElement;
    const rows = within(board).getAllByRole("button");
    // Coral has controller "codex"; Reef has none.
    expect(rows[0].textContent).toContain("codex");
    expect(rows[1].textContent).not.toContain("codex");
  });

  it("selects a civ when its row is clicked", async () => {
    const user = userEvent.setup();
    render(<CivilizationView />);
    hydrateMultiCiv();

    const board = document.querySelector(".civ-leaderboard") as HTMLElement;
    const reefRow = within(board).getAllByRole("button").find((r) => r.textContent?.includes("Reef"))!;
    await user.click(reefRow);

    expect(useCivStore.getState().selectedCivId).toBe("civ-1");
  });
});

describe("CivilizationView window.civCamera bridge (REN-02 / ARENA-02 additive)", () => {
  // The real scene installs window.civCamera; the canvas is mocked here, so we
  // install a six-method spy bridge and assert the View drives it. This mirrors
  // the Phase 1 ARENA-02 back-compat style: the four pre-existing methods MUST
  // remain alongside the two new ones (extend-only contract).
  function installCameraSpy() {
    const cam = {
      zoomBy: vi.fn(),
      recenter: vi.fn(),
      toggleFollow: vi.fn(),
      focusRegion: vi.fn(),
      focusCiv: vi.fn(),
      frameAll: vi.fn(),
    };
    window.civCamera = cam;
    return cam;
  }

  afterEach(() => {
    delete window.civCamera;
  });

  it("retains the four existing methods AND adds focusCiv + frameAll (all six are functions)", () => {
    installCameraSpy();
    render(<CivilizationView />);
    hydrateMultiCiv();
    for (const name of ["zoomBy", "recenter", "toggleFollow", "focusRegion", "focusCiv", "frameAll"] as const) {
      expect(typeof window.civCamera?.[name]).toBe("function");
    }
  });

  it("focuses the selected civ via focusCiv and resets via frameAll when cleared", () => {
    const cam = installCameraSpy();
    render(<CivilizationView />);
    hydrateMultiCiv();
    cam.focusCiv.mockClear();
    cam.frameAll.mockClear();

    selectCiv("civ-2");
    expect(cam.focusCiv).toHaveBeenCalledWith("civ-2");

    selectCiv(null);
    expect(cam.frameAll).toHaveBeenCalled();
  });

  it("focuses the civ a leaderboard row click selects (Phase 1 row -> setSelectedCivId -> focusCiv)", async () => {
    const cam = installCameraSpy();
    const user = userEvent.setup();
    render(<CivilizationView />);
    hydrateMultiCiv();
    cam.focusCiv.mockClear();

    const board = document.querySelector(".civ-leaderboard") as HTMLElement;
    const reefRow = within(board).getAllByRole("button").find((r) => r.textContent?.includes("Reef"))!;
    await user.click(reefRow);

    expect(useCivStore.getState().selectedCivId).toBe("civ-1");
    expect(cam.focusCiv).toHaveBeenCalledWith("civ-1");
  });

  // MED-04 (guard): the Phaser scene installs window.civCamera in create(), which
  // runs after React commit. Selecting a civ during that startup window (bridge
  // not yet installed) must be a silent no-op via optional chaining, never a
  // throw. (The missed-focus retry on scene-ready is deferred — see
  // deferred-items.md; this only pins "does not crash before install".)
  it("does not throw when a civ is selected before the camera bridge installs", () => {
    delete window.civCamera; // bridge not installed yet (scene create() pending)
    render(<CivilizationView />);
    hydrateMultiCiv();
    expect(() => selectCiv("civ-2")).not.toThrow();
    expect(() => selectCiv(null)).not.toThrow();
    expect(window.civCamera).toBeUndefined();
  });
});

describe("CivilizationView selectedCivId-driven observer + log", () => {
  it("drives the observer score panel from the selected civ, not civs[0]", async () => {
    const user = userEvent.setup();
    render(<CivilizationView />);
    hydrateMultiCiv();
    selectCiv("civ-2");
    await openObserver(user);

    const drawer = document.querySelector(".civ-drawer-right") as HTMLElement;
    // Coral (civ-2) total is 60 — primaryCiv (civs[0]=Reef) total is 30.
    expect(within(drawer).getByText("60")).toBeDefined();
  });

  it("filters the log to the selected civ and shows all when none selected", async () => {
    const user = userEvent.setup();
    render(<CivilizationView />);
    hydrateMultiCiv();
    await openObserver(user);

    // No selection -> all entries visible.
    expect(document.body.textContent).toContain("Reef gathers food.");
    expect(document.body.textContent).toContain("Coral builds a nest.");

    // Select civ-2 -> only Coral entries remain in the log.
    selectCiv("civ-2");
    const log = document.querySelector(".civ-log") as HTMLElement;
    expect(within(log).queryByText("Reef gathers food.")).toBeNull();
    expect(within(log).getByText("Coral builds a nest.")).toBeDefined();
  });
});

describe("CivilizationView reasoning expand toggle", () => {
  it("hides reasoning behind a toggle and reveals it on expand; no toggle when absent", async () => {
    const user = userEvent.setup();
    render(<CivilizationView />);
    hydrateMultiCiv();
    await openObserver(user);

    const log = document.querySelector(".civ-log") as HTMLElement;
    // Rationale is always visible.
    expect(within(log).getByText("Coral builds a nest.")).toBeDefined();
    // Reasoning is collapsed by default.
    expect(within(log).queryByText("Coral private chain-of-thought.")).toBeNull();

    // The entry with reasoning exposes a toggle; the entry without reasoning does not.
    const toggles = within(log).getAllByRole("button", { name: /reasoning/i });
    expect(toggles).toHaveLength(2); // Reef + first Coral entry have reasoning; second Coral does not.

    const coralToggle = toggles.find((t) =>
      (t.closest("article")?.textContent ?? "").includes("Coral builds a nest."),
    )!;
    await user.click(coralToggle);
    expect(within(log).getByText("Coral private chain-of-thought.")).toBeDefined();
  });
});

describe("CivilizationView civPilotControls", () => {
  it("keeps the legacy start({goal, possessId}) signature working (ARENA-02)", () => {
    render(<CivilizationView />);
    hydrateMultiCiv();
    // The bridge mounts on the window regardless of possessable axolotls.
    expect(typeof window.civPilotControls?.start).toBe("function");
    // Legacy call must not throw and must not touch selection or the controller IPC.
    expect(() => window.civPilotControls?.start({ goal: "task", possessId: "axo-1" })).not.toThrow();
    expect(setCivController).not.toHaveBeenCalled();
  });

  it("scopes selection to civId and tags the controller via set_civ_controller (ARENA-03)", () => {
    render(<CivilizationView />);
    hydrateMultiCiv();
    setCivController.mockReset();

    window.civPilotControls?.start({ civId: "civ-2", controller: "codex" });

    expect(useCivStore.getState().selectedCivId).toBe("civ-2");
    expect(setCivController).toHaveBeenCalledWith("sess-1", "civ-2", "codex");
  });
});

describe("CivilizationView Play shop goals", () => {
  it("shows common egg, rare lure, and rare egg milestones with current affordability", async () => {
    const user = userEvent.setup();
    render(<CivilizationView />);
    hydrateMultiCiv(shopSnapshot(12));

    await user.click(document.querySelector(".civ-mode-switch button") as HTMLElement);

    const goals = document.querySelector("[aria-label='Shop goals']") as HTMLElement;
    expect(goals).not.toBeNull();
    expect(within(goals).getByText("Common Egg")).toBeDefined();
    expect(within(goals).getByText("Rare Lure")).toBeDefined();
    expect(within(goals).getByText("Rare Egg")).toBeDefined();

    expect(within(goals).getByRole("button", { name: "Buy Common Egg" })).toHaveProperty("disabled", false);
    expect(within(goals).getByRole("button", { name: "Buy Rare Lure" })).toHaveProperty("disabled", false);
    expect(within(goals).getByRole("button", { name: "Rare Egg needs 18 more pearls" })).toHaveProperty("disabled", true);
  });
});

describe("CivilizationView hatchling care", () => {
  it("prioritizes a fresh hatch ceremony hatchling and exposes feed readiness", () => {
    const snapshot = shopSnapshot(4);
    const civ = snapshot.civs?.[0]!;
    snapshot.world.entities.push(
      {
        id: "older-hatchling",
        kind: "axolotl",
        name: "Older Hatchling",
        x: 8,
        y: 9,
        health: 80,
        mood: 75,
        role: "juvenile",
        civ_id: civ.id,
        morph: "wild",
        pattern: "plain",
        stage: "hatchling",
        sex: "f",
        age: 3,
        activity: "play",
      } as CivEntity,
      {
        id: "fresh-hatchling",
        kind: "axolotl",
        name: "Fresh Hatchling",
        x: 10,
        y: 12,
        health: 95,
        mood: 88,
        role: "juvenile",
        civ_id: civ.id,
        morph: "mystic",
        pattern: "marbled",
        stage: "hatchling",
        sex: "m",
        age: 0,
        activity: "hatch",
      } as CivEntity,
    );

    expect(hatchlingCareTarget(snapshot, civ)).toMatchObject({
      id: "fresh-hatchling",
      name: "Fresh Hatchling",
      rarity: "mythic",
      rarityLabel: "Mythic",
      level: 8,
      health: 95,
      mood: 88,
      food: 20,
      canFeed: true,
      x: 10,
      y: 12,
    });
  });
});

describe("CivilizationView Play target prompt", () => {
  it("formats active resource targets as immediate gather prompts", () => {
    const prompt = playerTargetPrompt({
      entityId: "axo-1",
      kind: "resource",
      label: "wood",
      resource: "wood",
      x: 920,
      y: 740,
      tileX: 57,
      tileY: 46,
      distance: 30,
      cycle_index: 2,
      cycle_count: 7,
    }, "use");

    expect(prompt).toMatchObject({
      state: "active",
      action: "Gather",
      label: "Wood",
      keyAction: "Gather",
    });
    expect(prompt.detail).toContain("30 px");
    expect(prompt.detail).toContain("tile 57,46");
  });

  it("formats empty targets without implying an action will fire", () => {
    const prompt = playerTargetPrompt(null, "mine");

    expect(prompt).toMatchObject({
      state: "empty",
      action: "No target",
      label: "In reach",
      detail: "Mine ready",
      keyAction: "Wait",
    });
  });
});
