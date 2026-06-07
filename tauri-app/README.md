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

## macOS packaging

```sh
npm run build:mac             # builds Xolotl Code.app
npm run build:mac:dmg         # builds the app and wraps it in a simple DMG
npm run build:mac:universal   # builds a universal .app when both Rust targets are installed
npm run open:mac              # opens the built .app
```

The DMG script uses `ditto` and `hdiutil` directly so CI and local builds do
not depend on Finder AppleScript window-layout automation.

## Product surfaces

- Chat: session-based coding conversations with model selection, skills, file attachments, and tool output rendering.
- Agents: isolated worktree agents, team launches, and merge checkpoint review.
- Eval Lab: single-prompt, suite, and goal evals with randomized blind labels for human review.

The app shares provider configuration, sessions, eval results, skills, and MCP server discovery through `~/.xolotl-code/`.
