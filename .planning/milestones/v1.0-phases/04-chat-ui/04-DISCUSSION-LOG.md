# Phase 4: Chat UI - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-10
**Phase:** 4-Chat UI
**Areas discussed:** Streaming wire-up, UI shell & layout, Rendering stack, Slash command scope

---

## Streaming Wire-up

### Q1: How should token deltas reach the frontend?

| Option | Description | Selected |
|--------|-------------|----------|
| New AgentEvent::TextDelta variant | Add TextDelta(String) to AgentEvent; existing broadcast + Tauri relay picks it up automatically | ✓ |
| Separate streaming Tauri command | Dedicated invoke() channel; duplicates Phase 3 relay infrastructure | |
| You decide | Leave transport choice to researcher/planner | |

**User's choice:** New AgentEvent::TextDelta variant
**Notes:** Consistent with how permission prompts already flow through the same channel.

---

### Q2: How should the frontend buffer incoming token deltas?

| Option | Description | Selected |
|--------|-------------|----------|
| requestAnimationFrame batching | Accumulate deltas in a ref, flush to state on each rAF tick (~60fps) | ✓ |
| Fixed interval batching (16ms setInterval) | Similar effect; rAF is more correct (pauses when tab hidden) | |
| You decide | Let the planner pick the buffering strategy | |

**User's choice:** requestAnimationFrame batching
**Notes:** Already called out explicitly in UI-01.

---

### Q3: When the user sends a message, which Tauri command starts the agent turn?

| Option | Description | Selected |
|--------|-------------|----------|
| Extend the existing spawn_agent command | Reuse Phase 3 lifecycle command; keeps command surface small | ✓ |
| New run_turn Tauri command | Dedicated command for single-turn chat; more explicit but duplicates infrastructure | |
| You decide | Leave command design to the planner | |

**User's choice:** Extend spawn_agent
**Notes:** Keeps the Tauri command surface minimal.

---

## UI Shell & Layout

### Q1: Main app layout?

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed 2-column: sidebar + chat pane | Session list always visible left; chat right. Standard coding-assistant layout. | ✓ |
| Collapsible sidebar + chat pane | Sidebar collapses to icon strip; more screen space but more complexity | |
| Single pane, sessions in a modal | Chat full-width, session management in dialog; minimal but less discoverable | |

**User's choice:** Fixed 2-column

---

### Q2: Where does the model selector live?

| Option | Description | Selected |
|--------|-------------|----------|
| Top bar of the chat pane, per-session | Dropdown in chat header; changing applies to current session | ✓ |
| In the chat input area (inline) | Next to send button; compact but cluttered | |
| Settings panel / drawer | Gear icon; less discoverable | |

**User's choice:** Top bar of the chat pane, per-session

---

### Q3: Where does token count and dollar cost display?

| Option | Description | Selected |
|--------|-------------|----------|
| Below each message + running total in top bar | Per-turn footnote under assistant message + session total in header | ✓ |
| Running total only in top bar | Simpler — one number in header only | |
| Status bar at bottom of window | Thin footer always visible, VS Code-style | |

**User's choice:** Below each message + running total in top bar

---

### Q4: Color scheme?

| Option | Description | Selected |
|--------|-------------|----------|
| Dark-only | Single dark theme; no toggle; matches developer expectations | ✓ |
| Dark default + light toggle | Respects system preference + manual override; more CSS work | |
| You decide | Let the planner pick a sensible default | |

**User's choice:** Dark-only

---

## Rendering Stack

### Q1: Markdown + syntax-highlighted code blocks library?

| Option | Description | Selected |
|--------|-------------|----------|
| react-markdown + rehype-highlight | Standard combo; highlight.js backend; Tailwind/shadcn compatible | ✓ |
| react-markdown + shiki (rehype-shiki) | Best-in-class highlighting quality; heavier bundle | |
| marked.js + highlight.js | Lower-level; more control, more wiring for React | |

**User's choice:** react-markdown + rehype-highlight

---

### Q2: File edit diff display format?

| Option | Description | Selected |
|--------|-------------|----------|
| Unified diff with +/- line coloring | Single-column; green/red backgrounds; familiar from git output | ✓ |
| Side-by-side (before \| after columns) | Two columns; cramped inside a collapsible tool block | |
| Minimal: highlight changed lines in 'after' view | Simplest but loses 'before' context | |

**User's choice:** Unified diff with +/- line coloring

---

### Q3: Frontend diff computation library?

| Option | Description | Selected |
|--------|-------------|----------|
| diff (npm package) | Canonical JS diff library; zero-deps; returns structured change objects; render with Tailwind | ✓ |
| react-diff-viewer-continued | Handles diff + rendering; opinionated styling conflicts with Tailwind | |
| You decide | Leave library choice to planner | |

**User's choice:** `diff` npm package

---

## Slash Command Scope

### Q1: Which slash commands ship in Phase 4? (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| /clear — reset current session | Clears chat thread; keeps session in sidebar | ✓ |
| /model — switch model inline | Alternative to top-bar model selector | ✓ |
| /save and /load — session management | Explicit save/load complementing sidebar | ✓ |
| /help — show available commands | Lists commands with descriptions in palette | ✓ |

**User's choice:** All four commands

---

### Q2: What UI component powers the slash command palette?

| Option | Description | Selected |
|--------|-------------|----------|
| cmdk (shadcn Command component) | Already in shadcn ecosystem; keyboard-first; accessible | ✓ |
| Custom inline dropdown | No dependency; more CSS/keyboard work; harder to make accessible | |
| You decide | Let the planner pick the palette implementation | |

**User's choice:** shadcn Command (cmdk)

---

## Claude's Discretion

- Exact sidebar width and chat pane proportions
- Session auto-save vs explicit-save-only behavior
- Tool block default expand/collapse state
- Bash output truncation threshold

## Deferred Ideas

- Light/dark theme toggle
- `/cost` slash command (cost already visible in top bar)
- Collapsible/resizable sidebar (deferred to Phase 5)
- Per-turn cost breakdown (input/output tokens separately)
