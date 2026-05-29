# Long-Term Improvement Plan — Xolotl Code

**Goal:** turn Xolotl from a *thin* harness that works great with Claude into a *thick* harness that is genuinely on par with Claude Code and OpenCode **for open-source models** (Kimi, DeepSeek, MiniMax, GLM, Qwen).

**Thesis.** Claude Code can be thin because Opus is strong. A harness *for open models* must be thick: it has to compensate for weaker tool-calling, sloppier edits, miscalibrated context accounting, and shakier self-correction. Xolotl already has Claude Code's *breadth* (compaction, caching, subagents, worktrees, MCP client, hooks, permissions, planning, memory). What it lacks is the **compensation layer**. This plan builds that layer, in priority order, behind a measurement harness that proves each change helps.

> Status: **proposed** · Created 2026-05-28 · This is a *living execution document*. The [Checkpoint Status Tracker](#tracker) is the single source of truth — update it as work lands.

---

## How to read this document

- **If you are an agent about to implement:** read [Agent Execution Protocol](#protocol) first, then the [Checkpoint Status Tracker](#tracker) to find the next unblocked checkpoint, then that checkpoint's task list. Do not read the whole document to start work — each checkpoint is self-contained.
- **If you are a human reviewing strategy:** read the thesis above, the [Phase dependency map](#depmap), and each phase's *Objective*.

### Table of contents
1. [Agent Execution Protocol](#protocol) — incl. **§1.7 [verified architecture & resolved blockers](#preflight) (read first)**
2. [Checkpoint Status Tracker](#tracker)
3. [Open Decisions Registry](#decisions)
4. [Conventions: branches, commits, gates](#conventions)
5. [Success metrics framework](#metrics)
6. [Phase dependency map](#depmap)
7. [Phase 0 — Failure-Mode Benchmark & Baseline](#p0)
8. [Phase 1 — Resilient Edit / Apply Layer](#p1)
9. [Phase 2 — Malformed Tool-Call Recovery](#p2)
10. [Phase 3 — Correctness Feedback Loop](#p3)
11. [Phase 4 — Context & Cost Calibration](#p4)
12. [Phase 5 — Surface & Ecosystem Parity](#p5)
13. [Phase 6 — Self-Calibrating Eval Flywheel](#p6)
14. [Cross-cutting concerns](#crosscut)
15. [Risk register](#risks)
16. [Appendix: search anchors & new modules](#appendix)

---

<a name="protocol"></a>
## 1. Agent Execution Protocol

This section is the operating manual. Follow it literally.

### 1.1 Picking work
1. Open the [Checkpoint Status Tracker](#tracker). Find the topmost checkpoint whose status is `TODO` and whose `Depends on` are all `MERGED`.
2. If two such checkpoints have **disjoint file ownership** (see the `Owns` column), they may be worked in parallel by different agents. Never start a checkpoint whose `Owns` files overlap an `IN-PROGRESS` checkpoint.
3. Set its status to `IN-PROGRESS` (edit this file, commit the tracker change first on your branch).

### 1.2 The per-task loop (test-first)
For each task `T-x.y` in the checkpoint:
1. **Locate by symbol, not line number.** Use Grep for the symbol named in the task (e.g. `fn execute_tool`, `cost_usd`, `tool_choice`). Line numbers in this doc are stale hints only.
2. **Write the test first.** Create/extend the named test with the listed cases. It must fail for the right reason before you implement.
3. **Implement the minimum** to pass — surgical, behind the trait/flag the task names. Do not refactor adjacent code.
4. **Run the task's `Verify` command.** It must pass locally.
5. **Commit atomically** with the task title as the message subject.

### 1.3 Two-tier acceptance — read this carefully
Every checkpoint has two kinds of acceptance. **Do not confuse them.**

- **CI Gate (BLOCKS MERGE).** Deterministic, offline, no API keys. This is the *Definition of Done* you must satisfy to merge. See [global DoD](#dod).
- **Benchmark Target (RECORDED, does not block merge by itself).** A live-model metric from the `bench` harness (Phase 0). You **record** it in the [metrics table](#metrics) and the PR body. The hard rule is: **a regression versus the previous tag blocks merge; failing to hit the aspirational target does not** — it instead tells you whether the phase needs another iteration (open a follow-up checkpoint).

This split is what makes the plan executable: you can always reach the CI gate deterministically; benchmark numbers drive iteration, with regressions as the real guardrail.

<a name="dod"></a>
### 1.4 Global Definition of Done (inherited by every checkpoint)
Rust-touching checkpoints:
```bash
cd rust
cargo fmt --all -- --check
cargo clippy --workspace --all-features --exclude compat-harness -- -D warnings
cargo build --workspace
cargo test --workspace --exclude compat-harness          # includes the new tests you wrote
```
Tauri-touching checkpoints (additionally):
```bash
cd tauri-app
npx tsc --noEmit
npm test
```
Plus, for **all** checkpoints:
- [ ] New behavior is behind a trait/strategy/flag; the Claude/Bedrock happy path is unchanged (control test green).
- [ ] No new heavy external dependency beyond those listed in the task (else → stop-and-ask).
- [ ] `/code-review` run on the diff; findings addressed.
- [ ] Tracker row updated; metrics row updated if a benchmark was run.
- [ ] Both CI workflows green on Linux/Windows/macOS.

### 1.5 Stop-and-ask triggers
Pause and ask the human (do **not** silently proceed) if a change would:
- alter Claude/Bedrock happy-path behavior or output;
- require a new heavy dependency, a paid API key/secret, or network access to merge;
- contradict a choice the human reserved in the [Open Decisions Registry](#decisions);
- require destructive git ops (force-push, history rewrite) or a `push` you weren't authorized to make;
- expand scope beyond the checkpoint's task list.
Otherwise: proceed using the registry defaults and note the choice in the PR body.

### 1.6 Push & PR mechanics
Pushing is outward-facing — only at an authorized checkpoint boundary. When authorized:
1. Branch per the [naming convention](#conventions).
2. Atomic commits (one per task), each ending with the trailer
   `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
3. Push → open PR with: checkpoint id, task checklist, CI-gate evidence, benchmark deltas (if any), and the open-decision choices made.
4. On green CI + review: merge to `main`, apply the phase tag if it's the phase's final checkpoint, set tracker row to `MERGED`.

<a name="preflight"></a>
### 1.7 Verified architecture & resolved blockers — READ THIS FIRST

Verified against the source on 2026-05-28. **Trust these over your priors;** re-verify only a specific line if it looks stale. The phase tasks below already incorporate every fix here.

**Verified seams (build on these — do not reinvent):**
- **The model is a trait.** The loop depends on `trait ApiClient { fn stream(&mut self, request: ApiRequest) -> Result<Vec<AssistantEvent>, RuntimeError>; }` in `runtime/src/conversation.rs`. HTTP impls live in the **CLI** (`AnthropicRuntimeClient` in `rusty-claude-cli/src/main.rs`, plus `openai.rs`/`bedrock.rs`), **not** in `runtime`.
- **Mocking already works.** `ScriptedApiClient` exists in `conversation.rs` tests and returns scripted `AssistantEvent`s by call count. Every "model emits bad call, then corrects on retry" test in this plan uses this exact pattern — no new test infra needed.
- **Headless entry point exists.** `ConversationRuntime::new(session, api_client, tool_executor, permission_policy, system_prompt)` drives the whole loop with injected deps. The bench harness (P0) and headless mode (P5) build on this — do **not** replicate CLI wiring.
- **Tool schemas are data.** `ToolSpec { name, description, input_schema: serde_json::Value }`; `mvp_tool_specs()` returns all. Usable for validation.
- **Iteration budget is one field.** `max_iterations` (default 32). New retry counters (D4) thread into the same loop scope — no architectural change.
- **OAI usage captures cache tokens correctly** (`openai.rs`); the Anthropic path does not yet (see B4).

**Resolved blockers (fixes are baked into the tasks):**

- **B1 — Recorder/shared-trait placement.** Because `tools → runtime` (one-way), any trait referenced by **both** the loop (`runtime`) and `edit_file`/`execute_tool` (`tools`) **must live in `runtime`** — never in `bench` or `tools`. The `BenchRecorder` trait lives in `runtime`; `tools` already imports `runtime`, so it sees it. `bench` depends on `runtime` and supplies the concrete recorder.
- **B2 — Worktree manager can't isolate non-git content.** `supervisor/worktree.rs::add()` shells out to `git worktree add` and requires an existing repo. The bench harness **rolls its own temp-dir isolation** (copy seed snapshot into a tempdir; `git init` only for tasks that need git). Do not reuse the supervisor worktree manager for P0.
- **B3 — Hooks are fire-and-forget.** `Hook::on_event(&self, event) -> ()` has **no return channel**; `PostTool`/`PostTurn` cannot inject anything back into the conversation. P3's verification feedback is therefore an **in-loop step in `conversation.rs`** that appends a synthetic tool-result/system message (same mechanism tool results already use), **not** a hook. (Adding a reusable injection channel by changing the `Hook` trait to return `Option<Injection>` is a separate, larger change — out of scope unless the human approves.)
- **B4 — Anthropic cache tokens are hardcoded to `0`.** In `AnthropicRuntimeClient` (`main.rs`, `MessageDelta` handler) `cache_creation_input_tokens`/`cache_read_input_tokens` are set to `0`, though `api::Usage` carries them and Anthropic returns them (cache fields arrive on `message_start`'s usage). **P4 fixes this first (T-4.1.0)** or Claude — the control — has zero cache accounting.
- **B5 — `runtime` cannot import `tools` (circular).** P2's repair/validate lives in `runtime` and must validate against the tool definitions **already carried in the `ApiRequest`** the runtime assembles (schemas travel as JSON to the model), not by importing `tools::mvp_tool_specs()`. If the request does not already expose schemas to `runtime`, pass them into `ConversationRuntime` as data (T-2.1.2 covers this).
- **B6 — Edit failure needs a structured signal.** Tools return `Result<String, String>`, so `runtime` can't distinguish "edit `NoMatch` → re-prompt with file content" from a generic error. P1.4.2 introduces a **structured/recognizable edit-failure signal** (a typed error or reserved machine-readable marker in the tool result), defined in `runtime` (per B1), so the loop detects it without parsing prose.
- **B7 — Real `ApiClient` impls live in a binary-only crate (discovered during CP 0.1; BLOCKS CP 0.2's live runs).** `AnthropicRuntimeClient`/`openai`/`bedrock` are defined in `rusty-claude-cli`, which has **only `src/main.rs` (no `lib.rs`)**, so the `bench` crate cannot import them. The CP 0.1 runner is therefore generic over `runtime::ApiClient` and is exercised offline with a scripted client. **Before CP 0.2 can run a live baseline, the provider HTTP clients must be reachable as a library** — options: (a) add a `lib.rs` to `rusty-claude-cli` re-exporting the client impls; (b) extract the HTTP clients into a new `providers` crate that both the CLI and `bench` depend on (cleaner, but larger); (c) move them into `runtime` (rejected — keeps `runtime` HTTP-free by design). **Decision reserved for the human** (it reshapes crate boundaries). Default if unreserved at 0.2 start: option (a), the least invasive.

---

<a name="tracker"></a>
## 2. Checkpoint Status Tracker  *(single source of truth)*

Statuses: `TODO` · `IN-PROGRESS` · `MERGED`. Keep this table current — it is how any agent resumes.

> **Current focus (updated 2026-05-28):** Checkpoint **0.1** (Bench harness skeleton) is **code-complete and DoD-green locally** on branch `feat/p0-bench-harness` — all four tasks (T-0.1.1–0.1.4) done and checked. Status stays `IN-PROGRESS` (not `MERGED`) because it has **not been pushed/merged** (no push authorized yet). Local DoD verified: `cargo fmt --all --check`, `cargo clippy --workspace --all-features --exclude compat-harness -- -D warnings`, `cargo build --workspace`, `cargo test --workspace --exclude compat-harness` (runtime 166 incl. +2 recorder tests, bench 7), and `cargo run -p bench -- --help` exit 0. Claude/Bedrock control path unchanged (recorder is `None` by default).
>
> **To resume / next steps:** (1) When authorized, push `feat/p0-bench-harness`, open the PR, and on green CI set this row to `MERGED` + tag `bench-baseline-v0` only after 0.2. (2) **Before CP 0.2** resolve blocker **B7** (real `ApiClient` impls are in the binary-only `rusty-claude-cli` crate — the bench runner can't reach them for live runs). (3) Then CP **0.2** (corpus + baseline) plus the parallel-safe 1.1 / 2.1 / 3.1 / 4.1. Per-task progress is tracked with `[ ]`/`[x]` checkboxes below.

| CP | Title | Status | Depends on | Branch | Owns (file scope) | Parallel-safe with |
|----|-------|--------|-----------|--------|-------------------|--------------------|
| 0.1 | Bench harness skeleton | IN-PROGRESS | — | `feat/p0-bench-harness` | `rust/crates/bench/**`, `runtime/src/bench.rs` (recorder trait, B1), recorder calls in `conversation.rs` + `tools/src/lib.rs` | — |
| 0.2 | Corpus + baseline | TODO | 0.1 | `feat/p0-corpus-baseline` | `rust/crates/bench/corpus/**`, `bench/results/**` | 4.x |
| 1.1 | Edit strategy scaffold (exact parity) | TODO | 0.1 | `feat/p1-edit-strategy-scaffold` | `rust/crates/tools/src/edit/**`, `tools/src/lib.rs` (edit only) | 4.x, 5.x |
| 1.2 | Whitespace + anchored strategies | TODO | 1.1 | `feat/p1-ws-anchored` | `rust/crates/tools/src/edit/**` | 4.x, 5.x |
| 1.3 | Fuzzy + confidence gate | TODO | 1.2 | `feat/p1-fuzzy` | `rust/crates/tools/src/edit/**` | 4.x, 5.x |
| 1.4 | Alt formats + re-prompt + hints | TODO | 1.3 | `feat/p1-formats-reprompt` | `tools/src/edit/**`, `runtime/src/conversation.rs`, `runtime/src/model_hints.rs` | 5.x |
| 2.1 | JSON repair + validation | TODO | 0.1 | `feat/p2-json-repair` | `rust/crates/runtime/src/toolcall/**`, `conversation.rs` | 4.x |
| 2.2 | Tool-call re-prompt protocol | TODO | 2.1 | `feat/p2-toolcall-reprompt` | `runtime/src/toolcall/**`, `conversation.rs` | 4.x |
| 2.3 | Text/XML fallback parser | TODO | 2.1 | `feat/p2-fallback-parser` | `runtime/src/toolcall/**` | 4.x |
| 2.4 | Per-model tool_choice | TODO | 2.1 | `feat/p2-tool-choice-hints` | `model_hints.rs`, `openai.rs`, `bedrock.rs` (tool_choice only) | — |
| 3.1 | Project command detection | TODO | 0.1 | `feat/p3-project-detect` | `rust/crates/runtime/src/verify/**` | 1.x, 2.x, 4.x |
| 3.2 | Post-edit verification (in-loop, B3) | TODO | 3.1, 1.1 | `feat/p3-verify-hook` | `runtime/src/verify/**`, `conversation.rs` (in-loop step) | — |
| 3.3 | LSP diagnostics (feature-flagged) | TODO | 3.2 | `feat/p3-lsp` | `rust/crates/lsp/**` | 4.x, 5.x |
| 4.1 | Pricing table + Anthropic cache fix (B4) | TODO | — | `feat/p4-pricing` | `runtime/src/usage.rs`, `rusty-claude-cli/src/main.rs` (usage plumbing) | 1.x, 2.x, 3.x |
| 4.2 | Per-model tokenization | TODO | — | `feat/p4-tokenizer` | `runtime/src/tokenizer.rs` | 1.x, 2.x, 3.x |
| 4.3 | Compaction calibration | TODO | 4.2 | `feat/p4-compaction` | `runtime/src/compact.rs` | 1.x, 2.x |
| 4.4 | graphify retrieval (optional) | TODO | — | `feat/p4-graphify-retrieval` | `runtime/src/` (new retrieval mod) | 1.x, 2.x |
| 5.1 | Headless NDJSON protocol | TODO | — | `feat/p5-headless` | `rusty-claude-cli/src/` (new), `runtime` events (read-only) | 1.x, 4.x |
| 5.2 | MCP server | TODO | 5.1 | `feat/p5-mcp-server` | `rust/crates/mcp-server/**` | 1.x, 4.x |
| 5.3 | Bash sandboxing | TODO | — | `feat/p5-sandbox` | `runtime/src/permissions.rs`, bash tool | 1.x, 4.x |
| 5.4 | ACP adapter (optional) | TODO | 5.1 | `feat/p5-acp` | `rust/crates/acp/**` (new) | 1.x, 4.x |
| 6.1 | Eval-lab metric capture | TODO | 0.1, 1.1, 2.1 | `feat/p6-eval-metrics` | `tauri-app/src-tauri/**`, `tauri-app/src/**` | — |
| 6.2 | Reliability profiles | TODO | 6.1 | `feat/p6-profiles` | profiles writer (runtime or tauri) | — |
| 6.3 | Hint tuning (propose-only) | TODO | 6.2 | `feat/p6-hint-tuning` | tuning module, `model_hints.rs` (read) | — |
| 6.4 | Regression dashboard | TODO | 6.1 | `feat/p6-dashboard` | `tauri-app/src/**` | — |

**Tags applied at phase close:** `bench-baseline-v0` (0.2), `edit-layer-v1` (1.4), `toolcall-recovery-v1` (2.4), `feedback-loop-v1` (3.3), `calibration-v1` (4.4), `parity-v1` (5.x last), `flywheel-v1` (6.4).

---

<a name="decisions"></a>
## 3. Open Decisions Registry

Each has a **default** so an agent never stalls. Proceed with the default and note it in the PR; only stop-and-ask if the human reserved the decision (`Reserved: yes`).

| ID | Decision | Default (use this) | Reserved? |
|----|----------|--------------------|-----------|
| D1 | Fuzzy edit match algorithm | Normalized-whitespace line similarity (difflib-style ratio); pure Rust, no new dep | no |
| D2 | Fuzzy apply confidence threshold | 0.85; below → reject + re-prompt (never silent apply) | no |
| D3 | Default edit format per model | Keep `old_string/new_string` for all models initially; search/replace & udiff are opt-in via hints until P6 data justifies a switch | no |
| D4 | `max_edit_retries` / `max_toolcall_retries` | 2 each; counts toward iteration budget | no |
| D5 | JSON-repair library | Hand-rolled conservative repair in `toolcall/repair.rs` (fences, trailing commas, balanced-close); no `json5`/external dep unless a test proves it necessary | no |
| D6 | LSP client implementation | Minimal JSON-RPC stdio client mirroring `rusty-claude-cli/src/mcp.rs`; **not** `tower-lsp`. Feature-flagged `--features lsp` | yes |
| D7 | Language servers launched (P3.3) | `rust-analyzer`, `typescript-language-server`, `pyright`; auto-detect, skip if binary absent | no |
| D8 | Default verify commands (P3) | Rust: `cargo check`; Node/TS: `npx tsc --noEmit`; Python: `pyright` or `python -m pytest -q`. Overridable in `.claude/settings.json` | no |
| D9 | Bench corpus size (P0) | 30 tasks across the 6 categories listed in P0 | no |
| D10 | Sandbox mechanism (P5.3) | Working-dir confinement + destructive-pattern deny-list in `permissions.rs`; OS-level (`bubblewrap`) Linux-only and optional | yes |
| D11 | Models in benchmark sweep | `kimi-coding, deepseek, minimax, glm, qwen` + `sonnet` as control | no |

---

<a name="conventions"></a>
## 4. Conventions: branches, commits, gates

**Repo facts.** Main branch `main`; remote `origin` → `github.com/cesarfrancots/Claw-code2`. Two independent Rust trees: the `rust/` Cargo workspace (engine + CLI) and `tauri-app/src-tauri/` (desktop backend), each with its own CI (`.github/workflows/rust.yml`, `tauri-app.yml`). Rust CI: Linux+Windows+macOS, Rust **1.95.0**, runs `fmt`, `clippy -D warnings` (pedantic), build, tests **excluding `compat-harness`**. `cargo test` for the Tauri backend can't run on Windows (WebView2 DLL loader) — runs on Linux/macOS CI. `tauri-app/src/bindings.ts` is auto-generated by tauri-specta on `tauri dev` — never hand-edit; regenerate after changing IPC commands.

**Branches:** `feat|fix|chore/p<phase>-<slug>`, one branch per checkpoint.
**Commits:** imperative, capitalized (match existing history, e.g. `Add fuzzy edit fallback strategy`); atomic; Claude trailer required (§1.6).
**Gates:** the [global DoD](#dod) is the merge gate. Pushing only at authorized checkpoints.

---

<a name="metrics"></a>
## 5. Success metrics framework

Produced by the Phase 0 `bench` harness; re-run at checkpoints that carry a benchmark target. **Baselines are filled by Phase 0 — do not invent numbers.** Reported **per model** (D11). These are *Benchmark Targets* per §1.3, not CI gates.

| Metric | Definition | Baseline | Target | Phase |
|---|---|---|---|---|
| Edit-apply success rate | edits applied w/o error / total edit calls | TBD | ≥ 92% (open models) | P1 |
| Tool-call parse rate | usable on first parse / total | TBD | ≥ 95% | P2 |
| Tool-call recovery rate | malformed salvaged / total malformed | TBD | ≥ 80% | P2 |
| Task completion rate | tasks passing acceptance / total | TBD | +25pp vs baseline | P1–P3 |
| Post-edit error catch rate | broken-build edits caught+fixed in-loop / total breakages | 0% (no loop today) | ≥ 70% | P3 |
| Mean turns to completion | assistant turns per completed task | TBD | ≤ baseline | all |
| Token-count error | \|est − reported\| / reported | TBD | ≤ 5% | P4 |
| Cost-accounting error | \|computed − provider price\| / price | large (OS→Opus rates) | ≤ 2% | P4 |

> Cost note (B4): today Anthropic cache tokens are hardcoded to `0` in the runtime client, so Claude's cache-cost is currently *understated to zero*, not just OS models. T-4.1.0 fixes this before any cost target is meaningful.

---

<a name="depmap"></a>
## 6. Phase dependency map

```
P0 Benchmark ──┬───────────────────────────────────────────────┐ (gates everything; regression harness)
               ▼                                                 ▼
P1 Resilient Edit ──► P3 Verify/Diagnostics ──► P6 Eval Flywheel
               │            ▲                         ▲
P2 Tool-call Recovery ──────┘                         │
                                                      │
P4 Context & Cost Calibration ────────────────────────┤  (independent; parallel-safe with P1–P3)
P5 Surface & Ecosystem Parity ────────────────────────┘  (independent; schedule last or parallel)
```
**Critical path:** P0 → P1 → P2 → P3 → P6. P4, P5 independent. See the tracker's `Parallel-safe with` column for concrete concurrency.

---

<a name="p0"></a>
## Phase 0 — Failure-Mode Benchmark & Baseline

**Objective.** A reproducible suite that runs fixed coding tasks against each model through the real runtime loop and reports the §5 metrics per model. Replaces guesses with data; becomes the regression harness for all later phases.

**Context to load first:** `rust/Cargo.toml` (workspace members), `rust/crates/runtime/src/conversation.rs` (`trait ApiClient`, `ConversationRuntime::new`, `ScriptedApiClient` test, tool extraction), `rust/crates/tools/src/lib.rs` (`fn execute_tool`, `fn edit_file`, `ToolSpec`). **Isolation:** do NOT use `supervisor/worktree.rs` (requires a git repo — B2); the runner rolls its own temp-dir isolation.

### Checkpoint 0.1 — Bench harness skeleton
**Owns:** `rust/crates/bench/**`, the `BenchRecorder` trait in `runtime/src/bench.rs` (B1), plus minimal recorder *call sites* in `conversation.rs` and `tools/src/lib.rs`.

Tasks:
- [x] **T-0.1.1 — Add `bench` crate.** Files: `rust/Cargo.toml` (add member), `rust/crates/bench/Cargo.toml`, `src/lib.rs`. Test first: `cargo build -p bench` succeeds (skeleton). Verify: workspace builds.
- [x] **T-0.1.2 — `BenchRecorder` trait + instrumentation.** Per **B1**, define the `BenchRecorder` trait in **`runtime`** (`runtime/src/bench.rs`) — NOT in `bench` (that would be circular: `tools → runtime`). Thread an `Option<Arc<dyn BenchRecorder>>` through the loop and tool execution; record parse outcome at the tool-call extraction site in `conversation.rs` and edit apply outcome+reason in `tools::edit_file`. The concrete counting recorder lives in `bench` (which depends on `runtime`). Production path unaffected when `None`. Test first: counter test in `runtime` on synthetic outcomes. Verify: `cargo test -p runtime -p bench`.
- [x] **T-0.1.3 — Runner.** Files: `bench/src/runner.rs` — per `(task × model)` run in an **isolated temp dir** (own logic per **B2**; copy seed snapshot, `git init` only if the task needs git), driving `ConversationRuntime::new(...)` with the real `ApiClient` for live runs and a `ScriptedApiClient` for the harness's own unit test. Capture metrics. Test first: runner executes one trivial fixture end-to-end with a scripted model (no network). Verify: `cargo test -p bench`.
- [x] **T-0.1.4 — Reporter.** Files: `bench/src/report.rs` — write `results/<ts>.json` + `.md` (per-model §5 table). Test first: reporter renders a fixed result set to expected MD. Verify: `cargo test -p bench`.

**CI Gate / DoD:** global DoD; `cargo run -p bench -- --help` works; `bench` unit tests green. (Live runs are *not* a CI gate — no keys in CI.)
**Benchmark Target:** none (this CP builds the tool).

### Checkpoint 0.2 — Corpus + baseline
**Owns:** `rust/crates/bench/corpus/**`, `bench/results/**`. Depends on 0.1.

Tasks:
- [ ] **T-0.2.1 — Corpus (D9: 30 tasks).** Categories: single-file edit, multi-file edit, create-from-scratch, bugfix-with-failing-test, refactor-preserving-API, navigate-large-repo-then-change-one-thing. Each task dir = `prompt.md` + seed repo snapshot + `verify.sh`/expected-diff acceptance. Test first: corpus loader validates all task manifests. Verify: `cargo test -p bench` (loader test).
- [ ] **T-0.2.2 — Run baseline & commit.** Run `cargo run -p bench -- --models <D11>`; commit `results/baseline-<date>.{json,md}`; fill §5 baseline column in this file. (Requires keys — run locally, not in CI.) Verify: results files exist; metrics table updated.

**CI Gate / DoD:** global DoD; corpus loader test green.
**Benchmark Target:** establishes baselines (recorded).
**Tag on merge:** `bench-baseline-v0`.

**Risks:** API cost → token caps per run; flaky tasks flagged separately. Instrumentation behind trait → clean revert.

---

<a name="p1"></a>
## Phase 1 — Resilient Edit / Apply Layer

**Objective.** Make edits succeed when intent is unambiguous despite imperfect quoting; when ambiguous, **re-prompt with real file content** instead of a dead error. Today `edit_file` is exact-string `.replace()` with no fallback (locate: `fn edit_file` in `rust/crates/tools/src/lib.rs`).

**Context to load first:** `tools/src/lib.rs` (find `fn edit_file`, the `replace`/`replacen` apply site), the tool result type, and `conversation.rs` tool-result handling.

### Checkpoint 1.1 — Edit strategy scaffold (exact parity)
**Owns:** `rust/crates/tools/src/edit/**`, edit-related code in `tools/src/lib.rs`.
- [ ] **T-1.1.1 — Define `EditStrategy` trait + `apply_edit()` orchestrator.** Files: `tools/src/edit/mod.rs`. Trait contract: `fn try_apply(&self, file: &str, old: &str, new: &str, replace_all: bool) -> EditOutcome` where `EditOutcome ∈ {Applied(String), NoMatch, Ambiguous(n)}`. Test first: orchestrator returns first `Applied`. Verify: `cargo test -p tools`.
- [ ] **T-1.1.2 — `exact.rs` (move current logic verbatim).** Behavior byte-identical to today. Test first: existing edit tests pass unchanged. Verify: `cargo test -p tools`.
- [ ] **T-1.1.3 — Wire `edit_file` → `apply_edit()` with only `[exact]` in the ladder.** Test first: full existing edit suite green. Verify: `cargo test -p tools`.

**CI Gate / DoD:** global DoD; existing edit tests pass with zero behavior change (control).
**Benchmark Target:** none (parity CP); confirm edit-apply rate flat vs baseline.

### Checkpoint 1.2 — Whitespace + anchored strategies
**Owns:** `tools/src/edit/**`. Depends on 1.1.
- [ ] **T-1.2.1 — `whitespace.rs`.** Match ignoring leading/trailing whitespace & indentation width; re-indent replacement to matched block. Test first: golden cases — indentation change, trailing space, CRLF/LF. Verify: `cargo test -p tools`.
- [ ] **T-1.2.2 — `anchored.rs`.** Match on unique first/last lines of `old`, tolerate middle drift; reject if anchors non-unique. Test first: golden anchored cases + non-unique-anchor rejection. Verify: `cargo test -p tools`.
- [ ] **T-1.2.3 — Insert into ladder after `exact`.** Test first: ladder order test (`exact` wins when it matches). Verify: `cargo test -p tools`.

**CI Gate / DoD:** global DoD; golden suite green; **ambiguity never silently applies**.
**Benchmark Target:** edit-apply rate ↑ vs baseline (record). Regression vs `bench-baseline-v0` blocks merge.

### Checkpoint 1.3 — Fuzzy + confidence gate
**Owns:** `tools/src/edit/**`. Depends on 1.2.
- [ ] **T-1.3.1 — `fuzzy.rs` (D1/D2).** Similarity-ranked match; apply only if best score ≥ 0.85 **and** unique; else `Ambiguous`/`NoMatch`. Test first: below-threshold rejected; two-near-matches rejected; clear match applied. Verify: `cargo test -p tools`.
- [ ] **T-1.3.2 — Append to ladder (last resort).** Test first: ladder falls through exact→ws→anchored→fuzzy. Verify: `cargo test -p tools`.

**CI Gate / DoD:** global DoD; zero incorrect silent applies in the ambiguity golden set (merge blocker).
**Benchmark Target:** edit-apply rate ↑ (record).

### Checkpoint 1.4 — Alt formats + re-prompt loop + hints
**Owns:** `tools/src/edit/**`, `runtime/src/conversation.rs`, `runtime/src/model_hints.rs`.
- [ ] **T-1.4.1 — `formats/search_replace.rs` + `formats/udiff.rs`.** Parse alt payloads → normalized edit ops. Test first: valid + malformed payloads. Verify: `cargo test -p tools`.
- [ ] **T-1.4.2 — Structured edit-failure signal + re-prompt loop.** Per **B6**: the edit tool can only return `Result<String,String>` today, so first introduce a recognizable failure signal the loop can detect without parsing prose — a typed `EditFailure { kind: NoMatch|Ambiguous, region: String }` surfaced through the tool result (e.g. a reserved machine-readable marker the `runtime` side parses), defined in `runtime` (B1). Then in `conversation.rs`, on that signal, append a synthetic tool result containing failure reason + current exact region (±N lines) + "re-emit using <format>". Cap `max_edit_retries` (D4=2), threaded alongside `max_iterations`. Test first (with `ScriptedApiClient`): model corrects on retry; cap terminates. Verify: `cargo test -p runtime`.
- [ ] **T-1.4.3 — `model_hints` fields.** Add `preferred_edit_format`, `enabled_edit_strategies`; defaults per D3. Test first: hint plumbed to orchestrator. Verify: `cargo test -p runtime`.

**CI Gate / DoD:** global DoD; control (Claude exact path) unchanged.
**Benchmark Target:** edit-apply ≥ 92% (open models); task completion ↑. Record; regression blocks.
**Tag on merge:** `edit-layer-v1`. Update §5 table + README/CLAUDE.md.

**Risks:** silent wrong edits → hard thresholds + ambiguity tests gate merge; each strategy independently revertable; ladder degrades to exact-only if later strategies disabled via hints.

---

<a name="p2"></a>
## Phase 2 — Malformed Tool-Call Recovery

**Objective.** Salvage malformed tool calls; when unsalvageable, re-prompt with the precise validation error; parse tool intent from prose for models with poor native function-calling. Today: `serde_json::from_value::<T>()` fails → model debugs blind (locate: `fn execute_tool` in `tools/src/lib.rs`; OAI arg reassembly: find `pending_tools` in `rusty-claude-cli/src/openai.rs`).

**Context to load first:** `conversation.rs` tool extraction/exec; `openai.rs` streaming tool-call reassembly; how tool definitions enter the `ApiRequest`. **Constraint (B5):** this module lives in `runtime`, which **cannot** import `tools` (circular). Validate against the tool schemas already carried in the `ApiRequest` — not `tools::mvp_tool_specs()`.

### Checkpoint 2.1 — JSON repair + validation
**Owns:** `rust/crates/runtime/src/toolcall/**`, `conversation.rs` (extraction site).
- [ ] **T-2.1.1 — `toolcall/repair.rs` (D5).** Strip ``` fences, fix trailing commas, balance/close unterminated strings/braces where unambiguous, handle truncation. **Never fabricate values.** Test first: fenced/trailing-comma/unterminated/truncated → expected; irreparable → `None` (not a guess). Verify: `cargo test -p runtime`.
- [ ] **T-2.1.2 — `toolcall/validate.rs`.** Validate args vs the tool's JSON schema **as carried in the `ApiRequest`** (B5 — do not import `tools`); if the request doesn't already expose schemas to `runtime`, pass them into `ConversationRuntime` as data. Emit a model-targeted error naming the bad field. Test first: wrong type / missing field → correct message. Verify: `cargo test -p runtime`.
- [ ] **T-2.1.3 — Wire before deserialize** in extraction. Test first: malformed-but-repairable call now executes. Verify: `cargo test -p runtime`.

**CI Gate / DoD:** global DoD; repair never fabricates values (audited test, merge blocker).
**Benchmark Target:** parse rate ↑ (record).

### Checkpoint 2.2 — Re-prompt protocol
**Owns:** `runtime/src/toolcall/**`, `conversation.rs`. Depends on 2.1.
- [ ] **T-2.2.1 — Re-prompt on parse/validation failure.** Tool result carries exact error + compact schema + "re-emit only the corrected call". Cap `max_toolcall_retries` (D4=2). Test first: mocked malformed→corrected completes; cap terminates. Verify: `cargo test -p runtime`.

**CI Gate / DoD:** global DoD; control unchanged.
**Benchmark Target:** recovery rate ↑ (record).

### Checkpoint 2.3 — Text/XML fallback parser
**Owns:** `runtime/src/toolcall/**`. Depends on 2.1.
- [ ] **T-2.3.1 — `toolcall/fallback_parser.rs`.** Extract tool intent from assistant *text*: fenced ```tool blocks, `<tool_use>`-style tags, "I'll call X with {…}". Normalize to internal `ToolUse`. Test first: real-transcript fixtures → normalized call; negative (no intent) → none. Verify: `cargo test -p runtime`.
- [ ] **T-2.3.2 — Invoke when no native tool call present** (gated per model via hints). Test first: model-without-native-calls path. Verify: `cargo test -p runtime`.

**CI Gate / DoD:** global DoD; disabled-by-default for models that have native calls (no Claude impact).
**Benchmark Target:** parse/recovery rate ↑ for affected models (record).

### Checkpoint 2.4 — Per-model tool_choice
**Owns:** `model_hints.rs`, `openai.rs` & `bedrock.rs` (tool_choice expressions only). Depends on 2.1.
- [ ] **T-2.4.1 — `tool_choice_mode` hint (`auto|required|single`).** Replace hardcoded `"auto"` (locate `tool_choice` in `openai.rs` and `bedrock.rs`) with hint-derived value; default `auto`. Test first: hint → correct wire value per provider. Verify: `cargo test`.

**CI Gate / DoD:** global DoD; default `auto` keeps Claude unchanged.
**Benchmark Target:** completion/turns ↑ for tuned models (record).
**Tag on merge:** `toolcall-recovery-v1`. Update §5 + docs.

**Risks:** over-eager repair → "never fabricate" rule + negative tests gate merge; fallback parser disabled per model via hints.

---

<a name="p3"></a>
## Phase 3 — Correctness Feedback Loop (Verify + Diagnostics)

**Objective.** After edits, auto-verify (build/test/typecheck), feed failures back into the loop, and (stretch) surface LSP diagnostics. Today: zero compiler/LSP feedback (the only "diagnostic" in-tree is SDD scoring). **Implementation note (B3):** hooks are fire-and-forget (`on_event -> ()`, no return channel), so verification feedback is an **in-loop step in `conversation.rs`** that appends a synthetic tool-result/system message — NOT a hook. Hooks may still fire for *observability/logging* of verification, but cannot carry the result back.

**Context to load first:** `conversation.rs` (turn boundary + how tool results are appended — the synthetic message uses the same path), `runtime/src/hooks.rs` (observe-only, confirm B3), CLI `# TODO: Add build/test commands` stubs (`rusty-claude-cli/src/main.rs`).

### Checkpoint 3.1 — Project command detection
**Owns:** `rust/crates/runtime/src/verify/**`.
- [ ] **T-3.1.1 — `verify/detect.rs` (D8).** Detect Cargo/npm/pyproject → resolve build/test/typecheck commands; allow `.claude/settings.json` override. Resolves the CLI TODO stubs. Test first: fixtures Rust/Node/Python → expected commands; override respected. Verify: `cargo test -p runtime`.

**CI Gate / DoD:** global DoD.

### Checkpoint 3.2 — Post-edit verification (in-loop, B3)
**Owns:** `runtime/src/verify/**`, `conversation.rs` (in-loop step). Depends on 3.1, 1.1. *(Not `hooks.rs` — hooks can't inject; see B3.)*
- [ ] **T-3.2.1 — Error parsers.** `verify/parse.rs`: cargo / tsc / pytest output → `{file, line, msg}`. Test first: recorded outputs → normalized diagnostics. Verify: `cargo test -p runtime`.
- [ ] **T-3.2.2 — In-loop post-edit verification step (B3).** After edit tool execution (debounced), run the detected check from inside the loop in `conversation.rs`; on failure, append a synthetic tool-result/system message into the conversation for the next turn (same append path as normal tool results — NOT via a hook, which can't inject). Guardrails: opt-in per project, timeout, only-on-edit, max-frequency. Test first (with `ScriptedApiClient`): broken edit → check fails → failure surfaced to next turn; disabled → no behavior change. Verify: `cargo test -p runtime`.

**CI Gate / DoD:** global DoD; fully disable-able with zero behavior change (control).
**Benchmark Target:** post-edit error catch rate ≥ 70%; bugfix-subset completion ↑ (record).

### Checkpoint 3.3 — LSP diagnostics (feature-flagged)
**Owns:** `rust/crates/lsp/**`. Depends on 3.2. **D6 reserved — confirm crate choice before starting.**
- [ ] **T-3.3.1 — Minimal LSP client.** New `lsp` crate, JSON-RPC stdio mirroring `mcp.rs`; launch server per filetype (D7), subscribe `publishDiagnostics`. Behind `--features lsp`. Test first: fixture/recorded diagnostics → digest. Verify: `cargo test -p lsp --features lsp`.
- [ ] **T-3.3.2 — `get_diagnostics` tool + post-edit digest into context.** Test first: digest formatting. Verify: `cargo test`.

**CI Gate / DoD:** global DoD; dedicated CI job builds `--features lsp`; default build unaffected.
**Benchmark Target:** completion ↑ on compile-heavy tasks (record).
**Tag on merge:** `feedback-loop-v1`.

**Risks:** latency/noise → debounce+budget+opt-in; LSP complexity → isolated feature-flagged crate; 3A (3.1–3.2) delivers most value without 3.3.

---

<a name="p4"></a>
## Phase 4 — Context & Cost Calibration

**Objective.** Accurate per-model token counts, per-provider cost, and compaction tied to the real context window. Independent of P1–P3 (parallel-safe). Fixes distortions in P0's own numbers and the leaderboard.

**Verified problems:** cl100k tokenizer for all models (locate `estimate_tokens` in `runtime/src/tokenizer.rs`); OS models priced at Opus rates (locate `fn cost_usd` in `runtime/src/usage.rs`); confirm compaction reads model context window (locate auto-compact in `compact.rs`/`conversation.rs`).

### Checkpoint 4.1 — Per-provider pricing + Anthropic cache-usage fix
**Owns:** `runtime/src/usage.rs`, `rusty-claude-cli/src/main.rs` (Anthropic usage plumbing only).
- [ ] **T-4.1.0 — Fix Anthropic cache-token plumbing (B4) — DO THIS FIRST.** In `AnthropicRuntimeClient` (`main.rs`), the `MessageDelta` handler hardcodes `cache_creation_input_tokens`/`cache_read_input_tokens` to `0`. Read them from the stream — Anthropic returns cache fields in the `message_start` usage (and output in `message_delta`); accumulate both into the emitted `TokenUsage`. Without this, Claude (the control) reports zero cache usage and cost. Test first: a `ScriptedApiClient`/SSE fixture carrying cache tokens → emitted `TokenUsage` preserves them. Verify: `cargo test`.
- [ ] **T-4.1.1 — Replace `contains()` ladder with a data table** keyed by model id (input/output/cache-write/cache-read + "last verified" date) for every README-matrix provider. Unknown model → explicit "unknown" (not Opus). Test first: per-model lookup; unknown → unknown. Verify: `cargo test -p runtime`.

**CI Gate / DoD:** global DoD. *(T-4.1.0 fixes Claude cache accounting; T-4.1.1 fixes the leaderboard cost axis.)*
**Benchmark Target:** cost error ≤ 2% vs a real provider usage page (record manually).

### Checkpoint 4.2 — Per-model tokenization
**Owns:** `runtime/src/tokenizer.rs`.
- [ ] **T-4.2.1 — Encoder selection by model family; provider-reported usage as truth for accounting** (estimates only for pre-send budgeting; OAI usage already parsed — locate usage fields in `openai.rs`). Test first: family→encoder; reported usage overrides estimate. Verify: `cargo test -p runtime`.

**CI Gate / DoD:** global DoD.
**Benchmark Target:** token-count error ≤ 5% (record).

### Checkpoint 4.3 — Compaction calibration
**Owns:** `runtime/src/compact.rs`. Depends on 4.2.
- [ ] **T-4.3.1 — Threshold from `model_hints` context window** (not a global 120K). Test first: synthetic 900K-token session on a 1M-context model does NOT compact at 120K. Verify: `cargo test -p runtime`.

**CI Gate / DoD:** global DoD.

### Checkpoint 4.4 — graphify retrieval (optional)
**Owns:** new retrieval module in `runtime/src/`.
- [ ] **T-4.4.1 — Optional read-only retrieval** consulting `graphify-out/` (god nodes/community map) to target reads on large repos; opt-in flag. Test first: retrieval returns ranked files for a fixture graph; absent graph → no-op. Verify: `cargo test -p runtime`.

**CI Gate / DoD:** global DoD; opt-in, no default behavior change.
**Tag on merge:** `calibration-v1`.

**Risks:** stale pricing → "last verified" dates (candidate for a scheduled review). Each task isolated/revertable.

---

<a name="p5"></a>
## Phase 5 — Surface & Ecosystem Parity

**Objective.** Make the harness embeddable (headless protocol + MCP server + optional ACP) and safer to run autonomously. Independent; parallel-safe with P1/P4.

**Verified problems:** MCP client-only (locate JSON-RPC in `rusty-claude-cli/src/mcp.rs`); no headless agent protocol; bash has a disable-sandbox flag but no real sandbox.

### Checkpoint 5.1 — Headless NDJSON protocol
**Owns:** new module in `rusty-claude-cli/src/`; reads runtime event types (read-only).
- [ ] **T-5.1.1 — `xolotl agent --protocol ndjson`.** Stable NDJSON event stream over stdio reusing runtime events (TextDelta/ReasoningDelta/ToolUse/ToolResult). Document schema in `docs/headless-protocol.md`. Test first: golden event-stream for a scripted (mocked) session. Verify: `cargo test`.

**CI Gate / DoD:** global DoD.

### Checkpoint 5.2 — MCP server
**Owns:** `rust/crates/mcp-server/**`. Depends on 5.1.
- [ ] **T-5.2.1 — Expose selected tools + agent-spawn over MCP stdio**, mirroring the client. Test first: `initialize` + `tools/list` + one tool round-trip vs a test client. Verify: `cargo test -p mcp-server`.

**CI Gate / DoD:** global DoD.

### Checkpoint 5.3 — Bash sandboxing
**Owns:** `runtime/src/permissions.rs`, bash tool. **D10 reserved — confirm mechanism.**
- [ ] **T-5.3.1 — Policy replacing the boolean flag:** working-dir confinement + destructive-pattern deny-list (extend `permissions.rs`); optional OS-level (`bubblewrap`, Linux). Deny-by-default for destructive patterns when autonomous. Test first: destructive corpus blocked under autonomous policy; allowed under explicit approval. Verify: `cargo test -p runtime`.

**CI Gate / DoD:** global DoD.

### Checkpoint 5.4 — ACP adapter (optional)
**Owns:** new `rust/crates/acp/**`. Depends on 5.1. Feature-flagged.
- [ ] **T-5.4.1 — Map headless protocol → ACP** so editors can drive Xolotl. Test first: ACP handshake + one task via a scripted client. Verify: `cargo test -p acp --features acp`.

**CI Gate / DoD:** global DoD; feature-flagged.
**Tag on merge (last 5.x):** `parity-v1`.

**Risks:** ACP scope → optional/flagged/last; 5.1–5.3 deliver embeddability+safety without it.

---

<a name="p6"></a>
## Phase 6 — Self-Calibrating Eval Flywheel

**Objective.** Close the loop: eval/bench runs → per-model reliability profile → **proposed** `model_hints` → regression dashboard. The moat. Today `model_hints.rs` is hand-authored constants.

**Prereqs:** P0 (metrics) + P1/P2/P3 (the layers whose effectiveness varies by model). **Tauri reminder:** edit IPC commands first, run `tauri dev` once so `bindings.ts` regenerates; never hand-edit bindings.

### Checkpoint 6.1 — Eval-lab metric capture
**Owns:** `tauri-app/src-tauri/**`, `tauri-app/src/**`. Depends on 0.1, 1.1, 2.1.
- [ ] **T-6.1.1 — Record §5 reliability metrics during normal eval runs**, persist into `~/.xolotl-code/evals/<id>.json`. Test first: vitest on new UI bits; Rust unit on the recorder; `npx tsc --noEmit` clean (bindings regenerated). Verify: `npm test && npx tsc --noEmit`.

**CI Gate / DoD:** both CI workflows green; bindings regenerated (not hand-edited).

### Checkpoint 6.2 — Reliability profiles
**Owns:** profiles writer. Depends on 6.1.
- [ ] **T-6.2.1 — Aggregate runs → `~/.xolotl-code/profiles/<model>.json`** (edit-apply by format, recovery rate, optimal read threshold, observed effective context). Test first: aggregation from synthetic records. Verify: `cargo test`/`npm test`.

### Checkpoint 6.3 — Hint tuning (propose-only)
**Owns:** tuning module; reads `model_hints.rs`. Depends on 6.2.
- [ ] **T-6.3.1 — profile → proposed hint overrides → reviewable file.** **No silent auto-merge into shipped defaults** (human ratifies). Test first: determinism (same profile → same proposal). Verify: `cargo test`.

### Checkpoint 6.4 — Regression dashboard
**Owns:** `tauri-app/src/**`. Depends on 6.1.
- [ ] **T-6.4.1 — Eval-lab view of per-model metrics over time/versions.** Test first: vitest surfaces an injected regression. Verify: `npm test && npx tsc --noEmit`.

**CI Gate / DoD:** both workflows green.
**Benchmark Target:** ratified hints improve that model's completion vs its pre-tuning baseline (re-run P0; record on a **held-out** task set never used for tuning).
**Tag on merge:** `flywheel-v1`. Refresh full §5 table — milestone closeout.

**Risks:** overfitting → held-out set, report both; auto-tuning instability → propose-only, human-ratified.

---

<a name="crosscut"></a>
## 14. Cross-cutting concerns
- **No Claude regression, ever.** Claude/Bedrock is the control; every shared-path checkpoint re-runs control metrics; a regression blocks merge.
- **Feature isolation.** New layers behind traits/strategies/flags; disable-able per model via `model_hints`; isolated-PR revertable.
- **Windows path gotcha.** Local Windows builds need the gitignored `rust/.cargo/config.toml` target-dir redirect (spaces in repo path break mingw `dlltool`). Never commit it.
- **bindings.ts.** Tauri IPC change → edit Rust command, `tauri dev` once, never hand-edit.
- **Docs.** Each phase's final checkpoint updates `README.md` (capabilities) and `CLAUDE.md` (new gotchas).
- **GSD mirror (optional).** Can be mirrored into `.planning/` as a `v2` milestone; this file stays source of truth.

---

<a name="risks"></a>
## 15. Risk register

| # | Risk | L | I | Mitigation | Phase |
|---|------|---|---|-----------|-------|
| R1 | Fuzzy edits apply wrong changes silently | M | H | Hard confidence threshold (D2); ambiguity-rejection tests block merge | P1 |
| R2 | JSON repair fabricates argument values | M | H | "Never guess values" rule + negative tests block merge | P2 |
| R3 | Verification loop too slow/noisy | M | M | Debounce, budget, opt-in, only-on-edit | P3 |
| R4 | LSP integration stalls roadmap | M | M | Feature-flagged isolated crate; 3.1–3.2 deliver value without it | P3 |
| R5 | Pricing data stale | H | L | "Last verified" dates; scheduled review | P4 |
| R6 | P0 reorders priorities after measurement | M | M | By design — re-rank P1–P3 from data | P0 |
| R7 | Claude path regresses under new fallbacks | L | H | Control metrics block merge; happy path tried first | all |
| R8 | Hints overfit benchmark corpus | M | M | Held-out task set; report both | P6 |
| R9 | API cost of repeated benchmarks | M | L | Token caps; full suite only at checkpoints | P0/P6 |
| R10 | ACP scope balloons | M | L | Optional, flagged, last | P5 |

---

<a name="appendix"></a>
## 16. Appendix

### Search anchors (locate by symbol — line numbers drift)
| Need | Grep for | File |
|---|---|---|
| Model trait seam (mock here) | `trait ApiClient`, `ScriptedApiClient` | `rust/crates/runtime/src/conversation.rs` |
| Headless loop entry | `ConversationRuntime::new`, `fn run_turn` | `rust/crates/runtime/src/conversation.rs` |
| Anthropic runtime client (cache-0 bug, B4) | `impl ApiClient for AnthropicRuntimeClient`, `MessageDelta` | `rust/crates/rusty-claude-cli/src/main.rs` |
| Tool spec / schema struct | `struct ToolSpec`, `mvp_tool_specs` | `rust/crates/tools/src/lib.rs` |
| Tool dispatch | `fn execute_tool` | `rust/crates/tools/src/lib.rs` |
| Edit apply (corrected CP 0.1) | `fn edit_file` | `rust/crates/runtime/src/file_ops.rs` (NOT `tools/src/lib.rs`; `tools` only wraps it via `run_edit_file`/`execute_tool`) |
| Conversation loop / tool extraction | `fn run`, tool-use extraction, retry/backoff | `rust/crates/runtime/src/conversation.rs` |
| Auto-compaction | `compact`, context-window check | `runtime/src/compact.rs`, `conversation.rs` |
| Token estimate | `estimate_tokens` | `runtime/src/tokenizer.rs` |
| Cost | `fn cost_usd` | `runtime/src/usage.rs` |
| Model config | `ModelHints` | `runtime/src/model_hints.rs` |
| Hooks | `HookEvent`, `PostTool`, `HookManager` | `runtime/src/hooks.rs` |
| Permissions | `PermissionPolicy`, `PermissionMode` | `runtime/src/permissions.rs` |
| OAI tool_choice / SSE / arg reassembly | `tool_choice`, `pending_tools`, SSE parse | `rusty-claude-cli/src/openai.rs` |
| Bedrock tool_choice | `tool_choice` / `ToolChoice::Auto` | `rusty-claude-cli/src/bedrock.rs` |
| Build/test TODO stubs | `TODO: Add build`, `TODO: Add test` | `rusty-claude-cli/src/main.rs` |
| MCP client | JSON-RPC `initialize`, `tools/list` | `rusty-claude-cli/src/mcp.rs` |
| Worktree isolation | `worktree`, `.xolotl-worktrees` | `runtime/src/supervisor/worktree.rs` |
| Tauri eval runner | eval run command | `tauri-app/src-tauri/` |

### New modules introduced
- `rust/crates/bench/` (P0) — harness + corpus + reporter
- `rust/crates/tools/src/edit/` (P1) — strategy ladder + formats
- `rust/crates/runtime/src/toolcall/` (P2) — repair, validate, fallback parser
- `rust/crates/runtime/src/verify/` (P3) — detection + post-edit checks
- `rust/crates/lsp/` (P3, flagged) — diagnostics client
- `rust/crates/mcp-server/` (P5) — MCP server
- `rust/crates/acp/` (P5, flagged) — ACP adapter
- `~/.xolotl-code/profiles/<model>.json` (P6) — reliability profiles

*End of plan. Update the [tracker](#tracker) and [metrics table](#metrics) as work lands — they are the resume anchors for any agent.*
