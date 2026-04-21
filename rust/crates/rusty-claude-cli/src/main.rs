// Allow various clippy lints that would require significant refactoring
#![allow(
    clippy::too_many_lines,
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::needless_pass_by_value,
    clippy::format_push_string,
    clippy::unused_self,
    clippy::similar_names,
    clippy::case_sensitive_file_extension_comparisons,
    clippy::clone_on_ref_ptr,
    clippy::manual_let_else,
    clippy::doc_lazy_continuation,
    clippy::redundant_clone,
    clippy::unnecessary_wraps,
    clippy::unused_unit,
    clippy::let_underscore_untyped,
    clippy::if_same_then_else,
    clippy::too_many_arguments,
    clippy::assigning_clones,
    clippy::needless_continue,
    clippy::format_collect,
    clippy::no_effect_underscore_binding,
    dead_code
)]

mod bedrock;
mod input;
mod mcp;
mod openai;
mod render;
mod style;

use std::collections::HashSet;
use std::env;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use api::{
    AnthropicClient, ContentBlockDelta, ImageSource as ApiImageSource, InputContentBlock,
    InputMessage, MessageRequest, OutputContentBlock, StreamEvent as ApiStreamEvent,
    SystemContentBlock, ThinkingConfig, ToolChoice, ToolDefinition, ToolResultContentBlock,
};

use commands::handle_slash_command;
use compat_harness::{extract_manifest, UpstreamPaths};
use mcp::McpManager;
use runtime::{
    build_plan_prompt, extract_json_from_response, format_plan_summary,
    load_system_prompt_with_hints, ApiClient, ApiRequest, AssistantEvent, CompactionConfig,
    ContentBlock, ConversationMessage, ConversationRuntime, MemorySystem, MessageRole, ModelHints,
    PermissionMode, PermissionPolicy, PermissionPromptDecision, PermissionPrompter,
    PermissionRequest, PlanArtifact, RuntimeError, SddEngine, Session, TokenUsage, ToolError,
    ToolExecutor,
};
use tools::{execute_tool, mvp_tool_specs, DynamicToolSpec};

const DEFAULT_BEDROCK_MODEL: &str = "bedrock/us.anthropic.claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS: u32 = 16384;
const CLAW_VERSION: &str = "0.2.0";

static STDOUT_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn stdout_lock() -> &'static Mutex<()> {
    STDOUT_LOCK.get_or_init(|| Mutex::new(()))
}

/// Returns the default model.
/// Always uses Bedrock cross-region Sonnet 4.6.
fn default_model() -> String {
    DEFAULT_BEDROCK_MODEL.to_string()
}

/// Returns the current UTC date as `YYYY-MM-DD` using only stdlib.
fn today_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let mut days = secs / 86400;
    let mut year = 1970_u32;
    loop {
        let days_in_year = if is_leap_year(year) { 366 } else { 365 };
        if days < days_in_year {
            break;
        }
        days -= days_in_year;
        year += 1;
    }
    let months: [u64; 12] = if is_leap_year(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut month = 1_u32;
    for &m in &months {
        if days < m {
            break;
        }
        days -= m;
        month += 1;
    }
    format!("{year:04}-{month:02}-{:02}", days + 1)
}

fn is_leap_year(year: u32) -> bool {
    (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400)
}

/// Returns `~/.claw-code/` as an absolute path.
fn claw_home() -> PathBuf {
    let home = env::var("USERPROFILE")
        .or_else(|_| env::var("HOME")).map_or_else(|_| PathBuf::from("."), PathBuf::from);
    home.join(".claw-code")
}

/// Returns `~/.claw-code/sessions/` as an absolute path.
fn sessions_dir() -> PathBuf {
    claw_home().join("sessions")
}

/// Load API keys from `~/.claw-code/config.json` into env vars (only if not
/// already set). Silently skips if the file doesn't exist.
fn load_config_keys() {
    let path = claw_home().join("config.json");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return;
    };
    let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) else {
        return;
    };
    let Some(obj) = val.as_object() else {
        return;
    };
    for (key, value) in obj {
        if let Some(s) = value.as_str() {
            // Only set if not already present in environment
            if env::var(key).is_err() {
                env::set_var(key, s);
            }
        }
    }
}

/// Interactive setup wizard: writes API keys to `~/.claw-code/config.json`.
fn run_setup() -> Result<(), Box<dyn std::error::Error>> {
    use std::io::BufRead;

    println!("Claw Code setup — saves API keys to ~/.claw-code/config.json");
    println!("Press Enter to keep the current value. Type 'clear' to unset.\n");

    let config_path = claw_home().join("config.json");
    let mut config: serde_json::Map<String, serde_json::Value> = config_path
        .exists()
        .then(|| {
            std::fs::read_to_string(&config_path)
                .ok()
                .and_then(|t| serde_json::from_str(&t).ok())
        })
        .flatten()
        .unwrap_or_default();

    let keys = [
        (
            "BEDROCK_API_KEY",
            "AWS Bedrock API key — paste from the Bedrock console (recommended)",
        ),
        (
            "AWS_DEFAULT_REGION",
            "AWS region for Bedrock (default: us-east-1)",
        ),
        (
            "ANTHROPIC_API_KEY",
            "Anthropic direct API key (alternative to Bedrock)",
        ),
        ("KIMI_API_KEY", "Kimi / Moonshot k2.6 (for kimi/ models)"),
        (
            "KIMI_CODING_API_KEY",
            "Kimi K2.6 Coding (for kimi-coding/ models)",
        ),
        ("GLM_API_KEY", "Zhipu GLM (for glm/ models)"),
        ("MINIMAX_API_KEY", "MiniMax (for minimax/ models)"),
        ("DASHSCOPE_API_KEY", "Alibaba Qwen (for qwen/ models)"),
        ("OPENAI_API_KEY", "OpenAI or custom OpenAI-compat provider"),
        (
            "AWS_ACCESS_KEY_ID",
            "AWS Access Key ID (IAM auth — alternative to BEDROCK_API_KEY)",
        ),
        ("AWS_SECRET_ACCESS_KEY", "AWS Secret Access Key (IAM auth)"),
    ];

    let stdin = io::stdin();
    for (var, label) in &keys {
        let current = config
            .get(*var)
            .and_then(|v| v.as_str())
            .or(None)
            .map(|v| {
                if v.len() > 8 {
                    format!("{}…{}", &v[..4], &v[v.len() - 4..])
                } else {
                    "set".to_string()
                }
            });

        if let Some(ref hint) = current {
            eprint!("  {var} [{label}] (current: {hint}): ");
        } else {
            eprint!("  {var} [{label}]: ");
        }
        let _ = io::stderr().flush();

        let mut line = String::new();
        stdin.lock().read_line(&mut line)?;
        let trimmed = line.trim();

        if trimmed.is_empty() {
            // keep existing
        } else if trimmed == "clear" {
            config.remove(*var);
        } else {
            config.insert(
                var.to_string(),
                serde_json::Value::String(trimmed.to_string()),
            );
        }
    }

    std::fs::create_dir_all(claw_home())?;
    let json = serde_json::to_string_pretty(&serde_json::Value::Object(config))?;
    std::fs::write(&config_path, json)?;

    // Set permissions restrictive on Unix (best-effort)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&config_path, std::fs::Permissions::from_mode(0o600));
    }

    println!("\nConfig saved to {}", config_path.display());
    Ok(())
}

/// Interactive permission prompter for the REPL.
/// Prints a one-line preview of each tool call and waits for y/n/a.
struct ReplPermissionPrompter {
    always_allow: HashSet<String>,
    /// If true, every tool call is auto-approved without prompting.
    auto_accept: bool,
}

impl ReplPermissionPrompter {
    fn new(auto_accept: bool) -> Self {
        Self {
            always_allow: HashSet::new(),
            auto_accept,
        }
    }

    fn set_auto_accept(&mut self, on: bool) {
        self.auto_accept = on;
    }
}

impl PermissionPrompter for ReplPermissionPrompter {
    fn decide(&mut self, request: &PermissionRequest) -> PermissionPromptDecision {
        // Auto-accept: skip all prompts
        if self.auto_accept {
            return PermissionPromptDecision::Allow;
        }
        if self.always_allow.contains(&request.tool_name) {
            return PermissionPromptDecision::Allow;
        }

        // ── Styled permission prompt ──────────────────────────────────────────
        let preview: String = request.input.chars().take(200).collect();
        let display_name = request
            .tool_name
            .strip_prefix("mcp__")
            .unwrap_or(&request.tool_name);
        let width = 52usize;
        let bar = style::BOX_H.repeat(width);

        eprintln!();
        eprintln!(
            "  {}{}{}{}{}",
            style::YELLOW,
            style::BOX_TL,
            bar,
            style::BOX_TR,
            style::RESET
        );
        eprintln!(
            "  {}{}{}  {}Permission required{}  {}{}{}",
            style::YELLOW,
            style::BOX_V,
            style::RESET,
            style::WHITE_BOLD,
            style::RESET,
            style::YELLOW,
            style::BOX_V,
            style::RESET
        );
        eprintln!("  {}{}{}", style::YELLOW, style::BOX_V, style::RESET);
        eprintln!(
            "  {}{}{}  {}tool{}   {}",
            style::YELLOW,
            style::BOX_V,
            style::RESET,
            style::CYAN,
            style::RESET,
            display_name
        );
        // Print input preview (wrapping at width-4)
        let wrap_width = width.saturating_sub(9);
        let input_clean: String = preview.replace(['\n', '\t'], " ");
        let input_line = if input_clean.chars().count() > wrap_width {
            format!(
                "{}…",
                input_clean
                    .chars()
                    .take(wrap_width.saturating_sub(1))
                    .collect::<String>()
            )
        } else {
            input_clean
        };
        eprintln!(
            "  {}{}{}  {}input{}  {}",
            style::YELLOW,
            style::BOX_V,
            style::RESET,
            style::CYAN,
            style::RESET,
            input_line
        );
        eprintln!("  {}{}{}", style::YELLOW, style::BOX_V, style::RESET);
        eprintln!(
            "  {}{}{}  {}[y]{} Allow  {}[n]{} Deny  {}[a]{} Always  {}[!]{} Accept all",
            style::YELLOW,
            style::BOX_V,
            style::RESET,
            style::GREEN,
            style::RESET,
            style::RED,
            style::RESET,
            style::CYAN,
            style::RESET,
            style::ACCENT,
            style::RESET
        );
        eprintln!(
            "  {}{}{}{}{}",
            style::YELLOW,
            style::BOX_BL,
            bar,
            style::BOX_BR,
            style::RESET
        );
        eprint!("  {} ", style::PROMPT_ARROW);
        let _ = io::stderr().flush();

        let mut line = String::new();
        if io::stdin().lock().read_line(&mut line).is_err() {
            return PermissionPromptDecision::Deny {
                reason: "could not read permission response".to_string(),
            };
        }
        match line.trim().to_lowercase().as_str() {
            "y" | "yes" | "" => PermissionPromptDecision::Allow,
            "a" | "always" => {
                self.always_allow.insert(request.tool_name.clone());
                PermissionPromptDecision::Allow
            }
            "!" | "accept-all" => {
                self.auto_accept = true;
                eprintln!(
                    "  {}{}  Auto-accept mode enabled for this session.{}",
                    style::ACCENT,
                    style::WARN_SYM,
                    style::RESET
                );
                PermissionPromptDecision::Allow
            }
            _ => PermissionPromptDecision::Deny {
                reason: "denied by user".to_string(),
            },
        }
    }
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().skip(1).collect();

    // Load persisted keys before anything that might need them
    if !matches!(
        args.first().map(String::as_str),
        Some("setup" | "--help" | "-h" | "dump-manifests" | "bootstrap-plan" |
"system-prompt")
    ) {
        load_config_keys();
    }

    match parse_args(&args)? {
        CliAction::DumpManifests => dump_manifests(),
        CliAction::BootstrapPlan => print_bootstrap_plan(),
        CliAction::PrintSystemPrompt { cwd, date, model } => print_system_prompt(cwd, date, model),
        CliAction::ResumeSession {
            session_path,
            command,
        } => resume_session(&session_path, command),
        CliAction::Prompt { prompt, model } => {
            LiveCli::new(model, false, false)?.run_turn(&prompt)?;
        }
        CliAction::Repl { model, auto_accept } => run_repl(model, auto_accept)?,
        CliAction::Setup => run_setup()?,
        CliAction::Help => print_help(),
        CliAction::SubAgent {
            prompt,
            output_path,
            model,
        } => run_subagent(&prompt, &output_path, model)?,
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum CliAction {
    DumpManifests,
    BootstrapPlan,
    PrintSystemPrompt {
        cwd: PathBuf,
        date: String,
        model: String,
    },
    ResumeSession {
        session_path: PathBuf,
        command: Option<String>,
    },
    Prompt {
        prompt: String,
        model: String,
    },
    Repl {
        model: String,
        auto_accept: bool,
    },
    Setup,
    Help,
    SubAgent {
        prompt: String,
        output_path: PathBuf,
        model: String,
    },
}

fn parse_args(args: &[String]) -> Result<CliAction, String> {
    let mut model = default_model();
    let mut auto_accept = false;
    let mut max_parallel = None;
    let mut sub_agent_prompt = None;
    let mut sub_agent_output_path = None;
    let mut rest = Vec::new();
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
            "--version" | "-v" => {
                println!("claw version {CLAW_VERSION}");
                std::process::exit(0);
            }
            "--model" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "missing value for --model".to_string())?;
                model = value.clone();
                index += 2;
            }
            flag if flag.starts_with("--model=") => {
                model = flag[8..].to_string();
                index += 1;
            }
            "--max-parallel-tasks" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "missing value for --max-parallel-tasks".to_string())?;
                max_parallel = Some(value.clone());
                index += 2;
            }
            flag if flag.starts_with("--max-parallel-tasks=") => {
                max_parallel = Some(flag[22..].to_string());
                index += 1;
            }
            "--task-prompt" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "missing value for --task-prompt".to_string())?;
                sub_agent_prompt = Some(value.clone());
                index += 2;
            }
            flag if flag.starts_with("--task-prompt=") => {
                sub_agent_prompt = Some(flag[14..].to_string());
                index += 1;
            }
            "--task-output" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "missing value for --task-output".to_string())?;
                sub_agent_output_path = Some(PathBuf::from(value));
                index += 2;
            }
            flag if flag.starts_with("--task-output=") => {
                sub_agent_output_path = Some(PathBuf::from(&flag[14..]));
                index += 1;
            }
            "--print-output" => {
                // Flag only, no value — signals sub-agent mode
                index += 1;
            }
            // Auto-accept flags (all equivalent)
            "--yes" | "-y" | "--dangerously-skip-permissions" | "-Y" => {
                auto_accept = true;
                index += 1;
            }
            other => {
                rest.push(other.to_string());
                index += 1;
            }
        }
    }

    if let Some(val) = max_parallel {
        env::set_var("MAX_PARALLEL_TASKS", val);
    }

    // Sub-agent mode: --print-output --task-prompt <prompt> --task-output <path>
    if let (Some(prompt), Some(output_path)) =
        (sub_agent_prompt.take(), sub_agent_output_path.take())
    {
        return Ok(CliAction::SubAgent {
            prompt,
            output_path,
            model,
        });
    }

    if rest.is_empty() {
        return Ok(CliAction::Repl { model, auto_accept });
    }
    if matches!(rest.first().map(String::as_str), Some("--help" | "-h")) {
        return Ok(CliAction::Help);
    }
    if rest.first().map(String::as_str) == Some("--resume") {
        return parse_resume_args(&rest[1..]);
    }

    match rest[0].as_str() {
        "dump-manifests" => Ok(CliAction::DumpManifests),
        "bootstrap-plan" => Ok(CliAction::BootstrapPlan),
        "setup" => Ok(CliAction::Setup),
        "system-prompt" => parse_system_prompt_args(&rest[1..], model.clone()),
        "prompt" => {
            let prompt = rest[1..].join(" ");
            if prompt.trim().is_empty() {
                return Err("prompt subcommand requires a prompt string".to_string());
            }
            Ok(CliAction::Prompt { prompt, model })
        }
        other => Err(format!("unknown subcommand: {other}")),
    }
}

fn parse_system_prompt_args(args: &[String], model: String) -> Result<CliAction, String> {
    let mut cwd = env::current_dir().map_err(|error| error.to_string())?;
    let mut date = today_iso();
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
            "--cwd" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "missing value for --cwd".to_string())?;
                cwd = PathBuf::from(value);
                index += 2;
            }
            "--date" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "missing value for --date".to_string())?;
                date.clone_from(value);
                index += 2;
            }
            other => return Err(format!("unknown system-prompt option: {other}")),
        }
    }

    Ok(CliAction::PrintSystemPrompt { cwd, date, model })
}

fn parse_resume_args(args: &[String]) -> Result<CliAction, String> {
    let session_path = args
        .first()
        .ok_or_else(|| "missing session path for --resume".to_string())
        .map(PathBuf::from)?;
    let command = args.get(1).cloned();
    if args.len() > 2 {
        return Err("--resume accepts at most one trailing slash command".to_string());
    }
    Ok(CliAction::ResumeSession {
        session_path,
        command,
    })
}

fn dump_manifests() {
    let workspace_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let paths = UpstreamPaths::from_workspace_dir(&workspace_dir);
    match extract_manifest(&paths) {
        Ok(manifest) => {
            println!("commands: {}", manifest.commands.entries().len());
            println!("tools: {}", manifest.tools.entries().len());
            println!("bootstrap phases: {}", manifest.bootstrap.phases().len());
        }
        Err(error) => {
            eprintln!("failed to extract manifests: {error}");
            std::process::exit(1);
        }
    }
}

fn print_bootstrap_plan() {
    for phase in runtime::BootstrapPlan::claude_code_default().phases() {
        println!("- {phase:?}");
    }
}

fn print_system_prompt(cwd: PathBuf, date: String, model: String) {
    let hints = ModelHints::for_model(&model);
    match load_system_prompt_with_hints(cwd, date, env::consts::OS, "unknown", hints) {
        Ok(sections) => println!("{}", sections.join("\n\n")),
        Err(error) => {
            eprintln!("failed to build system prompt: {error}");
            std::process::exit(1);
        }
    }
}

fn resume_session(session_path: &Path, command: Option<String>) {
    let session = match Session::load_from_path(session_path) {
        Ok(session) => session,
        Err(error) => {
            eprintln!("failed to restore session: {error}");
            std::process::exit(1);
        }
    };

    match command {
        Some(command) if command.starts_with('/') => {
            let Some(result) = handle_slash_command(
                &command,
                &session,
                CompactionConfig {
                    max_estimated_tokens: 0,
                    ..CompactionConfig::default()
                },
            ) else {
                eprintln!("unknown slash command: {command}");
                std::process::exit(2);
            };
            if let Err(error) = result.session.save_to_path(session_path) {
                eprintln!("failed to persist resumed session: {error}");
                std::process::exit(1);
            }
            println!("{}", result.message);
        }
        Some(other) => {
            eprintln!("unsupported resumed command: {other}");
            std::process::exit(2);
        }
        None => {
            println!(
                "Restored session from {} ({} messages).",
                session_path.display(),
                session.messages.len()
            );
        }
    }
}

fn run_repl(model: String, auto_accept: bool) -> Result<(), Box<dyn std::error::Error>> {
    let mut cli = LiveCli::new(model, true, auto_accept)?;
    let mut editor = input::LineEditor::new("› ");

    print_startup_banner(&cli);

    while let Some(input) = editor.read_line()? {
        let trimmed = cli.runtime.parse_input_images(input.trim());
        let pending_image_count = cli.runtime.pending_image_count();
        if pending_image_count > 0 {
            println!(
                "  {}{}{} {} image(s) attached{}",
                style::CYAN,
                style::BOLD,
                style::CHECK,
                pending_image_count,
                style::RESET
            );
        }
        if trimmed.is_empty() && !cli.runtime.has_pending_images() {
            continue;
        }

        // Dispatch slash commands
        if trimmed.starts_with('/') {
            // Handle multi-word commands first (/memory search <query>)
            if trimmed.starts_with("/memory search") {
                let query = trimmed.strip_prefix("/memory search").unwrap().trim();
                if query.is_empty() {
                    println!(
                        "  {}Usage: /memory search <query>{}",
                        style::MUTED,
                        style::RESET
                    );
                } else {
                    cli.search_memory(query);
                }
                continue;
            }

            // Single-word + argument commands (splitn(2) preserves full arg)
            let parts: Vec<&str> = trimmed.splitn(2, ' ').collect();
            match parts[0] {
                "/exit" | "/quit" => break,
                "/help" => print_slash_help(),
                "/status" => cli.print_status(),
                "/cost" => cli.print_cost(),
                "/compact" => cli.compact()?,
                "/clear" => cli.clear_session()?,
                "/save" => cli.save_session()?,
                "/load" => {
                    if let Some(id) = parts.get(1).copied() {
                        let id = id.trim();
                        if id.is_empty() {
                            println!(
                                "  {}Usage: /load <session-id>{}",
                                style::MUTED,
                                style::RESET
                            );
                        } else {
                            cli.load_session(id)?;
                        }
                    } else {
                        list_sessions();
                    }
                }
                "/mcp" => cli.print_mcp_status(),
                "/doctor" => run_doctor(),
                "/init" => run_init()?,
                "/sessions" => list_sessions(),
                "/accept-all" | "/permissions" => cli.toggle_auto_accept(),
                "/budget" => {
                    if let Some(amount) = parts.get(1).and_then(|s| s.trim().parse::<f64>().ok()) {
                        cli.set_budget(amount);
                    } else {
                        cli.print_budget();
                    }
                }
                "/model" => {
                    if let Some(name) = parts.get(1).copied() {
                        cli.set_model(name.trim())?;
                    } else {
                        print_model_help(&cli.model);
                    }
                }
                "/memory" | "/memory status" => {
                    cli.print_memory_status();
                }
                "/plan" => {
                    if let Some(desc) = parts.get(1).copied() {
                        let desc = desc.trim();
                        if desc.is_empty() {
                            println!(
                                "  {}Usage: /plan <description>{}",
                                style::MUTED,
                                style::RESET
                            );
                        } else if let Err(e) = cli.generate_plan(desc) {
                            style::print_err(&e.to_string());
                        }
                    } else {
                        cli.print_plan_status();
                    }
                }
                "/plan status" => {
                    cli.print_plan_status();
                }
                "/plan abort" => {
                    cli.abort_plan();
                }
                "/rollback" => {
                    let n = parts
                        .get(1)
                        .and_then(|s| s.trim().parse::<usize>().ok())
                        .unwrap_or(1);
                    cli.rollback(n);
                }
                "/diff" => {
                    cli.print_session_diff();
                }
                other => {
                    style::print_err(&format!("Unknown command: {other}  (try /help)"));
                }
            }
            continue;
        }

        // Check cost budget before running a turn
        if cli.is_over_budget() {
            style::print_err(&format!(
                "Cost budget exceeded (${:.2}). Use /budget <amount> to increase.",
                cli.budget_limit.unwrap_or(0.0)
            ));
            continue;
        }

        // SDD: Analyze complexity and suggest next tools (invisible state machine)
        if let Some(suggestion) = cli.sdd_suggest(&trimmed) {
            println!();
            println!(
                "  {}{} SDD: {}{}",
                style::CYAN,
                style::BOLD,
                suggestion,
                style::RESET
            );
            println!();
        }

        let turn_start = std::time::Instant::now();
        cli.run_turn(&trimmed)?;

        // Write session summary to Obsidian memory after each turn
        cli.write_session_memory(turn_start.elapsed().as_secs());
    }

    println!("\n  {}Bye.{}\n", style::MUTED, style::RESET);
    Ok(())
}

fn print_startup_banner(cli: &LiveCli) {
    use style::{format_model, shorten_path, ACCENT, SPARKLE, RESET, YELLOW, WARN_SYM, MUTED, BOX_H, strip_ansi_len, BOX_V, BOX_TL, BOX_TR, BOLD, CLAW_ICON, BOX_LM, BOX_RM, GRAY, WHITE_BOLD, BOX_BL, BOX_BR, ARROW_UP, ARROW_DOWN};

    // Gather info
    let model_display = format_model(&cli.model);
    let cwd = env::current_dir().map_or_else(|_| ".".to_string(), |p| shorten_path(&p));
    let mcp_count = cli.mcp.lock().map(|m| m.tools.len()).unwrap_or(0);
    let builtin_count = tools::mvp_tool_specs().len();
    let tool_str = if mcp_count > 0 {
        format!("{builtin_count} built-in  {ACCENT}{SPARKLE}{RESET} {mcp_count} MCP")
    } else {
        format!("{builtin_count} built-in")
    };
    let mode_str = if cli.auto_accept {
        format!("{YELLOW}{WARN_SYM} auto-accept (all tools approved){RESET}")
    } else {
        format!("{MUTED}prompt for writes{RESET}")
    };

    // Inner width of the box (between the vertical bars)
    let inner = 52usize;
    let bar = BOX_H.repeat(inner);
    let pad = |s: &str| {
        let vis = strip_ansi_len(s);
        let p = inner.saturating_sub(2).saturating_sub(vis);
        format!(
            "  {ACCENT}{BOX_V}{RESET}  {s}{}{ACCENT}{BOX_V}{RESET}",
            " ".repeat(p)
        )
    };

    println!();
    println!("  {ACCENT}{BOX_TL}{bar}{BOX_TR}{RESET}");
    // Logo row
    let logo = format!("{ACCENT}{BOLD}{CLAW_ICON} claw{RESET}  {MUTED}v{CLAW_VERSION}{RESET}");
    println!("{}", pad(&logo));
    // Divider row
    let div_inner = BOX_H.repeat(inner.saturating_sub(2));
    println!("  {ACCENT}{BOX_V}{BOX_LM}{div_inner}{BOX_RM}{BOX_V}{RESET}");
    // model
    let model_row = format!("{GRAY}model   {RESET}{WHITE_BOLD}{model_display}{RESET}");
    println!("{}", pad(&model_row));
    // cwd
    let cwd_row = format!("{GRAY}cwd     {RESET}{MUTED}{cwd}{RESET}");
    println!("{}", pad(&cwd_row));
    // tools
    let tools_row = format!("{GRAY}tools   {RESET}{tool_str}");
    println!("{}", pad(&tools_row));
    // mode
    let mode_row = format!("{GRAY}mode    {RESET}{mode_str}");
    println!("{}", pad(&mode_row));
    // Divider row before session
    println!("  {ACCENT}{BOX_V}{BOX_LM}{div_inner}{BOX_RM}{BOX_V}{RESET}");
    // session path
    let sess_short = shorten_path(&cli.auto_save_path);
    let sess_row = format!("{GRAY}session {RESET}{MUTED}{sess_short}{RESET}");
    println!("{}", pad(&sess_row));
    // Bottom
    println!("  {ACCENT}{BOX_BL}{bar}{BOX_BR}{RESET}");
    println!();
    println!("  {MUTED}/help for commands  ·  {ARROW_UP}/{ARROW_DOWN} history  ·  Shift+Enter newline{RESET}");
    println!();
}

fn print_slash_help() {
    use style::{WHITE_BOLD, RESET, MUTED, DIVIDER_SHORT, ACCENT, PROMPT_ARROW, CYAN, GRAY, ARROW_UP, ARROW_DOWN};
    println!();
    println!("  {WHITE_BOLD}Commands{RESET}");
    println!("  {MUTED}{DIVIDER_SHORT}{RESET}");
    println!("  {ACCENT}{PROMPT_ARROW}{RESET} Conversation  {CYAN}/clear{RESET} · {CYAN}/compact{RESET} · {CYAN}/save{RESET} · {CYAN}/load{RESET} · {CYAN}/model{RESET}");
    println!("  {ACCENT}{PROMPT_ARROW}{RESET} Plan Mode     {CYAN}/plan <description>{RESET} · {CYAN}/plan status{RESET} · {CYAN}/plan abort{RESET}");
    println!("  {ACCENT}{PROMPT_ARROW}{RESET} Session Ctrl  {CYAN}/rollback <n>{RESET} · {CYAN}/diff{RESET}");
    println!("  {ACCENT}{PROMPT_ARROW}{RESET} Info          {CYAN}/status{RESET} · {CYAN}/cost{RESET} · {CYAN}/budget{RESET} · {CYAN}/sessions{RESET}");
    println!("  {ACCENT}{PROMPT_ARROW}{RESET} Memory        {CYAN}/memory{RESET} · {CYAN}/memory search <query>{RESET}");
    println!("  {ACCENT}{PROMPT_ARROW}{RESET} Tools         {CYAN}/mcp{RESET} · {CYAN}/permissions{RESET} · {CYAN}/accept-all{RESET}");
    println!(
        "  {ACCENT}{PROMPT_ARROW}{RESET} Project       {CYAN}/init{RESET} · {CYAN}/doctor{RESET}"
    );
    println!(
        "  {ACCENT}{PROMPT_ARROW}{RESET} Session       {CYAN}/help{RESET} · {CYAN}/exit{RESET}"
    );
    println!();
    println!("  {GRAY}Keyboard{RESET}");
    println!("  {MUTED}  {ARROW_UP}/{ARROW_DOWN}   Browse input history{RESET}");
    println!("  {MUTED}  Shift+Enter   Insert newline{RESET}");
    println!("  {MUTED}  Ctrl+C        Cancel current input{RESET}");
    println!();
}

fn print_model_help(current: &str) {
    use style::{format_model, GRAY, RESET, WHITE_BOLD, MUTED, CYAN};
    println!();
    println!(
        "  {GRAY}current{RESET}  {WHITE_BOLD}{}{RESET}",
        format_model(current)
    );
    println!();
    println!("  {MUTED}Usage: /model <alias or full-id>{RESET}");
    println!();
    println!("  {CYAN}sonnet{RESET}       Claude Sonnet 4.6  {GRAY}(default){RESET}");
    println!("  {CYAN}opus{RESET}         Claude Opus 4.6");
    println!("  {CYAN}haiku{RESET}        Claude Haiku 4.5   {GRAY}(fast · cheap){RESET}");
    println!("  {CYAN}sonnet4.5{RESET}    Claude Sonnet 4.5");
    println!("  {CYAN}opus4.5{RESET}      Claude Opus 4.5");
    println!("  {CYAN}opusplan{RESET}     Opus 4.6 plans, Sonnet 4.6 executes");
    println!();
    println!(
        "  {CYAN}kimi-coding{RESET}  Kimi K2.6 Coding   {GRAY}(coding-optimized · 256K ctx){RESET}"
    );
    println!("  {CYAN}kimi2.6{RESET}      Kimi K2.6 Standard {GRAY}(general purpose){RESET}");
    println!("  {CYAN}minimax2.7{RESET}   MiniMax 2.7        {GRAY}(1M context){RESET}");
    println!("  {CYAN}glm5.1{RESET}       GLM 5.1            {GRAY}(128K context){RESET}");
    println!("  {CYAN}qwen3.6{RESET}      Qwen 3.6 Plus");
    println!();
    println!("  {MUTED}Dual model:  /model opus+sonnet{RESET}");
    println!();
}

struct LiveCli {
    model: String,
    system_prompt: Vec<String>,
    runtime: ConversationRuntime<AnyApiClient, CliToolExecutor>,
    prompter: ReplPermissionPrompter,
    auto_save_path: PathBuf,
    mcp: Arc<Mutex<McpManager>>,
    budget_limit: Option<f64>,
    auto_accept: bool,
    turn_start: Option<std::time::Instant>,
    sdd_engine: SddEngine,
    memory: Option<MemorySystem>,
    session_start: std::time::Instant,
    plan_artifact: Option<PlanArtifact>,
    plan_path: Option<PathBuf>,
}

impl LiveCli {
    fn new(
        model: String,
        enable_tools: bool,
        auto_accept: bool,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        // Connect to MCP servers (errors are warnings, not fatal)
        let mcp = Arc::new(Mutex::new(McpManager::connect()));
        let system_prompt = build_system_prompt(&model)?;
        let runtime = build_runtime(
            Session::new(),
            model.clone(),
            system_prompt.clone(),
            Arc::clone(&mcp),
            enable_tools,
        )?;
        // Create a stable session path for this REPL invocation.
        let dir = sessions_dir();
        std::fs::create_dir_all(&dir)?;
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let auto_save_path = dir.join(format!("session-{ts}.json"));

        let model_hints = ModelHints::for_model(&model);
        let sdd_engine = SddEngine::new().with_aggressive_read(model_hints.aggressive_read);

        let memory = MemorySystem::discover_vault().map(|vault_path| MemorySystem::new(runtime::MemoryConfig {
                enabled: true,
                vault_path: Some(vault_path),
                ..Default::default()
            }));

        Ok(Self {
            model,
            system_prompt,
            runtime,
            prompter: ReplPermissionPrompter::new(auto_accept),
            auto_save_path,
            mcp,
            budget_limit: None,
            auto_accept,
            turn_start: None,
            sdd_engine,
            memory,
            session_start: std::time::Instant::now(),
            plan_artifact: None,
            plan_path: None,
        })
    }

    fn run_turn(&mut self, input: &str) -> Result<(), Box<dyn std::error::Error>> {
        use style::fmt_num;
        println!(); // breathing room before response
        self.inject_memory_context(input);
        self.turn_start = Some(std::time::Instant::now());
        let result = self.runtime.run_turn(input, Some(&mut self.prompter));
        let elapsed = self
            .turn_start
            .take()
            .map(|s| s.elapsed())
            .unwrap_or_default();
        match result {
            Ok(_) => {
                let cost = self
                    .runtime
                    .usage()
                    .cost_usd(primary_model_name(&self.model));
                let usage = self.runtime.usage().cumulative_usage();
                let secs = elapsed.as_secs_f64();
                let dur_str = if secs < 60.0 {
                    format!("{secs:.1}s")
                } else {
                    format!("{:.0}m{:.0}s", secs / 60.0, secs % 60.0)
                };
                println!(
                    "\n  {muted}{up}{in_tok} in · {down}{out_tok} out{cache_str}  ·  ${cost:.4}  ·  {dur}{reset}",
                    muted  = style::MUTED,
                    up     = style::ARROW_UP,
                    in_tok = fmt_num(usage.input_tokens),
                    down   = style::ARROW_DOWN,
                    out_tok= fmt_num(usage.output_tokens),
                    cache_str = if usage.cache_read_input_tokens > 0 {
                        format!(" · {}✦ {} cached{}", style::ACCENT, fmt_num(usage.cache_read_input_tokens), style::MUTED)
                    } else { String::new() },
                    cost   = cost,
                    dur    = dur_str,
                    reset  = style::RESET,
                );
                // Auto-save after every successful turn
                if let Err(e) = self.runtime.session().save_to_path(&self.auto_save_path) {
                    style::print_warn(&format!("auto-save failed: {e}"));
                }
                Ok(())
            }
            Err(error) => {
                style::print_err(&error.to_string());
                Err(Box::new(error))
            }
        }
    }

    fn toggle_auto_accept(&mut self) {
        self.auto_accept = !self.auto_accept;
        self.prompter.set_auto_accept(self.auto_accept);
        if self.auto_accept {
            println!();
            println!(
                "  {}{}{}  {}Auto-accept ON{} — all tool calls approved automatically",
                style::YELLOW,
                style::WARN_SYM,
                style::RESET,
                style::YELLOW,
                style::RESET
            );
            println!(
                "  {}  Run /accept-all again to turn off{}",
                style::MUTED,
                style::RESET
            );
            println!();
        } else {
            style::print_ok("Auto-accept OFF — tool calls will prompt for permission.");
        }
    }

    fn sdd_suggest(&mut self, input: &str) -> Option<String> {
        if input.starts_with('/') {
            return None;
        }
        
        self.sdd_engine.analyze(input)
    }

    fn write_session_memory(&self, duration_secs: u64) {
        

        let Some(memory) = &self.memory else { return };
        if !memory.is_enabled() {
            return;
        }

        let messages = &self.runtime.session().messages;
        if messages.is_empty() {
            return;
        }

        let task = if let Some(first) = messages.first() {
            first
                .blocks
                .iter()
                .find_map(|b| {
                    if let runtime::ContentBlock::Text { text } = b {
                        Some(text.chars().take(100).collect::<String>())
                    } else {
                        None
                    }
                })
                .unwrap_or_else(|| "Untitled session".to_string())
        } else {
            return;
        };

        let files_changed: Vec<String> = messages
            .iter()
            .filter_map(|m| {
                if m.role != runtime::MessageRole::Assistant {
                    return None;
                }
                Some(
                    m.blocks
                        .iter()
                        .filter_map(|b| match b {
                            runtime::ContentBlock::Text { text } if text.starts_with("Writing") => {
                                Some(text.clone())
                            }
                            _ => None,
                        })
                        .collect::<Vec<_>>(),
                )
            })
            .flatten()
            .take(10)
            .collect();

        let phase = format!("{:?}", self.sdd_engine.state().phase);
        let complexity = self
            .sdd_engine
            .state()
            .complexity
            .map(|c| format!("{c:?}"))
            .unwrap_or_default();

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();
        let secs = now.as_secs();
        let date = format!(
            "{} {:02}:{:02}",
            today_iso(),
            (secs % 86400) / 3600,
            (secs % 3600) / 60
        );

        let note = runtime::SessionNote {
            title: task.clone(),
            date,
            task,
            phase: Some(phase),
            complexity: Some(complexity),
            models: vec![self.model.clone()],
            files_changed,
            duration_seconds: Some(duration_secs),
            content: String::new(),
            tags: vec![
                format!(
                    "#phase-{}",
                    self.sdd_engine
                        .state()
                        .phase
                        .description()
                        .to_lowercase()
                        .replace(' ', "-")
                ),
                "#session".to_string(),
            ],
        };

        if let Err(e) = memory.write_session_note(&note) {
            eprintln!(
                "  {}Failed to write session note: {}{}",
                style::WARN_SYM,
                e,
                style::RESET
            );
        }
    }

    fn inject_memory_context(&mut self, input: &str) {
        let Some(memory) = &self.memory else { return };
        if !memory.is_enabled() {
            return;
        }

        // Use semantic TF-IDF search for much better relevance than keyword matching
        let results = match memory.semantic_search(input, 5) {
            Ok(r) if !r.is_empty() => r,
            _ => {
                // Fallback to recent sessions if semantic search yields nothing
                match memory.get_recent_sessions(3) {
                    Ok(paths) => paths
                        .into_iter()
                        .map(|p| runtime::MemorySearchResult {
                            path: p.clone(),
                            title: p
                                .file_stem()
                                .and_then(|s| s.to_str())
                                .unwrap_or("unknown")
                                .replace('-', " "),
                            score: 0.0,
                            snippet: String::new(),
                        })
                        .collect(),
                    Err(_) => return,
                }
            }
        };

        let mut summaries = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for result in results {
            let key = result.path.to_string_lossy().to_string();
            if seen.contains(&key) {
                continue;
            }
            seen.insert(key);
            summaries.push(format!("- {} — {}", result.title, result.snippet));
            if summaries.len() >= 5 {
                break;
            }
        }

        if summaries.is_empty() {
            return;
        }

        let memory_section = format!(
            "# Relevant past sessions\nThe following past sessions may be relevant to the current task:\n{}",
            summaries.join("\n")
        );

        let mut prompt = self.system_prompt.clone();
        let boundary_pos = prompt
            .iter()
            .position(|s| s.contains("__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__"));
        if let Some(pos) = boundary_pos {
            prompt.insert(pos + 1, memory_section);
        } else {
            prompt.push(memory_section);
        }
        self.runtime.set_system_prompt(prompt);
    }

    fn print_memory_status(&self) {
        use style::{print_header, print_kv_w, MUTED, RESET, WARN_SYM};
        if let Some(memory) = &self.memory {
            if let Some((vault_path, note_count)) = memory.vault_status() {
                print_header("Obsidian Memory");
                print_kv_w(
                    "vault",
                    &format!("{MUTED}{}{RESET}", vault_path.display()),
                    12,
                );
                print_kv_w("sessions", &note_count.to_string(), 12);
                println!();

                print_header("Recent Sessions");
                match memory.get_recent_sessions(5) {
                    Ok(recent) => {
                        for (i, path) in recent.iter().enumerate() {
                            if let Some(name) = path.file_stem().and_then(|n| n.to_str()) {
                                println!(
                                    "  {}{}. {}{} {}",
                                    MUTED,
                                    i + 1,
                                    RESET,
                                    name.replace(['-', '_'], " "),
                                    MUTED
                                );
                            }
                        }
                    }
                    Err(e) => {
                        println!("  {WARN_SYM}Failed to list sessions: {e}{RESET}");
                    }
                }
                println!();
            }
        } else {
            println!();
            println!(
                "  {MUTED}No Obsidian vault found.{RESET} Create one at:"
            );
            println!("    ~/Obsidian Vault/");
            println!("    ~/Documents/Obsidian/");
            println!("    ~/.claw-code/vault/");
            println!();
        }
    }

    fn search_memory(&self, query: &str) {
        use style::{WARN_SYM, RESET, MUTED, CYAN, BOLD};
        let Some(memory) = &self.memory else {
            println!("  {WARN_SYM}No Obsidian vault configured{RESET}");
            return;
        };

        match memory.semantic_search(query, 10) {
            Ok(results) if !results.is_empty() => {
                println!();
                println!(
                    "  {}{} results for \"{}{}{}\"",
                    MUTED,
                    results.len(),
                    CYAN,
                    query,
                    MUTED
                );
                println!();
                for result in &results {
                    let score_str = format!("{:.2}", result.score);
                    println!(
                        "  {}{}{}  {}{}score: {}{RESET}",
                        BOLD, result.title, RESET, MUTED, CYAN, score_str
                    );
                    if !result.snippet.is_empty() {
                        println!(
                            "    {}{}…{}{}",
                            MUTED,
                            &result.snippet[..result.snippet.len().min(120)],
                            MUTED,
                            RESET
                        );
                    }
                }
                println!();
            }
            Ok(_) => {
                println!("  {MUTED}No results for \"{CYAN}{query}{MUTED}\"");
            }
            Err(e) => {
                println!("  {WARN_SYM}Search failed: {e}{RESET}");
            }
        }
    }

    fn generate_plan(&mut self, description: &str) -> Result<(), Box<dyn std::error::Error>> {
        use style::{CYAN, BOLD, RESET, MUTED, GREEN};
        println!();
        println!("  {CYAN}{BOLD}Generating plan...{RESET}  {MUTED}(using planner model){RESET}");
        println!();

        let prompt = build_plan_prompt(description);
        let response = self
            .runtime
            .run_planning_turn(&prompt)
            .map_err(|e| format!("Planning failed: {e}"))?;

        let json_str = extract_json_from_response(&response)
            .ok_or("Planner did not return valid JSON. Try again with a clearer description.")?;

        let plan: PlanArtifact = serde_json::from_str(&json_str)
            .map_err(|e| format!("Failed to parse plan JSON: {e}"))?;

        // Save plan to disk
        let plans_dir = claw_home().join("plans");
        std::fs::create_dir_all(&plans_dir)?;
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let plan_path = plans_dir.join(format!("plan-{ts}.json"));
        plan.save(&plan_path)?;
        self.plan_artifact = Some(plan.clone());
        self.plan_path = Some(plan_path);

        // Convert plan to todos
        let todos = plan.to_todos();
        let todo_input = runtime::TodoWriteInput { todos };
        runtime::todo_write(&todo_input)?;

        // Display plan
        println!("{}", format_plan_summary(&plan));
        println!();
        println!(
            "  {GREEN}{BOLD}Plan saved{RESET}  {MUTED}{}{RESET}",
            style::shorten_path(self.plan_path.as_ref().unwrap())
        );
        println!("  {MUTED}Use /plan status to check progress. The plan has been added to your todos.{RESET}");
        println!();

        // Inject plan context into system prompt for the executor
        let plan_context = format!(
            "# Active Plan: {}\nThere is an active implementation plan with {} tasks across {} phases. \
            Check the todo list for details. Execute the plan step by step.",
            plan.title,
            plan.total_tasks(),
            plan.phases.len()
        );
        let mut prompt = self.system_prompt.clone();
        let boundary_pos = prompt
            .iter()
            .position(|s| s.contains("__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__"));
        if let Some(pos) = boundary_pos {
            prompt.insert(pos + 1, plan_context);
        } else {
            prompt.push(plan_context);
        }
        self.runtime.set_system_prompt(prompt);

        Ok(())
    }

    fn print_plan_status(&self) {
        use style::{MUTED, RESET, CYAN, BOLD, CHECK, GREEN, RED, WARN_SYM};
        let Some(ref plan) = self.plan_artifact else {
            println!("  {MUTED}No active plan. Use /plan <description> to create one.{RESET}");
            return;
        };

        // Read current todos to get status
        match runtime::todo_read() {
            Ok(todo_output) => {
                let completed = plan.completed_tasks(&todo_output.todos);
                let total = plan.total_tasks();
                println!();
                println!(
                    "  {CYAN}{BOLD}Plan: {}{RESET}  {MUTED}({}/{} tasks){RESET}",
                    plan.title, completed, total
                );
                println!();
                for (i, phase) in plan.phases.iter().enumerate() {
                    let phase_completed = todo_output
                        .todos
                        .iter()
                        .filter(|t| {
                            t.id.starts_with(&format!("plan-{i}-"))
                                && t.status != runtime::TodoStatus::Pending
                                && t.status != runtime::TodoStatus::InProgress
                        })
                        .count();
                    let phase_total = phase.tasks.len();
                    let (icon, icon_color) = if phase_completed == phase_total {
                        (CHECK, GREEN)
                    } else {
                        (" ", MUTED)
                    };
                    println!(
                        "  {}{}{}{}  {}{} ({}/{} tasks){RESET}",
                        icon_color,
                        icon,
                        RESET,
                        BOLD,
                        phase.name,
                        MUTED,
                        phase_completed,
                        phase_total
                    );
                    for (j, task) in phase.tasks.iter().enumerate() {
                        let todo_id = format!("plan-{i}-{j}");
                        let status = todo_output
                            .todos
                            .iter()
                            .find(|t| t.id == todo_id)
                            .map_or(&runtime::TodoStatus::Pending, |t| &t.status);
                        let (status_icon, status_color) = match status {
                            runtime::TodoStatus::Completed => (CHECK, GREEN),
                            runtime::TodoStatus::InProgress => ("●", CYAN),
                            runtime::TodoStatus::Cancelled => ("✗", RED),
                            runtime::TodoStatus::Pending => ("○", MUTED),
                        };
                        println!(
                            "    {}{} {}{MUTED}{}{RESET}",
                            status_color,
                            status_icon,
                            task.description,
                            task.tool
                                .as_ref()
                                .map(|t| format!(" ({t})"))
                                .unwrap_or_default()
                        );
                    }
                }
                println!();
            }
            Err(e) => {
                println!("  {WARN_SYM}Failed to read todo list: {e}{RESET}");
            }
        }
    }

    fn abort_plan(&mut self) {
        use style::{MUTED, RESET, WARN_SYM, YELLOW, BOLD};
        let Some(ref plan) = self.plan_artifact else {
            println!("  {MUTED}No active plan to abort.{RESET}");
            return;
        };

        // Mark all plan todos as cancelled
        match runtime::todo_read() {
            Ok(todo_output) => {
                let mut todos = todo_output.todos;
                for todo in &mut todos {
                    if todo.id.starts_with("plan-") {
                        todo.status = runtime::TodoStatus::Cancelled;
                    }
                }
                if let Err(e) = runtime::todo_write(&runtime::TodoWriteInput { todos }) {
                    println!("  {WARN_SYM}Failed to update todos: {e}{RESET}");
                    return;
                }
            }
            Err(e) => {
                println!("  {WARN_SYM}Failed to read todos: {e}{RESET}");
                return;
            }
        }

        println!("  {YELLOW}{BOLD}Plan aborted:{RESET} {}", plan.title);
        self.plan_artifact = None;
        self.plan_path = None;

        // Remove plan context from system prompt
        let mut prompt = self.system_prompt.clone();
        prompt.retain(|s| !s.starts_with("# Active Plan:"));
        self.runtime.set_system_prompt(prompt);
    }

    fn print_status(&self) {
        use style::{YELLOW, WARN_SYM, RESET, MUTED, shorten_path, print_header, print_kv_w, format_model, fmt_num, ARROW_UP, ARROW_DOWN, SPARKLE, CYAN, WHITE_BOLD, WHITE};
        let usage = self.runtime.usage().cumulative_usage();
        let cost = self
            .runtime
            .usage()
            .cost_usd(primary_model_name(&self.model));
        let mode_str = if self.auto_accept {
            format!("{YELLOW}{WARN_SYM} auto-accept{RESET}")
        } else {
            format!("{MUTED}prompt for writes{RESET}")
        };
        let cwd = env::current_dir().map_or_else(|_| ".".to_string(), |p| shorten_path(&p));

        print_header("Session");
        print_kv_w("model", &format_model(&self.model), 12);
        print_kv_w("cwd", &format!("{MUTED}{cwd}{RESET}"), 12);
        print_kv_w("mode", &mode_str, 12);
        print_kv_w("turns", &self.runtime.usage().turns().to_string(), 12);
        print_kv_w(
            "messages",
            &fmt_num(self.runtime.session().messages.len() as u32),
            12,
        );
        println!("  {MUTED}──────────────────────────────────{RESET}");
        print_kv_w(&format!("{ARROW_UP} in"), &fmt_num(usage.input_tokens), 12);
        print_kv_w(
            &format!("{ARROW_DOWN} out"),
            &fmt_num(usage.output_tokens),
            12,
        );
        if usage.cache_read_input_tokens > 0 {
            print_kv_w(
                &format!("{SPARKLE} cached"),
                &fmt_num(usage.cache_read_input_tokens),
                12,
            );
        }
        println!("  {MUTED}──────────────────────────────────{RESET}");
        println!("  {CYAN}{:<12}{RESET}{WHITE_BOLD}${cost:.4}{RESET}", "cost");

        if self.sdd_engine.state().is_active() {
            println!();
            print_header("SDD State");
            let state = self.sdd_engine.state();
            print_kv_w("phase", &format!("{:?}", state.phase), 12);
            if let Some(ref complexity) = state.complexity {
                print_kv_w("complexity", &format!("{complexity:?}"), 12);
            }
            if !state.files_to_read.is_empty() {
                println!("  {MUTED}──────────────────────────────────{RESET}");
                println!("  {CYAN}{:<12}{RESET}Files to read:", "read");
                for file in &state.files_to_read {
                    println!("    {MUTED}-{RESET} {}", file.display());
                }
            }
            if let Some(ref spec) = state.spec {
                println!();
                println!("  {MUTED}──────────────────────────────────{RESET}");
                println!("  {CYAN}{:<12}{RESET}Internal Spec:", "spec");
                println!("  {WHITE}{}{RESET}", spec.summary());
            }
        }

        if let Some(ref memory) = self.memory {
            println!();
            if let Some((vault_path, note_count)) = memory.vault_status() {
                print_header("Memory");
                print_kv_w(
                    "vault",
                    &format!("{MUTED}{}{RESET}", vault_path.display()),
                    12,
                );
                print_kv_w("sessions", &note_count.to_string(), 12);
            }
        }

        println!();
    }

    fn print_cost(&self) {
        use style::{print_header, print_kv_w, friendly_model_name, format_model, MUTED, RESET, ARROW_UP, fmt_num, ARROW_DOWN, CYAN, WHITE_BOLD, GREEN};
        let usage = self.runtime.usage().cumulative_usage();
        let primary = primary_model_name(&self.model);
        let cost = self.runtime.usage().cost_usd(primary);

        // Compute cache savings estimate (cache reads are ~10x cheaper)
        let saved = if usage.cache_read_input_tokens > 0 {
            let full_cost = (f64::from(usage.cache_read_input_tokens) / 1_000_000.0) * 3.0; // $3/MTok full rate
            let cache_cost = (f64::from(usage.cache_read_input_tokens) / 1_000_000.0) * 0.3; // ~$0.30/MTok cached
            full_cost - cache_cost
        } else {
            0.0
        };

        print_header("Cost breakdown");
        if let Some(plus) = self.model.find('+') {
            print_kv_w("planner", &friendly_model_name(&self.model[..plus]), 14);
            print_kv_w(
                "executor",
                &friendly_model_name(&self.model[plus + 1..]),
                14,
            );
        } else {
            print_kv_w("model", &format_model(&self.model), 14);
        }
        println!("  {MUTED}──────────────────────────────────{RESET}");
        print_kv_w(
            &format!("{ARROW_UP} input"),
            &fmt_num(usage.input_tokens),
            14,
        );
        print_kv_w(
            &format!("{ARROW_DOWN} output"),
            &fmt_num(usage.output_tokens),
            14,
        );
        if usage.cache_creation_input_tokens > 0 {
            print_kv_w(
                "cache write",
                &fmt_num(usage.cache_creation_input_tokens),
                14,
            );
        }
        if usage.cache_read_input_tokens > 0 {
            print_kv_w("cache read", &fmt_num(usage.cache_read_input_tokens), 14);
        }
        println!("  {MUTED}──────────────────────────────────{RESET}");
        println!(
            "  {CYAN}{:<14}{RESET}{WHITE_BOLD}${cost:.4}{RESET}",
            "total cost"
        );
        if saved > 0.0001 {
            println!("  {CYAN}{:<14}{RESET}{GREEN}${saved:.4} saved{RESET}  {MUTED}(via prompt cache){RESET}", "cache saved");
        }
        println!();
    }

    fn compact(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let max_tokens = self.runtime.max_context_tokens();
        let config = CompactionConfig {
            preserve_recent_messages: 6,
            max_estimated_tokens: max_tokens / 2,
        };
        let result = self.runtime.compact(config);
        let removed = result.removed_message_count;
        let old_usage = self.runtime.usage().cumulative_usage();
        let old_turns = self.runtime.usage().turns();
        self.runtime = build_runtime(
            result.compacted_session,
            self.model.clone(),
            self.system_prompt.clone(),
            Arc::clone(&self.mcp),
            true,
        )?;
        self.runtime
            .usage_tracker_mut()
            .set_cumulative(old_usage, old_turns);
        style::print_ok(&format!(
            "Compacted {BOLD}{removed}{RESET} messages.",
            BOLD = style::BOLD,
            RESET = style::RESET
        ));
        Ok(())
    }

    fn clear_session(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let dir = sessions_dir();
        std::fs::create_dir_all(&dir)?;
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        self.auto_save_path = dir.join(format!("session-{ts}.json"));
        self.runtime = build_runtime(
            Session::new(),
            self.model.clone(),
            self.system_prompt.clone(),
            Arc::clone(&self.mcp),
            true,
        )?;
        self.sdd_engine.abort();
        style::print_ok("Session cleared.");
        Ok(())
    }

    fn set_model(&mut self, new_model: &str) -> Result<(), Box<dyn std::error::Error>> {
        let expanded = expand_model_spec(new_model);
        let new_prompt = build_system_prompt(&expanded)?;
        self.system_prompt = new_prompt.clone();
        self.runtime = build_runtime(
            self.runtime.session().clone(),
            expanded.clone(),
            new_prompt,
            Arc::clone(&self.mcp),
            true,
        )?;
        self.model = expanded.clone();
        if let Some(i) = expanded.find('+') {
            style::print_ok(&format!(
                "Dual model  {}{}+{}{}",
                style::friendly_model_name(&expanded[..i]),
                style::MUTED,
                style::RESET,
                style::friendly_model_name(&expanded[i + 1..]),
            ));
        } else {
            style::print_ok(&format!(
                "Model {} {}",
                style::ARROW_RIGHT,
                style::friendly_model_name(&expanded)
            ));
        }
        Ok(())
    }

    fn save_session(&self) -> Result<(), Box<dyn std::error::Error>> {
        self.runtime.session().save_to_path(&self.auto_save_path)?;
        style::print_ok(&format!(
            "Saved {} {}",
            style::ARROW_RIGHT,
            style::shorten_path(&self.auto_save_path)
        ));
        Ok(())
    }

    fn load_session(&mut self, id: &str) -> Result<(), Box<dyn std::error::Error>> {
        let sessions_dir = sessions_dir();
        let path = if id.ends_with(".json") {
            sessions_dir.join(id)
        } else {
            sessions_dir.join(format!("{id}.json"))
        };

        if !path.exists() {
            style::print_err(&format!("Session not found: {}", path.display()));
            return Ok(());
        }

        let session = Session::load_from_path(&path)?;
        let msg_count = session.messages.len();
        self.runtime = build_runtime(
            session,
            self.model.clone(),
            self.system_prompt.clone(),
            Arc::clone(&self.mcp),
            true,
        )?;
        style::print_ok(&format!(
            "Loaded {} {} ({} messages)",
            style::ARROW_RIGHT,
            style::shorten_path(&path),
            msg_count
        ));
        Ok(())
    }

    fn rollback(&mut self, n: usize) {
        use style::{YELLOW, BOLD, RESET, MUTED};
        let messages = &mut self.runtime.session_mut().messages;
        // Count how many complete turn cycles (assistant + tool results) to remove
        let mut turns_removed = 0usize;
        let mut remove_count = 0usize;

        for msg in messages.iter().rev() {
            if turns_removed >= n {
                break;
            }
            match msg.role {
                runtime::MessageRole::Assistant | runtime::MessageRole::Tool => {
                    remove_count += 1;
                    if msg.role == runtime::MessageRole::Assistant {
                        turns_removed += 1;
                    }
                }
                _ => break,
            }
        }

        if remove_count > 0 {
            let new_len = messages.len() - remove_count;
            messages.truncate(new_len);
            println!("  {YELLOW}{BOLD}Rolled back{RESET} {BOLD}{turns_removed}{RESET} turn(s) ({remove_count} messages).");
        } else {
            println!("  {MUTED}Nothing to roll back.{RESET}");
        }
    }

    fn print_session_diff(&self) {
        use style::{MUTED, RESET, WHITE_BOLD, DIVIDER_SHORT, GREEN, CYAN};
        let messages = &self.runtime.session().messages;
        let mut files_touched: Vec<(String, String)> = Vec::new();
        let mut seen = std::collections::HashSet::new();

        for msg in messages {
            if msg.role != runtime::MessageRole::Assistant {
                continue;
            }
            for block in &msg.blocks {
                if let runtime::ContentBlock::ToolUse { name, input, .. } = block {
                    let (op, path) = match name.as_str() {
                        "write_file" => ("write", extract_path_from_tool_input(input)),
                        "edit_file" => ("edit", extract_path_from_tool_input(input)),
                        _ => continue,
                    };
                    if let Some(path) = path {
                        let key = format!("{op}:{path}");
                        if seen.insert(key) {
                            files_touched.push((op.to_string(), path));
                        }
                    }
                }
            }
        }

        if files_touched.is_empty() {
            println!("  {MUTED}No file changes in this session.{RESET}");
            return;
        }

        println!();
        println!("  {WHITE_BOLD}Session changes{RESET}");
        println!("  {MUTED}{DIVIDER_SHORT}{RESET}");
        for (op, path) in &files_touched {
            let icon = match op.as_str() {
                "write" => format!("{GREEN}+{RESET}"),
                "edit" => format!("{CYAN}~{RESET}"),
                _ => " ".to_string(),
            };
            println!("  {icon}  {path}");
        }
        println!();
    }

    fn print_mcp_status(&self) {
        style::print_header("MCP Servers");
        if let Ok(manager) = self.mcp.lock() {
            if manager.is_empty() {
                style::print_muted("No MCP servers connected.");
                style::print_muted("Add servers to ~/.claude/settings.json under \"mcpServers\".");
            } else {
                let mut current_server = String::new();
                for tool in &manager.tools {
                    if tool.server_name != current_server {
                        current_server = tool.server_name.clone();
                        println!("  {}{current_server}{}", style::CYAN, style::RESET);
                    }
                    println!(
                        "    {}{}{}  {}",
                        style::MUTED,
                        tool.qualified_name,
                        style::RESET,
                        tool.description
                    );
                }
            }
        }
        println!();
    }

    fn set_budget(&mut self, usd: f64) {
        self.budget_limit = Some(usd);
        style::print_ok(&format!(
            "Budget set to {}${usd:.2}{}",
            style::WHITE_BOLD,
            style::RESET
        ));
    }

    fn print_budget(&self) {
        let cost = self
            .runtime
            .usage()
            .cost_usd(primary_model_name(&self.model));
        style::print_header("Budget");
        if let Some(limit) = self.budget_limit {
            let pct = if limit > 0.0 {
                cost / limit * 100.0
            } else {
                0.0
            };
            style::print_kv("budget", &format!("${limit:.2}"));
            style::print_kv("spent", &format!("${cost:.4}  ({pct:.1}%)"));
        } else {
            style::print_kv("spent", &format!("${cost:.4}"));
            style::print_muted("No budget set. Use /budget <usd> to set one.");
        }
        println!();
    }

    fn is_over_budget(&self) -> bool {
        let Some(limit) = self.budget_limit else {
            return false;
        };
        let cost = self
            .runtime
            .usage()
            .cost_usd(primary_model_name(&self.model));
        cost >= limit
    }
}

// ── /doctor — diagnostics ─────────────────────────────────────────────────────

fn run_doctor() {
    use style::{print_header, GREEN, CHECK, RESET, MUTED, DOT, print_kv};
    print_header("Doctor");

    // Check credentials
    let checks: &[(&str, &str)] = &[
        ("BEDROCK_API_KEY", "Bedrock API key"),
        ("AWS_ACCESS_KEY_ID", "AWS IAM (access key)"),
        ("ANTHROPIC_API_KEY", "Anthropic direct API"),
        ("KIMI_API_KEY", "Kimi provider"),
        ("KIMI_CODING_API_KEY", "Kimi Coding provider"),
        ("GLM_API_KEY", "GLM provider"),
        ("MINIMAX_API_KEY", "MiniMax provider"),
        ("OPENAI_API_KEY", "OpenAI provider"),
    ];

    for (var, label) in checks {
        match env::var(var) {
            Ok(val) if !val.is_empty() => {
                println!("  {GREEN}{CHECK}{RESET} {label}  {MUTED}({var} set){RESET}");
            }
            _ => {
                println!("  {MUTED}{DOT}{RESET} {label}  {MUTED}({var} not set){RESET}");
            }
        }
    }

    // Check config files
    println!();
    let config_home = env::var("USERPROFILE")
        .or_else(|_| env::var("HOME")).map_or_else(|_| PathBuf::from("."), PathBuf::from);

    let config_files: Vec<(PathBuf, &str)> = vec![
        (claw_home().join("config.json"), "claw config"),
        (
            config_home.join(".claude").join("settings.json"),
            "claude settings (user)",
        ),
        (
            PathBuf::from(".claude").join("settings.json"),
            "claude settings (project)",
        ),
        (PathBuf::from("CLAUDE.md"), "CLAUDE.md"),
    ];

    for (path, label) in &config_files {
        if path.exists() {
            println!(
                "  {GREEN}{CHECK}{RESET} {label}  {MUTED}({}){RESET}",
                path.display()
            );
        } else {
            println!("  {MUTED}{DOT}{RESET} {label}  {MUTED}(not found){RESET}");
        }
    }

    // Session info and platform
    println!();
    let session_dir = sessions_dir();
    let session_count = std::fs::read_dir(&session_dir)
        .map(std::iter::Iterator::count)
        .unwrap_or(0);
    print_kv("sessions", &format!("{session_count} saved"));
    print_kv(
        "platform",
        &format!("{} ({})", env::consts::OS, env::consts::ARCH),
    );
    println!();
}

// ── /init — project bootstrap ─────────────────────────────────────────────────

fn run_init() -> Result<(), Box<dyn std::error::Error>> {
    let path = PathBuf::from("CLAUDE.md");
    if path.exists() {
        style::print_warn("CLAUDE.md already exists. Delete it first if you want to regenerate.");
        println!();
        return Ok(());
    }

    // Detect project type
    let mut hints = Vec::new();
    if PathBuf::from("Cargo.toml").exists() {
        hints.push("Rust (Cargo)");
    }
    if PathBuf::from("package.json").exists() {
        hints.push("Node.js (npm)");
    }
    if PathBuf::from("pyproject.toml").exists() || PathBuf::from("setup.py").exists() {
        hints.push("Python");
    }
    if PathBuf::from("go.mod").exists() {
        hints.push("Go");
    }
    if PathBuf::from("pom.xml").exists() || PathBuf::from("build.gradle").exists() {
        hints.push("Java/Kotlin");
    }
    if PathBuf::from("Gemfile").exists() {
        hints.push("Ruby");
    }
    if PathBuf::from("composer.json").exists() {
        hints.push("PHP");
    }
    if PathBuf::from("Makefile").exists() {
        hints.push("Make");
    }
    if PathBuf::from("docker-compose.yml").exists() || PathBuf::from("Dockerfile").exists() {
        hints.push("Docker");
    }

    let stack = if hints.is_empty() {
        "Unknown".to_string()
    } else {
        hints.join(", ")
    };
    let cwd = env::current_dir()?.display().to_string();
    let dir_name = Path::new(&cwd)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy();

    let content = format!(
        "# {dir_name}\n\n\
         ## Tech Stack\n\
         {stack}\n\n\
         ## Build & Test\n\
         ```sh\n\
         # TODO: Add build commands\n\
         # TODO: Add test commands\n\
         ```\n\n\
         ## Conventions\n\
         - Follow existing code style and patterns\n\
         - Write tests for new features\n\
         - Keep changes tightly scoped\n\n\
         ## Project Structure\n\
         <!-- TODO: Describe key directories and their purpose -->\n"
    );

    std::fs::write(&path, &content)?;
    style::print_ok(&format!("Created CLAUDE.md ({stack})"));
    style::print_muted("Edit it to add build commands, conventions, and project structure.");
    println!();
    Ok(())
}

// ── /sessions — list saved sessions ───────────────────────────────────────────

fn list_sessions() {
    use style::{print_header, print_muted, CYAN, RESET, MUTED};
    let dir = sessions_dir();
    let mut entries: Vec<(String, u64, usize)> = Vec::new();

    if let Ok(reader) = std::fs::read_dir(&dir) {
        for entry in reader.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.ends_with(".json") {
                continue;
            }
            let meta = entry.metadata().ok();
            let size = meta.as_ref().map_or(0, |m| m.len() as usize);
            let ts = name
                .strip_prefix("session-")
                .and_then(|s| s.strip_suffix(".json"))
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);
            entries.push((name, ts, size));
        }
    }

    entries.sort_by(|a, b| b.1.cmp(&a.1));

    print_header("Saved Sessions");
    print_muted(&dir.display().to_string());
    println!();

    if entries.is_empty() {
        print_muted("No saved sessions.");
    } else {
        for (name, _ts, size) in entries.iter().take(20) {
            let size_kb = size / 1024;
            println!("  {CYAN}{name}{RESET}  {MUTED}({size_kb} KB){RESET}");
        }
        if entries.len() > 20 {
            print_muted(&format!("...and {} more", entries.len() - 20));
        }
        println!();
        print_muted(&format!(
            "Resume with: claw --resume {}",
            dir.join(&entries[0].0).display()
        ));
    }
    println!();
}

fn build_system_prompt(model: &str) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let hints = ModelHints::for_model(model);
    Ok(load_system_prompt_with_hints(
        env::current_dir()?,
        today_iso(),
        env::consts::OS,
        "unknown",
        hints,
    )?)
}

/// Expand shorthand model specs before routing.
/// - `opusplan` → `claude-opus-4-5-20250514+<DEFAULT_MODEL>`
/// - `opusplan kimi/moonshot-v1-32k` → `claude-opus-4-5-20250514+kimi/moonshot-v1-32k`
/// Expand friendly model aliases to full Bedrock model IDs.
///
/// Users can type short names like `sonnet`, `opus`, `haiku` and they'll be
/// expanded to the full `bedrock/us.anthropic.claude-*` identifier.
fn expand_model_spec(spec: &str) -> String {
    // Handle dual-model "plannerspec+executorspec" syntax
    if let Some(plus) = spec.find('+') {
        let planner = expand_single_alias(&spec[..plus]);
        let executor = expand_single_alias(&spec[plus + 1..]);
        return format!("{planner}+{executor}");
    }

    // Handle "opusplan" shorthand: opus plans, sonnet executes
    if spec == "opusplan" {
        let planner = expand_single_alias("opus");
        let executor = default_model();
        return format!("{planner}+{executor}");
    }
    if let Some(executor_spec) = spec.strip_prefix("opusplan ") {
        let planner = expand_single_alias("opus");
        let executor = expand_single_alias(executor_spec.trim());
        return format!("{planner}+{executor}");
    }

    expand_single_alias(spec)
}

/// Map a single model alias to its full Bedrock model ID.
fn expand_single_alias(alias: &str) -> String {
    let alias_lower = alias.to_lowercase();
    let resolved = match alias_lower.as_str() {
        // ── Sonnet family ─────────────────────────────────────────────
        "sonnet" | "sonnet4.6" | "sonnet-4.6" | "claude-sonnet-4-6" => {
            "bedrock/us.anthropic.claude-sonnet-4-6"
        }
        "sonnet4.5" | "sonnet-4.5" => "bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        "sonnet4" | "sonnet-4" => "bedrock/us.anthropic.claude-sonnet-4-20250514-v1:0",

        // ── Opus family ───────────────────────────────────────────────
        "opus" | "opus4.6" | "opus-4.6" | "claude-opus-4-6" => {
            "bedrock/us.anthropic.claude-opus-4-6-v1"
        }
        "opus4.5" | "opus-4.5" => "bedrock/us.anthropic.claude-opus-4-5-20251101-v1:0",
        "opus4" | "opus-4" => "bedrock/us.anthropic.claude-opus-4-20250514-v1:0",
        "opus4.1" | "opus-4.1" => "bedrock/us.anthropic.claude-opus-4-1-20250805-v1:0",

        // ── Haiku family ──────────────────────────────────────────────
        "haiku" | "haiku4.5" | "haiku-4.5" => "bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0",

        // ── MiniMax family ───────────────────────────────────────────
        "minimax2.7" | "minimax-2.7" | "minimax" | "minimax-text-01" => "minimax/MiniMax-Text-01",

        // ── Qwen family ───────────────────────────────────────────────
        "qwen3.6" | "qwen3.6-plus" | "qwen-3.6-plus" | "qwen" | "qwen-plus" => "qwen/qwen-3.6-plus",

        // ── Kimi family ────────────────────────────────────────────────
        "kimi-coding" | "kimi-coding-k2.6" | "k2.6-coding" => "kimi-coding/k2.6",
        "kimi2.6" | "kimi-2.6" | "k2.6" | "kimi-k2-6" => "kimi/moonshot-v1-32k",

        // ── Legacy / direct Anthropic ─────────────────────────────────
        "claude-3.7-sonnet" | "sonnet3.7" => "bedrock/us.anthropic.claude-3-7-sonnet-20250219-v1:0",

        // ── Pass-through (already a full ID or provider-prefixed) ─────
        _ => return alias.to_string(),
    };
    resolved.to_string()
}

/// Returns just the planner model name (the part before `+`, if any).
/// Used for cost estimation — the executor model may be a free/cheap provider.
fn primary_model_name(model: &str) -> &str {
    match model.find('+') {
        Some(i) => &model[..i],
        None => model,
    }
}

/// Split system prompt sections into cached (static) and non-cached (dynamic) blocks.
///
/// Everything before `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` is static and gets
/// `cache_control: {"type": "ephemeral"}` so the API provider can cache it.
/// Everything after the boundary changes per turn (git status, date, etc.)
/// and is sent without `cache_control`.
fn build_cached_system_blocks(sections: &[String]) -> Vec<SystemContentBlock> {
    use runtime::SYSTEM_PROMPT_DYNAMIC_BOUNDARY;

    if sections.is_empty() {
        return Vec::new();
    }

    let full = sections.join("\n\n");
    if let Some(split_pos) = full.find(SYSTEM_PROMPT_DYNAMIC_BOUNDARY) {
        let static_part = full[..split_pos].trim();
        let dynamic_part = full[split_pos + SYSTEM_PROMPT_DYNAMIC_BOUNDARY.len()..].trim();

        let mut blocks = Vec::new();
        if !static_part.is_empty() {
            blocks.push(SystemContentBlock::cached_text(static_part));
        }
        if !dynamic_part.is_empty() {
            blocks.push(SystemContentBlock::text(dynamic_part));
        }
        blocks
    } else {
        // No boundary marker — cache the whole thing
        vec![SystemContentBlock::cached_text(full)]
    }
}

/// Build a single (non-dual) API client for a model spec.
fn build_single_client(
    model: &str,
    tool_specs: Vec<DynamicToolSpec>,
    enable_tools: bool,
    hints: &runtime::ModelHints,
) -> Result<AnyApiClient, Box<dyn std::error::Error>> {
    if bedrock::is_bedrock_model(model) {
        Ok(AnyApiClient::Bedrock(bedrock::BedrockRuntimeClient::new(
            model,
            tool_specs,
            enable_tools,
            hints.max_completion_tokens,
        )?))
    } else if openai::is_anthropic_model(model) {
        Ok(AnyApiClient::Anthropic(AnthropicRuntimeClient::new(
            model.to_string(),
            tool_specs,
            enable_tools,
            None,
            hints.max_completion_tokens,
        )?))
    } else {
        let cache_key = if hints.supports_prompt_cache {
            // Stable per-model cache key. In production this should be session-scoped.
            Some(format!("claw-{}", model.replace(['/', ' ', ':'], "-")))
        } else {
            None
        };
        Ok(AnyApiClient::OpenAi(OpenAiRuntimeClient::new(
            model.to_string(),
            tool_specs,
            enable_tools,
            hints.max_completion_tokens,
            cache_key,
        )?))
    }
}

fn build_runtime(
    session: Session,
    model: String,
    system_prompt: Vec<String>,
    mcp: Arc<Mutex<McpManager>>,
    enable_tools: bool,
) -> Result<ConversationRuntime<AnyApiClient, CliToolExecutor>, Box<dyn std::error::Error>> {
    let model = expand_model_spec(&model);

    // Build the combined tool spec list (builtin + MCP) to send to the model
    let tool_executor = CliToolExecutor::new(
        Arc::clone(&mcp),
        model.clone(),
        enable_tools,
        system_prompt.clone(),
    );
    let tool_specs = if enable_tools {
        tool_executor.all_tool_specs()
    } else {
        Vec::new()
    };

    let hints = runtime::ModelHints::for_model(&model);
    let client = if let Some(plus) = model.find('+') {
        let planner_spec = &model[..plus];
        let executor_spec = &model[plus + 1..];
        let planner_hints = runtime::ModelHints::for_model(planner_spec);
        let executor_hints = runtime::ModelHints::for_model(executor_spec);
        AnyApiClient::Dual {
            planner: Box::new(build_single_client(
                planner_spec,
                tool_specs.clone(),
                enable_tools,
                &planner_hints,
            )?),
            executor: Box::new(build_single_client(
                executor_spec,
                tool_specs,
                enable_tools,
                &executor_hints,
            )?),
        }
    } else {
        build_single_client(&model, tool_specs, enable_tools, &hints)?
    };

    Ok(ConversationRuntime::new(
        session,
        client,
        tool_executor,
        permission_policy_from_env(),
        system_prompt,
    )
    .with_max_parallel(
        std::env::var("MAX_PARALLEL_TASKS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(5),
    )
    .with_model(model.clone())
    .with_model_hints(ModelHints::for_model(&model)))
}

/// Build a child runtime for in-process sub-agent execution.
/// Excludes the `task` tool to prevent recursive sub-agent spawning.
fn build_subagent_runtime(
    model: String,
    system_prompt: Vec<String>,
    mcp: Arc<Mutex<McpManager>>,
) -> Result<ConversationRuntime<AnyApiClient, CliToolExecutor>, Box<dyn std::error::Error>> {
    let tool_executor =
        CliToolExecutor::new(Arc::clone(&mcp), model.clone(), true, system_prompt.clone());
    let mut tool_specs = tool_executor.all_tool_specs();
    tool_specs.retain(|s| s.name != "task");

    let hints = runtime::ModelHints::for_model(&model);
    let client = if let Some(plus) = model.find('+') {
        let planner_spec = &model[..plus];
        let executor_spec = &model[plus + 1..];
        let planner_hints = runtime::ModelHints::for_model(planner_spec);
        let executor_hints = runtime::ModelHints::for_model(executor_spec);
        AnyApiClient::Dual {
            planner: Box::new(build_single_client(
                planner_spec,
                tool_specs.clone(),
                true,
                &planner_hints,
            )?),
            executor: Box::new(build_single_client(
                executor_spec,
                tool_specs,
                true,
                &executor_hints,
            )?),
        }
    } else {
        build_single_client(&model, tool_specs, true, &hints)?
    };

    Ok(ConversationRuntime::new(
        Session::new(),
        client,
        tool_executor,
        PermissionPolicy::new(PermissionMode::Allow), // Auto-approve all tools in sub-agents
        system_prompt,
    )
    .with_max_parallel(3)
    .with_model(model.clone())
    .with_model_hints(hints))
}

struct AnthropicRuntimeClient {
    runtime: tokio::runtime::Runtime,
    client: AnthropicClient,
    model: String,
    tool_specs: Vec<DynamicToolSpec>,
    enable_tools: bool,
    thinking: Option<ThinkingConfig>,
    max_tokens: u32,
}

impl AnthropicRuntimeClient {
    fn new(
        model: String,
        tool_specs: Vec<DynamicToolSpec>,
        enable_tools: bool,
        thinking: Option<ThinkingConfig>,
        max_tokens: u32,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        Ok(Self {
            runtime: tokio::runtime::Runtime::new()?,
            client: AnthropicClient::from_env()?,
            model,
            tool_specs,
            enable_tools,
            thinking,
            max_tokens,
        })
    }
}

impl ApiClient for AnthropicRuntimeClient {
    fn stream(&mut self, request: ApiRequest) -> Result<Vec<AssistantEvent>, RuntimeError> {
        let system_blocks = build_cached_system_blocks(&request.system_prompt);
        let thinking = request.thinking.or_else(|| self.thinking.clone());
        let message_request = MessageRequest {
            model: self.model.clone(),
            max_tokens: self.max_tokens,
            messages: convert_messages(&request.messages),
            system: if system_blocks.is_empty() {
                None
            } else {
                Some(system_blocks)
            },
            tools: self.enable_tools.then(|| {
                self.tool_specs
                    .iter()
                    .map(|spec| ToolDefinition {
                        name: spec.name.clone(),
                        description: Some(spec.description.clone()),
                        input_schema: spec.input_schema.clone(),
                    })
                    .collect()
            }),
            tool_choice: self.enable_tools.then_some(ToolChoice::Auto),
            stream: true,
            thinking,
        };

        self.runtime.block_on(async {
            let mut stream = self
                .client
                .stream_message(&message_request)
                .await
                .map_err(|error| RuntimeError::new(error.to_string()))?;
            let mut stdout = io::stdout();
            let mut events = Vec::new();
            let mut pending_tool: Option<(String, String, String)> = None;
            let mut saw_stop = false;
            let mut interrupted = false;

            loop {
                tokio::select! {
                    result = stream.next_event() => {
                        let Some(event) = result
                            .map_err(|error| RuntimeError::new(error.to_string()))?
                        else {
                            break;
                        };
                        match event {
                            ApiStreamEvent::MessageStart(start) => {
                                for block in start.message.content {
                                    push_output_block(block, &mut stdout, &mut events, &mut pending_tool)?;
                                }
                            }
                            ApiStreamEvent::ContentBlockStart(start) => {
                                push_output_block(
                                    start.content_block,
                                    &mut stdout,
                                    &mut events,
                                    &mut pending_tool,
                                )?;
                            }
                            ApiStreamEvent::ContentBlockDelta(delta) => match delta.delta {
                                ContentBlockDelta::TextDelta { text } => {
                                    if !text.is_empty() {
                                        write!(stdout, "{text}")
                                            .and_then(|()| stdout.flush())
                                            .map_err(|error| RuntimeError::new(error.to_string()))?;
                                        events.push(AssistantEvent::TextDelta(text));
                                    }
                                }
                                ContentBlockDelta::ThinkingDelta { thinking } => {
                                    style::print_thinking_fragment(&thinking);
                                    events.push(AssistantEvent::ThinkingDelta(thinking));
                                }
                                ContentBlockDelta::InputJsonDelta { partial_json } => {
                                    if let Some((_, _, input)) = &mut pending_tool {
                                        input.push_str(&partial_json);
                                    }
                                }
                            },
                            ApiStreamEvent::ContentBlockStop(_) => {
                                if let Some((id, name, input)) = pending_tool.take() {
                                    events.push(AssistantEvent::ToolUse { id, name, input });
                                }
                            }
                            ApiStreamEvent::MessageDelta(delta) => {
                                events.push(AssistantEvent::Usage(TokenUsage {
                                    input_tokens: delta.usage.input_tokens,
                                    output_tokens: delta.usage.output_tokens,
                                    cache_creation_input_tokens: 0,
                                    cache_read_input_tokens: 0,
                                }));
                            }
                            ApiStreamEvent::MessageStop(_) => {
                                saw_stop = true;
                                events.push(AssistantEvent::MessageStop);
                                break;
                            }
                        }
                    }
                    _ = tokio::signal::ctrl_c() => {
                        eprintln!("\nInterrupted.");
                        interrupted = true;
                        break;
                    }
                }
            }

            // Ensure the session stays valid after an interruption
            if !saw_stop {
                if interrupted
                    && !events.iter().any(|e| matches!(e, AssistantEvent::TextDelta(_)))
                {
                    events.push(AssistantEvent::TextDelta("[Interrupted]".to_string()));
                }
                if let Some((id, name, input)) = pending_tool.take() {
                    events.push(AssistantEvent::ToolUse { id, name, input });
                }
                events.push(AssistantEvent::MessageStop);
            }

            Ok(events)
        })
    }
}

fn push_output_block(
    block: OutputContentBlock,
    out: &mut impl Write,
    events: &mut Vec<AssistantEvent>,
    pending_tool: &mut Option<(String, String, String)>,
) -> Result<(), RuntimeError> {
    match block {
        OutputContentBlock::Text { text } => {
            if !text.is_empty() {
                write!(out, "{text}")
                    .and_then(|()| out.flush())
                    .map_err(|error| RuntimeError::new(error.to_string()))?;
                events.push(AssistantEvent::TextDelta(text));
            }
        }
        OutputContentBlock::Thinking { thinking } => {
            events.push(AssistantEvent::ThinkingDelta(thinking));
        }
        OutputContentBlock::ToolUse { id, name, input } => {
            *pending_tool = Some((id, name, input.to_string()));
        }
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct FileChange {
    pub path: String,
    pub operation: String,
    pub description: String,
}

struct CliToolExecutor {
    mcp: Arc<Mutex<McpManager>>,
    model_spec: String,
    enable_tools: bool,
    system_prompt: Vec<String>,
    file_changes: Arc<Mutex<Vec<FileChange>>>,
}

impl Clone for CliToolExecutor {
    fn clone(&self) -> Self {
        Self {
            mcp: self.mcp.clone(),
            model_spec: self.model_spec.clone(),
            enable_tools: self.enable_tools,
            system_prompt: self.system_prompt.clone(),
            file_changes: self.file_changes.clone(),
        }
    }
}

impl CliToolExecutor {
    fn new(
        mcp: Arc<Mutex<McpManager>>,
        model_spec: String,
        enable_tools: bool,
        system_prompt: Vec<String>,
    ) -> Self {
        Self {
            mcp,
            model_spec,
            enable_tools,
            system_prompt,
            file_changes: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn record_file_change(&self, path: &str, operation: &str, description: &str) {
        if let Ok(mut changes) = self.file_changes.lock() {
            changes.push(FileChange {
                path: path.to_string(),
                operation: operation.to_string(),
                description: description.to_string(),
            });
        }
    }

    pub fn file_changes(&self) -> Vec<FileChange> {
        self.file_changes
            .lock()
            .map(|c| c.clone())
            .unwrap_or_default()
    }

    pub fn clear_file_changes(&self) {
        if let Ok(mut changes) = self.file_changes.lock() {
            changes.clear();
        }
    }

    /// Return all tool specs: builtin MVP tools + MCP tools.
    fn all_tool_specs(&self) -> Vec<DynamicToolSpec> {
        let mut specs: Vec<DynamicToolSpec> =
            mvp_tool_specs().iter().map(DynamicToolSpec::from).collect();
        if let Ok(manager) = self.mcp.lock() {
            for mcp_tool in &manager.tools {
                specs.push(DynamicToolSpec {
                    name: mcp_tool.qualified_name.clone(),
                    description: mcp_tool.description.clone(),
                    input_schema: mcp_tool.input_schema.clone(),
                });
            }
        }
        specs
    }

    /// Execute a tool and return both the result and display output lines.
    fn execute_with_display(
        &mut self,
        tool_name: &str,
        input: &str,
    ) -> (Result<String, ToolError>, Vec<String>) {
        let start = std::time::Instant::now();
        let display_name = tool_name.strip_prefix("mcp__").unwrap_or(tool_name);
        let input_preview = extract_tool_preview(tool_name, input);
        let inner = 52usize;
        let mut display = Vec::new();

        let title = format!(
            "{ACCENT_C}{BOLD_C}{display_name}{RESET_C}",
            ACCENT_C = style::ACCENT,
            BOLD_C = style::BOLD,
            RESET_C = style::RESET
        );
        let title_vis = display_name.len();
        let bar_right = style::BOX_H.repeat(inner.saturating_sub(title_vis + 4));
        display.push(format!(
            "\n  {}{TL}{H} {title} {bar_right}{TR}{}",
            style::ACCENT,
            style::RESET,
            TL = style::BOX_TL,
            H = style::BOX_H,
            TR = style::BOX_TR
        ));
        if !input_preview.is_empty() {
            let preview_vis = style::strip_ansi_len(&input_preview);
            let pad = " ".repeat(inner.saturating_sub(2).saturating_sub(preview_vis));
            display.push(format!(
                "  {acc}{v}{res}  {input_preview}{pad}{acc}{v}{res}",
                acc = style::ACCENT,
                v = style::BOX_V,
                res = style::RESET
            ));
        }

        if tool_name == "task" {
            return self.execute_task_in_process(input, inner, start);
        }

        if tool_name.starts_with("mcp__") {
            let output = self
                .mcp
                .lock()
                .map_err(|e| ToolError::new(format!("MCP lock poisoned: {e}")))
                .and_then(|mut manager| manager.execute(tool_name, input).map_err(ToolError::new));
            match output {
                Ok(output) => {
                    let box_lines = format_tool_output_box(&output, inner);
                    display.extend(box_lines);
                    let elapsed = start.elapsed();
                    display.push(format_tool_footer(style::GREEN, inner, &elapsed, false));
                    (Ok(output), display)
                }
                Err(e) => {
                    let elapsed = start.elapsed();
                    display.push(format!(
                        "  {}{} {}{}",
                        style::RED,
                        style::CROSS,
                        &e,
                        style::RESET
                    ));
                    display.push(format_tool_footer(style::RED, inner, &elapsed, true));
                    (Err(e), display)
                }
            }
        } else {
            let value = match serde_json::from_str(input) {
                Ok(v) => v,
                Err(error) => {
                    let err = ToolError::new(format!("invalid tool input JSON: {error}"));
                    let elapsed = start.elapsed();
                    display.push(format!(
                        "  {}{} {}{}",
                        style::RED,
                        style::CROSS,
                        &err,
                        style::RESET
                    ));
                    display.push(format_tool_footer(style::RED, inner, &elapsed, true));
                    return (Err(err), display);
                }
            };
            match execute_tool(tool_name, &value) {
                Ok(output) => {
                    let box_lines = format_tool_output_box(&output, inner);
                    display.extend(box_lines);
                    let elapsed = start.elapsed();
                    let is_error = output.contains("\"error\"") && output.contains("true");
                    // Track file changes for diff/undo support
                    if !is_error {
                        match tool_name {
                            "write_file" => {
                                if let Ok(v) = serde_json::from_str::<serde_json::Value>(input) {
                                    if let Some(path) = v.get("path").and_then(|p| p.as_str()) {
                                        self.record_file_change(
                                            path,
                                            "write",
                                            "Created or overwritten",
                                        );
                                    }
                                }
                            }
                            "edit_file" => {
                                if let Ok(v) = serde_json::from_str::<serde_json::Value>(input) {
                                    if let Some(path) = v.get("path").and_then(|p| p.as_str()) {
                                        self.record_file_change(path, "edit", "Modified in-place");
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                    display.push(format_tool_footer(style::CYAN, inner, &elapsed, is_error));
                    (Ok(output), display)
                }
                Err(error) => {
                    let elapsed = start.elapsed();
                    let err_line =
                        format!("{}{} {}{}", style::RED, style::CROSS, error, style::RESET);
                    let pad = " ".repeat(
                        inner
                            .saturating_sub(2)
                            .saturating_sub(style::strip_ansi_len(&err_line)),
                    );
                    display.push(format!(
                        "  {acc}{v}{res}  {err_line}{pad}{acc}{v}{res}",
                        acc = style::ACCENT,
                        v = style::BOX_V,
                        res = style::RESET
                    ));
                    display.push(format_tool_footer(style::RED, inner, &elapsed, true));
                    (Err(ToolError::new(error)), display)
                }
            }
        }
    }

    fn execute_task_in_process(
        &self,
        input: &str,
        inner: usize,
        start: std::time::Instant,
    ) -> (Result<String, ToolError>, Vec<String>) {
        use serde::Deserialize;
        use std::thread;

        #[derive(Debug, Deserialize)]
        struct TaskInput {
            tasks: Vec<TaskSpecInput>,
        }
        #[derive(Debug, Deserialize)]
        struct TaskSpecInput {
            description: String,
            prompt: String,
        }
        #[derive(Debug, serde::Serialize)]
        struct TaskResult {
            task_id: usize,
            description: String,
            success: bool,
            output: String,
            elapsed_ms: u64,
        }

        let mut display = Vec::new();
        let task_input: TaskInput = match serde_json::from_str(input) {
            Ok(v) => v,
            Err(e) => {
                let err = ToolError::new(format!("invalid task input: {e}"));
                let elapsed = start.elapsed();
                display.push(format!(
                    "  {}{} {}{}",
                    style::RED,
                    style::CROSS,
                    &err,
                    style::RESET
                ));
                display.push(format_tool_footer(style::RED, inner, &elapsed, true));
                return (Err(err), display);
            }
        };

        let max_parallel = std::env::var("MAX_PARALLEL_TASKS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(5);

        display.push(format!(
            "  {}{} Spawning {} sub-agent task(s) in-process (max_parallel={}){}",
            style::CYAN,
            style::BOLD,
            task_input.tasks.len(),
            max_parallel,
            style::RESET
        ));

        let mut handles = Vec::new();
        let running = Arc::new(std::sync::atomic::AtomicUsize::new(0));

        for (idx, task) in task_input.tasks.into_iter().enumerate() {
            while running.load(std::sync::atomic::Ordering::Relaxed) >= max_parallel {
                thread::sleep(std::time::Duration::from_millis(50));
            }
            running.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

            let model_spec = self.model_spec.clone();
            let mcp = self.mcp.clone();
            let system_prompt = self.system_prompt.clone();
            let description = task.description;
            let prompt = task.prompt;
            let running_clone = running.clone();

            let handle = thread::spawn(move || {
                struct Guard(Arc<std::sync::atomic::AtomicUsize>);
                impl Drop for Guard {
                    fn drop(&mut self) {
                        self.0.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
                    }
                }
                let _guard = Guard(running_clone);
                let task_start = std::time::Instant::now();

                let result = (|| -> Result<String, String> {
                    let child_runtime = build_subagent_runtime(model_spec, system_prompt, mcp)
                        .map_err(|e| e.to_string())?;
                    let mut runtime = child_runtime;
                    let summary = runtime.run_turn(&prompt, None).map_err(|e| e.to_string())?;
                    let output = summary
                        .assistant_messages
                        .iter()
                        .flat_map(|m| m.blocks.iter())
                        .filter_map(|b| match b {
                            runtime::ContentBlock::Text { text } => Some(text.as_str()),
                            _ => None,
                        })
                        .collect::<Vec<_>>()
                        .join("");
                    Ok(output)
                })();

                TaskResult {
                    task_id: idx,
                    description,
                    success: result.is_ok(),
                    output: result.unwrap_or_else(|e| e),
                    elapsed_ms: u64::try_from(task_start.elapsed().as_millis()).unwrap_or(u64::MAX),
                }
            });
            handles.push(handle);
        }

        let results: Vec<TaskResult> = handles
            .into_iter()
            .map(|h| {
                h.join().unwrap_or_else(|e| TaskResult {
                    task_id: 0,
                    description: "thread panicked".to_string(),
                    success: false,
                    output: format!("{e:?}"),
                    elapsed_ms: 0,
                })
            })
            .collect();

        for result in &results {
            let status_icon = if result.success {
                style::GREEN
            } else {
                style::RED
            };
            let status_sym = if result.success {
                style::CHECK
            } else {
                style::CROSS
            };
            display.push(format!(
                "    {}{}{} {}  {}{:.1}s{}",
                status_icon,
                status_sym,
                style::RESET,
                result.description,
                style::MUTED,
                result.elapsed_ms as f64 / 1000.0,
                style::RESET
            ));
        }

        let elapsed = start.elapsed();
        let all_success = results.iter().all(|r| r.success);
        display.push(format_tool_footer(
            if all_success {
                style::GREEN
            } else {
                style::CYAN
            },
            inner,
            &elapsed,
            !all_success,
        ));

        match serde_json::to_string_pretty(&results) {
            Ok(json) => (Ok(json), display),
            Err(e) => (Err(ToolError::new(e.to_string())), display),
        }
    }
}

impl ToolExecutor for CliToolExecutor {
    fn execute(&mut self, tool_name: &str, input: &str) -> Result<String, ToolError> {
        let (result, display) = self.execute_with_display(tool_name, input);
        let _guard = stdout_lock().lock().unwrap();
        for line in display {
            println!("{line}");
        }
        result
    }
}

/// Extract the `path` field from a tool input JSON string.
fn extract_path_from_tool_input(input: &str) -> Option<String> {
    let val = serde_json::from_str::<serde_json::Value>(input).ok()?;
    val.get("path").and_then(|v| v.as_str()).map(str::to_string)
}

/// Extract a single meaningful preview line from tool input JSON.
fn extract_tool_preview(tool_name: &str, input: &str) -> String {
    let Ok(val) = serde_json::from_str::<serde_json::Value>(input) else {
        return String::new();
    };
    // Tool-specific field extraction
    let raw = match tool_name {
        "bash" => val
            .get("command")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        "read_file" => val
            .get("path")
            .and_then(|v| v.as_str())
            .map(|p| format!("{}{p}{}", style::MUTED, style::RESET)),
        "write_file" | "edit_file" => val
            .get("path")
            .and_then(|v| v.as_str())
            .map(|p| format!("{}{p}{}", style::MUTED, style::RESET)),
        "glob_search" => val.get("pattern").and_then(|v| v.as_str()).map(|p| {
            format!(
                "{ACCENT}{p}{RESET}",
                ACCENT = style::ACCENT2,
                RESET = style::RESET
            )
        }),
        "grep_search" => val.get("pattern").and_then(|v| v.as_str()).map(|p| {
            format!(
                "{ACCENT}/{p}/{RESET}",
                ACCENT = style::ACCENT2,
                RESET = style::RESET
            )
        }),
        "web_fetch" => val
            .get("url")
            .and_then(|v| v.as_str())
            .map(|u| format!("{}{u}{}", style::CYAN, style::RESET)),
        "todo_write" => val
            .get("todos")
            .and_then(|t| t.as_array())
            .map(|arr| format!("{}{} item(s){}", style::MUTED, arr.len(), style::RESET)),
        "todo_read" => Some(format!("{}reading todo list{}", style::MUTED, style::RESET)),
        _ => val
            .get("command")
            .or_else(|| val.get("path"))
            .or_else(|| val.get("pattern"))
            .and_then(|v| v.as_str())
            .map(str::to_string),
    };
    let Some(text) = raw else {
        return String::new();
    };
    // Truncate if too long
    let clean: String = text.chars().filter(|&c| c != '\n' && c != '\r').collect();
    let vis = style::strip_ansi_len(&clean);
    if vis > 44 {
        // Need to truncate the visible portion while preserving ANSI
        format!("{}…", &clean.chars().take(43).collect::<String>())
    } else {
        clean
    }
}

fn format_tool_output_box(output: &str, inner: usize) -> Vec<String> {
    let lines: Vec<&str> = output.lines().collect();
    let max_lines = 8usize;
    let shown: Vec<&str> = lines.iter().copied().take(max_lines).collect();
    let mut result = Vec::new();

    for line in &shown {
        let trimmed = line.trim_end();
        let vis = trimmed.chars().count().min(inner.saturating_sub(4));
        let display: String = trimmed.chars().take(vis).collect();
        let pad = inner
            .saturating_sub(2)
            .saturating_sub(display.chars().count());
        result.push(format!(
            "  {acc}{V}{res}  {MUTED}{display}{RESET}{}{acc}{V}{res}",
            " ".repeat(pad),
            acc = style::ACCENT,
            V = style::BOX_V,
            res = style::RESET,
            MUTED = style::MUTED,
            RESET = style::RESET
        ));
    }
    if lines.len() > max_lines {
        let more = format!(
            "{}… {} more lines{}",
            style::MUTED,
            lines.len() - max_lines,
            style::RESET
        );
        let pad = inner
            .saturating_sub(2)
            .saturating_sub(style::strip_ansi_len(&more));
        result.push(format!(
            "  {acc}{V}{res}  {more}{}{acc}{V}{res}",
            " ".repeat(pad),
            acc = style::ACCENT,
            V = style::BOX_V,
            res = style::RESET
        ));
    }
    result
}

fn format_tool_footer(
    _color: &str,
    inner: usize,
    elapsed: &std::time::Duration,
    _is_error: bool,
) -> String {
    let secs = elapsed.as_secs_f64();
    let dur_str = if secs < 1.0 {
        format!(
            "{HOURGLASS} {:.0}ms",
            secs * 1000.0,
            HOURGLASS = style::HOURGLASS
        )
    } else {
        format!("{HOURGLASS} {:.1}s", secs, HOURGLASS = style::HOURGLASS)
    };
    let vis_dur = style::strip_ansi_len(&dur_str) + 2;
    let bar_before = inner.saturating_sub(vis_dur);
    format!(
        "  {acc}{BL}{bar} {dur_str} {BR}{res}",
        acc = style::ACCENT,
        res = style::RESET,
        BL = style::BOX_BL,
        BR = style::BOX_BR,
        bar = style::BOX_H.repeat(bar_before)
    )
}

// ── OpenAI-compatible runtime client ──────────────────────────────────────────

struct OpenAiRuntimeClient {
    runtime: tokio::runtime::Runtime,
    http: reqwest::Client,
    config: openai::ProviderConfig,
    tool_specs: Vec<DynamicToolSpec>,
    max_tokens: u32,
    enable_tools: bool,
    cache_key: Option<String>,
    is_kimi: bool,
    is_kimi_coding: bool,
}

impl OpenAiRuntimeClient {
    fn new(
        model_spec: String,
        tool_specs: Vec<DynamicToolSpec>,
        enable_tools: bool,
        max_tokens: u32,
        cache_key: Option<String>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let config = openai::resolve_provider(&model_spec)
            .map_err(Box::<dyn std::error::Error>::from)?;
        let is_kimi = model_spec.to_lowercase().contains("kimi")
            || model_spec.to_lowercase().contains("moonshot");
        let is_kimi_coding = model_spec.to_lowercase().contains("kimi-coding");
        Ok(Self {
            runtime: tokio::runtime::Runtime::new()?,
            http: reqwest::Client::new(),
            config,
            tool_specs,
            max_tokens,
            enable_tools,
            cache_key,
            is_kimi,
            is_kimi_coding,
        })
    }
}

impl ApiClient for OpenAiRuntimeClient {
    fn stream(&mut self, request: ApiRequest) -> Result<Vec<AssistantEvent>, RuntimeError> {
        let messages = openai::to_openai_messages(&request.system_prompt, &request.messages);
        let tools = self
            .enable_tools
            .then(|| openai::to_openai_tools(&self.tool_specs));

        let thinking = if self.is_kimi_coding {
            request.thinking.map(|_| {
                serde_json::json!({
                    "type": "enabled",
                    "keep": "all",
                    "budget": 32000
                })
            })
        } else if self.is_kimi {
            request.thinking.map(|_| {
                serde_json::json!({
                    "type": "enabled",
                    "keep": "all"
                })
            })
        } else {
            None
        };

        let body = openai::OaiRequest {
            model: self.config.model.clone(),
            messages,
            tools,
            tool_choice: self.enable_tools.then_some("auto"),
            stream: true,
            stream_options: Some(openai::OaiStreamOptions {
                include_usage: true,
            }),
            max_completion_tokens: self.max_tokens,
            thinking,
            prompt_cache_key: self.cache_key.clone(),
            response_format: None,
        };
        self.runtime
            .block_on(openai::stream_completion(&self.http, &self.config, &body))
    }
}

// ── Unified client enum ────────────────────────────────────────────────────────

enum AnyApiClient {
    Anthropic(AnthropicRuntimeClient),
    OpenAi(OpenAiRuntimeClient),
    Bedrock(bedrock::BedrockRuntimeClient),
    /// Planner/executor split: planner responds to user messages; executor handles
    /// tool-result turns (the agentic loop). Box<> breaks the recursive size.
    Dual {
        planner: Box<AnyApiClient>,
        executor: Box<AnyApiClient>,
    },
}

impl ApiClient for AnyApiClient {
    fn stream(&mut self, request: ApiRequest) -> Result<Vec<AssistantEvent>, RuntimeError> {
        match self {
            Self::Anthropic(c) => c.stream(request),
            Self::OpenAi(c) => c.stream(request),
            Self::Bedrock(c) => c.stream(request),
            Self::Dual {
                planner, executor, ..
            } => {
                // Route by last message role: tool results → executor, user → planner
                let last_is_tool = request
                    .messages
                    .last()
                    .is_some_and(|m| m.role == MessageRole::Tool);
                if last_is_tool {
                    executor.stream(request)
                } else {
                    planner.stream(request)
                }
            }
        }
    }
}

fn permission_policy_from_env() -> PermissionPolicy {
    let mode =
        env::var("RUSTY_CLAUDE_PERMISSION_MODE").unwrap_or_else(|_| "workspace-write".to_string());
    match mode.as_str() {
        "read-only" => PermissionPolicy::new(PermissionMode::Deny)
            .with_tool_mode("read_file", PermissionMode::Allow)
            .with_tool_mode("glob_search", PermissionMode::Allow)
            .with_tool_mode("grep_search", PermissionMode::Allow)
            .with_tool_mode("web_fetch", PermissionMode::Allow)
            .with_tool_mode("todo_read", PermissionMode::Allow),
        "allow-all" => PermissionPolicy::new(PermissionMode::Allow),
        // Default: read/fetch/todo tools auto-approved; write/exec tools need confirmation;
        // MCP tools are auto-approved (they have their own server-side permissions)
        _ => PermissionPolicy::new(PermissionMode::Allow)
            .with_tool_mode("bash", PermissionMode::Prompt)
            .with_tool_mode("write_file", PermissionMode::Prompt)
            .with_tool_mode("edit_file", PermissionMode::Prompt),
    }
}

pub(crate) fn convert_messages(messages: &[ConversationMessage]) -> Vec<InputMessage> {
    messages
        .iter()
        .filter_map(|message| {
            let role = match message.role {
                MessageRole::System | MessageRole::User | MessageRole::Tool => "user",
                MessageRole::Assistant => "assistant",
            };
            let content = message
                .blocks
                .iter()
                .map(|block| match block {
                    ContentBlock::Text { text } => InputContentBlock::Text { text: text.clone() },
                    ContentBlock::Thinking { .. } => InputContentBlock::Text {
                        text: String::new(),
                    },
                    ContentBlock::Image { source } => InputContentBlock::Image {
                        source: match source {
                            runtime::ImageSource::Base64 { media_type, data } => ApiImageSource {
                                source_type: "base64".to_string(),
                                media_type: media_type.clone(),
                                data: data.clone(),
                            },
                        },
                    },
                    ContentBlock::ToolUse { id, name, input } => InputContentBlock::ToolUse {
                        id: id.clone(),
                        name: name.clone(),
                        input: serde_json::from_str(input)
                            .unwrap_or_else(|_| serde_json::json!({ "raw": input })),
                    },
                    ContentBlock::ToolResult {
                        tool_use_id,
                        output,
                        is_error,
                        ..
                    } => InputContentBlock::ToolResult {
                        tool_use_id: tool_use_id.clone(),
                        content: vec![ToolResultContentBlock::Text {
                            text: output.clone(),
                        }],
                        is_error: *is_error,
                    },
                })
                .collect::<Vec<_>>();
            (!content.is_empty()).then(|| InputMessage {
                role: role.to_string(),
                content,
            })
        })
        .collect()
}

fn print_help() {
    println!("claw — personal AI coding agent v{CLAW_VERSION}");
    println!();
    println!("Usage:");
    println!("  claw                                    Start interactive REPL");
    println!("  claw -y / --yes                         Start with auto-accept (skip permission prompts)");
    println!("  claw setup                              Save API keys to ~/.claw-code/config.json");
    println!("  claw --model MODEL                      Start REPL with a specific model");
    println!("  claw --model opusplan                   Opus plans, Sonnet executes");
    println!("  claw prompt TEXT                         Send one prompt and exit");
    println!("  claw --resume SESSION.json              Resume a saved session");
    println!("  claw --version                          Show version");
    println!();
    println!("Model aliases:  sonnet · opus · haiku · sonnet4.5 · opus4.5 · opusplan · minimax2.7 · qwen3.6 · kimi2.6 · kimi-coding");
    println!();
    println!("Slash commands:");
    println!("  /help  /status  /cost  /budget  /compact  /clear  /model  /mcp  /accept-all");
    println!("  /tasks  /sessions  /doctor  /init  /save  /exit");
    println!();
    println!("Flags:");
    println!("  --yes, -y, --dangerously-skip-permissions   Auto-accept all tool calls");
    println!("  --model MODEL                               Use a specific model or alias");
    println!("  --version, -v                               Show version information");
    println!();
    println!("Environment (or save with 'claw setup'):");
    println!("  BEDROCK_API_KEY          Bedrock API key (recommended)");
    println!("  AWS_DEFAULT_REGION       Bedrock region (default: us-east-1)");
    println!("  ANTHROPIC_API_KEY        Anthropic direct API");
    println!("  MINIMAX_API_KEY          MiniMax API key (minimax2.7 model)");
    println!("  DASHSCOPE_API_KEY        Qwen API key (qwen3.6 model)");
    println!("  OPENAI_API_KEY           OpenAI or compatible provider");
    println!("  AWS_ACCESS_KEY_ID        Bedrock IAM auth");
    println!("  AWS_SECRET_ACCESS_KEY    Bedrock IAM auth");
    println!();
    println!("MCP servers: configure in ~/.claude/settings.json (\"mcpServers\" key)");
}

fn run_subagent(
    prompt: &str,
    output_path: &PathBuf,
    model: String,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut cli = LiveCli::new(model, true, true)?;
    let result = cli.runtime.run_turn(prompt, Some(&mut cli.prompter));
    let output = match result {
        Ok(_) => {
            let session = cli.runtime.session();
            let mut text_parts = Vec::new();
            for msg in &session.messages {
                for block in &msg.blocks {
                    if let ContentBlock::Text { text } = block {
                        if !text.trim().is_empty() {
                            text_parts.push(text.clone());
                        }
                    }
                }
            }
            text_parts.join("\n\n")
        }
        Err(e) => format!("error: {e}"),
    };
    std::fs::write(output_path, &output)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{default_model, parse_args, CliAction};
    use runtime::{ContentBlock, ConversationMessage, MessageRole};
    use std::path::PathBuf;

    #[test]
    fn defaults_to_repl_when_no_args() {
        assert_eq!(
            parse_args(&[]).expect("args should parse"),
            CliAction::Repl {
                model: default_model(),
                auto_accept: false,
            }
        );
    }

    #[test]
    fn parses_yes_flag() {
        let args = vec!["--yes".to_string()];
        assert_eq!(
            parse_args(&args).expect("args should parse"),
            CliAction::Repl {
                model: default_model(),
                auto_accept: true,
            }
        );
    }

    #[test]
    fn parses_prompt_subcommand() {
        let args = vec![
            "prompt".to_string(),
            "hello".to_string(),
            "world".to_string(),
        ];
        assert_eq!(
            parse_args(&args).expect("args should parse"),
            CliAction::Prompt {
                prompt: "hello world".to_string(),
                model: default_model(),
            }
        );
    }

    #[test]
    fn parses_system_prompt_options() {
        let args = vec![
            "system-prompt".to_string(),
            "--cwd".to_string(),
            "/tmp/project".to_string(),
            "--date".to_string(),
            "2026-04-01".to_string(),
        ];
        assert_eq!(
            parse_args(&args).expect("args should parse"),
            CliAction::PrintSystemPrompt {
                cwd: PathBuf::from("/tmp/project"),
                date: "2026-04-01".to_string(),
                model: default_model(),
            }
        );
    }

    #[test]
    fn parses_resume_flag_with_slash_command() {
        let args = vec![
            "--resume".to_string(),
            "session.json".to_string(),
            "/compact".to_string(),
        ];
        assert_eq!(
            parse_args(&args).expect("args should parse"),
            CliAction::ResumeSession {
                session_path: PathBuf::from("session.json"),
                command: Some("/compact".to_string()),
            }
        );
    }

    #[test]
    fn converts_tool_roundtrip_messages() {
        let messages = vec![
            ConversationMessage::user_text("hello"),
            ConversationMessage::assistant(vec![ContentBlock::ToolUse {
                id: "tool-1".to_string(),
                name: "bash".to_string(),
                input: "{\"command\":\"pwd\"}".to_string(),
            }]),
            ConversationMessage {
                role: MessageRole::Tool,
                blocks: vec![ContentBlock::ToolResult {
                    tool_use_id: "tool-1".to_string(),
                    tool_name: "bash".to_string(),
                    output: "ok".to_string(),
                    is_error: false,
                }],
                usage: None,
            },
        ];

        let converted = super::convert_messages(&messages);
        assert_eq!(converted.len(), 3);
        assert_eq!(converted[1].role, "assistant");
        assert_eq!(converted[2].role, "user");
    }
}
