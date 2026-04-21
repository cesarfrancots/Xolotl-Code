//! Task registry for tracking sub-agent execution.

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
    use super::TaskRegistry;

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
}
