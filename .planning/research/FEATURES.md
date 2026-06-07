# Feature Research

**Domain:** Axolotl civilization / colony-sim game (Minecraft/Terraria-style aquatic block world + Civ-style multi-faction strategy), played by *both* humans and AI harnesses through one shared control bridge
**Researched:** 2026-06-07
**Confidence:** MEDIUM-HIGH (engine reality verified by direct code reading; genre design patterns from game-design literature, MEDIUM)

> **Scope discipline for the requirements author:** v2.1 *extends* a large, working engine. Do not re-spec what exists. The grep evidence below shows the engine already ships: finite/renewable resources (15 keys), depth-banded ore veins + mining-as-terraform, a 7-tech tree with tool-tier gating (`stone_tools`→`metal_tools`), inter-civ `trade` (give/receive with hostile-block), NPC-style quest tasks (`fetch`/`trade`/`visit`/`repair`/`rescue`/`build_bridge` with rewards), entity-level **possession** with a rich text bridge (`render_game_to_text` exposes player oxygen/blocked/hazard/nearby-interactions + `civs[]` with `controller` + `leaderboard` + `environment`), and a `control_mode: codex|manual|released` switch. v2.1's job is **breadth on top of these primitives**, not new foundations.

## Feature Landscape

Organized by the 7 question categories. Each row is tagged in-cell with **[T]** table-stakes / **[D]** differentiator / **[A]** anti-feature, **complexity S/M/L**, and **dependency** on existing systems. "Parity" notes how the feature reaches the AI harness through the same bridge (human-play ⟂ agentic-play).

---

### 1. Infinite procedural world

The W10.3–W10.7 deferred slices (terraform/place, blueprints, prospecting, fBm terrain, caves) are the foundation; "infinite" means streaming chunks beyond the current finite width.

| Feature | Tag / Cx | Why / Dependency | Parity (harness) |
|---------|----------|------------------|------------------|
| Chunked streaming world (generate/cull chunks around camera or colony, beyond fixed `world_width`) | **[T] L** | Players expect "keep swimming, world keeps going." Depends on: existing chunked RenderTexture culling (W8), `generate_world` seed determinism, `seabed_ripple`/fBm (W10.6). The hard part is deterministic *lazy* chunk gen keyed by `(seed, chunkX)` so a chunk is identical whether reached now or later. | Text bridge already reports `visible_entities` + tiles near the player; extend to report "frontier" direction + newly-revealed chunk summary so a harness can drive exploration. |
| Biome variety with soft transitions + depth bands (already 14 biomes, depth-banded veins) | **[T] S** | Exploration is fun when biomes are legible and *predictable-once-recognized* (see ore depth bands). Mostly DONE — extend biome count/blending at chunk seams. | Strata report (W10.5) already planned into `build_observation`; expose biome label per region in text. |
| Prospecting / discovery loop (`explore down` → `strata_report`: richest deep vein + depth) | **[D] M** | This is the "what keeps it interesting" engine — gives a *reason* to dig vs. a flat reward. W10.5 spec exists; fold into the existing observation tile-pass (no extra O(n) loop). | A harness can call prospect then target the named vein — high-signal text action, cheap to expose. |
| Landmarks / points-of-interest (seeded ruins, rare resource shrines, abandoned colonies) | **[D] M** | Pure procedural noise gets boring; hand-feel POIs give *destinations*. Seed sparsely per chunk; reuse building/structure entities as anchors. | Each POI is a `visible_entity` with a role → harness can navigate to it like an NPC. |
| Terraform / place blocks (constructive inverse of mining; anti-grief adjacency) | **[T] S** | Block worlds must let you *build* terrain, not just dig it. W10.3 spec exists; reuses `placeable_build_resource` (stone/clay/wood/fiber/coral/ice already gated). | Already an action verb candidate; add `terraform` to the pilot decision set. |
| Carved caves & water pockets (below mandatory `CAVE_CAP`) | **[D] M** | Adds vertical exploration + hidden veins. W10.7, flagged "LAST, highest risk" — cross-platform f32 determinism + seabed-cap invariant. | Caves surface as mineable tiles in the existing tile pass; no new bridge work. |
| **[A]** True unbounded RNG world with no anchors / no return path | **[A] —** | "Infinite" tempts pure noise. Problem: no memorable places, agents and humans wander aimlessly, and IPC JSON explodes if every tile streams. **Instead:** finite-but-large chunks with seeded POIs + a "home beacon"/recall; cap streamed tiles per observation. |
| **[A]** Per-tile entity in the renderer at infinite scale | **[A] —** | The W8 note already warns one `Image` per tile is "untenable at ~36k+." **Instead:** chunked RenderTextures keyed to `worldView` (already the plan) — do NOT regress to per-tile sprites for new terrain. |

---

### 2. Resource → gathering → crafting / items loops

| Feature | Tag / Cx | Why / Dependency | Parity (harness) |
|---------|----------|------------------|------------------|
| Richer resource taxonomy (extend the 15 `known_resource` keys with processed/crafted goods) | **[T] S** | Players expect raw→intermediate→finished tiers. Current keys are mostly *raw*; v2.1 wants items. Add a *category* notion (raw / refined / tool / consumable / valuable) rather than one flat list. | `known_resource` is the validation gate; widening it auto-widens what harness `gather`/`trade`/`craft` can name. |
| Crafting recipes that gate gameplay (each tier unlocks genuinely new actions, not busywork) | **[D] M** | Genre lesson: satisfying crafting = *cascading unlocks* where a new material opens a new recipe set; avoid "smash junk for stat+1." Build on existing `tech_cost`/`workshop_craft` tech + `building_cost` patterns rather than a brand-new system. | Add a `craft` action verb mirroring `build`/`research` validation; emit craftable list in observation. |
| Tool tiers (mining gating already: none→`stone_tools`→`metal_tools`; extend to gather speed/harvest tiers) | **[T] S** | DONE for mining (`mining_tier`/`required_mining_tier`, acyclic chain verified). Extend the *same* tier idea to harvest yield / dig speed so tools matter beyond ore. | Tier shows in civ `techs[]` in text; harness already reasons about tech prerequisites. |
| "Grow better vegetation" — cultivated/upgradable renewables (farm tiers raise `forage_yield`/regrowth) | **[D] M** | PROJECT explicitly asks for "growing more & better vegetation." Hook into existing `resource_regrowth` (renewable-only) + `moss_farm`/`farm` building. Higher farm tier = faster/denser regrowth. | Regrowth state already in the world tiles the harness sees; farm tier is a tech/building it can pursue. |
| Item taxonomy with equip/consume semantics (accessories already equip; add consumable buffs) | **[D] M** | Items are "a thing" when they *do* something on use. Accessories (`accessories: Vec<String>`) already equip on entities; add consumable items that grant a timed `CivModifier`. | Equipping/consuming = interactions on the bridge; modifiers already serialize into text. |
| **[A]** Deep recipe trees with dozens of intermediate goods | **[A] —** | Tempting for "depth." Problem: combinatorial balance + bloats the IPC snapshot + agents drown in choices. **Instead:** 2–3 tiers, ~1 dozen items total, each with a clear use. |
| **[A]** Grindy gather quotas with no qualitative change | **[A] —** | "Gather 500 wood" feels like busywork. **Instead:** every gather threshold should *unlock* something (recipe, building, tool) — tie to the crafting cascade. |

---

### 3. Economy & currencies (≥5 currencies)

The single highest-design-risk category — currently the engine has **no money layer at all** (trade is direct resource barter via `apply_trade`). This is net-new.

| Feature | Tag / Cx | Why / Dependency | Parity (harness) |
|---------|----------|------------------|------------------|
| A currency layer distinct from resources (per-civ wallet of N currencies) | **[T] M** | Money exists so you can *sell* heterogeneous resources for one fungible thing and *buy* across categories — without it, a shop is impossible. Add `currencies: HashMap<String,i64>` to `CivCivilization` (parallel to `resources`). | Add to civ summary in `render_game_to_text` (`resources` already there — mirror it with `currencies`). |
| ≥5 currencies, each with a *distinct purpose* (not 5 reskins of gold) | **[T] M** | Genre rule: multiple currencies create distinct progression avenues. Recommend a *role* per currency, ocean/pond-themed: **(1) Shells** = common soft currency (sell raw resources); **(2) Pearls** = rare/premium (deep mining, big achievements) → buys buildings/permanent upgrades; **(3) Spawn/Bio tokens** = breeding/genetics sink; **(4) Research/Lore crystals** = tech & buffs; **(5) Reputation/Favor** = NPC/diplomacy currency, earned by quests, spent on traders. Each = one sink domain. | Each currency is a named field in text; harness can plan "earn X to afford Y" just like a human. |
| Fixed-price selling (sell resources → currency at a posted rate) | **[T] S** | PROJECT specifies "sell at fixed prices." Simplest, deterministic, agent-legible. A static price table (`sell_price(resource) -> (currency, amount)`). Deterministic = testable on Windows-blocked backend. | A `sell` action verb; price table is observable so the harness can compute ROI. |
| Sinks that match each currency's source (buildings, tools, buffs, breeding, diplomacy fees) | **[T] M** | The #1 economy failure is faucets without sinks → stockpiles → meaningless purchases (>12%/period stockpile growth = unstable). Every currency needs a dedicated drain. Reuse `building_cost`/`tech_cost` as sink hooks; add shop purchases (cat 4) + breeding cost (cat 6) + diplomacy/trade tax. | Sinks are just costed actions in the bridge — harness sees affordability. |
| Researched acquisition/sink rates (balance via seeded simulation) | **[D] M** | PROJECT asks for "researched acquisition rates and sinks so the economy is balanced." Because the engine is deterministic + seeded, you can *unit-test* economic balance (run N turns, assert net currency growth stays in a band). This is a genuine differentiator vs typical games that only playtest. | Same sim drives both; a harness "economy run" doubles as a balance test. |
| Dynamic markets / supply-demand pricing | **[A]/[D-defer] M** | Markets are *cool* but volatile + hard to balance + harder for agents to reason about. PROJECT explicitly chose **fixed prices**. **Recommend:** ship fixed-price first; treat markets as a possible later differentiator, NOT v2.1. Mark as anti-feature for this milestone. |
| **[A]** A single universal currency | **[A] —** | Easiest, but PROJECT requires ≥5 *with different uses*; one currency collapses all progression to one number and removes interesting choices. **Instead:** role-segmented currencies (above). |
| **[A]** Premium / real-money (hard) currency | **[A] —** | F2P pattern, but this is a personal non-monetized project (PROJECT constraint). Borrow the *soft/hard* split conceptually (Shells=soft, Pearls=hard-but-earned) without any purchase. |
| **[A]** Unbounded compounding faucets (e.g., currency-per-turn that scales with stockpile) | **[A] —** | Classic inflation spiral. **Instead:** flat/diminishing sell yields + scaling sink costs (next building tier costs more). |

---

### 4. Shop / store

| Feature | Tag / Cx | Why / Dependency | Parity (harness) |
|---------|----------|------------------|------------------|
| Catalog UI with categories: buffs, resources, buildings, items (PROJECT list) | **[T] M** | A store is the player-facing sink for currencies. Catalog should map *category → currency* (buildings cost Pearls, buffs cost Crystals, etc.) so each currency feels purposeful. Depends on: currency layer (cat 3), `CivModifier` (buffs), `building_cost` (buildings). | A `purchase(item_id)` action verb + a catalog dump in the text bridge so a harness can shop too. |
| What's fun to buy = things that *change play*, not stat trinkets | **[D] M** | Genre lesson (Moonlighter/Recettear): purchases are fun when they grant tangible gameplay benefit (buffs/perks) and feed back into the other system. Prefer: permanent unlocks, powerful buffs, new building types, rare resource bundles to skip a grind. | Same catalog; harness picks by expected value. |
| Progression gating: cheap first unlocks, escalating costs, some items gated by tech/era | **[T] S** | Gating gives a "without overloading" ramp; first items trivially affordable, later ones require Pearls/era. Reuse era + tech as gates (already on `CivCivilization`). | Gates are visible (era/tech in text) → harness reasons about unlock order. |
| Store primarily for human takeovers, but accessible to AI civs as actions | **[D] M** | PROJECT: store is "primarily for human takeovers." But for parity, the same `purchase` verb should be in the decision schema so an AI-controlled or possessed-by-harness civ can shop. | This IS the parity story for the shop: one verb, two drivers (UI button ⟂ pilot action). |
| **[A]** Lootbox / gacha / randomized purchases | **[A] —** | Engagement-dark-pattern + non-deterministic (breaks the seeded-test discipline) + pointless for a personal game. **Instead:** deterministic, known-price catalog. |
| **[A]** Cosmetic-only store | **[A] —** | Cosmetics don't change play and don't justify 5 currencies. **Instead:** functional catalog (buffs/buildings/items); cosmetics (accessories) can be a *minor* tab funded by the cheapest currency. |

---

### 5. Civ-level human takeover / "possession" (Game B)

This is the conceptual leap from existing **entity-level** possession to **civ-level** control. The plumbing (`controller` field on civ, `control_mode`, possession bridge) partly exists.

| Feature | Tag / Cx | Why / Dependency | Parity (harness) |
|---------|----------|------------------|------------------|
| Possess a whole civ → the civ stops calling its LLM and takes player/harness orders (`controller="human"` bypasses `call_model_text`) | **[T] M** | PROJECT core: "possessing a civ makes it fully player-controlled and bypasses the LLM." The turn loop must check `controller` and skip the model decision for that civ, awaiting a queued player decision instead. Depends on: existing `set_civ_controller`, per-civ turn loop (W3). | A harness possessing a civ = setting `controller="codex"` and supplying the same `CivDecisionAction` JSON the LLM would. **This is near-free parity** — the action schema already exists. |
| Two control granularities coexisting: **god/RTS civ-level** (issue civ-wide directives: gather X, build Y, claim Z) AND **single-axolotl possession** (already shipped) | **[D] M** | Genre: god-games = indirect influence over many NPCs; RTS = direct unit control under resource/time limits. Offer both: civ-level "orders" for strategy + drop into one axolotl for hands-on play. Reuse existing entity possession for the latter. | Both already expressible: civ-level = `CivDecisionAction`; entity-level = the `civPilotControls` move/interact bridge. |
| Human-vs-AI coexistence on one board (possessed civ competes against still-AI civs in the same turn loop) | **[T] S** | The whole point — a player civ races AI civs on the shared leaderboard. The per-civ loop already iterates civs independently; just mixed controllers. Predictable scripts make AI exploitable — accept it (it's a lab) or add light variation. | Already true for harness: `controller` tag + leaderboard already in text bridge. |
| Controls a human needs: select/queue civ orders, camera focus-civ (exists), pause/step turns (exists), economy/shop access, diplomacy panel, direct-possess-unit toggle | **[T] M** | god/RTS players expect: select entity/region, issue order, see resources, control time, set policy. Most primitives exist (`focusCiv`, pause/step, intervention tools); v2.1 wires them into a coherent *player* control scheme vs *observer* tools. | The order queue = the same action list the harness emits; UI is just a second producer of it. |
| Release control → civ resumes LLM governance (`control_mode: released`) | **[T] S** | Players want to hand a civ back. `control_mode` already has `released`; extend from entity to civ scope. | Harness can release too (set `controller=None`). |
| **[A]** Full pause-the-world while the human micromanages every axolotl | **[A] —** | Turns a strategy race into a chore and desyncs from AI civs that decide per-turn. **Instead:** civ-level *orders* per turn (god-game indirection) + optional single-unit possession for moments, not mandatory micro. |
| **[A]** Letting a possessed civ ignore the rules AI civs follow (god-mode cheats) | **[A] —** | Breaks the fairness of the leaderboard/eval framing. **Instead:** human uses the *same* `CivDecisionAction` verbs + economy the AI uses; the advantage is human cleverness, not extra powers. (Observer "interventions" stay a separate god-tool, clearly labeled, outside the competitive frame.) |

---

### 6. NPC interaction

The engine already has a surprisingly complete **quest-giver** layer (axolotl NPCs issue `fetch`/`trade`/`visit`/`repair`/`rescue`/`build_bridge` tasks with rewards; `celebrate_npc_at` closure). v2.1 wants *non-civ* NPCs (traders/quest-givers/fauna handlers).

| Feature | Tag / Cx | Why / Dependency | Parity (harness) |
|---------|----------|------------------|------------------|
| Wandering trader NPCs (neutral `civ_id=None` entities that buy/sell resources for currency) | **[D] M** | A legible economy actor: a place to *spend Reputation/Shells* and offload resources outside the fixed civ shop. Reuse the predator pattern for neutral entities + an `apply_trade`-style swap, but resource↔currency. | Traders are `visible_entities` with a role → the pilot's NPC-targeting + `task`/`trade` logic already handles "approach NPC, transact." |
| Quest-giver NPCs (extend existing task system to non-civ givers; reward = currency/items) | **[T] S** | The task framework EXISTS and is rich (status `ready`, reward, multi-kind). Mostly: spawn non-civ givers + pay rewards in the new currencies. Adds legible *structure* + a Reputation faucet. | The whole `civPilot` task loop (`task-fetch`/`task-trade`/`task-visit`/`task-repair`/`task-rescue`/`task-bridge`) already drives an agent through quests — **strongest existing parity asset.** |
| Fauna handlers / tameable wild creatures (interact with neutral fauna: tame for buffs, ranch for resources) | **[D] M** | "Fauna handler" role from PROJECT. Builds on existing wild predators/prey (`kind:"predator"`). Taming = converting a neutral entity to a civ asset that yields resources. Adds a soft, non-combat way to engage fauna. | Tame = an interaction verb on a `visible_entity`; harness can pursue it. |
| Persistent NPC identity & dialogue beats (named givers with a small role-flavored line set) | **[D] S** | Makes the world feel inhabited (NPCs already have `name`/`role`; `requestKindForEntity` even maps morph/role→task type). Lightweight: flavor text on interaction. | Dialogue is text the harness reads as task context — already the model in `civPilot`'s task strings. |
| **[A]** Branching dialogue trees / conversation minigames | **[A] —** | Heavy authoring, low strategy value, hard to expose to a harness as discrete actions. **Instead:** transactional NPCs (give task / trade / tame) with one flavor line — every interaction is one legible action. |
| **[A]** NPCs as a separate AI-LLM call per character | **[A] —** | Cost + nondeterminism + breaks seeded tests. **Instead:** deterministic scripted NPC behavior (like the existing task givers and predators). |

---

### 7. Game-native UI vs "app chrome"

PROJECT: "the Civ UI should read as a game, not as part of the harness app." Current `CivilizationView.tsx` (2.3k lines) uses lucide icons + shared `ui/button`/`ui/input` — i.e., app chrome.

| Feature | Tag / Cx | Why / Dependency | Parity (harness) |
|---------|----------|------------------|------------------|
| Restyle HUD to non-diegetic *game* style (themed panels, game fonts, ocean palette, not the app's component kit) | **[T] M** | A game UI feels native via consistent themed chrome distinct from software UI. Lowest-risk first step: a civ-scoped CSS theme + game-styled panel components, keep the React structure. | UI-only; no bridge impact (the text bridge is the harness's UI). |
| Diegetic / spatial elements in the Phaser canvas (civ banners under colonies exist; add floating resource pips, build ghosts, selection rings, in-world quest markers) | **[D] M** | Diegetic/spatial UI (markers, rings, in-world labels) is what most separates a game from an app overlay. The renderer already does civ color rings/banners + particles/pulses — extend, don't rebuild. | Spatial markers mirror what the text bridge already lists (nearby_interactions) — they're the human view of the same data. |
| Game-feel polish: hover/click sfx, transitions, juicy feedback on buy/build/mine | **[D] S** | "Juice" is a large part of feeling game-native. Cheap, additive. | None. |
| Gemini-generated art replacing placeholder sprites (tiles/resources/accessories/morphs) | **[D] M** | PROJECT calls for Gemini image API assets. Replaces the Python placeholder pipeline (W7) for richer art; must match existing PNG sizes/sheet variant order (lockstep with `MORPHS`/`ACCESSORIES` in both Rust + TS — gotcha). | Asset-only; bridge is text, unaffected. |
| Store / economy / order panels styled as in-game menus (not settings forms) | **[T] M** | The new shop + civ-order UI are the biggest new surfaces; they must read as a game store, not a config dialog. Depends on cat 3/4/5. | The same actions are bridge verbs; UI is the human producer. |
| **[A]** Fully diegetic-only UI (all info in-world, no overlays) | **[A] —** | Looks immersive but hides strategy info a Civ-style game needs (resource totals, leaderboard). **Instead:** mix — non-diegetic HUD for numbers, diegetic/spatial for world interaction (standard pro practice: games mix UI types). |
| **[A]** Rebuilding the renderer/HUD from scratch for "game feel" | **[A] —** | The 3.5k-line canvas + 2.3k-line view are working and bridge-load-bearing. **Instead:** restyle + add layers; never break `render_game_to_text`/`civPilotControls` (PROJECT hard constraint). |

---

## Feature Dependencies

```
Currency layer (3)
   ├──requires──> distinct sinks (3) ──> Shop catalog (4) ──> Shop UI (7)
   ├──requires──> Fixed-price sell table (3)
   └──enables──> Trader NPCs (6), NPC quest rewards (6), breeding sink (3)

Richer resources/items (2)
   └──requires──> crafting recipes (2) ──requires──> tool tiers (2, mostly DONE)
                       └──enables──> consumable buff items (2) ──> Shop catalog (4)

Infinite chunk streaming (1)
   ├──requires──> deterministic lazy chunk gen (1) + chunked RenderTexture culling (W8, DONE)
   └──enables──> prospecting (1, W10.5), POIs (1), caves (1, W10.7)

Civ-level possession (5)
   ├──requires──> turn loop checks `controller` to bypass LLM (5)
   ├──reuses────> entity possession bridge (DONE), focusCiv camera (DONE), set_civ_controller (DONE)
   └──enables──> human use of Shop (4) + civ orders + diplomacy panel (5)

Game-native UI (7) ──enhances──> all human-facing features (4,5)
Gemini assets (7) ──enhances──> renderer (independent, parallelizable)

Text bridge parity (cross-cutting) ──must extend──> currencies, shop catalog, sell/purchase/craft/terraform/tame verbs, civ-controller
```

### Dependency Notes
- **Shop requires the currency layer:** a catalog needs something to cost. Currency + sinks must land before/with the shop. This makes **Economy the critical-path first phase** for the human-play half.
- **Crafting requires the resource/item taxonomy widening** (`known_resource` is the validation gate); recipes then ride on the existing `tech_cost`/`building_cost` machinery.
- **Civ-level possession reuses far more than it builds** — the action schema, controller tag, camera, and entity-possession bridge already exist. The genuinely new piece is one branch in the turn loop. Low risk, high payoff; can land early to make the economy/shop *playable by a human* immediately.
- **Infinite world is the most independent track** — it doesn't need economy/shop and can be built in parallel; but it's the heaviest (L) due to deterministic lazy generation.
- **Parity is not a separate feature** — it's a checklist item *inside each phase*: every new human verb (sell/buy/craft/terraform/tame/civ-order) must also be a `CivDecisionAction` and appear in `render_game_to_text`.

## MVP Definition

### Launch With (v2.1 core)
- [ ] **Currency layer + ≥5 role-segmented currencies + fixed-price selling + matching sinks** — the spine of "economy"; everything human-facing hangs off it; deterministically testable.
- [ ] **Shop/store with categorized catalog (buffs/resources/buildings/items) + gating** — the primary currency sink and the headline human surface.
- [ ] **Civ-level possession (bypass LLM via `controller`) + a coherent player control scheme** — without this the economy/shop has no human to use it; cheap because plumbing exists.
- [ ] **Resource/item taxonomy widening + a small crafting cascade (2–3 tiers, ~12 items)** — gives the shop/economy things worth buying and gathering.
- [ ] **Bridge parity for every new verb** (sell/buy/craft/civ-order) — non-negotiable PROJECT constraint.

### Add After Validation (v2.1 polish)
- [ ] **Infinite chunk streaming + prospecting + POIs** — big exploration win; can ship after the economy loop proves out (heaviest track).
- [ ] **Trader / quest-giver / fauna-handler NPCs** — extend the existing task system; reputation currency sink/faucet.
- [ ] **Game-native UI restyle + diegetic markers + Gemini assets** — makes it *feel* like a game once the systems exist.
- [ ] **Caves (W10.7), structure blueprints (W10.4), fBm terrain (W10.6)** — world depth.

### Future Consideration (v2.2+)
- [ ] **Dynamic supply/demand markets** — deliberately deferred; fixed prices first (PROJECT decision).
- [ ] **Tameable fauna ranching economy** — if fauna handlers prove fun.
- [ ] **Branching NPC narrative** — only if a story layer is ever wanted.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Currency layer + 5 currencies + fixed-price sell + sinks | HIGH | MEDIUM | P1 |
| Shop/store catalog + UI + gating | HIGH | MEDIUM | P1 |
| Civ-level possession (LLM bypass) + control scheme | HIGH | MEDIUM | P1 |
| Resource/item taxonomy + crafting cascade | HIGH | MEDIUM | P1 |
| Bridge parity for new verbs | HIGH (constraint) | LOW | P1 |
| Infinite chunk streaming + lazy gen | MEDIUM-HIGH | HIGH | P2 |
| Prospecting / POIs / discovery loop | MEDIUM | MEDIUM | P2 |
| Trader / quest-giver / fauna-handler NPCs | MEDIUM | MEDIUM | P2 |
| Game-native UI restyle + diegetic markers | MEDIUM | MEDIUM | P2 |
| Gemini-generated assets | MEDIUM | MEDIUM | P2 |
| Caves / blueprints / fBm terrain | LOW-MEDIUM | MEDIUM | P3 |
| Dynamic markets | LOW (this milestone) | HIGH | P3 (defer) |

## Competitor Feature Analysis

| Feature | Genre exemplar A | Genre exemplar B | Our approach (grounded in existing engine) |
|---------|------------------|------------------|--------------------------------------------|
| Multi-currency economy | F2P soft/hard split (Machinations) | MMO sinks via trade tax/AH cut | 5 role-segmented currencies (Shells/Pearls/Spawn/Crystals/Reputation), fixed-price sell, costed sinks; **deterministic + unit-testable** balance (our edge) |
| Procedural world | Minecraft (16×16 chunk streaming, biome blend) | Terraria (handcrafted-feel POIs) | Deterministic lazy chunks keyed `(seed,chunkX)` + seeded POIs + prospecting; reuse chunked RenderTexture culling |
| Crafting/tools | Survival-craft tier cascades | JRPG satisfying-craft | 2–3 tier cascade on existing tech tree; every unlock changes play; reuse done tool-tier mining gating |
| Human takeover | Civ (total control) / Age of Empires (lead one civ) | God games (indirect NPC influence) | Civ-level orders (god indirection) + single-unit possession (RTS hands-on), both via existing action schema; competes fairly with AI civs |
| Shop | Moonlighter/Recettear (buy→play→sell feedback) | Shop-sims (furniture buffs) | Functional catalog (buffs/buildings/items), gated by era/tech/Pearls; one `purchase` verb for human ⟂ harness |
| NPCs | RTS neutral traders | Quest-giver RPGs | Neutral traders + extend the **existing** task/quest framework; deterministic scripted, no per-NPC LLM |
| Game UI | Diegetic (Dead Space) | Mixed HUD (Uncharted) | Mixed: non-diegetic HUD for strategy numbers + diegetic/spatial markers in canvas; restyle, don't rebuild |

## Sources

Genre / game-design literature (MEDIUM confidence — design patterns, not engine facts):
- [Game economy inflation: foresee & overcome — Machinations.io](https://machinations.io/articles/what-is-game-economy-inflation-how-to-foresee-it-and-how-to-overcome-it-in-your-game-design)
- [Currencies in game economy loops — Game Developer](https://www.gamedeveloper.com/business/currencies-in-game-economy-loops)
- [A 7-Step Framework for Game Economy Design — Game Dev Essentials](https://gamedevessentials.com/a-7-step-framework-for-game-economy-design/)
- [Keys to Economic Systems — GDKeys](https://gdkeys.com/keys-to-economic-systems/)
- [World generation — Minecraft Wiki](https://minecraft.wiki/w/World_generation)
- [The Future of World Generation — Hytale](https://hytale.com/news/2026/1/the-future-of-world-generation)
- [7 crafting systems game designers should study — Game Developer](https://www.gamedeveloper.com/design/7-crafting-systems-game-designers-should-study)
- [Pathways to Mastery: Taxonomy of Player Progression Systems — IntechOpen](https://www.intechopen.com/online-first/1221745)
- [Examining Gating in Game Design — Game Developer](https://www.gamedeveloper.com/design/examining-gating-in-game-design)
- [The Balance of Game Design of Shop Simulators — Game Wisdom](https://game-wisdom.com/critical/surprising-success-shop-simulators)
- [Games That Let You Play As A God — Game Rant](https://gamerant.com/games-that-let-you-play-god/)
- [Diegetic vs Non-Diegetic UI: 4-Type Framework — Nasty Rodent](https://nastyrodent.com/diegetic-and-non-diegetic-ui/)
- [User interface design in video games — Game Developer](https://www.gamedeveloper.com/design/user-interface-design-in-video-games)

Engine reality (HIGH confidence — read directly from source):
- `tauri-app/src-tauri/src/civilization.rs` — `known_resource` (15 keys), `known_tech` (7-tech tree), tool-tier mining (`mining_tier`/`required_mining_tier`), `apply_trade`, NPC task kinds (`fetch`/`trade`/`visit`/`repair`/`rescue`/`build_bridge`), `set_civ_controller` + `controller` field, predators as neutral entities
- `tauri-app/src/lib/civPilot.ts` — full possession/control bridge: text-state shape, task-loop decision logic, oxygen/blocked/hazard, `civs[]`/`leaderboard`/`controller` in bridge
- `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx` — `possessedEntityId`, `control_mode: released|manual|codex`, `renderSnapshotToText`, chunked-render plan
- `tauri-app/src/components/civilization/CivilizationView.tsx` — current app-chrome HUD (lucide + shared ui kit)
- `civ-multi-civ-world-plan.md` (W10.3–W10.7) and `.planning/PROJECT.md` (v2.1 targets + constraints)

---
*Feature research for: axolotl civilization / colony-economy game (human ⟂ agentic parity)*
*Researched: 2026-06-07*
</content>
