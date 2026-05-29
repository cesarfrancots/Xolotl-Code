//! Parser for aider-style search/replace blocks:
//!
//! ```text
//! <<<<<<< SEARCH
//! old text
//! =======
//! new text
//! >>>>>>> REPLACE
//! ```
//!
//! A payload may contain several blocks. Each becomes one [`EditOp`]. Malformed
//! payloads (a marker without its partner, or no blocks at all) are rejected —
//! the parser never fabricates an op from an incomplete block.

use super::EditOp;

const SEARCH: &str = "<<<<<<< SEARCH";
const DIVIDER: &str = "=======";
const REPLACE: &str = ">>>>>>> REPLACE";

/// Parse zero-or-more search/replace blocks. Returns `Err` with a reason when a
/// block is malformed or no block is present.
pub fn parse_search_replace(payload: &str) -> Result<Vec<EditOp>, String> {
    let lines: Vec<&str> = payload.lines().collect();
    let mut ops = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        if lines[i].trim_end() != SEARCH {
            i += 1;
            continue;
        }
        // Collect the SEARCH side until the divider.
        let mut search = Vec::new();
        i += 1;
        let mut saw_divider = false;
        while i < lines.len() {
            if lines[i].trim_end() == DIVIDER {
                saw_divider = true;
                i += 1;
                break;
            }
            search.push(lines[i]);
            i += 1;
        }
        if !saw_divider {
            return Err("search/replace block missing '=======' divider".to_string());
        }
        // Collect the REPLACE side until the closing marker.
        let mut replace = Vec::new();
        let mut saw_close = false;
        while i < lines.len() {
            if lines[i].trim_end() == REPLACE {
                saw_close = true;
                i += 1;
                break;
            }
            replace.push(lines[i]);
            i += 1;
        }
        if !saw_close {
            return Err("search/replace block missing '>>>>>>> REPLACE' marker".to_string());
        }
        ops.push(EditOp {
            path: None,
            old: search.join("\n"),
            new: replace.join("\n"),
        });
    }

    if ops.is_empty() {
        return Err("no '<<<<<<< SEARCH' block found".to_string());
    }
    Ok(ops)
}

#[cfg(test)]
mod tests {
    use super::parse_search_replace;

    #[test]
    fn parses_single_block() {
        let payload = "<<<<<<< SEARCH\nlet x = 1;\n=======\nlet x = 2;\n>>>>>>> REPLACE\n";
        let ops = parse_search_replace(payload).expect("parse");
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].old, "let x = 1;");
        assert_eq!(ops[0].new, "let x = 2;");
    }

    #[test]
    fn parses_multiple_blocks() {
        let payload = "<<<<<<< SEARCH\na\n=======\nA\n>>>>>>> REPLACE\n\
                       <<<<<<< SEARCH\nb\n=======\nB\n>>>>>>> REPLACE\n";
        let ops = parse_search_replace(payload).expect("parse");
        assert_eq!(ops.len(), 2);
        assert_eq!(ops[1].old, "b");
        assert_eq!(ops[1].new, "B");
    }

    #[test]
    fn rejects_missing_divider() {
        let payload = "<<<<<<< SEARCH\nold\n>>>>>>> REPLACE\n";
        assert!(parse_search_replace(payload).is_err());
    }

    #[test]
    fn rejects_unterminated_block() {
        let payload = "<<<<<<< SEARCH\nold\n=======\nnew\n";
        assert!(parse_search_replace(payload).is_err());
    }

    #[test]
    fn rejects_no_block() {
        assert!(parse_search_replace("just some text\n").is_err());
    }

    #[test]
    fn allows_empty_search_for_pure_insert() {
        let payload = "<<<<<<< SEARCH\n=======\nnew line\n>>>>>>> REPLACE\n";
        let ops = parse_search_replace(payload).expect("parse");
        assert_eq!(ops[0].old, "");
        assert_eq!(ops[0].new, "new line");
    }
}
