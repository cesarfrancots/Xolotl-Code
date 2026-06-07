# Roadmap: xolotl

**Granularity:** standard
**Mode:** yolo
**Core Value:** A developer can spawn, monitor, and coordinate multiple AI agents working in parallel on a single project — from a chat-first desktop app — without being locked into OpenAI or Anthropic.

---

## Milestones

- ✅ **v1.0 Orchestration MVP** — Phases 1-6 (shipped 2026-06-06; full detail archived to `.planning/milestones/v1.0-phases/` and `.planning/milestones/v1.0-ROADMAP.md`)
- ✅ **v2.0 Civ Simulation** — Phases 1-5 (shipped 2026-06-07; live UAT pending; full detail archived to `.planning/milestones/v2.0-ROADMAP.md` and `.planning/milestones/v2.0-phases/`)
- 🚧 **v2.1 Living World & Economy** — Phases 1-6 (active)

> **Phase numbering note:** v2.1 uses **reset numbering** — it starts at Phase 1, not Phase 6. Each milestone's phases are self-contained; v1.0 (Phases 1-6) and v2.0 (Phases 1-5) are archived. The headings below under "🚧 v2.1" are the live phases.

---

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked INSERTED), appearing between their surrounding integers in numeric order.

### 🚧 v2.1 Living World & Economy (active)

- [ ] **Phase 1: Human Takeover (Possession)** — A user (or agent) can possess a whole civ and play it directly; the LLM never fires for a possessed civ. Cheap, high-value unlock that makes every later phase human-testable.
- [ ] **Phase 2: Economy & Currency** — Each civ holds ≥5 distinct currencies and sells resources at fixed prices; a 200-turn greedy-miner sim proves every currency stays bounded AND is spent.
- [ ] **Phase 3: Shop / Store + UI** — A game-native store drawer where humans browse a gated catalog and buy with currency; AI and agents buy at the identical price through the bridge.
- [ ] **Phase 4: Items, Crafting & NPCs** — Widened item taxonomy + a 2-3 tier crafting cascade (Spawn-token loop) + interactable trader/quest-giver/fauna-handler NPCs (Favor faucet).
- [ ] **Phase 5: Infinite / Chunked Procedural World** — Deterministic chunked terrain gen + sparse diff-persistence + chunked RenderTexture rendering, with prospecting and terraform. **[NEEDS RESEARCH]**
- [ ] **Phase 6: Assets & Game-native UI** — Gemini-generated art for currencies/items/NPCs/tiles + a game-native HUD restyle of the Civ surface (with graceful no-key fallback).

<details>
<summary>✅ v2.0 Civ Simulation (Phases 1-5) — SHIPPED 2026-06-07 (live UAT pending)</summary>

- [x] **Phase 1: W9-lite — Multi-Model World Creation + Leaderboard** *(complete 2026-06-06)*
- [x] **Phase 2: W8 — Renderer Multi-Civ Identity** *(complete 2026-06-06)*
- [x] **Phase 3: W4 — Environment Engine** *(complete 2026-06-07)*
- [x] **Phase 4: W6 — Combat & Diplomacy** *(complete 2026-06-07)*
- [x] **Phase 5: W5 — Genetics Depth & Selection** *(complete 2026-06-07)*

All 17/17 requirements implemented and automated-verified (vitest + `cargo test --no-run`/clippy; milestone audit PASSED — `.planning/milestones/v2.0-MILESTONE-AUDIT.md`). Live human UAT (real providers + WebView2) + backend `cargo test` on CI + desktop exe refresh via `build.bat` remain a human/CI gate. Full phase detail, plans, and waves archived at `.planning/milestones/v2.0-ROADMAP.md` and `.planning/milestones/v2.0-phases/`.

</details>

<details>
<summary>✅ v1.0 Orchestration MVP (Phases 1-6) — SHIPPED 2026-06-06</summary>

- [x] **Phase 1: CLI Completion** *(complete 2026-05-08)*
- [x] **Phase 2: Orchestration Layer** *(complete 2026-05-08)*
- [x] **Phase 3: Tauri Shell** *(complete 2026-05-09)*
- [x] **Phase 4: Chat UI** *(complete 2026-05-10)*
- [x] **Phase 5: Agent Dashboard** *(complete 2026-05-10)*
- [x] **Phase 6: Parallel Worktrees + Team Orchestration** *(complete 2026-05-11)*

Full phase detail, plans, and waves archived at `.planning/milestones/v1.0-ROADMAP.md` and `.planning/milestones/v1.0-phases/`.

</details>

---

## Phase Details

> The phases below are **v2.1** (additive layer over the v2.0 engine). Grounding: `.planning/research/SUMMARY.md` (decision-ready synthesis with per-phase exit gates) + `.planning/research/ECONOMY.md` (concrete currency/price/catalog tables). Spec-of-record extends `civ-multi-civ-world-plan.md` (W10.3–W10.7).
>
> **Cross-cutting criteria (apply to EVERY phase, checked at phase close):**
> - **PARITY** — every new human verb (possess / sell / buy / craft / talk-to-NPC / terraform) is also a `CivDecisionAction` arm AND a `civPilotControls` command AND appears in `render_game_to_text()`.
> - **DETERMINISM** — no new draw on the shared founder/vein RNG; new world-gen uses salted per-chunk sub-streams. Verified on Windows via `cargo check` / `cargo clippy --pedantic` / `cargo test --no-run`; full tests on CI.
> - **BACK-COMPAT** — every new struct field is `#[serde(default)]`; schema-shape changes bump `SCHEMA_VERSION` + extend `migrate_value_in_place`; a pre-v2.1 save loads cleanly each phase. `bindings.ts` regenerated via `tauri dev` (never hand-edited). Arena-bridge keys are append-only (legacy vitest locks stay byte-identical green).
> - **FALLBACK = IPC MOCK ONLY** — `tauriBrowserFallback.ts` mocks new IPC commands with believable canned shapes; engine RNG/economy math is NEVER ported to TypeScript.
> - **UI SCOPE** — restyle/UI work is confined to `tauri-app/src/components/civilization/`; never touch the harness chat/eval/settings surfaces.

### Phase 1: Human Takeover (Possession)
**Goal**: A user can take over (possess) a whole civilization and play it directly as a fully player-controlled civ, issuing the same civ-level orders the AI uses and releasing control at will — and the backend turn loop never invokes the LLM for a possessed civ (no tokens burned, the AI does not act against the player), while combat/predator/environment passes still run. Possession is also agent-legible and agent-drivable. This is the cheapest high-value unlock (one `control_mode` field + one guard branch in `advance_civ_turn` to skip `call_model_text`) and it makes every later phase immediately human-testable.
**Depends on**: Nothing (first v2.1 phase; reuses v2.0 `set_civ_controller`, `possessedEntityId`, `focusCiv`, and the existing intervention seam)
**Requirements**: POSS-01, POSS-02, POSS-03, POSS-04
**Success Criteria** (what must be TRUE):
  1. A user can possess an entire civilization from the Civ UI and play it directly, competing against the remaining AI civs; possession state is clearly visible in-game.
  2. A possessed civ burns ZERO model calls — the backend turn loop skips `call_model_text` for it (provable by a unit test counting model calls), while post-loop combat / predator / environment passes still run for it.
  3. The user can issue the full `CivDecisionAction` order set to a possessed civ and release control back to the AI at any time (the civ resumes LLM-driven turns).
  4. Possession/control-mode is agent-legible — it appears in `render_game_to_text()` — and an agent can possess/release a civ via `civPilotControls` at parity with the human surface.
**Plans**: TBD
**UI hint**: yes

> **Implementation notes:** Add `control_mode` (`model` | `human`, `#[serde(default)]`) to `CivCivilization`; inject a guard branch in `advance_civ_turn` (~L874) so `control_mode != model` skips `call_model_text` but still runs the unconditional post-loop world passes. Frontend-only possession is NOT sufficient (Pitfall 4 — possession desync). Add `civPilotControls.possess(civId)` / release verbs; surface `controller` / control-mode in the text bridge. Research flag: standard patterns — skip phase research.

### Phase 2: Economy & Currency
**Goal**: Each civ (AI or human-possessed) holds a wallet of ≥5 distinct currencies (Shells, Pearls, Tidewardens' Favor, Spawn-tokens, Ancient Amberglass) — each with a distinct faucet and a distinct sink — and can sell resources at fixed prices to earn the appropriate currency, subject to a per-turn sell cap and anti-exploit rules. The economy is balanced: over a long deterministic run no currency inflates unboundedly AND every currency is actually spent, and currency never feeds the score function. This is the foundational ledger every later phase spends against, and with possession live from Phase 1 the balance is immediately human-playable.
**Depends on**: Phase 1 (possession makes economy balance human-testable)
**Requirements**: ECON-01, ECON-02, ECON-03, ECON-04
**Success Criteria** (what must be TRUE):
  1. Each civ holds a wallet of ≥5 distinct currencies, each with a distinct source (faucet) and distinct sink, mirroring the existing `resources` idiom.
  2. A civ (AI or human-possessed) can sell resources at fixed prices to earn the correct currency, bounded by a per-turn sell cap and anti-exploit rules (buy-price > sell-price; no downward conversion; deterministic round-down).
  3. A 200-turn deterministic greedy-miner sim test proves every currency stays bounded (no unbounded inflation) AND every currency is actually spent; currency does NOT feed the score function.
  4. Wallet balances, sell prices, and earn/spend events appear in `render_game_to_text()`, and the `sell` action is available to both AI and human-possessed civs at identical prices (PARITY).
**Plans**: TBD

> **Implementation notes:** `currencies: HashMap<String,i32>` on `CivCivilization` (`#[serde(default)]`); `sell_price()` / `known_currency()` catalog fns; `sell` arm in `validate_action` + `apply_model_decision` and a matching `civPilotControls.sell`. Use `ECONOMY.md` price tables / rates / anti-exploit rules as implementation defaults, then TUNE against the 200-turn sim-test (the exit gate). Pitfall 3 (imbalance) — sim-test is the gate; Pitfall 6 — serde(default). Research flag: ECONOMY.md is the spec — skip phase research.

### Phase 3: Shop / Store + UI
**Goal**: A user can open a game-native store UI, browse a categorized catalog (buffs, resources, buildings, items) gated by progression (era / tech / currency tier), see prices alongside their currency balances, and buy — a purchase deducts the correct currency, applies its effect, and shows a clear insufficient-funds state when unaffordable. The store is the primary human-facing currency sink and headline new surface, and an AI civ / agent can buy at the same prices through the bridge. The shop is mostly a routing-and-pricing layer over mutations (build / research / `CivModifier`) that already exist.
**Depends on**: Phase 2 (the catalog must cost currency)
**Requirements**: SHOP-01, SHOP-02, SHOP-03, SHOP-04
**Success Criteria** (what must be TRUE):
  1. A user can open a game-native store drawer, browse a categorized catalog (buffs / resources / buildings / items), and see prices alongside their per-currency balances.
  2. A user can buy from the store: the purchase deducts the correct currency, applies the effect, and shows a clear insufficient-funds state when unaffordable.
  3. Catalog entries are gated by progression (era / tech / currency tier) so the shop is a meaningful sink rather than a flat menu.
  4. An AI civ can buy via a decision action and an agent can buy via `civPilotControls` at the SAME prices as the UI, and the catalog appears in `render_game_to_text()` (PARITY — one pricing table, one transaction fn, one sell-cap counter; UI and AI are thin clients).
**Plans**: TBD
**UI hint**: yes

> **Implementation notes:** `ShopPanel.tsx` drawer in `CivilizationView.tsx`; `shop_catalog()` + `shop_price()` backend fns; a `buy` / `shop_buy` intervention kind through `apply_intervention_to_snapshot` (~L3052) + decision arm; insufficient-funds UI state; catalog in `build_observation` + `render_game_to_text()`. Buffs reuse the existing `CivModifier` system (no new buff engine). Pitfall 11 (UI scope creep) — vertical slice first; "done" = browse / see price / buy / sell / see balances / insufficient-funds. Exit gate: an agent completes a buy via `civPilotControls.buy(itemId)` at identical price to UI; vitest green. Research flag: standard patterns — skip phase research.

### Phase 4: Items, Crafting & NPCs
**Goal**: The resource/item taxonomy is widened with usable tools/items (mining, digging, harvesting, growing) held per civ; a civ can craft items and upgrades from resources via a 2-3 tier recipe cascade using the Spawn-token closed loop; and interactable NPCs (trader / quest-giver / fauna-handler) seeded near colonies can be engaged by both human and AI, with quests acting as the faucet for Tidewardens' Favor. These three sub-systems share `items: HashMap<String,i32>` and are cohesive enough to land together — items are shop SKUs and NPC rewards (needs Phases 2-3), crafting clones the build/research dispatch pattern, and NPC roles extend the already-rich task framework.
**Depends on**: Phase 3 (items are shop SKUs and NPC rewards; crafting/NPC economics spend the Phase 2 currencies through the Phase 3 transaction layer)
**Requirements**: ITEM-01, CRAFT-01, NPC-01, NPC-02
**Success Criteria** (what must be TRUE):
  1. The resource/item taxonomy is widened with usable tools/items for mining, digging, harvesting, and growing more & better vegetation/resources; items are held per civ.
  2. A civ can craft items and upgrades from resources via a 2-3 tier recipe cascade using the Spawn-token closed loop (tokens minted only by a workshop, spent only on recipes).
  3. Interactable NPCs (trader / quest-giver / fauna-handler) are seeded near colonies and can be engaged by a player or an AI civ.
  4. NPC interactions (trade, quests) are available to both human and AI via the bridge, and quests act as the faucet for Tidewardens' Favor (PARITY — every NPC interaction has a `civPilotControls` verb and a text-bridge block).
**Plans**: TBD

> **Implementation notes:** `items: HashMap<String,i32>` on `CivCivilization` (`#[serde(default)]`); `item_def()` / `craft_recipe()` fns; `craft` action arm + intervention kind cloning build/research; new NPC `role` values on `kind:npc` entities using the existing task/quest framework; `trade_npc` / `quest` action arms. Pitfall 5 — every NPC interaction has a bridge verb; Pitfall 6 — `items` serde(default). Exit gate: agent crafts via text bridge; trader NPC accessible to both AI and human possession; pre-v2.1 save loads. Research flag: standard patterns — skip phase research.

### Phase 5: Infinite / Chunked Procedural World
**Goal**: The world becomes procedurally generated and effectively infinite/expandable — terrain is a deterministic function of (seed, coordinate) via chunked generation with organic fBm terrain and biomes that blend at chunk seams; players/civs can explore, prospect/discover (strata reports, POIs/landmarks), and terraform/place blocks, with only modifications persisted (sparse diffs) so save size and per-turn IPC stay bounded; and generation is cross-platform deterministic (golden-hash verified), stays performant while exploring (flat frame-time via chunked RenderTextures), and world state remains agent-legible. This is the highest-risk structural change — it goes last so all content types (items / NPCs / economy) are stable before the ground shifts.
**Depends on**: Phase 4 (content types — items, NPCs, resources — must be stable before the world distributes them into chunks; retrofitting chunked persistence around unstable content would be a rewrite)
**Requirements**: WORLD-01, WORLD-02, WORLD-03
**Success Criteria** (what must be TRUE):
  1. The world is procedurally generated and effectively infinite — `generate_chunk(seed, cx, cy)` is a pure, stateless function of (seed, coordinate) producing identical terrain regardless of explore order, with organic fBm terrain and biomes that blend at chunk seams (golden-hash verified, cross-platform deterministic).
  2. Players/civs can explore, prospect/discover (strata reports, POIs/landmarks), and terraform/place blocks; only modifications are persisted (sparse diffs), keeping a 200-turn explored save under a size budget and per-turn IPC payload bounded (< 512 KB/turn).
  3. Frame-time stays flat while exploring (chunked RenderTextures pooled/unloaded) and world state remains agent-legible in `render_game_to_text()`, with terraform/place exposed at human/agent parity (PARITY + DETERMINISM via salted per-chunk sub-streams).
**Plans**: TBD
**Research flag**: NEEDS RESEARCH — the `tile_at` lazy accessor, sparse diff-persistence schema (`CivWorld` struct shape), W8 Phaser `RenderTexture` chunk pooling/unloading, and per-chunk determinism testing are only partially spec-ed in `civ-multi-civ-world-plan.md`. `/gsd-plan-phase 5` MUST run a research pass first. Also decide `tauriBrowserFallback.ts` preview scope (bounded single starter-chunk vs multi-chunk mock) before Phase 5 begins.

> **Implementation notes:** Split `generate_world` into `generate_chunk(seed, cx, cy)` (pure, salted sub-stream RNG: `seed XOR 0xC4A0_5EED XOR mix(cx,cy)`) + a `tile_at(world, x, y)` lazy accessor; route every direct `tiles.iter().find()` site through the accessor. Sparse diff-persistence (persist only mined/placed tiles; regenerate untouched terrain from seed). W8 chunked `RenderTexture` baking in `CivilizationGameCanvas.tsx`. Pitfall 1 (RNG corruption — order-independence test BEFORE any chunk-dependent feature; re-baseline determinism goldens deliberately); Pitfall 2 (save bloat — decide diff model before writing terraform); Pitfall 10 (chunk seams). Exit gate: `gen_chunk(s,5,0)` identical regardless of explore order; 200-turn explored save under budget; IPC < 512 KB/turn; flat frame-time.

### Phase 6: Assets & Game-native UI
**Goal**: Game art (currency icons, item sprites, NPC characters, new tile types) is generated via the existing Gemini image pipeline, committed, and rendered in-game — and the Civilization UI is restyled to read as a game (game-native HUD + diegetic in-world markers) rather than part of the harness app, scoped to `civilization/` components only. The game runs gracefully with `GEMINI_API_KEY` unset (placeholder fallback, no crash); asset generation is a one-time, cached, build-time cost. This is the presentation layer — it depends on all new content keys (items, NPCs, tiles) existing, so it lands after Phase 4; it is parallelizable with Phase 5 but strictly after Phase 4 so the sprite sets are known.
**Depends on**: Phase 4 (all content keys — item / NPC / currency / tile sets — must exist so the art jobs are complete; parallelizable with Phase 5)
**Requirements**: ASSET-01, ASSET-02, GAMEUI-01
**Success Criteria** (what must be TRUE):
  1. Game art (currency icons, item sprites, NPC characters, new tile types) is generated via the Gemini image pipeline, committed to `tauri-app/public/civ/`, and rendered in-game.
  2. The game loads and runs gracefully with `GEMINI_API_KEY` unset (placeholder fallback, no crash); asset generation is a one-time, cached, build-time cost (no runtime API calls).
  3. The Civilization UI reads as a game — game-native HUD + diegetic in-world markers — with all changes confined to `tauri-app/src/components/civilization/` (and `public/civ/`); no files outside that scope touched (UI SCOPE), `tsc --noEmit` + vitest green.
**Plans**: TBD
**UI hint**: yes

> **Implementation notes:** The complete Gemini pipeline already exists at `output/civ-gen/gemini/` (`gen.mjs` + `postprocess.py`, `gemini-2.5-flash-image` via Vertex express REST, build-time only) — v2.1 adds new job entries, no pipeline code change. Restyle is confined to `CivilizationView.tsx` and sibling `civilization/` components — zero engine or IPC changes. Pitfall 8 (Gemini cost/key/style — graceful unset fallback); Pitfall 11 (scope creep). Research flag: standard patterns — skip phase research.

---

## Progress

**Execution Order (v2.1):**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6
(Phase 6 is parallelizable with Phase 5 but is sequenced after Phase 4 so content keys are known.)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Human Takeover (Possession) | v2.1 | 0/TBD | Not started | - |
| 2. Economy & Currency | v2.1 | 0/TBD | Not started | - |
| 3. Shop / Store + UI | v2.1 | 0/TBD | Not started | - |
| 4. Items, Crafting & NPCs | v2.1 | 0/TBD | Not started | - |
| 5. Infinite / Chunked Procedural World | v2.1 | 0/TBD | Not started (needs research) | - |
| 6. Assets & Game-native UI | v2.1 | 0/TBD | Not started | - |
| 1-5 (v2.0) | v2.0 | 14/14 | Complete | 2026-06-07 |
| 1-6 (v1.0) | v1.0 | 33/33 | Complete | 2026-06-06 |

---

## Coverage (v2.1)

- **v2.1 requirements:** 22
- **Mapped:** 22 / 22
- **Orphans:** 0
- **Duplicates:** 0

| Phase | Workstream | Requirement IDs | Count |
|-------|-----------|-----------------|-------|
| 1 | Possession | POSS-01, POSS-02, POSS-03, POSS-04 | 4 |
| 2 | Economy & Currency | ECON-01, ECON-02, ECON-03, ECON-04 | 4 |
| 3 | Shop / Store + UI | SHOP-01, SHOP-02, SHOP-03, SHOP-04 | 4 |
| 4 | Items, Crafting & NPCs | ITEM-01, CRAFT-01, NPC-01, NPC-02 | 4 |
| 5 | Infinite / Chunked Procedural World | WORLD-01, WORLD-02, WORLD-03 | 3 |
| 6 | Assets & Game-native UI | ASSET-01, ASSET-02, GAMEUI-01 | 3 |

---
*v2.1 roadmap created: 2026-06-07 (reset phase numbering; v2.0 + v1.0 archived). Phase ordering adopted from `research/SUMMARY.md` (possession → economy → shop → items/NPCs → chunked world → assets/UI); coverage validated 22/22, 0 orphans, 0 duplicates.*
