//! Serialized git operation queue — prevents index.lock conflicts between parallel agents.
//!
//! One `GitOpQueue` per repo root. `AgentSupervisor` holds `HashMap`<`PathBuf`, `GitOpQueue`>.
//! Each queue runs git commands sequentially in a dedicated tokio task (ORC-07).

use std::path::PathBuf;
use tokio::sync::{mpsc, oneshot};

/// A single git operation to be run by the queue.
pub struct GitOp {
    /// git subcommand and arguments (e.g., ["commit", "-m", "message"]).
    /// The queue always uses `git` as the executable.
    pub command: Vec<String>,
    /// Working directory for the git command.
    pub cwd: PathBuf,
    /// Channel to return the result to the caller.
    pub result_tx: oneshot::Sender<Result<std::process::Output, std::io::Error>>,
}

/// Serialized git operation queue for a single repo root.
///
/// Clone to share the queue sender across multiple callers.
/// The background task shuts down when all senders are dropped.
#[derive(Clone)]
pub struct GitOpQueue {
    sender: mpsc::Sender<GitOp>,
}

impl GitOpQueue {
    /// Start the background queue task and return a handle to submit operations.
    ///
    /// The queue task runs git commands sequentially inside `spawn_blocking` to avoid
    /// blocking the tokio worker thread (avoids Pitfall 4 from research doc).
    #[must_use]
    pub fn start() -> Self {
        let (tx, mut rx) = mpsc::channel::<GitOp>(32);
        tokio::spawn(async move {
            while let Some(op) = rx.recv().await {
                let command = op.command.clone();
                let cwd = op.cwd.clone();
                let result = tokio::task::spawn_blocking(move || {
                    std::process::Command::new("git")
                        .args(&command)
                        .current_dir(&cwd)
                        .output()
                })
                .await
                .unwrap_or_else(|e| Err(std::io::Error::other(e.to_string())));
                // Ignore send error — caller may have dropped the receiver
                let _ = op.result_tx.send(result);
            }
        });
        Self { sender: tx }
    }

    /// Submit a git operation and await its result.
    ///
    /// Commands run sequentially in the queue — concurrent callers are serialized.
    /// This prevents `index.lock` conflicts when multiple agents write to the same repo.
    ///
    /// # Arguments
    /// * `command` — git subcommand + args (e.g., `vec!["add", "."]`)
    /// * `cwd` — repo root or worktree path to run git from
    pub async fn run(
        &self,
        command: Vec<String>,
        cwd: PathBuf,
    ) -> Result<std::process::Output, std::io::Error> {
        let (result_tx, result_rx) = oneshot::channel();
        self.sender
            .send(GitOp {
                command,
                cwd,
                result_tx,
            })
            .await
            .map_err(|_| std::io::Error::other("git queue closed"))?;
        result_rx
            .await
            .map_err(|_| std::io::Error::other("git queue dropped result"))?
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn git_queue_start_and_run_git_version() {
        let queue = GitOpQueue::start();
        // `git version` is safe to run anywhere — no repo context needed
        let output = queue
            .run(vec!["version".to_string()], std::env::temp_dir())
            .await
            .expect("git version should succeed");
        assert!(output.status.success(), "git version should exit 0");
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(stdout.contains("git"), "output should contain 'git'");
    }

    #[tokio::test]
    async fn git_queue_serializes_concurrent_ops() {
        use std::sync::{Arc, Mutex};

        let queue = GitOpQueue::start();
        let order: Arc<Mutex<Vec<u32>>> = Arc::new(Mutex::new(Vec::new()));

        let q1 = queue.clone();
        let order1 = order.clone();
        let h1 = tokio::spawn(async move {
            q1.run(vec!["version".to_string()], std::env::temp_dir())
                .await
                .unwrap();
            order1.lock().unwrap().push(1);
        });

        let q2 = queue.clone();
        let order2 = order.clone();
        let h2 = tokio::spawn(async move {
            q2.run(vec!["version".to_string()], std::env::temp_dir())
                .await
                .unwrap();
            order2.lock().unwrap().push(2);
        });

        let _ = tokio::join!(h1, h2);

        // Both completed — order may vary but neither panicked
        let completed = order.lock().unwrap();
        assert_eq!(completed.len(), 2);
    }
}
