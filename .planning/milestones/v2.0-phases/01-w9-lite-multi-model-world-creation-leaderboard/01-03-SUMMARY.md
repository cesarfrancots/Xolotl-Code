---
phase: 01-w9-lite-multi-model-world-creation-leaderboard
plan: 03
subsystem: civ-arena-bridge
tags: [render_game_to_text, text-state, leaderboard, civPilot, vitest, arena, back-compat]
provides:
  - "render_game_to_text() additively exposes civs[] (per-civ summaries), a score.total-desc leaderboard, and environment as structured JSON"
  - "Legacy single-civ text-state keys (coordinate_system/session/civilization/player/player_task/visible_entities) preserved byte-identical for the codex-play-civ.mjs harness (ARENA-02)"
  - "CivPilotTextState type additively models civs?/leaderboard?/environment?"
  - "Vitest contract spec locking both legacy and new text-state keys"
affects: [arena, leaderboard, civ-pilot, plan-04-civilization-view]
tech-stack:
  added: []
  patterns: ["additive read-bridge extension (single JSON.stringify, no key renames)", "vi.mock('phaser') to import a pure render fn from a Phaser-laden module under jsdom"]
key-files:
  created: []
  modified:
    - tauri-app/src/components/civilization/CivilizationGameCanvas.tsx
    - tauri-app/src/lib/civPilot.ts
    - tauri-app/src/lib/civPilot.test.ts
key-decisions:
  - "Exported renderSnapshotToText so the contract spec exercises the real function (was module-private)"
  - "Left codex-play-civ.mjs unchanged: the optional richer-logging read is not required for ARENA-02, and changing it risks the hard back-compat gate for zero required benefit"
  - "Guarded snapshot.civs with (?? []) — the static binding type is optional even though store snapshots are always normalized"
requirements: [ARENA-01, ARENA-02]
duration: 7min
completed: 2026-06-06
---

# Phase 01 Plan 03: Additive Arena Read Bridge (civs[] + leaderboard + environment) Summary

**`render_game_to_text()` now emits the full multi-civ state and a score-sorted leaderboard as structured JSON while keeping the legacy single-civ keys byte-identical, locked by a vitest contract spec — the ARENA-02 back-compat gate holds.**

## Performance
- **Duration:** ~7 min
- **Tasks:** 2 of 2 completed
- **Files modified:** 3

## Accomplishments
- Appended `civs[]` (id/name/model/color/alive/population/era/score/controller/resources), a `leaderboard` sorted by `score.total` desc (id/name/model/color/alive/score/controller), and `environment` to the **single** `JSON.stringify` object in `renderSnapshotToText` — no second stringify, no key renames (Pitfall 3 respected).
- Kept `coordinate_system`, `session`, `civilization` (still `primaryCiv`), `player`, `player_task`, `visible_entities` byte-identical — the working-tree diff is purely additive (new sibling keys after `visible_entities`).
- Extended `CivPilotTextState` additively with optional `civs?`, `leaderboard?`, `environment?` (nothing existing changed).
- Added a 3-test contract spec (`renderSnapshotToText arena contract`) asserting: legacy keys present/well-formed (codex harness contract), new keys present + leaderboard sorted desc + correct controller passthrough, and that no provider config / key material leaks into the text-state (T-03-01).
- Verified the codex harness (`codex-play-civ.mjs`) still parses the additive shape and still reads `state.civilization.resources`; left it unchanged (optional enrichment skipped per back-compat priority).

## Task Commits
1. **Task 1 (RED): arena text-state contract spec** - `1197f63` (test: export render fn + phaser mock + failing new-key assertions)
2. **Task 1 (GREEN): additively expose civs[]/leaderboard/environment** - `59419ca` (feat: render append + CivPilotTextState fields)
- Task 2 deliverable (contract test covering legacy + new keys) was authored in `1197f63` and passes against `59419ca`; `codex-play-civ.mjs` intentionally unchanged (no commit needed — additive-safe).

## Files Created/Modified
- `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx` - Exported `renderSnapshotToText`; appended `civs`/`leaderboard`/`environment` to the existing single stringify object.
- `tauri-app/src/lib/civPilot.ts` - Extended `CivPilotTextState` with optional `civs?`/`leaderboard?`/`environment?`.
- `tauri-app/src/lib/civPilot.test.ts` - Added `vi.mock('phaser')` + fixtures + 3-test `renderSnapshotToText arena contract` describe block.

## Verification Results
- `npx tsc --noEmit` → exit 0 (clean).
- `npm test -- civPilot` → 22 passed (22) — includes the 3 new contract tests.
- `node --check scripts/codex-play-civ.mjs` → exit 0 (file unchanged; confirmed still valid + still reads `state.civilization.resources`).
- Full `npm test` → 25 files / 206 tests passed, no regressions.
- Legacy text-state keys confirmed byte-identical: render-function diff vs prior state is additive-only (single changed line is the `visible_entities` closing brace gaining new siblings); exactly one `JSON.stringify` in the function.

## Decisions & Deviations
- **[Rule 3 - Blocking] Phaser import crashes the test suite under jsdom.** Found during Task 1 RED: importing `renderSnapshotToText` from the canvas module transitively loads `phaser`, whose ESM init touches a jsdom canvas and aborts the whole suite. Fixed by adding `vi.mock("phaser", ...)` (minimal `Scene`/`Game`/`AUTO`/`Scale` stub) in the test file — the render function is pure and never calls Phaser at runtime. Verified by the now-passing suite. (Commit `1197f63`.)
- **[Minor] Exported the previously module-private `renderSnapshotToText`** so the contract spec can call the real function (behavior-neutral; window hooks at 255/301 and the scene `renderToText()` fallback ~594 keep using it unchanged).
- **[Minor] `(snapshot.civs ?? [])` guard** added in the render append because the `CivSessionSnapshot` binding types `civs` as optional (store snapshots are always normalized, so this is purely a tsc/static-safety guard; matches the existing defensive `primaryCiv` which uses `snapshot.civs?.[0]`).
- codex-play-civ.mjs left unchanged (optional read explicitly skipped to protect the ARENA-02 hard gate; control-call shape `controls.start({goal, possessId, requesterId, continueAfterTask})` untouched).
- Nothing logged to `deferred-items.md` — no out-of-scope or broken discoveries.

## Next Phase Readiness
Ready for Plan 04 (CivilizationView.tsx): the arena read bridge now surfaces per-civ summaries + leaderboard + environment as structured JSON, and the controller/civId driving wiring lands there over the existing (still backward-compatible) control surface.

## Self-Check: PASSED
- `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx` exists, contains `civs:`/`leaderboard:`/`environment:` and `civilization:` (legacy) — verified.
- `tauri-app/src/lib/civPilot.ts` contains `civs?`/`leaderboard?`/`environment?` — verified.
- `tauri-app/src/lib/civPilot.test.ts` asserts legacy keys (`civilization.resources`, `player`, `player_task`, `visible_entities`) and new keys (`civs`, `leaderboard` sorted desc, `environment`) — verified.
- Commits `1197f63` and `59419ca` present in `git log` — verified.
- tsc exit 0, `civPilot` 22/22, full suite 206/206, `node --check` exit 0 — verified.
