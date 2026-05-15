//! Shared context store for cross-agent snapshot sharing.
//!
//! Agents publish named text snapshots and pull them on demand.
//! Implements D-06 (keyed pull-on-demand) and D-07 (`TooLarge` enforcement).

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// Errors returned by `SharedContextStore` operations.
#[derive(Debug, thiserror::Error, PartialEq)]
pub enum ContextError {
    /// Snapshot exceeds the 1000-token whitespace limit. Contains the actual count.
    #[error("snapshot exceeds 1000-token limit ({0} whitespace tokens)")]
    TooLarge(usize),
}

/// Thread-safe store for cross-agent text snapshots.
///
/// Internally a `HashMap<String, String>` behind an `Arc<RwLock<...>>`.
/// Cloning the store shares the same underlying data — suitable for passing
/// to multiple agent tasks.
///
/// Token counting uses whitespace splitting (D-07 decision) — no tiktoken dependency.
#[derive(Debug, Clone, Default)]
pub struct SharedContextStore {
    inner: Arc<RwLock<HashMap<String, String>>>,
}

impl SharedContextStore {
    /// Create a new empty store.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Publish a named snapshot.
    ///
    /// Returns `Err(ContextError::TooLarge(n))` if the snapshot contains more than
    /// 1000 whitespace-separated tokens. Callers must trim before publishing.
    /// No silent truncation (D-07).
    pub fn publish(&self, key: &str, snapshot: &str) -> Result<(), ContextError> {
        let token_count = snapshot.split_whitespace().count();
        if token_count > 1000 {
            return Err(ContextError::TooLarge(token_count));
        }
        let mut map = self.inner.write().unwrap();
        map.insert(key.to_string(), snapshot.to_string());
        Ok(())
    }

    /// Pull a named snapshot.
    ///
    /// Returns `None` if the key has not been published, `Some(snapshot)` otherwise.
    #[must_use]
    pub fn pull(&self, key: &str) -> Option<String> {
        let map = self.inner.read().unwrap();
        map.get(key).cloned()
    }

    /// Remove a snapshot by key. Returns true if the key existed.
    #[must_use]
    pub fn remove(&self, key: &str) -> bool {
        let mut map = self.inner.write().unwrap();
        map.remove(key).is_some()
    }

    /// Return all current keys in the store (order unspecified).
    #[must_use]
    pub fn keys(&self) -> Vec<String> {
        let map = self.inner.read().unwrap();
        map.keys().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn context_store_publish_ok_under_limit() {
        let store = SharedContextStore::new();
        // 10 whitespace-separated tokens — well under 1000
        let snapshot = "one two three four five six seven eight nine ten";
        assert!(store.publish("key1", snapshot).is_ok());
    }

    #[test]
    fn context_store_publish_ok_at_limit() {
        let store = SharedContextStore::new();
        // Exactly 1000 tokens
        let snapshot: String = (0..1000)
            .map(|i| format!("token{i}"))
            .collect::<Vec<_>>()
            .join(" ");
        assert_eq!(snapshot.split_whitespace().count(), 1000);
        assert!(store.publish("key_at_limit", &snapshot).is_ok());
    }

    #[test]
    fn context_store_too_large_returns_err() {
        let store = SharedContextStore::new();
        // 1001 tokens — exceeds limit
        let snapshot: String = (0..1001)
            .map(|i| format!("token{i}"))
            .collect::<Vec<_>>()
            .join(" ");
        let result = store.publish("key_too_large", &snapshot);
        assert!(matches!(result, Err(ContextError::TooLarge(1001))));
    }

    #[test]
    fn context_store_pull_missing_returns_none() {
        let store = SharedContextStore::new();
        assert!(store.pull("nonexistent").is_none());
    }

    #[test]
    fn context_store_pull_after_publish_returns_some() {
        let store = SharedContextStore::new();
        store.publish("plan", "the plan is to do X").unwrap();
        let result = store.pull("plan");
        assert_eq!(result, Some("the plan is to do X".to_string()));
    }

    #[test]
    fn context_store_clone_shares_data() {
        let store1 = SharedContextStore::new();
        let store2 = store1.clone();
        store1.publish("shared", "data from agent 1").unwrap();
        assert_eq!(store2.pull("shared"), Some("data from agent 1".to_string()));
    }

    #[test]
    fn context_store_publish_overwrites_existing_key() {
        let store = SharedContextStore::new();
        store.publish("key", "first version").unwrap();
        store.publish("key", "second version").unwrap();
        assert_eq!(store.pull("key"), Some("second version".to_string()));
    }
}
