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
- Command palette keeps Mac handoff failures visible with recovery guidance for Finder, editor, Quick Look, and clipboard actions.
- Mac command routing uses a shared command model for global keydown handling, native-menu action normalization, and command-palette action rows.
- File > Open Recent is populated from the persisted project store and refreshes after project add/remove/activation.
- Directory paths passed at app launch are imported into the project store and activated on startup.
- macOS open/reopen events are handled: folder URLs from Finder/Open With activate directly, document file URLs activate their containing folder, and Dock/app reopen focuses the main window.
- The macOS bundle registers Finder/Open With document types for project folders plus common source/text documents.
- The macOS bundle registers `xolotl-code://open?path=...` project links for Shortcuts, Raycast, Alfred, and shell automation.
- Project rows and the command palette can copy `xolotl-code://open?path=...` links for saved projects, current folders, and visible file-browser entries.
- The command palette can copy a prompt-ready active project context block with the POSIX path and `xolotl-code://` link for Shortcuts, Raycast, Alfred, and shell automation.
- Saved project rows and file browser entries can reveal their target in Finder.
- File browser entries can copy POSIX paths and project-relative paths.
- File browser browse failures show macOS-specific recovery for missing folders and privacy-denied folder access.
- File browser entries can preview files with macOS Quick Look from row actions and the command palette.
- File browser folders can open embedded terminals at the current folder or selected child folder, matching Finder-style "New Terminal Here" workflow.
- Terminal cwd metadata can reveal its folder in Finder and copy the POSIX cwd path.
- Terminal cwd Finder/copy actions show inline success or recovery feedback instead of failing silently.
- Eval history can reveal saved eval JSON files and the generated eval artifacts folder in Finder.
- Eval history can export saved evals as Markdown reports to `~/Documents/Xolotl Code/Eval Reports` with reveal/copy follow-up actions.
- Launched eval outcome artifacts can reveal their generated artifact folder in Finder, copy its POSIX path, and open it in the preferred external editor.
- Expanded agent output can reveal the active agent worktree in Finder, copy its POSIX path, and open it in the preferred external editor.
- Launched eval outcome artifacts and expanded agent worktrees can copy `xolotl-code://open?path=...` links for automation handoff.
- Packaged launch-path smoke coverage is available through `npm run smoke:mac:launch-path`.
- Packaged Launch Services/Open With smoke coverage is available through `npm run smoke:mac:open-project`.
- Terminal tab commands are available from a native Terminal menu.
- Terminal tabs capture the active project directory when they are created.
- Finder-style folder drops on the app window can activate projects.
- Sidebar project paths use Mac-style `~` home labels.
- File browser entries include hidden, alias, and package metadata.
- Quitting or closing the app cleans up Xolotl-owned terminal PTYs and tracked eval children from the native backend.
- Provider API keys saved from the Mac app use macOS Keychain, with env-var and legacy config-file fallback.
- Settings show whether each provider key comes from Keychain, an environment variable, or the legacy config file.
- Legacy config-file provider keys can be moved into Keychain from Settings after a one-time confirmation.
- Keychain read failures surface in Settings with recovery text instead of looking like missing provider keys.
- Terminal tabs resolve zsh/bash/fish-aware shell profiles and display shell, cwd, and environment source metadata.
- macOS Settings include a preferred external editor, and active projects can open in that editor from project rows or the command palette.
- macOS Settings include opt-in notification toggles for agent completion, eval completion, and permission prompts. Backend notifications now respect those toggles.
- Mac productivity notifications emit route metadata and Dock/app reopen can route back to the related Chat, Eval, or Agent view; eval ids are preserved while the lazy Eval view mounts.
- App-level Mac recovery status surfaces native menu, notification routing, app reopen routing, global hotkey, productivity settings, and menu bar status item runtime failures without replacing the active workspace.
- Command palette includes clipboard-aware actions to seed a chat from the current text clipboard or ask for an explanation of the clipboard snippet.
- The last workbench tab is restored on reopen when the URL does not explicitly request a tab, while direct `?tab=` links still take priority.
- The last active project is revalidated and restored on reopen when Finder/Open With/URL launch paths are absent; stale or inaccessible folders clear the active scope with Mac recovery guidance.
- Settings and the command palette share a tighter macOS utility-dialog surface and close with `Cmd+W` before underlying app shortcuts see the event.
- macOS Settings include an opt-in, configurable global hotkey that can bring the app window forward from anywhere.
- macOS Settings include an opt-in menu bar status item with active project and agent-state summary plus quick access to common commands.
- macOS Settings show compact status tiles and targeted recovery guidance for editor, global-hotkey, menu-bar, and notification states.
- The Mac UI respects system reduced-motion and higher-contrast preferences, with a fallback keyboard focus ring for custom workbench controls.
- Mac release preflight checks are available through `npm run release:mac:preflight` and the release checklist is tracked in `MACOS_RELEASE_CHECKLIST.md`.

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
  - Add visible focus rings and predictable Tab order for sidebar, chat, eval, civ, terminal, and agent panels. Done for the first global fallback focus-ring pass across custom controls.
  - Use Mac shortcut labels consistently in menus, buttons, tooltips, and command palette rows. Done for the first pass across toolbar, terminal, sidebar footer, composer, and palette.
- Accessibility:
  - Verify reduced motion and high-contrast behavior. Done for the first global CSS preference pass and regression coverage.
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
  - Add file-browser commands for current folder navigation, Finder reveal, Quick Look, New Terminal Here, and visible row copy/path actions. Done for the current listing and non-hidden visible entries.
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
- Open project folders from Finder. Done for Tauri window drops, macOS `RunEvent::Opened` file URLs, Info.plist document registration, and packaged Launch Services/Open With smoke coverage.
- Open source/text files from Finder by activating the containing folder as a project. Done for macOS `RunEvent::Opened` file URLs and packaged Open With smoke coverage.
- Open projects from `xolotl-code://open?path=...` deep links. Done for macOS URL scheme registration, native open-event parsing, and packaged smoke coverage.
- Copy project and file-browser deep links for automation handoff. Done for saved project rows plus active/current/visible command-palette actions.
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
- Investigate Tauri reopen/open-url/document-open support for dragging a folder onto the Dock icon or launching via Finder "Open With". Done for `RunEvent::Opened` and `RunEvent::Reopen` handling, with packaged Launch Services smoke coverage.
- Add a packaged-app smoke script that launches the `.app` with a temporary directory argument and asserts the project is activated. Done via `npm run smoke:mac:launch-path`.
- Evaluate Dock menu support only after project-open event handling is stable. Done: current Tauri API does not provide Dock menu construction.

## Phase 4 - Terminal and Developer Environment Polish

Status: in progress.

Deliverables:

- Improve shell detection for zsh, bash, fish, and user login shell. Done for explicit shell, `$SHELL`, macOS login shell, and platform fallback resolution.
- Start terminals in the active project directory by default. Done for newly created terminal tabs.
- Start terminals from file-browser folders on demand. Done for current folder and visible child folders.
- Add Mac-specific terminal shortcuts:
  - Cmd+T: new terminal tab. Done via native Terminal menu and dock fallback.
  - Cmd+W: close active terminal tab. Done via native Terminal menu and dock fallback.
  - Cmd+Shift+Left/Right: switch terminal tabs. Done via native Terminal menu and dock fallback.
- Add terminal profile metadata:
  - Current shell. Done in the active terminal profile strip.
  - Current working directory. Done with Mac-style `~` labels.
  - Environment source. Done with shell resolution source metadata.
- Investigate native pseudo-terminal behavior for long-running agent tasks and process cleanup on app quit. Done for backend-owned terminal PTYs and tracked eval child processes; autonomous agent executor child tracking remains a follow-up if the CLI runner is kept long term.

Acceptance:

- Terminal tabs consistently start in the selected project.
- Terminal shortcuts do not conflict with global app/window shortcuts.
- Quitting the app cleans up owned terminal/eval processes without killing unrelated shells. Done for terminal PTYs and tracked eval children.

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
- Add better error recovery when macOS denies file or notification permissions. Done for provider Keychain read failures, notification permission/routing failures, and project/file-browser folder access failures.

Acceptance:

- API keys are not stored in plain browser local storage.
- Failed Keychain reads produce actionable settings UI, not silent chat failures. Done for provider keys.
- Existing users can migrate without reconfiguring every model provider manually. Done for provider keys already present in the legacy config file.

## Phase 6 - Mac Productivity Features

Status: in progress.

Deliverables:

- Optional global hotkey to bring Xolotl Code to front. Done for opt-in settings, configurable accelerator persistence, runtime register/unregister, and window focus.
- Optional menu bar helper or status item:
  - Running agents count. Done for opt-in status item title/menu summary.
  - Active project. Done for disabled status menu row.
  - Quick open command palette. Done through the status item menu using the native command bridge.
- Finder actions:
  - Reveal active project in Finder.
  - Quick Look project files from the sidebar and command palette. Done for visible file entries.
  - Reveal generated eval artifacts in Finder. Done for saved eval JSON files, the eval-artifacts folder, and generated artifact folders after launch; launched artifact folders also support path copy and editor handoff.
  - Open project folder in the user's preferred external editor if configured. Done for active project rows and command palette access.
- Notification actions for long-running tasks:
  - Agent finished. Done for opt-in native completion alerts and reopen-to-agent routing.
  - Eval finished. Done for opt-in single eval, goal eval, and suite completion alerts with reopen-to-eval routing.
  - Permission required. Done for opt-in tool permission prompt alerts with reopen-to-chat routing.
- Clipboard-aware command palette actions:
  - Explain selected code. Done for the current text clipboard.
  - Start chat with clipboard snippet. Done for the current text clipboard.
- Evaluate macOS Services or Shortcuts integration after core workflows are stable.
  - First pass done with `xolotl-code://open?path=...` deep links for Shortcuts, Raycast, Alfred, and shell automation.
  - Link-copying actions are available from saved project rows and the command palette.

Acceptance:

- Every OS-level feature is opt-in when it can interrupt the user.
- Global shortcuts are configurable and can be disabled.
- Notifications route back to the relevant app view.

Implementation order:

1. Add non-interruptive Finder actions first.
   - Done for active project external-editor launch with a macOS Settings preference.
2. Add notification routing for existing long-running work.
   - Done for opt-in backend notifications, route metadata events, app-reopen routing, and eval-id handoff for lazy Eval views. Direct notification click payloads remain constrained by the current Tauri desktop notification wrapper, which ignores Rust-side action metadata.
3. Add opt-in global hotkey with settings UI and tests.
   - Done for the first implementation with the official Tauri global-shortcut plugin. Remaining validation: packaged-app manual collision behavior on a clean Mac account.
4. Evaluate menu bar helper only after agent/eval status events are stable enough to summarize.
   - Done for the first opt-in implementation: the frontend sends active project/running agent state to a native Tauri status item, and status menu actions reuse the existing native command bridge.

## Phase 7 - Distribution, Signing, and Update Path

Status: in progress.

Deliverables:

- Universal Apple Silicon + Intel build path.
- Developer ID code signing.
- Notarization workflow.
- DMG layout polish:
  - App icon. Done for preflight verification against the packaged app.
  - Applications shortcut. Done for preflight verification by mounting the DMG.
  - Clear volume name. Done through the DMG packaging script volume name and preflight mount checks.
- Versioned release checklist. Done in `MACOS_RELEASE_CHECKLIST.md` for the first distribution pass.
- Investigate Tauri updater support after signing is stable.

Acceptance:

- A clean Mac can install and launch the app without Gatekeeper workarounds.
- DMG and `.app` artifacts are reproducible from documented commands.
- Release checklist states required environment variables and certificates.

Implementation notes:

- `npm run release:mac:preflight` verifies the built app/DMG identity, icon, architecture, DMG contents, and optional signing/notarization gates.
- `npm run release:mac:universal:preflight` requires a universal app binary via `MAC_RELEASE_EXPECT_UNIVERSAL=1` and defaults to the universal Tauri app bundle path.
- Strict release validation can require Developer ID signing and notarization by setting `MAC_RELEASE_REQUIRE_SIGNING=1` and `MAC_RELEASE_REQUIRE_NOTARIZATION=1`.

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
- Smoke script for Launch Services/Open With folder and file URL delivery.
- Build checks for app bundle, DMG, and universal target.

## Next Mac-Unique Improvement Track

This track is the next implementation focus after the first compatibility and native integration work. It assumes macOS can support deeper OS integration than the Windows build, but keeps those features opt-in when they can interrupt the user or add native maintenance cost.

### A. Mac Visual and Interaction Refinement

Deliverables:

- Tune the app shell toward a native utility-app feel without reducing developer density:
  - Sidebar and file browser should read more like Finder/Xcode navigators.
  - Workbench controls should keep segmented-control behavior and clear pressed states.
  - Dialogs and popovers should feel closer to macOS sheets/popovers with tighter spacing, lighter borders, and predictable keyboard dismissal. Done for the first shared Settings and command-palette pass.
- Respect system appearance more deeply:
  - Audit light/dark transitions for contrast and separator clarity.
  - Use the existing high-contrast/reduced-motion hooks for any new motion or focus state.
  - Evaluate system accent-color usage only where it improves recognizability and does not create a one-color UI.
- Improve compact-window behavior:
  - Verify traffic-light spacing, collapsed sidebar controls, terminal tabs, and command palette at narrow widths.
  - Prevent titlebar and toolbar actions from wrapping into unusable states.

Acceptance:

- The first viewport remains the working app, not a landing page.
- No controls overlap at compact MacBook widths.
- Full keyboard access can reach sidebar, workbench tabs, command palette, terminal tabs, and Settings.

### B. Finder, Shortcuts, and Automation Handoff

Deliverables:

- Make project and file handoff frictionless:
  - Continue expanding `xolotl-code://open?path=...` links where they naturally fit.
  - Add a command-palette action to copy a prompt-ready project context link when a project is active. Done for active project path + `xolotl-code://` link context blocks.
  - Add documentation or in-app affordances for using links from Shortcuts, Raycast, Alfred, and shell scripts without adding noisy onboarding text to the main UI.
- Improve Finder-originated workflows:
  - Complete end-to-end manual QA for drag/drop, Open With, and file-url launch using real folders with spaces and package directories.
  - Consider an AppKit shim only for features Tauri cannot expose cleanly and only after the maintenance cost is clear.
- Add Mac-friendly import/export surfaces:
  - Export eval artifacts and generated reports to Finder-visible locations with reveal/copy actions. Done for launched eval artifact folders and persisted Markdown eval reports.
  - Keep file writes explicit and avoid surprise background exports.

Acceptance:

- A Mac user can get from Finder, Raycast, Shortcuts, or Terminal into the exact Xolotl project/folder without duplicate project entries.
- Copied links survive paths with spaces and Unicode.
- Automation hooks work without requiring main-branch changes or private user paths in tests.

### C. Mac Work Continuity

Deliverables:

- Restore useful workspace state on reopen:
  - Last active project. Done with startup revalidation, canonical path refresh, launch-path priority, and stale-folder recovery.
  - Last workbench tab. Done for Chat/Eval/Civ restoration with direct URL priority.
  - Terminal dock visibility. Done through persisted UI state.
  - Command palette or modal state only when restoration is clearly helpful.
- Improve reopen and notification routing:
  - Keep Dock/app reopen focused on the most useful current task.
  - Preserve route metadata for chat, eval, and agent contexts.
  - Revisit direct notification action payloads if the Tauri notification layer exposes reliable click metadata.
- Add recent-work affordances:
  - Recent projects stay in the native menu and command palette.
  - Consider recent files/folders only if it does not clutter the command palette.

Acceptance:

- Quit/reopen feels intentional and does not strand users on an empty screen.
- Notification and Dock routing never opens the wrong project or loses eval/chat context.
- State restoration has tests for missing, moved, or inaccessible project paths.
  - Done for stale last-active-project cleanup and launch-path priority over restore.

### D. Developer Handoff Features

Deliverables:

- Expand external editor support:
  - Keep the preferred editor setting.
  - Add per-action error recovery when the configured editor is missing.
  - Consider editor-specific deep links for VS Code, Cursor, and Zed if they are installed and if detection is reliable.
- Expand terminal handoff:
  - Current embedded terminal actions stay first-class.
  - Optional external terminal launch for Terminal.app, iTerm2, and Warp is available behind a macOS Settings preference for terminal cwd, project row, current-folder, and folder-entry handoff actions.
  - Preserve active project/folder cwd and shell profile metadata.
- Add task-result handoffs:
  - Reveal artifacts, copy paths, copy deep links, and open folders in editor from eval/agent result surfaces. Done for launched eval artifact folders and expanded agent worktree folders, including `xolotl-code://` link-copying handoffs.
- Add visible recovery for failed handoff actions. Done for command-palette Finder/editor/Quick Look/clipboard actions.
  - Done for terminal cwd Finder/copy actions.
  - Done for expanded agent worktree Finder/copy/editor actions.

Acceptance:

- Handoff actions fail visibly and recoverably when an external app is not installed.
- Embedded terminal remains the default reliable path.
- Terminal cwd, saved project rows, and file-browser folder actions can open their active folder in the configured external Mac terminal without replacing the embedded terminal workflow.
- External app support is additive and does not break browser/Vite tests.

### E. Menu Bar and Global Controls

Deliverables:

- Improve the optional menu bar status item:
  - Show active project and running agent/eval summary.
  - Add quick commands only when they are stable and already route through native command actions.
  - Avoid turning the status menu into a second full app navigation tree.
- Improve global hotkey behavior:
  - Detect registration failures and show recovery text in Settings. Done for frontend save failures with Mac-specific recovery guidance.
  - Validate collisions on a clean Mac account.
  - Keep the feature disabled by default.
- Add clearer status feedback:
  - Use native notifications only for user-enabled events. Done for persisted notification toggles and permission gating.
  - Keep in-app status indicators quiet and scan-friendly.
  - Show compact macOS Settings status tiles for editor, global hotkey, menu bar helper, and notification permission. Done.

Acceptance:

- Menu bar and global hotkey features are fully optional.
- Failed registration or permission states are visible in Settings.
- Status menu commands reuse the tested native command bridge.

### F. Validation and Release Confidence

Deliverables:

- Add targeted regression checks for each Mac feature:
  - Unit tests for command, URL, path, and settings state.
  - Browser smoke for frontend rendering after visual changes.
  - Packaged `.app` smoke for Launch Services, deep links, and release preflight.
- Build a manual QA checklist for Mac-specific UX:
  - Apple Silicon current macOS.
  - Fresh profile and existing profile.
  - Paths with spaces, Unicode, symlinks, hidden files, and package directories.
  - Offline launch and missing provider-key states.
- Keep distribution gates explicit:
  - Universal build check.
  - Signing check.
  - Notarization check.
  - DMG mount/install check.

Acceptance:

- Each Mac-only feature has at least one focused test or documented manual verification path.
- Release checks fail with actionable messages.
- The macOS branch stays isolated until the user explicitly approves pushing or merging to main.

## Working Implementation Queue

This is the near-term order for this branch.

1. Finish Phase 3 native project workflows:
   - Finder/Open With end-to-end smoke harness for packaged app file-url open events. Done via `npm run smoke:mac:open-project`.
   - Optional AppKit Dock menu shim only if the benefit is worth the native-maintenance cost.
2. Start Phase 2 Mac UI pass:
   - Audit the current app shell at desktop and compact MacBook widths.
   - Tighten Settings, command palette, terminal tabs, and result surfaces to match the existing Mac-style sidebar/workbench direction. Done for the first Settings and command-palette dialog pass.
   - Add browser screenshots and focused tests for any layout-affecting changes.
3. Add Phase 2.5 keyboard parity:
   - Additional file-browser row commands in the command palette. Done for current-folder, Quick Look, New Terminal Here, and visible-entry commands.
   - Tests for menu, palette, and keydown routing. Done for shared command actions, palette native rows, global shortcuts, and terminal-scoped shortcuts.
4. Expand Phase 6 productivity features:
   - Notifications with click-through routing. Done for backend route metadata and macOS app-reopen routing; direct action payload support remains dependent on Tauri desktop notification support.
   - Optional global hotkey. Done for the first opt-in implementation.
   - Optional status/menu bar helper. Done for the first opt-in implementation with active project, agent summary, command palette, terminal, settings, and project-opening actions.
   - Clearer failure/recovery states for hotkey registration, notification permission, and configured external apps. Done for macOS Settings save/permission failures and status summary.
5. Harden distribution:
   - Universal build path. Build and package scripts now select the universal app bundle when `MAC_DMG_ARCH=universal`; preflight has a universal architecture gate.
   - Signing and notarization checklist. Done for the first release checklist and strict preflight flags.
   - DMG polish and clean-machine install smoke. Preflight now verifies app/icon/Applications link; clean-machine manual install remains in the checklist.
