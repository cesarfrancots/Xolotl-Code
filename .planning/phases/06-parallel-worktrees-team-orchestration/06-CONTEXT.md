# Phase 6: Parallel Worktrees + Team Orchestration - Context

**Gathered:** 2026-05-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Enable multiple agents to run concurrently on isolated git worktrees, launched via role-based team or swarm configuration, with file-conflict detection at merge time and a user-controlled merge checkpoint for reviewing and approving per-worktree changes. Builds on the AgentPanel from Phase 5 and the WorktreeManager + GitOpQueue from Phase 2. Does NOT include: LLM-driven orchestrator task assignment, remote execution, or interactive conflict resolution editors.

</domain>

<decisions>
## Implementation Decisions

### Worktree Panel (WRK-01)
- **D-01:** Extend the existing AgentPanel (320px right column) — no new tab, no new panel. Phase 6 adds branch/worktree data to the existing agent cards inline.
- **D-02:** Each agent card gains a small branch name label (e.g., `agent/refactor-auth-module`) below the task description. One-liner only.
- **D-03:** Activity indicator for the Executing state: a pulsing dot on the existing status badge via Tailwind `animate-ping`. No file-path chips or additional card rows.

### Team vs Swarm Launch (WRK-02, WRK-03)
- **D-04:** One unified "Launch Team" dialog with a toggle between two modes: **Team** (role-based, user configures each role) and **Swarm** (N identical agents with a shared objective).
- **D-05:** Team mode is **static configuration**: the dialog shows 4 role rows (Planner, Coder, Reviewer, Tester), each with a model dropdown and task description text field. The user fills in every role before launching. No LLM orchestrator call at launch.
- **D-06:** Swarm mode "result aggregation" = **no LLM synthesis**. N agents run in parallel on separate worktrees. The merge checkpoint (WRK-05, D-10) is the aggregation mechanism — user reviews per-worktree outputs and approves the merge. Swarm dialog collects: agent count (N), shared objective text (seeded into each agent's task), model selector (same model for all).

### File Conflict Protocol (WRK-04)
- **D-07:** Conflict detection happens **at merge time only** — no pre-flight analysis, no runtime file-lock table in the Rust supervisor. When the merge checkpoint opens, the UI compares each worktree's changed file paths against the others and flags overlapping paths.
- **D-08:** Conflict visualization: files touched by 2+ worktrees get a **yellow warning badge** in the merge checkpoint file list. No separate "Conflicts" section — the badge is enough context for the user to decide.

### Merge Checkpoint (WRK-05)
- **D-09:** The merge checkpoint is **auto-triggered** when all agents in the same team/swarm group reach Done or Failed state. No user action needed to open it.
- **D-10:** The checkpoint appears as a **center pane replacement** — same pattern as `AgentOutputView` replacing `ChatPane` in Phase 5. User closes it to return to chat.
- **D-11:** Per-worktree content: accordion list of changed files for each worktree branch. Each file is expandable to show a before/after diff, reusing the existing `DiffView` component from Phase 4. Conflicting files (D-08) show the yellow warning badge inline.
- **D-12:** "Approve & Merge" button runs `git merge <branch>` for each worktree branch into main, dispatched through the existing `GitOpQueue` (one-at-a-time, serialized to prevent index.lock conflicts). After all merges complete, worktrees are pruned.

### Agent Grouping (new concept for team/swarm)
- **D-13:** Teams and swarms must introduce a **group concept** in the data model. A group has an ID, a list of agent IDs, a mode (team/swarm), and a `merge_state` (Pending → AllDone → CheckpointOpen → Merged). The `agentStore` needs a `groups` map alongside its existing `agents` map.
- **D-14:** The AgentPanel shows a **group header row** above the agent cards belonging to the same team/swarm. Header shows: group name (auto-derived from shared objective or first role task), overall status summary, and "View Checkpoint" button once merge is ready.

### Claude's Discretion
- Exact styling of the group header row in AgentPanel (color, typography, expand/collapse).
- Pulsing badge animation details (ring size, speed).
- "Launch Team" dialog layout and spacing within the two-mode toggle.
- Merge checkpoint header design (which branch merged first, merge progress state).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §Parallel Worktrees + Team Orchestration — WRK-01 through WRK-05 (full requirement descriptions)
- `.planning/ROADMAP.md` §Phase 6 — Goal, success criteria, dependencies (depends on Phase 5 + Phase 2)

### Existing IPC & Event Types
- `tauri-app/src/bindings.ts` — TypeScript types for `AgentEvent`, `AgentState`, all Tauri commands. Must read before adding new IPC. New commands (`launch_team`, `launch_swarm`, `get_worktree_diff`, `merge_worktree`) need entries here (partial hand-update required per established pattern).
- `tauri-app/src-tauri/src/commands.rs` — Existing command implementations; new team/swarm/merge commands added here.
- `tauri-app/src-tauri/src/lib.rs` — Plugin registration and event relay; any new event types registered here.
- `tauri-app/src-tauri/capabilities/default.json` — Capability grants; no new plugins expected for Phase 6.

### Phase 5 Components (extend, don't replace)
- `tauri-app/src/components/agent/AgentPanel.tsx` — The 320px right column; gains group header rows and branch labels on agent cards.
- `tauri-app/src/components/agent/AgentCard.tsx` — Individual agent card; gains branch name label (D-02) and pulsing badge (D-03).
- `tauri-app/src/components/agent/AgentOutputView.tsx` — Pattern for center pane replacement; `MergeCheckpointView` follows this same pattern (D-10).
- `tauri-app/src/components/agent/SpawnAgentDialog.tsx` — Reference pattern for the new `LaunchTeamDialog` (D-04).
- `tauri-app/src/stores/agentStore.ts` — Needs `groups` map added alongside `agents` (D-13); existing store structure must be understood before extending.

### Phase 4 Components (reuse unchanged)
- `tauri-app/src/components/chat/DiffView.tsx` — Before/after diff renderer; reuse directly in merge checkpoint file accordion (D-11).
- `tauri-app/src/hooks/useAgentEvents.ts` — Per-agent event subscription; reuse for listening to agent state changes in the group tracker.

### Rust Backend (Phase 2 — must read before adding Rust)
- `rust/crates/runtime/src/supervisor/worktree.rs` — `WorktreeManager`: add/remove/list/prune; `merge_branch_into_main()` needs to be added here.
- `rust/crates/runtime/src/supervisor/git_queue.rs` — `GitOpQueue`: all git operations (including merges) must go through this queue.
- `rust/crates/runtime/src/supervisor/supervisor.rs` — `AgentSupervisor::spawn_agent_with_config()`; new `launch_team()` / `launch_swarm()` methods or a group-aware spawn variant added here.
- `rust/crates/runtime/src/supervisor/agent_state.rs` — `AgentState` + `AgentEvent` enum; check before adding new event variants.

### Prior Phase Context
- `.planning/phases/05-agent-dashboard/05-CONTEXT.md` — Phase 5 decisions (3-column layout, AgentPanel patterns, IPC patterns). Phase 6 must be fully consistent.
- `.planning/phases/04-chat-ui/04-CONTEXT.md` — Phase 4 decisions (rendering stack, DiffView, dark-only).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `tauri-app/src/components/chat/DiffView.tsx` — Already renders before/after file diffs; plug directly into the merge checkpoint file accordion for per-file review (D-11).
- `tauri-app/src/components/agent/AgentOutputView.tsx` — Center pane replacement pattern; `MergeCheckpointView` should follow the exact same mount/unmount cycle.
- `tauri-app/src/components/agent/SpawnAgentDialog.tsx` — Dialog structure (shadcn Dialog + form fields) is the blueprint for `LaunchTeamDialog`.
- `rust/crates/runtime/src/supervisor/git_queue.rs` — `GitOpQueue` already serializes git writes; extend it to accept merge operations (D-12).
- `rust/crates/runtime/src/supervisor/worktree.rs` — `WorktreeManager::remove()` already deletes the worktree + branch; a new `merge_into_main()` method follows the same `git` CLI pattern.

### Established Patterns
- **3-column layout (Phase 5):** SessionSidebar (256px) | CenterPane (flex-1, swaps between ChatPane / AgentOutputView / MergeCheckpointView) | AgentPanel (320px). Phase 6 adds `MergeCheckpointView` as a third center-pane variant — nothing changes in the column structure.
- **Dark-only (Phase 4 D-07):** All new components inherit the dark palette. No light mode consideration.
- **Event relay (Phase 3):** Rust emits event → broadcast → Tauri emit → `listen()` on frontend. New `group_state_changed` events follow this relay unchanged.
- **bindings.ts partial hand-update:** WebView2 DLL issue prevents regeneration; all new Tauri command signatures must be manually added to `bindings.ts`.
- **MSVC toolchain (Phase 3):** All new Rust dependencies must be MSVC-compatible (no GNU-only crates).
- **Zustand store pattern:** `create()` with typed `State + Actions`; extend `agentStore` rather than creating a separate store for groups.

### Integration Points
- `tauri-app/src/App.tsx` — CenterPane logic gains a third condition: if `mergeCheckpointGroupId` is set → show `MergeCheckpointView`; else if `expandedAgentId` is set → show `AgentOutputView`; else → show `ChatPane`.
- `tauri-app/src/stores/agentStore.ts` — Add `groups: AgentGroup[]`, `mergeCheckpointGroupId: string | null`, and group-level actions: `addGroup`, `updateGroupState`, `openMergeCheckpoint`.
- `tauri-app/src-tauri/src/commands.rs` — New IPC commands: `launch_team(roles: Vec<RoleConfig>)`, `launch_swarm(count: u32, objective: String, model: String)`, `get_worktree_diff(agent_id: String)`, `merge_worktrees(group_id: String)`.

</code_context>

<specifics>
## Specific Ideas

- Branch name in agent card should display as a monospace chip or `<code>` tag to visually distinguish it from the task description text.
- Pulsing badge: use `relative` + `animate-ping` on a secondary element positioned over the badge — standard Tailwind hero-icon pattern.
- Group header in AgentPanel: show something like `Team · 3/4 Done` with a compact progress indicator, not a full progress bar.
- Launch Team dialog toggle: shadcn `ToggleGroup` or `Tabs` component with "Team" / "Swarm" options — keeps it inside one dialog without separate dialogs.
- Merge checkpoint "Approve & Merge" should be disabled (and show a tooltip) when any agent in the group is still running.

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope.

</deferred>

---

*Phase: 6-Parallel Worktrees + Team Orchestration*
*Context gathered: 2026-05-11*
