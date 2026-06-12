<!-- ░░░░░░░░░░░░░░░░░░░░░░░░░░░  XOLOTL CODE  ░░░░░░░░░░░░░░░░░░░░░░░░░░░ -->
<div align="center">

<img src="assets/game/axo-gold.png" width="68" alt="">
<img src="assets/game/axo-firefly.png" width="68" alt="">
<img src="assets/game/axo-blue.png" width="68" alt="">
<img src="assets/game/axo-gfp.png" width="68" alt="">
<img src="assets/game/axo-mystic.png" width="68" alt="">
<img src="assets/game/axo-piebald.png" width="68" alt="">
<img src="assets/game/axo-copper.png" width="68" alt="">
<img src="assets/game/axo-wild.png" width="68" alt="">

# 🪸 Xolotl Code

**A desktop AI coding-agent platform for evaluating, comparing, and _racing_ LLMs on real engineering work —**
**built so Claude and the best open models are first-class citizens, side by side.**

<br/>

![Rust](https://img.shields.io/badge/Rust-1.95.0-CE412B?logo=rust&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri-2.x-FFC131?logo=tauri&logoColor=black)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Phaser](https://img.shields.io/badge/Phaser-4-8E44AD?logo=phaser&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-3DA639)
![Platforms](https://img.shields.io/badge/platforms-Windows%20·%20macOS%20·%20Linux-7A8B99)

<a href="#overview">Overview</a> ·
<a href="#quick-start">Quick start</a> ·
<a href="#platform">Platform</a> ·
<a href="#the-game">The Game 🦎</a> ·
<a href="#providers">Providers</a> ·
<a href="#cli">CLI</a> ·
<a href="#development">Development</a> ·
<a href="docs/index.md">Docs 📚</a>

</div>

---

<a id="overview"></a>

## ✨ Overview

Xolotl Code ships as **two surfaces that share one engine and one config file**:

| Surface | What it is |
| --- | --- |
| 🖥️ **Tauri desktop app** | The primary surface — a chat pane, an agent/team worktree orchestrator, an eval lab (incl. **Goal Eval**), and **Pondfall**, the axolotl base-builder. |
| ⌨️ **`xolotl` CLI** | The same engine without the UI — multi-provider routing, slash commands, sessions, planning, tools, and memory. |

Both read `~/.xolotl-code/config.json`, so a key you set in either tool works in both. The core bet: a **chat-first UI with an agent-swarm layer underneath**, where an orchestrator coordinates cheaper specialized agents across parallel git worktrees — **without locking you into OpenAI or Anthropic.**

```mermaid
flowchart TD
    UI["🖥️ Desktop App<br/>Tauri 2 · React 19 · Phaser 4"]
    CLI["⌨️ xolotl CLI<br/>Rust REPL"]
    ENG["⚙️ Shared Engine<br/>(runtime crate)<br/>conversation loop · tools · memory · agent supervisor"]
    ROUTER{{"Provider Router"}}
    CFG[("~/.xolotl-code/<br/>config.json")]

    UI -- "Tauri IPC" --> ENG
    CLI --> ENG
    ENG --> ROUTER
    ROUTER --> AN["Anthropic"] & KI["Kimi K2"] & MM["MiniMax"] & DS["DeepSeek"]
    ROUTER --> GL["GLM"] & QW["Qwen"] & BR["AWS Bedrock"] & OAI["OpenAI-compat"]
    UI -. reads .-> CFG
    CLI -. reads .-> CFG
```

---

<a id="quick-start"></a>

## 🚀 Quick start

### Desktop app (recommended)

> **Prerequisites:** Node.js 20+, the Rust toolchain, and the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS (WebView2 on Windows, WebKitGTK on Linux, none on macOS).

```bash
cd tauri-app
npm install
npm run tauri dev      # dev with hot-reload (Vite serves on :1420)
npm run tauri build    # production binary in src-tauri/target/release
```

On first launch, click the **gear icon** in the left sidebar to set API keys — or export the matching env var (`ANTHROPIC_API_KEY`, `KIMI_CODING_API_KEY`, `MINIMAX_API_KEY`, `DEEPSEEK_API_KEY`, …). Keys are shared with the CLI via `~/.xolotl-code/config.json`.

### CLI

```bash
cd rust
cargo install --path crates/rusty-claude-cli --force
xolotl --version
xolotl                 # interactive REPL
```

---

<a id="platform"></a>

## 🧠 The platform

### 💬 Chat
A conversational pane with streaming responses and a **separate chain-of-thought** track — reasoning models (Kimi, DeepSeek) stream `reasoning_content` first, then the answer, and both are surfaced. Tool-use display, inline diffs, and a command palette included.

### 🤖 Agents & teams
The right sidebar spawns sub-agents that work in **isolated git worktrees**, so their changes can be reviewed and merged on your terms.

- **Spawn agent** — a single agent with a task, model, and optional budget cap.
- **Launch team** — a multi-agent swarm with named roles & tasks; a **merge checkpoint** view opens when all members finish.
- Per-agent state is persisted; the panel survives app restarts. Orchestrator runs a smart model (Opus/Sonnet); workers run cheap ones (Haiku/Kimi).

### 🎯 Goal Eval — the distinctive eval mode
Instead of judging only the final answer, Goal Eval grades the **reasoning _process_** a model uses to reach a goal, with an optional **live supervisor** that flags issues as the model thinks.

| Axis | What it measures |
| --- | --- |
| **Goal Decomposition** | Does the model break the goal into the right sub-tasks? |
| **Assumption Quality** | Are assumptions explicit and reasonable? |
| **Self-Correction** | Does it catch and fix its own mistakes mid-trace? |
| **Plan ↔ Action** | Do the actions match the stated plan? |
| **Goal Achievement** | Was the goal actually reached? |

Each axis scores 1–5 with a **verbatim evidence quote** from the trace. Supervisor flags (`bad_assumption`, `goal_drift`, `premature_commit`, `no_verification`, `contradiction`, `good_decomposition`, `good_self_correction`) render as colour-coded highlights anchored to the original reasoning text.

### 🏁 Standard eval — race · judge · human-in-the-loop
- **Single Prompt** — one prompt, N models in parallel, a live race-track with tok/s, cost, and tokens.
- **Eval Suite** — prompt sets graded by per-prompt rules (`ai_slop`, `brevity`, `json_mode`, `code`, `refusal`).
- **LLM-as-judge** — anonymises responses as A/B/C and scores on an 8-axis rubric.
- **Blind human scoring** — hide model names, rate without bias; sliders write back to the saved eval.
- **Leaderboard** — composite of quality, cost, and speed with adjustable weights.

All runs persist to `~/.xolotl-code/evals/<id>.json` and reload from the History sidebar.

### 🧩 Skills & MCP
- **Skills** — Claude-Code-compatible markdown skills from `~/.xolotl-code/skills/<name>/SKILL.md`; toggle them to advertise to the model each turn.
- **MCP servers** — discovered from `~/.xolotl-code/mcp.json` (user) and `.mcp.json` (project); the dialog reachability-tests each server with latency reporting.

---

<a id="the-game"></a>

## 🦎 Pondfall — the axolotl base-builder

> **Clash-style, pond-sized.** Pondfall is a Clash of Clans-inspired base-builder living in the **Pond** tab: grow your kelp economy, fortify the village, hatch an axolotl army, and raid procedurally generated enemy ponds for loot, stars and trophies.

<table>
  <tr>
    <td align="center" width="50%">
      <img src="assets/game/axolotls.png" width="380" alt="Axolotl morphs"><br/>
      <sub><b>Axolotl troops</b> — morphs become units: Wildling, Finling, Pilfer, Boomtail, Pebbleback, Riptide, Sparkfin, Glowmender, Tidelord</sub>
    </td>
    <td align="center" width="50%">
      <img src="assets/game/buildings.png" width="380" alt="Buildings, resources & life stages"><br/>
      <sub><b>Build & defend</b> — Pondheart, farms & mines, vats & vaults, hatchery, geysers, spires, elder dens, canal walls</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="assets/game/terrain.png" width="380" alt="Terrain biomes"><br/>
      <sub><b>Pixel pond world</b> — a mossy shelf ringed by sand and deep water, rendered tile by tile</sub>
    </td>
    <td align="center" width="50%">
      <img src="assets/game/accessories.png" width="380" alt="Cosmetic accessories"><br/>
      <sub><b>Personality</b> — a wardrobe of diegetic accessories for your axolotls</sub>
    </td>
  </tr>
</table>

<sub>🎨 All art is generated through the in-repo Gemini image pipeline (`output/civ-gen/gemini/`) and rendered with **Phaser 4**.</sub>

### The loop

- 🌿 **Economy** — Kelp Farms and Shard Mines produce in real time (even while the app is closed, up to a buffer); harvest into Kelp Vats and Shard Vaults that gate how much you can hoard.
- 🔨 **Construction** — every building costs the opposite resource and takes real time to build; each Builder Workshop houses a named **tadpole worker** (level 1–5 — train them with shards to build faster) that swims to its job site and splashes while it works. Extra workshops are bought with **pearls** (250 → 500), exactly like CoC builders cost gems. The **Pondheart** level gates what you can place and how far you can upgrade.
- 👑 **The Supreme Axolotl** — build the **Sovereign Throne** (Pondheart 3) to summon your hero: it lounges crowned on its throne, joins every raid for free, rages and self-heals when wounded (**Sovereign Wrath**), levels up to 2× your Pondheart level, and regenerates after being knocked out — the Barbarian King, axolotl-style.
- 💣 **Defense depth** — the **Mudspitter** mortar shells raiders from afar but is blind up close, and hidden **Tide Traps** stay invisible to attackers (yours and the enemy's) until someone swims over one.
- 🥚 **Army** — the Hatchery trains seven axolotl morph troops with CoC-style housing costs into Mossy Camps; higher hatchery levels unlock stronger morphs, and the **Glow Lab** researches troop levels that scale their combat stats.
- 🦪 **Pearls** — a premium currency earned from raid stars and clearing obstacles (driftwood, boulders, glowblooms drift into your pond over time); spend pearls to finish any build or research timer instantly.
- ✨ **Spells** — the Spell Spring brews **Heal Rain** (mends troops under its radius) and **Tide Surge** (damage + speed boost); cast them anywhere mid-raid from the deploy tray.
- 🖥️ **Fullscreen** — one click (or Esc to exit) hides the whole workbench chrome so the pond takes over the window, CoC-style HUD and all.
- ⚔️ **Raids** — attack procedurally generated enemy ponds scaled to your trophies: scout the available loot, pay glowshards to skip to another pond, then deploy around the walls. Troops pick targets by preference (Pebblebacks hunt defenses, Pilfers beeline for loot), defenses shoot back, and stars are earned at 50%, Pondheart down, and 100% destruction.
- 🛡️ **Defense** — Bubble Geysers, Crystal Spires and Elder Dens guard your loot while you're away; lose a raid and you get a 12-hour shield, win on defense and you take trophies instead.

### Where it lives in the code

The whole game is a self-contained TypeScript module — a pure, unit-tested simulation with a thin Phaser/React shell on top:

| Layer | Path |
| --- | --- |
| Balance & data model | `tauri-app/src/lib/pond/config.ts`, `types.ts` |
| Village economy (pure functions) | `tauri-app/src/lib/pond/village.ts` |
| Battle simulation (fixed-step, headless-testable) | `tauri-app/src/lib/pond/battle.ts` |
| Enemy base generation + away-raids (seeded RNG) | `tauri-app/src/lib/pond/enemy.ts` |
| Phaser 4 renderer | `tauri-app/src/components/pond/PondCanvas.tsx` |
| HUD / shop / army / battle UI | `tauri-app/src/components/pond/PondView.tsx` |

Saves persist to `localStorage`, so the pond works identically in the desktop app and the browser dev preview.

---

<a id="providers"></a>

## 🔌 Providers & models

<details>
<summary><b>Provider API keys</b> — set as env vars or via the CLI <code>/connect</code></summary>

<br/>

| Variable | Provider |
| --- | --- |
| `KIMI_CODING_API_KEY` | Kimi K2.6 Coding |
| `KIMI_API_KEY` | Moonshot / Kimi |
| `MINIMAX_API_KEY` | MiniMax |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `GLM_API_KEY` | Zhipu GLM |
| `DASHSCOPE_API_KEY` | Alibaba Qwen |
| `ANTHROPIC_API_KEY` | Anthropic direct |
| `BEDROCK_API_KEY` | AWS Bedrock |
| `OPENAI_API_KEY` | OpenAI or compatible fallback |

Base URLs are overridable via the `*_BASE_URL` variants.

</details>

<details>
<summary><b>Model aliases</b> — pick a route by short name</summary>

<br/>

| Alias | Provider | Notes |
| --- | --- | --- |
| `kimi-coding` | Kimi Coding | Coding-tuned, 256K context, exposes `reasoning_content`, prompt cache |
| `kimi2.6` | Moonshot / Kimi | General Kimi route |
| `minimax2.7` | MiniMax | 1M context for broad reads |
| `deepseek`, `deepseek-v4-pro` | DeepSeek | V4 Pro, 1M context, thinking mode |
| `deepseek-flash`, `deepseek-v4-flash` | DeepSeek | V4 Flash, 1M context, lower cost |
| `glm5.1` | Zhipu GLM | 128K context |
| `qwen3.6` | Alibaba Qwen | Qwen-compatible route |
| `claude-sonnet-4-6`, `sonnet` | Anthropic / Bedrock | Claude Sonnet |
| `claude-opus-4-7`, `opus` | Anthropic / Bedrock | Claude Opus |
| `claude-haiku-4-5-20251001`, `haiku` | Anthropic / Bedrock | Fast Haiku — cheap default judge |
| `bedrock-nova-pro`, `bedrock-nova-lite`, `bedrock-llama-3.3-70b` | AWS Bedrock | Non-Claude Bedrock options |

**Dual-model planner + executor** in the CLI:

```text
/model opus+sonnet
/model opus+kimi-coding
```

</details>

---

<a id="cli"></a>

## ⌨️ CLI & REPL

```bash
xolotl                                # interactive REPL
xolotl -y                             # auto-approve tool calls
xolotl prompt "summarize the runtime crate"
xolotl setup                          # configure API keys
```

Inside the REPL, `/connect <provider>` saves a key. Supported: `kimi-coding`, `kimi`, `minimax`, `deepseek`, `glm`, `qwen`, `anthropic`, `bedrock`, `openai`.

<details>
<summary><b>REPL commands & keybindings</b></summary>

<br/>

```text
/help                  Show commands
/status                Session, model, usage, memory state
/cost                  Token + cache cost breakdown
/model <alias>         Switch models
/connect <provider>    Save provider API key
/plan <description>    Structured implementation plan
/ultra-plan <desc>     Deeper plan with risk + dependency tracking
/compact               Compact session context
/save                  Save the current session
/load <session>        Load a saved session
/rollback <n>          Roll back recent assistant turns
/diff                  Files touched during the session
/memory                Show memory status
/mcp                   Show connected MCP tools
/accept-all            Toggle tool-call auto-approval
/doctor                Check local configuration
/exit                  Quit
```

| Key | Action |
| --- | --- |
| ↑ / ↓ | Browse input history |
| Shift+Enter | Insert newline |
| Ctrl+T | Toggle thinking display |
| Ctrl+E | Cycle effort level |
| Ctrl+M | Quick model switch |
| Ctrl+S | Save session |
| Ctrl+R | Retry last prompt |
| Ctrl+C | Cancel input |

</details>

---

<a id="development"></a>

## 🛠️ Development

```bash
# Rust workspace (engine + CLI)
cd rust
cargo build --workspace
cargo test --workspace --exclude compat-harness
cargo fmt --all -- --check
cargo clippy --workspace --all-features --exclude compat-harness -- -D warnings

# Tauri app
cd tauri-app
npm install
npm run tauri dev
npx tsc --noEmit                     # type-check without building
npm test                             # vitest
```

CI runs the `rust/` workspace on **Linux + Windows + macOS** (Rust **1.95.0**): fmt, clippy with `-D warnings`, build, and tests excluding the compat harness. Clippy runs `pedantic` and `unsafe_code = "forbid"`. The Tauri TypeScript layer is checked locally; `bindings.ts` regenerates from `#[specta::specta]` Rust commands on each debug build.

<details>
<summary><b>Project layout</b></summary>

<br/>

```text
.
├── rust/                            # Cargo workspace (engine + CLI)
│   └── crates/
│       ├── api/                     # Anthropic API types, client, SSE
│       ├── bench/                   # Benchmark harness
│       ├── commands/                # Slash-command handling
│       ├── compat-harness/          # External compatibility checks
│       ├── lsp/                     # Language-server integration
│       ├── mcp-server/              # MCP server implementation
│       ├── pdfmd/                   # PDF → markdown
│       ├── runtime/                 # Conversation loop, prompts, memory,
│       │                            #   tools, agent supervisor, events
│       ├── rusty-claude-cli/        # `xolotl` binary
│       └── tools/                   # Built-in tool specs + dispatch
├── tauri-app/                       # Desktop app (React 19 + Tauri v2)
│   ├── src-tauri/                   # Rust side: commands, MCP, skills,
│   │                                #   eval runner, goal-grade judge
│   └── src/
│       ├── components/
│       │   ├── chat/                # Chat pane, message input, palette
│       │   ├── agent/               # Agent roster, spawn, team launcher
│       │   ├── eval/                # Eval lab + Goal Eval mode
│       │   ├── pond/                # Pondfall base-builder (Phaser canvas)
│       │   ├── settings/            # Providers / Skills / MCP tabs
│       │   └── sidebar/             # Session sidebar
│       ├── lib/pond/                # Pondfall pure game engine (tested)
│       └── stores/                  # Zustand stores
├── output/civ-gen/gemini/           # Game art pipeline (Gemini, build-time)
├── assets/game/                     # Showcase art (this README)
└── .planning/                       # Phase plans, UAT, state, decisions
```

</details>

### Configuration & persistence

Everything lives under `~/.xolotl-code/`:

```text
~/.xolotl-code/
├── config.json                      # provider keys + defaults
├── sessions/<id>.json               # chat sessions
├── evals/<id>.json                  # eval runs + reasoning + grades
├── skills/<name>/SKILL.md           # user-defined skills
└── mcp.json                         # user-scoped MCP servers
```

<sub>Legacy `~/.claw-code/config.json` is migrated automatically on first run.</sub>

---

## 🎯 Design goals

- Make **multi-model** coding workflows first-class — Claude _and_ the open coding models (Kimi, MiniMax, GLM, Qwen) on equal footing.
- Treat **reasoning as a first-class artifact** — surface it, persist it, judge it.
- Keep agentic tool loops **reliable, testable, and recoverable** in worktrees.
- Cache-friendly prompts and accurate token/cost accounting across providers.
- Don't waste context on large repositories.

---

## 📜 License

[MIT](LICENSE) — personal project; built for capability over safety margins.

<div align="center"><sub>Made with 🪸 and a colony of axolotls.</sub></div>
