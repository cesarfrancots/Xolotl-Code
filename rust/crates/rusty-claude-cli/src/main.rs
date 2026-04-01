mod bedrock;
mod input;
mod mcp;
mod openai;
mod render;

use std::collections::HashSet;
use std::env;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use api::{
    AnthropicClient, ContentBlockDelta, InputContentBlock, InputMessage, MessageRequest,
    OutputContentBlock, StreamEvent as ApiStreamEvent, ToolChoice, ToolDefinition,
    ToolResultContentBlock,
};

use commands::handle_slash_command;
use compat_harness::{extract_manifest, UpstreamPaths};
use mcp::McpManager;
use render::TerminalRenderer;
use runtime::{
    load_system_prompt, ApiClient, ApiRequest, AssistantEvent, CompactionConfig, ContentBlock,
    ConversationMessage, ConversationRuntime, MessageRole, PermissionMode, PermissionPolicy,
    PermissionPromptDecision, PermissionPrompter, PermissionRequest, RuntimeError, Session,
    TokenUsage, ToolError, ToolExecutor,
};
use tools::{execute_tool, mvp_tool_specs, DynamicToolSpec};

const DEFAULT_BEDROCK_MODEL: &str = "bedrock/global.anthropic.claude-sonnet-4-6-v1";
const DEFAULT_MAX_TOKENS: u32 = 8192;

/// Returns the default model.
/// Always uses the Bedrock cross-region (global) Sonnet 4.6 endpoint.
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
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

/// Returns `~/.claw-code/` as an absolute path.
fn claw_home() -> PathBuf {
    let home = env::var("USERPROFILE")
        .or_else(|_| env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
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
        ("BEDROCK_API_KEY", "AWS Bedrock API key — paste from the Bedrock console (recommended)"),
        ("AWS_DEFAULT_REGION", "AWS region for Bedrock (default: us-east-1)"),
        ("ANTHROPIC_API_KEY", "Anthropic direct API key (alternative to Bedrock)"),
        ("KIMI_API_KEY", "Kimi / Moonshot (for kimi/ models)"),
        ("GLM_API_KEY", "Zhipu GLM (for glm/ models)"),
        ("MINIMAX_API_KEY", "MiniMax (for minimax/ models)"),
        ("OPENAI_API_KEY", "OpenAI or custom OpenAI-compat provider"),
        ("AWS_ACCESS_KEY_ID", "AWS Access Key ID (IAM auth — alternative to BEDROCK_API_KEY)"),
        ("AWS_SECRET_ACCESS_KEY", "AWS Secret Access Key (IAM auth)"),
    ];

    let stdin = io::stdin();
    for (var, label) in &keys {
        let current = config
            .get(*var)
            .and_then(|v| v.as_str())
            .or_else(|| None)
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
            config.insert(var.to_string(), serde_json::Value::String(trimmed.to_string()));
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
}

impl ReplPermissionPrompter {
    fn new() -> Self {
        Self {
            always_allow: HashSet::new(),
        }
    }
}

impl PermissionPrompter for ReplPermissionPrompter {
    fn decide(&mut self, request: &PermissionRequest) -> PermissionPromptDecision {
        if self.always_allow.contains(&request.tool_name) {
            return PermissionPromptDecision::Allow;
        }
        let preview: String = request.input.chars().take(120).collect();
        eprintln!();
        eprintln!("  Tool:  {}", request.tool_name);
        eprintln!("  Input: {preview}");
        eprint!("  Allow? [y]es / [n]o / [a]lways : ");
        let _ = io::stderr().flush();
        let mut line = String::new();
        if io::stdin().lock().read_line(&mut line).is_err() {
            return PermissionPromptDecision::Deny {
                reason: "could not read permission response".to_string(),
            };
        }
        match line.trim() {
            "y" | "yes" | "" => PermissionPromptDecision::Allow,
            "a" | "always" => {
                self.always_allow.insert(request.tool_name.clone());
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
        Some("setup") | Some("--help") | Some("-h") | Some("dump-manifests") | Some("bootstrap-plan") | Some("system-prompt")
    ) {
        load_config_keys();
    }

    match parse_args(&args)? {
        CliAction::DumpManifests => dump_manifests(),
        CliAction::BootstrapPlan => print_bootstrap_plan(),
        CliAction::PrintSystemPrompt { cwd, date } => print_system_prompt(cwd, date),
        CliAction::ResumeSession {
            session_path,
            command,
        } => resume_session(&session_path, command),
        CliAction::Prompt { prompt, model } => LiveCli::new(model, false)?.run_turn(&prompt)?,
        CliAction::Repl { model } => run_repl(model)?,
        CliAction::Setup => run_setup()?,
        CliAction::Help => print_help(),
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
    },
    Setup,
    Help,
}

fn parse_args(args: &[String]) -> Result<CliAction, String> {
    let mut model = default_model();
    let mut rest = Vec::new();
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
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
            other => {
                rest.push(other.to_string());
                index += 1;
            }
        }
    }

    if rest.is_empty() {
        return Ok(CliAction::Repl { model });
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
        "system-prompt" => parse_system_prompt_args(&rest[1..]),
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

fn parse_system_prompt_args(args: &[String]) -> Result<CliAction, String> {
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

    Ok(CliAction::PrintSystemPrompt { cwd, date })
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

fn print_system_prompt(cwd: PathBuf, date: String) {
    match load_system_prompt(cwd, date, env::consts::OS, "unknown") {
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

fn run_repl(model: String) -> Result<(), Box<dyn std::error::Error>> {
    let mut cli = LiveCli::new(model, true)?;
    let editor = input::LineEditor::new("› ");

    // ── Startup banner ─────────────────────────────────────────────────────────
    println!();
    println!("  \x1b[1;36m⚡ claw\x1b[0m  \x1b[2m{}\x1b[0m", cli.model);
    println!("  \x1b[2m/help for commands · Shift+Enter for newlines\x1b[0m");
    println!("  \x1b[2msession → {}\x1b[0m", cli.auto_save_path.display());
    {
        let mcp_tool_count = cli.mcp.lock().map(|m| m.tools.len()).unwrap_or(0);
        if mcp_tool_count > 0 {
            println!("  \x1b[2m{mcp_tool_count} MCP tool{} loaded  (/mcp for details)\x1b[0m",
                if mcp_tool_count == 1 { "" } else { "s" });
        }
    }
    println!();

    while let Some(input) = editor.read_line()? {
        let trimmed = input.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Dispatch slash commands
        if trimmed.starts_with('/') {
            let parts: Vec<&str> = trimmed.splitn(2, ' ').collect();
            match parts[0] {
                "/exit" | "/quit" => break,
                "/help" => print_slash_help(),
                "/status" => cli.print_status(),
                "/cost" => cli.print_cost(),
                "/compact" => cli.compact()?,
                "/clear" => cli.clear_session()?,
                "/save" => cli.save_session()?,
                "/mcp" => cli.print_mcp_status(),
                "/model" => {
                    if let Some(name) = parts.get(1).copied() {
                        cli.set_model(name.trim())?;
                    } else {
                        println!("\n  \x1b[2mcurrent\x1b[0m  {}", cli.model);
                        println!("  \x1b[2musage\x1b[0m    /model <model>");
                        println!("           /model <planner>+<executor>");
                        println!("           /model opusplan");
                        println!("           /model opusplan kimi/moonshot-v1-32k");
                        println!();
                    }
                }
                other => {
                    println!("\n  \x1b[31m✘ Unknown command: {other}\x1b[0m  \x1b[2m(try /help)\x1b[0m\n");
                }
            }
            continue;
        }

        cli.run_turn(trimmed)?;
    }

    println!("\n  \x1b[2mBye.\x1b[0m\n");
    Ok(())
}

fn print_slash_help() {
    println!();
    println!("  \x1b[1mCommands\x1b[0m");
    println!("  \x1b[2m────────────────────────────────────\x1b[0m");
    println!("  \x1b[36m/help\x1b[0m               show this help");
    println!("  \x1b[36m/status\x1b[0m             token usage & cost");
    println!("  \x1b[36m/cost\x1b[0m               detailed cost breakdown");
    println!("  \x1b[36m/compact\x1b[0m            compact session history");
    println!("  \x1b[36m/clear\x1b[0m              clear session and start fresh");
    println!("  \x1b[36m/model\x1b[0m \x1b[2m<name>\x1b[0m       switch model");
    println!("  \x1b[36m/mcp\x1b[0m                list connected MCP servers and tools");
    println!("  \x1b[36m/save\x1b[0m               save session to disk");
    println!("  \x1b[36m/exit\x1b[0m               quit");
    println!();
}

struct LiveCli {
    model: String,
    system_prompt: Vec<String>,
    runtime: ConversationRuntime<AnyApiClient, CliToolExecutor>,
    prompter: ReplPermissionPrompter,
    /// Path where this session is auto-saved after every turn.
    auto_save_path: PathBuf,
    /// Shared MCP manager (kept alive for the duration of the REPL session).
    mcp: Arc<Mutex<McpManager>>,
}

impl LiveCli {
    fn new(model: String, enable_tools: bool) -> Result<Self, Box<dyn std::error::Error>> {
        // Connect to MCP servers (errors are warnings, not fatal)
        let mcp = Arc::new(Mutex::new(McpManager::connect()));
        let system_prompt = build_system_prompt()?;
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
        Ok(Self {
            model,
            system_prompt,
            runtime,
            prompter: ReplPermissionPrompter::new(),
            auto_save_path,
            mcp,
        })
    }

    fn run_turn(&mut self, input: &str) -> Result<(), Box<dyn std::error::Error>> {
        println!(); // breathing room before response
        let result = self.runtime.run_turn(input, Some(&mut self.prompter));
        match result {
            Ok(_) => {
                let cost = self.runtime.usage().cost_usd(primary_model_name(&self.model));
                let usage = self.runtime.usage().cumulative_usage();
                println!(
                    "\n  \x1b[2m↑{} ↓{}  ${cost:.4}\x1b[0m",
                    usage.input_tokens, usage.output_tokens,
                );
                // Auto-save after every successful turn
                if let Err(e) = self.runtime.session().save_to_path(&self.auto_save_path) {
                    eprintln!("  \x1b[33m⚠ auto-save failed: {e}\x1b[0m");
                }
                Ok(())
            }
            Err(error) => {
                println!("\n  \x1b[31m✘ {error}\x1b[0m");
                Err(Box::new(error))
            }
        }
    }

    fn print_status(&self) {
        let usage = self.runtime.usage().cumulative_usage();
        let cost = self.runtime.usage().cost_usd(primary_model_name(&self.model));
        println!();
        println!("  \x1b[1mSession\x1b[0m");
        println!("  \x1b[2m────────────────────────────────────\x1b[0m");
        println!("  \x1b[36mmodel\x1b[0m       {}", self.model);
        println!("  \x1b[36mmessages\x1b[0m    {}", self.runtime.session().messages.len());
        println!("  \x1b[36mturns\x1b[0m       {}", self.runtime.usage().turns());
        println!("  \x1b[36m↑ tokens\x1b[0m    {}", usage.input_tokens);
        println!("  \x1b[36m↓ tokens\x1b[0m    {}", usage.output_tokens);
        println!("  \x1b[36mcost\x1b[0m        \x1b[1m${cost:.4}\x1b[0m");
        println!();
    }

    fn compact(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let result = self.runtime.compact(CompactionConfig::default());
        let removed = result.removed_message_count;
        self.runtime = build_runtime(
            result.compacted_session,
            self.model.clone(),
            self.system_prompt.clone(),
            Arc::clone(&self.mcp),
            true,
        )?;
        println!("\n  \x1b[32m✔\x1b[0m Compacted \x1b[1m{removed}\x1b[0m messages.\n");
        Ok(())
    }

    fn clear_session(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        // Allocate a fresh auto-save path for the new session
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
        println!("\n  \x1b[32m✔\x1b[0m Session cleared.\n");
        Ok(())
    }

    fn set_model(&mut self, new_model: &str) -> Result<(), Box<dyn std::error::Error>> {
        let expanded = expand_model_spec(new_model);
        self.runtime = build_runtime(
            self.runtime.session().clone(),
            expanded.clone(),
            self.system_prompt.clone(),
            Arc::clone(&self.mcp),
            true,
        )?;
        self.model = expanded.clone();
        if let Some(i) = expanded.find('+') {
            println!(
                "\n  \x1b[32m✔\x1b[0m Dual model  \x1b[36mplanner\x1b[0m {} \x1b[2m+\x1b[0m \x1b[36mexecutor\x1b[0m {}\n",
                &expanded[..i],
                &expanded[i + 1..]
            );
        } else {
            println!("\n  \x1b[32m✔\x1b[0m Model → \x1b[1m{expanded}\x1b[0m\n");
        }
        Ok(())
    }

    fn save_session(&self) -> Result<(), Box<dyn std::error::Error>> {
        self.runtime.session().save_to_path(&self.auto_save_path)?;
        println!(
            "\n  \x1b[32m✔\x1b[0m Saved → \x1b[2m{}\x1b[0m\n",
            self.auto_save_path.display()
        );
        Ok(())
    }

    fn print_cost(&self) {
        let usage = self.runtime.usage().cumulative_usage();
        let primary = primary_model_name(&self.model);
        let cost = self.runtime.usage().cost_usd(primary);
        println!();
        println!("  \x1b[1mCost\x1b[0m");
        println!("  \x1b[2m────────────────────────────────────\x1b[0m");
        if let Some(plus) = self.model.find('+') {
            println!("  \x1b[36mplanner\x1b[0m     {}", &self.model[..plus]);
            println!("  \x1b[36mexecutor\x1b[0m    {}", &self.model[plus + 1..]);
        } else {
            println!("  \x1b[36mmodel\x1b[0m       {}", self.model);
        }
        println!("  \x1b[36m↑ tokens\x1b[0m    {}", usage.input_tokens);
        println!("  \x1b[36m↓ tokens\x1b[0m    {}", usage.output_tokens);
        println!("  \x1b[36mcache wr\x1b[0m     {}", usage.cache_creation_input_tokens);
        println!("  \x1b[36mcache rd\x1b[0m     {}", usage.cache_read_input_tokens);
        println!("  \x1b[36mcost\x1b[0m        \x1b[1m${cost:.4}\x1b[0m  \x1b[2m(planner rate)\x1b[0m");
        println!();
    }

    fn print_mcp_status(&self) {
        println!();
        println!("  \x1b[1mMCP Servers\x1b[0m");
        println!("  \x1b[2m────────────────────────────────────\x1b[0m");
        if let Ok(manager) = self.mcp.lock() {
            if manager.is_empty() {
                println!("  \x1b[2mNo MCP servers connected.\x1b[0m");
                println!("  \x1b[2mAdd servers to ~/.claude/settings.json under \"mcpServers\".\x1b[0m");
            } else {
                let mut current_server = String::new();
                for tool in &manager.tools {
                    if tool.server_name != current_server {
                        current_server = tool.server_name.clone();
                        println!("  \x1b[36m{current_server}\x1b[0m");
                    }
                    println!("    \x1b[2m{}\x1b[0m  {}", tool.qualified_name, tool.description);
                }
            }
        }
        println!();
    }
}

fn build_system_prompt() -> Result<Vec<String>, Box<dyn std::error::Error>> {
    Ok(load_system_prompt(
        env::current_dir()?,
        today_iso(),
        env::consts::OS,
        "unknown",
    )?)
}

/// Expand shorthand model specs before routing.
/// - `opusplan` → `claude-opus-4-5-20250514+<DEFAULT_MODEL>`
/// - `opusplan kimi/moonshot-v1-32k` → `claude-opus-4-5-20250514+kimi/moonshot-v1-32k`
fn expand_model_spec(spec: &str) -> String {
    const OPUS: &str = "claude-opus-4-5-20250514";
    if spec == "opusplan" {
        format!("{OPUS}+{}", default_model())
    } else if let Some(executor) = spec.strip_prefix("opusplan ") {
        format!("{OPUS}+{executor}")
    } else {
        spec.to_string()
    }
}

/// Returns just the planner model name (the part before `+`, if any).
/// Used for cost estimation — the executor model may be a free/cheap provider.
fn primary_model_name(model: &str) -> &str {
    match model.find('+') {
        Some(i) => &model[..i],
        None => model,
    }
}

/// Build a single (non-dual) API client for a model spec.
fn build_single_client(
    model: &str,
    tool_specs: Vec<DynamicToolSpec>,
    enable_tools: bool,
) -> Result<AnyApiClient, Box<dyn std::error::Error>> {
    if bedrock::is_bedrock_model(model) {
        Ok(AnyApiClient::Bedrock(bedrock::BedrockRuntimeClient::new(
            model,
            tool_specs,
            enable_tools,
        )?))
    } else if openai::is_anthropic_model(model) {
        Ok(AnyApiClient::Anthropic(AnthropicRuntimeClient::new(
            model.to_string(),
            tool_specs,
            enable_tools,
        )?))
    } else {
        Ok(AnyApiClient::OpenAi(OpenAiRuntimeClient::new(
            model.to_string(),
            tool_specs,
            enable_tools,
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
    let tool_executor = CliToolExecutor::new(Arc::clone(&mcp));
    let tool_specs = if enable_tools {
        tool_executor.all_tool_specs()
    } else {
        Vec::new()
    };

    let client = if let Some(plus) = model.find('+') {
        let planner_spec = &model[..plus];
        let executor_spec = &model[plus + 1..];
        AnyApiClient::Dual {
            planner: Box::new(build_single_client(planner_spec, tool_specs.clone(), enable_tools)?),
            executor: Box::new(build_single_client(executor_spec, tool_specs, enable_tools)?),
        }
    } else {
        build_single_client(&model, tool_specs, enable_tools)?
    };

    Ok(ConversationRuntime::new(
        session,
        client,
        tool_executor,
        permission_policy_from_env(),
        system_prompt,
    ))
}

struct AnthropicRuntimeClient {
    runtime: tokio::runtime::Runtime,
    client: AnthropicClient,
    model: String,
    tool_specs: Vec<DynamicToolSpec>,
    enable_tools: bool,
}

impl AnthropicRuntimeClient {
    fn new(model: String, tool_specs: Vec<DynamicToolSpec>, enable_tools: bool) -> Result<Self, Box<dyn std::error::Error>> {
        Ok(Self {
            runtime: tokio::runtime::Runtime::new()?,
            client: AnthropicClient::from_env()?,
            model,
            tool_specs,
            enable_tools,
        })
    }
}

impl ApiClient for AnthropicRuntimeClient {
    fn stream(&mut self, request: ApiRequest) -> Result<Vec<AssistantEvent>, RuntimeError> {
        let message_request = MessageRequest {
            model: self.model.clone(),
            max_tokens: DEFAULT_MAX_TOKENS,
            messages: convert_messages(&request.messages),
            system: (!request.system_prompt.is_empty()).then(|| request.system_prompt.join("\n\n")),
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
                                            .and_then(|_| stdout.flush())
                                            .map_err(|error| RuntimeError::new(error.to_string()))?;
                                        events.push(AssistantEvent::TextDelta(text));
                                    }
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
                    .and_then(|_| out.flush())
                    .map_err(|error| RuntimeError::new(error.to_string()))?;
                events.push(AssistantEvent::TextDelta(text));
            }
        }
        OutputContentBlock::ToolUse { id, name, input } => {
            *pending_tool = Some((id, name, input.to_string()));
        }
    }
    Ok(())
}


struct CliToolExecutor {
    renderer: TerminalRenderer,
    mcp: Arc<Mutex<McpManager>>,
}

impl CliToolExecutor {
    fn new(mcp: Arc<Mutex<McpManager>>) -> Self {
        Self {
            renderer: TerminalRenderer::new(),
            mcp,
        }
    }

    /// Return all tool specs: builtin MVP tools + MCP tools.
    fn all_tool_specs(&self) -> Vec<DynamicToolSpec> {
        let mut specs: Vec<DynamicToolSpec> = mvp_tool_specs()
            .iter()
            .map(DynamicToolSpec::from)
            .collect();
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
}

impl ToolExecutor for CliToolExecutor {
    fn execute(&mut self, tool_name: &str, input: &str) -> Result<String, ToolError> {
        // Route MCP tools
        if tool_name.starts_with("mcp__") {
            let output = self
                .mcp
                .lock()
                .map_err(|e| ToolError::new(format!("MCP lock poisoned: {e}")))?
                .execute(tool_name, input)
                .map_err(ToolError::new)?;
            let markdown = format!("### Tool `{tool_name}`\n\n```\n{output}\n```\n");
            self.renderer
                .stream_markdown(&markdown, &mut io::stdout())
                .map_err(|e| ToolError::new(e.to_string()))?;
            return Ok(output);
        }

        let value = serde_json::from_str(input)
            .map_err(|error| ToolError::new(format!("invalid tool input JSON: {error}")))?;
        match execute_tool(tool_name, &value) {
            Ok(output) => {
                let markdown = format!("### Tool `{tool_name}`\n\n```json\n{output}\n```\n");
                self.renderer
                    .stream_markdown(&markdown, &mut io::stdout())
                    .map_err(|error| ToolError::new(error.to_string()))?;
                Ok(output)
            }
            Err(error) => Err(ToolError::new(error)),
        }
    }
}

// ── OpenAI-compatible runtime client ──────────────────────────────────────────

struct OpenAiRuntimeClient {
    runtime: tokio::runtime::Runtime,
    http: reqwest::Client,
    config: openai::ProviderConfig,
    tool_specs: Vec<DynamicToolSpec>,
    max_tokens: u32,
    enable_tools: bool,
}

impl OpenAiRuntimeClient {
    fn new(model_spec: String, tool_specs: Vec<DynamicToolSpec>, enable_tools: bool) -> Result<Self, Box<dyn std::error::Error>> {
        let config = openai::resolve_provider(&model_spec)
            .map_err(|e| Box::<dyn std::error::Error>::from(e))?;
        Ok(Self {
            runtime: tokio::runtime::Runtime::new()?,
            http: reqwest::Client::new(),
            config,
            tool_specs,
            max_tokens: DEFAULT_MAX_TOKENS,
            enable_tools,
        })
    }
}

impl ApiClient for OpenAiRuntimeClient {
    fn stream(&mut self, request: ApiRequest) -> Result<Vec<AssistantEvent>, RuntimeError> {
        let messages =
            openai::to_openai_messages(&request.system_prompt, &request.messages);
        let tools = self.enable_tools.then(|| openai::to_openai_tools(&self.tool_specs));
        let body = openai::OaiRequest {
            model: self.config.model.clone(),
            messages,
            tools,
            tool_choice: self.enable_tools.then_some("auto"),
            stream: true,
            stream_options: Some(openai::OaiStreamOptions { include_usage: true }),
            max_tokens: self.max_tokens,
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
            Self::Dual { planner, executor, .. } => {
                // Route by last message role: tool results → executor, user → planner
                let last_is_tool = request
                    .messages
                    .last()
                    .map(|m| m.role == MessageRole::Tool)
                    .unwrap_or(false);
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
    println!("claw — personal AI coding agent");
    println!();
    println!("Usage:");
    println!("  claw                                    Start interactive REPL");
    println!("  claw setup                              Save API keys to ~/.claw-code/config.json");
    println!("  claw --model MODEL                      Start REPL with a specific model");
    println!("  claw --model PLAN+EXEC                  Dual model: planner+executor");
    println!("  claw --model opusplan                   Opus plans, Sonnet executes");
    println!("  claw --model 'opusplan kimi/moonshot-v1-32k'  Opus plans, Kimi executes");
    println!("  claw prompt TEXT                        Send one prompt and exit");
    println!("  claw system-prompt [--cwd PATH]         Print system prompt for current dir");
    println!("  claw --resume SESSION.json [/compact]   Resume a saved session");
    println!();
    println!("Slash commands (inside REPL):");
    println!("  /help   /status   /cost   /compact   /clear   /model <name>   /mcp   /save   /exit");
    println!();
    println!("Environment (or save with 'claw setup'):");
    println!("  BEDROCK_API_KEY                 Bedrock API key (create in AWS console)");
    println!("  AWS_DEFAULT_REGION              Bedrock region (default: us-east-1)");
    println!("  ANTHROPIC_API_KEY               Anthropic direct API");
    println!("  KIMI_API_KEY                    Required for kimi/ models");
    println!("  GLM_API_KEY                     Required for glm/ models");
    println!("  MINIMAX_API_KEY                 Required for minimax/ models");
    println!("  OPENAI_API_KEY                  Required for openai/ or custom models");
    println!("  AWS_ACCESS_KEY_ID               Bedrock IAM auth (alternative to BEDROCK_API_KEY)");
    println!("  AWS_SECRET_ACCESS_KEY           Bedrock IAM auth");
    println!("  AWS_SESSION_TOKEN               Optional — temporary IAM credentials");
    println!("  RUSTY_CLAUDE_PERMISSION_MODE    read-only | allow-all (default: prompt for writes)");
    println!();
    println!("MCP servers:");
    println!("  Configure in ~/.claude/settings.json (same format as Claude Code / OpenCode):");
    println!("  {{ \"mcpServers\": {{ \"name\": {{ \"command\": \"npx\", \"args\": [...] }} }} }}");
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
