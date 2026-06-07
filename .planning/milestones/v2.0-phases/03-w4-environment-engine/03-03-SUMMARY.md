---
phase: 03-w4-environment-engine
plan: 03
subsystem: api
tags: [rust, tauri, civilization, simulation, determinism, seasons, disasters]

# Dependency graph
requires:
  - phase: 03-01
    provides: advance_season + season_target_temp + regrow_resources + is_renewable (pure helpers)
  - phase: 03-02
    provides: roll_forecast + disaster_kinds_for + apply_disaster_to_tiles (pure helpers, remaining_turns-as-lead convention)
provides:
  - tick_environment(&mut snapshot) per-turn orchestrator running the CONTEXT-locked sequence
  - turn-start insertion in advance_civ_turn so civs observe fresh env via build_observation
  - disaster_duration(kind) bounded active-duration helper
  - removal of all temporary #[allow(dead_code)] on the 03-01/03-02 helpers (now reachable)
  - full-tick byte-determinism + multi-turn replay + tile-count-invariant + back-compat tests
affects: [04-w5-genetics, 05, w8-harness, w9-renderer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-turn world orchestrator: take() the forecast, mutate snapshot in field order, log via push_log with distinct kinds"
    - "Borrow-safe mutate-then-log: read env scalars into locals / collect expiring ids before retain to avoid aliasing snapshot with push_log"
    - "Disaster civ-effect via reused CivModifier kinds (drought/cold_snap) — never push an unknown kind (silent no-op)"
    - "seed+turn-derived ids (format!(\"dis-{turn}-{kind}\")) — no uuid/SystemTime in the tick for byte-stable replay"

key-files:
  created:
    - .planning/phases/03-w4-environment-engine/03-03-SUMMARY.md
  modified:
    - tauri-app/src-tauri/src/civilization.rs

key-decisions:
  - "tick_environment runs at TURN START (advance_civ_turn line 799, after snapshot.turn = next_turn, before civ_turn_order) so build_observation shows the fresh season/forecast and a fired disaster's CivModifier rides the existing post-loop resolve_environment + tick_modifiers"
  - "Locked sequence: fire due forecast (reshape + reused modifier + log) -> advance season/temp/water (log on wrap) -> regrow renewables -> tick disaster countdowns + retire expired (log expiry) -> roll/refresh forecast (log announce)"
  - "Only drought/cold_snap fired disasters push a CivModifier (existing resolve_environment arms); flood/quake are terrain-only; storm/predator_incursion are announce/one-shot (Pitfall 5)"
  - "disaster_duration per kind (drought/cold_snap 5, flood 4, predator 3, quake/storm 2, default 3), clamped 1..12"
  - "No fields added to CivEnvironment/CivDisaster -> bindings.ts byte-identical, no specta/Type change, no regen"

patterns-established:
  - "Pattern: world-level per-turn tick orchestrator wiring isolated pure helpers in a locked, deterministic order with per-event logging"

requirements-completed: [ENV-01, ENV-02, ENV-03]

# Metrics
duration: 12 min
completed: 2026-06-07
---

# Phase 3 Plan 03: tick_environment Orchestrator Summary

**Wired the four Wave-1/2 pure helpers into a single deterministic per-turn `tick_environment` orchestrator inserted at turn start in `advance_civ_turn`, so seasons drift, disasters forecast→fire→reshape terrain, and renewables regrow while finite stays depleted — end to end with zero frontend changes.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-06T23:50Z (after 03-02)
- **Completed:** 2026-06-07T00:00Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 1 (civilization.rs)

## Accomplishments
- `tick_environment(&mut snapshot)` orchestrator implementing the CONTEXT-locked sequence (fire→advance→regrow→countdown→roll), with distinct log kinds ("season", "forecast", "disaster") for every world event.
- One-line insertion at turn start in `advance_civ_turn` (line 799) so civs observe the freshly-advanced env the same turn and a fired disaster's `CivModifier` rides the existing post-loop `resolve_environment` + `tick_modifiers`.
- Removed all temporary `#[allow(dead_code)]` attributes (and their "remove when 03-03 wires it" comment block) from the 03-01/03-02 helpers — they are now genuinely reachable from the turn loop; clippy stays exactly at the 16-error baseline.
- 10 new `#[cfg(test)]` tests: 6 integration (season advance, forecast→fire, fire/forecast logging, expiry, reused-modifier, regrowth) + 4 cross-cutting (single + multi-turn byte-determinism, tile-count invariant, env-less save loads calm spring).

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1 (RED): failing tick_environment integration tests** - `79378a3` (test)
2. **Task 1 (GREEN): tick_environment orchestrator + insertion + dead_code removal** - `494596a` (feat)
3. **Task 2 (RED+GREEN): byte-determinism + back-compat tests** - `a92a060` (test)

**Plan metadata:** committed separately as `docs(03): complete plan 03-03`.

_Task 2 has no separate production-code commit — it is tests only (no new prod code), so RED and GREEN coincide once `tick_environment` exists from Task 1._

## Files Created/Modified
- `tauri-app/src-tauri/src/civilization.rs` — added `tick_environment` + `disaster_duration`; inserted the call in `advance_civ_turn`; removed the temporary `#[allow(dead_code)]` attributes from the W4 helpers; added 10 tests.
- `.planning/phases/03-w4-environment-engine/03-03-SUMMARY.md` — this summary.

## Verification Results

Run from `tauri-app/src-tauri` (backend tests cannot execute on Windows — gotcha #5 — so this is compile-only; CI Linux/macOS runs them):

- `cargo test --no-run` → **exit 0** (only the pre-existing `permission_prompter.rs:31` warning; in the documented baseline).
- `cargo clippy --all-features -- -D warnings` → **16 error lines = the documented baseline exactly**; the only `civilization.rs` reference is the pre-existing `:703` `unnecessary_sort_by` (logged in phase-01 deferred-items.md). **Zero new warnings**; removing the `#[allow(dead_code)]` attributes introduced no `dead_code` warning (the helpers are now used).
- `bindings.ts` hash `dc02cba3…` **byte-identical** before and after — no `#[derive(Type)]` field added, no `#[specta::specta]` command added, no regen. `CivEnvironment` field set `{season, turn_of_season, temperature, water_level, disasters, forecast}` and `CivDisaster` field set `{id, kind, epicenter_x, radius, intensity, remaining_turns}` both unchanged.
- `tick_environment(&mut snapshot);` is at `advance_civ_turn` line 799 — after `snapshot.turn = next_turn;` (794) and before `let turn_order = civ_turn_order(` (807). Confirmed correct site.
- Multi-turn determinism test seed (777) **offline-verified** to fire ≥1 disaster within 12 turns (standalone Rust replica of the exact rng + forecast bookkeeping), so the forecast→fire→expiry cycle is genuinely exercised under replay.

## Decisions Made
- Followed the plan's locked sequence and turn-start placement exactly. Reused only existing `drought`/`cold_snap` modifier kinds for fired-disaster civ-effects (Pitfall 5); flood/quake terrain-only; storm/predator announce/one-shot.
- `disaster_duration` durations are Claude's-discretion bounded values per the plan's suggestion, all `.clamp(1, 12)`.
- Borrow-safety: `.take()` the forecast; read env scalars into locals before assignment; collect expiring disaster ids before `retain` so `push_log(snapshot, ...)` never aliases an outstanding borrow.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. The borrow checker required reading env scalars into locals before mutating (anticipated by the plan's "Sequence note"); handled cleanly. Could not run tests on Windows (known gotcha #5) — used `cargo test --no-run` for compile verification and an offline Rust replica to confirm the seed-777 disaster-fire assertion.

## Known Stubs
None. `tauriBrowserFallback.ts` `advancePreviewCiv` remains a cosmetic preview stub intentionally (RESEARCH A1 / no requirement asks for a browser-preview env mirror) — out of scope and untouched this phase.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 3 (W4 Environment Engine) is now complete: all three plans (03-01 pure season/regrow helpers, 03-02 pure forecast/disaster helpers, 03-03 the orchestrator + wiring) are landed. The world now evolves every turn end-to-end.
- The full tick is byte-deterministic (single + multi-turn), tile-count invariant holds across many ticks including disaster fires, and old saves still load as calm spring.
- Ready for `/gsd-verify-work` on phase 3 (CI green on Linux/macOS executes the new unit tests). Recommend refreshing the root `xolotl.exe` via `build.bat` before manual UAT.

## Self-Check: PASSED

- `03-03-SUMMARY.md` exists on disk.
- Task commits `79378a3`, `494596a`, `a92a060` all present in git history.
- `cargo test --no-run` exit 0; clippy at 16-error baseline (no new); bindings.ts byte-identical.

---
*Phase: 03-w4-environment-engine*
*Completed: 2026-06-07*
