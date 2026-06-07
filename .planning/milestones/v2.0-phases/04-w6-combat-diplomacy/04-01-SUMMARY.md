---
phase: 04-w6-combat-diplomacy
plan: 01
subsystem: api
tags: [rust, tauri-specta, bindings, civilization-engine, war, diplomacy, serde]

# Dependency graph
requires:
  - phase: 01-w9-lite-multi-model-world-creation-leaderboard
    provides: "multi-civ data model (CivCivilization.diplomacy, CivRegion.owner, CivEntity.civ_id), build_observation/build_decision_prompt, validate_action/apply_model_decision dispatch, headless export_bindings binary"
provides:
  - "5 new optional CivDecisionAction fields (target/stance/receive/amount/receive_amount), all #[serde(default)] Option<...> for back-compat"
  - "claim_region helper (WAR-01): adjacency-gated region.owner mutation"
  - "set_stance helper (WAR-03): writes civs[ci].diplomacy[target]"
  - "apply_trade helper (WAR-03): bounded, conserved, hostile-blocked two-civ resource swap"
  - "validate_action arms for claim/attack|raid/diplomacy|set_stance/trade"
  - "apply_model_decision dispatch for claim/diplomacy/trade (attack deliberately deferred to 04-02)"
  - "region.id in build_observation; claim/attack/diplomacy/trade in the decision prompt menu"
  - "regenerated bindings.ts CivDecisionAction TS type with the 5 new fields"
affects: [04-02-combat, 04-03-predators, phase-5-genetics]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optional #[serde(default)] field add + headless bindings regen as the IPC-surface change unit"
    - "Read-both-holdings-then-mutate-civ-by-civ for two-civ resource swaps (no interleaved &mut borrows)"
    - "civ_index/region-find guards + early Err/return so a malformed model target is a logged no-op, never a panic"

key-files:
  created:
    - .planning/phases/04-w6-combat-diplomacy/04-01-SUMMARY.md
  modified:
    - tauri-app/src-tauri/src/civilization.rs
    - tauri-app/src/bindings.ts

key-decisions:
  - "Adjacency rule for claim_region: a region is adjacent if its [x,x+width) interval borders/overlaps any owned region's interval OR contains the civ's spawn_x (regions tile contiguously, so neighbours share a boundary)"
  - "Omitted claim target auto-expands to the deterministically-lowest-id adjacent unclaimed region (replay-stable, no RNG)"
  - "apply_trade caps each give at the giver's current holdings and credits the receiver the SAME capped amount -> conserved + never negative"
  - "Trade blocked when EITHER side's stance toward the other is hostile (mutually defensive)"
  - "Used i32::try_from(u32).unwrap_or(i32::MAX) instead of the plan's `as i32` to avoid clippy pedantic cast_possible_truncation/cast_possible_wrap under -D warnings"
  - "attack/raid is VALIDATED here (Wave 1) but NOT dispatched in apply_model_decision; resolution (queue + combat pass) is deferred to 04-02 per the plan"

patterns-established:
  - "Pattern: new model-action surface = optional #[serde(default)] fields + validate_action arm + apply_model_decision arm + observation/prompt exposure + headless bindings regen, all in one plan"
  - "Pattern: two-civ resource swap reads both holdings into copied scalars first, then mutates one civ's map fully, then the other's"

requirements-completed: [WAR-01, WAR-03]

# Metrics
duration: 18 min
completed: 2026-06-07
---

# Phase 4 Plan 01: Combat & Diplomacy Foundation Summary

**5 optional CivDecisionAction fields + claim_region/set_stance/apply_trade engine helpers wired into validate_action and apply_model_decision, with the model observation exposing region ids and a clean headless bindings.ts regen (WAR-01, WAR-03).**

## Performance

- **Duration:** ~18 min
- **Completed:** 2026-06-07
- **Tasks:** 3 (all TDD)
- **Files modified:** 2 (civilization.rs, bindings.ts)

## Accomplishments
- Added 5 new `#[serde(default)] Option<...>` fields to `CivDecisionAction` (`target`, `stance`, `receive`, `amount`, `receive_amount`) so old saves/decisions still deserialize, plus validate_action arms for claim/attack|raid/diplomacy|set_stance/trade (the unknown-type catch-all is intact, so existing actions are unaffected — ARENA-02).
- Implemented `claim_region` (WAR-01): claims an unclaimed region adjacent to a civ's owned territory (or its spawn column); rejects already-owned and non-adjacent regions; omitting the target auto-expands to the lowest-id adjacent unclaimed region.
- Implemented `set_stance` (WAR-03): writes the diplomacy map; ignores self-targeting and unknown targets.
- Implemented `apply_trade` (WAR-03): bounded two-civ swap via `consume` + capped gives, conserved totals, never negative, blocked when either side is hostile, and self-trade rejected — with borrow-safe civ-by-civ mutation.
- Wired claim/diplomacy/trade dispatch arms (with `push_log`) into `apply_model_decision`; NO attack arm (queued + resolved in 04-02).
- Exposed `region.id` in `build_observation` and listed claim/attack/diplomacy/trade in `build_decision_prompt` so models can target other civs/regions.
- Regenerated `bindings.ts` headlessly — clean, additive, scoped to `CivDecisionAction`; `npx tsc --noEmit` exits 0.

## Task Commits

Each task was committed atomically:

1. **Task 1: CivDecisionAction fields + validate_action arms + observation id + prompt menu** - `aa77369` (feat)
2. **Task 2: claim_region + set_stance + apply_trade helpers + dispatch** - `7013c16` (feat)
3. **Task 3: headless bindings.ts regen + tsc gate** - `b95a397` (feat)

_Note: TDD RED/GREEN could not be observed as a runtime test failure on Windows (WebView2 loader blocks `cargo test` execution — CLAUDE.md gotcha #5). Each task's tests + implementation were authored together and verified via `cargo test --no-run` (compile gate); the WAR-01/WAR-03 tests RUN on Linux/macOS CI._

## Files Created/Modified
- `tauri-app/src-tauri/src/civilization.rs` - 5 new CivDecisionAction fields; claim_region/set_stance/apply_trade helpers; 4 validate_action arms; claim/diplomacy/trade dispatch in apply_model_decision; region.id in build_observation; extended prompt menu; 13 new WAR-01/WAR-03 unit tests.
- `tauri-app/src/bindings.ts` - Regenerated CivDecisionAction TS type with target?/stance?/receive? (string|null) and amount?/receive_amount? (number|null).

## Bindings: full-regen vs hand-add

**Full headless regen** (`cargo run --bin export_bindings`) was used — the MEMORY "bindings.ts drift trap" did NOT trigger this session. The diff was minimal and clean: **+10 lines, scoped entirely to `CivDecisionAction`** (the 5 new fields plus their doc comments). No unrelated eval/types changed, and `npx tsc --noEmit` exited 0. The documented hand-add fallback was therefore not needed.

## Verification Results

- `cargo fmt --all -- --check` → exit 0
- `cargo test --no-run` → exit 0 (all test executables compiled; `apply_trade` compiles, confirming no interleaved-&mut borrow error)
- `cargo clippy --all-features -- -D warnings` → **16 errors (baseline, ZERO new)**. The single civilization.rs error is the pre-existing `sort_by`→`sort_by_key` baseline in `list_civ_sessions` (line shifted ~703→718 by the struct additions); the other 15 are the baseline commands.rs/skills_mcp.rs/permission_prompter.rs warnings. None fall on lines added by this plan.
- `cargo run --bin export_bindings` → exit 0; `npx tsc --noEmit` → exit 0; diff scoped to `CivDecisionAction`.

## Decisions Made
- **Adjacency rule:** a region is adjacent if its `[x, x+width)` interval borders/overlaps any region the civ already owns, OR it contains the civ's `spawn_x`. Regions tile contiguously, so the home region's neighbour is the natural first claim.
- **Auto-expand:** when `claim` has no target, the deterministically-lowest-id adjacent unclaimed region is claimed (replay-stable; no RNG, no clock).
- **Trade bounds:** each give is capped at the giver's current holdings and the receiver is credited the same capped amount (conserved + never negative); blocked when either side declared the other hostile.
- **Cast safety:** used `i32::try_from(u32).unwrap_or(i32::MAX)` for trade amounts instead of the plan's `as i32` cast, to keep clippy at the 16-error baseline under `-D warnings`.
- **attack/raid validation only:** validated here so 04-02 only adds the queue + combat resolution; no dispatch arm was added in `apply_model_decision`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug avoidance] Used `i32::try_from(...).unwrap_or(i32::MAX)` instead of `as i32` for trade amounts**
- **Found during:** Task 2 (apply_model_decision trade dispatch)
- **Issue:** The plan's example used `action.amount.unwrap_or(0) as i32`. A `u32 as i32` cast trips clippy pedantic `cast_possible_truncation`/`cast_possible_wrap`, which would add new errors under the workspace `-D warnings` gate (the plan's own constraint: ZERO new clippy beyond the 16 baseline).
- **Fix:** Converted via `i32::try_from(action.amount.unwrap_or(0)).unwrap_or(i32::MAX)`. Semantically equivalent for realistic amounts; `apply_trade` re-clamps to holdings anyway, so an oversized value is harmless.
- **Files modified:** tauri-app/src-tauri/src/civilization.rs
- **Verification:** `cargo clippy --all-features -- -D warnings` stays at 16.
- **Committed in:** `7013c16` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 clippy-baseline-preservation / bug avoidance).
**Impact on plan:** Minor, necessary to satisfy the plan's own clippy-baseline gate. No scope creep — all behaviour matches the plan's helper specs and tests.

## Issues Encountered
None. All anchors matched the plan's `<interfaces>` line ranges (after accounting for line shifts from the struct additions). The `gather_action` test fixture (which lists all CivDecisionAction fields explicitly) was updated with the 5 new `None` fields so it kept compiling — expected, not a deviation.

## Known Stubs
None. `attack`/`raid` is intentionally validation-only in this plan (resolution lands in 04-02 per the plan's explicit deferral); this is documented in the plan, not a stub blocking WAR-01/WAR-03.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The IPC surface (`CivDecisionAction` fields + regenerated bindings) is locked, so 04-02 (combat) and 04-03 (predators) compile against it without re-touching bindings.
- `set_stance` is available for 04-02's ally no-fight gate; `region.owner` mutation pattern is established for raid territory transfer.
- `attack`/`raid` is already validated; 04-02 only needs to add the attack queue in `advance_civ_turn` + the combat resolution pass.
- Backend tests RUN on Linux/macOS CI (cannot run on Windows — WebView2 loader); CI should confirm the WAR-01/WAR-03 unit tests green on merge.

---
*Phase: 04-w6-combat-diplomacy*
*Completed: 2026-06-07*

## Self-Check: PASSED
- FOUND: tauri-app/src-tauri/src/civilization.rs (contains `fn claim_region`)
- FOUND: tauri-app/src/bindings.ts (contains the 5 new CivDecisionAction fields)
- FOUND commit: aa77369 (Task 1)
- FOUND commit: 7013c16 (Task 2)
- FOUND commit: b95a397 (Task 3)
- Gates re-run: fmt exit 0, test --no-run exit 0, clippy == 16 (baseline), tsc exit 0
