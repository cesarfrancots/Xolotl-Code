# Phase 3: W4 — Environment Engine - Context

**Gathered:** 2026-06-07
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (decisions by Claude per user's "keep going on your own" directive; proposals auto-accepted)

<domain>
## Phase Boundary

The world stops being stale. A world-level environment tick runs each turn inside
`advance_civ_turn`: seasons advance and drift temperature (ENV-01); disasters are
forecast ahead of time, then trigger, get logged, and physically reshape terrain
tiles (ENV-02); renewable resources regrow over time while finite resources stay
depleted, sustaining scarcity (ENV-03).

Delivers ENV-01, ENV-02, ENV-03. The `CivEnvironment`/`CivDisaster` data model
already EXISTS (calm default from W1) — this phase adds the LOGIC that mutates it
each turn, plus the resource-regrowth pass over `world.tiles`.

In scope: backend `tauri-app/src-tauri/src/civilization.rs` (the turn loop + new
pure environment helpers), and any required mirror in
`tauri-app/src/lib/tauriBrowserFallback.ts` (single-player mechanics are
duplicated there — verify during planning). Out of scope: a dedicated environment
HUD/UI (deferred W9), heavy disaster VFX, genetics selection (Phase 5 consumes the
pressure this phase creates), combat predators (Phase 4 consumes `predator_incursion`).
</domain>

<decisions>
## Implementation Decisions

### Seasons & Temperature (ENV-01)
- Four-season cycle: spring → summer → autumn → winter, advancing on a
  `turn_of_season` counter with a fixed season length (default 8 turns —
  Claude's discretion). Wraps deterministically.
- Each season has a target temperature; `temperature` drifts smoothly toward the
  season target each turn (plus small seed-deterministic noise) rather than
  snapping. `water_level` shifts with season (e.g. lower/icy in winter, melt/high
  in spring) — small bounded integer deltas.
- Season/temperature are read by the regrowth pass (ENV-03) and disaster rolls
  (ENV-02), and ride the snapshot → text-state (ARENA-01, Phase 1) and the log so
  they're observable. Season change is logged (a world/session log entry).

### Disasters (ENV-02)
- A small fixed set of disaster kinds tied to season/biome/temperature (Claude's
  discretion, ~4-6): e.g. `flood`, `storm`, `drought`/`heatwave`, `cold_snap`/`ice`,
  `quake`/`landslide`, `algal_bloom`, and `predator_incursion` (the last is a hook
  Phase 4 combat consumes — Phase 3 spawns/announces it; predators themselves are P4).
- **Forecast then fire:** the `forecast: Option<CivDisaster>` field holds the NEXT
  disaster, announced K turns ahead (default 2-3 — discretion) and logged so civs
  can prepare (ties to the existing `prepare` action). When the forecast comes due,
  it moves into `disasters[]`, its effects apply, and a new forecast may be rolled.
- **Trigger** is seed-deterministic per turn (use world `seed` + `turn` so runs are
  reproducible and unit-testable), with probability/kind weighted by current
  season/temperature.
- **Physically reshape terrain (hard requirement):** when a disaster fires it
  MUTATES `world.tiles` deterministically and boundedly around its epicenter — e.g.
  flood raises `water_level`/converts shallow seabed tiles to water; quake/landslide
  shifts the seabed floor / collapses tiles; drought lowers water / hardens tiles;
  cold_snap freezes surface. Bounded blast radius; never corrupts world invariants
  (stay within width/height; preserve a livable world).
- Disasters expire after a duration; they apply ongoing modifiers via the existing
  `modifiers`/`CivModifier` path where appropriate. Every fire + forecast + expiry
  is logged.

### Resource Regrowth (ENV-03)
- Classify resources: **renewable** (organic — e.g. food, kelp, herbs, fiber, coral)
  regrow over turns up to a per-source cap; **finite** (mined — ore, stone, clay,
  amber, sulfur, glowshards, ice) stay depleted (mining in W10 removed them; they do
  NOT regrow). Exact split is Claude's discretion, grounded in the BIOMES resource
  belts + the resource list in `initial_snapshot`.
- Regrowth is a per-turn world pass over the resource belts/tiles: renewable nodes
  tick back toward their cap at a rate scaled by season/temperature (faster in
  spring/summer, slower/zero in winter). Finite nodes are skipped. Net effect:
  sustained scarcity of finite resources, recoverable renewables.

### Integration & Determinism
- Add ONE world-level `tick_environment` step in `advance_civ_turn`, run at TURN
  START (after `TurnStarted` emit / turn increment, before the civ decision loop) so
  civs observe the updated season/temperature/forecast/disaster and can react the
  same turn. Sequence: fire any due forecast (apply terrain effects) → advance
  season/temperature/water_level → regrow resources → roll/refresh the forecast.
- **Determinism:** all rolls derive from `seed` + `turn` (no wall-clock randomness),
  mirroring the existing world-gen RNG idiom — required for reproducibility and tests.
- **Pure helpers for testability:** extract pure functions (e.g.
  `advance_season(env, turn) -> (season, turn_of_season, temperature, water_level)`,
  `roll_forecast(seed, turn, env) -> Option<CivDisaster>`,
  `apply_disaster_to_tiles(tiles, &disaster) ` (bounded mutation),
  `regrow_resources(tiles, season, temperature)`), unit-tested with `cargo test`
  (compiles on Windows via `cargo test --no-run`; runs on CI per gotcha #5).

### Claude's Discretion
- Exact season length, temperature curves, disaster kind set + weights + blast radii
  + durations, forecast lead time, renewable/finite split, and regrowth rates.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `civilization.rs`: `CivEnvironment` struct (season/turn_of_season/temperature/
  water_level/disasters[]/forecast — ~488-513, calm default in `CivEnvironment::new`);
  `CivDisaster` struct (~515+, id/kind/epicenter_x/...); `advance_civ_turn` turn loop
  (~782+, increments turn, emits TurnStarted, loops `civ_turn_order`, resolves per-civ
  environment + collapse after the loop); `CivModifier`/`modifiers` for buffs/debuffs;
  `push_log`/`push_decision_log` for log entries; the seed-deterministic RNG idiom
  (`next_rng`, `seed_from`) used throughout world-gen; BIOMES resource belts + the
  per-civ resource list in `initial_snapshot`; `world.tiles`/`floor_y_at`/biome layout
  from world-gen (the terrain disasters will reshape).
- Phase 1 exposed `environment` in `render_game_to_text` (ARENA-01) and `civStore`
  normalizes it — season/disaster/forecast will surface to harness + UI automatically.

### Established Patterns
- Seed-deterministic RNG (no wall-clock); `#[serde(default)]` on new fields for
  back-compat load; pure helpers + unit tests (Phase 1 pattern); world invariants
  must hold after any tile mutation.

### Integration Points
- `advance_civ_turn` is the single turn entry point — the environment tick slots in
  there. `build_observation`/`build_decision_prompt` feed civs their view (so they
  see season/forecast). `tauriBrowserFallback.ts` may mirror turn mechanics for the
  browser preview — VERIFY during planning whether the env tick must be mirrored.

</code_context>

<specifics>
## Specific Ideas

- The data model already exists — this is an "add the missing logic" phase, not a
  schema redesign. Extend, keep `#[serde(default)]` back-compat, keep determinism.
- `predator_incursion` disaster is a deliberate seam for Phase 4 (combat/predators) —
  Phase 3 announces/spawns the event; the predators themselves are Phase 4.
- Environmental pressure (e.g. ice age / plague mortality) is the seam for Phase 5
  genetics selection — Phase 3 creates the pressure (season/temp/disaster effects on
  health/mortality hooks); Phase 5 makes genes respond.

</specifics>

<deferred>
## Deferred Ideas

- Dedicated environment HUD / disaster-management UI (deferred full-W9).
- Rich disaster VFX/animations in the renderer (Phase 2 was identity-only; light
  visual cues acceptable but not the focus).
- Genetics selection response to pressure (Phase 5).
- Wild predators that hunt axolotls (Phase 4 — consumes `predator_incursion`).

</deferred>
