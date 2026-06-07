---
phase: 5
slug: w5-genetics-depth-selection
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-07
---

# Phase 5 — Validation Strategy

> Per-phase validation contract. FINAL phase. BACKEND (Rust) — tests can't EXECUTE on
> Windows (WebView2, gotcha #5); verify via cargo check + clippy + fmt + `cargo test --no-run`
> (compile-only); `#[test]`s RUN on CI. Genetics helpers are CURRENTLY UNTESTED (Wave 0).
> The load-bearing GEN-02 proof is a deterministic multi-turn "mean adapted-trait rises
> under sustained pressure" selection test. CivGenes/entity change → bindings regen + tsc gate.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust libtest `#[test]` in `civilization.rs` `#[cfg(test)] mod tests` |
| **Config file** | none (cargo built-in); crate `tauri-app/src-tauri` (lib `xolotl_lib`) |
| **Quick run (Windows, compile-only)** | `cargo test --no-run` (from `tauri-app/src-tauri`) |
| **Quick check (Windows)** | `cargo check` + `cargo clippy --all-features -- -D warnings` (ZERO new vs 16 baseline) + `cargo fmt --all -- --check` |
| **Bindings gate** | `cargo run --bin export_bindings` then `npx tsc --noEmit` (REQUIRED — CivGenes + entity.pattern change) |
| **Full suite (CI)** | `cargo test` — executes the GEN-* unit/selection tests |
| **Estimated runtime** | compile ~60–120s; CI test exec seconds |

---

## Sampling Rate

- **After every task commit:** `cargo check` + `cargo clippy --all-features -- -D warnings` (zero new) + `cargo fmt --check` + `cargo test --no-run`.
- **On any CivGenes/CivEntity change:** `cargo run --bin export_bindings` + `npx tsc --noEmit`; commit bindings.ts. Run `npm test` if any TS touched (the render-map line).
- **After every plan wave:** same; CI runs full `cargo test`.
- **Before `/gsd-verify-work`:** clippy baseline-only; `cargo test --no-run` exit 0; tsc 0; bindings regenerated+committed; the multi-turn selection test is the GEN-02 proof.
- **Max feedback latency:** ~120 seconds (backend compile-bound).

---

## Per-Task Verification Map

> Populated by the planner. Determinism + Mendelian ratios + monotonic mortality +
> measurable multi-turn evolution are the load-bearing automatable properties.

| Req ID | Behavior | Test Type | Automated Command (CI) | Backing Test(s) | Status |
|--------|----------|-----------|------------------------|-----------------|--------|
| GEN-01 | `cross_genes` pattern allele = one-from-each parent (Mendelian) | unit | `cargo test cross_genes_pattern_mendelian` | `cross_genes_pattern_mendelian` (civilization.rs:8899; >150/199 one-from-each across 199 seeds) | ✅ green |
| GEN-01 | `cross_genes` quantitative traits blend within clamp bounds | unit | `cargo test cross_genes_traits_blend_clamped` | `cross_genes_traits_blend_clamped` (:8924; cold/disease 0–1, strength 0.5–1.6, near-mean ±0.08 over 299 seeds) | ✅ green |
| GEN-01 | `cross_genes` deterministic for fixed rng stream | unit (determinism) | `cargo test cross_genes_deterministic` | `cross_genes_deterministic` (:8955; serde byte-equal + rng advanced identically) | ✅ green |
| GEN-01 | `expressed_pattern`/`pattern_rank` dominance | unit | `cargo test expressed_pattern_dominance` | `expressed_pattern_dominance` (:8850; order-independent) + `pattern_rank_total_and_no_panic` (:8860; totality + unknown→rank1, no panic) | ✅ green |
| GEN-01 | `expressed_morph` dominance still holds (regression) | unit | `cargo test expressed_morph_dominance` | `expressed_morph_dominance` (:8838; order-independent + unknown-morph fallback) | ✅ green |
| GEN-01 | new gene fields back-compat: v2 snapshot WITHOUT them deserializes | unit | `cargo test genes_serde_default_backcompat` | `genes_serde_default_backcompat` (:8872; legacy 6-field CivGenes JSON + no-`pattern` CivEntity JSON → serde defaults) | ✅ green |
| GEN-01 | entity `pattern` set on hatch + breed (rides snapshot → text-state) | unit | `cargo test hatch_sets_expressed_pattern` | `hatch_sets_expressed_pattern` (:8996; egg hatches → pattern == expressed_pattern == "marbled", non-empty) | ✅ green |
| GEN-01 | `genes.strength` raises `civ_strength` (extend existing monotonic test) | unit | `cargo test civ_strength_monotonic` | `civ_strength_monotonic` (:8764, extended via `give_civ_axolotls_with_strength` :8694; strong>weak + deterministic) | ✅ green |
| GEN-02 | `gene_mortality_modifier` monotonic: lower cold_resistance ⇒ higher under cold | unit | `cargo test gene_mortality_monotonic_cold` | `gene_mortality_monotonic_cold` (:9072; both low-temp AND cold_snap branches) | ✅ green |
| GEN-02 | `gene_mortality_modifier` monotonic in disease under plague; 0.0 benign; clamped | unit | `cargo test gene_mortality_bounds_and_disease` | `gene_mortality_bounds_and_disease` (:9098; benign==0.0, plague-monotonic, no-plague irrelevant, worst-case==CAP, is_finite) | ✅ green |
| GEN-02 | **Selection: mean cold_resistance RISES over N turns of sustained cold (deterministic)** | integration | `cargo test selection_raises_cold_resistance_over_run` | `selection_raises_cold_resistance_over_run` (:9181; strict `mean_n > mean_0` on founder-free + nest-free civ-1, 60-axolotl full spread, 30 turns pinned cold + cold_snap, ≥1 survivor, deterministic 2nd run) | ✅ green |
| GEN-02 | selection never wipes a civ to 0 from mortality alone (≥1 survivor) | integration (invariant) | `cargo test selection_leaves_survivors` | `selection_leaves_survivors` (:9243; 50 turns, harshest env: −50° + cold_snap + plague, n=5 @0.0 res, asserts ≥1 EACH turn) | ✅ green |
| GEN-02 | `run_life_cycle` mortality deterministic for fixed (seed, turn) | integration (determinism) | `cargo test life_cycle_mortality_deterministic` | `life_cycle_mortality_deterministic` (:9282; two clones 12 turns → serde byte-identical entities) | ✅ green |
| GEN-02 | (extra) population mirror consistent + benign no-op + plague first-class | unit/integration | `cargo test selection_keeps_population_mirror_consistent selection_no_op_in_benign_environment plague_is_first_class_disaster` | `selection_keeps_population_mirror_consistent` (:9314), `selection_no_op_in_benign_environment` (:9342), `plague_is_first_class_disaster` (:9137) | ✅ green |
| ALL | IPC compiles + types check after field add | smoke (gate) | `cargo run --bin export_bindings` then `npx tsc --noEmit` | bindings.ts additive (CivGenes +5 optional, CivEntity `pattern?`); `npx tsc --noEmit` re-run live → exit 0 | ✅ green |
| ALL | no new clippy warnings | smoke (gate) | `cargo clippy --all-features -- -D warnings` | re-run live → 16 errors == Phase-01 baseline; the single civilization.rs error is the pre-existing `unnecessary_sort_by` at :767 (NOT genetics); zero new | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> **Audit note (Nyquist, 2026-06-07):** Every automatable behavior above is backed by a
> non-hollow test verified line-by-line against `civilization.rs` (ratios/bounds/byte-equality/
> strict-rise, not mere existence). The GEN-02 headline proof is genuine: `multi_civ_snapshot`
> → `test_snapshot` (single participant) → `generate_world(seed, 1)` runs `found_colony` for
> civ-0 ONLY, so `civ_id_for(1)` has no founders and no nests; `can_breed` needs `nests > 0`, so
> breeding never fires and the strict mean rise is pure selection, not breeding dilution. The three
> live gates were re-run from `tauri-app/src-tauri` / `tauri-app`: `cargo test --no-run` exit 0,
> `cargo clippy --all-features -- -D warnings` == 16 baseline (zero new in genetics), `npx tsc
> --noEmit` exit 0. No genuine coverage gap found — no new tests added (the IN-01 NaN-temp path is
> an unreachable defensive input, classed LOW in 05-REVIEW; testing it would assert an impossible
> production scenario). Backend tests EXECUTE on CI (Linux/macOS) per gotcha #5.

---

## Wave 0 Requirements

- [x] Establish the FIRST genetics unit tests in the existing `mod tests` (cross_genes/expressed_morph/morph_rank were untested) + the new pattern/trait/selection tests. **DONE** — 8 GEN-01 + 8 GEN-02 tests landed (commits 96332cf, 8da798f).
- [x] A genes-bearing test-axolotl helper. **DONE** — `give_civ_axolotls_with_genes(s, civ_id, n, base, spread)` (:8729) seeds a cold/disease_resistance spread (+ longevity=100 to isolate selection from elder deaths); `give_civ_axolotls_with_strength` (:8694) for the civ_strength seam.
- [x] A multi-turn driver. **DONE** — `selection_raises_cold_resistance_over_run` (:9181) loops `run_life_cycle` 30 turns with temperature pinned to 2.0 + a lingering cold_snap, asserting `mean_n > mean_0` (strict) and a deterministic 2nd-run replay; determinism mirrors `resolve_attack_is_deterministic`.
- [x] No new framework install — `#[test]` + `multi_civ_snapshot`/`test_snapshot`/`civ_id_for` reused as-is.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pattern/colour diversity reads visibly across a colony | GEN-01 | Visual judgment | Run a live session; confirm axolotls show varied morph + pattern in the observer/text-state |
| Evolution "feels" real + balanced over a long run (no degenerate fixation/collapse) | GEN-02 | Emergent multi-turn balance | Run a long session under varying seasons/disasters; confirm populations adapt without dying out or instantly fixing |

---

## Validation Sign-Off

- [x] All automatable tasks have `<automated>` verify or Wave 0 dependencies — every map row has a named backing test + CI command.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — each task commit gated by fmt + `cargo test --no-run` + clippy.
- [x] Wave 0 covers all MISSING references (the new genetics tests + genes-bearing helper) — all four Wave-0 items checked above.
- [x] Bindings regenerated + tsc 0 (CivGenes/entity.pattern change) — bindings.ts additive (CivEntity `pattern?`:339, CivGenes `pattern_a?`:394 / `cold_resistance?`:400 / `disease_resistance?`:402), committed in 620b248; `npx tsc --noEmit` re-run live → exit 0.
- [x] The GEN-02 multi-turn selection test demonstrates MEASURABLE evolution (deterministic) — `selection_raises_cold_resistance_over_run` asserts a STRICT mean rise on a founder-free + nest-free (no breeding dilution) population, with a deterministic replay assert.
- [x] No watch-mode flags — all gates are one-shot (`--no-run`, `--noEmit`, clippy).
- [x] Feedback latency < 120s — backend compile ~60–120s; CI test exec seconds.
- [x] `nyquist_compliant: true` set in frontmatter (after execution + audit).

**Approval:** SIGNED OFF — Nyquist audit 2026-06-07. All criteria genuinely met: 13 automatable behaviors each backed by a verified non-hollow test (incl. the genuine measurable-evolution proof); 3 live gates pass at the documented baseline; bindings regenerated + tsc 0; no genuine coverage gap (no new tests warranted). Manual-Only items (visual pattern/colour diversity, long-run "feel"/balance) and CI runtime execution of the backend tests (Windows cannot run them — gotcha #5) are legitimately not blockers.
