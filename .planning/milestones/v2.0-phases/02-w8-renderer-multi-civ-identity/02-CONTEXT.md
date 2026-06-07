# Phase 2: W8 — Renderer Multi-Civ Identity - Context

**Gathered:** 2026-06-07
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (decisions made by Claude per user's "keep going on your own" directive; all proposals auto-accepted)

<domain>
## Phase Boundary

Make the multi-civ world visually legible: every civilization's axolotls, buildings, and
territory render tinted by that civ's color so colonies are distinguishable at a glance, and
the Phaser camera frames all living colonies by default while supporting focus on a single civ
(`focusCiv`) — staying performant at the larger multi-civ world scale.

Delivers REN-01 (per-civ tint) and REN-02 (multi-colony camera + focus + performance).

In scope: canvas/Phaser rendering in `CivilizationGameCanvas.tsx` (sprite tint, territory
overlay, camera framing/focus, the `window.civCamera` bridge). Out of scope: game logic,
new HTML panels (the leaderboard/observer landed in Phase 1), environment/combat/genetics
visuals (Phases 3–5), and Game B possession rendering (parked).
</domain>

<decisions>
## Implementation Decisions

### Tinting (REN-01)
- Tint axolotls and buildings with Phaser `setTint(civColorHex)` keyed by `entity.civ_id` →
  a `civ_id → civ.color` lookup built once per snapshot from `snapshot.civs` (colors resolved
  in Phase 1's palette/override logic). Reuse the existing `setTint` call sites (lines ~971/980).
- Territory/regions: render a translucent fill + border in the owning civ's color
  (`region.owner` → civ color). Unowned/neutral regions stay neutral (no tint / subtle grey).
- Civ tint is the PRIMARY identity cue; keep sprite legibility (don't fully wash out morph/GFP
  detail — blend so colony identity reads while individual sprites stay recognizable). Exact
  blend ratio is Claude's discretion.
- Dead/collapsed civs: their remaining entities (if any) render greyed/desaturated.

### Camera (REN-02)
- Default framing: compute a bounding box over ALL living colonies (home regions + their
  entities) and fit the camera to show them all — generalize the existing single-`this.colony`
  fit/zoom logic (~2948–2963) to N colonies.
- Focus: `focusCiv(civId)` pans + zooms to that civ's colony. Wire it to `selectedCivId`
  (clicking a leaderboard row focuses that civ). A "frame all" / reset returns to the
  all-colonies view.
- Re-frame on world create/load and on civ collapse (drop dead civs from the default frame).
  Keep existing manual pan/zoom controls working — extend `window.civCamera` additively and
  expose `focusCiv` there for UI/harness use.

### Performance (REN-02)
- Reuse existing sprite/update patterns; set tint only when an entity's civ changes or on
  (re)creation — no per-frame re-tint of the whole world.
- Cull/skip off-screen entities at the larger scale if needed; keep the minimap path intact.
- Target stable interaction at a 3-civ world without frame collapse (informal verification —
  no hard FPS instrumentation required this phase).

### Claude's Discretion
- Exact tint blend ratios, territory overlay alpha, camera easing/durations, and whether to
  dim non-selected civs while focused.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `CivilizationGameCanvas.tsx` Phaser scene: `this.cameras.main` (`setBounds` ~650,
  `centerOn` ~2905, `setZoom` ~2911, `pan`), existing `window.civCamera` bridge (~2918),
  `setTint` usage (~714/971/980), camera fit/zoom logic (~2948–2963).
- `snapshot.civs` carry `id`/`color` (Phase 1); entities carry `civ_id`; regions carry
  `owner` (civ_id). `civStore` normalizes both v1 and v2 snapshots.
- `selectedCivId` + `setSelectedCivId` in `civStore` (Phase 1/2) — the selection signal to
  drive `focusCiv`.

### Established Patterns
- The scene is single-colony-centric today (`this.colony`); generalize to a colonies list.
- ARENA bridges on `window` (`render_game_to_text`, `civPilotControls`, `civCamera`) are
  extend-only contracts — do not break them (CLAUDE.md / Phase 1 ARENA-02).

### Integration Points
- Leaderboard row click → `setSelectedCivId` (Phase 1) → camera `focusCiv` (this phase).
- Possible parity surface: `tauriBrowserFallback.ts` (single-player mechanics duplicated) —
  verify during planning whether the canvas renderer needs any mirrored change (likely not,
  renderer is canvas-only).

</code_context>

<specifics>
## Specific Ideas

- Extend, don't rebuild: build on the existing `civCamera` + `setTint` + fit logic rather than
  replacing the scene. Keep all `window.*` arena/camera bridges working; add `focusCiv`
  additively.

</specifics>

<deferred>
## Deferred Ideas

- Environment/disaster VFX (Phase 3), combat/territory-contest visuals (Phase 4), genetics
  pattern-allele rendering (Phase 5).
- Minimap multi-civ redesign beyond basic tint.
- Game B possession-mode rendering (parked for this milestone).

</deferred>
