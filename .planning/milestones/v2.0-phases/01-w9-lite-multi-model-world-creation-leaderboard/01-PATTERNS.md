# Phase 1: W9-lite — Multi-Model World Creation + Leaderboard - Pattern Map

**Mapped:** 2026-06-06
**Files analyzed:** 9 (3 backend Rust, 1 generated bindings, 4 frontend TS/React, 2 arena bridge)
**Analogs found:** 9 / 9 (all in-repo; this phase surfaces an already-multi-civ engine)

> All file:line anchors below were **re-verified against current code this session** (not just copied from RESEARCH.md). Where RESEARCH cited a line, it matched. The engine is multi-civ; every "new" capability is a surfacing/wiring task over existing tested logic — copy the sibling pattern, do not re-invent.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `tauri-app/src-tauri/src/civilization.rs` — `CivParticipant` struct | model (DTO) | transform (config→world) | `CivSessionConfig` (civilization.rs:251-257) | exact (sibling struct, same file) |
| `tauri-app/src-tauri/src/civilization.rs` — multi-participant `CivSessionConfig` + back-compat | model (DTO) | transform | `CivSessionConfig` + `CivEnvironment`/`CivLogEntry` `#[serde(default)]` pattern | exact |
| `tauri-app/src-tauri/src/civilization.rs` — `create_civ_session` N-civ generalization | command | transform (CRUD-create) | `create_civ_session` (579-601) + `generate_world(seed,N)`/`found_colony` | exact (generalize existing) |
| `tauri-app/src-tauri/src/civilization.rs` — `controller: Option<String>` on `CivCivilization` | model (field) | request-response (rides snapshot) | `CivCivilization.diplomacy`/`home_region` `#[serde(default)]` fields (420-454) | exact |
| `tauri-app/src-tauri/src/civilization.rs` — `controller` in `leaderboard()` JSON | utility | transform | `leaderboard()` (1491-1515) | exact (add one key) |
| `tauri-app/src-tauri/src/civilization.rs` — `set_civ_controller` command + (opt B) `push_decision_log` | command | CRUD-update / event-emit | `apply_civ_intervention` (655-677) | exact (load→mutate→save→emit→return) |
| `tauri-app/src-tauri/src/lib.rs` — `.typ::<CivParticipant>()` + import | config (registration) | — | existing `.typ::<CivSessionConfig>()` (154) + `collect_commands!` (109) | exact |
| `tauri-app/src/bindings.ts` | config (generated) | — | regenerated, not hand-edited | n/a (run `export_bindings`) |
| `tauri-app/src/stores/civStore.ts` — multi-participant `createSession` + `selectedCivId` | store | request-response / state | `createSession` (238-247) + `CivState` slice (14-33) + `normalizeCiv` (115-135) | exact |
| `tauri-app/src/components/civilization/CivilizationView.tsx` — picker / leaderboard top-bar / log filter / reasoning toggle / ModelDecision listener | component | event-driven + request-response | creation card (805-838), event listener (229-245), `civPilotControls` (408-444), `recentLog`/`activeCiv` (255-256) | exact |
| `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx` — `render_game_to_text` additive | utility | transform (serialize) | `renderSnapshotToText` (~3135) + `window.render_game_to_text` hook (255/301) | exact |
| `tauri-app/src/lib/civPilot.ts` — `CivPilotTextState` additions | model (type) | transform | `CivPilotTextState` (60-97) | exact (extend type) |
| `tauri-app/scripts/codex-play-civ.mjs` — consume additive state | utility (harness) | transform/read | `readState`/`progressSignature` (148-179) | exact (read new keys, keep old) |

---

## Pattern Assignments

### `civilization.rs` — `CivParticipant` + multi-participant `CivSessionConfig` (model/DTO, transform)

**Analog:** `CivSessionConfig` at civilization.rs:251-257 (same file, immediately replace).

**Current shape (verified 251-257):**
```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivSessionConfig {
    pub name: String,
    pub model: String,
    #[serde(default)]
    pub seed: Option<u32>,
}
```

**Derive macro + `#[serde(default)]` field pattern to copy** (from `CivCivilization` 419-454 and `CivEnvironment` 477-486 — both registered `Type`s with optional fields that legacy saves omit):
```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]   // same derive set as every registered civ struct
pub struct CivParticipant {
    pub name: String,
    pub model: String,
    #[serde(default)]
    pub color: Option<String>,   // None => auto CIV_COLORS[index] (palette at civilization.rs:66-68)
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivSessionConfig {
    pub name: String,
    #[serde(default)]
    pub seed: Option<u32>,
    #[serde(default)]
    pub civs: Vec<CivParticipant>,   // new shape
    #[serde(default)]
    pub model: Option<String>,       // legacy single-model; mapped to one participant if `civs` empty
}
```
**Back-compat rule (D-05):** `#[serde(default)]` on BOTH `civs` and `model` is what lets the legacy front-end JSON `{name, model, seed}` AND the new `{name, seed, civs:[…]}` both deserialize. This is the exact same `#[serde(default)]`-for-back-compat idiom already used on `CivCivilization.id`/`diplomacy`/`home_region` (422-445) and `CivSessionSnapshot.version` (277).

---

### `civilization.rs` — `create_civ_session` N-civ generalization (command, CRUD-create)

**Analog:** `create_civ_session` itself (579-601) + the already-multi-civ `generate_world`/`found_colony` machinery.

**Current command (verified 579-601):**
```rust
#[tauri::command]
#[specta::specta]
pub fn create_civ_session(config: CivSessionConfig) -> Result<String, String> {
    if config.model.trim().is_empty() {
        return Err("model is required".to_string());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let seed = config.seed.unwrap_or_else(|| seed_from(&id));
    let now = unix_timestamp_secs();
    let mut snapshot = initial_snapshot(id.clone(), clean_name(&config.name),
        config.model.trim().to_string(), seed, now);
    push_log(&mut snapshot, "session", "Colony founded", "…");
    save_snapshot(&snapshot)?;
    Ok(id)
}
```

**Generalization pattern (RESEARCH §2):** resolve `config.civs` first (back-compat: if empty and `config.model` is `Some(non-empty)`, synthesize `vec![CivParticipant{name: config.name, model, color: None}]`; else `Err("at least one civilization is required")`); validate 1–3 (D-03) and each model non-empty. Then generalize `initial_snapshot` to build N civs from `generate_world(seed, N)`:
- `generate_world(seed, civ_count)` (civilization.rs:979) already loops `for i in 0..civ_count { found_colony(…, i, …) }` (1084-1102).
- `found_colony` (1219) tags entities `civ_id = "civ-{i+1}"` (1447-1449), claims home region, seeds population — its doc says "Shared by initial world gen and (W9) add_civ_to_session."
- Colors: `CIV_COLORS` (66-68), assigned round-robin by index; `CIV_COLORS[0]` used today at line 886. Participant's `color.unwrap_or(CIV_COLORS[i % len])`.

**Validation idiom to copy** (`Err(String)` early-return, as at 580-582 and `apply_intervention_to_snapshot`): keep returning `Result<String,String>`; the command signature is unchanged (still takes `CivSessionConfig`), so `collect_commands!` (lib.rs:109) picks it up automatically — only the registered `.typ` set grows.

---

### `civilization.rs` — `controller: Option<String>` on `CivCivilization` (model field, rides snapshot)

**Analog:** the `#[serde(default)]` optional fields already on `CivCivilization` (verified 420-454):
```rust
    /// `false` once the colony collapses (population hits 0).
    #[serde(default = "default_true")]
    pub alive: bool,
    #[serde(default)]
    pub diplomacy: HashMap<String, String>,
```
**Add (same idiom, after `score`):**
```rust
    /// Harness/model id driving this civ (ARENA-03 score attribution). None => model plays itself.
    #[serde(default)]
    pub controller: Option<String>,
```
`#[serde(default)]` is mandatory so existing saved snapshots (no `controller` key) still load — same guarantee `migrate_value_in_place`/`backfill_snapshot` (4379/4415) rely on. Also default `controller: null` in TS `normalizeCiv` (civStore.ts:115-135, see below).

---

### `civilization.rs` — `controller` in `leaderboard()` JSON (utility, transform)

**Analog:** `leaderboard()` (verified 1491-1515). Add one key inside the existing `serde_json::json!` map:
```rust
serde_json::json!({
    "id": civ.id, "name": civ.name, "model": civ.model, "color": civ.color,
    "alive": civ.alive, "population": civ.population, "era": civ.era,
    "score": civ.score,
    "controller": civ.controller,   // ARENA-03
})
```
Ranking logic is untouched — `sort_by` on `score.total` desc (1494-1499) already does D-07/D-08 ordering.

---

### `civilization.rs` — `set_civ_controller` command + (Option B) `push_decision_log` (command, CRUD-update)

**Analog:** `apply_civ_intervention` (verified 655-677) — the canonical load→mutate→save→emit→return-String shape:
```rust
#[tauri::command]
#[specta::specta]
pub fn apply_civ_intervention(app_handle: AppHandle, id: String, intervention: CivIntervention) -> Result<String, String> {
    let mut snapshot = load_snapshot(&id)?;
    apply_intervention_to_snapshot(&mut snapshot, &intervention)?;
    snapshot.updated_at = unix_timestamp_secs();
    rescore_all_civs(&mut snapshot);
    save_snapshot(&snapshot)?;
    emit_civ_event(&app_handle, &snapshot.id, "InterventionApplied",
        serde_json::json!({ "intervention": intervention, "snapshot": &snapshot }));
    serde_json::to_string(&snapshot).map_err(|e| e.to_string())
}
```
**Copy this exactly** for `set_civ_controller(app_handle, id, civ_id, controller: Option<String>)`: `load_snapshot` → find `civs.iter_mut().find(|c| c.id == civ_id)` and set `.controller` → `updated_at` → `save_snapshot` → `emit_civ_event(..., "ControllerSet", json!({"snapshot": &snapshot}))` → `to_string`. Emitting `{"snapshot": …}` is what makes the front-end listener (CivilizationView.tsx:235) auto-hydrate it — see Shared Patterns.

**Option B decision-log helper (RESEARCH §1, recommended):** do NOT change `push_log` (~40 call sites — see Pitfall 1). Mirror `push_log` (4322) as a new `push_decision_log(snapshot, civ_id, intent, rationale, ethics, reasoning)` and add `#[serde(default)] civ_id: Option<String>` + `#[serde(default)] reasoning: Option<String>` to `CivLogEntry` (511-518, same `#[serde(default)]` idiom). Note `CivLogEntry` IS a registered `.typ` (lib.rs:165) so these fields **require a bindings regen** even though the snapshot crosses as a String.

---

### `lib.rs` — registration (config)

**Analog:** existing `.typ::<…>()` chain (verified 154-168) and `collect_commands!` (109).
```rust
// in collect_commands! list (add after apply_civ_intervention, 113):
            set_civ_controller,
// in the .typ chain (after .typ::<CivSessionConfig>(), 154):
        .typ::<CivParticipant>()
```
Add `CivParticipant`, `set_civ_controller` to the `use civilization::{…}` import block (lib.rs:8-9). `create_civ_session` is already listed (109) — its signature change needs no list edit. `export_bindings` fn at lib.rs:171 is unchanged.

**Bindings regen (the project's drift mitigation — VERIFIED bin):** `tauri-app/src-tauri/src/bin/export_bindings.rs` calls `xolotl_lib::export_bindings("../src/bindings.ts")` headlessly (no WebView2). Run from `tauri-app/src-tauri`:
```
cargo run --bin export_bindings
```
Then `npx tsc --noEmit`. Never hand-edit `bindings.ts` (gotcha #1), never use `tauri dev` for regen on Windows (gotcha #5).

---

### `civStore.ts` — multi-participant `createSession` + `selectedCivId` (store, state)

**Analog (state slice):** `CivState` interface (verified civStore.ts:14-33) already holds UI-ish state (`lastEventType`, `turnRunning`). Add alongside:
```ts
  selectedCivId: string | null;
  setSelectedCivId: (id: string | null) => void;
```
Initialize `selectedCivId: null` next to `turnRunning: false` (215), and `setSelectedCivId: (id) => set({ selectedCivId: id })`. Reset to `null` (or top-ranked living civ) inside `loadSession` (249) and `createSession` (238). RESEARCH §4 picks store-state over component-state because the top-bar (source), observer panel + log filter (consumers), and Phase 2 `focusCiv` all need it.

**Analog (createSession signature, verified 26 + 238-247):** the action passes `config` straight to `commands.createCivSession(config)`. Change the typed signature from `{ name; model; seed? }` to the multi-participant shape, e.g. `(config: { name: string; seed?: number | null; civs: { name: string; model: string; color?: string | null }[] })`, and pass through unchanged. After the bindings regen, `CivSessionConfig` in `bindings.ts` (~437) gains `civs: CivParticipant[]`; the `Option<String> model` purely guards old callers.

**Analog (`normalizeCiv`, verified 115-135):** add `controller: stringPropOrNull(input, "controller", null)` (or `input.controller ?? null`) so the new field defaults safely; it already defaults `color` to `"#6dd6a7"` and `id` to `civ-{n}`. The leaderboard top-bar derives from `snapshot.civs` (RESEARCH §3a) — `normalizeCivSnapshot` (81-109) already yields `civs[]` for v1 and v2, so no new parser.

---

### `CivilizationView.tsx` — picker / leaderboard top-bar / log filter / reasoning toggle / ModelDecision listener (component, event-driven)

**Analog (creation card, verified 805-838):** the single-model `<select>` bound to `selectedModel`. The multi-model picker repeats this `models.map(m => <option>)` per participant row (1–3 rows, D-03), each with a name `<Input>` (816 idiom), the model `<select>` (817-827), and a color chip overriding `CIV_COLORS[index]` (D-01). The "Found Colony" `<Button disabled={loading || …}>` (828-831) stays; `handleCreate` builds the `civs[]` array for `createSession`.

**Analog (event listener — THE D-12 gap, verified 229-245):**
```ts
listen<CivEventPayload>(`civ-event:${activeSessionId}`, (event) => {
  const payload = event.payload;
  if (payload.snapshot) hydrateSnapshot(payload.snapshot, payload.type);
  if (payload.error) setError(payload.error);
});
```
The `ModelDecision` event (emitted civilization.rs:745-755 with `{turn, civ_id, decision, reasoning}` and **no `snapshot`**) is dropped here. `CivEventPayload` (verified 148-149) doesn't model `civ_id`/`decision`/`reasoning`. **Option A pattern:** extend `CivEventPayload` with those fields and add a branch `if (payload.type === "ModelDecision") stashReasoning(payload.civ_id, payload.turn, payload.reasoning)` into a `useRef`/state keyed by `(turn, civ_id)` for the expand toggle. **Option B pattern (recommended):** persist via `push_decision_log` (above) so the toggle reads `entry.reasoning` off the snapshot log instead.

**Analog (observer `activeCiv` rewire — Pitfall 4, verified 255-256):**
```ts
const recentLog = useMemo(() => [...(snapshot?.log ?? [])].reverse().slice(0, 12), [snapshot?.log]);
const activeCiv = snapshot ? primaryCiv(snapshot) : null;   // primaryCiv => civs[0] (civStore.ts:111-113)
```
Change `activeCiv` to `snapshot ? (snapshot.civs.find(c => c.id === selectedCivId) ?? primaryCiv(snapshot)) : null`. The existing entity-by-civ filter at 266-273 (`entity.civ_id === activeCiv.id`) already shows the per-civ scoping idiom to reuse for `ColonyPanel`.

**Per-civ log filter (D-10, Pitfall 5):** with Option B's `CivLogEntry.civ_id`, filter `recentLog` by `selectedCivId` (show all when `null`). Without it, name-string matching on the `"{civ_name} intent:"` title (civilization.rs:2058) is brittle — prefer Option B.

**Leaderboard top-bar (D-06/07/08):** new sibling component above the canvas branch (around 797-803). Read `useCivStore(s => s.activeSnapshot)`, sort `civs` by `score.total` desc (mirrors `leaderboard()`), render living civs first then `!alive` civs greyed at the bottom (D-08; `alive===false` IS the collapsed state, civilization.rs:441/764). Row = color swatch · rank · name · `score.total` · controller badge. `onClick` → `setSelectedCivId(c.id)` (D-09 connective tissue). Style with the existing `civ-glass`/oklch HUD vocabulary (806-810).

---

### `CivilizationGameCanvas.tsx` — `render_game_to_text` additive (utility, serialize)

**Analog:** `renderSnapshotToText(snapshot, playerState?)` (~3135) wired to `window.render_game_to_text` (255 & 301), with a Phaser-scene `renderToText()` fallback (~594) that also calls it.

**Additive pattern (D-13/14, Pitfall 3):** keep `session`, `civilization` (still `primaryCiv` — the legacy harness reads `state.civilization.resources`, codex-play-civ.mjs:177), `player`, `player_task`, `visible_entities` **byte-identical**. APPEND inside the same single `JSON.stringify`:
```js
civs: snapshot.civs.map(c => ({ id:c.id, name:c.name, model:c.model, color:c.color,
  alive:c.alive, population:c.population, era:c.era, score:c.score,
  controller: c.controller ?? null, resources: c.resources })),
leaderboard: [...snapshot.civs].sort((a,b)=>b.score.total-a.score.total)
  .map(c => ({ id:c.id, name:c.name, model:c.model, color:c.color, alive:c.alive,
    score:c.score, controller: c.controller ?? null })),
environment: snapshot.environment,
```
`snapshot.environment` is already normalized (civStore.ts:148-158). The `civs[]` field set satisfies the discretion list (id, name, model, color, alive, population, era, score, controller).

---

### `civPilot.ts` — `CivPilotTextState` additions (model/type, transform)

**Analog:** `CivPilotTextState` (verified 60-97) — an all-optional (`?:`) structural type. Extend additively with the new keys mirroring the text-state, all optional so nothing breaks:
```ts
  civs?: Array<{ id: string; name: string; model: string; color: string;
    alive: boolean; population: number; era: string;
    score: { survival: number; ethics: number; intelligence: number; total: number };
    controller: string | null; resources: Record<string, number> }>;
  leaderboard?: Array<{ id: string; name: string; model: string; color: string;
    alive: boolean; score: { /* …CivScore */ total: number }; controller: string | null }>;
  environment?: unknown;
```
Keep existing `session`/`player`/`player_task`/`visible_entities` unchanged (these are what the possession model parses).

---

### `codex-play-civ.mjs` — consume additive state (harness, read)

**Analog:** `readState` (148-152) `JSON.parse(window.render_game_to_text())`, `progressSignature` reading `state.civilization.resources` (177). Because the text-state change is additive, **no change is strictly required** for ARENA-02 back-compat. To consume new data, read `state.civs` / `state.leaderboard` / `state.environment` (new keys) while leaving `playerOf`/`taskOf`/`state.civilization.resources` reads intact. If wiring D-15 `civId`, pass it through the existing `controls.start({goal, possessId, requesterId, continueAfterTask})` call (~869) as an added `civId` field.

---

## Shared Patterns

### Command shape (load → mutate → save → emit → return String)
**Source:** `apply_civ_intervention` (civilization.rs:655-677).
**Apply to:** `set_civ_controller` (and any other new civ-mutating command). Always return `Result<String,String>` via `serde_json::to_string(&snapshot)`; emit `serde_json::json!({"snapshot": &snapshot})` so the front-end listener auto-hydrates.

### Event auto-hydration contract
**Source:** listener at CivilizationView.tsx:233-235 — only acts on `payload.snapshot` and `payload.error`.
**Apply to:** any new emit. If you want the UI to update from an event, the payload MUST carry `snapshot`. The `ModelDecision` event intentionally has none (it's a side-channel) — that's exactly why D-12 needs explicit listener handling (Option A) or log persistence (Option B).

### `#[serde(default)]` for snapshot/config back-compat
**Source:** `CivCivilization.diplomacy`/`home_region`/`alive` (420-445), `CivSessionSnapshot.version` (277), `CivEnvironment.forecast` (484).
**Apply to:** every new field on a serialized struct (`CivParticipant.color`, `CivSessionConfig.civs`+`model`, `CivCivilization.controller`, `CivLogEntry.civ_id`+`reasoning`). Without it, existing saved JSON fails to deserialize — the hard back-compat gate.

### Registered-type → bindings regen
**Source:** lib.rs `.typ::<…>()` chain (116-168) + `export_bindings.rs` bin.
**Apply to:** any change to a `.typ`-registered struct (`CivSessionConfig`, `CivParticipant`, `CivCivilization`, `CivLogEntry`) or a command signature → run `cargo run --bin export_bindings` then `npx tsc --noEmit`. Snapshot-shape-only changes that ride the String still need regen IF the type is registered (it's read off the deserialized TS type).

### Civ normalization (v1 + v2 + defaults)
**Source:** `normalizeCivSnapshot` (civStore.ts:81-109) + `normalizeCiv` (115-135).
**Apply to:** leaderboard panel, log filter, text-state — read `snapshot.civs` directly; it already handles legacy single-civ saves and fills every field. Add new-field defaults here (`controller`).

### Single source of truth for selection
**Source:** `CivState` slice (civStore.ts:14-33).
**Apply to:** `selectedCivId` — store-level, consumed by top-bar (writer), observer panel + log filter (readers), Phase 2 `focusCiv` (future reader). Avoids prop-drilling.

---

## No Analog Found

None. Every file has a direct, same-domain analog (most in the same file). This phase is surfacing/wiring over an already-multi-civ engine, not greenfield construction.

---

## Metadata

**Analog search scope:** `tauri-app/src-tauri/src/{civilization.rs, lib.rs, bin/export_bindings.rs}`, `tauri-app/src/{stores/civStore.ts, lib/civPilot.ts}`, `tauri-app/src/components/civilization/{CivilizationView.tsx, CivilizationGameCanvas.tsx}`, `tauri-app/scripts/codex-play-civ.mjs`.
**Files scanned:** 9 (all read this session; key ranges re-verified against the RESEARCH anchors).
**Pattern extraction date:** 2026-06-06
**Cross-checks vs RESEARCH:** CivSessionConfig 251-257 ✓, CivCivilization 419-454 ✓, leaderboard 1491-1515 ✓, apply_civ_intervention 655-677 ✓, create_civ_session 579-601 ✓, lib.rs 109/154-168 ✓, createSession 238-247 / CivState 14-33 / normalizeCiv 115-135 ✓, event listener 229-245 / civPilotControls 408-444 / creation card 805-838 / activeCiv 255-256 ✓, export_bindings.rs ✓, civPilot.ts 60-97 ✓, codex-play-civ.mjs 148-179 ✓.

## PATTERN MAPPING COMPLETE
