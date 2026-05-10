---
phase: 05-agent-dashboard
plan: 05
subsystem: ui
tags: [react, shadcn, zustand, agent-panel, vitest, testing-library]

requires:
  - phase: 05-03
    provides: [spawnAgent-binding, stopAgent-binding, listModels-binding, agentStore-IPC-contract]
provides:
  - AgentStateBadge component with all 6 AgentState color variants and Executing spinner
  - AgentCard component with badge, truncated task, cost display, expand/stop buttons
  - AgentPanel 320px right column with roster + spawn dialog trigger
  - SpawnAgentDialog with model Select, task textarea, budget input, spawnAgent invoke, addAgent on success
  - agentStore.ts Zustand store with AgentRecord type and 9 actions
  - useAgentPanelEvents.ts per-agent event hook with rAF buffer
affects: [05-06, 05-07]

tech-stack:
  added:
    - "@testing-library/react ^16.3.2 (component rendering tests)"
    - "@testing-library/user-event ^14.6.1 (click simulation)"
    - "@testing-library/jest-dom ^6.9.1 (DOM matchers)"
    - "shadcn select component (ui/select.tsx)"
  patterns:
    - "AgentCard mounts useAgentPanelEvents(agent.id) — subscription lifetime = card lifetime"
    - "AgentStore functional update: set((s) => ({ agents: s.agents.map(a => a.id === id ? {...a, ...} : a) }))"
    - "estimateTurnCost uses RATES table for client-side cost display (server is authoritative for enforcement)"
    - "vitest.config.ts requires @ alias for @/lib/utils resolution in UI component tests"

key-files:
  created:
    - tauri-app/src/components/agent/AgentStateBadge.tsx
    - tauri-app/src/components/agent/AgentCard.tsx
    - tauri-app/src/components/agent/AgentCard.test.tsx
    - tauri-app/src/components/agent/AgentPanel.tsx
    - tauri-app/src/components/agent/SpawnAgentDialog.tsx
    - tauri-app/src/components/ui/select.tsx
    - tauri-app/src/stores/agentStore.ts
    - tauri-app/src/hooks/useAgentPanelEvents.ts
  modified:
    - tauri-app/src/components/chat/MessageInput.tsx
    - tauri-app/package.json
    - tauri-app/package-lock.json
    - tauri-app/vitest.config.ts

key-decisions:
  - "agentStore.ts and useAgentPanelEvents.ts created here (05-05) not in 05-04 — both agents run in parallel from same base; 05-05 implements prerequisite files since 05-04 had not yet committed them"
  - "useAgentPanelEvents StateChanged guard uses undefined check: payload.StateChanged !== undefined (TypeScript discriminated union with optional never fields requires runtime check)"
  - "MessageInput.tsx spawnAgent('main') fixed to spawnAgent(msg, 'claude-sonnet-4-5', null) — carry-forward from 05-03 SUMMARY Known Issues"
  - "vitest.config.ts extended with @ alias (path.resolve __dirname ./src) to resolve @/lib/utils in shadcn components during test runs"

requirements-completed: [AGT-01, AGT-03, AGT-05]

duration: 12min
completed: "2026-05-10"
---

# Phase 5 Plan 05: Agent Dashboard UI Components Summary

**Four React components — AgentStateBadge, AgentCard (with 10 tests), AgentPanel (320px right column), SpawnAgentDialog (model/task/budget) — plus agentStore Zustand store and useAgentPanelEvents hook wiring the agent roster to the IPC event stream**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-10T16:00:00Z
- **Completed:** 2026-05-10T16:07:00Z
- **Tasks:** 2 (+ prerequisite files created)
- **Files modified:** 12

## Accomplishments

- AgentStateBadge renders all 6 AgentState variants with the documented color map (Idle=gray, Planning=blue, Executing=green+spinner, Waiting=amber, Done=emerald, Failed=red)
- AgentCard shows colored badge, truncated task (max 80 chars), $-formatted cost (toFixed(4)), expand + conditional stop buttons; model NOT shown (D-03/T-5-10)
- AgentPanel is a fixed 320px right column (w-80, border-l) with AGENTS header, scroll area listing AgentCards, empty state, and + button opening SpawnAgentDialog
- SpawnAgentDialog collects model (Select from listModels), task (textarea), optional budget (number input); validates budget client-side (T-5-01); calls spawnAgent(task, model, budgetDollars) and addAgent on success
- agentStore.ts: full Zustand store with AgentRecord type and 9 actions (addAgent, updateAgentState, appendAgentStreamingContent, finalizeAgentStream, startAgentToolCall, completeAgentToolCall, appendAgentError, setExpandedAgent)
- useAgentPanelEvents.ts: per-agent event subscription with rAF buffer for TextDelta, mirrors useAgentEvents.ts targeting agentStore instead of chatStore, fires OS notification on Done/Failed
- 10 unit tests pass; tsc --noEmit: zero errors across all new files

## Task Commits

1. **Task 1: AgentStateBadge + AgentCard + agentStore + useAgentPanelEvents** - `14f2357` (feat)
2. **Task 2: AgentPanel + SpawnAgentDialog + select.tsx + MessageInput fix** - `7cc8a65` (feat)

## Files Created/Modified

- `tauri-app/src/components/agent/AgentStateBadge.tsx` - Colored badge per AgentState variant; animate-spin for Executing
- `tauri-app/src/components/agent/AgentCard.tsx` - Per-agent card; mounts useAgentPanelEvents; badge, task, cost, expand/stop
- `tauri-app/src/components/agent/AgentCard.test.tsx` - 10 vitest tests covering badge, truncation, cost format, model absence, expand click, stop visibility
- `tauri-app/src/components/agent/AgentPanel.tsx` - 320px fixed right column; AGENTS header; agent roster; empty state
- `tauri-app/src/components/agent/SpawnAgentDialog.tsx` - Full spawn dialog with model/task/budget; T-5-01 client validation; addAgent on success
- `tauri-app/src/components/ui/select.tsx` - Installed via shadcn (required for SpawnAgentDialog model picker)
- `tauri-app/src/stores/agentStore.ts` - Zustand store with AgentRecord + 9 actions; estimateTurnCost for display
- `tauri-app/src/hooks/useAgentPanelEvents.ts` - Per-agent event hook; rAF TextDelta buffer; OS notification on terminal states
- `tauri-app/src/components/chat/MessageInput.tsx` - Fixed spawnAgent call from 1-arg to 3-arg signature
- `tauri-app/package.json`, `package-lock.json` - Added @testing-library/react + user-event + jest-dom
- `tauri-app/vitest.config.ts` - Added @ path alias for @/lib/utils resolution

## Decisions Made

- **agentStore and useAgentPanelEvents created in 05-05:** Both Wave 3 plans run in parallel from the same base commit. When 05-05 execution started, 05-04 had not yet committed these files. Created them here following the exact 05-04 spec so 05-05 components compile and test correctly.
- **StateChanged undefined guard:** TypeScript's discriminated union for AgentEvent marks `StateChanged` as `AgentState | undefined` (optional never on sibling variants). Added `payload.StateChanged !== undefined` guard before passing to `updateAgentState`.
- **MessageInput fix:** The `spawnAgent("main")` call was documented as a known TypeScript error in 05-03 SUMMARY (to be fixed in 05-05). Fixed to `spawnAgent(msg, "claude-sonnet-4-5", null)` — using the user's message as the task for chat-initiated agents.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] agentStore.ts and useAgentPanelEvents.ts created as prerequisites**
- **Found during:** Task 1 — AgentCard.tsx imports from both; neither existed
- **Issue:** Plan 05-04 (parallel Wave 3 agent) had not yet committed these files; 05-05 imports them
- **Fix:** Created both files following the exact 05-04 plan spec (interfaces, actions, rAF pattern)
- **Files modified:** tauri-app/src/stores/agentStore.ts, tauri-app/src/hooks/useAgentPanelEvents.ts
- **Verification:** AgentCard.test.tsx imports succeed; 10 tests pass
- **Committed in:** 14f2357

**2. [Rule 3 - Blocking] Installed @testing-library/react, user-event, jest-dom**
- **Found during:** Task 1 — AgentCard.test.tsx uses render/screen/userEvent
- **Issue:** Test infra packages not in package.json; plan specified their use but did not pre-install
- **Fix:** `npm install --save-dev @testing-library/react @testing-library/user-event @testing-library/jest-dom`
- **Files modified:** tauri-app/package.json, tauri-app/package-lock.json
- **Verification:** Tests compile and run
- **Committed in:** 14f2357

**3. [Rule 3 - Blocking] Added @ alias to vitest.config.ts**
- **Found during:** Task 1 — test run failed: `Failed to resolve import "@/lib/utils" from "src/components/ui/button.tsx"`
- **Issue:** vitest.config.ts lacked the @ alias that vite.config.ts has
- **Fix:** Added `resolve: { alias: { "@": path.resolve(__dirname, "./src") } }` to vitest.config.ts
- **Files modified:** tauri-app/vitest.config.ts
- **Verification:** Tests resolve button/badge imports and pass
- **Committed in:** 14f2357

**4. [Rule 1 - Bug] Fixed SpawnAgentDialog StateChanged undefined guard in useAgentPanelEvents**
- **Found during:** Task 2 — tsc reported type error on `payload.StateChanged` (AgentState | undefined)
- **Fix:** Changed `"StateChanged" in payload` to `"StateChanged" in payload && payload.StateChanged !== undefined`
- **Files modified:** tauri-app/src/hooks/useAgentPanelEvents.ts
- **Committed in:** 7cc8a65

**5. [Rule 1 - Bug] Fixed MessageInput.tsx spawnAgent call (carry-forward from 05-03)**
- **Found during:** Task 2 — tsc reported `Expected 3 arguments, but got 1` on `commands.spawnAgent("main")`
- **Issue:** 05-03 updated the spawnAgent signature but MessageInput.tsx wasn't updated (documented as carry-forward)
- **Fix:** `commands.spawnAgent("main")` → `commands.spawnAgent(msg, "claude-sonnet-4-5", null)`
- **Files modified:** tauri-app/src/components/chat/MessageInput.tsx
- **Committed in:** 7cc8a65

---

**Total deviations:** 5 auto-fixed (3 blocking infra, 2 type/bug fixes)
**Impact on plan:** All auto-fixes necessary for correctness. No scope creep. The agentStore/useAgentPanelEvents creation overlaps with 05-04 scope but is required for this plan to compile — the orchestrator merge will resolve any duplicates.

## Issues Encountered

- Parallel execution with 05-04: both plans operate on the same starting commit. When this agent started, 05-04's files (agentStore.ts, useAgentPanelEvents.ts) did not yet exist. Created them here to unblock. The merge step will see identical or compatible files from both worktrees.

## Known Stubs

None — all components wire to real store actions and real IPC commands. The `estimateTurnCost` RATES table is a simplified client-side approximation (documented in agentStore comments as acceptable per RESEARCH.md assumption A2; server-side accumulate_cost is authoritative for enforcement).

## Threat Surface Scan

No new trust boundaries introduced beyond what the plan's threat model documented. All STRIDE mitigations applied:

| Threat ID | Status |
|-----------|--------|
| T-5-01 | Mitigated — `Number.isFinite(parsed) && parsed > 0` in SpawnAgentDialog.handleSpawn |
| T-5-09 | Mitigated — task string passed to server via `commands.spawnAgent`; no shell interpolation in UI |
| T-5-10 | Mitigated — `grep -c "agent.model"` on AgentCard.tsx returns 0; model not rendered on card |

## Next Phase Readiness

- AgentPanel, AgentCard, AgentStateBadge, SpawnAgentDialog are ready for plan 05-06 (App.tsx 3-column wiring + AgentOutputView)
- agentStore provides `expandedAgentId` and per-agent messages for AgentOutputView to read
- useAgentPanelEvents provides the streaming update pipeline for agent output display

---
*Phase: 05-agent-dashboard*
*Completed: 2026-05-10*

## Self-Check

Checking that all claimed files exist and commits are present:

- [x] `tauri-app/src/components/agent/AgentStateBadge.tsx` - exists
- [x] `tauri-app/src/components/agent/AgentCard.tsx` - exists
- [x] `tauri-app/src/components/agent/AgentCard.test.tsx` - exists
- [x] `tauri-app/src/components/agent/AgentPanel.tsx` - exists
- [x] `tauri-app/src/components/agent/SpawnAgentDialog.tsx` - exists
- [x] `tauri-app/src/components/ui/select.tsx` - exists
- [x] `tauri-app/src/stores/agentStore.ts` - exists
- [x] `tauri-app/src/hooks/useAgentPanelEvents.ts` - exists
- [x] Commit `14f2357` - Task 1
- [x] Commit `7cc8a65` - Task 2

## Self-Check: PASSED
