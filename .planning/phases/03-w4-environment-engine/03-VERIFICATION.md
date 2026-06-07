---
phase: 03-w4-environment-engine
verified: 2026-06-07T00:00:00Z
status: human_needed
score: 11/11 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Disaster terrain reshape looks right + season/disaster balance feels fair over a long run"
    expected: "On CI/dev (NOT Windows), advance many turns on a seeded world: seasons cycle spring→summer→autumn→winter, forecasts are announced then fire, terrain visibly changes near disaster epicenters, and the world stays livable (no soft-bricked colony)"
    why_human: "Aesthetic/balance judgment, not a hard invariant; the bounded-reshape + livability invariants ARE asserted by unit tests, but 'looks/feels right' is subjective. Unit tests cannot EXECUTE on this Windows host (gotcha #5 — WebView2 DLL loader blocks the test harness); they run on CI (Linux/macOS)."
  - test: "Sustained scarcity emerges over a long run (ENV-03 emergent property)"
    expected: "Advance a long run; confirm finite minerals (ore/stone/glowshards/amber/coral/…) stay depleted while renewables (moss/kelp/wood/fiber/herbs) recover toward their cap"
    why_human: "Emergent multi-turn property; the per-pass mechanic is unit-tested (renewable regrows, finite never regrows) but the macro 'observable sustained scarcity' over a full game is a runtime/UX observation."
  - test: "Phase-3 unit-test suite passes on CI"
    expected: "tauri-app.yml (Linux/macOS) runs `cargo test` and the ~29 new env-engine #[test]s pass green (determinism, invariants, finite-never-regrow, logging, back-compat)"
    why_human: "Backend tests cannot EXECUTE on Windows (gotcha #5). This verification confirmed they COMPILE (`cargo test --no-run` exit 0) and are substantive by reading every assertion, but the green/red signal is produced by CI, which a human/CI must confirm."
---

# Phase 3: W4 — Environment Engine Verification Report

**Phase Goal:** The world stops being stale — seasons advance over turns and drift temperature visibly; natural disasters trigger, are forecast and logged, and physically reshape terrain; renewable resources regrow while finite resources stay depleted, creating sustained scarcity.
**Verified:** 2026-06-07
**Status:** human_needed (all 11 code must-haves VERIFIED; remaining items are CI-execution + aesthetic/emergent runtime observations that cannot be checked on this Windows host)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `advance_season` advances spring→summer→autumn→winter, wraps deterministically on `SEASON_LEN`, drifts temperature toward the season target with seed-deterministic noise (ENV-01) | ✓ VERIFIED | `civilization.rs:4951-4981` — `tos` wraps at `SEASON_LEN=8`, `idx=(idx+1)%4`, temp = `temperature + (target-temperature)*0.25 + noise`, noise from `seed^turn.wrapping_mul(0x9E37_79B9)^ENV_SEASON_SALT`, `round1`-stabilized. Tests `advance_season_wraps_on_season_len`, `advance_season_cycle_order` (5327-5350) |
| 2 | `advance_season` is pure / seed-deterministic: identical inputs → identical tuple (replay) | ✓ VERIFIED | No SystemTime/uuid in body (`4951-4981`); all randomness from `seed^turn^SALT`; `temp` via `round1` for byte-stability. Test `advance_season_is_deterministic` (5319) + `..._temp_is_round1_stable_and_water_bounded` (5353) |
| 3 | `regrow_resources` ticks renewables toward a cap scaled by season (≈0 winter/cold); finite minerals NEVER regrow (ENV-03) | ✓ VERIFIED | `civilization.rs:4997-5014` — rate 2 spring/summer, 1 autumn, **0 winter**, early-return if `temperature < 2.0`; gated by `is_renewable(res)`, capped at `REGROW_CAP=18`. Tests `regrow_renewable_rises_to_cap`, `finite_resources_never_regrow`, `regrow_is_zero_in_winter`, `regrow_zero_when_too_cold`, `coral_is_finite_and_never_regrows` (5387-5431) |
| 4 | `regrow_resources` mutates in place — tile count unchanged | ✓ VERIFIED | `iter_mut()` only, never push/remove (`5007-5013`). Test `regrow_preserves_tile_count` (5434) |
| 5 | `roll_forecast` deterministically rolls `Option<CivDisaster>` weighted by season/temperature, seed/turn-derived id (no uuid/wall-clock), `remaining_turns` repurposed as forecast-lead (ENV-02) | ✓ VERIFIED | `civilization.rs:5052-5080` — `rng=(seed^turn*0x9E37_79B9^ENV_FORECAST_SALT).max(1)`, kind via `disaster_kinds_for`, id `format!("dis-{turn}-{kind}")`, `remaining_turns: lead`. Tests `roll_forecast_is_deterministic`, `..._clamps_bounds`, `..._id_is_seed_derived` (id<30 chars, `dis-{turn}-{kind}`), `disaster_kinds_are_season_weighted` (6631-6707) |
| 6 | `apply_disaster_to_tiles` physically reshapes `world.tiles` boundedly AND preserves invariants (tile count constant, x/y clamped, only below seabed surface, world livable) (ENV-02) | ✓ VERIFIED | `civilization.rs:5092-5127` — flood/quake/landslide only (early-return otherwise), bounded blast band `cx±r` (`r≤DISASTER_RADIUS_MAX=8`), converts substrate→water/deepwater only at `ty>surface+1 && ty≥WATER_SURFACE_Y`, `iter_mut().find` (no push/remove). Tests `apply_disaster_preserves_tile_count`, `flood_reshapes_terrain_to_water`, `apply_disaster_never_touches_air_band`, `apply_disaster_stays_in_bounds`, `terrain_neutral_disaster_leaves_tiles_unchanged`, `apply_disaster_is_deterministic` (6723-6839) |
| 7 | Disaster civ-effects reuse existing `CivModifier` kinds (drought/cold_snap) via the existing `resolve_environment` arms — no silent no-op kinds (ENV-02) | ✓ VERIFIED | Fire path pushes only `drought`/`cold_snap` (`5168-5182`); consumed by `resolve_environment` arms at `2539-2547`. flood/quake terrain-only, storm/predator announce-only. Test `tick_environment_fired_disaster_pushes_reused_modifier` asserts drought→drought, cold_snap→cold_snap, AND flood pushes NO unknown kind (6972-6994) |
| 8 | `tick_environment` runs the CONTEXT-locked sequence (fire due forecast → advance season → regrow → countdown/expire → roll forecast), wired at turn start so civs observe fresh state (ENV-01/02/03) | ✓ VERIFIED | `civilization.rs:5153-5268` implements (a)fire → (b)advance → (c)regrow → (d)countdown+retire → (e)roll, in that order. Wired at `advance_civ_turn:799` (after `snapshot.turn=next_turn` at 794, before `civ_turn_order` at 803; decision loop's `build_observation` at 810 then reads fresh env). Tests `tick_environment_advances_season`, `..._forecast_then_fire`, `..._regrowth_runs_in_tick` (6855-7018) |
| 9 | Every forecast announce, disaster fire, season change, and disaster expiry is logged via `push_log` with a distinct kind | ✓ VERIFIED | `push_log` kinds: `"disaster"` on fire (5183) + expiry (5244), `"season"` on wrap (5215), `"forecast"` on roll (5260). Tests `tick_environment_disaster_logged` (fire + forecast), `..._disaster_expiry`, `..._advances_season` assert the log kinds (6917-6969) |
| 10 | Full env tick is byte-deterministic: two clones at same (seed,turn) → serde-identical `environment` + `world.tiles` | ✓ VERIFIED | Tests `tick_environment_deterministic` (single tick, 7023) and `tick_environment_multi_turn_deterministic` (12-turn replay, fires ≥1 disaster, 7044). Both serde-compare `environment` + `world.tiles` (correctly EXCLUDING `log`, which carries a wall-clock `created_at` per `push_log:4461`). `tile_count_invariant_after_ticks` over 24 turns (7079) |
| 11 | Old saves without env fields still load (serde defaults) — no new IPC field; bindings unchanged | ✓ VERIFIED | `#[serde(default = "default_environment")]` (300-301), `#[serde(default)]` on `forecast` (498). Test `old_save_loads_calm_spring` removes the `environment` key from JSON, re-parses via `parse_snapshot`, asserts calm-spring defaults (7102-7123). `CivEnvironment`/`CivDisaster` field sets unchanged; `bindings.ts:303-368` matches; no env-engine `#[specta::specta]` command added; phase diff touched only `civilization.rs` |

**Score:** 11/11 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `tauri-app/src-tauri/src/civilization.rs` (env helper block) | `advance_season`, `season_target_temp`, `is_renewable`, `regrow_resources` + consts (ENV-01/03) | ✓ VERIFIED | Lines 4937-5014; all present, substantive, wired into `tick_environment` |
| `civilization.rs` (disaster helpers) | `roll_forecast`, `disaster_kinds_for`, `apply_disaster_to_tiles` + caps (ENV-02) | ✓ VERIFIED | Lines 5030-5127; all present, substantive, wired into `tick_environment` |
| `civilization.rs` (`tick_environment` orchestrator) | per-turn orchestrator + `advance_civ_turn` insertion | ✓ VERIFIED | `tick_environment` 5153-5268; `disaster_duration` 5131-5140; insertion at `advance_civ_turn:799` |
| `civilization.rs` `#[cfg(test)] mod tests` | unit tests for every automatable behavior | ✓ VERIFIED | ~29 env tests (9 season/regrow 5319-5443, 10 disaster/forecast 6631-6839, 10 tick/determinism/back-compat 6855-7123); all substantive (assert behavior, not truisms) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `advance_civ_turn` | `tick_environment` | `tick_environment(&mut snapshot)` at turn start | ✓ WIRED | `advance_civ_turn:799` — after turn increment (794), before civ loop (803). (PLAN anticipated "line 794/798"; actual site 799 is functionally identical — after increment, before loop.) |
| `tick_environment` | `advance_season`/`regrow_resources`/`roll_forecast`/`apply_disaster_to_tiles` | locked sequence calls | ✓ WIRED | All four called: 5202 (advance), 5224 (regrow), 5255 (roll), 5165 (apply) |
| fired disaster | `resolve_environment` drought/cold_snap arms | push reused `CivModifier` → applied post-loop | ✓ WIRED | Push at 5173-5182; consumed at `resolve_environment:2539-2547`; `resolve_environment` called at `advance_civ_turn:875`, `tick_modifiers` at 889 |
| `regrow_resources` / `is_renewable` | `is_finite_mineral` | `is_renewable(r) == !is_finite_mineral(r)` | ✓ WIRED | `is_renewable:4987-4989` negates the single classifier `is_finite_mineral:4067` — no duplicate list (coral correctly finite) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `tick_environment` | `snapshot.environment` (season/temp/forecast/disasters) | mutated in place from `advance_season`/`roll_forecast` over `seed`+`turn` | Yes — real seed/turn-derived state, persisted via `save_snapshot` (892), surfaced to civs via `build_observation` (810) and to harness/UI via the existing `environment` field (no stub/hardcoded path) | ✓ FLOWING |
| `tick_environment` | `snapshot.world.tiles` | `apply_disaster_to_tiles` + `regrow_resources` mutate in place | Yes — physical terrain change asserted by `flood_reshapes_terrain_to_water` | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All tests (incl. ~29 env tests) compile | `cargo test --no-run` (from `tauri-app/src-tauri`) | exit **0**; lib/main/export_bindings/test_chat binaries built; only pre-existing `permission_prompter.rs:31` dead_code warning | ✓ PASS |
| No new clippy errors vs documented baseline | `cargo clippy --all-features -- -D warnings` | **15 lib errors = documented baseline exactly** (commands.rs ×10, skills_mcp.rs ×4, permission_prompter.rs:31, civilization.rs:**703** `list_civ_sessions` sort). **ZERO** clippy hits anywhere in the env-engine code (4923-7124). New-vs-baseline = **0 new**. | ✓ PASS |
| Env tick produces real terrain/season change at runtime | run a seeded world for N turns | n/a — tests cannot EXECUTE on Windows (gotcha #5) | ? SKIP → human/CI (see Human Verification) |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| ENV-01 | 03-01, 03-03 | Seasons advance over turns and drift temperature, visibly affecting the world | ✓ SATISFIED | `advance_season` (4951) wired in `tick_environment` (5202) at turn start; logged on wrap; rides `snapshot.environment` (existing IPC) to harness/UI. Truths 1,2,8,9 |
| ENV-02 | 03-02, 03-03 | Natural disasters trigger, physically reshape terrain, are logged + announced via a forecast | ✓ SATISFIED | `roll_forecast` (5052) + `apply_disaster_to_tiles` (5092) wired via forecast→fire path in `tick_environment` (5158-5197); reshape + reused-modifier + log. Truths 5,6,7,8,9 |
| ENV-03 | 03-01, 03-03 | Renewable resources regrow over time while finite resources stay depleted, creating sustained scarcity | ✓ SATISFIED | `regrow_resources` (4997) wired in `tick_environment` (5224); finite never regrows (reuses `is_finite_mineral`). Truths 3,4 |

No requirement silently dropped. No orphaned requirements: ROADMAP/REQUIREMENTS map exactly ENV-01/02/03 to Phase 3, and all three are claimed by the plans' `requirements:` fields and covered above.

### Threat-Model Mitigations

| Threat | Mitigation | Status |
|--------|-----------|--------|
| Replay non-determinism (T-03-01/04/08) | All rolls from `seed^turn^SALT`; ids `dis-{turn}-{kind}`; no uuid/SystemTime in any env helper; `round1` byte-stable floats | ✓ Present — verified by determinism tests + grep (no uuid/SystemTime in 4923-7124) |
| Unbounded terrain mutation / soft-brick colony (T-03-02/05/10) | Bounded blast band (`r≤8`), substrate-only below `surface+1`, `iter_mut` (no push/remove), air band untouched | ✓ Present — tile-count/bounds/air-band invariant tests pass-compile |
| Serde back-compat break (T-03-09) | `#[serde(default = "default_environment")]` + `#[serde(default)]` on forecast; no new field | ✓ Present — `old_save_loads_calm_spring` test |
| Silent no-op modifier kind (Pitfall 5) | Only push `CivModifier` kinds with an existing `resolve_environment` arm (drought/cold_snap) | ✓ Present — verified push (5168) vs consume (2539) |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | No TODO/FIXME/placeholder/unimplemented/todo!/silent-empty-return in `civilization.rs` | — | Clean. Grep returned no matches across the file. |

`tauriBrowserFallback.ts` `advancePreviewCiv` (498-533) is a **legitimately non-mirrored** hardcoded browser-only preview teaser (baked scores, fake log) that never runs the real turn loop — no requirement asks for a browser-preview env mirror (RESEARCH A1 / 03-03). Not a stub of phase-3 work; correctly out of scope.

### Human Verification Required

1. **Disaster reshape / balance "looks & feels right" (ENV-02/01)** — On CI/dev (not Windows), advance many turns on a seeded world; observe seasons cycling, forecasts announced then firing, terrain visibly changing, world staying livable. *Why human:* aesthetic/balance judgment; the hard invariants are unit-tested but "feels fair" is subjective, and tests cannot run on this Windows host (gotcha #5).
2. **Sustained scarcity emerges over a long run (ENV-03)** — Advance a long run; confirm finite minerals stay depleted while renewables recover. *Why human:* emergent multi-turn property.
3. **Phase-3 unit suite is green on CI** — Confirm `tauri-app.yml` (Linux/macOS) runs `cargo test` and the ~29 new env tests pass. *Why human/CI:* backend tests cannot EXECUTE on Windows; this verification confirmed they COMPILE (`cargo test --no-run` exit 0) and are substantive (read every assertion), but the pass/fail signal comes from CI.

### Gaps Summary

No gaps. All 11 code-level must-haves are VERIFIED against the current `civilization.rs`:
- ENV-01/02/03 are fully implemented as pure, seed-deterministic helpers wired into a single turn-start `tick_environment` orchestrator with the CONTEXT-locked sequence.
- Determinism, bounded terrain mutation, finite-never-regrow, distinct-kind logging, and serde back-compat are each backed by substantive unit tests (verified by reading the assertion bodies, not summary claims).
- Live gates re-run from `tauri-app/src-tauri`: `cargo test --no-run` → **exit 0**; `cargo clippy --all-features -- -D warnings` → **15 errors = documented baseline, 0 new** (only civilization.rs hit is the pre-existing `:703`).
- No IPC change: phase diff (`ff9be71`→HEAD) touched only `civilization.rs` + planning docs; `CivEnvironment`/`CivDisaster` field sets unchanged; `bindings.ts` types match; no new `#[specta::specta]` command; all temporary `#[allow(dead_code)]` removed.

Status is `human_needed` (not `passed`) solely because the phase's own VALIDATION.md defines two manual-only checks (aesthetic reshape/balance, emergent scarcity) and the unit tests EXECUTE on CI rather than on this Windows host — the goal is genuinely achieved in code; what remains is human/CI confirmation of runtime/aesthetic/emergent behavior.

---

*Verified: 2026-06-07*
*Verifier: Claude (gsd-verifier)*
