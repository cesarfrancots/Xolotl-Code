# Phase 5: W5 — Genetics Depth & Selection - Pattern Map

**Mapped:** 2026-06-07
**Files analyzed:** 3 (1 heavy backend, 1 TS render-map line, 1 generated artifact)
**Analogs found:** 3 / 3 (all in-repo; every mechanic already exists in a colour/quantitative/disaster form)

> Anchors below were re-verified by SYMBOL NAME against the live source (RESEARCH warned
> line numbers can drift). Verified line numbers as of this mapping are given; if they shift,
> grep the symbol. This is an additive, single-file backend phase + one TS render line + a
> bindings regen. No new deps, no new RNG, no new disaster system unless `"plague"` is added
> with a live handler.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `tauri-app/src-tauri/src/civilization.rs` — `CivGenes` +5 fields, entity `pattern` | model | transform | `CivGenes` (:420-428), entity `morph` (:362-364) | exact (same struct / same idiom) |
| ` ↳ pattern_rank` / `expressed_pattern` | utility | transform | `morph_rank` (:5026) / `expressed_morph` (:5042) | exact (parallel pair) |
| ` ↳ cross_genes` extension (pattern + 3 new f32) | service | transform | `cross_genes` (:5114-5142) + `pick_allele` (:5106) | exact (extend in place) |
| ` ↳ random_genes` / `default_genes` extension | service | transform | `random_genes` (:5094) / `default_genes` (:5083) | exact |
| ` ↳ gene_mortality_modifier` (NEW pure helper) | utility | transform | `civ_strength` (:5251, pure read) + `gene_mortality_modifier` has NO exact analog | role-match (genuinely new — pure math over genes+env) |
| ` ↳ selection death roll in run_life_cycle` | service | event-driven | elder-death roll (:2796) + deaths/retain (:2800-2810) + pop re-sync (:2927-2933) | exact (mirror the existing roll) |
| ` ↳ civ_strength` strength term at SEAM | service | CRUD | `civ_strength` (:5251-5267, SEAM comment :5265) | exact (one-line seam) |
| ` ↳ plague hook` (disaster machinery) | service | event-driven | `disaster_kinds_for` (:5900) + `disaster_duration` (:6013) + `tick_environment` modifier map (:6053) | role-match (Open Q1: reuse vs add) |
| ` ↳ #[cfg(test)] genetics tests + genes-bearing helper` | test | transform | `civ_strength_monotonic` (:8485) + `resolve_attack_is_deterministic` (:8532) + `give_civ_axolotls` (:8464) | exact (test scaffold exists) |
| `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx` | component | transform | `renderSnapshotToText` entity map (:3450-3468, `morph:` at :3457) | exact (add one line) |
| `tauri-app/src/bindings.ts` | config | — | REGEN via `export_bindings.rs` bin; current `CivGenes` (:384-391) / `CivEntity` (:322-364) | exact (additive regen, NOT hand-edited) |

---

## Pattern Assignments

### `CivGenes` struct + entity `pattern` field (model, transform)

**Analog:** `CivGenes` (civilization.rs:420-428) and entity `morph` (civilization.rs:362-364).

**Current struct to extend** (:420-428) — note it derives `Type` (→ bindings regen) and does
NOT currently use `#[serde(default)]` on its existing fields:
```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivGenes {
    pub allele_a: String,
    pub allele_b: String,
    pub size_gene: f32,
    pub fertility: f32,
    pub longevity: f32,
    pub vigor: f32,
}
```
Add 5 fields, ALL `#[serde(default = "…")]` (back-compat — Pitfall 4): `pattern_a`/`pattern_b`
(String), `strength`/`cold_resistance`/`disease_resistance` (f32). Mirror the named-default idiom
already used by the entity `size` field (`#[serde(default = "default_size")]` at :375, with
`fn default_size() -> f32 { 1.0 }` at :402-404) — add `fn default_resistance()`, `fn
default_strength()`, `fn default_pattern_allele()` the same way.

**Entity back-compat field shape** (:362-364, 374-376) — the exact template for the new
top-level entity `pattern: String`:
```rust
/// Expressed colour morph (e.g. "leucistic"). Empty for non-axolotls.
#[serde(default)]
pub morph: String,
```
Add immediately below `morph`:
```rust
/// Expressed pattern (e.g. "spotted"). Empty for non-axolotls. Mirrors `morph`.
#[serde(default)]
pub pattern: String,
```
> `#[serde(default)]` String → `pattern?: string` in bindings (verified: `morph?` at
> bindings.ts:337). f32 with default → `name?: number | null` (verified: `size_gene?` at
> bindings.ts:387). Neither breaks the 3 `genes: {…}` TS literals in
> `tauriBrowserFallback.ts` (:231, :239, :626) — they stay valid because the new fields are optional.

**Pattern allele consts** — add beside the colour const block (:28-46):
```rust
// Colour genetics (existing template):
const MORPHS: [&str; 12] = [ "leucistic", "wild", … "mystic" ];
const COMMON_MORPHS: [&str; 6] = ["leucistic", "wild", "gold", "axanthic", "copper", "albino"];
const RARE_MORPHS: [&str; 3] = ["gfp", "firefly", "mystic"];
```
Add a parallel `const PATTERNS` (+ optional `COMMON_PATTERNS`) here (e.g. `["plain","spotted","striped","marbled"]`).

---

### `pattern_rank` / `expressed_pattern` (utility, transform)

**Analog:** `morph_rank` (civilization.rs:5026-5040) + `expressed_morph` (:5042-5048).

**Dominance template to mirror exactly** (:5025-5048):
```rust
/// Higher = more dominant when an axolotl carries two different colour alleles.
fn morph_rank(morph: &str) -> u8 {
    match morph {
        "mystic" => 11, "wild" => 10, "gfp" | "firefly" => 9, "copper" => 8,
        "melanoid" => 7, "axanthic" => 6, "gold" => 5, "piebald" => 4,
        "blue" => 2, "albino" => 1,
        _ => 3, // leucistic + unknown
    }
}
fn expressed_morph(genes: &CivGenes) -> String {
    if morph_rank(&genes.allele_b) > morph_rank(&genes.allele_a) {
        genes.allele_b.clone()
    } else {
        genes.allele_a.clone()
    }
}
```
Add `fn pattern_rank(p: &str) -> u8` (pick a dominance order, e.g. `"plain"` recessive → low)
and `fn expressed_pattern(genes: &CivGenes) -> String` immediately below, SAME shape (compare
`pattern_b` rank vs `pattern_a` rank, clone the dominant). This is the GEN-01 "visible via
dominance" mechanism.

---

### `cross_genes` extension (service, transform)

**Analog:** `cross_genes` (civilization.rs:5114-5142) + `pick_allele` (:5106-5112).

**The one-from-each-parent idiom** (:5106-5112) — copy for a new `pick_pattern_allele`:
```rust
fn pick_allele<'a>(rng: &mut u32, genes: &'a CivGenes) -> &'a str {
    if next_rng(rng).is_multiple_of(2) {
        &genes.allele_a
    } else {
        &genes.allele_b
    }
}
```

**The colour alleles + mutation + quantitative-blend body to extend** (:5114-5142):
```rust
fn cross_genes(a: &CivGenes, b: &CivGenes, rng: &mut u32) -> CivGenes {
    let mut allele_a = pick_allele(rng, a).to_string();
    let mut allele_b = pick_allele(rng, b).to_string();
    // Mutation: ~7% chance to flip one allele, sometimes to a rare fantasy morph.
    if rand_f(rng) < 0.07 {
        let pool: &[&str] = if rand_f(rng) < 0.4 { &RARE_MORPHS } else { &MORPHS };
        let m = pool[(next_rng(rng) as usize) % pool.len()].to_string();
        if next_rng(rng).is_multiple_of(2) { allele_a = m; } else { allele_b = m; }
    }
    CivGenes {
        allele_a,
        allele_b,
        size_gene: ((a.size_gene + b.size_gene) / 2.0 + rand_range(rng, -0.08, 0.08))
            .clamp(0.7, 1.4),
        fertility: ((a.fertility + b.fertility) / 2.0 + rand_range(rng, -0.08, 0.08))
            .clamp(0.3, 1.0),
        longevity: ((a.longevity + b.longevity) / 2.0 + rand_range(rng, -0.08, 0.08))
            .clamp(0.8, 1.35),
        vigor: ((a.vigor + b.vigor) / 2.0 + rand_range(rng, -0.08, 0.08)).clamp(0.8, 1.25),
    }
}
```
**Extend additively** — add `pattern_a`/`pattern_b` via `pick_pattern_allele` (one-from-each,
optionally a small mutation-flip mirroring the colour block), and add the 3 new f32 traits using
the IDENTICAL `((x+y)/2.0 + rand_range(rng,-δ,δ)).clamp(lo,hi)` blend (clippy pedantic: the
existing code inlines it 4×; consider extracting a `blend(x,y,rng,lo,hi)` helper to avoid 7
repetitions). Suggested clamps: `cold_resistance`/`disease_resistance` → `0.0..1.0`,
`strength` → e.g. `0.5..1.6`.
> Every new f32 read on a parent (`a.cold_resistance`) is always present on the materialized
> struct — `#[serde(default = "…")]` fills it on load — so no `unwrap_or` is needed on the
> FIELD. The only `Option` is `entity.genes` (handled via `map_or` at :2779).

---

### `random_genes` / `default_genes` extension (service, transform)

**Analog:** `random_genes` (civilization.rs:5094-5104) + `default_genes` (:5083-5092).
```rust
fn default_genes() -> CivGenes {
    CivGenes { allele_a: "leucistic".to_string(), allele_b: "leucistic".to_string(),
        size_gene: 1.0, fertility: 0.7, longevity: 1.0, vigor: 1.0 }
}
fn random_genes(rng: &mut u32, primary: &str) -> CivGenes {
    let carrier = COMMON_MORPHS[(next_rng(rng) as usize) % COMMON_MORPHS.len()];
    CivGenes { allele_a: primary.to_string(), allele_b: carrier.to_string(),
        size_gene: rand_range(rng, 0.85, 1.18), fertility: rand_range(rng, 0.5, 0.95),
        longevity: rand_range(rng, 0.85, 1.2), vigor: rand_range(rng, 0.85, 1.15) }
}
```
Add the 5 new fields to both. Per RESEARCH Open Q3: `default_genes` → recessive `"plain"` +
mid resistances (e.g. 0.5); `random_genes` (founders) → pick patterns from `COMMON_PATTERNS`
(carrier via `next_rng % len`, same idiom as `carrier`) and `rand_range` the resistances so
the founding colony has VARIANCE for selection to act on (GEN-02 measurability).

---

### `gene_mortality_modifier` (NEW pure helper) + selection death roll (service, event-driven)

**Analog (pure-read shape):** `civ_strength` (:5251) — `&snapshot` immutable, returns f32.
**Analog (the death roll to mirror):** elder-death roll in `run_life_cycle` Section 1
(civilization.rs:2767, 2796) + the deaths/retain pattern (:2772, 2800-2810) + population
re-sync (:2927-2933).

**RNG seed (reuse verbatim — do NOT reseed per entity, Pitfall 2)** (:2767):
```rust
let mut rng = snapshot.seed ^ snapshot.turn.wrapping_mul(0x9E37_79B9) ^ 0x5A5A_5A5A;
```

**The existing elder-death roll to sit ALONGSIDE** (:2779, 2796):
```rust
let longevity = entity.genes.as_ref().map_or(1.0, |g| g.longevity);   // genes is Option — map_or
…
let elder_at = (ELDER_BASE_AGE * longevity) as u32;
if entity.stage == "elder" && entity.age > elder_at + 6 && rand_f(&mut rng) < 0.35 {
    deaths.push(entity.id.clone());
}
```

**The deaths → retain → population mirror invariant (DO NOT decrement, Pitfall 1)** (:2800-2810, 2927-2933):
```rust
if !deaths.is_empty() {
    snapshot.world.entities.retain(|e| !deaths.contains(&e.id));   // remove, not decrement
}
…
// 4) Population mirrors the living (non-egg) axolotls of this civ.
let pop = civ_entities(snapshot, civ_id)
    .filter(|e| e.kind == "axolotl" && e.stage != "egg").count() as u32;
if let Some(ci) = civ_index(snapshot, civ_id) { snapshot.civs[ci].population = pop; }
```

**Borrow-safety idiom for reading env inside the `&mut entities` loop (Pitfall 3)** — the fn
already reads scalars into locals at :2768-2769 before the mutable iterator; do the same:
```rust
let env = snapshot.environment.clone();   // small struct; mirrors `health`/`morale` locals at :2768
```

**New pure helper to add (no exact analog — model the env source on `CivEnvironment` :492-500
and `CivDisaster` :516-523):**
```rust
// CivEnvironment fields: season, turn_of_season, temperature: f32, water_level, disasters: Vec<CivDisaster>
// CivDisaster fields: id, kind: String, epicenter_x, radius, intensity: f32, remaining_turns
fn gene_mortality_modifier(g: &CivGenes, env: &CivEnvironment) -> f32 {
    let mut p = 0.0_f32;
    // cold pressure scales with temp below a comfort baseline AND a "cold_snap" disaster
    let cold = ((COMFORT_TEMP - env.temperature) / COMFORT_SPAN).clamp(0.0, 1.0)
        .max(if env.disasters.iter().any(|d| d.kind == "cold_snap") { 0.6 } else { 0.0 });
    p += cold * (1.0 - g.cold_resistance) * COLD_COEFF;
    // disease pressure from the plague hook (see plague section)
    let plague = if env.disasters.iter().any(|d| is_plague_kind(&d.kind)) { 1.0 } else { 0.0 };
    p += plague * (1.0 - g.disease_resistance) * DISEASE_COEFF;
    p.clamp(0.0, MORTALITY_CAP)   // bounded — no instant collapse
}
```
Apply it inside the entities loop after the elder roll, gated `entity.stage != "egg"`, pushing
into the SAME `deaths` vec; then enforce a >=1-survivor floor (mirror `bounded_loss` :5307-5313:
`if living <= 1 { return; }` / `count.min(living - 1)`) so selection alone never wipes the civ.
Reference temperatures: `season_target_temp` (:5806) gives summer 24 / autumn 14 / winter 4;
pick `COMFORT_TEMP`/`COMFORT_SPAN` against those. Round any stored f32 with `round1` (:5223).

**Where eggs hatch / lay set `morph` — also set `pattern`** (:2830, 2899):
```rust
entity.morph = expressed_morph(&genes);   // hatch (:2830) — add: entity.pattern = expressed_pattern(&genes);
…
morph: expressed_morph(&child),           // egg lay (:2899) — add: pattern: expressed_pattern(&child),
```
And in `make_axolotl` (:5159, 5170): `let morph = expressed_morph(&genes);` then the
`CivEntity { … morph, … }` literal (:5160-5182) — add `let pattern = expressed_pattern(&genes);`
and `pattern,` in the struct.

---

### `civ_strength` strength term at SEAM (service, CRUD)

**Analog:** `civ_strength` (civilization.rs:5251-5267), SEAM comment at :5265.
```rust
fn civ_strength(snapshot: &CivSessionSnapshot, civ_id: &str) -> f32 {
    let Some(ci) = civ_index(snapshot, civ_id) else { return 0.0; };
    let c = &snapshot.civs[ci];
    let pop = f64::from(c.population);
    let tools = f64::from(*c.resources.get("tools").unwrap_or(&0));
    let tech = c.techs.len() as f64;
    let owned = snapshot.world.regions.iter()
        .filter(|r| r.owner.as_deref() == Some(civ_id)).count() as f64;
    // Phase-5 SEAM: add a `genes.strength` term to this sum here only.
    round1((pop * 1.0 + tools * 0.2 + tech * 1.5 + owned * 2.0) as f32)
}
```
At the SEAM, aggregate `genes.strength` over LIVING (non-egg) axolotls — mirror the
`living_axolotl_count` filter (:5271-5275): `civ_entities(snapshot, civ_id).filter(|e| e.kind ==
"axolotl" && e.stage != "egg").filter_map(|e| e.genes.as_ref().map(|g| g.strength)).sum()`. Use a
SUM with a small `K` coefficient (Open Q2 — consistent with the additive shape the
`civ_strength_monotonic` test asserts). `&snapshot` is immutable + `civ_entities` is an immutable
iterator → borrow-safe. Wrap the final value through `round1` (already there).

---

### Plague hook (service, event-driven) — Open Q1, Claude's discretion

**Analog:** `disaster_kinds_for` (:5900-5915), `disaster_duration` (:6013-6022),
`tick_environment` modifier-map (:6053-6059).

Phase 3 kinds: `cold_snap`/`storm`/`quake`/`drought`/`flood`/`landslide`/`predator_incursion`
— NO plague. Unknown kinds are DROPPED silently by the modifier map (`_ => None` at :6058) and
`disaster_duration` defaults unknowns to 3 (`_ => 3` at :6019).

**Season-eligibility list to extend (:5900-5915):**
```rust
fn disaster_kinds_for(season: &str, temperature: f32) -> &'static [&'static str] {
    match season {
        "winter" => &["cold_snap", "storm", "quake"],
        "summer" => { if temperature >= 22.0 { &["drought","flood","storm","quake"] } else { &["flood","storm","quake"] } }
        "spring" => &["flood", "storm", "predator_incursion"],
        _ => &["storm", "quake", "drought", "landslide"],
    }
}
```
**Duration arm to extend (:6013-6022):**
```rust
fn disaster_duration(kind: &str) -> u32 {
    let raw = match kind {
        "drought" | "cold_snap" => 5, "flood" => 4, "predator_incursion" => 3,
        "quake" | "storm" => 2, _ => 3,
    };
    raw.clamp(1, 12)
}
```
**RESEARCH recommendation (B-lite, low cost):** add `"plague"` to an autumn/winter
`disaster_kinds_for` arm + a `disaster_duration("plague")` arm, and read it in
`gene_mortality_modifier` via `is_plague_kind`. Its mechanical effect IS the mortality term, so
NO `resolve_environment` arm and NO entry in the `modifier_kind` map (:6053) is strictly needed
(leaving it `_ => None` there is correct — it is NOT a morale/terrain modifier). A
forecast/log already announces it via the generic `tick_environment` "A {kind} struck" push_log
(:6073-6081), so it is "visible." Anti-pattern (Pitfall 5): adding `"plague"` to the kind list
WITHOUT the `gene_mortality_modifier` branch → it fires and does nothing.
**Fallback (route A, zero disaster-system change):** drive `disease_resistance` pressure off an
EXISTING active disaster kind (e.g. `cold_snap`/`drought`) or winter/low-morale instead.

---

### `#[cfg(test)]` genetics tests + genes-bearing helper (test, transform)

**Analog (determinism + monotonic shape):** `civ_strength_monotonic` (:8485-8529) and
`resolve_attack_is_deterministic` (:8532-8553).

**Monotonic test shape to mirror** (:8485-8499):
```rust
#[test]
fn civ_strength_monotonic() {
    let base = multi_civ_snapshot(2024, 2);
    let cid = civ_id_for(0);
    let ci = civ_index(&base, &cid).unwrap();
    let s0 = civ_strength(&base, &cid);
    assert_eq!(s0, civ_strength(&base, &cid));   // deterministic
    let mut s_pop = base.clone();
    s_pop.civs[ci].population += 5;
    assert!(civ_strength(&s_pop, &cid) > s0, "more population must raise strength");
    …
}
```
EXTEND this test with a "more `genes.strength` ⇒ more strength" assertion. Use the same shape
for `gene_mortality_monotonic_cold` / `expressed_pattern_dominance` / `cross_genes_*`.

**Determinism test shape (byte-identical JSON across clones)** (:8538-8552):
```rust
let mut ra = (a.seed ^ a.turn.wrapping_mul(0x9E37_79B9) ^ 0xC0FF_EE01).max(1);
…
assert_eq!(serde_json::to_string(&a.world.entities).unwrap(),
           serde_json::to_string(&b.world.entities).unwrap(),
           "entity casualties must be byte-identical across clones");
```
Use this for `cross_genes_deterministic`, `life_cycle_mortality_deterministic`, and the
`genes_serde_default_backcompat` test (deserialize a v2 fixture WITHOUT the new fields).

**Genes-bearing test helper (Wave 0 gap — extend or add a variant)** (:8464-8482):
```rust
fn give_civ_axolotls(s: &mut CivSessionSnapshot, civ_id: &str, n: u32) {
    for i in 0..n {
        s.world.entities.push(CivEntity {
            id: format!("axo-{civ_id}-test-{i}"),
            kind: "axolotl".to_string(), name: format!("Test Axolotl {i}"),
            x: 10 + i, y: 20, health: 80.0, mood: 70.0, role: "worker".to_string(),
            civ_id: Some(civ_id.to_string()), stage: "adult".to_string(),
            sex: if i % 2 == 0 { "f" } else { "m" }.to_string(), age: 10,
            ..Default::default()   // ← genes: None today
        });
    }
}
```
Add `give_civ_axolotls_with_genes(s, civ_id, n, …)` (or a param) that sets `genes: Some(CivGenes
{ …, cold_resistance: spread, disease_resistance: spread, .. })` so the selection test starts
with VARIANCE. Drive the multi-turn selection test by looping `tick_environment` +
`run_life_cycle` with `snapshot.environment.temperature` pinned cold (or a plague `CivDisaster`
injected into `env.disasters`), asserting mean `cold_resistance` at turn N > turn 0 (GEN-02
"measurably evolve" proof) AND a >=1 survivor floor. Scaffolding exists: `multi_civ_snapshot`
(:7407), `test_snapshot` (:6185), `civ_id_for` (:1625).
> Backend tests COMPILE on Windows (`cargo test --no-run`) but EXECUTE only on CI (Linux/macOS,
> `tauri-app.yml`) — CLAUDE.md #5 / Pitfall 6. Verify locally with `cargo check` + `cargo clippy
> --all-features -- -D warnings` (pedantic, zero NEW warnings) + `cargo test --no-run`.

---

### `CivilizationGameCanvas.tsx` — text-state visibility (component, transform)

**Analog:** `renderSnapshotToText` `visible_entities` map (CivilizationGameCanvas.tsx:3450-3468),
`morph:` at :3457.
```ts
visible_entities: snapshot.world.entities.map((entity) => {
  const livePlayer = possessedPlayer?.id === entity.id ? possessedPlayer.player : null;
  return {
    id: entity.id, name: entity.name, kind: entity.kind, role: entity.role,
    morph: entity.morph,        // ← existing "visible" colour at :3457
    stage: entity.stage, sex: entity.sex, age: entity.age,
    accessories: entity.accessories, /* … */
  };
}),
```
Add ONE line after `morph: entity.morph,`:
```ts
    pattern: entity.pattern,    // ← ADD: GEN-01 visible pattern (ARENA-01 text-state)
```
No other TS change needed for "visible" — the snapshot carries `pattern`; this map just echoes it.

---

### `bindings.ts` — REGENERATED, not hand-edited (config)

**Analog:** current `CivGenes` (bindings.ts:384-391) + `CivEntity` (:322-364) — the additive
shapes the regen will produce; regen flow = `export_bindings.rs` (Phase-4 precedent).
```ts
export type CivGenes = {
    allele_a: string, allele_b: string,
    size_gene: number | null, fertility: number | null,
    longevity: number | null, vigor: number | null,
};
// CivEntity has:  morph?: string,  stage?: string,  genes?: CivGenes | null,
```
**Do NOT hand-edit** (CLAUDE.md #1). Regen headlessly from `tauri-app/src-tauri`:
```
cargo run --bin export_bindings        # → ../src/bindings.ts (no WebView2; Windows-safe)
```
(`export_bindings.rs` calls `xolotl_lib::export_bindings("../src/bindings.ts")`.) After regen,
gate with `npx tsc --noEmit` from `tauri-app/`. Expected additive diff: `CivGenes` gains
`pattern_a?: string, pattern_b?: string, strength?: number | null, cold_resistance?: number |
null, disease_resistance?: number | null`; `CivEntity` gains `pattern?: string`. Because all are
optional, the 3 `genes: {…}` literals in `tauriBrowserFallback.ts` (:231, :239, :626) and the
test file stay valid (Pitfall 4).

---

## Shared Patterns

### Determinism (seed^turn RNG — reuse verbatim, never `rand`/uuid/wall-clock)
**Source:** `seed_from`/`next_rng`/`rand_f`/`rand_range` (civilization.rs:4999-5023); life-cycle
seed at :2767.
**Apply to:** every new roll (mortality, mutation, founder pattern). Pitfall 2.
```rust
let mut rng = snapshot.seed ^ snapshot.turn.wrapping_mul(0x9E37_79B9) ^ 0x5A5A_5A5A;  // :2767
// rand_f(&mut rng) -> f32 in [0,1) ; rand_range(&mut rng, lo, hi) ; next_rng(&mut rng) % n
```
If a SEPARATE uncorrelated stream is wanted, define ONE new distinct salt const (like combat's
`0xC0FF_EE01`) and seed once — never reseed per entity.

### Replay-clean floats (`round1`)
**Source:** `round1` (civilization.rs:5223-5225).
**Apply to:** any new f32 STORED in the snapshot that came from a float computation (the
`civ_strength` term, any new stored gene value). Already wraps `civ_strength` (:5266) and
`advance_season` temp (:5847).
```rust
fn round1(value: f32) -> f32 { (value * 10.0).round() / 10.0 }
```

### Back-compat (`#[serde(default = "…")]`)
**Source:** entity `size` (:375 + `default_size` :402), `morph`/`stage`/`sex` (:363/367/369).
**Apply to:** ALL new `CivGenes` fields + entity `pattern`. f32 → `name?: number | null`,
String → `name?: string` in bindings — keeps the 3 TS genes literals valid. Pitfall 4.

### Population is a mirror — remove entities, never decrement
**Source:** deaths/retain (:2800-2810) + pop re-sync (:2927-2933); combat precedent
`kill_axolotls` (:5283-5300, sorts ids for replay-order).
**Apply to:** the GEN-02 selection deaths (push into the existing `deaths: Vec<String>`).
Pitfall 1.

### Survivor floor (>=1 always survives)
**Source:** `bounded_loss` (:5307-5313).
**Apply to:** GEN-02 mortality (CONTEXT: "no instant population collapse; always survivors").
```rust
if living <= 1 { return 0; }
count.min(living.saturating_sub(1))
```

### Borrow-safety (read env into a local before the `&mut entities` loop)
**Source:** `run_life_cycle` reads `health`/`morale` into locals at :2768-2769 before iterating;
`resolve_environment` clones modifiers at :2696.
**Apply to:** `let env = snapshot.environment.clone();` before the GEN-02 loop. Pitfall 3.

---

## No Analog Found

| Piece | Role | Data Flow | Reason |
|-------|------|-----------|--------|
| `gene_mortality_modifier(genes, &CivEnvironment) -> f32` | utility | transform | No existing helper combines genes × env into a death probability. Build it pure (model the env read on `CivEnvironment` :492 / `CivDisaster` :516; the cold/disease branch structure is novel). Use RESEARCH Pattern 3 as the spec; unit-test for monotonicity + bounds. The PURE-READ contract mirrors `civ_strength`. |
| `is_plague_kind` predicate + `"plague"` disaster kind (route B) | service | event-driven | Phase 3 has no plague kind. If added, it has no existing `resolve_environment`/modifier arm by design (its effect lives in `gene_mortality_modifier`). Closest machinery analog = `disaster_kinds_for`/`disaster_duration`/`tick_environment` map, but the kind itself is new. |

## Metadata

**Analog search scope:** `tauri-app/src-tauri/src/civilization.rs` (model/service/util/test),
`tauri-app/src/components/civilization/CivilizationGameCanvas.tsx` (render map),
`tauri-app/src/bindings.ts` (generated types), `tauri-app/src/lib/tauriBrowserFallback.ts`
(genes literals, Pitfall 4), `tauri-app/src-tauri/src/bin/export_bindings.rs` (regen flow).
**Files scanned:** 5 (read), anchors re-verified by symbol name via grep.
**Pattern extraction date:** 2026-06-07
**Key caveat:** line numbers verified this session but `civilization.rs` is large/active — the
planner/implementer should re-grep symbols (`fn cross_genes`, `// Phase-5 SEAM`, `fn
civ_strength_monotonic`, `morph: entity.morph`) before editing, per RESEARCH "verify anchors by
symbol name, not line number."
