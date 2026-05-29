use std::sync::LazyLock;
use tiktoken::CoreBpe;

use crate::model_hints::ModelFamily;

static ENCODER: LazyLock<&'static CoreBpe> = LazyLock::new(|| {
    tiktoken::get_encoding("cl100k_base").expect("tiktoken cl100k_base must initialize")
});

/// Estimate token count using the default `cl100k_base` encoder.
///
/// This is the long-standing default; for model-aware estimates prefer
/// [`estimate_tokens_for_family`].
#[must_use]
pub fn estimate_tokens(text: &str) -> usize {
    ENCODER.encode(text).len()
}

/// tiktoken encoding name used to *estimate* token counts for a model family.
///
/// Only OpenAI models have an exact tiktoken encoding — `o200k_base`, used by the
/// current GPT-4o / o-series line. Every other family (Claude, Bedrock, and the
/// open-weight families, whose native tokenizers are not tiktoken-based) falls
/// back to `cl100k_base`, the conventional cross-model approximation and the
/// engine's historical default.
///
/// These are pre-send *budgeting* estimates only. Provider-reported usage
/// (`TokenUsage`, captured from the stream) is authoritative for cost and
/// accounting — never an estimate.
#[must_use]
pub fn encoding_name_for_family(family: ModelFamily) -> &'static str {
    match family {
        ModelFamily::OpenAI => "o200k_base",
        _ => "cl100k_base",
    }
}

/// Estimate token count using the encoder that best fits `family`.
///
/// See [`encoding_name_for_family`] for the selection rationale and the
/// estimate-vs-accounting distinction.
#[must_use]
pub fn estimate_tokens_for_family(text: &str, family: ModelFamily) -> usize {
    let encoder = tiktoken::get_encoding(encoding_name_for_family(family)).unwrap_or(*ENCODER);
    encoder.encode(text).len()
}

#[cfg(test)]
mod tests {
    use super::{
        encoding_name_for_family, estimate_tokens, estimate_tokens_for_family,
    };
    use crate::model_hints::ModelFamily;

    #[test]
    fn openai_family_selects_o200k_others_cl100k() {
        assert_eq!(encoding_name_for_family(ModelFamily::OpenAI), "o200k_base");
        for family in [
            ModelFamily::Claude,
            ModelFamily::BedrockAnthropic,
            ModelFamily::DeepSeek,
            ModelFamily::Qwen,
            ModelFamily::Glm,
            ModelFamily::MiniMax,
            ModelFamily::KimiCoding,
            ModelFamily::Generic,
        ] {
            assert_eq!(encoding_name_for_family(family), "cl100k_base");
        }
    }

    #[test]
    fn claude_family_estimate_matches_default_encoder() {
        // Back-compat: families that map to cl100k must agree with estimate_tokens.
        let text = "fn main() {\n    println!(\"hello, world\");\n}";
        assert_eq!(
            estimate_tokens_for_family(text, ModelFamily::Claude),
            estimate_tokens(text)
        );
    }

    #[test]
    fn family_estimate_counts_tokens() {
        // o200k tokenizes real text into a positive count without panicking.
        let count = estimate_tokens_for_family("the quick brown fox", ModelFamily::OpenAI);
        assert!(count > 0);
    }

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
