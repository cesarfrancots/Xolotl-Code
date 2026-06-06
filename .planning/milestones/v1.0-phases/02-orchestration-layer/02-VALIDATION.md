---
phase: 2
phase_slug: orchestration-layer
generated: 2026-05-08
---

# Validation Strategy: Phase 2 — Orchestration Layer

## Test Framework

| Property | Value |
|----------|-------|
| Framework | Rust built-in test framework (`#[test]`, `#[tokio::test]`) |
| Config file | `rust/Cargo.toml` workspace |
| Quick run command | `cargo test --manifest-path rust/Cargo.toml -p runtime supervisor` |
| Full suite command | `cargo test --manifest-path rust/Cargo.toml --workspace` |

## Requirement → Test Map

| Req ID | Behavior | Test Type | Automated Command |
|--------|----------|-----------|-------------------|
| ORC-01 | AgentState transitions: valid and invalid paths | unit | `cargo test -p runtime agent_state` |
| ORC-01 | AgentEvent serde round-trip (serialize → deserialize → same value) | unit | `cargo test -p runtime agent_event_serde` |
| ORC-02 | AgentSupervisor: spawn N agents, list returns N entries, stop removes entry | unit | `cargo test -p runtime supervisor_registry` |
| ORC-02 | AgentHandle::subscribe() returns receiver that sees events | unit | `cargo test -p runtime agent_handle_subscribe` |
| ORC-03 | run_turn() inside spawn_blocking: 8 concurrent agents complete without deadlock | load test | `cargo test -p runtime load_test_spawn_blocking` |
| ORC-04 | publish() accepts ≤1000 token snapshot, returns Ok | unit | `cargo test -p runtime context_store_publish_ok` |
| ORC-04 | publish() rejects >1000 token snapshot, returns Err(TooLarge) | unit | `cargo test -p runtime context_store_too_large` |
| ORC-04 | pull() returns None for missing key, Some for existing key | unit | `cargo test -p runtime context_store_pull` |
| ORC-05 | WorktreeManager::add() shells out to git worktree add, returns path | unit (requires git) | `cargo test -p runtime worktree_add` |
| ORC-05 | WorktreeManager::remove() removes worktree from active map | unit (requires git) | `cargo test -p runtime worktree_remove` |
| ORC-05 | WorktreeManager::list() returns all active worktrees | unit | `cargo test -p runtime worktree_list` |
| ORC-06 | SubAgentConfig with working_dir set passes --working-dir flag to child | unit | `cargo test -p runtime spawner_working_dir` |
| ORC-06 | NDJSON AgentEvent round-trip: serialize to line, deserialize back | unit | `cargo test -p runtime ndjson_roundtrip` |
| ORC-07 | GitOpQueue serializes two concurrent writes: second runs after first completes | unit | `cargo test -p runtime git_queue_serialization` |

**14 tests total** across all 7 ORC requirements.

## Sampling Rate

- **Per task commit:** `cargo test --manifest-path rust/Cargo.toml -p runtime`
- **Per wave merge:** `cargo test --manifest-path rust/Cargo.toml --workspace`
- **Phase gate:** Full suite green before `/gsd-verify-work`

## ORC-03 Load Test Strategy

Use `tokio::runtime::Builder::new_multi_thread().max_blocking_threads(16)` to bound the blocking pool at a known value and confirm 8 concurrent agents fit without exhaustion. `MockApiClient` returns instantly with canned response (no real API key needed — D-09).

## Test Infrastructure Requirements

- `tempfile = "3"` as dev-dependency in `rust/crates/runtime/Cargo.toml` — for git worktree fixture tests (ORC-05)
- All tests run without real API keys — headless verification per D-09

## Phase Gate Criteria

All 14 tests must pass with `cargo test --manifest-path rust/Cargo.toml --workspace` before phase is considered complete.

---
*Generated: 2026-05-08 from 02-RESEARCH.md Validation Architecture*
