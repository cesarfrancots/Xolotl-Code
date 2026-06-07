---
phase: 03-w4-environment-engine
plan: 02
subsystem: simulation
tags: [rust, civilization, environment-engine, disasters, determinism, terrain, tdd]

# Dependency graph
requires:
  - phase: 03-01
    provides: "env-engine pure-helper block + RNG idiom (seed^turn^SALT), round1, SEASONS/ENV_SEASON_SALT consts, test_snapshot/determinism test conventions (file ordering only — no code dependency)"
provides:
  - "roll_forecast(seed, turn, &env, width) -> Option<CivDisaster> — pure, seed/turn-deterministic, season/temperature-weighted disaster roll"
  - "apply_disaster_to_tiles(&mut [CivTile], &CivDisaster, width) — pure, bounded, invariant-safe in-place terrain reshape"
  - "disaster_kinds_for(season, temperature) -> &'static [&'static str] — season-weighted kind eligibility table"
  - "DISASTER_FORECAST_LEAD / DISASTER_RADIUS_MAX / ENV_FORECAST_SALT consts"
  - "10 unit tests: forecast determinism + bounds + seed-derived id + season weighting; reshape tile-count/bounds/air-band invariants + terrain-neutral no-op + determinism"
affects: [03-03, tick_environment, ENV-02, ENV-03, environment-engine-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Seed/turn-derived disaster id (format!(\"dis-{turn}-{kind}\")) — replayable, no uuid/wall-clock (threat T-03-04)"
    - "Forecast lead countdown reuses CivDisaster.remaining_turns (no new struct field → no IPC/bindings change; Open Q3 convention)"
    - "Bounded substrate-guarded in-place tile reshape mirroring mining terraform rules (saturating arithmetic, iter_mut().find, never push/remove)"
    - "Disaster civ-effects reuse existing CivModifier kinds (drought/cold_snap) — no new no-op kinds (T-03-06)"

key-files:
  created:
    - .planning/phases/03-w4-environment-engine/03-02-SUMMARY.md
    - .planning/phases/03-w4-environment-engine/deferred-items.md
  modified:
    - tauri-app/src-tauri/src/civilization.rs

key-decisions:
  - "Repurposed CivDisaster.remaining_turns as the forecast LEAD countdown (turns-until-fire) while in env.forecast, instead of adding an eta field — avoids an IPC/bindings.ts change (resolves RESEARCH Open Q3)"
  - "Disaster id is format!(\"dis-{turn}-{kind}\"); ALL rolls derive from seed^turn^ENV_FORECAST_SALT — no uuid, no SystemTime (deterministic replay, T-03-04)"
  - "flood/quake/landslide are terrain-reshape kinds; drought/cold_snap reuse existing resolve_environment arms; storm/predator_incursion are announce/one-shot — no new CivModifier kind without a matching arm (T-03-06)"
  - "apply_disaster_to_tiles only converts substrate strictly BELOW surface+1 and at y >= WATER_SURFACE_Y, mirroring mining terraform — keeps the seabed surface/air band intact so a disaster can't soft-brick a colony (T-03-05)"
  - "Both helpers carry #[allow(dead_code)] with a 'remove when 03-03 wires it' comment (consumed only by tests until 03-03 tick_environment), matching the 03-01 convention"

patterns-established:
  - "Pure env-engine leaf helpers: seed/turn-deterministic, return-or-mutate-in-place, fully unit-tested for determinism + invariants before Wave-3 wiring"
  - "Disaster terrain mutation = bounded blast band (epicenter clamped [1,width-2], radius capped at DISASTER_RADIUS_MAX), all saturating arithmetic (unsafe_code forbidden)"

requirements-completed: [ENV-02]

# Metrics
duration: ~18 min
completed: 2026-06-07
---

# Phase 03 Plan 02: Disaster Pure Helpers (ENV-02) Summary

**Two pure, seed-deterministic disaster helpers — `roll_forecast` (season/temperature-weighted Option<CivDisaster> roll with a forecast-lead countdown reusing `remaining_turns`) and `apply_disaster_to_tiles` (bounded, invariant-safe sub-surface substrate→water reshape) — backed by 10 determinism/bounds/invariant unit tests, with zero new clippy warnings and no IPC/bindings change.**

## Performance

- **Duration:** ~18 min
- **Completed:** 2026-06-07
- **Tasks:** 2 (TDD: RED → GREEN each)
- **Files modified:** 1 source (`civilization.rs`), +351 lines over 03-01 (`ff9be71`)

## Accomplishments

- **`roll_forecast`** — pure free function: `rng = (seed ^ turn.wrapping_mul(0x9E37_79B9) ^ ENV_FORECAST_SALT).max(1)`, base chance higher in winter/summer (0.30 vs 0.20), season/temperature-weighted kind pick via `disaster_kinds_for`, seed/turn-derived id `dis-{turn}-{kind}`, all of epicenter_x/radius/intensity/lead clamped. `remaining_turns` carries the 1–3 turn forecast lead countdown (no new field).
- **`disaster_kinds_for`** — season-weighted eligibility: winter→cold_snap/storm/quake; hot summer (≥22°)→drought/flood/storm/quake (cool summer drops drought); spring→flood/storm/predator_incursion; autumn→storm/quake/drought.
- **`apply_disaster_to_tiles`** — pure in-place reshape: terrain-only for flood/quake/landslide (early-return otherwise), bounded blast band around a clamped epicenter, converts sub-surface substrate to water/deepwater mirroring the mining terraform rules, never touches the air band / seabed surface, all saturating arithmetic, never push/remove (tile-count invariant).
- **10 unit tests** added to the existing `#[cfg(test)] mod tests` covering both helpers (determinism, bounds clamps, seed-derived id, season weighting, tile-count/bounds/air-band invariants, terrain-neutral no-op, byte-determinism).
- **No IPC change:** `CivDisaster` field set unchanged → no `#[derive(Type)]`/`#[specta::specta]` change → `bindings.ts` untouched, no regen, no `tsc`.

## Task Commits

Each task was committed atomically (TDD test → feat):

1. **Task 1 (RED): failing roll_forecast/disaster_kinds_for tests** — `5c00179` (test)
2. **Task 1 (GREEN): roll_forecast + disaster_kinds_for + consts** — `a467a77` (feat)
3. **Task 2 (RED): failing apply_disaster_to_tiles tests** — `932fa31` (test)
4. **Task 2 (GREEN): apply_disaster_to_tiles bounded reshape** — `1372491` (feat)

**Plan metadata:** committed as `docs(03): complete plan 03-02` (this SUMMARY + deferred-items.md).

## Files Created/Modified

- `tauri-app/src-tauri/src/civilization.rs` — added `DISASTER_FORECAST_LEAD`/`DISASTER_RADIUS_MAX`/`ENV_FORECAST_SALT` consts, `disaster_kinds_for`, `roll_forecast`, `apply_disaster_to_tiles` (all in the W4 env-engine helper block, each `#[allow(dead_code)]` until 03-03), and 10 unit tests in `mod tests`.
- `.planning/phases/03-w4-environment-engine/deferred-items.md` — logged the stale-snapshot observation + the clippy baseline note.

## Verification Gate Results

Run from `tauri-app/src-tauri` (backend tests COMPILE on Windows, EXECUTE on CI — gotcha #5):

- **`cargo test --no-run`** → exit **0** (all test binaries built).
- **`cargo clippy --all-features -- -D warnings`** → **15 pre-existing baseline errors, 0 new.**
  - Baseline locations (unchanged): `commands.rs` ×10, `skills_mcp.rs` ×4, `permission_prompter.rs:31` ×1, `civilization.rs:703` ×1. No clippy entry anywhere in the new env-engine code (5000+). (The `manual_strip` baseline error spans two `-->` lines, so the location dump shows 16 lines for 15 errors — byte-identical to the pre-change baseline.)
- **`bindings.ts` untouched** — byte-identical to committed `ff9be71`; no new `#[derive(Type)]`/`#[specta::specta]` field; `remaining_turns` reused (no new `CivDisaster` field). No regen, no `tsc`.
- **Acceptance criteria:** all Task 1 + Task 2 grep criteria PASS (functions present; `format!("dis-` present and no `new_v4`/`SystemTime`/`unix_timestamp` in the roll body; `.clamp(`/`wrapping_mul(0x9E37_79B9)`/`ENV_FORECAST_SALT`; `is_substrate(`/`DEEP_WATER_Y`/`saturating_sub`/`iter_mut().find(`; early-return for non-reshape kinds; all named tests present).

## Decisions Made

See `key-decisions` frontmatter. In short: reuse `remaining_turns` as the forecast lead (no new field → no IPC churn); seed/turn-derived id for replay; flood/quake reshape terrain while drought/cold_snap reuse existing modifier arms and storm/predator are announce-only; convert only strictly-sub-surface substrate so the colony floor stays buildable.

## Deviations from Plan

None — plan executed exactly as written. The plan supplied the helper bodies and test names verbatim; implementation matched them. (One minor test-hygiene choice: used `"dis-1-flood".into()` instead of `format!("dis-1-flood")` in a test helper to avoid a spurious `useless_format` clippy add — purely a clippy-cleanliness refinement within the planned tests, not a behavioral deviation.)

## Issues Encountered

- **Stale orchestrator git-status snapshot.** The initial snapshot listed uncommitted edits to `STATE.md`/`config.json`/`lib.rs`/`bindings.ts`/`civilization.rs` + an untracked `deferred-items.md`, but the working tree was already clean at executor start (matching `ff9be71`); reflog shows no reset/checkout/stash and this executor ran no destructive git commands. `lib.rs`/`bindings.ts` are byte-identical to their committed state — this plan never touched them. Logged in `deferred-items.md` for human awareness; out of scope for 03-02.

## Known Stubs

None. Both helpers are complete and correct; they carry `#[allow(dead_code)]` only because they are consumed by tests until 03-03 wires `tick_environment` (the allows are removed by 03-03, per the documented convention — not stubs).

## User Setup Required

None — backend-only pure helpers, no external service configuration.

## Next Phase Readiness

- **Ready for 03-03 (Wave 3, `tick_environment` orchestrator).** 03-03 will: call `roll_forecast` → store in `env.forecast`, decrement `remaining_turns` each turn, fire the disaster (move to `env.disasters`, reset `remaining_turns` to active duration) → call `apply_disaster_to_tiles` + push the appropriate `CivModifier` (drought/cold_snap) / one-shot + `push_log`, then remove all four `#[allow(dead_code)]` attributes added in 03-01/03-02 once the helpers are wired.
- No blockers. Full `cargo test` runs the new unit tests on CI (Linux/macOS); Windows verified compile-only per gotcha #5.

## Self-Check: PASSED

- Created files exist: `03-02-SUMMARY.md` (this file), `deferred-items.md` — FOUND.
- Commits exist (`git log --oneline --all`): `5c00179`, `a467a77`, `932fa31`, `1372491` — all FOUND.
- `civilization.rs` contains `fn roll_forecast`, `fn disaster_kinds_for`, `fn apply_disaster_to_tiles` and all 10 new tests — FOUND.

---
*Phase: 03-w4-environment-engine*
*Completed: 2026-06-07*
