# Pitfalls Research — Milestone v2.1 "Living World & Economy"

**Domain:** Adding economy + ≥5 currencies, shop/store UI, civ-level human possession (LLM bypass), infinite procedural world, items/crafting, NPCs, Gemini asset pipeline, and a game-native UI to an EXISTING deterministic seeded Rust civ engine (`civilization.rs`, 10K LOC) + Phaser/React frontend + tauri-specta IPC + an AI-harness arena bridge.
**Researched:** 2026-06-07
**Confidence:** HIGH on integration/determinism/back-compat pitfalls (read directly from `civilization.rs`, `tauriBrowserFallback.ts`, v2.0 RETROSPECTIVE); MEDIUM on economy-balance and Gemini-pipeline specifics (domain knowledge + game-economy literature, not codebase-verified).

> These are pitfalls for adding THESE features to THIS codebase — not generic game-dev advice. Architectural facts grounding them, verified in the tree:
> - **RNG is a hand-rolled xorshift LCG over a `u32`** (`next_rng`, line 5106), seeded by an FNV-1a hash of the session id (`seed_from`, line 5097), with **per-subsystem salts** (`0x5EAB_ED01` biome layout, `0x9E37_79B9` turn shuffle, `0xBADD_CA75` predators). RNG state is **threaded by reference and consumed in a strict order** — comments explicitly note founders must consume rng before veins "so the founder rng stays unperturbed" (line 1332). Determinism is positional: insert a draw anywhere and everything downstream shifts.
> - **World is a fixed-size flat `Vec<CivTile>`** of `width × height`; `WORLD_WIDTH=128`, `WORLD_HEIGHT=96`, width scales with civ count up to a cap (`world_width`, line 1198). **The entire tile vector is serialized into every `CivSessionSnapshot`** (line 312, 330).
> - **Saves are `serde_json` with `SCHEMA_VERSION=2`**, `#[serde(default)]` on nearly every field, an explicit `migrate_value_in_place` (v1→v2, line 4945) + `backfill_snapshot` (line 4981), and vitest locking legacy text keys byte-identical. This is the established back-compat machinery.
> - **Currencies already have a home:** `CivCivilization.resources: HashMap<String, i32>` (line 510). Adding currencies = adding keys, not a new schema.
> - **The turn loop calls the model for EVERY living civ** (`advance_civ_turn`, line 874 — `for civ_id in &turn_order { … call_model_text(…).await? }`). There is **no "skip the LLM" branch today.** Possession must inject one.
> - **`controller: Option<String>` already exists** on every civ (line 516) and is surfaced in the leaderboard + text state for ARENA-03 attribution, set via `set_civ_controller` (line 817). Possession should extend this, not invent a parallel control concept.
> - **`tauriBrowserFallback.ts` is NOT a faithful re-implementation** of the engine — it's a `mockIPC` browser-preview that builds a tiny hand-authored `PREVIEW_WORLD` (line ~211, ~479). It diverges from the engine by design; "keep in lockstep" means *keep the IPC contract + observable behavior aligned*, not *port the xorshift world-gen*.
> - **Backend cannot run tests on Windows** (WebView2) — verified via `cargo check`/`clippy --pedantic -D warnings`/`cargo test --no-run` + frontend `tsc`/vitest. Determinism is therefore proven by *unit tests on pure helpers*, which only run in CI (Linux/macOS). A determinism break can ship green on a Windows dev box.

---

## Critical Pitfalls

Mistakes that cause rewrites, corrupt saves, break the arena bridge, or silently destroy reproducibility.

---

### Pitfall 1: Infinite-world determinism break — positional RNG corruption

**What goes wrong:**
The "infinite procedural world" (fBm terrain, caves, prospecting, terraform/place) is bolted onto `generate_world`/`seed_underground_veins`, and a new draw (`next_rng(&mut rng)`) is inserted into the *existing shared rng stream*, or new chunk-gen reuses the same `&mut rng` the founders/veins consume. Every downstream draw shifts by one. The same seed now produces a different world; the GEN-02 "mean cold_resistance strictly rises" invariant test and every replay diverge. Because backend tests don't run on Windows, this ships green locally and only reds in CI — or worse, slips through if the new chunk code has no determinism test.

**Why it happens:**
The engine's determinism is *positional and order-coupled*, not keyed. The code itself warns about this (line 1332: "consumes rng strictly after the founders — keeping the founder rng unperturbed"). A developer adding terrain naturally reaches for the rng already in scope.

**How to avoid:**
- Give procedural world-gen its **own salted sub-stream**, never the shared founder/vein rng. Derive a per-chunk seed: `seed_from_coords(world_seed, chunk_x, chunk_y)` using a fresh salt (e.g. `world_seed ^ 0xC4A0_5EED ^ mix(cx,cy)`), exactly as predators use `0xBADD_CA75`. **Chunk N's terrain must depend only on (world_seed, N)** — never on how many chunks were generated before it, never on entity state.
- Make this a **stateless pure function** `gen_chunk(world_seed, cx, cy) -> ChunkTiles` so generation order (explore left vs right first) cannot affect output.
- Land it as a **pure helper + unit test FIRST** (the v2.0 pattern that "paid for itself twice"): a test asserting `gen_chunk(s, 5, 0)` is byte-identical regardless of whether chunks 0–4 were generated, and that two runs with the same seed produce identical worlds.
- Add a **whole-world golden-hash regression test**: hash the generated tile vector for a fixed seed; CI fails if it changes unexpectedly.

**Warning signs:**
Any new `next_rng(&mut rng)` reusing a borrow that the founder/vein/decision code also touches; chunk-gen that reads `world.tiles.len()` or entity positions; a determinism unit test you "didn't get around to"; "it looks fine on my Windows box."

**Phase to address:** **Infinite Procedural World phase** (the W10.3–W10.7 work). This is the load-bearing pitfall of the whole milestone — gate the phase on the per-chunk determinism test.

---

### Pitfall 2: Reconciling "infinite" with the fixed-size serialized world model → save-file bloat & perf collapse

**What goes wrong:**
The world model is a flat `Vec<CivTile>` that is **serialized whole into every snapshot** and **emitted whole inside Tauri events** (`advance_civ_turn` emits `"snapshot": &snapshot` on `TurnStarted`, line 855; the renderer already had perf work). Make the world "infinite" by simply letting `width`/`tiles` grow unbounded, and: (a) save files balloon from KBs to tens of MBs as the player explores; (b) every turn re-serializes and re-emits the entire explored world over IPC, freezing the WebView (the v1.0 PITFALLS Pitfall 1 — large IPC payloads freeze the JS thread); (c) Phaser tries to render/own tiles for the whole explored area and frame-rate collapses.

**Why it happens:**
"Infinite world" is conceptually a coordinate-space change, but the codebase models the world as a single eagerly-materialized array that is the unit of persistence and of IPC. The path of least resistance (grow the array) violates all three.

**How to avoid:**
- **Do not make the world a giant array.** Keep generation lazy + chunked (see Pitfall 1) and **persist only diffs from procedural baseline**: store `world_seed` + a sparse map of *player-modified* tiles (mined/terraformed/placed). Regenerate untouched terrain on load from the seed. Save size grows with *edits*, not with *explored area*.
- **Never emit the full world per turn.** Emit only the active viewport / changed chunks + per-civ deltas. Keep `TurnStarted`'s legacy `snapshot` payload for back-compat only if the world stays bounded; otherwise add a lean event and migrate consumers.
- **Bound what the renderer instantiates** to visible chunks + a margin; unload off-screen chunks (Phaser object pooling). Honor the existing renderer perf budget.
- Add a `version`-gated schema for the new persistence shape so old (full-tiles) saves still load via `migrate_value_in_place`.

**Warning signs:**
`CivSessionSnapshot` JSON growing turn-over-turn; IPC payload >512KB (the v1.0 guard threshold); frame-time climbing as exploration expands; `world.tiles.len()` unbounded; save/load latency creeping up.

**Phase to address:** **Infinite Procedural World phase** — decide the persistence-as-diffs model and the chunk-streaming IPC shape *before* writing terraform/place, because retrofitting persistence after edits exist is a rewrite.

---

### Pitfall 3: Economy imbalance — inflation, dead currencies, dominant strategy, fixed-price exploit

**What goes wrong:**
Civs/axolotls "gather resources and sell them at **fixed prices** for currency." Fixed prices + an infinite procedural world rich with mineable resources = an **infinite money pump**: find the highest value/effort resource, mine it forever, sell at the fixed price, buy anything. Currency supply grows without a sink → inflation makes shop prices meaningless, or (if prices are static) the player one-shots the whole catalog and the economy is "solved" by turn 20. Meanwhile, of the ≥5 required currencies, 2–3 end up with **no real sink or unique acquisition** and become vestigial — the player ignores them, defeating the "5 distinct currencies with different uses" requirement. A single dominant resource→currency loop drowns the rest.

**Why it happens:**
Fixed selling prices are the easy implementation, but they remove the market's natural balancing force (price discovery). Designers add currencies for flavor without designing a closed loop (distinct source + distinct sink) for each. Infinite worlds make any positive-margin loop unbounded.

**How to avoid:**
- **Every currency needs a closed loop: a distinct source AND a distinct sink.** Write a one-line spec per currency: *what only it buys* and *what only it's earned from*. If a currency has no exclusive sink, cut it or merge it — 5 meaningful currencies beat 8 vestigial ones. (Ocean/pond theme: e.g. common Shells = bulk trade; Pearls = rare/prestige buys; Brine/Salt = consumable crafting input; Coral Marks = territory/building; a fauna/research token = NPC/quest-gated.)
- **Kill the fixed-price pump with diminishing returns and sinks:** per-turn sell caps, falling marginal price as you flood a resource (a simple decay on repeated sales), upkeep/decay costs that drain currency each turn, and shop items priced as ongoing sinks (consumables, repairs, upkeep) not just one-time buys.
- **Model the economy as pure deterministic helpers and simulate it** before wiring: write `apply_sale`, `tick_economy`, `shop_price` as pure functions and add **unit tests that run the loop 200 turns under a "greedy miner" policy** asserting no currency balance exceeds a sane ceiling and no currency's lifetime volume is ~0 (dead-currency detector). This is the GEN-02 multi-turn-invariant pattern applied to money — and it runs in CI despite WebView2.
- Ground catalog/prices/rates in the milestone's economy research (the PROJECT.md "researched acquisition rates and sinks") and encode them as named constants, not magic numbers, so they're tunable.

**Warning signs:**
Any currency balance that only ever rises; a sell price that never changes regardless of supply; a currency never spent in a 200-turn sim; one resource accounting for >60% of income; QA reaching "buy everything" trivially.

**Phase to address:** **Economy & Currency phase** — the balance sim-test is the phase's primary exit gate. The Shop phase consumes its prices.

---

### Pitfall 4: Possession desync — possessed civ still runs the LLM, or frontend(entity)/backend(civ) control mismatch

**What goes wrong:**
"Possessing a civ makes it fully player-controlled and bypasses the LLM." But `advance_civ_turn` *unconditionally* calls `call_model_text` for every civ in `turn_order` (line 874–888). If possession is implemented only in the frontend (e.g., the UI lets you click entities) without a backend branch, the engine **still spends tokens and makes AI decisions for the civ you think you control**, fighting the human's inputs. Conversely, if the human controls *entities* (frontend granularity) but the backend models control at the *civ* level (the `controller` field), the two diverge: the human moves an axolotl, the AI civ-decision overrides it next turn. Add a turn-skip for possessed civs naively and you get **turn-loop skip bugs** — combat/predator/environment world-passes that assumed all civs decided now run on a half-updated snapshot.

**Why it happens:**
Control is currently a single concept (`controller` = attribution label) and the loop has no human branch. Possession introduces a real second control mode mid-loop, and the loop has ordering-sensitive world passes (combat → predators → environment, line 956–965) that assume every living civ went through the decision step.

**How to avoid:**
- **Model possession at the civ level**, reusing/extending the existing `controller` concept — add e.g. `control_mode: "ai" | "human"` (`#[serde(default)]` → defaults to `"ai"`, old saves safe). Don't invent an entity-level control system parallel to the civ model.
- In `advance_civ_turn`, **branch the per-civ step**: if `control_mode == "human"`, skip `call_model_text` + `parse_model_decision` and instead apply the **queued human actions** (collected via IPC during the player's turn) through the *same* `apply_model_decision` / `validate_action` path. The human and the LLM must funnel through one action-application code path so combat/economy/world-passes see identical state shape.
- **Keep the post-loop world passes unconditional** — possessed civs still go through combat/predator/environment resolution; only the *decision source* changes, never the resolution order.
- Test: a unit test that advances a turn with one human civ (pre-queued actions) + one AI civ and asserts (a) zero model calls for the human civ, (b) both civs' actions applied, (c) combat/predator passes ran for both.

**Warning signs:**
Token/cost meter ticking for a "possessed" civ; the AI "undoing" the player's moves next turn; a turn-skip path that bypasses `resolve_combat`/`step_predators`; human actions applied through a different code path than `apply_model_decision`.

**Phase to address:** **True Human Takeover (Game B) phase.** The branch in `advance_civ_turn` is the core deliverable.

---

### Pitfall 5: Breaking the arena bridge / agent-legibility — human-only features the text bridge can't express

**What goes wrong:**
The guiding constraint is "every human-play feature should also benefit agentic playability." A shop UI, possession controls, crafting, and NPC dialog are built as **rich React/Phaser interactions with no text-state mirror and no `civPilotControls` verb**. Result: `render_game_to_text()` (consumed at `civPilot.ts:366` via `window.render_game_to_text`) doesn't describe the shop catalog, the player's currencies, available crafting recipes, or nearby NPCs — so an agent (`codex-play-civ.mjs`) literally cannot see or use half the game. Human↔agent parity breaks; the arena eval silently measures a smaller game than humans play. Worse, changing the text-state *format* or a `civPilotControls` verb breaks the byte-identical legacy-key vitest locks and the arena harness.

**Why it happens:**
UI features are visual-first; the text bridge is an afterthought. The arena bridge is additive-only by contract, but new systems tempt format changes. Parity erodes one un-mirrored feature at a time.

**How to avoid:**
- **Treat the text bridge as a first-class output of every v2.1 feature, in the same phase.** Definition-of-done for shop/economy/possession/crafting/NPC includes: (a) the state is in `render_game_to_text()` (currencies, catalog, recipes, NPCs in range), and (b) every human action verb (buy, sell, craft, talk-to-NPC, possess, place/terraform) has a corresponding `civPilotControls` command an agent can emit.
- **Additive-only:** new text-state keys/sections appended; never rename/reorder existing keys (the vitest byte-identical locks enforce this — add new locks for new keys).
- Extend `codex-play-civ.mjs` alongside, and add a smoke check that an agent can complete one buy + one craft via the bridge.
- Parity test: assert every action available in the UI has a bridge verb (enumerate both, diff them in a test).

**Warning signs:**
A shop/craft/NPC interaction reachable by mouse but absent from `render_game_to_text()` output; a `civPilotControls` verb list shorter than the UI's action list; a vitest legacy-key lock failing (you changed an existing key — revert and append instead).

**Phase to address:** **Every feature phase** (economy, shop, possession, crafting, NPC) — make bridge-mirroring a per-phase exit criterion, not a trailing "agent support" phase.

---

### Pitfall 6: bindings.ts drift + non-defaulted serde fields breaking old saves

**What goes wrong:**
v2.1 adds many IPC commands (shop buy/sell, possess, craft, place/terraform, NPC interact, asset fetch) and many new struct fields (currencies, items, recipes, NPC entities, control mode, chunk persistence). Two recurring traps fire: (1) `bindings.ts` is auto-generated and **drifts** — hand-editing it gets overwritten, and a new `#[specta::specta]` command without a `tauri dev` regen leaves the frontend calling a binding that doesn't exist (or stale types → red `tsc`). (2) A new struct field added **without `#[serde(default)]`** makes every pre-v2.1 save fail to deserialize → existing worlds won't load.

**Why it happens:**
These are the two highest-leverage standing gotchas in this repo (named in CLAUDE.md and both prior retrospectives). They recur every milestone that touches the IPC surface — v2.1 touches it heavily.

**How to avoid:**
- **Every new `CivCivilization`/entity/snapshot field gets `#[serde(default)]`** (or `#[serde(default = "fn")]` for non-`Default` types) — the established v2.0 pattern. Currencies fit `resources: HashMap<String, i32>` with zero schema change; prefer that over new fields where possible.
- If the persistence *shape* changes (chunk diffs, items, NPCs), **bump `SCHEMA_VERSION` and extend `migrate_value_in_place` + `backfill_snapshot`**, with a test loading a real pre-v2.1 snapshot JSON (there's precedent: `snapshot_missing_controller_key_deserializes`, line 7310).
- **Regenerate `bindings.ts` via `tauri dev` once after each new command** and run `tsc --noEmit`; never hand-edit. Add new commands to the `invoke_handler` list.
- Run `cargo check` + `clippy --pedantic -D warnings` (note `unsafe_code = forbid`) on every backend change — these catch what Windows test-runs can't.

**Warning signs:**
Frontend `invoke("new_command")` returning undefined; `tsc` red on a binding type; a new field with no `#[serde(default)]`; an old save failing to load; clippy pedantic warnings on new code.

**Phase to address:** **Every phase** — bake into each phase's verification checklist. Especially the Shop/Possession/Items phases (most new commands + fields).

---

### Pitfall 7: Engine/fallback divergence misunderstood → fallback breaks the browser preview or wastes effort

**What goes wrong:**
The constraint "single-player mechanics are duplicated in `civilization.rs` and `tauriBrowserFallback.ts`" is misread as "port every new system into the fallback." A developer tries to re-implement currency/shop/chunk-gen in `tauriBrowserFallback.ts` — but that file is a `mockIPC` browser-preview with a hand-authored tiny `PREVIEW_WORLD`, not a faithful engine clone. Either huge wasted effort re-implementing xorshift world-gen in TS, or the preview breaks because a new IPC command the UI now calls isn't mocked (the preview throws on an unmocked `invoke`).

**Why it happens:**
"Duplicated, keep in lockstep" overstates the fallback's role. The real contract is: the fallback must answer the same IPC commands with plausible-enough shapes so the browser preview/vitest doesn't crash — not reproduce engine math.

**How to avoid:**
- **Lockstep = IPC contract + observable behavior parity, NOT algorithm parity.** When you add an IPC command (buy/sell/possess/craft/asset), add a `mockIPC` handler in `tauriBrowserFallback.ts` returning a believable canned shape so the preview and vitest stay green.
- Don't port chunk-gen/economy math into TS. Mock the *results*.
- Run `npm test` (vitest) after touching the IPC surface to confirm the preview still loads.

**Warning signs:**
Browser preview throwing "command X not mocked"; effort spent re-implementing engine RNG in TS; vitest reds after adding a command.

**Phase to address:** **Every phase that adds an IPC command** (shop, possession, crafting, NPC, assets).

---

## Moderate Pitfalls

---

### Pitfall 8: Gemini asset pipeline — per-run API cost, missing key, art-style drift, committed binaries

**What goes wrong:**
Generating sprites/resource art via the Gemini image API (`GEMINI_API_KEY`) at runtime, uncached, **re-bills on every world load / every new resource type** — cost balloons and load stalls on network. `GEMINI_API_KEY` is **absent at runtime for most users** (config.json is a free-form map; the key may simply not be set) → either a hard crash or missing textures. Each generation call yields a slightly different style → a **visually incoherent** game (every axolotl a different rendering). And generated PNGs get **committed as large binaries**, bloating the repo.

**Why it happens:**
Image-gen is treated like a function call instead of a build/asset step. Image models are non-deterministic in style. Missing-key handling is forgotten because the dev has the key.

**How to avoid:**
- **Generate at design/build time, not per run.** Treat Gemini as an *asset authoring tool*: generate once, commit the *resulting sprite atlas* (optimized, reasonable size), ship that. Runtime loads local atlases, never calls Gemini in the hot path.
- **Cache by content hash on disk** if any runtime generation is kept (`~/.xolotl-code/assets/<hash>.png`); never regenerate an existing asset.
- **Style consistency:** pin one prompt template + style guide + seed where the API allows; generate a full set in one batched session; review as a sheet for coherence before committing.
- **Missing-key path must degrade, never crash:** if `GEMINI_API_KEY` isn't in the config map, fall back to existing placeholder art and surface a gentle notice. Read the key from the free-form config map (same pattern as `ANTHROPIC_API_KEY`), don't model config as a struct.
- **Don't commit raw multi-MB PNGs** — commit a packed, downscaled atlas; consider git-lfs only if assets are large. Add atlas load-failure handling (fallback texture) so a bad/missing atlas doesn't black-screen the renderer.

**Warning signs:**
Cost meter moving on game load; a crash/black sprites when `GEMINI_API_KEY` unset; visually mismatched art; large PNGs in `git status`; renderer error on a missing atlas frame.

**Phase to address:** **Asset Generation (Gemini) phase.** Decide build-time-vs-runtime first; it determines everything else.

---

### Pitfall 9: AI civs vs possessed civ fairness & arena attribution

**What goes wrong:**
A human-possessed civ gets the rich shop UI, manual micro, and unlimited "thinking time," while AI civs get one JSON decision per turn — the human trivially dominates, and if this same world is scored as an arena eval, the **leaderboard/`controller` attribution conflates** human and model performance, polluting the eval. Or possession grants the human action affordances (e.g., precise placement, instant crafting) the AI's action schema can't express → the AI is handicapped by an unfair action surface.

**Why it happens:**
Possession is designed for human fun; the arena scores models. The same `controller`/leaderboard machinery serves both, so the modes leak into each other.

**How to avoid:**
- **Mark human-controlled civs distinctly in attribution** (extend `controller`/`control_mode`) and **exclude or separately bucket human civs from the model leaderboard** so an eval run isn't contaminated by a human player.
- **Keep the action surface symmetric:** every affordance possession grants the human must exist as a `civPilotControls`/decision verb the AI can also emit (ties back to Pitfall 5). If the human can do it, the schema can express it.
- Decide explicitly whether a possessed world is "play mode" (not scored) or "arena mode" (scored, no human) — don't let one session be both.

**Warning signs:**
Leaderboard showing a human civ ranked against models; possession granting an action with no agent verb; eval numbers spiking when a human joins.

**Phase to address:** **True Human Takeover phase**, coordinated with arena-bridge work.

---

### Pitfall 10: Chunk seams, popping, and biome discontinuity at chunk boundaries

**What goes wrong:**
Independently-generated chunks (required for determinism, Pitfall 1) produce **visible seams** — terrain height jumps, biomes change abruptly, veins cut off at the edge — and **popping** as chunks load while exploring. The existing world uses a continuous `floor_y_at`/`seabed_ripple` height function and `biome_layout`; naive per-chunk generation loses that continuity.

**Why it happens:**
Determinism pushes toward fully-independent chunks, but visual continuity needs neighbor-awareness — a tension that's easy to resolve wrong (sharing state across chunks reintroduces the determinism break).

**How to avoid:**
- **Use continuous, position-driven noise** (fBm sampled at absolute world coords) so height/biome are functions of global `(x, y)`, identical whether computed for chunk N alone or as part of a sweep — continuity for free, determinism preserved. Extend the existing `floor_y_at` style to global coordinates rather than per-chunk independent RNG for terrain *shape*.
- **Generate a 1-tile (or more) margin** beyond the visible chunk so edge features blend; cull on render.
- **Pre-load adjacent chunks** ahead of the camera to hide popping; fade-in newly streamed chunks.

**Warning signs:**
Visible vertical cliffs at fixed x-intervals; biomes switching mid-tile-row; resources clipped at chunk edges; sprites popping in at the screen edge.

**Phase to address:** **Infinite Procedural World phase** (after the determinism model, before the renderer streaming work).

---

### Pitfall 11: UI scope creep — "full store UI + game-native restyle" balloons past shippable

**What goes wrong:**
"Shop with full UI" + "game-native UI refinement (read as a game, not the harness app)" is an open-ended visual mandate. Without a boundary it absorbs the milestone: every screen gets restyled, the shop grows tabs/animations/filtering, and the playable build slips. Meanwhile the harness app's existing UI (chat/eval/settings) risks collateral restyling.

**Why it happens:**
"Game-native" and "full" are unbounded adjectives. Polish is satisfying and infinite.

**How to avoid:**
- **Scope the restyle to the Civ surface only** — explicitly exclude the harness chat/eval/settings UIs (don't touch them; surgical-changes rule).
- **Define "full store UI" by a checklist, not a vibe:** browse catalog, see price in the right currency, buy, sell, see balances, insufficient-funds state. Ship that; defer filtering/animation/wishlists.
- **Vertical slice first:** one buyable item end-to-end (catalog → buy → currency deducted → effect applied → text bridge reflects it) before breadth. Time-box restyle.

**Warning signs:**
Restyle PRs touching `components/` outside `civilization/`; shop feature list growing mid-phase; "playable" date slipping for polish; the v2.0 lesson recurring (verification debt — never actually watched live).

**Phase to address:** **Shop/Store phase** and **Game-native UI phase** — bound both with explicit done-checklists.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Grow `world.tiles` array for "infinite" world | Trivial; no new persistence model | Save bloat + IPC freeze + render collapse; rewrite to fix | **Never** — chunk/diff from the start |
| Fixed sell prices, no sinks | Simplest economy to ship | Infinite money pump; economy "solved"; dead currencies | Only as a stubbed placeholder *with* the balance sim-test already failing-loud |
| Reuse shared `&mut rng` for new world-gen | Less plumbing | Determinism break; CI-only red; replay/eval corruption | **Never** — salted sub-stream |
| Runtime Gemini calls, uncached | Fresh art, less asset tooling | Per-run cost + load stalls + style drift + crash on missing key | **Never** for hot path; build-time generation instead |
| Possession in frontend only | Fast demo of clicking entities | LLM still runs the civ; cost + AI fights player; rewrite into the loop | **Never** — needs the `advance_civ_turn` branch |
| New serde field without `#[serde(default)]` | One less attribute | Every existing save fails to load | **Never** |
| Skip text-bridge mirror for a new feature | Ship the UI faster | Human↔agent parity breaks; arena eval shrinks silently | Only if mirroring is a tracked, same-milestone follow-up task |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Gemini image API | Call per run; crash if key missing; commit raw PNGs | Build-time generation; content-hash cache; graceful placeholder fallback when `GEMINI_API_KEY` (read from free-form config map) is absent; commit packed atlas |
| tauri-specta `bindings.ts` | Hand-edit; forget to regen after a new command | Edit Rust command, `tauri dev` once to regenerate, `tsc --noEmit`; never hand-edit |
| `tauriBrowserFallback.ts` (mockIPC) | Port engine math into TS; leave new commands unmocked → preview crash | Mock new IPC commands with believable canned shapes; keep contract parity, not algorithm parity |
| `render_game_to_text()` / `civPilotControls` arena bridge | Change/reorder existing text keys; add UI actions with no agent verb | Append new keys (byte-identical legacy locks stay green); add a bridge verb per UI action |
| `~/.xolotl-code/config.json` | Model as a struct to add `GEMINI_API_KEY` | Treat as free-form `serde_json::Map`; read the uppercase key, never serialize a strict struct back |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Whole-world serialize per snapshot/event | Save + `TurnStarted` payload grow with explored area; UI stutter | Persist diffs; emit viewport/chunk deltas | As soon as the world exceeds the fixed 128×96 and keeps growing |
| Renderer owns all explored tiles | Frame-time climbs while exploring | Stream visible chunks + margin; pool/unload off-screen | After a few screens of exploration |
| Uncached Gemini calls on load | Network stall + cost on every game open | Build-time/local atlas | First non-dev user / first new resource type |
| Per-turn model call for possessed civ | Token cost on a human-controlled civ | `control_mode == human` branch skips LLM | First possessed-civ turn |
| Economy with no decay/cap | Currency balances → overflow-adjacent; numbers unreadable | Sinks + caps + diminishing returns | Mid-game on any infinite-resource world |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Trusting client-supplied shop/craft/possession action amounts | Negative-price buys, free items, currency overflow, snapshot bloat | Validate every action server-side through `validate_action` (existing pattern); clamp amounts; reject negatives — mirror `set_civ_controller`'s sanitize/cap (trim + 64-char cap) for any free-form label |
| Logging/committing `GEMINI_API_KEY` | Key leak | Read from config map at use-site; never log; never write into a saved snapshot |
| Hostile/overlong NPC or item names from data | Text-state/leaderboard bloat, T-01-02-style spoofing | Sanitize + length-cap all free-form strings entering the snapshot (existing precedent) |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| 5+ currencies with unclear purpose | Player can't tell what each currency is for; ignores most | Per-currency tooltip stating its one exclusive use; shop shows item price in its required currency |
| No insufficient-funds / why-can't-I-buy feedback | Player clicks buy, nothing happens | Explicit disabled state + reason in the shop UI |
| Chunk popping while exploring | World feels broken/janky | Pre-load ahead of camera; fade-in chunks |
| Possession with no clear "you control this civ now" affordance | Player unsure what they command | Clear mode indicator + which actions are theirs; mirror in text bridge |
| Inconsistent generated art | Game looks amateur | Single style guide; review the full sprite sheet for coherence pre-commit |

## "Looks Done But Isn't" Checklist

- [ ] **Infinite world:** Often missing — *determinism test* (same seed → identical world regardless of explore order) and *diff-based persistence* — verify a 200-turn explored save is small and reloads byte-identical
- [ ] **Economy:** Often missing — *sinks and price decay* — verify a 200-turn greedy-miner sim keeps every currency bounded AND every currency gets spent (no dead currency)
- [ ] **Possession:** Often missing — the *`advance_civ_turn` LLM-skip branch* — verify zero model calls for a possessed civ and that world-passes still ran for it
- [ ] **Every feature:** Often missing — the *text-bridge mirror + `civPilotControls` verb* — verify an agent can do via the bridge whatever a human can do in the UI
- [ ] **New IPC commands:** Often missing — *`bindings.ts` regen + `tsc` + `mockIPC` handler in fallback* — verify frontend call resolves and browser preview/vitest stays green
- [ ] **New serde fields:** Often missing — *`#[serde(default)]` + a pre-v2.1 save loads* — verify with a real old snapshot JSON in a unit test
- [ ] **Gemini assets:** Often missing — *graceful fallback when `GEMINI_API_KEY` unset* and *no per-run API calls* — verify the game loads with the key removed and makes no network call on load
- [ ] **Game-native UI:** Often missing — *bounded scope* — verify no harness (chat/eval/settings) screen was restyled

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Determinism break shipped | MEDIUM | Bisect via golden-hash test to the offending draw; move new gen to a salted sub-stream; re-pin golden hash. Old saves with the broken seed are lost-reproducibility but still load. |
| Save bloat / full-world IPC | HIGH | Retrofit chunk/diff persistence + delta events; write a migration converting bloated full-tile saves to diff form; bump `SCHEMA_VERSION` |
| Economy runaway in shipped build | MEDIUM | Add sinks/caps/decay as a balance patch; sim-test the new constants; existing saves rebalance on next tick (clamp on load) |
| Possessed civ still calling LLM | LOW | Add the `control_mode` branch in `advance_civ_turn`; ship; cost stops immediately |
| Arena bridge broken (changed a text key) | LOW | Revert the key change; append a new key instead; re-run the byte-identical vitest locks |
| Committed large PNGs | MEDIUM | Pack into atlas, downscale, remove originals from history if needed (git filter-repo / lfs migrate) |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Infinite-world determinism break | Infinite Procedural World | Pure `gen_chunk(seed,cx,cy)` unit test: order-independent + same-seed-identical; whole-world golden hash in CI |
| 2. Fixed-array bloat / IPC + render collapse | Infinite Procedural World | 200-turn explored save < size budget; per-turn IPC payload < 512KB; frame-time flat while exploring |
| 3. Economy imbalance / fixed-price exploit / dead currencies | Economy & Currency | 200-turn greedy-miner sim: every currency bounded AND spent; sell price decays with supply |
| 4. Possession desync / LLM-bypass / turn-skip | True Human Takeover | Unit test: 0 model calls for human civ; both civs' actions applied; combat/predator passes ran |
| 5. Arena bridge break / agent-legibility gap | Every feature phase | Parity test: every UI action has a `civPilotControls` verb; new state in `render_game_to_text()`; legacy text-key locks green |
| 6. bindings drift / non-default serde fields | Every phase | `tauri dev` regen + `tsc`; pre-v2.1 save loads; `cargo check`/clippy pedantic clean |
| 7. Engine/fallback divergence | Every IPC-adding phase | `mockIPC` handler added; vitest + browser preview green |
| 8. Gemini cost/key/style/binaries | Asset Generation (Gemini) | No network call on game load; loads with `GEMINI_API_KEY` unset; atlas committed (not raw PNGs) |
| 9. Possession fairness / attribution | True Human Takeover + arena | Human civ bucketed out of model leaderboard; symmetric action surface |
| 10. Chunk seams / popping | Infinite Procedural World | No seams at boundaries (continuous global noise); pre-load hides popping |
| 11. UI scope creep | Shop + Game-native UI | Done-checklist met; no harness-UI files touched; vertical slice first |

## Sources

- **`tauri-app/src-tauri/src/civilization.rs`** (read directly): RNG (`next_rng` L5106, `seed_from` L5097, salts L1155/1704/964), fixed-size world (`WORLD_WIDTH/HEIGHT` L13-14, `world_width` L1198, `tiles: Vec<CivTile>` L330), serde/migration (`SCHEMA_VERSION` L83, `migrate_value_in_place` L4945, `backfill_snapshot` L4981, `#[serde(default)]` throughout), currencies (`resources: HashMap<String,i32>` L510), control (`controller` L516, `set_civ_controller` L817), turn loop (`advance_civ_turn` L846, per-civ model call L874-888, world passes L956-965), bridge (`leaderboard` L1719, `build_observation` L2070)
- **`tauri-app/src/lib/tauriBrowserFallback.ts`** (read directly): `mockIPC` preview, hand-authored `PREVIEW_WORLD` (~L211/479) — confirms fallback is a mock, not an engine clone
- **`tauri-app/src/lib/civPilot.ts`**: `window.render_game_to_text?.()` consumption (L366) — the arena text bridge entry point
- **`.planning/RETROSPECTIVE.md`** (v2.0): pure-helper-first decomposition, determinism-as-constraint, additive back-compat contracts, bindings/config standing gotchas, verification-debt lesson
- **`.planning/PROJECT.md`** (v2.1 milestone definition + guiding constraints)
- **`CLAUDE.md`**: bindings.ts drift, config-as-free-form-map, WebView2 test gotcha, clippy pedantic + `unsafe_code=forbid`
- Game-economy balance (sources/sinks, currency-loop design, inflation control, fixed-price exploits): general game-design domain knowledge — MEDIUM confidence, validate balance constants against the milestone's own economy research

---
*Pitfalls research for: xolotl v2.1 Living World & Economy (adding economy/world/possession/NPC/assets to the existing deterministic civ engine)*
*Researched: 2026-06-07*
