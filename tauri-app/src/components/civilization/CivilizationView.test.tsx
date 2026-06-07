import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CivilizationView } from "./CivilizationView";
import { useCivStore } from "../../stores/civStore";
import type { CivSessionConfig } from "../../bindings";

const createCivSession = vi.fn();

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
