//! Per-task benchmark runner.
//!
//! Each task runs through the real [`runtime::ConversationRuntime`] loop inside
//! an isolated working directory seeded from an in-memory snapshot. The loop
//! drives a real tool executor ([`RealToolExecutor`], backed by
//! `tools::execute_tool`) so edits actually hit disk, and a fresh
//! [`CountingRecorder`] captures the metrics.
//!
//! Isolation (blocker B2): we write the seed snapshot into the working dir and
//! do **not** reuse `runtime::WorktreeManager` (which requires a git repo).
//! Tasks that need a real repository will `git init` the working dir in
//! checkpoint 0.2; no skeleton fixture needs it yet.
//!
//! The runner is generic over [`runtime::ApiClient`]: the unit test drives it
//! with a scripted client (no network), and checkpoint 0.2 wires the real
//! provider clients for live runs.

use std::path::Path;
use std::sync::Arc;

use runtime::{
    ApiClient, ConversationRuntime, PermissionMode, PermissionPolicy, Session, ToolError,
    ToolExecutor,
};

use crate::recorder::{CountingRecorder, Metrics};

/// One seed file written into a task's isolated working directory.
#[derive(Debug, Clone)]
pub struct SeedFile {
    /// Path relative to the working directory.
    pub rel_path: String,
    pub contents: String,
}

/// A benchmark task: a prompt plus the seed files it operates on.
#[derive(Debug, Clone)]
pub struct TaskSpec {
    pub name: String,
    pub prompt: String,
    pub seed_files: Vec<SeedFile>,
}

/// The result of running one task against one model.
#[derive(Debug, Clone)]
pub struct RunOutcome {
    pub task_name: String,
    /// Whether the conversation loop terminated without error.
    pub completed: bool,
    pub iterations: usize,
    pub metrics: Metrics,
    /// The loop error, if it failed.
    pub error: Option<String>,
}

/// A [`ToolExecutor`] backed by the production `tools::execute_tool` dispatch.
///
/// Path resolution caveat (CP 0.2 prerequisite): `execute_tool` resolves
/// *relative* paths against the process's current working directory, which this
/// executor does not change. The offline test uses absolute paths into the task
/// dir, so isolation holds. Live runs (CP 0.2), where the model emits relative
/// paths, must resolve this — by running each task in its own process, by
/// rewriting model paths to absolute, or by a working-dir-aware executor.
/// Setting the process CWD globally here is unsafe under the parallel test
/// harness, so it is deliberately deferred.
#[derive(Clone, Default)]
pub struct RealToolExecutor;

impl ToolExecutor for RealToolExecutor {
    fn execute(&mut self, tool_name: &str, input: &str) -> Result<String, ToolError> {
        let value: serde_json::Value = serde_json::from_str(input)
            .map_err(|err| ToolError::new(format!("invalid tool input json: {err}")))?;
        tools::execute_tool(tool_name, &value).map_err(ToolError::new)
    }
}

/// Run a single task through the real loop in `working_dir`, returning captured
/// metrics. Generic over the API client so the harness's own test uses a
/// scripted (offline) client while live runs pass a real provider client.
///
/// # Errors
/// Returns an error only if seeding the working directory fails; a loop failure
/// is reported in [`RunOutcome::completed`]/[`RunOutcome::error`], not as `Err`.
pub fn run_task<C: ApiClient>(
    task: &TaskSpec,
    working_dir: &Path,
    api_client: C,
) -> std::io::Result<RunOutcome> {
    seed_working_dir(working_dir, &task.seed_files)?;

    let recorder = Arc::new(CountingRecorder::new());
    let mut runtime = ConversationRuntime::new(
        Session::new(),
        api_client,
        RealToolExecutor,
        PermissionPolicy::new(PermissionMode::Allow),
        vec!["You are a coding agent running a benchmark task.".to_string()],
    )
    .with_bench_recorder(recorder.clone());

    let (completed, iterations, error) = match runtime.run_turn(task.prompt.as_str(), None) {
        Ok(summary) => (true, summary.iterations, None),
        Err(err) => (false, 0, Some(err.to_string())),
    };

    Ok(RunOutcome {
        task_name: task.name.clone(),
        completed,
        iterations,
        metrics: recorder.snapshot(),
        error,
    })
}

fn seed_working_dir(working_dir: &Path, seeds: &[SeedFile]) -> std::io::Result<()> {
    std::fs::create_dir_all(working_dir)?;
    for seed in seeds {
        let dest = working_dir.join(&seed.rel_path);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(dest, &seed.contents)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{run_task, SeedFile, TaskSpec};
    use runtime::{ApiClient, ApiRequest, AssistantEvent, RuntimeError};
    use std::path::PathBuf;

    /// Scripts one `edit_file` tool call against a known absolute path, then a
    /// final text reply. Absolute path keeps the test independent of the global
    /// working directory.
    struct ScriptedEditRunnerClient {
        edit_path: String,
        call_count: usize,
    }

    impl ApiClient for ScriptedEditRunnerClient {
        fn stream(&mut self, _request: ApiRequest) -> Result<Vec<AssistantEvent>, RuntimeError> {
            self.call_count += 1;
            if self.call_count == 1 {
                let input = serde_json::json!({
                    "path": self.edit_path,
                    "old_string": "hello",
                    "new_string": "goodbye",
                })
                .to_string();
                Ok(vec![
                    AssistantEvent::ToolUse {
                        id: "edit-1".to_string(),
                        name: "edit_file".to_string(),
                        input,
                    },
                    AssistantEvent::MessageStop,
                ])
            } else {
                Ok(vec![
                    AssistantEvent::TextDelta("done".to_string()),
                    AssistantEvent::MessageStop,
                ])
            }
        }
    }

    fn unique_temp_dir(tag: &str) -> PathBuf {
        // Process id + a monotonic counter keeps the path unique even when the
        // test harness runs multiple tests concurrently in one process.
        use std::sync::atomic::{AtomicU64, Ordering};
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let seq = SEQ.fetch_add(1, Ordering::Relaxed);
        let mut dir = std::env::temp_dir();
        dir.push(format!("xolotl-bench-{tag}-{}-{seq}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn runner_applies_edit_in_isolated_dir() {
        let working_dir = unique_temp_dir("runner-applies-edit");
        let note_path = working_dir.join("note.txt");
        let task = TaskSpec {
            name: "edit-note".to_string(),
            prompt: "change hello to goodbye in note.txt".to_string(),
            seed_files: vec![SeedFile {
                rel_path: "note.txt".to_string(),
                contents: "hello world".to_string(),
            }],
        };
        let client = ScriptedEditRunnerClient {
            edit_path: note_path.to_string_lossy().into_owned(),
            call_count: 0,
        };

        let outcome = run_task(&task, &working_dir, client).expect("run_task io");

        assert!(
            outcome.completed,
            "task should complete: {:?}",
            outcome.error
        );
        assert_eq!(outcome.metrics.tool_calls, 1);
        assert_eq!(outcome.metrics.edits_applied, 1);
        let final_contents = std::fs::read_to_string(&note_path).expect("read edited file");
        assert_eq!(final_contents, "goodbye world");

        let _ = std::fs::remove_dir_all(&working_dir);
    }
}
