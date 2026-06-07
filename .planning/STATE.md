---
gsd_state_version: 1.0
milestone: v2.1
milestone_name: Living World & Economy
status: roadmap_complete
last_updated: "2026-06-07T00:00:00.000Z"
last_activity: 2026-06-07
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# State: xolotl

**Initialized:** 2026-05-07
**Mode:** yolo
**Granularity:** standard

---

## Project Reference

- **Core Value:** A developer can spawn, monitor, and coordinate multiple AI agents working in parallel on a single project — from a chat-first desktop app — without being locked into OpenAI or Anthropic.
- **Current Focus:** v2.1 Living World & Economy — **roadmap complete, Phase 1 not started**. v2.0 Civ Simulation shipped 2026-06-07 (code-complete; live UAT pending). v2.1 goal: a fully playable axolotl civ game — infinite procedural world, resource→currency→shop economy (5+ currencies), true human takeover (possession), NPCs, items, Gemini-generated assets, game-native UI — where every human-play feature also deepens agentic playability.

## Current Position

Phase: 1 — Human Takeover (Possession)
Plan: —
Status: Not started (roadmap approved; ready to plan)
Last activity: 2026-06-07 — v2.1 ROADMAP created (6 phases, 22/22 reqs mapped, reset numbering, v2.0 collapsed)

**Progress:** [------] 0/6 phases

## Performance Metrics

| Metric | Value |
|--------|-------|
| v2.1 phases | 0 / 6 complete |
| v2.1 requirements mapped | 22 / 22 (0 orphans, 0 duplicates) |
| v2.1 plans completed | 0 / TBD |
| Active blockers | 0 |
| v2.0 (shipped) | 5 phases / 14 plans / 17 reqs (live UAT pending) |
| v1.0 (shipped) | 6 phases / 33 plans / 40 reqs |

## Accumulated Context

### Key Decisions

- v2.1 uses RESET phase numbering — Phase 1 is the first v2.1 phase; v2.0 phases 1-5 and v1.0 phases 1-6 are archived to `.planning/milestones/`.
- v2.1 phase order (from `research/SUMMARY.md`): Possession → Economy → Shop → Items/Crafting/NPCs → Chunked World → Assets/UI. Possession is first because it is cheap (1 field + 1 branch) and makes every later phase human-testable; economy balance needs human play to validate.
- Economy before shop (shop needs something to cost); items/NPCs before chunked world (items are content distributed into chunks + are shop SKUs); chunked world late (highest structural risk — content must be stable first); assets/UI last + parallelizable with Phase 5.
- v2.1 is overwhelmingly ADDITIVE over the v2.0 engine: new serde(default) fields + new dispatch arms + new catalog tables. Zero new runtime dependencies (hand-rolled fBm on existing xorshift; existing Tailwind/shadcn/cmdk stack; existing Gemini pipeline).
- Currency does NOT feed the score function (anti-hoard); 5 currencies = Shells / Pearls / Tidewardens' Favor / Spawn-tokens / Ancient Amberglass, each with a distinct faucet + sink.

### v2.1 Constraints (carry into every phase — per-phase exit criteria, not one-time)

- **PARITY** — every new human verb (possess / sell / buy / craft / talk-to-NPC / terraform) is also a `CivDecisionAction` arm AND a `civPilotControls` command AND appears in `render_game_to_text()`. Diff UI verbs vs bridge verbs in a test before phase close.
- **DETERMINISM** — no new draw on the shared founder/vein RNG; new world-gen uses salted per-chunk sub-streams. Backend (tauri-app/src-tauri) tests can't run on Windows (WebView2) — verify via `cargo check` + `cargo clippy --pedantic` + `cargo test --no-run`; full tests on CI. Frontend via `npx tsc --noEmit` + vitest.
- **BACK-COMPAT** — every new struct field `#[serde(default)]`; schema-shape change bumps `SCHEMA_VERSION` + extends `migrate_value_in_place`; pre-v2.1 save loads cleanly each phase. `bindings.ts` regenerated via `tauri dev` (never hand-edited). Arena-bridge keys append-only (legacy vitest locks stay byte-identical green).
- **FALLBACK = IPC MOCK ONLY** — `tauriBrowserFallback.ts` mocks new IPC commands with believable canned shapes; NEVER port engine RNG/economy math into TypeScript.
- **UI SCOPE** — restyle/UI work confined to `tauri-app/src/components/civilization/`; never touch harness chat/eval/settings surfaces.

### Open Todos

- Phase 5 (Chunked World) is flagged **NEEDS RESEARCH** — `/gsd-plan-phase 5` must run a research pass on the `tile_at` accessor, sparse diff-persistence schema, W8 RenderTexture chunk pooling, and per-chunk determinism testing before requirements are written. Also decide `tauriBrowserFallback.ts` preview scope (single-chunk vs multi-chunk mock).

### Blockers

- None.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Verification | v2.0 Phase 02 (renderer) live UAT — `human_needed` (WebView2 + real providers) | UAT pending | v2.0 close |
| Verification | v2.0 Phase 03 (environment) live UAT — `human_needed` (WebView2 + real providers) | UAT pending | v2.0 close |
| CI/Build | v2.0 backend `cargo test` on Linux/macOS CI + desktop exe refresh via `build.bat` | Pending | v2.0 close |
| Economy (v2.2+) | Dynamic/auction markets with supply-demand pricing (MKT-01) | Deferred | v2.1 planning |
| World (v2.2+) | Deep W10.7 cave systems (CAVE-01 — highest f32 determinism risk) | Deferred | v2.1 planning |
| Fauna (v2.2+) | Tameable fauna ranching / breeding economy (RANCH-01) | Deferred | v2.1 planning |
| NPCs (v2.2+) | Branching NPC narrative / multi-step quest chains (NPC-V2-01) | Deferred | v2.1 planning |
| Persistence (v2.2+) | Cross-run currency/inventory persistence beyond Amberglass Vault (PERSIST-01) | Deferred | v2.1 planning |

## Session Continuity

- **Last action:** Milestone v2.1 "Living World & Economy" ROADMAP created — 6 phases (reset numbering), 22/22 requirements mapped (0 orphans, 0 duplicates), 2-5 goal-backward success criteria per phase with SUMMARY exit gates folded in. v2.0 collapsed into an archived `<details>` block (detail lives in `.planning/milestones/v2.0-ROADMAP.md`); milestones list now reads ✅ v1.0, ✅ v2.0, 🚧 v2.1. Phase 5 flagged NEEDS RESEARCH. REQUIREMENTS.md traceability statuses updated.
- **Next action:** `/gsd-discuss-phase 1` (or `/gsd-plan-phase 1`) for **Phase 1 — Human Takeover (Possession)**: add `control_mode` field + the `advance_civ_turn` LLM-bypass branch + bridge parity (`civPilotControls.possess` + text-state). Exit gate: a unit test proving 0 model calls for a possessed civ while post-loop world passes still run.
- **Last updated:** 2026-06-07
- **Resume file:** .planning/ROADMAP.md

---
*State initialized: 2026-05-07; milestone v2.1 started 2026-06-07*

## Operator Next Steps

- v2.1 roadmap is approved/written. Resume with `/gsd-discuss-phase 1` (or `/gsd-plan-phase 1`) for Phase 1 (Possession).
- Separately, the v2.0 milestone still has open human/CI gates: live UAT of the running sim (real providers + WebView2), backend `cargo test` on Linux/macOS CI, and a `build.bat` exe refresh. These are independent of v2.1 planning.
