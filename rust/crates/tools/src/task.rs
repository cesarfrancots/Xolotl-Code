use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Instant;

use serde::Serialize;

static TASK_COUNTER: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Clone)]
pub struct TaskSpec {
    pub description: String,
    pub prompt: String,
}

pub struct TaskRuntime {
    max_parallel: usize,
    running: Arc<AtomicUsize>,
    results_dir: PathBuf,
}

impl TaskRuntime {
    pub fn new(max_parallel: usize) -> Self {
        let results_dir = std::env::temp_dir().join("claw-tasks");
        let _ = fs::create_dir_all(&results_dir);
        Self {
            max_parallel,
            running: Arc::new(AtomicUsize::new(0)),
            results_dir,
        }
    }

    pub fn run_tasks(&self, tasks: Vec<TaskSpec>) -> Vec<TaskResult> {
        let mut handles = Vec::new();

        for spec in tasks {
            while self.running.load(Ordering::Relaxed) >= self.max_parallel {
                thread::sleep(std::time::Duration::from_millis(50));
            }
            self.running.fetch_add(1, Ordering::Relaxed);
            let running = self.running.clone();
            let results_dir = self.results_dir.clone();

            let handle = thread::spawn(move || {
                struct Guard(Arc<AtomicUsize>);
                impl Drop for Guard {
                    fn drop(&mut self) {
                        self.0.fetch_sub(1, Ordering::Relaxed);
                    }
                }
                let _guard = Guard(running);

                let task_id = TASK_COUNTER.fetch_add(1, Ordering::Relaxed);
                let result_path = results_dir.join(format!("task-{task_id}.json"));

                let started = Instant::now();
                let output = Self::run_subagent(&spec.prompt, &result_path);
                let elapsed = started.elapsed();

                TaskResult {
                    task_id,
                    description: spec.description,
                    success: output.is_ok(),
                    output: output.unwrap_or_else(|e| e),
                    elapsed_ms: u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX),
                }
            });
            handles.push(handle);
        }

        handles.into_iter().map(|h| h.join().unwrap()).collect()
    }

    fn run_subagent(prompt: &str, result_path: &PathBuf) -> Result<String, String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut child = Command::new(&exe)
            .arg("--print-output")
            .arg("--task-prompt")
            .arg(prompt)
            .arg("--task-output")
            .arg(result_path.to_str().unwrap_or(""))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("failed to spawn subagent: {e}"))?;

        let timeout = std::time::Duration::from_mins(5);
        let start = Instant::now();
        while start.elapsed() < timeout {
            if child.try_wait().is_ok_and(|w| w.is_some()) {
                break;
            }
            thread::sleep(std::time::Duration::from_millis(100));
        }

        if child.try_wait().map_or(true, |w| w.is_none()) {
            let _ = child.kill();
            return Err("task timed out after 5 minutes".to_string());
        }

        if result_path.exists() {
            fs::read_to_string(result_path).map_err(|e| e.to_string())
        } else {
            Err("task completed but no result file found".to_string())
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskResult {
    pub task_id: usize,
    pub description: String,
    pub success: bool,
    pub output: String,
    pub elapsed_ms: u64,
}

impl Clone for TaskRuntime {
    fn clone(&self) -> Self {
        Self {
            max_parallel: self.max_parallel,
            running: self.running.clone(),
            results_dir: self.results_dir.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn task_runtime_can_be_cloned() {
        let rt = super::TaskRuntime::new(3);
        let _ = rt.clone();
    }
}
