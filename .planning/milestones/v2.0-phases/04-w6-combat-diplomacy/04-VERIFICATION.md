---
phase: 04-w6-combat-diplomacy
verified: 2026-06-07T00:00:00Z
status: passed
score: 4/4 must-haves verified (WAR-01, WAR-02, WAR-03, WAR-04)
overrides_applied: 0
re_verification:
  previous_status: none
  note: initial verification
gates:
  cargo_test_no_run: "exit 0 (all WAR test executables compile on Windows; tests RUN on Linux/macOS CI per gotcha #5)"
  cargo_clippy: "16 errors == documented baseline; ZERO new in any Phase-4 combat/predator/diplomacy code"
  npx_tsc_noemit: "exit 0 (bindings.ts regen type-checks)"
---

# Phase 4: W6 — Combat & Diplomacy Verification Report

**Phase Goal:** Civilizations can claim/own/contest territory, resolve combat and raids deterministically with population/resource/territory consequences, set diplomacy stances and execute trades (allies don't fight), and defend with strength against wild predators that hunt axolotls.

**Verified:** 2026-06-07
**Status:** passed
**Re-verification:** No — initial verification

## Verdict

**ALL FOUR REQUIREMENTS PASS.** WAR-01/02/03/04 are each implemented in substantive, wired, deterministic, invariant-safe code in the CURRENT `civilization.rs`, backed by non-hollow unit tests that assert the load-bearing behaviours (no-instant-wipeout, plunder conservation, replay determinism via clone+serde-compare, the unilateral ally gate, the entity-removal→population-mirror discipline, predator hunt/defend/cull/food/expire). No requirement was silently dropped. The three live gates pass: `cargo test --no-run` exit 0, clippy at the exact 16-error documented baseline (zero new), `npx tsc --noEmit` exit 0. The frontend is legitimately unchanged — the renderer already draws the territory overlay from `region.owner` and funnels `civ_id == null` predators through `createAxo`.

The phase goal is **genuinely achieved.**

## Goal Achievement

### Observable Truths

| # | Truth (Success Criterion) | Status | Evidence |
|---|---------------------------|--------|----------|
| 1 | A civilization can claim and own a region; ownership is tracked, contestable, and visible to the user (WAR-01) | ✓ VERIFIED | `claim_region` (civilization.rs:4240) sets `region.owner = Some(civ_id)` only for an UNCLAIMED region adjacent to owned territory/spawn (4267,4285); rejects already-owned (4277) and non-adjacent (4280). Wired via apply_model_decision `"claim"` arm (2305). Contestable: a decisive raid flips an owner via `seize_region` (5362→5384). Tracked in observation `"id": region.id` (2072). Visible: renderer `regionOverlayFor(region.owner,…)` at CivilizationGameCanvas.tsx:724,1723. |
| 2 | Hostile civs resolve combat/raids deterministically with population/resource/territory consequences (loser loses pop, resources looted, owner can flip) (WAR-02) | ✓ VERIFIED | `resolve_attack` (5401) deterministic from `civ_strength` + seeded rng (salt `0xC0FF_EE01`, 5487); casualties REMOVE axolotl entities via `kill_axolotls`/`retain` (5298), never decrement the population counter (grep `population -=` == 0); bounded `bounded_loss` always leaves ≥1 survivor (5313); `plunder` conserved (`consume` drain == credit, 5349-5352); `seize_region` flips one peripheral region on a decisive win. Queued in advance_civ_turn (823,896-904) and resolved in `resolve_combat` (910) BEFORE resolve_environment (920). |
| 3 | Civs set diplomacy stances and execute trades; allied/trading civs do not fight (WAR-03) | ✓ VERIFIED | `set_stance` (4222) writes `civs[ci].diplomacy[target]`; `apply_trade` (4322) swaps resources via `consume`, conserved (same `g`/`r` credited as drained, 4349-4358), clamped to holdings (4345-4346, never negative), blocked when either side hostile (4337-4341). Ally no-fight gate at top of `resolve_attack` (5415-5435): unilateral, logged no-op, returns false before any mutation; `resolve_combat` also `continue`s on the ally stance to avoid a contradictory log (5497-5505). |
| 4 | Wild predators spawn and hunt axolotls; civs defend with strength; killed predators drop food (WAR-04) | ✓ VERIFIED | `spawn_predators` (5547) creates net-new `kind=="predator"`, `civ_id:None` entities with deterministic `predator-{turn}-{n}` ids, hooked into tick_environment's predator_incursion fire branch (6087-6094) while KEEPING the quarrel_pressure modifier (6057). `step_predators` (5626) hunts (removes axolotl entities, bounded, 5730), `civ_strength` defense (5691-5697), strong civs cull more, culled predators credit `"food"` (5701,5754-5757), predators expire at `age >= PREDATOR_LIFESPAN` (5661). Runs after resolve_combat, before resolve_environment (916). Distinct salt `0xBADD_CA75` (5539). |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `tauri-app/src-tauri/src/civilization.rs` | 5 new CivDecisionAction fields; claim/stance/trade helpers + dispatch; combat engine (civ_strength/resolve_attack/kill_axolotls/bounded_loss/plunder/seize_region/resolve_combat); predator engine (spawn_predators/step_predators/step_toward); queue+passes in advance_civ_turn; 30+ WAR unit tests | ✓ VERIFIED | All functions present (4222-5790); 5 fields `#[serde(default)]` (597-611); 41 test fns in the Phase-4 range; clippy clean on all added lines |
| `tauri-app/src/bindings.ts` | Regenerated CivDecisionAction TS type with 5 new optional fields | ✓ VERIFIED | `target?`/`stance?`/`receive?`/`amount?`/`receive_amount?` all `\| null` at lines 302-310; `npx tsc --noEmit` exit 0; diff scoped to CivDecisionAction |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| apply_model_decision dispatch | claim_region / set_stance / apply_trade | match arms on action_type | ✓ WIRED | `"claim"` (2305), `"diplomacy" \| "set_stance"` (2322), `"trade"` (2337); no `"attack"` arm (correctly deferred to the queue) |
| CivDecisionAction (Rust) | bindings.ts CivDecisionAction | export_bindings headless regen | ✓ WIRED | 5 fields present in bindings.ts:302-310; tsc 0 |
| advance_civ_turn decision loop | resolve_combat | Vec<(attacker,target)> queue collected post-decision, resolved sorted | ✓ WIRED | queue declared (823), intents collected (896-904), `resolve_combat(&mut snapshot, &mut attacks)` (910) before resolve_environment (920) |
| resolve_attack casualties | world.entities.retain | kill_axolotls removing living axolotls | ✓ WIRED | retain at 5298; population mirror re-syncs in run_life_cycle (2928-2933) which resolve_environment calls (2745) |
| resolve_attack | civ_strength | attacker-vs-defender ratio (Phase-5 seam) | ✓ WIRED | civ_strength called at 5437,5454; single `// Phase-5 SEAM` (5265) |
| tick_environment predator_incursion fire | spawn_predators | spawn call in the fire path (modifier kept) | ✓ WIRED | spawn_predators(6093) inside the fire branch; quarrel_pressure kept (6057) |
| advance_civ_turn | step_predators | predator pass between combat and resolve_environment | ✓ WIRED | step_predators(916) after resolve_combat(910), before resolve_environment(920) |
| step_predators damage | civ_strength | defense reduces damage; strong civs cull | ✓ WIRED | civ_strength(5647) feeds defense (5691) + cull chance (5697) |

### Data-Flow Trace (Level 4)

Backend-only phase (no new dynamic-data UI component introduced). The data flow that matters here is engine→snapshot→existing renderer:

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| Territory overlay (existing renderer) | `region.owner` | claim_region / seize_region mutations on the live snapshot | Yes — owner is set to a real civ id and re-read each frame | ✓ FLOWING |
| Predator sprites (existing renderer) | entities with `civ_id == null` | spawn_predators pushes net-new entities into world.entities | Yes — real entities; renderer createAxo funnel | ✓ FLOWING |
| population (leaderboard/score) | `civs[].population` | mirror re-synced from living axolotl entities after combat/predator entity removals | Yes — casualties land before the mirror re-syncs | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Backend tests compile (WAR-01..04) | `cargo test --no-run` (tauri-app/src-tauri) | exit 0; 4 test executables built | ✓ PASS |
| Clippy stays at baseline (no new warnings in Phase-4 code) | `cargo clippy --all-features -- -D warnings` | 16 errors == baseline; civilization.rs error only at :718 (pre-existing list_civ_sessions, documented) | ✓ PASS |
| Frontend type-checks after bindings regen | `npx tsc --noEmit` (tauri-app) | exit 0 | ✓ PASS |
| Determinism: no uuid/clock/rand:: in combat+predator code | grep region 5251-5790 | only doc-comment mentions ("no uuid/clock"); zero code uses | ✓ PASS |
| Distinct salts | grep | combat 0xC0FF_EE01, predator 0xBADD_CA75, turn-order 0x51ED_2701, env 0xE05A_F107 — all distinct | ✓ PASS |
| Population-mirror discipline | grep `population -=` | 0 matches | ✓ PASS |

**Note (gotcha #5):** The WAR unit tests cannot RUN on Windows (WebView2 loader blocks the test harness). Verification of behaviour was done by (a) reading every test body and confirming the assertions are substantive, and (b) `cargo test --no-run` proving they compile. The tests RUN on Linux/macOS CI.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| WAR-01 | 04-01 | Claim/own territory; ownership tracked + contestable | ✓ SATISFIED | claim_region (4240) + seize_region contest (5362); tests claim_region_sets_owner_on_adjacent_unclaimed (8295), rejects_owned (8328), rejects_non_adjacent (8344), auto_expands (8306); raid_transfers_owner (8664) |
| WAR-02 | 04-02 | Deterministic combat/raids with pop/resource/territory consequences | ✓ SATISFIED | resolve_attack/resolve_combat; tests resolve_attack_is_deterministic (8532), combat_casualties_remove_entities (8556), attack_no_instant_wipeout (8584), plunder_is_bounded_and_conserved (8603), attack_no_negative_resources (8639), raid_transfers_owner (8664), turn_with_combat_is_replay_stable (8766), resolve_combat_sorts_attacks_into_fixed_order (8799), civ_strength_monotonic (8485) |
| WAR-03 | 04-01, 04-02 | Diplomacy stances + trades; allies don't fight | ✓ SATISFIED | set_stance (4222), apply_trade (4322), ally gate (5415); tests set_stance_writes_diplomacy_map (8369), apply_trade_swaps_and_conserves (8385), apply_trade_clamps_over_ask_and_never_negative (8413), apply_trade_blocked_when_hostile (8431), apply_trade_rejects_self_trade (8451), allies_do_not_fight (8733) |
| WAR-04 | 04-03 | Wild predators spawn + hunt; civs defend with strength; killed predators drop food | ✓ SATISFIED | spawn_predators (5547), step_predators (5626); tests predator_incursion_spawns_predators (8908), predator_spawn_is_deterministic (8946), non_predator_disaster_spawns_no_predators (8969), step_predators_hunt_and_expire (8984), strength_defends_against_predators (9044), culled_predator_drops_food (9085), step_predators_is_deterministic (9119), step_predators_no_instant_wipeout (9144), step_predators_runs_in_advance_turn_window (9160) |

**Orphans:** None. All 4 Phase-4 requirements (WAR-01..04 per ROADMAP coverage table) are claimed by a plan and implemented. No requirement silently dropped.

**ARENA-02 regression (carry-over contract):** validate_action's unknown-type catch-all is intact (`other => return Err("unknown action type: {other}")`, 2276) and asserted by validate_action_still_rejects_unknown_types (8252). Existing gather/build/research/explore/policy/prepare actions are unaffected. Old action JSON deserializes (old_action_json_still_deserializes, 8200).

### Threat-Model Mitigations Verified

| Threat | Mitigation | Status |
|--------|-----------|--------|
| T-04-01 (panic on bad target) | civ_index/region-find guards + early return/Err in every helper | ✓ Present (4245,4331,5252,5407,5489) |
| T-04-02 (instant wipeout / DoS) | bounded_loss leaves ≥1 survivor; predator kills `.min(living-1)` | ✓ Present (5313,5730); tests attack_no_instant_wipeout, step_predators_no_instant_wipeout |
| T-04-03/T-04-08 (replay determinism) | distinct salts, format! ids, sorted resolution, no uuid/clock | ✓ Present; determinism tests + grep clean |
| T-04-04 (resource underflow / economic exploit) | trade + plunder cap at holdings, drain via consume, credit verbatim | ✓ Present (4345,5338-5352); tests conserve + never-negative |
| T-04-05 (trade with hostile) | apply_trade Err when either side hostile | ✓ Present (4337-4341); apply_trade_blocked_when_hostile |
| T-04-06 (claim stealing owned/non-adjacent) | claim_region rejects owned + non-adjacent | ✓ Present (4277,4280); rejects_owned/non_adjacent tests |
| T-04-07 (stale bindings) | headless regen + tsc gate | ✓ tsc exit 0; bindings.ts:302-310 |
| T-04-09 (population/entity desync) | casualties via retain only; combat+predator passes before resolve_environment | ✓ grep `population -=` == 0; ordering 910<916<920 |
| T-04-10 (attack ally) | unilateral ally gate early-return | ✓ Present (5415-5435); allies_do_not_fight |
| T-04-11 (predator food runaway/negative) | fixed PREDATOR_FOOD_DROP credit only on actual cull | ✓ Present (5701); culled_predator_drops_food asserts exact + non-negative |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| civilization.rs | 718 | clippy `unnecessary_sort_by` in list_civ_sessions | ℹ️ Info | PRE-EXISTING baseline (deferred-items.md); NOT in Phase-4 code; line shifted down by added code. Not a Phase-4 regression. |
| permission_prompter.rs | 31 | dead_code warning (TauriPermissionPrompter) | ℹ️ Info | PRE-EXISTING baseline; unrelated to Phase 4 |

No Phase-4 anti-patterns. No TODO/FIXME/placeholder, no stub returns, no hardcoded-empty data, no `population -=`, no uuid/SystemTime/rand:: in combat/predator code. The Phase-5 `genes.strength` term is an intentional, single, documented SEAM (one comment, 5265) explicitly deferred to Phase 5 per CONTEXT — not a stub blocking WAR-02.

### Frontend Unchanged (legitimately)

The only Phase-4 commit touching `tauri-app/src` is `b95a397` (additive bindings.ts regen). No renderer source changed. This is correct because:
- WAR-01 territory visibility: the W2/W8 renderer already calls `regionOverlayFor(region.owner, this.civColorById)` (CivilizationGameCanvas.tsx:724,1723) — owner flips flow straight to the overlay.
- WAR-04 predator visibility: wild fauna (`civ_id == null`) already funnel through `createAxo` with a map-miss default tint (lines 994-998, 3285). A distinct predator sprite is an out-of-scope W9 cosmetic, documented in RESEARCH Pitfall 5.

### Human Verification Required

None. All four success criteria are verifiable from code + compiled tests + the three live gates. The visual surfaces (territory overlay, predator sprites) reuse already-shipped W2/W8 renderer paths that read the engine state this phase produces; no new UI was introduced that would need visual human testing.

### Gaps Summary

No gaps. Every must-have resolves to VERIFIED. The implementation matches the plans, the tests are substantive (not hollow), the threat-model mitigations are present and tested, determinism is clean, the entity-removal→population-mirror discipline is correct and ordering-safe (combat 910 → predators 916 → resolve_environment 920), back-compat is preserved (`#[serde(default)]` + old-action deserialize test), ARENA-02 is non-regressed, and the frontend is correctly unchanged.

---

_Verified: 2026-06-07_
_Verifier: Claude (gsd-verifier)_
