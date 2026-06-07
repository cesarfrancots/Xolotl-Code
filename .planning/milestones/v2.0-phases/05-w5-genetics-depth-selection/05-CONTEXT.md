# Phase 5: W5 — Genetics Depth & Selection - Context

**Gathered:** 2026-06-07
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (decisions by Claude per user's "keep going on your own" directive; proposals auto-accepted)
**Note:** FINAL phase of milestone v2.0. After it completes → milestone lifecycle (audit → complete → cleanup).

<domain>
## Phase Boundary

Axolotls evolve. Expand the heritable genome with NEW traits + a second visible
Mendelian allele pair (pattern), crossed Mendelian-style at breeding and expressed
visibly (GEN-01); and make environmental pressure (cold seasons / ice / plague-type
disasters from Phase 3) raise mortality for ill-adapted genes in the life cycle so
allele/trait frequencies measurably shift across a run (GEN-02).

In scope: backend `tauri-app/src-tauri/src/civilization.rs` — extend `CivGenes`,
`cross_genes`/`random_genes`/`default_genes`/mutation, add `expressed_pattern`,
add an environment-vs-genes mortality term in `run_life_cycle`, and wire the new
`strength` gene into Phase 4's `civ_strength` seam — plus the additive bindings
regen for the new `CivGenes` fields. Out of scope: a genetics-inspector UI / Punnett
HUD (deferred — gene data rides the snapshot/text-state); deep pattern VFX in the
renderer (a light visible cue is enough; "visible" is primarily via the expressed
pattern on the entity + text-state/observer, matching how `morph` is already shown).
</domain>

<decisions>
## Implementation Decisions

### Expanded genome (GEN-01)
- Extend `CivGenes` (currently allele_a/allele_b colour + size_gene/fertility/
  longevity/vigor f32 traits) with, all `#[serde(default)]` for back-compat:
  - `pattern_a` / `pattern_b` — a SECOND Mendelian allele pair (pattern: e.g.
    plain/spotted/striped/marbled), expressed via dominance (a `pattern_rank` mirroring
    `morph_rank`); VISIBLE (an `expressed_pattern` on the axolotl, surfaced like `morph`).
  - `strength` (f32) — fulfills Phase 4's `civ_strength` SEAM (add the `genes.strength`
    term THERE; aggregate colony strength = sum/avg over living axolotls).
  - `cold_resistance` (f32) and `disease_resistance` (f32) — adaptation traits the
    selection pressure (GEN-02) acts on; chosen so ill-adaptation is legible/measurable.
- Mendelian crossing: extend `cross_genes` so pattern alleles inherit one-from-each-parent
  (like colour), and the quantitative traits (size/fertility/longevity/vigor/strength/
  resistances) inherit as a parent blend ± small seed-deterministic mutation, clamped to
  sane ranges. Update `random_genes`/`default_genes` and the rare-mutation path.

### Selection pressure (GEN-02)
- In `run_life_cycle`, the per-axolotl mortality/aging calc gains an
  environment-vs-genes term read from `snapshot.environment` (season, temperature,
  active disasters from Phase 3): cold winter / low temperature / `cold_snap`/`ice`
  disaster raises death probability MORE for low `cold_resistance`; a plague-type
  disaster raises it MORE for low `disease_resistance`. Well-adapted genes survive
  more → over turns the population's mean resistance / allele frequencies shift
  (measurable evolution). Bounded (no instant population collapse; always survivors).
- Add a plague-type disaster trigger if Phase 3's set lacks one (e.g. reuse/extend a
  disaster kind), OR drive disease pressure from an existing kind — RESEARCH decides
  the cleanest hook; prefer reusing Phase 3 machinery over new disaster kinds.

### Integration & Determinism
- Breeding, mutation, and mortality rolls are seed^turn-deterministic (reuse the
  established RNG idiom + `round1`); evolution must be replay-stable.
- `civ_strength` (Phase 4) gains the `genes.strength` term at its single seam comment —
  closing the Phase-4 → Phase-5 handoff.
- "Visible": expressed colour `morph` + new `expressed_pattern` ride the entity and the
  text-state/observation (ARENA-01) so harness + observer panel show them; a renderer
  cue for pattern is optional/discretion (Phase 2 tints by civ; pattern is secondary).

### Pure helpers for testability
- `cross_genes` (already exists — extend), `expressed_pattern`/`pattern_rank`,
  `gene_mortality_modifier(genes, &environment) -> f32`, and the `genes.strength`
  term in `civ_strength` — pure/near-pure, unit-tested (`cargo test --no-run` Windows /
  run on CI): Mendelian ratios, dominance, mortality monotonic in mismatch, and a
  multi-turn "population mean resistance rises under sustained cold/plague" selection test.

### Claude's Discretion
- Exact new trait set names/ranges, pattern allele set + dominance order, mutation rates,
  mortality coefficients, the plague hook choice, and whether to add a small renderer cue.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `civilization.rs`: `CivGenes` struct (~418-428: allele_a/allele_b/size_gene/fertility/
  longevity/vigor); entity `genes: Option<CivGenes>` + `morph`/`sex`/`parents` (~360-386);
  `run_life_cycle` (~2763: ages, hatches eggs, breeds via `cross_genes` ~2887, mutation);
  `cross_genes`/`random_genes` (~1558)/`default_genes` (~1981); `expressed_morph` (~5042)
  + `morph_rank` (~5026, dominance); COMMON_MORPHS + rare-via-mutation morphs (~43-45);
  longevity already gates death age (~2779), size_gene → size. Phase 3 `snapshot.environment`
  (season/temperature/disasters) — the selection pressure source. Phase 4 `civ_strength`
  SEAM comment — where `genes.strength` plugs in. Seed^turn RNG idiom + `round1`.

### Established Patterns
- Mendelian dominance via `*_rank` + `expressed_*`; quantitative genes as f32; breeding in
  `run_life_cycle` via `cross_genes`; `#[serde(default)]` on new fields; CivGenes is a
  `#[derive(Type)]` → adding fields requires the headless `export_bindings` regen + tsc
  (additive, exactly like Phase 4's CivDecisionAction change). Determinism; world invariants.

### Integration Points
- `run_life_cycle` (mortality term reads `snapshot.environment`); `cross_genes` (new gene
  inheritance); `civ_strength` (Phase-4 seam ← `genes.strength`); the entity → text-state /
  observation already carries `morph` (extend with `expressed_pattern`). `tauriBrowserFallback.ts`
  is a cosmetic stub (confirmed prior phases) — verify no mirror needed.

</code_context>

<specifics>
## Specific Ideas

- Build on the existing genome — extend `CivGenes` + `cross_genes` + `expressed_*`, do not
  rebuild. Reuse Phase 3's environment + disasters as the selection pressure rather than
  inventing a parallel system; close Phase 4's `civ_strength` seam with `genes.strength`.
- Keep ARENA contracts: genes/morph/pattern ride the existing snapshot → render_game_to_text
  (ARENA-01); no IPC break beyond the additive CivGenes field regen.
- GEN-02 must be MEASURABLE: a deterministic multi-turn test must show mean adapted-trait
  value rising under sustained pressure (that's the "populations measurably evolve" proof).

</specifics>

<deferred>
## Deferred Ideas

- Genetics-inspector / Punnett-square UI, gene HUD (deferred W9 — data rides snapshot/text-state).
- Rich pattern-allele VFX in the renderer beyond a light cue.
- Cross-civ gene flow / hybridization between civs (out of scope — breeding is within a colony).

</deferred>
