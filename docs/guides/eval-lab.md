# Eval lab

Beside [Goal Eval](goal-eval.md), the lab supports standard race / judge / human-in-the-loop evaluation.

## Modes

- **Single Prompt** — one prompt, N models in parallel, a live race-track with tok/s, cost, and tokens.
- **Eval Suite** — pre-defined prompt sets graded by per-prompt rules (`ai_slop`, `brevity`, `json_mode`, `code`, `refusal`).
- **LLM-as-judge** — anonymises responses as A/B/C, then asks a judge model to score them on an 8-axis rubric (accuracy, helpfulness, quality, creativity, design, aesthetics, anti-slop, brevity).
- **Blind human scoring** — hide model names so you rate without bias; sliders write back to the saved eval.
- **Leaderboard** — composite score blending quality, cost, and speed with adjustable weights.

All runs persist to `~/.xolotl-code/evals/<id>.json` and reload from the History sidebar.

## To write

- [ ] Screenshots of the race-track and leaderboard
- [ ] Defining a custom eval suite
- [ ] How the composite leaderboard weighting works
