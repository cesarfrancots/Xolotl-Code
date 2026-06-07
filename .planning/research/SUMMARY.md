# Research Summary - Milestone v2.1 Living World and Economy

**Project:** xolotl Axolotl Civilization Simulation (Tauri + Rust + Phaser)
**Domain:** Turn-based deterministic multi-civ colony-sim, doubling as an AI agent arena
**Researched:** 2026-06-07
**Confidence:** HIGH (all five research files grounded in direct code reading of the v2.0 engine)

---

## Executive Summary

v2.1 is an additive milestone on a large working engine, not a greenfield build. The v2.0 codebase already ships entity-level possession, per-civ controller tagging, an intervention seam for human mutations, a quest-task system, renewable/finite resource mining with tool-tier gating, multi-biome terrain, and a full agent-arena bridge. v2.1 lays an economy layer on top of those primitives, widens the world, and wires the human-play surface across eight feature categories. The headline stack finding: almost nothing new is required. Hand-roll deterministic fBm on the existing integer RNG (no noise crate), build the shop UI from the already-present Tailwind/shadcn/radix/cmdk stack, and run Gemini art generation through the existing pipeline at build time. Net new third-party dependencies: zero.

The single hardest architectural decision is phase ordering. ARCHITECTURE proposed P1 possession -> P2 economy -> P3 shop -> P4 items/NPCs -> P5 chunked world -> P6 assets/UI. FEATURES called economy the critical-path first phase. The reconciled recommendation: possession comes first because it is cheap (one branch in advance_civ_turn + a control_mode field) and immediately makes the economy/shop human-testable. A human-testable economy is the earliest possible validation gate for the hardest balance work. The chunked world rewrite (highest-risk structural change) goes last so all content systems are stable before the ground shifts under them.

Two cross-cutting non-negotiables enforced as per-phase exit criteria: (1) human/agent parity -- every new human verb must be a CivDecisionAction arm and appear in render_game_to_text() before the phase closes; and (2) additive-only IPC and serde -- all new struct fields get serde(default), text-bridge keys are appended, byte-identical vitest legacy-key locks stay green. A determinism break or save-back-compat failure have zero tolerance.

---

## Key Findings

### Recommended Stack

Zero new runtime dependencies. The entire v2.1 feature set is buildable from what already exists in the repo:

- Procedural terrain: hand-rolled integer-lattice value-noise/fBm on the existing next_rng xorshift32, discretized to [0,1) like rand_f. No third-party noise crate (incompatible RNG seeding, risk of byte-divergence across CI OSes). The codebase already does this -- seabed_ripple is a hand-rolled sum-of-sines.
- Gemini art: the complete pipeline exists at output/civ-gen/gemini/ (gen.mjs + postprocess.py). Uses gemini-2.5-flash-image via Vertex express REST at ~0.02-0.04 USD/image, build-time only. v2.1 adds new job entries -- no pipeline code changes.
- Shop/inventory UI: Tailwind v4 + shadcn + radix-ui + lucide-react + cmdk are all in package.json. React DOM panel over the Phaser canvas is correct -- forms, scroll, search, a11y far cheaper in DOM than in canvas.

| Technology | Role | Decision |
|---|---|---|
| Inline integer-lattice fBm in civilization.rs | Organic terrain W10.6, caves W10.7 | Hand-rolled ~40 LOC; no new dep |
| Existing output/civ-gen/gemini/gen.mjs | Sprite generation (build-time) | Extend job files; no pipeline change |
| Tailwind/shadcn/radix/cmdk (already in repo) | Shop/inventory/possession UI | No new dep |
| HashMap<String,i32> currency ledger on CivCivilization | Economy layer | Mirrors existing resources idiom |

### Feature Categories

Must-have (v2.1 core):
- Currency layer + 5 distinct currencies + fixed-price selling + matching sinks
- Shop/store catalog (buffs / resources / buildings / items) with per-currency gating
- Civ-level possession -- control_mode field + advance_civ_turn LLM-bypass branch
- Resource/item taxonomy widening + 2-3 tier crafting cascade (~12 items total)
- Bridge parity for all new verbs (sell/buy/craft/civ-order/terraform)

Should-have (v2.1 polish): infinite/chunked world + prospecting; trader/quest-giver/fauna-handler NPCs; game-native UI restyle; Gemini-generated sprites
Defer to v2.2+: dynamic markets; tameable fauna ranching; branching NPC narrative; W10.7 caves

### The 5 Currencies

| # | Currency | Use (sole purpose) | Source (faucet) | Sink |
|---|---|---|---|---|
| 1 | Shells | Everyday goods: consumable buffs, basic tools, resource crates | Sell renewable surplus + tier-1 minerals + +2/turn stipend | Consumables expire; buy-price spreads; upward burn to Pearls |
| 2 | Pearls | Premium goods: buildings, permanent buffs, advanced tools | Sell deep minerals (ore/amber/glowshards -- tool-gated; no stipend) | Prefab buildings, permanent buffs; no downward conversion |
| 3 | Tidewardens Favor | NPC/faction-exclusive catalog (rank-gated, non-bankable) | NPC quests, ally diplomacy, protect-vulnerable policy | NPC vendor items only; decays to a soft ceiling |
| 4 | Spawn (Spore-tokens) | Crafting and upgrade recipes only -- closed loop with the workshop | Workshop processing (1 token per 10 raw resources) | Craft recipes, tech unlocks, building upgrades only |
| 5 | Ancient Amberglass | Late-game prestige: wonders, era leaps, legacy buffs | Reach canal_village era, survive disasters, combat wins | Wonders/prestige catalog; one big purchase per slow trickle |

Anti-inflation rules: buy-price always exceeds sell-price; no downward currency conversion; upward burn is punitive (100 Shells -> 1 Pearl); per-turn sell cap (40 units/civ); currency does NOT feed the score function; Favor is non-bankable (rank-gated not pile-gated).

### Architecture Approach

v2.1 is overwhelmingly additive fields + new dispatch arms + new catalog tables. The existing seams handle all new systems without forked code paths:

- Possession = one guard branch in advance_civ_turn (line 874) for control_mode != model
- Economy = currencies: HashMap<String,i32> on CivCivilization + sell_price() catalog fn
- Shop = new intervention kinds through apply_intervention_to_snapshot (line 3052) + shop_catalog() fn
- Crafting = craft() dispatch arm cloning the build/research pattern
- NPCs = new role values on kind:npc entities using the existing task/quest framework

The one genuinely structural change is the chunked world (Phase 5): generate_world splits into generate_chunk(seed, chunk_x) + a tile_at(world, x, y) lazy accessor; every direct tiles.iter().find() site goes through that accessor; the Phaser renderer must implement W8 chunked RenderTexture baking; tauriBrowserFallback.ts needs a bounded preview window.

Critical clarification on tauriBrowserFallback.ts: it is a mockIPC browser-preview with a hand-authored tiny PREVIEW_WORLD, NOT an engine clone. Lockstep means mock new IPC commands with believable canned shapes so the preview and vitest stay green. Do NOT port xorshift world-gen or economy math into TypeScript.

Major integration seams:
1. advance_civ_turn -- gains possession skip branch + economy/regrowth steps
2. CivCivilization -- gains currencies, items, control_mode (all serde(default))
3. apply_intervention_to_snapshot -- gains buy/sell/craft/place_block kinds
4. validate_action + apply_model_decision -- gain sell/shop_buy/craft/terraform/trade_npc arms
5. Catalog fns -- gain known_currency, sell_price, shop_catalog, item_def, craft_recipe
6. generate_world -> generate_chunk(seed, cx) + tile_at() accessor (Phase 5 only)
7. ShopPanel.tsx -- new React drawer in CivilizationView.tsx
8. render_game_to_text -- gains wallet, shop, catalog, NPC-in-range blocks

### Critical Pitfalls

1. **Infinite-world determinism break** -- Give chunk-gen its own salted sub-stream (seed XOR 0xC4A0_5EED XOR mix(cx,cy)). Make gen_chunk(seed, cx, cy) a stateless pure function. Unit test asserting order-independence before writing any chunk-dependent feature. Re-baseline determinism goldens deliberately.

2. **Save-file bloat + IPC payload collapse** -- Do NOT grow Vec<CivTile> unboundedly. Persist only diffs (sparse map of player-modified tiles; regenerate untouched terrain from seed). Decide diff-persistence model before writing terraform/place -- retrofitting is a rewrite.

3. **Economy imbalance: inflation / dead currencies / fixed-price exploit** -- Every currency needs a closed loop (distinct source AND distinct sink). Write a 200-turn greedy-miner sim-test asserting every currency bounded AND every currency spent. This is the economy phase exit gate.

4. **Possession desync -- LLM still running for a possessed civ** -- advance_civ_turn unconditionally calls call_model_text today. Possession must inject a backend branch; frontend-only possession is not sufficient. Post-loop world passes stay unconditional. Unit test: zero model calls for possessed civ.

5. **Arena bridge / agent-legibility gap** -- Bridge parity is a per-phase exit criterion. Every new human verb must have a civPilotControls command and appear in render_game_to_text() before the phase closes. Append-only text keys. Diff UI actions vs bridge verbs in a test.

6. **bindings.ts drift + non-defaulted serde fields** -- Every new struct field: serde(default). Schema shape changes: bump SCHEMA_VERSION + extend migrate_value_in_place. Regen bindings.ts via tauri dev after each new command; never hand-edit. Pre-v2.1 save load test per phase.

7. **Fallback misread as engine clone** -- tauriBrowserFallback.ts lockstep = IPC contract parity (mock new commands with believable canned shapes), NOT algorithm parity. Do not port chunk-gen or economy math into TypeScript.

---

## Implications for Roadmap

### Phasing Recommendation (reconciled from ARCHITECTURE + FEATURES)

ARCHITECTURE proposed: P1 possession -> P2 economy -> P3 shop -> P4 items/NPCs -> P5 chunked world -> P6 assets/UI.
FEATURES proposed: economy is the critical-path first phase (shop depends on it).

Reconciliation: Possession goes first because it is genuinely cheap (1-field + 1-branch, reuses all existing infrastructure) and its payoff is outsized -- it makes every subsequent phase immediately human-testable. Economy must be human-tested to validate balance, which requires possession. Items/NPCs before chunked world: items are content types distributed across the world in Phase 5; build content types first, populate them into chunks second. Chunked world last: highest structural risk; retrofitting chunked persistence around unstable content types would be expensive.

---

### Phase 1: True Human Takeover (Possession)
Rationale: Cheapest high-value unlock. Reuses set_civ_controller, possessedEntityId, focusCiv, and the existing intervention seam. Makes every subsequent feature human-testable during development.
Delivers: Human can possess a whole civ, issue CivDecisionAction-shaped orders, compete against AI civs; LLM never fires for possessed civ; control_mode visible in render_game_to_text().
Features: FEATURES section 5 -- civ-level LLM bypass, god/RTS coexistence, human-vs-AI turn loop, release control.
Avoids: Pitfall 4 (possession desync) -- backend branch is the core deliverable, not just a UI affordance.
Exit gate: unit test -- 0 model calls for possessed civ, combat/predator passes ran; civPilotControls.possess(civId) verb exists; possession state in text bridge.
Research flag: standard patterns -- skip phase research.

---

### Phase 2: Economy and Currency
Rationale: Foundational ledger. Shop, crafting, and NPC economics all spend/earn currencies. With possession live from Phase 1, balance tuning is immediately human-playable.
Delivers: currencies: HashMap<String,i32> on each civ; 5 currencies (Shells/Pearls/Favor/Spawn/Amberglass); sell action arm; sell_price() catalog; known_currency() gate; per-turn Shell stipend; 200-turn greedy-miner sim-test; wallet + shop.sell_prices in render_game_to_text().
Features: FEATURES section 3 -- currency layer, 5 currencies, fixed-price selling, anti-inflation sinks.
Avoids: Pitfall 3 (economy imbalance) -- sim-test is the exit gate; Pitfall 6 -- serde(default) on currencies.
Exit gate: 200-turn sim -- every currency bounded AND every currency spent; sell verb in both AI and human paths; pre-v2.1 save loads cleanly.
Research flag: ECONOMY.md has concrete price tables and rates -- use as implementation defaults, tune via sim-test. Skip phase research.

---

### Phase 3: Shop / Store + UI
Rationale: Primary human-facing currency sink and headline new surface. Depends on Phase 2 (currencies). Builds on existing building_cost/tech_cost/CivModifier patterns -- the shop is mostly a routing and pricing layer over mutations that already exist.
Delivers: ShopPanel.tsx drawer; shop_catalog() + shop_price() backend fns; buy intervention kind through apply_intervention_to_snapshot; shop_buy decision action arm for AI civs; insufficient-funds UI state; catalog in build_observation and render_game_to_text().
Features: FEATURES section 4 -- categorized catalog, progression gating, functional items, per-currency price display.
Avoids: Pitfall 11 (UI scope creep) -- vertical slice first; done defined by checklist: browse / see price / buy / sell / see balances / insufficient-funds state.
Exit gate: agent completes a buy via civPilotControls.buy(itemId) through text bridge at identical price to UI; vitest green.
Research flag: standard patterns -- skip phase research.

---

### Phase 4: Items, Crafting and NPC Interaction
Rationale: Items are shop SKUs and NPC rewards (needs Phase 2+3); crafting clones the build/research dispatch pattern; NPC roles extend the already-rich task framework. These three sub-systems share items: HashMap<String,i32> and are cohesive enough to land together.
Delivers: items: HashMap<String,i32> on CivCivilization; item_def()/craft_recipe() fns; craft action arm + intervention kind; new NPC roles (trader/quest-giver/fauna-handler) seeded near colonies; trade_npc/quest action arms; Spawn-token closed loop; Favor faucet from quests.
Features: FEATURES sections 2 (resource/item taxonomy, 2-3 tier cascade) and 6 (traders, quest-givers, fauna handlers).
Avoids: Pitfall 5 -- every NPC interaction has a bridge verb; Pitfall 6 -- items field serde(default).
Exit gate: agent can craft via text bridge; trader NPC accessible to both AI and human possession; pre-v2.1 save loads.
Research flag: standard patterns -- skip phase research.

---

### Phase 5: Infinite / Chunked Procedural World
Rationale: Highest-risk structural change. Placing this after Phases 1-4 means all content types are stable before the world changes shape. W10.7 caves go last (highest f32 determinism risk).
Delivers: generate_chunk(seed, cx) pure fn with salted sub-stream RNG; tile_at() lazy accessor; sparse diff-persistence (mined/placed tiles only); W8 chunked RenderTexture renderer; whole-world golden-hash test; terraform/place actions; prospecting strata_report; seeded POIs; fBm terrain.
Features: FEATURES section 1 -- chunked streaming, biome blending at seams, prospecting/discovery, landmarks/POIs, terraform/place.
Avoids: Pitfall 1 (RNG corruption); Pitfall 2 (save bloat); Pitfall 10 (chunk seams).
Exit gate: gen_chunk(s, 5, 0) identical regardless of explore order; 200-turn explored save under size budget; IPC payload < 512KB/turn; frame-time flat while exploring.
Research flag: NEEDS PHASE RESEARCH -- chunked determinism + sparse persistence + W8 RenderTexture chunking only partially spec-ed in civ-multi-civ-world-plan.md.

---

### Phase 6: Gemini Assets + Game-Native UI Restyle
Rationale: Presentation layer; depends on all new content keys existing. Parallelizable with Phase 5 but strictly after Phase 4 so item and NPC sprite sets are known. Restyle confined to CivilizationView.tsx -- zero engine or IPC changes.
Delivers: New Gemini-generated PNGs committed to tauri-app/public/civ/ (currency icons, item sprites, NPC characters, new tile types); game-themed CivilizationView.tsx restyle.
Features: FEATURES section 7 -- game-native HUD restyle, diegetic in-world markers, Gemini art replacing placeholder sprites.
Avoids: Pitfall 8 (Gemini cost/key/style); Pitfall 11 (scope creep -- restyle scoped to civilization/ components only).
Exit gate: game loads with GEMINI_API_KEY unset (placeholder fallback, no crash); no files outside civilization/ and public/civ/ touched; tsc --noEmit + vitest green.
Research flag: standard patterns -- skip phase research.

---

### Phase Ordering Rationale

- Possession first (not economy first): 1-field + 1-branch change; makes every subsequent phase human-testable. Economy balance requires human play to validate; possession enables that immediately.
- Economy before shop: universally agreed -- shop needs something to cost.
- Items/NPCs before chunked world: items are content types distributed across the world in Phase 5. Also items are shop SKUs -- must exist before the world distributes them.
- Chunked world late: highest structural risk; retrofitting chunked persistence around unstable content types would be expensive; content systems must be stable first.
- Assets/UI last and parallelizable: pure presentation; benefits from knowing all final content keys.

### Research Flags

Needs phase research:
- Phase 5 (Chunked World): tile_at lazy accessor, sparse diff-persistence format, W8 RenderTexture chunking, per-chunk determinism testing -- only partially spec-ed in civ-multi-civ-world-plan.md. Research the Phaser RenderTexture API for pooling/unloading and nail down the persistence schema before writing terraform code.

Standard patterns (skip phase research):
- Phase 1 (Possession): Pure additive field + branch; code path fully understood.
- Phase 2 (Economy): ECONOMY.md has concrete price tables, rates, and anti-exploit rules.
- Phase 3 (Shop): Established catalog fn + intervention seam pattern.
- Phase 4 (Items/Crafting/NPCs): Clones build/research + extends task framework.
- Phase 6 (Assets/UI): Pipeline exists; restyle scope bounded.

---

## Cross-Cutting Constraints

Per-phase exit criteria -- not one-time tasks.

| Constraint | Enforcement |
|---|---|
| Human/agent parity | Every new human verb = CivDecisionAction arm + civPilotControls command + block in render_game_to_text(). Enumerate both surfaces and diff in a test before phase close. |
| Determinism | No new draw on shared founder/vein rng. New world-gen uses salted per-chunk sub-streams. cargo check/clippy --pedantic/test --no-run on Windows; full tests on CI. |
| Additive IPC + serde | Every new struct field: serde(default). Schema shape changes: bump SCHEMA_VERSION + extend migrate_value_in_place. Pre-v2.1 save load test per phase. bindings.ts regen via tauri dev after every new command. |
| Arena bridge extend-only | Never rename/reorder existing render_game_to_text() keys. Append new sections. Byte-identical vitest legacy-key locks stay green. |
| Fallback = IPC mock only | tauriBrowserFallback.ts mocks new IPC commands with believable canned shapes. Never port engine RNG or economy math into TypeScript. Run npm test after every IPC surface change. |
| UI scope | Restyle confined to tauri-app/src/components/civilization/. Never touch harness chat/eval/settings screens. |

---

## Open Questions / Tuning Knobs

| Knob | Default | Tuning range | Risk if wrong |
|---|---|---|---|
| Shells/turn net (anchor) | ~10-15 | 5-25 | Too high -> buffs trivial; too low -> shop feels dead |
| Per-turn stipend | +2 shells | 0-5 | Too high -> no scarcity early |
| Ore->Pearl ratio | 2:1 | 1:1-4:1 | Sets premium-currency velocity |
| Spawn-token mint rate | 1 per 10 processed resources | 1:5-1:20 | Controls crafting-economy speed |
| Season price band | OFF (+-20% if enabled) | +-0-30% | ON -> less legible AI planning |
| Per-turn sell cap | 40 units/civ | 20-100 | Anti-dump; too low frustrates |
| Amberglass earn rate | Era milestones + disaster survival | -- | Too fast -> prestige loses weight |
| Upward-burn rates | 100:1 / 50:1 (punitive) | -- | Too cheap -> reintroduces fungibility |

Design decisions still open:
1. Does sell cost a worker-turn or is it free bookkeeping against the per-turn cap? (Recommended: free bookkeeping, capped.)
2. Is the shop ambient or does it require a physical Trading Post NPC? (Recommended: ambient for AI legibility; physical NPC optional for Favor-gated items.)
3. Do currencies persist across runs? (Recommended: Amberglass only, if the Ancestral Vault wonder is purchased.)
4. Do combat raids loot currency or only resources? (Recommended: resources only; keeps faucets clean.)
5. Browser preview scope for chunked world: bounded single starter-chunk vs multi-chunk mock in tauriBrowserFallback.ts?

---

## Confidence Assessment

| Area | Confidence | Notes |
|---|---|---|
| Stack | HIGH | All findings grounded in direct code reading; crate versions verified; Gemini pipeline verified |
| Features | MEDIUM-HIGH | Table-stakes features grounded in engine code; design patterns from game-design literature (MEDIUM) |
| Architecture | HIGH | Every seam cited with file + line number, read directly from civilization.rs, canvas, view, store, fallback |
| Pitfalls | HIGH on integration/determinism/back-compat; MEDIUM on balance | Integration pitfalls from code + two prior retrospectives |
| Economy design | MEDIUM-HIGH | Prices/rates are opinionated defaults grounded in actual resource set; validate via 200-turn sim-test |

Overall confidence: HIGH for architecture, integration constraints, and phasing; MEDIUM for balance constants (sim-test is the validation mechanism).

### Gaps to Address

- Economy balance constants: treat ECONOMY.md values as starting defaults; validate against the 200-turn sim-test before shipping Phase 2.
- Chunked world persistence schema: diff/sparse model is the right direction but the exact CivWorld struct shape is not fully resolved -- Phase 5 needs a research pass.
- f32 determinism for fBm (W10.6): integer-lattice discretization should be safe; must be verified with a cross-platform golden hash in CI before the terrain shape is locked.
- tauriBrowserFallback.ts scope for chunked world: decide bounded single-chunk preview vs multi-chunk mock before Phase 5 begins.

---

## Sources

### Primary (HIGH confidence -- direct code reading)
- tauri-app/src-tauri/src/civilization.rs -- next_rng/seed_from, seabed_ripple, advance_civ_turn, apply_intervention_to_snapshot, build_observation, validate_action, apply_model_decision, building_cost/tech_cost/known_resource, resources HashMap, controller/set_civ_controller, generate_world/seed_underground_veins, NPC task framework
- tauri-app/src/components/civilization/CivilizationGameCanvas.tsx -- possessedEntityId, renderSnapshotToText, bakeTerrain, asset preload + key tables
- tauri-app/src/components/civilization/CivilizationView.tsx -- civPilotControls, handlePlayerInteract, current HUD structure
- tauri-app/src/stores/civStore.ts -- applyIntervention, snapshot normalize
- tauri-app/src/lib/tauriBrowserFallback.ts -- mockIPC pattern, PREVIEW_WORLD, fallback contract
- tauri-app/src/lib/civPilot.ts -- text-state shape, render_game_to_text consumption, CivPilotDecision union
- output/civ-gen/gemini/{gen.mjs,postprocess.py,jobs-*.json} -- complete Gemini pipeline
- tauri-app/package.json -- confirmed Phaser 4.1, Zustand 5, Tailwind 4 + shadcn + radix + cmdk
- .planning/PROJECT.md -- v2.1 target features + guiding constraints

### Secondary (MEDIUM confidence -- game-design literature)
- Machinations.io -- game economy inflation, faucet/sink discipline
- Game Developer -- economy loops, crafting systems, diegetic vs non-diegetic UI
- Windrose faction design -- non-bankable rank-gated reputation currency
- arxiv 1412.6924 -- fixed vs flexible pricing in economic sims
- Minecraft Wiki -- chunked world generation patterns

---
*Research completed: 2026-06-07*
*Ready for roadmap: yes -- Phase 5 (chunked world) needs a brief research pass before requirements are written*
