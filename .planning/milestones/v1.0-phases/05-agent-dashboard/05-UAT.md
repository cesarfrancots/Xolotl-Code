---
status: complete
phase: 05-agent-dashboard
source: [05-01-SUMMARY.md, 05-02-SUMMARY.md, 05-03-SUMMARY.md, 05-04-SUMMARY.md, 05-05-SUMMARY.md, 05-06-SUMMARY.md, 05-07-SUMMARY.md]
started: 2026-05-10T00:00:00Z
updated: 2026-05-10T12:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Agent Roster Panel Visible
expected: Launch the app. The right column (320px) is always visible with an "AGENTS" header and a "+" button. Initially it shows an empty-state message (no agents spawned yet). The main chat pane and session sidebar are also present — a 3-column layout.
result: pass

### 2. Spawn Agent Dialog Opens
expected: Clicking the "+" button in the AGENTS panel opens a dialog with: (a) a model selector dropdown, (b) a task textarea, (c) an optional budget number input, and (d) a Spawn button.
result: pass

### 3. Model Dropdown Populated from Backend
expected: The model dropdown in the Spawn Agent dialog is populated with models returned by the backend (e.g., claude-opus-4-5, claude-sonnet-4-5, claude-haiku-3-5). The first item in the list is selected by default. If loading fails, an error message appears in the dialog instead of silently showing only a default value.
result: issue
reported: "can't select any other model than opus 4.5 and it should support the same models as the CLI, kimi k2.6, minimax, etc"
severity: major

### 4. Spawn Agent — Card Appears in Roster
expected: Fill in a task (e.g., "test task"), select a model, leave budget empty, and click Spawn. The dialog closes and a new agent card appears in the AGENTS panel showing: a colored state badge, the task text (truncated if long), and $0.0000 cost. Note: after the code review fix (CR-01), the agent CLI binary is not yet configured — the agent will immediately transition to a "Failed" state with an error.
result: issue
reported: "the app crashed as soon as I tried to spawn the agent"
severity: blocker

### 5. Agent State Badge Colors
expected: Agent cards show colored badges matching the state: Idle=gray, Planning=blue, Executing=green with spinner, Waiting=amber, Done=emerald, Failed=red. Spawn an agent and observe it transition through states (at minimum you should see a Failed red badge after the CR-01 stub error).
result: issue
reported: "No agent card appears at all in the AGENTS panel when spawning fails — no red Failed badge visible"
severity: blocker

### 6. Expand Agent — Center Pane Swaps to AgentOutputView
expected: Click the expand button on an agent card. The center pane replaces the chat view with AgentOutputView, showing: the agent's task description at the top, the state badge, accumulated cost, a close button, and the agent's message list (including the error message from the CLI stub).
result: blocked
blocked_by: prior-phase
reason: "no agent card appears due to spawn failure (test 4/5 blockers)"

### 7. Close AgentOutputView Returns to ChatPane
expected: While viewing an agent's output (AgentOutputView), click the close/X button. The center pane returns to the normal chat view (ChatPane). The agent card remains in the AGENTS panel.
result: blocked
blocked_by: prior-phase
reason: "worktree error on spawn — branch 'agent/hi' already exists; no agent card appears"

### 8. OS Notification on Agent Failed
expected: After spawning an agent (which immediately fails due to CR-01 stub), an OS-level desktop notification fires with the agent's task name (truncated to 60 chars) and "Failed" state in the body. You may need to grant notification permission on first run.
result: issue
reported: "no OS notification pop up when agent fails"
severity: major

### 9. Budget Validation in Spawn Dialog
expected: In the Spawn Agent dialog, enter a negative number or zero in the budget field and click Spawn. The dialog should show a validation error and NOT spawn the agent. Enter a valid positive budget (e.g., 1.00) and confirm spawning proceeds (agent card appears).
result: pass

### 10. Per-Agent Model — Different Models Visible per Card
expected: Spawn two agents with different models selected. Each agent card shows its own task/cost — model is intentionally NOT shown on the card (privacy decision D-03). Verify you can select different models for each spawn in the dialog.
result: issue
reported: "can pick a different model in the dialog but the choice doesn't save for future sessions"
severity: major

## Summary

total: 10
passed: 3
issues: 5
pending: 0
skipped: 0
blocked: 2

## Gaps

- truth: "Model dropdown shows all models supported by the CLI (kimi k2.6, minimax, claude variants, etc.)"
  status: failed
  reason: "User reported: can't select any other model than opus 4.5 and it should support the same models as the CLI, kimi k2.6, minimax, etc"
  severity: major
  test: 3
  artifacts: []
  missing: []

- truth: "Clicking Spawn closes the dialog and adds an agent card to the AGENTS panel without crashing or erroring"
  status: failed
  reason: "First attempt crashed the app. Second attempt showed: worktree error: git worktree command failed: Preparing worktree (new branch 'agent/say-hi') fatal: a branch named 'agent/say-hi' already exists"
  severity: blocker
  test: 4
  artifacts: []
  missing: ["worktree branch uniqueness / stale branch cleanup before spawn"]

- truth: "Failed agent spawn results in a visible agent card with a red Failed badge in the AGENTS panel"
  status: failed
  reason: "No agent card appears at all in the AGENTS panel when spawning fails — no red Failed badge visible"
  severity: blocker
  test: 5
  artifacts: []
  missing: ["agent card must be persisted/shown even when CLI spawn errors immediately"]

- truth: "Sending a chat message with any model selected works without crashing"
  status: failed
  reason: "Typing 'Hi' in chat with kimi 2.6 selected as model crashed the app"
  severity: blocker
  test: out-of-band
  artifacts: []
  missing: ["chat handler crashes when non-claude model selected"]

- truth: "Selected model persists across app restarts"
  status: failed
  reason: "After restart, model reverts to claude-sonnet-4-5 regardless of prior selection"
  severity: major
  test: out-of-band
  artifacts: []
  missing: ["model selection not persisted to storage"]

- truth: "Default model matches the CLI default (kimi k2.6), not claude-sonnet-4-5"
  status: failed
  reason: "App defaults to claude-sonnet-4-5 instead of kimi k2.6 which is the active CLI default"
  severity: major
  test: out-of-band
  artifacts: []
  missing: ["default model should be set to kimi k2.6 to match CLI behavior"]

- truth: "OS desktop notification fires when an agent transitions to Failed state"
  status: failed
  reason: "No OS notification pop up when agent fails via worktree error"
  severity: major
  test: 8
  artifacts: []
  missing: ["notification not firing — likely never reaches the Failed state transition because error is thrown before agent is tracked"]

- truth: "Model selection persists across app restarts (last used model is remembered)"
  status: failed
  reason: "Can pick different models per spawn but choice doesn't save for future sessions"
  severity: major
  test: 10
  artifacts: []
  missing: ["model choice not written to persistent storage (e.g. Tauri store/localStorage)"]
