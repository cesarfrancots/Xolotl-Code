---
phase: 04-chat-ui
plan: "02"
subsystem: state-management
tags: [typescript, zustand, vitest, tdd, diff, cost, stores]
dependency_graph:
  requires:
    - "04-01: bindings.ts (TokenUsage, SessionMeta, commands), diff npm package, zustand v5, vitest"
  provides:
    - computeLineDiff (diff.ts)
    - formatCost, formatTokens, calcTurnCost, formatCostBar, formatTurnFootnote (cost.ts)
    - useChatStore with streaming actions and alwaysAllowedTools (chatStore.ts)
    - useSessionStore with Tauri-backed session persistence (sessionStore.ts)
    - serializeSession canonical disk format helper (sessionStore.ts)
  affects:
    - All Wave 3+ components that consume chatStore, sessionStore, diff.ts, cost.ts
tech_stack:
  added: []
  patterns:
    - Zustand functional updates to avoid stale closures (appendStreamingContent uses set((state) => ...))
    - TDD RED/GREEN cycle for utility libs and store tests
    - vi.mock("../bindings") for sessionStore tests without Tauri runtime
    - Per-session alwaysAllowedTools Set (Pitfall 6 mitigation per RESEARCH.md)
key_files:
  created:
    - tauri-app/src/lib/diff.ts
    - tauri-app/src/lib/cost.ts
    - tauri-app/src/stores/chatStore.ts
    - tauri-app/src/stores/sessionStore.ts
    - tauri-app/src/stores/chatStore.test.ts
    - tauri-app/src/stores/sessionStore.test.ts
  modified:
    - tauri-app/src/lib/diff.test.ts (replaced placeholder with real tests)
    - tauri-app/src/lib/cost.test.ts (replaced placeholder with real tests)
decisions:
  - "clearSession uses set(() => ...) not set((state) => ...) since it doesn't read prior state — cleaner and avoids unused param"
  - "chatStore.ts uses _get (unused) to satisfy zustand create signature; TS strict mode required the rename"
  - "serializeSession placed in sessionStore.ts (not a separate file) — callers import it from same module as useSessionStore"
  - "MODEL_PRICING table uses 2026-05 Anthropic pricing; haiku-3-5 retained as cheapest tier"
metrics:
  duration: "~15 minutes"
  completed: "2026-05-10"
  tasks_completed: 3
  files_created: 6
  files_modified: 2
---

# Phase 4 Plan 02: State Management Summary

**One-liner:** Zustand chatStore (streaming + permission + alwaysAllow) and sessionStore (Tauri-backed persistence) with line-diff and cost-formatting utilities, all TDD-verified with 15 passing tests.

## Tasks Completed

| Task | Name | Commit | Key Output |
|------|------|--------|------------|
| 1 | Utility libs — diff.ts and cost.ts with unit tests | 580c905 | diff.ts, cost.ts, updated diff.test.ts, cost.test.ts (10 tests) |
| 2 | Zustand stores — chatStore and sessionStore | 0d8f307 | chatStore.ts, sessionStore.ts |
| 3 | Store unit tests — chatStore.test.ts and sessionStore.test.ts | e3b911a | chatStore.test.ts, sessionStore.test.ts (5 more tests) |

## Verification Results

1. `npm test` — 15 tests pass (4 test files: diff.test.ts, cost.test.ts, chatStore.test.ts, sessionStore.test.ts)
2. `npx tsc --noEmit` — exits 0, no errors
3. `grep "Set<string>" chatStore.ts` — confirms alwaysAllowedTools typed as Set
4. `grep "state\) =>"` — appendStreamingContent, finalizeStream, cancelStream all use functional updates

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript strict mode: unused `get` parameter in chatStore**
- **Found during:** Task 2 verification (`npx tsc --noEmit`)
- **Issue:** `create<ChatState>()((set, get) => ...)` — `get` is never read; TS6133 error with strict mode
- **Fix:** Renamed to `_get` to signal intentional non-use (standard TS convention)
- **Files modified:** `tauri-app/src/stores/chatStore.ts`
- **Commit:** Included in 0d8f307

## Known Stubs

None — all exports are fully implemented with correct logic.

## Threat Surface Scan

No new network endpoints or auth paths introduced. All Tauri command calls go through the existing `commands` object from bindings.ts. The `alwaysAllowedTools` Set is in-memory only (resets on page reload) — per T-4-02-02 in the plan's threat model, this is accepted scope for Phase 4; Rust-side persistence deferred to Phase 5.

## Self-Check: PASSED

- [x] tauri-app/src/lib/diff.ts — `export function computeLineDiff` present
- [x] tauri-app/src/lib/cost.ts — `export function formatCost`, `formatTokens`, `calcTurnCost`, `formatCostBar`, `formatTurnFootnote` present
- [x] tauri-app/src/stores/chatStore.ts — `export const useChatStore` present
- [x] tauri-app/src/stores/sessionStore.ts — `export const useSessionStore` present
- [x] 15 tests passing (npm test exits 0)
- [x] TypeScript compiles clean (npx tsc --noEmit exits 0)
- [x] Commits 580c905, 0d8f307, e3b911a exist in git log
