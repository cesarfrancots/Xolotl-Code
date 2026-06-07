---
phase: 02-w8-renderer-multi-civ-identity
plan: 02
subsystem: ui
tags: [phaser, camera, react, vitest, multi-civ, renderer]
requires:
  - phase: 02-w8-renderer-multi-civ-identity (Plan 01)
    provides: civColorById build + pure-helper export pattern (hexToTint/buildCivColorMap/civTintFor/regionOverlayFor) + civCanvas.test.ts (vi.mock("phaser"))
  - phase: 01-w9-lite-multi-model-world-creation-leaderboard
    provides: selectedCivId/setSelectedCivId in civStore + leaderboard row -> setSelectedCivId wiring + ARENA-02 extend-only bridge contract
provides:
  - colonyBounds + focusTarget pure named exports (Phaser-free, unit-tested)
  - multi-colony camera framing (recomputeColonies + frameAll fitting a bounding box over all living colonies)
  - collapse re-frame (drops a dead civ when the living-civ count shrinks)
  - additive window.civCamera.focusCiv(civId) + frameAll() (four existing methods intact, ARENA-02)
  - both hand-written Window.civCamera typedefs extended (no bindings regen)
  - selectedCivId -> focusCiv / null -> frameAll wiring in CivilizationView
affects: [phase 3 renderer/camera work, any future ARENA harness consuming window.civCamera]
tech-stack:
  added: []
  patterns:
    - "Multi-colony camera fit via a pure colonyBounds() bbox + cam.zoomTo/pan built-in effects (no per-frame lerp)"
    - "Re-frame only on world create/load (framed flip) + collapse (prevLivingCount shrink), never per snapshot"
    - "Extend-only window.* bridge: add keys, keep the four existing methods; both ambient typedefs mirrored"
    - "Pure Phaser-free named exports tested under vi.mock(\"phaser\")"
key-files:
  created: []
  modified:
    - tauri-app/src/components/civilization/CivilizationGameCanvas.tsx
    - tauri-app/src/components/civilization/civCanvas.test.ts
    - tauri-app/src/components/civilization/CivilizationView.tsx
    - tauri-app/src/components/civilization/CivilizationView.test.tsx
key-decisions:
  - "focusTarget returns WORLD-TILE coords (caller multiplies by TILE_SIZE), mirroring focusRegion's (rx+width/2)*TILE_SIZE math; region centre y uses height/2, spawn_x fallback uses SURFACE_ROWS as a sensible surface y"
  - "Re-frame gated on prevLivingCount scene field (collapse) + framed flip (create/load) — NOT every snapshot (Pitfall 3)"
  - "Component additive-bridge test installs a six-method spy window.civCamera (canvas is mocked, so the real scene does not install it) and asserts the View's useEffect drives focusCiv/frameAll"
  - "Skipped the optional dim-non-selected-civs discretion item (Open Question 2) — frameAll + focusCiv satisfy REN-02 without it"
requirements-completed: [REN-02]
duration: 8 min
completed: 2026-06-07
---

# Phase 2 Plan 02: Frame the Multi-Civ World Summary

**Multi-colony camera framing (bounding box over all living civs) with an additive `window.civCamera.focusCiv`/`frameAll` bridge wired to `selectedCivId`, plus pure unit-tested `colonyBounds`/`focusTarget` helpers — REN-02.**

## Performance
- **Duration:** 8 min
- **Started:** 2026-06-07T04:04:02Z
- **Completed:** 2026-06-07T04:12:23Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 4

## Accomplishments
- Added two pure, Phaser-free named exports — `colonyBounds(colonies, pad)` (bbox over living colonies, excludes dead, null when none) and `focusTarget(civId, civs, regions, entities)` (home-region centre → entities centroid → spawn_x → null) — covered by 9 new `civCanvas.test.ts` rows under `vi.mock("phaser")`.
- Generalized the single-colony camera to multi-colony: `recomputeColonies()` builds one framing point per living civ, `frameAll()` fits the camera over the colony bounding box, the `onResize` `!framed` branch now fits `colonyBounds()` (single-colony fallback retained), and a collapse re-frame triggers when the living-civ count shrinks (`prevLivingCount` scene field).
- Added `focusCiv(civId)` (pan+zoom to one civ, falls back to `frameAll()` on an unresolvable civ) and `frameAll()` to `window.civCamera` **additively** — `zoomBy`/`recenter`/`toggleFollow`/`focusRegion` remain (ARENA-02 extend-only). Both hand-written `Window.civCamera` typedefs extended; no `bindings.ts` regen.
- Wired `selectedCivId` → camera in `CivilizationView` via a `useEffect([selectedCivId])` (selected → `focusCiv`, null → `frameAll`); a Phase 1 leaderboard row click flows through it. Extended `CivilizationView.test.tsx` with the six-method additive-bridge contract + selectedCivId/leaderboard-click focus assertions.

## Task Commits
1. **Task 1: Pure camera helpers (colonyBounds, focusTarget) + civCanvas.test.ts extension** - `1d9db10` (feat, TDD: RED verified then GREEN)
2. **Task 2: Multi-colony framing + additive focusCiv/frameAll bridge + both typedefs + selectedCivId wiring + component test** - `fbe6d0d` (feat, TDD)

**Plan metadata:** committed as `docs(02): complete plan 02-02`

## Files Created/Modified
- `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx` - Added `colonyBounds`/`focusTarget` pure exports; `private colonies`/`prevLivingCount` state; `recomputeColonies`/`frameAll`/`focusCiv` scene methods; generalized `onResize` `!framed` fit; additive `focusCiv`/`frameAll` bridge keys; extended Window.civCamera typedef.
- `tauri-app/src/components/civilization/civCanvas.test.ts` - Imported `colonyBounds`/`focusTarget`; added 9 unit rows (rect math, pad inflation, dead-colony exclusion, null-when-none, focus precedence home→centroid→spawn_x→null, unknown-civ null).
- `tauri-app/src/components/civilization/CivilizationView.tsx` - Mirrored Window.civCamera typedef extension; added `useEffect([selectedCivId])` driving `focusCiv`/`frameAll`.
- `tauri-app/src/components/civilization/CivilizationView.test.tsx` - Added the six-method additive-bridge contract test + selectedCivId-change and leaderboard-click → `focusCiv` / null → `frameAll` assertions (spy `window.civCamera`).

## Decisions & Deviations

**Decisions:**
- `focusTarget` returns world-TILE coordinates; callers (`focusCiv`, `recomputeColonies`) multiply by `TILE_SIZE`, consistent with `focusRegion`'s `(rx + width/2) * TILE_SIZE`. Region centre y uses `height/2`; the spawn_x fallback uses `SURFACE_ROWS` as a sensible surface y.
- Re-frame is gated to world create/load (`framed` flip) and civ collapse (`prevLivingCount` shrink), never per snapshot, per Pitfall 3.
- The additive-bridge component test installs a spy `window.civCamera` (the canvas is mocked in component tests, so the real scene never installs the bridge there) and asserts the View's `useEffect` drives `focusCiv`/`frameAll`.
- Skipped the optional "dim non-selected civs while focused" discretion item (Research Open Question 2) — `frameAll` + `focusCiv` satisfy REN-02 without it.

**Deviations from Plan:** None - plan executed exactly as written.

## Verification Results
- `npx tsc --noEmit` → exit 0 (clean).
- `npx vitest run civCanvas` → 27 passed (18 existing + 9 new).
- `npx vitest run CivilizationView` → 17 passed (14 existing + 3 new).
- Full `npm test` → 244 passed across 26 files (baseline 232; +12, no regressions).
- Additive contract (ARENA-02): all six `window.civCamera` methods present; the four existing methods unchanged.
- `git diff --name-only` does NOT list `tauri-app/src/bindings.ts` (only the two hand-written typedefs changed).
- Manual UAT (3-civ world default-frames-all + leaderboard-click focus + smooth interaction) is GPU-only and deferred to the Phase 2 manual gate (cannot be automated under jsdom).

## Issues Encountered
None.

## Next Phase Readiness
- REN-02 complete; this was the final plan of Phase 2 (W8 — Renderer Multi-Civ Identity). All automated gates green.
- One outstanding non-blocker: the GPU-only manual visual UAT for the phase (per-civ tint legibility from Plan 01 + default-frame-all / leaderboard-focus / no-frame-collapse from this plan) should be run on the dev machine via `npm run tauri dev` with a 3-civ world before the phase is declared visually verified.

## Self-Check: PASSED
- SUMMARY.md exists on disk.
- Both task commits present in git log (`1d9db10`, `fbe6d0d`).
- All four modified files exist on disk.
- All plan-level verification commands re-run green (tsc 0; civCanvas 27; CivilizationView 17; full suite 244).

---
*Phase: 02-w8-renderer-multi-civ-identity*
*Completed: 2026-06-07*
