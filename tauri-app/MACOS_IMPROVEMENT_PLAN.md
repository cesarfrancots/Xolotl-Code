# Xolotl Code macOS Improvement Plan

Last updated: 2026-06-07

This plan tracks the macOS-specific work for the `codex/mac-version` branch. The goal is not only to package the app for macOS, but to make it feel like a native Mac developer tool while preserving the cross-platform React/Tauri core.

## Current Baseline

- App bundle builds as `Xolotl Code.app`.
- DMG packaging works through `scripts/package-mac-dmg.mjs`.
- Browser storage is guarded for Tauri/WebView startup safety.
- Embedded terminal opens reliably and focuses when the dock becomes visible.
- Native macOS menu and Cmd shortcuts are wired and smoke-tested.
- File > New Chat, workbench tab shortcuts, command palette, and terminal toggle route through the native menu bridge.
- Terminal tab commands are available from a native Terminal menu.
- Terminal tabs capture the active project directory when they are created.
- Finder-style folder drops on the app window can activate projects.

## Phase 1 - Native Mac Shell

Status: done.

Deliverables:

- Native menu bar with app, File, Edit, View, Workbench, and Window menus.
- Standard Cmd shortcuts:
  - Cmd+N: new chat.
  - Cmd+O: open folder.
  - Cmd+Comma: settings.
  - Cmd+K: command palette.
  - Cmd+J: terminal dock.
  - Cmd+1, Cmd+2, Cmd+3: Chat, Eval, Civ workbench tabs.
- Keep existing Ctrl+Backtick terminal shortcut for users coming from the web app.
- Add menu bridge tests so Rust menu IDs normalize into frontend actions.
- Smoke test the built `.app` with menu accelerators and visible state changes.

Acceptance:

- Menu items appear in the macOS menu bar.
- Shortcuts work from the native menu and from direct WebView keydown handling.
- App remains usable in browser/Vite tests without the Tauri event bridge.

## Phase 2 - Mac-Style Window and Navigation UX

Status: planned.

Deliverables:

- Evaluate a macOS titlebar style:
  - Keep native traffic-light controls.
  - Use an inset or transparent titlebar if it does not break drag regions.
  - Preserve a dense developer-tool layout rather than a marketing-style shell.
- Add proper draggable header regions where the window chrome allows it.
- Refine the top workbench toolbar:
  - More native spacing.
  - Clear active tab affordance.
  - Less visual noise around borders and shadows.
- Add Mac shortcut labels consistently in menus, buttons, tooltips, and command palette rows.
- Add reduced-transparency and high-contrast checks for Mac accessibility settings where feasible.

Acceptance:

- Window chrome feels native on macOS.
- No controls overlap with traffic lights at narrow widths.
- Keyboard users can reach all primary workbench areas without pointer use.

## Phase 3 - Finder and Project Workflow Integration

Status: in progress.

Deliverables:

- Open project folders from Finder and command-line launch arguments.
- Add a Recent Projects menu that mirrors the project store.
- Add Dock menu shortcuts for New Chat, Open Folder, and recent projects if Tauri/AppKit support is practical.
- Support drag-and-drop of folders onto the app window to open a project. Done for Tauri window drops; still needs end-to-end Finder smoke coverage with a real project folder.
- Improve file browser behavior for Mac paths:
  - Home directory display.
  - Hidden file visibility toggle.
  - Symlink and package-directory handling.

Acceptance:

- Dropping a folder or opening with a path activates the project.
- Recent projects persist and are reachable without opening the sidebar.
- Finder-originated workflows do not create duplicate project entries.

## Phase 4 - Terminal and Developer Environment Polish

Status: in progress.

Deliverables:

- Improve shell detection for zsh, bash, fish, and user login shell.
- Start terminals in the active project directory by default. Done for newly created terminal tabs.
- Add Mac-specific terminal shortcuts:
  - Cmd+T: new terminal tab. Done via native Terminal menu and dock fallback.
  - Cmd+W: close active terminal tab. Done via native Terminal menu and dock fallback.
  - Cmd+Shift+Left/Right: switch terminal tabs. Done via native Terminal menu and dock fallback.
- Add terminal profile metadata:
  - Current shell.
  - Current working directory.
  - Environment source.
- Investigate native pseudo-terminal behavior for long-running agent tasks and process cleanup on app quit.

Acceptance:

- Terminal tabs consistently start in the selected project.
- Terminal shortcuts do not conflict with global app/window shortcuts.
- Quitting the app cleans up owned processes without killing unrelated shells.

## Phase 5 - Secure Mac Storage and Permissions

Status: planned.

Deliverables:

- Move API keys from local app storage into macOS Keychain or a Tauri-backed secure storage layer.
- Add migration from existing stored keys with a clear one-time confirmation.
- Add settings UI for key storage status:
  - Stored in Keychain.
  - Missing.
  - Needs migration.
- Review filesystem permissions and user prompts for project access.
- Add better error recovery when macOS denies file or notification permissions.

Acceptance:

- API keys are not stored in plain browser local storage.
- Failed Keychain reads produce actionable settings UI, not silent chat failures.
- Existing users can migrate without reconfiguring every model provider manually.

## Phase 6 - Mac Productivity Features

Status: planned.

Deliverables:

- Optional global hotkey to bring Xolotl Code to front.
- Optional menu bar helper or status item:
  - Running agents count.
  - Active project.
  - Quick open command palette.
- Notification actions for long-running tasks:
  - Agent finished.
  - Eval finished.
  - Permission required.
- Clipboard-aware command palette actions:
  - Explain selected code.
  - Start chat with clipboard snippet.
- Evaluate macOS Services or Shortcuts integration after core workflows are stable.

Acceptance:

- Every OS-level feature is opt-in when it can interrupt the user.
- Global shortcuts are configurable and can be disabled.
- Notifications route back to the relevant app view.

## Phase 7 - Distribution, Signing, and Update Path

Status: planned.

Deliverables:

- Universal Apple Silicon + Intel build path.
- Developer ID code signing.
- Notarization workflow.
- DMG layout polish:
  - App icon.
  - Applications shortcut.
  - Clear volume name.
- Versioned release checklist.
- Investigate Tauri updater support after signing is stable.

Acceptance:

- A clean Mac can install and launch the app without Gatekeeper workarounds.
- DMG and `.app` artifacts are reproducible from documented commands.
- Release checklist states required environment variables and certificates.

## Phase 8 - QA Matrix

Status: planned.

Test targets:

- Apple Silicon current macOS.
- Intel macOS or universal build validation if hardware/runner is available.
- Fresh user profile with no app data.
- Existing user profile with sessions, projects, and keys.
- Offline mode.
- App quit/reopen while terminal and agents are running.
- File paths with spaces, Unicode, symlinks, and package directories.

Automation targets:

- Unit tests for menu/action bridges.
- Tauri Rust tests for menu ID mapping where practical.
- Smoke script for `.app` launch, terminal focus, menu shortcuts, and project opening.
- Build checks for app bundle, DMG, and universal target.
