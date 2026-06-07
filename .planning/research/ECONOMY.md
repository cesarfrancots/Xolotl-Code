# Economy & Shop Design — Milestone v2.1 "Living World & Economy"

**Researched:** 2026-06-07
**Mode:** Deep design (opinionated defaults the team can tune)
**Status:** NET-NEW system — `currency` / `shell` / `economy` are 0 code refs today. Everything here is greenfield, but every number is grounded in the **actual** existing resource/building/tech set in `tauri-app/src-tauri/src/civilization.rs`.

---

## 0. Grounding: what already exists (verified in code)

These are the real game objects the economy must price. Confirmed by reading `civilization.rs`:

**15 resources** (`known_resource`, L4500): `food`, `clean_water`, `wood`, `stone`, `clay`, `fiber`, `tools`, `glowshards`, `kelp`, `ore`, `ice`, `coral`, `sulfur`, `amber`, `herbs`.

- **Renewable** (regrow via `resource_regrowth`): `food` (from moss), `clean_water`, `wood`, `fiber`, `kelp`, `herbs`.
- **Finite minerals** (`is_finite_mineral`, L4469 — deplete the block, flood to water): `stone`, `clay`, `ore`, `sulfur`, `coral`, `glowshards`, `amber`, `ice`.
- **Crafted** (not gathered): `tools`.

**Mining-tier gating** (`required_mining_tier`, L4492): tier 1 = stone/clay/ice (bare claws); tier 2 = ore/sulfur/coral (needs `stone_tools`); tier 3 = glowshards/amber (needs `metal_tools`). **This rarity ladder is the spine of the price table below** — I price strictly along it so prices are *legible* (deeper = rarer = dearer).

**5 buildings** (`building_cost`, L4226): `nest`, `storage`, `farm`, `workshop`, `canal`.
**7 techs** (`tech_cost`, L4250): `moss_farm`, `stone_tools`, `water_filter`, `council`, `workshop_craft`, `canal_network`, `metal_tools`.
**Eras** (`advance_era_if_ready`): `pond_camp` → `tool_pond` → `canal_village`.
**Score axes** (`score_civilization`, L4173): `survival` (0.35) + `ethics` (0.35) + `intelligence` (0.30). Resource hoarding already feeds `intelligence` weakly (`resources.values().sum()/8.0`, capped at 22). **Currency should NOT feed score directly** (anti-hoard; see §4).

**Action bridge** (`validate_action` L2207 / `apply_model_decision` L2330): `gather`, `build`, `research`, `explore`, `policy`, `prepare`, `claim`, `attack`/`raid`, `diplomacy`, `trade` (civ↔civ resource swap, totals-conserving). Economy adds exactly **two** verbs: `sell` and `shop_buy` (§5) — additive, never breaking the existing surface.

**Existing trade** (`apply_trade`, L4420) is barter between civs (food-for-stone), conserves totals, blocked by `hostile`. The shop is the *opposite*: a non-civ sink/faucet that mints and burns currency at fixed prices. Both coexist.

---

## 1. Currencies

**Why 5+ and not 1:** A single currency collapses every decision into one fungible pile — selling amber and selling moss become the same lever, and the "deep mining is special" feeling (already coded via tool tiers) evaporates. Multi-currency is the standard pattern (soft / hard / medium, + faction + prestige) because **non-interchangeable currencies gate distinct progression tracks and make hoarding one pile useless for another goal** ([Windrose faction design](https://thegameswiki.com/windrose/wiki/faction-merchants), [game economy primer](https://machinations.io/articles/game-economy-design-free-to-play-games)). Each currency below has a **distinct source, distinct sink, and distinct rarity tier** — no redundancy.

| # | Currency | Theme | Tier | What it's FOR (sole use) | EARNED (faucet) | SPENT (sink) | AI auto-earns? |
|---|----------|-------|------|--------------------------|-----------------|--------------|----------------|
| 1 | **Shells** 🐚 | base trade coin | Common (soft) | Everyday buying: resources, basic tools, common buffs | Sell **renewable** surplus (food/water/wood/fiber/kelp/herbs) + tier-1 minerals to the shop; small per-turn stipend | Resources, common consumable buffs, basic tools (§3 A/B/D) | **Yes** — passively from selling surplus each turn |
| 2 | **Pearls** ◍ | premium hard currency | Rare | High-value goods: buildings, blueprints, permanent buffs, prestige tools | Sell **deep minerals** (glowshards/amber/coral/ore) + boss/disaster-survival rewards; rare drop from mining | Buildings, permanent buffs, advanced tools (§3 C/E) | **Yes** — but slowly (only from deep mining, which is tool-gated) |
| 3 | **Tidewardens' Favor** 🛡 | faction / reputation | Medium, **non-bankable** | Faction-exclusive catalog (rescue gear, NPC-only buffs, quest goods) | NPC quests + helping wild fauna/other civs (`task_interactions`, diplomacy `ally`, `protect_vulnerable` policy) | NPC-vendor-only items (§3 F); rank-gated tiers | **Partial** — earns via ally/protect-vulnerable; can't buy raw |
| 4 | **Spawn** (Spore-tokens) 🌱 | crafting / material token | Common-uncommon | Crafting & upgrading material-tech: tool tiers, building upgrades, recipe unlocks | Earned by *processing* at a `workshop` (convert raw → token); disaster cleanup | ONLY crafting/upgrade recipes (§3 E); never raw resources | **Yes** — auto from workshop throughput |
| 5 | **Ancient Amberglass** 🔶 | prestige / long-game | Ultra-rare | End-game prestige unlocks: era leaps, world-scale wonders, cosmetic morphs, legacy buffs | Reach `canal_village` era; survive N disasters; win combats; **age out** of low currencies (sink-to-prestige conversion) | Wonders, prestige-only catalog (§3 G); 1 purchase = a run-defining swing | **Yes** — but only at high era; rewards long survival |

**Redundancy check (each is irreplaceable):**
- Shells buy *volume*; Pearls buy *value* — you can't shell-grind your way to a building (no Pearl→Shell or Shell→Pearl exchange; see anti-exploit §4).
- Favor is **non-bankable** (decays / is rank-locked like [Sea of Thieves / Windrose rep](https://thegameswiki.com/windrose/wiki/faction-reputation)) so you can't stockpile it; it *must* be spent at NPC vendors and unlocks gear no other currency can.
- Spawn-tokens are a **closed loop with crafting** — they can ONLY be made by a workshop and ONLY spent on upgrades, so they reward building infrastructure, not raw extraction.
- Amberglass is **deliberately illiquid**: a slow trickle that you bank for one big late swing, the classic prestige layer.

**The one allowed conversion (a sink, not an exchange):** you may *burn* surplus low currency UP the ladder at a punitive rate (Shells→Pearls 100:1, Pearls→Amberglass 50:1) — never downward. This is an anti-hoard sink (§4), not a liquidity market.

---

## 2. Resource → Currency Sell Prices

**Design stance: FIXED base prices, season multiplier optional and small.** Fixed prices are *legible* — an AI civ (and a human) can reason "amber is worth 12 shells" without modeling a market. Academic colony-sim work confirms fixed pricing (FMar=0) is the low-variance choice vs. flexible (FMar=0.5) ([market sim paper](https://arxiv.org/pdf/1412.6924)); colony games like RimWorld also use mostly-fixed vendor prices with small location modifiers. We keep prices fixed and add **only a ±20% seasonal band** (optional, off by default) so the world feels alive without breaking planability.

Prices follow the **tool-tier rarity ladder** already in code — the dominant balancing principle. Renewables are cheap (they regrow); finite minerals scale with mining tier; deep minerals pay **Pearls**, not Shells, so they're a separate faucet.

### A. Renewables & tier-1 → **Shells** (the bread-and-butter faucet)

| Resource | Tier | Sell price | Currency | Rationale |
|----------|------|-----------|----------|-----------|
| `food` | renewable | **1 shell / 2 units** | Shells | Cheapest; civ needs it to survive (don't incentivize selling your food away — half-coin) |
| `clean_water` | renewable | **1 / 2** | Shells | Same survival-good logic |
| `moss`→`food` | renewable | 1 / 2 | Shells | Yields food, priced as food |
| `fiber` | renewable | **1 / unit** | Shells | Abundant, light value |
| `kelp` | renewable | **1 / unit** | Shells | Coastal staple |
| `herbs` | renewable | **2 / unit** | Shells | Buff ingredient (see medicine buffs) |
| `wood` | renewable | **2 / unit** | Shells | Building staple |
| `stone` | tier 1 finite | **3 / unit** | Shells | Finite but shallow/common |
| `clay` | tier 1 finite | **3 / unit** | Shells | Finite, shallow |
| `ice` | tier 1 finite | **3 / unit** | Shells | Finite, seasonal (winter glut → season modifier shines here) |
| `tools` | crafted | **6 / unit** | Shells | Embeds labor; selling tools back is a partial refund |

### B. Mid & deep minerals → **Pearls** (the premium faucet, tool-gated)

| Resource | Tier | Sell price | Currency | Rationale |
|----------|------|-----------|----------|-----------|
| `ore` | tier 2 (needs stone_tools) | **2 ore → 1 Pearl** | Pearls | First premium tier; gated by tech so it can't be early-rushed |
| `sulfur` | tier 2 | **2 → 1 Pearl** | Pearls | Same tier |
| `coral` | tier 2 | **3 → 2 Pearls** | Pearls | Slightly dearer (also a build material) |
| `glowshards` | tier 3 (needs metal_tools) | **1 → 2 Pearls** | Pearls | Deepest, rarest by code (`seed_underground_veins` deep band is "fewer + richer") |
| `amber` | tier 3 | **1 → 3 Pearls** | Pearls | Rarest, highest unit value |

**Why two faucets, not one big price?** Because earning Pearls *requires* having climbed the tech tree (`metal_tools`) and dug deep — exactly the progression the world already gates. A new civ literally cannot mint Pearls until it invests, which paces the premium economy automatically. No artificial gate needed; the existing `required_mining_tier` IS the gate.

### C. Season modifier (optional, OFF by default)

If enabled: `final_price = round(base × season_mult)`, `season_mult ∈ {summer:1.0, autumn:1.1, winter:1.2(ice→0.8), spring:0.9}` clamped to ±20%. Rationale: keep it *small* so AI planning stays valid; let `ice` swing most (winter glut) for flavor. **Default OFF** for v2.1 launch — ship legible fixed prices first, add the season band as a tuning knob once balance is proven.

---

## 3. Shop Catalog

Concrete goods across categories. Buffs map onto the **existing `CivModifier` system** (already in code — currently observer-only; the shop becomes a *second* trigger for it, no new buff engine needed). Buildings/techs reuse existing `build`/`research` definitions. Prices chosen so a mid-game civ affords ~1 building or ~3 consumables per "shopping trip" (see §4 pacing).

### A. Consumable Buffs (temporary `CivModifier`, N-turn duration) — **Shells**

| Item | Effect (modifier) | Duration | Price | Notes |
|------|-------------------|----------|-------|-------|
| Current-Ride Kelp | +50% movement/work speed (`speed` mod) | 4 turns | **18 shells** | Mirrors `forage_yield`/`speed` gene buffs |
| Forager's Feast | +40% gather yield (`abundant_moss`-style) | 4 turns | **20 shells** | Reuses existing `abundant_moss` modifier hook |
| Warmblood Tonic | +cold resistance (counters ice_age death roll) | 6 turns | **24 shells** | Pairs with `cold_tolerance` selection pressure (W5) |
| Herbal Poultice | +health regen, cures plague debuff | 3 turns | **22 shells** | Consumes `herbs` thematically; counters `plague` disaster |
| Calm Waters | +morale, suppresses `quarrel_pressure` | 5 turns | **16 shells** | Cheap morale floor |
| Clean-Flow Charm | clean_water decay −50% | 6 turns | **20 shells** | Counters `drought` |

### B. Resources (instant top-up, anti-stall) — **Shells**

| Item | Grants | Price | Notes |
|------|--------|-------|-------|
| Ration Crate | +20 food | **8 shells** | Emergency famine relief; priced ABOVE sell (4 shells) so it's a sink not arbitrage |
| Water Barrel | +20 clean_water | **8 shells** | Same |
| Timber Bundle | +15 wood | **24 shells** | Bypass slow harvest |
| Stone Pallet | +15 stone | **36 shells** | Bypass mining |
| Fiber Spool | +15 fiber | **12 shells** | — |

**Buy > sell always** (Ration buys at 8 for 20 food = 0.4/food; sells at 0.5/food). The gap is the shop's spread — kills buy-low-sell-high arbitrage (§4).

### C. Buildings (instant placement) — **Pearls**

| Item | Effect | Price | Notes |
|------|--------|-------|-------|
| Prefab Storage | instant `storage` (no resource cost) | **6 Pearls** | vs. wood7+clay4 build; convenience premium |
| Prefab Farm | instant `farm` | **10 Pearls** | — |
| Prefab Workshop | instant `workshop` | **14 Pearls** | Unlocks Spawn-token crafting (§4) |
| Prefab Canal | instant `canal` | **12 Pearls** | — |
| Tide Palisade | instant fortify (defense building) | **16 Pearls** | Ties to W6 combat; Pearl-gated so it's a real investment |

### D. Tools & Items (mining/digging/harvesting/growing) — **Shells (basic) / Pearls (advanced)**

| Item | Effect | Price | Currency |
|------|--------|-------|----------|
| Stone Pick | +1 mining batch yield, tier-2 capable | **30 shells** | Shells |
| Harvest Sickle | +1 worker-equivalent on renewables | **24 shells** | Shells |
| Tide-Tiller (growing) | +1 regrowth speed on owned tiles | **40 shells** | Shells |
| Metal Drill | tier-3 capable, +2 mineral yield | **8 Pearls** | Pearls |
| Prospector's Lens | reveals deep `strata_report` (W10.5) | **6 Pearls** | Pearls |
| Dredge Net | bulk-harvest kelp/coral in radius | **5 Pearls** | Pearls |

### E. Crafting & Upgrades — **Spawn-tokens** (closed loop)

| Item | Effect | Price | Notes |
|------|--------|-------|-------|
| Smelt Recipe → `tools` | craft 3 tools without a workshop turn | **4 Spawn** | The token sink |
| Stone-Tools Unlock | instant `stone_tools` tech | **8 Spawn** | Alt path to tech tree |
| Metal-Tools Unlock | instant `metal_tools` tech | **18 Spawn** | Gated high |
| Storage Upgrade Mk2 | +50% resource cap | **12 Spawn** | New mechanic; pairs w/ storage |
| Building Reinforce | +building HP (combat) | **10 Spawn** | Ties to W6 |

Spawn-tokens are **minted only by a workshop** (e.g. 1 token per 10 raw resources processed/turn) and **spent only here** — a self-contained craft economy that rewards infrastructure, not extraction.

### F. NPC / Faction Vendor — **Tidewardens' Favor** (rank-gated)

| Item | Effect | Rank | Price | Notes |
|------|--------|------|-------|-------|
| Rescue Harness | speeds `rescue_object` tasks | 1 | **20 Favor** | Ties to existing rescue tasks |
| Beacon Charm | wild fauna won't aggro 3 turns | 1 | **25 Favor** | Counters predators |
| Trade-Tongue | +1 civ↔civ trade per turn | 2 | **40 Favor** | Buffs existing `apply_trade` |
| Wardens' Banner | permanent +morale floor | 3 | **70 Favor** | Rep-gated prestige-lite |
| Migrant Caravan | found a satellite nest (W6 `migrate`) | 3 | **90 Favor** | Expansion via rep, not war |

Favor is **rank-gated** (Rank N unlocks tier N) exactly like [faction vendors](https://www.keengamer.com/articles/guides/windrose-factions-guide-all-vendor-items-and-best-leveling-order/) — you must *do faction activity* (quests, allying, protecting vulnerable) to access higher shelves. Non-bankable: Favor caps at a soft ceiling and the top items are rank- not pile-gated.

### G. Prestige / Wonders — **Ancient Amberglass**

| Item | Effect | Price | Notes |
|------|--------|-------|-------|
| Era Leap | skip to next era instantly | **3 Amberglass** | Huge swing; ultra-rare currency |
| The Great Reef (Wonder) | +permanent forage_yield for whole civ | **8 Amberglass** | Run-defining |
| Tidemother's Blessing | civ-wide disaster resistance | **6 Amberglass** | Long-game payoff |
| Legacy Morph (cosmetic) | unlock a rare visible morph/pattern | **4 Amberglass** | Cosmetic; pairs w/ W5 genetics |
| Ancestral Vault | bank survives colony collapse | **10 Amberglass** | Meta-prestige across runs |

---

## 4. Acquisition & Balance

**Core ratio (the load-bearing number): a healthy mid-game civ nets ~10–15 shells/turn from surplus selling.** Derivation: ~8 workers, gathering ~3/worker/turn (`rate = workers*3`, L2431) ≈ 24 raw/turn; after self-consumption (food/water for population), ~15–25 *surplus* units sellable at ~0.5–1 shell each ≈ **10–15 shells/turn**. Calibrate all Shell prices against this:

| Good | Price | Turns to afford (mid-game) | Intended feel |
|------|-------|----------------------------|---------------|
| Consumable buff (~18–24) | ~20 | ~1.5 turns | Impulse buy, frequent |
| Basic tool (~24–40) | ~30 | ~2.5 turns | Occasional |
| Resource crate (~8) | 8 | <1 turn | Emergency, cheap |
| Prefab building (6–16 **Pearls**) | — | Pearls are slow → many turns | Milestone purchase |

**Per-turn stipend (faucet floor):** every alive civ auto-gains **+2 shells/turn** baseline so even a struggling civ can buy a Ration Crate eventually (anti-death-spiral). Pearls have **no stipend** — they must be earned by deep mining (keeps premium scarce).

### Early / Mid / Late pacing

- **Early (`pond_camp`, no stone_tools):** Shells only. Can't mint Pearls (no tier-2 mining). Buys: ration/water crates, cheap morale buffs. Economy is a survival cushion. ~5–10 shells/turn.
- **Mid (`tool_pond`, stone/metal tools):** Pearls unlock. Sell ore/coral → buy prefab buildings, advanced tools. Spawn-tokens flow once a workshop exists. Favor accrues from diplomacy. ~15 shells + a trickle of Pearls/turn.
- **Late (`canal_village`):** Amberglass unlocks. Civ banks the slow prestige currency for an Era Leap / Wonder. Shells become trivial (intentional — soft currency saturates late, that's the cue to spend up the ladder).

### Sinks to prevent hoarding / inflation

1. **Buy/sell spread** — shop always buys back below sell (e.g. food sells 0.5, Ration buys 0.4/food). No risk-free arbitrage loop.
2. **No downward exchange** — can't convert Pearls→Shells, so you can't dump premium into soft-currency inflation.
3. **Upward burn sink** — surplus Shells→Pearls at a *punitive* 100:1, Pearls→Amberglass 50:1. This is a deliberate money-burner that removes excess soft currency from circulation (the classic faucet/sink discipline — [economy balance](https://medium.com/@msahinn21/designing-game-economies-inflation-resource-management-and-balance-fa1e6c894670)).
4. **Currency does NOT feed score** — unlike raw resources (which weakly feed `intelligence`), banked currency is worth 0 score. Hoarding is strictly worse than spending. Removes the incentive to sit on piles.
5. **Consumable buffs expire** — most valuable Shell sinks are temporary, creating recurring demand (the renewable sink).
6. **Favor is non-bankable** (rank- not pile-gated) and **Amberglass is illiquid** (one big purchase, not many) — neither inflates.

### Anti-exploit rules for fixed-price selling

- **Per-turn sell cap** (e.g. ≤40 units/turn/civ) so a civ can't liquidate a giant stockpile in one turn and crash its own economy / mint infinite currency.
- **Buy-price > sell-price always** (the spread) — kills the buy-cheap-sell-dear loop entirely.
- **Finite minerals can't be bought back** as raw (only as crates at a markup) — you can't launder Pearls back into ore to re-sell.
- **Stipend + sell are the only Shell faucets**; both are bounded per turn. No unbounded source exists.
- **Deterministic, seeded rounding** — prices are integers; fractional sells round *down* (house edge), keeping the engine deterministic (a hard constraint of this codebase).

---

## 5. Agent + Human Parity

The whole point of this milestone: **an AI civ and a human-possessed civ must play the identical economy.** The codebase already has the bridge — economy is purely additive.

### State exposure in `render_game_to_text()`

The text-state already carries per-civ `resources: Record<string, number>` (see `CivPilotTextState.civs[].resources`, civPilot.ts L107). **Add a sibling `wallet` map per civ** so currency is symmetric with resources:

```jsonc
"civs": [{
  "id": "civ-1", "controller": "human" | "model" | null,
  "resources": { "food": 42, "ore": 8, ... },
  "wallet": { "shells": 37, "pearls": 4, "favor": 12, "spawn": 6, "amberglass": 0 }
}],
"shop": {                          // NEW top-level block, identical for AI + human
  "sell_prices": { "ore": {"currency":"pearls","ratio":[2,1]}, "food": {"currency":"shells","ratio":[1,2]}, ... },
  "catalog": [ { "id":"current_ride_kelp","category":"buff","currency":"shells","price":18,"effect":"+50% speed 4t" }, ... ],
  "favor_rank": 2,                 // gates which catalog rows are buyable
  "sell_cap_remaining": 40
}
```

This means the AI's `build_observation` prompt and the human's shop UI read from the **same source of truth**. The human store UI is just a rendering of `shop.catalog`; the AI sees the catalog as text. Neither has information the other lacks.

### Control bridge: two new verbs (symmetric)

Both surfaces funnel into the **same backend functions**, exactly like `gather`/`trade` do today:

1. **AI / model path** — extend `validate_action` + `apply_model_decision` (L2207 / L2330) with:
   - `{"type":"sell","resource":"ore","amount":6}` → mints currency per §2 price, decrements resource, respects sell-cap.
   - `{"type":"shop_buy","item":"current_ride_kelp"}` (or `"building":"prefab_farm"`) → checks `wallet`, burns currency, applies effect (a `CivModifier`, a building, a resource grant, or a tech).
   - These join the existing 10 action types; zero changes to the others.

2. **Human path** — `civPilotControls` already has `interact` / `advance_turn` / `possess`. Add:
   - `civPilotControls.sell(resource, amount)` and `civPilotControls.buy(itemId)` → call the **same** Tauri command the AI action dispatches to. The human store UI buttons call these; the harness (`codex-play-civ.mjs`) can call them too.
   - A human-possessed civ's `sell`/`buy` and an AI civ's `sell`/`shop_buy` action resolve through **one** `apply_shop_transaction()` function — guaranteeing identical prices, caps, and effects.

3. **Harness parity (`codex-play-civ.mjs`)** — the existing `CivPilotDecision` union (civPilot.ts L19) gains `{action:"sell"|"buy"; itemId; amount}` so the scripted/LLM driver can transact through the same text-bridge it already uses for move/interact/advance_turn. The `render_game_to_text` shop block gives it everything it needs to decide.

**Parity guarantee:** there is exactly one pricing table (Rust `sell_prices`/`catalog`), one transaction function, one sell-cap counter. UI and AI are thin clients over it. This is the same discipline that kept v2.0's arena bridge symmetric.

---

## 6. Open Questions / Tuning Knobs

| Knob | Default | Range to tune | Risk if wrong |
|------|---------|---------------|---------------|
| Shells/turn net (the anchor) | ~10–15 | 5–25 | Too high → buffs trivial; too low → shop feels dead |
| Per-turn stipend | +2 shells | 0–5 | Too high → no scarcity early |
| Ore→Pearl ratio | 2:1 | 1:1–4:1 | Sets premium-currency velocity |
| Spawn-token mint rate | 1 per 10 processed | 1:5–1:20 | Controls craft-economy speed |
| Season price band | OFF (±20% if on) | ±0–30% | On → less legible AI planning |
| Per-turn sell cap | 40 units | 20–100 | Anti-dump; too low frustrates |
| Amberglass earn rate | era + survival milestones | — | Too fast → prestige loses weight |
| Favor soft ceiling | rank-gated | — | Bankable rep = inflation |
| Upward-burn rates | 100:1 / 50:1 | punitive | Too cheap → reintroduces fungibility |

**Unresolved for requirements author:**
1. **Does selling a resource cost a worker-turn (an action) or is it free bookkeeping?** Recommend: `sell` is a free bookkeeping action (doesn't consume a worker), so it doesn't compete with gather — but it counts against the per-turn sell cap. Tune if it trivializes.
2. **Should the shop be a physical building/NPC the civ must reach, or an ambient menu?** Recommend ambient menu for AI legibility (no pathing tax), but a physical "Trading Post" NPC could gate Favor purchases (you must reach a Tidewarden). This dovetails with the NPC workstream.
3. **Do currencies persist across runs (Ancestral Vault)?** Only Amberglass, and only if the Vault is bought — keep all others run-scoped.
4. **Combat looting → currency?** Recommend raids loot *resources* (already coded) not currency, to keep currency faucets clean; convert looted resources via normal selling.

---

## Sources

- [Game economy design: soft/hard/medium currency, faucet/sink ratio, prestige](https://machinations.io/articles/game-economy-design-free-to-play-games) — MEDIUM
- [Designing game economies: inflation, sinks, balance](https://medium.com/@msahinn21/designing-game-economies-inflation-resource-management-and-balance-fa1e6c894670) — MEDIUM
- [Faction reputation as non-bankable, rank-gated currency (Windrose)](https://thegameswiki.com/windrose/wiki/faction-merchants) / [vendor tiers](https://www.keengamer.com/articles/guides/windrose-factions-guide-all-vendor-items-and-best-leveling-order/) — MEDIUM
- [Why separate currencies prevent hoarding (faction rep design)](https://thegameswiki.com/windrose/wiki/faction-reputation) — MEDIUM
- [Fixed vs flexible pricing in economic sims (FMar 0 vs 0.5)](https://arxiv.org/pdf/1412.6924) — MEDIUM
- [Colony-sim economies: Stardeus market/merchants, Prosperous Universe](https://store.steampowered.com/app/1761220/Prosperous_Universe/) — LOW (flavor reference)
- **Codebase (HIGH, primary):** `tauri-app/src-tauri/src/civilization.rs` — resource set (L4500), finite/renewable split (L4469), mining tiers (L4492), building/tech costs (L4226/L4250), scoring (L4173), action bridge (L2207/L2330), civ↔civ trade (L4420); `tauri-app/src/lib/civPilot.ts` — text-state shape (L60–119) & control decisions (L19); `tauri-app/scripts/codex-play-civ.mjs` — harness bridge (`civPilotControls`, L869).
