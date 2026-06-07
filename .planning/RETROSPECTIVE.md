# Retrospective: xolotl

Living document. One section per milestone, newest first, followed by cross-milestone trends.

---

## Milestone: v2.0 — Civ Simulation

**Shipped:** 2026-06-07 (code-complete; live human UAT pending)
**Phases:** 5 | **Plans:** 14 | **Tasks:** 31

### What Was Built
Turned the single-civ Axolotl game into a watchable, multi-AI-civilization simulation that doubles as a harness eval/arena. Multi-model world creation (1-3 civs, per-civ color + controller) with a live leaderboard; per-civ renderer tints + multi-colony/focus camera; an environment engine (seasons drift temperature, disasters forecast→fire→reshape terrain, renewable-only regrowth); deterministic combat/raids/territory/diplomacy/trades + wild predators; and expanded visible Mendelian genetics with environmental selection that measurably evolves a population. The arena interface (`render_game_to_text()`, `civPilotControls`, `codex-play-civ.mjs`) was extended, never broken.

### What Worked
- **Pure-helper-first decomposition.** Most phases split into "pure, seed-deterministic leaf helpers + unit tests" (Wave 1) then "wire into `advance_civ_turn`" (Wave 2). This made the backend testable on Windows via `cargo test --no-run` despite WebView2 blocking live backend tests.
- **Determinism as a design constraint** (seeded salts per subsystem, e.g. predators `0xBADD_CA75`) gave reproducible runs and testable invariants — including a multi-turn proof that mean `cold_resistance` strictly rises under cold (GEN-02).
- **Additive back-compat contracts** (vitest locking legacy single-civ text keys byte-identical) let the IPC surface grow without breaking the harness bridge.
- **Autonomous GSD pipeline** ran all 5 phases end-to-end (context → research → plan → execute → verify → review → Nyquist) with atomic commits to `main`.

### What Was Inefficient
- **PROJECT.md drifted** — it was last evolved mid-v1.0, so v1.0 Phase 4-6 deliverables sat in "Active" as unchecked items and v2.0 wasn't recorded until milestone close. Lesson below.
- **Verification stopped at automated checks.** Renderer (P02) and environment (P03) carry `human_needed` gaps; the live sim was never watched end-to-end, so visual/feel regressions can't be ruled out yet.

### Patterns Established
- Backend sim changes land as `pure helper + test` → `orchestrator wiring + integration test`.
- Every new `CivGenes`/entity/IPC field is `#[serde(default)]` + additive bindings regen, so old saves deserialize and `bindings.ts` drift stays controlled.
- WebView2 reality: backend unit tests compile-and-run on CI (Linux/macOS); on Windows verify via `cargo check`/`clippy`/`test --no-run` + frontend `tsc`/vitest.

### Key Lessons
1. **Run the PROJECT.md evolution review at every milestone close, not just at the end of a long gap** — drift compounds.
2. **A "code-complete" milestone is not a "shipped" milestone** until a human has watched the live build. Keep the UAT gate explicit in MILESTONES.md rather than implying ship.
3. Deterministic engines pay for themselves twice: testability now, replay/debug later.

### Cost Observations
- Model mix: quality profile (Opus/Sonnet orchestration; cheaper models for sim civ turns at runtime).
- Notable: one autonomous session carried all 5 phases; the bottleneck is human/live confirmation, not generation throughput.

---

## Milestone: v1.0 — Orchestration MVP

**Shipped:** 2026-06-06
**Phases:** 6 | **Plans:** 33

### What Was Built
The shared Rust engine + CLI (`xolotl`) and the Tauri desktop shell: streaming multi-provider client, agentic loop with parallel tool dispatch, sessions/compaction, permissions, an orchestration layer (AgentSupervisor, SharedContextStore, GitOpQueue, WorktreeManager), the chat-first UI, an agent dashboard, and parallel-worktree role-based team orchestration.

### Key Lessons
- The free-form `config.json` map (never a strict struct) and the auto-generated `bindings.ts` are the two highest-leverage gotchas — both cost real time when treated naively.
- Windows pathing (spaces in repo path breaking `dlltool`; `link.exe` shadowing MSVC) needs a local-only gitignored `.cargo/config.toml`.

*(Backfilled at v2.0 close — v1.0 predated this retrospective.)*

---

## Cross-Milestone Trends

| Milestone | Phases | Plans | Shipped | Notable |
|-----------|--------|-------|---------|---------|
| v1.0 Orchestration MVP | 6 | 33 | 2026-06-06 | Engine + CLI + Tauri shell + teams |
| v2.0 Civ Simulation | 5 | 14 | 2026-06-07 | Multi-civ sim + harness arena (UAT pending) |

**Recurring themes**
- *bindings.ts drift* and *config.json as a map* recur every milestone that touches the IPC surface — treat as standing constraints.
- *Determinism + pure helpers + additive contracts* is the pattern that keeps a Windows-untestable backend verifiable.
- *Verification debt*: automated checks are strong; live human UAT lags. v2.1 should make the game's playability/feel a first-class, demoable verification target.
