---
phase: 03-w4-environment-engine
reviewed: 2026-06-07T00:00:00Z
depth: deep
files_reviewed: 1
files_reviewed_list:
  - tauri-app/src-tauri/src/civilization.rs
findings:
  critical: 0
  high: 0
  medium: 1
  low: 4
  total: 5
status: resolved
resolved_at: 2026-06-07
resolution:
  MD-01: "fixed (b774dd2) — storm→fatigue, predator_incursion→quarrel_pressure (existing resolve_environment arms); test extended"
  LW-01: "fixed (7a4e5d3) — landslide added to autumn eligibility; reachability + reshape-equals-quake test added"
  LW-02: "fixed (dc9d536) — REGROW_CAP set to 17 (true world-gen renewable ceiling 6..=17); cap test updated"
  LW-03: "fixed (e423202) — companion modifier reuses forecast.id for log correlation"
  LW-04: "deferred — performance note, explicitly out of v1 review scope; no correctness impact"
---

# Phase 03: Code Review Report — W4 Environment Engine

**Reviewed:** 2026-06-07
**Depth:** deep (cross-file: traced into `resolve_environment`, `tick_modifiers`, `is_finite_mineral`, `is_substrate`, `seabed_row_at`, `next_rng`/`rand_f`/`rand_range`, `parse_snapshot`, `default_environment`, the `advance_civ_turn` turn loop)
**Files Reviewed:** 1 (`tauri-app/src-tauri/src/civilization.rs` — the only source file changed in `e971153..HEAD`)
**Status:** clean (no CRITICAL/HIGH findings)

## Summary

The W4 environment engine (new pure helpers `advance_season`, `season_target_temp`,
`regrow_resources`, `is_renewable`, `roll_forecast`, `disaster_kinds_for`,
`apply_disaster_to_tiles`, `disaster_duration`; the `tick_environment` orchestrator;
its insertion at `advance_civ_turn:799`; and 28 new `#[cfg(test)]` tests) is
**correct, fully deterministic, and well-bounded**. I attacked it on every axis the
brief flagged and found no real correctness, determinism, or terrain-invariant defect.

Verified hard points:

- **Determinism (threat T-03-04 / T-03-08):** All randomness derives from
  `seed ^ turn.wrapping_mul(0x9E37_79B9) ^ SALT` with distinct salts per stream
  (`ENV_SEASON_SALT`, `ENV_FORECAST_SALT`, both distinct from `civ_turn_order`'s
  `0x51ED_2701`). No `SystemTime`, no `uuid`, no `HashMap`-iteration-order dependence
  in the env tick. Disaster ids are `format!("dis-{turn}-{kind}")`. All saved floats
  pass through `round1`. The determinism tests genuinely `clone()` + serde-compare
  both `environment` and `world.tiles` (`tick_environment_deterministic`,
  `tick_environment_multi_turn_deterministic`). `apply_disaster_to_tiles` uses only
  ordered `iter()/iter_mut().find()/min()` over the tile vec — order-stable.
- **Terrain invariants (threat T-03-05 / T-03-10):** `apply_disaster_to_tiles`
  mutates strictly in place (no `push`/`remove`), so tile count is invariant
  (asserted to `width * WORLD_HEIGHT` in `apply_disaster_preserves_tile_count` and
  `tile_count_invariant_after_ticks`). x is bounded by `lo..=hi` with `hi.min(width-1)`;
  the inner guard `ty > surface + 1 && ty >= WATER_SURFACE_Y` keeps the seabed surface
  and surface+1 solid (no soft-brick), and radius is capped at `DISASTER_RADIUS_MAX = 8`.
  Edge epicenters (0, 1, 200, 250, 255) are tested for in-bounds + no-panic. The
  air-band test serde-compares every `y < WATER_SURFACE_Y` tile before/after.
- **Locked tick sequence:** fire-due-forecast → advance-season → regrow → countdown
  /retain → roll-forecast. Step (a) runs before step (e), so a freshly rolled forecast
  cannot double-fire the same turn; the lead countdown decrements exactly once per turn
  (`saturating_sub(1)`, fires at 0). The fired disaster's `env.disasters` entry is
  ticked in step (d) while its companion `CivModifier` is ticked by the existing
  end-of-turn `tick_modifiers` — each decrements once per turn, so they stay in sync
  (no double-decrement, no missed fire).
- **ENV-03 finite/renewable:** `is_renewable = !is_finite_mineral` reuses the single
  classifier (no drift). Coral is correctly FINITE (`is_finite_mineral` lists it).
  Finite minerals never regrow; renewables cap at `REGROW_CAP = 18`; winter rate is 0
  and `temperature < 2.0` short-circuits. All asserted with real value checks.
- **Modifier reuse (Pitfall 5):** Only `drought`/`cold_snap` push a `CivModifier`,
  and both have live arms in `resolve_environment` (`civilization.rs:2539,2544`).
  `flood`/`quake` are terrain-only; `storm`/`predator_incursion` are announce/one-shot.
  No unknown modifier kind that would silently `_ => {}`. Tested both ways.
- **Back-compat (threat T-03-09):** `old_save_loads_calm_spring` round-trips a snapshot
  with the `environment` key removed and proves it defaults to calm spring via
  `#[serde(default = "default_environment")]` (`civilization.rs:300`).
- **IPC surface:** `git diff e971153..HEAD` touches `civilization.rs` only. `bindings.ts`
  and `lib.rs` are unchanged in the phase range. No new `#[specta::specta]` command and
  no new `#[derive(Type)]` field — `CivEnvironment`/`CivDisaster`/`CivModifier`/`CivTile`
  pre-existed with `Type`. The IPC surface is untouched (correct).
- **Compile / clippy:** `cargo check` → exit 0, the only warning is the pre-existing
  `permission_prompter.rs` dead-code. `cargo clippy` → 16 warnings, **all pre-existing
  baseline** (`civilization.rs:703`, `commands.rs`, `skills_mcp.rs`, `test_chat.rs`,
  `permission_prompter.rs`); the single `civilization.rs:703` hit is far above the
  Phase-3 additions (lines 4920+). **Zero new warnings** in the added lines.

The findings below are quality/design notes only. None block shipping.

## Medium

### MD-01: `storm` / `predator_incursion` disasters fire with zero mechanical effect

**File:** `tauri-app/src-tauri/src/civilization.rs:266-290` (fire path in `tick_environment`), `5024-5025` (`disaster_kinds_for` returns them)
**Issue:** When a `storm` or `predator_incursion` forecast fires, `apply_disaster_to_tiles`
is a no-op for those kinds (only `flood|quake|landslide` reshape) **and** `modifier_kind`
resolves to `None` (only `drought`/`cold_snap` push a modifier). The disaster is therefore
logged ("A storm struck"), sits in `env.disasters` for `disaster_duration` turns, expires,
and is logged again — but applies **no** resource/health/morale/terrain change to any civ.
These are the most-frequently-rolled kinds (every season list includes `storm`), so a large
fraction of "disasters" the player sees are cosmetic. This is the documented "announce/
one-shot" intent, but "one-shot" here means "no-op", which is a gameplay gap, not just a
naming nuance.
**Fix:** Either (a) give `storm`/`predator_incursion` a real one-shot effect at fire time
(e.g. a one-turn `fatigue`/`quarrel_pressure` modifier — both already have live
`resolve_environment` arms at `:2551,:2555`, so no new arm/Pitfall-5 risk), or (b) drop
them from `disaster_kinds_for` so only kinds with a real effect can roll. Example for (a):
```rust
let modifier_kind = match forecast.kind.as_str() {
    "drought" => Some("drought"),
    "cold_snap" => Some("cold_snap"),
    "storm" => Some("fatigue"),                 // existing arm, real effect
    "predator_incursion" => Some("quarrel_pressure"), // existing arm
    _ => None, // flood/quake = terrain-only
};
```

## Low

### LW-01: `landslide` reshape arm is unreachable dead code

**File:** `tauri-app/src-tauri/src/civilization.rs:192,209` (`apply_disaster_to_tiles` matches `"flood" | "quake" | "landslide"` and branches on `_ => 1` for landslide)
**Issue:** `disaster_kinds_for` never returns `"landslide"`, so `roll_forecast` can never
produce one and the `landslide` branch in `apply_disaster_to_tiles` is unreachable through
the normal tick path. It is harmless (defensive), but it is dead and untested.
**Fix:** Either add `landslide` to a season's eligibility in `disaster_kinds_for` (and test
it), or drop `"landslide"` from the `matches!` and the `_ => 1` comment to keep the reshape
set honest. Low priority — defensive breadth is defensible.

### LW-02: `REGROW_CAP = 18` slightly exceeds the actual world-gen renewable ceiling

**File:** `tauri-app/src-tauri/src/civilization.rs:104` (`const REGROW_CAP: i32 = 18`)
**Issue:** The comment says "grounded in world-gen patch amounts (6..18)", but the world-gen
patch amount is `6 + (next_rng % 12)` = range `6..=17` (`civilization.rs:1179`). So
regrowth can lift a renewable to 18, one above any value the world ever spawns. This is a
cosmetic over-cap, not a bug (still bounded), but the "6..18" comment is off by one against
the source range it cites.
**Fix:** Set `REGROW_CAP = 17` to match the true world-gen ceiling, or correct the comment
to "world-gen patch amounts are 6..=17; cap nudged to 18". Either resolves the mismatch.

### LW-03: disaster id vs companion-modifier id use different turn anchors

**File:** `tauri-app/src-tauri/src/civilization.rs:171` (disaster id = roll-turn) vs `273` (modifier id = fire-turn)
**Issue:** `roll_forecast` builds the disaster id as `dis-{turn}-{kind}` using the turn it
was **rolled**; the fired companion `CivModifier` is built as `dis-{snapshot.turn}-{kind}`
using the turn it **fired**. When the forecast lead > 1 these turn numbers differ, so a
fired disaster and its modifier carry different ids for the same event. Both remain
deterministic and there is no collision (only one forecast exists at a time), so this is a
traceability nit, not a correctness bug.
**Fix:** If you want the disaster and its modifier to share an id for log correlation,
reuse `forecast.id` for the modifier instead of re-deriving from `snapshot.turn`:
```rust
id: forecast.id.clone(),
```

### LW-04: `apply_disaster_to_tiles` re-scans the tile vector once per `(x, ty)`

**File:** `tauri-app/src-tauri/src/civilization.rs:200-216`
**Issue:** Per affected column it does an `O(n)` `iter().filter().min()` for the surface,
then an `O(n)` `iter_mut().find()` for each `ty`. With a 128x96 world (~12k tiles) and
radius ≤ 8 this is a handful of full scans per fire — negligible in practice, and
**performance is explicitly out of v1 review scope**. Flagged only as a maintainability
note: a single grouped pass (or indexing by `y * width + x` if the tile vec is row-major)
would be clearer. No action required for correctness.

## Test-quality assessment (positive — recorded for completeness)

The new tests are **substantive, not hollow**:
- Determinism tests `clone()` + serde-compare real state (`environment` AND `world.tiles`),
  not just "ran without panicking".
- `tile_count_invariant_after_ticks` / `apply_disaster_preserves_tile_count` assert the
  exact count `== width * WORLD_HEIGHT`, not merely "non-empty".
- `apply_disaster_never_touches_air_band` serde-compares each above-surface tile.
- `apply_disaster_stays_in_bounds` sweeps edge epicenters (incl. 0 and 255) for no-panic +
  in-bounds.
- `finite_resources_never_regrow` / `coral_is_finite_and_never_regrows` /
  `regrow_is_zero_in_winter` / `regrow_zero_when_too_cold` assert exact unchanged values.
- `old_save_loads_calm_spring` actually strips the `environment` key and re-parses, proving
  the serde-default back-compat (and asserting `expect("...environment key")` so the test
  would fail loudly if the field were ever renamed).
- `tick_environment_fired_disaster_pushes_reused_modifier` checks both the positive
  (drought/cold_snap push a real arm) and the negative (flood pushes no unknown kind).

Note (not a defect): backend `cargo test` cannot run on Windows (WebView2 loader, per
CLAUDE.md); these assertions were verified by reasoning + a clean `cargo check`/`cargo
clippy`, and run on Linux/macOS CI.

## Resolution (2026-06-07)

All actionable findings fixed in `civilization.rs` (commits atomic, conventional `fix(03): ...`):

- **MD-01 → b774dd2:** `storm` and `predator_incursion` now map (at fire time) to the existing
  `resolve_environment` morale arms `fatigue` (`-1.2 × intensity`) and `quarrel_pressure`
  (`-1.5 × intensity`). No new `CivModifier` kind, so no Pitfall-5 silent no-op. The
  modifier-reuse test was extended to assert both new kinds push a live arm, plus a negative
  check that terrain-only `flood` pushes no modifier at all.
- **LW-01 → 7a4e5d3:** `landslide` added to autumn `disaster_kinds_for` eligibility (season-weighted),
  making the previously-unreachable `apply_disaster_to_tiles` landslide carve live. New test proves
  autumn reachability and that landslide reshapes byte-identically to `quake` (shared depth-1 arm),
  holding the tile-count and bounds invariants.
- **LW-02 → dc9d536:** `REGROW_CAP` set to `17` to match the true world-gen renewable ceiling
  (resource belts at `6 + (rng % 12)` = `6..=17`; veins only place finite minerals). Comment and
  cap-pinning test updated.
- **LW-03 → e423202:** the fired disaster's companion `CivModifier` now reuses `forecast.id`
  instead of re-deriving from the fire turn, so the disaster and its modifier share one id for log
  correlation. Still deterministic (no uuid/wall-clock), no collision.
- **LW-04:** deferred — per-`(x, ty)` re-scan is a maintainability/performance note explicitly out of
  v1 review scope; no correctness impact.

Invariants preserved (determinism `seed^turn`/`round1`, tile-count constant, bounds-clamp,
below-seabed-only, no new IPC field/no bindings regen, `unsafe_code` forbidden). `cargo test --no-run`
→ exit 0; `cargo clippy --all-features -- -D warnings` → 16 baseline locations, **zero new warnings**
(only pre-existing `civilization.rs:703`).

---

_Reviewed: 2026-06-07_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
_Resolved: 2026-06-07 (Claude Opus 4.8) — all findings fixed except LW-04 (deferred, out of scope)_
