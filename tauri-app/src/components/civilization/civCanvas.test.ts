import { describe, expect, it, vi } from "vitest";

// The tint helpers live in CivilizationGameCanvas.tsx, which imports Phaser at
// module load (Phaser's ESM init touches a real canvas and crashes under jsdom).
// The helpers themselves are pure (no Phaser), so stub the module to import them
// safely — mirrors the Phase 1 civPilot.test.ts pattern. Mock BEFORE the import.
vi.mock("phaser", () => {
  class Scene {}
  return {
    default: {
      Scene,
      Game: class {},
      AUTO: 0,
      Scale: { RESIZE: 0, NO_CENTER: 0 },
      TintModes: { FILL: 1, MULTIPLY: 0 },
    },
    Scene,
  };
});

import {
  buildCivColorMap,
  civTintFor,
  hexToTint,
  regionOverlayFor,
} from "./CivilizationGameCanvas";

const GREY = 0x888888;

describe("hexToTint", () => {
  it("parses a full 6-digit hex with leading #", () => {
    expect(hexToTint("#6dd6a7")).toBe(0x6dd6a7);
  });

  it("parses a 6-digit hex without the leading #", () => {
    expect(hexToTint("112233")).toBe(0x112233);
  });

  it("expands 3-digit shorthand by doubling each char", () => {
    expect(hexToTint("#abc")).toBe(0xaabbcc);
    expect(hexToTint("abc")).toBe(0xaabbcc);
  });

  it("returns 0xffffff for null / undefined / empty input (fail-safe)", () => {
    expect(hexToTint(null)).toBe(0xffffff);
    expect(hexToTint(undefined)).toBe(0xffffff);
    expect(hexToTint("")).toBe(0xffffff);
  });

  it("returns 0xffffff for non-hex garbage and never throws / never NaN", () => {
    expect(hexToTint("not-a-color")).toBe(0xffffff);
    expect(hexToTint("#zzzzzz")).toBe(0xffffff);
    expect(hexToTint("#<script>")).toBe(0xffffff);
    expect(Number.isFinite(hexToTint("garbage"))).toBe(true);
  });
});

describe("buildCivColorMap", () => {
  it("maps id -> {tint, alive} and defaults alive to true when absent", () => {
    const map = buildCivColorMap([
      { id: "a", color: "#112233", alive: true },
      { id: "b", color: "#445566" },
    ]);
    expect(map.get("a")).toEqual({ tint: 0x112233, alive: true });
    expect(map.get("b")).toEqual({ tint: 0x445566, alive: true });
  });

  it("records alive:false explicitly", () => {
    const map = buildCivColorMap([{ id: "c", color: "#778899", alive: false }]);
    expect(map.get("c")).toEqual({ tint: 0x778899, alive: false });
  });

  it("skips entries without an id", () => {
    const map = buildCivColorMap([
      { color: "#112233", alive: true },
      { id: "keep", color: "#445566" },
    ]);
    expect(map.size).toBe(1);
    expect(map.has("keep")).toBe(true);
  });

  it("returns an empty map for undefined / empty input", () => {
    expect(buildCivColorMap(undefined).size).toBe(0);
    expect(buildCivColorMap([]).size).toBe(0);
  });

  it("falls back to 0xffffff for a missing colour", () => {
    const map = buildCivColorMap([{ id: "d" }]);
    expect(map.get("d")).toEqual({ tint: 0xffffff, alive: true });
  });
});

describe("civTintFor", () => {
  it("returns null on a map miss (wild fauna / null civ_id) so the caller keeps the default", () => {
    expect(civTintFor(undefined, GREY)).toBeNull();
  });

  it("returns a non-grey identity tint for a living civ", () => {
    const t = civTintFor({ tint: 0x112233, alive: true }, GREY);
    expect(t).not.toBeNull();
    expect(t).not.toBe(GREY);
    expect(Number.isFinite(t as number)).toBe(true);
  });

  it("lightens the living-civ tint toward white (each channel >= the raw channel)", () => {
    const raw = 0x204060;
    const t = civTintFor({ tint: raw, alive: true }, GREY) as number;
    const ch = (v: number, shift: number) => (v >> shift) & 0xff;
    expect(ch(t, 16)).toBeGreaterThanOrEqual(ch(raw, 16));
    expect(ch(t, 8)).toBeGreaterThanOrEqual(ch(raw, 8));
    expect(ch(t, 0)).toBeGreaterThanOrEqual(ch(raw, 0));
  });

  it("returns the grey constant for a dead civ", () => {
    expect(civTintFor({ tint: 0x112233, alive: false }, GREY)).toBe(GREY);
  });
});

describe("regionOverlayFor", () => {
  const map = buildCivColorMap([
    { id: "a", color: "#112233", alive: true },
    { id: "dead", color: "#445566", alive: false },
  ]);

  it("returns null when the owner is null / undefined (unowned -> neutral)", () => {
    expect(regionOverlayFor(null, map)).toBeNull();
    expect(regionOverlayFor(undefined, map)).toBeNull();
  });

  it("returns null when the owner is not in the map", () => {
    expect(regionOverlayFor("ghost", map)).toBeNull();
  });

  it("returns the {tint, alive} descriptor for a resolvable living owner", () => {
    expect(regionOverlayFor("a", map)).toEqual({ tint: 0x112233, alive: true });
  });

  it("returns alive:false for a dead owner so the caller can dim it", () => {
    expect(regionOverlayFor("dead", map)).toEqual({ tint: 0x445566, alive: false });
  });
});
