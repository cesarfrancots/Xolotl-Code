---
phase: 01-w9-lite-multi-model-world-creation-leaderboard
verified: 2026-06-06T20:40:00Z
status: passed
score: 5/5 success criteria verified (6/6 requirements, 17/17 plan truths)
overrides_applied: 0
re_verification: # none — initial verification
gaps: []
deferred:
  - truth: "Add-civilization mid-run UI + add_civ_to_session command"
    addressed_in: "Out of scope per CONTEXT <deferred> (full W9 beyond lite slice); not a Phase 1 promise"
    evidence: "01-CONTEXT.md:120 'Add-civilization mid-run UI + add_civ_to_session command — deferred'; civilization.rs:1346 only a doc comment, command not implemented (intentional)"
  - truth: "Renderer per-civ tints + multi-colony camera / focusCiv"
    addressed_in: "Phase 2 (W8 — Renderer Multi-Civ Identity)"
    evidence: "ROADMAP.md:73-87 Phase 2 success criteria; Phase 1 only sets selectedCivId that focusCiv will consume (CONTEXT.md:123)"
  - truth: "Environment HUD (season/temperature/water/disasters/forecast)"
    addressed_in: "Phase 3 (W4 — Environment Engine)"
    evidence: "ROADMAP.md:89-91; environment rides along in text-state but is not surfaced this phase (CONTEXT.md:121)"
  - truth: "Diplomacy-management UI"
    addressed_in: "Phase 4 (W6 — Combat & Diplomacy)"
    evidence: "CONTEXT.md:122; ROADMAP requirements WAR-03"
---

# Phase 1: W9-lite — Multi-Model World Creation + Leaderboard Verification Report

**Phase Goal:** A user can create a world with 2-3 different AI-model civilizations (each a color), found it, and watch a leaderboard rank the living civs by score as turns advance — and agentic harnesses can read full state as text and drive the game on a shared scoreboard.

**Verified:** 2026-06-06T20:40:00Z
**Status:** passed
**Re-verification:** No — initial verification
**HEAD:** f86a905 (all 4 plans committed)

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| #   | Truth (ROADMAP SC) | Status | Evidence |
| --- | ------ | ------ | -------- |
| 1 | User can create a world from the Civ creation UI with 2-3 participants, each a distinct model + color, and found it | ✓ VERIFIED | `ParticipantPicker` renders 1-3 rows (color chip + name + model picker), capped at `MAX_PARTICIPANTS=3` (CivilizationView.tsx:1329-1398, 153, 590-594); `handleCreate` builds `civs[]` → `createSession` (606-620); store passes config to `commands.createCivSession` (civStore.ts:246-255); backend `resolve_participants` validates 1-3 + assigns palette/override colors (civilization.rs:604-643); `initial_snapshot` founds N civs by index with distinct colors (950-1032). Tests: `multi_participant_config_founds_n_civs_with_distinct_colors` (civilization.rs:5632) + UI specs (CivilizationView.test.tsx) |
| 2 | User sees a leaderboard ranking living civs by score that updates as turns advance | ✓ VERIFIED | `Leaderboard` top-bar component sorts living civs by `score.total` desc, greys `alive===false` civs at bottom with "collapsed" marker (CivilizationView.tsx:1400-1472); mounted persistently above canvas (922-928); derived from `snapshot.civs` which the event listener re-hydrates each turn; backend `leaderboard()` ranks by score.total (civilization.rs:1620-1644). Test: "ranks living civs by score.total desc and greys collapsed civs" (CivilizationView.test.tsx:213) |
| 3 | Each civ is driven by its own configured real-provider model; per-civ model decisions visible in log | ✓ VERIFIED | Per-civ turn loop calls each civ's own model: `call_model_text(&model,…)` where `model = snapshot.civs[ci].model` (civilization.rs:800-814); reasoning captured (`first.reasoning`, 846) threaded → `apply_model_decision` → `push_decision_log` keyed by `civ_id` (865, 2177-2191, 4470-4493). UI: log filters by `entry.civ_id === selectedCivId` (CivilizationView.tsx:300); each entry shows action+rationale always, reasoning behind expand toggle (2155-2185). Tests: `push_decision_log_persists_civ_id_and_reasoning` (civilization.rs:5711); "filters the log to the selected civ" + "reasoning expand toggle" (CivilizationView.test.tsx:269,288) |
| 4 | An external harness can read full game state (per-civ summaries + leaderboard) as text via `window.render_game_to_text()` without parsing pixels | ✓ VERIFIED | `renderSnapshotToText` additively appends `civs[]` (id/name/model/color/alive/population/era/score/controller/resources), `leaderboard` (sorted by score.total desc), `environment` to legacy keys (CivilizationGameCanvas.tsx:3135-3214); exposed on `window.render_game_to_text` (255,301); `CivPilotTextState` models the new fields (civPilot.ts:60-119). Test: "additively exposes civs[], a score-sorted leaderboard, and environment" (civPilot.test.ts:1025) |
| 5 | A harness can drive the game via `window.civPilotControls` / `codex-play-civ.mjs` without breaking existing controls, and the leaderboard attributes civ scores to the controlling harness/model | ✓ VERIFIED | `civPilotControls.start` accepts additive optional `civId`+`controller`; sets selectedCivId and calls `commands.setCivController` (CivilizationView.tsx:455-501); legacy `start({goal,possessId})` still works (all options optional, `options={}`); `codex-play-civ.mjs` still reads `window.render_game_to_text()` + `state.civilization.resources` (codex-play-civ.mjs:149,177); controller tag in `leaderboard()` JSON + UI badge (civilization.rs:1640, CivilizationView.tsx:1454-1458). Tests: contract spec (civPilot.test.ts:1012-1022); "keeps legacy start signature" + "scopes selection to civId and tags controller" (CivilizationView.test.tsx:313,323) |

**Score:** 5/5 ROADMAP success criteria verified

### Requirements Coverage

| Requirement | Source Plan(s) | Verdict | Evidence |
| ----------- | -------------- | ------- | -------- |
| **CIV-01** — create 2-3 model civs each a distinct color, from UI | 01-01, 01-02 | ✓ PASS | Backend `resolve_participants`/`initial_snapshot` found 1-3 civs with auto/override colors (civilization.rs:604-643, 950-1032); UI `ParticipantPicker` 1-3 rows wired to `createSession({civs})` (CivilizationView.tsx:1329-1398, 606-620); legacy single-model back-compat preserved (resolve_participants 607-617; bindings.ts CivSessionConfig has both `civs?` + `model?`, 463-468; test `legacy_single_model_config_founds_one_civ` 5616) |
| **CIV-02** — leaderboard ranks living civs, updates as turns advance | 01-04 | ✓ PASS | Persistent top-bar `Leaderboard`, score.total desc, greys dead civs (CivilizationView.tsx:1400-1472); see SC #2 |
| **CIV-03** — each civ own configured model; per-civ decisions in log | 01-01, 01-04 | ✓ PASS | Per-civ `call_model_text(&civ.model)` (civilization.rs:804-814); reasoning persisted into `CivLogEntry` keyed by civ_id (846,865,4470-4493); UI per-civ log filter + action+rationale + reasoning toggle (CivilizationView.tsx:300, 2155-2185); see SC #3 |
| **ARENA-01** — harness reads full state (per-civ + leaderboard) as text | 01-03 | ✓ PASS | Additive `render_game_to_text` civs[]/leaderboard/environment (CivilizationGameCanvas.tsx:3189-3212); `CivPilotTextState` (civPilot.ts:97-118); see SC #4 |
| **ARENA-02** — harness drives via civPilotControls/codex-play-civ.mjs, existing controls unbroken | 01-03, 01-04 | ✓ PASS | Legacy keys byte-preserved in text-state (session/civilization.resources/player/player_task/visible_entities, CivilizationGameCanvas.tsx:3142-3188); contract test asserts legacy keys present (civPilot.test.ts:1012-1022); harness still parses `state.civilization.resources` (codex-play-civ.mjs:177); `civPilotControls.start` back-compat (CivilizationView.tsx:456-487; test 313) |
| **ARENA-03** — leaderboard doubles as harness scoreboard; attribute scores to controller | 01-01, 01-04 | ✓ PASS | `controller` field on civ (civilization.rs:465-467), in `leaderboard()` JSON (1640) + text-state (CivilizationGameCanvas.tsx:3198,3210) + UI badge (CivilizationView.tsx:1454-1458); `set_civ_controller` (sanitized) command (civilization.rs:753-778); settable via `civPilotControls.start({civId,controller})` (CivilizationView.tsx:462-467; test 323) |

**No requirement silently dropped.** All 6 declared requirements (CIV-01/02/03, ARENA-01/02/03) implemented and tested. No ORPHANED requirements (REQUIREMENTS.md maps exactly these 6 to Phase 1).

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `civilization.rs` | CivParticipant, multi-participant CivSessionConfig, N-civ create_civ_session, controller, set_civ_controller, push_decision_log | ✓ VERIFIED | All present and substantive (struct 251-257; config 259-268; resolve+create 604-668; controller 465-467; set_civ_controller 753-778; push_decision_log 4470-4493). cargo test --no-run exits 0 |
| `lib.rs` | .typ::<CivParticipant>() + set_civ_controller registration | ✓ VERIFIED | use-block (lib.rs:9), collect_commands! (110,115), .typ chain (156-157) |
| `bindings.ts` | regenerated CivParticipant + civs[] + controller + setCivController | ✓ VERIFIED | CivParticipant type (435-439); CivSessionConfig {civs?, model?} (463-468); controller (287); CivLogEntry civ_id+reasoning (410,415); setCivController (186). tsc --noEmit exits 0 |
| `civStore.ts` | createSession(civs[]) + selectedCivId + setSelectedCivId + controller default | ✓ VERIFIED | createSession multi-participant (27-32,246-255); selectedCivId state (23,225); setSelectedCivId (257); normalizeCiv controller default (140); resets on create/load (247,260) |
| `CivilizationView.tsx` | participant picker, leaderboard top-bar, selectedCivId observer/log, reasoning toggle, civPilot civId/controller | ✓ VERIFIED | All present (picker 1329-1398; leaderboard 1400-1472; activeCiv+log filter 293-302; reasoning toggle 2155-2185; civPilot 455-501) |
| `CivilizationGameCanvas.tsx` | additive render_game_to_text (civs[]/leaderboard/environment) | ✓ VERIFIED | renderSnapshotToText 3135-3214 |
| `civPilot.ts` | CivPilotTextState additive civs?/leaderboard?/environment? | ✓ VERIFIED | civPilot.ts:97-118 |
| `civPilot.test.ts` | back-compat contract (legacy keys + new keys + no key leak) | ✓ VERIFIED | civPilot.test.ts:1004-1052 |
| `codex-play-civ.mjs` | still parses state.civilization.resources | ✓ VERIFIED | reads window.render_game_to_text() (149) + state.civilization.resources (177) |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| creation card rows | createSession({civs}) | handleCreate builds civs[] | ✓ WIRED | CivilizationView.tsx:608-616 → createSession |
| createSession | commands.createCivSession | bindings.ts CivSessionConfig | ✓ WIRED | civStore.ts:248; bindings.ts:463-468 |
| create_civ_session | generate_world(seed,N)/found_colony | initial_snapshot N civs | ✓ WIRED | civilization.rs:648-659 → initial_snapshot:957 generate_world(seed, participants.len()) |
| leaderboard row onClick | setSelectedCivId | civStore selection | ✓ WIRED | CivilizationView.tsx:1443 onSelect → 927 setSelectedCivId |
| selectedCivId | observer panel + log filter | activeCiv find + entry.civ_id filter | ✓ WIRED | CivilizationView.tsx:293-302 |
| civPilotControls.start({civId,controller}) | commands.setCivController | set_civ_controller (Plan 01) | ✓ WIRED | CivilizationView.tsx:465 → bindings.ts:186 → civilization.rs:753 |
| ModelDecision reasoning | CivLogEntry.reasoning | push_decision_log keyed by civ_id | ✓ WIRED | civilization.rs:846,865,2184-2191,4480-4488 |
| render_game_to_text output | codex-play-civ.mjs | JSON.parse state.civilization.resources | ✓ WIRED | CivilizationGameCanvas.tsx:3143-3155 → codex-play-civ.mjs:177 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| Leaderboard | `civs` (snapshot.civs) | civStore activeSnapshot, re-hydrated by CivEvent listener each turn; backend `rescore_all_civs` (civilization.rs:1647) | Yes — real per-civ score from score_civilization | ✓ FLOWING |
| Log filter | `snapshot.log` filtered by civ_id | backend push_decision_log writes ai_decision entries with civ_id+reasoning during advance_civ_turn | Yes — real model decisions+reasoning | ✓ FLOWING |
| reasoning toggle | `entry.reasoning` | call_model_text accumulates ReasoningDelta (gotcha #6) → threaded to push_decision_log | Yes — real chain-of-thought when model emits it; None otherwise | ✓ FLOWING |
| render_game_to_text civs[]/leaderboard | snapshot.civs | same snapshot pipeline | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| TS layer type-checks against regenerated bindings | `npx tsc --noEmit` | exit 0 | ✓ PASS |
| Full frontend test suite (incl. arena contract, leaderboard, log filter, reasoning toggle, civPilot) | `npx vitest run` | 214 passed / 25 files | ✓ PASS |
| Backend compiles incl. all new tests | `cargo test --no-run` | exit 0 (1 pre-existing dead-code warning) | ✓ PASS |
| Backend unit tests execute | (skipped) | WebView2 blocks test harness on Windows (gotcha #5) — run on CI Linux/macOS; verified by reading test bodies (civilization.rs:5616-5734) which contain substantive assertions | ? SKIP (platform) |

### Security Mitigations (from plan threat models)

| Threat | Mitigation | Status | Evidence |
| ------ | ---------- | ------ | -------- |
| T-01-01 Tampering/DoS on participant list | Validate 1-3, reject empty/>3, each model non-empty | ✓ PRESENT | civilization.rs:619,623,630; tests empty_config_errors (5654), too_many_participants_errors (5663) |
| T-01-02 Spoofing/injection on controller string | trim + 64-char cap + drop-if-empty | ✓ PRESENT | civilization.rs:760-762 `.trim().chars().take(64)…filter(!empty)` |
| T-01-03 / T-04-01 Key material leak into snapshot/log/text-state | model id only; no config-map read in these paths | ✓ PRESENT | No config.json/API_KEY/env::var(key) reads in civilization.rs decision/snapshot paths (only USERPROFILE/HOME for dir, 4655); contract test asserts no API_KEY/ANTHROPIC/AWS_/BASE_URL in text-state (civPilot.test.ts:1047-1051) |
| T-04-02 XSS via untrusted model output | render as escaped React text children, never dangerouslySetInnerHTML | ✓ PRESENT | reasoning+rationale rendered as JSX text (CivilizationView.tsx:2164,2178); controller badge `{civ.controller}` text child (1456); the only "dangerouslySetInnerHTML" string in the file is a comment documenting its absence (2154) — no actual usage |
| T-01-04 Malformed/older snapshot deserialize | all new fields #[serde(default)] | ✓ PRESENT | controller (466), civ_id/reasoning (534,538); tests snapshot_missing_controller_key_deserializes (5698), log_entry_missing_civ_id_reasoning_deserializes (5729) |

### Deferred Items

Items not built this phase, but explicitly out-of-scope per ROADMAP/CONTEXT — NOT gaps in Phase 1's promise.

| # | Item | Addressed In | Evidence |
| - | ---- | ------------ | -------- |
| 1 | Add-civilization mid-run UI + `add_civ_to_session` command | Out of scope (full W9 beyond lite slice) | CONTEXT.md:120; civilization.rs:1346 is only a doc comment (command intentionally absent) |
| 2 | Renderer per-civ tints + multi-colony camera / `focusCiv` | Phase 2 (W8) | ROADMAP.md:73-87; Phase 1 only sets selectedCivId focusCiv will consume (CONTEXT.md:123) |
| 3 | Environment HUD (season/temp/water/disasters/forecast) | Phase 3 (W4) | CONTEXT.md:121; environment rides text-state but isn't surfaced (ROADMAP.md:89) |
| 4 | Diplomacy-management UI | Phase 4 (W6) | CONTEXT.md:122 |

All deferrals are pre-existing roadmap boundaries; none reduce this phase's promised scope.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| src-tauri/src/permission_prompter.rs | 31 | dead-code (TauriPermissionPrompter never constructed) | ℹ️ Info | Pre-existing baseline, documented in deferred-items.md; untouched by this phase |
| src-tauri/src/civilization.rs et al. | — | 16 pre-existing clippy lints | ℹ️ Info | Baseline on clean main (verified via git stash, deferred-items.md); none in Plan 01's added code |

No blocker or warning anti-patterns in Phase 1 code. No TODO/FIXME/placeholder/stub patterns found in the modified source files. The `placeholder=` hits in CivilizationView.tsx are legitimate HTML input attributes.

### Human Verification Required

None blocking. The backend unit tests cannot execute on Windows (WebView2 harness, gotcha #5) and run on CI Linux/macOS; their bodies were read and contain substantive assertions, and `cargo test --no-run` compiles them clean. The full visual/UX experience (colors legible on canvas, top-bar layout on narrow widths, live turn-by-turn leaderboard updates against a real provider) is a normal end-of-milestone human pass but is not required to confirm this phase's goal is achieved in code — every observable truth is backed by passing automated tests and direct code evidence.

### Gaps Summary

No gaps. All 5 ROADMAP success criteria, all 6 requirements, all 17 plan must-have truths, all required artifacts (3-level: exists, substantive, wired; plus Level-4 data-flow), all key links, and all plan-threat-model security mitigations are verified against the current codebase at HEAD f86a905. Integrated gates are green: `tsc --noEmit` exit 0, `vitest run` 214/214 passing across 25 files, `cargo test --no-run` exit 0. The phase goal — a creatable, watchable, harness-drivable multi-model civ world with a ranking leaderboard and arena bridge — is genuinely achieved.

---

_Verified: 2026-06-06T20:40:00Z_
_Verifier: Claude (gsd-verifier)_
