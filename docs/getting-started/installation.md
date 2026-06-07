# Installation

Xolotl Code has two surfaces — the desktop app and the CLI. They share the same engine and config, so you can install either or both.

## Prerequisites

- **Node.js 20+** (desktop app)
- **Rust toolchain** (both surfaces; CI pins **1.95.0**)
- The [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS:
  - **Windows** — WebView2 (preinstalled on Windows 11)
  - **Linux** — WebKitGTK
  - **macOS** — none beyond Xcode command-line tools

## Desktop app (recommended)

```bash
cd tauri-app
npm install
npm run tauri dev      # development with hot-reload (Vite serves on :1420)
npm run tauri build    # production binary in src-tauri/target/release
```

On first launch, open settings (the **gear icon** in the left sidebar) to add API keys. See [Configuration](configuration.md).

## CLI

```bash
cd rust
cargo install --path crates/rusty-claude-cli --force
xolotl --version
```

This installs the `xolotl` binary onto your `PATH`.

## Next steps

- [Quickstart](quickstart.md) — your first chat and eval
- [Configuration](configuration.md) — provider keys and where state lives
