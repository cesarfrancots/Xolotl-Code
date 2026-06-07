# Xolotl Code macOS Release Checklist

This checklist is for release builds from the `codex/mac-version` branch. It keeps the unsigned local package flow separate from the stricter Developer ID and notarization gates.

## Build Targets

Apple Silicon local package:

```bash
npm test
npm run build
cd src-tauri && cargo test && cd ..
npm run build:mac:dmg
npm run release:mac:preflight
npm run smoke:mac:launch-path
npm run smoke:mac:open-project
```

Universal package:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run build:mac:universal:dmg
npm run release:mac:universal:preflight
npm run smoke:mac:launch-path
npm run smoke:mac:open-project
```

## Preflight Gates

`npm run release:mac:preflight` checks the built `.app` and DMG:

- App bundle exists.
- DMG exists.
- `Info.plist` name, bundle id, version, executable, and Developer Tools category match project config.
- `Info.plist` registers Finder/Open With document types for folders and source/text documents.
- `Info.plist` registers the `xolotl-code` URL scheme for Shortcuts, Raycast, Alfred, and shell automation.
- App icon exists.
- Executable architecture matches the current Mac, or both `arm64` and `x86_64` when universal mode is requested.
- DMG mounts and contains `Xolotl Code.app` plus an `Applications` symlink.
- Code signing is reported as a warning by default and becomes required with `MAC_RELEASE_REQUIRE_SIGNING=1`.
- Notarization assessment is skipped by default and becomes required with `MAC_RELEASE_REQUIRE_NOTARIZATION=1`.

`MAC_DMG_ARCH=universal` packages and preflights the app from `src-tauri/target/universal-apple-darwin/release/bundle/macos/Xolotl Code.app` while keeping the DMG output in `src-tauri/target/release/bundle/dmg`. Use `MAC_APP_BUNDLE_PATH=/path/to/Xolotl Code.app` when a release runner needs to package or verify an app bundle from a custom location.

Strict release gate:

```bash
MAC_RELEASE_REQUIRE_SIGNING=1 \
MAC_RELEASE_REQUIRE_NOTARIZATION=1 \
npm run release:mac:preflight
```

## Signing Inputs

Developer ID signing and notarization require Apple Developer account material on the release machine or CI runner.

Expected environment variables:

- `APPLE_CERTIFICATE`: base64-encoded Developer ID Application `.p12` certificate, when importing a signing certificate in CI.
- `APPLE_CERTIFICATE_PASSWORD`: password for the `.p12` certificate.
- `APPLE_SIGNING_IDENTITY`: Developer ID Application identity name or hash.
- `APPLE_ID`: Apple ID used for notary submission.
- `APPLE_PASSWORD` or `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password for the Apple ID.
- `APPLE_TEAM_ID`: Apple Developer Team ID.

Local Keychain alternative:

- Install the Developer ID Application certificate in the login keychain.
- Confirm `security find-identity -v -p codesigning` lists the intended Developer ID Application identity.
- Build with the appropriate signing identity configured for Tauri or the release environment.

## Manual Verification

Run these checks on a clean macOS user profile before a public release:

- Install from the DMG by dragging `Xolotl Code.app` to Applications.
- Launch from Applications.
- Confirm Gatekeeper allows launch without workaround after notarization.
- Open Settings and verify provider key source rows.
- Enable the menu bar status item and confirm the status menu opens Xolotl, Settings, Command Palette, Terminal, and Open Folder.
- Enable notifications, run a test notification, and confirm notification routing returns to the expected view.
- Launch the app with a project path and confirm the project is active.
- Use Finder/Open With on a project folder and confirm it activates without duplicate recent-project rows.
- Use Finder/Open With on a source or Markdown file and confirm Xolotl activates the containing folder as a project.
- Open `xolotl-code://open?path=/absolute/project/path` from Shortcuts, Raycast, Alfred, or `open -u` and confirm Xolotl activates the project.
- Quit with terminal tabs open and confirm Xolotl-owned terminal processes are cleaned up.

## Artifacts

Expected local artifacts:

- `src-tauri/target/release/bundle/macos/Xolotl Code.app`
- `src-tauri/target/release/bundle/dmg/Xolotl Code_0.1.0_aarch64.dmg`
- `src-tauri/target/universal-apple-darwin/release/bundle/macos/Xolotl Code.app`, for universal builds.
- `src-tauri/target/release/bundle/dmg/Xolotl Code_0.1.0_universal.dmg`, for the universal DMG generated with `MAC_DMG_ARCH=universal`.
