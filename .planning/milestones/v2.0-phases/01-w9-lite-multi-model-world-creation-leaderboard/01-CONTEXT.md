# Phase 1: W9-lite — Multi-Model World Creation + Leaderboard - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the **already-multi-civ backend** *creatable, watchable, and harness-drivable* from the desktop app. Deliver:
1. A multi-model **world creation flow** (2–3 participants, each a model + color).
2. A live **leaderboard** that ranks the living civs by score as turns advance.
3. **Per-civ model decision visibility** in the log.
4. An **arena bridge**: a text-state read API (`render_game_to_text()`) and a control API (`civPilotControls` / `codex-play-civ.mjs`) that report and drive the multi-civ world, with the leaderboard doubling as a harness scoreboard.

**Key grounding fact (verified against code, not just the spec doc):** the backend is *further along than `civ-multi-civ-world-plan.md`'s 2026-06-05 status implies*. The turn loop already iterates per-civ (`advance_civ_turn` → `civ_turn_order` → per-civ `call_model_text`), `leaderboard(&snapshot.civs)` already emits ranked civs in the `TurnResolved` payload, `rescore_all_civs`/`score_civilization` are per-civ, and `CivSessionSnapshot` is already `civs: Vec<CivCivilization>`. So Phase 1 is predominantly a **frontend + IPC-surface + arena-bridge** effort — NOT a backend turn-loop rewrite.

**In scope:** multi-participant `create_civ_session`; multi-model creation UI; leaderboard panel; per-civ decision log; `render_game_to_text()` multi-civ extension; harness drives one civ by id + controller-tagged scoreboard.

**Out of scope (deferred per REQUIREMENTS.md):** add-civilization **mid-run UI** + `add_civ_to_session` command, environment HUD, diplomacy-management UI. Renderer per-civ tints / camera focus are **Phase 2 (W8)** — Phase 1 only needs colors assigned/stored and leaderboard row-click to set a `selectedCivId` that Phase 2's `focusCiv` will consume.

</domain>

<decisions>
## Implementation Decisions

### Creation UI & Participants (CIV-01)
- **D-01:** Each added participant auto-gets the next distinct color from a fixed palette, with a color chip to **override**. (auto palette + override)
- **D-02:** The **same model may power multiple civs** in one world (e.g. two Kimi civs) — civs stay distinct by color/name. No unique-model constraint.
- **D-03:** Creation allows **1–3 participants**. A single participant (1) is permitted and maps to the **single-model back-compat path**; founding requires ≥1.
- **D-04:** Per-civ names are **auto-generated but inline-editable** (default to model name or "Civ 1/2/3").
- **D-05:** Backend `create_civ_session` moves to multi-participant `CivSessionConfig { name, seed, civs: Vec<CivParticipant { name, model, color? }> }` and MUST keep accepting the legacy single `model` by mapping it to a one-element `civs`. New `CivParticipant` struct + `.typ::<…>()` registration in `lib.rs`; regenerate `bindings.ts` via one `tauri dev` (gotcha #1) — keep single-model back-compat in the generated shape.

### Leaderboard (CIV-02)
- **D-06:** Leaderboard lives in a **persistent top bar** above the canvas (always visible while watching turns), not in a drawer.
- **D-07:** **Minimal rows**: color swatch · rank · name · `score.total`. Richer per-civ vitals (model, population, era) surface in the observer panel when a civ is selected.
- **D-08:** **Dead/collapsed civs greyed at the bottom** with a "collapsed" marker (survival story stays visible) — not hidden.
- **D-09:** **Clicking a leaderboard row selects that civ** → sets the shared `selectedCivId` that drives the observer panel + per-civ log filter, and is the same selection Phase 2's `focusCiv` will consume. Leaderboard is the primary civ navigator.

### Per-Civ Decision Log (CIV-03)
- **D-10:** **One combined chronological stream**, each entry color-tagged + model-name-tagged; selecting a civ **filters** the log to that civ. (combined, filter-on-select)
- **D-11:** Each decision entry shows **action + the model's rationale** (rationale field if present in the decision), not action-only.
- **D-12:** Model **reasoning / chain-of-thought is collapsed behind a per-entry expand toggle** (available, not noisy). NOTE: reasoning models (Kimi/DeepSeek) stream `delta.reasoning_content` separately (gotcha #6) — surfacing it may require threading reasoning text into the `ModelDecision`/log entry; research must confirm whether the backend currently captures it.

### Harness Arena Bridge (ARENA-01/02/03)
- **D-13:** `render_game_to_text()` is **extended additively** — existing `player`/`civilization` keys keep working so the current `codex-play-civ.mjs` does not break (ARENA-02 "without breaking existing controls"); ADD `civs[]` (per-civ summaries) + `leaderboard` + `environment`.
- **D-14:** Text-state output stays **structured JSON** (serializable text, no pixel parsing) — matches how `codex-play-civ.mjs`/`civPilot.ts` already parse it.
- **D-15:** A harness drives **one civ by id** (a `civ_id` passed into `civPilotControls.start`); the other civs remain AI-model-driven. This is the "harness vs the AI models" arena framing.
- **D-16:** The harness-driven civ carries a **controller tag** (harness/model id) shown on the leaderboard **and** in the text-state, so a run can attribute that civ's score to the controlling harness/model (ARENA-03). Distinguishes "harness X driving model Y" from "model Y playing itself".

### Claude's Discretion
- Exact palette hex values and contrast rules (just keep them visually distinct and legible on the canvas).
- Precise top-bar layout/styling and how it collapses on narrow widths.
- Exact field set inside `civs[]` summaries in the text-state (cover at least: id, name, model, color, alive, population, era, score, controller tag).
- How `selectedCivId` is stored (civStore vs component state) — pick what fits existing patterns.
- Log entry visual design and the expand-toggle interaction.
- Whether the controller tag is set at creation, at `civPilotControls.start`, or both.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spec of record
- `civ-multi-civ-world-plan.md` — W1–W10 spec-of-record. **W9 section** (lines ~386–406) defines the `create_civ_session` multi-participant shape, leaderboard panel, and the `render_game_to_text` extension. **W8 section** (line ~380) is where the `render_game_to_text` multi-civ update was originally scoped — Phase 1 pulls that text-state update forward (renderer tints/camera stay in Phase 2). Note the doc's status block understates backend progress — verify against code.

### Backend engine (Rust)
- `tauri-app/src-tauri/src/civilization.rs` — engine. Current state: `CivSessionConfig` (single `model`, ~L251), `create_civ_session` (~L577), `advance_civ_turn` multi-civ loop (~L681), `leaderboard()` (~L1491), `rescore_all_civs`/`score_civilization` (~L1517), `CivSessionSnapshot { civs: Vec<…>, environment }` (~L271). `CivParticipant`/`add_civ_to_session` do NOT exist yet.
- `tauri-app/src-tauri/src/lib.rs` — command + `.typ::<…>()` registration (~L154–168). Add `CivParticipant`; update `create_civ_session` registration.

### Frontend (TS/React)
- `tauri-app/src/bindings.ts` — **auto-generated** (gotcha #1); regen via one `tauri dev` after the Rust command changes. Currently exports single-model `CivSessionConfig`.
- `tauri-app/src/stores/civStore.ts` — `createSession({ name, model, seed })` (~L26/238), already normalizes v1↔v2 multi-civ snapshots (~L81–109), `loadModels()`→`listModels()` (~L219). No leaderboard/selectedCiv state yet.
- `tauri-app/src/components/civilization/CivilizationView.tsx` — single-model `<select>` creation card (~L805–838), observer right drawer (~L997–1084), `window.civPilotControls.start/stop` (~L408–444). No leaderboard panel, no multi-model picker.
- `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx` — Phaser renderer; owns `renderSnapshotToText` / `window.render_game_to_text` hook (currently legacy single-civ).

### Arena bridge
- `tauri-app/scripts/codex-play-civ.mjs` — external harness driver; reads `window.render_game_to_text()` (~L149) and currently expects single-civ `state.civilization.resources` (~L177). Must keep working under additive extension.
- `tauri-app/src/lib/civPilot.ts` — `CivPilotTextState` type (~L60–96) + pilot memory; the contract the harness parses.

### Project guardrails
- `CLAUDE.md` (repo root) — gotchas: #1 bindings.ts auto-gen drift, #2 config.json is a free-form map, #3 u64/i64 specta bigint cast, #5 Tauri backend `cargo test` can't run on Windows (use `cargo check`+`clippy`+`test --no-run`; tests run on CI Linux/macOS), #6 reasoning models stream `reasoning_content` separately.
- `.planning/REQUIREMENTS.md` — CIV-01/02/03, ARENA-01/02/03 + the deferred list.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `leaderboard(&snapshot.civs)` (civilization.rs ~L1491) already returns ranked civ summaries in `TurnResolved` — the leaderboard panel renders this; no new ranking logic needed.
- `civStore.ts` snapshot normalization already produces a `civs[]` array (handles legacy v1) — the panel + log read from it directly.
- `listModels()` command + `loadModels()` store action already surface available models for the picker.
- Existing observer drawer (`ColonyPanel`/`RosterRow`, log section) can be filtered by `selectedCivId` rather than rebuilt.
- `civPilotControls.start/stop` and `CivPilotTextState` already exist — extend, don't replace.

### Established Patterns
- IPC snapshot crosses as a serialized String, so snapshot-shape changes need no bindings regen — but the **command signature change** to `create_civ_session` DOES require a bindings regen (gotcha #1).
- Single-player mechanics are duplicated across `civilization.rs` and `tauriBrowserFallback.ts` — keep in lockstep if a change touches shared mechanics.

### Integration Points
- `selectedCivId` is the connective tissue: leaderboard row-click → observer panel + log filter → (Phase 2) `focusCiv`.
- `create_civ_session` (Rust) ↔ `createSession` (store) ↔ creation card (View) ↔ `bindings.ts` (regen) — the multi-participant change ripples through all four.
- `render_game_to_text()` ↔ `codex-play-civ.mjs` ↔ `civPilot.ts` — additive extension must preserve existing keys.

</code_context>

<specifics>
## Specific Ideas

- Framing: "harness vs the AI models" — the leaderboard is the shared scoreboard; a controller-tagged civ lets a run compare an external harness against the configured provider models.
- Back-compat is a hard requirement, not a nicety: 1-participant worlds, legacy snapshots, and the existing `codex-play-civ.mjs` must all keep working.

</specifics>

<deferred>
## Deferred Ideas

- **Add-civilization mid-run UI + `add_civ_to_session` command** — deferred (full W9 beyond the lite slice). Phase 1 stores colors/participants but does not add civs to a running world.
- **Environment HUD** (season/temperature/water/disasters/forecast) — Phase 3 (W4) territory; not surfaced this phase even though `environment` rides along in the text-state.
- **Diplomacy-management UI** — Phase 4 (W6).
- **Renderer per-civ tints + multi-colony camera / `focusCiv`** — Phase 2 (W8). Phase 1 only sets the `selectedCivId` it will consume.

None of the discussion strayed outside the phase scope; all deferrals are pre-existing roadmap boundaries.

</deferred>

---

*Phase: 1-w9-lite-multi-model-world-creation-leaderboard*
*Context gathered: 2026-06-06*
