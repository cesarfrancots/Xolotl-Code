# Phase 5: Agent Dashboard - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-10
**Phase:** 5-Agent Dashboard
**Areas discussed:** Dashboard layout, Spawn dialog design, Agent output expansion, OS notifications

---

## Dashboard Layout

| Option | Description | Selected |
|--------|-------------|----------|
| 3rd column (right) | sidebar \| chat \| agent-panel. Always visible roster on the right. No view switching. | ✓ |
| Tabbed navigation | Top-level tabs: 'Chat' + 'Agents'. Agents hidden when chatting. | |
| Bottom panel | Chat takes ~70% height; collapsible agent panel at bottom à la VS Code terminal. | |

**User's choice:** 3rd column (right)
**Notes:** None provided.

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed ~320px | Like the session sidebar — clean, no resize handle. | ✓ |
| Resizable drag handle | User can resize. Adds implementation complexity. | |
| You decide | Claude picks the width. | |

**User's choice:** Fixed ~320px

| Option | Description | Selected |
|--------|-------------|----------|
| Status badge + task + cost + expand button | Matches AGT-01 exactly. | ✓ |
| Above + model name | Also show which model is running (useful for AGT-05). | |
| Above + progress indicator | Animated spinner or progress bar while Executing. | |

**User's choice:** Status badge + task + cost + expand button

---

## Spawn Dialog Design

| Option | Description | Selected |
|--------|-------------|----------|
| Model + task + budget | Worktree auto-assigned. Budget optional. Tight dialog. | ✓ |
| Model + task + budget + worktree branch | User explicitly names the branch. More control, more friction. | |
| Just model + task | Budget set after spawning. Worktree always auto-assigned. | |

**User's choice:** Model + task + budget (worktree auto-assigned from task name)
**Notes:** None provided.

| Option | Description | Selected |
|--------|-------------|----------|
| Dropdown from list_models | Reuses existing list_models command from Phase 4. Consistent. | ✓ |
| Free-text input | User types model name/ID directly. | |
| You decide | Claude picks based on simplicity and Phase 4 consistency. | |

**User's choice:** Dropdown from list_models

| Option | Description | Selected |
|--------|-------------|----------|
| Rust backend | Extend spawn_agent with optional budget param. Runtime halts agent. Same as CLI --budget. | ✓ |
| Frontend tracking | Accumulate TurnCompleted usage in store; call stop_agent when exceeded. | |

**User's choice:** Rust backend

---

## Agent Output Expansion

| Option | Description | Selected |
|--------|-------------|----------|
| Replaces main chat pane | Clicking expand swaps ChatPane for agent's conversation view. Reuses all existing components. | ✓ |
| In-place accordion in roster | Card expands vertically within 320px panel. Tight for tool blocks. | |
| Right-side panel becomes stream | Roster on top (compact cards), selected agent stream below. | |

**User's choice:** Replaces main chat pane
**Notes:** None provided.

| Option | Description | Selected |
|--------|-------------|----------|
| Read-only | No input field in agent view. Observation only. | ✓ |
| Interactive — user can send messages | Input allows injecting messages into the agent's conversation. | |

**User's choice:** Read-only

| Option | Description | Selected |
|--------|-------------|----------|
| The regular chat session | Center defaults to human chat session when no agent expanded. | ✓ |
| Empty state / dashboard overview | Summary card: active agents, total cost, orchestration tips. | |

**User's choice:** Regular chat session

---

## OS Notifications

| Option | Description | Selected |
|--------|-------------|----------|
| Tauri notification plugin (OS-native) | @tauri-apps/plugin-notification. Real OS toast even when window minimized. | ✓ |
| In-app toast only | shadcn Sonner/Toast. Only visible when app is focused. No new plugin. | |
| Both | In-app always + OS when window not focused. | |

**User's choice:** Tauri notification plugin (OS-native)

| Option | Description | Selected |
|--------|-------------|----------|
| Title: task description. Body: Done/Failed + cost | E.g., "Refactor auth module" / "Done — $0.0042" | ✓ |
| Generic: 'Agent finished' | Minimal — user checks dashboard. | |
| You decide | Claude picks the content. | |

**User's choice:** Title: task description. Body: Done/Failed + cost summary

| Option | Description | Selected |
|--------|-------------|----------|
| Always on Done or Failed | Simple rule, no focus-detection logic. | ✓ |
| Only when window is minimized/unfocused | Requires Tauri window-state detection. | |
| User toggle per agent | Checkbox in spawn dialog. | |

**User's choice:** Always on Done or Failed

---

## Claude's Discretion

- Exact status badge colors per `AgentState` variant
- Animation/spinner for Executing state in agent card
- Truncation threshold for task description in card
- Agent panel header design (title, "New Agent" button placement)
- Transition animation when switching between chat view and agent view

## Deferred Ideas

None — discussion stayed within phase scope.
