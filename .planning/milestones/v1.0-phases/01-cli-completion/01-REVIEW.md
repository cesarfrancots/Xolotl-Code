---
phase: 01-cli-completion
reviewed: 2026-05-08T00:00:00Z
depth: standard
files_reviewed: 1
files_reviewed_list:
  - rust/crates/rusty-claude-cli/src/main.rs
findings:
  critical: 5
  warning: 8
  info: 4
  total: 17
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-05-08
**Depth:** standard
**Files Reviewed:** 1
**Status:** issues_found

## Summary

`main.rs` is a large (~4,825 line) single-file Rust CLI that orchestrates an AI agent loop: argument parsing, REPL, session management, model routing, tool execution, and sub-agent spawning. The top of the file carries a broad `#![allow(..., dead_code)]` suppressor that hides dead-code warnings across the entire crate, which is itself a structural red flag.

Five findings are BLOCKERs: two are security issues (API keys readable world-wide on Windows because the Unix `chmod 0o600` guard is `#[cfg(unix)]` only, and API keys injected into env vars for all child processes via `env::set_var`); one is a data-loss risk (sub-agent output only collects assistant-role text, silently discarding tool-result text); one is a soundness bug (the parallel task counter uses `Relaxed` ordering in a wait-loop without a fence, risking a spin-forever deadlock on some platforms); and one is a logic error in the `/plan status` phase-completion check that will always show phases as incomplete when any task is `InProgress`.

---

## Critical Issues

### CR-01: Config file written with no permissions restriction on Windows

**File:** `rust/crates/rusty-claude-cli/src/main.rs:278-283`

**Issue:** `run_setup()` and `connect_provider()` both write API keys to `~/.xolotl-code/config.json`. The `chmod 0o600` guard is wrapped in `#[cfg(unix)]`, so on Windows the file is created with default ACL — typically readable by all accounts in the same user session and by SYSTEM. Any process running as the same user or as an elevated process can trivially read every stored API key.

**Fix:**
```rust
// After writing the config on Windows, restrict via ACL (best-effort)
#[cfg(windows)]
{
    use std::os::windows::fs::OpenOptionsExt;
    // Use icacls or the windows-acl crate to restrict to current user only:
    let _ = std::process::Command::new("icacls")
        .args([
            config_path.to_str().unwrap_or(""),
            "/inheritance:r",
            "/grant:r",
            &format!("{}:(R,W)", env::var("USERNAME").unwrap_or_default()),
        ])
        .output();
}
```
Or at minimum document that Windows provides no file-level key isolation.

---

### CR-02: API keys propagated to all child processes via `env::set_var`

**File:** `rust/crates/rusty-claude-cli/src/main.rs:185-188` (in `load_config_keys`) and `rust/crates/rusty-claude-cli/src/main.rs:2519` (in `connect_provider`)

**Issue:** `env::set_var(key, s)` sets environment variables in the current process, which are inherited by every child process spawned afterwards — including sub-agents, shell tools (`bash` tool), and MCP servers. A prompt-injected `bash` command can exfiltrate all API keys with:
```bash
echo $ANTHROPIC_API_KEY $BEDROCK_API_KEY ...
```
The permission model tries to guard `bash` via `PermissionMode::Prompt`, but auto-accept mode (`-y`) or `[a] Always allow` bypasses that completely.

**Fix:** Do not store secrets in environment variables beyond initial client construction. Pass the key directly to the HTTP client at construction time and do not expose it in the process environment for the lifetime of the program. If env-var loading is required for compatibility, unset the vars after use.

---

### CR-03: Sub-agent output silently drops tool-result and non-text content

**File:** `rust/crates/rusty-claude-cli/src/main.rs:4411-4424`

**Issue:** `run_subagent()` collects only `ContentBlock::Text` blocks from *all* messages (user + assistant), merging them with `"\n\n"`. Tool results, image blocks, and structured data are silently discarded. Worse, it also includes the original user prompt text in the output (the first message is a user message with `ContentBlock::Text`). The resulting file will contain the prompt itself prepended to the agent response, which is incorrect output.

```rust
// Current — collects from ALL messages including user prompt
for msg in &session.messages {
    for block in &msg.blocks {
        if let ContentBlock::Text { text } = block {
```

**Fix:**
```rust
// Collect only from assistant-role messages
for msg in &session.messages {
    if msg.role != MessageRole::Assistant {
        continue;
    }
    for block in &msg.blocks {
        if let ContentBlock::Text { text } = block {
            if !text.trim().is_empty() {
                text_parts.push(text.clone());
            }
        }
    }
}
```

---

### CR-04: Parallel task counter uses `Relaxed` ordering in a spin-wait loop — potential livelock on weakly-ordered platforms

**File:** `rust/crates/rusty-claude-cli/src/main.rs:3796-3798`

**Issue:** The spawning loop polls `running.load(Ordering::Relaxed)` in a tight sleep loop to throttle parallel tasks:
```rust
while running.load(std::sync::atomic::Ordering::Relaxed) >= max_parallel {
    thread::sleep(std::time::Duration::from_millis(50));
}
running.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
```
The `Drop` guard on each worker thread uses `fetch_sub(1, Ordering::Relaxed)`. On architectures with weak memory ordering (e.g., ARM), the decrement in the completing thread is not guaranteed to be visible to the spawning thread without an `Acquire`/`Release` pair. The spawner may spin indefinitely even after all slots have freed. On x86 this is unlikely to manifest in practice, but it is technically unsound.

**Fix:** Use `Ordering::Release` for the `fetch_sub` decrement and `Ordering::Acquire` for the `fetch_add` and the load in the wait loop:
```rust
while running.load(Ordering::Acquire) >= max_parallel {
    thread::sleep(std::time::Duration::from_millis(50));
}
running.fetch_add(1, Ordering::Relaxed); // relaxed is fine for the add itself
// In Drop:
self.0.fetch_sub(1, Ordering::Release);
```

---

### CR-05: `/plan status` phase-completion check excludes `InProgress` tasks, making all active phases appear incomplete

**File:** `rust/crates/rusty-claude-cli/src/main.rs:2075-2083`

**Issue:** The phase-completion check counts only todos that are *neither* `Pending` nor `InProgress`:
```rust
let phase_completed = todo_output
    .todos
    .iter()
    .filter(|t| {
        t.id.starts_with(&format!("plan-{i}-"))
            && t.status != runtime::TodoStatus::Pending
            && t.status != runtime::TodoStatus::InProgress
    })
    .count();
```
The check then compares `phase_completed == phase_total` to decide whether to show the green check. If a task is `Cancelled` it is counted as "done" even though it was abandoned. If a task is `InProgress` it is counted as incomplete, so a phase with one in-progress and all others complete will never show as done even after all work completes (once a task transitions from `InProgress` → `Completed` this resolves, but the icon logic during execution is misleading). More critically, `Cancelled` tasks inflate the completion count — a fully-cancelled phase shows as "completed".

**Fix:** Count only `Completed` tasks:
```rust
let phase_completed = todo_output
    .todos
    .iter()
    .filter(|t| {
        t.id.starts_with(&format!("plan-{i}-"))
            && t.status == runtime::TodoStatus::Completed
    })
    .count();
```

---

## Warnings

### WR-01: `abort_plan` retains system prompt sections starting with `"# Active Plan:"` but `generate_ultra_plan` injects `"# Active Ultra-Plan:"`

**File:** `rust/crates/rusty-claude-cli/src/main.rs:2166-2168`

**Issue:** `abort_plan()` removes system prompt sections with:
```rust
prompt.retain(|s| !s.starts_with("# Active Plan:"));
```
But `generate_ultra_plan()` injects a section starting with `"# Active Ultra-Plan:"`. The retain predicate does not match this prefix, so aborting an ultra-plan leaves the injected context in the system prompt permanently for the session. The model will continue to think an ultra-plan is active.

**Fix:**
```rust
prompt.retain(|s| {
    !s.starts_with("# Active Plan:")
        && !s.starts_with("# Active Ultra-Plan:")
});
```

---

### WR-02: `today_iso()` silently produces the wrong date when the system clock is before UNIX epoch

**File:** `rust/crates/rusty-claude-cli/src/main.rs:86-115`

**Issue:** `SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default()` returns zero duration if the clock is behind epoch (e.g., VM with bad clock). `unwrap_or_default()` returns `Duration::ZERO`, silently yielding date `1970-01-01` injected into the system prompt. No error is reported.

**Fix:** Log a warning or propagate an error rather than silently injecting a wrong date:
```rust
let secs = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map_err(|_| eprintln!("Warning: system clock before epoch; date may be wrong"))
    .map(|d| d.as_secs())
    .unwrap_or(0);
```

---

### WR-03: `run_setup()` calls `maybe_migrate_legacy_config()` twice

**File:** `rust/crates/rusty-claude-cli/src/main.rs:199-200` and `rust/crates/rusty-claude-cli/src/main.rs:169`

**Issue:** `run_setup()` is called only after `load_config_keys()` has already run `maybe_migrate_legacy_config()` (line 170). Then `run_setup()` calls it again at line 200. This results in two migration attempts — harmless if idempotent, but the second call re-reads and re-checks file existence, and prints nothing on the second run (returns `false`). More importantly, `run_setup()` is exempt from the `load_config_keys()` call (line 453-458), so `maybe_migrate_legacy_config()` in `run_setup()` is the *only* migration call in that code path. The duplication inside `load_config_keys()` (line 170) is therefore unreachable when the user runs `xolotl setup`. This is confusing dead-path logic.

**Fix:** Remove the second call in `run_setup()` and rely on the call in `load_config_keys()`. If `setup` must migrate before loading, call `load_config_keys()` unconditionally, or restructure.

---

### WR-04: `connect_provider()` reads API key from stdin into a `String` but never zeroes memory

**File:** `rust/crates/rusty-claude-cli/src/main.rs:2471-2474`

**Issue:** The API key is read into a heap-allocated `String`, used, then dropped normally. Rust does not guarantee zeroing of heap allocations on drop. The key may persist in process memory for an unbounded time. On any OS with swap, this key can end up in pagefile/swapfile unencrypted.

**Fix:** Use the `zeroize` crate to overwrite the key buffer before drop:
```rust
use zeroize::Zeroize;
let mut key_string = line.trim().to_string();
// ... use key_string ...
key_string.zeroize(); // zero before dropping
```
This is a hardening improvement. Mark as WARNING because Rust's general memory safety model does not guarantee zeroing and this is a known accepted limitation in many Rust apps.

---

### WR-05: `/resume` command accepts a `command` argument that is ignored when `run_repl_resumed` is called

**File:** `rust/crates/rusty-claude-cli/src/main.rs:464-475`

**Issue:** In `run()`, the `ResumeSession` action checks `if command.is_some()` to call `resume_session()` (non-interactive) or `run_repl_resumed()`. If `command.is_none()`, `run_repl_resumed` is called and the `model`, `auto_accept`, and `budget` are forwarded — but the `command` `None` branch provides no indication to the user why their command was dropped. The real problem is structural: `parse_resume_args` allows at most one trailing argument as `command` (line 710), but that argument is `args.get(1)` — meaning any positional arg after the session path is silently treated as a command. If a user mistakenly writes `xolotl --resume session.json --model opus`, the string `"--model"` becomes the `command` and `"opus"` is silently discarded (not even validated as a slash command).

**Fix:** Validate that `command`, if provided, starts with `/` before accepting it, and return an error otherwise:
```rust
let command = args.get(1).cloned();
if let Some(ref cmd) = command {
    if !cmd.starts_with('/') {
        return Err(format!(
            "--resume command must be a slash command (e.g., /compact), got: {cmd}"
        ));
    }
}
```

---

### WR-06: Hardcoded cost rates in `run_turn()` diverge from the official rate table

**File:** `rust/crates/rusty-claude-cli/src/main.rs:1516-1524`

**Issue:** Per-turn cost is computed with hardcoded dollar-per-million-token rates that are duplicated from some external source:
```rust
if model_name.contains("opus") {
    (15.0, 75.0, 18.75, 1.50)
} else if model_name.contains("sonnet") {
    (3.0, 15.0, 3.75, 0.30)
```
These rates do not match models like `haiku4.5`, `glm`, `kimi`, `minimax`, or `qwen`. Those all fall through to the default `(15.0, 75.0, 18.75, 1.50)` — the Opus rate — grossly overestimating their cost. There is a separate `cost_usd()` function in `UsageTracker`, and if these two rate tables ever diverge the displayed "turn cost" will contradict the session cost shown in the same footer.

**Fix:** Remove the duplicated rate table from `run_turn()` and compute per-turn cost using the same `cost_usd()` function, then subtract the previous session cost:
```rust
let session_cost = self.runtime.usage().cost_usd(primary_model_name(&self.model));
let prev_session_cost = /* saved before the turn */ ...;
let turn_cost = session_cost - prev_session_cost;
```

---

### WR-07: `parse_args` silently ignores `--task-prompt` without `--task-output` (and vice versa)

**File:** `rust/crates/rusty-claude-cli/src/main.rs:631-639`

**Issue:** Sub-agent mode requires both `--task-prompt` and `--task-output`. If only one is provided, `parse_args` falls through to the default Repl action without any error or warning. A user who accidentally omits one of the two flags will start an interactive REPL instead of running the sub-agent, with no indication that their flags were ignored.

**Fix:**
```rust
match (sub_agent_prompt.take(), sub_agent_output_path.take()) {
    (Some(prompt), Some(output_path)) => return Ok(CliAction::SubAgent { prompt, output_path, model }),
    (Some(_), None) => return Err("--task-prompt requires --task-output".to_string()),
    (None, Some(_)) => return Err("--task-output requires --task-prompt".to_string()),
    (None, None) => {}
}
```

---

### WR-08: `rollback()` only removes trailing assistant/tool messages, silently does nothing if the last message is a user message

**File:** `rust/crates/rusty-claude-cli/src/main.rs:2590-2611`

**Issue:** The rollback loop iterates in reverse and breaks as soon as it encounters a non-`Assistant`/`Tool` message:
```rust
_ => break,
```
If the conversation ends with a user message (e.g., the turn was interrupted before the assistant responded), `remove_count` stays 0 and the function prints "Nothing to roll back." even though the user just typed a message they want to undo. The user is left with no way to retract their last prompt.

**Fix:** Before iterating, also remove trailing user messages up to the requested `n` user turns:
```rust
// Skip trailing user messages first, then remove n assistant turns
```

---

## Info

### IN-01: Broad `#![allow(dead_code)]` suppresses dead-code warnings crate-wide

**File:** `rust/crates/rusty-claude-cli/src/main.rs:23`

**Issue:** `dead_code` is suppressed globally. Several methods are visibly unreachable or only reachable through tests: `clear_file_changes()`, `file_changes()`, `build_prompt_cache_scope_for_process()`. The blanket allow prevents the compiler from flagging newly introduced dead code.

**Fix:** Remove `dead_code` from the crate-level allow list and fix the reported warnings individually, or annotate specific items with `#[allow(dead_code)]`.

---

### IN-02: `/memory` and `/memory status` handled as the same match arm, but `/memory status` can never be reached

**File:** `rust/crates/rusty-claude-cli/src/main.rs:1113-1115`

**Issue:**
```rust
"/memory" | "/memory status" => {
    cli.print_memory_status();
}
```
The `splitn(2, ' ')` on line 1000 splits on the first space, so `parts[0]` for `/memory status` would be `/memory` and `parts[1]` would be `status`. The match arm `"/memory status"` can never match `parts[0]`; it would only match if the user typed literally `/memory status` without a space between them (impossible). This arm is dead code that was probably intended to be a separate case.

**Fix:** Either remove the `| "/memory status"` arm (since `/memory` and `/memory status` already behave identically), or handle it explicitly after checking `parts.get(1)`.

---

### IN-03: `or(None)` is a no-op

**File:** `rust/crates/rusty-claude-cli/src/main.rs:243`

**Issue:**
```rust
let current = config.get(*var).and_then(|v| v.as_str()).or(None).map(|v| {
```
`.or(None)` on an `Option` is always a no-op (equivalent to the identity function). It should be removed.

**Fix:**
```rust
let current = config.get(*var).and_then(|v| v.as_str()).map(|v| {
```

---

### IN-04: `max_parallel` parsed from CLI but stored via `env::set_var`, overwriting any previously set env var

**File:** `rust/crates/rusty-claude-cli/src/main.rs:626-628`

**Issue:**
```rust
if let Some(val) = max_parallel {
    env::set_var("MAX_PARALLEL_TASKS", val);
}
```
Setting an env var rather than threading the value through function parameters makes it invisible in function signatures and can interfere with sub-processes. It also means the value cannot be changed per-runtime-instance if multiple runtimes are created (e.g., `set_model` rebuilds the runtime but does not re-apply `MAX_PARALLEL_TASKS`). This is a design smell.

**Fix:** Pass `max_parallel` through the `CliAction` variants and `build_runtime` signature instead of using the environment.

---

_Reviewed: 2026-05-08_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
