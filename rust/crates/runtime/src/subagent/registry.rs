//! Task registry for tracking sub-agent execution with aggregation support.

use super::{SubAgentInfo, SubAgentResult, SubAgentStatus};
use std::collections::HashMap;
use std::sync::atomic::AtomicUsize;
use std::sync::{Arc, Mutex};

#[allow(dead_code)]
static TASK_REGISTRY_COUNTER: AtomicUsize = AtomicUsize::new(0);
#[allow(dead_code)]
static GLOBAL_REGISTRY: std::sync::LazyLock<Arc<Mutex<TaskRegistry>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(TaskRegistry::new(10))));

#[allow(dead_code)]
pub fn global_task_registry() -> Arc<Mutex<TaskRegistry>> {
    GLOBAL_REGISTRY.clone()
}

#[derive(Debug, Clone, Default)]
pub struct TaskStatus {
    pub running: usize,
    pub pending: usize,
    pub completed: usize,
    pub failed: usize,
    pub cancelled: usize,
}

impl TaskStatus {
    #[must_use]
    pub fn total(&self) -> usize {
        self.running + self.pending + self.completed + self.failed + self.cancelled
    }

    #[must_use]
    pub fn success_rate(&self) -> f64 {
        let completed = self.completed as f64;
        let failed = self.failed as f64;
        let total = completed + failed;
        if total == 0.0 {
            0.0
        } else {
            completed / total
        }
    }
}

/// Aggregated results from multiple sub-agent executions.
#[derive(Debug, Clone, Default)]
pub struct AggregatedResults {
    pub total_tasks: usize,
    pub successful_tasks: usize,
    pub failed_tasks: usize,
    pub total_elapsed_ms: u64,
    pub total_input_tokens: u32,
    pub total_output_tokens: u32,
    pub combined_output: String,
    pub errors: Vec<String>,
}

pub struct TaskRegistry {
    tasks: Arc<Mutex<HashMap<String, SubAgentInfo>>>,
    results: Arc<Mutex<Vec<SubAgentResult>>>,
    max_concurrent: usize,
}

impl TaskRegistry {
    #[must_use]
    pub fn new(max_concurrent: usize) -> Self {
        Self {
            tasks: Arc::new(Mutex::new(HashMap::new())),
            results: Arc::new(Mutex::new(Vec::new())),
            max_concurrent,
        }
    }

    pub fn submit(&self, task_id: String, description: String) {
        let mut tasks = self.tasks.lock().unwrap();
        let info = SubAgentInfo {
            task_id: task_id.clone(),
            description,
            status: SubAgentStatus::Pending,
            started_at: None,
            completed_at: None,
            output_preview: None,
        };
        tasks.insert(task_id, info);
    }

    pub fn mark_running(&self, task_id: &str) {
        let mut tasks = self.tasks.lock().unwrap();
        if let Some(info) = tasks.get_mut(task_id) {
            info.status = SubAgentStatus::Running;
            info.started_at = Some(chrono::Utc::now().to_rfc3339());
        }
    }

    pub fn mark_completed(&self, task_id: &str, output_preview: Option<String>) {
        let mut tasks = self.tasks.lock().unwrap();
        if let Some(info) = tasks.get_mut(task_id) {
            info.status = SubAgentStatus::Completed;
            info.completed_at = Some(chrono::Utc::now().to_rfc3339());
            info.output_preview = output_preview;
        }
    }

    pub fn mark_failed(&self, task_id: &str) {
        let mut tasks = self.tasks.lock().unwrap();
        if let Some(info) = tasks.get_mut(task_id) {
            info.status = SubAgentStatus::Failed;
            info.completed_at = Some(chrono::Utc::now().to_rfc3339());
        }
    }

    pub fn mark_cancelled(&self, task_id: &str) {
        let mut tasks = self.tasks.lock().unwrap();
        if let Some(info) = tasks.get_mut(task_id) {
            info.status = SubAgentStatus::Cancelled;
            info.completed_at = Some(chrono::Utc::now().to_rfc3339());
        }
    }

    #[must_use]
    pub fn cancel(&self, task_id: &str) -> bool {
        let mut tasks = self.tasks.lock().unwrap();
        if let Some(info) = tasks.get_mut(task_id) {
            if matches!(
                info.status,
                SubAgentStatus::Pending | SubAgentStatus::Running
            ) {
                info.status = SubAgentStatus::Cancelled;
                info.completed_at = Some(chrono::Utc::now().to_rfc3339());
                return true;
            }
        }
        false
    }

    pub fn store_result(&self, result: SubAgentResult) {
        let mut results = self.results.lock().unwrap();
        results.push(result);
    }

    #[must_use]
    pub fn status(&self) -> TaskStatus {
        let tasks = self.tasks.lock().unwrap();
        let mut status = TaskStatus::default();
        for info in tasks.values() {
            match info.status {
                SubAgentStatus::Running => status.running += 1,
                SubAgentStatus::Completed => status.completed += 1,
                SubAgentStatus::Failed => status.failed += 1,
                SubAgentStatus::Cancelled => status.cancelled += 1,
                SubAgentStatus::Pending => status.pending += 1,
            }
        }
        status
    }

    #[must_use]
    pub fn list_tasks(&self) -> Vec<SubAgentInfo> {
        let tasks = self.tasks.lock().unwrap();
        tasks.values().cloned().collect()
    }

    #[must_use]
    pub fn get_result(&self, task_id: &str) -> Option<SubAgentResult> {
        let results = self.results.lock().unwrap();
        results.iter().find(|r| r.task_id == task_id).cloned()
    }

    #[must_use]
    pub fn max_concurrent(&self) -> usize {
        self.max_concurrent
    }

    // ── Aggregation Methods ───────────────────────────────────────────────────

    /// Aggregate all stored results into a summary.
    #[must_use]
    pub fn aggregate_results(&self) -> AggregatedResults {
        let results = self.results.lock().unwrap();
        let mut aggregated = AggregatedResults::default();

        for result in results.iter() {
            aggregated.total_tasks += 1;
            if result.success {
                aggregated.successful_tasks += 1;
            } else {
                aggregated.failed_tasks += 1;
            }
            aggregated.total_elapsed_ms += result.elapsed_ms;
            if !result.output.is_empty() {
                if !aggregated.combined_output.is_empty() {
                    aggregated.combined_output.push_str("\n\n---\n\n");
                }
                aggregated.combined_output.push_str(&result.output);
            }
            if let Some(ref error) = result.error {
                aggregated.errors.push(error.clone());
            }
            if let Some(ref usage) = result.token_usage {
                aggregated.total_input_tokens += usage.input_tokens;
                aggregated.total_output_tokens += usage.output_tokens;
            }
        }

        aggregated
    }

    /// Get results filtered by success status.
    #[must_use]
    pub fn filter_by_status(&self, success: bool) -> Vec<SubAgentResult> {
        let results = self.results.lock().unwrap();
        results
            .iter()
            .filter(|r| r.success == success)
            .cloned()
            .collect()
    }

    /// Get results for tasks that had retries.
    #[must_use]
    pub fn retried_results(&self) -> Vec<SubAgentResult> {
        let results = self.results.lock().unwrap();
        results.iter().filter(|r| r.retry_count > 0).cloned().collect()
    }

    /// Get a summary report of all tasks and results.
    #[must_use]
    pub fn summary_report(&self) -> String {
        let status = self.status();
        let aggregated = self.aggregate_results();

        let mut lines = vec![
            "=== Sub-Agent Execution Report ===".to_string(),
            format!("Total tasks: {}", status.total()),
            format!("  Pending: {}", status.pending),
            format!("  Running: {}", status.running),
            format!("  Completed: {}", status.completed),
            format!("  Failed: {}", status.failed),
            format!("  Cancelled: {}", status.cancelled),
            format!("Success rate: {:.1}%", status.success_rate() * 100.0),
            String::new(),
            "=== Token Usage ===".to_string(),
            format!("  Input: {}", aggregated.total_input_tokens),
            format!("  Output: {}", aggregated.total_output_tokens),
            format!("  Total: {}", aggregated.total_input_tokens + aggregated.total_output_tokens),
            String::new(),
            format!("Total elapsed: {}ms", aggregated.total_elapsed_ms),
        ];

        if !aggregated.errors.is_empty() {
            lines.push(String::new());
            lines.push("=== Errors ===".to_string());
            for (i, error) in aggregated.errors.iter().enumerate() {
                lines.push(format!("  {}. {error}", i + 1));
            }
        }

        let retried = self.retried_results();
        if !retried.is_empty() {
            lines.push(String::new());
            lines.push(format!("=== Retried Tasks ({}) ===", retried.len()));
            for result in retried {
                lines.push(format!("  - {} ({} retries)", result.description, result.retry_count));
            }
        }

        lines.join("\n")
    }

    /// Clear all stored results (useful for long-running sessions).
    pub fn clear_results(&self) {
        let mut results = self.results.lock().unwrap();
        results.clear();
    }

    /// Get the number of stored results.
    #[must_use]
    pub fn result_count(&self) -> usize {
        let results = self.results.lock().unwrap();
        results.len()
    }
}

impl Clone for TaskRegistry {
    fn clone(&self) -> Self {
        Self {
            tasks: self.tasks.clone(),
            results: self.results.clone(),
            max_concurrent: self.max_concurrent,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn task_registry_submit_and_status() {
        let registry = TaskRegistry::new(5);
        registry.submit("task-1".to_string(), "test task".to_string());
        registry.submit("task-2".to_string(), "another task".to_string());

        let status = registry.status();
        assert_eq!(status.total(), 2);
        assert_eq!(status.running, 0);
    }

    #[test]
    fn task_registry_clone_is_shared() {
        let registry = TaskRegistry::new(5);
        registry.submit("task-1".to_string(), "test task".to_string());

        let cloned = registry.clone();
        cloned.submit("task-2".to_string(), "another task".to_string());

        let status = registry.status();
        assert_eq!(status.total(), 2);
    }

    #[test]
    fn aggregate_results_combines_outputs() {
        let registry = TaskRegistry::new(5);
        registry.store_result(SubAgentResult::success(
            "t1".to_string(),
            "task 1".to_string(),
            "output 1".to_string(),
            None,
            Duration::from_secs(1),
        ));
        registry.store_result(SubAgentResult::success(
            "t2".to_string(),
            "task 2".to_string(),
            "output 2".to_string(),
            None,
            Duration::from_secs(2),
        ));

        let aggregated = registry.aggregate_results();
        assert_eq!(aggregated.total_tasks, 2);
        assert_eq!(aggregated.successful_tasks, 2);
        assert!(aggregated.combined_output.contains("output 1"));
        assert!(aggregated.combined_output.contains("output 2"));
        assert_eq!(aggregated.total_elapsed_ms, 3000);
    }

    #[test]
    fn filter_by_status_works() {
        let registry = TaskRegistry::new(5);
        registry.store_result(SubAgentResult::success(
            "t1".to_string(),
            "task 1".to_string(),
            "output".to_string(),
            None,
            Duration::from_secs(1),
        ));
        registry.store_result(SubAgentResult::failure(
            "t2".to_string(),
            "task 2".to_string(),
            "error".to_string(),
            Duration::from_secs(1),
        ));

        let successful = registry.filter_by_status(true);
        assert_eq!(successful.len(), 1);
        assert_eq!(successful[0].task_id, "t1");

        let failed = registry.filter_by_status(false);
        assert_eq!(failed.len(), 1);
        assert_eq!(failed[0].task_id, "t2");
    }

    #[test]
    fn summary_report_generation() {
        let registry = TaskRegistry::new(5);
        registry.submit("t1".to_string(), "task 1".to_string());
        registry.mark_completed("t1", Some("done".to_string()));
        registry.store_result(SubAgentResult::success(
            "t1".to_string(),
            "task 1".to_string(),
            "output".to_string(),
            None,
            Duration::from_secs(1),
        ));

        let report = registry.summary_report();
        assert!(report.contains("Sub-Agent Execution Report"));
        assert!(report.contains("Completed: 1"));
        assert!(report.contains("Success rate: 100.0%"));
    }
}
