---
phase: 01-cli-completion
plan: "02"
subsystem: rusty-claude-cli
tags: [cost-display, budget, tdd, cli-args]
dependency_graph:
  requires: [01-01-SUMMARY.md]
  provides: [D-05-cost-footer, D-09-budget-flag, D-10-budget-error]
  affects: [LiveCli, parse_args, run_repl, CliAction]
tech_stack:
  added: []
  patterns: [TDD red-green, extract-helper-for-testability, pure-function-helpers]
key_files:
  created: []
  modified:
    - rust/crates/rusty-claude-cli/src/main.rs
decisions:
  - Remove Eq derive from CliAction since f64 does not implement Eq; PartialEq suffices for assert_eq! in tests
  - Compute per-turn cost inline in run_turn() using duplicated rate table rather than adding a new UsageTracker API (minimal surface, avoids runtime crate changes)
  - Add format_cost_footer() and format_budget_error() as pub(crate) free functions so they are independently testable without mocking LiveCli
metrics:
  duration: "~15 minutes"
  completed: "2026-05-08T00:00:00Z"
  tasks_completed: 2
  files_modified: 1
---

# Phase 01 Plan 02: Cost Footer and Budget Flag Summary

**One-liner:** D-05 cost footer (`in: X | out: Y | $Z.ZZZZ  [session: $N.NNNN]`), `--budget` CLI flag wired into `LiveCli.set_budget()`, and D-10 budget-exceeded error message updated — all via TDD red-green.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 (RED) | Failing tests for --budget flag | b9e248f | main.rs |
| 1 (GREEN) | Add --budget to parse_args and run_repl | d75873b | main.rs |
| 2 (RED) | Failing tests for D-05 footer and D-10 error | ef55d14 | main.rs |
| 2 (GREEN) | Replace cost footer and update budget error | a995e4b | main.rs |

## Changes Made

### Task 1: --budget flag (D-09)

**Change 1 — `CliAction::Repl` new field:**
Added `budget: Option<f64>` to `CliAction::Repl`. Removed `Eq` from the derive since `f64` does not implement `Eq`; `PartialEq` is sufficient for all existing and new tests.

**Change 2 — `parse_args()` flag parsing:**
Added `--budget <dollars>` and `--budget=<dollars>` match arms. Invalid values return `Err(format!("invalid --budget value: ..."))`. Missing value returns `Err("missing value for --budget")`.

**Change 3 — Threading through `run_repl()`:**
Changed signature to `run_repl(model, auto_accept, budget: Option<f64>)`. After `LiveCli::new()`, calls `cli.set_budget(b)` if `budget` is `Some`. Updated call site in `run()`.

### Task 2: D-05 cost footer and D-10 budget error

**Change 1 — `format_cost_footer()` helper:**
```rust
pub(crate) fn format_cost_footer(in_tokens: u32, out_tokens: u32, turn_cost: f64, session_cost: f64) -> String
```
Produces: `"in: X | out: Y | $Z.ZZZZ  [session: $N.NNNN]"`

**Change 2 — `format_budget_error()` helper:**
```rust
pub(crate) fn format_budget_error(budget: f64, session_cost: f64) -> String
```
Produces: `"Budget $X.XX exceeded (session: $Y.YY). Use --budget to raise the limit."`

**Change 3 — `LiveCli::run_turn()` footer:**
Replaced the old cumulative-only footer (`{up} X in · {down} Y out · $cost`) with a call to `format_cost_footer()` using `current_turn_usage()` for per-turn tokens and an inline per-turn cost computation using the same rate table as `UsageTracker::cost_usd`. Duration string removed from footer.

**Change 4 — D-10 budget exceeded error:**
Replaced `style::print_err(&format!("Cost budget exceeded (${:.2}). Use /budget <amount> to increase.", ...))` with `style::print_err(&format_budget_error(...))`.

## Acceptance Criteria Verification

- `grep "in: {} | out: {}"` returns 1 match (in `format_cost_footer`): YES
- `grep "current_turn_usage"` returns 1 match: YES
- `grep "session:"` returns match in footer/error context: YES
- `grep "Use --budget to raise"` returns 1 match: YES
- Old `"Use /budget <amount> to increase"` D-10 text removed: YES (the remaining `Use /budget <usd>` on line 2622 is a pre-existing slash-command help message, unrelated to D-10)
- `cargo test -p rusty-claude-cli -- cost_footer budget_error` exits 0: YES (2 tests pass)
- `cargo test -p rusty-claude-cli` exits 0 (52 total tests): YES
- `cargo build -p rusty-claude-cli` exits 0: YES

## Deviations from Plan

**1. [Rule 1 - Bug] Removed `Eq` derive from `CliAction` (f64 incompatibility)**
- **Found during:** Task 1 GREEN phase
- **Issue:** `#[derive(Eq)]` on `CliAction` fails to compile after adding `budget: Option<f64>` because `f64` does not implement `Eq`
- **Fix:** Removed `Eq` from `#[derive(Debug, Clone, PartialEq, Eq)]` — `assert_eq!` only requires `PartialEq`
- **Files modified:** `rust/crates/rusty-claude-cli/src/main.rs`
- **Commit:** d75873b

## TDD Gate Compliance

- Task 1 RED gate commit: b9e248f — `test(01-02): add failing tests for --budget flag in parse_args`
- Task 1 GREEN gate commit: d75873b — `feat(01-02): add --budget flag to parse_args and thread through run_repl`
- Task 2 RED gate commit: ef55d14 — `test(01-02): add failing tests for D-05 cost footer format and D-10 budget error`
- Task 2 GREEN gate commit: a995e4b — `feat(01-02): replace cost footer with D-05 format and update D-10 budget error`
- REFACTOR: Not needed — code is already clean.

## Known Stubs

None.

## Threat Flags

None — all changes are display-only or CLI arg parsing. The `--budget` flag is parsed with `.parse::<f64>().map_err()` as required by T-02-01 and T-02-03. No new network endpoints, auth paths, or schema changes introduced.

## Self-Check: PASSED

- rust/crates/rusty-claude-cli/src/main.rs: FOUND
- Commit b9e248f: FOUND (test RED task 1)
- Commit d75873b: FOUND (feat GREEN task 1)
- Commit ef55d14: FOUND (test RED task 2)
- Commit a995e4b: FOUND (feat GREEN task 2)
