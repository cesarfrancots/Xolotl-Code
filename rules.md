# Project Rules — Claw-code

These rules exist to keep the codebase healthy, CI green, and developer velocity high. If a rule is slowing you down without preventing real problems, propose a change—do not silently ignore it.

---

## 1. Rust Toolchain & CI Determinism

**1.1. Pinned CI Toolchain**
The CI workflow (`.github/workflows/rust.yml`) pins an exact Rust version (e.g., `dtolnay/rust-toolchain@1.95.0`). This prevents surprise CI breakages when a new stable Rust release introduces new clippy lints or compiler warnings.

- **Bumping the pinned version** is an intentional act: update `.github/workflows/rust.yml`, run the full local validation suite (see §2), open a dedicated PR, and verify all three OS jobs pass before merging.
- **Do not** use `@stable` or `@nightly` in CI unless there is an explicit, documented reason.

**1.2. Local Toolchain Alignment (Strongly Recommended)**
Developers should align their local toolchain with the CI pin when possible:
```bash
rustup install 1.95.0
rustup default 1.95.0
rustup component add rustfmt clippy --toolchain 1.95.0
```
If your local version is behind the CI pin, you may push code that passes locally but fails in CI.

**1.3. Workspace Lint Configuration is the Source of Truth**
Lint levels are declared in `rust/Cargo.toml` under `[workspace.lints.rust]` and `[workspace.lints.clippy]`. These propagate to all workspace crates.
- Do not add `#![allow(...)]` or `#[allow(...)]` attributes to silence lints without a code review comment explaining why.
- If a lint is fundamentally incompatible with a specific module or crate, use `#[allow(lint_name)]` with a `// SAFETY:` or `// REASON:` comment, never a blanket suppression.

---

## 2. Pre-Push Validation

Before pushing to `main`, `dev`, or opening a PR, the following must pass in your local `rust/` directory:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-features -- -D warnings
cargo build --workspace
cargo test --workspace --exclude compat-harness
```

**2.1. Clippy is Mandatory, Not Optional**
We run clippy with `-D warnings`, which means **every warning is a hard error** in CI. If clippy warns locally, CI will fail.
- Treat clippy suggestions as blockers, not suggestions.
- If a clippy lint produces a false positive, suppress it locally with a rationale comment and mention it in the PR description.

**2.2. Formatting is Enforced**
`cargo fmt --all -- --check` must pass. Do not debate formatting in PR reviews—defer to `rustfmt`.

**2.3. Cross-Platform Awareness**
CI runs on `ubuntu-latest`, `windows-latest`, and `macos-latest`.
- Use `std::path::PathBuf` and `std::path::Path` for filesystem operations; never assume Unix path separators.
- Be cautious with `fs` metadata, file locking, and process spawning differences across OSes.
- If you add OS-specific code, gate it with `#[cfg(target_os = "...")]` and ensure the other paths are exercised in tests or at least compile.

---

## 3. Code Quality & Idioms

**3.1. Prefer Match Guards Over Nested `if` in Match Arms**
Clippy flag: `collapsible_match`
When a `match` arm contains only an `if` statement, collapse it into a match guard. This reduces nesting and aligns with Rust idioms.

**3.2. Use Human-Readable Duration Constructors**
Clippy flag: `duration_suboptimal_units`
Prefer `Duration::from_mins(5)` over `Duration::from_secs(300)`, and `Duration::from_hours(1)` over `Duration::from_secs(3600)`. Readability matters.

**3.3. Saturating Arithmetic for Score/Count Adjustments**
When mutating scores, token counts, or other bounded integers, use `saturating_add`, `saturating_sub`, and friends to prevent silent overflow/underflow bugs.

**3.4. Model-Specific Logic Must Be Documented**
Any code that branches on `ModelFamily` or model aliases must include a comment explaining *why* that model is treated differently (context window size, cost, behavior quirks). See existing examples in `detector.rs`.

---

## 4. Workspace & Crate Structure

**4.1. Add New Crates to the Workspace**
All crates live under `rust/crates/`. When adding a new crate:
- Register it in `rust/Cargo.toml` workspace members.
- Inherit workspace lints: add `lints.workspace = true` to the new crate's `Cargo.toml`.
- Inherit shared dependencies from `[workspace.dependencies]` where possible.

**4.2. Keep `Cargo.lock` Committed**
This is an application/workspace project, not a library. Commit `Cargo.lock` so CI and all developers resolve the same dependency graph.

---

## 5. Documentation & Knowledge Graph

**5.1. Update `AGENTS.md` When Behavior Changes**
If you modify build steps, test commands, model configurations, or environment variable requirements, update `AGENTS.md` in the same PR. It is the source of truth for agent behavior.

**5.2. Keep the Graphify Graph Current**
This project maintains a knowledge graph at `graphify-out/`.
- After any session that modifies code files, run:
  ```bash
  graphify update .
  ```
  (AST-only update, no API cost.)
- If you refactored architecture or moved major modules, regenerate or update the graph so architecture questions can be answered from `graphify-out/GRAPH_REPORT.md` rather than raw file searches.

---

## 6. CI Workflow Changes

**6.1. CI Changes Require Extra Scrutiny**
Any modification to `.github/workflows/` must be reviewed with the same rigor as a critical bug fix. Ask:
- Does this change affect all three OS matrix jobs?
- Does it alter caching behavior in a way that could poison the cache?
- If pinning a version (Rust, actions, tools), is the version documented in `rules.md` or a comment?

**6.2. Comment Version Pins**
Whenever a version is pinned in CI (Rust toolchain, GitHub Action, cargo tool), add a comment explaining:
```yaml
# Pinned to 1.95.0 for reproducible builds. Bump intentionally after local testing.
```

---

## 7. Dependency Management

**7.1. Prefer Workspace-Declared Dependencies**
Add shared dependencies to `[workspace.dependencies]` in `rust/Cargo.toml` and reference them in individual crates with `dep = { workspace = true }`. This prevents version drift across crates.

**7.2. Audit Before Major Bumps**
Before bumping a dependency across a semver-major boundary, verify:
- The changelog does not introduce breaking changes that affect our usage.
- CI still passes on all three platforms.

---

## 8. Testing

**8.1. Tests Must Pass on the Workspace Level**
Run `cargo test --workspace --exclude compat-harness` before pushing. The `compat-harness` is excluded because it depends on external upstream services that may not be available in CI.

**8.2. Unit Test New Logic**
When adding model-specific scoring, subagent spawning, or file detection logic, add unit tests. The `runtime` crate is complex enough that "it compiles" is not sufficient assurance.

---

## 9. Error Handling

**9.1. Use `thiserror` for Crate-Level Error Types**
The workspace depends on `thiserror`. Define structured error enums instead of stringly-typed errors. This enables callers to match on specific failure modes.

**9.2. Propagate Errors, Do Not Panic**
The workspace forbids `unsafe_code`. Avoid `unwrap()` and `expect()` in production paths unless the invariant is truly unbreakable (and document why). Prefer `?` and explicit `Result` handling.

---

## 10. Summary Checklist (Before Every Push)

- [ ] `cargo fmt --all -- --check` passes
- [ ] `cargo clippy --workspace --all-features -- -D warnings` passes
- [ ] `cargo build --workspace` passes
- [ ] `cargo test --workspace --exclude compat-harness` passes
- [ ] `AGENTS.md` updated if build/model/env behavior changed
- [ ] `graphify update .` run if code files were modified
- [ ] CI workflow changes include version comments and have been tested on a feature branch
