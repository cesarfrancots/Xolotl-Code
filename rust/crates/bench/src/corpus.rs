//! On-disk benchmark corpus loader (Phase 0, CP 0.2, T-0.2.1).
//!
//! A corpus is a directory of task subdirectories. Each task contains:
//! - `prompt.md` — the instruction given to the model (required, non-empty);
//! - `seed/` — seed files copied into the task's isolated working dir (required
//!   unless the category is `create-from-scratch`);
//! - `task.json` — `{ "category": ..., "acceptance": {...} }`.
//!
//! The loader validates every manifest and produces [`CorpusTask`]s ready to feed
//! [`crate::runner::run_task`]. Acceptance checks are declarative and recorded
//! here; they are executed by live runs (which require API keys — see CP 0.2).

use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::runner::{SeedFile, TaskSpec};

/// The six task categories (D9).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TaskCategory {
    SingleFileEdit,
    MultiFileEdit,
    CreateFromScratch,
    BugfixWithFailingTest,
    RefactorPreservingApi,
    NavigateLargeRepo,
}

/// Declarative acceptance criterion for a task. Recorded at load time and
/// evaluated by live runs in the task's working dir after the agent finishes.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Acceptance {
    /// `path` must contain `substring` after the task.
    FileContains { path: String, substring: String },
    /// `path` must equal `contents` exactly after the task.
    FileEquals { path: String, contents: String },
    /// `command` (run in the task dir) must exit 0.
    Command { command: String },
}

#[derive(Debug, Deserialize)]
struct TaskManifest {
    category: TaskCategory,
    acceptance: Acceptance,
}

/// A loaded corpus task: the runnable spec plus its category and acceptance.
#[derive(Debug, Clone)]
pub struct CorpusTask {
    pub spec: TaskSpec,
    pub category: TaskCategory,
    pub acceptance: Acceptance,
}

/// Load and validate every task under `corpus_dir` (sorted by name).
///
/// # Errors
/// Returns a descriptive error if the directory cannot be read, contains no
/// tasks, or any task is missing a required part / has an empty prompt or seed /
/// has an unparseable `task.json`.
pub fn load_corpus(corpus_dir: &Path) -> Result<Vec<CorpusTask>, String> {
    let mut dirs: Vec<PathBuf> = fs::read_dir(corpus_dir)
        .map_err(|e| format!("cannot read corpus dir {}: {e}", corpus_dir.display()))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    dirs.sort();

    let mut tasks = Vec::new();
    for dir in dirs {
        tasks.push(load_task(&dir)?);
    }
    if tasks.is_empty() {
        return Err(format!(
            "corpus {} contains no task directories",
            corpus_dir.display()
        ));
    }
    Ok(tasks)
}

fn load_task(dir: &Path) -> Result<CorpusTask, String> {
    let name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("bad task dir name: {}", dir.display()))?
        .to_string();

    let prompt = fs::read_to_string(dir.join("prompt.md"))
        .map_err(|e| format!("task '{name}': cannot read prompt.md: {e}"))?;
    if prompt.trim().is_empty() {
        return Err(format!("task '{name}': prompt.md is empty"));
    }

    let manifest_text = fs::read_to_string(dir.join("task.json"))
        .map_err(|e| format!("task '{name}': cannot read task.json: {e}"))?;
    let manifest: TaskManifest = serde_json::from_str(&manifest_text)
        .map_err(|e| format!("task '{name}': invalid task.json: {e}"))?;

    let seed_dir = dir.join("seed");
    let mut seed_files = Vec::new();
    collect_seed_files(&seed_dir, &seed_dir, &mut seed_files)
        .map_err(|e| format!("task '{name}': {e}"))?;
    if seed_files.is_empty() && manifest.category != TaskCategory::CreateFromScratch {
        return Err(format!(
            "task '{name}': seed/ has no files (only create-from-scratch may be empty)"
        ));
    }
    seed_files.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));

    Ok(CorpusTask {
        spec: TaskSpec {
            name,
            prompt,
            seed_files,
        },
        category: manifest.category,
        acceptance: manifest.acceptance,
    })
}

/// Recursively collect files under `dir` into `out`, with paths relative to
/// `root`. A missing `seed/` directory is allowed (create-from-scratch).
fn collect_seed_files(root: &Path, dir: &Path, out: &mut Vec<SeedFile>) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    let entries = fs::read_dir(dir).map_err(|e| format!("cannot read {}: {e}", dir.display()))?;
    for entry in entries {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.is_dir() {
            collect_seed_files(root, &path, out)?;
        } else {
            let rel = path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            let contents = fs::read_to_string(&path)
                .map_err(|e| format!("cannot read seed {}: {e}", path.display()))?;
            out.push(SeedFile {
                rel_path: rel,
                contents,
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{load_corpus, TaskCategory};
    use std::path::{Path, PathBuf};

    fn corpus_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("corpus")
    }

    #[test]
    fn loads_and_validates_the_bundled_corpus() {
        let tasks = load_corpus(&corpus_dir()).expect("bundled corpus should load");
        assert!(!tasks.is_empty(), "corpus must contain tasks");
        for task in &tasks {
            assert!(
                !task.spec.prompt.trim().is_empty(),
                "{} has empty prompt",
                task.spec.name
            );
            // create-from-scratch may have no seed; everything else must seed.
            if task.category != TaskCategory::CreateFromScratch {
                assert!(
                    !task.spec.seed_files.is_empty(),
                    "{} should have seed files",
                    task.spec.name
                );
            }
        }
    }

    #[test]
    fn bundled_corpus_covers_multiple_categories() {
        let tasks = load_corpus(&corpus_dir()).expect("load");
        let mut categories: Vec<TaskCategory> = tasks.iter().map(|t| t.category).collect();
        categories.sort_by_key(|c| format!("{c:?}"));
        categories.dedup();
        assert!(
            categories.len() >= 3,
            "corpus should span several categories, got {categories:?}"
        );
    }

    fn scratch_dir(tag: &str) -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let seq = SEQ.fetch_add(1, Ordering::Relaxed);
        let mut dir = std::env::temp_dir();
        dir.push(format!("xolotl-corpus-{tag}-{}-{seq}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn rejects_task_with_empty_prompt() {
        let root = scratch_dir("empty-prompt");
        let task = root.join("bad");
        std::fs::create_dir_all(task.join("seed")).unwrap();
        std::fs::write(task.join("prompt.md"), "   \n").unwrap();
        std::fs::write(
            task.join("task.json"),
            "{\"category\":\"single-file-edit\",\"acceptance\":{\"kind\":\"file-contains\",\"path\":\"a\",\"substring\":\"b\"}}",
        )
        .unwrap();
        std::fs::write(task.join("seed").join("a.txt"), "x").unwrap();

        let err = load_corpus(&root).expect_err("empty prompt must be rejected");
        assert!(err.contains("prompt.md is empty"), "{err}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_task_with_unparseable_manifest() {
        let root = scratch_dir("bad-manifest");
        let task = root.join("bad");
        std::fs::create_dir_all(task.join("seed")).unwrap();
        std::fs::write(task.join("prompt.md"), "do something").unwrap();
        std::fs::write(task.join("task.json"), "{ not valid json").unwrap();
        std::fs::write(task.join("seed").join("a.txt"), "x").unwrap();

        let err = load_corpus(&root).expect_err("bad manifest must be rejected");
        assert!(err.contains("invalid task.json"), "{err}");
        let _ = std::fs::remove_dir_all(&root);
    }
}
