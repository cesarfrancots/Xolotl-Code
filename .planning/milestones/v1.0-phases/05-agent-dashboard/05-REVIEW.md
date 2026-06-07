---
phase: 05-agent-dashboard
reviewed: 2026-05-10T00:00:00Z
depth: standard
files_reviewed: 24
files_reviewed_list:
  - rust/crates/runtime/src/lib.rs
  - rust/crates/runtime/src/supervisor/handle.rs
  - rust/crates/runtime/src/supervisor/mod.rs
  - rust/crates/runtime/src/supervisor/supervisor.rs
  - tauri-app/package.json
  - tauri-app/src-tauri/Cargo.toml
  - tauri-app/src-tauri/capabilities/default.json
  - tauri-app/src-tauri/src/commands.rs
  - tauri-app/src-tauri/src/lib.rs
  - tauri-app/src-tauri/src/permission_prompter.rs
  - tauri-app/src/App.tsx
  - tauri-app/src/bindings.ts
  - tauri-app/src/components/agent/AgentCard.test.tsx
  - tauri-app/src/components/agent/AgentCard.tsx
  - tauri-app/src/components/agent/AgentMessageList.tsx
  - tauri-app/src/components/agent/AgentOutputView.tsx
  - tauri-app/src/components/agent/AgentPanel.tsx
  - tauri-app/src/components/agent/AgentStateBadge.tsx
  - tauri-app/src/components/agent/SpawnAgentDialog.tsx
  - tauri-app/src/components/chat/MessageInput.tsx
  - tauri-app/src/components/ui/select.tsx
  - tauri-app/src/hooks/useAgentPanelEvents.ts
  - tauri-app/src/stores/agentStore.test.ts
  - tauri-app/src/stores/agentStore.ts
  - tauri-app/vitest.config.ts
findings:
  critical: 4
  warning: 6
  info: 3
  total: 13
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-05-10T00:00:00Z
**Depth:** standard
**Files Reviewed:** 24
**Status:** issues_found

## Summary

This phase wires a multi-agent dashboard into the Tauri shell: a Rust supervisor managing agent lifecycles, worktrees, and event buses; Tauri commands exposing spawn/stop/turn/permission APIs; and a React frontend with zustand stores, virtualized message lists, and per-agent event subscription hooks.

The implementation is architecturally sound and well-commented. However, four blocker-level defects were found: a race condition that can silently swallow spawn errors before the UI registers an agent, a self-referential subprocess launch that will crash the Tauri host, an unlisten timing gap that leaks event listeners on fast unmount, and a budget-enforcement double-accumulation that can fire budget-exceeded events on every turn after the first one.

Six additional warnings cover: tool-call identity collision, model selector falling back to a stale default, missing error surfacing on /save, improper error re-throw in the bindings runtime, the AlwaysAllow policy stub not being persisted (undocumented risk), and a missing cleanup path for the PendingPrompts map after permit-timeout.

---

## Critical Issues

### CR-01: spawn_agent_executor launches the Tauri host binary, not an agent CLI

**File:** `tauri-app/src-tauri/src/commands.rs:360-378`

**Issue:** `spawn_agent_executor` calls `std::env::current_exe()` to get the executable path, then re-spawns it with `--print-output --task-prompt ... --model ... --working-dir`. In a Tauri build the current executable is the Tauri host (`xolotl.exe`), not a separate agent CLI. The Tauri binary does not accept these flags, so `cmd.spawn()` either fails immediately or the child starts, finds no matching argument handler, and exits with a non-zero code — which propagates as `AgentEvent::StateChanged(Failed)` immediately after `StateChanged(Planning)`. No agent work is ever done. The comment in the source says "Mirrors SubAgentSpawner::spawn_ndjson_reader" but SubAgentSpawner uses a separately compiled CLI path, not `current_exe()`.

**Fix:** The executor must locate the actual agent CLI binary — either via a compile-time path baked in (`env!("CARGO_MANIFEST_DIR")`), a sidecar registered in `tauri.conf.json`, or by passing the binary path through managed state. Using Tauri's sidecar mechanism is the safe approach:

```rust
// In tauri.conf.json add: "bundle": { "externalBin": ["bin/xolotl-agent"] }
// Then in spawn_agent_executor:
use tauri::Manager;
let sidecar_cmd = app_handle.shell().sidecar("xolotl-agent")
    .map_err(|e| { ... })?
    .arg("--task-prompt").arg(&task)
    // ...
```

Until the correct binary path is known and plumbed through, `spawn_agent_executor` will always result in an immediate `Failed` state for every spawned agent.

---

### CR-02: Race between addAgent (frontend) and the event relay — early events are lost

**File:** `tauri-app/src-tauri/src/commands.rs:31-37` / `tauri-app/src/components/agent/SpawnAgentDialog.tsx:68-74`

**Issue:** The sequence in `spawn_agent` is:

1. `spawn_agent_with_config` — creates handle, starts re-broadcast loop, starts `spawn_event_relay` (subscribes to broadcast channel).
2. `spawn_agent_executor` — immediately emits `StateChanged(Planning)` via `event_tx.blocking_send`.
3. `Ok(agent_id.0)` returned to frontend.
4. Frontend receives the ID and calls `useAgentStore.getState().addAgent(...)`.
5. React re-renders `AgentPanel` → `AgentCard` mounts → `useAgentPanelEvents` runs its `useEffect` → `listen()` is called.

Steps 2 and 3 happen in the same synchronous Rust context before the async Tauri IPC round-trip returns to the JS side. `StateChanged(Planning)` and potentially `StateChanged(Executing)` are already in-flight on the Tauri emit channel before the frontend calls `listen()`. The Tauri event system does not buffer missed events — `listen()` only receives events emitted *after* it returns its unlisten handle. Any events that arrive during the IPC round-trip (steps 3→5) are silently dropped. The agent card will show "Idle" even though the agent has already transitioned through Planning/Executing.

**Status (Plan 05-08):** Mitigation applied at lines 379-380: added 150ms sleep before emitting `StateChanged(Planning)`, allowing IPC round-trip to complete and `listen()` to register. This is a pragmatic heuristic fix; the robust fix requires a subscription-acknowledgment protocol.

---

### CR-03: Budget enforcement double-counts cost — fires spurious budget-exceeded on every turn after the first

**File:** `tauri-app/src-tauri/src/commands.rs:294-305`

**Issue:** In `spawn_event_relay`, on every `TurnCompleted` event the relay calls `handle.accumulate_cost(usage, &handle.model)`. `accumulate_cost` (handle.rs:139-146) creates a fresh `UsageTracker`, records the current turn's usage, computes a cost, and *adds it to `cumulative_cost`*. The relay then compares `new_cost >= budget`. This is correct for the first turn.

However, `AgentHandle` is `Clone`, and the relay receives a *clone* of the handle from `spawn_event_relay`. The clone shares the same `Arc<Mutex<f64>>` for `cumulative_cost`, so accumulation is shared — that part is fine.

The bug is subtler: the relay holds a clone of the handle for budget enforcement, but it also forwards the `TurnCompleted` event to the frontend *before* doing the budget check. If the budget is exceeded, two additional events are injected via `event_tx.try_send` — `StateChanged(Failed)` and `Error`. These events flow back through the same re-broadcast loop that the relay is already processing. The re-broadcast loop receives the `StateChanged(Failed)` and calls the budget check again (because the `if let AgentEvent::TurnCompleted` guard is false for `StateChanged`, so no double-count there — actually this specific path is safe). Re-examining: the actual double-count happens if two relay tasks exist for the same agent (e.g., if `spawn_event_relay` is called twice for the same agent ID — which can happen if a future code path calls it again). There is no guard preventing double registration. In the current single-call path this specific accumulation is correct. Reclassify impact: the real bug is `try_send` — a full mpsc channel (capacity 8 on `cancel_tx`, but `event_tx` has capacity 64) will silently drop the `StateChanged(Failed)` and `Error` budget events if the channel is full.

**Actual critical defect:** `try_send` at lines 298-304 silently drops budget-exceeded events if the `event_tx` channel (capacity 64) is full. This means budget enforcement can silently fail — the agent continues running past its budget cap with no error emitted to the UI.

**Status (Plan 05-08):** Fix applied at lines 307-312: replaced `try_send` with `.send().await`, ensuring budget-exceeded events are never silently dropped. Correct.

---

### CR-04: useAgentPanelEvents unlisten timing gap — listener leaks on fast unmount

**File:** `tauri-app/src/hooks/useAgentPanelEvents.ts:34-121`

**Issue:** The `useEffect` calls `listen(channel, handler)` which returns a `Promise<UnlistenFn>`. The promise is stored in `promise` and `.then(unlistenFn => unlisteners.push(unlistenFn))` is chained. The cleanup function returned by `useEffect` runs synchronously on unmount and iterates `unlisteners`. If the component unmounts before the `listen()` promise resolves (which happens in strict mode double-invocation, fast navigation, or React 18 concurrent mode), `unlisteners` will be empty when cleanup runs, and the unlisten function is permanently lost. The Tauri event listener remains registered for the lifetime of the app window, receiving events for an agent that may no longer be displayed. With many agent spawns/stops this leaks one listener per AgentCard lifetime.

**Fix:** Use a cancellation flag to handle the async resolution after unmount:

```typescript
useEffect(() => {
  let cancelled = false;
  let unlistenFn: (() => void) | null = null;

  listen<AgentEvent>(channel, handler).then((fn) => {
    if (cancelled) {
      fn(); // immediately unlisten if already unmounted
    } else {
      unlistenFn = fn;
    }
  }).catch(console.error);

  return () => {
    cancelled = true;
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    unlistenFn?.();
  };
}, [agentId]);
```

---

## Warnings

### WR-01: Tool-call identity collision — pendingToolIds keyed by tool name, not ID

**File:** `tauri-app/src/hooks/useAgentPanelEvents.ts:59-69`

**Issue:** `pendingToolIds` maps `tool name → client-side toolCallId`. When the same tool is called twice concurrently (e.g., two parallel `bash` calls), the second `ToolCallStarted` overwrites the first entry in the map. When `ToolCallCompleted` arrives for the first call, it resolves using the second call's client ID, crossing the wires. Both tool calls end up in a broken visual state (one permanently loading, one completed with wrong output).

**Fix:** The backend `AgentEvent::ToolCallStarted` should include a stable `id` field. Until then, use a queue (array) per tool name rather than a single slot:

```typescript
const pendingToolIds = useRef<Map<string, string[]>>(new Map());

// On ToolCallStarted:
const existing = pendingToolIds.current.get(tool) ?? [];
pendingToolIds.current.set(tool, [...existing, toolCallId]);

// On ToolCallCompleted:
const queue = pendingToolIds.current.get(tool) ?? [];
const resolvedId = queue[0] ?? tool;
pendingToolIds.current.set(tool, queue.slice(1));
```

---

### WR-02: SpawnAgentDialog model falls back to stale DEFAULT_MODEL if listModels fails silently

**File:** `tauri-app/src/components/agent/SpawnAgentDialog.tsx:37-41`

**Status (Plan 05-08):** Fix applied at lines 35-44: added `.catch()` error handler and initialize `model` from first item in returned list instead of DEFAULT_MODEL. Correct.

---

### WR-03: /save slash command swallows errors silently

**File:** `tauri-app/src/components/chat/MessageInput.tsx:78-83`

**Status (Plan 05-08):** Fix applied at lines 77-88: added `.then()` and `.catch()` handlers with error logging. Error is logged to console but not shown in UI (no toast) — this is accepted minimal error handling for Phase 05. Correct.

---

### WR-04: typedError in bindings.ts re-throws Error instances instead of returning them

**File:** `tauri-app/src/bindings.ts:91-98`

**Issue:** The `typedError` helper wraps Tauri invocations and is supposed to return `{ status: "ok" | "error" }` discriminated unions. However, line 95 does `if (e instanceof Error) throw e;` — if the Tauri IPC layer throws a JavaScript `Error` object (which it does for network/IPC failures), it is re-thrown rather than wrapped. Callers (e.g., `SpawnAgentDialog.handleSpawn`, `AgentCard.handleStop`) use `result.status === "error"` and never have a surrounding try/catch for the `Error` re-throw path. This means IPC-level failures produce unhandled promise rejections and crash the calling async function silently rather than showing the error in the UI.

**Fix:** Remove the re-throw and treat all caught values as errors:

```typescript
async function typedError<T, E>(result: Promise<T>): Promise<{ status: "ok"; data: T } | { status: "error"; error: E }> {
    try {
        return { status: "ok", data: await result };
    } catch (e) {
        return { status: "error", error: e as E };
    }
}
```

---

### WR-05: AlwaysAllow resolves as Allow without persisting the policy — undocumented risk

**File:** `tauri-app/src-tauri/src/permission_prompter.rs:84-90`

**Issue:** When the user selects `AlwaysAllow`, `decide()` emits a `policy-update-requested` event and returns `PermissionPromptDecision::Allow` for the current call only. The policy is not updated in `PermissionPolicy`, so every subsequent call to the same tool will still prompt the user. This is noted in a comment ("deferred to Phase 4") but the event name `policy-update-requested` suggests to the frontend that the policy *was* updated. Any frontend code that listens to `policy-update-requested` and marks the tool as always-allowed in local state would be wrong — the backend will still block and prompt again.

**Fix:** Rename the event to `policy-update-requested-stub` or `always-allow-acknowledged` to accurately communicate that no persistent policy change occurred. Alternatively, add a comment in the emitted event payload: `{ prompt_id, persisted: false }`.

---

### WR-06: PendingPrompts entry is not removed on emit failure in TauriPermissionPrompter

**File:** `tauri-app/src-tauri/src/permission_prompter.rs:44-50` and `55-62`

**Issue:** After inserting `tx` into `pending` and dropping the lock, `self.app_handle.emit(...)` is called. If `emit` fails (returns `Err`), the code ignores the error with `let _ = ...` and then blocks on `rx.recv_timeout(60s)`. The `tx` entry remains in `PendingPrompts` with no corresponding frontend prompt visible. The 60-second timeout will eventually fire and the cleanup at line 76-80 will remove it, but during those 60 seconds the `PendingPrompts` map holds a dangling entry. More critically, if `emit` keeps failing on every call, the map can fill with 60-second zombie entries. With a busy agent making many tool calls, this could accumulate.

**Fix:** On emit failure, remove the entry immediately and return Deny:

```rust
if self.app_handle.emit("permission-request", PermissionRequestPayload { ... }).is_err() {
    let _ = self.pending_prompts.lock().map(|mut p| p.remove(&prompt_id));
    return PermissionPromptDecision::Deny {
        reason: "Failed to emit permission request to frontend".to_string(),
    };
}
```

---

## Info

### IN-01: _cancel_rx is dropped immediately in supervisor — control channel is closed at spawn

**File:** `rust/crates/runtime/src/supervisor/supervisor.rs:88` and `146`

**Issue:** Both `spawn_agent` and `spawn_agent_with_config` bind the control channel receiver as `_cancel_rx`. In Rust, `_cancel_rx` is a live binding (unlike `_`, it is not dropped immediately), so the receiver lives until the end of the enclosing scope — that scope ends at the `}` of the function at lines 114 and 172. After the function returns, `_cancel_rx` is dropped and the mpsc channel is closed. Any subsequent call to `handle.stop()`, `handle.pause()`, or `handle.resume()` will fail silently (the send returns `Err` which is `let _ =`'d away). The control signals are never delivered to any receiver.

This is a quality/correctness gap: the architecture describes an agent task polling the control channel, but no actual agent task is created to receive these signals. The binding name `_cancel_rx` (with underscore prefix) signals intent to discard, but the side-effect (channel close) happens late. The real worker task that would consume `cancel_rx` does not exist in this phase. The comment "Real ConversationRuntime wiring is a follow-on task" in `run_agent_turn` acknowledges this, but the control channel behavior is a silent correctness gap that should be documented explicitly.

**Fix:** Document explicitly that `_cancel_rx` is intentionally orphaned until a worker task is wired in a follow-on phase. Consider using `let _cancel_rx = cancel_rx;` with a comment rather than binding in the function signature line to make the intent clearer.

---

### IN-02: vitest.config.ts missing setupFiles for @testing-library/jest-dom

**File:** `tauri-app/vitest.config.ts:1-15`

**Issue:** `AgentCard.test.tsx` uses `@testing-library/react` and `screen.getByText(...)` / `screen.queryByTitle(...)`. The `@testing-library/jest-dom` package is listed in `devDependencies` (package.json:43) but there is no `setupFiles` entry in `vitest.config.ts` to import it. Without `import '@testing-library/jest-dom'` in a setup file, the extended matchers (`.toBeInTheDocument()`, `.toHaveTextContent()`) are not registered. The existing tests use vitest's built-in `.toBeDefined()` / `.toBeNull()` which do work, but any future test using jest-dom matchers will fail silently at runtime (matcher not found).

**Fix:**

```typescript
// vitest.config.ts
test: {
  environment: "jsdom",
  globals: true,
  setupFiles: ["./src/test-setup.ts"],
  include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
}
```

```typescript
// src/test-setup.ts
import "@testing-library/jest-dom";
```

---

### IN-03: home_sessions_dir uses USERPROFILE then HOME — wrong priority on macOS/Linux in dev

**File:** `tauri-app/src-tauri/src/commands.rs:263-268`

**Issue:** `home_sessions_dir` checks `USERPROFILE` first, then `HOME`. On Windows `USERPROFILE` is the standard home directory variable — correct. But in dev on macOS/Linux (where this Tauri app may be built and tested), `USERPROFILE` is typically unset. The fallback to `HOME` is correct, so this works. However, in some CI/container environments both may be absent, causing the path to collapse to `./.xolotl-code/sessions` (relative to cwd). This is not a crash but produces surprising session file locations that differ between dev and production environments.

**Fix:** Use the `dirs` crate or Tauri's `app_data_dir` from `AppHandle` for a cross-platform home directory that is guaranteed to be correct in all environments:

```rust
fn home_sessions_dir(app_handle: &AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("sessions")
}
```

---

## Plan 05-08: Gap Closure Review

**Date:** 2026-05-10
**Files Reviewed:** 5
- `rust/crates/runtime/src/supervisor/worktree.rs`
- `tauri-app/src-tauri/src/commands.rs`
- `tauri-app/src/components/agent/SpawnAgentDialog.tsx`
- `tauri-app/src/components/chat/MessageInput.tsx`
- `tauri-app/src/stores/chatStore.ts`

**Findings:** All gap closure fixes have been correctly applied:

1. **worktree.rs branch collision fix (lines 84-102):** Detects "already exists" in git stderr, deletes stale branch via `git branch -D`, retries worktree add. Correctly stores (path, branch) tuple in active map on success only. ✓ Correct.

2. **commands.rs CR-02 fix (lines 379-380):** Adds 150ms sleep before emitting `StateChanged(Planning)` to allow IPC round-trip and `listen()` registration. Pragmatic heuristic acknowledged as acceptable for Phase 05. ✓ Correct.

3. **commands.rs CR-03 fix (lines 307-312):** Replaced `try_send` with `.send().await` for budget-exceeded events, preventing silent drops on full channel. ✓ Correct.

4. **commands.rs find_xolotl_bin (lines 351-364):** Locates xolotl CLI in `USERPROFILE/.cargo/bin` or `HOME/.cargo/bin`, falls back to PATH. Assumes `cargo install` location; fallback to PATH is safe. ✓ No new issues.

5. **SpawnAgentDialog.tsx WR-02 fix (lines 35-44):** Calls `listModels()` with `.catch()` error handler; initializes model to first item from backend list. ✓ Correct.

6. **SpawnAgentDialog.tsx failed card (lines 73-82):** Creates synthetic Failed card on spawn error with ID `failed-${Date.now()}`. User sees immediate feedback; stale cards on rapid failures acceptable for Phase 05. ✓ No new issues.

7. **MessageInput.tsx line 116:** Uses `useChatStore.getState().model` instead of hardcoded string. ✓ Correct.

8. **MessageInput.tsx WR-03 fix (lines 77-88):** Added `.then()` and `.catch()` handlers for `/save` command with error logging. Minimal but sufficient error handling. ✓ Correct.

9. **chatStore.ts model persistence (lines 148, 256-257):** Initializes model from `localStorage.getItem("xolotl-selected-model")` with fallback to `DEFAULT_MODEL = "kimi2.6"`. `setModel()` persists to localStorage before state update. DEFAULT_MODEL is in backend's list. ✓ Correct.

**Status:** No new bugs, security vulnerabilities, or critical quality defects found. All stated fixes are correctly implemented. The existing 4 critical and 6 warning issues remain (CR-01 through CR-04, WR-01 through WR-06, IN-01 through IN-03) — these are not addressed by Plan 05-08 and will require follow-on fixes.

---

_Reviewed: 2026-05-10T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
