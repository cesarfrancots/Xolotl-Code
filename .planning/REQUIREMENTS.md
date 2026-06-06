# Requirements: v2.0 Civ Simulation

**Milestone goal:** Turn the Axolotl Civilization game into a living, watchable, multi-AI-civilization simulation — and a harness eval/arena where agentic harnesses compete on a shared scoreboard.

**Spec-of-record:** `civ-multi-civ-world-plan.md` (W1–W10). Backend is already structurally multi-civ; `advance_civ_turn` (tauri-app/src-tauri/src/civilization.rs:681) already calls each civ's own LLM via `call_model_text`. Done: W1, W2, W10.1, W10.2.

---

## v2.0 Requirements

### Civilization Setup & Scoreboard (maps to W9-lite — Phase 1)
- [ ] **CIV-01**: User can create a world with 2–3 AI-model civilizations, each assigned a distinct color, from the Civ creation UI.
- [ ] **CIV-02**: User sees a leaderboard ranking the living civilizations by score, updating as turns advance.
- [ ] **CIV-03**: Each civilization is governed by its own configured model (real providers from `~/.xolotl-code/config.json`), and per-civ model decisions are visible in the log.

### Harness Arena (cross-cutting — primarily landed in Phase 1, preserved throughout)
- [ ] **ARENA-01**: An external/agentic harness can read full game state as text via `window.render_game_to_text()` (includes per-civ summaries + leaderboard) without parsing pixels.
- [ ] **ARENA-02**: An external/agentic harness can drive the game programmatically via the `window.civPilotControls` bridge / `scripts/codex-play-civ.mjs` without breaking existing controls.
- [ ] **ARENA-03**: The leaderboard doubles as a harness scoreboard — a run can attribute civ scores to the controlling harness/model for comparison.

### Renderer Multi-Civ Identity (maps to W8 — Phase 2)
- [ ] **REN-01**: Each civilization's axolotls/buildings/territory render tinted by that civ's color so colonies are visually distinguishable.
- [ ] **REN-02**: The camera frames all colonies by default and can focus a single civ (`focusCiv`), at the larger multi-civ world scale without performance collapse.

### Environment Engine (maps to W4 — Phase 3)
- [ ] **ENV-01**: Seasons advance over turns and drift temperature, visibly affecting the world.
- [ ] **ENV-02**: Natural disasters (e.g. flood/drought/earthquake/eruption) trigger and physically reshape terrain, and are logged + announced via a forecast.
- [ ] **ENV-03**: Renewable resources regrow over time while finite resources stay depleted, creating sustained scarcity.

### Combat & Diplomacy (maps to W6 — Phase 4)
- [ ] **WAR-01**: A civilization can claim/own territory (regions), and ownership is tracked and contestable.
- [ ] **WAR-02**: Hostile civilizations resolve combat/raids deterministically, with population/resource/territory consequences.
- [ ] **WAR-03**: Civilizations can set diplomacy stances and execute trades; allied/trading civs do not fight.
- [ ] **WAR-04**: Wild predators spawn and hunt axolotls; civilizations defend with strength.

### Genetics & Selection (maps to W5 — Phase 5)
- [ ] **GEN-01**: Axolotls carry expanded genetics (new traits + pattern alleles) that cross Mendelian-style and are visible.
- [ ] **GEN-02**: Environmental pressure (e.g. ice age, plague) raises mortality for ill-adapted genes, so populations measurably evolve over runs.

---

## Future Requirements (deferred)

- Add-civilization mid-run UI, environment HUD, and diplomacy-management UI (full W9 beyond the lite slice).
- W10.3–W10.7: terraform/place action, structure blueprints, prospecting, fBm terrain, caves.
- "Zoom into a civ" embodied mode reusing the parked single-player possession layer (Game B), optionally LLM-driven.

## Out of Scope (this milestone)

- Single-player possession action game as a primary surface — parked; sim-first this milestone.
- Multiplayer/networked human play.
- New art-asset generation pipeline beyond what existing morphs/tiles support (W7) — only add assets if a phase strictly needs them.

---

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| _(filled by roadmap)_ | | |
