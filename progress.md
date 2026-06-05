Original prompt: Add an interactive pixel axolotl civilization game/eval lab to the app, with saved sessions, player interventions, buffs/debuffs, AI-controlled civilization turns, and generated game assets.

Progress:
- Started implementation in Default mode.
- Chosen v1 scope: single model civilization, observer/god-player controls, Tauri backend module, Phaser canvas, saved sessions.
- Added `tauri-app/src-tauri/src/civilization.rs` with deterministic sessions, interventions, AI turn parsing, scoring, and Tauri events.
- `cargo test civilization --lib` compiled but the Tauri test binary failed to start with Windows `STATUS_ENTRYPOINT_NOT_FOUND`; use `cargo check` for backend verification unless the harness issue is fixed.
- Added fallback project-local pixel PNGs under `tauri-app/public/civ/` after built-in image generation returned a rate limit.
- Replaced the placeholder worker with a 12-variant `axolotl-seeds.png` sheet and updated Phaser to assign stable seed frames per axolotl.
- Frontend tests, frontend build, Rust `cargo check --lib`, and `graphify update .` passed.

TODO:
- Retry `$imagegen` for higher-quality project-bound assets when the service is available.
- Browser screenshot verification was not completed because the Browser tool was not exposed and Playwright is not installed in this app.
