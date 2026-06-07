---
phase: 01-cli-completion
verified: 2026-05-08T18:00:00Z
status: human_needed
score: 4/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Run xolotl with KIMI_CODING_API_KEY and MINIMAX_API_KEY set, send a bash tool prompt to each model, confirm tool-call round-trip completes (not text-only)"
    expected: "Both Kimi K2 and MiniMax M1 invoke the bash tool and return the tool result — no text-only fallback. Cost footer shows non-zero tokens after each turn."
    why_human: "Live API endpoints cannot be exercised in CI. The openai.rs SSE parsing logic and finish_reason handling exist in code and tests pass, but real endpoint behavior (empty id on first chunk, MiniMax usage aliases, finish_reason variants) can only be confirmed with actual API traffic."
---

# Phase 1: CLI Completion Verification Report

**Phase Goal:** A user can run a complete, cost-aware, resumable agent session from the CLI against Anthropic, Kimi K2, and MiniMax M1 with safe, interactive tool gating.
**Verified:** 2026-05-08T18:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can approve/deny/always-allow tool calls interactively and the choice is honored for the rest of the session | VERIFIED | `ReplPermissionPrompter::decide()` at line 318: `always_allow.contains(&request.tool_name)` short-circuits to Allow on subsequent calls; `"a"\|"always"` arm inserts into `always_allow` HashSet. Tests `permission_preview_truncated_at_120_chars` and `permission_prompt_choices_line_has_no_bang` pass. |
| 2 | User can run /help, /clear, /model, /cost, /save, /load and see their effects | VERIFIED | All six handlers present at lines 1003–1062 in `run_repl_loop`. Human checklist A (01-04-SUMMARY.md) confirms all 8 sub-checks passed including `/model` switch, `/save`+`/load` round-trip, and `/clear`. |
| 3 | User sees per-turn and session-total token counts and dollar cost after each turn | VERIFIED | `format_cost_footer()` at line 3984 produces `"in: X \| out: Y \| $Z.ZZZZ  [session: $N.NNNN]"`. Called from `run_turn()` at line 1534 using `current_turn_usage()` for per-turn and `cost_usd()` for session total. Test `cost_footer_format_matches_d05` passes. |
| 4 | User can resume a previous session via --resume id and continues with full prior context | VERIFIED | `run_repl_resumed()` at line 859 resolves path via `resolve_session_path()`, loads session via `Session::load_from_path()`, rebuilds runtime, then delegates to `run_repl_loop()`. `CliAction::ResumeSession` dispatch at line 474 calls it when `command` is `None`. Tests `parses_resume_flag_bare_id` and `resolve_resume_path_with_dot_json` pass. |
| 5 | Kimi K2 and MiniMax M1 complete a tool-call round-trip against real endpoints without text-only fallback, and the agent loop refuses a new turn when budget is exceeded | PARTIAL | **Budget enforcement:** VERIFIED — `is_over_budget()` at line 1178 gates each turn; `format_budget_error()` produces the correct D-10 message; `--budget` flag parsed and threaded through to `LiveCli.set_budget()`. Test `budget_error_message_format_d10` passes. **Live tool-call round-trip:** HUMAN NEEDED — openai.rs SSE parsing handles `finish_reason` `"tool_calls"\|"stop"\|"end_turn"`, orphaned tool-call IDs, and empty `id` on first chunk (line 781). Human checklist B+C in 01-04-SUMMARY.md reports approved, but this verifier cannot confirm live endpoint behavior without API keys. |

**Score:** 4/5 truths fully verifiable by static analysis + automated tests. Truth 5 is split: budget enforcement is VERIFIED; live endpoint round-trip is HUMAN NEEDED.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `rust/crates/rusty-claude-cli/src/main.rs` | ReplPermissionPrompter with 120-char preview | VERIFIED | `truncate_preview()` at line 298; `PERMISSION_CHOICES` const at line 302; called in `decide()` at line 328 |
| `rust/crates/rusty-claude-cli/src/main.rs` | D-05 cost footer, --budget flag, D-10 budget error | VERIFIED | `format_cost_footer()` at line 3984; `format_budget_error()` at line 3997; `--budget` match arms at lines 595, 606; `CliAction::Repl.budget: Option<f64>` at line 510 |
| `rust/crates/rusty-claude-cli/src/main.rs` | run_repl_resumed() and run_repl_loop() for interactive resume | VERIFIED | `run_repl_loop()` at line 902; `run_repl_resumed()` at line 859; called from dispatch at line 474 |
| `rust/crates/rusty-claude-cli/src/openai.rs` | Kimi K2 + MiniMax M1 SSE client with tool-call handling | VERIFIED (code) | Provider routing at lines 40–131; `finish_reason` multi-variant match at line 800; orphaned-ID guard at line 781 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ReplPermissionPrompter::decide()` | `PermissionPromptDecision` | y/n/a keypress match | WIRED | Lines 420–435: `"y"\|"yes"\|""` → Allow; `"a"\|"always"` → insert to `always_allow` + Allow; `"!"\|"accept-all"` → set `auto_accept` (hidden); else → Deny |
| `parse_args()` | `CliAction::Repl { budget: Option<f64> }` | `--budget` flag match arm | WIRED | Lines 595–642: `"--budget"` and `--budget=` arms parse `f64`, thread into `CliAction::Repl { budget }` |
| `LiveCli::run_turn()` | `UsageTracker::current_turn_usage()` | per-turn cost computation | WIRED | Line 1507: `self.runtime.usage().current_turn_usage()` feeds `format_cost_footer()` at line 1534 |
| `LiveCli turn loop` | `is_over_budget()` | D-10 error message with `session:` | WIRED | Lines 1178–1183: `if cli.is_over_budget()` → `format_budget_error(budget_limit, session_cost)` |
| `CliAction::ResumeSession { command: None }` | `run_repl()` with loaded session | `run_repl_resumed()` + `Session::load_from_path` | WIRED | Line 474: `None` arm calls `run_repl_resumed()`; line 878: `Session::load_from_path(&resolved_path)` |
| `xolotl CLI` | Kimi K2 live endpoint | `KIMI_CODING_API_KEY` + openai.rs SSE client | WIRED (code) | Lines 128–131 in openai.rs: endpoint + key routing; HUMAN NEEDED for live confirmation |
| `xolotl CLI` | MiniMax M1 live endpoint | `MINIMAX_API_KEY` + openai.rs SSE client | WIRED (code) | Same as above for MiniMax; HUMAN NEEDED for live confirmation |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `run_turn()` cost footer | `turn_usage` / `session_cost` | `self.runtime.usage().current_turn_usage()` / `cost_usd()` | Yes — UsageTracker accumulates from real API responses | FLOWING |
| `is_over_budget()` | `budget_limit` | `LiveCli.budget_limit` set via `cli.set_budget(b)` from `--budget` arg | Yes — CLI arg flows to field before REPL loop | FLOWING |
| `run_repl_resumed()` | session messages | `Session::load_from_path()` reads JSON from disk | Yes — reads real session file, rebuilds runtime | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 120-char permission preview | `cargo test -p rusty-claude-cli -- permission` | 2/2 pass | PASS |
| Budget flag parsing | `cargo test -p rusty-claude-cli -- parses_budget` | 2/2 pass | PASS |
| Cost footer format | `cargo test -p rusty-claude-cli -- cost_footer` | 1/1 pass | PASS |
| Budget error format | `cargo test -p rusty-claude-cli -- budget_error` | 1/1 pass | PASS |
| Session resume path resolution | `cargo test -p rusty-claude-cli -- resume` | 3/3 pass | PASS |
| Full suite | `cargo test -p rusty-claude-cli` | 54/54 pass | PASS |
| Kimi K2 live tool-call round-trip | Live API call | Cannot test without keys | SKIP |
| MiniMax M1 live tool-call round-trip | Live API call | Cannot test without keys | SKIP |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| CLI-01 | 01-01-PLAN.md | Interactive y/n/a tool approval with always-allow per tool | SATISFIED | `ReplPermissionPrompter` fully implemented and tested |
| CLI-02 | 01-04-PLAN.md | /help, /clear, /model, /cost, /save, /load slash commands | SATISFIED | All six handlers in `run_repl_loop`; human checklist A approved |
| CLI-03 | 01-02-PLAN.md | Per-turn + session token counts and dollar cost | SATISFIED | `format_cost_footer()` used in `run_turn()`; test passes |
| CLI-04 | 01-03-PLAN.md | --resume session-id opens interactive REPL with prior context | SATISFIED | `run_repl_resumed()` wired through `CliAction::ResumeSession`; tests pass |
| CLI-05 | 01-04-PLAN.md | Kimi K2 + MiniMax M1 tool-call round-trip against real endpoints | NEEDS HUMAN | Code path exists and is complete; live validation requires API keys |
| CLI-06 | 01-02-PLAN.md | Agent loop refuses turn when cost budget exceeded | SATISFIED | `is_over_budget()` gates each turn in `run_repl_loop`; budget error uses D-10 format |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| main.rs | 1523 | Duplicated rate table (same rates as `UsageTracker::cost_usd`) | Info | Technical debt only — cost display is correct; could drift if rates change in `usage.rs` |

No placeholders, stub returns, or TODO/FIXME patterns found in the Phase 1 implementation paths.

### Human Verification Required

#### 1. Kimi K2 Tool-Call Round-Trip (CLI-05)

**Test:** With `KIMI_CODING_API_KEY` set, run `xolotl --model kimi-coding -Y` and send: `Use the bash tool to run: echo "kimi-tool-call-test"`

**Expected:** The model invokes the bash tool (not text-only output); the tool returns `kimi-tool-call-test`; the model acknowledges the result; cost footer shows non-zero tokens.

**Why human:** Live API endpoint required. The SSE parsing, finish_reason handling, and orphaned tool-call ID guard in openai.rs are implemented and unit-tested, but actual endpoint behavior (streaming format, finish_reason values, id field timing) can only be confirmed with real traffic.

#### 2. MiniMax M1 Tool-Call Round-Trip (CLI-05)

**Test:** With `MINIMAX_API_KEY` set, run `xolotl --model minimax2.7 -Y` and send: `Use the bash tool to run: echo "minimax-tool-call-test"`

**Expected:** Same as Kimi K2 above — tool invoked, result returned, tokens shown in footer.

**Why human:** Same reason as above. MiniMax has additional edge case: tool call `id` may arrive in a later SSE delta — the guard at openai.rs line 781 handles this, but only real traffic confirms it works.

**Note:** The 01-04-SUMMARY.md records both Kimi K2 and MiniMax M1 as "APPROVED" by the developer. If the developer who ran that checklist is the same person signing off, this can be accepted as sufficient and status upgraded to `passed`. A fresh verifier cannot independently confirm it.

### Gaps Summary

No implementation gaps found. All five success criteria have working code in the codebase. The single outstanding item (CLI-05 live endpoint validation) is a human-only test due to requiring live API keys and terminal interaction — the code supporting it is complete and correct per static analysis and automated tests.

The 01-04-SUMMARY.md records the developer's manual approval for both Kimi K2 and MiniMax M1 tool-call round-trips. If the project accepts the developer's own checklist as the verification record for CLI-05, the phase may be considered fully passed.

---

_Verified: 2026-05-08T18:00:00Z_
_Verifier: Claude (gsd-verifier)_
