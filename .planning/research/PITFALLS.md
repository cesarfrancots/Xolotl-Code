# Domain Pitfalls

**Project:** xolotl — Tauri 2.x desktop app + multi-agent AI orchestration
**Domain:** AI coding assistant with parallel agent teams, streaming UI, git worktrees
**Researched:** 2026-05-07
**Overall confidence:** MEDIUM — drawn from training knowledge of Tauri 2.x (stable as of late 2024), multi-agent system patterns, and direct analysis of the existing codebase architecture docs. External tool access was blocked during this session; flag claims marked LOW for phase-specific validation.

---

## Critical Pitfalls

Mistakes that cause rewrites or major architectural rework.

---

### Pitfall 1: IPC Payload Size Causing UI Freeze (Tauri)

**What goes wrong:** Tauri's `#[tauri::command]` uses JSON serialization over a synchronous channel between the Rust backend and the WebView. Returning large structs (full session histories, file contents, long tool outputs) as a single command response blocks the WebView's JS thread during deserialization. At ~1–5 MB payloads the freeze becomes user-visible. At 10+ MB it triggers WebView timeouts or silent drops.

**Why it happens:** Tauri commands are request/response: the JS caller awaits a single resolved value. The entire payload is serialized to a JSON string, sent over an IPC bridge, and deserialized in the WebView in one shot. There is no streaming within a command return value.

**Consequences:** Session restore with large history locks the UI. Displaying long tool outputs (e.g., grep results on a big codebase) freezes the chat panel. Multi-agent status dumps with many concurrent agent logs are especially risky.

**Prevention:**
- Never return full session history from a command. Return paginated slices (last N messages).
- Use Tauri **events** (`app_handle.emit()`) for streaming data — events are fire-and-forget and can carry small incremental payloads.
- For the streaming response pipeline specifically: emit one event per SSE delta (text chunk, tool start, tool result), not one event per turn. The existing `ApiClient::stream()` already produces delta events — map them 1:1 to Tauri events.
- Hard-code a payload size guard in command handlers: if serialized size > 512 KB, paginate or error.

**Warning signs:** UI stutters on session load; chat panel freezes during tool result display; any command that returns `Vec<ConversationMessage>` in full.

**Phase mapping:** Must be addressed in the Tauri IPC wiring phase (before the chat UI is built on top). Retrofitting pagination after the UI is built is painful.

---

### Pitfall 2: Blocking the Tauri Main Thread with Synchronous Rust Logic

**What goes wrong:** The existing `ConversationRuntime::run_turn()` is synchronous and blocking — it calls `ApiClient::stream()` which blocks on HTTP SSE for potentially minutes. If this is called directly from a `#[tauri::command]` without spawning to a separate thread, it blocks the Tauri event loop. Window resizing, menu interactions, and other IPC calls all freeze until the turn completes.

**Why it happens:** Tauri 2.x command handlers run on a thread pool by default, but if the handler holds a `Mutex<ConversationRuntime>` guard across the blocking HTTP call, it deadlocks any other command that tries to acquire the same lock. This is the most common early mistake when wrapping a synchronous Rust backend in Tauri.

**Consequences:** The window appears hung. The OS may show "not responding." Other commands (cancel, stop agent, switch view) queue behind the locked guard and never fire. This is a rewrite-level mistake if the locking strategy is baked in early.

**Prevention:**
- Spawn each `run_turn()` call with `tauri::async_runtime::spawn_blocking()`. This moves it off the command handler thread.
- The `ConversationRuntime` must be behind a non-blocking coordination primitive. Consider `Arc<Mutex<...>>` with `try_lock` + task queue, or a dedicated per-agent actor thread that owns the runtime and receives messages via `std::sync::mpsc`.
- Design the agent state machine as a separate OS thread (or `tokio::task::spawn_blocking`) from day one. The Tauri side only sends commands and receives events — it never holds the runtime lock.

**Warning signs:** Any code path where a `MutexGuard<ConversationRuntime>` is held across an `await` or a blocking HTTP call.

**Phase mapping:** Architecture decision for the Tauri shell phase. The "agent thread owns the runtime, Tauri sends messages" pattern must be chosen before writing any command handlers.

---

### Pitfall 3: Agent Loop Runaway (Infinite Tool Calls / Cost Explosion)

**What goes wrong:** An agent enters a tool-call loop — it calls `bash`, gets partial output, calls `bash` again to fix the error, which produces another error, ad infinitum. The existing `max_iterations=32` guard in `ConversationRuntime` prevents per-agent runaway, but in a multi-agent system the orchestrator can spawn new child agents that each get their own 32-iteration budget. A misbehaving orchestrator prompt can trigger 10 child agents × 32 iterations × expensive model = thousands of dollars in minutes.

**Why it happens:** The orchestrator is given broad authority and a task like "fix all failing tests." With poor stopping conditions, it keeps spawning agents until it believes the task is done. Models also have a known failure mode where they loop on ambiguous feedback ("the test still fails" → same fix again).

**Consequences:** Cost overrun. On Kimi K2/MiniMax at low per-token prices this is manageable, but a single Sonnet/Opus orchestrator turn costs 10–50x more. Mixed-model teams amplify the risk.

**Prevention:**
- Implement a **session-level cost budget** enforced in `UsageTracker`: hard stop when cumulative cost exceeds a threshold (e.g., $5 per session, configurable). The `UsageTracker` already tracks per-model pricing — add `budget_exceeded()` check at the top of `run_turn()`.
- Add a **global agent count ceiling** in `TaskRegistry`: refuse to spawn more than N concurrent agents (default 5–10).
- The orchestrator prompt must include explicit stopping conditions: "If you have called bash more than 3 times on the same error without progress, stop and report failure."
- Add a **dead-letter detection**: if the last 3 tool inputs are identical, abort the loop and surface an error.

**Warning signs:** `UsageTracker` total cost climbing faster than expected; `SUBAGENT_COUNTER` incrementing without bound; same bash command appearing in consecutive tool calls.

**Phase mapping:** Cost budget enforcement belongs in the CLI phase (pre-UI). The multi-agent ceiling belongs in the orchestration layer phase. Both must exist before any long-running agent experiments.

---

### Pitfall 4: Race Conditions in Shared Git Worktrees

**What goes wrong:** Two parallel agents working on different branches of the same repository write to shared infrastructure: `.git/index.lock`, `ORIG_HEAD`, stash refs, the reflog. Git is not designed for concurrent write access across worktrees from multiple processes simultaneously. The `.git/index.lock` file is a mutex — if one agent holds it, another agent's `git add` or `git status` will fail with "index.lock exists."

**Why it happens:** Git's locking model is process-level, not worktree-level for shared objects. While `git worktree add` creates separate `HEAD` and index files per worktree, the object store and packed-refs file are shared. Concurrent `git gc`, `git pack-refs`, or aggressive `git fetch` calls across worktrees can corrupt the pack index.

**Consequences:** Agent bash commands fail with git errors mid-task. If an agent retries without clearing the lock, it creates cascading failures. At worst, object store corruption requires `git fsck` and manual recovery.

**Prevention:**
- Assign one worktree per agent and enforce it — no two agents share the same worktree directory.
- Serialize git-mutating operations: route all `git add/commit/push` through a **git operation queue** per repository. The queue ensures only one process holds the lock at a time.
- Add a `git_lock_guard` abstraction in bash execution: before any git write command, check for `.git/index.lock` and wait (with timeout) for it to clear.
- Avoid `git gc --aggressive` in any automated agent path.

**Warning signs:** Bash tool results containing "fatal: Unable to create '.git/index.lock'"; agents timing out on git commands; diverging branch histories that require force-push.

**Phase mapping:** Worktree management layer phase. Define the worktree-per-agent invariant before implementing the parallel agent spawning UI.

---

### Pitfall 5: Context Window Accumulation Across Agent Handoffs

**What goes wrong:** The orchestrator serializes its full context (all tool results, all agent outputs, all intermediate thoughts) into the prompt it sends to each worker agent. A single orchestrator turn with 5 parallel agents each returning 8K tokens of output means the next orchestrator turn starts with 40K tokens of agent results stacked on top of its existing context. After 3–4 rounds of this, the orchestrator context window is exhausted or triggers compaction that loses critical state.

**Why it happens:** The natural temptation is to include "everything" in the orchestrator context for coherence. In practice, most agent output is irrelevant to subsequent decisions — only the summary matters.

**Consequences:** Compaction fires too early and the orchestrator loses task state. Or the orchestrator context exceeds the model's limit and the API returns a 400 error mid-task. Either way the multi-agent workflow fails silently mid-session.

**Prevention:**
- Each sub-agent must return a **structured summary** (not raw output) to the orchestrator: status (success/fail), files changed, key findings, blockers. Cap summary at 500–1000 tokens.
- The orchestrator prompt should explicitly instruct: "Do not reproduce agent outputs in full. Summarize only what affects next steps."
- The existing `compact.rs` sliding-window compaction applies to the orchestrator session — but compaction at 120K tokens is too late if token accumulation is fast. Set the orchestrator's compaction threshold lower (e.g., 60K for orchestrator sessions).
- Use the `SubAgentResult` struct as the boundary: only the structured result crosses back to the orchestrator, never raw session messages.

**Warning signs:** Orchestrator `UsageTracker` input tokens climbing > 50K on the second round; `compact.rs` firing within 3 turns; 400 "context_length_exceeded" errors from the API.

**Phase mapping:** Agent result protocol design — address during the orchestration layer phase before any multi-round experiments.

---

### Pitfall 6: Model Capability Mismatch in Worker Agent Roles

**What goes wrong:** The orchestrator (Sonnet/Opus) writes structured instructions assuming the worker (Haiku/Kimi K2) will follow multi-step reasoning chains, use tools in a specific sequence, or respect nuanced constraints. Cheaper models fail silently: they skip steps, call the wrong tool, produce malformed JSON, or claim success without doing the work.

**Why it happens:** Instructions optimized for one model tier do not transfer to a weaker model. The orchestrator's self-model ("I would do X when told Y") is wrong for a different model family.

**Consequences:** Worker agents produce subtly wrong outputs that pass the orchestrator's sanity check. Bugs are introduced silently. The failure only surfaces at review/test time, far from the point of failure.

**Prevention:**
- Write worker agent system prompts to the lowest capable model in the fleet. If Haiku or Kimi K2 is a target, test the prompt against those models first.
- Use **role-specific system prompts** that constrain scope. A "Coder" agent's prompt should say "You have one job: implement the function described. Do not refactor unrelated code. Do not explain. Write code only." Narrow prompts reduce failure modes.
- Add **output validation** after each worker turn: the orchestrator (or a dedicated Reviewer agent) checks the diff before accepting it. Never trust worker output without a structural check.
- Kimi K2 and MiniMax M1 have different tool-call schemas. The `openai.rs` client already handles them but the tool schemas must be validated against each model's spec. See Pitfall 11 (open model tool schema differences).

**Warning signs:** Worker agents returning "Done" with no tool calls logged; workers calling tools in unexpected order; diffs that don't match the task description.

**Phase mapping:** Orchestration prompt design phase. Test each role prompt against the intended model tier before wiring the full team.

---

## Moderate Pitfalls

---

### Pitfall 7: Tauri Auto-Updater Requiring Code Signing Infrastructure

**What goes wrong:** Tauri's built-in updater requires code-signed releases to work on macOS (notarization) and Windows (Authenticode). Without signing, macOS Gatekeeper blocks the update binary and Windows SmartScreen warns users. Setting up signing infrastructure (Apple Developer account, Windows EV cert or self-signed cert trust) is non-trivial and often discovered only at distribution time.

**Prevention:**
- For personal use with no public distribution: disable the updater plugin entirely in `tauri.conf.json`. The auto-updater adds complexity with no benefit if the only user is the developer.
- If updates are desired: set up signing in CI from the start (GitHub Actions + `tauri-action`). Retrofitting signing after the fact requires re-configuring the build pipeline.
- On Windows with MSVC: the existing build issue (Git's `link.exe` shadowing MSVC linker) will resurface in the release/signing pipeline. Document the WinLibs + `rustup override` fix in the CI config.

**Warning signs:** `tauri build --release` succeeds locally but the installer triggers SmartScreen; macOS .dmg opens but "Application cannot be opened because the developer cannot be verified."

**Phase mapping:** Distribution/packaging phase (not the core build phase). Don't spend time on this until the app is functionally complete.

---

### Pitfall 8: Tauri Window State Not Persisting Across Restarts

**What goes wrong:** Users resize and reposition the window, close the app, reopen — window snaps back to the default size and position. This is a Tauri default: window state is not persisted unless explicitly configured via the `window-state` plugin.

**Prevention:**
- Add `tauri-plugin-window-state` from day one. It's a single plugin registration with no behavior changes needed.
- If building a multi-window layout (main chat + agent monitor panel), the window-state plugin handles each window independently as long as they have distinct labels.

**Warning signs:** Window position reset on every launch; user feedback about lost layout.

**Phase mapping:** Early UI phase — easy to add at the start, annoying to explain later.

---

### Pitfall 9: React Re-render Thrashing on High-Frequency Streaming Events

**What goes wrong:** The Tauri event listener calls a React state setter on every SSE delta. For fast models (Sonnet streaming at 60–100 tokens/sec), this fires React's reconciler 60–100 times per second. With multiple concurrent agent streams, this compounds. The UI becomes choppy; CPU usage spikes; on slower machines the input field becomes unresponsive during streaming.

**Why it happens:** The default pattern (`useEffect` + `listen()` → `setState(prev => [...prev, chunk])`) triggers a full re-render on every chunk. React 18's concurrent mode helps but does not eliminate this for rapid state updates.

**Prevention:**
- Batch event updates with `useTransition` or a local buffer that flushes at 60fps via `requestAnimationFrame`. Instead of calling `setState` on every event, accumulate chunks in a ref and flush the ref to state on the next animation frame.
- Keep streaming text in a `useRef` (not `useState`) during active streaming; only promote to `useState` when the stream ends or on a timer.
- Virtualize the message list (`react-virtual` or `@tanstack/react-virtual`). Long conversations with many tool results will cause layout thrashing without virtualization.
- For the agent status panel (N concurrent agents, each streaming): render each agent as an isolated component with its own local state. Avoid lifting all agent streams into a single shared store.

**Warning signs:** CPU usage > 80% during streaming on a modern machine; input field keystroke lag while a stream is active; React DevTools showing > 20 re-renders/sec on the chat component.

**Phase mapping:** Chat UI phase — design the event-to-state pipeline with batching from the first streaming implementation.

---

### Pitfall 10: Git Worktree Branch Divergence Becoming Unmergeable

**What goes wrong:** Multiple agents work in parallel on separate branches. Each agent accumulates commits. When the orchestrator tries to merge all branches back to main, they have diverged significantly — conflicting changes to the same files, incompatible refactors, duplicate additions. Automated merge fails; human intervention is required; the agent work must be partially discarded.

**Why it happens:** Agents working independently on "implement X" and "implement Y" frequently touch the same files (config, tests, shared modules). Without coordination, both agents make incompatible assumptions about shared state.

**Prevention:**
- The orchestrator must perform **task decomposition with explicit file ownership**: assign files/modules to agents, disallow overlap. Include "do not modify files outside your scope" in every worker prompt.
- Implement a **merge checkpoint**: after N agent turns, pause, merge to a staging branch, resolve conflicts, then continue. Don't let parallel agents diverge for more than 1–2 commits without a merge checkpoint.
- Prefer **additive tasks** for parallel agents: creating new files, adding new functions, writing tests for existing code. Avoid assigning two agents to refactor the same module in parallel.

**Warning signs:** Two agents' task descriptions both mention the same file; orchestrator task list has implicit ordering dependencies that weren't expressed; merge step produces > 3 conflict markers per file.

**Phase mapping:** Orchestration strategy design. Establish the file-ownership protocol before enabling parallel worktree spawning in the UI.

---

### Pitfall 11: Open Model Tool Call Schema Differences Breaking the Agentic Loop

**What goes wrong:** The `tools` crate sends Anthropic-formatted tool schemas (with `input_schema` at the top level). Kimi K2 and MiniMax M1 via the OpenAI-compatible endpoint expect OpenAI-formatted schemas (`function.parameters`). The `openai.rs` client converts schemas at the API call boundary, but subtle differences — nested `$defs`, `anyOf` types, `additionalProperties: false` — cause the model to receive a schema it can't parse, resulting in malformed tool calls or the model declining to call tools at all.

**Why it happens:** Tool call schemas are not a universal standard. OpenAI's spec, Anthropic's spec, and the open models' implementations diverge at edge cases. The conversion logic in `openai.rs` may handle the common cases but miss edge cases in complex nested schemas.

**Consequences:** Agent silently falls back to "text only" responses when it can't form a valid tool call. Coder agents that can't call `bash` or `write_file` are useless. The failure is hard to detect because the model still produces text output.

**Prevention:**
- Add **schema round-trip tests** for every tool spec: serialize to Anthropic format, convert to OpenAI format, send to a Kimi/MiniMax test endpoint, verify the model calls the tool correctly.
- Avoid `$defs`, `$ref`, and `anyOf` in tool schemas where possible — use flat, explicit schemas that all providers handle consistently.
- Log raw API request/response bodies in debug mode for Kimi/MiniMax clients. The failure manifests in the API response, not in the Rust code.
- The existing `model_hints.rs` per-model tuning should include a `tool_call_format` field that governs schema serialization behavior per provider.

**Warning signs:** Agent produces correct reasoning text but calls no tools; `ToolUse` events absent from API response when tools are listed; Kimi/MiniMax agent sessions that "work" in text mode but never invoke file ops.

**Phase mapping:** CLI completion phase (the "Kimi K2 / MiniMax M1 tool-call validation and schema fixes" item already in the Active requirements list). Must be solved before multi-agent work — a worker agent that can't call tools is a critical failure.

---

### Pitfall 12: Inconsistent Stop Sequences / Premature Response Truncation Across Models

**What goes wrong:** Some open models (particularly MiniMax M1 and some Qwen variants) generate content past the expected stop sequence or stop earlier than expected. In an agentic loop, premature stopping produces an incomplete tool call JSON that cannot be parsed. The loop then sends a malformed `ToolResult` back to the model, which confuses the next turn.

**Prevention:**
- The `ApiClient::stream()` implementation for OpenAI-compatible clients should handle partial/truncated `tool_calls` objects in the SSE stream: if `finish_reason` is `stop` but the tool call JSON is incomplete, treat it as an error and retry the turn (not the HTTP request).
- Add a `finish_reason` validator in `openai.rs`: if `finish_reason == "length"` during a tool call generation, the context window was hit — trigger compaction before retrying.
- For MiniMax M1 specifically, test whether the model respects `stop` sequences at all when generating JSON — some fine-tuned models ignore stop sequences inside structured outputs.

**Warning signs:** JSON parse errors in `openai.rs` tool call deserialization; `ToolResult` with `is_error: true` on consecutive turns; model outputting partial JSON followed by natural language.

**Phase mapping:** CLI completion phase, same as Pitfall 11.

---

### Pitfall 13: Tauri 1.x Patterns That Break in 2.x

**What goes wrong:** xolotl is starting fresh on Tauri 2.x, but most tutorials, Stack Overflow answers, and community examples as of mid-2024 target Tauri 1.x. Key differences that trip up developers:
- **Plugin system**: Tauri 2.x uses a capability-based permission system. Plugins must be declared in `src-tauri/capabilities/` JSON files. Missing capability = silent permission denial at runtime (no error, just no-op).
- **`invoke` vs `core:default`**: The `invoke` channel in Tauri 2.x requires explicit capability grants. The first IPC call from the frontend will silently fail if `core:default` isn't in the capability config.
- **Window labels**: Tauri 2.x window labels must be lowercase alphanumeric with hyphens. Underscores or uppercase cause window creation to fail with an opaque error.
- **`app_handle` passing**: In Tauri 2.x, `AppHandle` is `Clone` and should be passed into long-running tasks. Storing `&AppHandle` references causes lifetime issues that are hard to diagnose.

**Prevention:**
- Read the official Tauri 2.x migration guide before writing any Tauri code, even if not migrating from 1.x.
- Start with the minimal capability config and add permissions explicitly as features are added. Don't copy 1.x capability configs.
- Use `tauri::Manager` trait methods (`app.get_webview_window()`) not the deprecated `WindowBuilder` patterns from 1.x.

**Warning signs:** IPC calls that return `undefined` with no error; window not appearing on spawn; permission-related 403 errors in the Tauri console.

**Phase mapping:** Tauri shell initialization phase — get the capability config right before adding any features.

---

## Minor Pitfalls

---

### Pitfall 14: Streaming Backpressure with Multiple Concurrent Agent Streams

**What goes wrong:** When 5 agents stream simultaneously, the Tauri event system emits events from 5 parallel threads. The WebView's event listener queue can back up. On Windows with the WebView2 renderer, high-frequency events from multiple sources occasionally arrive out of order or in burst batches after a brief pause.

**Prevention:**
- Prefix each event payload with an `agent_id` field. The frontend must use this to route events to the correct agent's display — never assume event ordering across agents.
- Add sequence numbers to streaming events. The frontend can detect gaps and request a replay, or at minimum log a warning about dropped events.
- Rate-limit event emission to max 50 events/sec per agent on the Rust side during streaming. Model streaming rarely produces value from 100Hz UI updates.

**Phase mapping:** Streaming UI implementation phase.

---

### Pitfall 15: Windows-Specific Path Separator Issues in Rust Tooling

**What goes wrong:** xolotl's primary development platform is Windows 11. The existing codebase uses `std::path::PathBuf` and `Path` consistently (from reviewing the architecture), but `bash.rs` executes shell commands with paths as strings. On Windows, paths with backslashes fail inside the bash execution context if the shell is cmd.exe/PowerShell but would succeed in WSL or Git Bash. The existing build issue (Git `link.exe` shadowing MSVC linker) is a symptom of this broader path/toolchain environment complexity.

**Prevention:**
- In `bash.rs`, normalize paths to forward slashes before embedding them in shell command strings.
- The agent's working directory for bash execution should always be an explicitly set absolute path, not inherited from the parent process.
- Test all bash tool invocations on Windows with paths that include spaces (common in `C:\Users\<name>\Documents\...`).

**Phase mapping:** CLI completion phase and then regression-test during Tauri integration.

---

### Pitfall 16: Obsidian Vault Memory System Creating Large Context Injections

**What goes wrong:** The `memory/` subsystem retrieves notes from the Obsidian vault and injects them into the system prompt. If the retrieval query is too broad (e.g., matches dozens of notes), the injected content can add 10–20K tokens to every turn, accelerating context window consumption and triggering premature compaction.

**Prevention:**
- Cap memory injection at a fixed token budget (e.g., 2K tokens) per turn. Truncate or summarize notes that exceed this budget.
- Use similarity scoring in `retrieval.rs` — inject only the top-3 most relevant notes, not all matching notes.

**Phase mapping:** Memory system refinement. Not a blocker for the Tauri phase.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|----------------|------------|
| Tauri shell initialization | Silent IPC failures from missing capability config (Pitfall 13) | Start with `core:default` + read Tauri 2.x capability docs before any IPC code |
| Agent thread / runtime wiring | Mutex deadlock blocking the event loop (Pitfall 2) | Agent owns runtime in a dedicated thread; Tauri side sends messages only |
| Chat streaming UI | React re-render thrashing at 60-100 events/sec (Pitfall 9) | Buffer events in a ref, flush via requestAnimationFrame |
| Tool schema validation (Kimi/MiniMax) | Silent tool call failures from schema incompatibility (Pitfall 11) | Round-trip schema tests against real endpoints before multi-agent work |
| Multi-agent orchestration | Token accumulation → orchestrator context exhaustion (Pitfall 5) | Define structured SubAgentResult summary format before first multi-round test |
| Parallel worktrees | git index.lock conflicts between concurrent agents (Pitfall 4) | Git operation queue per repo; one worktree per agent invariant |
| Cost budgeting | Orchestrator spawning agents without cost ceiling (Pitfall 3) | UsageTracker budget_exceeded() check before any long-running experiment |
| Branch merging | Unmergeable diverged branches from parallel agents (Pitfall 10) | File ownership protocol in orchestrator prompt; merge checkpoints |
| IPC data transfer | Large session payloads freezing WebView (Pitfall 1) | Paginated message loading; event-based streaming for turn output |
| Open model support | Inconsistent stop sequences producing unparseable tool calls (Pitfall 12) | finish_reason validator + partial JSON error recovery in openai.rs |

---

## Confidence Assessment

| Area | Confidence | Basis |
|------|------------|-------|
| Tauri 2.x IPC/capability pitfalls | MEDIUM | Training knowledge of Tauri 2.0 stable (Oct 2024) + Tauri 1→2 migration patterns |
| Tauri auto-updater / signing | MEDIUM | Well-documented requirement in Tauri docs; signing pain is widely reported |
| Multi-agent token accumulation | HIGH | Direct consequence of architecture documented in ARCHITECTURE.md; SubAgentResult is the boundary |
| Agent loop runaway | HIGH | UsageTracker + SUBAGENT_COUNTER are already in the codebase; budget check is the missing guard |
| Git worktree locking | HIGH | Git's locking semantics are well-established; parallel write risk is deterministic |
| React streaming re-renders | MEDIUM | Standard React performance pattern; batching recommendation is established practice |
| Kimi K2 / MiniMax schema issues | MEDIUM | Already flagged as Active requirement in PROJECT.md; specific failure mode is training-knowledge-based |
| Open model stop sequences | LOW | Model-specific behavior; validate against real endpoints |
| Windows path/toolchain issues | MEDIUM | Existing build issue in PROJECT.md confirms this is a real active concern |

---

## Sources

- Tauri 2.x architecture: training knowledge from Tauri 2.0 stable release (October 2024) — verify against https://v2.tauri.app/concept/inter-process-communication/ and https://v2.tauri.app/security/capabilities/
- Multi-agent patterns: analysis of xolotl's own `subagent/`, `usage.rs`, `compact.rs`, and `ARCHITECTURE.md`
- Git worktree semantics: Git documentation on worktree index isolation and object store sharing
- React streaming: React 18 concurrent features documentation and standard batching patterns
- Open model tool call schemas: analysis of `openai.rs` client and `model_hints.rs` in the existing codebase; Kimi K2 and MiniMax OpenAI-compatibility notes from training data (LOW confidence — validate against current provider docs)
