---
phase: 05-w5-genetics-depth-selection
reviewed: 2026-06-07T00:00:00Z
depth: deep
diff_base: 9261009
files_reviewed: 3
files_reviewed_list:
  - tauri-app/src-tauri/src/civilization.rs
  - tauri-app/src/components/civilization/CivilizationGameCanvas.tsx
  - tauri-app/src/bindings.ts
findings:
  critical: 0
  high: 0
  medium: 0
  low: 2
  total: 2
status: clean
---

# Phase 05: Code Review Report — W5 Genetics Depth & Selection

**Reviewed:** 2026-06-07
**Depth:** deep (cross-file: turn pipeline order, struct/binding consistency, call-chain trace)
**Files Reviewed:** 3
**Diff base:** `9261009..HEAD`
**Status:** clean (no CRITICAL/HIGH/MEDIUM findings)

## Summary

Phase 5 adds a second Mendelian trait (coat pattern), three quantitative resistance/strength
genes, an environment-vs-genes selection death roll, and a first-class `plague` disaster. The
implementation is well-engineered and the test suite is substantive, not hollow. Every targeted
review concern was traced to ground and verified correct:

**Verified correct (the hard parts):**

- **GEN-02 selection removes entities, never decrements a counter.** The roll pushes ids into
  `selection_deaths`, merges into `deaths`, and `retain`s them out (civilization.rs:2903-2906);
  `population` is then recomputed by counting living entities (3026-3030). There is no
  `population -=` anywhere in the file (grep returned zero decrement sites). Mirror consistency is
  asserted by `selection_keeps_population_mirror_consistent`.
- **>=1-survivor floor counts SELECTION deaths only.** `living_now` (pre-removal count) minus
  `elder_doomed` (=`deaths.len()`) gives `after_elders`; `allowed_selection = after_elders - 1`
  (saturating) caps how many selection deaths may stand, and only `selection_deaths` is truncated
  (2873-2886). Elder deaths are never trimmed, and the elder roll `continue`s so an elder can't also
  be a selection death (no double-count). It can neither over-trim (floor protects 1) nor
  under-protect (elders subtracted first). Proven by `selection_leaves_survivors` (50 turns,
  harshest env, n=5 at 0.0 resistance, asserts `>=1` every turn).
- **Borrow safety.** `env` is cloned (2822) BEFORE the `&mut entities` iteration (2830), mirroring
  the existing `health`/`morale` locals; the roll reads the clone, not `snapshot.environment`.
  `cargo clippy`/`cargo test --no-run` both compile clean, confirming no borrow conflict.
- **Deterministic rng reuse.** The roll reuses the same `seed ^ turn`-derived `rng`, no reseed, no
  `rand`/`uuid`/wall-clock. Truncation is from the vec end (no rng). Determinism asserted by
  `cross_genes_deterministic` (serde byte-compare + rng-advance equality),
  `life_cycle_mortality_deterministic` (clone + 12-turn serde compare), and the evolution test's
  second identical run.
- **`gene_mortality_modifier` is pure, bounded, monotonic.** No mutation/rng; clamped to
  `[0.0, MORTALITY_CAP]`; 0.0 in a benign env; monotonic in `cold_resistance` under cold (temp
  below comfort or active `cold_snap`) and in `disease_resistance` under `plague`. Reads
  `cold_snap`/`plague` from `env.disasters` correctly. NaN absorption is real (see IN-01). Covered
  by `gene_mortality_monotonic_cold` and `gene_mortality_bounds_and_disease` (cap-binds-exactly +
  `is_finite` assertions).
- **`plague` is genuinely first-class, not a silent no-op.** Added to winter + autumn
  `disaster_kinds_for`, so it is forecast via `roll_forecast`, fired into `env.disasters` with
  `disaster_duration("plague") == 4`, and logged ("A plague struck") in `tick_environment`
  (6281-6303). Its `modifier_kind` arm is intentionally `None` (no CivModifier) because its
  mechanical effect routes through the `gene_mortality_modifier` disease branch — confirmed and
  documented. Critically, the turn pipeline runs `tick_environment` at turn start (863) BEFORE
  `run_life_cycle` (2794) clones `env`, so a fired plague is visible to the selection roll the same
  turn. Covered by `plague_is_first_class_disaster`.
- **GEN-01 breeding regression-safe.** `cross_genes` preserves the existing draw order
  (size -> fertility -> longevity -> vigor) via the shared `blend` helper (5276-5279); pattern
  alleles drawn one-from-each with a ~7% mutation flip AFTER the colour block and BEFORE the new
  quantitative traits. `pattern_rank`/`expressed_pattern` dominance is correct and order-independent.
  `entity.pattern` is set at every morph set-site: founders (via `make_axolotl`:5319), hatch
  (2927), egg (2997), and `make_axolotl` direct (5319) — grep of all `morph:`/`expressed_morph`
  sites shows no missed pattern set. All 5 new fields carry `#[serde(default)]` and back-compat
  is proven by `genes_serde_default_backcompat` (legacy 6-field JSON deserializes).
- **`civ_strength` aggregation is safe.** Sums `genes.strength` over LIVING non-egg axolotls only
  (5423-5428), `f64::from` before the `* 0.5` term; strength is clamped `0.5..=1.6` at breeding so
  no NaN/inf/overflow for realistic populations. `civ_strength_monotonic` asserts strong > weak +
  determinism.
- **Evolution proof is real.** `selection_raises_cold_resistance_over_run` uses `civ_id_for(1)`
  (= `civ-2`), which has NO founders and NO nests — verified: `multi_civ_snapshot(2024, 2)` calls
  `test_snapshot` with a single participant, so `generate_world(seed, 1)` only spawns
  `found_colony` for civ-1; the civ-2 record is a clone with no world entities. With nests==0,
  `can_breed` is false, so the mean shift is pure selection (no breeding dilution). A 60-individual
  founder cohort spanning the full 0.0..0.98 resistance range, longevity=100 (no elder confound),
  pinned cold (temp 2.0 + lingering cold_snap), 30 turns, asserts STRICT `mean_n > mean_0` plus a
  deterministic second run. This genuinely proves measurable evolution.
- **IPC additive + clean.** `bindings.ts` diff adds only the 5 new optional `CivGenes` fields and
  `CivEntity.pattern?`; no existing field changed. The `?`+`| null` rendering on the new f32 fields
  (vs bare `| null` on the old four) correctly reflects their `#[serde(default)]`. `npx tsc
  --noEmit` returns 0. `tauriBrowserFallback.ts` is unaffected.
- **clippy clean for added lines.** `cargo clippy --all-features` exits 0; the only `civilization.rs`
  warning cited is the pre-existing `sort_by_key` at line 767 (well before all Phase-5 regions).
  Lib warning count is 15 (at/under the ~16 baseline) — no new warning attributable to Phase 5.

Two LOW (informational) items below — neither affects correctness, security, or shipping.

## Low

### IN-01: Doc comment misattributes NaN absorption to `clamp` (it is the `.max`)

**File:** `tauri-app/src-tauri/src/civilization.rs:334-335, 339-345`
**Issue:** The doc comment states "NaN/extreme env temp is absorbed by the `clamp` on the cold
term." In Rust, `f32::NAN.clamp(0.0, 1.0)` returns NaN (verified empirically) — the `clamp` does
NOT absorb a NaN temperature. What actually rescues it is the subsequent
`.max(if cold_snap {0.6} else {0.0})`, because `f32::max(NaN, x)` returns the non-NaN `x`
(`NaN.max(0.6) == 0.6`, `NaN.max(0.0) == 0.0`). So the end result is still finite and the function
never returns NaN in practice — but the comment names the wrong mechanism. A future refactor that
removed/reordered the `.max` (e.g. if `cold_snap` floor were dropped) could silently reintroduce a
NaN path that the comment claims is already guarded.
**Fix:** Correct the comment, e.g.:
```rust
// NaN/extreme env temp: the clamp keeps a finite ratio for finite temps, and a NaN
// temperature is absorbed by the `.max(..)` below (f32::max returns the non-NaN arg),
// so `cold` — and thus the result — is always finite.
```
Optionally add a regression assertion to `gene_mortality_bounds_and_disease`:
```rust
let nan_temp = env_with(f32::NAN, &[]);
assert!(gene_mortality_modifier(&genes_res(0.0, 0.0), &nan_temp).is_finite());
```

### IN-02: `PATTERNS` and `COMMON_PATTERNS` are identical duplicate arrays

**File:** `tauri-app/src-tauri/src/civilization.rs:32-34`
**Issue:** `const PATTERNS: [&str; 4] = ["plain", "spotted", "striped", "marbled"]` and
`const COMMON_PATTERNS: [&str; 4] = ["plain", "spotted", "striped", "marbled"]` hold byte-identical
contents. For the colour trait the analogous split is meaningful (`COMMON_MORPHS` excludes the
mutation-only `RARE_MORPHS`), but here founders may carry every pattern, so the two constants are
pure duplication. Not a bug — but a reader will reasonably assume `COMMON_PATTERNS` is a curated
subset (as with morphs) and may "fix" a perceived omission, and any future divergence between the
two lists would be an easy silent mistake.
**Fix:** Either alias to make the intent explicit —
```rust
// Founders may carry every pattern (unlike morphs, no rare/mutation-only tier).
const COMMON_PATTERNS: [&str; 4] = PATTERNS;
```
or drop `COMMON_PATTERNS` and use `PATTERNS` directly in `random_genes`. A one-line comment noting
"intentionally equals PATTERNS" is sufficient if kept separate.

---

_Reviewed: 2026-06-07_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
