# Phase 1: Human Takeover (Possession) - Context

**Gathered:** 2026-06-07
**Status:** Ready for planning

<domain>
## Phase Boundary

A user (or agent) can **possess a whole civilization** and play it directly as a fully player-controlled civ — issuing the same civ-level orders the AI uses (`CivDecisionAction` set) and releasing control at will — while the backend turn loop **never invokes the LLM for a possessed civ** (no tokens burned; the AI does not act against the player), and combat/predator/environment world-passes still run for it. Possession is agent-legible (`render_game_to_text()`) and agent-drivable (`civPilotControls`) at parity with the human surface.

**In scope:** civ-level `control_mode` field + `advance_civ_turn` LLM-bypass branch; an RTS orders panel for the human to issue the *existing* `CivDecisionAction` set; possess/release UI + bridge verbs; possession visibility; control-mode in the text bridge.

**Out of scope (later phases):** currency/sell (Phase 2), shop/buy (Phase 3), items/craft/NPC verbs (Phase 4), chunked world/terraform (Phase 5), Gemini art + game-native restyle / diegetic in-world markers (Phase 6). The Phase 1 order set is strictly the v2.0 actions: `gather, build, research, explore, policy, prepare, attack, raid, diplomacy/set_stance, trade, claim`.
</domain>

<decisions>
## Implementation Decisions

### Order-entry UX
- **D-01:** The human issues civ orders through a **game-native RTS orders panel** — queue one or more actions per type, then "End Turn". The panel maps 1:1 onto the existing `CivDecisionAction` set; it does **not** introduce sell/buy/craft (those are later phases).
- **D-02:** Every queued action routes through the **existing `validate_action` + `apply_model_decision` path** — the human plays by the **same rules/limits as the AI** (worker caps 1–8, resource costs, one decision per turn). No new game logic; the panel is a UI over the existing seam.
- **D-03:** The existing **god-mode intervention controls** (`apply_intervention_to_snapshot` — grant/remove/spawn resource, modifiers) remain available as a **separate observer/cheat toggle**, clearly distinct from the orders panel. Note: god-mode is NOT the `CivDecisionAction` path, so it does not by itself satisfy POSS-03 — the orders panel does.

### Possess entry + visibility
- **D-04:** Possess/Release is a **per-civ button on the existing leaderboard/civ row** (becomes "Release" while possessed). Possessing focuses the camera on that civ (reuse `focusCiv` / `selectedCivId`).
- **D-05:** Possession is shown via a **"YOU" badge** on the possessed civ's row (reusing its color tint) **plus a persistent HUD banner** (e.g. "Playing as <civ> · model bypassed"). **No diegetic in-world markers** in Phase 1 — deferred to Phase 6.

### Control scope
- **D-06:** Civ-possession is **strategic-only** (commander view: issue orders + advance turns). The existing **single-axolotl avatar control** (`possessedEntityId` / `civPilot.ts`) stays an **independent, coexisting layer** — not coupled to civ-possession in this phase ("god/RTS coexistence").

### Turn cadence
- **D-07:** **One global turn clock.** "End Turn" applies the human civ's queued orders (via `apply_model_decision`, **zero model calls**) and steps the AI civs + post-loop world passes the **same turn**. Ending with an empty queue = the human civ **idles** that turn.
- **D-08:** The human civ keeps its slot in the existing deterministic `civ_turn_order` (no special first/last) — determinism and shared-resource fairness preserved.

### Possession scope / data model
- **D-09:** The **local player pilots one human civ at a time**; possessing another releases/switches the first. Clean "you vs the AIs" arena framing.
- **D-10:** `control_mode` (`model` | `human`) is **per-civ and general** — any civ can be human-controlled. An **agent can possess/release any civ via `civPilotControls`** (POSS-04 parity); the existing `controller` field records *who* drives for leaderboard attribution. `control_mode` answers "is the LLM bypassed", `controller` answers "who is driving".

### Released / scoring defaults (low-ambiguity, captured not asked)
- **D-11:** **Release** sets `control_mode` back to `model`; the model resumes driving the civ from the current state on the next advance (fresh observation). Effective for the next turn.
- **D-12:** A human-possessed civ **stays on the leaderboard and is scored identically** (survival/ethics/intelligence) — it is a fair human-vs-AI contest. Currency/score interplay is a Phase 2 concern (currency does not feed score).

### Claude's Discretion
- Exact placement of the orders panel + Possess button inside `CivilizationView.tsx`; the shape/location of the **staged human-decision buffer** (where the pending human decision lives on the snapshot before `advance_civ_turn` reads it); precise badge/banner styling; the exact name of the bridge verb (`possess`/`release`). Default to the recommended options above. Backend `control_mode` is the source of truth (frontend-only possession is forbidden — Pitfall 4).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope, requirements & cross-cutting law
- `.planning/ROADMAP.md` → "Phase 1: Human Takeover (Possession)" (goal, success criteria, implementation notes) + the top-level **Cross-cutting criteria** block (PARITY / DETERMINISM / BACK-COMPAT / FALLBACK / UI SCOPE).
- `.planning/REQUIREMENTS.md` → POSS-01..POSS-04 + the **Cross-Cutting Requirements** section (per-phase exit criteria).
- `.planning/PROJECT.md` → "Current Milestone: v2.1" goal + "Guiding constraints".

### Research (decision-ready synthesis)
- `.planning/research/SUMMARY.md` → "Phase 1: True Human Takeover (Possession)" section; **Pitfall 4** (possession desync — backend branch is the core deliverable); **Pitfall 5** (arena-bridge parity); **Pitfall 6** (serde default + bindings.ts drift); "Cross-Cutting Constraints" table.

### Spec of record
- `civ-multi-civ-world-plan.md` (repo root) — v2.0/v2.1 engine spec the milestone extends (background; Phase 1 reuses existing seams, no new world-gen).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `tauri-app/src-tauri/src/civilization.rs:514` — `CivCivilization.controller: Option<String>` already exists (free-form attribution label, sanitized; **not** a control mode). `control_mode` is a NEW, separate `#[serde(default)]` field added near here.
- `tauri-app/src-tauri/src/civilization.rs:625` — `CivDecisionAction` struct = the full order set the orders panel mirrors.
- `tauri-app/src-tauri/src/civilization.rs:2207` — `validate_action` (and `apply_model_decision` nearby) = the path human orders must reuse (D-02). Existing action types: gather/build/research/explore/policy/prepare/attack/raid/diplomacy/set_stance/trade/claim.
- `tauri-app/src-tauri/src/civilization.rs:817` — `set_civ_controller` command (controller tag, sanitization pattern to mirror for any new command).
- `tauri-app/src-tauri/src/civilization.rs:3052` — `apply_intervention_to_snapshot` = the god-mode/observer mutation seam kept as a separate toggle (D-03).
- `tauri-app/src/components/civilization/CivilizationView.tsx:464` — `window.civPilotControls.start/stop` bridge (already has `civId` + `controller` scoping) — extend with `possess(civId)` / `release` verbs (POSS-04).
- `tauri-app/src/components/civilization/CivilizationGameCanvas.tsx:259/305` — `window.render_game_to_text` (+ `renderSnapshotToText`); the `civs[]` text block already carries `controller` — append `control_mode` here (POSS-04). NOTE: the text bridge is **frontend-built**, not a Rust fn.
- `tauri-app/src/lib/civPilot.ts` — entity-level avatar pilot (`possessedEntityId`); coexists independently (D-06). Its `CivPilotTextState.civs[]` type carries `controller` — extend with `control_mode`.

### Established Patterns
- **Additive serde:** new struct fields are `#[serde(default)]`; schema-shape change bumps `SCHEMA_VERSION` + extends `migrate_value_in_place`. `control_mode` defaults to `model` so pre-v2.1 saves load as AI-driven.
- **Per-civ controller attribution** (ARENA-03) — pair `control_mode` (LLM bypass) with the existing `controller` (who drives).
- **Deterministic `civ_turn_order`** (shuffled per turn) — human civ keeps its slot (D-08); no new RNG draw (DETERMINISM).
- **bindings.ts** is regenerated via `tauri dev` after any new command — never hand-edit (see project memory: bindings drift trap).

### Integration Points
- `tauri-app/src-tauri/src/civilization.rs:874` — the per-civ loop inside `advance_civ_turn` (`call_model_text` at :881). **The guard branch goes here:** `control_mode != model` → skip `call_model_text`/repair, instead apply the staged human decision (or idle), then fall through unchanged to the unconditional post-loop combat/predator/environment passes (:959+).
- A **staged human-decision buffer** must carry the human civ's queued orders into `advance_civ_turn` (shape = Claude's discretion).
- **Parity test (exit gate):** a unit test asserting **0 `call_model_text` calls** for a possessed civ while world passes still run; plus a UI-verb vs `civPilotControls`-verb vs `render_game_to_text()` diff.
- **Fallback:** `tauri-app/src/lib/tauriBrowserFallback.ts` mocks any new IPC command with canned shapes — never port engine logic into TS.
</code_context>

<specifics>
## Specific Ideas

- The user picked the **"queue → End Turn" RTS orders panel** mockup explicitly:
  ```
  ┌─ ORDERS — Coral Reef (YOU) ──────┐
  │ [Gather ▾] moss   workers [3 ▾] [+]│
  │ [Build  ▾] farm            [+]    │
  │ [Research ▾] canals        [+]    │
  │ [Diplomacy ▾] civ-2 · ally  [+]   │
  ├─ Queued this turn ───────────────┤
  │ • gather moss ×3            [x]   │
  │ • build farm                [x]   │
  └───────── [ End Turn ▶ ] ─────────┘
  ```
- HUD banner phrasing direction: "Playing as <civ> · model bypassed".
</specifics>

<deferred>
## Deferred Ideas

- **Rich diegetic in-world possession markers** (flag/glow over the colony) → Phase 6 (game-native UI restyle).
- **Multi-civ hot-seat** (local player piloting several civs at once) → not in scope; the per-civ `control_mode` data model leaves it open for later.
- **Unified commander + avatar mode** (auto-attach to an axolotl when possessing a civ) → revisit in a later phase if it feels needed; layers stay independent for now.
- **sell / buy / craft / talk-to-NPC / terraform order verbs** → Phases 2–5; the Phase 1 orders panel ships only the existing v2.0 action set.
</deferred>

---

*Phase: 1-Human Takeover (Possession)*
*Context gathered: 2026-06-07*
