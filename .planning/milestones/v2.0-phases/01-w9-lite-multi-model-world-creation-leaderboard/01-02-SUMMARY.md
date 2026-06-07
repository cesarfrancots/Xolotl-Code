---
phase: 01-w9-lite-multi-model-world-creation-leaderboard
plan: 02
subsystem: civilization-frontend
tags: [react, zustand, vitest, tdd, multi-civ, world-creation]
provides:
  - "Multi-participant createSession({ name, seed?, civs[] }) in civStore"
  - "selectedCivId + setSelectedCivId shared selection state (reset on create/load)"
  - "normalizeCiv controller default (null when absent)"
  - "1-3 participant creation picker (per-row name + model + overridable color chip)"
  - "ParticipantPicker shared by the welcome card and the left drawer"
affects: [01-03 (leaderboard/observer/log read selectedCivId), phase-2 focusCiv]
tech-stack:
  added: []
  patterns:
    - "TDD RED/GREEN per task (test commit then feat commit)"
    - "Single source of truth for selection (store-owned selectedCivId)"
    - "Shared sub-component for two creation surfaces (no divergent UIs)"
    - "Auto palette mirroring backend CIV_COLORS ordering"
key-files:
  created:
    - tauri-app/src/components/civilization/CivilizationView.test.tsx
  modified:
    - tauri-app/src/stores/civStore.ts
    - tauri-app/src/stores/civStore.test.ts
    - tauri-app/src/components/civilization/CivilizationView.tsx
key-decisions:
  - "selectedCivId resets to null (not top-ranked) on session change — simplest, matches PATTERNS guidance; downstream panels fall back to primaryCiv when null"
  - "Refactored the drawer 'New colony' surface to the same ParticipantPicker, not just the welcome card, so both founding paths share one participants[] state and one handleCreate"
  - "Dropped the legacy selectedModel component state entirely; per-civ model selection now lives in participants[]"
requirements-completed: [CIV-01]
duration: 11 min
completed: 2026-06-06
---

# Phase 1 Plan 02: Multi-Model World Creation + selectedCivId Summary

**Replaced the single-model colony-creation card with a 1-3 participant picker (per-row editable name, model select with same-model allowed, and overridable color chip auto-assigned from the backend CIV_COLORS palette), wired it to a multi-participant `createSession`, and added store-owned `selectedCivId` selection state that resets on every session change.**

## Performance
- **Duration:** 11 min
- **Tasks:** 2 / 2
- **Files modified:** 3 (+1 created)

## Accomplishments
- `civStore.createSession` now takes `{ name; seed?; civs: { name; model; color? }[] }` and forwards it straight to `commands.createCivSession` (legacy top-level `model` field no longer sent — the backend `Option<String>` model only guards old saved JSON / external callers).
- Added `selectedCivId: string | null` + `setSelectedCivId` to `CivState`; reset to `null` inside both `createSession` and `loadSession` (every code path that swaps the active session).
- `normalizeCiv` defaults the new `controller` field to `null` when absent and preserves an explicit string tag.
- Creation card (both the welcome surface and the left drawer's "New colony" section) now renders a shared `ParticipantPicker`: 1 row by default, "Add civilization" enabled while `< 3`, per-row remove enabled while `> 1`, each row exposing a name `<Input>`, a model `<select>` (no unique-model filtering — same model allowed across civs), and an overridable color chip pre-filled from `CIV_PALETTE[index]` (mirrors backend `CIV_COLORS` order so chips match founded civ colors).
- `handleCreate` builds `civs[]` from the participant rows (trimmed name fallback `Civ {n}`, model fallback to the preferred model) and calls `createSession`, then resets selection so the observer panel has a focus.

## Task Commits
1. **Task 1 (RED): failing civStore specs** - `a51e1b2`
2. **Task 1 (GREEN): multi-participant createSession + selectedCivId + controller default** - `4f0ad93`
3. **Task 2 (RED): failing participant-picker specs** - `5c08ae4`
4. **Task 2 (GREEN): 1-3 participant picker wired to createSession** - `c2f6e9a`

## Files Created/Modified
- `tauri-app/src/stores/civStore.ts` - createSession multi-participant signature; `selectedCivId`/`setSelectedCivId`; selection reset on create/load; `normalizeCiv` controller default.
- `tauri-app/src/stores/civStore.test.ts` - mocked bindings `commands`; specs for civs[] forwarding, selectedCivId state + reset, controller default/preservation.
- `tauri-app/src/components/civilization/CivilizationView.tsx` - `CIV_PALETTE`/participant helpers; `participants[]` state replacing `selectedModel`; `ParticipantPicker` sub-component used by both creation surfaces; rewritten `handleCreate`.
- `tauri-app/src/components/civilization/CivilizationView.test.tsx` (new) - RTL specs for row bounds (1-3), per-row name/model/color, and N-civ + single-civ founding via createSession.

## Verification
- `npx tsc --noEmit` → exit **0** (full project, against the Plan 01-01 regenerated bindings).
- `npm test -- civStore` → **13 passed** (8 pre-existing + 5 new).
- `npm test -- CivilizationView` → **6 passed** (new file).
- Full suite `npm test` → **25 files, 203 tests passed** (no regressions).
- Single-participant back-compat exercised by a dedicated test (`civs.length === 1`, model `kimi`).

## Decisions & Deviations

### Decisions
- **selectedCivId resets to `null`** (rather than top-ranked living civ) on session change — the conservative choice; downstream readers fall back to `primaryCiv(snapshot)` when null. Asserted in the store spec.
- **Both creation surfaces share one ParticipantPicker.** The plan named only the welcome card (805-838), but an identical single-model `<select>` lived in the left drawer's "New colony" section (941-954) calling the same `handleCreate`. Leaving it would create two divergent creation UIs (one single-model, one multi-model) over one `participants[]` state. I refactored both to the shared component so founding is coherent from either entry point.

### Deviations
- **[Rule 3 - Blocking] Drawer creation surface migrated to the multi-participant picker.** Found during Task 2. The drawer's single-model `<select>` still bound to the now-deleted `selectedModel` state, which would have left a dangling reference (tsc error) and a second, inconsistent creation path. Fixed by routing the drawer through the same `ParticipantPicker` + `canFound`/`handleCreate`. Files: `CivilizationView.tsx`. Verified: tsc 0, full suite green. Commit: `c2f6e9a`.
- **Total deviations:** 1 auto-fixed (1 blocking). **Impact:** Scope stayed within the plan's two named files; the change keeps both founding entry points consistent and removes dead state. No architectural change.

## Known Stubs
None. The picker is fully wired to `createSession` → `commands.createCivSession`; no placeholder/empty-data paths introduced.

## Next Phase Readiness
Ready for **Plan 01-03**: `selectedCivId`/`setSelectedCivId` are store-owned and exported for the leaderboard top-bar (writer) and the observer panel + per-civ log filter (readers). The creation flow now founds N-civ worlds (CIV-01 complete). No bindings changes were made (Plan 01-01's regenerated `bindings.ts` consumed as-is).
