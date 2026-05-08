---
phase: 01-cli-completion
plan: "01"
subsystem: rusty-claude-cli
tags: [permissions, ux, tdd]
dependency_graph:
  requires: []
  provides: [permission-prompt-120-char-preview, permission-prompt-no-bang-choice]
  affects: [ReplPermissionPrompter]
tech_stack:
  added: []
  patterns: [TDD red-green, extract-helper-for-testability]
key_files:
  created: []
  modified:
    - rust/crates/rusty-claude-cli/src/main.rs
decisions:
  - Extract truncate_preview() helper so preview truncation logic is independently testable without stdin mocking
  - Add PERMISSION_CHOICES const so prompt text is a single source of truth testable at compile time
metrics:
  duration: "~8 minutes"
  completed: "2026-05-08T14:22:36Z"
  tasks_completed: 1
  files_modified: 1
---

# Phase 01 Plan 01: Permission Prompt UX Fixes Summary

**One-liner:** Surgical two-line fix to ReplPermissionPrompter — 120-char preview via extracted helper and "[y] Allow  [n] Deny  [a] Always allow" choices line with [!] hidden from UI.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 (RED) | Failing tests for 120-char preview and no-bang choices | 914a0cf | main.rs |
| 1 (GREEN) | Fix ReplPermissionPrompter implementation | 4cc0444 | main.rs |

## Changes Made

### Task 1: Fix ReplPermissionPrompter — 120-char preview and corrected prompt line

**Change 1 — Preview truncation (D-01):**
Extracted `truncate_preview(input: &str) -> String` that uses `.chars().take(120)`. The `decide()` method now calls this helper instead of the previous inline `.chars().take(200)` call.

**Change 2 — Choices prompt line (D-02):**
Replaced the 4-choice eprintln (`[y] Allow  [n] Deny  [a] Always  [!] Accept all`) with a 3-choice version (`[y] Allow  [n] Deny  [a] Always allow`). The `"!" | "accept-all"` match arm is preserved as an undocumented escape hatch.

**Testability helpers added:**
- `fn truncate_preview(input: &str) -> String` — module-level free function
- `const PERMISSION_CHOICES: &str = "[y] Allow  [n] Deny  [a] Always allow"` — module-level const

## Acceptance Criteria Verification

- `chars().take(120)` present in permission prompt context: YES (in `truncate_preview`)
- `chars().take(200)` zero matches: YES (removed)
- `Always allow` in choices line: YES (both in const and eprintln)
- `[!] Accept all` zero matches: YES (removed from visible text)
- `cargo test -p rusty-claude-cli -- permission` exits 0: YES (2 tests pass)
- `cargo build -p rusty-claude-cli` exits 0: YES

## Deviations from Plan

None — plan executed exactly as written.

## TDD Gate Compliance

- RED gate commit: 914a0cf — `test(01-01): add failing tests for 120-char preview and no-bang choices line`
- GREEN gate commit: 4cc0444 — `feat(01-01): fix ReplPermissionPrompter — 120-char preview and corrected prompt line`
- REFACTOR: Not needed — code is already clean.

## Known Stubs

None.

## Threat Flags

None — all changes are display-only. The `truncate_preview` function uses `.chars().take(120)` which operates on Unicode scalar values (safe boundary). No new network endpoints, auth paths, or schema changes introduced.

## Self-Check: PASSED

- rust/crates/rusty-claude-cli/src/main.rs: FOUND
- Commit 914a0cf: FOUND
- Commit 4cc0444: FOUND
