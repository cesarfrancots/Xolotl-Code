# Phase 2: W8 — Renderer Multi-Civ Identity - Pattern Map

**Mapped:** 2026-06-06
**Files analyzed:** 4 (1 modified scene, 1 new helper test, 2 hand-written Window typedefs — the helpers themselves are new *exports inside the existing scene file*, not a new module)
**Analogs found:** 4 / 4

> **Key framing (from RESEARCH.md):** This phase is frontend-only and almost entirely contained in
> `CivilizationGameCanvas.tsx`. Every rendering primitive already exists for the *single-colony* case.
> The work is plumbing the *civ dimension* through existing passes — so the "analog" for nearly every
> change is **the same file's own existing code**. Extend, do not rewrite. No backend, no `bindings.ts`
> regen (no IPC change).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx` | component (Phaser scene) | transform / request-response (snapshot → render) | itself (existing single-colony passes) | exact (self-analog) |
| `tauri-app/src/components/civilization/civCanvas.test.ts` *(new)* | test (unit, pure helpers) | n/a | `tauri-app/src/lib/civPilot.test.ts` | exact (same `vi.mock("phaser")` + named-export pattern) |
| `Window.civCamera` typedef in `CivilizationGameCanvas.tsx` (lines 12-17) | config (ambient typedef) | n/a | itself (existing 4-method decl) | exact (additive) |
| `Window.civCamera` typedef in `CivilizationView.tsx` (lines 62-67) | config (ambient typedef) | n/a | the canvas-file decl (must stay in sync) | exact (additive, mirror) |
| *(optional)* `CivilizationView.test.tsx` extension | test (component, RTL) | n/a | `CivilizationView.test.tsx` (existing leaderboard-click test, lines 243-253) | exact (extend existing) |

The new pure helpers (`hexToTint`, `buildCivColorMap`, `colonyBounds`, `focusTarget`, plus tint-selection
and overlay-decision helpers) are **named exports added to `CivilizationGameCanvas.tsx`** — mirroring how
Phase 1 exported `renderSnapshotToText` from the same file so it could be unit-tested without Phaser.

---

## Pattern Assignments

### `CivilizationGameCanvas.tsx` — pure helpers (new named exports)

**Analog:** `shade()` (lines 3089-3094) — the existing pure, module-scope color helper.

```typescript
// 3089-3094 — bit-twiddling RGB helper, pure, exported style to mirror
function shade(color: number, factor: number): number {
  const r = Math.round(((color >> 16) & 0xff) * factor);
  const g = Math.round(((color >> 8) & 0xff) * factor);
  const b = Math.round((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}
```

**Pattern to follow:** Add `export function hexToTint(...)`, `export function buildCivColorMap(...)`,
`export function colonyBounds(...)`, `export function focusTarget(...)` at module scope (next to `shade`,
`clampSize`, `dist`). Keep them **Phaser-free** (no `Phaser.*` calls) so the test can import them under
`vi.mock("phaser")`. The exact helper signatures are in RESEARCH.md Patterns 1, 4, 5 (lines 153-171,
224-236, 259-264). `hexToTint` must be **total/fail-safe** (`#`-tolerant, 3-digit tolerant, bad/missing
→ `0xffffff`) per the Security Domain note (RESEARCH.md 521).

Data-model field names the helpers consume (confirmed in `bindings.ts`):
- `CivCivilization` (258-277): `id?`, `color?`, `alive?`, `spawn_x?`, `home_region?`.
- `CivRegion` (441-453): `id`, `x`, `width`, `height`, `owner?: string | null`.
- `CivEntity.civ_id` (~312-325): nullable; **null = wild fauna → no civ tint** (Pitfall 4).

---

### `CivilizationGameCanvas.tsx` — civ→color map build (in `setSnapshot`)

**Analog:** `setSnapshot()` (lines 522-534) and the diff-on-signature pattern.

```typescript
// 522-534 — snapshot apply flow: rebuild world, sync, recompute colony
setSnapshot(snapshot: CivSessionSnapshot) {
  if (snapshot.turn > this.prevTurn) this.spawnPulse(this.colony.x, this.colony.y, 0x6dd6a7);
  this.prevTurn = snapshot.turn;
  this.snapshot = snapshot;
  if (!this.sys?.isActive()) return;
  this.rebuildWorld();
  this.syncEntities();
  ...
  this.recomputeColony();
}
```

**Pattern to follow:** Add `this.civColorById = buildCivColorMap(snapshot.civs)` **before** `syncEntities()`
(so create/update tints can read it), and add `recomputeColonies()` alongside `recomputeColony()`. Add the
field next to `private colony = { x: 0, y: 0 }` (line 433):
`private civColorById = new Map<string, { tint: number; alive: boolean }>();`
and `private colonies: { civId: string; x: number; y: number; alive: boolean }[] = [];`. Re-frame only on
world create/load (`framed` flips false at line 657 in `rebuildWorld`) and on collapse — **not** every snapshot
(Pitfall 3).

---

### `CivilizationGameCanvas.tsx` — axolotl body tint (`createAxo` / `updateAxo`)

**Analog:** existing `setTint` call sites in `createAxo` — the morph-glow tint (971) and placeholder tint (980).

```typescript
// 971 — morph glow tint (KEEP as the secondary morph cue; do NOT overwrite)
g.setTint(entity.morph === "gfp" ? 0x7dffb0 : entity.morph === "firefly" ? 0xffe27a : 0xc89bff);
...
// 980 — placeholder body tint (the pre-sprite fallback path)
body.setTint(0xef9bc0);
```

**AxoSprite type extension** — analog is the existing type (lines 324-347):

```typescript
// 324-347 — add a new field to track the last-applied civ tint for the diff
type AxoSprite = {
  id: string;
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
  ...
  workSeed: number;
  // ADD: appliedTint?: number;  (and optionally appliedCivId?: string)
};
```

**Pattern to follow:**
- In `createAxo` (945-1009), after `container.add(body)` (~982): resolve
  `this.civColorById.get(entity.civ_id ?? "")`; if found, `body.setTint(<lightened tint>)` for a living civ
  or a grey/desaturated tint for a dead civ, and store `axo.appliedTint`. If **not** found (wild fauna,
  null civ_id) leave the body's default tint untouched (Pitfall 4).
- In `updateAxo` (1011-1032): re-tint **only when the wanted tint differs** from `axo.appliedTint`
  (RESEARCH.md Pattern 3, lines 204-212) — satisfies the CONTEXT "set tint only when civ changes / on
  (re)creation" performance decision.
- **Tint `axo.body`, never the `Container`** (Pitfall 2). Keep the morph `glow` tint (971) as-is.
- **Phaser 4 gotcha:** living civ = `setTint(color)` (MULTIPLY default — unchanged in v4, preserves morph
  detail). A hard flat grey for dead civs uses `setTint(grey).setTintMode(Phaser.TintModes.FILL)` —
  **NOT** the removed `setTintFill` (CLAUDE.md / RESEARCH.md Pitfall 1, line 299-305).

`syncEntities` (929-943) needs no structural change — it already routes to create/update; the tint logic
lives inside those two methods.

---

### `CivilizationGameCanvas.tsx` — building tint (`drawBuildings`)

**Analog:** `drawBuildings()` (lines 747-780) and its signature-diff guard.

```typescript
// 750-755 — building signature; early-return if unchanged
let sig = "";
for (const e of this.snapshot.world.entities) {
  if (e.kind === "building" || e.kind === "object") sig += `${e.id},${e.kind},${e.x},${e.y},${e.role},${e.activity},${Math.round(e.health ?? 0)};`;
}
if (sig === this.prevBuildingSig) return;
...
// 769-773 — building image creation (the tint target)
const img = this.add.image(px, py, key).setOrigin(0.5, 0.84);
img.setDisplaySize(big, big);
img.setDepth(entity.y * 0.02);
layer.add(img);
```

**Pattern to follow:** Add `entity.civ_id` to the signature string at line 752 so an ownership change forces
a redraw (Pitfall 5). After `layer.add(img)` (~773), resolve the civ color from `this.civColorById` keyed by
`entity.civ_id` and `img.setTint(civColor)` — only when civ resolves; leave neutral otherwise.

---

### `CivilizationGameCanvas.tsx` — region/territory owner overlay (`bakeTerrain` wash pass)

**Analog:** the per-biome `wash` fill loop in `bakeTerrain()` (lines 682-688).

```typescript
// 682-688 — existing translucent per-region BIOME fill (the pattern to mirror per-OWNER)
this.wash?.clear();
for (const region of world.regions ?? []) {
  const col = BIOME_WASH[region.biome];
  if (col === undefined) continue;
  this.wash?.fillStyle(col, 0.1);
  this.wash?.fillRect(region.x * TILE_SIZE, SURFACE_ROWS * TILE_SIZE, region.width * TILE_SIZE, this.worldH);
}
```

**Pattern to follow:** Add a sibling per-`owner` overlay (RESEARCH.md Code Example lines 367-378). Prefer a
**separate `Graphics` layer** (e.g. `this.territory`) above `wash` so biome wash and civ overlay compose,
and register it in the camera/uiCam ignore-lists (the ignore list lives at ~483-489, same place `wash`/
`substrate`/etc. are registered — declare the new layer field next to `wash?` at line 365 and create/ignore
it where the other Graphics layers are created). Loop `world.regions`, skip when `region.owner == null`
(neutral, Pitfall 4), else `fillStyle(info.tint, alive?0.14:0.06)` + `lineStyle/strokeRect` with the owner's
civ color. Alpha values are Claude's discretion.

---

### `CivilizationGameCanvas.tsx` — minimap region tint (`drawMinimap`)

**Analog:** the per-biome minimap region fill (lines 1648-1653).

```typescript
// 1648-1653 — minimap per-region biome fill
for (const region of this.snapshot.world.regions ?? []) {
  const rx = x + region.x * sx;
  const rw = region.width * sx;
  g.fillStyle(BIOME_WASH[region.biome] ?? 0x2f6f88, 0.34);
  g.fillRect(rx, y + SURFACE_ROWS * sy, rw, h - SURFACE_ROWS * sy);
}
```

**Pattern to follow:** "Basic tint" only (deeper minimap redesign is deferred — CONTEXT/RESEARCH OQ3).
When `region.owner` resolves to a civ, substitute the civ color for `BIOME_WASH[region.biome]` at line 1651;
otherwise keep the biome color. One-line change.

---

### `CivilizationGameCanvas.tsx` — multi-colony camera fit (`onResize` + new `frameAll`)

**Analog:** `onResize()` fit logic (lines 2957-2964) and `recomputeColony()` (2968-2983).

```typescript
// 2957-2964 — single-colony fit-on-first-frame (generalize to a colonyBounds rect)
if (!this.framed) {
  this.framed = true;
  const fit = Math.min(cw / this.worldW, ch / this.worldH);
  cam.setZoom(Phaser.Math.Clamp(Math.max(fit * 1.7, cw / (60 * TILE_SIZE)), this.minZoom, this.maxZoom));
  cam.centerOn(this.colony.x, this.colony.y);
} else {
  cam.setZoom(Phaser.Math.Clamp(cam.zoom, this.minZoom, this.maxZoom));
}

// 2968-2983 — single-point colony pick (pond → nest → axo centroid → world center)
private recomputeColony() {
  const ents = this.snapshot.world.entities;
  const pond = ents.find((e) => e.role === "pond") ?? ents.find((e) => e.role === "nest");
  if (pond) { this.colony = { x: pond.x * TILE_SIZE + TILE_SIZE / 2, y: pond.y * TILE_SIZE - 6 }; return; }
  ...
}
```

**Pattern to follow:** Keep `this.colony` + `recomputeColony` (player-follow fallback). **Add** a
`recomputeColonies()` that builds one point per **living** civ (home-region center, else entities centroid,
else `spawn_x`) into `this.colonies`, and a `private frameAll()` that calls the pure `colonyBounds(this.colonies, pad)`
then fits via `cam.zoomTo` + `cam.pan` (RESEARCH.md Pattern 4 lines 239-248). In `onResize`, when
`!this.framed`, fit to `colonyBounds()` over living colonies (fallback to `this.colony` when bounds is null).
`frameAll`/`focusCiv` must set `this.following = false` (mirror `focusRegion` 2936) and use the easing
pan/zoom that `step` already yields to.

---

### `CivilizationGameCanvas.tsx` — additive `focusCiv` / `frameAll` bridge (`installCameraApi`)

**Analog:** `installCameraApi()` (lines 2917-2945) — the existing 4-method `window.civCamera`, and
`focusRegion` (2935-2943) for the pan+zoom math; `zoomAt` (2908-2915) for zoom-around-point.

```typescript
// 2917-2945 — the existing bridge object literal. ADD keys; NEVER remove the four.
private installCameraApi() {
  window.civCamera = {
    zoomBy: (factor) => { ... },        // KEEP
    recenter: () => { ... },            // KEEP
    toggleFollow: () => { ... },        // KEEP
    focusRegion: (rx, width) => {       // KEEP — model the new methods on this
      this.following = false;
      const cx = (rx + width / 2) * TILE_SIZE;
      const cy = this.worldH * 0.46;
      const cam = this.cameras.main;
      const target = Phaser.Math.Clamp(cam.width / (width * TILE_SIZE * 1.15), this.minZoom, this.maxZoom);
      cam.pan(cx, cy, 420, Phaser.Math.Easing.Sine.Out);
      cam.zoomTo(target, 420, Phaser.Math.Easing.Sine.Out);
    },
    // ADD: focusCiv: (civId) => scene.focusCiv(civId),
    // ADD: frameAll: () => scene.frameAll(),
  };
}
```

**Pattern to follow:** Extend the literal additively (ARENA-02 / Phase 1 extend-only contract — Anti-Pattern
RESEARCH.md 278). `focusCiv(civId)` resolves the target via the pure `focusTarget(...)` helper (home-region
center → entities centroid → `spawn_x`), sets `this.following = false`, and `cam.pan`+`cam.zoomTo` exactly
like `focusRegion`. `frameAll()` delegates to the scene method above.

---

### `Window.civCamera` typedefs (two hand-written declarations, keep in sync)

**Analog:** the existing declarations — `CivilizationGameCanvas.tsx` 12-17 and `CivilizationView.tsx` 62-67
(currently **identical**, 4 methods each).

```typescript
// CivilizationGameCanvas.tsx 12-17  AND  CivilizationView.tsx 62-67 (mirror)
civCamera?: {
  zoomBy(factor: number): void;
  recenter(): void;
  toggleFollow(): void;
  focusRegion(x: number, width: number): void;
};
```

**Pattern to follow:** Add `focusCiv?(civId: string): void;` and `frameAll?(): void;` (optional, so existing
callers compile) to **both** declarations. These are hand-written ambient typedefs — **no `bindings.ts`
regen** (no IPC surface change; CLAUDE.md gotcha 1 / RESEARCH.md Runtime State Inventory line 409).

---

### `CivilizationView.tsx` — wire `selectedCivId` → camera

**Analog:** the existing `selectedCivId` consumer (line 200) and the camera-button bridge calls (1313-1321).

```typescript
// 200 — selectedCivId already read from the store
const selectedCivId = useCivStore((s) => s.selectedCivId);
// 1313-1321 — existing pattern for invoking window.civCamera from the view
<button ... onClick={() => window.civCamera?.zoomBy(1.2)} ...>
<button ... onClick={() => window.civCamera?.recenter()} ...>
```

**Pattern to follow:** Add a `useEffect([selectedCivId])` that calls
`window.civCamera?.focusCiv(selectedCivId)` when a civ is selected, and `window.civCamera?.frameAll()` when
it clears to null (RESEARCH.md Pattern 5 wiring, lines 273-274). The leaderboard-row → `setSelectedCivId`
link already landed in Phase 1 (verified by the existing test at `CivilizationView.test.tsx:243-253`).

---

### `civCanvas.test.ts` (new — pure-helper unit tests)

**Analog:** `tauri-app/src/lib/civPilot.test.ts` (lines 1-13) — the canonical Phase 1 pattern for testing a
pure function that lives in the Phaser-importing canvas module.

```typescript
// civPilot.test.ts 1-13 — mock phaser BEFORE importing from the canvas module
import { describe, expect, it, vi } from "vitest";
// renderSnapshotToText lives in the canvas module, which imports Phaser at module
// load (Phaser's ESM init touches a canvas and crashes under jsdom). ...
vi.mock("phaser", () => {
  class Scene {}
  return { default: { Scene, Game: class {}, AUTO: 0, Scale: { RESIZE: 0, NO_CENTER: 0 } }, Scene };
});
import { renderSnapshotToText } from "../components/civilization/CivilizationGameCanvas";
```

**Pattern to follow:** Place `vi.mock("phaser", ...)` at the **top, before** the import of the helpers from
`CivilizationGameCanvas`. Import `hexToTint`, `buildCivColorMap`, `colonyBounds`, `focusTarget` (and any
tint-selection / overlay-decision helper). Cover the REN-01/REN-02 unit rows from RESEARCH.md's Test Map
(lines 482-490): hex tolerance + bad-input fallback `0xffffff`; map id→{tint,alive}, skip id-less, alive
default true; null civ_id → map miss (no tint); region owner null → no overlay; dead civ → grey selected;
`colonyBounds` correct rect / null when none alive / excludes dead; `focusTarget` precedence (home region →
centroid → spawn_x → null). Run with `cd tauri-app && npx vitest run civCanvas`.

> If the test file is placed *next to* the canvas (`components/civilization/civCanvas.test.ts`), the relative
> import is `"./CivilizationGameCanvas"`; if in `lib/` like `civPilot.test.ts`, it is
> `"../components/civilization/CivilizationGameCanvas"`. Either works as long as `vi.mock("phaser")` precedes it.

---

## Shared Patterns

### Phaser 4 tint API (applies to: body tint, building tint, dead-civ grey)
**Source:** RESEARCH.md Pitfall 1 (299-305) / CLAUDE.md; existing multiply `setTint` sites (714/971/980).
- Living civ identity: `obj.setTint(color)` — MULTIPLY is the default mode in v4, preserves morph/GFP detail.
- Hard flat grey (dead civ, only if wanted): `obj.setTint(grey).setTintMode(Phaser.TintModes.FILL)`.
- **Never** `setTintFill` / `tintFill` — removed in Phaser 4.

### Diff-on-signature / diff-on-applied-value (applies to: tint perf, building redraw)
**Source:** `prevResourceSig` (726), `prevBuildingSig` (754), `bakeSig` (654-662).
Compute a signature/flag, early-return when unchanged. New tint code mirrors this with `axo.appliedTint`
(per-sprite diff) and by adding `civ_id` to the building signature.

### Extend-only `window.*` bridge contract (applies to: `civCamera`, both typedefs)
**Source:** ARENA-02 (Phase 1); Anti-Pattern RESEARCH.md 278; existing 4-method literal (2917-2945).
Add keys to the bridge object and both hand-written typedefs; never remove or rename the existing four.

### Pure helper + `vi.mock("phaser")` test (applies to: all new helpers and their test)
**Source:** `shade` (3089-3094) as the pure-helper shape; `civPilot.test.ts` (1-13) +
`renderSnapshotToText` export as the test+export precedent.
Export Phaser-free helpers from the canvas module; mock phaser at test top.

### Camera move via built-in effects (applies to: frameAll, focusCiv)
**Source:** `focusRegion` (2935-2943), `zoomAt` (2908-2915); `step` yields to `cam.panEffect.isRunning`.
Use `cam.pan()` / `cam.zoomTo()` with Sine easing and `Phaser.Math.Clamp(..., this.minZoom, this.maxZoom)`;
set `this.following = false` before re-framing. Do not hand-roll a per-frame lerp.

### Wild-fauna / unclaimed = neutral (applies to: axo tint, building tint, region overlay, minimap)
**Source:** RESEARCH.md Pitfall 4 (327-333); `bindings.ts` `civ_id` (312-325), `owner?` (449-453).
`civ_id == null` → no civ tint (keep morph default). `region.owner == null` → no civ overlay (neutral).
Only apply civ color when the id resolves in `civColorById`.

---

## No Analog Found

None. Every change has a same-file (or Phase 1) analog. The only genuinely new artifact is the
`civCanvas.test.ts` file, and its structure is fully prescribed by `civPilot.test.ts`.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| — | — | — | — |

---

## Metadata

**Analog search scope:** `tauri-app/src/components/civilization/` (canvas, view, view test),
`tauri-app/src/lib/` (civPilot.test.ts), `tauri-app/src/bindings.ts` (data model),
`tauri-app/src/stores/civStore.ts` (referenced via RESEARCH, not re-read — selectedCivId/normalizeCiv).
**Files scanned (read):** 6 (CONTEXT, RESEARCH, CLAUDE.md, CivilizationGameCanvas.tsx [targeted ranges],
CivilizationView.tsx [targeted ranges], CivilizationView.test.tsx, civPilot.test.ts, bindings.ts [targeted]).
**Pattern extraction date:** 2026-06-06
