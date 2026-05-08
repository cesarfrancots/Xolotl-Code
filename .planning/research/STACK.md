# Technology Stack: xolotl Tauri UI Layer

**Project:** xolotl — Tauri desktop app + React/TS frontend over existing Rust CLI backend
**Researched:** 2026-05-07
**Scope:** UI layer only. The Rust backend stack is already documented in `.planning/codebase/STACK.md`.
**Confidence note:** WebSearch, WebFetch, and Bash were all unavailable in this session. All findings are from training data (cutoff August 2025). Tauri 2.0 stable shipped October 2024 — fully within the training window and HIGH confidence. React/Zustand/Vite versions are verified as of August 2025; check npmjs.com for patch releases before pinning.

---

## Recommended Stack

### Tauri Core

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `tauri` (Rust crate) | 2.1.x | Desktop shell, IPC, window management | The only production-grade Tauri version for new projects. 1.x is in maintenance mode. 2.x introduced the `Channel` type — the correct primitive for streaming SSE from Rust to the WebView, which is the core IPC pattern for this project. |
| `@tauri-apps/api` (npm) | 2.x (currently ~2.1) | Frontend JS bindings for Tauri IPC | The official JS counterpart. Use `invoke()` for commands and `Channel` for streams. Do not use the legacy `event.listen()` approach for high-frequency streaming — Channel is significantly lower overhead. |
| `@tauri-apps/cli` (npm, devDep) | 2.x | Build tooling: `tauri dev`, `tauri build` | Installed as a dev dependency, not globally. Pin to the same major version as the Rust crate. |

**Why Tauri over Electron:** The Rust agent runtime (`ConversationRuntime`, `ApiClient`, `ToolExecutor`) is already compiled Rust. Tauri exposes it via `#[tauri::command]` with zero FFI friction — no Node.js bridge, no `napi-rs`, no IPC serialization across a process boundary that doesn't need to exist. Electron would add ~150 MB to the bundle and require rewriting or wrapping the entire backend in Node.js bindings. Tauri's Rust integration is the decisive advantage here.

---

### Frontend Framework

**Recommendation: React 19 with TypeScript.**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `react` + `react-dom` | 19.x (currently 19.0) | UI component framework | See rationale below. |
| `typescript` | 5.x (currently 5.5+) | Type safety across IPC boundary | The Tauri command types (`invoke<ReturnType>()`, `Channel<EventType>`) need TypeScript generics to be safe. Untyped JS is untenable when the IPC boundary is the primary failure surface. |

**React over Svelte:** Svelte 5 (with runes) is excellent for reactivity, but its ecosystem for complex state management (multi-agent status, streaming text, permission queues) is thinner. The React ecosystem has `@tanstack/react-virtual` for message list virtualization, `zustand` for agent state, and `@tanstack/react-query` if needed — all mature and specifically relevant to this project's UI complexity. Svelte would require more custom primitives for the agent dashboard.

**React over Solid:** SolidJS is the most reactive option with fine-grained updates, which would help with the streaming re-render problem (see PITFALLS.md Pitfall 9). However, Solid's ecosystem is smaller, and the streaming problem is solvable in React 19 with `useTransition` + ref-based buffering. Solid is a valid alternative if the React streaming performance proves inadequate, but start with React.

**React 19 specifically:** React 19 ships with the Actions API and improved concurrent features. The `useTransition` hook is the recommended mechanism for batching rapid streaming state updates without blocking user input. This directly addresses the 60–100 events/sec streaming problem.

---

### State Management

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `zustand` | 5.x (currently 5.0) | Global agent registry + session state | See rationale below. |
| React `useRef` + `useState` pattern | — | Per-message streaming buffer | NOT a library — a pattern. See below. |

**Zustand over Jotai:** Jotai's atom model is elegant but verbose for the multi-agent use case. An agent registry with N agents each having `{ id, state, messages, cost }` maps naturally to a single Zustand store with a `Record<AgentId, AgentSlice>`. Zustand's `subscribeWithSelector` lets components subscribe to exactly the slice they need (one agent's state) without re-rendering when other agents update — critical for the N-agent dashboard.

**Zustand over XState:** XState is the right tool for the Rust side (the `AgentState` enum in ARCHITECTURE.md is effectively a state machine). On the frontend, however, XState adds significant boilerplate for what is essentially a read-mostly view of state that originates in Rust. The Rust backend is the source of truth for agent state — the frontend receives `StateChanged` events via Tauri Channel and reflects them. A state machine in the frontend as well creates a dual source of truth. Use Zustand to mirror Rust state; don't re-implement the state machine logic in JS.

**Zustand over Redux:** Redux is categorically over-engineered for this use case. No action creators, no reducers, no middleware for a single-user desktop app.

**Streaming text pattern (not a library):**
```typescript
// DO NOT: setState on every token — causes 60-100 renders/sec
// DO: buffer in ref, flush at 60fps
const bufferRef = useRef<string>('');
const [displayText, setDisplayText] = useState('');

useEffect(() => {
  let animFrameId: number;
  const flush = () => {
    if (bufferRef.current.length > 0) {
      setDisplayText(prev => prev + bufferRef.current);
      bufferRef.current = '';
    }
    animFrameId = requestAnimationFrame(flush);
  };
  animFrameId = requestAnimationFrame(flush);
  return () => cancelAnimationFrame(animFrameId);
}, []);

// In Channel listener:
channel.onmessage = (event: AgentEvent) => {
  if (event.type === 'token') bufferRef.current += event.text;
  // other event types go directly to setState/zustand
};
```

This is the pattern for streaming. It is not exotic — it is `requestAnimationFrame` throttling, a well-established browser performance technique.

---

### Build Tooling

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `vite` | 6.x (currently 6.0) | Frontend dev server + bundler | Tauri's official frontend recommendation. `tauri dev` wraps `vite dev`. Fast HMR during development is critical — the Rust side takes 5–30 seconds to rebuild; the frontend should reload in < 100ms. |
| `pnpm` | 9.x | Package manager | Faster installs than npm, strict dependency isolation, and disk-efficient for a workspace that may grow. More importantly: pnpm's `node_modules` layout prevents accidental access to undeclared dependencies — relevant since Tauri's security model depends on explicit capability declarations. |
| `@vitejs/plugin-react` | 4.x | Vite plugin for React (SWC) | Use the SWC variant (`@vitejs/plugin-react-swc`) — 10-20x faster than Babel for HMR. No practical downside for a new project. |

**Turborepo: Not needed.** The project is a single Cargo workspace (Rust) + a single Tauri app (frontend). Turbo adds value for monorepos with multiple independent JS packages. Adding it now is premature complexity.

---

### Tauri Plugins

Tauri 2.x has a granular plugin system. Each plugin requires a Rust crate (`tauri-plugin-*`) + npm package (`@tauri-apps/plugin-*`) + capability declaration.

| Plugin | npm Package | Rust Crate | Why Needed | Priority |
|--------|------------|------------|------------|----------|
| `fs` | `@tauri-apps/plugin-fs` | `tauri-plugin-fs` | Read/write config files, session files from the frontend | P1 — needed for settings UI and session loading |
| `shell` | `@tauri-apps/plugin-shell` | `tauri-plugin-shell` | Open external links (docs, provider dashboards) in the system browser | P2 — needed for any `href` that should not load inside the WebView |
| `notification` | `@tauri-apps/plugin-notification` | `tauri-plugin-notification` | Background agent completion notifications | P2 — needed for background agent UX |
| `window-state` | `@tauri-apps/plugin-window-state` | `tauri-plugin-window-state` | Persist window size/position across restarts | P1 — add from day one, trivial to set up |
| `dialog` | `@tauri-apps/plugin-dialog` | `tauri-plugin-dialog` | Native file/folder picker for project directory selection | P2 — needed for onboarding / new session UI |
| `clipboard-manager` | `@tauri-apps/plugin-clipboard-manager` | `tauri-plugin-clipboard-manager` | Copy code blocks to clipboard | P1 — table stakes (copy button on code blocks) |
| `process` | `@tauri-apps/plugin-process` | `tauri-plugin-process` | Graceful app restart after config changes | P3 — nice-to-have |
| `store` | `@tauri-apps/plugin-store` | `tauri-plugin-store` | Lightweight key-value persistence for UI preferences | P2 — alternative to rolling custom config |
| `updater` | NOT recommended | — | Auto-updates | Skip for personal use. Requires code signing infrastructure. See PITFALLS.md Pitfall 7. |
| `deep-link` | NOT needed | — | URL protocol handling | No use case for this project. |

**Capability configuration is mandatory.** Every plugin requires an explicit grant in `src-tauri/capabilities/default.json`. Missing this causes silent permission denial at runtime with no error message — the most common Tauri 2.x pitfall (PITFALLS.md Pitfall 13).

---

### UI Component Library

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `tailwindcss` | 4.x (v4 stable as of 2025) | Utility-first styling | Fastest path to a polished dark-mode-first coding tool UI. No design system overhead. Tauri apps with Tailwind look native-quality with minimal effort. |
| `shadcn/ui` | Current (not versioned — copy-paste) | Accessible component primitives | NOT a dependency — you copy component source into the project. Built on Radix UI primitives. Provides: Dialog, DropdownMenu, Tooltip, Tabs, ScrollArea — exactly the components needed for agent panels, model selectors, and permission prompts. Use it as a starting point, not as a locked-in library. |
| `@radix-ui/react-*` | Latest | Accessible primitives under shadcn | shadcn components depend on these directly. Radix handles focus management, keyboard navigation, and ARIA correctly — critical for the permission prompt modal which must be keyboard-accessible when agents are actively running. |
| `lucide-react` | Latest | Icon set | The icon set shadcn ships with. Consistent, minimal, works well in dark mode. |

**Avoid:** Material UI, Ant Design, Chakra — all too opinionated in their visual language for a dev tool that should feel native and minimal. Component override complexity exceeds the benefit.

---

### Markdown and Code Rendering

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `react-markdown` | 9.x | Render markdown in chat messages | Correct choice: handles streaming partial markdown (incomplete code fences, partial headers) gracefully. Works incrementally — you can re-render on each `token` event without visual glitches. |
| `rehype-highlight` | Latest | Syntax highlighting in code blocks | Pairs with `react-markdown`. Uses `highlight.js` under the hood. Provides CSS class-based highlighting — easy to theme with Tailwind's dark mode. |
| `rehype-raw` | Latest | Allow HTML in markdown if needed | Only needed if tool outputs include raw HTML fragments. Optional. |

**Alternative considered:** `marked` + a custom renderer. Rejected because `react-markdown` handles the React component tree correctly (allowing the copy-button component to be inserted as a React component inside code blocks). `marked` produces HTML strings that require `dangerouslySetInnerHTML` — bad practice in a Tauri app where the content may include bash output.

**Diff rendering:** For inline diffs (before/after file content), use `react-diff-viewer-continued` (the maintained fork of `react-diff-viewer`). It handles unified and split diff formats, dark mode, and large files via line virtualization.

---

### Terminal Output Display

**Recommendation: Do NOT embed a full terminal emulator (xterm.js, wezterm).**

Rationale from FEATURES.md: A built-in terminal emulator is an anti-feature for this project. xolotl is a chat-first orchestration tool — agents run bash via the backend's `bash.rs` tool and results appear as tool-call blocks in the chat UI. Users do not need a raw terminal.

For tool output display:
- Bash output → render as a `<pre>` block with ANSI color stripping (use the `ansi-to-html` npm package to convert ANSI escape codes to HTML spans with CSS color classes).
- Long outputs → virtualized collapsible block (collapsed by default, expand on click, virtualized list for outputs > 100 lines).
- Streaming bash output → follow the same ref-buffer pattern as streaming text.

If a future requirement emerges for an actual terminal (debugging, interactive shells), add `xterm.js` at that point. `xterm.js` is 300+ KB gzipped and adds significant complexity to the Tauri WebView sandbox. Don't pre-optimize for a requirement that's explicitly out of scope.

---

### Virtualization (Message List)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@tanstack/react-virtual` | 3.x | Virtualize long conversation histories | A chat session with 200 turns of multi-tool agentic output can exceed 10,000 DOM nodes. Without virtualization, React layout + paint times exceed 16ms and the UI stutters. `@tanstack/react-virtual` renders only the visible window of messages. Essential for the agent dashboard with N concurrent agent views. |

---

### IPC Type Safety

**Recommendation: Generate TypeScript types from Rust structs using `specta` + `tauri-specta`.**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `specta` | 2.x | Rust → TypeScript type generation | Generates `.ts` type definitions from Rust structs. Ensures the `AgentEvent` enum, `SpawnRequest`, `AgentState` etc. have exact TypeScript counterparts. Eliminates an entire class of IPC bugs where the frontend uses wrong field names or wrong types. |
| `tauri-specta` | 2.x | Tauri-specific bindings for specta | Generates `invoke()` wrappers with correct TypeScript signatures. Instead of `invoke<AgentId>("spawn_agent", { request })` (no type safety), you get a generated `commands.spawnAgent(request)` function with full type checking. |

**Confidence: MEDIUM.** `specta` + `tauri-specta` are the community-standard approach as of the training cutoff, actively maintained, and officially recommended in Tauri community resources. Verify current package versions before adopting.

---

### Versions Summary (as of August 2025 training data — verify before pinning)

| Package | Version | npm / crates.io |
|---------|---------|----------------|
| `tauri` (Rust) | 2.1.x | crates.io |
| `@tauri-apps/api` | 2.1.x | npm |
| `@tauri-apps/cli` | 2.1.x | npm |
| `react` | 19.0.x | npm |
| `react-dom` | 19.0.x | npm |
| `typescript` | 5.5.x | npm |
| `vite` | 6.0.x | npm |
| `@vitejs/plugin-react-swc` | 3.x | npm |
| `tailwindcss` | 4.x | npm |
| `zustand` | 5.0.x | npm |
| `@tanstack/react-virtual` | 3.x | npm |
| `react-markdown` | 9.x | npm |
| `rehype-highlight` | 7.x | npm |
| `react-diff-viewer-continued` | 3.x | npm |
| `specta` | 2.x | crates.io |
| `tauri-specta` | 2.x | crates.io |

---

## Alternatives Considered and Rejected

| Category | Recommended | Alternative | Why Rejected |
|----------|-------------|-------------|--------------|
| Desktop framework | Tauri 2.x | Electron | 150 MB overhead; requires Node.js bridge for Rust backend; no integration advantage |
| Frontend framework | React 19 | Svelte 5 | Thinner ecosystem for complex state; fewer ready-made libraries for agent dashboard use case |
| Frontend framework | React 19 | SolidJS | Smaller ecosystem; streaming perf problem solvable in React 19 |
| State management | Zustand 5 | Jotai | Atom model less natural for N-agent registry with subscribeWithSelector |
| State management | Zustand 5 | XState (frontend) | Dual source of truth — Rust is the authoritative state machine |
| State management | Zustand 5 | Redux | Over-engineered; no multi-user requirements |
| Package manager | pnpm | npm | Slower; no strict dependency isolation |
| Package manager | pnpm | yarn | No significant advantage over pnpm for this use case |
| Monorepo tooling | (none) | Turborepo | Premature; single Tauri app doesn't need it |
| Component library | shadcn/ui | Material UI | Too opinionated visually; large override burden |
| Component library | shadcn/ui | Ant Design | Same issue + Chinese ecosystem (i18n assumptions) |
| Terminal emulator | (not added) | xterm.js | Anti-feature per FEATURES.md; 300 KB overhead for out-of-scope capability |
| Type generation | specta | Manual type sync | Error-prone; IPC boundary divergence causes hard-to-debug runtime failures |
| Build tool | Vite 6 | webpack | Slower HMR; no benefit over Vite for this use case |

---

## Tauri IPC Pattern: Commands vs Events vs Channels

These are three distinct IPC mechanisms in Tauri 2.x. Use each for the right purpose:

**`#[tauri::command]` (request/response):** For user-initiated actions where the frontend awaits a result. Examples: `spawn_agent(request)` → returns `AgentId`; `list_worktrees()` → returns `Vec<WorktreeInfo>`; `respond_to_permission(decision)` → returns `()`. Keep command responses small (< 64 KB). Never return full session histories.

**`Channel<T>` (streaming, Rust → frontend):** For ongoing data streams from a specific Rust task to a specific frontend consumer. One Channel per agent. The frontend passes a Channel handle to `spawn_agent`; the Rust backend holds the `Channel<AgentEvent>` sender in `AgentHandle`. This is the correct primitive for token streaming. HIGH confidence — Channel was introduced specifically in Tauri 2.0 to replace the old event system for this exact use case.

**`app_handle.emit()` (broadcast events, Rust → all windows):** For global state changes that all windows need to know about. Examples: app update available, global error, background agent completing when the main window is minimized. Do not use for per-agent streaming — use Channel for that.

**`app_handle.emit_to(window_label, ...)` (targeted events):** For sending to a specific window without a Channel. Use sparingly; Channel is preferred for typed streaming.

---

## Installation

```bash
# Create Tauri project inside existing Cargo workspace
cd rust
pnpm create tauri-app xolotl-ui -- --template react-ts

# Or manually scaffold:
mkdir src-tauri
# Add to rust/Cargo.toml workspace.members

# Frontend packages
pnpm add @tauri-apps/api react react-dom zustand @tanstack/react-virtual
pnpm add react-markdown rehype-highlight react-diff-viewer-continued
pnpm add @radix-ui/react-dialog @radix-ui/react-dropdown-menu lucide-react
pnpm add ansi-to-html

# Dev dependencies
pnpm add -D @tauri-apps/cli typescript vite @vitejs/plugin-react-swc tailwindcss

# Tauri plugins (Rust crates added to src-tauri/Cargo.toml):
# tauri-plugin-fs
# tauri-plugin-shell
# tauri-plugin-notification
# tauri-plugin-window-state
# tauri-plugin-dialog
# tauri-plugin-clipboard-manager
# tauri-plugin-store
# specta
# tauri-specta

# Tauri plugin npm packages:
pnpm add @tauri-apps/plugin-fs @tauri-apps/plugin-shell
pnpm add @tauri-apps/plugin-notification @tauri-apps/plugin-window-state
pnpm add @tauri-apps/plugin-dialog @tauri-apps/plugin-clipboard-manager
pnpm add @tauri-apps/plugin-store
```

---

## Project Structure (Tauri Layer)

```
rust/
  src-tauri/               # New Tauri crate (part of Cargo workspace)
    src/
      main.rs              # Tauri builder, managed state, command registration
      lib.rs               # Library root for specta type export
      commands/
        agent_commands.rs  # spawn_agent, kill_agent, send_message, respond_to_permission
        worktree_commands.rs # create_worktree, list_worktrees, delete_worktree
        session_commands.rs  # list_sessions, load_session
        config_commands.rs   # get_config, set_config
      state/
        supervisor.rs      # AgentSupervisor (thin re-export from orchestrator crate)
    Cargo.toml             # tauri 2.x + all tauri-plugin-* + specta + tauri-specta
    tauri.conf.json        # Window config, bundle ID, plugin list
    capabilities/
      default.json         # Core permissions + per-plugin grants
    icons/                 # App icons

frontend/                  # Vite/React project (sibling to rust/, or inside rust/)
  src/
    main.tsx
    App.tsx
    store/
      agentStore.ts        # Zustand store: agent registry, messages, cost
      sessionStore.ts      # Session list, current session
    hooks/
      useAgentStream.ts    # Channel subscription per agent_id
      useAgentList.ts      # Zustand selector for agent registry
    components/
      chat/
        ChatPanel.tsx      # Message thread for one agent
        MessageBubble.tsx  # Single turn (user/assistant)
        ToolCallBlock.tsx  # Collapsible tool invocation + result
        DiffBlock.tsx      # Before/after file diff
        CodeBlock.tsx      # Syntax-highlighted code + copy button
      agents/
        AgentRoster.tsx    # Dashboard: list of all active agents
        AgentCard.tsx      # One agent: status, model, cost, last output
        SpawnAgentDialog.tsx # Form to create a new agent
        PermissionPrompt.tsx # Inline allow/deny card
      layout/
        Sidebar.tsx        # Session list + navigation
        TopBar.tsx         # Model indicator, cost display, controls
      shared/
        CostMeter.tsx      # Token/cost display
        ModelBadge.tsx     # Model name chip
    bindings/
      commands.ts          # Generated by tauri-specta — DO NOT EDIT manually
      types.ts             # Generated by specta — DO NOT EDIT manually
  vite.config.ts
  tsconfig.json
  tailwind.config.ts
  package.json
```

---

## Windows Build Notes (Development Platform)

The existing `rust/.cargo/config.toml` sets up WinLibs + GNU toolchain to work around the Git `link.exe` collision with MSVC. When adding the Tauri crate to the workspace:

- Tauri 2.x on Windows requires **WebView2** (ships with Windows 11 — no separate install needed).
- The `tauri build` command requires either the MSVC toolchain or the GNU toolchain consistently. The existing GNU override (`stable-x86_64-pc-windows-gnu`) should work but verify that Tauri's build scripts don't require MSVC-specific flags.
- On Windows, `tauri dev` launches the WebView2-based window. The existing `RUST_LOG` env var for tracing will work normally.
- The build output directory is already overridden in `.cargo/config.toml` to `C:\Users\zazuk\claw-build` — Tauri's build artifacts will land there as well.

---

## Confidence Assessment

| Area | Confidence | Basis |
|------|------------|-------|
| Tauri 2.x + Channel IPC | HIGH | Tauri 2.0 stable (Oct 2024) within training window; Channel is the documented streaming primitive |
| Tauri plugin list and versions | MEDIUM | Plugin APIs are stable; specific versions may have patch releases since August 2025 |
| React 19 recommendation | HIGH | React 19 released Dec 2024, stable; useTransition + concurrent features are the documented streaming solution |
| Zustand 5 recommendation | HIGH | Zustand 5 released Oct 2024, stable; subscribeWithSelector is established |
| Vite 6 recommendation | HIGH | Vite 6 released Nov 2024, stable; @vitejs/plugin-react-swc is the standard Tauri template |
| pnpm recommendation | HIGH | Standard practice for Tauri projects; no ecosystem risk |
| specta + tauri-specta | MEDIUM | Community standard but not "official" Tauri tooling; verify active maintenance |
| Tailwind 4 | MEDIUM | v4 was in beta/RC as of training cutoff; verify stable release |
| react-diff-viewer-continued | MEDIUM | Fork of unmaintained original; verify maintenance status |
| Terminal emulator (not recommended) | HIGH | Anti-feature per documented product scope; no research needed |
| shadcn/ui recommendation | HIGH | Well-established for dark-mode dev tools; zero lock-in risk (copy-paste model) |

---

## Sources

- Tauri 2.0 architecture and IPC: training knowledge from Tauri 2.0 stable release (October 2024) — verify at https://v2.tauri.app
- Tauri Channel API: specifically documented in https://v2.tauri.app/develop/calling-rust/#channels
- Tauri plugin list: https://v2.tauri.app/plugin/
- Tauri capabilities/permissions: https://v2.tauri.app/security/capabilities/
- React 19 release: training knowledge from December 2024
- Zustand 5 release: training knowledge from October 2024
- Vite 6 release: training knowledge from November 2024
- specta/tauri-specta: https://github.com/oscartbeaumont/tauri-specta
- shadcn/ui: https://ui.shadcn.com
- Project context: `.planning/PROJECT.md`, `.planning/codebase/STACK.md`, `.planning/codebase/ARCHITECTURE.md`
- Existing research: `.planning/research/ARCHITECTURE.md` (IPC patterns), `.planning/research/PITFALLS.md` (streaming + blocking pitfalls)

**CRITICAL:** Verify all npm package versions at npmjs.com and Rust crate versions at crates.io before pinning. All versions stated here are as of August 2025.
