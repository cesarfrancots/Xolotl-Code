# Stack Research — Milestone v2.1 "Living World & Economy" (ADDITIONS)

**Domain:** Turn-based, deterministic-seeded civilization game inside an existing Tauri + Rust + Phaser app
**Researched:** 2026-06-07
**Confidence:** HIGH (existing pipelines verified in-repo; crate/model versions verified via ctx7 + official docs 2026-06)

> **Scope:** This is a *subsequent* milestone on an existing, working game. The v2.0
> stack (Tauri 2.11, React 19, Zustand 5, Phaser 4, the seeded Rust civ engine) stays
> exactly as-is. This file lists only the **minimal additions/techniques** for the
> NET-NEW v2.1 features (infinite procedural world, economy + ≥5 currencies, shop UI,
> civ-level possession, Gemini art, game-native restyle) and an explicit **do-NOT-add** list.
> **Headline finding: almost nothing new is required.** The two "new" capabilities people
> assume need libraries — procedural noise and Gemini art — are both better served by code
> already in the repo. Net new third-party dependencies recommended: **zero to one** (one
> optional Rust crate, only if W10.6 fBm is pursued).

---

## The two load-bearing decisions

### 1. Procedural infinite world: **hand-roll value-noise/fBm on the existing integer RNG. Do NOT add a noise crate.** (backend, Rust)

The engine's determinism contract is the single most important constraint in the codebase
and it is **integer-based**, not float-based:

- All world placement runs through `next_rng(&mut u32)` — a xorshift32 (`x^=x<<13; x^=x>>17; x^=x<<5`) threaded as `&mut u32`, seeded via FNV-1a (`seed_from`). See `civilization.rs:5106` and `:5097`.
- Determinism tests (`world_generation_is_deterministic_by_seed`, `world_scales_and_spawns_are_disjoint_per_civ`) assert **byte-identical** founders/tiles across runs, and CI re-serializes tiles on Linux/Windows/macOS (gotcha #5: backend tests run on Linux/macOS only).
- Existing terrain shape (`seabed_ripple`, `civilization.rs:1184`) is already a hand-rolled sum-of-sines on f32 with `.round() as i32` — i.e. the codebase already does deterministic value-noise without a crate.

A third-party noise crate (`noise` 0.9.0, `bracket-noise` 0.8.7, `fastnoise-lite`) would:
- introduce its **own RNG/permutation seeding** that does not compose with `next_rng`, forcing a parallel determinism story;
- raise the **cross-platform f32 reproducibility** risk the spec already flags for W10.6 (different SIMD/FMA/rounding across the three CI OSes can diverge a raw f32 lattice). The repo's own W10.6 note: *"Cross-platform f32-determinism caveat … keep off the critical mining path."*;
- add a dependency + clippy-pedantic surface for ~40 lines of code you can write inline.

**Recommended technique (W10.6 + W10.7):** deterministic **1-D and 2-D value-noise / fBm built on a hashed integer lattice**, snapped to integers at the boundary:
- Lattice hash = a small integer mix of `(seed, ix, iy)` (reuse the `next_rng`/FNV-1a mixing style), producing a `u32`; map to `f32` in `[0,1)` exactly like `rand_f` does (`% 100_000 as f32 / 100_000.0`) so the float domain is **discretized and identical on every platform**.
- fBm = 3–4 octaves of that lattice + smoothstep interpolation, per-biome amplitude/roughness on `BiomeDef` (W10.6), keeping the existing `floor_y_at` clamp.
- Caves (W10.7) = the same 2-D hash thresholded into voids **below a mandatory `CAVE_CAP`** of solid rows under `col_floor` (the spec's hard rule — `seabed_row_at` is load-bearing).
- "Infinite/expandable" world = keep generation **deterministic per `(seed, chunk_x)`**: a tile's terrain is a pure function of seed + coordinate, so expanding the world right/down re-derives identical tiles without storing them. This fits the turn-based model — no streaming thread, no async chunk loader needed on the backend; generation stays a synchronous pure function called from `generate_world`.

**Verification:** `cargo build` + `cargo clippy --all-features -- -D warnings` + `cargo test --no-run` (Windows), full `cargo test` on CI. Re-baseline the determinism golden once when fBm lands (the spec already plans this).

### 2. Gemini art assets: **REUSE the existing in-repo pipeline. Do NOT add a new image lib or change the runtime.** (build-time tooling, Node + Python)

A complete, working Gemini asset pipeline already exists at `output/civ-gen/gemini/` and produced the current committed art. It is **build-time only** — generated PNGs are committed to `tauri-app/public/civ/`, so there is **zero per-run / per-play API cost**. The Phaser renderer loads them as plain static files; it never calls Gemini.

Pipeline (already built — extend, don't rebuild):
1. **Job specs** — `jobs-{tiles,resources,buildings,accessories,axolotls,maps,stages}.json`: `[{ id, prompt, aspect? }]`. For v2.1 you add new entries (new tiles `tile-basalt/ice/coral/lava/...`, new resources `res-kelp/ore/sulfur/amber/herbs`, **currency icons** `cur-shell/pearl/...`, new items, the `bld-palisade` building, NPC sprites). Prompts already follow a good "seamless tileable top-down pixel-art … no border, no frame" recipe — copy it.
2. **Generate** — `node gen.mjs jobs-X.json` with `GEMINI_API_KEY` set. `gen.mjs` calls the **Vertex AI express REST endpoint** (`aiplatform.googleapis.com/v1/publishers/google/models/<model>:generateContent?key=…`) with `responseModalities:["Image"]`, model `gemini-2.5-flash-image` (still current; `gemini-3.1-flash-image` exists as a faster successor but the existing model works — no change needed). Raw PNGs land in `raw/`. Built-in retry/backoff + concurrency.
3. **Post-process** — `postprocess.py` (Pillow): flood-fills the flat-grey background to transparent, trims to bbox, fits sprites into 256px boxes, resizes tiles to 128px, and assembles the **axolotl animation spritesheet** (`axolotl-animated-seeds.png`, 16×3 grid of 64px frames) that `CivilizationGameCanvas.tsx:465` loads. Writes straight into `tauri-app/public/civ/{tiles,resources,buildings,accessories,axolotls,...}/`.
4. **Commit** the resulting PNGs → one-time cost.

**Loading into Phaser (no atlas library needed):** the renderer loads **one `this.load.image(key, "/civ/<sub>/<key>.png")` per asset** in `preload()` (`CivilizationGameCanvas.tsx:466–471`), driven by the `TERRAIN_TILES` / `RESOURCE_KEYS` / `BUILDING_KEYS` / `ACCESSORIES` maps. For v2.1, adding art = add the file under `public/civ/...` and add the key to the relevant map. **Do not introduce texture-atlas packing tooling** (TexturePacker, `phaser3-rex-plugins`): a few dozen small static PNGs over Tauri's local protocol load instantly; atlasing is premature optimization here. (If sprite count ever explodes, Phaser's built-in `this.load.atlas` + a free packer is the in-place upgrade — no new runtime dep.)

**Cost (verified, ai.google.dev/gemini-api/docs/pricing):** `gemini-2.5-flash-image` ≈ **$0.039/image** standard, **$0.0195/image** batch. The full v2.1 asset set (~40–60 images incl. currencies/items/NPCs) is a **one-time ~$1–2.50** spend, then free forever (committed).

---

## Recommended Stack — additions only

### Core Technologies (NEW for v2.1)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Inline value-noise/fBm in `civilization.rs` | n/a (hand-rolled) | Organic terrain (W10.6), caves (W10.7), prospecting strata | Composes with the existing integer `next_rng`; preserves byte-determinism + cross-OS reproducibility a noise crate would jeopardize; ~40 LOC, no new dep, clippy-clean. |
| Existing Gemini pipeline `output/civ-gen/gemini/` | model `gemini-2.5-flash-image` via `@google/genai ^2.8.0` (REST in `gen.mjs`) | Generate sprites/tiles/resource/building/item/**currency** art | Already built, already produced shipped art, build-time only → zero per-run cost; outputs drop straight into the dirs Phaser already loads. |
| Pillow (Python) | already used (`postprocess.py`) | Background-key, trim, fit, spritesheet assembly | Existing post-processor; extend its id lists for new categories (currencies/items/NPCs). |

### Supporting Libraries (already present — reuse, do not re-add)

| Library | Version (in repo) | Purpose | Use For (v2.1) |
|---------|-------------------|---------|----------------|
| Phaser | `^4.1.0` | Game renderer | Tile chunking (W8), new tiles/resources/buildings, possession visuals, store-anchored world UI. Has built-in `RenderTexture` (chunked baking the spec already plans) + `this.load.atlas` if ever needed. |
| Zustand | `^5.0.13` | Frontend state | Economy/currency balances, shop catalog state, possession mode, inventory — extend `civStore.ts`; no new state lib. |
| Tailwind v4 + shadcn + radix-ui + lucide-react + cmdk | `4.3.0` / `4.7.0` / `1.4.3` / `1.14.0` / `1.1.1` | UI primitives | Build the **shop/store + inventory UI** entirely from these. Dialog/sheet/tabs/scroll-area (radix/shadcn) = store modal; `lucide` for currency/item glyphs (or Gemini PNG icons); `cmdk` for a buy palette. No game-UI library needed. |
| `@tanstack/react-virtual` | `^3.13.24` | Virtualized lists | Long shop catalogs / inventory grids if they get big — already a dep. |
| serde / serde_json | `1` | Snapshot serialization across IPC | New economy/currency/item/possession fields are additive `#[serde(default)]` struct fields; snapshot still crosses IPC as a serialized String (per the spec) — minimizes `bindings.ts` drift. |

### Development Tools (process, not deps)

| Tool | Purpose | Notes |
|------|---------|-------|
| `cargo test --no-run` + `clippy --all-features -- -D warnings` | Verify backend on Windows | Mandatory: WebView2 blocks live backend tests on Windows (gotcha #5). Add 0 new clippy warnings (pedantic + `unsafe_code=forbid`). |
| `npm run tauri dev` (once) | Regenerate `bindings.ts` | Only when the IPC command surface changes (new possession/shop commands). Mind the drift trap (gotcha #1 / MEMORY). Prefer keeping new data inside the serialized snapshot String to avoid regen. |
| `vitest` + `tsc --noEmit` | Frontend gate | Test economy math, shop catalog, possession-mode store logic; keep `civilization.rs` ↔ `tauriBrowserFallback.ts` single-player logic in lockstep (PROJECT constraint). |

## Installation

```bash
# Backend (Rust): NOTHING required for the recommended path (hand-rolled noise).
#   Optional ONLY if you deliberately choose a crate over hand-rolling fBm:
#   cargo add noise@0.9        # in tauri-app/src-tauri/Cargo.toml — see "Alternatives"

# Asset generation (build-time, already scaffolded):
cd output/civ-gen/gemini && npm install      # @google/genai already pinned
$env:GEMINI_API_KEY = "..."                   # PowerShell; AI Studio key
node gen.mjs jobs-tiles.json                   # repeat per new job file
python postprocess.py                          # writes into tauri-app/public/civ/**
# then: git add tauri-app/public/civ && commit  (one-time)

# Frontend (shop/inventory/possession UI): NOTHING new — all primitives already in package.json.
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Hand-rolled integer-lattice fBm | `noise` crate 0.9.0 (`Fbm::<Perlin>::new(seed)`) | Only if you accept a separate determinism story AND verify byte-stable f32 across Linux/Win/macOS CI (risky — the spec warns against exactly this). Not worth it for ~40 LOC. |
| Hand-rolled integer-lattice fBm | `bracket-noise` 0.8.7 / `fastnoise-lite` | Same caveat; useful in real-time roguelikes, but this engine is turn-based + integer-deterministic. |
| Existing REST `gen.mjs` | `@google/generative-ai` (skill's SDK example, `gemini-2.0-flash-exp`) | The skill's example uses an older model + the AI-Studio `generativelanguage` endpoint, which the repo notes is **blocked** for this project (Vertex express is enabled). Prefer the repo's working `gen.mjs`. |
| Per-file `this.load.image` | `this.load.atlas` + free packer (e.g. `free-tex-packer`) | Only if sprite count grows into the hundreds and load time/draw calls measurably suffer. Phaser supports it natively — still no runtime dep. |
| Tailwind/shadcn/radix shop UI | A game-UI lib | Never for this scope; see "What NOT to Use". |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `noise` / `bracket-noise` / `fastnoise-lite` (Rust) | Own RNG seeding won't compose with `next_rng`; cross-OS f32 nondeterminism risk the determinism tests + CI would catch as flaky goldens; needless dep under clippy-pedantic | Inline integer-lattice value-noise/fBm discretized to `[0,1)` like `rand_f` |
| `@google/generative-ai` w/ `gemini-2.0-flash-exp` (the skill's snippet) | Older model; AI-Studio endpoint is blocked for this project; would fork the working pipeline | Existing `output/civ-gen/gemini/gen.mjs` (Vertex express, `gemini-2.5-flash-image`) |
| Texture-atlas packing tooling (TexturePacker, rexUI atlas plugins) | Premature optimization for a few dozen small local PNGs; adds build/runtime complexity | Per-file `this.load.image` (current pattern); upgrade to built-in `this.load.atlas` later if ever needed |
| A game-UI framework (e.g. a Phaser DOM-UI plugin, PixiUI, `phaser3-rex-plugins`) for the shop/inventory | The store/inventory is best as **React DOM over the canvas** (forms, scroll, search, accessibility) — already have Tailwind/shadcn/radix/cmdk | React + Tailwind + shadcn/radix; Phaser only for in-world buy markers/possession highlights |
| `react-dnd` / a drag-drop lib for inventory | Heavy for a click-to-buy/sell shop; HTML5 DnD or click handlers suffice | Native pointer/click handlers; revisit only if true drag-rearrange inventory is specced |
| A dedicated state-machine/ECS lib for economy or possession | Engine is a turn-resolved snapshot; economy is plain fields + per-turn functions; possession is a `controller`/flag bypassing `call_model_text` | Plain Rust structs/functions in `civilization.rs` + Zustand on the frontend |
| `decimal`/big-money crate for currencies | Game currencies are small integers (shells, pearls…), not financial money | `i64`/`u32` integer balances (also keeps determinism + IPC simple) |
| A real-time chunk-streaming/async world loader | Turn-based engine; tiles are a pure function of `(seed, coord)` so "infinite" = re-derive, not stream | Synchronous deterministic generation in `generate_world`; chunked *rendering* via Phaser `RenderTexture` (W8, no new dep) |

## Stack Patterns by Variant

**If pursuing W10.6/W10.7 (organic terrain + caves):**
- Add an inline fBm helper near `seabed_ripple`; consume rng **strictly after `found_colony`** (the W10.1 determinism rule); add a mandatory `CAVE_CAP`; re-baseline the determinism golden once.
- Because: keeps the founder rng sequence the tests lock in, and keeps f32 off any byte-compared path by discretizing.

**If the shop/inventory needs to feel "in-world" rather than a modal:**
- Render it as a React/Tailwind panel positioned over the Phaser canvas (DOM overlay), with Phaser only drawing in-world buy markers/glow.
- Because: forms, search (cmdk), scrolling, and a11y are far cheaper in DOM than in canvas; the app already composes React + Phaser this way.

**If currency/item icons should match the art style:**
- Generate them through the same Gemini pipeline (`cur-*`, `item-*` ids) and commit; reference by key in a `CURRENCY_KEYS` / `ITEM_KEYS` map mirroring `RESOURCE_KEYS`.
- Because: one consistent art source, zero runtime cost, same loader path.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@google/genai ^2.8.0` | Node 18+ | Build-time only; `gen.mjs` uses plain `fetch` REST so even the SDK is optional. |
| `gemini-2.5-flash-image` | Vertex express endpoint (`aiplatform.googleapis.com`) | Still current 2026-06; AI-Studio `generativelanguage` endpoint is blocked for this project. `gemini-3.1-flash-image` is a drop-in faster successor if desired. |
| `noise` 0.9.0 (only if chosen) | Rust 1.95 workspace | Would need verifying against clippy-pedantic + cross-OS f32 goldens — the reason it's *not* recommended. |
| Phaser `^4.1.0` | React 19 / Vite 7 (current) | `RenderTexture` + `load.atlas` are built-in; no plugin needed for chunking or atlases. |

## Sources

- In-repo (HIGH): `tauri-app/src-tauri/src/civilization.rs` — `next_rng`/`seed_from` (xorshift32 + FNV-1a), `seabed_ripple`/`floor_y_at` (existing hand-rolled value-noise), `seed_underground_veins` (rng-after-founders determinism rule), determinism tests.
- In-repo (HIGH): `output/civ-gen/gemini/{gen.mjs,postprocess.py,jobs-*.json,package.json}` — complete working Gemini→PNG→public/civ pipeline; `gemini-2.5-flash-image` via Vertex express REST; build-time/committed.
- In-repo (HIGH): `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx:465–471` — per-file `this.load.image` loader; `TERRAIN_TILES/RESOURCE_KEYS/BUILDING_KEYS/ACCESSORIES` maps.
- In-repo (HIGH): `tauri-app/package.json` — Phaser 4.1, Zustand 5, Tailwind 4 + shadcn + radix-ui + lucide + cmdk + @tanstack/react-virtual already present (covers shop/inventory UI).
- ctx7 + crates.io (HIGH): `noise` 0.9.0 (`Fbm::<Perlin>::new(seed)`), `bracket-noise` 0.8.7, `fastnoise-lite` — verified latest versions; recommended *against*.
- ai.google.dev/gemini-api/docs/pricing (HIGH, 2026-06): `gemini-2.5-flash-image` current; ~$0.039/image standard, ~$0.0195/image batch, 1290 tokens/1024px image; `gemini-3.1-flash-image`/`gemini-3-pro-image`/`imagen-4.0` exist as alternatives.
- civ-multi-civ-world-plan.md §W10.6/W10.7 (HIGH): explicit cross-platform f32-determinism caveat + `CAVE_CAP` + rng-after-founders rules this stack respects.

---
*Stack research for: xolotl v2.1 Living World & Economy (additions to an existing engine)*
*Researched: 2026-06-07*
