---
phase: 04-chat-ui
reviewed: 2026-05-10T00:00:00Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - tauri-app/src/App.tsx
  - tauri-app/src/bindings.ts
  - tauri-app/src/components/chat/ChatPane.tsx
  - tauri-app/src/components/chat/DiffView.tsx
  - tauri-app/src/components/chat/MarkdownRenderer.tsx
  - tauri-app/src/components/chat/Message.tsx
  - tauri-app/src/components/chat/MessageInput.tsx
  - tauri-app/src/components/chat/MessageList.tsx
  - tauri-app/src/components/chat/PermissionCard.tsx
  - tauri-app/src/components/chat/ToolBlock.tsx
  - tauri-app/src/components/sidebar/SessionItem.tsx
  - tauri-app/src/components/sidebar/SessionSidebar.tsx
  - tauri-app/src/hooks/useAgentEvents.ts
  - tauri-app/src/lib/cost.ts
  - tauri-app/src/lib/diff.ts
  - tauri-app/src/stores/chatStore.ts
  - tauri-app/src/stores/sessionStore.ts
  - tauri-app/src-tauri/src/commands.rs
  - tauri-app/src-tauri/src/lib.rs
  - tauri-app/src-tauri/src/permission_prompter.rs
findings:
  critical: 4
  warning: 7
  info: 3
  total: 14
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-05-10T00:00:00Z
**Depth:** standard
**Files Reviewed:** 20
**Status:** issues_found

## Summary

Phase 04 delivers the full chat UI: message list, streaming, tool blocks, permission cards, session sidebar, and backend session persistence. The architecture is sound and several hard problems (rAF delta buffering, virtualizer scroll, permission round-trip) are handled with documented intent.

However, four correctness bugs were found that can cause silent data loss or observable broken behavior in production:

1. A listener-cleanup race in `useAgentEvents` guarantees event listeners leak on fast unmount.
2. Concurrent same-tool calls corrupt tool-call slot matching.
3. `PermissionItem` objects are silently serialized into saved session files, preventing correct session reload.
4. `finalizeStream` silently no-ops on tool-only turns, losing usage accumulation.

---

## Critical Issues

### CR-01: Tauri event listeners always leak on fast unmount

**File:** `tauri-app/src/hooks/useAgentEvents.ts:148-187`

**Issue:** Both `listen()` calls return `Promise<UnlistenFn>`. The cleanup function (returned from `useEffect`) runs synchronously, iterates `unlisteners[]`, and calls each unlisten. But `unlisteners` is populated by `.then()` callbacks that are microtasks — they may not have run yet when React calls the cleanup. If the component unmounts before the promises resolve (common during strict-mode double-invoke, rapid navigation, or test teardown), `unlisteners` is empty and both Tauri event listeners are leaked for the lifetime of the window. Every subsequent `agentId` change then adds more leaked listeners that fire duplicate state updates.

**Fix:** Collect the promises and await them before registering, or use a pattern that captures the unlisten functions synchronously. The idiomatic fix:

```typescript
useEffect(() => {
  if (!agentId) return;

  let agentUnlisten: (() => void) | null = null;
  let permUnlisten: (() => void) | null = null;
  let cancelled = false;

  const agentChannel = `agent-event:${agentId}`;

  Promise.all([
    listen<AgentEvent>(agentChannel, (event) => { /* ... same handler ... */ }),
    listen<PermissionRequestPayload>("permission-request", (event) => { /* ... same handler ... */ }),
  ]).then(([ag, perm]) => {
    if (cancelled) {
      ag();
      perm();
      return;
    }
    agentUnlisten = ag;
    permUnlisten = perm;
  });

  return () => {
    cancelled = true;
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    agentUnlisten?.();
    permUnlisten?.();
  };
}, [agentId]);
```

---

### CR-02: PermissionItem objects silently written into saved session files

**File:** `tauri-app/src/hooks/useAgentEvents.ts:113-115`
**Also:** `tauri-app/src/components/chat/MessageInput.tsx:81`

**Issue:** Both auto-save (after TurnCompleted) and `/save` command pass `state.items` / `chatStore.items` to `serializeSession`, which expects `Message[]`. The `items` array is typed `ChatItem[]` and can contain `PermissionItem` objects (type: "permission"). These are silently cast with `as any` / `as Parameters<typeof serializeSession>[2]` and written to disk as session JSON. When the session is loaded back, the hydration code will encounter objects with `type: "permission"` where it expects `Message` objects, producing undefined behavior (wrong renders, possible crashes in `MessageItem`).

**Fix:** Filter items before serializing to strip permission entries:

```typescript
// In useAgentEvents.ts TurnCompleted handler:
const messages = state.items.filter(
  (item): item is Message => (item as PermissionItem).type !== "permission"
);
void sessionStore.saveSession(
  sessionId,
  serializeSession(sessionId, state.model, messages, state.sessionUsage)
);

// In MessageInput.tsx /save case:
const messages = (chatStore.items as ChatItem[]).filter(
  (item): item is Message => (item as PermissionItem).type !== "permission"
);
void commands.saveSession(
  saveId,
  serializeSession(saveId, chatStore.model, messages, chatStore.sessionUsage)
);
```

Also update `serializeSession` signature to accept `ChatItem[]` and filter internally, or keep `Message[]` and enforce the filter at call sites.

---

### CR-03: finalizeStream silently no-ops on tool-only turns, losing usage

**File:** `tauri-app/src/stores/chatStore.ts:157-173`

**Issue:** `finalizeStream` has this guard:

```typescript
if (!state.streamingContent && !state.isStreaming) return state;
```

`isStreaming` is only set to `true` inside `appendStreamingContent`. If an agent turn emits only tool calls with no `TextDelta` events (a valid scenario — e.g., the agent invokes a tool without narrating), `streamingContent` stays `""` and `isStreaming` stays `false`. When `TurnCompleted` fires, `finalizeStream` hits the guard and returns early without:
- Accumulating the turn's `usage` into `sessionUsage`
- Committing any pending state

The cost bar will always show `$0.0000 · 0 tok` for tool-only turns, silently under-counting cost.

**Fix:** Decouple "a turn is in progress" tracking from text streaming. Set `isStreaming: true` in `startToolCall` when there are no prior assistant messages, and in `run_agent_turn` / `StateChanged(Executing)` via a dedicated action. Alternatively, relax the guard:

```typescript
finalizeStream: (usage) =>
  set((state) => {
    // Always accumulate usage; only add a message if there was streamed content
    const newItems = state.streamingContent
      ? [
          ...state.items,
          {
            id: generateId(),
            role: "assistant" as const,
            content: state.streamingContent,
            toolCalls: [],
            usage,
          },
        ]
      : state.items;
    return {
      items: newItems,
      streamingContent: "",
      isStreaming: false,
      sessionUsage: addUsage(state.sessionUsage, usage),
    };
  }),
```

---

### CR-04: completeToolCall matches by tool name only — breaks concurrent same-tool calls

**File:** `tauri-app/src/stores/chatStore.ts:217-228`

**Issue:** `completeToolCall(tool, output)` finds the first `ToolCall` whose `.tool === tool && .loading === true` and updates it. The backend's `ToolCallCompleted` event only carries `tool` and `output` — no call ID. If an agent runs the same tool twice in one turn (e.g., two `bash` calls), the second `ToolCallCompleted` event will match the first loading slot whose `tool === "bash"`, leaving the second slot stuck in `loading: true` forever. This is a UI freeze: the spinner on the second tool block never goes away.

**Fix:** Either:

a) Have the backend include a stable call ID in both `ToolCallStarted` and `ToolCallCompleted`, and match on that ID. This requires a Rust-side change to `AgentEvent`.

b) Track in-flight tool calls in insertion order and match `completeToolCall` by FIFO position within the same tool name (less robust but avoids Rust changes):

```typescript
completeToolCall: (tool, output) =>
  set((state) => {
    let matched = false;
    const items = state.items.map((item) => {
      if ((item as Message).role !== "assistant") return item;
      const msg = item as Message;
      const toolCalls = msg.toolCalls.map((tc) => {
        if (!matched && tc.tool === tool && tc.loading) {
          matched = true;
          return { ...tc, output, loading: false };
        }
        return tc;
      });
      return { ...msg, toolCalls };
    });
    return { items };
  }),
```

This at least ensures only one slot is updated per event, not all matching slots.

---

## Warnings

### WR-01: typedError rethrows JavaScript Error instances as unhandled rejections

**File:** `tauri-app/src/bindings.ts:96-98`

**Issue:**
```typescript
if (e instanceof Error) throw e;
return { status: "error", error: e as any };
```

When Tauri's `invoke` rejects with a JavaScript `Error` object (e.g., network failure, serialization error), `typedError` rethrows it. Every call site uses `void` or awaits without a `.catch()` fallback (`void commands.listModels().then(...)`, `void commands.saveSession(...)`, etc.). These become unhandled promise rejections — silently swallowed in production builds, crashes the WebView2 process in some configurations.

**Fix:** Remove the rethrow or wrap all thrown Errors:

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

### WR-02: MessageList accesses items[vItem.index] without bounds guard

**File:** `tauri-app/src/components/chat/MessageList.tsx:89`

**Issue:**
```tsx
<MessageItem item={items[vItem.index]} />
```

`totalCount` is computed as `items.length + (isStreaming ? 1 : 0)` at the time the virtualizer is configured. If `items` shrinks between a render frame (e.g., `clearSession()` fires while virtual items are still being rendered), `items[vItem.index]` returns `undefined`. `MessageItem` receives `undefined` as `item` and will throw when it tries to access `item.type` or cast to `Message`.

**Fix:** Add a guard:

```tsx
const item = items[vItem.index];
if (!item) return null;
return <MessageItem item={item} />;
```

---

### WR-03: handleResumeSession does not hydrate chatStore — loading a session shows stale chat

**File:** `tauri-app/src/components/sidebar/SessionSidebar.tsx:28-31`

**Issue:**
```typescript
function handleResumeSession(id: string) {
  setActiveSessionId(id);
  // Wave 3 plan will wire loadSession() → hydrate chatStore
}
```

Clicking a session in the sidebar sets `activeSessionId` but does not load the session content into `chatStore`. The chat pane continues showing whatever was in memory. The comment defers this to "Wave 3," but there is no guard preventing the user from clicking sessions now, creating a confusing UX where the active session indicator changes but the chat content does not change. The `/save` command also saves with `activeSessionId`, meaning a subsequent auto-save after a new turn will overwrite the selected (but not loaded) session file with the current (different session's) content.

**Fix (short-term):** Disable the SessionItem click handler until wave 3 wiring is complete, or show a "loading" indicator and no-op the save path if `activeSessionId` doesn't match the current in-memory session.

---

### WR-04: permission_prompter.rs timeout path leaves stale sender in pending_prompts map

**File:** `tauri-app/src-tauri/src/permission_prompter.rs:66-78`

**Issue:** After `recv_timeout` returns `Err` (timeout), the code at lines 76-78 removes the entry from `pending_prompts`. However, if two threads race — the timeout path is cleaning up while `respond_to_permission` (Tauri command) has already called `prompts.remove(&prompt_id)` and gotten `None` (returning an error to the frontend) — the cleanup at line 78 will call `pending.remove` on an already-removed key, which is benign. The actual problem is the window between `recv_timeout` timing out (line 66) and the cleanup (line 76): the sender `tx` is still in the map. The agent could conceivably retry and the frontend could send a second response during this window, which would call `tx.send()` on a dropped receiver (`rx` is out of scope after `recv_timeout` returns). `tx.send()` returns `SendError` which `respond_to_permission` converts to a string error returned to frontend. This produces a visible but confusing error in the UI: "prompt_id X not found" — but actually it was found (send succeeded) and the error is from the dropped rx. The map entry is also not removed in this case (because `respond_to_permission` called `remove()` and got `Some`, ran `tx.send()` which failed).

**Fix:** Use `remove()` in `respond_to_permission` (already done via CR-02 comment in code). Additionally, the cleanup in `decide()` should happen before returning from the timeout arm, not after the match:

```rust
Err(_) => {
    // Remove before emitting so a racing respond_to_permission sees None
    if let Ok(mut pending) = self.pending_prompts.lock() {
        pending.remove(&prompt_id);
    }
    let _ = self.app_handle.emit("permission-timeout", &prompt_id);
    PermissionDecision::Deny
}
```

---

### WR-05: list_sessions uses file creation time which is unreliable on Linux

**File:** `tauri-app/src-tauri/src/commands.rs:196-201`

**Issue:**
```rust
let created_at = meta
    .created()
    .ok()?
    .duration_since(std::time::UNIX_EPOCH)
    .ok()?
    .as_secs();
```

`std::fs::Metadata::created()` returns `Err` on Linux/ext4/btrfs filesystems where creation time (birthtime) is not tracked. The `.ok()?` silently discards those entries — sessions created on Linux would disappear from the list entirely. Even on Windows (the current target), `created()` can return `Err` if the file was copied or the timestamp is corrupt.

**Fix:** Fall back to modification time:

```rust
let created_at = meta
    .created()
    .or_else(|_| meta.modified())
    .ok()?
    .duration_since(std::time::UNIX_EPOCH)
    .ok()?
    .as_secs();
```

---

### WR-06: home_sessions_dir() falls back to "." silently — sessions written to process cwd

**File:** `tauri-app/src-tauri/src/commands.rs:254-259`

**Issue:**
```rust
fn home_sessions_dir() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".xolotl-code").join("sessions")
}
```

If neither `USERPROFILE` nor `HOME` is set (sandboxed environments, CI, certain container configs), the function silently returns `./.xolotl-code/sessions`. Session files are written to and read from the process working directory without any warning. The user has no indication their sessions are in an ephemeral location.

**Fix:** Return a `Result` and propagate the error, or at minimum log a warning:

```rust
fn home_sessions_dir() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| {
            eprintln!("[warn] Neither USERPROFILE nor HOME is set; using cwd for sessions");
            ".".to_string()
        });
    PathBuf::from(home).join(".xolotl-code").join("sessions")
}
```

---

### WR-07: cancelStream does not stop the rAF loop in useAgentEvents

**File:** `tauri-app/src/hooks/useAgentEvents.ts` + `tauri-app/src/stores/chatStore.ts:175-191`

**Issue:** When the user clicks Stop, `cancelStream()` in the store commits the partial content and sets `isStreaming: false`. But `useAgentEvents` still has an active rAF loop (`rafId.current` may be non-null) and the event listener is still active. If the backend sends more `TextDelta` events before `stopAgent` takes effect, the rAF loop will call `appendStreamingContent` which sets `isStreaming: true` again, un-doing the cancel. The user sees "stopped" flash then the stream resumes briefly.

**Fix:** Expose a `isCancelled` flag in the store (or use a ref in the hook) that the rAF callback checks before applying further deltas:

```typescript
// In the rAF callback:
rafId.current = requestAnimationFrame(() => {
  const delta = deltaBuffer.current;
  deltaBuffer.current = "";
  rafId.current = null;
  if (delta && !useChatStore.getState().isStreaming === false) {
    // isStreaming was set false by cancel — drop remaining deltas
    return;
  }
  if (delta) {
    useChatStore.getState().appendStreamingContent(delta);
  }
});
```

Or more cleanly, add a `cancelledRef` ref in the hook that is set by an effect watching `isStreaming`.

---

## Info

### IN-01: Slash palette condition contains dead sub-expression

**File:** `tauri-app/src/components/chat/MessageInput.tsx:45`

**Issue:**
```typescript
setPaletteOpen(v.startsWith("/") && v.length >= 1);
```

`v.startsWith("/")` implies `v.length >= 1`. The second condition is always true when the first is true, and is dead code.

**Fix:**
```typescript
setPaletteOpen(v.startsWith("/"));
```

---

### IN-02: DiffView has conflicting overflow classes on container

**File:** `tauri-app/src/components/chat/DiffView.tsx:29`

**Issue:**
```tsx
<div className="rounded-sm overflow-hidden border border-neutral-800 font-mono text-xs max-h-64 overflow-y-auto my-2">
```

`overflow-hidden` and `overflow-y-auto` are both applied. In Tailwind v3/v4, `overflow-hidden` generates `overflow: hidden` and `overflow-y-auto` generates `overflow-y: auto`. CSS overflow shorthand (`overflow: hidden`) sets both axes, then `overflow-y: auto` overrides only the Y axis. The net result in most browsers is `overflow-x: hidden; overflow-y: auto`, which may be the intent — but `overflow-hidden` is misleading here and the two classes appear contradictory. If a future Tailwind version changes specificity, the behavior could silently break.

**Fix:** Replace with explicit per-axis classes:
```tsx
<div className="rounded-sm overflow-x-hidden overflow-y-auto border border-neutral-800 font-mono text-xs max-h-64 my-2">
```

---

### IN-03: console.error calls used for production error reporting

**File:** `tauri-app/src/components/chat/ChatPane.tsx:95`, `tauri-app/src/components/chat/PermissionCard.tsx:38`, `tauri-app/src/hooks/useAgentEvents.ts:165`

**Issue:** Errors from Tauri commands (`stopAgent`, `respondToPermission`, `runAgentTurn`) are reported only via `console.error`. In a production desktop app there is no DevTools open by default. These errors are silently swallowed from the user's perspective, providing no feedback that the stop/permission/turn operation failed.

**Fix:** Surface errors to the UI — for example, appending an error message item to the chat store, or displaying a toast notification. At minimum, collect errors for a structured logging channel rather than `console.error` alone.

---

_Reviewed: 2026-05-10T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
