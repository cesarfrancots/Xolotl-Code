---
phase: 04-chat-ui
plan: "01"
subsystem: bootstrap
tags: [rust, tauri, typescript, tailwind, shadcn, vitest, ipc]
dependency_graph:
  requires: []
  provides:
    - TextDelta AgentEvent variant (Rust + TypeScript)
    - run_agent_turn Tauri command (echo stub)
    - list_models, list_sessions, load_session, delete_session, save_session commands
    - SessionMeta type (Rust + TypeScript)
    - Tailwind v4 CSS entry point with @theme tokens
    - shadcn UI components (button, command, card, badge, scroll-area, etc.)
    - vitest test infrastructure (2 placeholder tests passing)
  affects:
    - tauri-app frontend build chain (all wave 2+ plans depend on this)
    - Rust backend IPC surface (6 new commands registered)
tech_stack:
  added:
    - tailwindcss v4 + @tailwindcss/vite plugin
    - "@tailwindcss/typography"
    - zustand v5
    - react-markdown v10
    - rehype-highlight + highlight.js
    - "@tanstack/react-virtual v3"
    - diff v9
    - cmdk v1
    - lucide-react
    - vitest v4 + @vitest/ui + jsdom
    - shadcn (Radix+Nova preset)
    - jsdom (vitest environment)
  patterns:
    - Tailwind v4 CSS-first config via @theme directive (no tailwind.config.js)
    - shadcn components in tauri-app/src/components/ui/ (do not edit)
    - @ path alias (tsconfig.json + vite.config.ts) for shadcn compatibility
    - AgentEvent discriminated union with TextDelta: never exclusions on all variants
key_files:
  created:
    - tauri-app/src/styles.css (Tailwind v4 entry + dark @theme tokens)
    - tauri-app/vitest.config.ts (jsdom environment, src/**/*.test.ts)
    - tauri-app/src/lib/cost.test.ts (placeholder)
    - tauri-app/src/lib/diff.test.ts (placeholder)
    - tauri-app/src/lib/utils.ts (shadcn cn utility)
    - tauri-app/src/components/ui/ (13 shadcn components)
    - tauri-app/components.json (shadcn config)
  modified:
    - rust/crates/runtime/src/supervisor/agent_state.rs (TextDelta variant)
    - tauri-app/src-tauri/src/commands.rs (6 new commands + CR-02 fix)
    - tauri-app/src-tauri/src/lib.rs (collect_commands! + SessionMeta type)
    - tauri-app/src-tauri/src/permission_prompter.rs (CR-01 fix)
    - tauri-app/src-tauri/capabilities/default.json (CR-04 path scope)
    - tauri-app/src/bindings.ts (TextDelta, SessionMeta, 6 new command sigs)
    - tauri-app/vite.config.ts (tailwindcss() plugin + @ alias)
    - tauri-app/tsconfig.json (baseUrl + paths for @ alias)
    - tauri-app/package.json (all new deps + test script)
decisions:
  - "Tailwind v4 CSS-first config: no tailwind.config.js needed; @import + @theme in styles.css"
  - "jsdom installed separately (not bundled with vitest v4)"
  - "shadcn Nova preset chosen (Radix + Lucide + Geist — matches UI-SPEC icon requirement)"
  - "dist/ folder created as stub for cargo build macro; gitignored"
  - "CR-01 applied: removed .unwrap() on mutex in permission_prompter.rs (let-else pattern)"
  - "CR-02 applied: HashMap::remove() instead of .get() in respond_to_permission"
metrics:
  duration: "~35 minutes"
  completed: "2026-05-10"
  tasks_completed: 3
  files_created: 20
  files_modified: 9
---

# Phase 4 Plan 01: Bootstrap Summary

**One-liner:** Rust+TypeScript IPC extended with TextDelta streaming variant and 6 session/agent commands; React app bootstrapped with Tailwind v4, shadcn Radix components, and working vitest.

## Tasks Completed

| Task | Name | Commit | Key Output |
|------|------|--------|-----------|
| 1 | Rust — TextDelta, 6 commands, CR fixes | 70c2258 | agent_state.rs, commands.rs, lib.rs, permission_prompter.rs, capabilities/default.json |
| 2 | bindings.ts — TextDelta union + 6 new command signatures | 8736ac2 | bindings.ts |
| 3 | Frontend bootstrap — npm, shadcn, Tailwind v4, vitest | d1e2c6e | package.json, styles.css, vitest.config.ts, src/components/ui/ |

## Verification Results

1. `cargo build` — exits 0 (warnings only: dead_code on set_state, TauriPermissionPrompter)
2. `npx tsc --noEmit` — exits 0, no errors
3. `npm test` — 2 tests pass (cost.test.ts, diff.test.ts)
4. `grep "TextDelta" agent_state.rs` — `TextDelta(String),` confirmed
5. `grep "TextDelta: string" bindings.ts` — discriminated union member confirmed
6. `grep "run_agent_turn" bindings.ts` — command signature confirmed
7. `button.tsx` in `src/components/ui/` — shadcn components confirmed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CR-01 was NOT already applied**
- **Found during:** Task 1 (plan said "verify; skip if already correct")
- **Issue:** permission_prompter.rs used `.unwrap()` on mutex lock in two places; plan must_haves listed CR-01 as required truth
- **Fix:** Replaced first `.unwrap()` with `let Ok(mut pending) = ... else { return Deny }` pattern; second with `if let Ok(mut pending) = ...`
- **Files modified:** `tauri-app/src-tauri/src/permission_prompter.rs`
- **Commit:** 70c2258

**2. [Rule 3 - Blocking] `tauri-app/dist/` directory needed for cargo build**
- **Found during:** Task 1 verification
- **Issue:** `tauri::generate_context!()` macro panics if `../dist` doesn't exist; frontend not yet built
- **Fix:** Created `tauri-app/dist/index.html` stub; directory is already gitignored
- **Files modified:** `tauri-app/dist/index.html` (not committed — gitignored)
- **Impact:** cargo build now passes; dist/ will be replaced by actual frontend build

**3. [Rule 3 - Blocking] shadcn init required @ path alias before running**
- **Found during:** Task 3 (shadcn init)
- **Issue:** shadcn init rejected without tsconfig.json paths and vite alias configured first
- **Fix:** Added `baseUrl` + `paths: { "@/*": ["./src/*"] }` to tsconfig.json; added `path` alias in vite.config.ts before running shadcn
- **Files modified:** tsconfig.json, vite.config.ts
- **Commit:** d1e2c6e

**4. [Rule 3 - Blocking] jsdom not bundled with vitest v4**
- **Found during:** Task 3 (npm test)
- **Issue:** vitest v4 no longer bundles jsdom; must install separately
- **Fix:** `npm install -D jsdom`
- **Files modified:** package.json, package-lock.json
- **Commit:** d1e2c6e

**5. [Note] shadcn init added extra styles.css content**
- **Found during:** Task 3 (shadcn init)
- **Issue:** shadcn updated styles.css with Nova preset theme tokens (CSS variables, dark mode, @import tw-animate-css, @import @fontsource-variable/geist)
- **Fix:** Kept shadcn additions; our @theme tokens from the plan were preserved
- **Impact:** styles.css now has both our custom dark tokens AND shadcn Nova theme tokens. This is correct — shadcn variables are used by shadcn components; our @theme tokens are used by custom UI

## Known Stubs

| Stub | File | Description |
|------|------|-------------|
| `run_agent_turn` echo | commands.rs | Returns echo instead of real ConversationRuntime::run_turn() — D-03 authorized Phase 4 behavior |
| `list_models` hardcoded | commands.rs | Returns 3 hardcoded model names instead of reading RuntimeConfig |

Both stubs are intentional per plan. Plan 07 smoke test expects to see "Echo (stub):" in chat. Full wiring in follow-on iteration.

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns beyond the plan's threat model. All session file operations implement path traversal prevention (id char validation). No flags.

## Self-Check: PASSED

- [x] rust/crates/runtime/src/supervisor/agent_state.rs — TextDelta variant present
- [x] tauri-app/src-tauri/src/commands.rs — run_agent_turn, list_models, list_sessions, load_session, delete_session, save_session present
- [x] tauri-app/src-tauri/src/lib.rs — all 6 commands in collect_commands! + SessionMeta type
- [x] tauri-app/src/bindings.ts — TextDelta union member + SessionMeta + 6 command signatures
- [x] tauri-app/src/styles.css — @import "tailwindcss" + @theme present
- [x] tauri-app/vitest.config.ts — vitest config present
- [x] tauri-app/src/components/ui/button.tsx — shadcn components present
- [x] Commits 70c2258, 8736ac2, d1e2c6e exist in git log
