---
phase: 1
slug: w9-lite-multi-model-world-creation-leaderboard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-06
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

> Populated by the planner/executor once task IDs exist. Each task carries an `<automated>` verify command drawn from the infrastructure above. Back-compat tasks must add the specific regression checks below.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 1-01-xx | 01 | 1 | CIV-01 / CIV-02 / CIV-03 / ARENA-01/02/03 | unit / compile | per task (see plan `<acceptance_criteria>`) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Back-Compat Regression Checks (hard requirement — see CONTEXT.md `<specifics>`)

| Behavior | Requirement | Check |
|----------|-------------|-------|
| Legacy single-`model` `create_civ_session` still founds a world | D-03 / D-05 | serde deserializes old `{name, model, seed}` shape → one-element `civs`; backend unit test (CI) + manual found |
| Legacy v1 snapshot still normalizes to `civs[]` | D-13 | existing v1→v2 migration test stays green (civilization.rs migration suite) |
| `codex-play-civ.mjs` still parses text-state | ARENA-02 | `render_game_to_text()` keeps `player`/`civilization.resources`/`visible_entities` keys; additive `civs[]`/`leaderboard`/`environment` only |

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

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Back-compat regression checks defined and wired to tasks
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
