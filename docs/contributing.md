# Contributing

## Local development

```bash
# Rust workspace (engine + CLI)
cd rust
cargo build --workspace
cargo test --workspace --exclude compat-harness
cargo fmt --all -- --check
cargo clippy --workspace --all-features --exclude compat-harness -- -D warnings

# Tauri app
cd tauri-app
npm install
npm run tauri dev
npx tsc --noEmit                     # type-check without building
npm test                             # vitest
```

## CI & lints

- The `rust/` workspace runs on CI across **Linux + Windows + macOS** (Rust **1.95.0**): fmt, clippy with `-D warnings`, build, and tests excluding the compat harness.
- Clippy runs `pedantic` and `unsafe_code = "forbid"` — new code must be clean under both.
- The Tauri TypeScript layer is checked locally; `bindings.ts` regenerates from `#[specta::specta]` Rust commands on each debug build.

## Conventions

- **Don't model `~/.xolotl-code/config.json` as a strict struct** — it's a free-form map shared with the CLI; a strict struct silently drops unknown keys.
- **Match the surrounding code's style**; keep changes surgical.
- Edit Rust IPC commands first, then regenerate bindings — never hand-edit `bindings.ts`.

## Docs

These docs live in `docs/` as plain Markdown. Add a page, then link it from [`SUMMARY.md`](SUMMARY.md) (the table of contents used by GitBook and as a human index).
