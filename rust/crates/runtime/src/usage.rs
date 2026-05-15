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
    /// Rates are per-million tokens as of 2025 pricing.
    #[must_use]
    pub fn cost_usd(&self, model: &str) -> f64 {
        let (input_rate, output_rate, cache_write_rate, cache_read_rate): (f64, f64, f64, f64) =
            if model.contains("opus") {
                (15.0, 75.0, 18.75, 1.50)
            } else if model.contains("sonnet") {
                (3.0, 15.0, 3.75, 0.30)
            } else if model.contains("haiku") {
                (0.80, 4.0, 1.0, 0.08)
            } else {
                (15.0, 75.0, 18.75, 1.50)
            };
        let m = 1_000_000.0_f64;
        f64::from(self.cumulative.input_tokens) / m * input_rate
            + f64::from(self.cumulative.output_tokens) / m * output_rate
            + f64::from(self.cumulative.cache_creation_input_tokens) / m * cache_write_rate
            + f64::from(self.cumulative.cache_read_input_tokens) / m * cache_read_rate
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
    use super::{TokenUsage, UsageTracker};
    use crate::session::{ContentBlock, ConversationMessage, MessageRole, Session};

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
