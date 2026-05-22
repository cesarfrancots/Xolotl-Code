# xolotl desktop

Tauri desktop workbench for xolotl coding sessions, parallel agents, and model evaluation.

## Local development

```sh
npm install
npm run dev
```

## Verification

```sh
npm test
npm run build
```

## Product surfaces

- Chat: session-based coding conversations with model selection, skills, file attachments, and tool output rendering.
- Agents: isolated worktree agents, team launches, and merge checkpoint review.
- Eval Lab: single-prompt, suite, and goal evals with randomized blind labels for human review.

The app shares provider configuration, sessions, eval results, skills, and MCP server discovery through `~/.xolotl-code/`.
