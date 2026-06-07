---
phase: 3
slug: w4-environment-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-07
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> BACKEND (Rust) phase. Tauri backend tests cannot EXECUTE on Windows (WebView2,
> gotcha #5) — verify via cargo check + clippy + `cargo test --no-run` (compile-only);
> the new `#[test]` unit tests RUN on CI (Linux/macOS) via tauri-app.yml.
> Determinism is the load-bearing automated property.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust libtest `#[test]` in `civilization.rs` `#[cfg(test)] mod tests` (~4918) |
| **Config file** | none (cargo built-in); crate `tauri-app/src-tauri` (lib `xolotl_lib`) |
| **Quick run (Windows, compile-only)** | `cargo test --no-run` (from `tauri-app/src-tauri`) |
| **Quick check (Windows)** | `cargo check` + `cargo clippy --all-features -- -D warnings` (ZERO new warnings vs the documented 16-error baseline) |
| **Full suite (CI Linux/macOS)** | `cargo test` — executes the new env unit tests |
| **Type gate** | `npx tsc --noEmit` only if any `.ts` touched (expected: none — no IPC change) |
| **Estimated runtime** | compile ~60–120s; CI test exec seconds |

---

## Sampling Rate

- **After every task commit:** `cargo check` + `cargo clippy --all-features -- -D warnings` (zero NEW warnings) + `cargo test --no-run`.
- **After every plan wave:** same; CI runs full `cargo test`.
- **Before `/gsd-verify-work`:** clippy clean for new lines; `cargo test --no-run` exits 0; bindings.ts unchanged (no IPC change) — or regenerated+committed if a registered type changed.
- **Max feedback latency:** ~120 seconds (backend compile-bound).

---

## Per-Task Verification Map

> Populated by the planner once task IDs exist. Determinism + invariants are the
> automatable load-bearing properties; terrain-reshape aesthetics/balance are manual CI observation.

| Req ID | Behavior | Test Type | Automated Command (CI) | Status |
|--------|----------|-----------|------------------------|--------|
| ENV-01 | `advance_season` advances+wraps deterministically; temp drifts toward season target; same (seed,turn) ⇒ identical | unit (pure) | `cargo test advance_season` | ⬜ pending |
| ENV-01 | season change logged + rides snapshot.environment | integration | `cargo test tick_environment` | ⬜ pending |
| ENV-02 | `roll_forecast` rolls + announces K turns ahead, then fires into disasters[] deterministically | unit + integration | `cargo test forecast` | ⬜ pending |
| ENV-02 | fired disaster reshapes world.tiles boundedly AND preserves invariants (tile count constant, x/y in bounds, no air below surface) | unit (pure) | `cargo test apply_disaster` | ⬜ pending |
| ENV-02 | every forecast/fire/expiry is logged | integration | `cargo test disaster_logged` | ⬜ pending |
| ENV-03 | renewable resources regrow toward cap, scaled by season (≈0 in winter) | unit (pure) | `cargo test regrow` | ⬜ pending |
| ENV-03 | finite minerals NEVER regrow (sustained scarcity; reuse `is_finite_mineral`) | unit (pure) | `cargo test finite_resources_never_regrow` | ⬜ pending |
| ENV-01/02/03 | full env tick byte-deterministic for (seed,turn) | integration (run twice, serde-compare) | `cargo test tick_environment_deterministic` | ⬜ pending |
| cross-cutting | back-compat: old save without env fields still loads (serde defaults) | unit | existing parse/migration pattern; extend if a field is touched | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Extend `#[cfg(test)] mod tests` in `civilization.rs` with the env tests above — **no new file**; reuse the existing module + `test_snapshot(...)` / `generate_world(seed, civ_count)` helpers (~4918-5028).
- [ ] No new framework install (libtest built in).
- [ ] No new fixtures (test_snapshot + generate_world already produce a full world to disaster/regrow against).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Disaster terrain reshape "looks right" + disaster/season balance feels fair | ENV-02/01 | Aesthetic/balance judgment; not a hard invariant | On CI/dev, advance many turns on a seeded world; observe seasons cycling, forecasts announced then firing, terrain visibly changing, world staying livable |
| Sustained scarcity emerges over a long run | ENV-03 | Emergent multi-turn property | Advance a long run; confirm finite minerals stay depleted while renewables recover |

---

## Validation Sign-Off

- [ ] All automatable tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (the new env tests in the existing module)
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter (after execution + audit)

**Approval:** pending
