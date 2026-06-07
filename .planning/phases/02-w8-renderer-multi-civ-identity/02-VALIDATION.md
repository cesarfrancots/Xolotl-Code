---
phase: 2
slug: w8-renderer-multi-civ-identity
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-07
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

| Req ID | Behavior | Test Type | Automated Command | Status |
|--------|----------|-----------|-------------------|--------|
| REN-01 | `hexToTint` parses `#`/3-digit; bad input → `0xffffff` | unit (pure) | `npx vitest run civCanvas` | ⬜ pending |
| REN-01 | `buildCivColorMap(civs)` maps id→{tint,alive}; skips id-less; alive default | unit (pure) | `npx vitest run civCanvas` | ⬜ pending |
| REN-01 | `civ_id == null` (wild fauna) → no civ tint (map miss) | unit (pure) | `npx vitest run civCanvas` | ⬜ pending |
| REN-01 | region `owner == null` → no overlay (neutral) | unit (pure) | `npx vitest run civCanvas` | ⬜ pending |
| REN-01 | dead civ (`alive:false`) → grey/desaturated tint selected | unit (pure) | `npx vitest run civCanvas` | ⬜ pending |
| REN-01 | per-civ tint on axolotls/buildings/territory; morph legible | manual visual | `npm run tauri dev`, 3-civ world | ⬜ manual |
| REN-02 | `colonyBounds(colonies,pad)` over living colonies → rect; null when none | unit (pure) | `npx vitest run civCanvas` | ⬜ pending |
| REN-02 | `colonyBounds` excludes dead colonies (collapse re-frame) | unit (pure) | `npx vitest run civCanvas` | ⬜ pending |
| REN-02 | `focusTarget` → home-region center → centroid → spawn_x → null | unit (pure) | `npx vitest run civCanvas` | ⬜ pending |
| REN-02 | `window.civCamera` keeps 4 existing methods AND adds `focusCiv`/`frameAll` | component | `npx vitest run CivilizationView` | ⬜ pending |
| REN-02 | leaderboard row click → `selectedCivId` → `focusCiv` invoked | component (RTL) | `npx vitest run CivilizationView` | ⬜ pending |
| REN-02 | default frames all colonies; focus pans+zooms; perf at 3 civs | manual visual | `npm run tauri dev`, 3-civ world | ⬜ manual |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tauri-app/src/components/civilization/CivilizationGameCanvas.test.ts` (or `civCanvas.test.ts`) — covers REN-01/REN-02 **pure helpers**; must `vi.mock("phaser")` if it imports from the canvas module. Requires the planner to export `hexToTint`/`buildCivColorMap`/`colonyBounds`/`focusTarget` as named exports (like Phase 1 exported `renderSnapshotToText`).
- [ ] Extend `tauri-app/src/components/civilization/CivilizationView.test.tsx` — assert `window.civCamera.focusCiv` exists + is called on selection/leaderboard-click; assert the four existing bridge methods remain (additive ARENA-02 contract).
- [ ] No new framework install — vitest/jsdom/RTL already present.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Per-civ tint visible & morph still legible | REN-01 | Real GPU rendering; jsdom has no canvas GPU | `npm run tauri dev`, create a 3-civ world (distinct colors), confirm axolotls/buildings/territory read by civ color and morph detail survives; collapse a civ → its entities grey |
| Default frames all colonies; focus pans/zooms; no frame collapse at scale | REN-02 | Camera framing is a visual/perf property | `npm run tauri dev`, 3-civ world: confirm default view shows all colonies; click a leaderboard row → camera focuses that civ; "frame all" resets; interaction stays smooth |

---

## Validation Sign-Off

- [ ] All automatable tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (the new helper test + extended component test)
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter (after execution + audit)

**Approval:** pending
