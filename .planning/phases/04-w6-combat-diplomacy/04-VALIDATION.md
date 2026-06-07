---
phase: 4
slug: w6-combat-diplomacy
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-07
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

| Req ID | Behavior | Test Type | Automated Command (CI) | Status |
|--------|----------|-----------|------------------------|--------|
| WAR-01 | `claim` sets region.owner when unclaimed+adjacent; rejects owned/non-adjacent | unit | `cargo test claim_region` | ⬜ pending |
| WAR-01 | successful raid transfers a defender region's owner (contestable) | unit | `cargo test raid_transfers_owner` | ⬜ pending |
| WAR-02 | `civ_strength` monotonic in pop/tools/tech/territory (Phase-5 gene seam) | unit | `cargo test civ_strength_monotonic` | ⬜ pending |
| WAR-02 | `resolve_attack` byte-deterministic for fixed (seed,turn) | unit (determinism) | `cargo test resolve_attack_is_deterministic` | ⬜ pending |
| WAR-02 | INVARIANT: single attack never wipes defender to 0; no negative resources | unit (invariant) | `cargo test attack_no_instant_wipeout` | ⬜ pending |
| WAR-02 | casualties remove axolotl ENTITIES so population mirror reflects them | unit | `cargo test combat_casualties_remove_entities` | ⬜ pending |
| WAR-02 | plunder steals a BOUNDED share; conserved (attacker gain == defender loss), clamped ≥0 | unit (invariant) | `cargo test plunder_is_bounded_and_conserved` | ⬜ pending |
| WAR-03 | `set_stance` writes the diplomacy map; observation reflects it | unit | `cargo test set_stance_writes_map` | ⬜ pending |
| WAR-03 | ally no-fight gate: attack on an ally is a logged no-op (chosen mutuality rule) | unit | `cargo test allies_do_not_fight` | ⬜ pending |
| WAR-03 | `apply_trade` swaps resources deterministically; blocked when hostile; never negative | unit | `cargo test apply_trade_swaps` | ⬜ pending |
| WAR-04 | `predator_incursion` firing spawns predator entities (kind=="predator", civ_id==None) | unit | `cargo test predator_incursion_spawns_predators` | ⬜ pending |
| WAR-04 | `step_predators` reduces a colony's living axolotls deterministically; predators expire | unit (determinism+invariant) | `cargo test step_predators_hunt_and_expire` | ⬜ pending |
| WAR-04 | strong civ (high civ_strength) culls predators / takes less damage than a weak civ | unit | `cargo test strength_defends_against_predators` | ⬜ pending |
| ALL | multi-turn replay: same seed → identical snapshot JSON incl. combat/predators | unit (determinism) | `cargo test turn_with_combat_is_replay_stable` | ⬜ pending |
| ARENA-02 | existing actions + existing tests still pass (no regression) | regression | `cargo test` (CI) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] All WAR-* unit/determinism/invariant tests above — add to the existing `mod tests` in civilization.rs (reuse `multi_civ_snapshot` ~6485, `test_snapshot` ~5291, `civ_id_for` ~1580). No new test files/fixtures.
- [ ] Determinism helper pattern: clone snapshot, run pass on both, assert `serde_json::to_string` equal (mirror `tick_environment_deterministic` ~7101).
- [ ] No framework install (libtest built in).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Wars/raids/trades produce watchable, non-degenerate outcomes over many turns | WAR-01/02/03 | Emergent multi-turn balance, not a hard invariant | Run a live 3-civ session; observe leaderboard + log: stances change, raids transfer territory, trades happen, no civ instantly annihilated |
| Predators visibly threaten then are repelled by strong civs | WAR-04 | Emergent/visual | Trigger predator_incursion over a run; confirm predators hunt and strong civs cull them |

---

## Validation Sign-Off

- [ ] All automatable tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (the new WAR-* tests in the existing module)
- [ ] Bindings regenerated + tsc 0 (CivDecisionAction change)
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter (after execution + audit)

**Approval:** pending
