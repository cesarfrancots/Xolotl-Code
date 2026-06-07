---
phase: 04-w6-combat-diplomacy
reviewed: 2026-06-07T07:43:19Z
depth: deep
files_reviewed: 2
files_reviewed_list:
  - tauri-app/src-tauri/src/civilization.rs
  - tauri-app/src/bindings.ts
findings:
  critical: 0
  warning: 0
  info: 5
  total: 5
status: clean
---

# Phase 4: Code Review Report

**Reviewed:** 2026-06-07T07:43:19Z
**Depth:** deep (cross-file + invariant tracing + build/clippy/tsc verification)
**Files Reviewed:** 2
**Status:** clean

## Summary

Phase 4 (W6 Combat & Diplomacy) adds combat (`civ_strength` / `resolve_attack` /
`resolve_combat`), diplomacy (`set_stance` / `apply_trade`), territory (`claim_region`
/ `seize_region` / `plunder`), and a wild-predator engine (`spawn_predators` /
`step_predators`), wired into `advance_civ_turn` and surfaced over IPC via 5 new
optional `CivDecisionAction` fields. I traced every load-bearing invariant the brief
flagged and verified the build.

**This is clean, well-engineered work. No CRITICAL or HIGH findings.** Every invariant
the brief named is genuinely upheld, and the tests genuinely assert the properties (not
hollow). The five INFO items below are minor consistency/realism observations and
cosmetic log nits — none is a correctness, security, or data-loss defect.

Verification performed:
- `cargo test --no-run` — compiles clean (only the pre-existing
  `TauriPermissionPrompter` dead-code warning, unrelated to Phase 4).
- `cargo clippy --lib` — 15 lib warnings, all pre-existing baseline. Exactly ONE
  clippy warning lands in `civilization.rs` (line 718, `sort_by`→`sort_by_key` in
  `list_civ_sessions`), which is OUTSIDE the Phase-4 diff. All three
  "too many arguments" warnings are in `commands.rs`, not the new combat code.
  **Zero new clippy warnings in the added lines.**
- `npx tsc --noEmit` — exit 0.

### Invariants verified (all PASS)

- **Population-mirror invariant.** `grep population -=` / `.population -` returns 0
  matches. Combat (`kill_axolotls`, civilization.rs:5283) and predators
  (`step_predators`, civilization.rs:5588) remove axolotl ENTITIES via `retain`, never
  decrement the counter. `run_life_cycle` re-syncs `population` from living entities
  (civilization.rs:2928-2933). Both passes run in the correct window: `tick_environment`
  → decision loop → `resolve_combat` (810) → `step_predators` (916) →
  `resolve_environment` loop (919). Both passes precede the mirror re-sync. Tests
  `combat_pass_runs_before_population_mirror_resync` and
  `step_predators_runs_in_advance_turn_window` assert exactly this.
- **No instant wipeout.** `bounded_loss` (civilization.rs:5310) uses live
  `living_axolotl_count` and clamps to `living - 1`; returns 0 when `living <= 1`.
  Holds across MULTIPLE attacks in one `resolve_combat` pass (each recomputes live
  count). Tests `attack_no_instant_wipeout` and `step_predators_no_instant_wipeout`
  assert `>= 1` survivor.
- **Plunder/trade conservation, no underflow.** `consume` clamps `>= 0`
  (civilization.rs:4211). `plunder` take = `floor(have * 0.20) <= have`, drained then
  credited verbatim ⇒ attacker gain == defender loss, no shortfall. `apply_trade` caps
  both gives at pre-read holdings (`g`/`r` computed from scalars copied BEFORE any
  mutation), so the same-resource (give==recv) case also conserves. Tests assert
  conservation, bounded-by-cap, and `all(v >= 0)`.
- **Determinism.** Distinct salts per pass (combat `0xC0FF_EE01`, predators
  `0xBADD_CA75`, both `seed^turn`-derived). No `uuid`/`SystemTime`/`rand::` in the
  combat/predator paths (the only `uuid`/`SystemTime` hits are pre-existing
  `create_civ_session` and `unix_timestamp_secs`). HashMap iteration is always
  collect-then-`sort()` before it touches state (`plunder` takes, `step_predators`
  kills/food). Victim/attack/predator selection is stable id-sort. Determinism tests
  genuinely clone + `serde_json::to_string` compare civs/entities/regions (correctly
  excluding the wall-clock `created_at` log — the load-bearing state IS byte-identical).
- **Borrow safety.** `apply_trade` and `plunder` read holdings into copied scalars
  first, then mutate one civ's map fully, then the other — no interleaved
  `&mut civs[fi]`/`&mut civs[ti]`. `step_predators` collects all reads into local
  Vecs/maps, then applies moves/kills/food/retain — no aliasing of `world.entities`
  while iterating. Confirmed by clean `cargo test --no-run`.
- **Ally gate (unilateral, attacker's stance).** `resolve_attack` (civilization.rs:5462
  region) returns a logged no-op when the ATTACKER's own stance toward the defender is
  `ally`; `resolve_combat` re-checks to suppress the generic "raid" line. Cannot be
  bypassed — the gate is the first mutation-bearing branch. `apply_trade` blocks when
  EITHER side flags the other hostile and mutates nothing on the blocked path. Tests
  `allies_do_not_fight` and `apply_trade_blocked_when_hostile` snapshot-compare to prove
  zero mutation.
- **IPC additive.** `bindings.ts` diff is exactly the 5 new optional fields
  (`target/stance/receive/amount/receive_amount`), all `?: ... | null`. The Rust fields
  carry `#[serde(default)]`; `old_action_json_still_deserializes` proves back-compat.
  `tsc` clean.

## Info

### IN-01: `civ_strength` reads the STALE population mirror during a multi-attack combat pass

**File:** `tauri-app/src-tauri/src/civilization.rs:5256`
**Issue:** `civ_strength` derives strength from `c.population` (the mirror), but combat
casualties remove ENTITIES and do not re-sync the mirror until `resolve_environment`
runs after the whole pass. So within one `resolve_combat`, a defender that already lost
entities to an earlier attacker still "looks" full-strength to a later attacker (and to
`step_predators`, which also calls `civ_strength`). This is a realism/consistency
inconsistency, NOT a correctness break: the no-wipeout guarantee uses live
`living_axolotl_count`, casualties/plunder/seize are all bounded and conserved, and the
mirror self-heals at `resolve_environment`. Determinism is unaffected (the mirror is a
deterministic function of prior state).
**Fix (optional, low value):** if intra-pass strength accuracy is wanted, base
`civ_strength`'s population term on `living_axolotl_count(snapshot, civ_id)` instead of
`c.population`. Defer to Phase 5 — note the genetic `strength` seam lands on the same
line, so revisit together. No change required for v1 correctness.

### IN-02: A `trade` with resources but omitted amounts is a logged no-op

**File:** `tauri-app/src-tauri/src/civilization.rs:2334-2336` (dispatch) and
`tauri-app/src-tauri/src/civilization.rs:2245` (`validate_action` trade arm)
**Issue:** `validate_action` requires `resource` + `receive` but NOT `amount` /
`receive_amount`. The dispatch uses `action.amount.unwrap_or(0)` /
`receive_amount.unwrap_or(0)`, so a model that omits both amounts produces a 0-for-0
"trade" that still emits a "X traded with Y / Gave 0 food, received 0 stone" log line.
Harmless (conserved, no mutation) but cosmetically misleading.
**Fix:** in the trade arm of `validate_action`, reject when both
`amount` and `receive_amount` are absent or 0, e.g.
`if action.amount.unwrap_or(0) == 0 && action.receive_amount.unwrap_or(0) == 0 { return Err("trade requires a non-zero amount".into()); }`

### IN-03: `validate_action` allows `trade` with `give == recv` (same resource both ways)

**File:** `tauri-app/src-tauri/src/civilization.rs:2241-2247`
**Issue:** Nothing rejects `resource == receive`. The math is conserved and never goes
negative (verified by tracing `apply_trade` with both scalars pre-read), so it is not a
bug — just a degenerate trade a model could waste an action on.
**Fix (optional):** add `if give == recv { return Err("trade give and receive must differ".into()); }` in the trade arm. Low priority.

### IN-04: A collapsed (alive == false) civ can still be raided/plundered/seized across turns

**File:** `tauri-app/src-tauri/src/civilization.rs` `resolve_attack` (guard at the
function head) and `resolve_combat` (skip guard)
**Issue:** Both passes guard on `civ_index(...).is_some()` but not on `alive`. A civ
that collapsed on a PRIOR turn remains in `snapshot.civs` (`alive == false`) and can be
targeted next turn: `bounded_loss` yields 0 casualties (0 living), but `plunder` could
still drain its leftover resources and `seize_region` could flip its lingering regions.
Whether "raiding the ruins" is intended is a design question, not a defect — every
invariant still holds and it is deterministic.
**Fix (if not intended):** add `&& snapshot.civs[di].alive` to the defender guards in
`resolve_attack`/`resolve_combat`, or filter dead civs out of the attack target set.
Confirm against the W6 design intent first.

### IN-05: `multi_civ_snapshot` clones share `home_region` / `spawn_x` across civs (test confound)

**File:** `tauri-app/src-tauri/src/civilization.rs:7407-7417`
**Issue:** The test helper clones civ-1's whole struct for civ-2/civ-3, changing only
`id` and `name`. The cloned civs therefore share civ-1's `home_region` and `spawn_x`.
The combat/seize tests work because they explicitly set region owners, but the shared
`home_region` is a latent confound that could mask a real home-region bug in a future
test (e.g. `seize_region`'s home-sparing keyed off a `home_region` that is not actually
the cloned civ's spawn). Not a current defect — the existing tests assert the right
properties.
**Fix:** give each cloned civ a distinct `home_region`/`spawn_x` in `multi_civ_snapshot`
(or seed real per-civ colonies) so home-region semantics are exercised honestly.

---

_Reviewed: 2026-06-07T07:43:19Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
