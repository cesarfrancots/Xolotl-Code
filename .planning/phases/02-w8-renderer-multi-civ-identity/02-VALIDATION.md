---
phase: 2
slug: w8-renderer-multi-civ-identity
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-07
audited: 2026-06-07
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Frontend-only phase (Phaser/React/TS). No `src-tauri` change — no cargo step.
> Actual GPU rendering is manual-only (jsdom has no GPU); pure helpers are unit-tested.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.5 (jsdom env, globals on) + RTL |
| **Config file** | `tauri-app/vitest.config.ts` |
| **Quick run command** | `cd tauri-app && npx vitest run <pattern>` (e.g. `civCanvas`, `CivilizationView`) |
| **Full suite command** | `cd tauri-app && npm test` |
| **Type gate** | `cd tauri-app && npx tsc --noEmit` |
| **Backend** | N/A this phase (no Rust change) |
| **Estimated runtime** | frontend ~10–20s |

---

## Sampling Rate

- **After every task commit:** `npx vitest run <pattern>` for the touched file + `npx tsc --noEmit`.
- **After every plan wave:** `npm test` (full vitest — currently 214 green, must stay green) + `npx tsc --noEmit` exit 0.
- **Before `/gsd-verify-work`:** Full suite green + tsc 0 + manual visual UAT.
- **Max feedback latency:** ~20 seconds.

---

## Per-Task Verification Map

> Populated by the planner once task IDs exist. Each automatable task carries an `<automated>`
> command from the infra above. Pure-helper extraction (named exports) is the key enabler.

| Req ID | Behavior | Test Type | Automated Command | Backing Test | Status |
|--------|----------|-----------|-------------------|--------------|--------|
| REN-01 | `hexToTint` parses `#`/3-digit; bad input → `0xffffff` | unit (pure) | `npx vitest run civCanvas` | `civCanvas.test.ts:32-58` (5 `it`: full hex, no-`#`, 3-digit, null/undef/"", `#<script>`/garbage never-NaN) | ✅ green |
| REN-01 | `buildCivColorMap(civs)` maps id→{tint,alive}; skips id-less; alive default | unit (pure) | `npx vitest run civCanvas` | `civCanvas.test.ts:60-93` (5 `it`: id→{tint,alive}, alive default, alive:false, skip id-less, empty/undef map, missing-colour fallback) | ✅ green |
| REN-01 | `civ_id == null` (wild fauna) → no civ tint (map miss) | unit (pure) | `npx vitest run civCanvas` | `civCanvas.test.ts:96` (`civTintFor(undefined)` → `null` so caller keeps default) | ✅ green |
| REN-01 | region `owner == null` → no overlay (neutral) | unit (pure) | `npx vitest run civCanvas` | `civCanvas.test.ts:127-134` (owner null/undef → null; unknown owner → null) | ✅ green |
| REN-01 | dead civ (`alive:false`) → grey/desaturated tint selected | unit (pure) | `npx vitest run civCanvas` | `civCanvas.test.ts:107-118` (living lightens each channel ≥ raw; dead → exact `GREY`); overlay dead descriptor `:140-141` | ✅ green |
| REN-01 | per-civ tint on axolotls/buildings/territory; morph legible | manual visual | `npm run tauri dev`, 3-civ world | Manual-Only (GPU pixels) — see table below | 🔵 manual |
| REN-02 | `colonyBounds(colonies,pad)` over living colonies → rect; null when none | unit (pure) | `npx vitest run civCanvas` | `civCanvas.test.ts:145-185` (tight box pad 0; pad inflation; null on empty/all-dead) | ✅ green |
| REN-02 | `colonyBounds` excludes dead colonies (collapse re-frame) | unit (pure) | `npx vitest run civCanvas` | `civCanvas.test.ts:170-180` (dead colony dropped from the box) | ✅ green |
| REN-02 | `focusTarget` → home-region center → centroid → spawn_x → null | unit (pure) | `npx vitest run civCanvas` | `civCanvas.test.ts:188-228` (5 `it`: home-region `ty=10` [CORRECTED, HIGH-01], centroid, spawn_x `ty=50` seabed [CORRECTED], null-nothing, null-unknown-civ) | ✅ green |
| REN-02 | `window.civCamera` keeps 4 existing methods AND adds `focusCiv`/`frameAll` | component | `npx vitest run CivilizationView` | `CivilizationView.test.tsx:278-285` (all six methods are functions, additive ARENA-02) + selection-before-install no-op guard `:321-328` | ✅ green |
| REN-02 | leaderboard row click → `selectedCivId` → `focusCiv` invoked | component (RTL) | `npx vitest run CivilizationView` | `CivilizationView.test.tsx:287-314` (selectedCivId→focusCiv, null→frameAll, leaderboard-row→focusCiv) | ✅ green |
| REN-02 | default frames all colonies; focus pans+zooms; perf at 3 civs | manual visual | `npm run tauri dev`, 3-civ world | Manual-Only (GPU camera/perf) — see table below | 🔵 manual |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · 🔵 manual-only*

**Audit (2026-06-07):** every automatable row above is backed by a real, non-hollow,
fail-capable existing test (no redundant tests added). `civCanvas.test.ts` = 27 green;
`CivilizationView.test.tsx` = 18 green; full suite = **245 green across 26 files**;
`npx tsc --noEmit` = exit 0. The decision-bearing logic is fully extracted into the six
pure helpers and unit-tested; the additive bridge + selection→focus wiring is
component-tested. The remaining scene-bound camera math (`frameAll`/`focusCiv`/`onResize`
multi-colony fit, the MED-01 `colonies.length >= 2` gate, `recomputeColonies`) calls
`this.cameras.main` / `Phaser.Math.*` and is GPU/scene-bound — it is covered by the
Manual-Only camera item, and its real-scene `installCameraApi` test is the documented
deferral in `deferred-items.md` (MED-04), not a new automatable gap. **No genuine
automatable coverage gap found.**

---

## Wave 0 Requirements

- [x] `tauri-app/src/components/civilization/civCanvas.test.ts` — covers REN-01/REN-02 **pure helpers**; `vi.mock("phaser")` before the canvas import (`:7-19`). The six helpers `hexToTint`/`buildCivColorMap`/`civTintFor`/`regionOverlayFor`/`colonyBounds`/`focusTarget` are named exports (mirroring Phase 1 `renderSnapshotToText`). 27 assertions green.
- [x] Extended `tauri-app/src/components/civilization/CivilizationView.test.tsx` — asserts `window.civCamera.focusCiv` exists + is called on selection (`:294-295`) / leaderboard-click (`:301-314`); asserts the four existing bridge methods remain alongside the two new ones (additive ARENA-02 contract, `:278-285`); plus a selection-before-install no-op guard (`:321-328`). 18 assertions green.
- [x] No new framework install — vitest/jsdom/RTL already present.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Per-civ tint visible & morph still legible | REN-01 | Real GPU rendering; jsdom has no canvas GPU | `npm run tauri dev`, create a 3-civ world (distinct colors), confirm axolotls/buildings/territory read by civ color and morph detail survives; collapse a civ → its entities grey |
| Default frames all colonies; focus pans/zooms; no frame collapse at scale | REN-02 | Camera framing is a visual/perf property | `npm run tauri dev`, 3-civ world: confirm default view shows all colonies; click a leaderboard row → camera focuses that civ; "frame all" resets; interaction stays smooth |

---

## Validation Sign-Off

- [x] All automatable tasks have `<automated>` verify or Wave 0 dependencies — every Per-Task row maps to a concrete `npx vitest run` command + a named backing test.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — both plans are TDD with per-task `<automated>` blocks.
- [x] Wave 0 covers all MISSING references (the new helper test + the extended component test) — both delivered and green.
- [x] No watch-mode flags — all commands are `vitest run` / `npm test` (run mode).
- [x] Feedback latency < 20s — `civCanvas` ~1.6s, `CivilizationView` ~4.7s, full suite ~11.5s.
- [x] `nyquist_compliant: true` set in frontmatter (after execution + audit).

**Manual-Only items (do NOT block sign-off):** REN-01 visual tint legibility + REN-02 live
framing/perf are irreducible GPU/WebGL properties (jsdom has no GPU) — listed in the
Manual-Only table, to be run via `npm run tauri dev` on a 3-civ world.

**Roadmap SC#3 (chunked-terrain perf):** accepted re-scope — civs capped at 3; the
~36k-tile chunked-`RenderTexture` rewrite is deferred to backlog (see 02-VERIFICATION.md
human item 3 + 02-CONTEXT). NOT a validation gap.

**Approval:** ✅ signed off (Nyquist audit 2026-06-07). tsc 0 · 245/26 green · all six pure
helpers + additive bridge + selection→focus wiring backed by real fail-capable tests · no
hollow tests · no genuine automatable gap found · no redundant tests added. Only the
documented GPU manual-UAT and the accepted SC#3 re-scope remain, neither of which blocks
automated sign-off.
