use runtime::{
    edit_file, execute_bash, glob_search, grep_search, read_file, read_image_base64, todo_read,
    todo_write, web_fetch, write_file, BashCommandInput, GrepSearchInput, TodoWriteInput,
    WebFetchInput,
};

mod task;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolManifestEntry {
    pub name: String,
    pub source: ToolSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolSource {
    Base,
    Conditional,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ToolRegistry {
    entries: Vec<ToolManifestEntry>,
}

impl ToolRegistry {
    #[must_use]
    pub fn new(entries: Vec<ToolManifestEntry>) -> Self {
        Self { entries }
    }

    #[must_use]
    pub fn entries(&self) -> &[ToolManifestEntry] {
        &self.entries
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolSpec {
    pub name: &'static str,
    pub description: &'static str,
    pub input_schema: Value,
}

/// Like `ToolSpec` but with owned `String` fields — used for dynamic tools
/// such as MCP server tools whose names aren't known at compile time.
#[derive(Debug, Clone)]
pub struct DynamicToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

impl From<&ToolSpec> for DynamicToolSpec {
    fn from(s: &ToolSpec) -> Self {
        Self {
            name: s.name.to_string(),
            description: s.description.to_string(),
            input_schema: s.input_schema.clone(),
        }
    }
}

#[allow(clippy::too_many_lines)]
#[must_use]
pub fn mvp_tool_specs() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "bash",
            description: "Execute a shell command in the current workspace.\n\n\
                - The command runs in PowerShell on Windows or sh on Unix.\n\
                - Working directory is the project root.\n\
                - Use `timeout` (milliseconds) for long-running commands; if it fires the output will be empty and `interrupted` will be true.\n\
                - Set `run_in_background: true` to launch a detached process (e.g. dev servers); returns immediately with a background task id.\n\
                - Output (combined stdout+stderr) is capped at 50 KB; larger output is truncated.\n\
                - Prefer single-line commands. For multi-step work use `;` to chain (avoid `&&` on PowerShell).\n\
                - Always quote file paths that contain spaces.\n\
                - NEVER run destructive or irreversible commands without explicit user approval.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "The shell command to execute" },
                    "timeout": { "type": "integer", "minimum": 1, "description": "Timeout in milliseconds (default: 120000)" },
                    "description": { "type": "string", "description": "Brief description of what this command does (5-10 words)" },
                    "run_in_background": { "type": "boolean", "description": "If true, launch the command in the background and return immediately" },
                    "dangerouslyDisableSandbox": { "type": "boolean" }
                },
                "required": ["command"],
                "additionalProperties": false
            }),
        },
        ToolSpec {
            name: "read_file",
            description: "Read a text file from the workspace.\n\n\
                - Returns the file content with each line prefixed by its 1-indexed line number.\n\
                - Use `offset` (1-indexed line number) and `limit` (number of lines) to paginate large files.\n\
                - Default: first 2000 lines. Call again with a larger offset to read later sections.\n\
                - If the file is binary or not valid UTF-8, an error is returned.\n\
                - Use glob_search to find file paths before reading.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute or relative file path" },
                    "offset": { "type": "integer", "minimum": 0, "description": "Line number to start from (0-indexed, default: 0)" },
                    "limit": { "type": "integer", "minimum": 1, "description": "Maximum lines to return (default: 2000)" }
                },
                "required": ["path"],
                "additionalProperties": false
            }),
        },
        ToolSpec {
            name: "write_file",
            description: "Write (create or overwrite) a text file in the workspace.\n\n\
                - Creates parent directories automatically.\n\
                - The entire `content` string becomes the new file content.\n\
                - ALWAYS read a file before overwriting it to avoid data loss.\n\
                - Prefer edit_file for small changes to existing files.\n\
                - Never write files that likely contain secrets (.env, credentials).",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute or relative file path" },
                    "content": { "type": "string", "description": "The full text content to write" }
                },
                "required": ["path", "content"],
                "additionalProperties": false
            }),
        },
        ToolSpec {
            name: "edit_file",
            description: "Replace exact text in an existing workspace file.\n\n\
                - `old_string` must match EXACTLY (including whitespace and indentation) in the file.\n\
                - If `old_string` is not found, the edit fails — verify the content with read_file first.\n\
                - If `old_string` appears multiple times and `replace_all` is false, only the first match is replaced.\n\
                - Use `replace_all: true` when renaming variables or updating repeated patterns.\n\
                - `new_string` must be different from `old_string`.\n\
                - Prefer this over write_file for targeted changes.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute or relative file path" },
                    "old_string": { "type": "string", "description": "Exact text to find and replace" },
                    "new_string": { "type": "string", "description": "Replacement text" },
                    "replace_all": { "type": "boolean", "description": "Replace all occurrences (default: false, replace first only)" }
                },
                "required": ["path", "old_string", "new_string"],
                "additionalProperties": false
            }),
        },
        ToolSpec {
            name: "glob_search",
            description: "Find files by glob pattern.\n\n\
                - Supports glob patterns like '**/*.rs', 'src/**/*.ts', '*.json'.\n\
                - Results are sorted by modification time (most recent first), capped at 100 files.\n\
                - Use this to discover file paths before reading them.\n\
                - Automatically skips .git, node_modules, target, and other generated directories.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "Glob pattern to match files" },
                    "path": { "type": "string", "description": "Base directory to search (default: current workspace)" }
                },
                "required": ["pattern"],
                "additionalProperties": false
            }),
        },
        ToolSpec {
            name: "grep_search",
            description: "Search file contents with a regex pattern.\n\n\
                - Returns matching file paths sorted by modification time (most recent first).\n\
                - Use `output_mode: 'content'` to include matching lines with context.\n\
                - Use `-i: true` for case-insensitive search, `multiline: true` for multi-line patterns.\n\
                - Use `glob` to filter by file pattern (e.g. '*.rs'), and `path` to limit the search directory.\n\
                - Automatically skips .git, node_modules, target, __pycache__, and other generated directories.\n\
                - Results are capped at 250 files.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "Regex pattern to search for" },
                    "path": { "type": "string", "description": "Directory to search (default: current workspace)" },
                    "glob": { "type": "string", "description": "File glob filter (e.g. '*.rs', '*.{ts,tsx}')" },
                    "output_mode": { "type": "string", "description": "'files_with_matches' (default), 'content', or 'count'" },
                    "-B": { "type": "integer", "minimum": 0, "description": "Lines of context before match" },
                    "-A": { "type": "integer", "minimum": 0, "description": "Lines of context after match" },
                    "-C": { "type": "integer", "minimum": 0, "description": "Lines of context before and after" },
                    "context": { "type": "integer", "minimum": 0 },
                    "-n": { "type": "boolean" },
                    "-i": { "type": "boolean", "description": "Case-insensitive search" },
                    "type": { "type": "string" },
                    "head_limit": { "type": "integer", "minimum": 1 },
                    "offset": { "type": "integer", "minimum": 0 },
                    "multiline": { "type": "boolean", "description": "Enable multi-line regex matching" }
                },
                "required": ["pattern"],
                "additionalProperties": false
            }),
        },
        ToolSpec {
            name: "web_fetch",
            description: "Fetch the content of a URL and return it as readable text.\n\n\
                - Only http:// and https:// URLs are supported.\n\
                - HTML is automatically converted to readable text (scripts/styles removed, entities decoded).\n\
                - JSON responses are pretty-printed.\n\
                - Response is capped at 512 KB. Use `start_index` and `max_length` to paginate large pages.\n\
                - Set `raw: true` to return raw HTML without conversion.\n\
                - Timeout: 30 seconds. Follows up to 5 redirects.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "The URL to fetch (http:// or https:// only)" },
                    "max_length": { "type": "integer", "minimum": 1, "description": "Maximum characters to return (default: 20000)" },
                    "start_index": { "type": "integer", "minimum": 0, "description": "Character offset to start from (default: 0)" },
                    "raw": { "type": "boolean", "description": "If true, return raw HTML/text without conversion" }
                },
                "required": ["url"],
                "additionalProperties": false
            }),
        },
        ToolSpec {
            name: "todo_write",
            description: "Create and manage a structured task list for tracking progress.\n\n\
                - Call this proactively when starting complex multi-step tasks.\n\
                - Pass the COMPLETE updated list every time — it replaces the previous list entirely.\n\
                - Update task status in real-time: set 'in_progress' when starting, 'completed' when done.\n\
                - Keep at most ONE task 'in_progress' at a time.\n\
                - The todo list persists across sessions in ~/.claw-code/todos.json.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "todos": {
                        "type": "array",
                        "description": "The complete updated todo list",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "string", "description": "Unique identifier" },
                                "content": { "type": "string", "description": "Task description" },
                                "status": { "type": "string", "enum": ["pending", "in_progress", "completed", "cancelled"] },
                                "priority": { "type": "string", "enum": ["high", "medium", "low"] }
                            },
                            "required": ["id", "content", "status", "priority"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": ["todos"],
                "additionalProperties": false
            }),
        },
        ToolSpec {
            name: "todo_read",
            description: "Read the current todo list. Use this to check on pending tasks at the start of a session or when the user asks about outstanding work.",
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        },
        ToolSpec {
            name: "read_image",
            description: "Read an image file and return it as a base64-encoded data URL for sending to the model.\n\n\
                - Supports PNG, JPEG, GIF, WebP, and SVG.\n\
                - Returns a JSON object with `media_type` and `data` (base64) fields.\n\
                - Use this to include screenshots, diagrams, or other images in the conversation.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute or relative path to the image file" }
                },
                "required": ["path"],
                "additionalProperties": false
            }),
        },
        ToolSpec {
            name: "task",
            description: "Run a task in a sub-agent with full tool access.\n\n\
                - `description`: a short label for this task (shown in parallel execution UI).\n\
                - `prompt`: the instruction for the sub-agent (typically a multi-step task).\n\
                - Runs up to 5 tasks in parallel by default, configurable via MAX_PARALLEL_TASKS.\n\
                - The sub-agent inherits ALL tools available to the parent (including MCP tools).\n\
                - Returns a JSON array of {task_id, description, success, output, elapsed_ms}.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "tasks": {
                        "type": "array",
                        "description": "List of tasks to run in parallel",
                        "items": {
                            "type": "object",
                            "properties": {
                                "description": { "type": "string", "description": "Short label for this task" },
                                "prompt": { "type": "string", "description": "Instruction for the sub-agent" }
                            },
                            "required": ["description", "prompt"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": ["tasks"],
                "additionalProperties": false
            }),
        },
    ]
}

pub fn execute_tool(name: &str, input: &Value) -> Result<String, String> {
    match name {
        "bash" => from_value::<BashCommandInput>(input).and_then(run_bash),
        "read_file" => from_value::<ReadFileInput>(input).and_then(run_read_file),
        "write_file" => from_value::<WriteFileInput>(input).and_then(run_write_file),
        "edit_file" => from_value::<EditFileInput>(input).and_then(run_edit_file),
        "glob_search" => from_value::<GlobSearchInputValue>(input).and_then(run_glob_search),
        "grep_search" => from_value::<GrepSearchInput>(input).and_then(run_grep_search),
        "web_fetch" => from_value::<WebFetchInput>(input).and_then(run_web_fetch),
        "todo_write" => from_value::<TodoWriteInput>(input).and_then(run_todo_write),
        "todo_read" => run_todo_read(),
        "read_image" => from_value::<ReadImageInput>(input).and_then(run_read_image),
        "task" => from_value::<TaskInput>(input).and_then(run_task),
        _ => Err(format!("unsupported tool: {name}")),
    }
}

fn from_value<T: for<'de> Deserialize<'de>>(input: &Value) -> Result<T, String> {
    serde_json::from_value(input.clone()).map_err(|error| error.to_string())
}

fn run_bash(input: BashCommandInput) -> Result<String, String> {
    serde_json::to_string_pretty(&execute_bash(input).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

    #[allow(clippy::needless_pass_by_value)]
    fn run_read_file(input: ReadFileInput) -> Result<String, String> {
        to_pretty_json(read_file(&input.path, input.offset, input.limit).map_err(io_to_string)?)
    }

#[allow(clippy::needless_pass_by_value)]
    fn run_write_file(input: WriteFileInput) -> Result<String, String> {
        to_pretty_json(write_file(&input.path, &input.content).map_err(io_to_string)?)
    }

#[allow(clippy::needless_pass_by_value)]
    fn run_edit_file(input: EditFileInput) -> Result<String, String> {
        to_pretty_json(
            edit_file(
                &input.path,
                &input.old_string,
                &input.new_string,
                input.replace_all.unwrap_or(false),
            )
            .map_err(io_to_string)?,
        )
    }

#[allow(clippy::needless_pass_by_value)]
    fn run_glob_search(input: GlobSearchInputValue) -> Result<String, String> {
        to_pretty_json(glob_search(&input.pattern, input.path.as_deref()).map_err(io_to_string)?)
    }

#[allow(clippy::needless_pass_by_value)]
    fn run_grep_search(input: GrepSearchInput) -> Result<String, String> {
        to_pretty_json(grep_search(&input).map_err(io_to_string)?)
    }

#[allow(clippy::needless_pass_by_value)]
    fn run_web_fetch(input: WebFetchInput) -> Result<String, String> {
        to_pretty_json(web_fetch(&input)?)
    }

#[allow(clippy::needless_pass_by_value)]
    fn run_todo_write(input: TodoWriteInput) -> Result<String, String> {
        to_pretty_json(todo_write(&input)?)
    }

fn run_todo_read() -> Result<String, String> {
    to_pretty_json(todo_read()?)
}

#[allow(clippy::needless_pass_by_value)]
    fn run_read_image(input: ReadImageInput) -> Result<String, String> {
        let source = read_image_base64(&input.path).map_err(|e| e.to_string())?;
        to_pretty_json(&source)
    }

#[allow(clippy::needless_pass_by_value)]
    fn run_task(input: TaskInput) -> Result<String, String> {
        let max_parallel = std::env::var("MAX_PARALLEL_TASKS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(5);
        let runtime = task::TaskRuntime::new(max_parallel);
        let specs = input
            .tasks
            .into_iter()
            .map(|t| task::TaskSpec {
                description: t.description,
                prompt: t.prompt,
            })
            .collect();
        let results = runtime.run_tasks(specs);
        to_pretty_json(&results)
    }

fn to_pretty_json<T: serde::Serialize>(value: T) -> Result<String, String> {
    serde_json::to_string_pretty(&value).map_err(|error| error.to_string())
}

#[allow(clippy::needless_pass_by_value)]
fn io_to_string(error: std::io::Error) -> String {
    error.to_string()
}

#[derive(Debug, Deserialize)]
#[allow(clippy::needless_pass_by_value)]
struct ReadFileInput {
    path: String,
    offset: Option<usize>,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[allow(clippy::needless_pass_by_value)]
struct WriteFileInput {
    path: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[allow(clippy::needless_pass_by_value)]
struct EditFileInput {
    path: String,
    old_string: String,
    new_string: String,
    replace_all: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[allow(clippy::needless_pass_by_value)]
struct GlobSearchInputValue {
    pattern: String,
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(clippy::needless_pass_by_value)]
struct ReadImageInput {
    path: String,
}

#[derive(Debug, Deserialize)]
#[allow(clippy::needless_pass_by_value)]
struct TaskInput {
    tasks: Vec<TaskSpecInput>,
}

#[derive(Debug, Deserialize)]
#[allow(clippy::needless_pass_by_value)]
struct TaskSpecInput {
    description: String,
    prompt: String,
}

#[cfg(test)]
mod tests {
    use super::{execute_tool, mvp_tool_specs};
    use serde_json::json;

    #[test]
    fn exposes_mvp_tools() {
        let names = mvp_tool_specs()
            .into_iter()
            .map(|spec| spec.name)
            .collect::<Vec<_>>();
        assert!(names.contains(&"bash"));
        assert!(names.contains(&"read_file"));
    }

    #[test]
    fn rejects_unknown_tool_names() {
        let error = execute_tool("nope", &json!({})).expect_err("tool should be rejected");
        assert!(error.contains("unsupported tool"));
    }
}
