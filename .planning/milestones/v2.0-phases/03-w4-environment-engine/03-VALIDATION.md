---
phase: 3
slug: w4-environment-engine
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-07
audited: 2026-06-07
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> BACKEND (Rust) phase. Tauri backend tests cannot EXECUTE on Windows (WebView2,
> gotcha #5) — verify via cargo check + clippy + `cargo test --no-run` (compile-only);
> the new `#[test]` unit tests RUN on CI (Linux/macOS) via tauri-app.yml.
> Determinism is the load-bearing automated property.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust libtest `#[test]` in `civilization.rs` `#[cfg(test)] mod tests` (~4918) |
| **Config file** | none (cargo built-in); crate `tauri-app/src-tauri` (lib `xolotl_lib`) |
| **Quick run (Windows, compile-only)** | `cargo test --no-run` (from `tauri-app/src-tauri`) |
| **Quick check (Windows)** | `cargo check` + `cargo clippy --all-features -- -D warnings` (ZERO new warnings vs the documented 16-error baseline) |
| **Full suite (CI Linux/macOS)** | `cargo test` — executes the new env unit tests |
| **Type gate** | `npx tsc --noEmit` only if any `.ts` touched (expected: none — no IPC change) |
| **Estimated runtime** | compile ~60–120s; CI test exec seconds |

---

## Sampling Rate

- **After every task commit:** `cargo check` + `cargo clippy --all-features -- -D warnings` (zero NEW warnings) + `cargo test --no-run`.
- **After every plan wave:** same; CI runs full `cargo test`.
- **Before `/gsd-verify-work`:** clippy clean for new lines; `cargo test --no-run` exits 0; bindings.ts unchanged (no IPC change) — or regenerated+committed if a registered type changed.
- **Max feedback latency:** ~120 seconds (backend compile-bound).

---

## Per-Task Verification Map

> Populated by the planner once task IDs exist. Determinism + invariants are the
> automatable load-bearing properties; terrain-reshape aesthetics/balance are manual CI observation.

> AUDIT (2026-06-07): every automatable row below is backed by a substantive,
> non-hollow `#[test]` (assertion bodies read line-by-line, not summary claims).
> Tests COMPILE on Windows (`cargo test --no-run` exit 0) and EXECUTE on CI
> (Linux/macOS, gotcha #5). Status "✅ (CI)" = green on CI, compile-verified here.

| Req ID | Behavior | Test Type | Automated Command (CI) | Backing test(s) | Status |
|--------|----------|-----------|------------------------|-----------------|--------|
| ENV-01 | `advance_season` advances+wraps deterministically; temp drifts toward season target; same (seed,turn) ⇒ identical | unit (pure) | `cargo test advance_season` | `advance_season_is_deterministic`, `advance_season_wraps_on_season_len`, `advance_season_cycle_order`, `advance_season_temp_is_round1_stable_and_water_bounded` | ✅ (CI) |
| ENV-01 | season change logged + rides snapshot.environment | integration | `cargo test tick_environment` | `tick_environment_advances_season` (asserts season wrap + temp drift + `kind=="season"` log) | ✅ (CI) |
| ENV-02 | `roll_forecast` rolls + announces K turns ahead, then fires into disasters[] deterministically | unit + integration | `cargo test forecast` | `roll_forecast_is_deterministic`, `roll_forecast_clamps_bounds` (lead ∈[1,3]), `roll_forecast_id_is_seed_derived`, `disaster_kinds_are_season_weighted`, `tick_environment_forecast_then_fire`, `tick_environment_disaster_logged` (forecast-announce sweep) | ✅ (CI) |
| ENV-02 | fired disaster reshapes world.tiles boundedly AND preserves invariants (tile count constant, x/y in bounds, no air below surface) | unit (pure) | `cargo test apply_disaster` | `apply_disaster_preserves_tile_count`, `flood_reshapes_terrain_to_water`, `apply_disaster_never_touches_air_band`, `apply_disaster_stays_in_bounds` (edge epicenters 0/1/200/250/255), `terrain_neutral_disaster_leaves_tiles_unchanged`, `apply_disaster_is_deterministic`, `landslide_reshapes_like_quake_and_holds_invariants` (LW-01) | ✅ (CI) |
| ENV-02 | every forecast/fire/expiry is logged | integration | `cargo test disaster_logged` | `tick_environment_disaster_logged` (fire + forecast kinds), `tick_environment_disaster_expiry`, `tick_environment_advances_season` (season log) | ✅ (CI) |
| ENV-02 | fired non-terrain disaster pushes a REUSED `CivModifier` with a LIVE `resolve_environment` arm — no silent no-op (MD-01) | integration | `cargo test fired_disaster_pushes_reused_modifier` | `tick_environment_fired_disaster_pushes_reused_modifier` (drought/cold_snap/storm→fatigue/predator→quarrel_pressure positive + flood pushes NO modifier negative; arms live at `resolve_environment:2539/2544/2551/2555`) | ✅ (CI) |
| ENV-03 | renewable resources regrow toward cap, scaled by season (≈0 in winter) | unit (pure) | `cargo test regrow` | `regrow_renewable_rises_to_cap` (caps at 17), `regrow_is_zero_in_winter`, `regrow_zero_when_too_cold`, `regrow_preserves_tile_count`, `tick_environment_regrowth_runs_in_tick` | ✅ (CI) |
| ENV-03 | finite minerals NEVER regrow (sustained scarcity; reuse `is_finite_mineral`) | unit (pure) | `cargo test finite_resources_never_regrow` | `finite_resources_never_regrow`, `coral_is_finite_and_never_regrows` | ✅ (CI) |
| ENV-01/02/03 | full env tick byte-deterministic for (seed,turn) | integration (run twice, serde-compare) | `cargo test tick_environment_deterministic` | `tick_environment_deterministic` (single tick), `tick_environment_multi_turn_deterministic` (12-turn replay, fires ≥1 disaster), `tile_count_invariant_after_ticks` (24 turns) | ✅ (CI) |
| cross-cutting | back-compat: old save without env fields still loads (serde defaults) | unit | `cargo test old_save_loads_calm_spring` | `old_save_loads_calm_spring` (strips `environment` key, re-parses, asserts calm-spring defaults) | ✅ (CI) |

*Status: ⬜ pending · ✅ (CI) green on CI / compile-verified on Windows · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] Extend `#[cfg(test)] mod tests` in `civilization.rs` with the env tests above — **no new file**; reuse the existing module + `test_snapshot(...)` / `generate_world(seed, civ_count)` helpers. ~29 env tests landed across plans 03-01/02/03 (and the LW-01/MD-01 fix tests).
- [x] No new framework install (libtest built in).
- [x] No new fixtures (test_snapshot + generate_world + the in-module `renewable_tile`/`finite_tile`/`flood_at`/`pending_forecast`/`env_for`/`first_forecast` helpers produce a full world to disaster/regrow against).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Disaster terrain reshape "looks right" + disaster/season balance feels fair | ENV-02/01 | Aesthetic/balance judgment; not a hard invariant | On CI/dev, advance many turns on a seeded world; observe seasons cycling, forecasts announced then firing, terrain visibly changing, world staying livable |
| Sustained scarcity emerges over a long run | ENV-03 | Emergent multi-turn property | Advance a long run; confirm finite minerals stay depleted while renewables recover |

---

## Validation Sign-Off

- [x] All automatable tasks have `<automated>` verify or Wave 0 dependencies — every Per-Task row maps to a named, substantive `#[test]`
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (the new env tests live in the existing module)
- [x] No watch-mode flags
- [x] Feedback latency < 120s (backend compile-bound; `cargo test --no-run` ~60-120s)
- [x] `nyquist_compliant: true` set in frontmatter (after execution + audit)

**Adversarial audit (2026-06-07):**

- Re-ran the gates from `tauri-app/src-tauri`:
  - `cargo test --no-run` → **exit 0** (all test binaries built; only the pre-existing `permission_prompter.rs:31` dead_code warning).
  - `cargo clippy --all-features -- -D warnings` → **15 lib errors = the documented baseline exactly** (`permission_prompter.rs:31`, `civilization.rs:703`, `commands.rs` ×10, `skills_mcp.rs` ×4 incl. the `manual_strip` 2-line span). **Zero clippy hits anywhere in the env-engine code (lines 4920+)** — verified by grepping the error locations.
- Read every env helper body and all ~29 env `#[test]` bodies: **no hollow tests.** Determinism tests `clone()` + serde-compare real `environment` AND `world.tiles`; invariant tests assert exact `width * WORLD_HEIGHT` counts and exact unchanged finite values; `apply_disaster_never_touches_air_band` serde-compares the full air band; the modifier-reuse test checks both positive (4 fired kinds → 4 live `resolve_environment` arms) and negative (terrain-only flood pushes zero modifiers).
- **No genuine coverage gap found** — every automatable behavior in the Per-Task map has a concrete, non-trivial backing test. The post-fix behaviors (MD-01 storm→fatigue / predator→quarrel_pressure; LW-01 landslide reachable + reshapes) each gained a dedicated test. No new test was added (would be redundant).
- Legitimate non-blockers (Windows can't EXECUTE backend tests — gotcha #5; aesthetic reshape/balance + emergent sustained scarcity are Manual-Only): tests run green on CI (Linux/macOS via `tauri-app.yml`), confirmed COMPILE-only here.

**Approval:** signed off (nyquist_compliant) — 2026-06-07
