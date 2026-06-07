# Phase 4: W6 — Combat & Diplomacy - Research

**Researched:** 2026-06-07
**Domain:** Deterministic backend game simulation (Rust) — territory, combat, diplomacy, wild predators in `civilization.rs`
**Confidence:** HIGH (all findings verified against the actual source tree; no external library research needed — this is a self-contained engine extension)

## Summary

Phase 4 is a **pure backend extension** of one file: `tauri-app/src-tauri/src/civilization.rs` (7202 lines). It adds four model actions (`claim`, `attack`/`raid`, `diplomacy`/`set_stance`, `trade`), a deterministic post-decision combat/predator world pass in `advance_civ_turn`, and net-new wild predator entities spawned by Phase 3's `predator_incursion`. Every datastructure the phase needs already exists and was deliberately seeded for this work: `CivRegion.owner: Option<String>` (territory), `CivCivilization.diplomacy: HashMap<String,String>` (stances), `CivEntity.civ_id: Option<String>` (None = wild fauna for predators), and the established `seed^turn` xorshift RNG idiom (`next_rng`/`rand_f`/`rand_range`) + `round1` for replay-stable rolls. [VERIFIED: civilization.rs grep + reads]

**The single most important architectural finding (drives every casualty rule):** a civ's `population` is a *mirror* re-synced every turn at the end of `run_life_cycle` (called from `resolve_environment`) to `count(living non-egg axolotl entities of that civ)` [VERIFIED: civilization.rs:2767-2773]. Therefore **combat casualties MUST remove actual axolotl entities, not merely decrement the `population` counter** — and the combat pass MUST run at a point where its entity removals are reflected in the mirror. Decrementing `population` directly before `resolve_environment` would be silently overwritten.

**The IPC decision (the CONTEXT open question), answered definitively:** the four new actions **cannot** be expressed with the existing `CivDecisionAction` fields — none of `{resource, workers, building, x, y, tech_id, direction, policy, event_id}` represents a *target civ id*, a *stance*, or a *trade give/receive amount*. New optional fields are unavoidable. Adding `#[serde(default)] Option<...>` fields to `CivDecisionAction` (a `#[derive(Type)]` struct reachable from the registered `advance_civ_turn`/`create_civ_session` commands) **does change `bindings.ts`** and requires the headless regen step. It does **not** require a new `#[specta::specta]` command — the existing command surface already carries the type transitively. [VERIFIED: lib.rs:54-116, export_bindings:174-178, bindings.ts:290-301]

**Primary recommendation:** Add exactly **3 new optional fields** to `CivDecisionAction` — `target` (target civ id, reused by attack/claim/diplomacy/trade), `stance` (diplomacy value), and reuse the existing `resource` + add `amount`/`give`/`receive` for trade (see Standard Stack table for the minimal field set). Regenerate bindings headlessly. Implement combat/diplomacy/predators as **pure helpers** (`civ_strength`, `resolve_attack`, `apply_trade`, `set_stance`, `claim_region`, `spawn_predators`, `step_predators`) unit-tested with `cargo test` (compile-check on Windows via `--no-run`; run on CI).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Territory claim/contest (WAR-01) | Backend engine (`civilization.rs`) | Renderer (read-only) | `region.owner` mutated in engine; renderer already draws per-owner overlay from `region.owner` (CivilizationGameCanvas:720-732) — no FE change. |
| Combat/raid resolution (WAR-02) | Backend engine (post-decision world pass) | — | Deterministic, server-authoritative; entity removal + resource/territory mutation are engine concerns. |
| Diplomacy stance + trade (WAR-03) | Backend engine (per-civ action application) | — | Stance lives in `civs[].diplomacy`; trade mutates two civs' `resources` maps. |
| Wild predators hunt/defend (WAR-04) | Backend engine (post-decision world pass) | Renderer (read-only) | Predators are `CivEntity{civ_id:None}`; renderer funnels all non-building entities to `createAxo` so they render (untinted) automatically. |
| Surfacing war/diplomacy to models | Backend (`build_observation`/prompt) | — | `rivals[].stance` + `biome_regions[].owner` already in observation (build_observation:2001,2031); extend the prompt action menu only. |
| Harness text-state (ARENA-01) | Snapshot JSON + per-civ log | Frontend `render_game_to_text` | War/diplomacy/territory ride the snapshot structs + `push_log` events; no FE change required. |

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Territory (WAR-01):** Regions carry `owner: Option<String>` (None=unclaimed; home claimed at spawn). A civ CLAIMs an adjacent unclaimed region (new `claim` action or deterministic expansion) → `owner = Some(civ_id)`. CONTEST/seize via a successful raid/attack transfers `owner`. Territory count feeds strength + score.
- **Combat & Raids (WAR-02):** New `attack`/`raid` action targeting another civ (and/or one of its regions). **Deterministic** resolution (seed^turn): outcome from attacker-vs-defender STRENGTH where `strength = f(population, tools/tech, owned-territory bonus, defender home-territory bonus)` — designed so Phase 5 plugs a genetic `strength` term via a single `civ_strength(civ, …)` helper. Consequences: population losses on BOTH sides (scaled by strength ratio), resource PLUNDER on a successful raid (bounded share of defender resources), TERRITORY transfer on a decisive win (contested region's `owner` flips). **All bounded; never instantly annihilate a civ.**
- **Allies don't fight (WAR-03 gate):** attack rejected/no-op if attacker's stance toward target is `ally` (and/or mutual ally). Logged.
- **Diplomacy & Trade (WAR-03):** New `diplomacy`/`set_stance` action sets stance in `diplomacy: HashMap<civ_id,String>` (`ally|trade|neutral|hostile`). Unilateral declaration; `ally` is mutually binding for the no-fight gate only when BOTH declare ally (decide one rule and test it). New `trade` action: deterministic resource exchange between two civs (give X of resource A, receive Y of resource B), gated by a non-hostile stance. Both civs' resource counts update; logged. (Distinct from Game-B NPC `trade_resource` quest — untouched.)
- **Wild Predators (WAR-04):** Phase 3's `predator_incursion` disaster SPAWNS wild predator entities (`civ_id=None`, a `predator` role) near a colony. Predators hunt axolotls: each turn move toward nearest colony and attack (reduce pop); civ DEFENDS with strength (defense reduces/repels predator damage; strong civs kill predators). Deterministic; predators expire/are culled. Reuse the wild-fauna notion (entities with `civ_id=None`).
- **Integration & Determinism:** Add a world-level interaction-resolution step in `advance_civ_turn` (combat + predators resolved AFTER civ decisions each turn, fixed civ order). Diplomacy/claim apply during the civ's own action application (`apply_model_decision`); combat resolution + predator behavior are a post-decision world pass. All rolls seed^turn-derived (no wall-clock/uuid), reusing the RNG idiom + `round1`. Combat must be replay-stable.
- **Pure helpers for testability:** `civ_strength(...)`, `resolve_attack(...)`, `apply_trade(...)`, `step_predators(...)` as pure/near-pure functions unit-tested with `cargo test` (compile on Windows via `--no-run`; run on CI).

### Claude's Discretion
- Exact strength formula + coefficients, plunder/casualty ratios + caps, claim adjacency rule, predator damage/spawn counts/lifespan, ally mutuality rule.

### Deferred Ideas (OUT OF SCOPE)
- Diplomacy-management UI / war HUD / territory overlay beyond Phase 2's basic tint (deferred W9 — data rides snapshot/text-state).
- Genetic `strength` gene + its effect on combat (Phase 5 — Phase 4 leaves the seam).
- Deep combat animations/VFX in the renderer.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WAR-01 | A civilization can claim/own territory (regions); ownership tracked & contestable. | `CivRegion.owner: Option<String>` exists (civilization.rs:319-332); home claimed at spawn (:1538-1544) + backfill (:4637); observation already surfaces `biome_regions[].owner` (:2031); renderer already draws per-owner overlay (CivilizationGameCanvas:720-732). New: `claim` action + adjacency rule + `claim_region` helper; raid transfers `owner` (WAR-02). |
| WAR-02 | Hostile civs resolve combat/raids deterministically with pop/resource/territory consequences. | `seed^turn` xorshift RNG (`next_rng`:4704, `rand_f`:4713, `rand_range`:4717) + `round1`:4919; `population` is an entity mirror (:2767-2773) → casualties remove entities; `resources: HashMap<String,i32>` for plunder; `region.owner` flip for territory. New: `civ_strength` + `resolve_attack` pure helpers + post-decision pass. |
| WAR-03 | Civs set diplomacy stances + execute trades; allied/trading civs don't fight. | `diplomacy: HashMap<String,String>` exists (:454-456, init empty :1018-1020); observation surfaces `rivals[].stance` (:2001). New: `diplomacy`/`set_stance` + `trade` actions; ally no-fight gate inside `resolve_attack` / attack validation. |
| WAR-04 | Wild predators spawn & hunt axolotls; civs defend with strength. | Predators are net-new — NO wild fauna exist today ("wild" is only a morph name, :44). `predator_incursion` currently only pushes a `quarrel_pressure` modifier (tick_environment:5178), spawns NO entities. New: spawn `CivEntity{kind:"predator",civ_id:None}` when that forecast fires; `spawn_predators` + `step_predators` pure helpers; reuse `civ_strength` for defense. |
</phase_requirements>

## Standard Stack

No external libraries. This phase extends one in-tree Rust module. The "stack" is the in-file idioms already established and proven across Phases 1-3.

### Core (in-file idioms to reuse)
| Idiom / Asset | Location | Purpose | Why Standard |
|---------------|----------|---------|--------------|
| `next_rng(&mut u32) -> u32` (xorshift) | civilization.rs:4704 | Deterministic PRNG step | The ONLY RNG used by the engine; replay-stable. [VERIFIED] |
| `rand_f` / `rand_range` | :4713 / :4717 | 0..1 float / ranged float | Built on `next_rng`; combat/predator rolls use these. [VERIFIED] |
| Seed expr `seed ^ turn.wrapping_mul(0x9E37_79B9) ^ <salt>` | :2417, :2607, :1610 | Per-pass RNG seeding | Each pass uses a distinct salt so passes don't correlate. Use a NEW salt for the combat pass and another for predators. [VERIFIED] |
| `round1(f32) -> f32` | :4919 | 1-decimal rounding | Keeps float state replay-stable / log-clean. [VERIFIED] |
| `push_log(snapshot, kind, title, body)` | used throughout | World event log (ARENA-01 + UI) | All war/diplomacy/predator events log here. [VERIFIED] |
| `push_decision_log` | apply_model_decision:2189 | Per-civ decision narrative | Already called before action dispatch. [VERIFIED] |
| `civ_index(snapshot, civ_id) -> Option<usize>` | :1564 | civ id → vec index | Standard accessor; combat needs two indices (attacker, defender). [VERIFIED] |
| `civ_label(snapshot, civ_id) -> String` | :1585 | Human name for logs | Use in all war log lines. [VERIFIED] |
| `civ_entities(snapshot, civ_id)` | :1569 | Iterate a civ's entities | Casualty selection iterates this filtered to `kind=="axolotl" && stage!="egg"`. [VERIFIED] |
| `colony_center(snapshot, civ_id) -> (u32,u32)` | :1671 | Colony heart coords | Predator spawn-near + hunt-toward target. [VERIFIED] |
| `consume(resources, key, n) -> shortfall` | resolve_environment:2516 | Bounded resource drain | Plunder/trade should drain via this so no negative resources. [VERIFIED] |

### Supporting (new pure helpers to ADD — recommended signatures)
| Helper | Signature (recommended) | Purpose | When Used |
|--------|------------------------|---------|-----------|
| `civ_strength` | `fn civ_strength(snapshot: &CivSessionSnapshot, civ_id: &str) -> f32` | Combat strength = f(pop, tools/tech, owned-territory bonus). **The Phase-5 seam** (add a `genes.strength` term here, nowhere else). | Attack + defense + predator defense. |
| `resolve_attack` | `fn resolve_attack(snapshot: &mut CivSessionSnapshot, attacker: &str, defender: &str, target_region: Option<&str>, rng: &mut u32) -> AttackOutcome` | Compute casualties (both sides), plunder, territory flip; bounded. | Combat world pass. |
| `apply_trade` | `fn apply_trade(snapshot: &mut CivSessionSnapshot, from: &str, to: &str, give: &str, give_amt: i32, recv: &str, recv_amt: i32) -> Result<(),String>` | Deterministic two-civ resource swap, gated on non-hostile stance + affordability. | `trade` action in apply pass. |
| `set_stance` | `fn set_stance(snapshot: &mut CivSessionSnapshot, civ_id: &str, target: &str, stance: &str)` | Write `civs[ci].diplomacy.insert(target, stance)`. | `diplomacy` action. |
| `claim_region` | `fn claim_region(snapshot: &mut CivSessionSnapshot, civ_id: &str, region_id: &str) -> Result<(),String>` | Set `owner=Some(civ_id)` if unclaimed + adjacent. | `claim` action. |
| `spawn_predators` | `fn spawn_predators(snapshot: &mut CivSessionSnapshot, near_civ: &str, count: u32, rng: &mut u32)` | Push `CivEntity{kind:"predator",civ_id:None}` near a colony. | When `predator_incursion` forecast fires (tick_environment). |
| `step_predators` | `fn step_predators(snapshot: &mut CivSessionSnapshot, rng: &mut u32)` | Move predators toward nearest colony, attack (remove axolotl entities), apply civ defense (cull weak/strong predators), expire by lifespan. | Predator world pass. |

### IPC: the `CivDecisionAction` field decision (THE key planning call)
| Instead of | Could Use | Tradeoff / Decision |
|------------|-----------|---------------------|
| New `target: Option<String>` field | Reuse `event_id` or `policy` as a target-id smuggle | **REJECTED** — semantic abuse; `validate_action` arms would clash; future maintainers misread. Add `target`. |
| Separate per-action structs | One `CivDecisionAction` with optional fields | Keep the single flat struct (the established pattern — gather/build/etc. all share it). Add optional fields, dispatch on `action_type`. [VERIFIED pattern :576-597] |

**Recommended minimal new fields on `CivDecisionAction`** (all `#[serde(default)] Option<...>`, back-compat preserved):
```rust
/// Target civ id for attack/raid/diplomacy/trade; or target region id for claim/raid.
#[serde(default)]
pub target: Option<String>,
/// Diplomacy stance for the `diplomacy`/`set_stance` action ("ally|trade|neutral|hostile").
#[serde(default)]
pub stance: Option<String>,
/// Resource the `trade` action wants in return (the give-resource reuses `resource`).
#[serde(default)]
pub receive: Option<String>,
/// Amounts for `trade` (give uses `amount`; receive uses `receive_amount`). Reuse `amount` for plunder caps if desired.
#[serde(default)]
pub amount: Option<u32>,
#[serde(default)]
pub receive_amount: Option<u32>,
```
- `claim`: `{type:"claim", target:"<region_id>"}` (or omit `target` for deterministic adjacent expansion).
- `attack`/`raid`: `{type:"attack", target:"<civ_id>", target_region?:"<region_id>"}` — reuse `target` for civ id; reuse `event_id` OR add `target_region`? **Recommendation: reuse `target` for the civ and keep region optional via the SAME `target` interpreted as region only for `claim`.** To target a specific region in a raid, add nothing extra — raids seize a deterministically-chosen contested region of the defender (simpler, fewer fields). This keeps the new field count at the minimum.
- `diplomacy`: `{type:"diplomacy", target:"<civ_id>", stance:"ally"}`.
- `trade`: `{type:"trade", target:"<civ_id>", resource:"food", amount:10, receive:"stone", receive_amount:5}`.

**Minimal-field recommendation:** add **`target`, `stance`, `receive`, `amount`, `receive_amount`** (5 optional fields, all `#[serde(default)]`). This is one bindings regen. If the planner wants the absolute floor, `target` + `stance` are mandatory; trade amounts can squeeze into `workers` (give amount) — **not recommended** (semantic abuse, `workers` is `Option<u32>` with combat-unrelated validation). Prefer the clean 5-field set.

**Installation / regen (REQUIRED because `CivDecisionAction` changes):**
```bash
# from tauri-app/src-tauri
cargo run --bin export_bindings        # headless: regenerates ../src/bindings.ts, no WebView2
# from tauri-app
npx tsc --noEmit                       # confirm the TS layer still type-checks
```
[VERIFIED: export_bindings.rs:1-13, lib.rs:174-178 — the binary exists and only runs the tauri-specta exporter, no window]

**Version verification:** N/A — no external packages added. The only dependency touched is the in-tree `tauri-specta` exporter already wired.

## Architecture Patterns

### System Architecture Diagram (the turn, after Phase 4)

```
advance_civ_turn(id)                              [civilization.rs:782]
  │
  ├─ snapshot.turn += 1
  ├─ tick_environment(snapshot)                   [:799]  ── if predator_incursion forecast FIRES:
  │      └─ (NEW) spawn_predators(near affected colony)    add wild predator entities (civ_id=None)
  │
  ├─ turn_order = civ_turn_order(snapshot)         [:803, deterministic shuffle]
  │
  ├─ FOR each civ in turn_order:                   [:805 decision loop]
  │      observation = build_observation           [:810]  (already carries rivals[].stance + regions[].owner)
  │      prompt = build_decision_prompt            [:811]  (EXTEND action menu: claim/attack/diplomacy/trade)
  │      decision = call_model_text → parse_model_decision (validate_action gains 4 new arms)
  │      apply_model_decision(snapshot, civ, decision)     [:870]
  │           ├─ "claim"     → claim_region        (mutate region.owner this civ's turn)
  │           ├─ "diplomacy" → set_stance          (mutate civs[].diplomacy this civ's turn)
  │           ├─ "trade"     → apply_trade         (two-civ resource swap this civ's turn)
  │           └─ "attack"    → QUEUE intent        (do NOT resolve mid-loop; record for the world pass)
  │
  ├─ (NEW) COMBAT WORLD PASS  (after decision loop, fixed civ order)   ◄── insert ~line 872
  │      FOR each queued attack (sorted by attacker civ id, deterministic):
  │           if stance gate (ally) → no-op + log
  │           else resolve_attack(attacker, defender) → remove axolotl entities + plunder + owner flip
  │
  ├─ (NEW) PREDATOR WORLD PASS  step_predators(snapshot)   ◄── insert before resolve_environment
  │           move predators → attack nearest colony (remove axolotl entities) → civ defense culls predators → expire
  │
  ├─ FOR each civ: resolve_environment(civ)        [:874]  ── run_life_cycle re-syncs population
  │           if should_collapse → alive=false              from surviving axolotl entities (mirror)
  │
  ├─ tick_modifiers · rescore_all_civs · save_snapshot     [:889-892]
  └─ emit TurnResolved (leaderboard + snapshot)            [:894]
```

**Placement decision (LOCKED by CONTEXT + verified by the population-mirror invariant):**
- `claim` / `diplomacy` / `trade` apply **inside** `apply_model_decision` during the acting civ's own turn (they are non-adversarial mutations of the actor's own state, or a consensual swap). [matches CONTEXT]
- `attack` is **queued** during the decision loop and **resolved in the combat world pass after the loop** so all attacks declared this turn resolve in one deterministic fixed order (sort queued attacks by attacker civ id, then index). This avoids order-of-decision affecting whether a target is alive when attacked. [CONTEXT: "fixed civ order"]
- Combat + predator passes run **before** `resolve_environment` so `run_life_cycle`'s population re-sync (:2767) reflects casualties. **Casualties remove axolotl entities** (use `retain` like the elder-death path :2649), not the `population` counter. [VERIFIED invariant]

### Pattern 1: Entity-removal casualties (NOT counter decrement)
**What:** Combat/predator deaths remove N living axolotl entities of the loser; `population` auto-updates via the mirror.
**Why:** `run_life_cycle` step 4 overwrites `population` from entity count every turn (:2767-2773). Decrementing `population` alone is erased.
**Example:**
```rust
// Source: pattern mirrors run_life_cycle elder-death retain (civilization.rs:2640-2650)
fn kill_axolotls(snapshot: &mut CivSessionSnapshot, civ_id: &str, mut n: u32) -> u32 {
    // Pick the N youngest/weakest deterministically (stable order: by entity id),
    // never eggs (eggs survive a raid; only living axolotls fight/fall).
    let mut victims: Vec<String> = snapshot.world.entities.iter()
        .filter(|e| e.kind == "axolotl" && e.stage != "egg"
                 && e.civ_id.as_deref() == Some(civ_id))
        .map(|e| e.id.clone())
        .collect();
    victims.sort();                 // deterministic selection order
    victims.truncate(n as usize);
    let killed = victims.len() as u32;
    snapshot.world.entities.retain(|e| !victims.contains(&e.id));
    killed
}
```

### Pattern 2: Deterministic strength + bounded outcome (no instant wipeout)
**What:** `civ_strength` is the single seam; `resolve_attack` derives casualties from the strength ratio, capped.
**Example (illustrative coefficients — Claude's discretion):**
```rust
fn civ_strength(snapshot: &CivSessionSnapshot, civ_id: &str) -> f32 {
    let Some(ci) = civ_index(snapshot, civ_id) else { return 0.0 };
    let c = &snapshot.civs[ci];
    let pop = c.population as f32;
    let tools = *c.resources.get("tools").unwrap_or(&0) as f32;
    let tech = c.techs.len() as f32;
    let owned = snapshot.world.regions.iter()
        .filter(|r| r.owner.as_deref() == Some(civ_id)).count() as f32;
    // Phase 5 SEAM: add `+ gene_strength_term(c)` here, nowhere else.
    round1(pop * 1.0 + tools * 0.2 + tech * 1.5 + owned * 2.0)
}

fn resolve_attack(snapshot: &mut CivSessionSnapshot, atk: &str, def: &str, rng: &mut u32) -> bool {
    let a = civ_strength(snapshot, atk);
    let d = civ_strength(snapshot, def)
          + home_region_bonus(snapshot, def);           // defender home bonus
    let roll = rand_range(rng, 0.85, 1.15);             // seed^turn jitter
    let ratio = (a * roll) / (d.max(1.0));
    // BOUNDED casualties: at most CASUALTY_CAP fraction of each side dies per attack.
    let def_loss = bound_casualties(snapshot, def, (ratio * 0.10).min(CASUALTY_CAP));
    let atk_loss = bound_casualties(snapshot, atk, (0.06 / ratio).min(CASUALTY_CAP));
    kill_axolotls(snapshot, def, def_loss);
    kill_axolotls(snapshot, atk, atk_loss);
    let win = ratio > WIN_THRESHOLD;                     // e.g. 1.3
    if win { plunder(snapshot, atk, def); maybe_flip_region(snapshot, atk, def); }
    win
}
```
**Bounded:** never let an attack take a civ below `MIN_SURVIVORS` (e.g. clamp so `def_loss < population`), so combat can't reach 0 in one strike — collapse happens through attrition + `should_collapse` (needs pop==0 AND no eggs). [VERIFIED: should_collapse:1664-1668]

### Pattern 3: Ally no-fight gate (decide ONE mutuality rule + test it)
**What:** In attack validation/resolution, reject if the attacker considers the target an ally.
**Recommendation (simplest + testable):** **unilateral** — if `attacker.diplomacy[target] == "ally"`, no-op + log "refuses to attack an ally". This is the minimal rule and matches "decide one rule and test it." If the planner prefers **mutual** (both must declare ally), gate on `a.diplomacy[def]=="ally" && def.diplomacy[a]=="ally"`. Pick one; write a test asserting the chosen semantics. Also block `trade` when stance is `hostile`.

### Pattern 4: Predator entity lifecycle (net-new; reuse the wild-fauna slot)
**What:** A predator is `CivEntity{kind:"predator", role:"predator", civ_id:None, health, x, y, age, ...Default}` with `age` doubling as a lifespan counter. Spawn count/lifespan = Claude's discretion (e.g. 1-3 predators, lifespan 4-6 turns, tied to `predator_incursion` duration which is 3 turns :5138).
**Hunt:** each turn move toward `colony_center` of the nearest living civ; if adjacent, remove `damage` axolotl entities (bounded), reduced by that civ's `civ_strength` (defense). Strong civs cull predators (remove the predator entity).
**Expire:** `age += 1`; retain only predators with `age < lifespan`. **Determinism:** seed^turn with a predator-specific salt; ids `format!("predator-{turn}-{n}")` — no uuid/clock (mirror the disaster id convention :5154). [VERIFIED: tick_environment id pattern]

### Recommended Project Structure
No new files. All additions land in `civilization.rs`:
- Struct field additions: in `CivDecisionAction` (:576).
- Validation arms: in `validate_action` (:2108, add 4 `match` arms).
- Apply arms: in `apply_model_decision` match (:2199, add claim/diplomacy/trade; queue attack).
- New pure helpers: place near other leaf helpers (after `round1` :4921, alongside the env helpers, or just before the test module).
- World passes: new `fn resolve_combat(...)` + reuse-aware `step_predators` called from `advance_civ_turn` between :871 and :874.
- Spawn hook: in `tick_environment` predator_incursion fire branch (:5174-5193).
- Prompt menu: extend `build_decision_prompt` action list (:2057-2064).

### Anti-Patterns to Avoid
- **Decrementing `population` directly** for casualties — overwritten by the mirror (:2767). Remove entities.
- **Resolving attacks mid-decision-loop** — order-dependent + non-deterministic w.r.t. which targets are alive. Queue then resolve in a fixed pass.
- **uuid/wall-clock ids or `rand`/`SystemTime`** in any combat/predator code — breaks replay. Use `next_rng` + `format!("...-{turn}-{n}")`.
- **Pushing an unknown `CivModifier.kind`** — `resolve_environment`'s match (:2538) silently no-ops unknown kinds (the documented Phase-3 pitfall). If combat after-effects use a modifier, reuse an existing kind or add an arm.
- **Negative resources** from plunder/trade — drain via bounded `consume`/`.max(0)`; never `-=` unchecked.
- **Smuggling target ids into `event_id`/`policy`** — add the clean `target` field; respect the established one-flat-struct dispatch pattern.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Random rolls | A new PRNG / `rand` crate | `next_rng`/`rand_f`/`rand_range` (:4704-4719) | Engine-wide determinism contract; `rand` is non-replayable. |
| Per-pass seeding | `SystemTime`/counter | `seed ^ turn.wrapping_mul(0x9E37_79B9) ^ <salt>` | Established idiom; salts keep passes uncorrelated. |
| Population accounting | A combat-only pop counter | Remove axolotl entities; mirror re-syncs (:2767) | Single source of truth; avoids drift between counter and entities. |
| Region ownership | A new ownership map | `CivRegion.owner: Option<String>` (:319) | Already wired into observation, renderer overlay, score. |
| Stance storage | A new diplomacy struct | `CivCivilization.diplomacy: HashMap` (:454) | Already in observation as `rivals[].stance`. |
| Wild entity slot | A new entity table | `CivEntity{civ_id:None}` (:358) | Renderer + civ-filter helpers already treat `civ_id:None` as wild. |
| Bounded resource drain | Manual `-=` | `consume(resources,key,n)` (:2516) | Returns shortfall, clamps at 0. |
| IPC type generation | Hand-editing bindings.ts | `cargo run --bin export_bindings` | bindings.ts is auto-generated; hand-edits are overwritten + drift (project gotcha #1). |

**Key insight:** Everything combat needs already exists as a deliberately-placed seam (the CONTEXT calls these out: `owner`, `diplomacy`, `civ_id:None` were "put in place FOR this phase"). The work is *wiring*, not invention. The only genuinely new concept is the predator entity behavior loop.

## Runtime State Inventory

> This is a code-only feature addition, not a rename/refactor/migration. No stored data keys, service config, OS-registered state, secrets, or build artifacts carry strings that this phase renames.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Existing civ session snapshots (`~/.xolotl-code` civilizations dir) are JSON with `#[serde(default)]` everywhere; **new `CivDecisionAction` fields + new `predator` entities + `owner`/`diplomacy` writes are forward-compatible** — old saves load (defaults fill), new saves carry the fields. No migration. | None — verified by the universal `#[serde(default)]` discipline on the structs (:330, :455, :579-596). |
| Live service config | None — no external service stores combat state. | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | None — combat reads no config keys. | None. |
| Build artifacts | `bindings.ts` becomes stale the moment `CivDecisionAction` gains a field — it is a generated artifact committed to git (project gotcha #1 + MEMORY "bindings.ts drift trap"). | Regenerate via `cargo run --bin export_bindings`, then `npx tsc --noEmit`, then commit the regenerated `bindings.ts`. |

## Common Pitfalls

### Pitfall 1: Casualties via `population` decrement get erased
**What goes wrong:** You set `civs[ci].population -= losses`; next `resolve_environment` runs `run_life_cycle` which re-sets `population` to the entity count, undoing it.
**Why:** `population` is a derived mirror, re-synced every turn (:2767-2773).
**How to avoid:** Remove axolotl entities (`retain`); let the mirror update. Run combat/predators BEFORE `resolve_environment`.
**Warning signs:** A test where pop drops then magically recovers next turn; combat "does nothing."

### Pitfall 2: Non-deterministic combat (replay diverges)
**What goes wrong:** Using `rand::random()`, `uuid`, `SystemTime`, or `HashMap` iteration order for combat order.
**Why:** Replay/eval requires byte-identical re-runs from `(seed, turn)`.
**How to avoid:** Only `next_rng` seeded by `seed^turn^salt`; sort queued attacks + casualty victims by stable key (civ id / entity id); ids via `format!`.
**Warning signs:** A determinism test (`resolve twice on a fresh clone → assert equal`) fails intermittently.

### Pitfall 3: Forgetting the bindings regen → tsc red / drift
**What goes wrong:** Add a `CivDecisionAction` field, skip regen; `bindings.ts` is stale, frontend type-checks against the old shape, or a later `tauri dev` regen produces a surprising diff.
**Why:** bindings.ts is auto-generated and committed (gotcha #1, MEMORY drift trap).
**How to avoid:** Run `cargo run --bin export_bindings` + `npx tsc --noEmit` and commit bindings.ts in the SAME change as the Rust field. The MEMORY note warns a *full* regen can red unrelated lines — verify the diff is limited to the `CivDecisionAction` type; if it reds eval/other types, hand-add only the new `CivDecisionAction` fields to bindings.ts (the documented mitigation).
**Warning signs:** `npx tsc --noEmit` errors on CivDecisionAction; large unexpected bindings.ts diff.

### Pitfall 4: Instant wipeout (CONTEXT bound violated)
**What goes wrong:** Strength ratio → casualties unbounded → a strong civ deletes a weak one in one attack.
**How to avoid:** Cap per-attack casualties (`CASUALTY_CAP` fraction) AND clamp so `def_loss < population` (always leave ≥1 survivor per attack); collapse only via attrition through `should_collapse`.
**Warning signs:** Invariant test "single attack never reduces defender to 0" fails.

### Pitfall 5: Predator renders as an axolotl (acceptable, but know it)
**What goes wrong:** A `predator` entity is funneled into `createAxo` (CivilizationGameCanvas:980 — only `building`/`object` are skipped) and renders as an untinted axolotl sprite.
**Why:** The renderer has no predator sprite; CONTEXT defers war visuals to W9.
**How to avoid:** This is EXPECTED and in-scope-acceptable (data rides existing rendering; cosmetic distinction deferred). Do NOT add a renderer change — that's out of scope. If a distinct look is later wanted, it's a W9 frontend task.
**Warning signs:** None — this is intended behavior for this phase. Just don't "fix" it.

### Pitfall 6: Adding clippy warnings on top of the baseline
**What goes wrong:** New combat code trips a `pedantic` lint; CI clippy (`-D warnings`) fails.
**Why:** Workspace lints are `pedantic` + `-D warnings`; there are 16 PRE-EXISTING baseline errors in src-tauri (deferred-items.md) — add ZERO new, fix none of the baseline.
**How to avoid:** Run `cargo clippy --all-features -- -D warnings` in `tauri-app/src-tauri`; confirm count == 16 and none in your new lines. Common pedantic traps: `cast_precision_loss` on `as f32` (allow locally or use `f64::from`), `too_many_arguments` (use a small struct or `#[allow]` like `make_axolotl` :4840), `needless_pass_by_value`.
**Warning signs:** clippy count > 16.

## Code Examples

### Validation arm pattern (extend `validate_action` :2108)
```rust
// Source: civilization.rs:2123-2177 (existing arms)
"attack" | "raid" => {
    if action.target.as_deref().unwrap_or_default().trim().is_empty() {
        return Err("attack.target (civ id) is required".to_string());
    }
}
"diplomacy" | "set_stance" => {
    let stance = action.stance.as_deref().ok_or("diplomacy.stance is required")?;
    if !matches!(stance, "ally" | "trade" | "neutral" | "hostile") {
        return Err(format!("unknown stance: {stance}"));
    }
    if action.target.as_deref().unwrap_or_default().trim().is_empty() {
        return Err("diplomacy.target (civ id) is required".to_string());
    }
}
"trade" => {
    if action.target.is_none() || action.resource.is_none() || action.receive.is_none() {
        return Err("trade requires target, resource, receive".to_string());
    }
}
"claim" => { /* target optional: present = specific region, absent = deterministic adjacent expansion */ }
```

### Dispatch arm pattern (extend `apply_model_decision` :2199)
```rust
// Source: civilization.rs:2199-2206 (existing dispatch)
"claim"     => claim_region_action(snapshot, civ_id, action),
"diplomacy" | "set_stance" => set_stance_action(snapshot, civ_id, action),
"trade"     => apply_trade_action(snapshot, civ_id, action),
"attack" | "raid" => queue_attack(&mut attacks, civ_id, action),  // NOTE: needs a queue in scope
// ^ since apply_model_decision can't easily own a queue, prefer: collect attack intents in
//   advance_civ_turn by inspecting the decision's actions, OR stash on the snapshot, OR
//   resolve attacks in a second per-civ loop reading each civ's last decision. Simplest:
//   in advance_civ_turn, after apply_model_decision, scan decision.actions for type=="attack"
//   and push (attacker, target) into a Vec<(String,String)>; resolve after the loop.
```
**Planner note:** the cleanest queueing is **in `advance_civ_turn`**: keep `apply_model_decision` pure for non-attack actions, and in the decision loop collect attack intents into a local `Vec<(attacker, target)>`, then run the combat pass over that vec (sorted) after the loop. This avoids threading a mutable queue through `apply_model_decision`.

### Prompt menu extension (extend `build_decision_prompt` :2057-2064)
```rust
// Append to the "Allowed action types" list:
"         - claim: target = an unclaimed region id adjacent to your territory\n\
          - attack: target = a rival civ id (refused if that civ is your ally)\n\
          - diplomacy: target = a rival civ id, stance one of ally, trade, neutral, hostile\n\
          - trade: target = a rival civ id, resource + amount to give, receive + receive_amount to get (blocked if hostile)\n\"
```
The observation already gives the model `rivals[].id/stance` (:1994-2002) and `biome_regions[].owner` (:2025-2032), so it can choose targets. [VERIFIED]

### Determinism test pattern (Validation)
```rust
// Source: mirrors tick_environment_deterministic (civilization.rs:7101) + multi_civ_snapshot (:6485)
#[test]
fn resolve_attack_is_deterministic() {
    let base = multi_civ_snapshot(2024, 2);
    let mut a = base.clone(); a.turn = 5;
    let mut b = base.clone(); b.turn = 5;
    let mut ra = a.seed ^ a.turn.wrapping_mul(0x9E37_79B9) ^ COMBAT_SALT;
    let mut rb = b.seed ^ b.turn.wrapping_mul(0x9E37_79B9) ^ COMBAT_SALT;
    let oa = resolve_attack(&mut a, &civ_id_for(0), &civ_id_for(1), &mut ra);
    let ob = resolve_attack(&mut b, &civ_id_for(0), &civ_id_for(1), &mut rb);
    assert_eq!(oa, ob);
    assert_eq!(serde_json::to_string(&a.civs).unwrap(),
               serde_json::to_string(&b.civs).unwrap());
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `predator_incursion` = morale-only disaster (`quarrel_pressure` modifier) | (Phase 4) it ALSO spawns predator entities | This phase | tick_environment fire branch gains a spawn call; the modifier can stay (predators + morale pressure coexist) or be replaced — Claude's discretion. |
| `region.owner` set only at spawn | Mutated by `claim` + raid transfer | This phase | Renderer overlay + score already read it — they update for free. |
| `diplomacy` map always empty | Written by `set_stance`; read by the ally gate | This phase | Observation `rivals[].stance` becomes meaningful. |

**Deprecated/outdated:** None. Nothing is removed; all changes are additive and back-compat (`#[serde(default)]`).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The MEMORY "bindings.ts drift trap" (full regen reds unrelated eval types) still applies; a clean targeted regen may also work. | Pitfall 3 / Installation | LOW — if full regen is clean, just commit it; if it reds unrelated lines, hand-add only the new `CivDecisionAction` fields (documented mitigation). Either way, verify the diff. |
| A2 | `renderSnapshotToText` (the fallback path of `render_game_to_text`) includes enough civ/log state that war/diplomacy events are observable as text without a FE change. | ARENA-01 / Resp. Map | LOW — even if `renderSnapshotToText` is terse, the full snapshot JSON (with `diplomacy`, `region.owner`, predator entities, and `log`) is the authoritative harness state; ARENA-01 is satisfied by the snapshot + log regardless. Planner can spot-check `renderToText`/`renderSnapshotToText` if it wants stance in the human-readable text too. |
| A3 | Recommending casualties remove the *lowest-sorted (by id)* axolotls as the deterministic selection rule. | Pattern 1 | LOW — any stable deterministic rule works; "youngest/weakest" or "by id" are both fine. Choice affects which sprites disappear, not invariants. |

**Note:** No compliance/security/retention assumptions — this is internal game logic.

## Open Questions

1. **Mutual vs unilateral ally gate** (CONTEXT explicitly defers to Claude: "decide one rule and test it").
   - What we know: both are trivially implementable from the `diplomacy` map.
   - What's unclear: which produces better emergent play.
   - Recommendation: **unilateral** (attacker won't attack a civ it has flagged `ally`) — simpler, fewer surprising no-ops, easy to test. Document + test the chosen rule. Planner should lock this in PLAN.

2. **Does a raid target a specific region, or auto-seize a deterministic contested region?**
   - What we know: adding a `target_region` field is one more optional field (already proposed via reusing `target` for `claim`).
   - Recommendation: **auto-seize** the defender's most-peripheral owned region on a decisive win (no extra field, fewer model errors). Keeps field count minimal. Planner decides.

3. **Should the existing `quarrel_pressure` modifier still fire on `predator_incursion`, or be replaced by entity predators?**
   - Recommendation: **keep both** (predators are the physical threat; morale pressure is the ambient dread) — least disruptive, no Phase-3 test changes. Claude's discretion.

## Environment Availability

> Code-only Rust addition. The only "tooling" is the existing Rust + cargo + the in-tree export_bindings binary + npm/tsc.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust + cargo (src-tauri crate) | All backend work | ✓ (project builds today) | workspace pin | — |
| `cargo run --bin export_bindings` | bindings regen (IPC field add) | ✓ | in-tree (export_bindings.rs) | hand-add fields to bindings.ts (MEMORY mitigation) |
| `npx tsc --noEmit` | TS type-check after regen | ✓ | project devDep | — |
| `cargo test --no-run` (Windows) | Compile-check new tests locally | ✓ | — | run on CI |
| `cargo test` (Linux/macOS CI) | Actually run backend tests | ✓ via CI (tauri-app.yml) | — | none needed (cannot run on Windows — WebView2 loader, gotcha #5) |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** bindings regen — fallback is the documented hand-edit if full regen reds unrelated types.

## Validation Architecture

> nyquist_validation is enabled (config.json workflow.nyquist_validation = true). This section feeds VALIDATION.md.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Rust built-in `#[test]` (the `mod tests` at civilization.rs:5281), plus `vitest` for any TS (none expected this phase) |
| Config file | none — cargo built-in; CI: `.github/workflows/tauri-app.yml` |
| Quick run command (Windows) | `cargo test --no-run -p <src-tauri crate>` (COMPILE-CHECK only — WebView2 blocks running, gotcha #5) |
| Full suite command (CI / Linux/macOS) | `cargo test` in `tauri-app/src-tauri` |
| Lint gate | `cargo clippy --all-features -- -D warnings` (must stay at the 16-error baseline; ZERO new) + `cargo fmt --all -- --check` |
| Bindings gate | `cargo run --bin export_bindings` then `npx tsc --noEmit` (only because `CivDecisionAction` changes) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WAR-01 | `claim` sets `region.owner` to the claiming civ when unclaimed+adjacent; rejects owned/non-adjacent | unit | `cargo test claim_region` | ❌ Wave 0 (add to mod tests) |
| WAR-01 | Successful raid transfers a defender region's `owner` to attacker (contestable) | unit | `cargo test raid_transfers_owner` | ❌ Wave 0 |
| WAR-02 | `civ_strength` increases with pop/tools/tech/owned-territory (monotonic seam test) | unit | `cargo test civ_strength_monotonic` | ❌ Wave 0 |
| WAR-02 | `resolve_attack` is byte-deterministic for fixed (seed,turn) | unit (determinism) | `cargo test resolve_attack_is_deterministic` | ❌ Wave 0 |
| WAR-02 | INVARIANT: a single attack never reduces defender population to 0 (no instant wipeout); no negative resources | unit (invariant) | `cargo test attack_no_instant_wipeout` / `attack_no_negative_resources` | ❌ Wave 0 |
| WAR-02 | Casualties remove axolotl ENTITIES so `population` mirror reflects them after `resolve_environment` | unit | `cargo test combat_casualties_remove_entities` | ❌ Wave 0 |
| WAR-02 | Plunder steals a BOUNDED share; attacker gains == defender loses (conservation), clamped ≥0 | unit (invariant) | `cargo test plunder_is_bounded_and_conserved` | ❌ Wave 0 |
| WAR-03 | `set_stance` writes the `diplomacy` map; observation reflects it | unit | `cargo test set_stance_writes_map` | ❌ Wave 0 |
| WAR-03 | Ally no-fight gate: attack on an ally is a logged no-op (assert chosen mutuality rule) | unit | `cargo test allies_do_not_fight` | ❌ Wave 0 |
| WAR-03 | `apply_trade` swaps resources between two civs deterministically; blocked when hostile; never negative | unit | `cargo test apply_trade_swaps` / `apply_trade_blocked_when_hostile` | ❌ Wave 0 |
| WAR-04 | `predator_incursion` firing spawns predator entities (`kind=="predator", civ_id==None`) | unit | `cargo test predator_incursion_spawns_predators` | ❌ Wave 0 |
| WAR-04 | `step_predators` reduces a colony's living axolotls, deterministic, predators expire by lifespan | unit (determinism + invariant) | `cargo test step_predators_hunt_and_expire` | ❌ Wave 0 |
| WAR-04 | Strong civ (high `civ_strength`) culls predators / takes less damage than a weak civ | unit | `cargo test strength_defends_against_predators` | ❌ Wave 0 |
| ALL | Multi-turn replay: same seed → identical snapshot JSON across the whole turn incl. combat/predators | unit (determinism) | `cargo test turn_with_combat_is_replay_stable` | ❌ Wave 0 |
| ARENA-02 | Existing actions (gather/build/etc.) + existing tests still pass (no regression) | regression | `cargo test` (CI) | ✅ existing suite |
| Emergent balance (no req id) | Wars/trades/predators produce watchable, non-degenerate outcomes over many turns | manual / observation | run a live multi-civ session; observe leaderboard + log | manual (human/CI live run) |

### Sampling Rate
- **Per task commit:** `cargo test --no-run` (Windows compile-check) + `cargo clippy --all-features -- -D warnings` (baseline==16) + `cargo fmt --check`.
- **On any `CivDecisionAction` change:** `cargo run --bin export_bindings` + `npx tsc --noEmit`, commit bindings.ts.
- **Per wave merge:** full `cargo test` on CI (Linux/macOS) — all WAR-* unit + determinism + invariant tests green.
- **Phase gate:** full CI suite green + clippy baseline-only + a manual live-session sanity observation (emergent balance) before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] All WAR-* unit tests above — add to the existing `mod tests` in civilization.rs (reuse `multi_civ_snapshot` :6485, `test_snapshot` :5291, `civ_id_for` :1580). No new test files/fixtures needed.
- [ ] No framework install — `#[test]` + `multi_civ_snapshot` already exist.
- [ ] Determinism helper pattern: clone snapshot, run pass on both, assert `serde_json::to_string` equal (pattern at :7101 `tick_environment_deterministic`).

*(No conftest/fixtures gap — the Rust test module + `multi_civ_snapshot` cover all setup.)*

## Security Domain

> security_enforcement is not set in config.json (absent). This is a self-contained, offline, single-user desktop game-simulation feature with no network surface, no auth, no untrusted input beyond the LLM's own JSON (already validated + repaired by `parse_model_decision`/`validate_action`). Standard ASVS web categories (auth/session/access-control) do not apply.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | n/a (local desktop, single user) |
| V3 Session Management | no | n/a |
| V4 Access Control | no | n/a (no multi-tenant; the "civ" is not a security principal) |
| V5 Input Validation | yes (mild) | Model JSON is validated by `validate_action` + clamped (e.g. `workers.clamp`, bounded casualties, `consume` clamps ≥0). New action arms MUST validate target ids exist + clamp amounts so a malformed/hostile model decision can't create negative resources or panic (e.g. index a non-existent civ). |
| V6 Cryptography | no | n/a (no secrets; RNG is a game PRNG, deliberately non-crypto + deterministic) |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Model emits a `target` civ id that doesn't exist | Tampering / DoS (panic) | `civ_index(...).ok_or(...)`/`else { return }` guard in every new arm (mirror existing `let Some(ci) = civ_index... else { return }` at :2212). |
| Model requests a trade/plunder larger than holdings → negative resources | Tampering | Drain via `consume`/`.max(0)`; cap give-amount at current holdings. |
| Unbounded casualties → instant civ deletion | DoS (game-state) | `CASUALTY_CAP` + leave ≥1 survivor per attack (CONTEXT bound). |
| Non-deterministic combat breaks eval replay | Repudiation (eval integrity) | seed^turn RNG only; stable sort keys; no uuid/clock — covered by determinism tests. |
| Integer overflow on amounts (`u32`/`i32`) | Tampering | Use saturating/clamped arithmetic (`saturating_add`, `.max(0)`), as the codebase already does. |

## Sources

### Primary (HIGH confidence) — all in-repo, verified this session
- `tauri-app/src-tauri/src/civilization.rs` — `CivDecisionAction` (:576), `validate_action` (:2108), `apply_model_decision` (:2182), `advance_civ_turn` (:782), `build_observation` (:1980), `build_decision_prompt` (:2050), `resolve_environment`/`run_life_cycle` + population mirror (:2509/:2603/:2767), `civ_turn_order` (:1603), `should_collapse` (:1664), RNG `next_rng`/`rand_f`/`rand_range` (:4704-4719), `round1` (:4919), `tick_environment` + predator_incursion (:5156, :5178), `CivRegion.owner` (:319), `CivCivilization.diplomacy` (:454), `CivEntity.civ_id` (:358), home claim (:1538), `multi_civ_snapshot` test helper (:6485), determinism test pattern (:7101).
- `tauri-app/src/bindings.ts` — `CivDecisionAction` type (:290-301), `CivModelDecision` (:418), advance_civ_turn signature (:415-421).
- `tauri-app/src-tauri/src/lib.rs` — command registration (`collect_commands!` :54-116), `export_bindings` (:174-178).
- `tauri-app/src-tauri/src/bin/export_bindings.rs` — headless regen binary (:1-13).
- `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx` — per-owner territory overlay (:720-732), entity render funnel `createAxo` (:977-1034), `render_game_to_text` wiring (:259).
- `tauri-app/src/lib/tauriBrowserFallback.ts` — `advance_civ_turn` → `advancePreviewCiv()` cosmetic stub (:1245-1247), confirming no engine mirror.
- `.planning/phases/04-w6-combat-diplomacy/04-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/config.json`, `CLAUDE.md`, `.planning/phases/01-.../deferred-items.md` (clippy baseline = 16).

### Secondary (MEDIUM confidence)
- User MEMORY "bindings.ts drift trap" — full regen may red unrelated eval types; mitigation = hand-add only the new fields. (Treated as a known caution, A1.)

### Tertiary (LOW confidence)
- None. No external/web sources were needed — this is a self-contained engine extension verified entirely against source.

## Metadata

**Confidence breakdown:**
- IPC / CivDecisionAction decision: **HIGH** — struct, bindings, and command-collection mechanism all read directly; the regen path (export_bindings binary) verified to exist.
- Combat/diplomacy/predator architecture: **HIGH** — every reused seam (owner, diplomacy, civ_id:None, RNG, population mirror, turn loop insertion point) verified against current source; the population-mirror finding is load-bearing and confirmed at :2767.
- Predators net-new: **HIGH** — grep confirms no wild fauna exist today and predator_incursion currently only pushes a morale modifier.
- Coefficients/caps/lifespans: **MEDIUM** — explicitly Claude's discretion; the patterns/bounds are sound but exact numbers are tuning, validated by invariant tests not by fixed values.

**Research date:** 2026-06-07
**Valid until:** 2026-07-07 (stable — internal code, no fast-moving external deps; only invalidated by major refactors of `civilization.rs`)
