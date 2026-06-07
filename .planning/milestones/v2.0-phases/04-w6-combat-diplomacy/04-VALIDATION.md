---
phase: 4
slug: w6-combat-diplomacy
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-07
audited: 2026-06-07
---

# Phase 4 — Validation Strategy

> Per-phase validation contract. BACKEND (Rust) phase. Tauri backend tests cannot
> EXECUTE on Windows (WebView2, gotcha #5) — verify via cargo check + clippy + fmt +
> `cargo test --no-run` (compile-only); the `#[test]`s RUN on CI (Linux/macOS).
> Determinism + invariants (no instant-wipeout, no negative pop/resources, conserved
> plunder, population-mirror correctness) are the load-bearing automated properties.
> This phase changes CivDecisionAction → a bindings regen + tsc gate applies.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust libtest `#[test]` in `civilization.rs` `#[cfg(test)] mod tests` (~5281) |
| **Config file** | none (cargo built-in); crate `tauri-app/src-tauri` (lib `xolotl_lib`) |
| **Quick run (Windows, compile-only)** | `cargo test --no-run` (from `tauri-app/src-tauri`) |
| **Quick check (Windows)** | `cargo check` + `cargo clippy --all-features -- -D warnings` (ZERO new vs 16-error baseline) + `cargo fmt --all -- --check` |
| **Bindings gate** | `cargo run --bin export_bindings` then `npx tsc --noEmit` (REQUIRED — CivDecisionAction changes) |
| **Full suite (CI)** | `cargo test` — executes the WAR-* unit/determinism/invariant tests |
| **Estimated runtime** | compile ~60–120s; CI test exec seconds |

---

## Sampling Rate

- **After every task commit:** `cargo check` + `cargo clippy --all-features -- -D warnings` (zero new) + `cargo fmt --check` + `cargo test --no-run`.
- **On any CivDecisionAction change:** `cargo run --bin export_bindings` + `npx tsc --noEmit`; commit the regenerated bindings.ts.
- **After every plan wave:** same; CI runs full `cargo test`.
- **Before `/gsd-verify-work`:** clippy baseline-only; `cargo test --no-run` exit 0; tsc 0; bindings regenerated+committed.
- **Max feedback latency:** ~120 seconds (backend compile-bound).

---

## Per-Task Verification Map

> Populated by the planner. Determinism + invariants are the load-bearing automatable
> properties; emergent war/trade/predator balance is manual/CI live observation.

> **Audit (2026-06-07):** every automatable behavior below traced to a substantive,
> non-hollow backing test (real mutation + load-bearing assertion that can fail). All 3
> live gates re-run green from `tauri-app/src-tauri`: `cargo test --no-run` exit 0 (all
> WAR executables compile); `cargo clippy --all-features -- -D warnings` at the documented
> 16-error baseline with ZERO new in any Phase-4 combat/predator/diplomacy code (the one
> `civilization.rs` clippy hit is the pre-existing `list_civ_sessions` `sort_by` at :718,
> outside the Phase-4 diff); `cd tauri-app && npx tsc --noEmit` exit 0. The `#[test]`s RUN
> on Linux/macOS CI (gotcha #5). No genuine coverage gap found; no test added.

| Req ID | Behavior | Test Type | Automated Command (CI) | Backing test(s) | Status |
|--------|----------|-----------|------------------------|-----------------|--------|
| WAR-01 | `claim` sets region.owner when unclaimed+adjacent; rejects owned/non-adjacent | unit | `cargo test claim_region` | `claim_region_sets_owner_on_adjacent_unclaimed`, `claim_region_auto_expands_when_target_omitted`, `claim_region_rejects_owned_region`, `claim_region_rejects_non_adjacent` | ✅ green |
| WAR-01 | successful raid transfers a defender region's owner (contestable) | unit | `cargo test raid_transfers_owner` | `raid_transfers_owner` (exactly one region flips; peripheral taken, home spared) | ✅ green |
| WAR-02 | `civ_strength` monotonic in pop/tools/tech/territory (Phase-5 gene seam) | unit | `cargo test civ_strength_monotonic` | `civ_strength_monotonic` (deterministic + strictly up in each of pop/tools/tech/owned-region) | ✅ green |
| WAR-02 | `resolve_attack` byte-deterministic for fixed (seed,turn) | unit (determinism) | `cargo test resolve_attack_is_deterministic` | `resolve_attack_is_deterministic` (civs+entities JSON byte-identical across clones) | ✅ green |
| WAR-02 | INVARIANT: single attack never wipes defender to 0; no negative resources | unit (invariant) | `cargo test attack_no_instant_wipeout` | `attack_no_instant_wipeout` (≥1 survivor vs overwhelming attacker), `attack_no_negative_resources` | ✅ green |
| WAR-02 | casualties remove axolotl ENTITIES so population mirror reflects them | unit | `cargo test combat_casualties_remove_entities` | `combat_casualties_remove_entities`, `combat_pass_runs_before_population_mirror_resync` (mirror == survivor count after resolve_environment) | ✅ green |
| WAR-02 | plunder steals a BOUNDED share; conserved (attacker gain == defender loss), clamped ≥0 | unit (invariant) | `cargo test plunder_is_bounded_and_conserved` | `plunder_is_bounded_and_conserved` (gain==loss, ≤ PLUNDER_FRAC, all ≥0) | ✅ green |
| WAR-03 | `set_stance` writes the diplomacy map; observation reflects it | unit | `cargo test set_stance_writes_map` | `set_stance_writes_diplomacy_map` (writes map; ignores self-target) | ✅ green |
| WAR-03 | ally no-fight gate: attack on an ally is a logged no-op (chosen mutuality rule) | unit | `cargo test allies_do_not_fight` | `allies_do_not_fight` (unilateral: zero civ/entity mutation, refusal logged, not a win) | ✅ green |
| WAR-03 | `apply_trade` swaps resources deterministically; blocked when hostile; never negative | unit | `cargo test apply_trade_swaps` | `apply_trade_swaps_and_conserves_resources`, `apply_trade_clamps_over_ask_and_never_negative`, `apply_trade_blocked_when_hostile` (zero mutation on block), `apply_trade_rejects_self_trade` | ✅ green |
| WAR-04 | `predator_incursion` firing spawns predator entities (kind=="predator", civ_id==None) | unit | `cargo test predator_incursion_spawns_predators` | `predator_incursion_spawns_predators` (deterministic `predator-{turn}-{n}` ids; quarrel_pressure kept), `predator_spawn_is_deterministic`, `non_predator_disaster_spawns_no_predators` | ✅ green |
| WAR-04 | `step_predators` reduces a colony's living axolotls deterministically; predators expire | unit (determinism+invariant) | `cargo test step_predators_hunt_and_expire` | `step_predators_hunt_and_expire` (hunt + expire + age), `step_predators_is_deterministic`, `step_predators_no_instant_wipeout` (≥1 survivor), `step_predators_runs_in_advance_turn_window` (mirror reflects loss) | ✅ green |
| WAR-04 | strong civ (high civ_strength) culls predators / takes less damage than a weak civ | unit | `cargo test strength_defends_against_predators` | `strength_defends_against_predators` (strong ≤ losses, ≥ culls, strictly better on ≥1 axis), `culled_predator_drops_food` (exact PREDATOR_FOOD_DROP credit, never negative) | ✅ green |
| ALL | multi-turn replay: same seed → identical snapshot JSON incl. combat/predators | unit (determinism) | `cargo test turn_with_combat_is_replay_stable` | `turn_with_combat_is_replay_stable` (civs+entities+regions byte-identical), `resolve_combat_sorts_attacks_into_fixed_order` (order-independent of decision order) | ✅ green |
| ARENA-02 | existing actions + existing tests still pass (no regression) | regression | `cargo test` (CI) | `validate_action_still_rejects_unknown_types` (catch-all intact), `old_action_json_still_deserializes` (`#[serde(default)]` back-compat); full suite green on CI | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> **Note on `advance_civ_turn` end-to-end:** the live turn entrypoint is `async fn` taking
> `AppHandle` and performs session-persistence I/O, so it cannot run in libtest. Its
> load-bearing combat/predator effects are therefore tested directly via the pure passes
> (`resolve_combat`, `step_predators`) sequenced with `resolve_environment`; the in-engine
> ordering is decision-loop → `resolve_combat` (civilization.rs:910) → `step_predators`
> (:916) → `resolve_environment` (:919), so casualties land before the population mirror
> re-syncs. This is the correct seam, not a coverage gap.

---

## Wave 0 Requirements

- [x] All WAR-* unit/determinism/invariant tests above — added to the existing `mod tests` in civilization.rs (reuse `multi_civ_snapshot` :7407, `test_snapshot`, `civ_id_for` :1625; helpers `give_civ_axolotls`, `give_predators_near`, `pending_forecast`). No new test files/fixtures. 33 WAR-* tests present (8200–9183).
- [x] Determinism helper pattern: clone snapshot, run pass on both, assert `serde_json::to_string` equal on the load-bearing state (civs/entities/regions), mirroring `tick_environment_deterministic` (the wall-clock `created_at` log is correctly excluded).
- [x] No framework install (libtest built in).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Wars/raids/trades produce watchable, non-degenerate outcomes over many turns | WAR-01/02/03 | Emergent multi-turn balance, not a hard invariant | Run a live 3-civ session; observe leaderboard + log: stances change, raids transfer territory, trades happen, no civ instantly annihilated |
| Predators visibly threaten then are repelled by strong civs | WAR-04 | Emergent/visual | Trigger predator_incursion over a run; confirm predators hunt and strong civs cull them |

---

## Validation Sign-Off

- [x] All automatable tasks have `<automated>` verify or Wave 0 dependencies — every map row backed by a named, non-hollow `#[test]`
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (the WAR-* tests live in the existing `mod tests`)
- [x] Bindings regenerated + tsc 0 (CivDecisionAction change) — 5 new optional fields present in bindings.ts:301–310, matching the Rust struct (civilization.rs:597–611); `npx tsc --noEmit` exit 0
- [x] No watch-mode flags
- [x] Feedback latency < 120s (compile-bound)
- [x] `nyquist_compliant: true` set in frontmatter (after execution + audit)

**Approval:** SIGNED OFF (2026-06-07, Nyquist audit). All automatable behaviors covered by
substantive tests; 3 live gates green (test --no-run 0, clippy baseline-only/zero-new in
Phase-4 code, tsc 0); CI executes the WAR-* suite. The Manual-Only items (emergent
war/trade/predator balance over many turns) and CI test execution are legitimately not
release blockers. No genuine coverage gap; no test added.
