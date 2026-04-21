//! Semantic text retrieval for Obsidian vault notes.
//!
//! Uses TF-IDF scoring on an in-memory inverted index. No external embedding
//! model required — pure classical IR that works offline and cross-platform.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

/// A scored document result from a search query.
#[derive(Debug, Clone)]
pub struct MemorySearchResult {
    pub path: PathBuf,
    pub title: String,
    pub score: f64,
    pub snippet: String,
}

/// In-memory TF-IDF index for a collection of markdown notes.
pub struct NoteIndex {
    /// term -> (`doc_id`, `term_frequency_in_doc`)
    inverted: HashMap<String, Vec<(usize, f64)>>,
    /// `doc_id` -> document metadata
    docs: Vec<DocMeta>,
    /// Total number of documents indexed
    doc_count: usize,
}

#[derive(Debug, Clone)]
struct DocMeta {
    path: PathBuf,
    title: String,
    modified: Option<std::time::SystemTime>,
}

impl NoteIndex {
    pub fn new() -> Self {
        Self {
            inverted: HashMap::new(),
            docs: Vec::new(),
            doc_count: 0,
        }
    }

    /// Add a document to the index.
    pub fn add_document(
        &mut self,
        path: PathBuf,
        title: String,
        content: &str,
        modified: Option<std::time::SystemTime>,
    ) {
        let doc_id = self.docs.len();
        let terms = tokenize(content);
        let mut term_counts: HashMap<String, usize> = HashMap::new();
        let mut total_terms = 0usize;

        for term in &terms {
            *term_counts.entry(term.clone()).or_insert(0) += 1;
            total_terms += 1;
        }

        // Index terms
        for (term, count) in &term_counts {
            #[allow(clippy::cast_precision_loss)]
            let tf = (*count as f64) / (total_terms.max(1) as f64);
            self.inverted
                .entry(term.clone())
                .or_default()
                .push((doc_id, tf));
        }

        self.docs.push(DocMeta {
            path,
            title,
            modified,
        });
        self.doc_count += 1;
    }

    /// Search the index with a free-text query. Returns top-k results sorted by score.
    pub fn search(&self, query: &str, top_k: usize) -> Vec<MemorySearchResult> {
        let query_terms = tokenize(query);
        if query_terms.is_empty() || self.doc_count == 0 {
            return Vec::new();
        }

        let query_set: HashSet<_> = query_terms.iter().cloned().collect();
        let mut scores: HashMap<usize, f64> = HashMap::new();

        for term in &query_terms {
            if let Some(postings) = self.inverted.get(term) {
                #[allow(clippy::cast_precision_loss)]
                let idf = ((self.doc_count as f64) / (postings.len().max(1) as f64)).ln() + 1.0;
                for (doc_id, tf) in postings {
                    let score = tf * idf;
                    *scores.entry(*doc_id).or_insert(0.0) += score;
                }
            }
        }

        // Boost exact title matches heavily
        for (doc_id, doc) in self.docs.iter().enumerate() {
            let title_lower = doc.title.to_lowercase();
            if query_set.iter().any(|t| title_lower.contains(t)) {
                *scores.entry(doc_id).or_insert(0.0) *= 2.5;
            }
        }

        // Apply small recency boost
        let now = std::time::SystemTime::now();
        for (doc_id, doc) in self.docs.iter().enumerate() {
            if let Some(modified) = doc.modified {
                if let Ok(age_secs) = now.duration_since(modified).map(|d| d.as_secs()) {
                    #[allow(clippy::cast_precision_loss)]
                    let days = age_secs as f64 / 86400.0;
                    let recency_boost = 1.0 + (30.0 / (days + 30.0));
                    if let Some(score) = scores.get_mut(&doc_id) {
                        *score *= recency_boost;
                    }
                }
            }
        }

        let mut ranked: Vec<_> = scores.into_iter().collect();
        ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        ranked.truncate(top_k);

        ranked
            .into_iter()
            .map(|(doc_id, score)| {
                let doc = &self.docs[doc_id];
                MemorySearchResult {
                    path: doc.path.clone(),
                    title: doc.title.clone(),
                    score,
                    snippet: extract_snippet(doc_id, &query_terms, &self.docs),
                }
            })
            .collect()
    }
}

impl Default for NoteIndex {
    fn default() -> Self {
        Self::new()
    }
}

/// Simple tokenizer: lowercase, alphanumeric only, remove stop words.
fn tokenize(text: &str) -> Vec<String> {
    const STOP_WORDS: &[&str] = &[
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
        "do", "does", "did", "will", "would", "could", "should", "may", "might", "must", "shall",
        "can", "need", "dare", "ought", "used", "to", "of", "in", "for", "on", "with", "at", "by",
        "from", "as", "into", "through", "during", "before", "after", "above", "below", "between",
        "under", "and", "but", "or", "yet", "so", "if", "because", "although", "though", "while",
        "where", "when", "that", "which", "who", "whom", "whose", "what", "this", "these", "those",
        "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them", "my",
        "your", "his", "its", "our", "their",
    ];

    let stop_set: HashSet<_> = STOP_WORDS.iter().copied().collect();

    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .map(|s| s.trim().to_string())
        .filter(|s| s.len() > 2 && !stop_set.contains(s.as_str()))
        .collect()
}

/// Extract a snippet around the first matching query term.
fn extract_snippet(doc_id: usize, query_terms: &[String], docs: &[DocMeta]) -> String {
    let doc = &docs[doc_id];
    let Ok(content) = std::fs::read_to_string(&doc.path) else {
        return String::new();
    };

    let content_lower = content.to_lowercase();
    for term in query_terms {
        if let Some(pos) = content_lower.find(term) {
            let start = pos.saturating_sub(60);
            let end = (pos + term.len() + 120).min(content.len());
            let snippet = &content[start..end];
            return snippet.trim().replace('\n', " ").clone();
        }
    }

    // Fallback: first 180 chars
    content
        .chars()
        .take(180)
        .collect::<String>()
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenize_basic() {
        let terms = tokenize("Hello world! This is a test.");
        assert!(terms.contains(&"hello".to_string()));
        assert!(terms.contains(&"world".to_string()));
        assert!(terms.contains(&"test".to_string()));
        assert!(!terms.contains(&"is".to_string())); // stop word
        assert!(!terms.contains(&"a".to_string())); // stop word
    }

    #[test]
    fn tfidf_search_ranking() {
        let mut index = NoteIndex::new();
        index.add_document(
            PathBuf::from("/tmp/a.md"),
            "Rust Ownership".to_string(),
            "Rust ownership rules prevent data races at compile time.",
            None,
        );
        index.add_document(
            PathBuf::from("/tmp/b.md"),
            "Python Basics".to_string(),
            "Python is a high-level programming language with dynamic typing.",
            None,
        );
        index.add_document(
            PathBuf::from("/tmp/c.md"),
            "Rust Concurrency".to_string(),
            "Rust concurrency uses ownership and borrowing for safe parallelism.",
            None,
        );

        let results = index.search("rust ownership", 2);
        assert_eq!(results.len(), 2);
        assert!(results[0].title.contains("Ownership") || results[0].title.contains("Concurrency"));
    }
}
