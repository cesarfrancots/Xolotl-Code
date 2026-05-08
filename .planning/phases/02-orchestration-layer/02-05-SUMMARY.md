---
plan: "02-05"
phase: "02"
status: complete
wave: 4
completed: 2026-05-08
---

# Summary: 02-05 — SubAgentSpawner Extension

## What Was Built

Extended `SubAgentConfig` in `rust/crates/runtime/src/subagent/spawner.rs` with two opt-in fields for child-process agent integration (D-05 / ORC-06):

- `working_dir: Option<PathBuf>` — when `Some`, passed as `--working-dir <path>` to the child CLI
- `ndjson_stdout: bool` — when `true`, child stdout is `Stdio::piped()` so the supervisor can read NDJSON lines; when `false` (default), stdout is `Stdio::null()` (existing behavior preserved)
- `with_working_dir(path)` and `with_ndjson_stdout(bool)` builder methods added
- `spawn_ndjson_reader()` async method reads child stdout lines and deserializes each as `serde_json::from_str::<AgentEvent>`

## Key Files

- `rust/crates/runtime/src/subagent/spawner.rs` — all changes in-place; existing `SubAgentSpawner` tests untouched

## Verification

- `cargo check -p runtime` — exits 0 (1 dead_code warning on `spawn_ndjson_reader` — expected, consumed by Plan 06 tests)
- `cargo test -p runtime subagent` — 15 passed, 0 failed
- All existing SubAgentSpawner tests still pass

## Commits

- `4fdd9d2`: feat(02-05): extend SubAgentConfig with working_dir and ndjson_stdout fields

## Key Decisions

- New fields default to `None`/`false` — zero-cost when unused, backward-compatible
- `spawn_ndjson_reader()` returns `impl Stream<Item = Result<AgentEvent, _>>` via `tokio_stream` line reader
- `AgentEvent` import from `crate::supervisor` — cross-crate link between subagent and supervisor layers

## Self-Check: PASSED
