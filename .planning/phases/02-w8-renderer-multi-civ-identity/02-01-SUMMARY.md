---
phase: 02-w8-renderer-multi-civ-identity
plan: 01
subsystem: renderer
tags: [phaser4, tint, civ-identity, react, typescript, vitest]
provides:
  - "Pure Phaser-free tint helpers as named exports: hexToTint, buildCivColorMap, civTintFor, regionOverlayFor"
  - "civColorById map built once per snapshot in setSnapshot"
  - "Per-civ multiply-tint on axolotl bodies (appliedTint diff) and building images"
  - "Per-owner translucent territory overlay (new this.territory Graphics layer) + owned minimap region tint"
  - "Dead/collapsed civs greyed; wild fauna (null civ_id) and unowned regions stay neutral"
affects: [02-02 camera framing/focus (REN-02), W8 renderer]
requirements-completed: [REN-01]
tech-stack:
  added: []
  patterns:
    - "Pure helper + vi.mock(\"phaser\") unit test (mirrors Phase 1 renderSnapshotToText/civPilot.test.ts)"
    - "Diff-on-applied-value (appliedTint) to re-tint only on civ change / creation"
    - "Phaser 4 tint: setTint(color) multiply for living civs; GREY_TINT for dead; never setTintFill"
    - "Sibling Graphics overlay layer registered in the uiCam ignore-list"
key-files:
  created:
    - tauri-app/src/components/civilization/civCanvas.test.ts
  modified:
    - tauri-app/src/components/civilization/CivilizationGameCanvas.tsx
key-decisions:
  - "civ tint lightened 50% toward white (lighten()) so multiply preserves morph/GFP legibility"
  - "GREY_TINT = 0x888888 as civTintFor's default grey param so Task 1 stays tsc-clean before Task 2 consumes it"
  - "Territory overlay alphas: living fill 0.14 / border 0.6, dead fill 0.06 / border 0.25"
  - "New this.territory Graphics at depth -10.5 (above wash -11, below depthGrad -10); added to uiCam ignore-list"
duration: 8 min
completed: 2026-06-06
---

# Phase 2 Plan 01: Renderer Multi-Civ Identity (Per-Civ Tint) Summary

**REN-01 identity layer: every living civ's axolotls, buildings, and owned territory render multiply-tinted by that civ's color (morph/GFP detail preserved), wild fauna and unowned regions stay neutral, and dead civs grey — driven by four pure, fail-safe, unit-tested tint helpers and a per-snapshot civColorById map.**

## Performance
- **Duration:** ~8 min
- **Tasks:** 2 of 2 completed
- **Files modified:** 1 modified, 1 created

## Accomplishments
- Extracted four PURE, Phaser-free named exports from `CivilizationGameCanvas.tsx` (mirroring Phase 1's `renderSnapshotToText`): `hexToTint`, `buildCivColorMap`, `civTintFor`, `regionOverlayFor`, plus a `lighten()` helper and `GREY_TINT` constant.
- `hexToTint` is total/fail-safe (T-02-01): tolerant of leading `#` and 3-digit shorthand; missing/garbage/non-finite input returns `0xffffff`, never throws, never NaN — a color string only ever becomes a number.
- New `civCanvas.test.ts` with `vi.mock("phaser")` BEFORE the canvas import (Pitfall 6) — 18 unit assertions covering all REN-01 unit rows (hex tolerance + bad-input fallback, map build/skip/alive-default, dead-civ grey, map-miss → no tint, owner-null/unknown → no overlay).
- Built `civColorById` once per snapshot in `setSnapshot` BEFORE `syncEntities()`.
- Tinted axolotl bodies (via `applyCivTint` with `appliedTint` diff — re-applies only on change), building images (with `civ_id` added to the redraw signature), a new per-owner `this.territory` overlay (fill + border), and owned minimap regions — all keyed by `civColorById`.
- Wild fauna (`civ_id == null` → map miss) keeps its morph default; unowned regions (`owner == null`) get no overlay; dead civs render grey with reduced overlay alpha.
- Phaser 4 compliance: only `setTint(color)` (multiply) for living + `GREY_TINT` for dead; `grep -rn "setTintFill" tauri-app/src` returns 0.

## Task Commits
1. **Task 1 (RED): failing civ-tint helper unit suite** - `181c0e3`
2. **Task 1 (GREEN): pure civ-tint helpers as named exports** - `ec8967a`
3. **Task 2: apply per-civ tints across render passes** - `00a2fb6`

## Files Created/Modified
- `tauri-app/src/components/civilization/civCanvas.test.ts` (created) - vitest unit suite for the four pure helpers under `vi.mock("phaser")`; 18 assertions for the REN-01 unit rows.
- `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx` (modified) - added the four named-export helpers + `lighten`/`GREY_TINT` next to `shade()`; `civColorById` field + build in `setSnapshot`; `appliedTint` on `AxoSprite` + `applyCivTint()`; building tint + `civ_id` signature; new `this.territory` overlay layer (field, creation at depth -10.5, uiCam ignore-list, per-owner pass in `bakeTerrain`); minimap owner tint.

## Verification Results
- `npx tsc --noEmit` → exit 0
- `npx vitest run civCanvas` → 18 passed (1 file)
- `npm test` (full suite) → 232 passed across 26 files (baseline was 214/25; +18 new tests, +1 new file, no regressions)
- `grep -rn "setTintFill" tauri-app/src` → 0 matches (Phaser 4 compliant)
- `git diff --name-only` does NOT list `tauri-app/src/bindings.ts` (no IPC change; bindings untouched)
- Manual GPU UAT (3-civ world: tints distinguishable, morph legible, collapse → grey) deferred to the phase gate (jsdom has no GPU) per the validation strategy.

## Decisions & Deviations

### Decisions
- **Lighten ratio 0.5:** `civTintFor` blends a living civ's tint 50% toward white via `lighten()` so the multiply keeps morph/GFP detail readable (CONTEXT "blend ratio is Claude's discretion").
- **`GREY_TINT` as `civTintFor`'s default param:** Task 1 declares `GREY_TINT` (consumed in Task 2). To keep Task 1's `tsc --noEmit` clean (no unused-symbol error) without leaving dead code, `GREY_TINT` is the default value of `civTintFor(info, grey = GREY_TINT)`; the unit tests still pass an explicit `GREY` arg.
- **Overlay alphas (Claude's discretion):** living regions fill 0.14 / border 0.6; dead-owner regions fill 0.06 / border 0.25.
- **Territory layer depth -10.5:** placed above `wash` (-11) and below `depthGrad` (-10) so biome wash and civ overlay compose; added to the `uiCam` ignore-list exactly like `wash`.

### Deviations from Plan
None - plan executed exactly as written. (The `GREY_TINT` default-param choice above is a minor within-spec implementation detail, not a scope/behavior deviation: the plan said "Define a module-scope `const GREY_TINT`" and "Exact ... is Claude's discretion".)

**Total deviations:** 0. **Impact:** none — all acceptance criteria and verification gates pass.

## Next Phase Readiness
Ready for **02-02** (REN-02 camera framing/focus). That plan builds on the same `civColorById` / multi-civ data already plumbed here; the per-civ identity layer is complete and green. The only outstanding REN-01 item is the manual GPU visual UAT, which is intentionally deferred to the phase gate (jsdom cannot render WebGL).

## Self-Check: PASSED
- `tauri-app/src/components/civilization/civCanvas.test.ts` exists on disk ✓
- `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx` modified on disk ✓
- Commits `181c0e3`, `ec8967a`, `00a2fb6` present in `git log` ✓
- tsc 0 · civCanvas 18 green · full suite 232 green · setTintFill 0 · bindings.ts untouched ✓
