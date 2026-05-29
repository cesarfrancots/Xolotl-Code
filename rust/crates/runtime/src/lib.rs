#![allow(
    dead_code,
    clippy::items_after_statements,
    clippy::needless_continue,
    clippy::match_same_arms,
    clippy::doc_link_with_quotes,
    clippy::doc_overindented_list_items,
    clippy::doc_markdown,
    clippy::too_many_arguments,
    clippy::missing_fields_in_debug,
    clippy::module_inception,
    clippy::needless_pass_by_value,
    clippy::unnecessary_debug_formatting,
    clippy::unused_async,
    clippy::uninlined_format_args,
    clippy::unnecessary_map_or,
    clippy::manual_range_contains,
    clippy::must_use_candidate,
    clippy::redundant_closure_for_method_calls
)]

mod bash;
mod bench;
mod bootstrap;
mod compact;
mod config;
mod conversation;
mod edit;
mod file_ops;
mod hooks;
mod json;
mod memory;
mod model_hints;
mod permissions;
mod plan;
mod prompt;
mod retrieval;
mod sdd;
mod session;
mod subagent;
mod supervisor;
mod todo;
mod tokenizer;
mod toolcall;
mod usage;
mod verify;
mod web_fetch;

pub use memory::{MemoryConfig, MemorySearchResult, MemorySystem, ObsidianVault, SessionNote};
pub use model_hints::{EffortLevel, ModelHints, ToolChoiceMode};
pub use sdd::{Complexity, ComplexityDetector, InternalSpec, SddEngine, SddPhase, SddState};
pub use tokenizer::{encoding_name_for_family, estimate_tokens, estimate_tokens_for_family};

pub use bash::{execute_bash, BashCommandInput, BashCommandOutput};
pub use bench::{BenchRecorder, EditOutcome, SharedBenchRecorder};
pub use bootstrap::{BootstrapPhase, BootstrapPlan};
pub use compact::{
    compact_session, estimate_session_tokens, estimate_session_tokens_for_family,
    format_compact_summary, get_compact_continuation_message, should_compact, CompactionConfig,
    CompactionResult,
};
pub use config::{
    ConfigEntry, ConfigError, ConfigLoader, ConfigSource, RuntimeConfig,
    CLAUDE_CODE_SETTINGS_SCHEMA_NAME,
};
pub use conversation::{
    ApiClient, ApiRequest, AssistantEvent, ConversationRuntime, RuntimeError, StaticToolExecutor,
    ToolError, ToolExecutor, TurnSummary,
};
pub use edit::{
    apply_edit, default_ladder, ladder_from_set, parse_search_replace, parse_udiff,
    AnchoredStrategy, EditApply, EditFormat, EditOp, EditStrategy, EditStrategySet, ExactStrategy,
    FuzzyStrategy, WhitespaceStrategy,
};
pub use file_ops::{
    edit_file, file_info, glob_search, grep_search, list_directory, read_file, read_image_base64,
    write_file, DirEntry, EditFileOutput, FileInfoOutput, GlobSearchOutput, GrepSearchInput,
    GrepSearchOutput, ListDirectoryOutput, ReadFileOutput, StructuredPatchHunk, TextFilePayload,
    WriteFileOutput,
};
pub use hooks::{Hook, HookEvent, HookManager, LoggingHook};
pub use permissions::{
    PermissionMode, PermissionOutcome, PermissionPolicy, PermissionPromptDecision,
    PermissionPrompter, PermissionRequest,
};
pub use plan::{
    build_plan_prompt, build_ultra_plan_prompt, extract_json_from_response, format_plan_summary,
    ParallelizationAnalysis, PlanArtifact, PlanMilestone, PlanPhase, PlanTask, RiskAssessment,
    RiskLevel, RollbackPoint,
};
pub use prompt::{
    load_system_prompt, load_system_prompt_with_hints, prepend_bullets, ContextFile,
    ProjectContext, PromptBuildError, SystemPromptBuilder, FRONTIER_MODEL_NAME,
    SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
};
pub use retrieval::{GraphRetrieval, RankedFile};
pub use session::{
    ContentBlock, ConversationMessage, ImageSource, MessageRole, Session, SessionError,
};
pub use subagent::{
    SubAgentConfig, SubAgentInfo, SubAgentResult, SubAgentSpawner, SubAgentStatus, TaskRegistry,
    TaskStatus,
};
pub use supervisor::{
    slugify_task, AgentControl, AgentEvent, AgentHandle, AgentId, AgentState, AgentSupervisor,
    ContextError, GitOpQueue, SharedContextStore, SupervisorError, WorktreeError, WorktreeManager,
};
pub use todo::{
    todo_read, todo_write, TodoItem, TodoOutput, TodoPriority, TodoStatus, TodoWriteInput,
};
pub use toolcall::{repair_json, validate_against_schema};
pub use usage::{cost_for_usage, pricing_for, ModelPricing, TokenUsage, UsageTracker};
pub use verify::{
    detect_project, format_digest, parse_check_output, resolve_verify_commands, Diagnostic,
    ProjectKind, VerifyCommand, VerifyCommands,
};
pub use web_fetch::{web_fetch, web_search, SearchResult, WebFetchInput, WebFetchOutput};
