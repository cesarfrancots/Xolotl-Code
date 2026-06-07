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
- Workbench toolbar uses a quieter macOS utility style with a focused segmented control and explicit active states.
- Main window uses macOS overlay titlebar chrome with hidden title text, explicit traffic-light positioning, custom drag regions, and safe spacing when the left rail is collapsed.
- Sidebar projects and file browser use compact Mac navigator rows, count badges, consistent utility icon buttons, and tighter Finder-style metadata labels.
- Shortcut hints use macOS symbols across workbench, terminal, sidebar footer, composer command button, and command palette rows.
- Command palette includes native-menu actions, active project Finder/path actions, recent project entries, and terminal actions with Mac shortcut chips.
- Command palette includes a File Browser section for current-folder reveal/copy/refresh/navigation and visible file/folder row actions.
- Mac command routing uses a shared command model for global keydown handling, native-menu action normalization, and command-palette action rows.
- File > Open Recent is populated from the persisted project store and refreshes after project add/remove/activation.
- Directory paths passed at app launch are imported into the project store and activated on startup.
- macOS open/reopen events are handled: file URLs from Finder/Open With are normalized into project-open requests, and Dock/app reopen focuses the main window.
- Saved project rows and file browser entries can reveal their target in Finder.
- File browser entries can copy POSIX paths and project-relative paths.
- Terminal cwd metadata can reveal its folder in Finder and copy the POSIX cwd path.
- Packaged launch-path smoke coverage is available through `npm run smoke:mac:launch-path`.
- Terminal tab commands are available from a native Terminal menu.
- Terminal tabs capture the active project directory when they are created.
- Finder-style folder drops on the app window can activate projects.
- Sidebar project paths use Mac-style `~` home labels.
- File browser entries include hidden, alias, and package metadata.
- Provider API keys saved from the Mac app use macOS Keychain, with env-var and legacy config-file fallback.
- Settings show whether each provider key comes from Keychain, an environment variable, or the legacy config file.
- Legacy config-file provider keys can be moved into Keychain from Settings after a one-time confirmation.
- Keychain read failures surface in Settings with recovery text instead of looking like missing provider keys.
- Terminal tabs resolve zsh/bash/fish-aware shell profiles and display shell, cwd, and environment source metadata.

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

Status: in progress.

Deliverables:

- Window chrome:
  - Keep native traffic-light controls.
  - Use an inset or transparent titlebar if it does not break drag regions or automated smoke tests. Done for the first pass with Tauri overlay titlebar chrome.
  - Add explicit drag regions to non-interactive toolbar areas. Done for the workbench toolbar and left sidebar title area.
  - Reserve safe space around the traffic lights at compact widths. Done for expanded left sidebar and collapsed left rail/workbench handoff.
  - Keep the current dense developer-tool layout rather than a marketing-style shell.
- Mac visual style pass:
  - Shift the top toolbar toward a quieter macOS utility-app look.
  - Use restrained system-like contrast, thinner separators, and clearer active states.
  - Move repeated command affordances toward icon buttons with tooltips where the action is familiar.
  - Keep cards reserved for repeated items, dialogs, and framed tools; avoid nested cards.
  - Tighten sidebar project/file-browser density while preserving Finder actions. Done for the first project and file-browser row pass.
- Workbench navigation:
  - Convert center workbench switching into a tighter segmented-control pattern. Done for the main Chat/Eval/Civ toolbar.
  - Add visible focus rings and predictable Tab order for sidebar, chat, eval, civ, terminal, and agent panels.
  - Use Mac shortcut labels consistently in menus, buttons, tooltips, and command palette rows. Done for the first pass across toolbar, terminal, sidebar footer, composer, and palette.
- Accessibility:
  - Verify reduced motion and high-contrast behavior.
  - Avoid text clipping in compact sidebars, titlebar-safe areas, and terminal tabs.
  - Preserve non-pointer access to every primary workbench action.

Implementation order:

1. Restyle the app header and workbench tabs without changing layout ownership. Done for the first toolbar pass.
2. Add titlebar/drag-region support behind a small Tauri config and CSS pass. Done for the first overlay-titlebar pass.
3. Tighten sidebar list density, selected states, and project/file browser labels. Done for the first project/file-browser pass.
4. Add shortcut labels/tooltips to command-bearing controls. Done for the first shortcut symbol pass.
5. Run screenshot checks at desktop and compact widths before package smoke.

Acceptance:

- Window chrome feels native on macOS.
- No controls overlap with traffic lights at narrow widths.
- Keyboard users can reach all primary workbench areas without pointer use.
- The app remains visually dense and operational, not landing-page-like.

## Phase 2.5 - Mac Command and Keyboard UX

Status: in progress.

Deliverables:

- Command palette:
  - Show Mac symbols for shortcuts where useful: Cmd, Shift, Option, Control. Done for the first palette shortcut-chip pass.
  - Add project-aware commands for Open Recent, Reveal in Finder, New Terminal Here, and Copy Path. Done for active project and recent project rows.
  - Add file-browser commands for current folder navigation, Finder reveal, and visible row copy/path actions. Done for the current listing and non-hidden visible entries.
  - Keep action names short and scan-friendly.
- Keyboard model:
  - Preserve existing web-friendly shortcuts where they do not conflict.
  - Prefer Cmd-first equivalents for Mac users.
  - Scope terminal tab shortcuts to terminal-open contexts where needed.
- Menu parity:
  - Keep native menu IDs, frontend action names, and command palette actions in sync. Done for the first shared Mac command model pass.
  - Add tests for any new command normalization. Done for shared command actions, global keydown routing, and terminal-scoped shortcut routing.

Acceptance:

- A Mac user can operate chat, project switching, file browsing, terminal tabs, settings, and command palette from the keyboard.
- Shortcut conflicts are documented or resolved in tests.
- Browser preview remains usable without native menu APIs.

## Phase 3 - Finder and Project Workflow Integration

Status: in progress.

Deliverables:

- Open project folders from command-line launch arguments. Done for existing directory arguments passed to the app.
- Open project folders from Finder. Done for Tauri window drops and macOS `RunEvent::Opened` file URLs; still needs end-to-end Finder/Dock smoke coverage against the packaged app.
- Add a Recent Projects menu that mirrors the project store. Done for File > Open Recent with menu refresh after project changes.
- Add Dock menu shortcuts for New Chat, Open Folder, and recent projects if Tauri/AppKit support is practical. Evaluated against local Tauri 2.11 API: Dock visibility is exposed, but Dock menu construction is not; revisit only if an AppKit-specific shim is worth carrying.
- Support drag-and-drop of folders onto the app window to open a project. Done for Tauri window drops; still needs end-to-end Finder smoke coverage with a real project folder.
- Improve file browser behavior for Mac paths:
  - Home directory display. Done for sidebar/project labels.
  - Hidden file visibility toggle. Done for dotfiles and `.git`.
  - Symlink and package-directory handling. Done with Alias/Package badges.

Acceptance:

- Dropping a folder or opening with a path activates the project.
- Recent projects persist and are reachable without opening the sidebar. Done for native menu access.
- Finder-originated workflows do not create duplicate project entries. Done for drag/drop and launch-path imports through canonical project add.

Next implementation details:

- Add Reveal in Finder for the active project, saved projects, terminal cwd, and file browser entries. Done for saved projects, current browser folder, terminal cwd, and visible entries.
- Add Copy POSIX Path and Copy Relative Path actions to file browser rows. Done for visible entries; current folder and saved projects support POSIX path copy.
- Investigate Tauri reopen/open-url/document-open support for dragging a folder onto the Dock icon or launching via Finder "Open With". Done for `RunEvent::Opened` and `RunEvent::Reopen` handling; packaged end-to-end smoke still needs a reliable harness.
- Add a packaged-app smoke script that launches the `.app` with a temporary directory argument and asserts the project is activated. Done via `npm run smoke:mac:launch-path`.
- Evaluate Dock menu support only after project-open event handling is stable. Done: current Tauri API does not provide Dock menu construction.

## Phase 4 - Terminal and Developer Environment Polish

Status: in progress.

Deliverables:

- Improve shell detection for zsh, bash, fish, and user login shell. Done for explicit shell, `$SHELL`, macOS login shell, and platform fallback resolution.
- Start terminals in the active project directory by default. Done for newly created terminal tabs.
- Add Mac-specific terminal shortcuts:
  - Cmd+T: new terminal tab. Done via native Terminal menu and dock fallback.
  - Cmd+W: close active terminal tab. Done via native Terminal menu and dock fallback.
  - Cmd+Shift+Left/Right: switch terminal tabs. Done via native Terminal menu and dock fallback.
- Add terminal profile metadata:
  - Current shell. Done in the active terminal profile strip.
  - Current working directory. Done with Mac-style `~` labels.
  - Environment source. Done with shell resolution source metadata.
- Investigate native pseudo-terminal behavior for long-running agent tasks and process cleanup on app quit.

Acceptance:

- Terminal tabs consistently start in the selected project.
- Terminal shortcuts do not conflict with global app/window shortcuts.
- Quitting the app cleans up owned processes without killing unrelated shells.

## Phase 5 - Secure Mac Storage and Permissions

Status: in progress.

Deliverables:

- Move API keys from local app storage into macOS Keychain or a Tauri-backed secure storage layer. Done for keys saved from the Mac app; env vars still override saved keys and `~/.xolotl-code/config.json` remains a legacy fallback.
- Add migration from existing stored keys with a clear one-time confirmation. Done for per-provider legacy config-file keys.
- Add settings UI for key storage status:
  - Stored in Keychain. Done.
  - Loaded from environment variable. Done.
  - Loaded from legacy config file. Done.
  - Missing. Done.
  - Needs migration. Done for legacy config-file keys.
- Review filesystem permissions and user prompts for project access.
- Add better error recovery when macOS denies file or notification permissions. Done for provider Keychain read failures; file and notification permission recovery still needs follow-up.

Acceptance:

- API keys are not stored in plain browser local storage.
- Failed Keychain reads produce actionable settings UI, not silent chat failures. Done for provider keys.
- Existing users can migrate without reconfiguring every model provider manually. Done for provider keys already present in the legacy config file.

## Phase 6 - Mac Productivity Features

Status: planned.

Deliverables:

- Optional global hotkey to bring Xolotl Code to front.
- Optional menu bar helper or status item:
  - Running agents count.
  - Active project.
  - Quick open command palette.
- Finder actions:
  - Reveal active project in Finder.
  - Reveal generated eval artifacts in Finder.
  - Open project folder in the user's preferred external editor if configured.
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

Implementation order:

1. Add non-interruptive Finder actions first.
2. Add notification routing for existing long-running work.
3. Add opt-in global hotkey with settings UI and tests.
4. Evaluate menu bar helper only after agent/eval status events are stable enough to summarize.

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

## Working Implementation Queue

This is the near-term order for this branch.

1. Finish Phase 3 native project workflows:
   - Finder/Open With end-to-end smoke harness for packaged app file-url open events.
   - Optional AppKit Dock menu shim only if the benefit is worth the native-maintenance cost.
2. Start Phase 2 Mac UI pass:
3. Add Phase 2.5 keyboard parity:
   - Additional file-browser row commands in the command palette. Done for current-folder and visible-entry commands.
   - Tests for menu, palette, and keydown routing. Done for shared command actions, palette native rows, global shortcuts, and terminal-scoped shortcuts.
4. Expand Phase 6 productivity features:
   - Notifications with click-through routing.
   - Optional global hotkey.
   - Optional status/menu bar helper if it proves useful in daily use.
5. Harden distribution:
   - Universal build path.
   - Signing and notarization checklist.
   - DMG polish and clean-machine install smoke.
