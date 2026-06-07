---
phase: 5
slug: w5-genetics-depth-selection
status: draft
nyquist_compliant: false
wave_0_complete: false
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

| Req ID | Behavior | Test Type | Automated Command (CI) | Status |
|--------|----------|-----------|------------------------|--------|
| GEN-01 | `cross_genes` pattern allele = one-from-each parent (Mendelian) | unit | `cargo test cross_genes_pattern_mendelian` | ⬜ pending |
| GEN-01 | `cross_genes` quantitative traits blend within clamp bounds | unit | `cargo test cross_genes_traits_blend_clamped` | ⬜ pending |
| GEN-01 | `cross_genes` deterministic for fixed rng stream | unit (determinism) | `cargo test cross_genes_deterministic` | ⬜ pending |
| GEN-01 | `expressed_pattern`/`pattern_rank` dominance | unit | `cargo test expressed_pattern_dominance` | ⬜ pending |
| GEN-01 | `expressed_morph` dominance still holds (regression) | unit | `cargo test expressed_morph_dominance` | ⬜ pending |
| GEN-01 | new gene fields back-compat: v2 snapshot WITHOUT them deserializes | unit | `cargo test genes_serde_default_backcompat` | ⬜ pending |
| GEN-01 | entity `pattern` set on hatch + breed (rides snapshot → text-state) | unit | `cargo test hatch_sets_expressed_pattern` | ⬜ pending |
| GEN-01 | `genes.strength` raises `civ_strength` (extend existing monotonic test) | unit | `cargo test civ_strength_monotonic` | ⬜ pending |
| GEN-02 | `gene_mortality_modifier` monotonic: lower cold_resistance ⇒ higher under cold | unit | `cargo test gene_mortality_monotonic_cold` | ⬜ pending |
| GEN-02 | `gene_mortality_modifier` monotonic in disease under plague; 0.0 benign; clamped | unit | `cargo test gene_mortality_bounds_and_disease` | ⬜ pending |
| GEN-02 | **Selection: mean cold_resistance RISES over N turns of sustained cold (deterministic)** | integration | `cargo test selection_raises_cold_resistance_over_run` | ⬜ pending |
| GEN-02 | selection never wipes a civ to 0 from mortality alone (≥1 survivor) | integration (invariant) | `cargo test selection_leaves_survivors` | ⬜ pending |
| GEN-02 | `run_life_cycle` mortality deterministic for fixed (seed, turn) | integration (determinism) | `cargo test life_cycle_mortality_deterministic` | ⬜ pending |
| ALL | IPC compiles + types check after field add | smoke (gate) | `cargo run --bin export_bindings` then `npx tsc --noEmit` | ⬜ pending |
| ALL | no new clippy warnings | smoke (gate) | `cargo clippy --all-features -- -D warnings` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Establish the FIRST genetics unit tests in the existing `mod tests` (cross_genes/expressed_morph/morph_rank are untested today) + the new pattern/trait/selection tests.
- [ ] A genes-bearing test-axolotl helper: extend `give_civ_axolotls` (~8464, currently sets `genes: None`) OR add `give_civ_axolotls_with_genes(...)` so the selection test starts from a population with a spread of cold_resistance/disease_resistance.
- [ ] A multi-turn driver: loop `run_life_cycle` (or `tick_environment` + `run_life_cycle`) with temperature pinned cold / a plague disaster injected, asserting mean resistance at turn N > turn 0. Determinism asserts mirror `civ_strength_monotonic` (~8485) / `resolve_attack_is_deterministic` (~8532).
- [ ] No new framework install — `#[test]` + multi_civ_snapshot/test_snapshot/civ_id_for already exist.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pattern/colour diversity reads visibly across a colony | GEN-01 | Visual judgment | Run a live session; confirm axolotls show varied morph + pattern in the observer/text-state |
| Evolution "feels" real + balanced over a long run (no degenerate fixation/collapse) | GEN-02 | Emergent multi-turn balance | Run a long session under varying seasons/disasters; confirm populations adapt without dying out or instantly fixing |

---

## Validation Sign-Off

- [ ] All automatable tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (the new genetics tests + genes-bearing helper)
- [ ] Bindings regenerated + tsc 0 (CivGenes/entity.pattern change)
- [ ] The GEN-02 multi-turn selection test demonstrates MEASURABLE evolution (deterministic)
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter (after execution + audit)

**Approval:** pending
