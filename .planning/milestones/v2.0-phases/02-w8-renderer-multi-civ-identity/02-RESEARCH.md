# Phase 2: W8 — Renderer Multi-Civ Identity - Research

**Researched:** 2026-06-06
**Domain:** Phaser 4 2D renderer (sprite tinting, Graphics overlays, camera framing) inside a Tauri/React/TS app
**Confidence:** HIGH (codebase is the primary source; Phaser API verified against official v4 migration guide)

## Summary

This phase is **frontend-only** and almost entirely contained in one file:
`tauri-app/src/components/civilization/CivilizationGameCanvas.tsx` (3215 lines, a `Phaser.Scene`
subclass `CivPhaserScene` plus a thin React wrapper). The data model needed already landed in
Phase 1: `snapshot.civs[]` carry `id`/`color` (hex string like `#6dd6a7`)/`alive`/`spawn_x`/`home_region`;
entities carry `civ_id` (nullable — null = wild fauna); regions carry `owner` (nullable civ id).
`civStore.normalizeCiv` guarantees every civ has a `color` (default `#6dd6a7`) and `alive` (default true).
`[VERIFIED: tauri-app/src/bindings.ts:258-453, civStore.ts:121-142]`

The scene already has all the rendering primitives this phase needs — it is **not** missing
capability, it is missing **multi-civ generalization**. Tinting infra exists (`setTint` at lines
714/971/980); region fills exist (the per-biome `BIOME_WASH` translucent fill in `bakeTerrain`,
lines 683-688, and the minimap region fill at 1648-1653); camera fit/zoom exists (`onResize`
fit logic 2957-2964 and `window.civCamera` bridge 2917-2945). The scene is **single-colony-centric**:
`this.colony = {x,y}` (line 433) is a single point computed by `recomputeColony()` (2968-2983)
from the first pond/nest, and the camera frames/recenters on that one point. The work is to
(a) tint per-civ instead of per-morph-only, (b) tint regions by `owner`, (c) generalize
`this.colony` (one point) into a colonies list with a bounding box, and (d) add `focusCiv` to
`window.civCamera`. `[VERIFIED: CivilizationGameCanvas.tsx]`

**Critical Phaser-4 finding:** This project pins `phaser@^4.1.0` (latest is also 4.1.0 — current).
Phaser 4 **removed `setTintFill()`** and split tint color from tint *mode*. The existing code only
uses multiply-tint (`setTint(color)`), which is unchanged in v4, so existing call sites are safe.
But any new code that wants a *solid fill* tint (e.g. flat-greying a dead civ) must use
`sprite.setTint(color).setTintMode(Phaser.TintModes.FILL)` — **not** `setTintFill`.
`[VERIFIED: github.com/phaserjs/phaser v4.0 MIGRATION-GUIDE; npm view phaser version → 4.1.0]`

**Primary recommendation:** Extend, do not rewrite. Add (1) a `civColorById: Map<string,number>`
rebuilt once per snapshot from `snapshot.civs`, (2) apply it as a *multiply* tint on axolotl bodies
and building images keyed by `entity.civ_id` (only when civ/morph changes — store the last-applied
civ on the sprite to avoid per-frame re-tint), (3) a translucent per-`owner` region overlay drawn
in the existing `wash` Graphics pass, (4) a `colonies[]` list + `colonyBounds()` helper that
generalizes `recomputeColony`, feeding a `frameAll()` and `focusCiv(civId)` exposed additively on
`window.civCamera`. Extract the pure pieces (hex→number, civ-color map build, bounding-box math,
focusCiv target resolution) as exported functions so they are vitest-testable without Phaser.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-civ sprite tint (axolotls/buildings) | Browser / Client (Phaser scene) | — | Pure visual; civ color already in snapshot from backend. No backend change. |
| Territory/region color overlay | Browser / Client (Phaser Graphics) | — | `region.owner` already in snapshot; overlay is a render-only fill. |
| civ_id → color resolution | Browser / Client (pure TS helper) | Frontend store | Color assigned at founding by backend (`CIV_COLORS`), normalized in `civStore`, consumed by renderer. |
| Multi-colony bounding box + camera fit | Browser / Client (Phaser camera) | — | Camera is a pure client concern; positions come from snapshot entities/regions. |
| `focusCiv` / `frame all` bridge | Browser / Client (`window.civCamera`) | UI (leaderboard click → `selectedCivId`) | Selection state already store-owned (Phase 1); this phase wires it to the camera. |
| Score/alive/color data | API / Backend (already done Phase 1) | — | Backend founds civs with colors and tracks `alive`; this phase only reads. |

**No backend (`src-tauri`) change is required for this phase.** All inputs exist in the snapshot.
`tauriBrowserFallback.ts` mirrors single-player *mechanics*, not rendering — **no mirror needed**
(verify in planning, but the renderer is canvas-only and reads the same snapshot regardless of source).
`[VERIFIED: CONTEXT.md code_context; bindings.ts data model]`

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| phaser | 4.1.0 (pinned `^4.1.0`) | 2D WebGL renderer / scene / camera / tint | Already the renderer; do not introduce another. `[VERIFIED: package.json; npm view phaser version → 4.1.0]` |
| react | (existing) | Host component lifecycle for the scene | Wrapper pattern already established (`CivilizationGameCanvas`). |
| zustand (`civStore`) | (existing) | Source of truth for `selectedCivId` | Phase 1 added `selectedCivId`/`setSelectedCivId`; reuse it. `[VERIFIED: civStore.ts:23,225,257]` |

### Supporting (testing)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 4.1.5 | Unit test runner (jsdom env) | Pure-helper tests (color map, bbox, focus target). `[VERIFIED: package.json, vitest.config.ts]` |
| @testing-library/react | 16.3.2 | Render `CivilizationView` for integration | Existing pattern; canvas is mocked out. `[VERIFIED: CivilizationView.test.tsx:2,29-31]` |
| jsdom | 29.1.1 | DOM env for vitest | Phaser must be mocked (its ESM init touches a real canvas and crashes jsdom). `[VERIFIED: civPilot.test.ts:5-9]` |

**No new dependencies.** This phase adds zero packages.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `setTint` multiply on existing sprites | Per-civ tinted texture atlases / shaders | Massively more complex; multiply-tint already preserves morph detail (it multiplies texture pixels by the color). Not worth it. |
| `Graphics.fillRect` region overlay | `TileSprite` per region | TileSprite adds GameObjects + memory; a single `Graphics` pass (already used for `wash`) is cheaper and matches the existing pattern. |
| Generalizing `this.colony` to `colonies[]` | New camera-controller class | Over-engineering for ≤3 colonies; keep it as scene methods. |

## Architecture Patterns

### System Architecture Diagram (data flow for this phase)

```
                snapshot (CivSessionSnapshot, normalized by civStore)
                 |          |              |
        civs[] (id,color,   entities[]     world.regions[] (owner)
        alive,spawn_x)      (civ_id, x,y)        |
                 |                |              |
                 v                |              |
   [build civColorById: Map<id,number>] (once per setSnapshot)
                 |                |              |
       +---------+----------+     |              |
       |                    |     |              |
       v                    v     v              v
  TINT axolotl bodies   TINT building     REGION OVERLAY (Graphics fill+border
  (syncEntities/         images            per owner color, in the wash pass)
   updateAxo: apply       (drawBuildings:
   civ tint when          tint img by
   civ_id changes;        entity.civ_id)
   grey if civ dead)
                 \                              /
                  \                            /
                   v                          v
            ----------- CAMERA (cameras.main) -----------
            colonies[] = living civs' home points
            colonyBounds() -> Rect over all colonies
                 |                         |
          frameAll() (default)      focusCiv(civId): pan+zoom
                 |                         ^
                 |                         | (leaderboard row click ->
                 v                         |  setSelectedCivId ->
          window.civCamera = {  ...existing,  focusCiv: ... }  <-- additive
                                                |
                          CivilizationView reads selectedCivId,
                          calls window.civCamera.focusCiv(id)
```

The diagram traces the primary use case: a snapshot arrives → a `civ_id→color` map is built once →
entities/buildings/regions are tinted by their civ → the camera frames all living colonies, and a
leaderboard click focuses one. File mapping is in the Component Responsibilities table below.

### Component Responsibilities (where each change lands)

| Concern | File / Method | Current behavior | This-phase change |
|---------|---------------|------------------|-------------------|
| Snapshot apply | `setSnapshot()` (522-534) | rebuilds world, syncs entities, recomputes single colony | also rebuild `civColorById`; recompute `colonies[]`; re-frame on world create/load + on collapse |
| Axolotl create | `createAxo()` (945-1009) | sets morph glow tint (971), placeholder tint (980) | apply civ multiply-tint to `body`; store `axo.civId` (extend `AxoSprite` type, 324-347) |
| Axolotl update | `updateAxo()` (1011-1032) | updates home/activity/size | re-tint only if `entity.civ_id` changed since last apply, or if civ `alive` flipped → grey |
| Buildings | `drawBuildings()` (747-780) | rebuilds layer on signature change | include `civ_id` in the building signature; `img.setTint(civColor)` per building |
| Region overlay | `bakeTerrain()` wash pass (682-688) | translucent per-*biome* fill | add a per-*owner* fill + border layer (new Graphics or extend `wash`); neutral when `owner == null` |
| Minimap regions | `drawMinimap()` (1648-1653) | per-biome fill | optionally tint owned regions by civ color (in-scope "basic tint"; deeper redesign deferred) |
| Single colony | `this.colony` (433), `recomputeColony()` (2968-2983) | one point from first pond/nest | keep `this.colony` (player-follow fallback) **and** add `colonies: {civId,x,y,alive}[]` |
| Camera fit | `onResize()` (2957-2964) | fits to world, centers on `this.colony` | when `!framed`, fit to `colonyBounds()` over living colonies |
| Camera bridge | `installCameraApi()` / `window.civCamera` (2917-2945) | zoomBy/recenter/toggleFollow/focusRegion | **add** `focusCiv(civId)` and `frameAll()` additively; keep all four existing methods |
| Bridge typedef | `declare global Window.civCamera` (12-17) | 4 methods | add optional `focusCiv?`/`frameAll?` (mirror in `CivilizationView.tsx` Window decl, line 62) |
| selectedCivId → camera | `CivilizationView.tsx` (200, 294) | reads selectedCivId for observer/log | `useEffect([selectedCivId])` → `window.civCamera?.focusCiv(selectedCivId)` |
| Pass selection to scene (optional) | `CivilizationGameCanvas` props (236-269) | no selectedCivId prop | optional: add `selectedCivId` prop + `useEffect` → `scene.setSelectedCiv(id)` for greying/dim-non-focused |

### Pattern 1: Build the civ→color map once per snapshot
**What:** Resolve hex strings to Phaser numbers once when the snapshot changes, not per sprite per frame.
**When:** In `setSnapshot()` (and `create()`), before `syncEntities()`.
**Example:**
```typescript
// hex "#6dd6a7" | "6dd6a7" -> 0x6dd6a7 ; tolerant of the store default.
// Phaser also offers Phaser.Display.Color.HexStringToColor(hex).color, but a
// pure helper is trivial and unit-testable without importing Phaser.
export function hexToTint(hex: string | null | undefined): number {
  if (!hex) return 0xffffff;
  const h = hex.replace(/^#/, "");
  const n = Number.parseInt(h.length === 3
    ? h.split("").map((c) => c + c).join("")
    : h, 16);
  return Number.isFinite(n) ? n : 0xffffff;
}

export function buildCivColorMap(
  civs: { id?: string; color?: string; alive?: boolean }[] | undefined,
): Map<string, { tint: number; alive: boolean }> {
  const m = new Map<string, { tint: number; alive: boolean }>();
  for (const c of civs ?? []) {
    if (!c.id) continue;
    m.set(c.id, { tint: hexToTint(c.color), alive: c.alive !== false });
  }
  return m;
}
```
**Source:** pattern derived from existing `shade()` helper (3089-3094) and `civStore.normalizeCiv` color default `#6dd6a7` (127). `[VERIFIED]`

### Pattern 2: Multiply tint preserves morph/GFP legibility
**What:** `setTint(color)` (default MULTIPLY mode) multiplies texture pixels by the color, so the
sprite's internal shading/morph pattern still reads. This satisfies the CONTEXT requirement that
civ tint be the *primary* cue without washing out morph/GFP detail. A subtle approach: apply a
*lightened* civ color (e.g. blend the civ color toward white ~50-65%) so the multiply doesn't
darken sprites too much — this is the "exact blend ratio is Claude's discretion" lever.
**When to use:** axolotl bodies and building images.
**Anti-pattern:** `setTintFill` / FILL mode on living sprites — it replaces ALL pixels with the
flat color and destroys morph detail. Reserve FILL only for the "dead civ, fully greyed" case if a
hard flat grey is wanted; otherwise grey via a desaturated multiply tint + reduced alpha.
**Example:**
```typescript
// Living civ: multiply-tint (keeps detail). Phaser 4: MULTIPLY is the default mode.
body.setTint(civTint);                       // e.g. lightened civ color
// Dead/collapsed civ: desaturate. Option A (keeps shape, reads "ghosted"):
body.setTint(0x888888); body.setAlpha(0.5);
// Option B (hard flat grey) — Phaser 4 API (NOT setTintFill, which was removed):
// body.setTint(0x6b6b6b).setTintMode(Phaser.TintModes.FILL);
```
**Source:** `[VERIFIED: Phaser docs — setTint multiplies, default MULTIPLY mode; v4 MIGRATION-GUIDE — setTintFill removed, use setTint().setTintMode(Phaser.TintModes.FILL)]`

### Pattern 3: Re-tint only on change (performance)
**What:** Tinting is a cheap GPU operation but calling it for every sprite every frame is wasteful
and the scene runs `step()` per frame over all axos. Store the last-applied civ id (and alive flag)
on each `AxoSprite`; re-apply tint only in `createAxo` (new) and in `updateAxo` when `entity.civ_id`
or the civ's `alive` flag changed.
**When:** Always — this is the CONTEXT decision "set tint only when an entity's civ changes or on (re)creation."
**Example:**
```typescript
// in updateAxo:
const civ = entity.civ_id ?? "";
const info = this.civColorById.get(civ);
const wantTint = info ? (info.alive ? info.tint : GREY_TINT) : 0xffffff;
if (axo.appliedTint !== wantTint) {
  axo.body.setTint(wantTint);
  axo.appliedTint = wantTint;
}
```
**Source:** CONTEXT performance decision + existing diff-on-signature patterns (`prevBuildingSig` 754, `prevResourceSig` 726). `[VERIFIED: CivilizationGameCanvas.tsx]`

### Pattern 4: Multi-colony bounding box + camera fit
**What:** Generalize `recomputeColony` (which picks ONE point) into `colonies[]` (one point per
living civ, from its home region or its entities' centroid), then compute a `Phaser.Geom.Rectangle`
over all living colonies and fit the camera. Phaser camera methods are stable across v3→v4 here:
`setBounds`, `setZoom`, `centerOn`, `pan`, `zoomTo`, `getWorldPoint`. `[VERIFIED: Phaser v4 Camera docs]`
**When:** default framing on world create/load and on civ collapse; the `frameAll()` reset.
**Example:**
```typescript
// pure, unit-testable: returns world-pixel rect (or null if no colonies)
export function colonyBounds(
  colonies: { x: number; y: number; alive: boolean }[],
  pad: number,
): { x: number; y: number; w: number; h: number } | null {
  const live = colonies.filter((c) => c.alive);
  if (live.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of live) {
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
  }
  return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
}

// in the scene (impure — uses cameras.main): fit zoom so the rect fits the viewport
private frameAll() {
  const b = colonyBounds(this.colonies, 6 * TILE_SIZE);
  const cam = this.cameras.main;
  const cw = this.scale.width, ch = this.scale.height;
  if (!b) { cam.centerOn(this.colony.x, this.colony.y); return; }   // fallback
  const fit = Math.min(cw / b.w, ch / b.h);
  this.following = false;
  cam.zoomTo(Phaser.Math.Clamp(fit, this.minZoom, this.maxZoom), 420, Phaser.Math.Easing.Sine.Out);
  cam.pan(b.x + b.w / 2, b.y + b.h / 2, 420, Phaser.Math.Easing.Sine.Out);
}
```
**Source:** generalizes `onResize` fit (2957-2964) + `focusRegion` zoom math (2935-2943). `[VERIFIED]`

### Pattern 5: focusCiv(civId) + additive bridge
**What:** Resolve a civ's home point (home region center, else its entities' centroid, else
`spawn_x`), pan+zoom there. Expose `focusCiv` and `frameAll` on `window.civCamera` without removing
the existing four methods (ARENA-02 / Phase 1 extend-only contract).
**Example:**
```typescript
// pure target resolution (unit-testable):
export function focusTarget(
  civId: string,
  civs: { id?: string; spawn_x?: number; home_region?: string }[],
  regions: { id: string; x: number; width: number; height?: number; owner?: string | null }[],
  entities: { civ_id?: string | null; x: number; y: number }[],
): { tx: number; ty: number } | null { /* prefer owned/home region center; else centroid; else spawn_x */ }

// installCameraApi() — ADD to the existing object literal, don't replace it:
window.civCamera = {
  zoomBy: ..., recenter: ..., toggleFollow: ..., focusRegion: ...,   // existing, unchanged
  focusCiv: (civId: string) => { /* resolve target, pan+zoom */ },   // NEW
  frameAll: () => this.frameAll(),                                    // NEW
};
```
**Wiring:** `CivilizationView.tsx` already reads `selectedCivId` (line 200). Add a `useEffect` that
calls `window.civCamera?.focusCiv(selectedCivId)` when it changes (null → `frameAll()`).
**Source:** `installCameraApi` (2917-2945), `CivilizationView.tsx` selectedCivId (200, 294). `[VERIFIED]`

### Anti-Patterns to Avoid
- **Replacing the `window.civCamera` object instead of extending it** — breaks `zoomBy`/`recenter`/`focusRegion` already used by the camera buttons (`CivilizationView.tsx:1313-1319, 2051`). Add keys; never remove. `[VERIFIED]`
- **`setTintFill` / `tintFill`** — removed in Phaser 4. Use `setTint(c).setTintMode(Phaser.TintModes.FILL)` only if a hard fill is truly needed. `[VERIFIED: v4 MIGRATION-GUIDE]`
- **Re-tinting every sprite every frame** — explicitly forbidden by CONTEXT performance decision.
- **Tinting a `Container`** — the axolotl is a `Container` holding a `body` (+glow+accessories). Tint the `body` Sprite/Image, not the container; the morph glow sprite already has its own tint (971) and should keep it (it's a morph cue, layered under the civ identity). Decide in planning whether civ tint goes on body only (recommended) or also tints accessories.
- **Hand-editing `bindings.ts`** — auto-generated; this phase needs **no** binding change (no IPC surface change), so this risk doesn't even arise. `[VERIFIED: CLAUDE.md gotcha 1]`

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hex string → color int | Custom 24-bit parser everywhere | One shared `hexToTint` helper (or `Phaser.Display.Color.HexStringToColor`) | One tested function; store already emits `#rrggbb`. |
| Sprite recoloring | Per-civ texture atlases / canvas recolor | `setTint()` (multiply) | GPU multiply preserves morph detail, zero memory cost. |
| Smooth camera move | Manual lerp in `step()` | `cam.pan()` / `cam.zoomTo()` with easing | Built-in pan/zoom effects; `step()` already checks `cam.panEffect.isRunning` (1085). |
| Zoom-to-fit math | Reinvent | Reuse `onResize` fit ratio + `focusRegion` zoom clamp | Already proven in this file; just feed it a multi-colony rect. |
| Color desaturate (dead civ) | Color-space conversion | A constant grey multiply tint + alpha, or FILL mode | Simple, reads as "ghosted"; full HSL desaturation is overkill. |

**Key insight:** Every primitive this phase needs already exists in the file for the single-colony
case. The work is *plumbing the civ dimension through* existing render passes, not new rendering tech.

## Common Pitfalls

### Pitfall 1: Phaser 4 tint-mode split
**What goes wrong:** Copying a Phaser 3 `setTintFill(color)` snippet — it doesn't exist in v4 and
will throw / type-error.
**Why:** Phaser 4 split tint color (`setTint`) from tint mode (`setTintMode`). `setTintFill`/`tintFill` removed.
**How to avoid:** For living civs use `setTint(color)` (MULTIPLY default — unchanged). For a hard flat
grey use `setTint(grey).setTintMode(Phaser.TintModes.FILL)`. `[VERIFIED: v4 MIGRATION-GUIDE]`
**Warning signs:** `tsc` error on `setTintFill`; a sprite turns a flat block of color (FILL applied where MULTIPLY intended).

### Pitfall 2: Container vs body tinting
**What goes wrong:** Calling `setTint` on `axo.container` (a `Container`) — tint applies to the
container's children inconsistently, and you fight the existing morph-glow tint.
**Why:** The axolotl is a `Container` (949) with `body`, optional `glow` (already tinted, 971), and
accessory images. Civ tint belongs on `body`.
**How to avoid:** Tint `axo.body`; leave the morph `glow` tint as the secondary morph cue. Track `axo.appliedTint` to diff. `[VERIFIED: createAxo 945-1009]`
**Warning signs:** Accessories/glow visibly recolored, or double-tint making GFP morphs muddy.

### Pitfall 3: Re-framing fights the follow camera and manual pan
**What goes wrong:** Calling `frameAll()`/`focusCiv` while `this.following` is true or the user is
mid-drag re-centers under them.
**Why:** `step()` (1085-1088) actively scrolls toward the follow target each frame when
`this.following`; manual drag sets `this.following=false` (1701) and `dragging=true`.
**How to avoid:** `frameAll`/`focusCiv` should set `this.following=false` (like `focusRegion` 2936
does) and use `cam.pan`/`zoomTo` (which `step` already yields to via `cam.panEffect.isRunning`).
Don't re-frame every snapshot — only on world create/load (`framed=false`, the bake-sig change at
657) and on civ collapse. `[VERIFIED: step 1085, focusRegion 2936, rebuildWorld 657]`
**Warning signs:** Camera snaps back while the user pans; jitter during turn advances.

### Pitfall 4: civ_id null = wild fauna, not "civ 0"
**What goes wrong:** Tinting null-`civ_id` entities with a default civ color.
**Why:** `civ_id == null` means wild fauna / neutral (predators, prey, resource flora) per the
binding doc (321-324). They should keep their morph tint, **not** get a civ color.
**How to avoid:** Only apply civ tint when `civ_id` resolves to a known civ in `civColorById`;
otherwise `clearTint()` / leave default. Same for regions: `owner == null` → neutral (subtle grey
or no overlay), per CONTEXT. `[VERIFIED: bindings.ts:321-325, 449-453; CONTEXT decisions]`
**Warning signs:** Predators/prey tinted as if owned; unclaimed regions colored.

### Pitfall 5: Building layer rebuild drops tint on signature miss
**What goes wrong:** `drawBuildings` (747-780) early-returns if the building signature is unchanged
(`prevBuildingSig`, 754). If `civ_id` isn't in the signature, an ownership change (W6 future, but
defensive now) won't re-tint.
**How to avoid:** Include `entity.civ_id` in the building signature string (752) so an owner change
forces a redraw. `[VERIFIED: drawBuildings 750-755]`
**Warning signs:** A building keeps an old civ's color after a (future) ownership flip.

### Pitfall 6: Phaser crashes vitest unless mocked
**What goes wrong:** Importing anything from `CivilizationGameCanvas.tsx` into a test transitively
loads `phaser`, whose ESM init touches a real canvas and aborts the jsdom suite.
**Why:** Documented in Phase 1 (civPilot.test.ts) — required `vi.mock("phaser")`.
**How to avoid:** Put the new pure helpers (`hexToTint`, `buildCivColorMap`, `colonyBounds`,
`focusTarget`) where they can be imported **without** the scene, OR keep `vi.mock("phaser", …)` at
the top of any test file that imports from the canvas module. Component tests mock the whole canvas
(`vi.mock("./CivilizationGameCanvas")`). `[VERIFIED: civPilot.test.ts:5-9, CivilizationView.test.tsx:29-31]`
**Warning signs:** Whole suite fails with a canvas/getContext error on import.

## Code Examples

### Resolving and applying a civ tint in createAxo (multiply, detail-preserving)
```typescript
// in createAxo, after `body` is created (~line 982, before container.add or after):
const info = this.civColorById.get(entity.civ_id ?? "");
if (info) {
  const tint = info.alive ? lighten(info.tint, 0.4) : GREY_TINT; // lighten = blend toward white
  body.setTint(tint);
  axo.appliedTint = tint;          // requires new AxoSprite field
} // else: wild fauna — leave morph default tint untouched
```

### Region owner overlay (translucent fill + border, in the wash pass)
```typescript
// extend the existing region loop in bakeTerrain (683-688), or add a sibling Graphics layer:
for (const region of world.regions ?? []) {
  const info = region.owner ? this.civColorById.get(region.owner) : undefined;
  if (!info) continue;                 // unowned -> neutral (no civ overlay)
  const x = region.x * TILE_SIZE, w = region.width * TILE_SIZE;
  const top = SURFACE_ROWS * TILE_SIZE;
  this.territory?.fillStyle(info.tint, info.alive ? 0.14 : 0.06);   // alpha = Claude's discretion
  this.territory?.fillRect(x, top, w, this.worldH - top);
  this.territory?.lineStyle(2, info.tint, info.alive ? 0.6 : 0.25);
  this.territory?.strokeRect(x, top, w, this.worldH - top);
}
```
**Note:** Use a *separate* Graphics layer (`this.territory`) above `wash` so biome wash and civ
overlay compose, and so the camera/uiCam ignore-lists (483-489) can include it. `[VERIFIED: wash pass 682-688, ignore list 483-489]`

### Additive bridge (preserve existing four methods)
```typescript
private installCameraApi() {
  const scene = this;
  window.civCamera = {
    zoomBy: (f) => { const c = scene.cameras.main; scene.zoomAt(c.width/2, c.height/2, f); },
    recenter: () => { /* existing */ },
    toggleFollow: () => { /* existing */ },
    focusRegion: (rx, width) => { /* existing */ },
    focusCiv: (civId) => scene.focusCiv(civId),   // NEW
    frameAll: () => scene.frameAll(),             // NEW
  };
}
```

## Runtime State Inventory

> This phase is a renderer change (TS/Phaser only). It writes no persisted data, registers no
> OS state, and reads only the in-memory snapshot. The categories below are answered explicitly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — renderer reads `snapshot` in memory; persists nothing. Civ colors are already persisted by the backend (Phase 1 `CIV_COLORS`) and not changed here. | None |
| Live service config | None — no external services touched. | None |
| OS-registered state | None — no Task Scheduler / pm2 / launchd involvement. | None |
| Secrets/env vars | None — renderer reads no secrets. | None |
| Build artifacts | `tauri-app/src/bindings.ts` is auto-generated, but **no IPC surface change** is needed this phase, so no regeneration. The two `Window.civCamera` *type* declarations (`CivilizationGameCanvas.tsx:12-17` and `CivilizationView.tsx:62`) are hand-written and must both gain the new optional methods. | Update both Window typedefs by hand; do NOT regen bindings |

**Verified by:** reading the data model (bindings.ts), the snapshot flow (`setSnapshot` 522), and
CLAUDE.md gotchas. This is a pure read-and-render phase.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phaser 3 `setTintFill(color)` | `setTint(color).setTintMode(Phaser.TintModes.FILL)` | Phaser v4.0 | Any FILL-tint code must use the new two-call form; `setTintFill` removed. |
| Phaser 3 `setTint` silently set FILL mode in some overloads | v4 `setTint`/`tint` are pure color; mode is separate | Phaser v4.0 | The existing multiply `setTint` calls (714/971/980) are unaffected (MULTIPLY is default). |
| Single `this.colony` framing | Multi-colony bounding-box framing | This phase | Generalization, not a library change. |

**Deprecated/outdated:**
- `setTintFill` / `tintFill` property — **removed in Phaser 4**. `[VERIFIED: v4 MIGRATION-GUIDE]`
- Do not consult Phaser 3 (`newdocs.phaser.io/docs/3.x`) examples for tint *mode*; they're stale for v4. Multiply-tint and camera (`pan`/`zoomTo`/`centerOn`/`setBounds`) examples remain valid.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A lightened/multiply civ tint reads as identity while preserving morph detail at the game's sprite scale | Pattern 2 | If too subtle, colonies don't read; mitigated by it being "Claude's discretion" + manual visual check (REN-01). Tunable, low risk. |
| A2 | Each living civ has a resolvable home point (home region center, entities centroid, or spawn_x) for `focusCiv`/`frameAll` | Patterns 4-5 | If a civ has no region/entities/spawn_x, focus has no target; fallback to world center handles it. Low risk (founders always spawn entities + home_region). `[partially VERIFIED: civ.spawn_x/home_region exist in bindings.ts:271-273]` |
| A3 | `tauriBrowserFallback.ts` needs no renderer mirror (it duplicates mechanics, not rendering) | Architectural Map | If it has its own render path, a change could be missed; CONTEXT says "likely not." Confirm by grep in planning. Low risk. |
| A4 | ≤3 civs' worth of entities won't need new culling beyond what exists; existing off-screen handling (substrate "off-screen ones cost ~nothing", caustics view-culling 1102-1110) suffices | Performance | If frame collapse occurs, add per-axo viewport cull in `step`. CONTEXT only requires informal stability at 3 civs. Low risk. |

## Open Questions

1. **Civ tint on accessories/buildings: how strong?**
   - What we know: body tint is recommended; buildings are plain `Image`s (easy to tint).
   - What's unclear: whether accessories should also tint (they're morph/decoration, not civ).
   - Recommendation: tint body + buildings + territory; leave accessories and morph-glow untinted. Revisit only if colonies don't read. (Claude's discretion per CONTEXT.)

2. **Dim non-selected civs while focused?**
   - What we know: CONTEXT lists this as Claude's discretion.
   - What's unclear: whether it adds clarity or clutter.
   - Recommendation: implement `frameAll` + `focusCiv` first (the requirement); add optional dimming
     only if it demonstrably helps in manual review. Keep it cheap (a single alpha on non-focused civ layers, not per-sprite).

3. **Minimap multi-civ tint depth.**
   - What we know: "basic tint" is in scope; "minimap multi-civ redesign" is deferred.
   - Recommendation: tint owned minimap regions by civ color (one-line change at 1648-1653); stop there.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| phaser | the entire renderer | ✓ (installed) | 4.1.0 | — (already in use) |
| vitest | helper unit tests | ✓ | 4.1.5 | — |
| jsdom | vitest env | ✓ | 29.1.1 | — |
| @testing-library/react | component integration test | ✓ | 16.3.2 | — |
| WebView2 / GPU | actual rendering (manual UAT) | runtime-only | — | Manual visual verification on the dev machine; cannot be automated. |

**Missing dependencies with no fallback:** None — all packages are installed.
**Missing dependencies with fallback:** Actual GPU rendering is verifiable only by manual visual
inspection (Phaser renders to a real WebGL canvas; jsdom has no GPU). This is expected and matches
Phase 1's manual-only rendering items.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.5 (jsdom env, globals on) |
| Config file | `tauri-app/vitest.config.ts` |
| Quick run command | `cd tauri-app && npx vitest run <pattern>` (e.g. `civCanvas`) |
| Full suite command | `cd tauri-app && npm test` (alias for `vitest run`) |
| Type gate | `cd tauri-app && npx tsc --noEmit` |
| Backend | **N/A this phase** — no `src-tauri` change; no cargo step. |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REN-01 | `hexToTint("#6dd6a7")` → `0x6dd6a7`; tolerant of `#`, 3-digit, bad input → `0xffffff` | unit (pure) | `npx vitest run civCanvas` | ❌ Wave 0 |
| REN-01 | `buildCivColorMap(civs)` maps id→{tint,alive}; skips id-less; alive default true | unit (pure) | `npx vitest run civCanvas` | ❌ Wave 0 |
| REN-01 | `civ_id == null` (wild fauna) resolves to no civ tint (map miss) | unit (pure) | `npx vitest run civCanvas` | ❌ Wave 0 |
| REN-01 | region `owner == null` → no civ overlay (neutral) | unit (pure, via overlay-decision helper) | `npx vitest run civCanvas` | ❌ Wave 0 |
| REN-01 | dead civ (`alive:false`) → grey/desaturated tint chosen | unit (pure, tint-selection helper) | `npx vitest run civCanvas` | ❌ Wave 0 |
| REN-01 | per-civ tint visible on axolotls/buildings/territory; morph still legible | **manual visual** | run `npm run tauri dev`, create 3-civ world, inspect | manual-only |
| REN-02 | `colonyBounds(colonies, pad)` over living colonies → correct rect; null when none alive | unit (pure) | `npx vitest run civCanvas` | ❌ Wave 0 |
| REN-02 | `colonyBounds` excludes dead colonies (collapse re-frame) | unit (pure) | `npx vitest run civCanvas` | ❌ Wave 0 |
| REN-02 | `focusTarget(civId, civs, regions, entities)` → home-region center, else centroid, else spawn_x, else null | unit (pure) | `npx vitest run civCanvas` | ❌ Wave 0 |
| REN-02 | `window.civCamera` retains `zoomBy/recenter/toggleFollow/focusRegion` AND adds `focusCiv/frameAll` (contract) | integration (mocked scene) or component | `npx vitest run CivilizationView` | partial (extend existing) |
| REN-02 | leaderboard row click sets `selectedCivId` → `focusCiv` invoked | component (RTL, `window.civCamera` spied) | `npx vitest run CivilizationView` | extend existing |
| REN-02 | camera frames all colonies by default; focus pans+zooms; performance at 3 civs | **manual visual** | `npm run tauri dev`, 3-civ world, observe framing + click focus | manual-only |

### Sampling Rate
- **Per task commit:** `cd tauri-app && npx vitest run <pattern>` for the touched file (e.g. `civCanvas` or `CivilizationView`) + `npx tsc --noEmit`.
- **Per wave merge:** `cd tauri-app && npm test` (full vitest suite — currently 214 green; must stay green) + `npx tsc --noEmit` exit 0.
- **Phase gate:** Full vitest suite green + tsc 0 + manual visual UAT (3-civ world: tints distinguishable, morph legible, dead civ greyed, default frames all colonies, leaderboard-click focuses one, no frame collapse).

### Wave 0 Gaps
- [ ] `tauri-app/src/components/civilization/CivilizationGameCanvas.test.ts` (or `civCanvas.test.ts`) — covers REN-01/REN-02 **pure helpers**; must `vi.mock("phaser")` if it imports from the canvas module (Pitfall 6). Recommend exporting `hexToTint`/`buildCivColorMap`/`colonyBounds`/`focusTarget` from the canvas module (like `renderSnapshotToText` was exported in Phase 1).
- [ ] Extend `tauri-app/src/components/civilization/CivilizationView.test.tsx` — assert `window.civCamera.focusCiv` exists and is called on `selectedCivId` change / leaderboard click; assert the existing four bridge methods remain (additive contract, mirrors ARENA-02 back-compat tests).
- [ ] No new framework install — vitest/jsdom/RTL already present.

*(Decision for the planner: prefer extracting pure helpers as named exports so they're tested
without Phaser, exactly as Phase 1 did with `renderSnapshotToText` + `vi.mock("phaser")`.)*

## Security Domain

> `security_enforcement` not present in `.planning/config.json` (treated as enabled). This phase is a
> pure client-side renderer change with no new input parsing, no IPC surface change, no auth, no
> crypto, and no untrusted-data sink.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth touched. |
| V3 Session Management | no | No sessions touched (the "session" here is a game session, not a security session). |
| V4 Access Control | no | No access control surface. |
| V5 Input Validation | minimal | Civ `color` strings come from the backend palette / user-overridable chip (Phase 1). `hexToTint` must fail safe (bad/missing → `0xffffff`) rather than throw — a robustness control, not an injection vector (a hex string only becomes a numeric tint, never markup/SQL). |
| V6 Cryptography | no | No crypto. |

### Known Threat Patterns for {Phaser/React renderer}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed civ `color` → NaN tint / crash | Denial of Service (cosmetic) | `hexToTint` returns `0xffffff` on bad input; never `parseInt`-then-blind-use. |
| Untrusted text rendered as HTML | Tampering / XSS | **Not applicable to the canvas** — Phaser draws to WebGL, not the DOM. (Phase 1 already enforced escaped React text for log/reasoning in `CivilizationView`; this phase adds no new text sink.) |

**Net:** no meaningful security surface beyond making `hexToTint` total/fail-safe.

## Sources

### Primary (HIGH confidence)
- `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx` — scene structure, `this.colony`/`recomputeColony` (433, 2968-2983), `setTint` sites (714/971/980), camera (`setBounds` 650, `centerOn` 2905, `onResize` fit 2957-2964), `window.civCamera` (2917-2945), region wash (682-688), minimap regions (1648-1653), `setSnapshot` flow (522-534), `shade` (3089).
- `tauri-app/src/bindings.ts` — `CivCivilization` (258, color/alive/spawn_x/home_region), `CivEntity.civ_id` (312-325), `CivRegion.owner` (441-453), `CivSessionSnapshot` (480-506).
- `tauri-app/src/stores/civStore.ts` — `selectedCivId`/`setSelectedCivId` (23/225/257), `primaryCiv`/`normalizeCiv` color default (117-142).
- `tauri-app/src/components/civilization/CivilizationView.tsx` — `selectedCivId` consumer (200/294), camera-button bridge usage (1313-1319, 2051), Window decl (62).
- `tauri-app/package.json`, `vitest.config.ts` — phaser 4.1.0, vitest 4.1.5, jsdom 29.1.1, RTL 16.3.2, `test` = `vitest run`.
- Phase 1 summaries (`01-01..01-04-SUMMARY.md`) — what landed (multi-civ data, leaderboard, `vi.mock("phaser")` pattern, `renderSnapshotToText` export).
- `02-CONTEXT.md` — locked decisions (tinting, camera, performance) and discretion areas.

### Secondary (MEDIUM confidence, verified against official source)
- Phaser v4.0 MIGRATION-GUIDE (github.com/phaserjs/phaser, `changelog/v4/4.0/MIGRATION-GUIDE.md`) — `setTintFill` removed; `setTint().setTintMode(Phaser.TintModes.FILL)`; tint color vs mode split. Cross-checked with the official "Phaser 3 vs Phaser 4" news article and the Tint namespace docs.
- Phaser v4 Camera docs (docs.phaser.io/api-documentation/class/cameras-scene2d-camera) — `setBounds`/`setZoom`/`centerOn`/`pan`/`zoomTo`/`getWorldPoint` present and stable.
- `npm view phaser version` → `4.1.0` (installed range `^4.1.0` is current).

### Tertiary (LOW confidence)
- None relied upon. (No claim in this doc rests solely on an unverified web result.)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions read from package.json and confirmed current via npm.
- Architecture / where changes land: HIGH — every anchor read directly in the source file.
- Phaser 4 tint API: HIGH — confirmed against the official v4 migration guide (the one genuine v3→v4 gotcha).
- Camera API: HIGH — methods used by this phase are stable across v3→v4 and already used in-file.
- Pitfalls: HIGH (codebase-derived) except A1/A2/A4 visual/runtime assumptions, which are MEDIUM and mitigated by manual UAT + fallbacks.

**Research date:** 2026-06-06
**Valid until:** 2026-07-06 (stable — Phaser pinned, data model frozen by Phase 1; revisit only if Phaser is bumped past 4.1.x).
