# Phase 1: Human Takeover (Possession) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-07
**Phase:** 1-Human Takeover (Possession)
**Areas discussed:** Order-entry UX, Possess entry + badge, Avatar coexistence, Turn cadence, Possession scope

---

## Order-entry UX — form factor

| Option | Description | Selected |
|--------|-------------|----------|
| RTS orders panel | Game-native panel with a control per action type; queue actions → advance. Cleanest parity, reads as a game. | ✓ |
| Minimal decision composer | Thin form building the same decision JSON the AI submits. Max parity, least UI, feels like a debug form. | |
| You decide | Default to the RTS orders panel. | |

**User's choice:** RTS orders panel (selected the "queue → End Turn" mockup preview).
**Notes:** Panel mirrors the existing `CivDecisionAction` set 1:1.

## Order-entry UX — rules/latitude

| Option | Description | Selected |
|--------|-------------|----------|
| Same rules as AI | Route every action through existing validate_action/apply_model_decision; same caps/costs/one-decision-per-turn. | |
| Rules + god-mode on the side | Same CivDecisionAction rules, BUT existing god-mode intervention controls stay as a separate observer/cheat toggle. | ✓ |
| You decide | Default to same-rules; god-mode only if trivially separable. | |

**User's choice:** Rules + god-mode on the side.
**Notes:** Two clearly-separated surfaces — fair-play orders panel + separate observer/cheat toggle.

## Possess entry + badge — entry affordance

| Option | Description | Selected |
|--------|-------------|----------|
| Button on civ/leaderboard row | Per-civ Possess/Release button; reuses selectedCivId + focusCiv. | ✓ |
| Toggle in a civ detail panel | Possess/Release lives in a civ inspector panel. | |
| You decide | Default to per-civ button on the leaderboard row. | |

**User's choice:** Button on civ/leaderboard row.

## Possess entry + badge — in-game visibility

| Option | Description | Selected |
|--------|-------------|----------|
| YOU badge + HUD banner | 'YOU' badge on the possessed civ row + persistent HUD banner ("Playing as … · model bypassed"). | ✓ |
| Badge only | Just the badge/highlight, no banner. | |
| Add in-world marker too | Also a diegetic marker over the colony (pulls Phase 6 scope earlier). | |

**User's choice:** YOU badge + HUD banner.
**Notes:** Diegetic in-world markers explicitly left to Phase 6.

## Avatar coexistence — control scope

| Option | Description | Selected |
|--------|-------------|----------|
| Strategic-only, layers coexist | Civ-possession = orders + advance; existing single-axolotl avatar control stays independent. Smallest scope. | ✓ |
| Unified commander + avatar | Possessing a civ also auto-attaches to an axolotl; couples the two systems. | |
| You decide | Default to strategic-only. | |

**User's choice:** Strategic-only, layers coexist.

## Turn cadence — advancement model

| Option | Description | Selected |
|--------|-------------|----------|
| One global turn clock | End Turn applies queued orders (no model call) + steps AI + world same turn; empty queue = idle. Preserves determinism + turn-order fairness. | ✓ |
| Step my civ independently | Decouple the human civ's clock from the AI; breaks single deterministic turn_order. | |
| You decide | Default to one global turn clock with idle allowed. | |

**User's choice:** One global turn clock.

## Possession scope — local player multi-civ policy

| Option | Description | Selected |
|--------|-------------|----------|
| One human civ at a time | Local player pilots a single civ vs the AI; data model still allows agent-possession of other civs via the bridge. | ✓ |
| Multiple human civs (hot-seat) | Local player possesses several civs at once; muddies vs-AI framing. | |
| You decide | Default to one local human civ; keep per-civ control_mode general. | |

**User's choice:** One human civ at a time.
**Notes:** `control_mode` stays per-civ/general so agents can possess others via `civPilotControls` (POSS-04).

---

## Claude's Discretion

- Exact placement of the orders panel + Possess button in CivilizationView.
- Shape/location of the staged human-decision buffer read by `advance_civ_turn`.
- Precise badge/banner styling and the exact bridge verb name (`possess`/`release`).
- Two low-ambiguity defaults captured without asking: released civ resumes model-driven turns from current state on next advance; possessed civ stays on the leaderboard and is scored identically.

## Deferred Ideas

- Rich diegetic in-world possession markers → Phase 6 (game-native UI restyle).
- Multi-civ hot-seat (local player piloting several civs) → out of scope; data model leaves it open.
- Unified commander + avatar mode → revisit later if needed.
- sell / buy / craft / talk-to-NPC / terraform order verbs → Phases 2–5.
