# Phase 5: W5 — Genetics Depth & Selection - Research

**Researched:** 2026-06-07
**Domain:** Rust backend genetics/breeding/life-cycle in `tauri-app/src-tauri/src/civilization.rs`; deterministic simulation; tauri-specta IPC binding regen
**Confidence:** HIGH (all claims verified by direct codebase read; no external libs introduced)

## Summary

Phase 5 is a pure-backend extension of an already-working genetics system. The engine
already has a Mendelian colour-allele pair (`allele_a`/`allele_b`), dominance via
`morph_rank`/`expressed_morph`, quantitative f32 traits (`size_gene`/`fertility`/
`longevity`/`vigor`), a breeding cross (`cross_genes`) called inside `run_life_cycle`,
and a fully seed-deterministic RNG idiom. GEN-01 is a *parallel extension* of every one of
those (a second allele pair `pattern_a`/`pattern_b` + `pattern_rank`/`expressed_pattern`,
plus three new f32 traits), and GEN-02 is a *new term* added to the aging/death pass that
reads the already-reachable `snapshot.environment` (season/temperature/disasters from
Phase 3). The Phase-4 `civ_strength` seam already has an explicit one-line comment marking
where `genes.strength` plugs in.

The two genuinely new pieces are (1) `gene_mortality_modifier(genes, &environment) -> f32`,
a pure helper, and (2) the decision of how to express "plague" pressure — Phase 3 has NO
plague/disease disaster kind, but it has `cold_snap` (winter) and a documented "reuse an
existing modifier kind, never push an unknown kind" rule. The cleanest hook is to drive
`disease_resistance` pressure off an EXISTING signal (a `cold_snap`/`drought` active
disaster, or simply low-morale/winter) rather than inventing a new disaster kind, OR to add
`"plague"` to the season-weighted kind list AND give it a live `resolve_environment` arm +
`disaster_duration` entry (the established pattern requires both, see Pitfall 5).

**Primary recommendation:** Extend in place — add fields to `CivGenes` (all `#[serde(default)]`),
mirror the colour-dominance helpers for pattern, add a per-axolotl mortality term in
`run_life_cycle` Section 1 reading `snapshot.environment`, wire `genes.strength` at the
`civ_strength` seam (line 5265), regen bindings headlessly (`cargo run --bin export_bindings`),
and prove GEN-02 with a deterministic multi-turn test that shows mean resistance rising under
sustained pressure. Reuse Phase 3 machinery for the plague hook; do not invent a parallel system.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Expanded genome (GEN-01):**
- Extend `CivGenes` (currently allele_a/allele_b colour + size_gene/fertility/longevity/vigor)
  with, all `#[serde(default)]` for back-compat:
  - `pattern_a` / `pattern_b` — a SECOND Mendelian allele pair (pattern: e.g.
    plain/spotted/striped/marbled), expressed via dominance (a `pattern_rank` mirroring
    `morph_rank`); VISIBLE (an `expressed_pattern`, surfaced like `morph`).
  - `strength` (f32) — fulfills Phase 4's `civ_strength` SEAM (add the `genes.strength` term
    THERE; aggregate colony strength = sum/avg over living axolotls).
  - `cold_resistance` (f32) and `disease_resistance` (f32) — adaptation traits the selection
    pressure (GEN-02) acts on; chosen so ill-adaptation is legible/measurable.
- Mendelian crossing: extend `cross_genes` so pattern alleles inherit one-from-each-parent
  (like colour), and quantitative traits inherit as parent blend ± small seed-deterministic
  mutation, clamped to sane ranges. Update `random_genes`/`default_genes` and the rare-mutation path.

**Selection pressure (GEN-02):**
- In `run_life_cycle`, the per-axolotl mortality/aging calc gains an environment-vs-genes term
  read from `snapshot.environment` (season, temperature, active disasters from Phase 3): cold
  winter / low temperature / `cold_snap`/`ice` disaster raises death probability MORE for low
  `cold_resistance`; a plague-type disaster raises it MORE for low `disease_resistance`.
  Well-adapted genes survive more → over turns the population's mean resistance / allele
  frequencies shift (measurable evolution). Bounded (no instant population collapse; always
  survivors).
- Add a plague-type disaster trigger if Phase 3's set lacks one (e.g. reuse/extend a disaster
  kind), OR drive disease pressure from an existing kind — RESEARCH decides the cleanest hook;
  prefer reusing Phase 3 machinery over new disaster kinds.

**Integration & Determinism:**
- Breeding, mutation, and mortality rolls are seed^turn-deterministic (reuse the established
  RNG idiom + `round1`); evolution must be replay-stable.
- `civ_strength` (Phase 4) gains the `genes.strength` term at its single seam comment.
- "Visible": expressed colour `morph` + new `expressed_pattern` ride the entity and the
  text-state/observation (ARENA-01); a renderer cue for pattern is optional/discretion.

**Pure helpers for testability:**
- `cross_genes` (extend), `expressed_pattern`/`pattern_rank`,
  `gene_mortality_modifier(genes, &environment) -> f32`, and the `genes.strength` term in
  `civ_strength` — pure/near-pure, unit-tested (`cargo test --no-run` Windows / run on CI):
  Mendelian ratios, dominance, mortality monotonic in mismatch, and a multi-turn "population
  mean resistance rises under sustained cold/plague" selection test.

### Claude's Discretion
- Exact new trait set names/ranges, pattern allele set + dominance order, mutation rates,
  mortality coefficients, the plague hook choice, and whether to add a small renderer cue.

### Deferred Ideas (OUT OF SCOPE)
- Genetics-inspector / Punnett-square UI, gene HUD (deferred W9 — data rides snapshot/text-state).
- Rich pattern-allele VFX in the renderer beyond a light cue.
- Cross-civ gene flow / hybridization between civs (breeding is within a colony).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GEN-01 | Axolotls carry expanded genetics (new traits + pattern alleles) that cross Mendelian-style and are visible | Extend `CivGenes` (5 new fields); mirror `morph_rank`→`pattern_rank` and `expressed_morph`→`expressed_pattern` (civilization.rs:5026-5048); extend `cross_genes` (5114), `random_genes` (5094), `default_genes` (5083), rare-mutation path (5117-5130). "Visible" = add a top-level entity `pattern` String set from `expressed_pattern` (mirroring `morph` at :364), surfaced in `renderSnapshotToText` (CivilizationGameCanvas.tsx:3457). Bindings regen additive. |
| GEN-02 | Environmental pressure (ice age, plague) raises mortality for ill-adapted genes, so populations measurably evolve | Add `gene_mortality_modifier(genes, &CivEnvironment) -> f32` (pure); apply it in `run_life_cycle` Section 1 (civilization.rs:2771-2799) where elder death is already rolled. `snapshot.environment` is reachable (run_life_cycle takes `&mut snapshot`); env is freshly advanced before this runs (turn order: tick_environment → … → resolve_environment→run_life_cycle). Bounded by a >=1-survivor floor + per-turn death cap. Deterministic (RNG already `seed^turn`-derived at :2767). Measurable via a multi-turn mean-resistance-rises test. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Gene inheritance (Mendelian + blend) | API/Backend (`cross_genes`) | — | Pure deterministic engine math; must be replay-stable; no UI involvement |
| Pattern dominance/expression | API/Backend (`pattern_rank`/`expressed_pattern`) | — | Mirrors existing colour dominance; entity carries the expressed result |
| Selection mortality | API/Backend (`run_life_cycle` + `gene_mortality_modifier`) | — | Reads `snapshot.environment`; removes entities; population is a mirror |
| Strength aggregation | API/Backend (`civ_strength`) | — | Phase-4 seam; sums over living axolotls' genes |
| Gene/pattern visibility (text-state) | API/Backend (snapshot entity fields) | Frontend Server (`renderSnapshotToText`) | Snapshot carries `morph`/`pattern`; the TS render layer just echoes them into the ARENA-01 text |
| Pattern visual cue (optional) | Browser/Client (Phaser scene) | — | Discretion only; renderer keys sprites off `morph` today |
| IPC type surface | API/Backend (specta derive) | Frontend Server (bindings.ts consumers) | `#[derive(Type)]` on `CivGenes`/`CivEntity` → regen bindings; additive |

## Standard Stack

No new dependencies. This phase uses only what `civilization.rs` already imports.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (in-crate) `xorshift` RNG via `next_rng`/`rand_f`/`rand_range`/`seed_from` | civilization.rs:4999-5023 | Seed-deterministic randomness | The ONLY RNG idiom in the engine; every disaster/combat/breeding roll uses it; replay-stable |
| serde + serde_json | workspace | Snapshot (de)serialization, `#[serde(default)]` back-compat | Already the snapshot format |
| specta / tauri-specta (`#[derive(Type)]`) | as in tauri-app | Generate `bindings.ts` types from Rust | `CivGenes`/`CivEntity` already derive `Type`; new fields auto-export |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `round1` (civilization.rs:5223) | in-crate | 1-dp rounding for replay stability | Apply to any new f32 stored in the snapshot that came from a float computation |
| `f32::clamp` | std | Bound trait ranges | Every quantitative gene is clamped in `cross_genes`; new ones must be too |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reuse in-crate `next_rng` | `rand` crate | FORBIDDEN — would break determinism/replay and add a dep; the whole engine deliberately uses the seeded xorshift |
| Add a new `"plague"` disaster kind | Drive disease off an existing active disaster / winter / low morale | New kind requires touching `disaster_kinds_for` + `disaster_duration` + a `resolve_environment` arm (Pitfall 5); reusing is lower-risk. RESEARCH leans reuse; either is viable (Open Q1). |

**Installation:** None — no `npm install` / `cargo add`.

**Version verification:** No registry packages added. Toolchain verified: `rustc 1.95.0`,
`cargo 1.95.0` [VERIFIED: `rustc --version` / `cargo --version` in this session], matching the
workspace CI pin (Rust 1.95.0) noted in CLAUDE.md.

## Architecture Patterns

### System Architecture Diagram

```
                       advance_civ_turn(id)  [civilization.rs:797]
                                 │
                turn += 1  →  tick_environment(snapshot)  [:814 / fn :6035]
                                 │   (fires due forecast → pushes CivDisaster into
                                 │    snapshot.environment.disasters; advances
                                 │    season/temperature; rolls next forecast)
                                 ▼
                       per-civ DECISION LOOP (LLM → apply_model_decision)
                                 │
                   resolve_combat → step_predators   (entity casualties)
                                 │
        ┌────────── for civ_id in turn_order: ──────────┐
        │   resolve_environment(snapshot, civ_id) [:2669]│
        │            │ (shortages, modifiers)            │
        │            ▼                                    │
        │   run_life_cycle(snapshot, civ_id) [:2745/:2763]│   ◀── GEN-02 hooks HERE
        │     1) AGE + STAGE + DEATH  [:2771-2810]        │       (read snapshot.environment;
        │        elder death roll (:2796)                 │        add gene_mortality_modifier
        │        ── ADD: env-vs-genes mortality roll ──   │        before/with elder roll)
        │     2) HATCH EGGS (expressed_morph + pattern)   │
        │     3) BREED: cross_genes(female, male, rng)    │   ◀── GEN-01 inheritance HERE
        │        [:2887]  (one-from-each + blend±mut)     │
        │     4) population = count(living non-egg)       │
        └─────────────────────────────────────────────────┘
                                 │
        civ_strength(snapshot, civ_id) [:5251]  ◀── GEN-01 strength term at SEAM :5265
                                 │
              snapshot persisted → emitted to UI/observer
                                 │
        window.render_game_to_text() → renderSnapshotToText() [tsx:3415]
              emits per-entity { morph, …, + pattern }  ◀── GEN-01 "visible" (ARENA-01)
```

Entry = a turn advance. `snapshot.environment` is fully current by the time `run_life_cycle`
runs (env ticked at turn start). All RNG for life-cycle is `snapshot.seed ^ turn*0x9E3779B9 ^
0x5A5A5A5A` (civilization.rs:2767) — wall-clock-free, replay-stable.

### Recommended Project Structure

Single file. Edits are localized:

```
tauri-app/src-tauri/src/civilization.rs
├── ~25-46     COMMON_MORPHS / RARE_MORPHS / MORPHS    # add pattern allele consts here
├── ~420-428   struct CivGenes                          # +5 #[serde(default)] fields
├── ~348-400   struct CivEntity                         # +1 #[serde(default)] `pattern: String`
├── ~2763      run_life_cycle                           # GEN-02 mortality term (Section 1)
│   └── ~2830/2899  hatch/egg morph set                 # also set entity.pattern = expressed_pattern
├── ~5026-5048 morph_rank / expressed_morph             # add pattern_rank / expressed_pattern below
├── ~5083-5142 default_genes/random_genes/cross_genes   # extend all three
├── ~5145-5183 make_axolotl                             # set pattern on the constructed entity
├── ~5251-5267 civ_strength                             # add genes.strength term at SEAM :5265
└── ~6900+     #[cfg(test)] mod tests                   # new unit + multi-turn selection tests

tauri-app/src/bindings.ts                               # REGEN (additive) — do not hand-edit
tauri-app/src/components/civilization/CivilizationGameCanvas.tsx
└── ~3457      renderSnapshotToText visible_entities map # add `pattern: entity.pattern`
tauri-app/src/lib/tauriBrowserFallback.ts               # only if TS literals break (see Pitfall 4)
```

### Pattern 1: Mirror the colour-dominance pair for pattern
**What:** Pattern inherits and expresses EXACTLY like colour. Add a parallel rank table and
expressor.
**When to use:** GEN-01 second Mendelian allele pair.
**Example (model after the existing colour code):**
```rust
// Existing (civilization.rs:5025-5048) — the template:
fn morph_rank(morph: &str) -> u8 { /* mystic=11 … albino=1, _=>3 */ }
fn expressed_morph(genes: &CivGenes) -> String {
    if morph_rank(&genes.allele_b) > morph_rank(&genes.allele_a) {
        genes.allele_b.clone()
    } else { genes.allele_a.clone() }
}
// New (add immediately below, same shape):
const PATTERNS: [&str; N] = ["plain", "spotted", "striped", "marbled", /* … */];
fn pattern_rank(p: &str) -> u8 { /* pick a dominance order; "plain" recessive */ }
fn expressed_pattern(genes: &CivGenes) -> String {
    if pattern_rank(&genes.pattern_b) > pattern_rank(&genes.pattern_a) {
        genes.pattern_b.clone()
    } else { genes.pattern_a.clone() }
}
```

### Pattern 2: Extend cross_genes additively (one-per-parent + blend ± mutation, clamped)
**What:** Pattern alleles use `pick_allele`-style one-from-each; quantitative traits use the
existing `(a+b)/2 + rand_range(rng,-δ,δ)).clamp(lo,hi)` blend.
**When to use:** GEN-01 inheritance.
**Example (extend, civilization.rs:5114-5142):**
```rust
fn cross_genes(a: &CivGenes, b: &CivGenes, rng: &mut u32) -> CivGenes {
    let allele_a = pick_allele(rng, a).to_string();   // existing colour
    let allele_b = pick_allele(rng, b).to_string();
    // … existing colour mutation block (7% flip) …
    // NEW pattern alleles — same one-per-parent idiom; reuse pick_pattern_allele(rng, g)
    let pattern_a = pick_pattern_allele(rng, a).to_string();
    let pattern_b = pick_pattern_allele(rng, b).to_string();
    // optional small pattern mutation flip, mirroring the colour block
    CivGenes {
        allele_a, allele_b, pattern_a, pattern_b,
        size_gene:  blend(a.size_gene,  b.size_gene,  rng, 0.7, 1.4),
        fertility:  blend(a.fertility,  b.fertility,  rng, 0.3, 1.0),
        longevity:  blend(a.longevity,  b.longevity,  rng, 0.8, 1.35),
        vigor:      blend(a.vigor,      b.vigor,      rng, 0.8, 1.25),
        // NEW quantitative — same blend, choose sane clamps:
        strength:          blend(a.strength,          b.strength,          rng, 0.5, 1.6),
        cold_resistance:   blend(a.cold_resistance,   b.cold_resistance,   rng, 0.0, 1.0),
        disease_resistance:blend(a.disease_resistance,b.disease_resistance,rng, 0.0, 1.0),
    }
}
// where blend = ((x+y)/2.0 + rand_range(rng,-0.08,0.08)).clamp(lo,hi)  — extract a helper
//       to avoid 8 repetitions (clippy pedantic is happier; the existing code inlines it).
```
> IMPORTANT: every new f32 read in `cross_genes` must come from an `Option<CivGenes>` parent
> that may be a legacy save WITHOUT the field. With `#[serde(default)]` + a `default_*` fn the
> field deserializes to a sane value, so `a.cold_resistance` is always present on the struct
> (the struct is fully materialized; serde fills the default on load). No `unwrap_or` needed
> on the field itself — only on `entity.genes` (already `Option`, handled at :2779 via `map_or`).

### Pattern 3: Selection mortality in run_life_cycle (GEN-02)
**What:** A bounded, deterministic extra death roll per axolotl, driven by mismatch between
genes and the live environment.
**Where:** Section 1 of `run_life_cycle` (civilization.rs:2771-2810), alongside the existing
elder-death roll at :2796.
**Example:**
```rust
// snapshot.environment is reachable: run_life_cycle takes &mut snapshot. Read the env BEFORE
// the &mut entities borrow (the existing fn already reads health/morale into locals at :2768).
let env = snapshot.environment.clone();           // small struct; clone avoids borrow conflict
// … inside the entities loop, after the elder roll …
if let Some(g) = entity.genes.as_ref() {
    let p_die = gene_mortality_modifier(g, &env);  // pure, bounded e.g. [0.0, 0.25]
    if entity.stage != "egg" && rand_f(&mut rng) < p_die {
        deaths.push(entity.id.clone());
    }
}
// SURVIVOR FLOOR: after collecting deaths, never let this civ hit 0 from selection alone —
// mirror bounded_loss (:3307): if deaths would remove all living, retain at least 1.
```
**Pure helper (unit-testable, monotonic):**
```rust
/// Extra per-turn death probability from environment-vs-genes mismatch. Bounded, pure,
/// deterministic. Monotonic: lower cold_resistance ⇒ higher result under cold; lower
/// disease_resistance ⇒ higher under plague. Returns 0.0 in a benign environment.
fn gene_mortality_modifier(g: &CivGenes, env: &CivEnvironment) -> f32 {
    let mut p = 0.0_f32;
    // Cold pressure: scales with how far temperature is below a comfort baseline, AND
    // hard cold_snap disasters. (1.0 - cold_resistance) is the deficit.
    let cold = ((COMFORT_TEMP - env.temperature) / COMFORT_SPAN).clamp(0.0, 1.0);
    let cold = cold.max(if env.disasters.iter().any(|d| d.kind == "cold_snap") { 0.6 } else { 0.0 });
    p += cold * (1.0 - g.cold_resistance) * COLD_COEFF;
    // Disease pressure: from a plague hook (Open Q1 — reuse existing or add "plague").
    let plague = if env.disasters.iter().any(|d| is_plague_kind(&d.kind)) { 1.0 } else { 0.0 };
    p += plague * (1.0 - g.disease_resistance) * DISEASE_COEFF;
    p.clamp(0.0, MORTALITY_CAP)   // e.g. 0.25 — bounded, no instant collapse
}
```

### Pattern 4: Strength at the civ_strength seam
**What:** Add an aggregate `genes.strength` term to the existing strength sum.
**Where:** civilization.rs:5265 (the literal `// Phase-5 SEAM:` comment).
**Example:**
```rust
// Aggregate over this civ's LIVING (non-egg) axolotls (mirror living_axolotl_count :5271).
let gene_str: f32 = civ_entities(snapshot, civ_id)
    .filter(|e| e.kind == "axolotl" && e.stage != "egg")
    .filter_map(|e| e.genes.as_ref().map(|g| g.strength))
    .sum();   // or mean — choose; sum scales with pop, mean is per-capita
// Phase-5 SEAM: add a `genes.strength` term to this sum here only.
round1((pop * 1.0 + tools * 0.2 + tech * 1.5 + owned * 2.0 + f64::from(gene_str) * K) as f32)
```
> Note: `civ_strength` takes `&snapshot` (immutable) and `civ_entities` is an immutable iterator
> — adding this read is borrow-safe.

### Anti-Patterns to Avoid
- **Pushing a new `CivModifier`/disaster kind with no handler arm:** silent no-op (Pitfall 5).
  If adding `"plague"`, add it to `disaster_kinds_for`, `disaster_duration`, AND give it a real
  effect (a `resolve_environment` arm and/or the `gene_mortality_modifier` disease branch).
- **Reading wall-clock or a fresh uuid in any new roll:** breaks replay determinism (the entire
  engine forbids it; ids are `format!("…-{turn}-…")`). Mortality/mutation MUST use the existing
  `rng` seeded at :2767.
- **Unbounded mortality:** always clamp `gene_mortality_modifier` and keep a >=1-survivor floor;
  CONTEXT mandates "no instant population collapse; always survivors."
- **Hand-editing `bindings.ts`:** auto-generated; regen via the headless bin (CLAUDE.md #1).
- **Modeling genes as required TS fields:** keep them `#[serde(default)]` so they render `field?:`
  (optional) and old saves + TS literals don't break (Pitfall 4).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Randomness | A new RNG / `rand` crate | `next_rng`/`rand_f`/`rand_range` (:5008-5023) | Determinism + no dep; replay-stable |
| Dominance/expression | New expression engine | Mirror `morph_rank`/`expressed_morph` (:5026) | Proven pattern; one parallel pair |
| Allele inheritance | Custom Punnett logic | `pick_allele` idiom (:5106) | One-from-each already correct & tested-by-use |
| Trait blending | New interpolation | `((a+b)/2 + rand_range(±δ)).clamp(lo,hi)` (:5134) | Already the house style; just clamp the new traits |
| Disaster/selection signal | A parallel environment system | `snapshot.environment` (season/temp/disasters) | Phase 3 owns this; GEN-02 only READS it |
| Survivor floor | Custom min-pop logic | Mirror `bounded_loss` >=1 clamp (:3307) | Same invariant ("always survivors") |
| Population bookkeeping | Decrement a counter | Remove entities; `population` re-syncs at :2928 | Population is a MIRROR — load-bearing invariant from Phase 4 |
| Bindings types | Hand-write TS | `cargo run --bin export_bindings` (:bin/export_bindings.rs) | Headless specta regen; Windows-safe |

**Key insight:** Every mechanic this phase needs already exists in a colour/quantitative/disaster
form. GEN-01 is "do the colour thing again for pattern + add three more f32s"; GEN-02 is "add one
bounded term to a death roll that already exists." Inventing new machinery is the failure mode.

## Common Pitfalls

### Pitfall 1: Population is a mirror — never decrement, remove entities
**What goes wrong:** Adding selection deaths by subtracting from `population` desyncs the counter
from the actual entities.
**Why it happens:** `population` looks authoritative but is re-derived from living non-egg
entities at the END of `run_life_cycle` (:2927-2933).
**How to avoid:** Selection deaths push ids into the existing `deaths: Vec<String>` and the
existing `entities.retain(|e| !deaths.contains(&e.id))` (:2808-2810) handles removal; the mirror
re-syncs automatically. (Confirmed load-bearing in Phase 4 STATE notes.)
**Warning signs:** A test where `population` != count of living axolotl entities after a turn.

### Pitfall 2: Determinism — reuse the existing rng, don't reseed mid-loop
**What goes wrong:** A new `rand` source or a wall-clock/uuid breaks replay; two identical
`(seed, turn)` runs diverge.
**Why it happens:** Easy to reach for `rand::random()` or a fresh seed.
**How to avoid:** Use the `rng` already seeded at :2767 for mortality/mutation. If a *separate*
uncorrelated stream is wanted (like combat's `0xC0FF_EE01` salt), define ONE new distinct salt
const and seed once — never reseed per entity. Round any stored f32 with `round1`.
**Warning signs:** A determinism test (`serde_json::to_string(&a) == to_string(&b)` for cloned
runs) fails; or output depends on `HashMap` iteration order (sort first, as `plunder`/`kill_axolotls` do).

### Pitfall 3: Borrow conflict reading environment inside the entities loop
**What goes wrong:** `snapshot.environment` borrow conflicts with `&mut snapshot.world.entities`.
**Why it happens:** `run_life_cycle` mutably iterates entities while needing env.
**How to avoid:** Clone the (small) `CivEnvironment` into a local BEFORE the `&mut entities`
borrow (the fn already reads `health`/`morale` into locals at :2768-2769 for the same reason).
**Warning signs:** `cannot borrow snapshot as immutable because it is also borrowed as mutable`.

### Pitfall 4: bindings.ts back-compat — keep new fields `#[serde(default)]`
**What goes wrong:** A non-default new field becomes a REQUIRED TS field, breaking `npx tsc`
on the three `genes: {…}` literals in `tauriBrowserFallback.ts` (lines 231, 239, 626) and the
test file; and old saves fail to deserialize.
**Why it happens:** specta maps a plain Rust field to a required TS prop; `#[serde(default)]`
maps it to optional (`field?:`). [VERIFIED: `morph`/`stage` are `#[serde(default)] String` at
civilization.rs:363/367 and render as `morph?: string`/`stage?: string` in bindings.ts:337/339.]
**How to avoid:** Every new `CivGenes` field AND the new entity `pattern` field gets
`#[serde(default = "…")]` (or `#[serde(default)]`). Then: f32 fields render `name?: number | null`
(like `size_gene`, bindings.ts:387), String fields render `name?: string` — neither breaks the
existing TS literals. Run `npx tsc --noEmit` after regen to confirm.
**Warning signs:** tsc errors on object literals missing the new field; or `cargo test`
deserializing a v1/v2 fixture fails.

### Pitfall 5: Plague hook — a new disaster kind needs a live handler or it's cosmetic
**What goes wrong:** Adding `"plague"` to `disaster_kinds_for` but no `resolve_environment` arm /
`gene_mortality_modifier` branch → it fires, logs, and does nothing mechanical.
**Why it happens:** The disaster→modifier mapping (`tick_environment` :6053) silently drops
unknown kinds (`_ => None`), and `disaster_duration` defaults unknowns to 3 turns.
**How to avoid (two valid routes — Open Q1):**
- (A) **Reuse:** drive `disease_resistance` pressure off an EXISTING active disaster kind
  (e.g. treat `"drought"` or `"cold_snap"` lingering as disease-adjacent), or off low morale /
  winter. Zero changes to the disaster system. Lower risk.
- (B) **Add `"plague"`:** add it to a season's `disaster_kinds_for` list, add a
  `disaster_duration("plague")` arm, and make `gene_mortality_modifier` read it (no
  `resolve_environment` arm needed if its ONLY effect is the mortality term — but then it won't
  appear in `modifier_kind` mapping, which is fine since its effect lives in run_life_cycle).
  Add a forecast/log so it's announced (ENV-02 style) and "visible."
**Warning signs:** A `"plague"` disaster in `env.disasters` with no measurable mortality delta in
the selection test.

### Pitfall 6: Backend tests cannot RUN on Windows
**What goes wrong:** `cargo test` for the Tauri backend fails (WebView2 DLL loader blocks the
harness — CLAUDE.md #5).
**How to avoid:** Verify locally with `cargo check`, `cargo clippy … -D warnings`, and
`cargo test --no-run` (compiles tests, doesn't execute). Tests EXECUTE on CI
(`.github/workflows/tauri-app.yml`, Linux/macOS). Frontend: `npx tsc --noEmit` + vitest.
**Warning signs:** A test author assuming green locally; balance/"feel" claims that need a run.

## Code Examples

### Verified determinism idiom (reuse verbatim)
```rust
// Source: civilization.rs:2767 (run_life_cycle's existing rng seed)
let mut rng = snapshot.seed ^ snapshot.turn.wrapping_mul(0x9E37_79B9) ^ 0x5A5A_5A5A;
// rolls: rand_f(&mut rng) -> f32 in [0,1); rand_range(&mut rng, lo, hi); next_rng(&mut rng) % n
```

### Verified back-compat field shape
```rust
// Source: civilization.rs:362-364 (entity.morph) and 374-376 (size with a named default fn)
#[serde(default)]                 // String → optional `pattern?: string` in bindings.ts
pub pattern: String,
// in CivGenes, for f32 fields, prefer a named default so old saves get a sane mid value:
#[serde(default = "default_resistance")]  pub cold_resistance: f32,   // fn returns e.g. 0.5
```

### Verified strength aggregation entry point
```rust
// Source: civilization.rs:5251-5267 (civ_strength) — immutable &snapshot, civ_entities iterator
fn civ_strength(snapshot: &CivSessionSnapshot, civ_id: &str) -> f32 { /* … SEAM at :5265 … */ }
```

### Verified text-state visibility path
```ts
// Source: CivilizationGameCanvas.tsx:3450-3468 (renderSnapshotToText visible_entities)
visible_entities: snapshot.world.entities.map((entity) => ({
  id: entity.id, name: entity.name, kind: entity.kind, role: entity.role,
  morph: entity.morph,            // ← existing "visible" colour
  pattern: entity.pattern,        // ← ADD: same shape, new entity field (GEN-01 visible)
  stage: entity.stage, /* … */
}))
```

## Runtime State Inventory

> This is a code-extension phase, not a rename/migration. Included for completeness; the only
> "stored state" concern is snapshot back-compat (handled by `#[serde(default)]`).

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Saved `CivSessionSnapshot` JSON (v1/v2) with old `CivGenes` (no new fields) and entities without `pattern` | None — `#[serde(default)]` fills new gene fields + `pattern` on load (verified pattern: `morph`/`stage`/`size` all use defaults at :363-376). No data migration. |
| Live service config | None — no external service stores gene strings | None — verified by absence of any DB/service referencing genes (grep). |
| OS-registered state | None | None. |
| Secrets/env vars | None | None. |
| Build artifacts | `bindings.ts` (generated) becomes stale after adding fields; `tauriBrowserFallback.ts` TS literals reference `genes` objects | Regen `bindings.ts` (`cargo run --bin export_bindings`); the literals stay valid IF new fields are `#[serde(default)]` (optional) — else add fields to the 3 literals (Pitfall 4). |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Rust built-in `#[test]` (`#[cfg(test)] mod tests` in civilization.rs, ~line 6900+) |
| Config file | none — standard cargo test; the existing module has ~80+ tests |
| Quick run command | `cargo test --no-run` (compiles tests; Windows-safe — does NOT execute, CLAUDE.md #5) |
| Full suite command | `cargo test` (executes — CI only, `.github/workflows/tauri-app.yml`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GEN-01 | `cross_genes` pattern allele = one-from-each parent (Mendelian) | unit | `cargo test -p (tauri backend) cross_genes_pattern_mendelian` | ❌ Wave 0 (no genetics tests exist) |
| GEN-01 | `cross_genes` quantitative traits blend within clamp bounds | unit | `… cross_genes_traits_blend_clamped` | ❌ Wave 0 |
| GEN-01 | `cross_genes` deterministic for fixed `(seed)` rng stream | unit | `… cross_genes_deterministic` | ❌ Wave 0 |
| GEN-01 | `expressed_pattern`/`pattern_rank` dominance (dominant over recessive) | unit | `… expressed_pattern_dominance` | ❌ Wave 0 |
| GEN-01 | `expressed_morph` dominance still holds (regression) | unit | `… expressed_morph_dominance` | ❌ Wave 0 (also untested today) |
| GEN-01 | New gene fields back-compat: a v2 snapshot WITHOUT them deserializes | unit | `… genes_serde_default_backcompat` | ❌ Wave 0 |
| GEN-01 | Entity `pattern` set on hatch + breed (rides snapshot → text-state) | unit | `… hatch_sets_expressed_pattern` | ❌ Wave 0 |
| GEN-01 | `genes.strength` raises `civ_strength` (extend `civ_strength_monotonic`) | unit | `… civ_strength_monotonic` (extend) | ✅ exists :8485 |
| GEN-02 | `gene_mortality_modifier` monotonic: lower cold_resistance ⇒ higher under cold | unit | `… gene_mortality_monotonic_cold` | ❌ Wave 0 |
| GEN-02 | `gene_mortality_modifier` monotonic in disease under plague; 0.0 benign; clamped | unit | `… gene_mortality_bounds_and_disease` | ❌ Wave 0 |
| GEN-02 | Selection: mean `cold_resistance` RISES over N turns of sustained cold (deterministic) | integration | `… selection_raises_cold_resistance_over_run` | ❌ Wave 0 |
| GEN-02 | Selection never wipes a civ to 0 from mortality alone (>=1 survivor) | integration | `… selection_leaves_survivors` | ❌ Wave 0 |
| GEN-02 | `run_life_cycle` mortality deterministic for fixed `(seed, turn)` | integration | `… life_cycle_mortality_deterministic` | ❌ Wave 0 |
| ALL | IPC surface compiles + types check after field add | smoke | `cargo run --bin export_bindings` then `npx tsc --noEmit` | n/a (gate) |
| ALL | No new clippy warnings (pedantic + `-D warnings`) | smoke | `cargo clippy … -D warnings` | n/a (gate) |

### Sampling Rate
- **Per task commit:** `cargo check` + `cargo test --no-run` (Windows-safe compile gate) +
  `cargo clippy --all-features -- -D warnings` (zero NEW warnings).
- **Per wave merge:** add `cargo run --bin export_bindings` + `npx tsc --noEmit` whenever
  `CivGenes`/`CivEntity` changed; run `npm test` (vitest) if any TS touched.
- **Phase gate:** full `cargo test` GREEN on CI (Linux/macOS) before `/gsd-verify-work`;
  the multi-turn selection test is the GEN-02 "measurably evolve" proof.

### Wave 0 Gaps
- [ ] Genetics unit tests do NOT exist today (`cross_genes`/`expressed_morph`/`morph_rank` are
      untested) — establish them as the first genetics tests in the existing `mod tests`.
- [ ] A genes-bearing test axolotl helper: extend `give_civ_axolotls` (:8464, currently sets
      `genes: None` via `..Default::default()`) OR add `give_civ_axolotls_with_genes(…)` so the
      selection test starts from a population with a spread of `cold_resistance`/`disease_resistance`.
- [ ] A multi-turn driver: reuse `run_life_cycle` directly in a loop (or `tick_environment` +
      `run_life_cycle`) with `snapshot.environment.temperature` pinned cold / a plague disaster
      injected, asserting mean resistance at turn N > turn 0. Model determinism asserts on
      `civ_strength_monotonic` (:8485) and `resolve_attack_is_deterministic` (:8532).
- [ ] No new framework install — `#[test]` + `multi_civ_snapshot`/`test_snapshot`/`civ_id_for`
      scaffolding already exist.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single colour allele pair only | Add a parallel pattern pair (mirror dominance) | Phase 5 | Two independent Mendelian traits |
| Genes affect only stage/size + breeding | Genes also gate survival under environment | Phase 5 (GEN-02) | Real selection → measurable evolution |
| `civ_strength` had a TODO seam for genes | `genes.strength` term wired in | Phase 5 (closes Phase-4 handoff) | Strength reflects the gene pool |

**Deprecated/outdated:** none — this phase only adds. No removals.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `#[serde(default)]` on a NEW `f32` field renders `name?: number \| null` (optional) in specta-generated bindings, like existing `size_gene` | Pitfall 4 / Code Examples | If specta renders it required, the 3 `tauriBrowserFallback.ts` genes literals + test file break tsc → must add the fields there too (mitigation already documented). Low risk: verified for `String` (`morph?`) and f32 fields already show `\| null`. |
| A2 | Exact mortality coefficients / clamp ranges / comfort temp produce a *measurable* mean-resistance rise within a feasible turn count without instant collapse | Pattern 3 / Validation | Tuning risk — the selection test may need iteration on coefficients to show a clear, deterministic upward trend while keeping survivors. Mitigated by CONTEXT marking these as Claude's discretion + a survivor floor. |
| A3 | Cloning `CivEnvironment` per `run_life_cycle` call is cheap enough (called per-civ per-turn) | Pitfall 3 | Negligible — it's a tiny struct (a few scalars + a short `Vec<CivDisaster>`); pattern mirrors the existing `let modifiers = snapshot.modifiers.clone()` at :2696. |
| A4 | Reusing Phase-3 disaster machinery (no new `"plague"` kind) is acceptable to satisfy GEN-02's "plague" example | Open Q1 | CONTEXT explicitly allows either; "prefer reusing Phase 3 machinery." Adding `"plague"` is also fine if done with a live handler (Pitfall 5). Planner/Claude picks. |

## Open Questions

1. **Plague hook: reuse vs add `"plague"` kind?** (Claude's discretion per CONTEXT)
   - What we know: Phase 3 kinds are `cold_snap`/`storm`/`quake`/`drought`/`flood`/`landslide`/
     `predator_incursion` (civilization.rs:5900-5915); NO plague. The disaster→modifier mapping
     drops unknown kinds silently (:6053). `cold_snap` already exists for cold pressure.
   - What's unclear: whether to (A) drive disease pressure off an existing signal, or (B) add a
     forecastable `"plague"` kind with a live handler.
   - Recommendation: (B-lite) add `"plague"` to the autumn/winter `disaster_kinds_for` list +
     a `disaster_duration` arm + read it in `gene_mortality_modifier` (its mechanical effect is
     the mortality term, so no `resolve_environment` arm strictly required) + a forecast/log so
     it's announced. This makes "plague" first-class and visible (matches GEN-02's example) at
     low cost. (A) is the zero-risk fallback if the planner wants to avoid touching disasters.

2. **Strength aggregation: sum vs mean?**
   - What we know: existing `civ_strength` terms are sums (pop, tools, tech, owned). A `sum` of
     `genes.strength` scales with population (double-counts pop pressure); a `mean` is per-capita.
   - Recommendation: use a SUM with a small coefficient `K` (consistent with the other additive
     terms and the `civ_strength_monotonic` test's "more X ⇒ more strength" shape). Discretion.

3. **Does `random_genes`/`default_genes` need pattern values that aren't all-`plain`?**
   - What we know: `random_genes` (:5094) picks a colour carrier from `COMMON_MORPHS`. The
     founding colony should probably carry some pattern diversity so selection has variance to act on.
   - Recommendation: seed `pattern_a`/`pattern_b` from a `COMMON_PATTERNS` subset in `random_genes`
     (founders) and default to a recessive `"plain"` in `default_genes` (fallback). Discretion.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust toolchain | All backend work | ✓ | rustc 1.95.0 / cargo 1.95.0 | — |
| `cargo clippy` (pedantic) | Lint gate | ✓ (workspace lints in CLAUDE.md) | — | — |
| `cargo run --bin export_bindings` | Bindings regen (headless) | ✓ (src-tauri/src/bin/export_bindings.rs present) | — | `tauri dev` regen (needs WebView2 — avoid on Windows) |
| Node/npm + `npx tsc` | TS type-check gate after regen | ✓ (tauri-app/) | — | — |
| `cargo test` execution | Run unit/selection tests | ✗ on Windows (WebView2 DLL loader, CLAUDE.md #5) | — | CI (Linux/macOS, tauri-app.yml); locally `cargo test --no-run` |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** local test EXECUTION — use CI; verify locally with
`cargo test --no-run` + `cargo check` + `cargo clippy`.

## Security Domain

> `security_enforcement` not set in `.planning/config.json`. This phase has no auth, network,
> input-parsing, crypto, or external-data surface — it is internal deterministic simulation math
> over an already-trusted local snapshot. ASVS categories (V2/V3/V4/V5/V6) do not apply.
> The only integrity-adjacent property is **deterministic replay** (no wall-clock/uuid/RNG drift),
> which is covered under Pitfall 2 and the determinism tests.

## Sources

### Primary (HIGH confidence)
- `tauri-app/src-tauri/src/civilization.rs` — direct read of: `CivGenes` (:420-428), `CivEntity`
  (:348-400), `CivEnvironment`/`CivDisaster` (:491-523), `run_life_cycle` (:2763-2934),
  `resolve_environment` (:2669), `advance_civ_turn` turn order (:797-934), `tick_environment`
  (:6035-6100), `disaster_kinds_for`/`roll_forecast`/`disaster_duration` (:5900-6022),
  `advance_season`/`season_target_temp` (:5806-5850), `morph_rank`/`expressed_morph` (:5026-5048),
  `default_genes`/`random_genes`/`cross_genes`/`pick_allele` (:5083-5142), `make_axolotl` (:5145),
  `civ_strength` (:5251-5267), RNG helpers `seed_from`/`next_rng`/`rand_f`/`rand_range` (:4999-5023),
  `round1` (:5223), `should_collapse` (:1709), `bounded_loss`/`kill_axolotls` (:5283-5314),
  test scaffold `test_snapshot`/`multi_civ_snapshot`/`give_civ_axolotls`/`civ_id_for`
  (:6185/:7407/:8464/:1625), `civ_strength_monotonic` test (:8485).
- `tauri-app/src/bindings.ts` — `CivGenes` (:384-391), `CivEntity` (:322-364), `CivEnvironment`
  (:371-378), `CivDisaster` (:312-320) — verified f32→`number | null`, `#[serde(default)] String`→
  `name?: string`.
- `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx` — `renderSnapshotToText`
  (:3415-3494, morph at :3457), `render_game_to_text` wiring (:259/:305), `renderToText` (:621),
  `morphVariant`/sprite morph keying (:3135).
- `tauri-app/src/lib/tauriBrowserFallback.ts` — static `genes` literals (:231/:239/:626); NO
  breeding/cross_genes mirror (cosmetic-stub confirmed).
- `tauri-app/src-tauri/src/bin/export_bindings.rs` — headless bindings regen.
- `.planning/phases/05-w5-genetics-depth-selection/05-CONTEXT.md`, `.planning/REQUIREMENTS.md`,
  `.planning/STATE.md`, `.planning/config.json`, `CLAUDE.md`.
- Toolchain: `rustc 1.95.0` / `cargo 1.95.0` [VERIFIED in session].

### Secondary (MEDIUM confidence)
- None — no external sources needed; phase is fully in-repo.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all idioms read directly from source.
- Architecture: HIGH — all seams, the turn order, and env reachability verified by direct read.
- Pitfalls: HIGH — each pitfall traced to a specific line/invariant in the engine.
- Tuning (coefficients/ranges for GEN-02 measurability): MEDIUM — values are Claude's discretion
  and may need iteration to make the selection test show a clear deterministic trend (A2).

**Research date:** 2026-06-07
**Valid until:** 2026-07-07 (stable — internal engine code; only risk is unrelated refactors of
`civilization.rs` shifting line anchors, so verify anchors by symbol name, not line number).
