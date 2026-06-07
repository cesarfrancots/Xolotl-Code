# Requirements: xolotl — Milestone v2.1 "Living World & Economy"

**Defined:** 2026-06-07
**Core Value:** A developer can spawn, monitor, and coordinate multiple AI agents working in parallel on a single project — from a chat-first desktop app — without being locked into OpenAI or Anthropic.
**Milestone goal:** Make the Axolotl Civilization simulation a fully playable, understandable, and enjoyable game — an infinite procedural world, a resource→currency→shop economy, true human takeover of a civ, NPCs, items, and a game-native UI — where every human-play feature also deepens agentic playability.

**Grounding:** `.planning/research/SUMMARY.md` (decision-ready synthesis) + `.planning/research/ECONOMY.md` (concrete currency/price/catalog tables). Spec-of-record extends `civ-multi-civ-world-plan.md` (W10.3–W10.7).

---

## Cross-Cutting Requirements (per-phase exit criteria, not a phase)

These hold for **every** requirement below and are checked at each phase close:

- **PARITY** — every new human verb (possess / sell / buy / craft / talk-to-NPC / terraform) is also a `CivDecisionAction` arm **and** a `civPilotControls` command **and** appears in `render_game_to_text()`. Human-play and agentic-play stay at parity.
- **DETERMINISM** — no new draw on the shared founder/vein RNG; new world-gen uses salted per-chunk sub-streams. Verified on Windows via `cargo check`/`clippy --pedantic`/`test --no-run`; full tests on CI.
- **BACK-COMPAT** — every new struct field is `#[serde(default)]`; schema-shape changes bump `SCHEMA_VERSION` + extend `migrate_value_in_place`; a pre-v2.1 save loads cleanly each phase. `bindings.ts` regenerated via `tauri dev` (never hand-edited). Arena-bridge keys are append-only (byte-identical legacy vitest locks stay green).
- **FALLBACK = IPC MOCK ONLY** — `tauriBrowserFallback.ts` mocks new IPC commands with believable canned shapes; engine RNG/economy math is **never** ported to TypeScript.
- **UI SCOPE** — restyle/UI work is confined to `tauri-app/src/components/civilization/`; never touch the harness chat/eval/settings surfaces.

---

## v1 Requirements (v2.1 scope)

### Human Takeover — Possession (POSS)

- [ ] **POSS-01**: A user can take over (possess) an entire civilization and play it directly as a fully player-controlled civ.
- [ ] **POSS-02**: A possessed civ does **not** invoke its LLM — the backend turn loop skips `call_model_text` for it (no tokens burned, the AI does not act against the player), while post-loop combat/predator/environment passes still run.
- [ ] **POSS-03**: A user can issue the civ-level orders the AI uses (the `CivDecisionAction` set) to a possessed civ, and can release control back to the AI at any time.
- [ ] **POSS-04**: Possession/control-mode is agent-legible — visible in-game and in `render_game_to_text()`, and an agent can possess/release a civ via `civPilotControls`.

### Economy & Currency (ECON)

- [ ] **ECON-01**: Each civ holds a wallet of **≥5 distinct currencies** (Shells, Pearls, Tidewardens' Favor, Spawn-tokens, Ancient Amberglass), each with a distinct source (faucet) and distinct sink.
- [ ] **ECON-02**: A civ (AI or human-possessed) can sell resources at **fixed prices** to earn the appropriate currency, subject to a per-turn sell cap and anti-exploit rules.
- [ ] **ECON-03**: The economy is balanced — over a long deterministic run no currency inflates unboundedly **and** every currency is actually spent (proven by a 200-turn greedy-miner sim test); currency does not feed the score function.
- [ ] **ECON-04**: Wallet balances, sell prices, and earn/spend events are surfaced in `render_game_to_text()`, and the `sell` action is available to both AI and human-possessed civs at identical prices.

### Shop / Store (SHOP)

- [ ] **SHOP-01**: A user can open a game-native store UI, browse a categorized catalog (buffs, resources, buildings, items), and see prices alongside their currency balances.
- [ ] **SHOP-02**: A user can buy from the store; a purchase deducts the correct currency, applies its effect, and shows a clear insufficient-funds state when unaffordable.
- [ ] **SHOP-03**: Catalog entries are gated by progression (era / tech / currency tier) so the shop is a meaningful currency sink rather than a flat menu.
- [ ] **SHOP-04**: An AI civ can buy via a decision action and an agent can buy via `civPilotControls` at the same prices as the UI; the catalog appears in `render_game_to_text()`.

### Items, Crafting & NPCs (ITEM / CRAFT / NPC)

- [ ] **ITEM-01**: The resource/item taxonomy is widened with usable tools/items for mining, digging, harvesting, and growing more & better vegetation/resources; items are held per civ.
- [ ] **CRAFT-01**: A civ can craft items and upgrades from resources via recipes (a 2–3 tier cascade) using the Spawn-token closed loop.
- [ ] **NPC-01**: Interactable NPCs exist (trader / quest-giver / fauna-handler), seeded near colonies, that a player or AI can engage.
- [ ] **NPC-02**: NPC interactions (trade, quests) are available to both human and AI via the bridge, and quests act as the faucet for Tidewardens' Favor.

### Infinite Procedural World (WORLD)

- [ ] **WORLD-01**: The world is procedurally generated and effectively infinite/expandable — terrain is a deterministic function of (seed, coordinate) via chunked generation, with organic fBm terrain and biomes that blend at chunk seams.
- [ ] **WORLD-02**: Players/civs can explore, prospect/discover (strata reports, POIs/landmarks), and terraform/place blocks; only modifications are persisted (sparse diffs), keeping save size and per-turn IPC bounded.
- [ ] **WORLD-03**: Procedural generation is cross-platform deterministic (golden-hash verified) and stays performant while exploring (flat frame-time via chunked RenderTextures), and world state remains agent-legible.

### Assets & Game-native UI (ASSET / GAMEUI)

- [ ] **ASSET-01**: Game art (currency icons, item sprites, NPC characters, new tile types) is generated via the Gemini image pipeline, committed, and rendered in-game.
- [ ] **ASSET-02**: The game runs gracefully with `GEMINI_API_KEY` unset (placeholder fallback, no crash); asset generation is a one-time, cached, build-time cost.
- [ ] **GAMEUI-01**: The Civilization UI is restyled to read as a game (game-native HUD + diegetic in-world markers) rather than part of the harness app, scoped to `civilization/` components only.

---

## v2 Requirements (deferred — tracked, not in this roadmap)

### Economy & World (future)

- **MKT-01**: Dynamic/auction markets with supply-demand pricing (v2.1 uses fixed prices for AI legibility).
- **RANCH-01**: Tameable fauna ranching / breeding economy.
- **NPC-V2-01**: Branching NPC narrative / multi-step quest chains.
- **CAVE-01**: Deep W10.7 cave systems (highest f32-determinism risk; defer until fBm terrain is golden-locked).
- **PERSIST-01**: Cross-run currency/inventory persistence beyond the Amberglass "Ancestral Vault".

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| Gacha / lootbox / random-reward purchases | Anti-feature; undermines a legible, plannable economy |
| Cosmetic-only / pay-to-look purchases | Shop must sell functional goods that matter to play |
| Real-money / monetization | Personal project; economy is in-game only |
| Dynamic market pricing in v2.1 | Fixed prices keep AI planning legible; markets deferred to v2 (MKT-01) |
| Porting engine math into `tauriBrowserFallback.ts` | It is an IPC mock/preview, not an engine clone — porting risks divergence |
| New runtime dependencies | Research confirms the whole milestone ships with zero new deps |
| Touching harness chat/eval/settings UI | UI scope is the Civ surface only |

---

## Traceability

Recommended mapping (validated/finalized by the roadmapper).

| Requirement | Phase | Status |
|-------------|-------|--------|
| POSS-01 | Phase 1 | Pending |
| POSS-02 | Phase 1 | Pending |
| POSS-03 | Phase 1 | Pending |
| POSS-04 | Phase 1 | Pending |
| ECON-01 | Phase 2 | Pending |
| ECON-02 | Phase 2 | Pending |
| ECON-03 | Phase 2 | Pending |
| ECON-04 | Phase 2 | Pending |
| SHOP-01 | Phase 3 | Pending |
| SHOP-02 | Phase 3 | Pending |
| SHOP-03 | Phase 3 | Pending |
| SHOP-04 | Phase 3 | Pending |
| ITEM-01 | Phase 4 | Pending |
| CRAFT-01 | Phase 4 | Pending |
| NPC-01 | Phase 4 | Pending |
| NPC-02 | Phase 4 | Pending |
| WORLD-01 | Phase 5 | Pending |
| WORLD-02 | Phase 5 | Pending |
| WORLD-03 | Phase 5 | Pending |
| ASSET-01 | Phase 6 | Pending |
| ASSET-02 | Phase 6 | Pending |
| GAMEUI-01 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-07*
*Last updated: 2026-06-07 after v2.1 research synthesis*
