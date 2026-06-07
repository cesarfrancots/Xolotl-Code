# Phase 3: W4 — Environment Engine - Pattern Map

**Mapped:** 2026-06-07
**Files analyzed:** 1 source file (all additions land in `tauri-app/src-tauri/src/civilization.rs`)
**Analogs found:** 10 / 10 (every new piece has an exact in-file analog)

> This is a **single-file, add-the-logic** phase. There are no new files, no new IPC,
> no `bindings.ts` regen (no struct fields change — `CivEnvironment`/`CivDisaster`
> already exist and are `#[serde(default)]`-safe). Every new function copies an
> existing pattern from elsewhere in `civilization.rs`. Below, each new/modified piece
> is mapped to its closest existing analog with the exact lines to mirror.

## File Classification

| New/Modified Piece (all in `civilization.rs`) | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `tick_environment(&mut snapshot)` (NEW orchestrator) | service (turn-loop step) | event-driven / batch | `resolve_environment` (2504) + `tick_modifiers` (2586) | role-match (impure mutator over snapshot + logs) |
| `advance_season(...) -> (String,u32,f32,i32)` (NEW pure) | utility | transform | `civ_turn_order` rng idiom (1598-1611) + `round1` (4914) | exact (pure, seed-deterministic, returns derived state) |
| `roll_forecast(seed,turn,&env,...) -> Option<CivDisaster>` (NEW pure) | utility | transform | `civ_turn_order` rng idiom (1605) + `modifier_from_intervention` (3876-3908) | exact (seeded roll → constructs a struct) |
| `apply_disaster_to_tiles(&mut [CivTile], &CivDisaster, width)` (NEW pure) | utility | transform / file-I/O-analog (tile mutation) | gather/mining terraform (2247-2271) + `place_resource_patch` (1767-1788) | exact (bounded in-place tile mutation, same flood/void rules) |
| `regrow_resources(&mut [CivTile], season, temperature)` (NEW pure) | utility | transform | `place_resource_patch` loop (1776-1787) + `is_finite_mineral` (4062) | exact (in-place `amount` tick gated by classifier) |
| `is_renewable(resource) -> bool` (NEW one-liner, or inline) | utility | transform | `is_finite_mineral` (4062-4067) | exact (negation of the same classifier — reuse, don't duplicate the list) |
| Insertion of `tick_environment(&mut snapshot);` in `advance_civ_turn` | controller (call site) | request-response | `advance_civ_turn` body around 794-798 | exact (one line after `snapshot.turn = next_turn;`) |
| Disaster `CivModifier` push (drought/cold_snap reuse) | service | event-driven | `modifier_from_intervention` construction (3900-3907) | exact (reuse existing kinds → existing `resolve_environment` arms) |
| `#[cfg(test)]` pure-helper unit tests (advance_season / regrow / apply_disaster / roll_forecast) | test | request-response | `world_generation_is_deterministic_by_seed` (4948-4964) | exact (determinism + invariant asserts) |
| `#[cfg(test)]` integration test (`tick_environment` on `test_snapshot`) | test | event-driven | `intervention_grants_resources_and_scores` (5113-5136), `player_harvest_depletes_tile_and_grants_yield` (5138-5175) | exact (build `test_snapshot`, mutate, assert) |

## Pattern Assignments

### `tick_environment(&mut snapshot)` (service, orchestrator)

**Analog:** `resolve_environment` (2504-2581) for the impure "read snapshot fields, mutate civs/world, push logs" shape; `tick_modifiers` (2586-2593) for the per-turn countdown+retain shape.

**Mutator + log shape to mirror** (`resolve_environment`, 2504-2527) — take `&mut CivSessionSnapshot`, read fields, branch, call `push_log`:
```rust
fn resolve_environment(snapshot: &mut CivSessionSnapshot, civ_id: &str) {
    // ... reads snapshot.civs[ci], mutates, then:
    push_log(snapshot, "crisis", "Shortage hurt the colony", &format!(...));
}
```

**Countdown + retain shape to mirror for disaster expiry** (`tick_modifiers`, 2586-2593):
```rust
fn tick_modifiers(snapshot: &mut CivSessionSnapshot) {
    for modifier in snapshot.modifiers.iter_mut() {
        modifier.remaining_turns = modifier.remaining_turns.saturating_sub(1);
    }
    snapshot.modifiers.retain(|modifier| modifier.remaining_turns > 0);
}
```
Mirror this exactly for `snapshot.environment.disasters`: `remaining_turns = .saturating_sub(1)` then `retain(|d| d.remaining_turns > 0)`, logging each expiry before retain (or via partition).

**CONTEXT-locked sequence** (RESEARCH diagram, lines 106-117): fire due forecast → `apply_disaster_to_tiles` + push `CivModifier` + `push_log` → `advance_season` (log on season wrap) → `regrow_resources` → tick disaster countdowns (log expiry) → `roll_forecast` → set `env.forecast` + `push_log`.

---

### `advance_season(...)` (utility, pure transform)

**Analog:** the seed+turn rng idiom from `civ_turn_order` (1605) and `round1` (4914).

**RNG idiom to copy verbatim** (1605) — pick a NEW unique salt constant (not `0x51ED_2701`, which `civ_turn_order` owns):
```rust
let mut rng = (snapshot.seed ^ snapshot.turn.wrapping_mul(0x9E37_79B9) ^ 0x51ED_2701).max(1);
// then: next_rng(&mut rng) / rand_f(&mut rng) / rand_range(&mut rng, lo, hi)
```
`next_rng`/`rand_f`/`rand_range` defined at 4699-4714. `.max(1)` is mandatory — xorshift state must be nonzero.

**Rounding to copy** (`round1`, 4914): `fn round1(value: f32) -> f32 { (value * 10.0).round() / 10.0 }` — apply to the drifted temperature so saved floats stay byte-stable for determinism tests.

**Signature note:** keep it pure — take primitives (`season:&str, turn_of_season:u32, temperature:f32, water_level:i32, turn:u32, seed:u32`) and RETURN the new tuple; the caller (`tick_environment`) does the logging and field assignment. This mirrors how `civ_turn_order` returns a `Vec` rather than mutating.

---

### `roll_forecast(seed, turn, &env, ...) -> Option<CivDisaster>` (utility, pure transform)

**Analog:** rng idiom (1605) for the probability/kind/epicenter rolls; `modifier_from_intervention` (3876-3908) for the "decide eligibility, then construct a struct with a derived id" shape.

**Struct-construction shape to mirror** (`modifier_from_intervention`, 3900-3907) — but use a SEED/TURN-derived id, NOT `unix_timestamp_secs()` (that one is fine for observer interventions but breaks replay determinism here):
```rust
// existing (observer path — uses timestamp id, do NOT copy the id source):
Ok(CivModifier {
    id: format!("{}-{}", intervention.target, unix_timestamp_secs()),  // ← replace with seed/turn-derived
    kind: intervention.target.clone(),
    ...
    remaining_turns: intervention.duration.unwrap_or(4).clamp(1, 20),
    intensity: intervention.intensity.unwrap_or(1.0).clamp(0.1, 5.0),
})
```
For `CivDisaster.id` use `format!("dis-{turn}-{kind}")` (RESEARCH Pattern 3 / Anti-Patterns). Clamp `remaining_turns`/`intensity` the same way (`.clamp(...)`), and clamp `epicenter_x`/`radius` to world bounds (see `apply_disaster_to_tiles` below).

**`CivDisaster` fields to fill** (515-523): `id, kind, epicenter_x:u32, radius:u32, intensity:f32, remaining_turns:u32`. No field has an "eta" — per RESEARCH Open Q3, repurpose `remaining_turns` as "turns until fire" while the disaster sits in `env.forecast`, then reset it to its active duration when it moves into `disasters[]`.

---

### `apply_disaster_to_tiles(&mut [CivTile], &CivDisaster, width)` (utility, pure tile mutation)

**Analog:** the gather/mining terraform (2247-2271) for the exact flood/void conversion rules; `place_resource_patch` (1767-1788) for bounded-iteration + substrate-guarded in-place mutation.

**Flood/void conversion rules to copy verbatim** (mining terraform, 2260-2271) — emptied substrate BELOW the seabed surface becomes water/deepwater; a surface block stays solid:
```rust
let surface = seabed_row_at(&snapshot.world, tx);   // top substrate row at column
if tile.amount == 0 {
    tile.resource = None;
    if ty > surface + 1 {                            // only BELOW surface → carve void
        tile.terrain = if ty >= DEEP_WATER_Y { "deepwater" } else { "water" }.to_string();
        dug_out = true;
    }
}
```
Note: in the helper you receive `&mut [CivTile]` (no `&CivWorld`), so derive `surface` by scanning the slice instead of calling `seabed_row_at`:
`tiles.iter().filter(|t| t.x == x && is_substrate(&t.terrain)).map(|t| t.y).min().unwrap_or(WORLD_HEIGHT - 2)` — this is literally the body of `seabed_row_at` (1544-1552), reused inline.

**Bounded, substrate-guarded iteration to copy** (`place_resource_patch`, 1776-1787):
```rust
for y in start_y..start_y.saturating_add(height).min(WORLD_HEIGHT) {
    for x in start_x..start_x.saturating_add(width) {
        if let Some(tile) = tiles.iter_mut().find(|tile| tile.x == x && tile.y == y) {
            if is_substrate(&tile.terrain) { /* mutate */ }
        }
    }
}
```
`is_substrate` (1554-1556): `!matches!(terrain, "air" | "water" | "deepwater")`.

**Invariants (must hold — asserted by determinism tests):**
- Tile **count constant** — mutate in place via `iter_mut().find(...)`; NEVER push/remove. `world_generation_is_deterministic_by_seed` asserts `tiles.len() == width * WORLD_HEIGHT` (4953).
- Clamp `epicenter_x` to `[1, width-2]`, `radius` small (≤ ~8), use `saturating_sub`/`.min(width)` (RESEARCH Pitfall 2, lines 280-286).
- Never write `y < WATER_SURFACE_Y` (6) and never convert above `seabed_row_at` (keeps colony floor buildable).

**Constants** (13-23): `WORLD_HEIGHT=96`, `WATER_SURFACE_Y=6`, `WATER_FLOOR_Y=50`, `DEEP_WATER_Y=34`. `CivTile` fields (335-346): `x:u32, y:u32, terrain:String, resource:Option<String>, amount:i32, biome:String`.

---

### `regrow_resources(&mut [CivTile], season, temperature)` (utility, pure transform)

**Analog:** `place_resource_patch` in-place loop (1776-1787) for iterate+guard+mutate; `is_finite_mineral` (4062-4067) as THE finite/renewable classifier — reuse, do not re-list.

**Classifier to reuse** (4062-4067) — `is_renewable(r) == !is_finite_mineral(r)`:
```rust
fn is_finite_mineral(resource: &str) -> bool {
    matches!(resource, "stone" | "clay" | "ore" | "sulfur" | "coral" | "glowshards" | "amber" | "ice")
}
```
Gate regrowth on `tile.resource.as_deref().is_some_and(|r| !is_finite_mineral(r))`.

**MICRO-DECISION (RESEARCH Pitfall 4 / Open Q1):** `coral` is listed FINITE here but CONTEXT prose calls it renewable. Defer to this code (coral = finite, no regrow) unless the plan reclassifies it AND updates `is_finite_mineral` + the mining code in lockstep. Clean renewable set = `{moss, fiber, wood, kelp, herbs}` (surface gather maps `moss`→food).

**Pitfall:** a fully-mined finite tile already has `resource:None` (2261) so it's skipped; a PARTIALLY-mined finite tile still has `resource:Some("ore")` — the `!is_finite_mineral` filter must still exclude it (RESEARCH Pitfall 3).

---

### Insertion site in `advance_civ_turn` (call site)

**Analog/site:** `advance_civ_turn` (782-900), exactly at line 794-798.

```rust
snapshot.turn = next_turn;                       // line 794 (existing)
// ◄ INSERT: tick_environment(&mut snapshot);  — turn START, BEFORE turn_order
let turn_order = civ_turn_order(&snapshot);      // line 798 (existing) — civs now observe new env
for civ_id in &turn_order { /* build_observation sees updated season/forecast */ }
```
Placement is load-bearing: turn-start so `build_observation` (per-civ, in the loop at 800-866) shows the freshly-advanced season/forecast, and any disaster-pushed `CivModifier` rides the EXISTING post-loop `resolve_environment` (870) + `tick_modifiers` (884). Do NOT place at turn end.

## Shared Patterns

### Seed-deterministic RNG (apply to ALL probabilistic env code)
**Source:** `civ_turn_order` (1605); helpers `next_rng`/`rand_f`/`rand_range` (4699-4714).
```rust
let mut rng = (snapshot.seed ^ snapshot.turn.wrapping_mul(0x9E37_79B9) ^ <NEW_SALT>).max(1);
let p = rand_f(&mut rng);              // [0,1)
let n = rand_range(&mut rng, lo, hi);  // float in range
```
Pick a fresh salt per subsystem (forecast roll, kind pick, epicenter, temp noise) so streams don't alias. NEVER `uuid::new_v4()` / `SystemTime` in the tick — both break byte-stable replay.

### Disaster civ-effect via existing `CivModifier` kinds (apply to drought/cold_snap disasters)
**Source:** `resolve_environment` arms (2533-2576) already implement `drought`/`cold_snap`/`food_rot`/`fatigue` etc.; `tick_modifiers` (2586-2593) already expires them; construction shape at `modifier_from_intervention` (3900-3907).
**Apply to:** heatwave/drought → push `kind:"drought"`; ice/cold_snap → push `kind:"cold_snap"`. For genuinely new effects (flood/storm/quake) prefer terrain-only or a one-shot health/morale hit at fire time — a new modifier `kind` with no matching `resolve_environment` arm is a SILENT no-op (the `_ => {}` at 2576 swallows it). RESEARCH Pitfall 5 / Open Q2.

### Logging (apply to every forecast / fire / season-change / expiry)
**Source:** `push_log` (4450-4464) — handles the 240-entry ring-buffer trim.
```rust
push_log(&mut snapshot, "disaster", "A flood struck", &format!("..."));
```
ENV-01/02 REQUIRE logs for season change, forecast announce, disaster fire, and expiry. Use distinct `kind` strings (`"season"`, `"forecast"`, `"disaster"`, `"terraform"` already used at 2307) so the harness/UI can filter.

### In-place, bounded, substrate-guarded tile mutation (apply to apply_disaster_to_tiles + regrow_resources)
**Source:** `place_resource_patch` (1776-1787) + `is_substrate` (1554) + mining terraform flood rules (2260-2271).
**Apply to:** any code touching `world.tiles`. Always `iter_mut().find(|t| t.x==x && t.y==y)`, guard with `is_substrate`, clamp with `saturating_*`/`.min`/`.clamp`, never push/remove tiles. (`unsafe_code` is forbid; raw `-`/`+` near 0/max panics — use saturating arithmetic.)

## Test Patterns

### Pure-helper determinism + invariant test
**Analog:** `world_generation_is_deterministic_by_seed` (4948-4964) — call twice, assert equal; assert tile-count invariant; serde-compare for byte-stability.
```rust
#[test]
fn world_generation_is_deterministic_by_seed() {
    let a = generate_world(1234, 1);
    let b = generate_world(1234, 1);
    assert_eq!(a.tiles.len(), (a.width * WORLD_HEIGHT) as usize);
    assert_eq!(serde_json::to_string(&a.tiles).unwrap(), serde_json::to_string(&b.tiles).unwrap());
}
```
Mirror for: `advance_season` (call twice, assert tuple equal + wrap on `SEASON_LEN`), `regrow_resources` (renewable rises ≤ cap; `finite_resources_never_regrow` on an ore tile), `apply_disaster_to_tiles` (tile count unchanged, x/y in bounds, no air below surface), `tick_environment_deterministic` (clone a `test_snapshot`, tick both, serde-compare `environment` + `world.tiles`).

### Integration test (build snapshot, mutate, assert fields + log)
**Analog:** `intervention_grants_resources_and_scores` (5113-5136) and `player_harvest_depletes_tile_and_grants_yield` (5138-5175) — both use `test_snapshot(id,name,model,seed,now)` (4928-4946), find a tile, apply, assert tile delta + side effects.
```rust
let mut snapshot = test_snapshot("test-session", "Test", "mock-model", 42, 1);
let tile = snapshot.world.tiles.iter().find(|t| t.resource.as_deref()==Some("moss")).cloned().unwrap();
// ...mutate via the function under test...
let after = snapshot.world.tiles.iter().find(|t| t.x==tile.x && t.y==tile.y).unwrap();
assert_eq!(after.amount, before - 2);
```
Mirror for `tick_environment` on a `test_snapshot`: advance turn/env, assert `environment.season`/`temperature` changed and a `"season"`/`"forecast"` log entry exists.

### Save back-compat test (only if any field is touched — should be NONE)
**Analog:** `legacy_v1_snapshot_migrates_to_multi_civ` (5561-5613) — serialize, surgically strip fields from the JSON, re-parse, assert defaults applied. The existing `#[serde(default = "default_environment")]` (300) + `default_environment` (414) already cover old saves loading as calm spring. **Do NOT add non-defaulted fields** to `CivEnvironment`/`CivDisaster` (would force a `bindings.ts` regen per gotcha #1 and break old saves).

## No Analog Found

None. Every new helper, the call site, the disaster-effect plumbing, and all tests have an exact existing analog in `civilization.rs`. The only genuinely "new" content is the disaster-kind table + tuning constants (`SEASON_LEN`, temp targets, regrowth rate/cap, radius/intensity caps, forecast lead) — all Claude's-discretion values grounded in existing const-table style (`BIOMES` ~91, world-gen patch amounts ~1174).

## Metadata

**Analog search scope:** `tauri-app/src-tauri/src/civilization.rs` (single file — the entire env surface lives here per RESEARCH).
**Sections read:** structs (293-346, 478-523), constants (10-26), `advance_civ_turn` (782-900), `civ_turn_order`/rng idiom (1595-1611, 4690-4714), `seabed_row_at`/`is_substrate`/`place_resource_patch` (1540-1556, 1767-1788), gather/mining terraform (2240-2312), `resolve_environment`/`tick_modifiers` (2504-2593), `modifier_from_intervention` (3876-3908), `is_finite_mineral`/`required_mining_tier`/`known_resource` (4055-4120), `push_log`/`push_decision_log` (4450-4493), `round1` (4914), test module + `test_snapshot` + determinism/migration tests (4918-5175, 5561-5613).
**Validation constraint (gotcha #5):** backend tests COMPILE on Windows (`cargo test --no-run -p xolotl`) but EXECUTE on CI (Linux/macOS). Add ZERO new clippy warnings over the documented baseline.
**Pattern extraction date:** 2026-06-07
