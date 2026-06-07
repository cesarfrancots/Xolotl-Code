# Milestones

## v2.0 Civ Simulation (Shipped: 2026-06-07)

**Phases completed:** 5 phases, 14 plans, 31 tasks

**Key accomplishments:**

- The backend's single-civ entry point is gone: `create_civ_session` now founds 1-3 civilizations with per-civ controller attribution and persisted model reasoning, and the TS bindings expose all of it.
- Replaced the single-model colony-creation card with a 1-3 participant picker (per-row editable name, model select with same-model allowed, and overridable color chip auto-assigned from the backend CIV_COLORS palette), wired it to a multi-participant `createSession`, and added store-owned `selectedCivId` selection state that resets on every session change.
- `render_game_to_text()` now emits the full multi-civ state and a score-sorted leaderboard as structured JSON while keeping the legacy single-civ keys byte-identical, locked by a vitest contract spec — the ARENA-02 back-compat gate holds.
- Persistent top-bar leaderboard that ranks living civs, greys collapsed ones, and on row-click drives a selectedCivId-scoped observer panel + per-civ log with an expandable model-reasoning toggle; plus an additive civPilotControls.start({civId, controller}) that scopes selection and attributes a controller tag via set_civ_controller without breaking the legacy bridge.
- REN-01 identity layer: every living civ's axolotls, buildings, and owned territory render multiply-tinted by that civ's color (morph/GFP detail preserved), wild fauna and unowned regions stay neutral, and dead civs grey — driven by four pure, fail-safe, unit-tested tint helpers and a per-snapshot civColorById map.
- Multi-colony camera framing (bounding box over all living civs) with an additive `window.civCamera.focusCiv`/`frameAll` bridge wired to `selectedCivId`, plus pure unit-tested `colonyBounds`/`focusTarget` helpers — REN-02.
- Two pure, seed-deterministic environment leaf helpers — `advance_season` (4-season cycle + smooth temperature/water drift, ENV-01) and `regrow_resources` (renewable-only regrowth toward a cap, finite stays depleted, ENV-03) — plus their 9 determinism/invariant unit tests, all in `civilization.rs`, with zero new clippy warnings and no IPC/bindings change.
- Two pure, seed-deterministic disaster helpers — `roll_forecast` (season/temperature-weighted Option<CivDisaster> roll with a forecast-lead countdown reusing `remaining_turns`) and `apply_disaster_to_tiles` (bounded, invariant-safe sub-surface substrate→water reshape) — backed by 10 determinism/bounds/invariant unit tests, with zero new clippy warnings and no IPC/bindings change.
- Wired the four Wave-1/2 pure helpers into a single deterministic per-turn `tick_environment` orchestrator inserted at turn start in `advance_civ_turn`, so seasons drift, disasters forecast→fire→reshape terrain, and renewables regrow while finite stays depleted — end to end with zero frontend changes.
- 5 optional CivDecisionAction fields + claim_region/set_stance/apply_trade engine helpers wired into validate_action and apply_model_decision, with the model observation exposing region ids and a clean headless bindings.ts regen (WAR-01, WAR-03).
- Deterministic combat: the civ_strength Phase-5 seam, resolve_attack (entity-removal casualties bounded to leave >=1 survivor, conserved bounded plunder, peripheral region seize), a unilateral ally no-fight gate, and a queued attacker-sorted combat world pass wired into advance_civ_turn before resolve_environment so the population mirror reflects casualties this same turn (WAR-02, WAR-03).
- WAR-04 wild predators: a fired predator_incursion now spawns net-new civ_id:None predator entities (deterministic predator-{turn}-{n} ids) near the threatened colony while keeping the quarrel_pressure modifier, and a byte-deterministic step_predators world pass (own salt 0xBADD_CA75) moves them toward the nearest colony, hunts by removing axolotl ENTITIES (bounded, never to 0) reduced by civ_strength defense, lets strong civs cull predators (dropping food), and expires predators by lifespan — wired into advance_civ_turn after resolve_combat and before resolve_environment so casualties land before the population mirror re-syncs.
- A second visible Mendelian pattern allele pair (plain/spotted/striped/marbled) plus three quantitative traits (strength/cold_resistance/disease_resistance) added to CivGenes, crossed Mendelian-style + clamped-blended deterministically, expressed onto every axolotl and into the text-state, with the Phase-4 civ_strength seam closed by summing genes.strength.
- A pure bounded `gene_mortality_modifier` plus a first-class forecastable `plague` disaster drive ONE extra deterministic per-axolotl death roll in `run_life_cycle` (into the existing deaths/retain/population-mirror pipeline, behind a >=1-survivor floor), and a deterministic multi-turn test PROVES populations measurably evolve — mean `cold_resistance` strictly rises under sustained cold. This closes GEN-02 and milestone v2.0.

**Verification status:** All 17/17 requirements implemented and **automated-verified** (vitest + `cargo test --no-run`/clippy; milestone audit PASSED — see `milestones/v2.0-MILESTONE-AUDIT.md`). **Live human UAT still pending** — Phases 02 (renderer) and 03 (environment) carry `human_needed` verification gaps requiring a running desktop build (real providers + WebView2): the live multi-civ sim has not yet been watched end-to-end by a human, the backend `cargo test` suite has not been run on Linux/macOS CI, and the desktop exe has not been refreshed via `build.bat`. Code-complete and archived; final live sign-off is a human/CI gate.

**Known deferred items at close:** 2 verification gaps (Phase 02, Phase 03 — human UAT) + 3 scope deferrals (full W9 UI, W10.3–W10.7 world features, Game B possession). Several deferrals are folded into milestone v2.1. See STATE.md Deferred Items.

---

## v1.0 Orchestration MVP (Shipped: 2026-06-06)

**Phases completed:** 6 phases, 29 plans, 38 tasks

**Key accomplishments:**

- SharedContextStore (Arc<RwLock> + whitespace TooLarge guard) and GitOpQueue (mpsc+oneshot serialized git write queue) wired into supervisor/mod.rs, satisfying ORC-04 and ORC-07.
- One-liner:
- TauriPermissionPrompter implemented with std::sync::mpsc + 60s recv_timeout; respond_to_permission and test_permission_prompt wired; PendingPrompts managed state registered; PermissionDecision exported to bindings.ts; cargo build exits 0; tsc passes.
- Three Tauri plugins (window-state, clipboard-manager, fs) registered in Builder chain with five capability grants; human checkpoint confirmed all TAU-01 through TAU-05 requirements passing in a live Tauri window on Windows.
- All 19 verification steps: APPROVED
- One-liner:

---
