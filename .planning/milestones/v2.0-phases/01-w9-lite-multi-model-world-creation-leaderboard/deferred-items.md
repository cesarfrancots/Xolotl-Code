# Deferred Items — Phase 01

Out-of-scope discoveries logged during execution. Do NOT fix as part of the
current plan (SCOPE BOUNDARY rule).

## Pre-existing clippy failures (baseline, NOT introduced by Plan 01-01)

`cargo clippy --all-features -- -D warnings` in `tauri-app/src-tauri` reports
**16 errors on a clean `main` tree** (verified 2026-06-07 via `git stash` →
clippy → identical count before/after Plan 01-01 changes). These predate this
phase and are unrelated to the multi-civ IPC surface work.

Affected files (all untouched by Plan 01-01 except the one noted):
- `src/skills_mcp.rs` — `manual_strip`, `wildcard_in_or_patterns`, others
- `src/permission_prompter.rs:31` — clippy lint
- `src/commands.rs` — multiple (lines 992, 1091, 1411, 1456, 1483, 2045, 2147, 3839, 3993, 4104)
- `src/civilization.rs:703` — `list_civ_sessions` `sort_by` → `unnecessary_sort_by`
  (PRE-EXISTING code; this line was at :636 before Plan 01-01 and is not part of
  the plan's changes — it only shifted down due to added code above it.)

Plan 01-01's own added code (CivParticipant, resolve_participants,
set_civ_controller, push_decision_log, new tests) is clippy-clean — none of the
16 errors fall within the lines this plan added or modified.

**Recommendation:** a separate cleanup pass (or CI on Linux/macOS, which may use
a different clippy baseline) should address these. Not actioned here to respect
the surgical-changes / scope-boundary constraints.
