//! WorktreeManager: creates, lists, and removes git worktrees for agent isolation.
//!
//! Each agent is assigned exactly one worktree at spawn time (D-08).
//! The supervisor owns this manager and calls add() / remove() as agents start and stop.
//!
//! Worktrees base directory: <repo_root>/.xolotl-worktrees/
//! Add .xolotl-worktrees/ to .gitignore to prevent git from tracking worktree dirs.

use crate::supervisor::AgentId;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// Errors from WorktreeManager git operations.
#[derive(Debug, thiserror::Error)]
pub enum WorktreeError {
    #[error("git worktree command failed: {0}")]
    GitFailed(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("no worktree assigned to agent {0}")]
    NotAssigned(AgentId),
}

/// Manages git worktrees for agent isolation.
///
/// Cloning this struct shares the same underlying `active` map — suitable for
/// passing to supervisor tasks that need to release worktrees on agent completion.
#[derive(Clone)]
pub struct WorktreeManager {
    /// Root of the git repository (where `.git/` lives).
    repo_root: PathBuf,
    /// Base directory for all agent worktrees: <repo_root>/.xolotl-worktrees/
    worktrees_base: PathBuf,
    /// Map from AgentId to the assigned worktree path.
    active: Arc<Mutex<HashMap<AgentId, PathBuf>>>,
}

impl WorktreeManager {
    /// Create a new manager rooted at `repo_root`.
    ///
    /// Creates the `.xolotl-worktrees/` directory if it does not exist.
    /// Does NOT run `git worktree prune` — call `prune()` explicitly at startup.
    pub fn new(repo_root: impl AsRef<Path>) -> Self {
        let repo_root = repo_root.as_ref().to_path_buf();
        let worktrees_base = repo_root.join(".xolotl-worktrees");
        let _ = std::fs::create_dir_all(&worktrees_base);
        Self {
            repo_root,
            worktrees_base,
            active: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Create a new worktree for `agent_id` on a new branch `branch`.
    ///
    /// Worktree path: `<repo_root>/.xolotl-worktrees/<agent_id>`
    /// Runs: `git worktree add -b <branch> <path>`
    ///
    /// # Errors
    /// Returns `WorktreeError::GitFailed` if git exits non-zero.
    pub fn add(&self, agent_id: &AgentId, branch: &str) -> Result<PathBuf, WorktreeError> {
        let path = self.worktrees_base.join(agent_id.to_string());
        let path_str = path.to_str().unwrap_or_default();

        let output = std::process::Command::new("git")
            .args(["worktree", "add", "-b", branch, path_str])
            .current_dir(&self.repo_root)
            .output()?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
            return Err(WorktreeError::GitFailed(stderr));
        }

        let mut active = self.active.lock().unwrap();
        active.insert(agent_id.clone(), path.clone());
        Ok(path)
    }

    /// Remove the worktree assigned to `agent_id`.
    ///
    /// Runs: `git worktree remove --force <path>`
    /// Removes the entry from the active map even if git fails (best-effort cleanup).
    ///
    /// # Errors
    /// Returns `WorktreeError::NotAssigned` if `agent_id` has no active worktree.
    pub fn remove(&self, agent_id: &AgentId) -> Result<(), WorktreeError> {
        let path = {
            let mut active = self.active.lock().unwrap();
            active
                .remove(agent_id)
                .ok_or_else(|| WorktreeError::NotAssigned(agent_id.clone()))?
        };

        let path_str = path.to_str().unwrap_or_default();
        let output = std::process::Command::new("git")
            .args(["worktree", "remove", "--force", path_str])
            .current_dir(&self.repo_root)
            .output()?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
            return Err(WorktreeError::GitFailed(stderr));
        }

        Ok(())
    }

    /// Return all currently active (AgentId, worktree path) pairs.
    pub fn list(&self) -> Vec<(AgentId, PathBuf)> {
        let active = self.active.lock().unwrap();
        active.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    /// Prune stale worktree entries from git's internal state.
    ///
    /// Run at supervisor startup to clean up after a crash.
    /// Runs: `git worktree prune`
    pub fn prune(&self) -> Result<(), WorktreeError> {
        let output = std::process::Command::new("git")
            .args(["worktree", "prune"])
            .current_dir(&self.repo_root)
            .output()?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
            return Err(WorktreeError::GitFailed(stderr));
        }

        Ok(())
    }

    /// Return the worktree path assigned to `agent_id`, if any.
    pub fn get_path(&self, agent_id: &AgentId) -> Option<PathBuf> {
        let active = self.active.lock().unwrap();
        active.get(agent_id).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    /// Create a temporary git repo for testing.
    /// Returns (TempDir, repo_root path). TempDir must be kept alive for the test.
    fn make_temp_git_repo() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().to_path_buf();

        // Initialize the git repo with a commit so worktree add works
        Command::new("git")
            .args(["init"])
            .current_dir(&path)
            .output()
            .expect("git init");

        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(&path)
            .output()
            .expect("git config email");

        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(&path)
            .output()
            .expect("git config name");

        // Create initial commit (required for git worktree add)
        std::fs::write(path.join("README.md"), "test repo").expect("write README");
        Command::new("git")
            .args(["add", "."])
            .current_dir(&path)
            .output()
            .expect("git add");
        Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(&path)
            .output()
            .expect("git commit");

        (dir, path)
    }

    #[test]
    fn worktree_list_empty_initially() {
        let (_dir, repo) = make_temp_git_repo();
        let manager = WorktreeManager::new(&repo);
        assert!(manager.list().is_empty());
    }

    #[test]
    fn worktree_add_creates_entry_and_directory() {
        let (_dir, repo) = make_temp_git_repo();
        let manager = WorktreeManager::new(&repo);
        let agent_id = AgentId::new();

        let path = manager
            .add(&agent_id, "test-branch")
            .expect("worktree add should succeed");

        // Entry is in the active map
        let list = manager.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].0, agent_id);
        assert_eq!(list[0].1, path);

        // The worktree directory exists
        assert!(path.exists(), "worktree directory should exist");
    }

    #[test]
    fn worktree_remove_cleans_up_entry() {
        let (_dir, repo) = make_temp_git_repo();
        let manager = WorktreeManager::new(&repo);
        let agent_id = AgentId::new();

        manager
            .add(&agent_id, "remove-branch")
            .expect("add");
        assert_eq!(manager.list().len(), 1);

        manager.remove(&agent_id).expect("remove");
        assert!(manager.list().is_empty());
    }

    #[test]
    fn worktree_remove_unknown_agent_returns_err() {
        let (_dir, repo) = make_temp_git_repo();
        let manager = WorktreeManager::new(&repo);
        let agent_id = AgentId::new();

        let result = manager.remove(&agent_id);
        assert!(matches!(result, Err(WorktreeError::NotAssigned(_))));
    }

    #[test]
    fn worktree_prune_runs_without_error() {
        let (_dir, repo) = make_temp_git_repo();
        let manager = WorktreeManager::new(&repo);
        // prune on a clean repo should succeed
        assert!(manager.prune().is_ok());
    }

    #[test]
    fn worktree_clone_shares_active_map() {
        let (_dir, repo) = make_temp_git_repo();
        let manager1 = WorktreeManager::new(&repo);
        let manager2 = manager1.clone();
        let agent_id = AgentId::new();

        manager1.add(&agent_id, "clone-branch").expect("add");
        // manager2 sees the same entry
        assert_eq!(manager2.list().len(), 1);
    }
}
