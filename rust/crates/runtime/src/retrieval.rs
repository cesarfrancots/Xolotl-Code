//! Optional, read-only graph retrieval (CP 4.4).
//!
//! Consults a `graphify-out/graph.json` knowledge graph to rank source files by
//! relevance to a query, biased toward high-centrality ("god") nodes. This is an
//! opt-in helper for targeting reads on large repos — it has no effect unless a
//! caller loads a graph and asks for a ranking, so the default behavior of the
//! engine is unchanged. When no graph is present, [`GraphRetrieval::from_graph_dir`]
//! returns `None` and the feature is simply a no-op.

use std::collections::HashMap;
use std::path::Path;

use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct RawGraph {
    #[serde(default)]
    nodes: Vec<RawNode>,
    #[serde(default)]
    links: Vec<RawLink>,
}

#[derive(Debug, Deserialize)]
struct RawNode {
    id: String,
    #[serde(default)]
    label: String,
    #[serde(default)]
    norm_label: String,
    #[serde(default)]
    file_type: String,
    #[serde(default)]
    source_file: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawLink {
    source: String,
    target: String,
}

/// A node retained for ranking (only those tied to a readable source file).
#[derive(Debug, Clone)]
struct Node {
    id: String,
    label: String,
    norm_label: String,
    source_file: String,
}

/// A source file ranked by query relevance and graph centrality.
#[derive(Debug, Clone, PartialEq)]
pub struct RankedFile {
    /// Absolute path to the source file (as recorded in the graph).
    pub path: String,
    /// Relevance score (higher is more relevant).
    pub score: f64,
    /// Symbols/labels in this file that matched the query.
    pub matched_symbols: Vec<String>,
}

/// A loaded knowledge graph that can rank files for a query.
#[derive(Debug)]
pub struct GraphRetrieval {
    nodes: Vec<Node>,
    /// Node id → undirected degree (centrality signal; high = "god" node).
    degree: HashMap<String, usize>,
}

impl GraphRetrieval {
    /// Load `graph.json` from a graphify output directory.
    ///
    /// Returns `None` if the file is absent or unparseable — the retrieval
    /// feature then degrades to a no-op rather than erroring.
    #[must_use]
    pub fn from_graph_dir(dir: &Path) -> Option<Self> {
        let text = std::fs::read_to_string(dir.join("graph.json")).ok()?;
        Self::from_graph_json(&text)
    }

    /// Build retrieval state from raw `graph.json` text.
    #[must_use]
    pub fn from_graph_json(json: &str) -> Option<Self> {
        let raw: RawGraph = serde_json::from_str(json).ok()?;

        let mut degree: HashMap<String, usize> = HashMap::new();
        for link in &raw.links {
            *degree.entry(link.source.clone()).or_insert(0) += 1;
            *degree.entry(link.target.clone()).or_insert(0) += 1;
        }

        // Keep only nodes that point at a readable source file (code/docs).
        let nodes = raw
            .nodes
            .into_iter()
            .filter(|node| matches!(node.file_type.as_str(), "code" | "document"))
            .filter_map(|node| {
                node.source_file.clone().map(|source_file| Node {
                    id: node.id,
                    label: node.label,
                    norm_label: node.norm_label,
                    source_file,
                })
            })
            .collect();

        Some(Self { nodes, degree })
    }

    /// Rank source files by relevance to `query`, returning at most `limit`.
    ///
    /// A node matches when its label contains a query term; each match
    /// contributes `1.0 + ln(1 + degree)` so central nodes lift their file.
    /// Scores from all matching nodes in a file are summed.
    #[must_use]
    pub fn rank_files(&self, query: &str, limit: usize) -> Vec<RankedFile> {
        let terms = tokenize(query);
        if terms.is_empty() {
            return Vec::new();
        }

        let mut by_file: HashMap<&str, (f64, Vec<String>)> = HashMap::new();
        for node in &self.nodes {
            let label_lower = node.label.to_lowercase();
            let norm_lower = node.norm_label.to_lowercase();
            let matches = terms
                .iter()
                .any(|term| label_lower.contains(term) || norm_lower.contains(term));
            if !matches {
                continue;
            }
            let degree = self.degree.get(&node.id).copied().unwrap_or(0);
            #[allow(clippy::cast_precision_loss)]
            let contribution = 1.0 + (1.0 + degree as f64).ln();
            let entry = by_file.entry(node.source_file.as_str()).or_default();
            entry.0 += contribution;
            let symbol = if node.label.is_empty() {
                node.norm_label.clone()
            } else {
                node.label.clone()
            };
            if !symbol.is_empty() && !entry.1.contains(&symbol) {
                entry.1.push(symbol);
            }
        }

        let mut ranked: Vec<RankedFile> = by_file
            .into_iter()
            .map(|(path, (score, matched_symbols))| RankedFile {
                path: path.to_string(),
                score,
                matched_symbols,
            })
            .collect();
        // Highest score first; tie-break by path for deterministic output.
        ranked.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.path.cmp(&b.path))
        });
        ranked.truncate(limit);
        ranked
    }
}

/// Split a query into lowercase alphanumeric terms of length ≥ 2.
fn tokenize(query: &str) -> Vec<String> {
    query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|term| term.len() >= 2)
        .map(str::to_lowercase)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::GraphRetrieval;
    use std::path::Path;

    const FIXTURE: &str = r#"{
        "nodes": [
            {"id": "auth_fn", "label": "authenticate()", "norm_label": "authenticate", "file_type": "code", "source_file": "/repo/src/auth.rs"},
            {"id": "auth_helper", "label": "auth_token()", "norm_label": "auth token", "file_type": "code", "source_file": "/repo/src/auth.rs"},
            {"id": "login_fn", "label": "login()", "norm_label": "login", "file_type": "code", "source_file": "/repo/src/login.rs"},
            {"id": "logo_img", "label": "logo.png", "norm_label": "logo", "file_type": "image", "source_file": "/repo/assets/logo.png"}
        ],
        "links": [
            {"source": "auth_fn", "target": "login_fn"},
            {"source": "auth_fn", "target": "auth_helper"},
            {"source": "auth_fn", "target": "logo_img"}
        ]
    }"#;

    #[test]
    fn ranks_files_by_query_and_centrality() {
        let retrieval = GraphRetrieval::from_graph_json(FIXTURE).expect("fixture parses");
        let ranked = retrieval.rank_files("auth login", 10);

        // auth.rs has two matching nodes (one of them the highest-degree node);
        // login.rs has one. auth.rs must rank first.
        assert_eq!(ranked.len(), 2);
        assert_eq!(ranked[0].path, "/repo/src/auth.rs");
        assert_eq!(ranked[1].path, "/repo/src/login.rs");
        assert!(ranked[0].score > ranked[1].score);
        assert!(ranked[0]
            .matched_symbols
            .iter()
            .any(|s| s == "authenticate()"));
    }

    #[test]
    fn respects_limit_and_skips_non_code_files() {
        let retrieval = GraphRetrieval::from_graph_json(FIXTURE).expect("fixture parses");
        // "logo" only matches an image node, which is filtered out.
        assert!(retrieval.rank_files("logo", 10).is_empty());
        // limit caps the result count.
        assert_eq!(retrieval.rank_files("auth login", 1).len(), 1);
    }

    #[test]
    fn no_matching_terms_returns_empty() {
        let retrieval = GraphRetrieval::from_graph_json(FIXTURE).expect("fixture parses");
        assert!(retrieval.rank_files("nonexistentsymbol", 10).is_empty());
        // An all-punctuation / too-short query yields no terms.
        assert!(retrieval.rank_files("a !", 10).is_empty());
    }

    #[test]
    fn absent_graph_is_a_no_op() {
        let missing = std::env::temp_dir().join("xolotl_nonexistent_graph_dir_4_4");
        assert!(GraphRetrieval::from_graph_dir(&missing).is_none());
    }

    #[test]
    fn loads_real_graph_when_present() {
        // The repo's own graphify-out (gitignored) is parseable if it exists; this
        // documents the happy path without depending on the file being present.
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("..")
            .join("graphify-out");
        if let Some(retrieval) = GraphRetrieval::from_graph_dir(&dir) {
            let ranked = retrieval.rank_files("conversation runtime", 5);
            assert!(ranked.len() <= 5);
        }
    }
}
