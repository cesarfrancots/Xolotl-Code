# Phase 1: W9-lite — Multi-Model World Creation + Leaderboard - Research

**Researched:** 2026-06-06
**Domain:** Tauri desktop app (React/TS frontend + Rust IPC) — making an already-multi-civ backend creatable/watchable/harness-drivable
**Confidence:** HIGH (every claim below verified against current code with file:line citations)

## Summary

The CONTEXT.md grounding fact is **correct and verified against code**: the backend turn loop, scoring, leaderboard, multi-civ snapshot, and even multi-civ *world generation* (`found_colony` per civ) already exist. Phase 1 is overwhelmingly a **frontend + IPC-surface + arena-bridge** effort with **two narrow, well-scoped backend additions**:

1. `create_civ_session` must accept multiple participants and actually generate a multi-civ world (today it hardcodes `generate_world(seed, 1)` and builds exactly one `CivCivilization`, even though `generate_world(seed, N)` and `found_colony` already support N civs).
2. A `controller` tag field on `CivCivilization` for ARENA-03 score attribution (no such field exists anywhere today).

Everything else (leaderboard ranking, per-civ scoring, v1↔v2 snapshot migration, civ-tagged world entities, reasoning capture up to event emission) is already built and just needs to be surfaced.

**The single highest-leverage finding (D-12):** model chain-of-thought is **already captured end-to-end on the backend** (`delta.reasoning_content` → `AgentEvent::ReasoningDelta` → `ModelTextResult.reasoning` → emitted in the `ModelDecision` event at civilization.rs:753). BUT the frontend listener **drops the `ModelDecision` event entirely** (CivilizationView.tsx:233-236 only reads `payload.snapshot`/`payload.error`), and the persisted `snapshot.log` "ai_decision" entry contains only `public_rationale` + `ethics_note`, **never the reasoning**. So D-12 needs a *plumbing* decision — capture the live event into frontend state, OR persist reasoning into the log — but requires **no model/provider work**. It degrades gracefully to "rationale only" if neither is done.

**Primary recommendation:** Treat this as 5 surgical workstreams: (1) multi-participant `create_civ_session` + `CivParticipant` + headless bindings regen; (2) multi-model creation card; (3) leaderboard top-bar reading the existing `leaderboard()` payload; (4) `selectedCivId` in `civStore` driving observer panel + per-civ log filter + reasoning toggle; (5) additive `render_game_to_text` extension + `civId`/controller threading into `civPilotControls`. Back-compat (1-participant world, legacy snapshot, existing `codex-play-civ.mjs`) is a hard gate, and the codebase already has the test pattern for it.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Multi-participant world creation | Rust engine (`create_civ_session`) | TS store/UI | World gen, civ founding, scoring are backend; UI only collects participants |
| Leaderboard ranking | Rust engine (`leaderboard()`) | TS top-bar | Ranking already computed backend-side and ships in `TurnResolved`; UI renders |
| Per-civ score | Rust engine (`score_civilization`/`rescore_all_civs`) | — | Pure backend, per-civ, already exists |
| `selectedCivId` selection state | TS frontend (civStore) | — | Pure UI navigation concern; backend is stateless re: selection |
| Per-civ decision log + reasoning toggle | TS frontend | Rust (emits/persists) | Log data is backend; filtering/expand UI is frontend |
| Text-state read API (`render_game_to_text`) | TS frontend (`renderSnapshotToText`) | — | Built in the canvas component from the snapshot; not a Rust command |
| Harness control bridge (`civPilotControls`) | TS frontend | — | `window`-attached browser bridge; backend unaware |
| Controller tag (ARENA-03) | Rust engine (stored on civ) | TS (sets at create + surfaces) | Must persist with the civ and ride the snapshot + leaderboard |

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Each participant auto-gets the next distinct color from a fixed palette, with a color chip to **override**.
- **D-02:** The **same model may power multiple civs** (no unique-model constraint).
- **D-03:** Creation allows **1–3 participants**; a single participant maps to the single-model back-compat path; founding requires ≥1.
- **D-04:** Per-civ names are **auto-generated but inline-editable** (default model name or "Civ 1/2/3").
- **D-05:** Backend moves to `CivSessionConfig { name, seed, civs: Vec<CivParticipant { name, model, color? }> }`, MUST keep accepting legacy single `model` mapped to a one-element `civs`. New `CivParticipant` struct + `.typ::<…>()` in lib.rs; regenerate `bindings.ts`.
- **D-06:** Leaderboard lives in a **persistent top bar** above the canvas (not a drawer).
- **D-07:** **Minimal rows**: color swatch · rank · name · `score.total`. Richer vitals in observer panel on select.
- **D-08:** **Dead/collapsed civs greyed at the bottom** with a "collapsed" marker — not hidden.
- **D-09:** **Clicking a row selects that civ** → sets shared `selectedCivId` (drives observer panel + per-civ log filter; same selection Phase 2's `focusCiv` consumes). Leaderboard is the primary civ navigator.
- **D-10:** **One combined chronological log stream**, each entry color-tagged + model-name-tagged; selecting a civ **filters** the log.
- **D-11:** Each decision entry shows **action + model's rationale** (rationale field if present), not action-only.
- **D-12:** Model **reasoning/chain-of-thought collapsed behind a per-entry expand toggle**. Research must confirm whether backend captures `reasoning_content`. (CONFIRMED — see §1 below.)
- **D-13:** `render_game_to_text()` **extended additively** — existing `player`/`civilization` keys keep working; ADD `civs[]` + `leaderboard` + `environment`.
- **D-14:** Text-state output stays **structured JSON**.
- **D-15:** A harness drives **one civ by id** (a `civ_id` passed into `civPilotControls.start`); others stay AI-model-driven.
- **D-16:** The harness-driven civ carries a **controller tag** (harness/model id) shown on the leaderboard AND in the text-state.

### Claude's Discretion
- Exact palette hex values & contrast rules (keep visually distinct/legible).
- Top-bar layout/styling and narrow-width collapse.
- Exact field set inside `civs[]` text-state summaries (≥ id, name, model, color, alive, population, era, score, controller tag).
- How `selectedCivId` is stored (civStore vs component state) — pick what fits existing patterns.
- Log entry visual design + expand-toggle interaction.
- Whether controller tag is set at creation, at `civPilotControls.start`, or both.

### Deferred Ideas (OUT OF SCOPE)
- Add-civilization **mid-run UI** + `add_civ_to_session` command.
- Environment HUD (season/temp/water/disasters/forecast).
- Diplomacy-management UI.
- Renderer per-civ tints + multi-colony camera / `focusCiv` (Phase 2). Phase 1 only **stores colors** and **sets the `selectedCivId`** Phase 2 will consume.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CIV-01 | Create a world with 2–3 color-distinct AI-model civs from the creation UI | `create_civ_session` → multi-participant (§2); `generate_world(seed,N)` + `found_colony` already multi-civ (civilization.rs:979,1219); creation card at CivilizationView.tsx:805-838 (§2) |
| CIV-02 | Leaderboard ranking living civs by score, updating per turn | `leaderboard(&snapshot.civs)` already in `TurnResolved` (civilization.rs:786,1492); store already yields `civs[]` (§3); top-bar panel (D-06) |
| CIV-03 | Each civ governed by its own configured model; per-civ decisions visible in log | `advance_civ_turn` already per-civ via `call_model_text` (civilization.rs:699-757); decisions logged via `push_log("ai_decision",…)` (civilization.rs:2055); reasoning capture (§1) |
| ARENA-01 | Harness reads full state as text incl. per-civ + leaderboard via `render_game_to_text()` | `renderSnapshotToText` additive extension (§5; CivilizationGameCanvas.tsx:3135) |
| ARENA-02 | Harness drives the game via `civPilotControls`/`codex-play-civ.mjs` without breaking existing controls | `civPilotControls.start/stop` (CivilizationView.tsx:409-440); preserve `player`/`civilization`/`visible_entities` keys (§5, §6) |
| ARENA-03 | Leaderboard doubles as harness scoreboard; attribute civ score to controller | New `controller` field on `CivCivilization` + leaderboard JSON + text-state (§6) |

## 1. D-12 / Reasoning Capture (HIGHEST PRIORITY) — CONFIRMED CAPTURED, NOT SURFACED

**Verdict: the backend captures chain-of-thought end-to-end. No model/provider work is needed. The gap is pure frontend/log plumbing.**

Verified pipeline (bottom-up):
- `commands.rs:4129` — the OpenAI-compatible streaming client reads `delta["reasoning_content"]` and emits `AgentEvent::ReasoningDelta(...)` (also `commands.rs:3869` for the Anthropic `thinking` path). This is exactly gotcha #6's separate reasoning stream.
- `civilization.rs:823` — `call_model_text` accumulates `AgentEvent::ReasoningDelta(text)` into a local `reasoning` String, returning `ModelTextResult { content, reasoning }` (struct at civilization.rs:793-796).
- `civilization.rs:745-755` — `advance_civ_turn` emits a `ModelDecision` event per civ per turn carrying `{ turn, civ_id, decision, reasoning: first.reasoning }`.

**Where it breaks (the gap):**
- **Live event dropped:** `CivilizationView.tsx:233-236` — the `civ-event:{id}` listener only acts on `payload.snapshot` and `payload.error`. The `ModelDecision` payload has **no `snapshot`** (see emit at civilization.rs:749), so its `reasoning` is silently discarded by the UI today. The `CivEventPayload` type (CivilizationView.tsx:148-152) doesn't even model `civ_id`/`decision`/`reasoning`.
- **Not persisted:** the decision is also written to `snapshot.log` via `apply_model_decision` → `push_log("ai_decision", "{civ_name} intent: {intent}", "{public_rationale}\nEthics: {ethics_note}")` (civilization.rs:2054-2063). This entry carries rationale + ethics but **never the reasoning**. `CivLogEntry` (civilization.rs:511-518) has fields `turn, kind, title, body, created_at` — **no `civ_id`, no `reasoning`**.

**Two implementation options for the planner (pick one; both are in-scope-small):**

| Option | Backend change | Frontend change | Pros / Cons |
|--------|---------------|-----------------|-------------|
| **A — Capture live event** | None (event already emitted) | Extend `CivEventPayload` to include `type==="ModelDecision"` with `{civ_id, decision, reasoning}`; in the listener, stash `reasoning` keyed by `(turn, civ_id)` in a React ref/state for the log toggle | No snapshot/log schema change, no bindings regen. Reasoning is **ephemeral** — lost on reload (turn snapshots don't replay events). Fine if D-12 is "available while watching live". |
| **B — Persist into log** | Add `civ_id: Option<String>` and `reasoning: Option<String>` (both `#[serde(default)]`) to `CivLogEntry`; thread `reasoning` into the `ai_decision` `push_log`. Crosses IPC as serialized String (no bindings regen needed for snapshot shape — see §2 note), but `CivLogEntry` is registered via `.typ::<CivLogEntry>()` (lib.rs:165) so a **bindings regen IS needed** for the new fields to appear in TS | Update `apply_model_decision` call site + `push_log` signature, plus frontend reads `entry.reasoning` | Reasoning survives reload and is **civ-filterable** by a real `civ_id` field (helps D-10 too). Slightly larger blast radius (push_log has ~40 call sites — prefer a separate `push_decision_log` helper rather than changing `push_log`'s signature). |

**Recommendation [VERIFIED: code trace]:** Option B with a **new** `push_decision_log(snapshot, civ_id, intent, rationale, ethics, reasoning)` helper (don't touch the shared `push_log` used by ~40 call sites). This also gives `CivLogEntry.civ_id` which makes the D-10 per-civ log filter robust (today the only civ linkage in a log entry is the civ name embedded in the title string — fragile to filter on). If the planner wants minimal blast radius, Option A is acceptable and D-12 degrades to "live-only, rationale always persists."

## 2. `create_civ_session` Multi-Participant Migration (D-05)

**Current shape [VERIFIED]:**
```rust
// civilization.rs:251-257
pub struct CivSessionConfig {
    pub name: String,
    pub model: String,
    #[serde(default)]
    pub seed: Option<u32>,
}
// civilization.rs:579 — create_civ_session(config) requires config.model non-empty,
// calls initial_snapshot(id, name, model, seed, now) → generate_world(seed, 1)
//                                                       → ONE CivCivilization
```
`bindings.ts:437-441` mirrors this single-model shape. `lib.rs:154` registers `.typ::<CivSessionConfig>()`.

**The hidden gap [VERIFIED]:** `initial_snapshot` (civilization.rs:836-922) is hardcoded to a single civ: `generate_world(seed, 1)` (line 843) and one `CivCivilization` literal (lines 882-904). HOWEVER, the multi-civ machinery already exists:
- `generate_world(seed, civ_count)` (civilization.rs:979) loops `for i in 0..civ_count { found_colony(&mut world, &mut rng, i, spawn_x) }` (lines 1084-1102), spreading spawns across livable regions.
- `found_colony` (civilization.rs:1219) tags every entity with `civ_id = civ_id_for(i)` = `"civ-{i+1}"` (line 1447-1449), claims the home region, and seeds `INITIAL_POPULATION` axolotls. Its doc comment literally says "Shared by initial world gen and (W9) add_civ_to_session."
- `CivCivilization` (civilization.rs:420-454) already has `id, name, model, color, spawn_x, home_region, alive, diplomacy, era, …, score` — fully multi-civ.
- `CIV_COLORS: [&str; 8]` (civilization.rs:66-68) is the palette; assigned round-robin by civ index (`CIV_COLORS[0]` used today at line 886).

So the work is: generalize `initial_snapshot` to build N civs and call `generate_world(seed, N)`, deriving each civ's `spawn_x`/`home_region` from the founded colonies.

**Target shape:**
```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivParticipant {
    pub name: String,
    pub model: String,
    #[serde(default)]
    pub color: Option<String>, // None => auto from CIV_COLORS[index]
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivSessionConfig {
    pub name: String,
    #[serde(default)]
    pub seed: Option<u32>,
    #[serde(default)]
    pub civs: Vec<CivParticipant>,
    // Back-compat: legacy single-model field. If `civs` is empty, map this to one participant.
    #[serde(default)]
    pub model: Option<String>,
}
```

**Back-compat mapping (serde accepts BOTH shapes):** Keep `model: Option<String>` on `CivSessionConfig` with `#[serde(default)]`. In `create_civ_session`: if `config.civs` is non-empty use it; else if `config.model` is `Some(non-empty)` synthesize `vec![CivParticipant { name: config.name, model, color: None }]`; else error "at least one civilization is required". This lets the **legacy front-end JSON `{name, model, seed}` deserialize unchanged** (the new `civs` field defaults to empty) AND the new front-end send `{name, seed, civs:[…]}`. Validate 1–3 participants (D-03) and each `model` non-empty.

> NOTE: making `model` `Option` is a *binding* change visible to TS. The current store always sends `model: string`. After the bindings regen, `createSession` should send the new `civs[]` shape; the `Option<String> model` purely guarantees old saved JSON / external callers don't break. Confirm the store's `createSession` signature is updated in lockstep (§3).

**lib.rs registration [VERIFIED at lib.rs:154-168]:** add `.typ::<CivParticipant>()` (alongside the existing `CivSessionConfig` line 154), and add `CivParticipant` to the `use civilization::{…}` import block (lib.rs:8-9). `create_civ_session` is already in the `collect_commands!` list (lib.rs:6, 109) — its signature change is picked up automatically.

**bindings.ts regen flow [VERIFIED]:** `tauri-app/src/bindings.ts` is auto-generated (gotcha #1). On Windows, the canonical headless regen is **`cargo run --bin export_bindings`** from `tauri-app/src-tauri` — this binary (src/bin/export_bindings.rs:1-14) calls `xolotl_lib::export_bindings("../src/bindings.ts")` (lib.rs:171) running only the `tauri-specta` exporter, no WebView2. This is the project memory's bindings-drift mitigation and avoids the `tauri dev` WebView2 dependency (gotcha #5). After regen, verify the generated `CivSessionConfig` (bindings.ts:437) gained `civs: CivParticipant[]` and a `CivParticipant` type appears, then `npx tsc --noEmit`.

**IPC note [VERIFIED]:** snapshot crosses IPC as a serialized String (`load_civ_session`/`advance_civ_turn` return `Result<String,String>`, civilization.rs:642-644, 790), so **snapshot-shape changes need no bindings regen** — only **command-signature** changes (the `CivSessionConfig` argument) and **registered `.typ::<…>()` struct** changes do. This is why the §1 Option B `CivLogEntry` field additions DO require a regen (CivLogEntry is a registered type) even though it rides inside the snapshot String — TS code reads `entry.reasoning` off the deserialized type.

## 3. Leaderboard Data Path (CIV-02)

**Already emitted [VERIFIED]:** `advance_civ_turn` emits `TurnResolved` with `"leaderboard": leaderboard(&snapshot.civs)` (civilization.rs:786). `leaderboard()` (civilization.rs:1492-1515) sorts civs strongest-first by `score.total` and returns per-civ JSON objects with exactly:
```
{ id, name, model, color, alive, population, era, score }   // score = {survival, ethics, intelligence, total}
```
This covers D-07's minimal row (color, name, score.total) **and** the richer observer fields (model, population, era) — no new ranking logic needed.

**Two viable read paths for the top-bar (planner choice):**
- **(a) Derive from the snapshot (recommended).** The store already holds `activeSnapshot.civs` (normalized, see below). The panel can sort `civs` by `score.total` desc itself (trivial, matches `leaderboard()`), so the leaderboard renders on **every** snapshot source (create, load, turn, intervention) — not just `TurnResolved`. This avoids adding leaderboard event state and keeps a single source of truth.
- **(b) Read the `leaderboard` event field.** Requires capturing the `TurnResolved` payload's `leaderboard` array (currently the listener only takes `payload.snapshot`, CivilizationView.tsx:235) — more wiring, and stale on load/intervention. Not recommended.

**Store already yields `civs[]` incl. legacy [VERIFIED]:** `normalizeCivSnapshot` (civStore.ts:81-109) builds `civs` from `input.civs` (v2) OR `[input.civilization]` (legacy v1) OR a synthesized default (civStore.ts:86-93); each civ normalized by `normalizeCiv` (civStore.ts:115-135) which fills `id, name, model, color, alive, population, era, score{…}`. So the panel reads `snapshot.civs` directly.

**Dead/collapsed representation (D-08) [VERIFIED]:** each civ carries `alive: bool` (`CivCivilization.alive`, civilization.rs:441-442; default true; set false on collapse at civilization.rs:764). There is **no separate "collapsed" marker** — `alive === false` IS the collapsed state. The panel sorts living civs by score, then appends `!alive` civs greyed at the bottom with a "collapsed" label derived from `alive === false`. (The collapse also pushes a log entry kind `"collapse"`, civilization.rs:766-771, if the panel wants a turn reference.)

**Top-bar placement (D-06):** new component rendered above the canvas in `CivilizationView` (the canvas branch around CivilizationView.tsx:797-803, sibling to the HUD elements at 855+). Reads `useCivStore(s => s.activeSnapshot)`.

## 4. `selectedCivId` Connective Tissue (D-09)

**Recommendation: store `selectedCivId` in `civStore`** (not component state). Rationale [VERIFIED against patterns]:
- The store is the single owner of `activeSnapshot`/`activeSessionId` and is consumed by both `CivilizationView` and (Phase 2) the renderer; `focusCiv` will want to read selection from the same place. Component-local state would force prop-drilling between the top-bar (selection source), the observer panel (consumer), the log filter (consumer), and Phase 2's canvas.
- Pattern fit: `CivState` (civStore.ts:14-33) already holds UI-ish state like `lastEventType`, `turnRunning`. Add `selectedCivId: string | null` + `setSelectedCivId(id)` alongside. Reset to `null` (or the top-ranked living civ) on `loadSession`/`createSession`.

**Observer panel rewire (today always civ[0]) [VERIFIED]:** `CivilizationView.tsx:256` sets `const activeCiv = snapshot ? primaryCiv(snapshot) : null;` and `primaryCiv` (civStore.ts:111-113) always returns `civs[0]`. `ScorePanel` (CivilizationView.tsx:1034), `ResourcesPanel` (1043) consume `activeCiv`. **Change:** derive `activeCiv` from `selectedCivId` — `snapshot.civs.find(c => c.id === selectedCivId) ?? primaryCiv(snapshot)`. `ColonyPanel`/`RegionsPanel` take the whole `snapshot` (CivilizationView.tsx:1037,1040); `ColonyPanel` (civilization view 1765) lists axolotls — for per-civ scoping it should filter entities by the selected civ's id (entities carry `civ_id`, see `civ_entities`, civilization.rs:1436-1445; the TS `CivEntity` has `civ_id`).

**Per-civ log filter (D-10) [VERIFIED]:** `recentLog` (CivilizationView.tsx:255) is `[...snapshot.log].reverse().slice(0,12)`, rendered by `LogPanel` (CivilizationView.tsx:1904). Today log entries link to a civ **only via the civ name embedded in the title string** (`"{civ_name} intent: …"`, civilization.rs:2058) — there is **no `civ_id` on `CivLogEntry`** (civilization.rs:511-518). To filter the combined stream by `selectedCivId` robustly, prefer §1 Option B (add `CivLogEntry.civ_id`). Without it, the filter must string-match civ names (brittle if two civs share a name; D-04 defaults can collide). The leaderboard row-click sets `selectedCivId`; the log panel filters when a civ is selected and shows all when `null`.

## 5. `render_game_to_text` Additive Extension (D-13/14, ARENA-01)

**Current output [VERIFIED at CivilizationGameCanvas.tsx:3135-3190]:** `renderSnapshotToText(snapshot, playerState?)` returns `JSON.stringify({ coordinate_system, session{id,turn,model}, civilization{…from primaryCiv…}, player{…}, player_task, visible_entities[] })`. It's wired to `window.render_game_to_text` at CivilizationGameCanvas.tsx:255 & 301 (with a Phaser-scene `renderToText()` fallback that itself calls `renderSnapshotToText`, line 594).

**Consumer contract that MUST keep working [VERIFIED]:**
- `codex-play-civ.mjs` reads (via `JSON.parse(window.render_game_to_text())`, L149-151): `state.player.player` (L155), `state.player_task` (L159), `state.visible_entities` (L191-194, L208), and `state.civilization.resources` (L177).
- `civPilot.ts` `CivPilotTextState` type (civPilot.ts:60-97) models `session`, `player`, `player_task`, `visible_entities` — the player-possession decision model.

**Extension plan (purely additive — append keys, mutate nothing):** add to the returned object:
```js
civs: snapshot.civs.map(c => ({
  id: c.id, name: c.name, model: c.model, color: c.color,
  alive: c.alive, population: c.population, era: c.era, score: c.score,
  controller: c.controller ?? null,        // §6
  resources: c.resources,
})),
leaderboard: [...snapshot.civs].sort((a,b)=>b.score.total-a.score.total)
  .map(c => ({ id:c.id, name:c.name, model:c.model, color:c.color,
               alive:c.alive, score:c.score, controller:c.controller ?? null })),
environment: snapshot.environment,          // season/temp/water/disasters/forecast already on snapshot
```
Keep `session`, `civilization` (still `primaryCiv` for legacy harness — L177 reads `civilization.resources`), `player`, `player_task`, `visible_entities` byte-identical. Output stays a single `JSON.stringify` (D-14). The `civs[]` field set satisfies the discretion list (id, name, model, color, alive, population, era, score, controller). `snapshot.environment` is already populated and normalized (civStore.ts:148-158).

**Test the contract:** add a vitest spec asserting the extended output still has `civilization.resources`, `player`, `visible_entities`, AND new `civs[]`/`leaderboard`/`environment` (mirrors existing `civPilot.test.ts`).

## 6. Harness Drives One Civ + Controller Tag (D-15/16, ARENA-02/03)

**Current `civPilotControls` [VERIFIED at CivilizationView.tsx:67-70 (type) & 409-444 (impl)]:**
```ts
civPilotControls?: { start(options?: { goal?, possessId?, requesterId?, continueAfterTask? }): void; stop(): void }
```
`start` drives the **legacy single-player possession layer** — it possesses one axolotl entity (`possessId` / `selectedPlayerId`) and runs `chooseCivPilotDecision` against the player text-state (CivilizationView.tsx:446-489+). It does NOT today "drive a civ's model turn"; it pilots a possessed axolotl. `codex-play-civ.mjs` calls `controls.start({goal, possessId, requesterId, continueAfterTask})` (L869-878).

**D-15 ("drive one civ by id"):** add an optional `civId?: string` to `start`'s options (type at CivilizationView.tsx:68 and impl at 410). For Phase 1's "harness vs models" framing, the cleanest in-scope wiring is: `start({civId})` sets `selectedCivId` (§4) so the harness's civ is the selected/observed one and its score is attributable, while the **other civs keep being model-driven by `advance_civ_turn`** (which already loops every living civ via its own model, civilization.rs:699). The harness drives turns through the existing control surface; `civId` scopes attribution/selection rather than swapping the per-civ model loop. **Confirm with the planner** how literally "drive" should bind — full "harness replaces civ-X's decision" is a larger change and may be partially deferred; the minimum ARENA-02/03 bar is: harness can act + the run can attribute civ-X's score to the controller. Either way, **add `civId` as additive** so existing `start({goal,possessId,…})` calls keep working (ARENA-02 "without breaking existing controls").

**D-16 / ARENA-03 controller tag [VERIFIED: no such field exists]:** `grep` for `controller|controlled_by|driven_by|harness_tag` in civilization.rs returns nothing. Add `controller: Option<String>` (`#[serde(default)]`) to `CivCivilization` (civilization.rs:420-454). Surface it in:
- `leaderboard()` JSON (civilization.rs:1503-1512) — add `"controller": civ.controller`.
- the leaderboard top-bar row (small badge).
- `render_game_to_text` `civs[]`/`leaderboard` (§5).
- TS `CivCivilization` (bindings regen) + `normalizeCiv` (civStore.ts:115-135) default `null`.

**Where the tag is set (discretion D-16 allows create / start / both):** simplest is **at `civPilotControls.start({civId, controller})`** — set `civs[i].controller` on the selected civ via an intervention or a tiny new command. A cleaner, persistence-friendly option is a small `#[tauri::command] set_civ_controller(id, civ_id, controller)` that loads, sets, saves, and re-emits (mirrors `apply_civ_intervention`, civilization.rs:655-677). Setting it at creation (a per-participant `controller` field) is also valid if a participant is pre-designated as harness-driven. Recommend **start-time set via a small command** so a run can tag mid-session, with optional creation-time default. Whichever, it must persist on the civ so it rides the snapshot and survives reload (the leaderboard derives from the snapshot per §3a).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Civ ranking | New sort/score logic | `leaderboard()` (civilization.rs:1492) — already in `TurnResolved` | Ranking + per-civ scoring already exist and are tested |
| Per-civ scoring | New scorer | `rescore_all_civs`/`score_civilization` (civilization.rs:1518, 3782) | Called every turn; per-civ already |
| v1→v2 snapshot back-compat | Custom migration | `migrate_value_in_place` + `backfill_snapshot` (civilization.rs:4379, 4415) | Legacy single-civ saves already migrate; test exists (5428) |
| Multi-civ world gen / spawns | New world builder | `generate_world(seed, N)` + `found_colony` (civilization.rs:979, 1219) | Already spreads N colonies across livable regions, civ-tagged |
| `civs[]` normalization (incl. legacy) | New parser | `normalizeCivSnapshot`/`normalizeCiv` (civStore.ts:81, 115) | Handles v2, legacy `civilization`, and defaults |
| Reasoning capture from streams | Parse `reasoning_content` | Already done: `commands.rs:4129` → `ReasoningDelta` → `ModelTextResult.reasoning` (civilization.rs:823) → `ModelDecision` event (753) | Only surfacing is missing, not capture |
| bindings.ts regen on Windows | Hand-edit bindings / run `tauri dev` | `cargo run --bin export_bindings` (src/bin/export_bindings.rs) | Headless, no WebView2; the project's drift mitigation |
| Model list for picker | New command | `listModels()` cmd + `loadModels()` store action (civStore.ts:219-226) | Already surfaces config models |

**Key insight:** the backend is a multi-civ engine wearing a single-civ entry point and UI. Almost every "new" capability is a surfacing/wiring task over existing tested logic — resist re-implementing.

## Runtime State Inventory

This is not a rename/migration phase, but it touches a **persisted snapshot schema** and serialized config, so the state surface matters:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Civ session snapshots in `~/.xolotl-code` civilizations dir (`home_civilizations_dir`, civilization.rs:606,651) as `{id}.json`. Legacy v1 (single `civilization`) + v2 (`civs[]`). | NONE for reads — `parse_snapshot`/`migrate_value_in_place` already migrate v1→v2 (civilization.rs:4368,4379) and `backfill_snapshot` fills civ identity. New optional civ fields (`controller`) must be `#[serde(default)]` so existing saves load. New `CivLogEntry` fields (Option B) likewise `#[serde(default)]`. |
| Live service config | None — no external service holds civ state. | None. |
| OS-registered state | None. | None — verified, no scheduled tasks/daemons touch civ. |
| Secrets/env vars | `~/.xolotl-code/config.json` is the free-form map (gotcha #2) read by `listModels()`. Phase only **reads** model ids; does not write config. | None — do NOT model config as a struct. |
| Build artifacts | `bindings.ts` is generated; stale after the `CivSessionConfig`/`CivParticipant`/`controller`/`CivLogEntry` changes. | Run `cargo run --bin export_bindings` then `npx tsc --noEmit` after every IPC-surface/registered-type change. |

**Back-compat hard gate (must verify, per CONTEXT specifics):** (1) a 1-participant world creates and runs identically to today; (2) a saved v1 snapshot still loads and ranks; (3) `codex-play-civ.mjs` still parses `state.civilization.resources` and drives via `civPilotControls.start({goal,possessId})` unchanged.

## Common Pitfalls

### Pitfall 1: Changing `push_log`'s signature for reasoning
**What goes wrong:** adding a `reasoning`/`civ_id` param to `push_log` forces edits at ~40 call sites and risks reds across unrelated log lines.
**Avoid:** add a dedicated `push_decision_log(...)` helper used only by `apply_model_decision`; leave `push_log` untouched.

### Pitfall 2: Forgetting the bindings regen (gotcha #1) — or running `tauri dev` for it on Windows
**What goes wrong:** TS still sees the old `CivSessionConfig`; `createSession` sends the wrong shape; or `tauri dev`'s WebView2 dependency blocks the regen on Windows (gotcha #5).
**Avoid:** after any registered-type/command change, `cd tauri-app/src-tauri && cargo run --bin export_bindings`, then `npx tsc --noEmit`. Don't hand-edit bindings.ts.

### Pitfall 3: Breaking the legacy harness with a non-additive text-state change
**What goes wrong:** renaming/removing `civilization`, `player`, or `visible_entities` breaks `codex-play-civ.mjs` (reads `state.civilization.resources` at L177) — fails ARENA-02.
**Avoid:** only **append** `civs[]`/`leaderboard`/`environment`; keep `civilization = primaryCiv(...)`. Add a vitest assertion locking the legacy keys.

### Pitfall 4: Driving the observer/log off civ[0] after adding multi-civ
**What goes wrong:** `activeCiv = primaryCiv(snapshot)` (always civ[0]) makes the observer panel ignore `selectedCivId`.
**Avoid:** derive `activeCiv` from `selectedCivId` with a `primaryCiv` fallback.

### Pitfall 5: Filtering the log by civ **name** instead of id
**What goes wrong:** D-04 name defaults ("Civ 1") or D-02 same-model civs can collide; title-string matching mis-filters.
**Avoid:** add `CivLogEntry.civ_id` (Option B) and filter on it.

### Pitfall 6: Treating reasoning as persisted when it's only a live event
**What goes wrong:** building the D-12 toggle to read `entry.reasoning` from the snapshot while choosing Option A (live event) → empty on reload.
**Avoid:** pick Option A *or* B explicitly and build the UI to match.

## Code Examples (verified anchors, not new code)

```
// Reasoning capture (already exists), civilization.rs:793-833
struct ModelTextResult { content: String, reasoning: String }
// ... AgentEvent::ReasoningDelta(text) => reasoning.push_str(&text)

// Per-civ turn loop (already multi-civ), civilization.rs:699-757
for civ_id in &turn_order { let model = snapshot.civs[ci].model.clone(); ... emit "ModelDecision" {civ_id, decision, reasoning} }

// Leaderboard payload (already emitted), civilization.rs:786 + 1492-1515

// v1→v2 migration + test, civilization.rs:4379 + 5428 (legacy_v1_snapshot_migrates_to_multi_civ)

// Headless bindings regen, tauri-app/src-tauri/src/bin/export_bindings.rs
//   cargo run --bin export_bindings   (from tauri-app/src-tauri)
```

## State of the Art

| Old (spec doc `civ-multi-civ-world-plan.md`, 2026-06-05) | Actual code (verified 2026-06-06) | Impact |
|--------------|------------------|--------|
| W9 "make backend multi-civ" implied as todo | Backend already multi-civ: per-civ turn loop, scoring, leaderboard, snapshot, world gen | Phase 1 is surfacing, not engine work |
| "the only civ until multi-spawn lands in W2/W9" (comment civilization.rs:69) | `generate_world(seed,N)`/`found_colony` already spawn N civs; only `initial_snapshot` hardcodes 1 | Multi-spawn machinery exists; entry point is the gap |
| Reasoning may need backend work (D-12 note) | Reasoning captured end-to-end to the `ModelDecision` event | D-12 is frontend/log plumbing only |

**Trust the code over the spec doc** wherever they disagree (the doc's status block understates backend progress — confirmed).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | "Drive one civ" (D-15) for Phase 1 can mean *scope selection + attribution* rather than fully replacing civ-X's per-turn model decision | §6 | If the user expects the harness to literally supply civ-X's decisions each turn, that's a larger change to `advance_civ_turn`; planner should confirm the intended depth |
| A2 | Leaderboard top-bar should derive from `snapshot.civs` (option 3a) rather than the `leaderboard` event field | §3 | If a reason exists to prefer the event payload (e.g., a server-only field not on the snapshot), 3a misses it — but `leaderboard()` fields are all civ fields, so low risk |

(Only 2 assumptions; everything else is `[VERIFIED: code trace]`.)

## Open Questions

1. **Depth of "harness drives one civ" (D-15).** See A1. Recommendation: implement additive `civId` scoping + controller attribution now; defer "harness fully replaces civ-X's model decision loop" if it expands scope. Confirm with planner/user.
2. **D-12 Option A vs B.** Recommend Option B (persist `CivLogEntry.civ_id` + `reasoning`) because it also hardens the D-10 per-civ filter; Option A is the lighter fallback. Planner to choose.
3. **Controller-tag set point (D-16 discretion).** Recommend a small `set_civ_controller` command invoked from `civPilotControls.start`, with optional creation-time default.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust toolchain (tauri-app crate) | `cargo check`/`clippy`/`run --bin export_bindings` | Assumed ✓ (repo builds) | Tauri backend crate (separate from `rust/` workspace) | — |
| Node/npm + vitest | `npx tsc --noEmit`, `npm test` | Assumed ✓ | per tauri-app/package.json | — |
| WebView2 (Windows) | `tauri dev`, `cargo test` for tauri backend | ✗ on Windows for tests (gotcha #5) | — | Use `export_bindings` bin for regen; run backend cargo tests on CI Linux/macOS |
| Provider API keys (Kimi/DeepSeek/etc.) | Live multi-model turns (CIV-03 end-to-end) | Unknown (user config) | — | Logic verifiable with deterministic tests + stubbed `call_model_text`; real turns need keys |

**Missing with no fallback:** none blocking *implementation/verification*. Live multi-model gameplay needs provider keys but the wiring/back-compat is fully testable without them.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Rust (backend) | built-in `#[cfg(test)] mod tests` (civilization.rs:4759), 64 tests; includes `legacy_v1_snapshot_migrates_to_multi_civ` (5428), `civ_turn_order_*` (5762,5778) |
| Frontend | vitest (`npm test`), e.g. `tauri-app/src/lib/civPilot.test.ts`, store/component tests |
| Type check | `npx tsc --noEmit` (gates bindings drift) |
| Backend quick gate (Windows) | `cargo check` + `cargo clippy --all-features -- -D warnings` + `cargo test --no-run` (compiles tests; gotcha #5 blocks *running* them on Windows) |
| Backend full run | `cargo test` on CI Linux/macOS |
| Bindings regen | `cargo run --bin export_bindings` (from tauri-app/src-tauri) |

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Command | File exists? |
|-----|----------|-----------|---------|--------------|
| CIV-01 | Multi-participant create builds N civs, N distinct colors, 1–3 validated | unit (Rust) | `cargo test -p (tauri backend) create_civ_session_multi` | ❌ Wave 0 (new test) |
| CIV-01 back-compat | Legacy `{name,model,seed}` config still creates 1-civ world | unit (Rust) | extend a config-deserialize test | ❌ Wave 0 |
| CIV-01 back-compat | Legacy v1 snapshot loads + migrates | unit (Rust) | `legacy_v1_snapshot_migrates_to_multi_civ` (exists 5428) — extend if schema changes | ✅ exists |
| CIV-02 | `leaderboard()` sorts living-first, includes color/name/score | unit (Rust) | new test on `leaderboard()` | ❌ Wave 0 |
| CIV-02 | Top-bar renders ranked civs incl. greyed collapsed | unit (vitest/RTL) | `npm test` leaderboard component spec | ❌ Wave 0 |
| CIV-03 | Per-civ decision logged with rationale (+reasoning if Option B) | unit (Rust) | test `apply_model_decision`/`push_decision_log` log entry | ❌ Wave 0 |
| CIV-03 | `selectedCivId` filters observer + log | unit (vitest) | store/component spec | ❌ Wave 0 |
| ARENA-01 | `render_game_to_text` includes `civs[]`+`leaderboard`+`environment` AND legacy `civilization.resources`/`player`/`visible_entities` | unit (vitest) | spec on `renderSnapshotToText` | ❌ Wave 0 (extend civPilot.test.ts) |
| ARENA-02 | `civPilotControls.start({goal,possessId})` legacy call still works; new `civId` optional | unit (vitest) | component spec | ❌ Wave 0 |
| ARENA-03 | `controller` rides civ → leaderboard JSON + text-state | unit (Rust + vitest) | leaderboard test + text-state test | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx tsc --noEmit` + targeted vitest; `cargo check` + `cargo clippy -- -D warnings` + `cargo test --no-run` for backend tasks.
- **Per wave merge:** full `npm test`; backend `cargo test` deferred to CI (Windows can't run it — gotcha #5).
- **Phase gate:** CI green (Linux/macOS backend tests) + local `tsc`/vitest green + manual smoke: create 2–3 civ world, watch leaderboard rank/collapse, select a civ, run `codex-play-civ.mjs` against the running app to prove ARENA-02.

### Wave 0 Gaps
- [ ] Rust: multi-participant `create_civ_session` test + extended back-compat (config deserialize both shapes; v1 snapshot with new optional fields).
- [ ] Rust: `leaderboard()` ordering/fields test (+ `controller` once added).
- [ ] Rust: decision-log test (Option B: `civ_id`+`reasoning` persisted).
- [ ] vitest: extend `civPilot.test.ts` / new spec asserting additive text-state (legacy keys preserved + new keys present).
- [ ] vitest: leaderboard component spec (rank/colors/collapsed-greyed/row-click→selectedCivId).
- [ ] vitest: store spec for `selectedCivId` + multi-participant `createSession`.

## Security Domain

`security_enforcement` not found in repo config inspected; this phase is local desktop UI/IPC with no new network surface, no auth/session, no untrusted input beyond model output already parsed by `parse_model_decision` (validated/repaired, civilization.rs:715-743). V5 Input Validation is the only relevant ASVS category and is already handled by the existing decision-parse/repair path. No new crypto, no new external endpoints. Threat note: model output is treated as untrusted and JSON-validated before apply — preserve that path for any new decision fields.

## Project Constraints (from CLAUDE.md)

- **Two Rust trees:** all backend work here is in `tauri-app/src-tauri/` (NOT the `rust/` workspace). Use that crate's commands.
- **Gotcha #1 (bindings.ts auto-gen):** edit Rust command/registered type first, then regenerate (`cargo run --bin export_bindings`). Never hand-edit bindings.ts.
- **Gotcha #2 (free-form config map):** config.json is a `serde_json::Map`; only read model ids via `listModels()`; never model it as a strict struct.
- **Gotcha #3 (specta bigint):** any new u64/i64 timestamp fields rely on `dangerously_cast_bigints_to_number()` — keep that escape hatch (no new bigints needed this phase).
- **Gotcha #5 (Windows backend tests):** `cargo test` for the tauri backend can't run on Windows; use `cargo check`/`clippy`/`test --no-run` locally, full tests on CI.
- **Gotcha #6 (reasoning streams):** `reasoning_content` arrives before `content`; already handled via `ReasoningDelta` (relevant to D-12).
- **Clippy pedantic + `-D warnings`, `unsafe_code = forbid`:** new Rust must be clean.
- After modifying code, `graphify update .` keeps the graph current (optional, no API cost).

## Sources

### Primary (HIGH — direct code inspection, this session)
- `tauri-app/src-tauri/src/civilization.rs` — CivSessionConfig (251), CivCivilization (420), CivScore (457), CivLogEntry (511), CivModelDecision (544), create_civ_session (579), advance_civ_turn (681), call_model_text/ModelTextResult (793-833), initial_snapshot (836), generate_world (979), found_colony (1219), civ_id_for (1447), civ_turn_order (1470), leaderboard (1492), rescore_all_civs (1518), apply_model_decision (2048), score_civilization (3782), push_log (4322), parse_snapshot/migrate_value_in_place/backfill (4368-4415), tests (4759, 5428).
- `tauri-app/src-tauri/src/commands.rs:4129, 3869` — reasoning_content → ReasoningDelta.
- `tauri-app/src-tauri/src/lib.rs:6-9, 109, 154-168, 171` — command/type registration, export_bindings.
- `tauri-app/src-tauri/src/bin/export_bindings.rs` — headless bindings regen.
- `tauri-app/src/bindings.ts:174, 437` — createCivSession / CivSessionConfig.
- `tauri-app/src/stores/civStore.ts` — CivState (14), createSession (238), normalizeCivSnapshot (81), normalizeCiv (115), primaryCiv (111), loadModels (219).
- `tauri-app/src/components/civilization/CivilizationView.tsx` — civPilotControls type (67) + impl (409), event listener (233), CivEventPayload (148), recentLog (255), activeCiv/primaryCiv (256), handleCreate (533), creation card (805), observer drawer (997), ColonyPanel/RosterRow (1765/1828), LogPanel (1904).
- `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx` — render_game_to_text hook (255/301), renderSnapshotToText (3135).
- `tauri-app/scripts/codex-play-civ.mjs` — readState (148), progressSignature/civilization.resources (177), civPilotControls.start (869).
- `tauri-app/src/lib/civPilot.ts:60-97` — CivPilotTextState.

### Secondary
- CONTEXT.md (D-01..D-16), REQUIREMENTS.md (CIV/ARENA), CLAUDE.md gotchas, project MEMORY.md (export_bindings drift mitigation).

## Metadata

**Confidence breakdown:**
- Standard stack / engine reuse: HIGH — all reuse points read directly.
- Architecture/wiring plan: HIGH — every integration point cited.
- D-12 reasoning verdict: HIGH — full pipeline traced commands.rs → civilization.rs → event; gap (dropped event + log lacks reasoning) confirmed.
- "Drive one civ" depth (A1): MEDIUM — implementation depth depends on user intent.

**Research date:** 2026-06-06
**Valid until:** ~2026-07-06 (stable; codebase-internal, low churn risk)

## RESEARCH COMPLETE
