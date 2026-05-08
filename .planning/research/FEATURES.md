# Feature Landscape

**Domain:** AI coding assistant — desktop app + CLI, multi-agent orchestration, open model support
**Researched:** 2026-05-07
**Confidence note:** Research tools (WebSearch, WebFetch, Bash/Context7 CLI) were unavailable in this session. All findings are from training data (cutoff August 2025). Features marked LOW confidence may have changed in products since then. Verify against current docs before treating as definitive.

---

## Competitive Reference Points

| Tool | Category | Relevant To xolotl |
|------|----------|-------------------|
| Warp | AI terminal | Agent mode, AI blocks, command UX patterns |
| OpenAI Codex app | Chat-first coding agent | UI/UX baseline, tool call display, background tasks |
| Cursor | AI IDE | Table stakes definition — what developers now expect |
| Jan / LM Studio / Msty | Local model UIs | Model management UX, open model support patterns |
| AutoGen / CrewAI / LangGraph | Multi-agent frameworks | Agent orchestration UX — mostly CLI/web, no desktop-first |

---

## Table Stakes

Features users expect from any AI coding tool. Missing these means users leave immediately or dismiss the product as a toy.

| Feature | Why Expected | Complexity | Confidence | Notes |
|---------|--------------|------------|------------|-------|
| Streaming responses | Every competitor streams; non-streaming feels broken | Low | HIGH | Rust backend already streams |
| Markdown rendering in chat | Code blocks, syntax highlight, headers — baseline readability | Low | HIGH | CLI already renders; Tauri frontend needs it |
| Syntax-highlighted code blocks | Reading code in monospace with color is non-negotiable | Low | HIGH | Part of markdown rendering |
| Copy button on code blocks | Extremely high-frequency action; missing it is maddening | Low | HIGH | Frontend component |
| Inline diff display | Showing what changed in files (before/after) | Med | HIGH | Codex and Cursor both show diffs; users expect this |
| Tool call / action visibility | Show what tools were called (read_file, bash, etc.) with expandable output | Med | HIGH | Cursor's "applying changes" UI set this expectation |
| Conversation history / context | Users need to scroll up and reference prior turns | Low | HIGH | Session management already exists in backend |
| Session persistence | Save and reload conversations | Low | HIGH | Backend already has JSON session save/load |
| Model switching | Swap the model mid-session or per-session | Low | HIGH | Config exists; UI selector needed |
| Permission prompts | Ask before executing destructive actions | Med | HIGH | Permissions system exists in backend |
| Cancel / stop generation | Interrupt a running response | Low | HIGH | Critical for long-running agent tasks |
| Keyboard shortcuts | Power users navigate by keyboard; mouse-only feels slow | Low | MEDIUM | Standard desktop app expectation |
| Cost / token display | Show current session cost and token count | Low | HIGH | Usage tracking exists in backend |
| Multiline input | Shift+Enter for newlines; paste large code blocks | Low | HIGH | CLI already handles this; frontend needs it |
| Slash commands | `/clear`, `/model`, `/help`, `/save`, `/load` | Low | HIGH | In Active requirements — expected by CLI users |

---

## Differentiators

Features that set xolotl apart. Not universally expected yet, but high value given the multi-agent + open model focus.

| Feature | Value Proposition | Complexity | Confidence | Notes |
|---------|-------------------|------------|------------|-------|
| **Agent orchestration dashboard** | Live view of all running agents, their status, current task, cost, and output. Nothing in Cursor/Codex has this. | High | HIGH | Core differentiator; backend subagent spawner exists |
| **Parallel worktree agents** | Spawn agents on separate git branches simultaneously; merge or compare results. Cursor and Codex are single-branch. | High | HIGH | Git worktree support + per-agent UI panel needed |
| **Role-based agent teams** | Orchestrator assigns Planner/Coder/Reviewer/Tester roles. Users can define team compositions. | High | HIGH | Requires in-process coordination layer |
| **Background agents with notifications** | Fire-and-forget long-running tasks; get notified on completion or error. Codex has a partial version but it's opaque. | Med | MEDIUM | Backend child-process model supports this; UI notification needed |
| **Open model first-class support** | Kimi K2, MiniMax M1, Qwen — not as a generic OpenAI-compat shim but with per-model schema validation and capability flags | Med | HIGH | Backend already has per-provider clients; UI model selector |
| **Per-agent model selection** | Each agent in a team can use a different model (orchestrator=Sonnet, workers=Haiku/Kimi). Cost-optimal by design. | Med | HIGH | Backend supports this; UI needs to surface it |
| **Agent cost budgets** | Set a max-cost per agent or per orchestration run. Cursor has no cost awareness; Codex has limited controls. | Med | HIGH | Usage tracking exists; budget enforcement logic needed |
| **Shared context window collaboration** | Multiple agents reading/writing to a shared context object (not just parallel monologues). | High | MEDIUM | Novel UX — no mainstream competitor has this |
| **Swarm strategy configuration** | Define orchestration strategies: sequential, parallel, fan-out/fan-in, tournament (best-of-N). | High | MEDIUM | No direct competitor; AutoGen/LangGraph have this in code form |
| **SDD (Spec-Driven Development) mode** | Spec → implementation state machine baked into the agent loop. No competitor has opinionated spec-first flow. | High | HIGH | Backend SDD state machine exists |
| **MCP tool discovery UI** | Visual browser for available MCP tools, their inputs/outputs, and usage in current session | Med | MEDIUM | MCP client exists; UI layer needed |
| **Session compaction visibility** | Show when context was compacted, what was summarized, let user review. Codex does this invisibly. | Low | MEDIUM | Backend auto-compaction exists; surfacing it adds trust |

---

## Warp-Specific Features Worth Adopting

Warp terminal has established UX patterns that are worth referencing. **Confidence: MEDIUM** — based on training data, verify current Warp feature set.

| Warp Feature | xolotl Equivalent | Complexity | Notes |
|--------------|-------------------|------------|-------|
| AI blocks (command output as block units) | Tool output blocks — collapsible units per tool call | Med | Natural fit for tool-call display |
| Command input with AI completion | Chat input with context-aware slash commands | Low | Simpler — chat not command line |
| Agent mode (multi-step task execution) | Single-agent mode already covered by backend | Med | xolotl's multi-agent layer goes beyond this |
| Session sharing / collaboration | Out of scope for v1 — personal tool | — | Explicitly out of scope |
| Notebook-style "Warp Drive" | Not applicable — chat-first not notebook-first | — | Anti-feature for this product |

---

## Cursor Features Worth Adopting

Cursor set expectations for AI IDEs. **Confidence: HIGH** for core features (well-documented through cutoff).

| Cursor Feature | Status for xolotl | Complexity | Notes |
|----------------|-------------------|------------|-------|
| `@codebase` / `@file` context mentions | Useful UX pattern for injecting file context | Med | Chat input parsing needed |
| Inline diff accept/reject | Should be in chat tool-output view, not inline in editor (chat-first) | Med | xolotl is not an IDE — show diffs in chat |
| Agent mode (multi-step file editing) | Covered by existing agentic loop | — | Backend already does this |
| `.cursorrules` / rules files | xolotl uses `CLAUDE.md` discovery — equivalent | Low | Backend already has this |
| Composer / multi-file context | Session context management — partially handled by session system | Med | UI to show what's in context |
| Tab autocomplete | Out of scope — xolotl is not an IDE | — | Anti-feature |
| Indexing codebase embeddings | Out of scope for v1 — adds significant infra complexity | — | Defer to later milestone |

---

## OpenAI Codex App Features Worth Noting

Codex app is the closest reference point for chat-first coding agents. **Confidence: MEDIUM** — app launched ~early 2025, some features may have evolved.

| Codex Feature | xolotl Status | Notes |
|---------------|---------------|-------|
| Chat thread with streaming responses | Table stakes — covered | |
| Tool call expansion (show bash output, file reads) | Table stakes — must build | |
| Background task queue | Differentiator — xolotl adds live monitoring dashboard | |
| Multiple conversations | Should support; UI tab or sidebar per session | Med complexity |
| Sandboxed execution | xolotl uses permission system instead — different model | |
| GitHub integration | Out of scope v1; git worktrees cover local branching | |
| Model locked to GPT-4o | xolotl differentiates here — any model | |

---

## Jan / LM Studio / Msty — Open Model UX Patterns

These tools define what users expect from open model management. **Confidence: MEDIUM** for feature set at cutoff.

| Pattern | Why It Matters | xolotl Relevance |
|---------|---------------|-----------------|
| Model library with one-click download | Users don't want to manually pull Ollama models | Out of scope v1 — remote APIs, not local weights |
| Per-conversation model selection | Users pick model at start of each chat | Essential — model selector per agent |
| Model capability flags (context window, tool support) | Prevents errors from using a model that can't do tool calls | Important — Kimi K2 / MiniMax M1 need schema flags |
| Provider config (base URL, API key per provider) | Clean provider management | Backend supports this; UI settings panel needed |
| Response stats (tokens/sec, latency) | Power users care; builds trust in open models | Nice-to-have; cost display is higher priority |
| Chat export | Save conversation as markdown/JSON | Low complexity; backend session save covers this |

---

## Anti-Features

Features to explicitly NOT build for v1. Building these would bloat scope, undermine the chat-first positioning, or solve problems xolotl doesn't have.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Inline code editor / IDE pane | Agents do the editing — adding an editor blurs what xolotl is | Show diffs in chat; use VS Code for editing |
| Tab autocomplete | Requires deep LSP integration; out of scope; Cursor owns this | Not a differentiator — agents write code on request |
| Codebase vector search / embeddings | Significant infrastructure; slow to build right; v1 doesn't need it | Use `grep`/`glob` tools the agent already has |
| Built-in terminal emulator | Warp owns this; adds complexity; not the core UX | Agents run bash via the bash tool; show output in chat |
| Collaborative / multi-user sessions | Personal use tool; adds auth, sync, and conflict complexity | Defer indefinitely (out of scope per PROJECT.md) |
| Plugin / extension marketplace | Premature at v1; MCP already covers extensibility | Use MCP for tool extension |
| GitHub PR / issues UI | Agents can use gh CLI via bash tool; no need for native UI | Let bash tool handle git operations |
| Voice input | Not a coding tool priority | — |
| Mobile app | Platform complexity; no value for coding workflows | Windows/Mac/Linux desktop only |
| Cloud sync of sessions | Adds backend infrastructure; personal tool | Local JSON sessions are sufficient |
| AI-generated UI themes / onboarding wizards | Scope creep; adds no coding value | Ship a clean default theme |

---

## Feature Dependencies

```
Streaming responses
  → Chat thread UI (renders streamed tokens)
  → Tool call blocks (nested inside chat thread)
    → Inline diff display (renders file diffs inside tool blocks)

Session persistence (backend)
  → Session resumption UI (load prior session)
  → Multiple conversations UI (list of sessions)

Permission system (backend)
  → Permission prompt UI (modal/inline in chat)

Sub-agent spawner (backend)
  → Agent orchestration dashboard (monitors spawned agents)
    → Per-agent model selection UI
    → Per-agent cost display
    → Agent status indicators (idle/running/done/error)
    → Parallel worktree visualization
      → Role-based agent teams UI
        → Swarm strategy configuration UI

Model switching (backend)
  → Model selector UI (per-session)
    → Per-agent model selection UI (per-agent in dashboard)
    → Provider config UI (settings panel)

Usage tracking (backend)
  → Cost/token display (per-turn and session total)
    → Agent cost budgets (per-agent limit enforcement)

MCP client (backend)
  → MCP tool discovery UI (optional, nice-to-have)
```

---

## MVP Recommendation

Prioritize these for the first usable Tauri release:

**Must have (v1 launch):**
1. Chat thread with streaming + markdown rendering + code blocks with copy
2. Tool call / action blocks (collapsible, show bash output, file reads, diffs)
3. Inline diff display inside tool blocks
4. Session persistence + resumption (load past sessions from sidebar)
5. Permission prompt UI (wired to existing backend permissions system)
6. Model selector (per session, covers all configured providers)
7. Cost / token display per turn and session total
8. Cancel / stop generation button
9. Slash command palette (`/clear`, `/model`, `/save`, `/load`, `/help`)

**Agent dashboard (v1 differentiator — after chat baseline):**
10. Agent status panel (list spawned agents, status, task, cost)
11. Background agent launch + completion notification
12. Per-agent model selection in spawn dialog

**Defer (post-v1):**
- Parallel worktree visualization (complex; needs git worktree UI)
- Role-based team composition UI (needs in-process coordination layer first)
- Swarm strategy configuration (needs team coordination to work)
- MCP tool discovery browser
- Session compaction visibility
- Agent cost budgets

---

## User Complaints in Competitors (Patterns to Avoid)

**Confidence: MEDIUM** — sourced from training data on community discussions through August 2025.

| Complaint (Cursor/Codex/Warp) | Implication for xolotl |
|-------------------------------|------------------------|
| "Agent silently fails with no indication of what went wrong" | Tool errors must be visible and surfaced clearly in chat |
| "Can't see what the agent is doing while it runs" | Live agent activity feed is a must, not optional |
| "Context gets compacted and I lose track of what the agent knows" | Surface compaction events; let user review summary |
| "I can't easily switch models mid-task" | Model selector must be accessible from the chat input area |
| "Background tasks complete but I get no notification" | Completion notifications are required for background agents |
| "Costs spiral unexpectedly in agent mode" | Cost display per turn + per agent + session total |
| "The diff view is hard to read / approve" | Invest in clean diff rendering inside chat |
| "Cursor's agent keeps asking for permission to do obvious things" | Permission system should have 'allow for session' and 'allow always' modes |
| "Open models feel like second-class citizens" | Schema validation + capability flags per model — not just a URL swap |

---

## Sources

- Project context: `.planning/PROJECT.md` (current)
- Warp feature knowledge: training data through August 2025 — verify at https://docs.warp.dev
- Cursor feature knowledge: training data through August 2025 — verify at https://cursor.com/features
- OpenAI Codex app: training data through August 2025 — verify at https://openai.com/codex
- Jan/LM Studio/Msty: training data through August 2025
- AutoGen/CrewAI/LangGraph multi-agent patterns: training data through August 2025
- Community pain points: aggregated from GitHub issues, Reddit, HN threads known through training cutoff

**IMPORTANT:** WebSearch, WebFetch, and Bash were all unavailable during this research session. All findings are from training knowledge. Before building, verify:
1. Current Warp agent mode capabilities (may have expanded significantly)
2. Current Codex app features (launched close to training cutoff — details may be incomplete)
3. Any new entrants in the AI coding assistant space since August 2025
