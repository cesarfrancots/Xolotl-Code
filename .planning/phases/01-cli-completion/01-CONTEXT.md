# Phase 1: CLI Completion - Context

**Gathered:** 2026-05-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire the existing Rust infrastructure (PermissionPrompter trait, UsageTracker, slash command registry, OpenAI-compat client) to produce a production-ready interactive CLI with interactive tool-approval prompting, cost display, a complete slash command set, session resume, open-model tool-call validation, and cost budget enforcement. No new capabilities — pure completion of what the codebase already has scaffolded.

</domain>

<decisions>
## Implementation Decisions

### Permission Prompt UX
- **D-01:** Show tool name + truncated preview of ~120 chars of the tool input when prompting for approval.
- **D-02:** Key choices are `y` (yes once) / `n` (no) / `a` (always allow for this session). No `d` (always deny).
- **D-03:** `a` (always allow) persists for the current REPL session only — never written to config. Next launch starts clean.
- **D-04:** Permission prompt is visually distinct using yellow/amber color from the existing crossterm theme in `style.rs`.

### Cost Display Format
- **D-05:** After each turn, print a single footer line: `in: X | out: Y | $Z.ZZZZ  [session: $N.NNNN]`.
- **D-06:** Session total appears on the same line, appended after the per-turn cost. No separate line.

### `/model` Command Behavior
- **D-07:** `/model` (no args) prints the currently active model. `/model <name>` switches the active model for the next turn.
- **D-08:** After a successful `/model <name>` switch, the REPL prompt updates to reflect the new model name.

### Budget Enforcement
- **D-09:** Cost budget is set via `--budget <dollars>` CLI flag only. No config key in Phase 1.
- **D-10:** When `UsageTracker::budget_exceeded()` is true at the start of a new turn, refuse the turn and print: `Budget $X.XX exceeded (session: $Y.YY). Use --budget to raise the limit.` — session stays open so the user can still read history.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/ROADMAP.md` §Phase 1 — Goal, success criteria, and requirement IDs (CLI-01 through CLI-06)
- `.planning/REQUIREMENTS.md` §CLI Completion — Detailed requirements for CLI-01 through CLI-06

### Key Source Files to Extend
- `rust/crates/runtime/src/permissions.rs` — `PermissionPrompter` trait (implement `ReplPermissionPrompter` backed by stdin here or in `rusty-claude-cli/`)
- `rust/crates/rusty-claude-cli/src/app.rs` — `SlashCommand` enum, `SessionConfig`, `SessionState` (add Clear, Model, Cost, Save, Load)
- `rust/crates/runtime/src/usage.rs` — `UsageTracker`, `UsageSummary` (wire to per-turn footer output)
- `rust/crates/rusty-claude-cli/src/openai.rs` — OpenAI-compat client for Kimi K2 and MiniMax M1 (tool-call schema fixes)
- `rust/crates/rusty-claude-cli/src/style.rs` — Crossterm color theme (use for permission prompt coloring)
- `rust/crates/commands/src/lib.rs` — `CommandRegistry` (register new slash commands)
- `rust/crates/rusty-claude-cli/src/args.rs` — Clap args (add `--budget` and `--resume` flags)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `PermissionPrompter` trait (`rust/crates/runtime/src/permissions.rs:22`) — Implement a `ReplPermissionPrompter` struct that prints the truncated request and reads a single keypress from stdin.
- `UsageTracker` / `UsageSummary` (`rust/crates/runtime/src/usage.rs`) — Already tracks cumulative tokens and per-model pricing; just needs to be read and formatted after `run_turn()`.
- `style.rs` crossterm theme — Color utilities already in place; use yellow/amber for the permission prompt line.
- `Session` JSON save/load (`rust/crates/runtime/src/session.rs`) — Already works; `--resume <id>` just needs to load the session before starting the REPL loop.

### Established Patterns
- New slash commands: add variant to `SlashCommand` enum in `app.rs`, add match arm in the handler, add entry to `CommandRegistry` in `commands/src/lib.rs`.
- New CLI flag: add field to `Args` struct in `args.rs` (clap derive), then thread it into `SessionConfig` or read it in `main.rs`.
- Provider-specific fixes stay in `openai.rs` — `ConversationRuntime` must not contain provider branching.

### Integration Points
- Permission prompting: `PermissionPolicy::authorize()` → calls `prompter.decide()` — wire `ReplPermissionPrompter` here.
- Cost footer: printed by `CliApp` after receiving `TurnSummary` from `run_turn()` — `UsageSummary` is already in `TurnSummary`.
- Budget gate: check `UsageTracker::budget_exceeded()` at the top of the turn loop in `app.rs` before calling `run_turn()`.
- Session resume: load session JSON from `~/.xolotl-code/sessions/<id>.json` and pass to `ConversationRuntime` before entering the REPL loop.

</code_context>

<specifics>
## Specific Ideas

No specific UI references or "I want it like X" moments — standard terminal UX with the existing crossterm stack is sufficient.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 1-CLI-Completion*
*Context gathered: 2026-05-07*
