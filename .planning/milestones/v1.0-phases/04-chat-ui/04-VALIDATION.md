---
phase: 4
slug: chat-ui
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-10
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (none installed — Wave 0 installs) |
| **Config file** | `tauri-app/vite.config.ts` test block (Wave 0 creates) |
| **Quick run command** | `cd tauri-app && npx tsc --noEmit` |
| **Full suite command** | `cd tauri-app && npm test` |
| **Estimated runtime** | ~15 seconds (TypeScript check); ~5 seconds (unit tests) |

---

## Sampling Rate

- **After every task commit:** Run `cd tauri-app && npx tsc --noEmit`
- **After every plan wave:** Run `cd tauri-app && npm test` (full vitest suite)
- **Before `/gsd-verify-work`:** Full suite must be green + live Tauri smoke test passes
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 4-W0-TextDelta | 01 | 0 | UI-01 | — | N/A | build | `cargo build -p tauri-app-backend` | ❌ W0 | ⬜ pending |
| 4-W0-bindings | 01 | 0 | UI-01 | T-4-01 | No XSS via stale AgentEvent types | type | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 4-W0-tailwind | 01 | 0 | — | — | N/A | build | `npm run build` | ❌ W0 | ⬜ pending |
| 4-W0-shadcn | 01 | 0 | — | — | N/A | type | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 4-W0-vitest | 01 | 0 | UI-04, UI-09 | — | N/A | unit | `npm test` | ❌ W0 | ⬜ pending |
| 4-01-chatstore | 02 | 1 | UI-01, UI-09, UI-10 | — | Functional update pattern avoids stale closure | unit | `npm test -- chatStore` | ❌ W0 | ⬜ pending |
| 4-01-sessionstore | 02 | 1 | UI-06 | T-4-02 | Session IDs validated as UUIDs before fs calls | unit | `npm test -- sessionStore` | ❌ W0 | ⬜ pending |
| 4-01-events | 02 | 1 | UI-01 | T-4-03 | Unlisten cleanup prevents subscription leak | type | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 4-02-markdown | 03 | 2 | UI-02 | T-4-01 | No rehypeRaw; no dangerouslySetInnerHTML | type | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 4-02-diff | 03 | 2 | UI-04 | T-4-01 | Diff rendered as React children, not innerHTML | unit | `npm test -- DiffView` | ❌ W0 | ⬜ pending |
| 4-02-virtualizer | 03 | 2 | UI-05 | — | N/A | manual | launch app, 200-msg fixture | — | ⬜ pending |
| 4-03-toolblock | 04 | 3 | UI-03 | — | N/A | manual | trigger bash tool call in dev | — | ⬜ pending |
| 4-03-diffview | 04 | 3 | UI-04 | T-4-01 | Text content only, no innerHTML | unit | `npm test -- DiffView` | ❌ W0 | ⬜ pending |
| 4-03-permission | 04 | 3 | UI-07 | — | N/A | manual | trigger permission prompt in dev | — | ⬜ pending |
| 4-04-sidebar | 05 | 4 | UI-06 | T-4-02 | UUID validation on session load | unit | `npm test -- sessionStore` | ❌ W0 | ⬜ pending |
| 4-05-model | 05 | 5 | UI-08 | — | N/A | manual | change model in dropdown | — | ⬜ pending |
| 4-05-cost | 05 | 5 | UI-09 | — | N/A | unit | `npm test -- cost` | ❌ W0 | ⬜ pending |
| 4-05-stop | 05 | 5 | UI-10 | — | N/A | manual | cancel turn, verify preserved output | — | ⬜ pending |
| 4-06-slash | 06 | 6 | UI-11 | — | N/A | manual | type `/` in input | — | ⬜ pending |
| 4-06-smoke | 06 | 6 | all | — | N/A | manual | full success criteria check in dev | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tauri-app/vitest.config.ts` or `vite.config.ts` test block — vitest setup
- [ ] `npm install -D vitest @vitest/ui` — test runner install
- [ ] `tauri-app/src/lib/diff.test.ts` — unit tests for `computeLineDiff` (add/remove/unchanged)
- [ ] `tauri-app/src/lib/cost.test.ts` — unit tests for dollar cost formatting per `TokenUsage`
- [ ] `tauri-app/src/stores/chatStore.test.ts` — unit tests for streaming state actions
- [ ] `tauri-app/src/stores/sessionStore.test.ts` — unit tests for session UUID validation

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Token-by-token streaming at 60fps | UI-01 | Requires live Tauri WebView + real agent run | Launch `npm run tauri dev`, send a message, observe streaming |
| Collapsible tool blocks with truncation | UI-03 | Requires live tool execution | Trigger bash command, expand/collapse tool block, verify 2000-char truncation |
| Virtualized scroll with 200+ messages | UI-05 | Requires message fixture in live app | Create fixture of 200 messages, scroll the list |
| Session resume from sidebar | UI-06 | Requires session file I/O via Tauri fs | Save session, restart app, resume from sidebar |
| Permission prompt card in thread | UI-07 | Requires live permission event from Rust | Use a command that triggers permission, verify card appears and responds |
| Model selector per session | UI-08 | Requires Tauri IPC to runtime | Change model mid-session, verify next turn uses new model |
| Stop button preserves partial output | UI-10 | Requires live streaming + cancel interaction | Start long agent run, click stop, verify "(generation stopped)" appended |
| Slash palette keyboard navigation | UI-11 | Requires keyboard input in WebView | Type `/`, navigate with arrows, execute command |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
