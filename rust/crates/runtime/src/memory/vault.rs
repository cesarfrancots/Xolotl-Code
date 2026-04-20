use std::fs;
use std::io::{self, BufRead};
use std::path::{Path, PathBuf};

use super::SessionNote;

#[derive(Debug, Clone)]
pub struct ObsidianVault {
    root: PathBuf,
    sessions_dir: PathBuf,
    learnings_dir: PathBuf,
    project_dir: PathBuf,
}

impl ObsidianVault {
    pub fn new(root: PathBuf) -> Self {
        let sessions_dir = root.join("sessions");
        let learnings_dir = root.join("learnings");
        let project_dir = root.join("project-context");

        fs::create_dir_all(&sessions_dir).ok();
        fs::create_dir_all(&learnings_dir).ok();
        fs::create_dir_all(&project_dir).ok();

        Self {
            root,
            sessions_dir,
            learnings_dir,
            project_dir,
        }
    }

    pub fn status(&self) -> (PathBuf, usize) {
        let count = fs::read_dir(&self.sessions_dir)
            .map(|d| d.filter_map(|e| e.ok()).count())
            .unwrap_or(0);
        (self.root.clone(), count)
    }

    pub fn write_session_note(&self, note: &SessionNote) -> Result<PathBuf, std::io::Error> {
        let filename = format!(
            "{}-{}.md",
            note.date.replace(':', "-").replace(' ', "-"),
            sanitize_filename(&note.task)
        );
        let path = self.sessions_dir.join(&filename);
        let content = note.to_markdown();
        fs::write(&path, content)?;
        Ok(path)
    }

    pub fn search_notes(&self, query: &str) -> Result<Vec<PathBuf>, std::io::Error> {
        let query_lower = query.to_lowercase();
        if query_lower.is_empty() {
            return Ok(Vec::new());
        }
        let mut results = Vec::new();

        if let Ok(entries) = fs::read_dir(&self.sessions_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("md") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        if content.to_lowercase().contains(&query_lower) {
                            results.push(path);
                        }
                    }
                }
            }
        }

        if let Ok(entries) = fs::read_dir(&self.learnings_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("md") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        if content.to_lowercase().contains(&query_lower) {
                            results.push(path);
                        }
                    }
                }
            }
        }

        results.sort_by_key(|p| std::cmp::Reverse(p.metadata().ok().and_then(|m| m.modified().ok())));
        Ok(results)
    }

    pub fn get_recent_sessions(&self, limit: usize) -> Result<Vec<PathBuf>, std::io::Error> {
        let mut sessions: Vec<_> = fs::read_dir(&self.sessions_dir)?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("md"))
            .collect();

        sessions.sort_by(|a, b| {
            let time_a = a.path().metadata().and_then(|m| m.modified());
            let time_b = b.path().metadata().and_then(|m| m.modified());
            match (time_a, time_b) {
                (Ok(t_a), Ok(t_b)) => t_b.cmp(&t_a),
                _ => std::cmp::Ordering::Equal,
            }
        });
        sessions.truncate(limit);

        Ok(sessions.into_iter().map(|e| e.path()).collect())
    }

    pub fn read_note(&self, path: &Path) -> Result<String, std::io::Error> {
        fs::read_to_string(path)
    }

    pub fn write_learning(&self, title: &str, content: &str, topics: &[&str]) -> Result<PathBuf, std::io::Error> {
        let filename = format!("{}.md", sanitize_filename(title));
        let path = self.learnings_dir.join(&filename);

        let mut md = String::new();
        md.push_str("---\n");
        md.push_str(&format!("date: {}\n", chrono::Utc::now().format("%Y-%m-%d")));
        md.push_str(&format!("topics: [{}]\n", topics.join(", ")));
        md.push_str("---\n\n");
        md.push_str(&format!("# {}\n\n", title));
        md.push_str(content);
        md.push('\n');

        fs::write(&path, md)?;
        Ok(path)
    }
}

pub fn discover_vault() -> Option<PathBuf> {
    let candidates = [
        dirs::home_dir().map(|h| h.join("Obsidian Vault")),
        dirs::home_dir().map(|h| h.join("Documents/Obsidian")),
        dirs::home_dir().map(|h| h.join("Documents/Obsidian Vault")),
        dirs::home_dir().map(|h| h.join(".claw-code/vault")),
        std::env::current_dir().ok().map(|p| p.join(".obsidian")),
    ];

    for candidate in candidates.into_iter().flatten() {
        if is_valid_vault(&candidate) {
            return Some(candidate);
        }
    }

    None
}

fn is_valid_vault(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }

    if path.join(".obsidian").is_dir() {
        return true;
    }

    if path.join("obsidian.json").exists() {
        return true;
    }

    let vault_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if vault_name.to_lowercase().contains("obsidian") && path.join("sessions").is_dir() {
        return true;
    }

    false
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' || c == '#' {
                c
            } else if c == '/' || c == '\\' {
                '-'
            } else {
                '_'
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_filename() {
        assert_eq!(sanitize_filename("OAuth implementation"), "OAuth-implementation");
        assert_eq!(sanitize_filename("Fix bug #123"), "Fix-bug-#123");
    }
}
