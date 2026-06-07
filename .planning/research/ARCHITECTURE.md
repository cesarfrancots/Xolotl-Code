# Architecture Research — v2.1 "Living World & Economy" Integration Plan

**Domain:** Deterministic, seeded multi-civ simulation game (Tauri + Phaser frontend, Rust `civilization.rs` engine) that doubles as an agent arena.
**Researched:** 2026-06-07
**Confidence:** HIGH (grounded in the actual v2.0 code; every seam cited below was read in `civilization.rs`, `commands.rs`, `lib.rs`, the Phaser canvas, `CivilizationView.tsx`, `civStore.ts`, and `tauriBrowserFallback.ts`)

> **Framing.** This is a *subsequent-milestone integration plan*, not a greenfield architecture. The v2.0 engine is large (~10k-line `civilization.rs`) and already contains most of the substrate v2.1 needs: a per-turn LLM loop, a civ-scoped intervention path that humans already drive, finite-mineral mining-as-terraform, NPCs/objects/tasks, a cost-table catalog pattern, and a whole-world serialized snapshot. v2.1 is overwhelmingly **additive fields + new dispatch arms + new catalog tables**, plus one genuinely structural change (infinite/chunked world). The hard constraints: serde-default everything, regen `bindings.ts` from Rust, keep the arena bridge additive, keep `tauriBrowserFallback.ts` in lockstep, stay deterministic, and remember backend tests don't run on Windows.

---

## Standard Architecture (the existing engine, as the integration target)

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│  FRONTEND (tauri-app/src)                                                   │
│  ┌────────────────────────┐  ┌───────────────────┐  ┌──────────────────┐   │
│  │ CivilizationView.tsx   │  │ civStore.ts        │  │ Phaser Canvas    │   │
│  │ HUD/drawers/toolbelt   │  │ (Zustand) snapshot │  │ CivilizationGame │   │
│  │ + arena bridge         │←→│ + commands wrap    │←→│ Canvas.tsx       │   │
│  │ window.civPilotControls│  │ activeSnapshot     │  │ window.render_   │   │
│  └───────────┬────────────┘  └─────────┬─────────┘  │ game_to_text     │   │
│              │ commands.* (bindings.ts) │            │ window.civCamera │   │
│              │                          │            │ entity possession│   │
│  ┌───────────┴──────────────────────────┴───────┐   └────────┬─────────┘   │
│  │ tauriBrowserFallback.ts  (mockIPC — DUPLICATES backend mechanics)    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────────────┤
│  IPC  — #[tauri::command] #[specta::specta]  → auto-gen bindings.ts          │
│  create_civ_session · advance_civ_turn · apply_civ_intervention ·           │
│  load/list/delete_civ_session · set_civ_controller                          │
├──────────────────────────────────────────────────────────────────────────┤
│  BACKEND ENGINE (tauri-app/src-tauri/src/civilization.rs, ~10k lines)       │
│  CivSessionSnapshot{ world, civs:Vec<CivCivilization>, environment, .. }     │
│  advance_civ_turn (846): tick_environment → per-civ build_observation →      │
│    call_model_text → parse/apply_model_decision → combat/predators →         │
│    resolve_environment → rescore → save_snapshot                             │
│  apply_intervention_to_snapshot (3052): the HUMAN/observer mutation path     │
│  Catalog fns: known_resource(4500) building_cost(4226) tech_cost(4250)       │
│  World: generate_world(1206) — whole Vec<CivTile> of width*96, serialized    │
└──────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities (existing, with v2.1 load)

| Component | Owns today | v2.1 load |
|-----------|-----------|-----------|
| `advance_civ_turn` (`civilization.rs:846`) | per-turn LLM governance loop | add a **possession skip** before `call_model_text`; add economy/regrowth steps |
| `apply_model_decision` (`:2330`) + `validate_action` (`:2207`) | dispatch + validate `CivDecisionAction` | new arms: `sell`, `buy`, `craft`, `terraform`, `place_block`, NPC verbs |
| `apply_intervention_to_snapshot` (`:3052`) | **the human/agent mutation seam** (already civ-scoped via `civ_id`) | possessed-civ human decisions, shop buy/sell, item use route through here |
| `CivCivilization` (`:480`) | per-civ id/model/resources/techs/score | gains `currencies` map + `control_mode` + `items` (all `#[serde(default)]`) |
| `CivDecisionAction` (`:625`) | one model action | gains shop/craft/terraform fields (already extensible — `target`,`amount` exist) |
| catalog fns (`building_cost`,`tech_cost`,`known_resource`) | cost/validity source-of-truth | mirror as `shop_catalog()`, `sell_price()`, `item_def()`, `craft_recipe()` |
| `generate_world` (`:1206`) | builds whole `Vec<CivTile>` (width×96) | **structural change**: chunked/on-demand generation for "infinite" world |
| Phaser `bakeTerrain` (`Canvas.tsx:698`) | one `Image` per substrate tile | **must** become chunked RenderTextures (W8, never shipped) |
| `tauriBrowserFallback.ts` | mockIPC duplicate of world+intervention+task mechanics | mirror every new mechanic touched (lockstep tax) |

---

## The Six Net-New Systems (integration points, NEW vs MODIFIED, data flow, build order)

### 1. Civ-level possession (true human/agent takeover, bypassing the LLM)

**Key seam.** Two facts from the code drive the whole design:
1. The LLM is called at exactly one place per civ: `advance_civ_turn` line 881, `call_model_text(&model, …)`, inside `for civ_id in &turn_order` (`:874`). Everything downstream (`parse_model_decision` → `apply_model_decision`) is model-agnostic — it just consumes a `CivModelDecision`. So **possession = skip the call, supply the decision another way.**
2. Humans already mutate civ state through a *different* path: `apply_civ_intervention` → `apply_intervention_to_snapshot` (`:3052`), already civ-scoped via `intervention.civ_id` (`:3058`) and already handling `mine_tile`/`place_tile`/`harvest_resource`/`use_building`/`use_object`/`talk_entity` — the exact verbs `handlePlayerInteract` in `CivilizationView.tsx:683` emits.

**Integration design (recommended):**
- Add `#[serde(default)] pub control_mode: String` to `CivCivilization` (`:480`); values `"model"` (default = today's behavior), `"human"`, `"agent"`. Mirrors the frontend's existing entity-level `control_mode: codex|manual|released` vocabulary (`Canvas.tsx:148`) but at the **civ** level.
- In `advance_civ_turn`, guard the model call:
  ```rust
  if snapshot.civs[ci].control_mode == "model" {
      // existing path: build_observation → call_model_text → parse → apply_model_decision
  } else {
      // possessed: skip call_model_text. Human/agent already mutated state THIS turn
      // via apply_civ_intervention (sell/buy/build/gather verbs). Just run the same
      // post-decision bookkeeping: reset_activities, advance_era_if_ready, scoring.
  }
  ```
  Combat/predator/environment resolution stays identical for all civs — possession only removes the autonomous decision, the v2.0 design intent.
- **Feeding the same `apply_model_decision` path (optional, cleaner for agents):** add a thin command `submit_civ_decision(id, civ_id, decision: CivModelDecision)` that runs the same validation then `apply_model_decision(snapshot, civ_id, &decision, None)`. Lets a human UI OR an external agent author a structured turn through the identical dispatch + `validate_action` the LLM uses — no second code path to keep correct. Free-form per-action human verbs (toolbelt) keep using `apply_civ_intervention`.

**Frontend entity-possession ↔ whole-civ control.** Today possession is per-entity (`possessedEntityId`, `setPlayerControl`, `Canvas.tsx:571`) and the player drives *one axolotl*; the civ still runs on the model each turn. v2.1's "Game B" means: when a civ's `control_mode != "model"`, the model no longer decides for it — the human's per-entity actions (already persisted as interventions) ARE the civ's turn. Frontend change is small: a **"Take over this civ"** toggle in `CivilizationView.tsx` that (a) calls a new `set_civ_control_mode(id, civ_id, mode)`, (b) auto-possesses an axolotl of that civ (reuse `possessFirstAvailable`, `:650`), (c) suppresses the model decision server-side. `selectedCivId` (already in `civStore`, `:23`) is the natural civ handle.

**Save/serde + arena.** `control_mode` is `#[serde(default)]` → old saves load as `"model"` (zero behavior change). Arena bridge: extend `window.civPilotControls.start({civId, controller, control_mode})` (`CivilizationView.tsx:464`) — it already sets `selectedCivId` + tags `controller` via `set_civ_controller`; adding `control_mode` is purely additive (ARENA-02 extend-only). `render_game_to_text`/`renderSnapshotToText` (`Canvas.tsx:621/3418`) already emit per-civ + the possessed entity's `control_mode`; extend the per-civ block to include each civ's `control_mode` so an agent sees which civs are takeover-able.

**NEW:** `set_civ_control_mode` + (optional) `submit_civ_decision` commands; civ-takeover toggle UI. **MODIFIED:** `CivCivilization` (+field), `advance_civ_turn` (guard), `bindings.ts` (regen), `tauriBrowserFallback.ts` (mirror skip), `renderSnapshotToText`.

---

### 2. Economy + ≥5 currencies

**Where balances live.** Resources live **per-civ**: `CivCivilization.resources: HashMap<String,i32>` (`:510`), seeded in `initial_snapshot` (`:1084`). Currencies are a parallel ledger → put them **per-civ** the same way. Do **not** reuse the `resources` map (keeps "40 kelp" vs "40 shells" clean for UI, pricing, scoring).

**New struct/fields (all back-compat):**
- `#[serde(default)] pub currencies: HashMap<String,i32>` on `CivCivilization`. Five+ themed currencies as plain keys: `"shells"` (base), `"pearls"`, `"coral_coins"`, `"bog_beads"` (swamp/peat), `"glow_motes"` (deep/cave). Keep it a free-form map (matches the resources idiom + the project's "never a strict struct" rule) gated by a `known_currency()` fn (mirror of `known_resource`, `:4500`).
- Per-entity wallet is **not** recommended — entities are ephemeral (born/die in `run_life_cycle`); a per-axolotl wallet leaks currency on death. Keep currency on the civ ledger; "an axolotl sells kelp" credits the civ.

**Resource→currency selling hooks the turn loop via a new action.** Add `"sell"` to `CivDecisionAction` (reuse existing `resource` + `amount`; add `#[serde(default)] pub currency: Option<String>`). Dispatch in `apply_model_decision` (`:2346`) → a `sell()` fn mirroring `gather()`'s structure (`:2420`): debit `resources[resource]`, credit `currencies[currency]` at a fixed price from a new `sell_price(resource) -> HashMap<currency,i32>` catalog table (same shape/idiom as `building_cost`, `:4226`). Validate in `validate_action` (`:2207`) like the `gather`/`trade` arms. Sells run inside the deterministic per-civ loop → stay seeded/reproducible.

**Surfacing to AI civs (so they can transact).** `build_observation` (`:2070`) is the model's whole world-view. Add `"currencies": civ.currencies` and a static `"prices"` block (sell + shop prices); document `sell`/`buy` in `build_decision_prompt` (`:2145`, same place `gather`/`trade` are listed). This single change makes AI civs first-class economic actors — same JSON the human UI reads.

**Balancing.** Sources = mining/harvest (finite minerals as the scarce high-value sells; renewables as low-value steady income). Sinks = shop (system 3) + crafting (system 5). Document acquisition curves in `ECONOMY.md`/`PITFALLS.md`; the engine just needs the price tables.

**NEW:** `currencies` field, `known_currency`, `sell_price` table, `sell()` fn, `sell` action arm. **MODIFIED:** `CivCivilization`, `CivDecisionAction`, `validate_action`, `apply_model_decision`, `build_observation`, `build_decision_prompt`, `initial_snapshot` (seed starting `shells`), `bindings.ts`, `civStore.ts` `normalizeCiv` (+currencies), `tauriBrowserFallback.ts`.

---

### 3. Shop / store with full UI

**Source of truth = backend catalog, not the UI.** Follow the established pattern: `building_cost`/`tech_cost` are Rust fns returning `HashMap<String,i32>`, with `can_pay`/`pay` (`:4296`/`:4302`) gating purchases. The shop catalog must be a backend fn (`shop_catalog() -> Vec<ShopItem>`, priced in currencies) so AI civs and the human UI buy at identical prices and prices ride the snapshot/observation. The UI **renders** the catalog; it never owns prices.

**New IPC commands (buy/sell).** Two paths, mirroring the two existing human seams:
- **AI civs**: `buy`/`sell` as `CivDecisionAction` arms (turn-loop, deterministic) — recommended for parity.
- **Human takeover UI**: `civ_shop_purchase(id, civ_id, sku, qty)` routing through `apply_intervention_to_snapshot` with a new `"buy"` intervention kind — reuses the civ-scoped intervention plumbing (`:3058`) and the existing `applyIntervention` Zustand action (`civStore.ts:322`). Matching `civ_shop_sell` or `buy` with negative semantics.

**How purchases mutate state.** Validate `can_pay(currencies, price)` → `pay` currencies → grant the SKU effect:
- resource SKU → `civ.resources[res] += qty` (like `grant_resource`, `:3060`);
- building SKU → place a building entity (reuse `build`'s placement, `:2528`);
- buff SKU → push a `CivModifier` (reuse `modifier_from_intervention`, `:4139`);
- item SKU → `civ.items` (system 5).
Every effect already has an implementation to reuse — the shop is mostly a *pricing + routing* layer over existing mutations.

**Agent-legible.** Catalog → `build_observation` (the `prices` block above); `buy` verb → `build_decision_prompt`; `render_game_to_text` gets a compact shop summary so the arena agent can shop too.

**UI scope.** New `ShopPanel.tsx` drawer in `CivilizationView.tsx` (sibling to the existing observer/roster drawers), gated to show when a civ is in human takeover. Restyle under system 6.

**NEW:** `ShopItem` struct, `shop_catalog`/`shop_price` fns, `buy`/`sell` intervention kinds + (optionally) action arms, `civ_shop_purchase` command, `ShopPanel.tsx`. **MODIFIED:** `apply_intervention_to_snapshot`, `build_observation`, `build_decision_prompt`, `bindings.ts`, `civStore.ts`, `tauriBrowserFallback.ts`.

---

### 4. Infinite procedural world (W10.3–W10.7 + chunking)

**This is the one structurally hard change.** Today the world is fully materialized: `generate_world` (`:1206`) builds `Vec<CivTile>` of `width(civ_count) × 96` (max width 512 → ~49k tiles), the whole thing serialized into the snapshot string across IPC and into the save (`save_snapshot`), and the renderer adds **one `Image` per substrate tile** (`bakeTerrain`, `:698`). None of that survives "infinite."

**Recommended approach — fixed-height, horizontally-chunked, on-demand columns ("explorable/expandable", not literally infinite).** PROJECT.md's requirement is "procedurally-generated, explorable/expandable terrain," not literal infinity. The pragmatic, deterministic design:
- Keep `WORLD_HEIGHT` fixed at 96 (the whole mining/`seabed_row_at`/`floor_y_at` machinery depends on it — `:1191`, `:6175`).
- Change the model from "all tiles always present" to **chunk columns generated on demand and cached**. Two viable storage models:
  - **(A) Sparse persisted tiles:** store only *visited/mutated* tiles (mined, placed, resourced); regenerate untouched chunks deterministically from `(seed, chunk_x)` on read. Save size bounded by play activity, not world size — matches the W10.1 determinism discipline (vein seeding is a pure fn of `seed` + position).
  - **(B) Bounded sliding window:** keep the materialized `Vec<CivTile>` but append chunks when a civ explores past the edge (`explore` exists, `:2240`), capped. Simpler; save grows with explored area.
  Recommend **(A)** for save-size sanity, but it's a real refactor: `generate_world` splits into `generate_chunk(seed, chunk_x)`; the many `tiles.iter().find(|t| t.x==x && t.y==y)` lookups (in `gather`/`mine_tile`/`place_tile`) go through a `tile_at(world, x, y)` accessor that lazily materializes the chunk. **Determinism caveat (W10.6 fBm):** keep f32 terrain noise off the hot path and re-baseline determinism goldens cross-platform (CI serializes tiles on Linux/Win/macOS).
- **Renderer:** finally implement the never-shipped **W8 chunked RenderTextures** (`civ-multi-civ-world-plan.md` §W8): 32×32-tile chunks, bake each to a `Phaser.GameObjects.RenderTexture` once, add/remove by `cameras.main.worldView` (+1 margin). `rebuildWorld`/`bakeTerrain` (`Canvas.tsx:675/698`) and `terrainSignature` (`:3147`) are the touch points; the `bakeSig` cache already exists to gate rebakes.

**Reconciling with `tauriBrowserFallback.ts`.** The fallback materializes `previewCivSession.world.tiles` and iterates them (`:803`, `:819`, `:844`). If the backend goes sparse/chunked, the fallback must mirror the same `tile_at` lazy-materialize or keep a bounded preview window. This is the heaviest lockstep cost in v2.1 — budget for it explicitly, or scope browser preview to a single fixed starter-chunk (acceptable — browser mode is a marketing preview, not the product).

**Seeding more content throughout.** `seed_underground_veins` (`:1344`) and the resource-belt loop (`:1261`) already populate substrate after founders; per-chunk generation extends them per chunk. Prospecting/caves (W10.5/W10.7) layer on once chunks exist.

**NEW:** `generate_chunk`, `tile_at` accessor, chunk cache, chunked RenderTexture renderer. **MODIFIED:** `generate_world`, every direct `tiles.iter().find`/`position` site, `CivWorld` (maybe `chunks` alongside/instead of `tiles`), determinism tests, `Canvas.tsx` baking, `tauriBrowserFallback.ts`. **Highest-risk; do after economy/shop so it doesn't block playable value.**

---

### 5. Items / crafting + NPC interaction

**Items.** Add `#[serde(default)] pub items: HashMap<String,i32>` to `CivCivilization` (civ inventory, same idiom as resources/currencies). Item definitions = a catalog fn `item_def(item) -> ItemDef { effect, tier }` (like `building_cost`). Items are bought (system 3), crafted, or NPC-rewarded.

**Crafting.** New `"craft"` action arm + intervention kind. `craft_recipe(item) -> HashMap<resource,i32>` table (mirror `tech_cost`). Dispatch validates `can_pay(resources, recipe)`, `pay`, then `items[item] += 1`. A direct clone of the build/research pattern (`:2528`, validate+can_pay+pay+grant). Tool tiers already exist (`mining_tier`/`required_mining_tier` from W10.2) — items can raise effective tier or buff `forage_yield`/`strength` via `CivModifier`.

**NPC interaction (extend, don't invent).** NPCs already exist as `CivEntity{ kind:"npc" }` with a task system encoded in log-entry markers (`parse_player_task`, `:4798`; `active_player_task`, `:4830`) and verbs `talk_entity`/`use_object`/`repair_object`/`rescue_object` in `apply_intervention_to_snapshot` (`:3551`+). v2.1 extends this:
- New NPC roles (trader → opens shop / gives currency; quest-giver → grants items; fauna-handler) as `role` values on `kind:"npc"` entities, seeded per chunk near colonies (the NPC-seeding code around `:6740`–`:7012` is the template).
- New action types so **AI civs** (not just humans) interact: e.g. `"trade_npc"` (sell to a trader for currency), `"quest"` (accept/complete). Validate + dispatch identically to existing arms; surface NPC presence in `build_observation`.

**NEW:** `items` field, `item_def`/`craft_recipe` tables, `craft` action+intervention, new NPC roles + `trade_npc`/`quest` actions. **MODIFIED:** `CivCivilization`, `CivDecisionAction`, `validate_action`, `apply_model_decision`, `apply_intervention_to_snapshot`, NPC seeding, `build_observation`/`prompt`, bindings, civStore normalize, fallback. **Depends on economy (currencies) + world (NPCs placed in chunks).**

---

### 6. Gemini assets + game-native UI

**Assets land exactly where the current PNGs do.** The renderer loads from Vite `public/`: `preload()` (`Canvas.tsx:464`) pulls `/civ/tiles/<key>.png`, `/civ/resources/<key>.png`, `/civ/buildings/<key>.png`, `/civ/accessories/acc-<name>.png`, and the spritesheet `/civ/axolotl-animated-seeds.png`, keyed by the `TERRAIN_TILES`/`RESOURCE_KEYS`/`BUILDING_KEYS`/`MORPHS`/`ACCESSORIES` tables (`:69`–`:87`). **No Gemini client exists in the repo** (only mentioned in PROJECT.md). So Gemini integration is an **offline generation script** (sibling to the existing `output/civ-gen/gen_assets.py`) that calls the Gemini image API with `GEMINI_API_KEY` and writes PNGs into those same `public/civ/...` folders. The runtime renderer is untouched except adding keys for new tiles/resources/items/NPCs/currency icons. Keep it offline (build-time), not a runtime IPC call — preserves determinism and avoids a network dependency in the hot loop.

**Game-native UI restyle scope.** Confined to `CivilizationView.tsx` (~2.4k lines — the HUD/drawers/toolbelt shell) and its CSS. The Phaser canvas already reads as a game; the harness-app chrome is the React HUD layer. Scope: restyle the creation card, leaderboard, observer tools, roster, the new ShopPanel, currency/inventory readouts, and the takeover controls into a cohesive game skin. Presentation-only — no engine or IPC change — so it can land last/in parallel.

**NEW:** `output/civ-gen/gen_gemini_assets.py`, new PNGs, new texture keys. **MODIFIED:** `Canvas.tsx` key tables + `preload`, `CivilizationView.tsx` styling, `tauriBrowserFallback.ts` only if it references asset keys.

---

## Data Flow

### Turn flow with v2.1 additions (model civ vs possessed civ)

```
advanceTurn() [civStore.ts:296] → commands.advanceCivTurn(id) [IPC]
  → advance_civ_turn [civilization.rs:846]
      tick_environment
      for civ in turn_order:
        if control_mode == "model":  build_observation(+currencies,+prices) → call_model_text
                                      → parse_model_decision → apply_model_decision
                                          (gather|build|...|SELL|BUY|CRAFT|TRADE_NPC)   ← NEW arms
        else (possessed):            SKIP call_model_text; human/agent already mutated      ← NEW
                                      state via apply_civ_intervention this turn
      resolve_combat / step_predators / resolve_environment / rescore / save_snapshot
  → snapshot string → parseCivSnapshot → activeSnapshot → Phaser re-render (chunked)
```

### Human takeover action flow (reuses the existing intervention seam)

```
Toolbelt/Shop click [CivilizationView.tsx] → applyIntervention(...) [civStore.ts:322]
  → commands.applyCivIntervention(id, {kind:"buy"|"sell"|"craft"|"mine_tile"..., civ_id})
  → apply_intervention_to_snapshot [civilization.rs:3052]  (civ-scoped, validates, mutates)
  → snapshot back → store → render
```

### State management (unchanged shape, additive fields)

`CivSessionSnapshot` stays the single serialized source of truth crossing IPC as a String — so most backend struct changes need **no bindings regen** until a command signature or a `.typ`-registered struct field changes. But `CivCivilization`/`CivDecisionAction`/`CivEnvironment` ARE `.typ`-registered in `lib.rs:118+`, so adding fields to them **does** require a `tauri dev` regen + `civStore.ts` `normalize*` updates.

---

## Build Order (dependency-honoring → maps to phases)

| Order | System | Why here / depends on |
|-------|--------|----------------------|
| **P1** | **Civ possession + takeover** | Pure additive (`control_mode` field + one `advance_civ_turn` guard + reuse of existing intervention path). Unlocks "Game B" and gives every later human feature a place to live. No deps. |
| **P2** | **Economy + currencies** | Foundational ledger every later system spends/earns. No structural deps; must precede shop/crafting. |
| **P3** | **Shop / store + UI** | Spends currencies (needs P2); buys resources/buildings/buffs/items (reuses existing mutation code). |
| **P4** | **Items + crafting + NPC roles** | Items are shop SKUs / NPC rewards (needs P2+P3); crafting clones build/research; trader NPCs need the economy. |
| **P5** | **Infinite/chunked world** | Highest-risk structural refactor (touches every tile-lookup site + renderer + fallback + determinism goldens). Content systems (P2–P4) should be stable first; "world before items-in-world" holds because P4 defines item/NPC *types* while P5 distributes them across chunks. Do W10.6 fBm last (cross-platform f32 determinism risk). |
| **P6** | **Gemini assets + game-native UI restyle** | Presentation-only; depends on all new content keys (tiles/resources/items/NPCs/currencies) existing so it can generate art for them. Can overlap P5. |

Cross-cutting per phase: regen `bindings.ts` whenever a `.typ` struct/command changes; mirror touched mechanics in `tauriBrowserFallback.ts`; extend (never replace) `render_game_to_text` + `civPilotControls`; verify with `cargo check`/`clippy`/`test --no-run` (Windows) + `tsc`/vitest.

---

## Anti-Patterns (specific to this codebase)

### Modeling new state as strict structs / abandoning the resources-map idiom
**What people do:** add a typed `Currencies{ shells:i32, pearls:i32 }` struct. **Why wrong:** breaks the free-form-map convention, makes a 6th currency a schema migration, and risks the "strict struct drops unknown keys" failure mode the project explicitly warns about. **Instead:** `HashMap<String,i32>` + a `known_currency()` gate, exactly like `resources` + `known_resource`.

### Adding a second human-action code path
**What people do:** write fresh buy/sell/possession mutation logic. **Why wrong:** `apply_intervention_to_snapshot` is already the civ-scoped human seam wired to `civStore.applyIntervention` and already handles mine/place/harvest/use/talk. **Instead:** add new `kind`s to it; the frontend `applyIntervention` plumbing is free.

### Forgetting the fallback / arena lockstep
**What people do:** ship a backend mechanic without mirroring it. **Why wrong:** `tauriBrowserFallback.ts` silently diverges (browser preview breaks), and a non-additive `render_game_to_text` change breaks the arena (`codex-play-civ.mjs`). **Instead:** every backend mechanic the browser preview exercises gets a fallback mirror; arena emitters are extended, never reshaped.

### Materializing an "infinite" world eagerly
**What people do:** just bump `world_width` higher. **Why wrong:** the whole `Vec<CivTile>` is serialized into every snapshot/IPC string/save and the renderer makes one Image per tile — both blow up superlinearly. **Instead:** chunked on-demand generation + sparse persistence + chunked RenderTextures (the unshipped W8 plan).

### Perturbing the founder RNG sequence
**What people do:** insert new seeded generation before founders. **Why wrong:** the determinism goldens lock the founder RNG sequence; W10.1 already had to seed veins *after* `found_colony` to preserve it. **Instead:** any new per-chunk/world generation consumes RNG strictly after founders, and re-baseline goldens deliberately.

## Integration Points

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Frontend ↔ engine | Tauri IPC, snapshot as serialized String | Adding `.typ` struct fields/new commands → regen `bindings.ts` via one `tauri dev`; update `civStore.ts` `normalize*` |
| Human UI ↔ engine | `apply_civ_intervention` (civ-scoped) | The established mutation seam; add `kind`s, don't fork |
| AI civ ↔ engine | `advance_civ_turn` → `apply_model_decision` | Add action arms + `validate_action` arms + prompt lines together (lockstep) |
| Arena agent ↔ game | `render_game_to_text`, `civPilotControls`, `civCamera` (window globals) | Extend additively only (ARENA-02) |
| Browser preview ↔ everything | `tauriBrowserFallback.ts` mockIPC | Mirror every touched mechanic |
| Gemini ↔ assets | offline Python script → `public/civ/...` PNGs | Build-time, not runtime; keep determinism |

## Sources

- `tauri-app/src-tauri/src/civilization.rs` — structs (`:300`–`:661`), `advance_civ_turn` (`:846`), `call_model_text` (`:1006`), `build_observation` (`:2070`), `build_decision_prompt` (`:2145`), `validate_action` (`:2207`), `apply_model_decision` (`:2330`), `gather` (`:2420`), `apply_intervention_to_snapshot` (`:3052`), catalog fns (`:4226`/`:4250`/`:4500`), `generate_world` (`:1206`), `seed_underground_veins` (`:1344`), NPC/task (`:4798`/`:4830`, `:6740`+)
- `tauri-app/src-tauri/src/commands.rs` — IPC command idiom; civ commands actually live in `civilization.rs` (`:709`–`:842`)
- `tauri-app/src-tauri/src/lib.rs` — `collect_commands!` + `.typ::<…>()` registration (`:54`, `:110`+, `:156`+)
- `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx` — possession (`:571`), `renderToText`/`renderSnapshotToText` (`:621`/`:3418`), `civCamera` (`:2991`), `bakeTerrain` (`:698`), asset preload + key tables (`:69`–`:87`, `:464`)
- `tauri-app/src/components/civilization/CivilizationView.tsx` — `civPilotControls` (`:464`), `handlePlayerInteract` → `applyIntervention` (`:683`), takeover/toolbelt
- `tauri-app/src/stores/civStore.ts` — snapshot normalize + command wrappers (`:87`, `:246`–`:345`)
- `tauri-app/src/lib/tauriBrowserFallback.ts` — duplicated intervention/world/task mechanics (`:784`–`:879`, `:1245`)
- `.planning/PROJECT.md` (v2.1 target features), `civ-multi-civ-world-plan.md` (W8 chunking + W10.3–W10.7 spec)

---
*Architecture research for: v2.1 Living World & Economy integration onto the v2.0 civ engine*
*Researched: 2026-06-07*
