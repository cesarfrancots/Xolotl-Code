use crate::session::Session;

#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type,
)]
pub struct TokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cache_creation_input_tokens: u32,
    pub cache_read_input_tokens: u32,
}

impl TokenUsage {
    #[must_use]
    pub fn total_tokens(self) -> u32 {
        self.input_tokens
            + self.output_tokens
            + self.cache_creation_input_tokens
            + self.cache_read_input_tokens
    }
}

/// Per-model token pricing in USD per 1,000,000 tokens.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ModelPricing {
    pub input: f64,
    pub output: f64,
    pub cache_write: f64,
    pub cache_read: f64,
    /// Month the rates were last checked against the provider's pricing page.
    pub last_verified: &'static str,
}

/// Pricing table matched by model-id substring, in priority order.
///
/// Sources: the Anthropic pricing page and the desktop app's authoritative
/// `tauri-app/src/lib/cost.ts` table (both 2026-05). Models without a verified
/// entry resolve to `None` (explicit "unknown") via [`pricing_for`] rather than
/// silently inheriting Opus rates, which previously overcharged every
/// open-weight model. Open-model rates beyond DeepSeek are intentionally left
/// out until verified against a live provider usage page (the §5 cost target);
/// recording an unverified guess would be worse than an honest "unknown".
const PRICING_TABLE: &[(&str, ModelPricing)] = &[
    (
        "opus",
        ModelPricing {
            input: 15.0,
            output: 75.0,
            cache_write: 18.75,
            cache_read: 1.50,
            last_verified: "2026-05",
        },
    ),
    (
        "sonnet",
        ModelPricing {
            input: 3.0,
            output: 15.0,
            cache_write: 3.75,
            cache_read: 0.30,
            last_verified: "2026-05",
        },
    ),
    (
        "haiku",
        ModelPricing {
            input: 0.80,
            output: 4.0,
            cache_write: 1.0,
            cache_read: 0.08,
            last_verified: "2026-05",
        },
    ),
    (
        "deepseek-v4-flash",
        ModelPricing {
            input: 0.14,
            output: 0.28,
            cache_write: 0.14,
            cache_read: 0.0028,
            last_verified: "2026-05",
        },
    ),
    (
        "deepseek-v4-pro",
        ModelPricing {
            input: 0.435,
            output: 0.87,
            cache_write: 0.435,
            cache_read: 0.003_625,
            last_verified: "2026-05",
        },
    ),
];

/// Look up per-model pricing by model-id substring.
///
/// Returns `None` for any model without a verified entry — an explicit
/// "unknown", never a fall-through to Opus rates.
#[must_use]
pub fn pricing_for(model: &str) -> Option<ModelPricing> {
    PRICING_TABLE
        .iter()
        .find(|(key, _)| model.contains(key))
        .map(|(_, pricing)| *pricing)
}

/// Dollar cost of a single [`TokenUsage`] for `model`.
///
/// Unknown models cost `0.0` (pricing is genuinely unknown — see [`pricing_for`])
/// rather than being charged at Opus rates.
#[must_use]
pub fn cost_for_usage(usage: TokenUsage, model: &str) -> f64 {
    let Some(pricing) = pricing_for(model) else {
        return 0.0;
    };
    let m = 1_000_000.0_f64;
    f64::from(usage.input_tokens) / m * pricing.input
        + f64::from(usage.output_tokens) / m * pricing.output
        + f64::from(usage.cache_creation_input_tokens) / m * pricing.cache_write
        + f64::from(usage.cache_read_input_tokens) / m * pricing.cache_read
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UsageTracker {
    latest_turn: TokenUsage,
    cumulative: TokenUsage,
    turns: u32,
}

impl UsageTracker {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn from_session(session: &Session) -> Self {
        let mut tracker = Self::new();
        for message in &session.messages {
            if let Some(usage) = message.usage {
                tracker.record(usage);
            }
        }
        tracker
    }

    pub fn record(&mut self, usage: TokenUsage) {
        self.latest_turn = usage;
        self.cumulative.input_tokens += usage.input_tokens;
        self.cumulative.output_tokens += usage.output_tokens;
        self.cumulative.cache_creation_input_tokens += usage.cache_creation_input_tokens;
        self.cumulative.cache_read_input_tokens += usage.cache_read_input_tokens;
        self.turns += 1;
    }

    pub fn set_cumulative(&mut self, cumulative: TokenUsage, turns: u32) {
        self.cumulative = cumulative;
        self.turns = turns;
    }

    #[must_use]
    pub fn current_turn_usage(&self) -> TokenUsage {
        self.latest_turn
    }

    #[must_use]
    pub fn cumulative_usage(&self) -> TokenUsage {
        self.cumulative
    }

    #[must_use]
    pub fn turns(&self) -> u32 {
        self.turns
    }

    /// Estimate the dollar cost of all tokens recorded so far.
    ///
    /// Rates come from the per-model [`PRICING_TABLE`] (per-million tokens,
    /// last verified 2026-05). Unknown models cost `0.0`, not Opus rates.
    #[must_use]
    pub fn cost_usd(&self, model: &str) -> f64 {
        cost_for_usage(self.cumulative, model)
    }

    /// Calculate cache hit ratio (0.0 to 1.0) based on cache read vs total input tokens.
    /// Returns None if no input tokens have been recorded.
    #[must_use]
    pub fn cache_hit_ratio(&self) -> Option<f64> {
        let total_input = self.cumulative.input_tokens + self.cumulative.cache_read_input_tokens;
        if total_input == 0 {
            return None;
        }
        Some(f64::from(self.cumulative.cache_read_input_tokens) / f64::from(total_input))
    }

    /// Return a human-readable summary of cache usage.
    #[must_use]
    pub fn cache_summary(&self) -> String {
        let created = self.cumulative.cache_creation_input_tokens;
        let read = self.cumulative.cache_read_input_tokens;
        let hit_ratio = self.cache_hit_ratio().unwrap_or(0.0);
        format!(
            "Cache: {} tokens created, {} tokens read ({:.1}% hit rate)",
            created,
            read,
            hit_ratio * 100.0
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{cost_for_usage, pricing_for, TokenUsage, UsageTracker};
    use crate::session::{ContentBlock, ConversationMessage, MessageRole, Session};

    #[test]
    fn pricing_matches_claude_tiers_by_substring() {
        // Control: real model ids (including Bedrock) must resolve to the same
        // rates the old `contains` ladder used, so Claude cost is byte-identical.
        let opus = pricing_for("claude-opus-4-8").expect("opus priced");
        assert!((opus.input - 15.0).abs() < f64::EPSILON);
        assert!((opus.output - 75.0).abs() < f64::EPSILON);

        let sonnet = pricing_for("bedrock/us.anthropic.claude-sonnet-4-6").expect("sonnet priced");
        assert!((sonnet.input - 3.0).abs() < f64::EPSILON);
        assert!((sonnet.cache_read - 0.30).abs() < f64::EPSILON);

        let haiku = pricing_for("claude-haiku-3-5").expect("haiku priced");
        assert!((haiku.input - 0.80).abs() < f64::EPSILON);
    }

    #[test]
    fn unknown_model_is_explicit_unknown_not_opus() {
        // The whole point of the table: open-weight models must NOT inherit Opus
        // rates. Without a verified entry they are explicitly unknown.
        assert!(pricing_for("kimi-k2-turbo-preview").is_none());
        assert!(pricing_for("qwen-3-max").is_none());
        assert!(pricing_for("totally-made-up-model").is_none());
        // ... and an unknown model therefore costs $0, not an Opus-rate charge.
        let usage = TokenUsage {
            input_tokens: 1_000_000,
            output_tokens: 1_000_000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
        };
        assert!((cost_for_usage(usage, "kimi-k2-turbo-preview") - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn cost_usd_unchanged_for_opus_control() {
        // 1M input + 1M output on Opus = $15 + $75 = $90 (same as the old ladder).
        let mut tracker = UsageTracker::new();
        tracker.record(TokenUsage {
            input_tokens: 1_000_000,
            output_tokens: 1_000_000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
        });
        assert!((tracker.cost_usd("claude-opus-4-8") - 90.0).abs() < 1e-9);
    }

    #[test]
    fn deepseek_priced_from_repo_source() {
        let pro = pricing_for("deepseek-v4-pro").expect("deepseek pro priced");
        assert!((pro.input - 0.435).abs() < f64::EPSILON);
        assert!((pro.output - 0.87).abs() < f64::EPSILON);
        let flash = pricing_for("deepseek-v4-flash").expect("deepseek flash priced");
        assert!((flash.input - 0.14).abs() < f64::EPSILON);
    }

    #[test]
    fn tracks_true_cumulative_usage() {
        let mut tracker = UsageTracker::new();
        tracker.record(TokenUsage {
            input_tokens: 10,
            output_tokens: 4,
            cache_creation_input_tokens: 2,
            cache_read_input_tokens: 1,
        });
        tracker.record(TokenUsage {
            input_tokens: 20,
            output_tokens: 6,
            cache_creation_input_tokens: 3,
            cache_read_input_tokens: 2,
        });

        assert_eq!(tracker.turns(), 2);
        assert_eq!(tracker.current_turn_usage().input_tokens, 20);
        assert_eq!(tracker.current_turn_usage().output_tokens, 6);
        assert_eq!(tracker.cumulative_usage().output_tokens, 10);
        assert_eq!(tracker.cumulative_usage().input_tokens, 30);
        assert_eq!(tracker.cumulative_usage().total_tokens(), 48);
    }

    #[test]
    fn reconstructs_usage_from_session_messages() {
        let session = Session {
            version: 1,
            messages: vec![ConversationMessage {
                role: MessageRole::Assistant,
                blocks: vec![ContentBlock::Text {
                    text: "done".to_string(),
                }],
                usage: Some(TokenUsage {
                    input_tokens: 5,
                    output_tokens: 2,
                    cache_creation_input_tokens: 1,
                    cache_read_input_tokens: 0,
                }),
            }],
        };

        let tracker = UsageTracker::from_session(&session);
        assert_eq!(tracker.turns(), 1);
        assert_eq!(tracker.cumulative_usage().total_tokens(), 8);
    }

    #[test]
    fn cache_hit_ratio_calculation() {
        let mut tracker = UsageTracker::new();
        assert!(tracker.cache_hit_ratio().is_none());

        tracker.record(TokenUsage {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 50,
        });
        let ratio = tracker.cache_hit_ratio().unwrap();
        assert!((ratio - 0.3333).abs() < 0.01);

        tracker.record(TokenUsage {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 150,
        });
        let ratio = tracker.cache_hit_ratio().unwrap();
        assert!((ratio - 0.5).abs() < 0.01);
    }

    #[test]
    fn cache_summary_format() {
        let mut tracker = UsageTracker::new();
        tracker.record(TokenUsage {
            input_tokens: 1000,
            output_tokens: 500,
            cache_creation_input_tokens: 2000,
            cache_read_input_tokens: 3000,
        });
        let summary = tracker.cache_summary();
        assert!(summary.contains("2000 tokens created"));
        assert!(summary.contains("3000 tokens read"));
        assert!(summary.contains("75.0% hit rate"));
    }
}
