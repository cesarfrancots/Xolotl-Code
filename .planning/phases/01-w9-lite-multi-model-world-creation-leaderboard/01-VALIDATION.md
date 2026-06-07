---
phase: 1
slug: w9-lite-multi-model-world-creation-leaderboard
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-06
audited: 2026-06-06
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Platform note (CLAUDE.md gotcha #5): the Tauri backend `cargo test` cannot run on Windows (WebView2 DLL loader blocks the harness). On Windows, backend validation is `cargo check` + `cargo clippy` + `cargo test --no-run` (compile-only); real backend test execution happens on Linux/macOS CI (`tauri-app.yml`). Frontend tests (vitest) run fine locally.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Frontend framework** | vitest (run mode) |
| **Backend framework** | `cargo test` (CI Linux/macOS only) — Windows = compile-only |
| **Config file** | `tauri-app/vitest` config + `tauri-app/src-tauri/Cargo.toml` |
| **Quick run command (frontend)** | `npx tsc --noEmit` then `npm test` (in `tauri-app/`) |
| **Quick run command (backend, Windows)** | `cargo check && cargo clippy --all-features -- -D warnings && cargo test --no-run` (in `tauri-app/src-tauri/`) |
| **Full suite command** | Frontend: `npm test`; Backend: `cargo test` (CI) |
| **Bindings regen check** | `cargo run --bin export_bindings` (headless, Windows-safe — avoids `tauri dev`/WebView2) then `npx tsc --noEmit` |
| **Estimated runtime** | frontend ~20s; backend compile ~60–120s |

---

## Sampling Rate

- **After every task commit:** Run the quick command for the surface touched (frontend → `npx tsc --noEmit`; backend → `cargo check` + `cargo clippy`).
- **After every plan wave:** Run frontend `npm test` and backend `cargo test --no-run` (Windows) / `cargo test` (CI).
- **After any change to `create_civ_session` / `CivParticipant` / `.typ::<…>()`:** Run `cargo run --bin export_bindings` and `npx tsc --noEmit` to catch bindings drift (gotcha #1).
- **Before `/gsd-verify-work`:** All quick + wave commands green; back-compat checks (below) pass.
- **Max feedback latency:** ~120 seconds (backend compile-bound).

---

## Per-Task Verification Map

> Populated by the Nyquist audit (2026-06-06) against HEAD f86a905. Each row maps a requirement-bearing task to the concrete EXISTING test(s) that validate its observable behavior, plus the command that runs them. Frontend commands were executed locally (green); backend rows are compile-verified on Windows (`cargo test --no-run` exit 0) and execute on CI (Linux/macOS) per platform constraint (gotcha #5).
>
> Test-file legend: `CV.tsx` = `tauri-app/src/components/civilization/CivilizationView.test.tsx`; `cP.ts` = `tauri-app/src/lib/civPilot.test.ts`; `cS.ts` = `tauri-app/src/stores/civStore.test.ts`; `civ.rs` = `tauri-app/src-tauri/src/civilization.rs` (tests module).

| Task ID | Plan | Wave | Requirement | Backing Test(s) | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|--------|
| 01-01 T1 | 01 | 1 | CIV-01 (N-civ founding, distinct colors, 1-3 bounds) | `civ.rs` `legacy_single_model_config_founds_one_civ` (5616), `multi_participant_config_founds_n_civs_with_distinct_colors` (5633), `empty_config_errors` (5654), `too_many_participants_errors` (5663) | unit (compile-verified Win / run CI) | `cd tauri-app/src-tauri && cargo test --no-run` | ✅ green |
| 01-01 T2 | 01 | 1 | ARENA-03 (controller tag + leaderboard key) | `civ.rs` `fresh_civ_has_no_controller` (5680), `leaderboard_includes_controller_key` (5686), `snapshot_missing_controller_key_deserializes` (5698) | unit (compile-verified Win / run CI) | `cd tauri-app/src-tauri && cargo test --no-run` | ✅ green |
| 01-01 T3 | 01 | 1 | CIV-03 (persist per-civ reasoning in log) | `civ.rs` `push_decision_log_persists_civ_id_and_reasoning` (5711), `log_entry_missing_civ_id_reasoning_deserializes` (5729) | unit (compile-verified Win / run CI) | `cd tauri-app/src-tauri && cargo test --no-run` | ✅ green |
| 01-02 T1 | 02 | 2 | CIV-01 (multi-participant createSession + selectedCivId) | `cS.ts` "forwards a multi-participant civs[] config" (255), "setSelectedCivId updates" (274), "resets selectedCivId on createSession/loadSession" (281,294), "normalizeCiv defaults controller to null"/"preserves explicit tag" (304,309) | unit (store) | `cd tauri-app && npx tsc --noEmit && npm test -- civStore` | ✅ green |
| 01-02 T2 | 02 | 2 | CIV-01 (1-3 participant creation card → createSession) | `CV.tsx` "renders a single row by default" (68), "adds rows up to 3" (75), "removes down to 1" (88), "row exposes name/model/color" (102), "founds N-civ via createSession" (111), "founds single-participant (legacy back-compat)" (132) | integration (RTL) | `cd tauri-app && npx tsc --noEmit && npm test -- CivilizationView` | ✅ green |
| 01-03 T1 | 03 | 2 | ARENA-01 (additive civs[]/leaderboard/environment in text-state) | `cP.ts` "additively exposes civs[], a score-sorted leaderboard, and environment" (1025), "never leaks provider config / key material" (1047) | integration (render contract) | `cd tauri-app && npx tsc --noEmit && npm test -- civPilot` | ✅ green |
| 01-03 T2 | 03 | 2 | ARENA-02 (legacy text-state keys preserved; harness parses) | `cP.ts` "preserves the legacy single-civ keys the codex harness parses" (1011); harness back-compat: `codex-play-civ.mjs:177` reads `state.civilization.resources` (unchanged) | integration (render contract) | `cd tauri-app && npm test -- civPilot` | ✅ green |
| 01-04 T1 | 04 | 3 | CIV-02 / CIV-03 (leaderboard top-bar, per-civ observer/log, reasoning toggle) | `CV.tsx` "ranks living civs by score.total desc + greys collapsed" (213), "controller badge only when tagged" (232), "row click selects civ" (243), "observer score panel from selection" (257), "filters log to selected civ" (269), "reasoning expand toggle" (288); turn-advance hydration: `cS.ts` "hydrates snapshots and tracks turn-start state from events" (320) | integration (RTL) | `cd tauri-app && npx tsc --noEmit && npm test -- CivilizationView` | ✅ green |
| 01-04 T2 | 04 | 3 | ARENA-02 / ARENA-03 (civPilot civId/controller additive) | `CV.tsx` "keeps the legacy start({goal, possessId}) signature working" (313), "scopes selection to civId and tags controller via set_civ_controller" (323) | integration (RTL) | `cd tauri-app && npm test -- CivilizationView` | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Audit run results (2026-06-06, HEAD f86a905):** `npx tsc --noEmit` exit 0; the 3 Phase-01 frontend files = 49/49 passing; full `npx vitest run` = 214/214 across 25 files; `cargo test --no-run` exit 0 (1 pre-existing dead-code warning — baseline, deferred-items.md). All test bodies inspected and contain substantive behavioral assertions (no stubs).

---

## Back-Compat Regression Checks (hard requirement — see CONTEXT.md `<specifics>`)

| Behavior | Requirement | Check | Wired Test (Status) |
|----------|-------------|-------|---------------------|
| Legacy single-`model` `create_civ_session` still founds a world | D-03 / D-05 | serde deserializes old `{name, model, seed}` shape → one-element `civs` | `civ.rs::legacy_single_model_config_founds_one_civ` (5616) — asserts `{name,model,seed}` deserializes, `resolve_participants` → 1 participant, `initial_snapshot` founds exactly 1 civ with palette-head color. Frontend mirror: `CV.tsx` "founds a single-participant world (legacy single-model back-compat)" (132). ✅ green (compile-verified Win / run CI; frontend run locally) |
| Legacy v1 snapshot still normalizes to `civs[]` | D-13 | existing v1→v2 migration test stays green (compiles) | `civ.rs::legacy_v1_snapshot_migrates_to_multi_civ` (5561) — rewrites a snapshot into legacy v1 shape (top-level `model` + single `civilization`, no `civs`/`version`/`environment`, entities stripped of `civ_id`) and asserts migration → `version==SCHEMA_VERSION`, 1 civ, entities re-tagged. Frontend boundary mirror: `cS.ts` "migrates legacy single-civilization snapshots" (94). ✅ green (compile-verified Win / run CI; frontend run locally) |
| `codex-play-civ.mjs` still parses text-state | ARENA-02 | `render_game_to_text()` keeps `player`/`civilization.resources`/`player_task`/`visible_entities` keys; additive `civs[]`/`leaderboard`/`environment` only | `cP.ts` "preserves the legacy single-civ keys the codex harness parses" (1011) — parses real `renderSnapshotToText` output, asserts `civilization.resources` (object, exact values), `player`, `player_task`, `visible_entities` present; companion test (1025) asserts the new keys are additive. Harness itself unchanged: `codex-play-civ.mjs:177` still reads `state.civilization.resources`. ✅ green (run locally) |

---

## Wave 0 Requirements

- Existing infrastructure (vitest + cargo) covers phase requirements — no new framework install.
- Wave 0 work, if any, is bindings/IPC-shape scaffolding (`CivParticipant` + `export_bindings` regen) so downstream frontend tasks type-check.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Multi-model creation flow → found → leaderboard updates as turns advance | CIV-01, CIV-02 | Requires live providers + WebView2 UI; backend cargo test can't run on Windows | Run app, create 2–3 civ world with distinct models/colors, found, advance turns, confirm leaderboard ranks living civs by score.total |
| Per-civ decision log shows action + rationale, reasoning collapsed/expandable | CIV-03 / D-11 / D-12 | Requires live reasoning-model (Kimi/DeepSeek) stream | Drive turns with a reasoning model; confirm rationale shows and reasoning expands |
| Harness drives one civ by id; controller tag on leaderboard + text-state | ARENA-02, ARENA-03 | Requires running harness against live UI | Run `scripts/codex-play-civ.mjs` against one `civ_id`; confirm other civs stay model-driven and that civ's row carries the controller tag |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — every requirement-bearing task in the map above carries a concrete backing test + command; all 9 task rows ✅ green.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — every task row has at least one automated test.
- [x] Back-compat regression checks defined and wired to tasks — all 3 checks wired to named, passing tests (table above): `legacy_single_model_config_founds_one_civ`, `legacy_v1_snapshot_migrates_to_multi_civ`, and the `cP.ts` legacy-keys contract spec; harness script reads `state.civilization.resources` unchanged.
- [x] No watch-mode flags — all commands use `vitest run` / `npm test` (run mode) / `cargo test --no-run`; no `--watch`.
- [x] Feedback latency < 120s — frontend ~13s full suite; backend compile ~15s incremental (within the 120s backend-compile bound).
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** SIGNED OFF — Nyquist audit 2026-06-06 (HEAD f86a905). All 6 requirements (CIV-01/02/03, ARENA-01/02/03) and all 3 back-compat regression checks map to concrete, substantive, passing automated tests; integrated gates green (tsc 0, vitest 214/214, cargo test --no-run 0). No genuine automatable coverage gaps found; no redundant tests added.

### Audit Notes (caveats, non-blocking)

- **Backend execution surface (platform):** All 11 backend `civilization.rs` tests are compile-verified on Windows (`cargo test --no-run` exit 0) and execute on CI (Linux/macOS) per gotcha #5 — they cannot run on this Windows host (WebView2 harness). Their bodies were read and contain real assertions. This is a documented platform constraint, not a coverage gap.
- **Controller-string sanitization (T-01-02, trim + 64-char cap + drop-if-empty):** verified by code inspection only (civilization.rs:760-762). The logic is inlined inside the `set_civ_controller` `#[tauri::command]` (requires `AppHandle` + disk I/O), so it is not unit-testable on the available surface without refactoring the implementation (out of scope — implementation is read-only) or a Tauri runtime. End-to-end coverage is the live-harness flow already listed in **Manual-Only Verifications** (harness-drives-one-civ row). No hollow copy-the-closure test was added. This is a security-mitigation caveat, not an uncovered phase requirement.
