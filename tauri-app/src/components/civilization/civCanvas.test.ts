import { describe, expect, it } from "vitest";

import {
  axoActionAnimationForInteraction,
  buildCivColorMap,
  civTintFor,
  colonyBounds,
  focusTarget,
  hexToTint,
  regionOverlayFor,
} from "../../lib/civVisualHelpers";

const GREY = 0x888888;

describe("axoActionAnimationForInteraction", () => {
  it("maps manual world actions to distinct axolotl animations", () => {
    expect(axoActionAnimationForInteraction({ kind: "terrain", action: "mine_tile" })?.state).toBe("mine");
    expect(axoActionAnimationForInteraction({ kind: "terrain", action: "place_tile" })?.state).toBe("build");
    expect(axoActionAnimationForInteraction({ kind: "object", action: "repair_object" })?.state).toBe("repair");
    expect(axoActionAnimationForInteraction({ kind: "object", action: "rescue_object" })?.state).toBe("rescue");
    expect(axoActionAnimationForInteraction({ kind: "npc", action: "feed_hatchling" })?.state).toBe("feed");
  });

  it("falls back from target kind for non-action interactions", () => {
    expect(axoActionAnimationForInteraction({ kind: "resource" })?.state).toBe("gather");
    expect(axoActionAnimationForInteraction({ kind: "npc" })?.state).toBe("talk");
    expect(axoActionAnimationForInteraction({ kind: "building" })?.state).toBe("use");
    expect(axoActionAnimationForInteraction({ kind: "empty" })).toBeNull();
  });
});

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

describe("colonyBounds", () => {
  it("returns the tight bounding box over living colonies (pad 0)", () => {
    expect(
      colonyBounds(
        [
          { x: 10, y: 10, alive: true },
          { x: 30, y: 50, alive: true },
        ],
        0,
      ),
    ).toEqual({ x: 10, y: 10, w: 20, h: 40 });
  });

  it("inflates the box by pad on every side", () => {
    expect(
      colonyBounds(
        [
          { x: 10, y: 10, alive: true },
          { x: 30, y: 50, alive: true },
        ],
        5,
      ),
    ).toEqual({ x: 5, y: 5, w: 30, h: 50 });
  });

  it("excludes dead colonies (collapse re-frame drops them)", () => {
    expect(
      colonyBounds(
        [
          { x: 10, y: 10, alive: true },
          { x: 30, y: 50, alive: false },
        ],
        0,
      ),
    ).toEqual({ x: 10, y: 10, w: 0, h: 0 });
  });

  it("returns null when there are zero living colonies", () => {
    expect(colonyBounds([], 6)).toBeNull();
    expect(colonyBounds([{ x: 1, y: 2, alive: false }], 6)).toBeNull();
  });
});

describe("focusTarget", () => {
  const civs = [
    { id: "a", spawn_x: 7, home_region: "r-a" },
    { id: "b", spawn_x: 12 },
    { id: "c" },
    { id: "d", spawn_x: 20, home_region: "missing" },
  ];
  const regions = [
    // y mirrors the backend (WATER_SURFACE_Y = 6); the region spans from y down.
    { id: "r-a", x: 4, y: 6, width: 6, height: 8, owner: "a" },
  ];
  const entities = [
    { civ_id: "b", x: 10, y: 20 },
    { civ_id: "b", x: 14, y: 24 },
    { civ_id: "x", x: 99, y: 99 },
  ];

  it("prefers the civ's home-region centre in world tiles", () => {
    // region r-a: x=4, width=6 -> cx = 4 + 6/2 = 7;
    // vertical centre = y + height/2 = 6 + 8/2 = 10 (region top + half height).
    expect(focusTarget("a", civs, regions, entities)).toEqual({ tx: 7, ty: 10 });
  });

  it("falls back to the centroid of that civ's entities when no home region resolves", () => {
    // civ b: no home_region; entities (10,20) & (14,24) -> centroid (12, 22).
    expect(focusTarget("b", civs, regions, entities)).toEqual({ tx: 12, ty: 22 });
  });

  it("falls back to spawn_x at the seabed band when no region and no entities resolve", () => {
    // civ d: home_region "missing" not in regions; no entities -> spawn_x 20,
    // y resolves to WATER_FLOOR_Y (50) — colonies live near the seabed, not the surface.
    expect(focusTarget("d", civs, regions, entities)).toEqual({ tx: 20, ty: 50 });
  });

  it("returns null when nothing resolves (no region, no entities, no spawn_x)", () => {
    expect(focusTarget("c", civs, regions, entities)).toBeNull();
  });

  it("returns null for an unknown civ id", () => {
    expect(focusTarget("ghost", civs, regions, entities)).toBeNull();
  });
});
