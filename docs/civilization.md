# Axolotl Civilization

> **One artifact, two jobs.** It's a cute, watchable colony-sim — _and_ a **deterministic, seeded arena** where LLMs play whole civilizations against each other on a shared scoreboard. Every "game" feature is also an agent-eval feature: the same world renders to a canvas for you and to **text** for an agent.

![Axolotl morphs](../assets/game/axolotls.png)

## What the engine does (v2.0, shipped)

- **🧬 Genetics** — expanded visible Mendelian inheritance across **12 morphs**, with environmental selection producing measurable evolution over generations.
- **🌦️ Living world** — seasons drift temperature, disasters physically reshape terrain, and resources regrow on renewable-only rules.
- **⚔️ Politics** — combat, raids, territory ownership, diplomacy & trades, and wild predators — all **deterministic and seeded** (reproducible runs).
- **🏆 Multi-model worlds** — 1–3 AI-model civs, each with its own colour and controller tag, on a **live leaderboard** scored on survival, ethics, and intelligence.

The world is rendered with **Phaser 4**; all art is generated through the in-repo Gemini image pipeline (`output/civ-gen/gemini/`).

## The arena bridge — why it doubles as an eval

The world exposes:

- `render_game_to_text()` — the full game state as text, so an agent can _observe_ it.
- `civPilotControls` — drive commands, so an agent can _act_ on it.

A coding agent can therefore **observe and play the same game a human watches** — a self-contained, reproducible benchmark for planning and decision-making under uncertainty. Every new human verb is kept at **parity**: it's also an agent action and appears in the text bridge.

## Roadmap — Milestone v2.1 "Living World & Economy"

Turning the simulation into a **fully playable game** where every human-play feature also deepens agentic playability:

| # | Phase | Status |
| :-: | --- | --- |
| 1 | **Human Takeover (Possession)** — possess a whole civ and play it directly; the LLM never fires for a possessed civ | 🛠️ in progress |
| 2 | Economy & Currency — ≥5 currencies (Shells · Pearls · Tidewardens' Favor · Spawn-tokens · Ancient Amberglass), fixed-price selling | ⏳ planned |
| 3 | Shop / Store + UI — a game-native catalog you buy buffs / buildings / items from | ⏳ planned |
| 4 | Items, Crafting & NPCs — tools, a recipe cascade, and trader / quest-giver / fauna-handler NPCs | ⏳ planned |
| 5 | Infinite / Chunked Procedural World — deterministic fBm terrain, prospecting, terraform | ⏳ planned |
| 6 | Assets & Game-native UI — Gemini art + a HUD restyle | ⏳ planned |

> Detailed phase plans live in `.planning/` (internal). Zero new runtime dependencies across the milestone.
