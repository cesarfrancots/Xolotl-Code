---
phase: 01-w9-lite-multi-model-world-creation-leaderboard
plan: 04
subsystem: civilization-ui
tags: [react, zustand, leaderboard, observer, log-filter, reasoning-toggle, civ-pilot, tdd, vitest]
provides:
  - Persistent top-bar leaderboard above the canvas (living civs ranked by score.total desc, collapsed civs greyed at bottom)
  - selectedCivId-driven observer panel + per-civ log filter (civ_id based)
  - Per-entry model-reasoning expand toggle (collapsed by default, escaped React text)
  - civPilotControls.start additive civId + controller wiring via set_civ_controller
affects: [phase-02-focus-civ, arena-harness, leaderboard-attribution]
tech-stack:
  added: []
  patterns:
    - "store-level selectedCivId as single source of truth for top-bar (writer) + observer/log (readers)"
    - "derive leaderboard from snapshot.civs (mirrors backend leaderboard()) rather than event field"
    - "additive optional bridge options preserve back-compat (ARENA-02)"
    - "untrusted model output rendered as escaped React text children, never dangerouslySetInnerHTML"
    - "inline Tailwind utility styling (file's dominant pattern) so all changes stay in CivilizationView.tsx"
key-files:
  created: []
  modified:
    - tauri-app/src/components/civilization/CivilizationView.tsx
    - tauri-app/src/components/civilization/CivilizationView.test.tsx
key-decisions:
  - "Single GREEN feat commit covering both tasks because both modify the same single file (CivilizationView.tsx); hunk-splitting one file is fragile and the plan note permits multiple TDD commits"
  - "Styled new leaderboard/reasoning-toggle elements with inline Tailwind utilities (keeping civ-* class names as test/style hooks) to honor the strict 'commit only CivilizationView.tsx + tests' scope instead of editing styles.css"
  - "controller passed when options.controller !== undefined (empty string clears the tag); backend sanitizes per T-04-01"
requirements-completed: [CIV-02, CIV-03, ARENA-02, ARENA-03]
duration: 9min
completed: 2026-06-06
---

# Phase 01 Plan 04: W9-lite UI Surfacing + Harness Wiring Summary

**Persistent top-bar leaderboard that ranks living civs, greys collapsed ones, and on row-click drives a selectedCivId-scoped observer panel + per-civ log with an expandable model-reasoning toggle; plus an additive civPilotControls.start({civId, controller}) that scopes selection and attributes a controller tag via set_civ_controller without breaking the legacy bridge.**

## Performance
- **Duration:** ~9 min
- **Tasks:** 2 of 2 completed (both TDD)
- **Files modified:** 2 (1 component, 1 test file)

## Accomplishments
- **Leaderboard top-bar (CIV-02):** new `Leaderboard` component mounted above the canvas, derived from `snapshot.civs` sorted by `score.total` desc; `alive === false` civs are greyed and sorted to the bottom with a "collapsed" marker. Each row = color swatch · rank · name · `score.total` · controller badge (only when `civ.controller` set). Row `onClick` → `setSelectedCivId(civ.id)`.
- **selectedCivId-driven observer + log (CIV-03):** `activeCiv` rewired from `primaryCiv(snapshot)` to `snapshot.civs?.find(c => c.id === selectedCivId) ?? primaryCiv(snapshot)`. The combined chronological log filters by `entry.civ_id === selectedCivId` (robust field from Plan 01, not name matching); shows all entries when `selectedCivId` is null.
- **Reasoning expand toggle (CIV-03, D-11/D-12):** each log entry shows title + rationale always; a per-entry "Show/Hide reasoning" toggle reveals `entry.reasoning` only when present (collapsed by default, toggle hidden when reasoning absent). Reasoning + rationale render as escaped React text children — never `dangerouslySetInnerHTML` (threat T-04-02).
- **civPilot civId + controller (ARENA-02, ARENA-03):** `civPilotControls.start` extended additively with optional `civId?` and `controller?`. Legacy `start({goal, possessId, requesterId, continueAfterTask})` is unchanged and possession behavior is untouched. When `civId` present → `setSelectedCivId(civId)`; when `controller` present → `commands.setCivController(activeSessionId, civId, controller)`.

## Task Commits
1. **RED — failing specs for both tasks** - `6f5049a`
2. **GREEN — Task 1 + Task 2 implementation** - `ba729b9`

## Files Created/Modified
- `tauri-app/src/components/civilization/CivilizationView.tsx` - Added `Leaderboard` + `LogEntryRow` components; rewired `activeCiv`/`recentLog` to `selectedCivId`; added per-entry reasoning toggle; extended `civPilotControls.start` with additive `civId`/`controller`; imported `commands` from bindings for `setCivController`.
- `tauri-app/src/components/civilization/CivilizationView.test.tsx` - Added multi-civ snapshot fixtures and 7 specs (leaderboard ranking + collapsed greying, controller badge, row-click → selectedCivId, observer score panel from selection, log civ_id filter, reasoning toggle, civPilot legacy back-compat + civId/controller); added `setCivController` mock and `act()`-wrapped store mutations.

## Verification Gates
- `npx tsc --noEmit` → **exit 0**
- `npm test -- CivilizationView` → **14 passed (14)** (7 original creation-card + 7 new)
- `dangerouslySetInnerHTML` grep → **only the explanatory comment**, no actual usage
- Full `npm test` → **25 files / 214 tests passed** (206 baseline + 8 new test cases; **zero regressions**)
- Back-compat (ARENA-02): legacy `civPilotControls.start({goal, possessId})` spec passes; `setCivController` is NOT called and selection is untouched for legacy calls.

## Decisions & Deviations
- **No deviations to the plan's behavior.** Implemented exactly as specified, locating code by content (the line anchors in the plan were stale after Plan 01-02's ParticipantPicker refactor, as the orchestrator warned).
- **Deviation [Rule 1 - type-safety]:** the bindings type marks `CivSessionSnapshot.civs` as optional (`civs?`), so `snapshot.civs.find(...)` and the `<Leaderboard civs={snapshot.civs}>` prop tripped tsc. Guarded with `snapshot.civs?.find(...)` and `snapshot.civs ?? []`. `normalizeCivSnapshot` always populates `civs`, so this is purely a type-correctness guard with no runtime behavior change. Verified by `npx tsc --noEmit` exit 0.
- **Scope decision (CSS):** the new leaderboard/reasoning-toggle elements were styled with inline Tailwind utility classes (the file's dominant styling pattern), keeping the semantic `civ-*` class names as functional/test hooks. This avoids editing `styles.css`, honoring the "commit ONLY CivilizationView.tsx + tests" constraint, while still rendering a styled HUD that matches the existing civ-glass / oklch vocabulary.
- **Commit structure:** RED tests in one commit; GREEN implementation for both tasks in one commit (both tasks edit the same single file — fragile to split by hunk). The plan note explicitly allows multiple TDD commits and atomic-per-task; this keeps each commit coherent and reversible.
- Nothing appended to `deferred-items.md` this plan — no out-of-scope/broken discoveries surfaced.

## Next Phase Readiness
- Phase 1 is now fully surfaced: world creation (01-02), persisted reasoning/controller fields (01-01), additive text-state (01-03), and this watchable/navigable competition UI (01-04). The `selectedCivId` store slice is the connective tissue a future Phase 2 `focusCiv` can reuse.
- All four plan requirements (CIV-02, CIV-03, ARENA-02, ARENA-03) are implemented and verified.

## Self-Check: PASSED
- `tauri-app/src/components/civilization/CivilizationView.tsx` — FOUND (modified, contains `selectedCivId`, `Leaderboard`, `setCivController`)
- `tauri-app/src/components/civilization/CivilizationView.test.tsx` — FOUND (modified, 14 passing specs)
- Commit `6f5049a` (test RED) — FOUND in git log
- Commit `ba729b9` (feat GREEN) — FOUND in git log
- All verification gates green (tsc exit 0, 14/14 CivilizationView, 214/214 full suite, no dangerouslySetInnerHTML usage).
