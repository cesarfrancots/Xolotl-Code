---
phase: "06"
plan: "03"
subsystem: "frontend-components"
tags: [typescript, react, tailwind, zustand, phase6, agent-panel, launch-team-dialog]
dependency_graph:
  requires:
    - "06-02 — agentStore groups/AgentGroup/branch/groupId shape"
    - "06-01 — bindings.ts launchTeam/launchSwarm/RoleConfig/GroupLaunchResult"
  provides:
    - "AgentCard branch label chip — <code> monospace chip below task text when agent.branch non-empty"
    - "AgentCard pulsing badge — animate-ping blue dot beside AgentStateBadge when state Executing"
    - "AgentPanel group header rows — name + N/M Done + View Checkpoint button"
    - "AgentPanel Users button — opens LaunchTeamDialog (left of Plus button)"
    - "AgentPanel useGroupWatcher mount — group completion auto-triggers merge checkpoint"
    - "LaunchTeamDialog — Team mode (4 roles) + Swarm mode (count/objective/model)"
  affects:
    - "tauri-app/src/components/agent/AgentCard.tsx — branch label + pulsing badge"
    - "tauri-app/src/components/agent/AgentPanel.tsx — grouped rendering + Users button + useGroupWatcher"
    - "tauri-app/src/components/agent/LaunchTeamDialog.tsx — new component"
tech_stack:
  added: []
  patterns:
    - "Surgical insertion — pulsing dot and branch label added to existing AgentCard JSX without touching Stop/Expand buttons or cost display"
    - "Grouped rendering — flat agents.map() replaced with group header + envelope + ungrouped tail pattern"
    - "Dialog pattern replication — LaunchTeamDialog follows SpawnAgentDialog structure exactly (shadcn Dialog + footer)"
    - "Mode toggle as plain styled buttons — NOT shadcn ToggleGroup; matches 06-UI-SPEC pill container spec"
key_files:
  created:
    - tauri-app/src/components/agent/LaunchTeamDialog.tsx
  modified:
    - tauri-app/src/components/agent/AgentCard.tsx
    - tauri-app/src/components/agent/AgentPanel.tsx
decisions:
  - "hasAnyContent check uses agents.length > 0 || groups.length > 0 — empty state hidden when group headers alone exist"
  - "teamLaunchDisabled checks every role task non-empty; swarmLaunchDisabled checks only objective — mirrors UI-SPEC button disable rules"
  - "groupName auto-derived from first role task (team) or swarmObjective (swarm) with 40-char truncation — consistent with D-13 naming intent"
metrics:
  duration: "~20 minutes"
  completed_date: "2026-05-11"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 3
---

# Phase 06 Plan 03: Wave 3 UI Chrome — AgentCard + AgentPanel + LaunchTeamDialog

**One-liner:** AgentCard extended with branch label chip and pulsing Executing badge; AgentPanel rewritten with group header rows, Users button, and useGroupWatcher mount; new LaunchTeamDialog delivers Team (4 roles) and Swarm (count/objective/model) launch flows with exact UI-SPEC copy and IPC wiring.

## What Was Built

### Task 1: AgentCard — branch label chip + pulsing badge

Two surgical insertions to `AgentCard.tsx`:

**Pulsing dot** — inserted in the top `flex items-center justify-between gap-2` row, after `<AgentStateBadge>`, before the cost span:

```tsx
{agent.state === "Executing" && (
  <span className="relative flex h-2 w-2 ml-1">
    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
  </span>
)}
```

**Branch label** — inserted after the task `<p>` element, before the button row:

```tsx
{agent.branch && (
  <code className="text-xs font-mono text-[oklch(0.45_0_0)] mt-1 truncate block max-w-full">
    {agent.branch}
  </code>
)}
```

Only renders when `agent.branch` is non-empty (solo agents with `branch=""` show nothing).

### Task 2: AgentPanel — group headers + Users button + useGroupWatcher mount

**Header** — now wraps both buttons in `flex items-center gap-1`:
- `Users` (lucide-react) icon button with `title="Launch team or swarm"` + `aria-label` — opens LaunchTeamDialog
- `Plus` icon button (unchanged) — opens SpawnAgentDialog

**Group watcher** — `useGroupWatcher()` called unconditionally in component body.

**Grouped rendering** — flat `agents.map()` replaced with:
1. For each group: group header row + agent cards in border envelope (`mx-2 border-x border-b border-neutral-800 rounded-b-md`)
2. Ungrouped agents: flat list after all groups

Group header row shows: group name (truncated), `N/M Done` progress, and "View Checkpoint" button (only when `mergeState === "AllDone"` or `"CheckpointOpen"`).

Empty state guard updated to `agents.length === 0 && groups.length === 0`.

### New: LaunchTeamDialog

Full dialog with two-mode toggle (Team / Swarm) in pill container:

**Team mode**: 4 role rows (Planner, Coder, Reviewer, Tester) each with model Select + 2-row textarea. All 4 role tasks required for submit. Calls `commands.launchTeam(roles)`.

**Swarm mode**: agent count (1-8), shared objective (4-row textarea), model Select. Calls `commands.launchSwarm(count, objective, model)`.

Both modes: on success, call `agentStore.addGroup()` + `addAgent()` for each agent_id/branch in the response. On error, display inline error message.

Validation error strings match UI-SPEC exactly: "All role tasks are required.", "Agent count must be between 1 and 8.", "Objective is required."

## Deviations from Plan

None — plan executed exactly as written.

## Threat Surface Scan

| Flag | File | Description |
|------|------|-------------|
| T-06-07 mitigated | LaunchTeamDialog.tsx | Swarm count validated 1-8 client-side before launchSwarm IPC call |
| T-06-08 accepted | LaunchTeamDialog.tsx | Task text passed verbatim to launchTeam/launchSwarm — Rust slugify_task() handles branch-name safety |

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| AgentCard.tsx exists | FOUND |
| grep "animate-ping" AgentCard.tsx | FOUND |
| grep "agent.branch" AgentCard.tsx | FOUND |
| grep "oklch(0.45_0_0)" AgentCard.tsx | FOUND |
| AgentPanel.tsx useGroupWatcher | FOUND (2 matches: import + call) |
| AgentPanel.tsx LaunchTeamDialog | FOUND |
| AgentPanel.tsx Users | FOUND |
| AgentPanel.tsx "View Checkpoint" | FOUND |
| AgentPanel.tsx "border-b-0" | FOUND |
| LaunchTeamDialog.tsx exists | FOUND |
| grep "launchTeam" LaunchTeamDialog.tsx | FOUND (1) |
| grep "launchSwarm" LaunchTeamDialog.tsx | FOUND (1) |
| grep "Planner\|Coder\|Reviewer\|Tester" | FOUND (4) |
| grep "Launch Team\|Launch Swarm" | FOUND (2) |
| Validation messages (3) | FOUND (3) |
| npx tsc --noEmit (main repo) | 0 errors |
| Commit 16bcee1 (Task 1) | FOUND |
| Commit 4820934 (Task 2) | FOUND |
| No deletions in commits | CONFIRMED |
