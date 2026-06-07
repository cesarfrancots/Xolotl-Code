# Phase 4: W6 — Combat & Diplomacy - Pattern Map

**Mapped:** 2026-06-07
**Files analyzed:** 2 (one heavily-modified Rust module + one regenerated artifact)
**Analogs found:** 13 / 13 (every new piece has a verified in-file analog)

> This phase is a single-file backend extension. The "analog" for almost every new
> piece lives INSIDE `tauri-app/src-tauri/src/civilization.rs` — the file being
> modified. Each pattern below cites the exact existing line range to mirror. All
> line numbers VERIFIED against the current source this session.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `tauri-app/src-tauri/src/civilization.rs` — new `CivDecisionAction` fields | model (struct) | request-response (model JSON → struct) | same struct's existing optional fields (`civilization.rs:579-596`) | exact (same struct) |
| `civilization.rs` — `validate_action` new arms | utility (validation) | request-response | existing `gather`/`policy`/`prepare` arms (`:2110-2177`) | exact (same fn) |
| `civilization.rs` — `apply_model_decision` dispatch arms | service (action dispatch) | event-driven (per-civ action) | existing dispatch match (`:2199-2207`) | exact (same fn) |
| `civilization.rs` — `civ_strength` helper | utility (pure compute) | transform | `colony_center` / `should_collapse` leaf accessors (`:1664`, `:1673`) | role-match (pure read helper) |
| `civilization.rs` — `resolve_attack` helper | service (state mutation) | transform | `resolve_environment` mutate-snapshot pattern (`:2509`) + elder-death retain (`:2636-2650`) | role-match |
| `civilization.rs` — `apply_trade` helper | service (state mutation) | CRUD (two-map swap) | `consume` bounded drain (`:4051-4056`) + `gather` resource credit | role-match |
| `civilization.rs` — `set_stance` helper | service (map write) | CRUD | `diplomacy` map field (`:454-456`) + observation read (`:2001`) | exact (writes the field already read) |
| `civilization.rs` — `claim_region` helper | service (state mutation) | CRUD | home-claim at spawn (`:1538-1544`) | exact (mutates same field) |
| `civilization.rs` — `spawn_predators` helper | service (entity create) | event-driven | entity vector push in `seed_founders` / lifecycle egg-laying (`:1535`, `:2756`) + CivEntity (`:348-399`) | role-match |
| `civilization.rs` — `step_predators` helper | service (entity move+remove) | event-driven | elder-death retain (`:2636-2650`) + `colony_center` (`:1673`) | role-match |
| `civilization.rs` — combat world pass in `advance_civ_turn` | controller (turn loop) | batch (post-decision) | the post-loop `resolve_environment` block (`:873-888`) | exact (same fn, adjacent insertion) |
| `civilization.rs` — predator spawn hook | controller (env tick) | event-driven | `tick_environment` predator_incursion fire branch (`:5174-5193`) | exact (same fn/branch) |
| `civilization.rs` — `#[cfg(test)]` tests | test | — | `mod tests` + `multi_civ_snapshot` + `tick_environment_deterministic` (`:5282`, `:6485`, `:7101`) | exact (same module) |
| `tauri-app/src/bindings.ts` — regenerated `CivDecisionAction` type | config (generated) | — | existing generated type (`bindings.ts:290-301`) + headless regen (`export_bindings.rs`) | exact (Phase 1 `CivParticipant` regen flow) |

---

## Pattern Assignments

### `CivDecisionAction` new optional fields (model struct, request-response)

**Analog:** the same struct's existing optional fields — `civilization.rs:576-597`

**`#[serde(default)] Option<...>` idiom to copy verbatim** (lines 579-596):
```rust
#[serde(default)]
pub resource: Option<String>,
#[serde(default)]
pub workers: Option<u32>,
// ... (every field is #[serde(default)] Option<T> — back-compat: old saves load, defaults fill)
#[serde(default)]
pub event_id: Option<String>,
```

**New fields to append before the closing `}` at line 597** (per RESEARCH §Standard Stack, the clean 5-field set):
```rust
#[serde(default)]
pub target: Option<String>,          // target civ id (attack/diplomacy/trade) or region id (claim)
#[serde(default)]
pub stance: Option<String>,          // diplomacy stance: ally|trade|neutral|hostile
#[serde(default)]
pub receive: Option<String>,         // trade: resource wanted back (give-resource reuses `resource`)
#[serde(default)]
pub amount: Option<u32>,             // trade: give amount
#[serde(default)]
pub receive_amount: Option<u32>,     // trade: receive amount
```

**Critical:** every field MUST carry `#[serde(default)]` (the universal struct discipline) so old session snapshots still deserialize — RESEARCH Runtime State row confirms forward-compat depends on this. Changing this struct is the trigger for the bindings regen (see `bindings.ts` assignment).

---

### `validate_action` new arms (utility, request-response)

**Analog:** existing arms in `validate_action` — `civilization.rs:2108-2180`

**Pattern to mirror** (the `gather` arm, lines 2110-2122 — `.ok_or(...)` for required field, `matches!` for enum membership, early `Err(format!(...))`):
```rust
"gather" => {
    let resource = action.resource.as_deref().ok_or("gather.resource is required")?;
    if !known_resource(resource) {
        return Err(format!("unknown resource: {resource}"));
    }
    // ...
}
```
**The `prepare` arm (lines 2166-2175) is the closest analog for a "non-empty target string" check:**
```rust
"prepare" => {
    if action.event_id.as_deref().unwrap_or_default().trim().is_empty() {
        return Err("prepare.event_id is required".to_string());
    }
}
```

**New arms to add (before the `other => return Err(...)` catch-all at line 2177)** — follow RESEARCH §Code Examples; gate `attack`/`diplomacy`/`trade` on a non-empty `target`, validate `stance` membership with `matches!`. The catch-all at `:2177` already rejects unknown action types, so ARENA-02 (existing actions unaffected) holds automatically.

---

### `apply_model_decision` dispatch arms (service, event-driven)

**Analog:** existing dispatch match — `civilization.rs:2198-2208`

**Pattern to mirror** (lines 2199-2206):
```rust
for action in &decision.actions {
    match action.action_type.as_str() {
        "gather" => gather(snapshot, civ_id, action),
        "build" => build(snapshot, civ_id, action),
        // ...
        "prepare" => prepare(snapshot, civ_id, action),
        _ => {}                          // unknown = silent no-op (already present)
    }
}
```

**New arms:** add `"claim"`, `"diplomacy" | "set_stance"`, `"trade"` here (these mutate the actor's own / consensual state during its turn). **Do NOT add `"attack"` here** — attack is QUEUED in `advance_civ_turn` and resolved in the post-loop combat pass (see RESEARCH §Code Examples "Planner note" and the combat-world-pass assignment below). The cleanest queue is a local `Vec<(attacker, target)>` in `advance_civ_turn`, NOT a queue threaded through `apply_model_decision`.

**Guard idiom for every new action helper** (the `gather` head, lines 2212-2217 — RESEARCH §Security V5 says guard non-existent civ ids this way to avoid panics):
```rust
let Some(ci) = civ_index(snapshot, civ_id) else {
    return;
};
```

---

### `civ_strength` helper (utility, pure transform) — THE Phase-5 seam

**Analog:** leaf read-only accessors `should_collapse` (`:1664-1669`) and `colony_center` (`:1673-1689`)

**Pattern to mirror** (`should_collapse`, lines 1664-1668 — `let Some(ci) = civ_index(...) else { return default }`, then read `snapshot.civs[ci]`):
```rust
fn should_collapse(snapshot: &CivSessionSnapshot, civ_id: &str) -> bool {
    let Some(ci) = civ_index(snapshot, civ_id) else {
        return false;
    };
    snapshot.civs[ci].population == 0 && !civ_entities(snapshot, civ_id).any(|e| e.kind == "egg")
}
```
**Owned-territory count** (mirror this region filter, used in observation `:2025` and home-claim `:1538-1543`):
```rust
snapshot.world.regions.iter().filter(|r| r.owner.as_deref() == Some(civ_id)).count()
```
Wrap the final score in `round1(...)` (`:4919`) for replay-clean floats. **Place the Phase-5 `genes.strength` term here and NOWHERE else** (CONTEXT seam requirement).

---

### `resolve_attack` helper (service, transform — mutates snapshot)

**Analogs:** `resolve_environment` mutate-snapshot signature (`:2509`); elder-death **entity-removal retain** (`:2636-2650`); `rand_range` jitter (`:4717`)

**Casualty pattern — REMOVE ENTITIES, never decrement `population`** (mirror the elder-death retain, lines 2636-2650):
```rust
// collect victim ids deterministically (stable sort by id), then:
if !deaths.is_empty() {
    snapshot.world.entities.retain(|e| !deaths.contains(&e.id));
}
```
**Load-bearing invariant (RESEARCH's #1 finding):** `population` is a MIRROR re-synced at the end of `run_life_cycle` (`:2767-2773`):
```rust
// 4) Population mirrors the living (non-egg) axolotls of this civ.
let pop = civ_entities(snapshot, civ_id)
    .filter(|e| e.kind == "axolotl" && e.stage != "egg")
    .count() as u32;
if let Some(ci) = civ_index(snapshot, civ_id) {
    snapshot.civs[ci].population = pop;
}
```
Decrementing `population` directly is silently overwritten. Combat MUST remove axolotl entities AND run BEFORE `resolve_environment` so the mirror reflects casualties. Bound casualties (cap fraction + always leave ≥1 survivor) so no instant wipeout — collapse only via `should_collapse` (`:1664`). Use `rand_range(rng, 0.85, 1.15)` for the seed^turn jitter.

---

### `apply_trade` helper (service, CRUD — two-civ resource swap)

**Analog:** `consume` bounded drain (`:4051-4056`) + `gather`'s resource credit

**Bounded-drain pattern to copy (NEVER `-=` unchecked — clamps at 0, returns shortfall):**
```rust
fn consume(resources: &mut HashMap<String, i32>, resource: &str, amount: i32) -> i32 {
    let entry = resources.entry(resource.to_string()).or_insert(0);
    let missing = (amount - *entry).max(0);
    *entry = (*entry - amount).max(0);
    missing
}
```
Drain the giver via `consume`; credit the receiver via `*entry += amt`. Gate on a non-hostile stance (read `diplomacy` map, see `set_stance`). Guard both civ indices with `civ_index(...).ok_or(...)`. RESEARCH §Security: cap give-amount at holdings; never negative resources (conservation test asserts attacker gain == defender loss).

---

### `set_stance` helper (service, CRUD — diplomacy map write)

**Analog:** the `CivCivilization.diplomacy` field (`:454-456`) and its observation read (`:2001`)

**The field being written** (lines 454-456):
```rust
/// Diplomacy stance toward other civs: civ_id -> "ally|trade|neutral|hostile".
#[serde(default)]
pub diplomacy: HashMap<String, String>,
```
**The read it must satisfy** (observation, line 2001 — defaults to `"neutral"` when absent):
```rust
"stance": civ.diplomacy.get(&other.id).cloned().unwrap_or_else(|| "neutral".to_string()),
```
Implementation is `snapshot.civs[ci].diplomacy.insert(target.to_string(), stance.to_string())` after a `civ_index` guard.

---

### `claim_region` helper (service, CRUD — region.owner mutation)

**Analog:** the home-claim at spawn — `civilization.rs:1538-1544`

**Pattern to mirror** (the EXACT mutation this phase generalizes — set `owner = Some(civ_id)`):
```rust
if let Some(region) = world
    .regions
    .iter_mut()
    .find(|r| spawn_x >= r.x && spawn_x < r.x + r.width)
{
    region.owner = Some(civ_id);
}
```
For `claim`, find the region by `target` id (or deterministic adjacent unclaimed region if `target` absent), reject if already owned or non-adjacent, then set `owner = Some(civ_id.to_string())`. Renderer overlay + score already read `region.owner` — they update for free (RESEARCH Resp. Map).

---

### `spawn_predators` helper (service, event-driven — entity create)

**Analogs:** entity vector push in `seed_founders` (`:1535`) and lifecycle egg extend (`:2756`); `CivEntity` struct (`:348-399`); `colony_center` for placement (`:1673`); disaster id convention (`:5154`, `:5183-5186`)

**Entity-push pattern** (mirror `:1535` / `:2756 snapshot.world.entities.extend(...)`). A predator is `CivEntity { kind: "predator".into(), role: "predator".into(), civ_id: None, health, x, y, age: 0, ..Default::default() }` — every other field has a `#[serde(default)]` so `..Default::default()` is valid (struct is `#[derive(Default)]` at `:348`).

**Deterministic ids — NO uuid/clock** (mirror the disaster `format!` id at `:5154`/`:5186`):
```rust
id: format!("predator-{turn}-{n}"),
```
Place near `colony_center(snapshot, near_civ)` (`:1673`). `civ_id: None` reuses the wild-fauna slot (`CivEntity.civ_id` doc `:358-359`) — renderer funnels it to `createAxo` (RESEARCH Pitfall 5: expected, do NOT add a renderer change).

---

### `step_predators` helper (service, event-driven — move + attack + cull)

**Analogs:** elder-death retain for entity removal (`:2636-2650`); `colony_center` for hunt target (`:1673`); `civ_strength` for defense; `rand_*` (`:4713-4719`)

**Hunt:** move each predator toward `colony_center` of the nearest living civ; if adjacent, remove `damage` axolotl entities (the `retain` pattern at `:2649`, bounded), reduced by that civ's `civ_strength` (defense). **Cull:** strong civs remove the predator entity (same `retain`). **Expire:** `age += 1`; retain only predators with `age < lifespan`. Seed with a predator-specific salt (distinct from combat salt; see Shared Patterns RNG row).

---

### Combat world pass in `advance_civ_turn` (controller, batch)

**Analog:** the existing post-decision-loop block — `civilization.rs:873-888`

**Insertion point pattern** (the post-loop per-civ resolution, lines 873-888 — the new combat + predator passes go BETWEEN the decision loop end at `:871` and this `resolve_environment` loop at `:874`):
```rust
// Resolve each civ's environment, then collapse any that ran out of axolotls.
for civ_id in &turn_order {
    resolve_environment(&mut snapshot, civ_id);
    if let Some(ci) = civ_index(&snapshot, civ_id) {
        if snapshot.civs[ci].alive && should_collapse(&snapshot, civ_id) {
            snapshot.civs[ci].alive = false;
            // ... push_log("collapse", ...)
        }
    }
}
```
**Placement is LOCKED (RESEARCH):** combat pass + predator pass run AFTER the decision loop (`:871`) and BEFORE `resolve_environment` (`:874`), so casualties land before the population mirror re-syncs. Queue attacks during the decision loop into a local `Vec<(attacker, target)>`, sort by attacker civ id (deterministic fixed order), then resolve. Mirror `civ_turn_order`'s seed expr for any pass-level RNG.

---

### Predator spawn hook in `tick_environment` (controller, event-driven)

**Analog:** the `predator_incursion` fire branch — `civilization.rs:5174-5193`

**The exact branch to extend** (lines 5174-5193 — `predator_incursion` currently maps only to a `quarrel_pressure` modifier; ADD a `spawn_predators(...)` call in the fire path; keep the modifier per RESEARCH Open Q3):
```rust
let modifier_kind = match forecast.kind.as_str() {
    "drought" => Some("drought"),
    "cold_snap" => Some("cold_snap"),
    "storm" => Some("fatigue"),
    "predator_incursion" => Some("quarrel_pressure"),   // ← add spawn_predators near affected colony here
    _ => None,
};
```
This is the WAR-04 spawn trigger. `disaster_duration("predator_incursion")` is 3 turns (`:5138`) — tie predator lifespan to it (Claude's discretion). This whole tick is documented byte-deterministic (`:5153-5155`); predator spawn must keep it so (seed^turn salt, `format!` ids).

---

### `#[cfg(test)]` tests (test)

**Analogs:** `mod tests` header (`:5282`), `test_snapshot` (`:5291`), `multi_civ_snapshot` (`:6485`), determinism test `tick_environment_deterministic` (`:7101`)

**Multi-civ fixture to reuse** (lines 6485-6495 — no new fixtures needed):
```rust
fn multi_civ_snapshot(seed: u32, n: usize) -> CivSessionSnapshot {
    let mut s = test_snapshot("multi", "Multi", "m", seed, 1);
    let base = s.civs[0].clone();
    for i in 1..n { /* clone base, set id = civ_id_for(i) */ }
    s
}
```
**Determinism test pattern** (clone snapshot, run pass on both, assert `serde_json::to_string` equal — lines 7101-7120):
```rust
let mut a = test_snapshot("det", "Det", "mock-model", 777, 1);
let mut b = a.clone();
a.turn = 1; b.turn = 1;
tick_environment(&mut a); tick_environment(&mut b);
assert_eq!(serde_json::to_string(&a.environment).unwrap(),
           serde_json::to_string(&b.environment).unwrap());
```
Use `civ_id_for(0)`/`civ_id_for(1)` (`:1580`) to name attacker/defender. **Backend tests COMPILE on Windows (`cargo test --no-run`) but RUN on Linux/macOS CI** (CLAUDE.md gotcha #5, WebView2 loader). Add all WAR-* tests to this existing module — no new test files.

---

### `bindings.ts` regenerated `CivDecisionAction` type (config, generated artifact)

**Analog:** the existing generated type (`bindings.ts:290-301`) + the Phase-1 `CivParticipant` headless-regen flow (`export_bindings.rs`)

**Current generated shape** (lines 290-301 — will gain `target?`/`stance?`/`receive?`/`amount?`/`receive_amount?` after regen):
```typescript
export type CivDecisionAction = {
	type: string,
	resource?: string | null,
	// ...
	event_id?: string | null,
};
```
**Regen flow (REQUIRED because `CivDecisionAction` changes — gotcha #1, MEMORY drift trap):**
```bash
# from tauri-app/src-tauri
cargo run --bin export_bindings        # headless: rewrites ../src/bindings.ts, no WebView2
# from tauri-app
npx tsc --noEmit                       # confirm TS layer still type-checks
```
`export_bindings.rs` only runs the tauri-specta exporter (no window). No new `#[specta::specta]` command is needed — the existing registered commands carry `CivDecisionAction` transitively. **NEVER hand-edit `bindings.ts` first** — it is generated. **Mitigation (MEMORY drift trap, RESEARCH Pitfall 3):** if a full regen reds unrelated eval types, hand-add ONLY the 5 new `CivDecisionAction` fields to `bindings.ts` and verify the diff is limited to that type. Commit `bindings.ts` in the SAME change as the Rust field add.

---

## Shared Patterns

### Deterministic RNG (seed^turn xorshift)
**Source:** `next_rng`/`rand_f`/`rand_range` (`:4704-4719`); seed expr in `civ_turn_order` (`:1610`)
**Apply to:** `resolve_attack`, `step_predators`, `spawn_predators`, combat world pass
```rust
let mut rng = (snapshot.seed ^ snapshot.turn.wrapping_mul(0x9E37_79B9) ^ <SALT>).max(1);
let roll = rand_range(&mut rng, 0.85, 1.15);
```
**Use a DISTINCT salt per pass** (combat salt ≠ predator salt ≠ existing `civ_turn_order` salt `0x51ED_2701`) so passes stay uncorrelated. NEVER `rand`/`SystemTime`/`uuid` (breaks replay). Stable-sort all victim/attacker collections by id before applying.

### Bounded resource math
**Source:** `consume` (`:4051-4056`)
**Apply to:** `apply_trade` (give side), `resolve_attack` plunder
Drain via `consume` (clamps ≥0, returns shortfall) or `.max(0)`; never `-=` unchecked. RESEARCH §Security: prevents negative resources.

### Entity-removal casualties (the load-bearing invariant)
**Source:** elder-death retain (`:2636-2650`); population mirror (`:2767-2773`)
**Apply to:** `resolve_attack`, `step_predators`
Remove axolotl ENTITIES via `entities.retain(|e| !victims.contains(&e.id))`; the mirror re-syncs `population` in `run_life_cycle`. Combat/predator passes MUST run before `resolve_environment`. Never decrement the `population` counter.

### World event logging
**Source:** `push_log(snapshot, kind, title, body)` (`:4455`); `push_decision_log` (`:2189`)
**Apply to:** every claim/attack/diplomacy/trade/predator event (ARENA-01 — war rides the log + snapshot, no FE change)
```rust
fn push_log(snapshot: &mut CivSessionSnapshot, kind: &str, title: &str, body: &str)
```

### Civ-index / wild-entity guards (panic safety)
**Source:** `civ_index` (`:1564`), the `let Some(ci) = civ_index(...) else { return }` guard (`:2212`), `civ_entities` (`:1569`), `civ_id: None` wild slot (`:358-361`)
**Apply to:** every new action helper and pass
Guard non-existent `target` civ/region ids before indexing (RESEARCH §Security: a malformed model `target` must not panic).

### Clippy / fmt gate
**Source:** workspace lints (pedantic + `-D warnings`); baseline = 16 pre-existing src-tauri errors (deferred-items.md)
**Apply to:** all new Rust code
Add ZERO new clippy warnings (fix none of the 16 baseline). Watch `cast_precision_loss` (`as f32` on counts — use `f64::from` or a local `#[allow]`), `too_many_arguments` (use a small struct or `#[allow]` like `make_axolotl`). Run `cargo clippy --all-features -- -D warnings` + `cargo fmt --all -- --check` in `tauri-app/src-tauri`.

---

## No Analog Found

None. Every new piece maps to a verified in-file analog. The only genuinely net-new *concept* (the predator entity behavior loop) still reuses existing seams: `CivEntity{civ_id:None}` (`:358`), `colony_center` (`:1673`), the elder-death retain (`:2649`), and the RNG idiom (`:4704`). No piece falls back to RESEARCH-only patterns.

## Metadata

**Analog search scope:** `tauri-app/src-tauri/src/civilization.rs` (the single file modified), `tauri-app/src/bindings.ts`, `tauri-app/src-tauri/src/bin/export_bindings.rs`
**Files scanned:** 3 (1 deep, multi-section reads; 2 targeted)
**Pattern extraction date:** 2026-06-07
**All line numbers verified against current source this session.**
