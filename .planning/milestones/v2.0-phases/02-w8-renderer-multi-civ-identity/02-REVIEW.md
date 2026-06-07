---
phase: 02-w8-renderer-multi-civ-identity
reviewed: 2026-06-06T00:00:00Z
depth: deep
files_reviewed: 4
files_reviewed_list:
  - tauri-app/src/components/civilization/CivilizationGameCanvas.tsx
  - tauri-app/src/components/civilization/civCanvas.test.ts
  - tauri-app/src/components/civilization/CivilizationView.tsx
  - tauri-app/src/components/civilization/CivilizationView.test.tsx
findings:
  critical: 0
  high: 1
  medium: 4
  warning: 5
  info: 3
  total: 8
status: resolved
resolved: 2026-06-06T00:00:00Z
resolution:
  high: fixed       # HIGH-01 (incl. WARN-04 test fix)
  medium: fixed     # MED-01, MED-02, MED-03 fixed; MED-04 partial (guard added, real-scene test + retry deferred)
  deferred:
    - MED-04 (real-scene installCameraApi test + missed-focus retry) — see deferred-items.md
---

# Phase 2: Code Review Report — W8 Renderer Multi-Civ Identity

**Reviewed:** 2026-06-06
**Depth:** deep (cross-file: TS canvas helpers ↔ Rust civilization.rs ↔ bindings.ts)
**Files Reviewed:** 4
**Status:** resolved (HIGH-01, MED-01/02/03 fixed; MED-04 partial — guard added, remainder deferred)

> ## Resolution (2026-06-06)
>
> All in-scope findings actioned. tsc `--noEmit` exit 0; full `npm test` green
> (26 files, 245 tests, up from 244 — one test added for MED-04). `bindings.ts`
> was NOT touched. Frontend-only, per-finding atomic commits.
>
> | Finding | Status | Commit | Note |
> |---------|--------|--------|------|
> | HIGH-01 | fixed | `4cca6f7` | `focusTarget` vertical centre: home-region now `region.y + height/2`; spawn_x fallback now `WATER_FLOOR_Y` (50, seabed) not `SURFACE_ROWS` (6, surface); signature accepts `region.y`. JSDoc updated (INFO-02). |
> | WARN-04 | fixed | `4cca6f7` | `civCanvas.test.ts` now asserts correct `ty` (home-region `ty=10` for `y=6,height=8`; spawn_x `ty=50`) instead of the buggy `ty=4` / `Number.isFinite`-only. |
> | MED-01 | fixed | `fd1245f` | Multi-colony fit gated on `colonies.length >= 2`; lone colony keeps the legacy world-fit instead of clamping to maxZoom. |
> | MED-02 | fixed | `efeb639` | `applyCivTint` null path now calls `clearTint()` + resets `appliedTint` so an owned→wild sprite returns to default. |
> | MED-03 | fixed | `c5051a8` | Collapse detection counts living civs from `snapshot.civs` (`alive !== false`), not resolvable colonies; redundant colony filter dropped. |
> | MED-04 | partial / deferred | `89f8bc6` | Cheap guard test added (selection-before-bridge-install is a no-op, not a crash). Real-scene `installCameraApi` test + missed-focus retry on scene readiness deferred — see `deferred-items.md`. |
>
> WARN-01/02/03/05 and INFO-01/03 were out of the fix scope (warnings/info) and
> were not actioned; INFO-02 (keep `focusTarget` JSDoc in sync) was folded into
> the HIGH-01 fix.
>
> Corrected `focusTarget` expected values:
> - home-region: `ty = region.y + height/2` (e.g. `6 + 8/2 = 10`).
> - centroid: unchanged (`mean(entity.y)`).
> - spawn_x fallback: `ty = WATER_FLOOR_Y = 50` (seabed band).

## Summary

The multi-civ identity work is mostly sound and well-tested at the pure-helper
level. `bindings.ts` was correctly NOT regenerated/hand-edited (verified absent
from the diff). No security issues: `hexToTint` is strictly regex-validated and
fail-safe (a colour string can only ever become a 24-bit number, never markup,
never NaN), and there is no `dangerouslySetInnerHTML`/`innerHTML`/`eval` sink.
Phaser 4 API usage is clean — no removed `setTintFill`, no `tintMode` misuse,
tinting is `setTint` only and is diff-gated (no per-frame whole-world re-tint).
The four ARENA-02 camera methods (`zoomBy`/`recenter`/`toggleFollow`/`focusRegion`)
are intact and untouched in `installCameraApi`.

The findings below are real correctness defects, not style. The headline issue:
`focusTarget`'s vertical-centre math is wrong across two of its three fallback
branches, so the camera frames a civ at the wrong altitude (HIGH). Secondary
issues: single-civ default framing changed behaviour, a stale-tint hole on a
hypothetical owned→wild transition, and a redundant filter that masks intent in
the collapse-detection path. Test coverage is substantive for the View wiring
and pure helpers, but has two real gaps (real-scene camera API not covered; the
buggy `ty` values are never asserted).

---

## High

### HIGH-01: `focusTarget` vertical centre is wrong in 2 of 3 branches — camera frames civs at the wrong altitude

**Resolution:** FIXED (`4cca6f7`). Home-region branch now returns `region.y + height/2`; spawn_x fallback returns `WATER_FLOOR_Y` (50); signature accepts `region.y`. JSDoc synced (INFO-02). Tests updated (WARN-04).

**File:** `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx:3335` and `:3347`

**Issue:** The phase brief requires `colonyBounds`/`focusTarget` math to match
`focusRegion`'s `*TILE_SIZE` convention. The tile math is right, but the
**vertical centre is computed incorrectly**, and the three fallback branches
disagree with each other by hundreds of pixels:

1. **Home-region branch (line 3335):** returns `ty: (region.height ?? 0) / 2`.
   But in the backend (`civilization.rs:1186-1188`) a region is
   `y = WATER_SURFACE_Y (=6)`, `height = WORLD_HEIGHT - WATER_SURFACE_Y (=90)`.
   The true vertical centre is `region.y + region.height / 2 = 6 + 45 = 51`
   tiles. The code returns `45` tiles — off by exactly `region.y` (6 tiles /
   96 px). The `focusTarget` signature does not even accept `region.y`, so it
   *cannot* compute the correct centre as written.

2. **spawn_x branch (line 3347):** returns `ty: SURFACE_ROWS` (= 6 tiles = 96 px
   from the top), i.e. the **water surface**. But colonies live at the seabed
   (`WATER_FLOOR_Y = 50`, ~800 px down). A civ resolved via the spawn_x fallback
   is framed ~700 px *above* its actual colony — effectively off-screen-vertical
   once zoomed.

3. **centroid branch (line 3343):** uses the real entity `y` (~seabed, correct).

Because `recomputeColonies` feeds these `ty` values into `colonyBounds`, the
multi-colony bounding box can be vertically skewed (a home-region civ at y=45
boxed together with a spawn_x civ at y=6), so `frameAll` mis-centres and the
default `onResize` fit is wrong.

**Fix:** Make all three branches resolve to the same physical level (the
seabed/colony band) and pass `region.y` through:

```ts
export function focusTarget(
  civId: string,
  civs: { id?: string; spawn_x?: number; home_region?: string }[] | undefined,
  regions: { id: string; x: number; y: number; width: number; height?: number; owner?: string | null }[] | undefined,
  entities: { civ_id?: string | null; x: number; y: number }[] | undefined,
): { tx: number; ty: number } | null {
  const civ = (civs ?? []).find((c) => c.id === civId);
  if (!civ) return null;
  if (civ.home_region) {
    const region = (regions ?? []).find((r) => r.id === civ.home_region);
    if (region) {
      // vertical centre = region top (y) + half its height, not height/2.
      return { tx: region.x + region.width / 2, ty: region.y + (region.height ?? 0) / 2 };
    }
  }
  const own = (entities ?? []).filter((e) => e.civ_id === civId);
  if (own.length > 0) {
    const sx = own.reduce((a, e) => a + e.x, 0) / own.length;
    const sy = own.reduce((a, e) => a + e.y, 0) / own.length;
    return { tx: sx, ty: sy };
  }
  if (typeof civ.spawn_x === "number") {
    // seabed level, not the surface — match the colony band the other branches resolve to.
    return { tx: civ.spawn_x, ty: WATER_FLOOR_Y }; // or seabed_row_at(spawn_x) if exposed
  }
  return null;
}
```

Then update the unit test to assert the actual `ty` values (it currently only
checks `Number.isFinite`, see WARN-04), and pass `r.y` in the call sites
(`focusCiv`, `recomputeColonies` already forward `this.snapshot.world.regions`,
which carry `y`).

---

## Medium

### MED-01: Single-civ default framing silently changed — now zooms to maxZoom on one colony

**Resolution:** FIXED (`fd1245f`). Multi-colony fit gated on `this.colonies.length >= 2`; lone colony keeps the legacy world-fit.

**File:** `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx:3051-3064`

**Issue:** Previously, the initial framing always used the world-fit
(`Math.max(fit * 1.7, cw / (60 * TILE_SIZE))`) centred on `this.colony`. Now the
multi-colony branch runs whenever **any** colony resolves — including the common
single-civ / legacy world. With one colony, `colonyBounds` returns a 12-tile-wide
box (`pad = 6 * TILE_SIZE` on each side), so `fit = min(cw/192, ch/192)` ≈ 6,
which clamps to `maxZoom = 2.6`. The default single-civ view is now much more
zoomed in than before — a behaviour regression for the legacy single-civ case,
which the brief flags as the dominant path.

**Fix:** Gate the multi-colony branch on `this.colonies.length >= 2`, or pad a
single colony far more generously so it falls back to a sensible wide view:

```ts
const b = this.colonies.length >= 2 ? colonyBounds(this.colonies, 6 * TILE_SIZE) : null;
if (b && b.w > 0 && b.h > 0) { /* multi-colony fit */ }
else { /* original world-fit centred on this.colony */ }
```

### MED-02: Stale civ tint on an owned→wild transition (appliedTint never reset to default)

**Resolution:** FIXED (`efeb639`). `applyCivTint` null path now calls `clearTint()` and resets `appliedTint`.

**File:** `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx:989-996`

**Issue:** `applyCivTint` returns early when `wanted == null` (wild fauna / map
miss) *without clearing a previously applied tint*. The comment frames this as
correct ("wild fauna keeps its default morph tint"), and for always-wild entities
it is. But if an entity ever transitions owned→wild (its `civ_id` goes from a
known civ to `null`/an unknown id), the body keeps the **previous civ's tint
forever** — there is no `clearTint()` path. Today the backend only goes
`null → Some(civ)` at load (`civilization.rs:4589-4592`), so this is latent, not
live — hence MEDIUM not HIGH. But the helper advertises "Wild fauna … keeps its
default" as a general contract, and the diff-gate makes the bug invisible until a
future raid/defect/release path sets `civ_id = None`.

**Fix:** Track whether a tint was ever applied and clear it on the null path:

```ts
private applyCivTint(axo: AxoSprite, entity: CivEntity) {
  const info = this.civColorById.get(entity.civ_id ?? "");
  const wanted = civTintFor(info, GREY_TINT);
  if (wanted == null) {
    if (axo.appliedTint !== undefined) { axo.body.clearTint(); axo.appliedTint = undefined; }
    return;
  }
  if (axo.appliedTint === wanted) return;
  axo.body.setTint(wanted);
  axo.appliedTint = wanted;
}
```

### MED-03: Collapse re-frame counts *resolvable* colonies, not living civs — spurious / missed re-frames

**Resolution:** FIXED (`c5051a8`). Collapse count now derives from `snapshot.civs` living count (`alive !== false`) in both the create baseline and setSnapshot; redundant colony filter dropped.

**File:** `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx:531`, `:552-557`, `:3094-3101`

**Issue:** `recomputeColonies` only pushes colonies that are (a) `alive !== false`
**and** (b) resolvable via `focusTarget`. So `this.colonies` is "living **and**
resolvable" — meaning `living = this.colonies.filter(c => c.alive).length`
(line 552) is really a count of *resolvable* living colonies, not living civs.
Consequences:
- A civ that is alive but momentarily unresolvable (no home_region, no entities,
  no spawn_x — e.g. a transient turn) drops from the count and triggers a
  **spurious collapse re-frame**.
- The `filter(c => c.alive)` is **redundant** — `recomputeColonies` never pushes
  a dead colony (line 3097 `if (!c.id || c.alive === false) continue`), so every
  element already has `alive: true`. The redundant filter hides the fact that
  "collapse" is being inferred from resolvability, not death.

**Fix:** Drive collapse detection from the authoritative living-civ count, and
drop the redundant filter:

```ts
// in updateSnapshot:
const living = (this.snapshot.civs ?? []).filter((c) => c.alive !== false).length;
if (this.prevLivingCount >= 0 && living < this.prevLivingCount && living > 0) {
  this.frameAll();
}
this.prevLivingCount = living;
```
Keep `colonies` for the bounding box, but base the shrink-detection on the civ
list, not on how many colonies happened to resolve this frame.

### MED-04: `focusCiv` is unreachable from the View when the View runs before the scene installs the bridge — and no test covers the real bridge

**Resolution:** PARTIAL / DEFERRED (`89f8bc6`). Added a View-level guard test pinning that selecting a civ before the bridge installs is a silent no-op (not a crash). The real-scene `installCameraApi` test (needs scene export or a camera-API factory + fattened Phaser mock) and the missed-focus retry on scene readiness (needs a cross-layer `civCameraReady` signal) are deferred — see `deferred-items.md` — to avoid disproportionate rework / a brittle test.

**File:** `tauri-app/src/components/civilization/CivilizationView.tsx:307-311`; `tauri-app/src/components/civilization/CivilizationView.test.tsx:29-31`

**Issue:** Two coupled gaps:
1. The `useEffect` calls `window.civCamera?.focusCiv?.(...)`. Because the canvas
   mounts a Phaser scene whose `create()` runs after React commit,
   `window.civCamera` may be undefined on the *first* selection, so the focus is
   silently dropped (optional-chain no-op). Selecting a civ during the brief
   startup window does nothing and never retries. Consider re-firing the effect
   when the scene signals readiness, or have the scene apply the
   current-selection on install.
2. The View tests mock `CivilizationGameCanvas` to `() => null` and install their
   own six-method spy bridge. So **no test exercises the real `installCameraApi`**
   — the ARENA-02 regression risk the brief calls out (an accidental break of
   the four original methods, or `focusCiv`/`frameAll` failing to bind `this`)
   is *not* covered. `civCanvas.test.ts` mocks Phaser entirely and only tests
   pure helpers, so it doesn't cover the scene method either.

**Fix:** Add a scene-readiness signal (e.g. a `civCameraReady` event or a
`window.civCamera` install callback) and re-run the focus effect on it; and add a
test that constructs the real scene's camera API (or at least asserts the diff's
six methods are all wired) under the Phaser mock, so a removed/renamed original
method is caught.

---

## Warnings

### WARN-01: `frameAll` ignores `cam.width/height` vs `scale.width/height` mismatch

**File:** `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx:3010-3022`

**Issue:** `frameAll` reads `this.scale.width/height` for the fit but
`focusCiv`/`focusRegion`/`onResize` use `cam.width`. If the camera viewport ever
differs from the scale size (split UI cam, letterboxing), the fit is computed
against the wrong dimensions. Minor today (they match), but it's an inconsistency
that will bite if the viewport is ever resized independently.

**Fix:** Use `cam.width`/`cam.height` consistently in `frameAll`, matching the
other camera methods.

### WARN-02: Minimap region fill does not grey dead civs (inconsistent with the main overlay)

**File:** `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx:1706-1708`

**Issue:** The main territory overlay dims a dead civ's region (alpha 0.06/0.25,
`drawWorld`), but the minimap uses `overlay.tint` at a flat 0.34 alpha regardless
of `overlay.alive`. A collapsed civ's territory still shows full-strength colour
on the minimap — visually contradicts the greyed main view.

**Fix:** Apply the same `alive ? tint : GREY_TINT` (or alpha reduction) in the
minimap branch, mirroring `drawWorld`'s overlay handling.

### WARN-03: `focusTarget` entity-centroid includes buildings/objects/eggs/dead bodies

**File:** `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx:3338-3344`

**Issue:** The centroid fallback averages **all** entities with the matching
`civ_id` — buildings, world objects, eggs, scattered/fleeing axolotls. A civ with
one outlying object (e.g. a far bridge or a trapped rescue object) pulls the
focus point off the colony. The other branches target the colony specifically.

**Fix:** Filter to colony anchors first (`role === "pond" || role === "nest"`,
else living `kind === "axolotl"`) before falling back to all entities — matching
`recomputeColony`'s pond/nest precedence.

### WARN-04: Tests assert `Number.isFinite(ty)` instead of the actual value — they would pass with the HIGH-01 bug

**Resolution:** FIXED (`4cca6f7`, with HIGH-01). Tests now assert exact correct `ty` (home-region `ty=10`; spawn_x `ty=50`).

**File:** `tauri-app/src/components/civilization/civCanvas.test.ts:204-209`, `:184-187`

**Issue:** The `focusTarget` tests check `expect(Number.isFinite(t?.ty)).toBe(true)`
for the spawn_x fallback and never assert the home-region `ty` against a colony
level. The home-region test asserts `ty: 4` (= 8/2, the buggy `height/2`), which
*encodes the HIGH-01 bug as expected behaviour*. These tests give false
confidence — they pass while the camera frames the wrong altitude.

**Fix:** Assert exact, physically-correct `ty` values once HIGH-01 is fixed (e.g.
home-region `ty = region.y + height/2`; spawn_x `ty = WATER_FLOOR_Y`). Tests
should pin the contract, not the defect.

### WARN-05: `prevLivingCount` collapse logic does not re-frame on the world-load path (only the `framed` flip handles it)

**File:** `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx:548-557`

**Issue:** The comment says "World create/load re-frames via the `framed` flip,"
but `framed` is only set false in a fresh scene. If a snapshot *replaces* the
world in an existing scene (load-into-running-scene) without recreating the scene,
`framed` stays true and the new world is never re-framed; collapse detection only
fires on a *shrink*, not on a load. Confirm the load path always recreates the
scene; if not, a loaded world keeps the previous camera box.

**Fix:** Either guarantee scene recreation on load, or reset `framed = false` (or
call `frameAll()`) when `updateSnapshot` detects a world identity change
(different `snapshot.id`/`seed`).

---

## Info

### INFO-01: Building tint uses the same `lighten(tint, 0.5)` as axolotls

**File:** `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx:811-813`

Buildings get the lightened identity tint. Intentional/consistent, but worth a
visual check — building sprites may read better with a stronger (less lightened)
multiply tint than the detail-preserving axolotl lightening.

### INFO-02: `colonyBounds`/`focusTarget` doc comments are excellent — keep them in sync after the HIGH-01 fix

**File:** `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx:3316-3322`

The JSDoc claims the math "mirrors focusRegion's `(rx + width/2) * TILE_SIZE`."
That holds for x but not for the vertical centre (HIGH-01). Update the comment
when fixing so it doesn't assert a property the code lacks.

### INFO-03: Test file mocks `Phaser.TintModes.FILL`, which the production code never uses

**File:** `tauri-app/src/components/civilization/civCanvas.test.ts:13`

The Phaser mock exposes `TintModes: { FILL, MULTIPLY }`, but the source uses only
`setTint` (multiply by default) — there's no `tintMode`/`setTintFill` call to
support. Harmless, but the mock surface is broader than the code needs; trim if
you want the mock to document actual usage.

---

_Reviewed: 2026-06-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
