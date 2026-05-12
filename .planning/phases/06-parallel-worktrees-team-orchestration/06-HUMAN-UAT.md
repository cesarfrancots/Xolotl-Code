---
status: partial
phase: 06-parallel-worktrees-team-orchestration
source: [06-VERIFICATION.md]
started: 2026-05-11T00:00:00.000Z
updated: 2026-05-11T00:00:00.000Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Team Launch End-to-End
expected: Click Users button → LaunchTeamDialog opens → fill Planner/Coder/Reviewer/Tester tasks → Launch Team → group header appears in AgentPanel with correct name + N/M Done counter + branch label chips on each agent card + pulsing blue dot while agents are Executing

result: [pending]

### 2. Swarm Count Validation
expected: Swarm mode with count=9 shows "Agent count must be between 1 and 8." error and does not launch; count=2 with objective successfully spawns 2 agents with group header

result: [pending]

### 3. Merge Checkpoint Auto-Open
expected: After all agents in a group reach Done or Failed, MergeCheckpointView automatically appears in the center pane (useGroupWatcher fires); per-agent accordion sections show diffs; "No conflicts" or conflict count visible

result: [pending]

### 4. Approve & Merge Flow
expected: window.confirm dialog appears when clicking Approve & Merge; header shows "Merging…" during merge; then "Merged" in emerald; center pane auto-closes after 1.5s back to ChatPane

result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
