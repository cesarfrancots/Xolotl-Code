# Roadmap: xolotl

**Granularity:** standard
**Mode:** yolo
**Core Value:** A developer can spawn, monitor, and coordinate multiple AI agents working in parallel on a single project — from a chat-first desktop app — without being locked into OpenAI or Anthropic.

---

## Milestones

- ✅ **v1.0 Orchestration MVP** — Phases 1-6 (shipped 2026-06-06; full detail archived to `.planning/milestones/v1.0-phases/` and `.planning/milestones/v1.0-ROADMAP.md`)
- 🚧 **v2.0 Civ Simulation** — Phases 1-5 (in progress)

> **Phase numbering note:** v2.0 uses **reset numbering** — it starts at Phase 1, not Phase 7. The v1.0 phases 1-6 are archived; the headings below under "🚧 v2.0" are the live v2.0 phases.

---

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked INSERTED), appearing between their surrounding integers in numeric order.

### 🚧 v2.0 Civ Simulation (active)

- [ ] **Phase 1: W9-lite — Multi-Model World Creation + Leaderboard** — Create a world of 2-3 AI-model civs, watch a leaderboard rank them, and let harnesses read/drive via the arena bridge.
- [ ] **Phase 2: W8 — Renderer Multi-Civ Identity** — Per-civ color tints and a multi-colony / focus-a-civ camera at multi-civ scale.
- [ ] **Phase 3: W4 — Environment Engine** — Seasons drift temperature, disasters reshape terrain with forecasts, renewable-only regrowth creates scarcity.
- [ ] **Phase 4: W6 — Combat & Diplomacy** — Claim/own/contest territory, deterministic raids, diplomacy stances + trades, wild predators.
- [ ] **Phase 5: W5 — Genetics Depth & Selection** — Expanded visible genetics that cross Mendelian-style, with environmental selection that makes populations evolve.

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

> The phases below are **v2.0** (sim-first order). Spec-of-record: `civ-multi-civ-world-plan.md` (workstreams W1-W10). Backend is already structurally multi-civ — `advance_civ_turn` already calls each civ's own LLM via `call_model_text`; these phases make the competition visible and the world alive.

### Phase 1: W9-lite — Multi-Model World Creation + Leaderboard
**Goal**: A user can create a world with 2-3 different AI-model civilizations (each a color), found it, and watch a leaderboard rank the living civs by score as turns advance — and agentic harnesses can read full state as text and drive the game on a shared scoreboard. This is the first phase the multi-civ AI competition becomes visible/creatable, and it unblocks human and harness testing of every later phase.
**Depends on**: Nothing (first v2.0 phase; backend turn loop is already multi-civ)
**Requirements**: CIV-01, CIV-02, CIV-03, ARENA-01, ARENA-02, ARENA-03
**Success Criteria** (what must be TRUE):
  1. User can create a world from the Civ creation UI with 2-3 participants, each assigned a distinct model and color, and found it.
  2. User sees a leaderboard ranking the living civilizations by score that updates as turns advance.
  3. Each civilization is driven by its own configured real-provider model (from `~/.xolotl-code/config.json`), and per-civ model decisions are visible in the log.
  4. An external/agentic harness can read full game state (per-civ summaries + leaderboard) as text via `window.render_game_to_text()` without parsing pixels.
  5. An external/agentic harness can drive the game via `window.civPilotControls` / `scripts/codex-play-civ.mjs` without breaking existing controls, and the leaderboard attributes civ scores to the controlling harness/model.
**Plans**: 4 plans
**UI hint**: yes

Plans:
- [ ] 01-01-PLAN.md — Backend IPC shape: multi-participant create_civ_session + CivParticipant + controller tag + persisted reasoning log + headless bindings regen
- [ ] 01-02-PLAN.md — Multi-model creation card (1-3 participants) + civStore createSession + selectedCivId state
- [ ] 01-03-PLAN.md — Additive render_game_to_text (civs[]/leaderboard/environment) + CivPilotTextState + back-compat contract test
- [ ] 01-04-PLAN.md — Leaderboard top-bar + selectedCivId-driven observer/log + reasoning toggle + civPilotControls civId/controller

> **Implementation notes:** This phase changes the IPC surface — `create_civ_session` → multi-participant `CivSessionConfig { name, seed, civs: Vec<CivParticipant { name, model, color? }> }`; add `add_civ_to_session` (deferred-UI but the back-compat shape matters). `bindings.ts` is auto-generated by `tauri-specta` and drifts (gotcha #1): edit the Rust command first, regenerate via one `tauri dev`, keep single-`model` back-compat by mapping to a one-element `civs`. Extend — do not break — the existing arena interface: `renderSnapshotToText` / `window.render_game_to_text()`, `window.civPilotControls`, `scripts/codex-play-civ.mjs`. `civStore.ts` / `CivilizationView.tsx` get the multi-model participant picker + leaderboard panel. Backend tests can't run on Windows (WebView2) — verify backend via `cargo check` + `cargo clippy` + `cargo test --no-run`; frontend via `npx tsc --noEmit` + vitest.

### Phase 2: W8 — Renderer Multi-Civ Identity
**Goal**: Each civilization's axolotls, buildings, and territory render tinted by that civ's color so colonies are visually distinguishable, and the camera frames all colonies by default while allowing focus on a single civ — performant at the larger multi-civ world scale.
**Depends on**: Phase 1 (needs creatable multi-civ worlds to render and a leaderboard/civ list to drive focus)
**Requirements**: REN-01, REN-02
**Success Criteria** (what must be TRUE):
  1. User can visually distinguish each civilization — axolotls/buildings/territory are tinted by that civ's color, and neutral entities (e.g. predators) are shown distinctly.
  2. The camera frames all colonies by default and the user can focus a single civ via `focusCiv`.
  3. Rendering stays smooth at the larger multi-civ world scale (chunked terrain rendering; no performance collapse at ~36k+ tiles).
**Plans**: 2 plans
**UI hint**: yes

Plans:
- [ ] 02-01-PLAN.md — Per-civ tint identity: pure tint helpers (named exports) + unit tests, then tint axolotls/buildings/region-overlay/minimap by civ color; dead civs greyed (REN-01)
- [ ] 02-02-PLAN.md — Multi-colony camera: pure colonyBounds/focusTarget helpers + tests, frame-all default + re-frame on collapse, additive window.civCamera.focusCiv/frameAll, selectedCivId wiring (REN-02)

> **Implementation notes:** In `CivilizationGameCanvas.tsx`: replace per-tile `Image` baking with chunked `RenderTexture` terrain (32×32-tile chunks culled by `cameras.main.worldView`, +1 chunk margin) — required for the bigger world. Per-civ color tints on banners/rings/region overlays/minimap; one camera center per civ + `window.civCamera.focusCiv(civId)`. Verify via `npx tsc --noEmit` + vitest.

### Phase 3: W4 — Environment Engine
**Goal**: The world stops being stale — seasons advance over turns and drift temperature visibly; natural disasters trigger, are forecast and logged, and physically reshape terrain; renewable resources regrow while finite resources stay depleted, creating sustained scarcity.
**Depends on**: Phase 1 (needs the multi-civ turn loop to tick environment into). Benefits from Phase 2 for disaster/season VFX, but is backend-gated and can land without it.
**Requirements**: ENV-01, ENV-02, ENV-03
**Success Criteria** (what must be TRUE):
  1. User sees seasons advance over turns and drift temperature, visibly affecting the world.
  2. Natural disasters (flood/drought/earthquake/eruption) trigger, are announced via a forecast, are logged, and physically reshape the terrain.
  3. Renewable resources (moss, kelp, wood, fiber, herbs) regrow over time while finite resources (ore, glowshards, amber, stone) stay depleted, creating observable sustained scarcity.
**Plans**: TBD

Plans:
- [ ] 03-01: TBD

> **Implementation notes:** New `CivEnvironment` / `CivDisaster` in `civilization.rs`; `tick_environment`, `apply_disaster_effects` (reuse `place_resource_patch`, `floor_y_at`, `is_substrate`, `seabed_row_at`), `resource_regrowth`. Single-player game mechanics are duplicated in `civilization.rs` and `tauriBrowserFallback.ts` — keep both in lockstep where the change touches shared mechanics. Backend tests can't run on Windows — verify via `cargo check` + `cargo clippy` + `cargo test --no-run` (spec names `disaster_effects_are_bounded_and_mutate_world`, `seasons_cycle`, `regrowth_is_renewable_only`).

### Phase 4: W6 — Combat & Diplomacy
**Goal**: Civilizations can claim/own/contest territory, resolve combat and raids deterministically with population/resource/territory consequences, set diplomacy stances and execute trades (allies don't fight), and defend with strength against wild predators that hunt axolotls.
**Depends on**: Phase 1 (needs multi-civ decisions/turn loop). Benefits from Phase 3 (disasters such as `predator_incursion` spawn the wild predators) but does not strictly require it.
**Requirements**: WAR-01, WAR-02, WAR-03, WAR-04
**Success Criteria** (what must be TRUE):
  1. A civilization can claim and own a region; ownership is tracked, contestable, and visible to the user.
  2. Hostile civilizations resolve combat/raids deterministically, with visible population/resource/territory consequences (loser loses population, resources looted, region owner can flip).
  3. Civilizations set diplomacy stances and execute trades; allied/trading civs do not fight each other.
  4. Wild predators spawn and hunt axolotls, civilizations defend with strength, and killed predators drop food.
**Plans**: TBD

Plans:
- [ ] 04-01: TBD

> **Implementation notes:** Extend the decision schema (`target_civ`, `region_id`, `offer`/`request` maps) with new `action_type`s (`claim`/`raid`/`fortify`/`diplomacy`/`migrate`) validated in `validate_action` and dispatched in `apply_model_decision`; `resolve_interactions(snapshot)` resolves combat/raids/trades/predators deterministically (seeded). Scoring folds territory/aggression into the existing ethics/intelligence/survival axes. Backend tests can't run on Windows — verify via `cargo check` + `cargo clippy` + `cargo test --no-run` (spec names `combat_is_deterministic_and_conserves_or_destroys`, `claim_sets_region_owner`, `allies_do_not_fight`, `predator_hunts_then_drops_food`).

### Phase 5: W5 — Genetics Depth & Selection
**Goal**: Axolotls carry expanded genetics (new traits + pattern alleles) that cross Mendelian-style and are visible, and environmental pressure (e.g. ice age, plague) raises mortality for ill-adapted genes so populations measurably evolve over runs.
**Depends on**: Phase 3 (selection pressure needs the environment engine's seasons/disasters) and Phase 4 (the `strength` gene feeds combat).
**Requirements**: GEN-01, GEN-02
**Success Criteria** (what must be TRUE):
  1. Axolotls carry expanded genetics (new traits + pattern alleles) that cross Mendelian-style across breeding and are visibly distinguishable (color morph × pattern × civ palette).
  2. Environmental pressure (ice age, plague) raises mortality for ill-adapted genes, so a population's gene distribution measurably shifts over a run.
**Plans**: TBD

Plans:
- [ ] 05-01: TBD

> **Implementation notes:** Extend `CivGenes` (all `#[serde(default)]` so old eggs deserialize): `speed`, `cold_tolerance`, `disease_resistance`, `forage_yield`, `strength`, `pattern_a`/`pattern_b`. Update `random_genes`/`cross_genes`/`default_genes`; `expressed_pattern` mirrors `expressed_morph`; selection pressure in `run_life_cycle`; disasters temporarily raise mutation rate. Backend tests can't run on Windows — verify via `cargo check` + `cargo clippy` + `cargo test --no-run` (spec names `genetics_cross_is_deterministic_and_valid`, `selection_pressure_under_ice_age_favors_cold_tolerance`).

---

## Progress

**Execution Order (v2.0):**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. W9-lite — Multi-Model World Creation + Leaderboard | v2.0 | 0/4 | Planned | - |
| 2. W8 — Renderer Multi-Civ Identity | v2.0 | 0/2 | Planned | - |
| 3. W4 — Environment Engine | v2.0 | 0/TBD | Not started | - |
| 4. W6 — Combat & Diplomacy | v2.0 | 0/TBD | Not started | - |
| 5. W5 — Genetics Depth & Selection | v2.0 | 0/TBD | Not started | - |
| 1-6 (v1.0) | v1.0 | 33/33 | Complete | 2026-06-06 |

---

## Coverage (v2.0)

- **v2.0 requirements:** 16
- **Mapped:** 16 / 16
- **Orphans:** 0
- **Duplicates:** 0

| Phase | Workstream | Requirement IDs | Count |
|-------|-----------|-----------------|-------|
| 1 | W9-lite | CIV-01, CIV-02, CIV-03, ARENA-01, ARENA-02, ARENA-03 | 6 |
| 2 | W8 | REN-01, REN-02 | 2 |
| 3 | W4 | ENV-01, ENV-02, ENV-03 | 3 |
| 4 | W6 | WAR-01, WAR-02, WAR-03, WAR-04 | 4 |
| 5 | W5 | GEN-01, GEN-02 | 2 |

---
*v2.0 roadmap created: 2026-06-06 (reset phase numbering; v1.0 archived)*
