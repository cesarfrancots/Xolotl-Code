use std::sync::LazyLock;
use tiktoken::CoreBpe;

static ENCODER: LazyLock<&'static CoreBpe> = LazyLock::new(|| {
    tiktoken::get_encoding("cl100k_base").expect("tiktoken cl100k_base must initialize")
});

pub fn estimate_tokens(text: &str) -> usize {
    ENCODER.encode(text).len()
}

#[cfg(test)]
mod tests {
    use super::estimate_tokens;

    #[test]
    fn estimates_empty_string() {
        let count = estimate_tokens("");
        assert_eq!(count, 0);
    }

    #[test]
    fn estimates_ascii_words() {
        let count = estimate_tokens("hello world");
        assert!(count > 0, "should count tokens for ascii text");
    }

    #[test]
    fn estimates_unicode() {
        let count = estimate_tokens("こんにちは世界");
        assert!(count > 0, "should handle unicode without crashing");
    }

    #[test]
    fn estimates_code() {
        let code = "fn main() {\n    println!(\"hello\");\n}";
        let count = estimate_tokens(code);
        assert!(count > 0, "should count code tokens");
    }
}
