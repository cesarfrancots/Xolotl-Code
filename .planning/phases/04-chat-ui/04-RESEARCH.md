# Phase 4: Chat UI - Research

**Researched:** 2026-05-10
**Domain:** React 19 + Tauri IPC event streaming + virtualized chat UI
**Confidence:** HIGH (core stack), MEDIUM (some integration patterns)

---

## Summary

Phase 4 delivers the complete chat experience on top of the Tauri IPC infrastructure built in Phase 3. The primary challenge is wiring the new `AgentEvent::TextDelta(String)` variant through the Rust supervisor → broadcast channel → Tauri event relay → React state pipeline, then rendering that stream efficiently. The existing event relay in `commands.rs` requires zero modification — adding the variant to the `AgentEvent` enum in `agent_state.rs` and updating `bindings.ts` manually is all the Rust work needed.

The frontend is a greenfield build: the current `App.tsx` is a scaffold with no real UI. Every Zustand store, component, and layout must be created from scratch. The stack (React 19, Zustand 5, Tailwind 4, shadcn/Radix, @tanstack/react-virtual) is locked in CONTEXT.md decisions but none of it is installed yet — Phase 4 Wave 0 must bootstrap Tailwind 4 via `@tailwindcss/vite` and initialize shadcn.

The key design tension is between streaming responsiveness (buffered rAF flush, D-02) and virtualization correctness (`measureElement` on dynamic-height items). These two interact: adding a streaming delta mutates an existing message's content, which changes its DOM height, which must re-trigger `measureElement` to keep the virtualizer accurate. The pattern for this is to wrap the streaming message's container div with `ref={virtualizer.measureElement}` and ensure React re-renders the ref element when content changes.

**Primary recommendation:** Add `TextDelta` to Rust, manually patch `bindings.ts`, bootstrap Tailwind/shadcn, then build the Zustand stores and core chat shell before touching virtualization or markdown rendering.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Add `AgentEvent::TextDelta(String)` variant to the Rust runtime. The existing broadcast channel + Tauri event relay picks it up automatically.
- D-02: Frontend buffers incoming `TextDelta` events in a React ref and flushes to state on each `requestAnimationFrame` tick (~60fps).
- D-03: User messages sent by extending/reusing the existing `spawn_agent` Tauri command (not a new command).
- D-04: Fixed 2-column layout: session list sidebar (left) + chat pane (right). Sidebar always visible.
- D-05: Model selector in top bar of the chat pane, per-session dropdown.
- D-06: Cost/token display: per-turn footnote below each assistant message; session running total in top bar.
- D-07: Dark-only color scheme. No light/dark toggle in Phase 4.
- D-08: `react-markdown` + `rehype-highlight` (highlight.js backend).
- D-09: Unified diff format, single-column with green/red line-background coloring.
- D-10: `diff` npm package (zero-deps) for diff computation.
- D-11: Four slash commands: `/clear`, `/model`, `/save`, `/load`, `/help`.
- D-12: shadcn `Command` component (cmdk) for slash command palette.

### Claude's Discretion
- Exact sidebar width and chat pane proportions.
- Session auto-save vs explicit-save-only behavior (within the constraint that `/save` and `/load` exist).
- Tool block expand/collapse default state (collapsed or expanded).
- Exact bash output truncation threshold for UI-03.

### Deferred Ideas (OUT OF SCOPE)
- Light/dark theme toggle.
- `/cost` slash command.
- Collapsible/resizable sidebar.
- Per-turn cost breakdown (input/output tokens separately).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UI-01 | User sees AI responses streaming token-by-token; buffered per rAF | TextDelta event wire-up, rAF flush pattern, Zustand streaming state |
| UI-02 | Code blocks with syntax highlighting and copy-to-clipboard | react-markdown + rehype-highlight + clipboard-manager plugin |
| UI-03 | Tool call blocks collapsible; bash output truncated with "show more" | Collapsible pattern via shadcn Collapsible or details/summary; truncation threshold at 2000 chars |
| UI-04 | File edits show inline diff (before/after) inside tool block | `diff` npm package `diffLines()` API + custom Tailwind rendering |
| UI-05 | Message list virtualized via @tanstack/react-virtual; 200+ turns performant | `useVirtualizer` with `measureElement` for dynamic height messages |
| UI-06 | Session sidebar lists saved sessions; resume or delete | Zustand session store + Tauri fs plugin for JSON persistence |
| UI-07 | Permission prompt as inline card in chat thread; approve/deny/always-allow | Existing `permission-request` event + `respondToPermission` command |
| UI-08 | Model selector per session from all configured providers | Per-session model field in Zustand; dropdown in top bar |
| UI-09 | Token count and dollar cost per turn and session total | `TurnCompleted` event carries `TokenUsage`; UsageTracker pattern |
| UI-10 | Cancel current turn via stop button; partial output preserved | `stopAgent` command + streaming state cleanup |
| UI-11 | Slash command palette opens with `/`; keyboard-first | cmdk `Command` component as popover above chat input |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| TextDelta streaming | API/Backend (Rust) | Frontend (React ref buffer) | Token production is in Rust runtime; frontend only buffers and renders |
| Session persistence | Frontend Server (Tauri fs) | — | Sessions saved as JSON via Tauri fs plugin; no remote DB |
| Message virtualization | Browser/Client | — | DOM measurement and scroll position are purely client-side |
| Slash command palette | Browser/Client | — | Pure UI state; no Rust involvement |
| Permission prompt | API/Backend (Rust) | Browser/Client | Decision originates in Rust runtime; UI card just responds |
| Cost/token display | Browser/Client | — | TokenUsage arrives in TurnCompleted event; math done in frontend |
| Model selection | Browser/Client | — | Model name stored in Zustand; passed to spawn_agent |
| Diff computation | Browser/Client | — | `diff` npm package runs in browser; before/after strings from ToolCallCompleted |

---

## Standard Stack

### Core (none installed yet — all require Wave 0 bootstrap)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tailwindcss | 4.3.0 | Utility CSS framework | Locked in STATE.md; v4 CSS-first config |
| @tailwindcss/vite | 4.3.0 | Vite plugin for Tailwind v4 | Required for v4 integration |
| @tailwindcss/typography | 0.5.19 | `prose` classes for markdown | Standard companion for react-markdown |
| zustand | 5.0.13 | Global state management | Locked in STATE.md; React 19 compatible |
| react-markdown | 10.1.0 | Markdown → React components | Locked D-08 |
| rehype-highlight | 7.0.2 | Syntax highlighting plugin | Locked D-08 |
| highlight.js | 11.11.1 | Highlighting engine for rehype-highlight | Peer dep of rehype-highlight |
| @tanstack/react-virtual | 3.13.24 | Message list virtualization | Locked in STATE.md |
| diff | 9.0.0 | Diff computation (zero-deps) | Locked D-10 |
| cmdk | 1.1.1 | Slash command palette | Locked D-12 (shadcn Command is built on cmdk) |

[VERIFIED: npm registry — all versions confirmed 2026-05-10]

### shadcn Components (add via CLI — not npm install)

shadcn components are copied into `src/components/ui/` via the shadcn CLI, not installed as npm packages.

Required shadcn components:
- `command` — slash command palette (D-12), based on cmdk
- `button` — send button, copy button, approve/deny buttons
- `collapsible` — tool call blocks (UI-03)
- `dropdown-menu` — model selector (D-05)
- `scroll-area` — sidebar scroll
- `badge` — agent state indicators
- `card` — permission prompt card (UI-07)
- `separator` — layout dividers

[ASSUMED] — shadcn component list derived from UI requirements; may need additional components discovered during implementation.

### Supporting (for types only)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/diff | 5.x | TypeScript types for diff package | Required alongside `diff` |

[VERIFIED: npm registry — `diff` ships its own types as of v5+, @types/diff may not be needed]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| react-markdown + rehype-highlight | shiki | Shiki has better themes but larger bundle; locked out by D-08 |
| @tanstack/react-virtual | react-window | react-window older, less dynamic height support; locked out by STATE.md |
| diff npm package | jsdiff or custom | diff IS jsdiff (same package, npm name `diff`); zero-deps is the win |
| cmdk | custom command palette | cmdk is what shadcn Command wraps; D-12 locks this |

**Installation:**
```bash
# From tauri-app directory
npm install tailwindcss @tailwindcss/vite @tailwindcss/typography
npm install zustand react-markdown rehype-highlight highlight.js
npm install @tanstack/react-virtual diff cmdk
# shadcn init (separate step — adds components.json, src/lib/utils.ts)
npx shadcn@latest init
# Add shadcn components
npx shadcn@latest add command button collapsible dropdown-menu scroll-area badge card separator
```

[VERIFIED: npm registry — package names and versions confirmed]

---

## Architecture Patterns

### System Architecture Diagram

```
User Input
    │
    ▼
Chat Input (React)
    │  "/" keypress → slash palette (cmdk Command)
    │  Enter → spawn_agent(branch, message) via bindings.ts
    ▼
Tauri IPC (invoke)
    │
    ▼
AgentSupervisor::spawn_agent()    ← Rust
    │
    ▼
AgentHandle::event_tx (mpsc sender)
    │
    ▼
re-broadcast loop (tokio::spawn)
    │
    ▼
broadcast::Sender<AgentEvent>     ← broadcasts TextDelta, ToolCallStarted, etc.
    │
    ▼
spawn_event_relay (commands.rs)   ← existing, no changes needed
    │
    ▼
app.emit("agent-event:{agent_id}", &event)   ← Tauri event
    │
    ▼
Frontend listen("agent-event:{id}", handler)  ← React
    │
    ├─ TextDelta → buffer in ref, flush per rAF → append to streaming message
    ├─ ToolCallStarted → insert tool block (loading state)
    ├─ ToolCallCompleted → update tool block with output + diff
    ├─ TurnCompleted → finalize message, record usage, clear streaming
    ├─ StateChanged → update agent status badge
    └─ permission-request event (separate channel) → insert permission card
         │
         └─ User response → respondToPermission(promptId, decision)

Zustand Store (chatStore)
    │
    ├─ sessions: Session[]
    ├─ activeSessionId: string | null
    ├─ messages: Message[] (per session)
    ├─ streamingContent: string (rAF-flushed buffer)
    ├─ isStreaming: boolean
    └─ usage: { perTurn: TokenUsage[], sessionTotal: TokenUsage }
```

### Recommended Project Structure

```
tauri-app/src/
├── components/
│   ├── ui/                  # shadcn-generated components (do not edit)
│   ├── chat/
│   │   ├── ChatPane.tsx     # right column — message list + input bar
│   │   ├── MessageList.tsx  # virtualized list via useVirtualizer
│   │   ├── Message.tsx      # single message: text, tool blocks, cost footnote
│   │   ├── MessageInput.tsx # textarea + send + stop + slash palette
│   │   ├── ToolBlock.tsx    # collapsible tool call with diff view
│   │   ├── DiffView.tsx     # green/red line diff rendering
│   │   ├── PermissionCard.tsx # inline approve/deny/always-allow card
│   │   └── SlashPalette.tsx # cmdk Command popover
│   └── sidebar/
│       ├── SessionSidebar.tsx  # left column — session list
│       └── SessionItem.tsx     # single session entry
├── stores/
│   ├── chatStore.ts         # Zustand: messages, streaming state, active session
│   └── sessionStore.ts      # Zustand: session list, load/save operations
├── lib/
│   ├── utils.ts             # shadcn cn() utility
│   ├── diff.ts              # wrapper around diff npm package
│   └── cost.ts              # per-model pricing table, dollar formatting
├── hooks/
│   ├── useAgentEvents.ts    # listen() subscription setup and teardown
│   └── useScrollToBottom.ts # auto-scroll logic with user-scroll detection
├── bindings.ts              # hand-maintained Tauri Specta types
├── App.tsx                  # layout shell: sidebar + chat pane
├── main.tsx                 # React root
└── styles.css               # @import "tailwindcss"; @theme overrides; hljs theme
```

### Pattern 1: TextDelta → rAF Flush (UI-01)

**What:** Incoming TextDelta events are not immediately committed to React state. Instead they accumulate in a `ref` (not state) and a `requestAnimationFrame` loop drains the ref into state once per frame.

**When to use:** Any event that fires faster than React can re-render (>30/sec). This prevents a render cascade at 60-100 events/sec.

**Example:**
```typescript
// Source: D-02 decision + standard rAF pattern [ASSUMED code, pattern is verified]
const deltaBuffer = useRef<string>("");
const rafId = useRef<number | null>(null);

// Called by Tauri listen() handler:
function onTextDelta(delta: string) {
  deltaBuffer.current += delta;
  if (rafId.current === null) {
    rafId.current = requestAnimationFrame(() => {
      chatStore.appendStreamingContent(deltaBuffer.current);
      deltaBuffer.current = "";
      rafId.current = null;
    });
  }
}
```

### Pattern 2: useVirtualizer with Dynamic Heights (UI-05)

**What:** `useVirtualizer` with `measureElement` callback ref to capture actual DOM heights of variable-height messages.

**When to use:** Any scrollable list where item heights are unknown at render time. For chat: every message is different height.

**Key insight:** During streaming, the same message item's DOM height grows frame by frame. The `measureElement` ref callback fires on every render of the item div — this is correct behavior and the virtualizer adapts `getTotalSize()` continuously.

**Example:**
```typescript
// Source: TanStack Virtual official API docs [CITED: tanstack.com/virtual/latest/docs/api/virtualizer]
const parentRef = useRef<HTMLDivElement>(null);

const virtualizer = useVirtualizer({
  count: messages.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 80,       // generous estimate: actual sizes refine via measureElement
  measureElement: (el) =>
    el?.getBoundingClientRect().height ?? 80,
  overscan: 5,
});

// Auto-scroll to bottom when new message arrives OR streaming grows
useEffect(() => {
  if (isStreaming || messages.length > prevLen.current) {
    virtualizer.scrollToIndex(messages.length - 1, { align: "end", behavior: "auto" });
    prevLen.current = messages.length;
  }
}, [messages.length, isStreaming, streamingContent]);

// Render
<div ref={parentRef} style={{ height: "100%", overflowY: "auto" }}>
  <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
    {virtualizer.getVirtualItems().map((vItem) => (
      <div
        key={vItem.key}
        data-index={vItem.index}
        ref={virtualizer.measureElement}
        style={{ position: "absolute", transform: `translateY(${vItem.start}px)`, width: "100%" }}
      >
        <Message message={messages[vItem.index]} />
      </div>
    ))}
  </div>
</div>
```

### Pattern 3: react-markdown + rehype-highlight (UI-02)

**What:** Render markdown with fenced code blocks auto-highlighted via highlight.js. Custom `code` component adds copy button.

**When to use:** All assistant text messages.

**Tailwind v4 note:** No `prose-invert` class needed for dark-only — target `dark:` prefix is not needed either. Just configure the prose color tokens in `@theme` block to use dark palette directly.

**Example:**
```typescript
// Source: rehypejs/discussions#69, react-markdown README [CITED]
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";  // import in styles.css, not here

const MarkdownRenderer = ({ content }: { content: string }) => (
  <ReactMarkdown
    className="prose prose-sm max-w-none"
    rehypePlugins={[rehypeHighlight]}
    components={{
      code({ className, children, ...props }) {
        const isBlock = className?.startsWith("language-");
        if (isBlock) {
          return (
            <div className="relative group">
              <code className={className} {...props}>{children}</code>
              <CopyButton text={String(children)} />
            </div>
          );
        }
        return <code className="bg-neutral-800 px-1 rounded text-sm" {...props}>{children}</code>;
      },
    }}
  >
    {content}
  </ReactMarkdown>
);
```

**Note on Tailwind 4 + prose:** The `@tailwindcss/typography` plugin is added to `styles.css` as `@plugin "@tailwindcss/typography"` (not in a JS config). [CITED: tailwindcss.com/blog/tailwindcss-v4]

### Pattern 4: diff npm package for Inline Diffs (UI-04)

**What:** Compute line-level diffs between before/after strings, render each changed line with green/red background.

**API:**
```typescript
// Source: kpdecker/jsdiff README [CITED: github.com/kpdecker/jsdiff]
import { diffLines } from "diff";

const changes = diffLines(oldStr, newStr);
// changes: Array<{ value: string, added?: boolean, removed?: boolean, count: number }>

// Render:
changes.map((part, i) => {
  const bg = part.added ? "bg-green-900/40" : part.removed ? "bg-red-900/40" : "";
  const prefix = part.added ? "+" : part.removed ? "-" : " ";
  return part.value.split("\n").filter(Boolean).map((line, j) => (
    <div key={`${i}-${j}`} className={`font-mono text-xs px-2 ${bg}`}>
      {prefix} {line}
    </div>
  ));
});
```

### Pattern 5: cmdk Slash Command Palette (UI-11, D-12)

**What:** `Command` component (shadcn wrapping cmdk) opens as a popover above the chat input when user types `/`.

**Integration approach:** Monitor the `onChange` of the chat input. When value starts with `/`, set `paletteOpen = true` and show the `Command` popover. Selecting a command inserts its text into the input (or executes directly) and closes the palette.

**Example:**
```typescript
// Source: cmdk docs [CITED: github.com/dip/cmdk]
const [paletteOpen, setPaletteOpen] = useState(false);
const [inputValue, setInputValue] = useState("");

function handleInputChange(val: string) {
  setInputValue(val);
  setPaletteOpen(val.startsWith("/") && val.length >= 1);
}

// In JSX:
<Popover open={paletteOpen} onOpenChange={setPaletteOpen}>
  <PopoverAnchor asChild>
    <textarea value={inputValue} onChange={(e) => handleInputChange(e.target.value)} />
  </PopoverAnchor>
  <PopoverContent side="top" align="start" className="p-0 w-64">
    <Command shouldFilter>
      <Command.List>
        <Command.Item onSelect={() => executeCommand("clear")}>
          /clear — Reset current session
        </Command.Item>
        <Command.Item onSelect={() => executeCommand("model")}>
          /model — Open model picker
        </Command.Item>
        <Command.Item onSelect={() => executeCommand("save")}>
          /save — Save session
        </Command.Item>
        <Command.Item onSelect={() => executeCommand("load")}>
          /load — Load session
        </Command.Item>
        <Command.Item onSelect={() => executeCommand("help")}>
          /help — List commands
        </Command.Item>
      </Command.List>
    </Command>
  </PopoverContent>
</Popover>
```

### Pattern 6: Zustand 5 Chat Store

**What:** Two Zustand stores — `chatStore` for per-session message state and `sessionStore` for session list persistence.

**Example:**
```typescript
// Source: Zustand docs + [ASSUMED] structure for this app's needs
import { create } from "zustand";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;               // final text
  toolCalls: ToolCall[];
  usage?: TokenUsage;
  permissionPrompt?: PermissionPrompt;
}

interface ChatState {
  agentId: string | null;
  messages: Message[];
  streamingContent: string;      // in-flight, not yet committed to a message
  isStreaming: boolean;
  model: string;
  sessionUsage: TokenUsage;

  setAgentId: (id: string) => void;
  appendMessage: (msg: Message) => void;
  appendStreamingContent: (delta: string) => void;
  finalizeStream: (usage: TokenUsage) => void;
  addToolCall: (agentId: string, tool: string, input: string) => void;
  completeToolCall: (tool: string, output: string) => void;
  setModel: (model: string) => void;
  clearSession: () => void;
}

export const useChatStore = create<ChatState>()((set) => ({
  // ...implementation
}));
```

### Pattern 7: Tailwind v4 Setup (Wave 0 prerequisite)

**What:** Tailwind v4 uses CSS-first configuration — no `tailwind.config.js`. The Vite plugin handles content scanning automatically.

**Vite config change:**
```typescript
// tauri-app/vite.config.ts
import tailwindcss from "@tailwindcss/vite";
// add to plugins: [react(), tailwindcss()]
```

**CSS entry point:**
```css
/* tauri-app/src/styles.css */
@import "tailwindcss";
@plugin "@tailwindcss/typography";

@theme {
  /* Dark-only custom tokens go here */
  --color-background: oklch(0.12 0 0);
  --color-surface: oklch(0.16 0 0);
}
```

[CITED: tailwindcss.com/blog/tailwindcss-v4, tailwindcss.com/docs/guides/vite]

### Pattern 8: TextDelta Rust Wire-Up (D-01)

**What:** Add `TextDelta(String)` variant to `AgentEvent` in `agent_state.rs`. No other Rust changes needed — the event relay in `commands.rs` picks it up via the broadcast channel automatically.

**`agent_state.rs` change:**
```rust
// rust/crates/runtime/src/supervisor/agent_state.rs
// Add after TurnCompleted variant:
TextDelta(String),
```

**`bindings.ts` manual patch** (until WebView2 DLL issue resolves):
```typescript
// Add TextDelta to the AgentEvent union type:
| ({ TextDelta: string }) & { ... }
```

**`serde(deny_unknown_fields)`:** The `AgentEvent` enum currently has this attribute. Adding `TextDelta` is a new variant, not a new field — no `deny_unknown_fields` issue.

[VERIFIED: read agent_state.rs directly — serde attribute confirmed on the enum, not on variants]

### Anti-Patterns to Avoid

- **Setting streaming state directly from the Tauri event handler:** Fires React setState 100x/sec → frame drops. Always buffer in ref, flush via rAF (D-02).
- **Calling `setState` inside the rAF callback with a closure over stale state:** Use Zustand's `get()` inside the action, not captured closure values.
- **Using `react-virtualized` instead of `@tanstack/react-virtual`:** The locked stack specifies `@tanstack/react-virtual` v3.
- **Adding `data-index` to the outer virtualizer div but not the inner content div:** The `measureElement` ref and `data-index` must be on the same element.
- **Measuring heights before fonts/images load:** Estimate generously (80px); the virtualizer corrects after measurement.
- **Skipping `#root { height: 100vh }` CSS:** Without a height constraint on the root, `getScrollElement()` returns an element with `scrollHeight = 0` and virtualization breaks.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown rendering | Custom markdown parser | `react-markdown` | Handles spec edge cases, XSS safety, remark/rehype pipeline |
| Syntax highlighting | Custom hljs integration | `rehype-highlight` | Correct plugin lifecycle with react-markdown |
| Diff computation | String diffing algorithm | `diff` npm package | Myers diff algorithm, edge cases, zero-deps already |
| Accessible command menu | Custom listbox + keyboard nav | `cmdk` (shadcn Command) | Focus trapping, ARIA, search, keyboard — 100+ edge cases |
| Virtual scroll | Manual absolute-position rendering | `@tanstack/react-virtual` | measureElement, getVirtualItems, getTotalSize — scroll math is subtle |
| UI component primitives | Custom dropdowns, popovers, dialogs | shadcn/Radix | Focus management, ARIA, keyboard, animation — Radix handles all |
| Copy to clipboard | `navigator.clipboard.writeText` | Tauri `clipboard-manager` plugin | Already installed; handles WebView2 clipboard quirks on Windows |

**Key insight:** The chat UI surface area looks straightforward but every element (command menus, virtual lists, diffs, markdown) has accessibility and edge-case complexity that library authors have already solved. Phase 4 is an integration problem, not an algorithm problem.

---

## Runtime State Inventory

> Phase 4 is not a rename/refactor phase — this section is OMITTED (greenfield UI build).

---

## Common Pitfalls

### Pitfall 1: serde `deny_unknown_fields` blocks TextDelta

**What goes wrong:** `AgentEvent` has `#[serde(deny_unknown_fields)]`. After adding `TextDelta`, old frontend code that tries to match the enum with `TextDelta?: never` in the exclusive union type will fail TypeScript compilation, not at runtime.
**Why it happens:** bindings.ts is manually maintained. Forgetting to add `TextDelta` to the union leaves the TypeScript types stale.
**How to avoid:** Immediately after adding the Rust variant, patch bindings.ts with the new TypeScript union member before writing any frontend code.
**Warning signs:** TypeScript errors on `AgentEvent` discriminated union access.

### Pitfall 2: Virtualizer breaks when scroll container has no fixed height

**What goes wrong:** Scroll position is always 0, virtualizer renders all items at once or renders none.
**Why it happens:** `getScrollElement()` returns a div whose computed height is `0` because no ancestor constrains it.
**How to avoid:** The scroll container div must have an explicit `height` or `max-height` (either CSS or Tailwind `h-full` with `overflow-y-auto`). The `#root` and all flex ancestors must be `h-screen` or `h-full`.
**Warning signs:** `virtualizer.getTotalSize()` returns the correct full height but the list visually renders all items.

### Pitfall 3: rAF callback captures stale `messages` from closure

**What goes wrong:** Each rAF flush appends to a stale copy of messages, so only the last delta is visible.
**Why it happens:** The `requestAnimationFrame` callback closes over the `messages` array at registration time. If Zustand's state updates asynchronously, the stale reference is used.
**How to avoid:** Write the Zustand action to use functional updates: `set((state) => ({ streamingContent: state.streamingContent + delta }))`. Never read `messages` from outside Zustand inside the rAF callback.
**Warning signs:** Streaming output shows only the most recent token, not accumulated text.

### Pitfall 4: Multiple Tauri `listen()` subscriptions not cleaned up

**What goes wrong:** Each re-render of the component that calls `listen()` adds another listener. Token count multiplies.
**Why it happens:** `listen()` in `@tauri-apps/api/event` is async and returns an `UnlistenFn`. If not called on unmount, subscriptions accumulate.
**How to avoid:** In `useEffect`, await the unlisten function and call it in the cleanup:
```typescript
useEffect(() => {
  let unlisten: (() => void) | null = null;
  listen("agent-event:...", handler).then((fn) => { unlisten = fn; });
  return () => { unlisten?.(); };
}, [agentId]);
```
**Warning signs:** TextDelta events fire multiple times per actual event; token count grows faster than expected.

### Pitfall 5: highlight.js CSS clashes with Tailwind prose

**What goes wrong:** `prose` resets `code` element padding and color, overriding highlight.js's styles.
**Why it happens:** `@tailwindcss/typography` applies `code::before` and `code::after` content quotes and resets many code element styles.
**How to avoid:** Wrap code blocks in a `not-prose` container or use `prose-pre:p-0` and configure the prose `code` component override. The `rehype-highlight` rendered `<code class="hljs language-*">` needs the hljs CSS to win specificity.
**Warning signs:** Code blocks render with visible backtick quotes around inline code, or syntax colors are not applied.

### Pitfall 6: AlwaysAllow not persisting across sessions (known deferred item)

**What goes wrong:** `permission_prompter.rs` emits `policy-update-requested` for `AlwaysAllow` but the Rust runtime treats it as `Allow` (no persisted policy). After a page refresh, "always allow" is not honored.
**Why it happens:** This is a known TODO in `permission_prompter.rs` — `PermissionPromptDecision::AlwaysAllow` requires `PermissionPolicy::authorize()` mutation which is not yet wired.
**How to avoid:** Track per-session `AlwaysAllow` decisions in the Zustand store. When a new `permission-request` event arrives for an already-always-allowed tool, auto-respond from the frontend without showing a card. This is the Phase 4 scope for this feature.
**Warning signs:** User has to re-approve same tool every new spawn.

### Pitfall 7: Tailwind v4 — `@tailwindcss/typography` must be added as `@plugin` in CSS, not in JS config

**What goes wrong:** `TypeError: Unknown at rule @plugin` or `prose` classes have no effect.
**Why it happens:** Tailwind v4 removed `tailwind.config.js`. Plugins must be declared in the CSS file.
**How to avoid:** In `styles.css`: `@plugin "@tailwindcss/typography";` (not in any JS config).
**Warning signs:** `prose` class appears in HTML but has zero styling applied.

### Pitfall 8: cmdk Command component re-filters on every keystroke when palette is open

**What goes wrong:** Typing `/cl` filters to `/clear` but doesn't show other commands starting with `/c`.
**Why it happens:** Default cmdk filter behavior uses full input value. Since the chat input value includes the slash prefix and the command name, filtering works correctly — but the filter function gets the full `inputValue` not just the command fragment.
**How to avoid:** Either pass `shouldFilter={false}` and filter the command list manually from the input string after stripping the leading `/`, or configure a custom `filter` prop that strips the `/` prefix before matching.
**Warning signs:** Typing `/cle` shows no results despite `/clear` existing.

---

## Code Examples

### Rust: Adding TextDelta variant

```rust
// rust/crates/runtime/src/supervisor/agent_state.rs
// Add inside the AgentEvent enum, after Error variant:
TextDelta(String),

// That's the only change needed in Rust for streaming.
// The event relay in commands.rs forwards all AgentEvent variants automatically.
```

[VERIFIED: read agent_state.rs — current enum has 5 variants, none is TextDelta]

### TypeScript: Adding TextDelta to bindings.ts

```typescript
// tauri-app/src/bindings.ts — manual patch
// In the AgentEvent type union, the exclusive discriminated union pattern:
| ({ TextDelta: string }) & { Error?: never; StateChanged?: never; ToolCallCompleted?: never; ToolCallStarted?: never; TurnCompleted?: never }
```

[VERIFIED: read bindings.ts — confirms the existing union pattern structure to match]

### Tauri listen() subscription setup

```typescript
// tauri-app/src/hooks/useAgentEvents.ts
import { listen } from "@tauri-apps/api/event";
import type { AgentEvent } from "../bindings";

export function useAgentEvents(agentId: string | null) {
  useEffect(() => {
    if (!agentId) return;
    let unlisten: (() => void) | null = null;
    listen<AgentEvent>(`agent-event:${agentId}`, (event) => {
      handleAgentEvent(event.payload);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [agentId]);
}
```

[VERIFIED: read commands.rs — confirms channel name format `agent-event:{agent_id.0}`]

### diff package: compute line diff

```typescript
// tauri-app/src/lib/diff.ts
import { diffLines } from "diff";
// Source: kpdecker/jsdiff README [CITED]

export function computeLineDiff(oldStr: string, newStr: string) {
  return diffLines(oldStr, newStr);
  // Returns: Array<{ value: string; added?: boolean; removed?: boolean; count: number }>
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tailwind `tailwind.config.js` | CSS-first `@theme` in `.css` file | v4.0 (Dec 2024) | No JS config needed; `@plugin` for plugins |
| `tailwindcss` + `postcss` | `@tailwindcss/vite` Vite plugin | v4.0 | No PostCSS config; add plugin to vite.config.ts |
| `rehype-highlight` v4 | `rehype-highlight` v7 | 2022-2024 | ESM-only; requires Node 12+; no CommonJS |
| Zustand `create` without generics | `create<State>()()` curried form | Zustand 4+ | Required for correct TypeScript inference |
| `prose-invert` for dark mode | CSS `@theme` dark token overrides | Tailwind v4 | No class toggling; always-dark is just the base theme |

**Deprecated/outdated:**
- `tailwind.config.js`: Not used in v4 projects (still supported for migration but not needed here).
- `rehype-highlight` v4.x: Old version; v7 is current with ESM.
- shadcn CLI v1 install pattern (`npx shadcn-ui@latest`): Renamed to `npx shadcn@latest`.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Tailwind v4 `@plugin "@tailwindcss/typography"` syntax is correct | Pattern 7 | Typography plugin won't load; fallback is adding it with postcss |
| A2 | shadcn components listed (collapsible, badge, card, etc.) are sufficient | Standard Stack | May need additional components discovered during implementation |
| A3 | Auto-scroll via `scrollToIndex(messages.length - 1)` is the right approach for streaming | Pattern 2 | May need user-scroll detection to pause auto-scroll |
| A4 | `diff@9.0.0` includes its own TypeScript types | Standard Stack | If not, add `@types/diff` |
| A5 | AlwaysAllow per-session state in Zustand is sufficient for Phase 4 | Pitfall 6 | Full persistence requires Rust `PermissionPolicy` mutation (Phase 5) |
| A6 | `spawn_agent` extended with `message: String` param is the right D-03 approach | Pattern (implied by D-03) | May need a separate `run_turn` command if session ID tracking is required |

---

## Open Questions

1. **How does `spawn_agent` receive a user message? (D-03 implementation detail)**
   - What we know: D-03 says "extend/reuse spawn_agent; not a new run_turn command." Current `spawn_agent` takes only `branch: String`.
   - What's unclear: The Rust `AgentSupervisor::spawn_agent()` only sets up infrastructure (channels, worktree). There is no `ConversationRuntime` wired yet — no actual API call happens. The agent is registered but idle.
   - Recommendation: Phase 4 needs to add a `run_agent_turn(agent_id, message)` command (or extend spawn_agent to accept an initial message) that feeds the message into `ConversationRuntime::run_turn()` inside `tokio::task::spawn_blocking`. This is the most significant missing piece in the IPC layer.

2. **How are models configured and listed?**
   - What we know: `config.rs` loads `RuntimeConfig` from `~/.xolotl-code/config.json`. Model is a string field.
   - What's unclear: Is there a Tauri command to list available models? Phase 4 UI-08 needs a model list for the dropdown.
   - Recommendation: Add a `list_models()` Tauri command that reads `RuntimeConfig` and returns configured model names. Or hardcode a known set (Anthropic models + any configured OpenAI-compat endpoints).

3. **Session persistence — what format and where?**
   - What we know: Rust `Session` type in `session.rs` already has JSON save/load. Sessions save to `~/.xolotl-code/sessions/`. Tauri fs plugin is installed.
   - What's unclear: Should the frontend read session files directly via the fs plugin, or should there be a `list_sessions()`/`load_session()` Tauri command wrapping the Rust session APIs?
   - Recommendation: Add Tauri commands for `list_sessions()`, `load_session(id)`, `delete_session(id)` rather than having React read the filesystem directly. This keeps the session format knowledge in Rust.

4. **`spawn_agent` and conversation management**
   - What we know: Each `spawn_agent` call creates a new git worktree and agent handle. A chat session is not one-to-one with an agent handle as currently defined.
   - What's unclear: For a simple chat, do we want a persistent agent (spawn once, re-use across turns) or a new agent per turn? The current architecture creates a new worktree per spawn.
   - Recommendation: For Phase 4 single-session chat, spawn once per session and run multiple turns through the same agent. This requires the agent task loop (not yet implemented) to stay alive between turns, waiting for user input.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js / npm | Frontend package install | ✓ | (npm confirmed working) | — |
| Tauri CLI | `npm run tauri dev` | ✓ | ^2 (in devDependencies) | — |
| Rust + MSVC toolchain | Rust compilation | ✓ | Confirmed by Phase 3 completion | — |
| Tauri clipboard-manager plugin | Copy button (UI-02) | ✓ | 2.3.2 (installed) | navigator.clipboard |
| Tauri fs plugin | Session file I/O | ✓ | 2.5.1 (installed) | — |
| @tailwindcss/vite | Tailwind v4 | Not installed | — | — |
| zustand | State management | Not installed | — | — |
| react-markdown | Markdown render | Not installed | — | — |
| rehype-highlight | Code highlighting | Not installed | — | — |
| @tanstack/react-virtual | Virtualization | Not installed | — | — |
| diff | Diff computation | Not installed | — | — |
| cmdk | Slash palette | Not installed | — | — |

**Missing dependencies with no fallback:**
- `@tailwindcss/vite`, `tailwindcss`, `zustand`, `react-markdown`, `rehype-highlight`, `@tanstack/react-virtual`, `diff`, `cmdk` — all must be installed in Wave 0 before any UI work begins.

**Missing dependencies with fallback:**
- None of the above have viable fallbacks given the locked decisions.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None detected — Wave 0 must establish |
| Config file | Not present |
| Quick run command | `npm run test` (to be configured) |
| Full suite command | `npm run test` |

The tauri-app has no test infrastructure. For Phase 4, given the UI-heavy nature and Tauri's WebView environment, full automated testing is limited. The validation strategy is primarily visual smoke testing via `tauri dev` with a few unit-testable pure functions.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01 | TextDelta events buffer in ref, flush per rAF | manual | launch app, trigger agent | — |
| UI-02 | Code blocks render highlighted with copy button | manual | launch app, send code-heavy message | — |
| UI-03 | Tool call blocks collapse; bash output truncates at threshold | manual | trigger bash tool call | — |
| UI-04 | File edits show before/after diff | unit | `npm test -- DiffView` (Wave 0) | ❌ Wave 0 |
| UI-05 | 200+ turn session scrolls without jank | manual | create 200-message fixture | — |
| UI-06 | Session save/resume/delete from sidebar | manual | UI flow test | — |
| UI-07 | Permission card appears, decisions flow to Rust | manual | use `test_permission_prompt` command | — |
| UI-08 | Model dropdown changes per-session model | manual | launch app, change model | — |
| UI-09 | Token/cost display correct | unit | `npm test -- cost.ts` (Wave 0) | ❌ Wave 0 |
| UI-10 | Stop button halts stream, preserves partial output | manual | trigger long agent run, cancel | — |
| UI-11 | Slash palette opens on `/`, commands execute | manual | type `/` in input | — |

### Sampling Rate

- **Per task commit:** `npx tsc --noEmit` (TypeScript type check — already in build)
- **Per wave merge:** Visual smoke test of all UI flows in `tauri dev`
- **Phase gate:** All 5 success criteria pass in live Tauri window before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tauri-app/src/lib/diff.test.ts` — unit tests for `computeLineDiff`, covers add/remove/unchanged
- [ ] `tauri-app/src/lib/cost.test.ts` — unit tests for dollar cost formatting per `TokenUsage`
- [ ] Test framework install: `npm install -D vitest @vitest/ui` — configure in `vite.config.ts`
- [ ] `tauri-app/vitest.config.ts` or `vite.config.ts` test block

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (no user auth in Phase 4) |
| V3 Session Management | partial | Session IDs are local UUIDs; no auth tokens |
| V4 Access Control | no | — (single-user local app) |
| V5 Input Validation | yes | react-markdown handles markdown XSS; do NOT use `dangerouslySetInnerHTML` for diff output |
| V6 Cryptography | no | — (no crypto in UI layer) |

### Known Threat Patterns for React + Tauri

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via markdown content | Tampering | react-markdown sanitizes by default; never set `rehypePlugins={[rehypeRaw]}` without explicit need |
| XSS via diff output rendered as HTML | Tampering | Render diff as text content (`.textContent` / React children), NOT `dangerouslySetInnerHTML` |
| Clipboard injection (copy button) | Tampering | Use Tauri clipboard plugin, not `navigator.clipboard` with raw content |
| Path traversal via session load | Tampering | Validate session IDs are UUIDs before passing to fs plugin; do not allow user-supplied paths |

---

## Sources

### Primary (HIGH confidence)

- `tauri-app/src/bindings.ts` — current AgentEvent TypeScript types (read directly)
- `tauri-app/src-tauri/src/commands.rs` — spawn_event_relay implementation (read directly)
- `rust/crates/runtime/src/supervisor/agent_state.rs` — AgentEvent Rust enum (read directly)
- `rust/crates/runtime/src/supervisor/supervisor.rs` — spawn_agent architecture (read directly)
- `tauri-app/package.json` — installed packages (read directly)
- npm registry — all library versions (npm view, 2026-05-10)

### Secondary (MEDIUM confidence)

- [TanStack Virtual API Docs](https://tanstack.com/virtual/latest/docs/api/virtualizer) — useVirtualizer options and measureElement pattern
- [kpdecker/jsdiff README](https://github.com/kpdecker/jsdiff) — diffLines API and change object format
- [cmdk GitHub](https://github.com/dip/cmdk) — Command component API and popover integration
- [Tailwind CSS v4 blog](https://tailwindcss.com/blog/tailwindcss-v4) — CSS-first config and @plugin syntax
- [rehypejs discussions #69](https://github.com/orgs/rehypejs/discussions/69) — rehype-highlight + react-markdown integration

### Tertiary (LOW confidence)

- WebSearch results for Zustand 5 chat store patterns — general guidance, not codebase-verified
- WebSearch results for react-markdown + Tailwind prose dark mode — confirmed pattern via multiple sources but not verified in this exact stack combination

---

## Metadata

**Confidence breakdown:**
- TextDelta wire-up: HIGH — codebase verified (event relay + enum location)
- Standard stack versions: HIGH — npm registry verified
- TanStack Virtual dynamic height: MEDIUM — official API docs, pattern confirmed
- react-markdown + rehype-highlight setup: MEDIUM — multiple sources agree
- cmdk slash palette pattern: MEDIUM — official README confirmed
- Zustand store structure: MEDIUM — pattern is standard, structure is [ASSUMED]
- Tailwind v4 CSS-first setup: HIGH — official blog post confirmed
- Open Question 1 (run_agent_turn gap): HIGH confidence this is a real gap

**Research date:** 2026-05-10
**Valid until:** 2026-06-10 (stable libraries; Tailwind v4 still evolving)
