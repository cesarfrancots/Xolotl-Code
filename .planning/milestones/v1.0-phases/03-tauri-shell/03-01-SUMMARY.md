---
phase: 03-tauri-shell
plan: "01"
subsystem: infra
tags: [tauri, rust, msvc, cargo, specta, tauri-specta, react, typescript, vite]

# Dependency graph
requires:
  - phase: 02-orchestration-layer
    provides: "AgentSupervisor, WorktreeManager, SharedContextStore, GitOpQueue, 151 passing runtime tests"
provides:
  - "MSVC-only rust/.cargo/config.toml (GNU/WinLibs override removed)"
  - "tauri-app/ scaffold (Vite + React + TypeScript + npm, Tauri 2.x)"
  - "tauri-app/src-tauri/ Cargo workspace with runtime path dep and all Phase 3 deps"
  - "specta dep wired into runtime/Cargo.toml for Type derives in Plan 03-03"
  - "Build foundation for Plans 03-02 through 03-05"
affects: [03-02, 03-03, 03-04, 03-05]

# Tech tracking
tech-stack:
  added:
    - "tauri 2.11 (Rust crate + CLI)"
    - "tauri-build 2.6"
    - "tauri-specta =2.0.0-rc.25"
    - "specta =2.0.0-rc.25"
    - "specta-typescript 0.0.12"
    - "tauri-plugin-window-state 2"
    - "tauri-plugin-clipboard-manager 2"
    - "tauri-plugin-fs 2"
    - "React 19 + TypeScript + Vite (scaffold defaults)"
    - "stable-x86_64-pc-windows-msvc 1.95.0"
  patterns:
    - "Separate Cargo workspace: tauri-app/src-tauri/ is NOT a member of rust/"
    - "runtime path dep pattern: runtime = { path = '../../rust/crates/runtime' }"
    - "specta exact version pin with = to prevent rc upgrade surprises"
    - "tauri-app/dist/ created as minimal placeholder to satisfy generate_context!() at build time"

key-files:
  created:
    - "rust/.cargo/config.toml — MSVC-only build config ([build] target-dir only)"
    - "tauri-app/ — full Tauri 2.x scaffold (41 files)"
    - "tauri-app/src-tauri/Cargo.toml — xolotl crate with all Phase 3 deps"
    - "tauri-app/src-tauri/tauri.conf.json — app config (xolotl, 1200x800, devUrl 5173)"
    - "tauri-app/src-tauri/capabilities/default.json — core:default only"
    - "tauri-app/src-tauri/build.rs — tauri_build::build() boilerplate"
    - "tauri-app/src-tauri/src/lib.rs — minimal Tauri builder (ready for Plan 03-02)"
    - "tauri-app/src-tauri/src/main.rs — calls xolotl_lib::run()"
  modified:
    - "rust/crates/runtime/Cargo.toml — added specta = { version = '=2.0.0-rc.25' }"
    - "rust/Cargo.lock — updated after specta dep added"

key-decisions:
  - "rust/.cargo/config.toml is gitignored in root .gitignore but committed via git add --force as it is a plan artifact"
  - "tauri-app/dist/ (minimal index.html) created to satisfy tauri::generate_context!() macro which validates frontendDist path at build time"
  - "capabilities/default.json set to core:default only per plan spec; plugin capabilities deferred to Plan 03-05"
  - "lib.rs kept minimal (no specta/commands) per TAU-01 scope; full wiring done in Plans 03-02 through 03-05"
  - "compat-harness tests excluded from verification (pre-existing env-dependent failures unrelated to toolchain switch)"

patterns-established:
  - "dist placeholder pattern: create tauri-app/dist/index.html to unblock cargo build before frontend is built"
  - "specta pin pattern: use = prefix on version string for both Cargo workspaces"

requirements-completed: [TAU-01]

# Metrics
duration: 25min
completed: 2026-05-09
---

# Phase 3 Plan 01: Tauri Shell — Toolchain + Scaffold Summary

**Tauri 2.x app scaffolded at tauri-app/ with runtime path dep, all Phase 3 deps declared, and rust/ workspace verified green (151 tests) under stable-x86_64-pc-windows-msvc 1.95.0**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-09T03:18:00Z
- **Completed:** 2026-05-09T03:43:00Z
- **Tasks:** 2
- **Files modified:** 43 (1 modified in rust/, 41 new in tauri-app/, 1 new rust/.cargo/config.toml)

## Accomplishments

- Switched rust/ workspace from GNU override (WinLibs linker) to system default MSVC toolchain; updated stable-msvc to 1.95.0; 151 runtime tests pass green
- Scaffolded tauri-app/ via create-tauri-app@4.6.2 with react-ts template; replaced generated Cargo.toml with full xolotl crate + runtime path dep + all Phase 3 deps
- cargo build succeeds in tauri-app/src-tauri/ — build foundation ready for Plans 03-02 through 03-05

## Task Commits

Each task was committed atomically:

1. **Task 1: MSVC toolchain switch — remove GNU override from rust/.cargo/config.toml** - `16478d5` (chore)
2. **Task 2: Scaffold tauri-app/ and wire all Cargo dependencies** - `638985e` (feat)

**Plan metadata:** (to be committed)

## Files Created/Modified

- `rust/.cargo/config.toml` — MSVC-only build config; GNU linker blocks removed, [build] target-dir preserved
- `rust/crates/runtime/Cargo.toml` — added specta = "=2.0.0-rc.25" for Type derives in Plan 03-03
- `tauri-app/src-tauri/Cargo.toml` — xolotl crate; runtime path dep; specta/tauri-specta pinned; plugins declared
- `tauri-app/src-tauri/tauri.conf.json` — productName xolotl, 1200x800, devUrl 5173, bundle.active=false
- `tauri-app/src-tauri/capabilities/default.json` — core:default only (plugin grants deferred to Plan 03-05)
- `tauri-app/src-tauri/src/lib.rs` — minimal Tauri builder, no-op for now (expanded in Plan 03-02)
- `tauri-app/src-tauri/src/main.rs` — calls xolotl_lib::run() (updated from scaffold's tauri_app_lib)
- `tauri-app/src-tauri/build.rs` — tauri_build::build() boilerplate (scaffold-generated, correct)
- `tauri-app/` (37 other scaffold files) — React/TS frontend, icons, package.json, vite config

## Decisions Made

- `rust/.cargo/config.toml` is gitignored by the root `.gitignore` (`rust/.cargo/` pattern). Added via `git add --force` since the plan designates it as a committed artifact for reproducibility.
- Created `tauri-app/dist/index.html` (minimal placeholder) to satisfy `tauri::generate_context!()` which validates `frontendDist` path at compile time. This placeholder is gitignored (dist/ in tauri-app/.gitignore) — the real dist is generated by Vite at build/dev time.
- lib.rs kept intentionally minimal — the full tauri-specta Builder, managed state, and commands are wired in Plans 03-02 through 03-05. Scope boundary respected.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created tauri-app/dist/index.html placeholder**
- **Found during:** Task 2 (cargo build in tauri-app/src-tauri/)
- **Issue:** `tauri::generate_context!()` macro fails if `frontendDist` path does not exist at compile time. The plan did not mention this — frontend dist is only created after `npm run build`.
- **Fix:** Created `tauri-app/dist/index.html` with minimal HTML. This unblocks `cargo build` without running the Vite build.
- **Files modified:** `tauri-app/dist/index.html` (gitignored — not committed)
- **Verification:** `cargo build` in tauri-app/src-tauri/ exits 0
- **Committed in:** Part of 638985e (not committed as dist/ is gitignored; applied to local filesystem only)

**2. [Rule 3 - Blocking] Updated main.rs to call xolotl_lib::run()**
- **Found during:** Task 2 (after renaming the lib crate to xolotl_lib)
- **Issue:** Scaffold-generated main.rs called `tauri_app_lib::run()` but the new Cargo.toml sets `lib.name = "xolotl_lib"`.
- **Fix:** Updated main.rs to `xolotl_lib::run()`.
- **Files modified:** `tauri-app/src-tauri/src/main.rs`
- **Verification:** cargo build succeeds
- **Committed in:** 638985e

---

**Total deviations:** 2 auto-fixed (2 Rule 3 blocking fixes)
**Impact on plan:** Both fixes were directly caused by this task's changes (scaffold name override, frontendDist validation). No scope creep.

## Issues Encountered

- compat-harness test suite has 3 pre-existing failures (`extracts_non_empty_manifests_from_upstream_repo`, `detects_known_upstream_command_symbols`, `detects_known_upstream_tool_symbols`) — these look for fixture files not present in this environment. They were failing before the toolchain switch and are unrelated to D-01. The 151 runtime tests (the tracked metric) all pass. compat-harness excluded via `--exclude compat-harness` in verification.

## User Setup Required

None — no external service configuration required. Tauri desktop development requires `npm install` in `tauri-app/` before running `npm run tauri dev`, but this is standard dev setup, not a service configuration.

## Next Phase Readiness

- Build foundation complete: rust/ MSVC + tauri-app/ scaffold + deps all verified
- Plan 03-02 (TAU-01 smoke test: minimal Tauri window + invoke) can proceed immediately
- Plan 03-03 (specta Type derives on AgentId/AgentState/AgentEvent) can proceed — specta dep is wired in runtime/Cargo.toml
- Plans 03-04 (TauriPermissionPrompter) and 03-05 (plugins) follow sequentially
- No blockers. All Phase 3 deps declared and compiling.

---
*Phase: 03-tauri-shell*
*Completed: 2026-05-09*
