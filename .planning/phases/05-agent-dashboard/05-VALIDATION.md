---
phase: 5
slug: agent-dashboard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-10
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.5 + cargo test |
| **Config file** | `tauri-app/vitest.config.ts` |
| **Quick run command** | `npm test` (in tauri-app/) |
| **Full suite command** | `npm test` (tauri-app/) + `cargo test -p runtime` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test` (in tauri-app/)
- **After every plan wave:** Run `npm test` + `cargo test -p runtime`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 5-xx-01 | Store | 1 | AGT-01, AGT-02, AGT-05 | — | N/A | unit | `npm test -- agentStore` | ❌ Wave 0 | ⬜ pending |
| 5-xx-02 | Store | 1 | AGT-06 | T-5-01 | Budget field parsed as f64, reject negative/NaN | unit | `npm test -- agentStore` | ❌ Wave 0 | ⬜ pending |
| 5-xx-03 | Backend | 1 | AGT-06 | T-5-01 | Budget stored in AgentHandle, halt on exceeded | unit (Rust) | `cargo test -p runtime` | ❌ Wave 0 | ⬜ pending |
| 5-xx-04 | Backend | 1 | AGT-03 | T-5-02 | Task slug: strip non-alphanumeric, cap length | unit (Rust) | `cargo test -p runtime` | ❌ Wave 0 | ⬜ pending |
| 5-xx-05 | UI | 2 | AGT-01 | — | N/A | unit | `npm test -- AgentCard` | ❌ Wave 0 | ⬜ pending |
| 5-xx-06 | UI | 2 | AGT-03 | — | N/A | unit | `npm test -- spawnDialog` | ❌ Wave 0 | ⬜ pending |
| 5-xx-07 | UI | 3 | AGT-02 | — | N/A | unit | `npm test -- agentStore` | ❌ Wave 0 | ⬜ pending |
| 5-xx-08 | Notify | 4 | AGT-04 | T-5-03 | Notification title truncated to 60 chars | manual | N/A | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tauri-app/src/stores/agentStore.test.ts` — stubs for AGT-01, AGT-02, AGT-05, AGT-06 (TS cost accumulation)
- [ ] `rust/crates/runtime/src/supervisor/tests.rs` — budget enforcement test added to existing test file (AGT-06 Rust side)
- [ ] `tauri-app/src/components/agent/AgentCard.test.tsx` — renders badge + truncated task (AGT-01)
- [ ] `tauri-app/src/lib/slug.test.ts` — covers slugify_task / task-to-branch naming (AGT-03)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| OS notification fires on agent Done/Failed | AGT-04 | Requires running OS with notification permission; WinRT toast cannot be unit-tested | 1. Spawn agent with short task. 2. Wait for completion. 3. Verify toast appears in Windows Action Center with correct title/body. |
| Agent spawns real ConversationRuntime turn | AGT-02 | Requires real Tauri window + subprocess | 1. Spawn agent. 2. Expand agent output view. 3. Verify at least one message appears in the stream. |

---

## Threat Model

| Threat ID | Pattern | STRIDE | Mitigation |
|-----------|---------|--------|------------|
| T-5-01 | Negative/NaN budget bypasses enforcement | Tampering | Validate `budget_dollars > 0.0` and reject NaN/infinity before storing in AgentHandle |
| T-5-02 | Task description → branch name injection | Tampering | `slugify_task()` strips all non-alphanumeric chars + length cap before `git worktree add` |
| T-5-03 | Notification content injection | Spoofing | Truncate task to 60 chars; WinRT toasts have no HTML rendering |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
