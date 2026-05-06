use std::collections::BTreeMap;
use std::fmt::{Display, Formatter};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use crate::compact::{
    compact_session, estimate_session_tokens, should_compact, CompactionConfig, CompactionResult,
};
use crate::hooks::{HookEvent, HookManager};
use crate::model_hints::ModelHints;
use crate::permissions::{PermissionOutcome, PermissionPolicy, PermissionPrompter};
use crate::session::{ContentBlock, ConversationMessage, Session};
use crate::usage::{TokenUsage, UsageTracker};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiRequest {
    pub system_prompt: Vec<String>,
    /// Optional system prompt as content blocks with cache control.
    /// When present, API clients should prefer this over `system_prompt`.
    pub system_prompt_blocks: Option<Vec<api::types::SystemContentBlock>>,
    pub messages: Vec<ConversationMessage>,
    pub thinking: Option<api::types::ThinkingConfig>,
    pub images: Vec<ContentBlock>,
}

impl ApiRequest {
    #[must_use]
    pub fn with_thinking(mut self, thinking: api::types::ThinkingConfig) -> Self {
        self.thinking = Some(thinking);
        self
    }

    #[must_use]
    pub fn with_cached_system_prompt(
        mut self,
        blocks: Vec<api::types::SystemContentBlock>,
    ) -> Self {
        self.system_prompt_blocks = Some(blocks);
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssistantEvent {
    TextDelta(String),
    ToolUse {
        id: String,
        name: String,
        input: String,
    },
    ThinkingDelta(String),
    Usage(TokenUsage),
    MessageStop,
}

pub trait ApiClient {
    fn stream(&mut self, request: ApiRequest) -> Result<Vec<AssistantEvent>, RuntimeError>;
}

pub trait ToolExecutor {
    fn execute(&mut self, tool_name: &str, input: &str) -> Result<String, ToolError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolError {
    message: String,
}

impl ToolError {
    #[must_use]
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for ToolError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for ToolError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeError {
    message: String,
}

impl RuntimeError {
    #[must_use]
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for RuntimeError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for RuntimeError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurnSummary {
    pub assistant_messages: Vec<ConversationMessage>,
    pub tool_results: Vec<ConversationMessage>,
    pub iterations: usize,
    pub usage: TokenUsage,
}

pub struct ConversationRuntime<C, T> {
    session: Session,
    api_client: C,
    tool_executor: T,
    permission_policy: PermissionPolicy,
    system_prompt: Vec<String>,
    max_iterations: usize,
    usage_tracker: UsageTracker,
    max_context_tokens: usize,
    max_parallel: usize,
    pending_images: Vec<ContentBlock>,
    model: Option<String>,
    model_hints: Option<ModelHints>,
    hook_manager: HookManager,
}

impl<C, T> ConversationRuntime<C, T>
where
    C: ApiClient,
    T: ToolExecutor + Send + Clone + 'static,
{
    #[must_use]
    pub fn new(
        session: Session,
        api_client: C,
        tool_executor: T,
        permission_policy: PermissionPolicy,
        system_prompt: Vec<String>,
    ) -> Self {
        let usage_tracker = UsageTracker::from_session(&session);
        let max_parallel = std::env::var("MAX_PARALLEL_TASKS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(5);
        Self {
            session,
            api_client,
            tool_executor,
            permission_policy,
            system_prompt,
            max_iterations: 32,
            usage_tracker,
            max_context_tokens: 120_000,
            max_parallel,
            pending_images: Vec::new(),
            model: None,
            model_hints: None,
            hook_manager: HookManager::new(),
        }
    }

    #[must_use]
    pub fn with_max_parallel(mut self, max_parallel: usize) -> Self {
        self.max_parallel = max_parallel;
        self
    }

    #[must_use]
    pub fn with_max_iterations(mut self, max_iterations: usize) -> Self {
        self.max_iterations = max_iterations;
        self
    }

    #[must_use]
    pub fn with_max_context_tokens(mut self, max_context_tokens: usize) -> Self {
        self.max_context_tokens = max_context_tokens;
        self
    }

    #[must_use]
    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        self.model = Some(model.into());
        self
    }

    #[must_use]
    pub fn with_model_hints(mut self, hints: ModelHints) -> Self {
        #[allow(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            clippy::cast_precision_loss
        )]
        {
            self.max_context_tokens = (hints.max_context as f32 * hints.compaction_ratio) as usize;
        }
        self.model_hints = Some(hints);
        self
    }

    #[must_use]
    pub fn with_hooks(mut self, hooks: HookManager) -> Self {
        self.hook_manager = hooks;
        self
    }

    pub fn model_hints(&self) -> Option<&ModelHints> {
        self.model_hints.as_ref()
    }

    pub fn model_hints_mut(&mut self) -> Option<&mut ModelHints> {
        self.model_hints.as_mut()
    }

    pub fn set_system_prompt(&mut self, prompt: Vec<String>) {
        self.system_prompt = prompt;
    }

    pub fn max_context_tokens(&self) -> usize {
        self.max_context_tokens
    }

    pub fn preserve_usage_from(&mut self, other: &ConversationRuntime<C, T>) {
        let (cumulative, turns) = {
            let usage = other.usage_tracker.cumulative_usage();
            let turns = other.usage_tracker.turns();
            (usage, turns)
        };
        self.usage_tracker.set_cumulative(cumulative, turns);
    }

    pub fn usage_tracker_mut(&mut self) -> &mut UsageTracker {
        &mut self.usage_tracker
    }

    pub fn add_image(&mut self, image: ContentBlock) {
        self.pending_images.push(image);
    }

    pub fn has_pending_images(&self) -> bool {
        !self.pending_images.is_empty()
    }

    pub fn pending_image_count(&self) -> usize {
        self.pending_images.len()
    }

    /// Returns true if the current model supports image input.
    pub fn supports_images(&self) -> bool {
        self.model_hints.as_ref().is_some_and(|h| h.supports_images)
    }

    /// Clear all pending images without sending them.
    pub fn clear_pending_images(&mut self) {
        self.pending_images.clear();
    }

    /// Parse input for @image references and add them to pending images.
    /// Returns the text portion without @ references.
    pub fn parse_input_images(&mut self, input: &str) -> String {
        let mut result = String::new();
        let mut current_path = String::new();
        let mut in_at_path = false;

        for ch in input.chars() {
            if ch == '@' && !in_at_path {
                in_at_path = true;
                current_path.clear();
            } else if in_at_path {
                if ch.is_whitespace() || ch == '"' || ch == '\'' || ch == ')' || ch == ']' {
                    // End of path - try to load image
                    if !current_path.is_empty() {
                        if let Ok(blocks) = Self::load_image_from_path(&current_path) {
                            for block in blocks {
                                self.pending_images.push(block);
                            }
                        }
                    }
                    in_at_path = false;
                    result.push(ch);
                    current_path.clear();
                } else {
                    current_path.push(ch);
                }
            } else {
                result.push(ch);
            }
        }

        // Handle trailing @path
        if in_at_path && !current_path.is_empty() {
            if let Ok(blocks) = Self::load_image_from_path(&current_path) {
                for block in blocks {
                    self.pending_images.push(block);
                }
            }
        }

        result
    }

    fn load_image_from_path(path: &str) -> Result<Vec<ContentBlock>, std::io::Error> {
        use crate::session::ImageSource;
        use std::fs;

        let path = path.trim();
        if path.is_empty() {
            return Ok(Vec::new());
        }

        let data = fs::read(path)?;
        let encoded = base64_encode(&data);
        let media_type = guess_media_type(path);

        Ok(vec![ContentBlock::Image {
            source: ImageSource::Base64 {
                media_type,
                data: encoded,
            },
        }])
    }

    /// If the session exceeds the context threshold, auto-compact in place.
    /// Returns `true` if compaction occurred.
    fn maybe_auto_compact(&mut self) -> bool {
        let estimated = estimate_session_tokens(&self.session);
        if estimated < self.max_context_tokens {
            return false;
        }
        let config = CompactionConfig {
            preserve_recent_messages: 6,
            max_estimated_tokens: self.max_context_tokens / 2,
        };
        if !should_compact(&self.session, config) {
            return false;
        }
        let result = compact_session(&self.session, config);
        if result.removed_message_count > 0 {
            eprintln!(
                "\n  \x1b[33m⚠ auto-compacted {} messages (context was ~{}K tokens)\x1b[0m",
                result.removed_message_count,
                estimated / 1000
            );
            self.session = result.compacted_session;
            true
        } else {
            false
        }
    }

    #[allow(clippy::too_many_lines)]
    pub fn run_turn(
        &mut self,
        user_input: impl Into<String>,
        mut prompter: Option<&mut dyn PermissionPrompter>,
    ) -> Result<TurnSummary, RuntimeError> {
        let mut input_blocks = vec![ContentBlock::Text {
            text: user_input.into(),
        }];
        // Append any pending images loaded via @image syntax to the user message
        if !self.pending_images.is_empty() {
            input_blocks.extend(std::mem::take(&mut self.pending_images));
        }
        self.session
            .messages
            .push(ConversationMessage::user_with_content(input_blocks));

        let mut assistant_messages = Vec::new();
        let mut tool_results = Vec::new();
        let mut iterations = 0;

        let effective_max_iterations = self.model_hints.as_ref().map_or(self.max_iterations, |h| {
            h.effective_max_iterations(self.max_iterations)
        });

        loop {
            iterations += 1;
            if iterations > effective_max_iterations {
                return Err(RuntimeError::new(
                    "conversation loop exceeded the maximum number of iterations",
                ));
            }

            // Auto-compact if context is getting too large
            self.maybe_auto_compact();

            let thinking = self.model_hints.as_ref().and_then(|hints| {
                if hints.should_use_thinking() {
                    Some(api::types::ThinkingConfig {
                        config_type: "enabled".to_string(),
                        budget_tokens: hints.effective_thinking_budget(),
                    })
                } else {
                    None
                }
            });

            let system_prompt_blocks = self.build_system_prompt_blocks();
            let request = ApiRequest {
                system_prompt: self.system_prompt.clone(),
                system_prompt_blocks,
                messages: self.session.messages.clone(),
                thinking,
                images: std::mem::take(&mut self.pending_images),
            };

            // Retry with exponential backoff on transient errors (429, 5xx, network)
            let events = {
                let max_retries = 3_u32;
                let mut attempt = 0;
                loop {
                    attempt += 1;
                    match self.api_client.stream(request.clone()) {
                        Ok(events) => break events,
                        Err(err) if attempt <= max_retries && is_retryable_error(&err) => {
                            let backoff_ms = 1000 * 2_u64.pow(attempt - 1); // 1s, 2s, 4s
                            eprintln!(
                                "  \x1b[33m⚠ API error (attempt {attempt}/{max_retries}): {err}\x1b[0m"
                            );
                            eprintln!("  \x1b[33m  retrying in {backoff_ms}ms...\x1b[0m");
                            std::thread::sleep(std::time::Duration::from_millis(backoff_ms));
                        }
                        Err(err) => return Err(err),
                    }
                }
            };
            let (assistant_message, usage) = build_assistant_message(events)?;
            if let Some(usage) = usage {
                self.usage_tracker.record(usage);
            }
            let pending_tool_uses = assistant_message
                .blocks
                .iter()
                .filter_map(|block| match block {
                    ContentBlock::ToolUse { id, name, input } => {
                        Some((id.clone(), name.clone(), input.clone()))
                    }
                    _ => None,
                })
                .collect::<Vec<_>>();

            self.session.messages.push(assistant_message.clone());
            assistant_messages.push(assistant_message);

            if pending_tool_uses.is_empty() {
                break;
            }

            let authorized: Vec<_> = pending_tool_uses
                .iter()
                .map(|(id, name, input)| {
                    let permission_outcome = if let Some(prompt) = prompter.as_mut() {
                        self.permission_policy.authorize(name, input, Some(*prompt))
                    } else {
                        self.permission_policy.authorize(name, input, None)
                    };
                    (id.clone(), name.clone(), input.clone(), permission_outcome)
                })
                .collect();

            let running = Arc::new(AtomicUsize::new(0));
            let mut handles = Vec::new();

            for (tool_use_id, tool_name, input, permission_outcome) in authorized {
                while running.load(Ordering::Relaxed) >= self.max_parallel {
                    std::thread::sleep(std::time::Duration::from_micros(50));
                }
                running.fetch_add(1, Ordering::Relaxed);
                let executor = self.tool_executor.clone();
                let hooks = self.hook_manager.clone();
                let running_clone = running.clone();

                let handle = std::thread::spawn(move || {
                    struct Guard(Arc<AtomicUsize>);
                    impl Drop for Guard {
                        fn drop(&mut self) {
                            self.0.fetch_sub(1, Ordering::Relaxed);
                        }
                    }
                    let _guard = Guard(running_clone);
                    match permission_outcome {
                        PermissionOutcome::Deny { reason } => {
                            ConversationMessage::tool_result(tool_use_id, tool_name, reason, true)
                        }
                        PermissionOutcome::Allow => {
                            let mut executor = executor;
                            hooks.dispatch(&HookEvent::PreTool {
                                tool_name: &tool_name,
                                tool_input: &input,
                            });
                            match executor.execute(&tool_name, &input) {
                                Ok(output) => {
                                    hooks.dispatch(&HookEvent::PostTool {
                                        tool_name: &tool_name,
                                        tool_input: &input,
                                        tool_output: &output,
                                    });
                                    ConversationMessage::tool_result(
                                        tool_use_id,
                                        tool_name,
                                        output,
                                        false,
                                    )
                                }
                                Err(error) => {
                                    let msg = error.message.clone();
                                    hooks.dispatch(&HookEvent::ToolError {
                                        tool_name: &tool_name,
                                        tool_input: &input,
                                        error: &msg,
                                    });
                                    ConversationMessage::tool_result(
                                        tool_use_id,
                                        tool_name,
                                        msg,
                                        true,
                                    )
                                }
                            }
                        }
                    }
                });
                handles.push(handle);
            }

            for handle in handles {
                let result_message = handle.join().unwrap();
                self.session.messages.push(result_message.clone());
                tool_results.push(result_message);
            }
        }

        Ok(TurnSummary {
            assistant_messages,
            tool_results,
            iterations,
            usage: self.usage_tracker.cumulative_usage(),
        })
    }

    #[must_use]
    pub fn compact(&self, config: CompactionConfig) -> CompactionResult {
        compact_session(&self.session, config)
    }

    #[must_use]
    pub fn estimated_tokens(&self) -> usize {
        estimate_session_tokens(&self.session)
    }

    #[must_use]
    pub fn usage(&self) -> &UsageTracker {
        &self.usage_tracker
    }

    #[must_use]
    pub fn session(&self) -> &Session {
        &self.session
    }

    pub fn session_mut(&mut self) -> &mut Session {
        &mut self.session
    }

    #[must_use]
    pub fn into_session(self) -> Session {
        self.session
    }

    /// Build system prompt content blocks with cache control when the model supports it.
    /// Static content before `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` is marked as cacheable.
    fn build_system_prompt_blocks(&self) -> Option<Vec<api::types::SystemContentBlock>> {
        use crate::prompt::SYSTEM_PROMPT_DYNAMIC_BOUNDARY;

        let hints = self.model_hints.as_ref()?;
        if !hints.supports_prompt_cache {
            return None;
        }

        let full = self.system_prompt.join("\n\n");
        if let Some(split_pos) = full.find(SYSTEM_PROMPT_DYNAMIC_BOUNDARY) {
            let static_part = full[..split_pos].trim();
            let dynamic_part = full[split_pos + SYSTEM_PROMPT_DYNAMIC_BOUNDARY.len()..].trim();

            let mut blocks = Vec::new();
            if !static_part.is_empty() {
                blocks.push(api::types::SystemContentBlock::cached_text(static_part));
            }
            if !dynamic_part.is_empty() {
                blocks.push(api::types::SystemContentBlock::text(dynamic_part));
            }
            Some(blocks)
        } else {
            // No boundary marker — cache the whole thing
            Some(vec![api::types::SystemContentBlock::cached_text(full)])
        }
    }

    /// Run a single planning turn without tools, returning the raw assistant text.
    /// Used by Ultra Plan Mode to generate structured JSON plans without polluting
    /// the main conversation session.
    ///
    /// Uses model-specific optimizations:
    /// - `plan_thinking_budget` instead of regular `thinking_budget` for planning
    /// - `plan_mode_system_prompt_addition` appended to system prompt
    /// - Adaptive retry limits based on model capabilities
    pub fn run_planning_turn(&mut self, prompt: &str) -> Result<String, RuntimeError> {
        let mut temp_messages = self.session.messages.clone();
        temp_messages.push(ConversationMessage::user_text(prompt));

        // Build enhanced system prompt with plan-mode additions
        let system_prompt = if let Some(ref hints) = self.model_hints {
            if let Some(ref plan_addition) = hints.plan_mode_system_prompt_addition {
                let mut enhanced = self.system_prompt.clone();
                enhanced.push(format!("# Plan mode guidance\n{plan_addition}"));
                enhanced
            } else {
                self.system_prompt.clone()
            }
        } else {
            self.system_prompt.clone()
        };

        let thinking = self.model_hints.as_ref().and_then(|hints| {
            if hints.should_use_thinking() {
                Some(api::types::ThinkingConfig {
                    config_type: "enabled".to_string(),
                    budget_tokens: hints.thinking_budget_for_mode(true),
                })
            } else {
                None
            }
        });

        let system_prompt_blocks = if self
            .model_hints
            .as_ref()
            .is_some_and(|h| h.supports_prompt_cache)
        {
            use crate::prompt::SYSTEM_PROMPT_DYNAMIC_BOUNDARY;
            let full = system_prompt.join("\n\n");
            if let Some(split_pos) = full.find(SYSTEM_PROMPT_DYNAMIC_BOUNDARY) {
                let static_part = full[..split_pos].trim();
                let dynamic_part = full[split_pos + SYSTEM_PROMPT_DYNAMIC_BOUNDARY.len()..].trim();
                let mut blocks = Vec::new();
                if !static_part.is_empty() {
                    blocks.push(api::types::SystemContentBlock::cached_text(static_part));
                }
                if !dynamic_part.is_empty() {
                    blocks.push(api::types::SystemContentBlock::text(dynamic_part));
                }
                Some(blocks)
            } else {
                Some(vec![api::types::SystemContentBlock::cached_text(full)])
            }
        } else {
            None
        };

        let request = ApiRequest {
            system_prompt,
            system_prompt_blocks,
            messages: temp_messages,
            thinking,
            images: Vec::new(),
        };

        // Adaptive retry limits based on model capabilities
        let max_retries = self.model_hints.as_ref().map_or(3, |hints| {
            if hints.supports_ultra_planning {
                5 // More retries for complex planning with capable models
            } else {
                3
            }
        });

        let mut attempt = 0;
        let events = loop {
            attempt += 1;
            match self.api_client.stream(request.clone()) {
                Ok(events) => break events,
                Err(err) if attempt <= max_retries && is_retryable_error(&err) => {
                    let backoff_ms = 1000 * 2_u64.pow(attempt - 1);
                    eprintln!(
                        "  \x1b[33m⚠ Planning API error (attempt {attempt}/{max_retries}): {err}\x1b[0m"
                    );
                    std::thread::sleep(std::time::Duration::from_millis(backoff_ms));
                }
                Err(err) => return Err(err),
            }
        };

        let (assistant_message, usage) = build_assistant_message(events)?;
        if let Some(usage) = usage {
            self.usage_tracker.record(usage);
        }

        // Extract text blocks only (ignore tool uses — planning should not use tools)
        let text = assistant_message
            .blocks
            .iter()
            .filter_map(|b| match b {
                ContentBlock::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("");

        Ok(text)
    }
}

pub(crate) fn build_assistant_message(
    events: Vec<AssistantEvent>,
) -> Result<(ConversationMessage, Option<TokenUsage>), RuntimeError> {
    let mut text = String::new();
    let mut thinking = String::new();
    let mut blocks = Vec::new();
    let mut finished = false;
    let mut usage = None;

    for event in events {
        match event {
            AssistantEvent::TextDelta(delta) => {
                flush_thinking_block(&mut thinking, &mut blocks);
                text.push_str(&delta);
            }
            AssistantEvent::ThinkingDelta(delta) => thinking.push_str(&delta),
            AssistantEvent::ToolUse { id, name, input } => {
                flush_thinking_block(&mut thinking, &mut blocks);
                flush_text_block(&mut text, &mut blocks);
                blocks.push(ContentBlock::ToolUse { id, name, input });
            }
            AssistantEvent::Usage(value) => usage = Some(value),
            AssistantEvent::MessageStop => {
                finished = true;
            }
        }
    }

    flush_thinking_block(&mut thinking, &mut blocks);
    flush_text_block(&mut text, &mut blocks);

    if !finished {
        return Err(RuntimeError::new(
            "assistant stream ended without a message stop event",
        ));
    }
    if blocks.is_empty() {
        return Err(RuntimeError::new("assistant stream produced no content"));
    }

    Ok((
        ConversationMessage::assistant_with_usage(blocks, usage),
        usage,
    ))
}

fn flush_thinking_block(thinking: &mut String, blocks: &mut Vec<ContentBlock>) {
    if !thinking.is_empty() {
        blocks.push(ContentBlock::Thinking {
            thinking: std::mem::take(thinking),
            signature: None,
        });
    }
}

fn flush_text_block(text: &mut String, blocks: &mut Vec<ContentBlock>) {
    if !text.is_empty() {
        blocks.push(ContentBlock::Text {
            text: std::mem::take(text),
        });
    }
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = chunk.get(1).copied().unwrap_or(0) as usize;
        let b2 = chunk.get(2).copied().unwrap_or(0) as usize;
        result.push(CHARS[b0 >> 2] as char);
        result.push(CHARS[((b0 & 0x03) << 4) | (b1 >> 4)] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((b1 & 0x0F) << 2) | (b2 >> 6)] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[b2 & 0x3F] as char);
        } else {
            result.push('=');
        }
    }
    result
}

fn guess_media_type(path: &str) -> String {
    let path_lower = path.to_lowercase();
    if std::path::Path::new(&path_lower)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("png"))
    {
        "image/png".to_string()
    } else if std::path::Path::new(&path_lower)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("jpg"))
        || std::path::Path::new(&path_lower)
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("jpeg"))
    {
        "image/jpeg".to_string()
    } else if std::path::Path::new(&path_lower)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("gif"))
    {
        "image/gif".to_string()
    } else if std::path::Path::new(&path_lower)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("webp"))
    {
        "image/webp".to_string()
    } else if std::path::Path::new(&path_lower)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("svg"))
    {
        "image/svg+xml".to_string()
    } else {
        "application/octet-stream".to_string()
    }
}

fn is_retryable_error(err: &RuntimeError) -> bool {
    let msg = err.to_string().to_lowercase();
    msg.contains("429")
        || msg.contains("500")
        || msg.contains("502")
        || msg.contains("503")
        || msg.contains("529")
        || msg.contains("timeout")
        || msg.contains("timed out")
        || msg.contains("connection")
        || msg.contains("temporarily unavailable")
        || msg.contains("throttl")
        || msg.contains("rate limit")
}

type ToolHandler =
    Arc<Mutex<Option<Box<dyn FnMut(&str) -> Result<String, ToolError> + Send + 'static>>>>;

#[derive(Default, Clone)]
pub struct StaticToolExecutor {
    handlers: BTreeMap<String, ToolHandler>,
}

impl StaticToolExecutor {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn register(
        mut self,
        tool_name: impl Into<String>,
        handler: impl FnMut(&str) -> Result<String, ToolError> + Send + 'static,
    ) -> Self {
        self.handlers.insert(
            tool_name.into(),
            Arc::new(Mutex::new(Some(Box::new(handler)))),
        );
        self
    }
}

impl ToolExecutor for StaticToolExecutor {
    fn execute(&mut self, tool_name: &str, input: &str) -> Result<String, ToolError> {
        let handler = self
            .handlers
            .get(tool_name)
            .ok_or_else(|| ToolError::new(format!("unknown tool: {tool_name}")))?;
        let mut guard = handler.lock().unwrap();
        guard
            .take()
            .ok_or_else(|| ToolError::new(format!("handler already consumed: {tool_name}")))?(
            input
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ApiClient, ApiRequest, AssistantEvent, ConversationRuntime, RuntimeError,
        StaticToolExecutor,
    };
    use crate::compact::CompactionConfig;
    use crate::permissions::{
        PermissionMode, PermissionPolicy, PermissionPromptDecision, PermissionPrompter,
        PermissionRequest,
    };
    use crate::prompt::{ProjectContext, SystemPromptBuilder};
    use crate::session::{ContentBlock, MessageRole, Session};
    use crate::usage::TokenUsage;
    use std::path::PathBuf;

    struct ScriptedApiClient {
        call_count: usize,
    }

    impl ApiClient for ScriptedApiClient {
        fn stream(&mut self, request: ApiRequest) -> Result<Vec<AssistantEvent>, RuntimeError> {
            self.call_count += 1;
            match self.call_count {
                1 => {
                    assert!(request
                        .messages
                        .iter()
                        .any(|message| message.role == MessageRole::User));
                    Ok(vec![
                        AssistantEvent::TextDelta("Let me calculate that.".to_string()),
                        AssistantEvent::ToolUse {
                            id: "tool-1".to_string(),
                            name: "add".to_string(),
                            input: "2,2".to_string(),
                        },
                        AssistantEvent::Usage(TokenUsage {
                            input_tokens: 20,
                            output_tokens: 6,
                            cache_creation_input_tokens: 1,
                            cache_read_input_tokens: 2,
                        }),
                        AssistantEvent::MessageStop,
                    ])
                }
                2 => {
                    let last_message = request
                        .messages
                        .last()
                        .expect("tool result should be present");
                    assert_eq!(last_message.role, MessageRole::Tool);
                    Ok(vec![
                        AssistantEvent::TextDelta("The answer is 4.".to_string()),
                        AssistantEvent::Usage(TokenUsage {
                            input_tokens: 24,
                            output_tokens: 4,
                            cache_creation_input_tokens: 1,
                            cache_read_input_tokens: 3,
                        }),
                        AssistantEvent::MessageStop,
                    ])
                }
                _ => Err(RuntimeError::new("unexpected extra API call")),
            }
        }
    }

    struct PromptAllowOnce;

    impl PermissionPrompter for PromptAllowOnce {
        fn decide(&mut self, request: &PermissionRequest) -> PermissionPromptDecision {
            assert_eq!(request.tool_name, "add");
            PermissionPromptDecision::Allow
        }
    }

    #[test]
    fn runs_user_to_tool_to_result_loop_end_to_end_and_tracks_usage() {
        let api_client = ScriptedApiClient { call_count: 0 };
        let tool_executor = StaticToolExecutor::new().register("add", |input| {
            let total = input
                .split(',')
                .map(|part| part.parse::<i32>().expect("input must be valid integer"))
                .sum::<i32>();
            Ok(total.to_string())
        });
        let permission_policy = PermissionPolicy::new(PermissionMode::Prompt);
        let system_prompt = SystemPromptBuilder::new()
            .with_project_context(ProjectContext {
                cwd: PathBuf::from("/tmp/project"),
                current_date: "2026-03-31".to_string(),
                git_status: None,
                instruction_files: Vec::new(),
                design_file: None,
            })
            .with_os("linux", "6.8")
            .build();
        let mut runtime = ConversationRuntime::new(
            Session::new(),
            api_client,
            tool_executor,
            permission_policy,
            system_prompt,
        );

        let summary = runtime
            .run_turn("what is 2 + 2?", Some(&mut PromptAllowOnce))
            .expect("conversation loop should succeed");

        assert_eq!(summary.iterations, 2);
        assert_eq!(summary.assistant_messages.len(), 2);
        assert_eq!(summary.tool_results.len(), 1);
        assert_eq!(runtime.session().messages.len(), 4);
        assert_eq!(summary.usage.output_tokens, 10);
        assert!(matches!(
            runtime.session().messages[1].blocks[1],
            ContentBlock::ToolUse { .. }
        ));
        assert!(matches!(
            runtime.session().messages[2].blocks[0],
            ContentBlock::ToolResult {
                is_error: false,
                ..
            }
        ));
    }

    #[test]
    fn records_denied_tool_results_when_prompt_rejects() {
        struct RejectPrompter;
        impl PermissionPrompter for RejectPrompter {
            fn decide(&mut self, _request: &PermissionRequest) -> PermissionPromptDecision {
                PermissionPromptDecision::Deny {
                    reason: "not now".to_string(),
                }
            }
        }

        struct SingleCallApiClient;
        impl ApiClient for SingleCallApiClient {
            fn stream(&mut self, request: ApiRequest) -> Result<Vec<AssistantEvent>, RuntimeError> {
                if request
                    .messages
                    .iter()
                    .any(|message| message.role == MessageRole::Tool)
                {
                    return Ok(vec![
                        AssistantEvent::TextDelta("I could not use the tool.".to_string()),
                        AssistantEvent::MessageStop,
                    ]);
                }
                Ok(vec![
                    AssistantEvent::ToolUse {
                        id: "tool-1".to_string(),
                        name: "blocked".to_string(),
                        input: "secret".to_string(),
                    },
                    AssistantEvent::MessageStop,
                ])
            }
        }

        let mut runtime = ConversationRuntime::new(
            Session::new(),
            SingleCallApiClient,
            StaticToolExecutor::new(),
            PermissionPolicy::new(PermissionMode::Prompt),
            vec!["system".to_string()],
        );

        let summary = runtime
            .run_turn("use the tool", Some(&mut RejectPrompter))
            .expect("conversation should continue after denied tool");

        assert_eq!(summary.tool_results.len(), 1);
        assert!(matches!(
            &summary.tool_results[0].blocks[0],
            ContentBlock::ToolResult { is_error: true, output, .. } if output == "not now"
        ));
    }

    #[test]
    fn reconstructs_usage_tracker_from_restored_session() {
        struct SimpleApi;
        impl ApiClient for SimpleApi {
            fn stream(
                &mut self,
                _request: ApiRequest,
            ) -> Result<Vec<AssistantEvent>, RuntimeError> {
                Ok(vec![
                    AssistantEvent::TextDelta("done".to_string()),
                    AssistantEvent::MessageStop,
                ])
            }
        }

        let mut session = Session::new();
        session
            .messages
            .push(crate::session::ConversationMessage::assistant_with_usage(
                vec![ContentBlock::Text {
                    text: "earlier".to_string(),
                }],
                Some(TokenUsage {
                    input_tokens: 11,
                    output_tokens: 7,
                    cache_creation_input_tokens: 2,
                    cache_read_input_tokens: 1,
                }),
            ));

        let runtime = ConversationRuntime::new(
            session,
            SimpleApi,
            StaticToolExecutor::new(),
            PermissionPolicy::new(PermissionMode::Allow),
            vec!["system".to_string()],
        );

        assert_eq!(runtime.usage().turns(), 1);
        assert_eq!(runtime.usage().cumulative_usage().total_tokens(), 21);
    }

    #[test]
    fn compacts_session_after_turns() {
        struct SimpleApi;
        impl ApiClient for SimpleApi {
            fn stream(
                &mut self,
                _request: ApiRequest,
            ) -> Result<Vec<AssistantEvent>, RuntimeError> {
                Ok(vec![
                    AssistantEvent::TextDelta("done".to_string()),
                    AssistantEvent::MessageStop,
                ])
            }
        }

        let mut runtime = ConversationRuntime::new(
            Session::new(),
            SimpleApi,
            StaticToolExecutor::new(),
            PermissionPolicy::new(PermissionMode::Allow),
            vec!["system".to_string()],
        );
        runtime.run_turn("a", None).expect("turn a");
        runtime.run_turn("b", None).expect("turn b");
        runtime.run_turn("c", None).expect("turn c");

        let result = runtime.compact(CompactionConfig {
            preserve_recent_messages: 2,
            max_estimated_tokens: 1,
        });
        assert!(result.summary.contains("Conversation summary"));
        assert_eq!(
            result.compacted_session.messages[0].role,
            MessageRole::System
        );
    }
}
