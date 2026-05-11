# Phase 6: Parallel Worktrees + Team Orchestration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-11
**Phase:** 6-Parallel Worktrees + Team Orchestration
**Areas discussed:** Worktree panel, Team vs Swarm UX, File conflict protocol, Merge checkpoint depth

---

## Worktree Panel

| Option | Description | Selected |
|--------|-------------|----------|
| Extend AgentPanel | Add branch label + pulsing badge to existing agent cards. No new tab or panel. | ✓ |
| New 'Worktrees' tab in AgentPanel | AgentPanel gets two tabs: Agents and Worktrees. | |
| Worktree map in center pane | Dedicated center-pane view showing a visual worktree map. | |

**User's choice:** Extend AgentPanel

---

| Option | Description | Selected |
|--------|-------------|----------|
| Pulsing dot on the badge | animate-ping on the Executing status badge. | ✓ |
| File path chips | Show last 1-2 files touched as chips below task description. | |
| You decide | Visual polish is Claude's call. | |

**User's choice:** Pulsing dot on the badge

---

| Option | Description | Selected |
|--------|-------------|----------|
| Branch name only | Small branch label below task description. | ✓ |
| Branch name + worktree path chip | Branch name plus worktree directory path chip. | |
| You decide | Display format is Claude's call. | |

**User's choice:** Branch name only

---

## Team vs Swarm UX

| Option | Description | Selected |
|--------|-------------|----------|
| One dialog, two modes | Single Launch Team dialog with Team / Swarm toggle. | ✓ |
| Separate dialogs | Three separate entry points for single agent, team, and swarm. | |
| Team only for now | Implement WRK-02 only; swarm = simplified team. | |

**User's choice:** One dialog, two modes

---

| Option | Description | Selected |
|--------|-------------|----------|
| User configures upfront (static) | User fills in all 4 role rows (model + task) before launching. | ✓ |
| Orchestrator-driven (dynamic) | LLM orchestrator breaks down a shared objective and assigns tasks. | |
| Hybrid | User configures roles/models; orchestrator fills task descriptions. | |

**User's choice:** User configures upfront (static)

---

| Option | Description | Selected |
|--------|-------------|----------|
| No aggregation — just parallel worktrees | Swarm = N agents on parallel worktrees; merge checkpoint handles "aggregation". | ✓ |
| User picks the merge strategy | Keep best / cherry-pick / auto-merge choice after agents complete. | |
| Orchestrator synthesizes results | LLM reads all outputs and produces a final merged result. | |

**User's choice:** No aggregation — just parallel worktrees

---

## File Conflict Protocol

| Option | Description | Selected |
|--------|-------------|----------|
| At merge time only | Compare changed file paths across worktrees when checkpoint opens. Flag overlaps. | ✓ |
| Pre-flight at launch | Analyze task descriptions before spawning to predict file overlap. | |
| Runtime lock table in Rust | File-lock registry in supervisor; second agent blocked at write time. | |

**User's choice:** At merge time only

---

| Option | Description | Selected |
|--------|-------------|----------|
| Warning badge on conflicting files | Yellow badge on files touched by 2+ agents in the merge checkpoint list. | ✓ |
| Separate 'Conflicts' section | Checkpoint UI has Clean / Conflicts sections with side-by-side views. | |
| You decide | Conflict visualization is Claude's call. | |

**User's choice:** Warning badge on conflicting files

---

## Merge Checkpoint Depth

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-trigger when all agents complete | Checkpoint opens automatically when all group agents reach Done/Failed. | ✓ |
| Manual — user clicks 'Review & Merge' | Button appears when group completes; user decides when to open. | |
| Both — auto but dismissible | Auto-opens with a way to come back later. | |

**User's choice:** Auto-trigger when all agents complete

---

| Option | Description | Selected |
|--------|-------------|----------|
| Center pane replacement | Replaces ChatPane in center column — same pattern as AgentOutputView. | ✓ |
| Modal/sheet overlay | Full-screen modal opens over current view. | |
| Dedicated section below AgentPanel | Collapsible section in the right column. | |

**User's choice:** Center pane replacement (like AgentOutputView)

---

| Option | Description | Selected |
|--------|-------------|----------|
| File list with diffs per worktree | Accordion of changed files per worktree with expandable DiffView. | ✓ |
| Summary only (no inline diffs) | Just file path list with conflict badges. | |
| Unified diff across all worktrees | Combined multi-branch diff view. | |

**User's choice:** File list with diffs per worktree

---

| Option | Description | Selected |
|--------|-------------|----------|
| Git merge each branch into main | 'Approve' runs git merge via GitOpQueue for each worktree branch. | ✓ |
| Copy files + discard worktrees | File copy into working directory, no git merge command. | |
| Approve is acknowledgment only | Marks as reviewed; user runs git merge manually. | |

**User's choice:** Git merge each worktree branch into main

---

## Claude's Discretion

- Exact styling of the group header row in AgentPanel (color, typography)
- Pulsing badge animation ring size and speed
- "Launch Team" dialog layout within the two-mode toggle
- Merge checkpoint header design and merge progress state display

## Deferred Ideas

None — discussion stayed within phase scope.
