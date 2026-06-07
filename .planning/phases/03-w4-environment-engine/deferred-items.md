# Phase 03 — Deferred / Out-of-Scope Items

Logged during execution. These are NOT fixed by the current plan — they are
recorded for a later sweep or for human awareness.

## 03-02 (Wave 2 — disaster pure helpers)

### [observation] Pre-existing working-tree changes were absent at executor start

- **Found during:** 03-02 executor startup (pre-flight git status).
- **Context:** The orchestrator's initial git-status snapshot listed uncommitted
  modifications to `.planning/STATE.md`, `.planning/config.json`,
  `tauri-app/src-tauri/src/civilization.rs`, `tauri-app/src-tauri/src/lib.rs`,
  `tauri-app/src/bindings.ts`, plus an untracked
  `.planning/phases/03-w4-environment-engine/deferred-items.md`.
- **Observed:** By the time this executor ran, `git status` was already CLEAN
  (working tree matched `ff9be71` exactly). No reflog reset/checkout/stash entry
  exists; this executor ran NO destructive git commands (no `git clean`,
  `git reset --hard`, or `git checkout -- .`). The snapshot was simply stale /
  those changes were reverted by an upstream step before this session started.
- **Impact:** None on 03-02. `lib.rs` and `bindings.ts` are byte-identical to
  their committed `ff9be71` state — this plan never touched them. If those
  pre-snapshot edits were intentional and are now genuinely lost, they predate
  and are unrelated to this plan; flag for human review.
- **Disposition:** Out of scope for 03-02 (Rule scope boundary). No action taken.

### [pre-existing baseline] clippy `-D warnings` baseline = 15 errors

- `commands.rs` (10), `skills_mcp.rs` (4), `permission_prompter.rs:31` (1),
  `civilization.rs:703` (1). Documented in the plan/CLAUDE.md as the ~16-error
  baseline. NOT fixed (scope boundary — pre-existing, unrelated to 03-02).
  03-02 adds ZERO new clippy warnings over this baseline.
