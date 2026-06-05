# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Xolotl Code** — a desktop coding-agent platform for evaluating, comparing, and racing LLMs on real engineering work. It ships as two surfaces that share one engine and one config file:

- **Tauri desktop app** (`tauri-app/`) — the primary surface: chat pane, agent/team worktree orchestration, an eval lab (incl. Goal Eval), and settings for providers/skills/MCP.
- **`xolotl` CLI** (`rust/crates/rusty-claude-cli/`) — the same engine without the UI: multi-provider routing, slash commands, sessions, planning, tools, memory.

Both read `~/.xolotl-code/config.json`, so a key configured in either tool works in both. (Legacy `~/.claw-code/config.json` is auto-migrated on first run.)

## Two separate Rust trees

There are **two independent Rust build trees** — do not confuse them:

- `rust/` — a Cargo workspace (`crates/*`) that is the shared engine + CLI. Has its own CI (`.github/workflows/rust.yml`, Rust 1.95.0, Linux+Windows+macOS).
- `tauri-app/src-tauri/` — the desktop app's Rust backend (separate crate, not part of the `rust/` workspace). Has its own CI (`.github/workflows/tauri-app.yml`).

The engine logic lives in `rust/crates/runtime/` (conversation loop, prompts, memory, tools, agent supervisor, streaming events). The Tauri backend wraps/reimplements engine concerns for the desktop and exposes them over IPC.

## Commands

### Rust workspace (`rust/`)
```bash
cargo build --workspace
cargo test --workspace --exclude compat-harness        # exclude compat-harness (external checks)
cargo test -p runtime <test_name>                      # single test
cargo fmt --all -- --check
cargo clippy --workspace --all-features --exclude compat-harness -- -D warnings
cargo install --path crates/rusty-claude-cli --force   # install the `xolotl` CLI
```
Clippy runs with `pedantic` + `-D warnings` and `unsafe_code = "forbid"` (see workspace lints in `rust/Cargo.toml`) — new code must be clean under both.

### Tauri app (`tauri-app/`)
```bash
npm install
npm run tauri dev            # dev with hot-reload; vite serves on :1420 (NOT :5173)
npm run tauri build          # production binary in src-tauri/target/release
npm test                     # vitest (run mode)
npx tsc --noEmit             # type-check the TS layer without building
```
`build.bat` (repo root) does a production build and copies `xolotl.exe` to the repo root so the "Xolotl Code" desktop shortcut launches the latest code.

## Critical gotchas (verify against current code before relying on these)

1. **`tauri-app/src/bindings.ts` is auto-generated** by `tauri-specta` at `tauri dev` startup from `#[specta::specta]` commands in `src-tauri/`. Hand-edits get overwritten. To change the IPC surface, edit the Rust command first (`tauri-app/src-tauri/src/commands.rs`), then run `tauri dev` once to regenerate.

2. **Never model `~/.xolotl-code/config.json` as a strict struct.** It is a free-form `serde_json::Map` with uppercase env-var-style keys (`ANTHROPIC_API_KEY`, `KIMI_CODING_BASE_URL`, `AWS_*`, …) shared with the CLI. A strict struct silently drops unknown keys on save and destroys the user's CLI config. Treat it as a map.

3. **u64/i64 in specta commands** panic at startup by default. The builder uses `dangerously_cast_bigints_to_number()` — these are unix-ms timestamps that fit safely in a JS Number. Keep that escape hatch when adding timestamp fields.

4. **Windows local builds break on spaces in the repo path** ("Important Projects/" breaks mingw `dlltool`). The fix is a **local-only, gitignored** `rust/.cargo/config.toml` redirecting the target dir off the spaced path. Do not commit it — committing it previously broke Linux CI and forks. (`rust/.cargo/` is gitignored.)

5. **`cargo test` for the Tauri backend fails on Windows** (WebView2 DLL loader blocks the test harness) — those unit tests run on Linux/macOS CI. The `tauri-app/` TS tests (vitest) run fine locally.

6. **Reasoning models stream chain-of-thought separately**: Kimi/DeepSeek emit `delta.reasoning_content` first (often 10s+ of silence before any `delta.content`), then the answer in `delta.content`. Surface both, or the UI looks dead.

7. **Kimi-For-Coding requires coding-agent headers** or it returns 403 `access_terminated_error`. Use the same header set as `rust/crates/rusty-claude-cli/src/openai.rs` (`User-Agent: claude-code/...`, `X-Client-Name`, `X-Client-Version`, `X-Source`, `Accept`). Its model id is `kimi-k2-turbo-preview`, not `kimi-coding`.

## graphify knowledge graph

A graphify graph exists at `graphify-out/` (gitignored).
- Before answering architecture/codebase-wide questions, read `graphify-out/GRAPH_REPORT.md` for god nodes and community structure; if `graphify-out/wiki/index.md` exists, navigate it instead of reading raw files.
- After modifying code files, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Planning artifacts

`.planning/` holds the GSD phase plans, discussion logs, UAT, verification, and state (`STATE.md`, `ROADMAP.md`). The v1 milestone (6 phases, 33 plans) is marked complete. These are project history/context, not build inputs.
