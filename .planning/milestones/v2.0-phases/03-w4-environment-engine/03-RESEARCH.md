# Phase 3: W4 — Environment Engine - Research

**Researched:** 2026-06-07
**Domain:** Rust turn-loop simulation logic (Tauri backend, `civilization.rs`) — deterministic seasons, disasters, resource regrowth
**Confidence:** HIGH (the entire surface is in one file in this repo; every claim below is grep/Read-verified against `civilization.rs` at HEAD)

## Summary

This is an "add the missing logic" phase, not a schema or IPC change. The data model
(`CivEnvironment`, `CivDisaster`, `CivModifier`) already exists and is already
`#[derive(Type)]`-registered and present in `bindings.ts`; the frontend (`civStore`,
`civPilot`) already normalizes and carries `environment` (season/temperature/water_level/
disasters/forecast). `build_observation` already feeds `season`/`temperature`/`forecast`
into every civ's decision prompt. So the world is fully wired to *display and observe* an
environment — it simply never changes today (`advance_civ_turn` never touches
`snapshot.environment`). [VERIFIED: civilization.rs:782-900, 1971-2043; bindings.ts:303-367,502; civStore.ts:111-165]

The work is: insert ONE world-level `tick_environment(&mut snapshot)` call at TURN START
inside `advance_civ_turn` (after `snapshot.turn = next_turn`, before the `for civ_id in
&turn_order` decision loop — so civs observe the freshly-advanced state the same turn), and
back it with four pure, seed-deterministic helpers (advance-season, roll-forecast,
apply-disaster-to-tiles, regrow-resources). All randomness must derive from
`seed ^ turn.wrapping_mul(0x9E37_79B9) ^ <salt>` fed to `next_rng`, matching the existing
idiom used by `civ_turn_order` and `run_life_cycle`. [VERIFIED: civilization.rs:1605, 2602, 4699-4706]

Three large pieces of reusable machinery already exist and should be leveraged rather than
re-built: (1) `is_finite_mineral` already defines the exact finite/renewable split that
ENV-03 needs; (2) `CivModifier` + `resolve_environment`'s match arm already implement
`drought` and `cold_snap` effects on civs — disasters can apply those existing modifiers
instead of inventing new civ-effect plumbing; (3) `place_resource_patch`, `seabed_row_at`,
`is_substrate`, and the gather/mining terraform code show exactly how to mutate `world.tiles`
without breaking world invariants. [VERIFIED: civilization.rs:4062-4067, 2529-2578, 1767-1788, 2246-2271]

**Primary recommendation:** Add `tick_environment` at turn start with the CONTEXT-locked
sequence (fire due forecast → advance season/temp/water → regrow → roll new forecast),
implement the four pure helpers as free functions taking primitives/slices (not `&AppHandle`,
not async), reuse `is_finite_mineral` for the regrowth split and the existing
`drought`/`cold_snap` `CivModifier` kinds for disaster civ-effects, and write unit tests that
compile on Windows (`cargo test --no-run`) and run on CI. No new IPC surface, no `bindings.ts`
regen, no `tauriBrowserFallback.ts` change.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Season/temperature advancement (ENV-01) | API/Backend (`civilization.rs` turn loop) | — | Pure world-state mutation; deterministic; must persist in snapshot. No UI logic. |
| Disaster forecast/fire/log (ENV-02) | API/Backend (`tick_environment`) | — | Rolls derive from seed+turn; mutates `world.tiles` + `disasters[]` + log. Server-authoritative. |
| Terrain reshaping on disaster fire (ENV-02) | API/Backend (`apply_disaster_to_tiles`) | — | Edits the canonical `CivWorld.tiles`; renderer reads tiles passively. |
| Resource regrowth (ENV-03) | API/Backend (regrowth pass over `world.tiles`) | — | Mutates tile `amount`/`resource`; pure given season/temp. |
| Displaying season/disaster/forecast | Frontend (already done) | — | `civStore.normalizeEnvironment` + harness `render_game_to_text` already surface it; no work this phase. |
| Civs reacting to forecast | API/Backend (`build_observation` already emits it) → model | — | Already wired; the `prepare` action already exists for civs to respond. |

**Key insight:** Every capability in this phase is backend-only. The renderer/HUD work is
explicitly deferred (CONTEXT `<deferred>`, full W9). The frontend already consumes the env
state, so making the backend mutate it produces visible behavior with zero frontend changes.

## Standard Stack

This phase adds **no new dependencies**. Everything needed is already in the crate.

### Core (existing, in-repo — verified present)
| Asset | Location | Purpose | Why use it |
|-------|----------|---------|-----------|
| `next_rng(&mut u32) -> u32` (xorshift) | civilization.rs:4699 | Seed-deterministic PRNG | The repo-wide RNG idiom; required for replay + tests |
| `rand_f`/`rand_range` | civilization.rs:4708-4714 | float in [0,1) / range | Convenience over `next_rng` for probability rolls |
| `seed_from(&str) -> u32` (FNV-1a) | civilization.rs:4690 | hash a string → seed | For disaster ids / per-epicenter salts if needed |
| `is_finite_mineral(&str) -> bool` | civilization.rs:4062 | finite vs renewable classifier | **This IS the ENV-03 split** — reuse verbatim |
| `place_resource_patch(...)` | civilization.rs:1767 | stamp resource+amount onto substrate tiles | Pattern for regrowth & resource respawn (guards substrate + bounds) |
| `seabed_row_at(world, x) -> u32` | civilization.rs:1544 | top substrate row at column x | Find the surface to reshape from / clamp epicenters |
| `is_substrate(&str) -> bool` | civilization.rs:1554 | terrain ≠ air/water/deepwater | Guard tile mutations so you don't "reshape" water into nonsense |
| `CivModifier` + `resolve_environment` arms | civilization.rs:479-486, 2529-2578 | per-civ buff/debuff effects already implemented for `drought`,`cold_snap`,`food_rot`,`fatigue` etc. | Disasters apply these instead of new civ-effect code |
| `push_log` / `push_decision_log` | civilization.rs:4450, 4470 | append world/civ log entries | Forecast/fire/expiry logging (ENV-01/02 require logs) |
| `uuid` v4 | Cargo.toml:22 | unique ids | Already a dep; for `CivDisaster.id` if not using a seed-derived id |

### Supporting (existing constants/bounds — must respect)
| Constant | Value | Why it matters for reshaping |
|----------|-------|------------------------------|
| `WORLD_HEIGHT` | 96 | All tile-y mutations clamp to `< WORLD_HEIGHT` |
| `WATER_SURFACE_Y` | 6 | Rows `< 6` are "air"; never below this is solid |
| `WATER_FLOOR_Y` | 50 | Base seabed; `floor_y_at` clamps floor to `[WATER_SURFACE_Y+16, WORLD_HEIGHT-4]` |
| `DEEP_WATER_Y` | 34 | Below this, flooded tiles become `deepwater` not `water` (see mining terraform) |
| `world.width` | 128 (1 civ) → up to 512 | epicenter_x must clamp to `[0, width)` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reusing `drought`/`cold_snap` `CivModifier` for disaster civ-effects | New disaster-specific modifier kinds | New kinds need matching arms in `resolve_environment` + `modifier_from_intervention`'s `known` list; reuse is less code and already battle-tested. Add new kinds ONLY for disasters with no existing analog (e.g. `flood`, `storm`). |
| Seed-derived disaster id (`format!("dis-{turn}-{kind}")`) | `uuid::new_v4()` | uuid is non-deterministic (breaks byte-stable replay tests). **Prefer a seed/turn-derived id** so the whole tick is reproducible. |

**Installation:** none — no `npm install` / no new Cargo deps.

**Version verification:** N/A (no new packages). The only "versions" that matter are the
existing pinned deps (specta `=2.0.0-rc.25`, tauri `2.11`) — untouched by this phase. [VERIFIED: Cargo.toml]

## Architecture Patterns

### System Architecture Diagram

```
advance_civ_turn(app_handle, id)              [civilization.rs:782]
  │
  ├─ load_snapshot(&id)
  ├─ next_turn = turn+1 ; emit "TurnStarted"
  ├─ snapshot.turn = next_turn
  │
  ├─►►► INSERT HERE: tick_environment(&mut snapshot)   ◄◄◄  (NEW — turn start)
  │        │
  │        ├─ 1. fire_due_forecast:  if forecast due this turn →
  │        │        move forecast → disasters[] ;
  │        │        apply_disaster_to_tiles(&mut world.tiles, &disaster, width)   [pure]
  │        │        push CivModifier (reuse drought/cold_snap; new flood/storm)   [optional]
  │        │        push_log("disaster", ...)
  │        ├─ 2. advance_season(env, turn) → (season, turn_of_season, temperature, water_level)  [pure]
  │        │        on season wrap: push_log("season", ...)
  │        ├─ 3. regrow_resources(&mut world.tiles, season, temperature)          [pure]
  │        ├─ 4. tick disaster countdowns (remaining_turns--, retain >0, log expiry)
  │        └─ 5. roll_forecast(seed, turn, &env) → Option<CivDisaster>            [pure]
  │                 if Some → set env.forecast ; push_log("forecast", ...)
  │
  ├─ turn_order = civ_turn_order(snapshot)
  ├─ for civ in turn_order:                    ◄ civs now OBSERVE updated env
  │     observation = build_observation(...)   ◄ already emits season/temperature/forecast
  │     decision = call_model_text(...)         (the `prepare` action lets them react)
  │     apply_model_decision(...)
  │
  ├─ for civ in turn_order: resolve_environment(...)  ◄ existing per-civ env (consumes food/water,
  │                                                      APPLIES the drought/cold_snap modifiers a
  │                                                      disaster pushed) + collapse check
  ├─ tick_modifiers(snapshot)                   ◄ counts down ALL modifiers (incl. disaster ones)
  ├─ rescore_all_civs ; save_snapshot ; emit "TurnResolved"
  └─ return snapshot JSON
```

Data flow: a disaster forecast rolled on turn N's tick is OBSERVED by every civ on turns
N..N+lead via `build_observation.forecast`; when it fires (tick on turn N+lead) it both
mutates `world.tiles` (terrain) AND pushes a `CivModifier` whose per-civ effect is applied by
the EXISTING `resolve_environment` later that same turn and counted down by the EXISTING
`tick_modifiers`. This is why turn-start placement is correct: the fire's terrain change is
visible to civs' observation, and the fire's civ-effect rides the existing post-loop machinery.

### Recommended Project Structure

No new files. All additions go in `tauri-app/src-tauri/src/civilization.rs`:

```
civilization.rs
├── tick_environment(&mut snapshot)              # NEW orchestrator (impure: logs, mutates snapshot)
├── advance_season(season,turn_of_season,temp,water_level,turn,seed) -> (..)  # NEW pure
├── season_target_temp(season) -> f32           # NEW pure (or const table)
├── roll_forecast(seed, turn, &env, world_width, &regions) -> Option<CivDisaster>  # NEW pure
├── disaster_kinds_for(season, biome) -> &[..]   # NEW pure (weights/eligibility)
├── apply_disaster_to_tiles(&mut tiles, &disaster, width) # NEW pure (bounded mutation)
├── regrow_resources(&mut tiles, season, temperature)     # NEW pure
├── is_renewable(resource) / reuse is_finite_mineral      # classifier (reuse existing)
└── #[cfg(test)] mod tests { ... }               # extend existing test module (~line 4918)
```

### Pattern 1: Seed-deterministic per-turn RNG (the repo idiom)
**What:** derive a fresh `u32` rng each turn from `seed` + `turn` + a per-purpose salt, then
draw with `next_rng`. Never use wall-clock / `rand` crate.
**When to use:** every probabilistic decision in `tick_environment` (forecast roll, disaster
kind/epicenter/radius, temperature noise).
**Example:**
```rust
// Source: civilization.rs:1605 (civ_turn_order) and :2602 (run_life_cycle) — the established pattern
let mut rng = (snapshot.seed
    ^ snapshot.turn.wrapping_mul(0x9E37_79B9)
    ^ 0xE0_5A_F1_07_u32)            // unique salt per subsystem (pick a NEW constant for env)
    .max(1);                         // xorshift requires nonzero state
let p = rand_f(&mut rng);            // [0,1) probability
```
[VERIFIED: civilization.rs:1605, 2602, 4699-4714]

### Pattern 2: Bounded, invariant-safe tile mutation (terraform)
**What:** when reshaping terrain, clamp x to `[0,width)` and y to `< WORLD_HEIGHT`, look up the
tile by `(x,y)`, and only convert with the same rules world-gen/mining use: emptied substrate
below the seabed becomes `water` (or `deepwater` if `y >= DEEP_WATER_Y`); flooding raises
water; never put substrate above `WATER_SURFACE_Y`.
**When to use:** `apply_disaster_to_tiles`.
**Example:**
```rust
// Source: civilization.rs:2246-2271 (gather/mining terraform) + 1776-1786 (place_resource_patch bounds)
let surface = seabed_row_at(world, tx);            // top substrate row at column
if let Some(tile) = tiles.iter_mut().find(|t| t.x == tx && t.y == ty) {
    if ty > surface + 1 {                          // only below the seabed surface
        tile.terrain = if ty >= DEEP_WATER_Y { "deepwater" } else { "water" }.to_string();
        tile.resource = None;
        tile.amount = 0;
    }
}
```
**Critical invariants to preserve** (so the determinism + colony tests keep passing):
- Tile **count never changes** (mutate in place; never push/remove tiles). World-gen and the
  determinism test assert `tiles.len() == width * WORLD_HEIGHT`. [VERIFIED: civilization.rs:4953, 4978]
- Keep at least the spawn columns livable — don't flood a colony's whole home region floor to
  water in one fire (bounded `radius`, bounded `intensity`). `should_collapse` only fires on
  zero population, but destroying all buildable seabed would soft-brick a colony.
- Surface-stripping vs void-flooding: mining a surface block (`ty <= surface+1`) strips ore but
  keeps the seabed solid so `seabed_row_at` stays stable and buildings don't fall into craters.
  Mirror this for quake/landslide. [VERIFIED: civilization.rs:2248-2271]

### Pattern 3: Reuse existing `CivModifier` kinds for disaster civ-effects
**What:** a fired disaster pushes a `CivModifier` onto `snapshot.modifiers`; the EXISTING
`resolve_environment` (civilization.rs:2529-2578) already has match arms for `drought` and
`cold_snap` (and `food_rot`, `fatigue`, `quarrel_pressure`, plus buffs), and `tick_modifiers`
already counts them down. So a `drought`/`heatwave` disaster → push `drought` modifier;
`cold_snap`/`ice` disaster → push `cold_snap` modifier. For genuinely new effects (flood,
storm, quake), either add a new match arm in `resolve_environment` OR represent the effect
purely as a terrain change + a direct one-shot health/resource hit at fire time.
**Example:**
```rust
// Source: civilization.rs:3900-3907 (modifier_from_intervention construction shape)
snapshot.modifiers.push(CivModifier {
    id: format!("dis-{}-{}", snapshot.turn, kind),   // seed/turn-derived, NOT uuid → replayable
    kind: "drought".to_string(),                     // REUSE existing kind → existing effect arm
    label: "Drought".to_string(),
    polarity: "debuff".to_string(),
    remaining_turns: duration,
    intensity,
});
```
[VERIFIED: civilization.rs:2533-2542 (drought/cold_snap arms exist), 2586-2593 (tick_modifiers), 3900-3907 (construction)]

### Anti-Patterns to Avoid
- **uuid/wall-clock in the env tick:** breaks byte-stable replay tests (`world_generation_is_deterministic_by_seed` pattern). Use seed+turn-derived ids and rng only.
- **Adding/removing tiles during reshaping:** breaks `tiles.len() == width*WORLD_HEIGHT`. Mutate in place only.
- **Regrowing finite minerals:** ENV-03 explicitly requires finite stays depleted. Gate regrowth on `!is_finite_mineral(res)`.
- **Putting the tick at turn END:** civs wouldn't observe the new season/forecast until the following turn, defeating the `prepare`-ahead design and CONTEXT's locked "turn start" decision.
- **New fields on `CivEnvironment`/`CivDisaster` without `#[serde(default)]`:** breaks back-compat load of old saves and (if a registered type changes) forces a `bindings.ts` regen. Avoid adding fields; if unavoidable, add `#[serde(default)]` AND regenerate bindings (see gotcha).
- **A strict struct for any save-adjacent map:** not applicable here (env is already a struct), but don't touch the config-map gotcha.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Finite vs renewable classification | A new resource enum/list | `is_finite_mineral` (civilization.rs:4062) | Already the single source of truth used by the mining/W10 code; duplicating it risks drift |
| Per-civ disaster effect (drought/cold) | New civ-stat mutation code | Push `CivModifier{kind:"drought"|"cold_snap"}` | `resolve_environment` already applies these; `tick_modifiers` already expires them |
| Random number generation | `rand` crate / `SystemTime` seeds | `next_rng`/`rand_f`/`rand_range` | Repo idiom; deterministic; required for tests; no new dep |
| Stamping resources onto tiles | Manual tile loops | `place_resource_patch` | Already guards substrate + world bounds |
| Finding the seabed / livable surface | Manual min-y scan | `seabed_row_at` | Handles empty columns, used everywhere |
| Logging | Manual `snapshot.log.push` | `push_log` | Handles the 240-entry ring-buffer trim |
| Surfacing env to frontend/harness | New IPC/serializer | nothing — already done | `civStore.normalizeEnvironment` + observation already read it |

**Key insight:** ~70% of this phase is wiring up logic that calls *existing* helpers in the
right order with deterministic RNG. The genuinely new code is the four pure helpers and the
disaster-kind table. Building parallel infrastructure (new RNG, new modifier system, new
finite/renewable list) would be slower AND would create drift bugs.

## Runtime State Inventory

> This is a backend logic-addition phase (new functions + one call site), **not** a rename/
> refactor/migration. No stored strings are being renamed. The relevant "state" question is
> instead **save-format back-compat**, covered below.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data (saved snapshots) | Saved `CivSessionSnapshot` JSON on disk carry `environment` with `#[serde(default = "default_environment")]` → old saves load as calm spring. `disasters`/`forecast` already default-safe. | None — existing `#[serde(default)]` covers it. **Do not add non-defaulted fields.** |
| Live service config | None — civ sessions are local JSON files, no external service. | None — verified: `save_snapshot` writes local files (civilization.rs:4509). |
| OS-registered state | None — no scheduler/daemon registrations involved. | None. |
| Secrets/env vars | None — env tick reads only `seed`/`turn`/world; no API keys. | None. |
| Build artifacts | If (and only if) a `#[derive(Type)]` struct field changes, `bindings.ts` must be regenerated via `cargo run --bin export_bindings` (headless bin exists at src/bin/export_bindings.rs). | **Likely none** — this phase adds no fields and no commands; confirm during plan that `CivEnvironment`/`CivDisaster` field sets are unchanged. If unchanged → no regen. |

**Canonical answer:** After the code lands, no runtime system holds a stale string. The only
back-compat concern is the save format, which the existing `#[serde(default)]` attributes
already handle. Plan tasks must NOT add non-defaulted fields to env structs.

## Common Pitfalls

### Pitfall 1: Non-determinism creeping into the env tick
**What goes wrong:** A `uuid::new_v4()` disaster id, a `SystemTime`-seeded rng, or
`HashMap` iteration order in a roll makes two runs of the same `(seed, turn)` diverge.
**Why it happens:** uuid/time are the "obvious" id/seed sources; HashMap iteration is unordered.
**How to avoid:** Derive every id from `(seed, turn, kind)`; seed every rng from
`seed ^ turn.wrapping_mul(0x9E37_79B9) ^ salt`; iterate `regions`/tiles by index/Vec order
(both are `Vec`), never by `HashMap`.
**Warning signs:** A determinism test (two `advance`/`tick` runs → byte-compare) fails intermittently or on CI but "passes" locally.

### Pitfall 2: Terrain reshaping that soft-bricks a colony or corrupts invariants
**What goes wrong:** Flooding/collapsing too large a radius removes all buildable seabed near a
spawn, or a y-index escapes `[0, WORLD_HEIGHT)` / x escapes `[0, width)` and writes the wrong tile (or panics on out-of-range arithmetic).
**Why it happens:** Unbounded `radius`/`intensity`; forgetting to clamp `epicenter_x ± radius`.
**How to avoid:** Clamp epicenter to `[1, width-2]` (mirrors `found_colony`'s spawn clamp,
civilization.rs:1350); cap `radius` small (e.g. ≤ ~8) and `intensity` (e.g. ≤ 3); use
`saturating_sub`/`.min(width)` like `place_resource_patch`; only convert tiles BELOW
`seabed_row_at(world, x)` to water; never touch `y < WATER_SURFACE_Y`.
**Warning signs:** `should_collapse` fires unexpectedly; a colony can no longer build; tile count assertion fails.

### Pitfall 3: Finite resources accidentally regrowing (ENV-03 violation)
**What goes wrong:** The regrowth pass ticks `amount` back up on ore/stone/etc., destroying the "sustained scarcity" requirement.
**Why it happens:** Regrowing "all resource tiles below their original amount" without filtering.
**How to avoid:** Gate the regrowth loop on `tile.resource.as_deref().is_some_and(|r| is_renewable(r))` where `is_renewable(r) == !is_finite_mineral(r)` for known resources. Note: a tile whose finite resource was fully mined has `resource: None` (see gather), so it's naturally skipped — but a *partially* mined finite tile still has `resource: Some("ore")`; the filter must still exclude it.
**Warning signs:** A test that mines an ore tile then ticks N turns sees `amount` recover.

### Pitfall 4: "coral" classification contradiction (CONTEXT vs existing code)
**What goes wrong:** CONTEXT's prose lists `coral` as a *renewable* (organic) example, but the
existing `is_finite_mineral` (civilization.rs:4065) lists `coral` as **finite** (it's mined
with stone tools, depletes, floods). If the plan treats coral as renewable for regrowth, it
contradicts the mining/W10 behavior and the established classifier.
**Why it happens:** Coral is biologically organic but mechanically a mined finite block here.
**How to avoid:** **Defer to `is_finite_mineral` as the source of truth** (coral = finite, no
regrowth) unless the plan deliberately decides to reclassify it AND updates `is_finite_mineral`
+ the mining code in lockstep. Flag this as a micro-decision for the planner. The clean
renewable set grounded in code = BIOMES resources MINUS `is_finite_mineral` =
`{moss, fiber, wood, kelp, herbs}` (note: surface gather maps `moss`→food).
[VERIFIED: civilization.rs:4062-4067 vs CONTEXT line 67; BIOMES resources lines 91-246]

### Pitfall 5: Adding a new `CivModifier` kind without an effect arm
**What goes wrong:** A disaster pushes `kind:"flood"` but `resolve_environment` has no `"flood"`
arm → the modifier shows in observation/UI but does nothing to civs (silent no-op).
**Why it happens:** The modifier-effect switch (civilization.rs:2533-2576) only handles a fixed
set; the `_ => {}` arm swallows unknowns.
**How to avoid:** For each new disaster civ-effect, either reuse an existing kind, OR add the
matching arm in `resolve_environment`, OR model the effect as a direct one-shot at fire time
(immediate health/resource delta in `tick_environment`) rather than a lingering modifier.
**Warning signs:** A flood "happens" (terrain changes, log entry) but civ health/morale is unaffected.

## Code Examples

Verified patterns from this codebase (the authoritative source for this phase):

### Deterministic season/temperature advance (pure helper shape)
```rust
// Pattern grounded in: const table style (BIOMES, civilization.rs:91) + rng idiom (:1605)
const SEASON_LEN: u32 = 8; // Claude's discretion per CONTEXT
const SEASONS: [&str; 4] = ["spring", "summer", "autumn", "winter"];
fn season_target_temp(season: &str) -> f32 {
    match season { "summer" => 24.0, "autumn" => 14.0, "winter" => 4.0, _ => 14.0 }
}
/// Pure: given current season state + turn/seed, return the next (season, turn_of_season,
/// temperature, water_level). No I/O, no logging — caller logs the season change.
fn advance_season(season: &str, turn_of_season: u32, temperature: f32, water_level: i32,
                  turn: u32, seed: u32) -> (String, u32, f32, i32) {
    let mut tos = turn_of_season + 1;
    let mut idx = SEASONS.iter().position(|&s| s == season).unwrap_or(0);
    if tos >= SEASON_LEN { tos = 0; idx = (idx + 1) % 4; }
    let target = season_target_temp(SEASONS[idx]);
    let mut rng = (seed ^ turn.wrapping_mul(0x9E37_79B9) ^ 0xE05A_F107).max(1);
    let noise = rand_range(&mut rng, -0.6, 0.6);
    let temp = temperature + (target - temperature) * 0.25 + noise;   // smooth drift
    let water = match SEASONS[idx] { "winter" => -2, "spring" => 2, _ => 0 };
    (SEASONS[idx].to_string(), tos, round1(temp), (water_level + water).clamp(-6, 6))
}
```
*(`round1` exists at civilization.rs:4914; `rand_range` at :4712.)*

### Resource regrowth pass (reuses the finite classifier)
```rust
// Source: is_finite_mineral civilization.rs:4062; tile shape :334
fn is_renewable(resource: &str) -> bool { !is_finite_mineral(resource) }
/// Pure: renewable tiles tick toward a cap; finite tiles untouched. Season scales the rate.
fn regrow_resources(tiles: &mut [CivTile], season: &str, temperature: f32) {
    let rate = match season {
        "spring" | "summer" => 2,
        "autumn" => 1,
        _ => 0,                       // winter: no regrowth
    };
    if rate == 0 || temperature < 2.0 { return; }
    const CAP: i32 = 18;              // grounded in world-gen patch amounts (6..18, civilization.rs:1174)
    for tile in tiles.iter_mut() {
        if let Some(res) = tile.resource.as_deref() {
            if is_renewable(res) && tile.amount < CAP {
                tile.amount = (tile.amount + rate).min(CAP);
            }
        }
    }
}
```

### Disaster epicenter clamp + terrain reshape (invariant-safe)
```rust
// Source: clamp pattern found_colony :1350; flood/void rules gather :2262-2271
fn apply_disaster_to_tiles(tiles: &mut [CivTile], dis: &CivDisaster, width: u32) {
    let cx = dis.epicenter_x.clamp(1, width.saturating_sub(2));
    let r = dis.radius.min(8);
    let lo = cx.saturating_sub(r);
    let hi = (cx + r).min(width.saturating_sub(1));
    for x in lo..=hi {
        // find this column's seabed surface from the slice (no &CivWorld here → scan the slice)
        let surface = tiles.iter().filter(|t| t.x == x && is_substrate(&t.terrain))
            .map(|t| t.y).min().unwrap_or(WORLD_HEIGHT - 2);
        match dis.kind.as_str() {
            "flood" => { /* raise water: convert top 1-2 substrate rows to water */
                for ty in surface..(surface + 2).min(WORLD_HEIGHT) {
                    if let Some(t) = tiles.iter_mut().find(|t| t.x == x && t.y == ty) {
                        if is_substrate(&t.terrain) {
                            t.terrain = if ty >= DEEP_WATER_Y { "deepwater" } else { "water" }.into();
                            t.resource = None; t.amount = 0;
                        }
                    }
                }
            }
            "quake" | "landslide" => { /* collapse a sub-surface tile to void, like mining */
                let ty = (surface + 2).min(WORLD_HEIGHT - 1);
                if let Some(t) = tiles.iter_mut().find(|t| t.x == x && t.y == ty) {
                    if is_substrate(&t.terrain) && ty > surface + 1 {
                        t.terrain = if ty >= DEEP_WATER_Y { "deepwater" } else { "water" }.into();
                        t.resource = None; t.amount = 0;
                    }
                }
            }
            _ => {} // storm/heatwave/cold_snap/predator_incursion = no terrain edit (civ-effect only)
        }
    }
}
```
*(`is_substrate` :1554, `DEEP_WATER_Y` :23, `WORLD_HEIGHT` :14 — all verified present.)*

### Insertion point in advance_civ_turn
```rust
// Source: civilization.rs:782-800
snapshot.turn = next_turn;
tick_environment(&mut snapshot);          // ◄ INSERT exactly here (after turn++, before turn_order)
let turn_order = civ_turn_order(&snapshot);
for civ_id in &turn_order { /* civs observe the updated env */ }
```

### Unit test pattern (compiles on Windows via `cargo test --no-run`)
```rust
// Source: existing tests civilization.rs:4918-5028 (mod tests, test_snapshot, determinism)
#[test]
fn advance_season_is_deterministic_and_wraps() {
    let a = advance_season("spring", 7, 14.0, 0, 5, 1234);
    let b = advance_season("spring", 7, 14.0, 0, 5, 1234);
    assert_eq!(a, b);                                   // determinism
    assert_eq!(a.0, "summer"); assert_eq!(a.1, 0);     // wrap on SEASON_LEN
}
#[test]
fn finite_resources_never_regrow() {
    let mut tiles = vec![CivTile { x:0,y:60,terrain:"stone".into(),
        resource:Some("ore".into()), amount:3, biome:"".into() }];
    regrow_resources(&mut tiles, "summer", 24.0);
    assert_eq!(tiles[0].amount, 3);                     // ENV-03: finite stays depleted
}
```

## State of the Art

| Old (current main) | New (this phase) | Impact |
|--------------------|------------------|--------|
| `advance_civ_turn` never touches `snapshot.environment` | `tick_environment` mutates it every turn | World stops being stale (ENV-01/02/03) |
| `CivEnvironment` is a calm constant from W1 | Seasons drift, disasters fire, resources regrow | Already-wired frontend/harness now show live data |
| Disasters only ever come from observer `trigger_event` intervention | Disasters self-spawn deterministically via forecast | Emergent environmental pressure (seam for Phase 5 genetics) |

**Deprecated/outdated:** nothing removed. `tauriBrowserFallback.ts` `advancePreviewCiv` is a
cosmetic stub (canned food/water nudge + fake log; still uses the legacy single-`civilization`
shape, not `civs[]`) — it is intentionally NOT a real engine mirror and should remain a stub.
[VERIFIED: tauriBrowserFallback.ts:498-533]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `tauriBrowserFallback.ts` does NOT need a mirrored env tick (it's a cosmetic preview stub, not a real engine mirror, and already uses the legacy snapshot shape) | State of the Art / Architecture | LOW — if a stakeholder wants the browser preview to *also* show seasons, a small optional mirror could be added; but no requirement asks for it and the stub is already divergent. |
| A2 | No `bindings.ts` regen needed because no `#[derive(Type)]` field/command changes | Runtime State Inventory | MEDIUM — true ONLY if the plan adds no fields to `CivEnvironment`/`CivDisaster`. If a plan adds e.g. a `forecast_eta` field, regen IS required (headless bin exists). Planner must hold the no-new-field line or add the regen task. |
| A3 | Specific numbers (SEASON_LEN=8, temp targets, regrowth rate/cap, radius≤8, forecast lead 2-3) are reasonable defaults | Code Examples | LOW — all are explicitly Claude's-discretion per CONTEXT; they are starting values to be tuned, not load-bearing facts. |
| A4 | Coral should follow `is_finite_mineral` (finite, no regrow), overriding CONTEXT's "renewable" prose | Pitfall 4 | MEDIUM — micro-decision for the planner; either choice is defensible but they must not contradict the mining code. |
| A5 | Reusing `drought`/`cold_snap` `CivModifier` kinds for disaster civ-effects is preferable to new kinds | Pattern 3 / Don't Hand-Roll | LOW — purely an implementation-economy call; new kinds work too if matching arms are added. |

## Open Questions

1. **Coral: renewable or finite?**
   - What we know: `is_finite_mineral` (code, authoritative) = finite; CONTEXT prose = renewable example.
   - What's unclear: which wins.
   - Recommendation: follow code (finite, no regrow) unless the plan reclassifies it AND updates `is_finite_mineral` + mining in lockstep. Surface as a one-line plan decision.

2. **Should new disaster civ-effects (flood/storm/predator_incursion) use new modifier kinds, one-shot hits, or terrain-only?**
   - What we know: existing `resolve_environment` arms cover drought/cold_snap; `_ => {}` swallows unknowns.
   - What's unclear: the desired severity model per disaster.
   - Recommendation: terrain-only for flood/quake (the physical-reshape requirement), reuse drought/cold_snap modifiers for heat/cold, one-shot morale hit for storm, and `predator_incursion` = forecast + log + (Phase 4 spawns the predator). Keep effects bounded.

3. **Forecast lead time vs disaster duration interplay**
   - What we know: `forecast: Option<CivDisaster>` holds the NEXT one; `prepare` action exists for civs to respond.
   - What's unclear: whether to store the "fires on turn T" target inside the existing `CivDisaster` fields (it has no eta field) without adding a field.
   - Recommendation: derive eta deterministically from `(seed, turn)` at roll time and store the disaster in `forecast` for `lead` turns by re-checking each tick (e.g. fire when a seed-derived countdown hits 0, tracked via the disaster's `remaining_turns` repurposed as "turns until fire" while in `forecast`, then reset to its active duration on fire). This avoids adding a field (preserves A2 / no bindings regen). Plan must define this convention precisely.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust toolchain (cargo) | building/checking the backend | ✓ (CI uses 1.95.0 per CLAUDE.md; local present) | — | — |
| `cargo check` / `clippy` / `test --no-run` (Windows) | local verification | ✓ | — | — |
| `cargo test` execution (Windows) | running backend tests | ✗ (WebView2 DLL loader blocks harness, gotcha #5) | — | **CI (Linux/macOS) runs them**; locally use `cargo test --no-run` to confirm compile |
| `uuid` v4 | (optional) ids | ✓ | 1.6 | seed/turn-derived id (preferred for determinism) |
| `cargo run --bin export_bindings` | bindings regen (only if types change) | ✓ (bin exists) | — | not needed if no type change |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** running `cargo test` on Windows → fall back to
`cargo test --no-run` locally (compile-only) + CI for execution. This is the governing
constraint for the whole phase's validation.

## Validation Architecture

> nyquist_validation = true (.planning/config.json:11) → section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Rust built-in `#[test]` (libtest) in `civilization.rs` `#[cfg(test)] mod tests` (civilization.rs:4918) |
| Config file | none (cargo built-in); crate = `tauri-app/src-tauri` (`xolotl` / lib `xolotl_lib`) |
| Quick run command (Windows, compile-only) | `cargo test --no-run -p xolotl` (from `tauri-app/src-tauri`) — gotcha #5: tests can't EXECUTE on Windows |
| Quick check command (Windows) | `cargo check` then `cargo clippy --all-features -- -D warnings` (must add ZERO new warnings over the 16-error baseline in `.planning/phases/01-.../deferred-items.md`) |
| Full suite command (CI Linux/macOS) | `cargo test` (executes the unit tests, including the new env tests) via `.github/workflows/tauri-app.yml` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ENV-01 | season advances + wraps deterministically; temperature drifts toward target; same (seed,turn) ⇒ identical result | unit (pure `advance_season`) | `cargo test -p xolotl advance_season` (CI) / `--no-run` (Win) | ❌ Wave 0 — add to existing `mod tests` |
| ENV-01 | season change is logged + rides snapshot.environment | integration (call `tick_environment` on a `test_snapshot`, assert env fields + a "season" log entry) | `cargo test -p xolotl tick_environment` (CI) | ❌ Wave 0 |
| ENV-02 | forecast is rolled, announced K turns ahead, then fires into `disasters[]` deterministically | unit (`roll_forecast`) + integration (multi-turn `tick_environment` loop) | `cargo test -p xolotl forecast` (CI) | ❌ Wave 0 |
| ENV-02 | fired disaster physically reshapes `world.tiles` boundedly AND preserves invariants (tile count constant, x/y in bounds, no air below surface) | unit (`apply_disaster_to_tiles` on a synthetic/`generate_world` tile vec) | `cargo test -p xolotl apply_disaster` (CI) | ❌ Wave 0 |
| ENV-02 | every forecast/fire/expiry is logged | integration (assert log kinds after `tick_environment`) | `cargo test -p xolotl disaster_logged` (CI) | ❌ Wave 0 |
| ENV-03 | renewable resources regrow toward a cap, scaled by season (zero in winter) | unit (`regrow_resources`) | `cargo test -p xolotl regrow` (CI) | ❌ Wave 0 |
| ENV-03 | finite minerals NEVER regrow (sustained scarcity) | unit (`regrow_resources` on an ore tile) | `cargo test -p xolotl finite_resources_never_regrow` (CI) | ❌ Wave 0 |
| ENV-01/02/03 | full env tick is byte-deterministic for a given (seed,turn) | integration (run `tick_environment` twice on cloned snapshots, serde-compare) | `cargo test -p xolotl tick_environment_deterministic` (CI) | ❌ Wave 0 |
| cross-cutting | back-compat: old save without env fields still loads (serde defaults) | unit (deserialize a minimal snapshot JSON) | covered by existing parse/migration tests pattern; extend if a field is touched | partial |

### Sampling Rate
- **Per task commit:** `cargo check` + `cargo clippy --all-features -- -D warnings` (zero NEW warnings vs the documented 16-error baseline) + `cargo test --no-run -p xolotl` (compile-only on Windows). Plus `npx tsc --noEmit` IF any `.ts` touched (expected: none).
- **Per wave merge:** same as above; on CI, full `cargo test` executes the new unit tests.
- **Phase gate:** CI `cargo test` green (Linux/macOS) before `/gsd-verify-work`; clippy clean for all newly-added lines; bindings unchanged (or regenerated + committed if a type changed).

### Wave 0 Gaps
- [ ] Extend `#[cfg(test)] mod tests` in `civilization.rs` with the env tests above — **no new file**, reuse the existing module + `test_snapshot`/`generate_world` helpers (civilization.rs:4918-5028).
- [ ] No new framework install needed (libtest is built in).
- [ ] No new fixtures needed — `test_snapshot(id,name,model,seed,now)` and `generate_world(seed,civ_count)` already produce a full world to disaster/regrow against.

*(Determinism is the load-bearing automated property; terrain-reshape "looks right" and disaster
balance are partly judgment calls — assert the invariants automatically (tile count, bounds,
finite-never-regrows, byte-determinism) and leave aesthetic tuning to manual CI observation.)*

## Security Domain

> No external input, no network, no auth surface in this phase. ASVS categories are largely N/A;
> the only relevant control is input/bounds validation on the (internally-generated) disaster
> parameters so a runaway value can't corrupt world state.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (local desktop, no auth in this path) |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes (internal) | Clamp disaster `epicenter_x`/`radius`/`intensity`/`remaining_turns`; clamp all tile x/y to world bounds; use `saturating_*` arithmetic (no overflow panics — `unsafe_code` is forbid by project convention) |
| V6 Cryptography | no | — (PRNG is for simulation, not security; `next_rng` is fine) |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Integer overflow / panic on tile arithmetic | Denial of Service | `saturating_sub`/`.min()`/`.clamp()` (repo idiom); never raw `-`/`+` on `u32` near 0/max |
| Out-of-bounds tile write corrupting the world | Tampering (of own state) | Clamp x∈[0,width), y∈[0,WORLD_HEIGHT); look up by (x,y) and skip if absent |
| Non-deterministic state divergence (replay/eval integrity) | Tampering / Repudiation | Seed+turn-derived RNG and ids only; no wall-clock, no uuid in the tick |

## Sources

### Primary (HIGH confidence) — in-repo, Read/Grep-verified at HEAD
- `tauri-app/src-tauri/src/civilization.rs` — `CivEnvironment`/`CivDisaster`/`CivModifier` (479-523), `advance_civ_turn` (782-900), `build_observation`/`build_decision_prompt` (1971-2063), `generate_world`/`floor_y_at`/`seabed_ripple`/`biome_layout` (1055-1238), `place_resource_patch`/`seabed_row_at`/`is_substrate` (1544-1788), gather/mining terraform (2206-2312), `resolve_environment`/`tick_modifiers` (2504-2593), modifier construction (3876-3908), `is_finite_mineral`/`required_mining_tier`/`known_resource` (4062-4112), `push_log`/`push_decision_log` (4450-4493), `seed_from`/`next_rng`/`rand_f`/`rand_range`/`round1` (4690-4915), `mod tests`/`test_snapshot`/determinism tests (4918-5028, 4948-5028), BIOMES (91-246), world constants (13-23)
- `tauri-app/src/bindings.ts` — CivDisaster/CivEnvironment already exported (303-367,502)
- `tauri-app/src/stores/civStore.ts` — `normalizeEnvironment` already surfaces env (111-165)
- `tauri-app/src/lib/civPilot.ts` — carries `environment` (118)
- `tauri-app/src/lib/tauriBrowserFallback.ts` — `advancePreviewCiv` is a cosmetic stub (498-533, 1245-1247)
- `tauri-app/src-tauri/Cargo.toml` — deps (uuid 1.6, specta pin), edition 2021, no `[lints]` (so no pedantic for this crate)
- `.planning/config.json` — nyquist_validation true (11)
- `.planning/phases/01-.../deferred-items.md` — 16-error clippy baseline
- `CLAUDE.md` — gotchas 1 (bindings regen), 5 (cargo test can't run on Windows)

### Secondary (MEDIUM confidence)
- `.planning/phases/03-w4-environment-engine/03-CONTEXT.md` — locked decisions (the design contract)
- `.planning/REQUIREMENTS.md` — ENV-01/02/03 wording
- `.planning/STATE.md` — phase order, v2.0 constraints

### Tertiary (LOW confidence)
- None — no external/web sources were needed; this phase is fully internal to the repo.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every helper is grep-verified present in `civilization.rs`; no external deps.
- Architecture (insertion point + sequence): HIGH — CONTEXT locks the sequence; the call site is unambiguous (after turn++, before turn_order at civilization.rs:794-798).
- Pitfalls: HIGH — derived directly from existing invariants/tests (determinism test, tile-count assertion, mining terraform rules) and one verified CONTEXT-vs-code contradiction (coral).
- Validation: HIGH — Windows constraint (gotcha #5) and the libtest pattern are confirmed; the only judgment is which behaviors are auto- vs manual-testable.

**Research date:** 2026-06-07
**Valid until:** 2026-07-07 (stable — internal repo logic; only invalidated if `civilization.rs` env/world structs or the turn loop are refactored before planning)
