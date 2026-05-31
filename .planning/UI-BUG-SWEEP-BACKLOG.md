# UI / Bug Sweep Backlog

Deferred findings from the 2026-05-30 adversarial bug+UI sweep (63 agents, 45 confirmed).
The HIGH functional bugs + trivial pure-win polish were fixed in commits f1b0c4b / 19e2510.
The items below are tracked for a future pass — mostly a11y, overflow, and edge-case polish.

## HIGH

- **[bug/trivial]** `kimi2.6` in model list always routes to wrong endpoint (`moonshot-v1-8k`)
  - `tauri-app/src-tauri/src/commands.rs:942`
  - Fix: Either (a) remove `"kimi2.6"` from `list_models()` and document it as unsupported until the moonshot API exposes a versioned ID, or (b) update the `kimi` routing branch to map `"kimi2.6"` â†’ `"moonshot-v1-128k"` or the correct versioned en

- **[bug/small]** `test_mcp_server` stdio test hangs indefinitely â€” deadline loop does not cancel blocking `read()`
  - `tauri-app/src-tauri/src/skills_mcp.rs:388`
  - Fix: Set the stdout fd non-blocking before the read loop: on Unix use `set_nonblocking(true)` on the raw fd; on Windows use `ReadFile` with a timeout or spawn a dedicated reader thread and join with a timeout. Simplest portable fix: spawn a seco

## MEDIUM

- **[bug/trivial]** `skills_mcp::test_mcp_server` does not close child stdin before reading stdout â€” MCP servers that read stdin until EOF will block forever
  - `tauri-app/src-tauri/src/skills_mcp.rs:379`
  - Fix: Send the message with a `Content-Length` header: `Content-Length: {len}\r\n\r\n{json_body}`. This is the MCP spec's required framing for stdio transport.

- **[bug/trivial]** SessionItem row is a non-interactive div with onClick â€” not keyboard reachable
  - `tauri-app/src/components/sidebar/SessionItem.tsx:26`
  - Fix: Change the outer `<div>` to a `<button>` (type="button") with full width styling, or keep the div and add `role="button" tabIndex={0}` plus an `onKeyDown` that calls `onResume` on Enter/Space. The delete Button inside already has stopPropag

- **[bug/trivial]** Show/hide API key button has no aria-label â€” screen readers announce only an unlabelled icon
  - `tauri-app/src/components/settings/SettingsDialog.tsx:226`
  - Fix: Add `aria-label={ps.showKey ? 'Hide API key' : 'Show API key'}` to the button. Also add `id={provider.id + '-key-input'}` to the `<Input>` and `htmlFor` to the `<label>` element above it so AT users know which field they are in.

- **[bug/trivial]** ModelMenu trigger button clips long model names in chat input bar
  - `tauri-app/src/components/chat/MessageInput.tsx:ModelMenu`
  - Fix: Add `min-w-0` to the `ml-auto flex items-center gap-1.5` container that holds ModelMenu + EffortMenu + Send so the flex children participate in shrink. Also ensure the ModelMenu trigger itself uses `flex-none` or an `overflow-hidden` guard 

- **[bug/trivial]** PermissionCard: pre/code block with long tool input paths overflows the card width without wrapping
  - `tauri-app/src/components/chat/PermissionCard.tsx:62`
  - Fix: Add `break-words` (or `break-all` for paths) alongside `whitespace-pre-wrap` to the `<pre>` element. The `<code>` snippet for the tool name at line 55 is short enough to be safe as-is.

- **[bug/small]** Error path in streamChatTurn calls finalizeStream then appendItem, producing duplicate empty message
  - `tauri-app/src/components/chat/MessageInput.tsx:179-194`
  - Fix: Replace the finalizeStream call in the Error branch with cancelStream (which marks the partial content as stopped) before appending the error message. Or call clearStreaming() and discard the partial content, keeping only the error message.

- **[bug/small]** stop_agent removes agent from Rust but never removes card from UI store
  - `tauri-app/src/components/agent/AgentCard.tsx:handleStop`
  - Fix: Add a removeAgent action to agentStore that filters out the agent by id. In handleStop(), after a successful stopAgent result, call useAgentStore.getState().removeAgent(agent.id) and also setExpandedAgent(null) if expandedAgentId === agent.

- **[bug/small]** Double auto-close of merge checkpoint after successful merge
  - `tauri-app/src/components/agent/MergeCheckpointView.tsx:handleMerge + tauri-app/src/hooks/useGroupWatcher.ts`
  - Fix: Remove the duplicate handling from one site. The cleanest fix: remove the updateGroupMergeState + setTimeout block from MergeCheckpointView.handleMerge() entirely and let useGroupWatcher be the single source of truth for the Merged transiti

- **[bug/small]** useGroupWatcher 'group-state-changed' listener leaks if AgentPanel unmounts before listen() resolves
  - `tauri-app/src/hooks/useGroupWatcher.ts:useEffect (group-state-changed listener)`
  - Fix: Apply the same cancelled-flag pattern from useAgentPanelEvents.ts: declare `let cancelled = false` before the listen() call, set `cancelled = true` in the cleanup, and in .then(fn => { if (cancelled) { fn(); } else { unlisten = fn; } })

- **[ui-polish/small]** MergeCheckpointView shows empty diff sections with no error when get_worktree_diff fails per agent
  - `tauri-app/src/components/agent/MergeCheckpointView.tsx:fetchAll`
  - Fix: Track per-agent diff errors separately: return { agentId, files: [], error: result.error } from the failed branch, store the errors in a Record<string, string> state, and render a red error banner ('Could not load diff: ...') inside that ag

- **[bug/small]** "Clear key" fires immediately without confirmation and shows no loading/error state
  - `tauri-app/src/components/settings/SettingsDialog.tsx:252`
  - Fix: Add a per-provider `clearing` boolean to ProviderState. Set it in handleClear, then in .finally set it back. Add a .catch that sets testState to 'error' with the error message. Also guard the button with disabled={ps.clearing}.

- **[bug/small]** SpawnAgentDialog leaves the model Select empty and read-only if listModels() fails
  - `tauri-app/src/components/agent/SpawnAgentDialog.tsx:35`
  - Fix: Show an inline warning when models.length === 0 after the load (e.g., 'No models available â€” configure a provider in Settings'). Disable the Spawn button when model is empty. Alternatively set a fallback sentinel and check it in handleSpa

- **[bug/small]** Terminal tab divs use `role="tab"` but are not wrapped in `role="tablist"` â€” broken ARIA tree
  - `tauri-app/src/components/terminal/TerminalPanel.tsx:39`
  - Fix: Add `role="tablist"` to the scroll container div, add `tabIndex={isActive ? 0 : -1}` to each tab div, and add an `onKeyDown` on the tablist handling ArrowLeft/ArrowRight to move between tabs and Enter/Space to activate. Use the roving tabin

- **[bug/small]** ChatPane header: cost bar text and skills badge can overflow at narrow width, pushing elements off-screen
  - `tauri-app/src/components/chat/ChatPane.tsx:31-54`
  - Fix: Add `min-w-0 flex-1` to the left `div` and `flex-none` to the right `div`. For the cost bar span, add `truncate` or `whitespace-nowrap` so it doesn't wrap. The skills badge already has fixed-size content so it just needs `flex-none` on its 

## LOW

- **[ui-polish/trivial]** StreamingMessage 'Thinking...' block stays open at fixed scroll height as content grows
  - `tauri-app/src/components/chat/Message.tsx:145-147`
  - Fix: Add max-h-[240px] overflow-y-auto to the inner content div of ReasoningBlock when isStreaming is true: className={'px-3 pb-2 pt-1 text-[13px] ... ' + (isStreaming ? 'max-h-[240px] overflow-y-auto' : '')}. This bounds the height during strea

- **[bug/trivial]** launch_swarm count validation uses InvalidBudget error variant (wrong error type)
  - `rust/crates/runtime/src/supervisor/supervisor.rs:launch_swarm`
  - Fix: Add a new SupervisorError::InvalidCount(String) variant to the enum, and return that from launch_swarm when the count check fails.

- **[ui-polish/trivial]** Collapsed agent roster silently truncates at 12 agents with no indicator
  - `tauri-app/src/components/agent/AgentPanel.tsx:collapsed roster (line 127)`
  - Fix: After the last rendered dot, if agents.length > 12, render a small +N label or a muted overflow dot. Alternatively, remove the hard cap and let the overflow container scroll (the parent already has overflow-y-auto).

- **[ui-polish/trivial]** OutcomePreview iframe sandbox lacks 'allow-forms' and 'allow-same-origin', breaking form-based demos
  - `tauri-app/src/components/eval/EvalView.tsx:OutcomePreview (line 493-499)`
  - Fix: Change line 497: `sandbox="allow-scripts allow-pointer-lock allow-forms allow-same-origin"`. This unblocks interactive form demos and canvas export calls without granting top-navigation or modal-dialog permissions.

- **[bug/trivial]** `list_sessions` falls back to 0 for creation time on Linux (`metadata.created()` unsupported)
  - `tauri-app/src-tauri/src/commands.rs:972`
  - Fix: Fall back to `metadata.modified()` when `created()` fails: `meta.created().or_else(|_| meta.modified()).ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs()`.

- **[bug/trivial]** `safe_artifact_file_name` rejects any filename containing `..` as a substring, even benign ones
  - `tauri-app/src-tauri/src/commands.rs:3367`
  - Fix: Remove the redundant `contains("..")` check â€” the `trimmed == ".."` guard on the previous line already blocks the only dangerous case. If stricter guarding is wanted, check `trimmed.starts_with("..")` instead.

- **[bug/trivial]** Collapsed agent sidebar renders an expand button in the action row when forceCollapsed=true, but the button does nothing
  - `tauri-app/src/components/agent/AgentPanel.tsx:111`
  - Fix: When forceCollapsed=true, add `disabled` and/or `cursor-not-allowed opacity-50` to the BotMessageSquare Button so it visually communicates that it is inactive.

- **[ui-polish/trivial]** MessageList empty state and the MessageInput workflow starters overlap in the same scroll container, causing pb-28 dead zone
  - `tauri-app/src/components/chat/MessageList.tsx:46`
  - Fix: Remove pb-28 from the empty-state div (the parent MessageList container already pads via pb-28 on the non-empty scroll container). Use `py-0` or a symmetric vertical padding so the text is truly centered.

- **[bug/trivial]** ToolBlock loading spinner shown even after tool output is present â€” chevron never appears
  - `tauri-app/src/components/chat/ToolBlock.tsx:74`
  - Fix: When toolCall.loading is true AND the block is expanded (isOpen=true), render a skeleton/spinner inside CollapsibleContent instead of the empty div. For example: `{toolCall.loading && !output && <div className='py-2 text-xs text-[oklch(0.45

- **[bug/trivial]** LaunchTeamDialog mode toggle buttons missing `aria-pressed` â€” active state invisible to AT
  - `tauri-app/src/components/agent/LaunchTeamDialog.tsx:163`
  - Fix: Add `aria-pressed={mode === 'team'}` to the Team button and `aria-pressed={mode === 'swarm'}` to the Swarm button. Alternatively, use `role="radio"` / `aria-checked` within a `role="radiogroup"` since only one can be active at a time.

- **[bug/trivial]** MoreHorizontal button in chat header has no aria-label â€” announced as unlabelled
  - `tauri-app/src/components/chat/ChatPane.tsx:36`
  - Fix: Add `aria-label="Session options"` (or `title="Session options"`) while the feature is a placeholder. If the button genuinely does nothing yet, consider setting `disabled` so it's skipped by Tab or rendered as `aria-hidden="true"` until wir

- **[ui-polish/trivial]** Collapsed session rail buttons lack focus-visible ring â€” no visible keyboard focus indicator
  - `tauri-app/src/components/sidebar/SessionSidebar.tsx:123`
  - Fix: Add `focus-visible:ring-2 focus-visible:ring-[oklch(0.62_0.035_190)] focus-visible:outline-none` to the className of the collapsed session circle buttons. Apply the same treatment to the collapsed agent roster mini-buttons in AgentPanel.tsx

- **[bug/trivial]** SpawnAgentDialog labels are not associated with their inputs via `htmlFor`/`id` â€” inputs are orphaned from labels
  - `tauri-app/src/components/agent/SpawnAgentDialog.tsx:105`
  - Fix: Add matching `htmlFor`/`id` pairs: e.g. `<label htmlFor="spawn-task">Task</label>` and `<textarea id="spawn-task" ...>`. Do the same for every `<label>` + input pair in SpawnAgentDialog and LaunchTeamDialog. The Select component should rece

- **[bug/trivial]** ToolBlock header row: tool name + input preview lack min-w-0 on the text span, causing layout overflow on long inputs
  - `tauri-app/src/components/chat/ToolBlock.tsx:66-81`
  - Fix: Add `flex-none` to the ToolIcon span and the tool-name text span (or give the tool-name a `max-w-[120px] truncate`). The preview span already has `flex-1 truncate` which is correct.

- **[bug/small]** Suite run state is never cleaned up on successful completion â€” activeSuite stays stale
  - `tauri-app/src/components/eval/EvalView.tsx:runSuiteEval + evalStore.ts (line 2362-2365, evalStore line 480)`
  - Fix: In `runSuiteEval`, call `useEvalStore.getState().startSuite(...)` after `result.data` is received. In the `SuitePromptStart` handler, call `advanceSuite(p.eval_id)`. In the `SuiteComplete` handler, call `finishSuite()`. This wires the alrea

- **[ui-polish/small]** Permission mode button in MessageInput has a non-functional ChevronDown â€” no action wired
  - `tauri-app/src/components/chat/MessageInput.tsx:682`
  - Fix: Either: (a) wire a popover/dropdown showing available permission modes and dispatch the appropriate store action, or (b) remove the ChevronDown and change the element to a non-interactive `<span>` or `<div>` to make clear it is display-only

- **[ui-polish/small]** Settings tab bar buttons missing `role="tab"` and `aria-selected` â€” not a proper tablist
  - `tauri-app/src/components/settings/SettingsDialog.tsx:54`
  - Fix: Wrap the tab row div in `role="tablist"`, give each `<TabBtn>` `role="tab"` and `aria-selected={active}`, add `aria-controls` pointing to panel ids, give each panel `role="tabpanel"` with `tabIndex={0}`, and add an `onKeyDown` on the tablis

- **[ui-polish/small]** TerminalPanel tab bar: many tabs exceed the flex container width causing a horizontal scroll bar inside the dock header
  - `tauri-app/src/components/terminal/TerminalPanel.tsx:33-69`
  - Fix: Add a custom thin scrollbar style (`scrollbar-none` or a thin CSS scrollbar) to the tab container, or cap the visible tab count and show a `+N` pill for overflow tabs. At minimum, hiding the native scrollbar with `[&::-webkit-scrollbar]:hid

### Needs live verification (not auto-fixable offline)
- **kimi2.6 routes to moonshot-v1-8k**: the model picker exposes `kimi2.6` but the backend hard-codes `moonshot-v1-8k` for any non-coding kimi (commands.rs kimi branch). Correct mapping needs the right live Moonshot model id — verify against the API before changing to avoid a 404.
