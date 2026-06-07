# Phase 1: W9-lite — Multi-Model World Creation + Leaderboard - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-06
**Phase:** 1-w9-lite-multi-model-world-creation-leaderboard
**Areas discussed:** Creation UI & participants, Leaderboard panel, Per-civ decision log, Harness arena bridge

---

## Creation UI & Participants

| Option | Description | Selected |
|--------|-------------|----------|
| Auto palette + override | Next palette color per participant; chip to change | ✓ |
| Auto palette only | Palette colors, not editable | |
| User picks each | User must choose every color | |

**User's choice:** Auto palette + override

| Option | Description | Selected |
|--------|-------------|----------|
| Allow duplicates | Same model can power 2+ civs | ✓ |
| Unique models only | Each civ a different model | |

**User's choice:** Allow duplicates

| Option | Description | Selected |
|--------|-------------|----------|
| 1–3 (1 = back-compat) | Single-civ allowed up to 3 | ✓ |
| Require 2–3 | Force ≥2 participants | |

**User's choice:** 1–3 (1 = back-compat)

| Option | Description | Selected |
|--------|-------------|----------|
| Auto, editable | Default name, inline-rename | ✓ |
| Auto only | Generated, not editable | |

**User's choice:** Auto, editable
**Notes:** Back-compat for single-model worlds is a hard requirement; duplicates enable testing seed/strategy variance of the same model.

---

## Leaderboard Panel

| Option | Description | Selected |
|--------|-------------|----------|
| Persistent top bar | Always-visible ranking strip above canvas | ✓ |
| Right observer drawer | New section in existing drawer | |
| Left panel | Dedicated left-side panel | |

**User's choice:** Persistent top bar

| Option | Description | Selected |
|--------|-------------|----------|
| Rich row | color/rank/name/model/score/pop/era/alive | |
| Minimal row | color/rank/name/score | ✓ |

**User's choice:** Minimal row

| Option | Description | Selected |
|--------|-------------|----------|
| Greyed at bottom | Collapsed civs greyed below living | ✓ |
| Hide dead | Dead civs disappear | |

**User's choice:** Greyed at bottom

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, selects civ | Row-click sets selectedCivId | ✓ |
| No, display only | Read-only board | |

**User's choice:** Yes, selects civ
**Notes:** Minimal rows + row-click → detail in observer panel; same selection feeds Phase 2 focusCiv.

---

## Per-Civ Decision Log

| Option | Description | Selected |
|--------|-------------|----------|
| Combined, filter on select | One tagged stream, filters to selected civ | ✓ |
| Always combined | Interleaved, never filtered | |
| Always per-civ | Scoped to selected civ only | |

**User's choice:** Combined, filter on select

| Option | Description | Selected |
|--------|-------------|----------|
| Action + rationale | Action plus model's rationale | ✓ |
| Action only | Structured action only | |

**User's choice:** Action + rationale

| Option | Description | Selected |
|--------|-------------|----------|
| Collapsed, on demand | Reasoning behind per-entry toggle | ✓ |
| Don't show reasoning | Skip chain-of-thought | |
| Always inline | Reasoning shown inline always | |

**User's choice:** Collapsed, on demand
**Notes:** Reasoning models stream reasoning_content separately (gotcha #6) — may require backend threading; flagged for research.

---

## Harness Arena Bridge

| Option | Description | Selected |
|--------|-------------|----------|
| Extend additively | Keep player/civilization keys; add civs[]/leaderboard/environment | ✓ |
| Clean multi-civ redesign | Replace shape; update codex-play-civ.mjs | |

**User's choice:** Extend additively

| Option | Description | Selected |
|--------|-------------|----------|
| Structured JSON | JSON object as today | ✓ |
| Human-readable + JSON | Prose summary + structured object | |

**User's choice:** Structured JSON

| Option | Description | Selected |
|--------|-------------|----------|
| One civ by id | Harness targets a civ_id; others AI-driven | ✓ |
| Keep player/possession layer | Drive existing possession layer | |
| Drive any/all civs | Harness issues actions for any civ | |

**User's choice:** One civ by id

| Option | Description | Selected |
|--------|-------------|----------|
| Controller tag on civ | Driven civ carries controller label on leaderboard + text-state | ✓ |
| Text-state only | Controller field only in render_game_to_text | |
| Reuse model field | No separate controller concept | |

**User's choice:** Controller tag on civ
**Notes:** Framing is "harness vs the AI models"; controller tag distinguishes "harness X driving model Y" from "model Y playing itself".

---

## Claude's Discretion

- Exact palette hex values / contrast rules
- Top-bar layout, styling, narrow-width collapse
- Exact `civs[]` summary field set in text-state
- `selectedCivId` storage location (store vs component)
- Log entry visual design + expand interaction
- When the controller tag is set (creation vs start vs both)

## Deferred Ideas

- Add-civilization mid-run UI + `add_civ_to_session` command (full W9) — deferred
- Environment HUD — Phase 3 (W4)
- Diplomacy-management UI — Phase 4 (W6)
- Renderer per-civ tints + multi-colony camera / `focusCiv` — Phase 2 (W8)
