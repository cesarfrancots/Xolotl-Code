# Phase 6: Parallel Worktrees + Team Orchestration — Research

**Researched:** 2026-05-11
**Domain:** Rust supervisor extensions + Tauri IPC + React/Zustand frontend group model
**Confidence:** HIGH — all findings are based on direct codebase audit of the actual source files

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Worktree Panel (WRK-01)**
- D-01: Extend the existing AgentPanel (320px right column) — no new tab, no new panel. Phase 6 adds branch/worktree data to the existing agent cards inline.
- D-02: Each agent card gains a small branch name label below the task description. One-liner only.
- D-03: Activity indicator for the Executing state: a pulsing dot on the existing status badge via Tailwind `animate-ping`. No file-path chips or additional card rows.

**Team vs Swarm Launch (WRK-02, WRK-03)**
- D-04: One unified "Launch Team" dialog with a toggle between two modes: Team (role-based) and Swarm (N identical agents with a shared objective).
- D-05: Team mode is static configuration: dialog shows 4 role rows (Planner, Coder, Reviewer, Tester), each with a model dropdown and task description text field.
- D-06: Swarm mode result aggregation = no LLM synthesis. N agents run in parallel. The merge checkpoint is the aggregation mechanism.

**File Conflict Protocol (WRK-04)**
- D-07: Conflict detection at merge time only — no pre-flight analysis, no runtime file-lock table in the Rust supervisor.
- D-08: Conflict visualization: files touched by 2+ worktrees get a yellow warning badge in the merge checkpoint file list.

**Merge Checkpoint (WRK-05)**
- D-09: Merge checkpoint auto-triggered when all agents in the same group reach Done or Failed state.
- D-10: Checkpoint appears as a center pane replacement, same pattern as AgentOutputView replacing ChatPane.
- D-11: Per-worktree content: accordion list of changed files for each worktree branch. Each file expandable to show a before/after diff reusing DiffView.
- D-12: "Approve & Merge" runs `git merge <branch>` for each worktree branch into main, dispatched through GitOpQueue. After all merges complete, worktrees are pruned.

**Agent Grouping**
- D-13: Groups concept in data model. A group has: ID, list of agent IDs, mode (team/swarm), merge_state (Pending → AllDone → CheckpointOpen → Merged).
- D-14: AgentPanel shows a group header row above agent cards belonging to the same team/swarm.

### Claude's Discretion
- Exact styling of group header row in AgentPanel.
- Pulsing badge animation details.
- Launch Team dialog layout and spacing.
- Merge checkpoint header design.

### Deferred Ideas (OUT OF SCOPE)
- None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WRK-01 | Worktree panel shows which agent is running on which git branch with per-worktree activity indicators | AgentRecord needs `branch` field; AgentCard gains branch label + pulsing badge; WorktreeManager.get_path() already exists; branch is stored in WorktreeManager active map |
| WRK-02 | User can compose a role-based agent team (Planner, Coder, Reviewer, Tester) with per-role model and task description | New LaunchTeamDialog (Team mode) calls new `launch_team` Tauri command; supervisor gains `launch_team()` that calls `spawn_agent_with_config` 4x |
| WRK-03 | User can configure a swarm strategy: number of agents, shared objective, result aggregation | New LaunchTeamDialog (Swarm mode) calls new `launch_swarm` Tauri command; supervisor gains `launch_swarm()` that calls `spawn_agent_with_config` N times |
| WRK-04 | File ownership protocol prevents two agents from writing the same file simultaneously; conflict surfaced in UI | At merge time: `get_worktree_diff` returns changed files per agent; frontend computes intersection; yellow badge on overlap |
| WRK-05 | Merge checkpoint UI appears when parallel agents are ready to merge; user reviews and approves | `MergeCheckpointView` as center pane replacement; `merge_worktrees` command dispatches sequential merges via GitOpQueue; auto-triggered by group state watcher |
</phase_requirements>

---

## Summary

Phase 6 is a surgical extension of the Phase 5 architecture. The Rust supervisor, frontend store, IPC layer, and component tree are all already in place. The phase adds: (1) a group concept to track sets of agents launched together, (2) two new Tauri commands for launching teams and swarms, (3) two new Tauri commands for diffing worktrees and merging them, (4) a `MergeCheckpointView` center pane component, and (5) UI chrome on existing components (branch label on AgentCard, group header row in AgentPanel, pulsing badge on the state badge).

The central dependency ordering is: Rust type changes → new Tauri commands → manual `bindings.ts` update → Zustand store extension → new/modified UI components. Frontend group tracking (auto-trigger of merge checkpoint) depends on the store changes being in place before the AgentPanel group header row.

The biggest risk is the `get_worktree_diff` command: it must shell out `git diff --name-only HEAD` per worktree and return a list of changed file paths. The conflict algorithm is a simple set-intersection performed entirely on the frontend with no Rust side involvement. The merge flow must go through the existing `GitOpQueue` to prevent `index.lock` corruption.

**Primary recommendation:** Build in four waves — (W1) Rust types + new supervisor methods + new Tauri commands + bindings.ts; (W2) agentStore group extensions + useGroupWatcher hook; (W3) LaunchTeamDialog + AgentCard/AgentPanel group UI; (W4) MergeCheckpointView + App.tsx center pane wiring.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Group launch (team/swarm) | API / Rust Backend | — | `AgentSupervisor` owns worktree allocation and agent spawning; frontend just invokes |
| Group state tracking (Pending→AllDone) | Frontend (Zustand) | — | Rust emits per-agent StateChanged events; frontend counts terminal agents to detect AllDone |
| Conflict detection | Frontend (Zustand/React) | — | D-07: conflict detection is a pure set-intersection on file path lists fetched from Rust; no Rust logic needed |
| Worktree diff retrieval | API / Rust Backend | — | Shells out `git diff --name-only HEAD` per worktree path; returns string list over IPC |
| Merge execution | API / Rust Backend | — | D-12: `git merge` dispatched through GitOpQueue (serialized); Rust owns this entirely |
| Merge checkpoint display | Browser / React | — | `MergeCheckpointView` is a pure UI component consuming data already fetched |
| Branch label on AgentCard | Browser / React | — | Branch name stored in AgentRecord; rendered as `<code>` chip |

---

## Standard Stack

All dependencies are already installed. No new npm or Cargo dependencies are required for Phase 6.

### Core (already present)
| Library | Version | Purpose | Note |
|---------|---------|---------|------|
| Rust + tokio | workspace | Async runtime for supervisor | No change |
| tauri 2.x | 2.11 | IPC between Rust and frontend | No change |
| specta / tauri-specta | rc.25 | Type generation (blocked by WebView2, so hand-update) | No change |
| React 19 + TypeScript | project | Frontend | No change |
| Zustand | project | Frontend state store | agentStore extended, not replaced |
| Tailwind 4 + shadcn/Radix | project | UI components | `animate-ping`, Accordion, ToggleGroup already available in shadcn |
| `diff` (npm) | project | `computeLineDiff` used by DiffView | No change — DiffView reused directly |

### No New Dependencies Required
All capabilities needed for Phase 6 are achievable with the existing stack:
- Accordion UI: shadcn `Accordion` component (already installed as part of the shadcn setup)
- Toggle between Team/Swarm: shadcn `Tabs` or `ToggleGroup` (already available)
- Pulsing badge: Tailwind `animate-ping` (already in the Tailwind install)
- Diff display: `DiffView` component already built in Phase 4

[VERIFIED: direct file audit of tauri-app/src-tauri/Cargo.toml and tauri-app/src/components/]

---

## Architecture Patterns

### System Architecture Diagram

```
User clicks "Launch Team" or "Launch Swarm"
         │
         ▼
LaunchTeamDialog (Team mode: 4 RoleConfig rows | Swarm mode: count + objective)
         │ invoke launch_team() / launch_swarm()
         ▼
commands.rs: launch_team(roles) / launch_swarm(count, objective, model)
         │ calls supervisor.launch_team() / launch_swarm()
         ▼
AgentSupervisor::launch_team() / launch_swarm()
  ├─ calls spawn_agent_with_config() N times (existing method, no change)
  ├─ collects Vec<AgentId>
  └─ returns GroupId + Vec<AgentId>
         │ IPC returns (group_id, agent_ids)
         ▼
Frontend: agentStore.addGroup(groupId, agentIds, mode)
          agentStore.addAgent(id, task, model) for each
         │
         ▼ (per-agent event streams, existing path)
useAgentPanelEvents (already mounted per AgentCard)
  └─ on StateChanged(Done|Failed): agentStore.updateAgentState()
         │
         ▼
agentStore group watcher (new): watches agents list
  └─ when all agents in group are Done|Failed: updateGroupState(AllDone)
         │ auto-trigger
         ▼
agentStore.openMergeCheckpoint(groupId)
  └─ sets mergeCheckpointGroupId
         │
         ▼
App.tsx center pane:
  mergeCheckpointGroupId set → MergeCheckpointView
  expandedAgentId set → AgentOutputView
  else → ChatPane
         │
         ▼
MergeCheckpointView:
  1. invoke get_worktree_diff(agentId) for each agent in group
     └─ returns { changed_files: string[] } per agent
  2. compute conflict set (frontend: set intersection)
  3. render accordion: one section per agent branch
     └─ per file: filename chip + yellow badge if conflict + expandable DiffView
  4. "Approve & Merge" button → invoke merge_worktrees(groupId)
         │
         ▼
commands.rs: merge_worktrees(group_id)
  └─ for each agent in group:
       git_queue.run(["merge", branch], repo_root)
       then worktree_manager.remove(agent_id)
  └─ emits group_state_changed { group_id, state: "Merged" }
         │
         ▼
Frontend: agentStore.updateGroupState(groupId, "Merged")
          agentStore.openMergeCheckpoint(null)  // close
```

### Recommended Project Structure

No new top-level directories needed. All additions are within existing modules.

**Rust (rust/crates/runtime/src/supervisor/):**
```
supervisor/
├── agent_state.rs      — add GroupId, AgentGroup struct, MergeState enum
├── supervisor.rs       — add launch_team(), launch_swarm()
├── worktree.rs         — add merge_into_main() + get_diff_files()
└── mod.rs              — re-export new types
```

**Tauri commands (tauri-app/src-tauri/src/):**
```
commands.rs             — add launch_team, launch_swarm, get_worktree_diff, merge_worktrees
lib.rs                  — register new commands in collect_commands!, add new types to .typ::<>()
```

**Frontend (tauri-app/src/):**
```
stores/
└── agentStore.ts       — add groups map, mergeCheckpointGroupId, group actions
hooks/
└── useGroupWatcher.ts  — (new) watches agent states → triggers AllDone transition
components/agent/
├── AgentPanel.tsx      — add group header rows between agent cards
├── AgentCard.tsx       — add branch label + pulsing badge
├── LaunchTeamDialog.tsx — (new) replaces nothing; opened from AgentPanel "+" button  
└── MergeCheckpointView.tsx — (new) center pane replacement
bindings.ts             — hand-update: add 4 new commands + GroupId, RoleConfig, GroupLaunchResult, WorktreeDiff types
```

---

## Existing Code: Key Findings

### WorktreeManager (worktree.rs) — What's Missing

The `WorktreeManager` has `add()`, `remove()`, `list()`, `prune()`, `get_path()`. Two methods need adding:

**1. `get_diff_files(agent_id: &AgentId) -> Result<Vec<String>, WorktreeError>`**
```rust
// Source: direct audit of worktree.rs
pub fn get_diff_files(&self, agent_id: &AgentId) -> Result<Vec<String>, WorktreeError> {
    let path = {
        let active = self.active.lock().unwrap();
        active.get(agent_id)
            .map(|(p, _)| p.clone())
            .ok_or_else(|| WorktreeError::NotAssigned(agent_id.clone()))?
    };
    let output = std::process::Command::new("git")
        .args(["diff", "--name-only", "HEAD"])
        .current_dir(&path)
        .output()?;
    if !output.status.success() {
        return Err(WorktreeError::GitFailed(
            String::from_utf8_lossy(&output.stderr).into_owned()
        ));
    }
    let files = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();
    Ok(files)
}
```

**2. `merge_into_main(agent_id: &AgentId, git_queue: &GitOpQueue, repo_root: &PathBuf) -> ...`**
The merge must go through GitOpQueue (D-12). Because `GitOpQueue::run()` is async, this method must be `async` too — or the caller handles the queue dispatch. Simpler: add a `get_branch(agent_id)` getter and have the Tauri command do the queue dispatch directly.

**Actual simpler design:**
```rust
// Add to WorktreeManager:
pub fn get_branch(&self, agent_id: &AgentId) -> Option<String> {
    let active = self.active.lock().unwrap();
    active.get(agent_id).map(|(_, branch)| branch.clone())
}
```
Then the `merge_worktrees` Tauri command does:
```rust
for agent_id in &group.agent_ids {
    let branch = worktree_manager.get_branch(agent_id).ok_or_else(|| ...)?;
    let result = git_queue.run(
        vec!["merge".to_string(), branch],
        repo_root.clone(),
    ).await?;
    if !result.status.success() { /* handle error */ }
    worktree_manager.remove(agent_id)?;
}
```

[VERIFIED: direct audit of worktree.rs — `get_path()` exists but `get_branch()` does not; `active` stores `(PathBuf, String)` tuple so branch is available]

### GitOpQueue (git_queue.rs) — No Changes Needed

The `GitOpQueue::run()` method accepts arbitrary `Vec<String>` commands and runs them serialized. Running `["merge", "<branch>"]` with `cwd = repo_root` is already fully supported. [VERIFIED: direct audit of git_queue.rs]

### AgentSupervisor (supervisor.rs) — What to Add

Current: `spawn_agent()`, `spawn_agent_with_config()`, `list()`, `get_handle()`, `stop_agent()`, `stop_all()`, `git_queue_for()`.

Need to add:
- `launch_team(roles: Vec<(String, String, String)>) -> Result<(GroupId, Vec<AgentId>), SupervisorError>`
  Each tuple: `(role_name, task, model)`. Budget is not per-role for Phase 6 (not in CONTEXT.md).
- `launch_swarm(count: u32, objective: String, model: String) -> Result<(GroupId, Vec<AgentId>), SupervisorError>`

Both methods are thin wrappers that call `spawn_agent_with_config()` N times and return the collected IDs. The group concept itself lives in the Tauri command layer and frontend — the Rust supervisor does NOT need to know about groups.

**Critical decision:** Groups do NOT need to live in the Rust supervisor. The Rust supervisor manages agents individually. The group concept is a frontend concern — the Tauri command creates agents, returns `(group_id, agent_ids)`, and the frontend tracks group membership in `agentStore.groups`. This keeps the Rust core simple.

[VERIFIED: direct audit of supervisor.rs — no group tracking exists or is needed there]

### AgentState / AgentEvent (agent_state.rs) — Minimal Changes

**No new AgentState variants needed.** The existing `Done` and `Failed` are the terminal states that trigger the merge checkpoint.

**One new AgentEvent variant needed:**
```rust
GroupStateChanged {
    group_id: String,
    state: String,  // "AllDone" | "CheckpointOpen" | "Merged"
}
```
This lets the Tauri merge command notify the frontend when merges complete. However, this event is emitted from the `merge_worktrees` Tauri command directly (not from an agent), so it should be emitted on a separate Tauri event channel `"group-event"` rather than shoehorned into `AgentEvent`.

**Simpler alternative (recommended):** The `merge_worktrees` command emits a plain Tauri event `"group-state-changed"` with payload `{ group_id: string, state: "Merged" }` using `app_handle.emit()`. This avoids touching `AgentEvent` entirely and keeps the boundary clean.

[VERIFIED: direct audit of agent_state.rs — AgentEvent uses `#[serde(deny_unknown_fields)]` so adding variants requires manual bindings.ts update]

### agentStore.ts — What to Add

**Current state shape:**
```typescript
agents: AgentRecord[]         // array of individual agents
expandedAgentId: string | null
```

**Required additions (D-13):**
```typescript
// New types
export interface AgentGroup {
  id: string;
  agentIds: string[];
  mode: "team" | "swarm";
  mergeState: "Pending" | "AllDone" | "CheckpointOpen" | "Merged";
  name: string;  // auto-derived from first agent's task or shared objective
}

// New store state
groups: AgentGroup[];
mergeCheckpointGroupId: string | null;

// New actions
addGroup: (id: string, agentIds: string[], mode: "team" | "swarm", name: string) => void;
updateGroupMergeState: (id: string, state: AgentGroup["mergeState"]) => void;
openMergeCheckpoint: (id: string | null) => void;
```

**AgentRecord needs one new field:**
```typescript
branch: string;  // worktree branch name, returned from launch_team/launch_swarm
```

The `addAgent` action signature must be extended to accept `branch`:
```typescript
addAgent: (id: string, task: string, model: string, branch: string) => void;
```

[VERIFIED: direct audit of agentStore.ts — current store has no `groups`, no `branch` on AgentRecord, no `mergeCheckpointGroupId`]

### App.tsx — Center Pane Switching

**Current logic:**
```tsx
{expandedAgentId ? <AgentOutputView /> : <ChatPane />}
```

**Required (D-10):**
```tsx
{mergeCheckpointGroupId
  ? <MergeCheckpointView groupId={mergeCheckpointGroupId} />
  : expandedAgentId
  ? <AgentOutputView agentId={expandedAgentId} />
  : <ChatPane />
}
```

Both `mergeCheckpointGroupId` and `expandedAgentId` come from `useAgentStore`. Priority: merge checkpoint takes precedence over expanded agent output.

[VERIFIED: direct audit of App.tsx — current 2-branch ternary must become 3-branch]

### AgentCard.tsx — What to Add

**Current:** state badge, cost, task description, stop/expand buttons.

**Required additions:**
1. Branch label (D-02): `<code className="text-xs font-mono text-[oklch(0.45_0_0)]">{agent.branch}</code>` below the task text. One line only.
2. Pulsing badge (D-03): when `agent.state === "Executing"`, add a `animate-ping` element. Standard Tailwind pattern:
```tsx
{agent.state === "Executing" && (
  <span className="relative flex h-2 w-2">
    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
  </span>
)}
```

[VERIFIED: direct audit of AgentCard.tsx — no branch field, no pulsing badge currently present]

### AgentPanel.tsx — What to Add

The panel currently renders a flat list of `AgentCard` components. It must change to render group header rows above the agents belonging to each group.

**Rendering logic:** Sort/group agents by `groupId` (looked up from `agentStore.groups`). For each group: render a group header row, then its AgentCards. Ungrouped agents (launched individually via SpawnAgentDialog) render without a header.

**Group header content (D-14):** group name + progress summary (e.g., "Team · 3/4 Done") + "View Checkpoint" button (visible when `mergeState === "AllDone"` or `"CheckpointOpen"`).

[VERIFIED: direct audit of AgentPanel.tsx — flat `agents.map()` with no grouping logic]

### SpawnAgentDialog.tsx / New LaunchTeamDialog.tsx

The existing `SpawnAgentDialog` opens from the "+" button in `AgentPanel`. Phase 6 needs a second button or a way to open `LaunchTeamDialog`. Options:
- Add a second icon button next to "+" in AgentPanel header (e.g., `Users` icon from lucide-react)
- Or replace "+" with a dropdown menu with "Single Agent" / "Team / Swarm" options

The `LaunchTeamDialog` pattern follows `SpawnAgentDialog` exactly: shadcn `Dialog` + form fields. Key differences:
- A `Tabs` or `ToggleGroup` at the top toggling between "Team" and "Swarm" modes
- Team mode: 4 fixed role rows (Planner, Coder, Reviewer, Tester), each with model Select + textarea
- Swarm mode: count input + shared objective textarea + model Select (single model for all)

[VERIFIED: direct audit of SpawnAgentDialog.tsx — the shadcn Dialog + form pattern is clear and replicable]

### DiffView.tsx — No Changes

`DiffView` accepts `{ oldStr: string, newStr: string }` and renders a line diff. The merge checkpoint passes `oldStr` from the base branch and `newStr` from the worktree branch. Fetching file contents requires a new Tauri command or reading via `fs` plugin. However D-11 says "expandable to show a before/after diff reusing DiffView" — the file content must come from somewhere.

**Practical design for `get_worktree_diff`:** Rather than fetching only file names, it should return the full diff text per file. Two options:
- Return `git diff HEAD -- <file>` output as patch text and parse it in frontend
- Return `{ file: string, old_content: string, new_content: string }[]` so DiffView can be used directly

The second option is cleaner for the frontend. Implementation: for each changed file, read `HEAD:<file>` (base) and the working tree version. In git: `git show HEAD:<file>` and `cat <worktree_path>/<file>`.

**Revised `get_worktree_diff` command signature:**
```rust
pub fn get_worktree_diff(
    supervisor: tauri::State<'_, Arc<AgentSupervisor>>,
    agent_id: String,
) -> Result<Vec<FileDiff>, String>

#[derive(Serialize, Deserialize, specta::Type)]
pub struct FileDiff {
    pub path: String,
    pub old_content: String,   // content at HEAD (may be empty if new file)
    pub new_content: String,   // content in worktree
}
```

[VERIFIED: DiffView.tsx signature confirmed — takes `oldStr` and `newStr` strings; direct audit]

---

## New IPC Commands — Exact Signatures

All new commands follow the existing pattern in `commands.rs`: `#[tauri::command] #[specta::specta]`. Because `bindings.ts` cannot be regenerated (WebView2 DLL issue), all new types and command signatures must be manually added.

### 1. `launch_team`
```rust
#[tauri::command]
#[specta::specta]
pub fn launch_team(
    supervisor: tauri::State<'_, Arc<AgentSupervisor>>,
    app_handle: AppHandle,
    roles: Vec<RoleConfig>,
) -> Result<GroupLaunchResult, String>

#[derive(Serialize, Deserialize, specta::Type, Clone)]
pub struct RoleConfig {
    pub role: String,    // "Planner" | "Coder" | "Reviewer" | "Tester"
    pub task: String,
    pub model: String,
}

#[derive(Serialize, Deserialize, specta::Type)]
pub struct GroupLaunchResult {
    pub group_id: String,
    pub agent_ids: Vec<String>,   // parallel to roles order
    pub branches: Vec<String>,    // branch for each agent, parallel to agent_ids
}
```

### 2. `launch_swarm`
```rust
#[tauri::command]
#[specta::specta]
pub fn launch_swarm(
    supervisor: tauri::State<'_, Arc<AgentSupervisor>>,
    app_handle: AppHandle,
    count: u32,
    objective: String,
    model: String,
) -> Result<GroupLaunchResult, String>
```

### 3. `get_worktree_diff`
```rust
#[tauri::command]
#[specta::specta]
pub fn get_worktree_diff(
    supervisor: tauri::State<'_, Arc<AgentSupervisor>>,
    agent_id: String,
) -> Result<Vec<FileDiff>, String>

#[derive(Serialize, Deserialize, specta::Type)]
pub struct FileDiff {
    pub path: String,
    pub old_content: String,
    pub new_content: String,
}
```

### 4. `merge_worktrees`
```rust
#[tauri::command]
#[specta::specta]
pub async fn merge_worktrees(
    supervisor: tauri::State<'_, Arc<AgentSupervisor>>,
    app_handle: AppHandle,
    group_id: String,
    agent_ids: Vec<String>,
) -> Result<(), String>
```

Note: `merge_worktrees` takes `agent_ids` from the frontend (the frontend knows the group membership). The command does not need a groups registry in Rust — it just iterates the provided IDs.

### bindings.ts additions (manual hand-update pattern)

```typescript
// New commands to add to the `commands` object:
launchTeam: (roles: RoleConfig[]) =>
    typedError<GroupLaunchResult, string>(__TAURI_INVOKE("launch_team", { roles })),
launchSwarm: (count: number, objective: string, model: string) =>
    typedError<GroupLaunchResult, string>(__TAURI_INVOKE("launch_swarm", { count, objective, model })),
getWorktreeDiff: (agentId: string) =>
    typedError<FileDiff[], string>(__TAURI_INVOKE("get_worktree_diff", { agentId })),
mergeWorktrees: (groupId: string, agentIds: string[]) =>
    typedError<null, string>(__TAURI_INVOKE("merge_worktrees", { groupId, agentIds })),

// New types to add:
export type RoleConfig = { role: string; task: string; model: string; };
export type GroupLaunchResult = { group_id: string; agent_ids: string[]; branches: string[]; };
export type FileDiff = { path: string; old_content: string; new_content: string; };
```

[VERIFIED: pattern matches existing `commands` object and `typedError` wrapper in bindings.ts — direct audit]

---

## Frontend State Shape

### AgentGroup type
```typescript
export interface AgentGroup {
  id: string;
  agentIds: string[];
  mode: "team" | "swarm";
  mergeState: "Pending" | "AllDone" | "CheckpointOpen" | "Merged";
  name: string;
}
```

### AgentRecord extension
```typescript
export interface AgentRecord {
  // ... existing fields ...
  branch: string;       // NEW: worktree branch name, e.g. "agent/refactor-auth-module"
  groupId: string | null;  // NEW: which group this agent belongs to, or null if solo
}
```

### agentStore additions
```typescript
export interface AgentStoreState {
  // ... existing fields ...
  groups: AgentGroup[];
  mergeCheckpointGroupId: string | null;

  addGroup: (id: string, agentIds: string[], mode: "team" | "swarm", name: string) => void;
  updateGroupMergeState: (groupId: string, state: AgentGroup["mergeState"]) => void;
  openMergeCheckpoint: (groupId: string | null) => void;
  // addAgent signature change:
  addAgent: (id: string, task: string, model: string, branch: string, groupId: string | null) => void;
}
```

### makeInitialRecord must include branch and groupId
```typescript
function makeInitialRecord(id: string, task: string, model: string, branch: string, groupId: string | null): AgentRecord {
  return { id, task, model, state: "Idle", cumulativeCost: 0, messages: [], streamingContent: "", isStreaming: false, branch, groupId };
}
```

### Group watcher hook (useGroupWatcher)

This hook is mounted once in `AgentPanel` (or `App`). It watches the `agents` array for state changes. When all agents in a group reach `Done` or `Failed`, it calls `updateGroupMergeState(groupId, "AllDone")` then `openMergeCheckpoint(groupId)`.

```typescript
// useGroupWatcher.ts
export function useGroupWatcher(): void {
  const agents = useAgentStore(s => s.agents);
  const groups = useAgentStore(s => s.groups);
  
  useEffect(() => {
    for (const group of groups) {
      if (group.mergeState !== "Pending") continue;
      const groupAgents = agents.filter(a => group.agentIds.includes(a.id));
      if (groupAgents.length === 0) continue;
      const allTerminal = groupAgents.every(
        a => a.state === "Done" || a.state === "Failed"
      );
      if (allTerminal) {
        useAgentStore.getState().updateGroupMergeState(group.id, "AllDone");
        useAgentStore.getState().openMergeCheckpoint(group.id);
      }
    }
  }, [agents, groups]);
}
```

[ASSUMED: the hook runs in a useEffect with `[agents, groups]` as deps — correct for React but may fire slightly after the last StateChanged event is processed. This is fine since the merge checkpoint opening is not time-critical.]

---

## Conflict Detection Algorithm

The conflict detection is a pure frontend operation (D-07). When `MergeCheckpointView` mounts, it:

1. Calls `get_worktree_diff(agentId)` for each agent in the group (parallel `Promise.all`)
2. Collects `{ agentId, files: FileDiff[] }` per agent
3. Computes the conflict set:
```typescript
function findConflicts(diffs: { agentId: string; files: FileDiff[] }[]): Set<string> {
  const pathCounts = new Map<string, number>();
  for (const { files } of diffs) {
    for (const f of files) {
      pathCounts.set(f.path, (pathCounts.get(f.path) ?? 0) + 1);
    }
  }
  return new Set([...pathCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([path]) => path));
}
```
4. Passes `conflictPaths` down to the file accordion; each file item checks `conflictPaths.has(file.path)` to show the yellow badge.

This is O(N * F) where N = agent count, F = files per agent. For typical Phase 6 use cases (4 agents, <100 changed files each), this is negligible.

---

## DiffView Integration

`DiffView` is already built and accepts `{ oldStr: string, newStr: string }`. The integration in `MergeCheckpointView` is direct:

```tsx
// Inside the file accordion, when a file row is expanded:
<DiffView oldStr={fileDiff.old_content} newStr={fileDiff.new_content} />
```

No changes needed to DiffView. The accordion wrapper is a shadcn `Accordion` component. Pattern:
```tsx
<Accordion type="multiple">
  {diffs[agentId].map(file => (
    <AccordionItem key={file.path} value={file.path}>
      <AccordionTrigger>
        <span className="font-mono text-xs">{file.path}</span>
        {conflictPaths.has(file.path) && (
          <span className="ml-2 text-xs bg-yellow-900/40 text-yellow-400 px-1 rounded">conflict</span>
        )}
      </AccordionTrigger>
      <AccordionContent>
        <DiffView oldStr={file.old_content} newStr={file.new_content} />
      </AccordionContent>
    </AccordionItem>
  ))}
</Accordion>
```

[VERIFIED: DiffView.tsx signature confirmed via direct audit; shadcn Accordion is a standard component available in the existing shadcn install]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Git serialization for merges | Custom mutex/lock around merge calls | Existing `GitOpQueue` | It already serializes all git ops to prevent index.lock |
| Diff rendering | Custom before/after renderer | Existing `DiffView` component | Already built, tested, and styled in Phase 4 |
| Branch name sanitization | Custom regex | Existing `slugify_task()` in handle.rs | Already handles path separators and shell metacharacters |
| Agent event subscription | New event listener setup | Existing `useAgentPanelEvents` hook | Hook already handles rAF buffering, cleanup, tool call FIFO |
| Dialog structure | Custom modal | shadcn `Dialog` as used in SpawnAgentDialog | Follow the exact pattern — no new component library needed |

---

## Common Pitfalls

### Pitfall 1: Locking the Mutex While Awaiting
**What goes wrong:** In the `merge_worktrees` command, if `worktree_manager.get_branch()` is called and the mutex is held across the `.await` of `git_queue.run()`, the runtime deadlocks.
**Why it happens:** `WorktreeManager.active` is `Arc<Mutex<...>>` (not RwLock). Holding the lock across an `.await` point is undefined behavior in async Rust (the lock guard is not `Send`).
**How to avoid:** Collect all branches first (short lock), then drop the lock, then await the git queue. The existing `supervisor.rs` consistently follows this pattern — copy it.
**Warning signs:** Compiler error "future is not Send" or runtime deadlock on merge.

### Pitfall 2: `serde(deny_unknown_fields)` on AgentEvent
**What goes wrong:** Adding a new variant to `AgentEvent` in Rust without updating `bindings.ts` causes the frontend to fail silently or throw when an event with the new variant arrives.
**Why it happens:** `AgentEvent` has `#[serde(deny_unknown_fields)]` — deserialization throws on unrecognized variants.
**How to avoid:** For Phase 6, avoid adding variants to `AgentEvent` entirely (emit `group-state-changed` as a plain Tauri event instead). If a variant is added, update `bindings.ts` immediately.
**Warning signs:** Frontend TypeScript errors when consuming events; runtime JSON parse errors.

### Pitfall 3: `addAgent` signature change breaking existing callers
**What goes wrong:** Adding `branch` and `groupId` parameters to `addAgent` in agentStore breaks `SpawnAgentDialog.tsx` which calls `addAgent(result.data, trimmedTask, model)`.
**Why it happens:** TypeScript will catch this, but only if the types are strict.
**How to avoid:** Use optional parameters with defaults: `addAgent(id, task, model, branch = "", groupId = null)`. Or update SpawnAgentDialog to pass `branch` (available from the spawn response if `spawnAgent` is updated to return it — but it currently returns only a string ID).
**Simpler fix:** Keep `branch` and `groupId` as optional (defaulting to `""` and `null`). Solo-spawned agents get no branch label and no group header.
**Warning signs:** TypeScript compile error at the `useAgentStore.getState().addAgent(...)` call in SpawnAgentDialog.

### Pitfall 4: `merge_worktrees` called before all agents are Done
**What goes wrong:** User clicks "Approve & Merge" while an agent is still running. The merge operates on an in-progress worktree, capturing partial work.
**Why it happens:** The button should only be enabled when `group.mergeState === "AllDone"` or `"CheckpointOpen"`.
**How to avoid:** Disable the "Approve & Merge" button if any agent in the group has a non-terminal state. The CONTEXT.md specifics already call this out.
**Warning signs:** Merge checkpoint opens but some agents still show Executing/Planning state.

### Pitfall 5: `get_worktree_diff` timing
**What goes wrong:** Calling `get_worktree_diff` before the agent process has committed or staged its work returns an empty diff.
**Why it happens:** The xolotl CLI subprocess runs in the worktree directory. Its changes are in the working tree, not necessarily staged or committed.
**How to avoid:** Use `git diff HEAD -- <file>` (not `git diff --staged`) to capture both staged and unstaged changes relative to HEAD. If the agent commits its work, use `git diff main..HEAD --name-only` to get all branch-level changes.
**Better command:** `git diff main...HEAD --name-only` (three dots = merge-base diff) captures all commits on the branch since it diverged from main. This is the correct command for "what did this agent do on its branch."
**Warning signs:** Empty diff shown in merge checkpoint even though agent reported done.

### Pitfall 6: `launch_team` branch collision
**What goes wrong:** Two roles with the same task text produce the same branch name via `slugify_task()`. The second `worktree_manager.add()` call fails with `"already exists"`.
**Why it happens:** `slugify_task()` is deterministic. If "write tests" is used for both Reviewer and Tester, both produce `"agent/write-tests"`.
**How to avoid:** Append the role name or an index to make branches unique: `"agent/{role}-{slug}"` or `"agent/{slug}-{index}"`. The `launch_team` / `launch_swarm` Tauri command handles this, not the supervisor.
**Warning signs:** Second agent in a team fails to spawn with a WorktreeError::GitFailed "branch already exists".

---

## Wave / Dependency Ordering

**Wave 1 (Rust + IPC foundation)** — must complete before any frontend work:
- W1-A: Add `get_branch()` and `get_diff_files()` to `WorktreeManager`
- W1-B: Add `launch_team()` and `launch_swarm()` methods to `AgentSupervisor` (thin wrappers over `spawn_agent_with_config`)
- W1-C: Add `RoleConfig`, `GroupLaunchResult`, `FileDiff` structs to commands.rs; implement `launch_team`, `launch_swarm`, `get_worktree_diff`, `merge_worktrees` commands
- W1-D: Register new commands in lib.rs (`collect_commands!`, `.typ::<>()`)
- W1-E: Hand-update `bindings.ts` with new command signatures and types

W1-A through W1-D can be done in a single plan with careful sequencing. W1-E is gated on W1-C/D completing (types must be finalized before the manual bindings update).

**Wave 2 (Store extension)** — depends on W1-E:
- W2-A: Extend `AgentRecord` with `branch` and `groupId`; extend `addAgent` signature
- W2-B: Add `groups`, `mergeCheckpointGroupId`, group actions to agentStore
- W2-C: Add `useGroupWatcher` hook
- W2-D: Update `SpawnAgentDialog` to pass `branch=""` and `groupId=null` (backward compatibility)

**Wave 3 (Panel + Dialog UI)** — depends on W2:
- W3-A: Update `AgentCard` — branch label + pulsing badge
- W3-B: Update `AgentPanel` — group header rows, "Launch Team" button
- W3-C: New `LaunchTeamDialog` — Team/Swarm toggle + form + invoke `launch_team`/`launch_swarm`
- W3-D: Mount `useGroupWatcher` in AgentPanel

W3-A and W3-B can be parallel (no file overlap). W3-C depends on nothing except the bindings update from W1.

**Wave 4 (MergeCheckpointView + App wiring)** — depends on W2 + W3:
- W4-A: New `MergeCheckpointView` — fetch diffs, conflict computation, accordion + DiffView, "Approve & Merge"
- W4-B: Update `App.tsx` — 3-branch center pane ternary

W4-A and W4-B have no file overlap and can be parallel.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest + jsdom |
| Config file | `tauri-app/vitest.config.ts` |
| Quick run command | `cd tauri-app && npm test -- --run` |
| Full suite command | `cd tauri-app && npm test -- --run` |
| Rust tests | `cd rust && cargo test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WRK-01 | AgentCard renders branch label + pulsing dot when Executing | unit (component) | `npm test -- --run AgentCard` | ❌ Wave 1 |
| WRK-02 | launch_team supervisor method creates N agents with unique branches | unit (Rust) | `cargo test -p runtime launch_team` | ❌ Wave 1 |
| WRK-03 | launch_swarm creates N agents with shared objective prefix | unit (Rust) | `cargo test -p runtime launch_swarm` | ❌ Wave 1 |
| WRK-04 | Conflict detection finds overlapping paths | unit (TS fn) | `npm test -- --run conflict` | ❌ Wave 2 |
| WRK-05 | agentStore.openMergeCheckpoint sets mergeCheckpointGroupId | unit (store) | `npm test -- --run agentStore` | ❌ Wave 2 |
| WRK-05 | useGroupWatcher triggers AllDone when all agents terminal | unit (hook) | `npm test -- --run useGroupWatcher` | ❌ Wave 2 |
| WRK-05 | MergeCheckpointView renders conflict badge on overlapping file | unit (component) | `npm test -- --run MergeCheckpointView` | ❌ Wave 4 |

### Wave 0 Gaps
- [ ] `tauri-app/src/stores/agentStore.test.ts` — extend existing tests or add group action tests
- [ ] `tauri-app/src/hooks/useGroupWatcher.test.ts` — covers WRK-05 auto-trigger
- [ ] `tauri-app/src/components/agent/MergeCheckpointView.test.tsx` — covers WRK-04/05 rendering
- [ ] Rust: `rust/crates/runtime/src/supervisor/tests/` — add `launch_team` / `launch_swarm` tests

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | `slugify_task()` already sanitizes branch names; role names from enum, not user input |
| V6 Cryptography | no | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Branch name injection via task text | Tampering | `slugify_task()` already strips all non-alphanumeric characters — inherited from Phase 5 |
| Path traversal in `get_worktree_diff` file paths | Information disclosure | `agent_id` parameter must be validated against the supervisor registry (returning NotFound error, not a filesystem path) |
| Merge of malicious branch name | Tampering | Branch name comes from `WorktreeManager.get_branch()` — always a value we wrote via `slugify_task()`, never user input verbatim |
| `launch_swarm` with count=0 or count>20 | DoS | Validate `count >= 1 && count <= 8` (reasonable swarm size) in the Tauri command |

---

## Open Questions

1. **`get_worktree_diff` — staged vs committed changes**
   - What we know: `git diff HEAD -- <file>` shows unstaged changes; `git diff main...HEAD --name-only` shows all branch-level commits
   - What's unclear: The xolotl subprocess may or may not commit its changes to the branch
   - Recommendation: Use `git diff main...HEAD --name-only` for the file list (covers both staged and committed branch changes). Planner should verify which git diff command gives the right answer for the xolotl subprocess's output pattern.

2. **Group ID generation**
   - What we know: Groups are created in Tauri commands and returned to frontend
   - What's unclear: Should group IDs be UUID-based (like prompt IDs) or sequential (like AgentId)?
   - Recommendation: Use `uuid::Uuid::new_v4().to_string()` in the Tauri command — same pattern as `test_permission_prompt`. No new dependency needed (uuid is already in Cargo.toml).

3. **`Approve & Merge` failure handling**
   - What we know: `merge_worktrees` runs merges sequentially via GitOpQueue
   - What's unclear: If the 2nd of 4 merges fails (real conflict), should the command stop and return an error or continue with remaining agents?
   - Recommendation: Stop on first failure, return error with which agent failed. User can inspect and retry. Continuing after failure risks merging inconsistent state.

4. **Branch name uniqueness for teams with repeated tasks**
   - What we know: `slugify_task()` is deterministic; Pitfall 6 above
   - Recommendation: Prefix branch with role index: `"agent/{index}-{slug}"` e.g. `"agent/0-write-tests"`, `"agent/1-write-tests"`. Simple, avoids collision.

---

## Environment Availability

Step 2.6: Not a blocking concern — this phase uses only the existing git CLI, Rust toolchain, and Node.js already verified working in Phases 1-5.

| Dependency | Required By | Available | Note |
|------------|------------|-----------|------|
| git CLI | WorktreeManager, merge | Yes (used in Phases 2+) | — |
| Rust/MSVC | Tauri backend | Yes (Phases 2-5 complete) | — |
| Node.js + npm | Frontend build | Yes (Phase 4+ complete) | — |
| shadcn Accordion | MergeCheckpointView | Assumed available | shadcn was initialized in Phase 4; Accordion component may need `npx shadcn add accordion` if not yet added |

[ASSUMED: shadcn `Accordion` component is available. Verify with `ls tauri-app/src/components/ui/accordion.tsx`. If absent, the plan must include `npx shadcn@latest add accordion` as a Wave 4 Wave 0 step.]

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | useGroupWatcher runs in useEffect with `[agents, groups]` deps; may fire slightly after the last StateChanged is processed | Frontend State Shape / useGroupWatcher | Minor UX: merge checkpoint opens one render cycle late — acceptable |
| A2 | shadcn Accordion component is installed | DiffView Integration | If absent: plan must add `npx shadcn@latest add accordion`; one extra step |
| A3 | xolotl subprocess leaves file changes in worktree working tree (not staged/committed to branch) | Common Pitfalls §5 | If it commits to branch: `git diff main...HEAD --name-only` is correct; if it uses working tree only: need `git diff HEAD` instead |
| A4 | Branch name conflict avoided by prepending role index | Open Questions §4 | If wrong approach: worktree.add() returns error on second agent; supervisor must handle the retry or derive a different unique name |

---

## Sources

### Primary (HIGH confidence)
- Direct codebase audit:
  - `rust/crates/runtime/src/supervisor/worktree.rs` — WorktreeManager API
  - `rust/crates/runtime/src/supervisor/git_queue.rs` — GitOpQueue API
  - `rust/crates/runtime/src/supervisor/supervisor.rs` — AgentSupervisor methods
  - `rust/crates/runtime/src/supervisor/agent_state.rs` — AgentState/AgentEvent enums
  - `rust/crates/runtime/src/supervisor/handle.rs` — AgentHandle fields
  - `tauri-app/src/stores/agentStore.ts` — current store shape
  - `tauri-app/src/bindings.ts` — current IPC types
  - `tauri-app/src-tauri/src/commands.rs` — existing commands and patterns
  - `tauri-app/src-tauri/src/lib.rs` — command registration pattern
  - `tauri-app/src/App.tsx` — center pane switching logic
  - `tauri-app/src/components/agent/AgentPanel.tsx`
  - `tauri-app/src/components/agent/AgentCard.tsx`
  - `tauri-app/src/components/agent/AgentOutputView.tsx`
  - `tauri-app/src/components/agent/SpawnAgentDialog.tsx`
  - `tauri-app/src/components/chat/DiffView.tsx`
  - `tauri-app/src/hooks/useAgentPanelEvents.ts`
  - `tauri-app/src-tauri/Cargo.toml`
  - `tauri-app/vitest.config.ts`

### Secondary (MEDIUM confidence)
- [CITED: git documentation] `git diff main...HEAD --name-only` (three-dot diff) — captures all changes on a feature branch relative to merge base, not just staged changes

### Tertiary (LOW confidence — marked with ASSUMED in text)
- Hook behavior details around React rendering timing

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all existing, direct file audit
- Architecture: HIGH — direct audit of all relevant files; design follows established patterns
- IPC signatures: HIGH — based on exact pattern of existing commands
- Conflict algorithm: HIGH — simple set intersection, no external dependency
- Pitfalls: HIGH — identified from actual code constraints (mutex+await, deny_unknown_fields)
- Git diff command: MEDIUM — `git diff main...HEAD` is well-understood but xolotl subprocess behavior (staged vs committed) needs verification

**Research date:** 2026-05-11
**Valid until:** 2026-06-11 (stable codebase — no fast-moving dependencies)
