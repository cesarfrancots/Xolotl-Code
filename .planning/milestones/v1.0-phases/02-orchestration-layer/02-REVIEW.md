---
phase: 02-orchestration-layer
reviewed: 2026-05-08T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - rust/crates/runtime/Cargo.toml
  - rust/crates/runtime/src/lib.rs
  - rust/crates/runtime/src/subagent/spawner.rs
  - rust/crates/runtime/src/supervisor/agent_state.rs
  - rust/crates/runtime/src/supervisor/context_store.rs
  - rust/crates/runtime/src/supervisor/git_queue.rs
  - rust/crates/runtime/src/supervisor/handle.rs
  - rust/crates/runtime/src/supervisor/mod.rs
  - rust/crates/runtime/src/supervisor/supervisor.rs
  - rust/crates/runtime/src/supervisor/tests.rs
  - rust/crates/runtime/src/supervisor/worktree.rs
findings:
  critical: 4
  warning: 6
  info: 3
  total: 13
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-05-08T00:00:00Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

This phase implements the orchestration layer: a multi-agent supervisor with git worktree isolation, a shared context store, a serialized git op queue, and a sub-agent spawner with retry. The overall architecture is sound and the channel-lifecycle hazard (event_tx drop bug) is well-documented and correctly avoided.

However, several correctness and security defects were found across the spawner, worktree manager, supervisor, and NDJSON reader. The most severe are: a race condition in the timeout/kill path of `spawn_once`; a path injection vector through unvalidated branch names passed directly to `git worktree add`; and a broken-on-error state where `remove()` removes the in-memory map entry but returns an error without removing the on-disk worktree, leaving the map desynchronized.

---

## Critical Issues

### CR-01: Race condition — child process may re-exit between `try_wait` check and `kill` call in `spawn_once`

**File:** `rust/crates/runtime/src/subagent/spawner.rs:240-248`

**Issue:** The timeout guard reads:

```rust
if child.try_wait().map_or(true, |w| w.is_none()) {
    let _ = child.kill();
    return SubAgentResult::failure(..., "task timed out".to_string(), ...);
}
```

`map_or(true, ...)` returns `true` when `try_wait` returns `Err(...)`. This means a transient OS error from `try_wait` (e.g., ECHILD) causes the code to unconditionally kill the child and return a "timed out" failure — masking the real error and incorrectly reporting a timeout for a process that may have already exited successfully. The correct guard is `map_or(false, |w| w.is_none())`: if we cannot determine status, do not assume the process is still running.

**Fix:**
```rust
// Before (incorrect — Err maps to true, kills on OS error)
if child.try_wait().map_or(true, |w| w.is_none()) {

// After (correct — Err maps to false, only kill if definitely still running)
if child.try_wait().map_or(false, |w| w.is_none()) {
    let _ = child.kill();
    return SubAgentResult::failure(
        task_id.to_string(),
        config.description.clone(),
        "task timed out".to_string(),
        started.elapsed(),
    );
}
// If try_wait returned Err, fall through to read the result file normally
```

---

### CR-02: Shell injection / path traversal — branch name is passed unsanitized to `git worktree add`

**File:** `rust/crates/runtime/src/supervisor/worktree.rs:66-69`

**Issue:** The `branch` parameter is passed directly to `git worktree add -b <branch> <path>` as a separate argument (not shell-interpolated), so the branch argument itself cannot be used for classic shell injection. However, git branch names that begin with `-` are treated as flags by git, allowing an attacker (or a misconfigured caller) to inject arbitrary git flags. For example `branch = "--exec=malicious-script"` would be passed to git and could trigger git hooks or unexpected behavior. Additionally, the worktree path is derived from `agent_id.to_string()` without canonicalization or sanitization of the agent ID, so a crafted `AgentId` containing `../` segments could write the worktree outside `.xolotl-worktrees/`.

**Fix:**
```rust
// Validate branch name before calling git
fn validate_branch_name(branch: &str) -> Result<(), WorktreeError> {
    if branch.starts_with('-') {
        return Err(WorktreeError::GitFailed(
            format!("invalid branch name (starts with '-'): {branch}")
        ));
    }
    // Optionally: enforce allowlist regex [a-zA-Z0-9._/-]+
    Ok(())
}

pub fn add(&self, agent_id: &AgentId, branch: &str) -> Result<PathBuf, WorktreeError> {
    validate_branch_name(branch)?;
    // ... rest of fn unchanged
}
```

---

### CR-03: Inconsistent state after `remove()` git failure — map entry removed, directory survives

**File:** `rust/crates/runtime/src/supervisor/worktree.rs:88-108`

**Issue:** `remove()` removes the `AgentId → path` entry from the `active` map *before* calling `git worktree remove`. If the git command fails, the function returns `Err(WorktreeError::GitFailed(...))` — but the map entry is already gone. This leaves the worktree directory on disk with no in-memory record, causing:
1. `manager.list()` no longer shows the agent, so callers believe it was cleaned up.
2. The directory remains on disk, leaking filesystem resources until the next `git worktree prune`.
3. A subsequent `add()` for the same agent ID will attempt to create the same path, which `git worktree add` will reject because the directory already exists.

**Fix:** Remove from the map only after a successful git call, or keep the entry and re-insert on failure:
```rust
pub fn remove(&self, agent_id: &AgentId) -> Result<(), WorktreeError> {
    // Peek the path without removing yet
    let path = {
        let active = self.active.lock().unwrap();
        active.get(agent_id)
            .cloned()
            .ok_or_else(|| WorktreeError::NotAssigned(agent_id.clone()))?
    };

    let path_str = path.to_str().unwrap_or_default();
    let output = std::process::Command::new("git")
        .args(["worktree", "remove", "--force", path_str])
        .current_dir(&self.repo_root)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        return Err(WorktreeError::GitFailed(stderr));
    }

    // Only remove from map after git succeeds
    let mut active = self.active.lock().unwrap();
    active.remove(agent_id);
    Ok(())
}
```

---

### CR-04: `spawn_ndjson_reader` breaks on non-error I/O line endings — silently terminates the read loop early

**File:** `rust/crates/runtime/src/subagent/spawner.rs:322-333`

**Issue:** The NDJSON reader loop uses a `match` where the `_ => break` arm fires on *any* `Err` from `reader.lines()`. A transient I/O error (e.g., `EINTR`, or a spurious line-read error on Windows pipe reads) causes the loop to exit silently, discarding all remaining events from the child process. The child is then `wait()`-ed but its remaining stdout is never consumed. This results in incomplete `Vec<AgentEvent>` being returned without any indication of truncation.

Additionally, the break also fires on `Ok("")` lines only if `line.trim().is_empty()` — but the pattern `_ => break` also fires on `Err` lines from the `lines()` iterator, making transient errors indistinguishable from EOF.

**Fix:**
```rust
for line in reader.lines() {
    match line {
        Ok(line) if !line.trim().is_empty() => {
            if let Ok(event) = serde_json::from_str::<AgentEvent>(&line) {
                events.push(event);
            }
        }
        Ok(_) => {
            // Empty line — skip, continue reading (do not break)
            continue;
        }
        Err(_e) => {
            // Real I/O error — stop reading but do not silently swallow
            break;
        }
    }
}
```

Note: the current code breaks on empty lines too, because `_ => break` is the catch-all. An empty NDJSON line (which is valid as a keepalive in some NDJSON producers) terminates the entire stream.

---

## Warnings

### WR-01: `_cancel_rx` in `spawn_agent` is immediately dropped — control channel is dead on arrival

**File:** `rust/crates/runtime/src/supervisor/supervisor.rs:86`

**Issue:** The cancel receiver is created and then bound to `_cancel_rx` (the leading `_` is a Rust convention meaning "intentionally unused — but do not drop"). However, because it is a local variable with no task or struct to hold it, it is dropped at the end of `spawn_agent`. Once the receiver is dropped, the mpsc channel is closed on the receiver side. Any subsequent `handle.stop().await` or `handle.pause().await` call will silently succeed (the send returns `Ok` until the channel is fully closed), and then fail with a send error once the channel detects the dropped receiver.

More critically, no actual worker task currently consumes from `cancel_rx`. The control loop exists in the API but has no consumer — `AgentControl::Stop/Pause/Resume` signals go nowhere. This means `stop_agent()` sends a Stop signal that is immediately discarded.

**Fix:** Either spawn a worker task that owns `cancel_rx` and acts on control messages, or store `cancel_rx` in the `AgentHandle` / registry until a real consumer is attached. As a minimum fix, do not bind it to `_cancel_rx` — store it in the handle or a registry-side struct so future work can wire up the consumer without a silent behavior difference:
```rust
// In AgentHandle or a new AgentWorker struct, store:
pub cancel_rx: mpsc::Receiver<AgentControl>,
```

---

### WR-02: `spawn_once` uses a blocking poll loop on a tokio thread

**File:** `rust/crates/runtime/src/subagent/spawner.rs:231-238`

**Issue:** The timeout wait loop calls `std::thread::sleep(Duration::from_millis(50))` inside what is an ordinary (non-blocking) function. `spawn()` is called from sync contexts, but `SubAgentSpawner::spawn` is marked `#[must_use]` and is called from sync code — however, if this is ever called from within a `tokio::task::spawn_blocking` context (which the ORC-03 test does for `ConversationRuntime`), the sleep holds the blocking thread for up to `config.timeout` (default: 5 minutes). With `max_blocking_threads(16)` and multiple concurrent spawners, this can exhaust the blocking thread pool and deadlock.

**Fix:** This function should not be called from within `spawn_blocking`. Document this constraint explicitly, or convert the spawner to use `tokio::time::timeout` + `tokio::process::Command` for proper async operation. At minimum, add:
```rust
/// MUST NOT be called from within tokio::task::spawn_blocking.
/// The timeout loop uses std::thread::sleep which holds the blocking thread.
pub fn spawn(&self, config: &SubAgentConfig) -> SubAgentResult {
```

---

### WR-03: `reqwest` with `blocking` feature declared but not used in this crate

**File:** `rust/crates/runtime/Cargo.toml:12`

**Issue:** `reqwest = { workspace = true, features = ["blocking"] }` pulls in the blocking HTTP client. The `blocking` feature spawns its own internal tokio runtime. If the calling code already runs inside a tokio runtime, creating a nested runtime via `reqwest::blocking` will panic at runtime with "Cannot start a runtime from within a runtime." This is a latent runtime-panic risk if any code in the `runtime` crate ever calls `reqwest::blocking` from an async context.

This is in `Cargo.toml` for the runtime crate; if `reqwest::blocking` is only needed in `web_fetch` or another module that is only called from sync contexts, the `blocking` feature should be gated or removed from this crate's feature list to prevent accidental misuse.

**Fix:** Audit which modules use `reqwest::blocking`. If all call sites are already inside `spawn_blocking`, document this. If any call site is in an async context, replace with `reqwest` async API.

---

### WR-04: `spawn_ndjson_reader` is `async` but does no async work — blocks the async executor

**File:** `rust/crates/runtime/src/subagent/spawner.rs:290-337`

**Issue:** The function is declared `async fn spawn_ndjson_reader(...)` but the entire body is synchronous: `std::process::Command::spawn()`, `BufReader::new`, and `reader.lines()` all block the thread. `reader.lines()` will block until the child process closes its stdout, which may take minutes for a long-running subagent. This blocks a tokio worker thread for the entire duration of the child process, violating tokio's rule that async tasks must not block.

**Fix:** Either:
1. Run the blocking read inside `tokio::task::spawn_blocking` and `.await` the handle, or
2. Use `tokio::process::Command` + `tokio::io::AsyncBufReadExt` for truly async line-by-line reading.

```rust
pub async fn spawn_ndjson_reader(
    &self,
    config: &SubAgentConfig,
) -> Result<Vec<AgentEvent>, String> {
    // ... build cmd ...
    let events = tokio::task::spawn_blocking(move || {
        // move child, stdout into blocking closure
        let mut events = Vec::new();
        let reader = std::io::BufReader::new(stdout);
        for line in reader.lines() { /* ... */ }
        let _ = child.wait();
        events
    }).await.map_err(|e| format!("spawn_blocking failed: {e}"))?;
    Ok(events)
}
```

---

### WR-05: `unwrap()` on mutex lock in `current_state` / `set_state` propagates poisoned mutex panic

**File:** `rust/crates/runtime/src/supervisor/handle.rs:107,112`

**Issue:** Both `current_state()` and `set_state()` call `self.state.lock().unwrap()`. If any thread panics while holding the mutex, the mutex becomes poisoned and all subsequent `lock().unwrap()` calls will panic. In a multi-agent supervisor, one panicking agent task can cascade-poison the shared state mutex and bring down all callers of `current_state()` including the supervisor's own `Debug` impl (which calls `current_state()` at line 122).

**Fix:** Handle the poisoned case explicitly:
```rust
pub fn current_state(&self) -> AgentState {
    self.state.lock().unwrap_or_else(|p| p.into_inner()).clone()
}
```

---

### WR-06: `stop_agent` has a TOCTOU window — agent can be double-stopped

**File:** `rust/crates/runtime/src/supervisor/supervisor.rs:135-158`

**Issue:** `stop_agent` reads the handle under lock, drops the lock, sends `Stop`, then re-acquires the lock to remove the entry. Between the two lock acquisitions, a concurrent `stop_all()` call (or another `stop_agent` call for the same ID) can also read the handle, send `Stop` again, and attempt to remove it. The second `registry.remove()` on the same ID will return `None` silently, but `worktree_manager.remove()` will be called twice — the second call returns `WorktreeError::NotAssigned` which is printed to stderr via `eprintln!` but not propagated. This is harmless in the current implementation but indicates the function is not idempotent in a concurrent context and could cause surprising log noise.

**Fix:** Use a single locked critical section that checks-and-removes atomically:
```rust
pub async fn stop_agent(&self, agent_id: &AgentId) -> Result<(), SupervisorError> {
    let handle = {
        let mut registry = self.registry.lock().unwrap();
        registry.remove(agent_id)
            .ok_or_else(|| SupervisorError::NotFound(agent_id.clone()))?
    };
    handle.stop().await;
    if let Err(e) = self.worktree_manager.remove(agent_id) {
        eprintln!("warn: failed to remove worktree for {agent_id}: {e}");
    }
    Ok(())
}
```

---

## Info

### IN-01: `max_total_budget_tokens` field is set but never read

**File:** `rust/crates/runtime/src/subagent/spawner.rs:113,128-130`

**Issue:** `SubAgentSpawner` has a `max_total_budget_tokens: Option<usize>` field and a `with_max_total_budget()` builder method, but neither `spawn()` nor `spawn_once()` reads this field to enforce a total budget across all spawned subagents. The per-agent `token_budget` check (lines 259-272) enforces individual budgets, but the advertised global ceiling silently does nothing.

**Fix:** Either implement the total-budget enforcement in `spawn()`, or remove the field and builder method until the feature is implemented.

---

### IN-02: `AgentId::new()` and `SubAgentConfig::generate_task_id()` use separate counters — IDs can collide

**File:** `rust/crates/runtime/src/supervisor/agent_state.rs:14-18`, `rust/crates/runtime/src/subagent/spawner.rs:10,106-108`

**Issue:** `AgentId` uses a static counter producing `"agent-0"`, `"agent-1"`, etc. `SubAgentConfig::generate_task_id()` uses a separate static counter producing `"subagent-0"`, `"subagent-1"`, etc. These counters are independent and in separate namespaces (different prefixes), so they do not collide with each other. However, both counters are process-global and use `Ordering::Relaxed`, which provides no cross-thread ordering guarantees. On targets where `usize` writes are not atomic at the hardware level, `Relaxed` for a fetch_add is safe (it is atomic by definition), but the lack of ordering means the returned counter value is not globally ordered — two threads may receive the same counter value if the increment has not propagated. In practice, `fetch_add` on x86 is always sequentially consistent, but this is a portability assumption. Using `Ordering::SeqCst` or `Ordering::AcqRel` is more correct for unique-ID generation.

**Fix:** Change `Ordering::Relaxed` to `Ordering::Relaxed` is actually safe for `fetch_add` uniqueness on all platforms (fetch_add is always atomic), but document this clearly, as the relaxed ordering only affects the ordering of other memory operations — not the atomicity of the increment itself. No code change strictly required; add a comment:
```rust
// Ordering::Relaxed is sufficient for counter uniqueness:
// fetch_add is always atomic (indivisible), so Relaxed does not risk duplicates.
// Relaxed only means other memory ops around this may be reordered — not the add itself.
let n = COUNTER.fetch_add(1, Ordering::Relaxed);
```

---

### IN-03: `to_str().unwrap_or_default()` silently passes empty string to git on non-UTF-8 paths

**File:** `rust/crates/runtime/src/supervisor/worktree.rs:64,96`

**Issue:** Both `add()` and `remove()` use `path.to_str().unwrap_or_default()` to convert the worktree path to a string. On platforms with non-UTF-8 filesystem paths (Linux with arbitrary byte paths), this silently falls back to `""` (empty string). An empty string passed as the `git worktree add` path argument will cause git to fail with a confusing error, and the returned `WorktreeError::GitFailed(stderr)` message will not indicate that the path could not be converted. The same issue exists in `spawn_once` at line 184.

**Fix:** Return an error instead of silently substituting:
```rust
let path_str = path.to_str()
    .ok_or_else(|| WorktreeError::GitFailed(
        format!("worktree path is not valid UTF-8: {path:?}")
    ))?;
```

---

_Reviewed: 2026-05-08T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
