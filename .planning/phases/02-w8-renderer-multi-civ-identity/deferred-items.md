# Deferred Items — Phase 02

Items surfaced during the W8 renderer code-review fix pass that are intentionally
NOT actioned now, with rationale (best-effort scope / surgical-changes rule).

## MED-04 (partial) — real-scene camera-bridge test + missed-focus retry

**Source:** `02-REVIEW.md` MED-04. Two coupled gaps were called out:

1. **No test exercises the real `installCameraApi`.** The View tests mock
   `CivilizationGameCanvas` to `() => null` and install their own six-method spy
   bridge, so the real scene's `window.civCamera` install (the ARENA-02
   regression risk — an accidental break of the four original methods, or
   `focusCiv`/`frameAll` failing to bind `this`) is never run under test.
   `civCanvas.test.ts` mocks Phaser entirely and only tests the pure exported
   helpers, so it can't cover the scene method either.

2. **Selection-before-scene-install is a silent no-op.** The View effect calls
   `window.civCamera?.focusCiv?.(...)`; because the Phaser scene's `create()`
   runs after React commit, `window.civCamera` may be undefined on the first
   selection, so that focus is dropped and never retried.

### What was done now (cheap, non-brittle)

- Added a View-level guard test ("does not throw when a civ is selected before
  the camera bridge installs") in `CivilizationView.test.tsx`. It pins the
  current contract: selecting a civ during the startup window is a silent no-op
  (optional-chaining), never a crash.

### What is deferred and why

- **Real-install test of the six camera methods.** Exercising the *real*
  `installCameraApi` requires either (a) exporting the private `CivPhaserScene`
  class purely for tests (broadens the production module's public surface), or
  (b) refactoring the camera-API object construction out of the scene into a
  standalone factory (a production restructure). Both also need a substantially
  fattened Phaser mock (`cameras.main` with `pan`/`zoomTo`/`centerOn`/`setZoom`/
  `zoom`/`width`/`height`, `Math.Clamp`, `Math.Easing`, `scale`, plus seeded
  `colonies`/`snapshot`/`colony`/`worldH`). The review explicitly flags this as
  the "disproportionate rework / brittle test" case and says to defer rather
  than force it. Deferred.

- **Missed-focus retry on scene readiness.** Fixing gap #2 properly (re-fire the
  focus effect when the scene signals readiness, or have the scene apply the
  current selection on install) requires plumbing a new scene-readiness signal
  (event or install callback) from the Phaser scene up into the React View — a
  cross-layer production change beyond a best-effort review fix. Deferred to a
  dedicated change.

**Recommendation:** Tackle both in one follow-up that introduces a
`civCameraReady` signal: the scene emits it on `installCameraApi`, the View
re-runs its focus effect on it (fixing #2), and a test can then assert the real
six-method install once the signal exists (fixing #1) without exporting the
scene class.

## ROADMAP SC#3 — chunked `RenderTexture` terrain (accepted re-scope, backlog)

**Source:** Phase 2 verification (`02-VERIFICATION.md`). The ROADMAP's Phase 2
success criterion #3 implementation note suggested replacing per-tile `Image`
baking (`bakeTerrain`) with chunked, worldView-culled `RenderTexture` terrain to
guarantee no perf collapse at ~36k+ tiles. CONTEXT.md (and RESEARCH assumption
A4) deliberately narrowed this to "informal stability at a 3-civ world, no FPS
instrumentation," and neither plan carried the chunking rewrite.

**Disposition: ACCEPTED re-scope (not a phase gap).** Civs are hard-capped at 1–3
(Phase 1 `resolve_participants`), so the world stays bounded; the per-tile
renderer is adequate at the milestone's actual scale. The chunked-terrain rewrite
is a pure performance optimization for a scale this milestone does not reach.

**Backlog (post-milestone perf):** if civ-count or world size is ever raised,
implement chunked `RenderTexture` terrain with worldView culling in
`CivilizationGameCanvas.tsx` (`bakeTerrain` ~744-753). Not scheduled in any v2.0
phase (Phases 3/4/5 do not touch renderer perf).
