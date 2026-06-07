---
phase: 04-w6-combat-diplomacy
plan: 03
subsystem: api
tags: [rust, civilization-engine, predators, wild-fauna, war, determinism, entity-removal]

# Dependency graph
requires:
  - phase: 04-w6-combat-diplomacy
    provides: "04-02: civ_strength (the combat/defense seam, reused here as predator defense); kill_axolotls + living_axolotl_count (bounded entity-removal casualties leaving >=1 survivor); the after-resolve_combat / before-resolve_environment world-pass placement and distinct-salt determinism convention; the attack queue + resolve_combat call this pass slots in next to"
  - phase: 03-w4-environment-disasters
    provides: "tick_environment forecast/fire pipeline; the predator_incursion disaster (epicenter_x/radius/intensity, duration 3, quarrel_pressure modifier) whose fire branch is the spawn hook; disaster_duration; deterministic dis-{turn}-{kind} id convention"
  - phase: 01-w9-lite-multi-model-world-creation-leaderboard
    provides: "CivEntity{civ_id:None} wild-fauna slot; population mirror (run_life_cycle re-sync); colony_center/dist2; seed^turn RNG idiom; multi_civ_snapshot test fixture; consume bounded drain"
provides:
  - "spawn_predators (WAR-04): net-new wild predator entities (kind/role 'predator', civ_id None, deterministic predator-{turn}-{n} ids, age 0) spawned near the colony nearest a fired predator_incursion's epicenter; 1-3 scaled by forecast.intensity; the existing quarrel_pressure modifier is KEPT (Open Q3)"
  - "step_predators (WAR-04): deterministic predator world pass — predators move toward the nearest living colony, hunt (remove axolotl ENTITIES, bounded, never to 0) reduced by civ_strength defense, strong civs cull predators, culled predators drop food, predators expire by lifespan; read-phase/write-phase borrow discipline"
  - "the predator pass wired into advance_civ_turn AFTER resolve_combat and BEFORE resolve_environment, so predator casualties land before the population mirror re-syncs"
  - "PREDATOR_SALT 0xBADD_CA75 (distinct from combat/turn-order/env salts) — both predator passes are byte-deterministic for a fixed (seed, turn)"
  - "9 WAR-04 spawn/hunt/defend/cull/food/expire/determinism/no-wipeout unit tests"
affects: [phase-5-genetics, eval-replay, w9-renderer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wild-fauna spawn on disaster fire: a fired environment forecast (predator_incursion) creates net-new civ_id:None entities with a self-contained predator-salt rng + format! ids, keeping the byte-deterministic tick intact and KEEPING the companion morale modifier"
    - "Read-phase/write-phase predator pass: collect per-predator moves/kills/culls/food/expiry into local Vecs+maps (stable id-sorted) FIRST, then apply moves -> bounded kills -> age survivors -> food credits -> one retain for culled+expired, so world.entities is never aliased while iterating (same borrow discipline as plunder)"
    - "civ_strength reused as predator DEFENSE: the single combat seam doubles as the predator-repel term (strong civ takes less damage + culls more) — Phase 5's genetic strength term still plugs into civ_strength only"
    - "Predator casualties remove axolotl ENTITIES (never a population decrement) and the pass runs before resolve_environment, mirroring the combat-casualty discipline so the population mirror reflects predator losses this same turn"

key-files:
  created:
    - .planning/phases/04-w6-combat-diplomacy/04-03-SUMMARY.md
  modified:
    - tauri-app/src-tauri/src/civilization.rs

key-decisions:
  - "PREDATOR_SALT=0xBADD_CA75 (distinct from combat 0xC0FF_EE01 / civ_turn_order 0x51ED_2701 / env 0xE05A_F107) keeps predator rolls uncorrelated with all other passes"
  - "PREDATOR_LIFESPAN=5 (disaster_duration('predator_incursion')==3 + slack), PREDATOR_RANGE2=36 (~6 tiles), PREDATOR_FOOD_DROP=3, spawn count = 1 + intensity.clamp(0,2) -> 1-3 (Claude's discretion per RESEARCH/CONTEXT)"
  - "Defense model: damage probability = 1 - (strength/20).clamp(0,1) (strong civ -> 0 damage); cull chance = (strength/30).clamp(0,0.9) (strong civ -> more culls). The invariants (bounded, no-wipeout, food-on-cull, determinism) are enforced by tests, not the exact numbers"
  - "Open Q3 resolved = KEEP the quarrel_pressure modifier when predator_incursion fires (predators are the physical threat, morale pressure the ambient dread) — no Phase-3 test regresses"
  - "Atomic commit split of one shared file (mirrors 04-02): a deterministic line-range strip produced a Task-1-only tree (spawn + spawn tests; fmt/test --no-run clean, clippy==16) committed first, then the full Task-2 tree (step_predators + wiring + tests) committed second"

patterns-established:
  - "Pattern: a wild-fauna lifecycle (spawn-on-disaster + a per-turn move/hunt/defend/cull/expire world pass) reusing CivEntity{civ_id:None}, colony_center/dist2, the elder-death retain, civ_strength, and the seed^turn RNG — all deterministic with its own salt"
  - "Pattern: an adversarial world pass that BOTH reads and mutates world.entities is structured read-phase (collect intents) then write-phase (apply mutations) to satisfy the borrow checker without cloning the whole entity vec"

requirements-completed: [WAR-04]

# Metrics
duration: 30 min
completed: 2026-06-07
---

# Phase 4 Plan 03: Wild Predators Summary

**WAR-04 wild predators: a fired predator_incursion now spawns net-new civ_id:None predator entities (deterministic predator-{turn}-{n} ids) near the threatened colony while keeping the quarrel_pressure modifier, and a byte-deterministic step_predators world pass (own salt 0xBADD_CA75) moves them toward the nearest colony, hunts by removing axolotl ENTITIES (bounded, never to 0) reduced by civ_strength defense, lets strong civs cull predators (dropping food), and expires predators by lifespan — wired into advance_civ_turn after resolve_combat and before resolve_environment so casualties land before the population mirror re-syncs.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-06-07
- **Tasks:** 2 (both TDD)
- **Files modified:** 1 (civilization.rs)
- **New tests:** 9 (3 Task 1 spawn + 6 Task 2 step)

## Accomplishments
- `spawn_predators` — net-new wild fauna: pushes `count` predator entities (`kind`/`role` "predator", `civ_id: None`, deterministic `predator-{turn}-{n}` ids, `age: 0`, `..Default::default()`) near the living colony nearest the disaster `epicenter_x`, with placement jitter from the predator-salt rng clamped to world bounds; a no-op when no living civ exists.
- `tick_environment` spawn hook — inside the `predator_incursion` FIRE branch (after `apply_disaster_to_tiles` and the modifier push, before the `forecast` move into `disasters[]`), spawns 1-3 predators (`1 + intensity.clamp(0,2)`) with a self-contained `seed^turn^0xBADD_CA75` rng. The existing `"predator_incursion" => Some("quarrel_pressure")` modifier is KEPT (Open Q3) — predators and morale pressure coexist; no Phase-3 test regresses.
- `step_predators` — the deterministic predator world pass: read phase collects per-predator moves/kills/culls/food/expiry into local Vecs+maps (stable id-sorted); write phase applies moves, then bounded kills (`kill_axolotls`, never below 1 survivor), ages survivors, credits culled-predator food (`+= PREDATOR_FOOD_DROP`, never negative), and removes culled+expired predators in one `retain`. Defense reuses `civ_strength` (strong civ takes less damage + culls more). No `population -=` anywhere.
- Wired the predator pass into `advance_civ_turn` AFTER `resolve_combat` and BEFORE the `resolve_environment` loop — order is decision loop -> `resolve_combat` -> `step_predators` -> `resolve_environment`, so both combat and predator casualties (entity removals) land before `run_life_cycle` re-syncs the population mirror this same turn.
- `PREDATOR_SALT 0xBADD_CA75` keeps spawn + hunt rolls uncorrelated with the combat/turn-order/env passes; ids are `format!`-derived (no uuid/clock); predators processed in stable id-sorted order — the pass is byte-deterministic for a fixed (seed, turn).
- 9 WAR-04 tests: spawn (kind/civ_id None + deterministic ids + quarrel_pressure-still-fires), spawn determinism, non-predator-disaster-spawns-none, hunt+expire (mirror reflects loss + survivors age + expired removed), strength-defends (strong civ loses fewer / culls more), culled-predator-drops-food (exact credit, never negative), step determinism, no-instant-wipeout, runs-in-advance-turn-window.

## Task Commits

Each task was committed atomically (TDD: implementation + tests authored together; runtime RED/GREEN cannot be observed on Windows — WebView2 blocks `cargo test` execution, CLAUDE.md gotcha #5; tests RUN on Linux/macOS CI):

1. **Task 1: spawn_predators + tick_environment predator_incursion spawn hook (WAR-04)** - `c35c091` (feat)
2. **Task 2: step_predators world pass (hunt + civ_strength defense + cull + food + expire) wired in advance_civ_turn (WAR-04)** - `64c1ad0` (feat)

**Plan metadata:** (this SUMMARY commit)

## Files Created/Modified
- `tauri-app/src-tauri/src/civilization.rs` — new "Predator engine" block after `resolve_combat`: constants (`PREDATOR_SALT`/`PREDATOR_LIFESPAN`/`PREDATOR_RANGE2`/`PREDATOR_FOOD_DROP`), `spawn_predators`, `PredatorOutcome` struct, `step_predators`, `step_toward`; the spawn call in `tick_environment`'s predator_incursion fire branch; the `step_predators(&mut snapshot)` call in `advance_civ_turn` (after `resolve_combat`, before `resolve_environment`); 9 new unit tests + `predator_count`/`give_predators_near` test helpers.

## Decisions Made
- **Tuning (Claude's discretion):** `PREDATOR_SALT=0xBADD_CA75`, `PREDATOR_LIFESPAN=5` (disaster duration 3 + slack), `PREDATOR_RANGE2=36` (~6 tiles), `PREDATOR_FOOD_DROP=3`, spawn count `1 + intensity.clamp(0,2)` (1-3). Defense: `damage_prob = 1 - (strength/20).clamp(0,1)`, `cull_chance = (strength/30).clamp(0,0.9)`. The invariants are test-enforced, not the exact numbers.
- **Open Q3 = keep the modifier:** a fired `predator_incursion` spawns predators AND still pushes the `quarrel_pressure` morale modifier — least disruptive, no Phase-3 regression.
- **civ_strength as the predator-defense term:** the 04-02 combat seam is reused directly for repel/cull, so Phase 5's genetic strength term still has exactly one insertion point.
- **Borrow discipline:** `step_predators` reads `world.entities` (collect intents) before mutating it (apply moves/kills/age/food/retain) — no aliasing while iterating; `cargo test --no-run` confirms no E0502/E0499.

## Deviations from Plan

None - plan executed exactly as written.

**Total deviations:** 0.
**Impact on plan:** All behaviour matches the plan's helper specs, invariants, salt convention, and placement. No scope creep — only `civilization.rs` was touched; no bindings/renderer/STATE/config change (none required for WAR-04).

## Issues Encountered
- **Atomic per-task commits from one shared file** (same situation as 04-02): Task 1 (`spawn_predators` + hook) and Task 2 (`step_predators` + wiring) both live in `civilization.rs`, and the Task-2 tests reference `step_predators`. To keep the two commits atomic and the FINAL tree clean, a deterministic line-range strip produced a Task-1-only tree (the Task-2 constants relocated next to `step_predators` so they strip cleanly; the spawn `predator_count` helper retained for the spawn tests), committed first (fmt + `cargo test --no-run` clean, clippy==16), then the full Task-2 tree was restored and committed second (fmt + test --no-run clean, **clippy back at the 16 baseline**). The transient Task-1-only state exists only between the two commits, by design (TDD implement-then-integrate). Resolved.

## Known Stubs
None. `spawn_predators` is called from the `tick_environment` fire branch; `step_predators` is called from `advance_civ_turn` between `resolve_combat` and `resolve_environment`. No placeholder/empty-data paths. Renderer funnels `civ_id:None` predators through `createAxo` (untinted) by design — RESEARCH Pitfall 5, an intentional cosmetic deferral to W9, not a stub.

## Verification Results
- `cargo fmt --all -- --check` -> exit 0
- `cargo test --no-run` -> exit 0 (all predator test executables compiled, incl. the borrow-sensitive `step_predators` read-then-write path — no aliasing error)
- `cargo clippy --all-features -- -D warnings` -> **16 errors (baseline, ZERO new)**. The 16 are the pre-existing src-tauri baseline (e.g. the `list_civ_sessions` `sort_by` at civilization.rs:718, `permission_prompter.rs`, `skills_mcp.rs`); none fall on predator code.
- Invariant spot-checks on committed HEAD: predators are `kind == "predator"` / `civ_id: None` (3 creation sites); `step_predators` runs AFTER `resolve_combat` (line 910) and BEFORE the `resolve_environment` loop (line 920) in `advance_civ_turn`; casualties use `kill_axolotls`/`retain` — **NO `population -=` anywhere** (count 0); the `quarrel_pressure` modifier is STILL pushed (Open Q3); food credit uses `.entry("food")` (never negative); predator code uses only `next_rng`/`rand_f`/`rand_range` seeded with `0xBADD_CA75` + `format!` ids — no uuid/SystemTime/rand.
- No bindings change this plan (no `CivDecisionAction`/type change) — `bindings.ts` NOT regenerated, NOT touched. `STATE.md` / `config.json` NOT touched.
- Backend tests RUN on Linux/macOS CI (cannot run on Windows — WebView2 loader, gotcha #5); CI should confirm the 9 WAR-04 tests green on merge.

## Next Phase Readiness
- WAR-04 complete — Phase 4 (Waves 1-3) is finished: territory/diplomacy/trade (04-01), deterministic combat (04-02), and wild predators (04-03) all land before the population mirror re-syncs and are replay-stable.
- `civ_strength` is now the single seam for combat attack, combat defense, AND predator defense — Phase 5's genetic `strength` term plugs into one place.
- The wild-fauna lifecycle pattern (spawn-on-disaster + a deterministic move/hunt/defend/cull/expire world pass with its own salt) is reusable for any future neutral fauna.
- Renderer/bindings unchanged; predators ride the existing `createAxo` funnel (W9 may add a distinct sprite — out of scope here).

---
*Phase: 04-w6-combat-diplomacy*
*Completed: 2026-06-07*

## Self-Check: PASSED
- FOUND: tauri-app/src-tauri/src/civilization.rs (contains `fn spawn_predators`, `fn step_predators`, `const PREDATOR_SALT`)
- FOUND commit: c35c091 (Task 1 — feat 04-03 spawn_predators + tick_environment hook)
- FOUND commit: 64c1ad0 (Task 2 — feat 04-03 step_predators world pass + advance_civ_turn wiring)
- Gates re-run on final HEAD: fmt exit 0, test --no-run exit 0, clippy == 16 (baseline, ZERO new)
- Invariants verified: predators kind=="predator"/civ_id None; step_predators after resolve_combat (910) before resolve_environment (920); casualties via kill_axolotls/retain; NO `population -=`; quarrel_pressure modifier kept; food credit via `.entry("food")`; predator salt 0xBADD_CA75; no uuid/SystemTime/rand in predator code
- Only civilization.rs changed across both commits (bindings.ts / STATE.md / config.json untouched)
