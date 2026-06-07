---
phase: 05-w5-genetics-depth-selection
plan: 01
subsystem: api
tags: [genetics, mendelian, serde, specta, bindings, civilization, determinism]

# Dependency graph
requires:
  - phase: 04-w6-combat-diplomacy
    provides: "civ_strength with a Phase-5 SEAM comment awaiting a genes.strength term"
  - phase: 01-w9-lite-multi-model-world-creation-leaderboard
    provides: "CivGenes colour-allele genome, morph_rank/expressed_morph dominance, cross_genes breeding, headless export_bindings bin, renderSnapshotToText text-state"
provides:
  - "Expanded CivGenes: pattern_a/pattern_b (2nd Mendelian pair) + strength/cold_resistance/disease_resistance (3 quantitative traits), all #[serde(default)] (back-compat)"
  - "pattern_rank/expressed_pattern dominance machinery mirroring colour morph"
  - "cross_genes inheritance for pattern (one-from-each + mutation) and the 3 new clamped f32 traits via an extracted blend() helper"
  - "Entity-level expressed pattern set on hatch/egg-lay/make_axolotl, surfaced in the ARENA-01 text-state"
  - "civ_strength closes the Phase-4 seam by summing genes.strength over living axolotls"
  - "Regenerated bindings.ts (additive) + first-ever genetics unit tests"
affects: [05-02-selection-pressure, GEN-02, gene_mortality_modifier]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Second Mendelian allele pair expressed via a parallel rank table (pattern_rank/expressed_pattern), mirroring colour"
    - "Shared blend() helper for all 7 quantitative trait crosses (existing-4 draw order preserved -> rng stream byte-identical)"
    - "#[serde(default = \"named_fn\")] for every new gene field -> optional TS props + legacy-snapshot back-compat"

key-files:
  created: []
  modified:
    - "tauri-app/src-tauri/src/civilization.rs"
    - "tauri-app/src/bindings.ts"
    - "tauri-app/src/components/civilization/CivilizationGameCanvas.tsx"

key-decisions:
  - "PATTERNS = [plain, spotted, striped, marbled]; plain recessive (rank 1), marbled most dominant (rank 4)"
  - "strength clamp 0.5..1.6; cold_resistance/disease_resistance clamp 0.0..1.0; legacy defaults strength=1.0, resistances=0.5 (mid), pattern alleles=plain"
  - "civ_strength aggregates genes.strength as a SUM with K=0.5 over living non-egg axolotls (consistent with the other additive terms + monotonic-test shape)"
  - "Extracted blend(x,y,rng,lo,hi) and refactored the existing 4 inline trait blends through it; order size->fertility->longevity->vigor preserved so determinism is unchanged"
  - "Backend genome (Tasks 1+2) committed as one atomic commit (the new CivGenes fields require the cross/random/default literal fills to compile -- splitting would create a non-compiling intermediate)"

patterns-established:
  - "Pattern dominance: pattern_rank + expressed_pattern as an exact parallel to morph_rank/expressed_morph"
  - "Every axolotl-construction site that sets morph also sets the expressed pattern"
  - "Headless bindings regen (cargo run --bin export_bindings) is the canonical IPC-surface refresh after CivGenes/CivEntity changes"

requirements-completed: [GEN-01]

# Metrics
duration: 22min
completed: 2026-06-07
---

# Phase 5 Plan 01: Expanded Genome (GEN-01) Summary

**A second visible Mendelian pattern allele pair (plain/spotted/striped/marbled) plus three quantitative traits (strength/cold_resistance/disease_resistance) added to CivGenes, crossed Mendelian-style + clamped-blended deterministically, expressed onto every axolotl and into the text-state, with the Phase-4 civ_strength seam closed by summing genes.strength.**

## Performance

- **Duration:** ~22 min
- **Completed:** 2026-06-07
- **Tasks:** 3 (all TDD; backend genome landed as one atomic compile-clean commit, bindings/render as a second)
- **Files modified:** 3

## Accomplishments
- `CivGenes` carries 5 new `#[serde(default)]` fields via named-default fns (`default_pattern_allele`/`default_strength`/`default_resistance`) — old snapshots deserialize with sane defaults.
- `pattern_rank`/`expressed_pattern` dominance mirrors `morph_rank`/`expressed_morph` exactly; entity gains a `#[serde(default)] pattern: String`.
- `cross_genes` extended additively: `pick_pattern_allele` (one-from-each) + ~7% pattern-mutation flip, and the 3 new f32 traits blended/clamped through a new `blend()` helper that now backs all 7 quantitative traits (existing 4 invoked in the SAME order → rng stream byte-identical, caught by `cross_genes_deterministic`).
- `random_genes` gives founders pattern + resistance variance; `default_genes` is recessive plain + mid resistances.
- Expressed pattern set at all 3 morph set-sites (hatch, egg-lay, make_axolotl); echoed into `renderSnapshotToText` (one TSX line).
- `civ_strength` sums `genes.strength` over living non-egg axolotls with K=0.5 — Phase-4 seam closed.
- First-ever genetics unit tests (8 new + 1 extended).

## Task Commits

1. **Task 1 + 2: genome expansion, dominance, cross/random/default extensions, set-sites, civ_strength seam, GEN-01 tests** — `96332cf` (feat) — combined because the new CivGenes fields require the literal fills to compile (atomic = compiling).
2. **Task 3: text-state echo + headless bindings regen** — `620b248` (feat)

**Plan metadata:** (this commit) `docs(05): complete plan 05-01`

## Files Created/Modified
- `tauri-app/src-tauri/src/civilization.rs` — 5 CivGenes fields + entity `pattern`; PATTERNS/COMMON_PATTERNS consts; pattern_rank/expressed_pattern; pick_pattern_allele + blend() + extended cross_genes/random_genes/default_genes; pattern set on hatch/breed/make_axolotl; genes.strength term in civ_strength; 8 new + 1 extended genetics tests; `give_civ_axolotls_with_strength` test helper.
- `tauri-app/src/bindings.ts` — regenerated (additive): CivGenes +5 optional fields, CivEntity +`pattern?`.
- `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx` — one line: `pattern: entity.pattern` in the visible_entities map.

## Verification Results (gates)

- `cargo fmt --all -- --check` → exit 0
- `cargo test --no-run` → exit 0 (tests compile; backend tests EXECUTE on CI only — Windows WebView2 limitation, CLAUDE.md #5)
- `cargo clippy --all-features -- -D warnings` → **16 errors (== baseline; ZERO new)**. The single civilization.rs clippy error is the pre-existing `list_civ_sessions` `unnecessary_sort_by` at :753 (was :703, documented in Phase-01 deferred-items.md); none of the added genetics code warns.
- `cargo run --bin export_bindings` → exit 0
- `npx tsc --noEmit` → exit 0
- `npm test` (vitest) → **245/245 passed (26 files)**

### Bindings regen: FULL regen (no hand-add)
The full headless regen produced a perfectly scoped **additive** diff (12 insertions, 0 deletions): `CivEntity` gained `pattern?: string`; `CivGenes` gained `pattern_a?`/`pattern_b?` (string) and `strength?`/`cold_resistance?`/`disease_resistance?` (number | null). **No unrelated eval/type drift** — the MEMORY "bindings.ts drift trap" did NOT trigger, so no hand-add fallback was needed. `tauriBrowserFallback.ts` is unchanged (its 3 genes literals stay valid because all new fields are optional).

### Morph set-sites + seam confirmation
Re-grep confirms every `expressed_morph` call is paired with an `expressed_pattern` call:
- hatch (`entity.morph =` / `entity.pattern =`)
- egg-lay (`morph: expressed_morph(&child)` / `pattern: expressed_pattern(&child)`)
- make_axolotl (`let morph` / `let pattern` + both in the CivEntity literal)

civ_strength SEAM closed: `gene_str` sums `g.strength` over `kind == "axolotl" && stage != "egg"` filtered via `filter_map(e.genes)`, added to the sum as `f64::from(gene_str) * 0.5`; the SEAM comment is retained.

## Decisions Made
See `key-decisions` frontmatter. Notable: combined Tasks 1+2 into one backend commit (a split would yield a non-compiling intermediate, violating atomic/working-state); chose SUM×K=0.5 for the strength term; preserved the existing 4-trait blend order to keep the rng stream byte-identical.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Combined Task 1 + Task 2 into a single compiling backend commit**
- **Found during:** Task 1 (struct expansion)
- **Issue:** Adding the 5 new non-`..default()` CivGenes fields makes the `default_genes`/`random_genes`/`cross_genes` struct literals and the `make_axolotl`/egg-lay `CivEntity` literals fail to compile until they set the new fields — which is Task 2's work. A Task-1-only commit would not compile, violating the atomic/working-commit invariant.
- **Fix:** Implemented Task 1's struct/dominance/consts AND Task 2's cross/random/default extensions + set-sites + seam together, committed as one feat commit (`96332cf`). Task 3 (TS/bindings) is separate (`620b248`).
- **Files modified:** tauri-app/src-tauri/src/civilization.rs
- **Verification:** `cargo build` / `cargo test --no-run` exit 0 at the commit; clippy at baseline.
- **Committed in:** 96332cf

**2. [Rule 2 - Missing Critical] Added `give_civ_axolotls_with_strength` test helper**
- **Found during:** Task 2 (extending civ_strength_monotonic)
- **Issue:** The existing `give_civ_axolotls` helper pushes axolotls with `genes: None`, so it cannot exercise the new `genes.strength` seam term. The plan's `civ_strength_monotonic` extension needs genes-bearing axolotls with a controllable strength.
- **Fix:** Added a `give_civ_axolotls_with_strength(s, civ_id, n, strength)` test helper (genes = `CivGenes { strength, ..default_genes() }`).
- **Files modified:** tauri-app/src-tauri/src/civilization.rs (test module)
- **Verification:** `cargo test --no-run` exit 0; the extended monotonic test compiles and its assertions (strong > weak; deterministic) are logically sound.
- **Committed in:** 96332cf

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing-critical).
**Impact on plan:** Both are mechanical/necessary for a compiling, testable result. No scope creep — all behavior matches the plan's specified genome, inheritance, visibility, and seam.

## Issues Encountered
None. All anchors matched the plan's `<interfaces>` by symbol name; the full bindings regen was clean (no drift-trap fallback needed); no `cargo clean` recovery was required.

## Stub / Threat notes
- No stubs introduced. All new fields are wired (set at construction, read at strength aggregation + dominance, surfaced in text-state).
- Threat register (T-05-01..05) honored: determinism preserved (existing-4 blend order intact + `cross_genes_deterministic`), all quantitative traits clamped (`cross_genes_traits_blend_clamped`), back-compat via `#[serde(default)]` (`genes_serde_default_backcompat`), bindings regen gate passed (T-05-04), `pattern_rank` has a `_ => 1` catch-all (T-05-05). No new external/network surface.

## Next Phase Readiness
- The FINAL genome is landed and bindings regenerated, so Plan 05-02 (GEN-02 selection pressure) can compile against `cold_resistance`/`disease_resistance`/`strength` and the entity `pattern` immediately.
- Backend genetics tests EXECUTE on CI (Linux/macOS) — run the full `cargo test` there before `/gsd-verify-work` to confirm the new unit tests pass at runtime (Windows compiles them but cannot run them).

## Self-Check: PASSED
- All 3 modified files exist on disk.
- Both task commits (`96332cf`, `620b248`) present in git log.
- Key symbols present: `pub pattern_a: String`, `fn expressed_pattern` (x2: def + tests), `fn pick_pattern_allele`, `g.strength` (seam + tests).
- All verification gates green (fmt 0, test --no-run 0, clippy 16 baseline, tsc 0, vitest 245/245).

---
*Phase: 05-w5-genetics-depth-selection*
*Completed: 2026-06-07*
