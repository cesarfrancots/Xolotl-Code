//! `AgentSupervisor` — central registry and lifecycle manager for supervised agents.
//!
//! Implements ORC-02: `spawn_agent()`, `list()`, `stop_agent()`, `stop_all()`.
//! Owns `WorktreeManager` (D-08) and `SharedContextStore`.
//! All public types are Send + Sync for Phase 3 Tauri managed state compatibility.

use crate::supervisor::handle::slugify_task;
use crate::supervisor::{
    AgentControl, AgentEvent, AgentHandle, AgentId, ContextError, GitOpQueue, SharedContextStore,
    WorktreeError, WorktreeManager,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::{broadcast, mpsc};

/// Errors from `AgentSupervisor` operations.
#[derive(Debug, thiserror::Error)]
pub enum SupervisorError {
    #[error("worktree error: {0}")]
    Worktree(#[from] WorktreeError),
    #[error("agent not found: {0}")]
    NotFound(AgentId),
    #[error("context store error: {0}")]
    Context(#[from] ContextError),
    #[error("invalid budget: {0}")]
    InvalidBudget(String),
}

/// Central supervisor owning all agent handles, worktrees, and shared context.
///
/// Clone to share across async tasks — the registry is behind Arc<Mutex<...>>.
/// Suitable for use as Tauri managed state (Send + Sync) in Phase 3.
#[derive(Clone)]
pub struct AgentSupervisor {
    /// Registry of all active agent handles, keyed by `AgentId`.
    registry: Arc<Mutex<HashMap<AgentId, AgentHandle>>>,
    /// Worktree manager — assigns one worktree per agent at spawn time (D-08).
    /// Public so Tauri commands can call `get_branch()`, `get_diff_files()`, `get_path()`, `remove()`.
    pub worktree_manager: WorktreeManager,
    /// Shared context store — agents publish/pull snapshots (ORC-04).
    pub context: SharedContextStore,
    /// Git operation queues per repo root (ORC-07).
    git_queues: Arc<Mutex<HashMap<PathBuf, GitOpQueue>>>,
    /// Root of the git repository — stored for `repo_root()` accessor used by merge commands.
    repo_root: PathBuf,
}

impl AgentSupervisor {
    /// Create a new supervisor rooted at `repo_root`.
    ///
    /// Calls `git worktree prune` at startup to clean up stale worktrees from previous runs.
    pub fn new(repo_root: impl AsRef<std::path::Path>) -> Self {
        let repo_root_path = repo_root.as_ref().to_path_buf();
        let worktree_manager = WorktreeManager::new(&repo_root_path);
        // Best-effort prune on startup — ignore error if repo is not a git repo
        let _ = worktree_manager.prune();

        Self {
            registry: Arc::new(Mutex::new(HashMap::new())),
            worktree_manager,
            context: SharedContextStore::new(),
            git_queues: Arc::new(Mutex::new(HashMap::new())),
            repo_root: repo_root_path,
        }
    }

    /// Return the git repository root path.
    #[must_use] 
    pub fn repo_root(&self) -> &std::path::Path {
        &self.repo_root
    }

    /// Spawn a new agent assigned to a fresh worktree on `branch`.
    ///
    /// Creates the dual-channel infrastructure (D-01), assigns a worktree (D-08),
    /// registers the handle, and starts the mpsc→broadcast re-broadcast loop.
    ///
    /// The `event_tx` mpsc sender is stored inside `AgentHandle` so the channel
    /// remains open as long as the handle lives in the registry. Worker tasks
    /// clone `handle.event_tx` to send events. The re-broadcast loop receives
    /// from `event_rx` and forwards to the broadcast channel for fan-out.
    ///
    /// Returns the `AgentId` of the new agent. The caller can retrieve the handle
    /// via `get_handle()` to subscribe or send control signals.
    ///
    /// # Errors
    /// Returns `SupervisorError::Worktree` if `git worktree add` fails.
    pub fn spawn_agent(&self, branch: &str) -> Result<AgentId, SupervisorError> {
        let agent_id = AgentId::new();

        // Assign a worktree before creating channels
        let worktree_path = self.worktree_manager.add(&agent_id, branch)?;

        // Create the dual-channel infrastructure (D-01)
        // event_tx is stored in AgentHandle — do NOT name it _event_tx or drop it here.
        // Dropping event_tx here closes the mpsc channel and the re-broadcast loop exits immediately.
        let (event_tx, mut event_rx) = mpsc::channel::<AgentEvent>(64);
        let (broadcast_tx, _) = broadcast::channel::<AgentEvent>(64);
        let (cancel_tx, _cancel_rx) = mpsc::channel::<AgentControl>(8);

        let handle = AgentHandle::new(
            agent_id.clone(),
            worktree_path,
            event_tx, // stored in handle — keeps channel alive
            broadcast_tx.clone(),
            cancel_tx,
        );

        // Re-broadcast loop: mpsc events → broadcast fan-out
        // IMPORTANT: lock → clone broadcast_tx → drop lock → spawn (Pitfall 1: no await while locked)
        let broadcast_tx_clone = broadcast_tx.clone();
        tokio::spawn(async move {
            while let Some(event) = event_rx.recv().await {
                // Silently discard if no subscribers (Phase 3 not yet subscribed) — expected
                let _ = broadcast_tx_clone.send(event);
            }
            // Loop exits only when all event_tx senders are dropped (agent stopped)
        });

        // Register after all resources are created
        {
            let mut registry = self.registry.lock().unwrap();
            registry.insert(agent_id.clone(), handle);
        } // lock released here — no await below this block

        Ok(agent_id)
    }

    /// Spawn a new agent with full task/model/budget configuration.
    ///
    /// Like `spawn_agent` but populates the handle's task, model, and budget fields,
    /// enabling per-agent cost tracking and budget enforcement (AGT-05, AGT-06).
    ///
    /// # Errors
    /// - `SupervisorError::InvalidBudget` if `budget_dollars` is Some(b) where b is
    ///   non-positive or non-finite (T-5-01 mitigation).
    /// - `SupervisorError::Worktree` if `git worktree add` fails.
    pub fn spawn_agent_with_config(
        &self,
        branch: &str,
        task: &str,
        model: &str,
        budget_dollars: Option<f64>,
    ) -> Result<AgentId, SupervisorError> {
        // T-5-01: validate budget is positive and finite before touching any resources
        if let Some(b) = budget_dollars {
            if !b.is_finite() || b <= 0.0 {
                return Err(SupervisorError::InvalidBudget(format!(
                    "budget must be > 0 and finite, got {b}"
                )));
            }
        }

        let agent_id = AgentId::new();
        let worktree_path = self.worktree_manager.add(&agent_id, branch)?;

        let (event_tx, mut event_rx) = mpsc::channel::<AgentEvent>(64);
        let (broadcast_tx, _) = broadcast::channel::<AgentEvent>(64);
        let (cancel_tx, _cancel_rx) = mpsc::channel::<AgentControl>(8);

        let handle = AgentHandle::new_with_config(
            agent_id.clone(),
            worktree_path,
            event_tx,
            broadcast_tx.clone(),
            cancel_tx,
            task.to_string(),
            model.to_string(),
            budget_dollars,
        );

        let broadcast_tx_clone = broadcast_tx.clone();
        tokio::spawn(async move {
            while let Some(event) = event_rx.recv().await {
                let _ = broadcast_tx_clone.send(event);
            }
        });

        {
            let mut registry = self.registry.lock().unwrap();
            registry.insert(agent_id.clone(), handle);
        }

        Ok(agent_id)
    }

    /// Return the `AgentId` list of all currently registered agents.
    #[must_use] 
    pub fn list(&self) -> Vec<AgentId> {
        let registry = self.registry.lock().unwrap();
        registry.keys().cloned().collect()
    }

    /// Get a clone of the `AgentHandle` for `agent_id`, if it exists.
    #[must_use] 
    pub fn get_handle(&self, agent_id: &AgentId) -> Option<AgentHandle> {
        let registry = self.registry.lock().unwrap();
        registry.get(agent_id).cloned()
    }

    /// Stop and deregister an agent.
    ///
    /// Sends Stop control signal, removes the handle from the registry,
    /// and releases the assigned worktree.
    ///
    /// # Errors
    /// Returns `SupervisorError::NotFound` if the agent is not registered.
    pub async fn stop_agent(&self, agent_id: &AgentId) -> Result<(), SupervisorError> {
        // Lock, clone the handle, drop lock — then await (Pitfall 1: no lock across .await)
        let handle = {
            let registry = self.registry.lock().unwrap();
            registry
                .get(agent_id)
                .cloned()
                .ok_or_else(|| SupervisorError::NotFound(agent_id.clone()))?
        };

        handle.stop().await;

        // Remove from registry
        {
            let mut registry = self.registry.lock().unwrap();
            registry.remove(agent_id);
        }

        // Release worktree (best-effort — log on failure)
        if let Err(e) = self.worktree_manager.remove(agent_id) {
            eprintln!("warn: failed to remove worktree for {agent_id}: {e}");
        }

        Ok(())
    }

    /// Stop all registered agents and clear the registry.
    pub async fn stop_all(&self) {
        let agent_ids: Vec<AgentId> = {
            let registry = self.registry.lock().unwrap();
            registry.keys().cloned().collect()
        };
        for agent_id in agent_ids {
            let _ = self.stop_agent(&agent_id).await;
        }
    }

    /// Get or create a `GitOpQueue` for `repo_root`.
    ///
    /// Queues are keyed by canonical repo root path to ensure per-repo serialization (ORC-07).
    pub fn git_queue_for(&self, repo_root: PathBuf) -> GitOpQueue {
        let mut queues = self.git_queues.lock().unwrap();
        queues
            .entry(repo_root)
            .or_insert_with(GitOpQueue::start)
            .clone()
    }

    /// Launch a role-based team: spawn one agent per role tuple (`role_name`, task, model).
    ///
    /// Branch names use `"agent/{index}-{slug}"` to prevent collision when roles share
    /// task text (Pitfall 6 from research doc). The group concept lives entirely in the
    /// frontend — this method just allocates agents and returns IDs.
    ///
    /// Returns `(group_id, agent_ids, branches)`.
    pub fn launch_team(
        &self,
        roles: Vec<(String, String, String)>,
    ) -> Result<(String, Vec<AgentId>, Vec<String>), SupervisorError> {
        let group_id = uuid::Uuid::new_v4().to_string();
        let mut agent_ids = Vec::with_capacity(roles.len());
        let mut branches = Vec::with_capacity(roles.len());
        for (index, (_role, task, model)) in roles.iter().enumerate() {
            let slug = slugify_task(task);
            let branch = format!("agent/{index}-{slug}");
            let agent_id = self.spawn_agent_with_config(&branch, task, model, None)?;
            agent_ids.push(agent_id);
            branches.push(branch);
        }
        Ok((group_id, agent_ids, branches))
    }

    /// Launch a swarm: spawn `count` identical agents with a shared objective.
    ///
    /// Validates count is between 1 and 8 (inclusive) — T-06-01 mitigation.
    /// Branch names use `"agent/{index}-{slug}"` to prevent collision (Pitfall 6).
    ///
    /// Returns `(group_id, agent_ids, branches)`.
    pub fn launch_swarm(
        &self,
        count: u32,
        objective: String,
        model: String,
    ) -> Result<(String, Vec<AgentId>, Vec<String>), SupervisorError> {
        if !(1..=8).contains(&count) {
            return Err(SupervisorError::InvalidBudget(format!(
                "swarm count must be 1–8, got {count}"
            )));
        }
        let group_id = uuid::Uuid::new_v4().to_string();
        let mut agent_ids = Vec::with_capacity(count as usize);
        let mut branches = Vec::with_capacity(count as usize);
        for index in 0..count {
            let slug = slugify_task(&objective);
            let branch = format!("agent/{index}-{slug}");
            let agent_id = self.spawn_agent_with_config(&branch, &objective, &model, None)?;
            agent_ids.push(agent_id);
            branches.push(branch);
        }
        Ok((group_id, agent_ids, branches))
    }
}

impl std::fmt::Debug for AgentSupervisor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let count = self.registry.lock().map_or(0, |r| r.len());
        write!(f, "AgentSupervisor {{ agents: {count} }}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Create a temp git repo and return (TempDir, repo_root).
    fn make_temp_git_repo() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().to_path_buf();
        std::process::Command::new("git")
            .args(["init"])
            .current_dir(&path)
            .output()
            .expect("git init");
        std::process::Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(&path)
            .output()
            .expect("config email");
        std::process::Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(&path)
            .output()
            .expect("config name");
        std::fs::write(path.join("README.md"), "test").expect("write");
        std::process::Command::new("git")
            .args(["add", "."])
            .current_dir(&path)
            .output()
            .expect("git add");
        std::process::Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(&path)
            .output()
            .expect("git commit");
        (dir, path)
    }

    #[test]
    fn supervisor_list_empty_initially() {
        let (_dir, repo) = make_temp_git_repo();
        let supervisor = AgentSupervisor::new(&repo);
        assert!(supervisor.list().is_empty());
    }

    #[tokio::test]
    async fn supervisor_spawn_agent_registers_handle() {
        let (_dir, repo) = make_temp_git_repo();
        let supervisor = AgentSupervisor::new(&repo);

        let id = supervisor
            .spawn_agent("feature-branch-1")
            .expect("spawn ok");
        let list = supervisor.list();

        assert_eq!(list.len(), 1);
        assert!(list.contains(&id));
    }

    #[tokio::test]
    async fn supervisor_spawn_multiple_agents() {
        let (_dir, repo) = make_temp_git_repo();
        let supervisor = AgentSupervisor::new(&repo);

        let id1 = supervisor.spawn_agent("branch-a").expect("spawn 1");
        let id2 = supervisor.spawn_agent("branch-b").expect("spawn 2");

        let list = supervisor.list();
        assert_eq!(list.len(), 2);
        assert!(list.contains(&id1));
        assert!(list.contains(&id2));
    }

    #[tokio::test]
    async fn supervisor_get_handle_returns_handle() {
        let (_dir, repo) = make_temp_git_repo();
        let supervisor = AgentSupervisor::new(&repo);

        let id = supervisor.spawn_agent("handle-branch").expect("spawn");
        let handle = supervisor.get_handle(&id);
        assert!(handle.is_some());
        assert_eq!(handle.unwrap().agent_id, id);
    }

    #[tokio::test]
    async fn supervisor_stop_agent_removes_from_registry() {
        let (_dir, repo) = make_temp_git_repo();
        let supervisor = AgentSupervisor::new(&repo);

        let id = supervisor.spawn_agent("stop-branch").expect("spawn");
        assert_eq!(supervisor.list().len(), 1);

        supervisor.stop_agent(&id).await.expect("stop ok");
        assert!(supervisor.list().is_empty());
    }

    #[tokio::test]
    async fn supervisor_stop_all_clears_registry() {
        let (_dir, repo) = make_temp_git_repo();
        let supervisor = AgentSupervisor::new(&repo);

        supervisor.spawn_agent("all-a").expect("spawn a");
        supervisor.spawn_agent("all-b").expect("spawn b");
        assert_eq!(supervisor.list().len(), 2);

        supervisor.stop_all().await;
        assert!(supervisor.list().is_empty());
    }

    // --- Phase 6 tests: launch_team / launch_swarm ---

    #[test]
    fn launch_swarm_rejects_zero() {
        let (_dir, repo) = make_temp_git_repo();
        let sup = AgentSupervisor::new(&repo);
        let result = sup.launch_swarm(0, "objective".into(), "claude-haiku".into());
        assert!(result.is_err(), "count=0 must be rejected");
        assert!(matches!(result, Err(SupervisorError::InvalidBudget(_))));
    }

    #[test]
    fn launch_swarm_rejects_nine() {
        let (_dir, repo) = make_temp_git_repo();
        let sup = AgentSupervisor::new(&repo);
        let result = sup.launch_swarm(9, "objective".into(), "claude-haiku".into());
        assert!(result.is_err(), "count=9 must be rejected");
        assert!(matches!(result, Err(SupervisorError::InvalidBudget(_))));
    }

    // --- New tests for Task 2 (Phase 5) ---

    #[tokio::test]
    async fn spawn_with_config_stores_task_model_budget() {
        let (_dir, repo) = make_temp_git_repo();
        let supervisor = AgentSupervisor::new(&repo);

        let id = supervisor
            .spawn_agent_with_config("feat-x", "do thing", "claude-sonnet-4", Some(0.5))
            .expect("spawn_with_config ok");

        let handle = supervisor.get_handle(&id).expect("handle exists");
        assert_eq!(handle.task, "do thing");
        assert_eq!(handle.model, "claude-sonnet-4");
        assert_eq!(handle.budget_dollars, Some(0.5));
    }

    #[tokio::test]
    async fn spawn_with_config_rejects_negative_budget() {
        let (_dir, repo) = make_temp_git_repo();
        let supervisor = AgentSupervisor::new(&repo);

        let result =
            supervisor.spawn_agent_with_config("feat-neg", "task", "claude-haiku", Some(-1.0));

        assert!(
            matches!(result, Err(SupervisorError::InvalidBudget(_))),
            "expected InvalidBudget, got: {:?}",
            result
        );
        assert!(
            supervisor.list().is_empty(),
            "no handle should be registered on error"
        );
    }

    #[tokio::test]
    async fn spawn_with_config_rejects_nan_budget() {
        let (_dir, repo) = make_temp_git_repo();
        let supervisor = AgentSupervisor::new(&repo);

        let result =
            supervisor.spawn_agent_with_config("feat-nan", "task", "claude-haiku", Some(f64::NAN));

        assert!(matches!(result, Err(SupervisorError::InvalidBudget(_))));
        assert!(supervisor.list().is_empty());
    }

    #[tokio::test]
    async fn spawn_with_config_rejects_infinite_budget() {
        let (_dir, repo) = make_temp_git_repo();
        let supervisor = AgentSupervisor::new(&repo);

        let result = supervisor.spawn_agent_with_config(
            "feat-inf",
            "task",
            "claude-haiku",
            Some(f64::INFINITY),
        );

        assert!(matches!(result, Err(SupervisorError::InvalidBudget(_))));
        assert!(supervisor.list().is_empty());
    }

    #[tokio::test]
    async fn spawn_with_config_allows_none_budget() {
        let (_dir, repo) = make_temp_git_repo();
        let supervisor = AgentSupervisor::new(&repo);

        let id = supervisor
            .spawn_agent_with_config("feat-none-budget", "unlimited task", "claude-haiku", None)
            .expect("spawn with None budget should succeed");

        let handle = supervisor.get_handle(&id).expect("handle exists");
        assert!(
            handle.budget_dollars.is_none(),
            "budget should be None (unlimited)"
        );
    }

    /// ORC-02: Verify the event bus works end-to-end.
    ///
    /// This test was missing in the original plan — the checker identified that
    /// event_tx was being dropped (named _event_tx), closing the channel before
    /// any event could flow. This test catches that regression: it sends an event
    /// via event_tx and asserts it arrives at a broadcast subscriber.
    #[tokio::test]
    async fn orc02_event_tx_flows_to_broadcast_subscriber() {
        use crate::usage::TokenUsage;

        let (_dir, repo) = make_temp_git_repo();
        let supervisor = AgentSupervisor::new(&repo);

        let id = supervisor
            .spawn_agent("orc02-event-bus-branch")
            .expect("spawn");
        let handle = supervisor
            .get_handle(&id)
            .expect("handle exists after spawn");

        // Subscribe BEFORE sending so we don't miss the event
        let mut subscriber = handle.subscribe();

        // Send an event via event_tx (the path that was broken when event_tx was _event_tx)
        handle
            .event_tx
            .send(AgentEvent::TurnCompleted {
                usage: TokenUsage {
                    input_tokens: 10,
                    output_tokens: 5,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0,
                },
            })
            .await
            .expect("event_tx send must succeed — channel is open because AgentHandle holds it");

        // Event must arrive at the broadcast subscriber via the re-broadcast loop
        let received = tokio::time::timeout(std::time::Duration::from_secs(1), subscriber.recv())
            .await
            .expect("event arrived within 1s — no timeout")
            .expect("no broadcast channel error");

        assert!(
            matches!(received, AgentEvent::TurnCompleted { .. }),
            "expected TurnCompleted, got: {received:?}"
        );
    }
}
