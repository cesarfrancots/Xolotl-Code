# Goal Eval

Goal Eval is the distinctive eval mode. Instead of judging only the final answer, it grades the **reasoning _process_** a model uses to reach a goal — with an optional live supervisor that flags issues as the model thinks.

## Running a Goal Eval

1. Open the **Eval** tab in the desktop app and switch to **Goal Eval**.
2. Type a goal — e.g. *"Refactor `src/auth/middleware.ts` to use `jose` instead of `jsonwebtoken`, preserving the public API."*
3. Pick models to race.
4. (Optional) Toggle **Live reasoning supervisor** to flag issues as the model thinks. It runs a small judge model on each ~1200-char window of reasoning — expect roughly 2× cost.
5. Hit **Run Goal Eval**. Each model streams its chain-of-thought into a per-card reasoning trace with inline flag highlights.
6. After the run, click **Grade Goal** for the scorecard.

## The 5-axis scorecard

| Axis | What it measures |
| --- | --- |
| **Goal Decomposition** | Does the model break the goal into the right sub-tasks? |
| **Assumption Quality** | Are assumptions explicit and reasonable? |
| **Self-Correction** | Does it catch and fix its own mistakes mid-trace? |
| **Plan ↔ Action** | Do the actions match the stated plan? |
| **Goal Achievement** | Was the goal actually reached? |

Each axis scores **1–5** with a **verbatim evidence quote** from the trace.

## Supervisor flags

When the live supervisor is on, issues are categorised and rendered as colour-coded highlights anchored to the original reasoning text:

`bad_assumption` · `goal_drift` · `premature_commit` · `no_verification` · `contradiction` · `good_decomposition` · `good_self_correction`

## Notes

- The supervisor is **opt-in**.
- The post-hoc grader works on **any** completed eval — single prompt, suite, or goal — that has a reasoning trace.
- Runs persist to `~/.xolotl-code/evals/<id>.json` and reload from the History sidebar.

See also: [Eval lab](eval-lab.md) for race / judge / blind-human-scoring modes.
