---
phase: 03-tauri-shell
reviewed: 2026-05-09T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - tauri-app/src-tauri/src/permission_prompter.rs
  - tauri-app/src-tauri/src/commands.rs
  - tauri-app/src-tauri/src/lib.rs
  - tauri-app/src/bindings.ts
  - tauri-app/src-tauri/capabilities/default.json
findings:
  critical: 4
  warning: 4
  info: 2
  total: 10
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-05-09T00:00:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

This review covers the Tauri IPC layer implementing permission prompts, agent lifecycle commands, and event relay. The architecture is generally sound — the locking discipline is careful and the channel setup is correct at a high level. However, four critical defects were found: a mutex-poisoning panic path, a missing cleanup on double-resolve, a shell injection vector in repo root discovery, and an over-broad filesystem capability grant. Four warnings cover correctness and robustness gaps in the channel cleanup and error handling paths.

---

## Critical Issues

### CR-01: Mutex panic on lock poisoning kills the entire Tauri process

**File:** `tauri-app/src-tauri/src/permission_prompter.rs:45,72`

**Issue:** Both `.lock().unwrap()` calls on `PendingPrompts` will panic if the mutex is poisoned. A mutex becomes poisoned any time a thread panics while holding the lock. Because `decide()` is called from `tokio::task::spawn_blocking` (a separate OS thread per invocation), any panic inside that thread while holding the lock — or in a prior call that held the lock and panicked — will poison the mutex permanently. All subsequent calls to `lock().unwrap()` on the same `Arc<Mutex<...>>` will then panic, which propagates through Tauri's invoke handler and kills the application process. This is a crash-on-demand vector for any agent that raises a permission request after a prior panic in the same state.

**Fix:**
```rust
// Replace both .lock().unwrap() calls with proper error handling:

// Line 43-46:
self.pending_prompts
    .lock()
    .map_err(|_| {
        // Poisoned — emit a deny decision rather than crashing
        let _ = self.app_handle.emit("permission-timeout", &prompt_id);
    })
    .ok()?
    // (return PermissionPromptDecision::Deny from the enclosing function)

// Simpler approach: return a deny on poison rather than unwrapping:
let Ok(mut prompts) = self.pending_prompts.lock() else {
    return PermissionPromptDecision::Deny {
        reason: "internal state error".to_string(),
    };
};
```
The same pattern applies at line 72. The `respond_to_permission` command already uses `.map_err(|e| e.to_string())?` and is correctly written.

---

### CR-02: Double-resolve of the same prompt_id is silently allowed — sender cleaned up too late

**File:** `tauri-app/src-tauri/src/commands.rs:59-65`

**Issue:** `respond_to_permission` holds the `PendingPrompts` lock while calling `tx.send(decision)`. The sender (`tx`) is only removed from the map after `recv_timeout` returns in `decide()` (line 72 of `permission_prompter.rs`). During the window between `tx.send()` returning and `decide()` removing the entry, a second call to `respond_to_permission` with the same `prompt_id` will find the sender still present in the map and call `tx.send()` again. The second `send()` will succeed on the channel (mpsc allows multiple sends) but the first decision has already been forwarded — the second send only fills the channel buffer silently. For `PermissionDecision::Allow`, this could grant a tool call twice if the runtime ever re-reads from the channel. More fundamentally it shows the prompt cannot be atomically "consumed" by a responder.

**Fix:** Remove the entry atomically when sending, not after the blocking wait:
```rust
pub fn respond_to_permission(
    pending_prompts: tauri::State<'_, PendingPrompts>,
    prompt_id: String,
    decision: PermissionDecision,
) -> Result<(), String> {
    // Remove (not get) — makes the entry unavailable to any concurrent call
    let tx = pending_prompts
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&prompt_id)
        .ok_or_else(|| format!(
            "prompt_id {prompt_id} not found (may have timed out or already resolved)"
        ))?;
    // Send after releasing the lock — tx is now exclusively owned
    tx.send(decision).map_err(|e| e.to_string())
}
```
This is strictly safer: the entry is gone from the map before `send()`, so no second caller can race in.

---

### CR-03: Shell injection in `repo_root` discovery via `git rev-parse`

**File:** `tauri-app/src-tauri/src/lib.rs:46-53`

**Issue:** The `git` binary is invoked via `std::process::Command` with static arguments — this is not a shell injection in the traditional sense. However, the resulting path is obtained by taking the raw stdout of `git rev-parse --show-toplevel`, trimming whitespace, and constructing a `PathBuf` from it without any sanitization. On Windows, Git can output a path with trailing `\r\n` — the `.trim()` call handles newline characters but does not strip other control characters or guard against a Git installation that has been compromised to output an attacker-controlled path. More concretely: if the application is run from a directory where `git` resolves to an attacker-controlled executable (PATH hijack, common on Windows without full-path specification), the entire `repo_root` passed to `AgentSupervisor` can be an arbitrary path under which `git worktree add` will operate. This creates a potential directory traversal / arbitrary worktree placement vulnerability.

**Fix:** Invoke `git` by its absolute path, or validate that the returned path is underneath the process working directory:
```rust
// Option A: absolute path on Windows (still fragile in CI, but reduces PATH hijack risk):
let git_bin = if cfg!(windows) { "C:\\Program Files\\Git\\cmd\\git.exe" } else { "/usr/bin/git" };

// Option B (preferred): validate the resolved root is an ancestor of cwd
let repo_root = /* ... */;
let cwd = std::env::current_dir().expect("cwd must be accessible");
if !cwd.starts_with(&repo_root) {
    eprintln!("warn: git root {repo_root:?} is not an ancestor of cwd {cwd:?}, using cwd");
    cwd
} else {
    repo_root
}
```

---

### CR-04: `fs:default` capability grants unrestricted filesystem access to the frontend

**File:** `tauri-app/src-tauri/capabilities/default.json:11`

**Issue:** `"fs:default"` in Tauri v2 grants access to the `fs` plugin's entire default permission set, which includes reading and writing files across the user's filesystem (subject to Tauri scope configuration). No `scope` field is present in this capability definition to restrict which paths are accessible. Because the frontend (a webview rendering arbitrary UI) can invoke `fs` plugin commands directly, a cross-site scripting vulnerability or a supply-chain compromise in any frontend dependency would gain read/write access to the user's full filesystem — including SSH keys, shell configs, and the codebase itself. For an AI coding agent application this attack surface is particularly high-value.

**Fix:** Replace `"fs:default"` with the minimum required `fs` permissions, and add a `scope`:
```json
{
  "permissions": [
    "core:default",
    "window-state:default",
    "clipboard-manager:allow-read-text",
    "clipboard-manager:allow-write-text",
    "fs:allow-read-file",
    "fs:allow-write-file"
  ],
  "scope": {
    "allow": [
      "$APPDATA/**",
      "$APPLOG/**"
    ]
  }
}
```
Audit which `fs` operations are actually used and grant only those. If no frontend component currently uses `fs` directly, remove the permission entirely.

---

## Warnings

### WR-01: `test_permission_prompt` background thread leaks if the sender is dropped by `respond_to_permission` before `recv_timeout`

**File:** `tauri-app/src-tauri/src/commands.rs:100-113`

**Issue:** If `respond_to_permission` is called and — per the fix in CR-02 — removes the sender from the map, `rx.recv_timeout` in the background thread will immediately receive `Err(RecvError::Disconnected)` (or succeed with the decision). The `Err` arm at line 107 attempts to remove the entry from `pending_prompts` again, which is a no-op but benign. However, if the current (pre-CR-02 fix) code is in place, the thread holds `rx` alive for 10 seconds while the sender remains in the map, meaning a second `respond_to_permission` call can send a second decision to a now-waiting rx that nobody will ever inspect. The thread then exits normally, but the behavior is undefined from the application's perspective. Even after fixing CR-02, the cleanup on the `Err` path (line 109) is now unreachable for the timeout case only — this is not a resource leak per se, but the comment on line 97-99 becomes misleading.

**Fix:** After applying CR-02, document that the `Err` cleanup arm is the timeout-only path:
```rust
Err(_) => {
    // Only reached on timeout (recv returns Err::Disconnected immediately
    // if the tx was already removed by respond_to_permission, which returns Ok).
    // On genuine timeout, the tx was already removed by respond_to_permission
    // not having been called — clean up the map entry ourselves.
    let _ = pending.lock().map(|mut p| p.remove(&id_clone));
    println!("[smoke-test] permission prompt timed out");
}
```

---

### WR-02: `AlwaysAllow` decision is silently downgraded to `Allow` without notifying the caller

**File:** `tauri-app/src-tauri/src/permission_prompter.rs:76-83`

**Issue:** When the frontend returns `PermissionDecision::AlwaysAllow`, the code maps it to `PermissionPromptDecision::Allow` (line 83) and emits `"policy-update-requested"` (line 81). However, `permissions.rs` line 79 shows that `PermissionPromptDecision::AlwaysAllow` is a valid variant in the runtime enum and is handled identically to `Allow` in `authorize()`. This means the `AlwaysAllow` variant exists in the runtime but is never surfaced from the Tauri prompter — the deferred Phase 4 work will require changing the return value here. If a future developer wires in the Phase 4 policy mutation without noticing this path, the mutation will be missing because the runtime never receives `AlwaysAllow`. The comment mentions Phase 4 but does not mark this as a `TODO` that needs changing, making it a hidden forward-breakage.

**Fix:** Add an explicit `TODO(phase-4)` marker with the required change:
```rust
PermissionDecision::AlwaysAllow => {
    // TODO(phase-4): return PermissionPromptDecision::AlwaysAllow once
    // PermissionPolicy::authorize() mutates in-session policy on that variant.
    // For now, emit a notification and treat as Allow.
    let _ = self.app_handle.emit("policy-update-requested", &prompt_id);
    PermissionPromptDecision::Allow
}
```

---

### WR-03: `typedError` swallows `Error` instances, breaking the return contract for real JS errors

**File:** `tauri-app/src/bindings.ts:75-82`

**Issue:** The `typedError` runtime function at line 79 re-throws `Error` instances (`if (e instanceof Error) throw e`) rather than wrapping them into the `{ status: "error"; error: E }` shape. This means if a Tauri IPC call rejects with an actual `Error` object (e.g., a network-level Tauri transport error), the caller receives a thrown exception rather than the typed error wrapper. Consumers of `spawnAgent`, `stopAgent`, `respondToPermission`, and `testPermissionPrompt` that expect the `{ status: "ok" | "error" }` union will encounter an unhandled exception instead of a handled `{ status: "error" }` result. This is inconsistent behavior: business-level errors (from `Result<_, String>` on the Rust side) become `{ status: "error" }`, but infrastructure-level errors become uncaught exceptions.

**Fix:**
```typescript
async function typedError<T, E>(result: Promise<T>): Promise<{ status: "ok"; data: T } | { status: "error"; error: E }> {
    try {
        return { status: "ok", data: await result };
    } catch (e) {
        // Do NOT re-throw Error instances — wrap everything uniformly
        return { status: "error", error: e as E };
    }
}
```
If re-throwing is intentional for infrastructure errors, document it explicitly so callers know they must also wrap invocations in a try/catch.

---

### WR-04: `spawn_agent` command is not `async` but calls into potentially blocking supervisor code

**File:** `tauri-app/src-tauri/src/commands.rs:17-28`

**Issue:** `spawn_agent` is declared as a synchronous `fn` but calls `supervisor.spawn_agent(&branch)` which internally calls `self.worktree_manager.add()`. `WorktreeManager::add()` runs `git worktree add` as a blocking subprocess (`std::process::Command`). Blocking subprocess execution on Tauri's async invoke thread (the thread Tauri uses to dispatch synchronous commands) can stall the entire IPC handler thread pool under load, delaying all other commands. This is not a correctness bug per se (the command will complete eventually) but it is a robustness issue: a slow git operation (large repo, network filesystem) will block the invoke handler for the duration.

**Fix:** Declare `spawn_agent` as `async` and wrap the blocking call:
```rust
#[tauri::command]
#[specta::specta]
pub async fn spawn_agent(
    supervisor: tauri::State<'_, Arc<AgentSupervisor>>,
    app_handle: AppHandle,
    branch: String,
) -> Result<String, String> {
    let supervisor = supervisor.inner().clone();
    let agent_id = tokio::task::spawn_blocking(move || {
        supervisor.spawn_agent(&branch).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    if let Some(handle) = supervisor.get_handle(&agent_id) {
        spawn_event_relay(app_handle, agent_id.clone(), handle);
    }
    Ok(agent_id.0)
}
```

---

## Info

### IN-01: `println!` debug output left in production smoke-test command

**File:** `tauri-app/src-tauri/src/commands.rs:105,110`

**Issue:** Two `println!` macros are present in `test_permission_prompt`. In Tauri production builds these write to stderr/stdout of the application process, which may not be visible to users and pollutes production logs. The command itself is a smoke-test helper and may be intentional in dev builds, but the prints are unconditional.

**Fix:** Gate behind `#[cfg(debug_assertions)]` or replace with `tracing::debug!` if the project adopts structured logging:
```rust
#[cfg(debug_assertions)]
println!("[smoke-test] permission response received: {:?}", decision);
```

---

### IN-02: `test_permission_prompt` is exposed in production capabilities with no access guard

**File:** `tauri-app/src-tauri/src/lib.rs:20` and `tauri-app/src-tauri/capabilities/default.json`

**Issue:** `test_permission_prompt` is registered in the production `invoke_handler` with no conditional compilation guard (`#[cfg(debug_assertions)]` or similar). The `default.json` capability grants `core:default` which includes the invoke permission for all registered commands. This means in a production build, any frontend code (including injected scripts) can call `test_permission_prompt`, cause a background thread to be spawned, and insert a `prompt_id` into `PendingPrompts` — polluting the map and potentially interfering with real prompts.

**Fix:** Gate the command registration behind a debug flag:
```rust
// In make_builder() or run():
#[cfg(debug_assertions)]
let builder = builder.commands(collect_commands![test_permission_prompt]);
```
Or add it to a separate debug capability not included in the production capability set.

---

_Reviewed: 2026-05-09T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
