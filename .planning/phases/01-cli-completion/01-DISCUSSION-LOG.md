# Phase 1: CLI Completion - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-07
**Phase:** 1-CLI-Completion
**Areas discussed:** Permission prompt UX, Cost display format, /model command behavior, Budget enforcement source

---

## Permission Prompt UX

### Input verbosity

| Option | Description | Selected |
|--------|-------------|----------|
| Truncated preview | Tool name + first ~120 chars of input | ✓ |
| Full input always | No truncation | |
| Tool name only | Minimal — no input context | |

**User's choice:** Truncated preview (~120 chars)
**Notes:** Enough context to judge the tool call without scrolling.

### Key choices

| Option | Description | Selected |
|--------|-------------|----------|
| y / n / a | yes once / no / always-allow for session | ✓ |
| y / n / a / d | Adds always-deny | |
| y / n only | No always-allow | |

**User's choice:** y / n / a
**Notes:** No always-deny key needed for Phase 1.

### Always-allow persistence

| Option | Description | Selected |
|--------|-------------|----------|
| Session only | In-memory, lost on exit | ✓ |
| Write to config | Persists across launches | |

**User's choice:** Session only
**Notes:** Safer default — no silent escalation across launches.

### Visual style

| Option | Description | Selected |
|--------|-------------|----------|
| Colored prompt | Yellow/amber via crossterm style.rs | ✓ |
| Plain text | No color | |

**User's choice:** Colored prompt
**Notes:** Use existing crossterm color theme, no new dependencies.

---

## Cost Display Format

### Per-turn breakdown

| Option | Description | Selected |
|--------|-------------|----------|
| Input + Output + Cost | `in: X \| out: Y \| $Z` | ✓ |
| Input + Output + Cache + Cost | Also shows cache tokens | |
| Cost only | Just `$Z` | |

**User's choice:** Input + Output + Cost per turn.
**Notes:** Clean one-liner; cache breakdown deferred to later phase if needed.

### Session total placement

| Option | Description | Selected |
|--------|-------------|----------|
| Same line appended | `... [session: $N.NN]` | ✓ |
| Separate line below | Session total on its own line | |
| /cost command only | Not auto-printed | |

**User's choice:** Same line, appended.
**Notes:** Everything in one footer line per turn.

---

## /model Command Behavior

### Switch vs display

| Option | Description | Selected |
|--------|-------------|----------|
| Switch + display | `/model` shows current; `/model <name>` switches | ✓ |
| Display only | Show current, no switching | |
| Switch with confirmation | Prompt before changing | |

**User's choice:** Switch + display.
**Notes:** Consistent with other CLI flags that can be changed at runtime.

### Prompt update after switch

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, update prompt | REPL shows new model name | ✓ |
| No, print confirmation only | Keep prompt as-is | |

**User's choice:** Yes, update REPL prompt.

---

## Budget Enforcement Source

### Budget source

| Option | Description | Selected |
|--------|-------------|----------|
| CLI flag only | `--budget 1.00` | ✓ |
| CLI flag + config key | Overridable default | |
| Config key only | No CLI flag | |

**User's choice:** CLI flag only for Phase 1.
**Notes:** Explicit per-launch; config key deferred.

### On budget exceeded

| Option | Description | Selected |
|--------|-------------|----------|
| Refuse turn + print message | Session stays open | ✓ |
| Save + exit | Auto-save and close REPL | |
| Warn only | Continue anyway | |

**User's choice:** Refuse turn + print message. Session stays open.
**Notes:** User can still read history after budget is hit.

---

## Claude's Discretion

None — all gray areas resolved by user selection.

## Deferred Ideas

None raised during discussion.
