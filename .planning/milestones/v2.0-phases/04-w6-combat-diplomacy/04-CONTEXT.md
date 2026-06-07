# Phase 4: W6 — Combat & Diplomacy - Context

**Gathered:** 2026-06-07
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (decisions by Claude per user's "keep going on your own" directive; proposals auto-accepted)

<domain>
## Phase Boundary

Civilizations stop being isolated. They claim/own/contest territory (WAR-01);
resolve combat and raids deterministically with population/resource/territory
consequences (WAR-02); set diplomacy stances and execute trades, where allies do
NOT fight (WAR-03); and defend with strength against wild predators that hunt
axolotls (WAR-04, spawned by Phase 3's `predator_incursion`).

In scope: backend `tauri-app/src-tauri/src/civilization.rs` — new model decision
actions (claim / attack-or-raid / set-stance / trade), a deterministic
combat/interaction resolution step in the turn loop, predator entities + their
hunt/defend behavior, and the territory-ownership mutations. Out of scope: a
dedicated diplomacy-management UI / war HUD (deferred W9 — the data rides the
snapshot/text-state which Phase 1 already exposes), genetics (Phase 5 adds the
`strength` gene that feeds combat — Phase 4 must leave a clean strength seam).
</domain>

<decisions>
## Implementation Decisions

### Territory (WAR-01)
- Regions carry `owner: Option<String>` already (None = unclaimed; home claimed at
  spawn). A civ can CLAIM an adjacent unclaimed region (a new `claim` model action,
  or deterministic expansion) — sets `owner = Some(civ_id)`. CONTEST/seize happens
  via a successful raid/attack (WAR-02) which transfers `owner`.
- Ownership is tracked (already in observation/text-state at ~2031) and contestable.
  A civ's territory count feeds its strength (home/owned bonus) and score.

### Combat & Raids (WAR-02)
- New model action `attack` / `raid` targeting another civ (and/or one of its
  regions). **Deterministic** resolution (seed^turn): outcome from attacker vs
  defender STRENGTH, where strength = f(population, tools/tech, owned-territory
  bonus, defender home-territory bonus) — designed so Phase 5 can add a genetic
  `strength` term cleanly (a single `civ_strength(civ, …)` helper).
- Consequences: population losses on BOTH sides (scaled by the strength ratio),
  resource PLUNDER on a successful raid (attacker steals a bounded share of
  defender resources), and TERRITORY transfer on a decisive win (a contested
  region's `owner` flips). All bounded; never instantly annihilate a civ.
- **Allies don't fight** (WAR-03 gate): an attack is rejected/no-op if the
  attacker's stance toward the target is `ally` (and/or mutual ally). Logged.

### Diplomacy & Trade (WAR-03)
- New model action `diplomacy` / `set_stance`: a civ sets its stance toward another
  in the existing `diplomacy: HashMap<civ_id,String>` map (`ally|trade|neutral|hostile`).
  Unilateral declaration; `ally` is only mutually binding for the no-fight gate when
  BOTH sides declare ally (decide one rule and test it).
- New `trade` action: a deterministic resource exchange between two civs (give X of
  resource A, receive Y of resource B), gated by a non-hostile stance. Both civs'
  resource counts update; logged. (Distinct from the Game-B NPC `trade_resource`
  quest — that's the possession layer, untouched.)

### Wild Predators (WAR-04)
- Phase 3's `predator_incursion` disaster SPAWNS wild predator entities
  (`civ_id = None`, a `predator` role) near a colony. Predators hunt axolotls: each
  turn they move toward the nearest colony and attack — reducing that civ's
  population — and the civ DEFENDS with strength (defense reduces/repels predator
  damage; strong civs kill predators). Deterministic; predators expire/are culled.
- Reuse the existing wild-fauna notion (entities with `civ_id = None`).

### Integration & Determinism
- Add a world-level interaction-resolution step in `advance_civ_turn` (combat +
  predators resolved AFTER civ decisions each turn, so attacks declared this turn
  resolve deterministically in a fixed civ order). Diplomacy/claim apply during the
  civ's own action application (`apply_model_decision`); combat resolution and
  predator behavior are a post-decision world pass.
- **Determinism:** all rolls seed^turn-derived (no wall-clock/uuid), reusing the
  established RNG idiom + `round1`. Combat must be replay-stable.
- **Pure helpers for testability:** `civ_strength(...)`, `resolve_attack(attacker,
  defender, seed, turn) -> outcome`, `apply_trade(...)`, `step_predators(...)` as
  pure/near-pure functions unit-tested with `cargo test` (compile on Windows via
  `--no-run`; run on CI).

### Open question for RESEARCH (do not guess in CONTEXT)
- Do the new actions (attack/claim/diplomacy/trade) need new fields on the
  `CivDecisionAction` struct (a `#[derive(Type)]` type in bindings)? If yes, this is
  an IPC change → bindings MUST be regenerated headlessly (`cargo run --bin
  export_bindings`) + `tsc`. RESEARCH must determine whether new fields are needed or
  whether existing action fields (target ids, amounts) can be reused, and PLAN
  accordingly (prefer reuse; if a field is unavoidable, include the regen step).

### Claude's Discretion
- Exact strength formula + coefficients, plunder/casualty ratios + caps, claim
  adjacency rule, predator damage/spawn counts/lifespan, ally mutuality rule.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `civilization.rs`: `CivRegion.owner: Option<String>` (~313-331, home-claim at
  ~1543, backfill ~4637); `CivCivilization.diplomacy: HashMap<String,String>`
  (~454-456, init empty ~1020); entities' `civ_id: Option<String>` (None = wild
  fauna/predators ~358); the model-decision action pipeline (`apply_model_decision`
  + `validate_action` dispatch over gather/build/research/explore/policy/prepare —
  extend with the new action types); `CivModifier`/`modifiers` for post-combat
  after-effects; the seed^turn RNG idiom + `round1`; `push_log`/`push_decision_log`;
  observation/prompt already surface diplomacy stance (~2001) + region owner (~2031)
  so models can reason about war/peace; Phase 3's `predator_incursion` disaster + the
  env tick (the spawn trigger for WAR-04).

### Established Patterns
- Model actions are JSON parsed into `CivDecisionAction` then dispatched; new actions
  follow that path. Seed-deterministic; `#[serde(default)]` on any new field for
  back-compat; world invariants hold after mutation; unsafe_code forbidden.

### Integration Points
- `advance_civ_turn` turn loop (post-decision world pass for combat/predators);
  `apply_model_decision` (per-civ claim/diplomacy/trade application); `tick_environment`
  (Phase 3) spawns predators on `predator_incursion`. `tauriBrowserFallback.ts` is a
  cosmetic stub (Phase 3 confirmed it is not a real engine mirror) — verify it needs
  no change.

</code_context>

<specifics>
## Specific Ideas

- Build on what exists: `region.owner` + the `diplomacy` map were put in place FOR
  this phase ("mutated by claim/raid once combat lands (W6)"). Extend the action
  pipeline rather than inventing a parallel one.
- Leave a single clean `civ_strength(...)` seam so Phase 5's `strength` gene plugs in
  without reworking combat.
- Keep ARENA contracts intact: combat/diplomacy/territory state must ride the
  existing snapshot → `render_game_to_text` so harnesses observe the war (ARENA-01),
  and any new model action must not break existing controls (ARENA-02).

</specifics>

<deferred>
## Deferred Ideas

- Diplomacy-management UI / war HUD / territory overlay beyond Phase 2's basic tint
  (deferred W9 — data rides the snapshot/text-state).
- Genetic `strength` gene + its effect on combat (Phase 5 — Phase 4 leaves the seam).
- Deep combat animations/VFX in the renderer.

</deferred>
