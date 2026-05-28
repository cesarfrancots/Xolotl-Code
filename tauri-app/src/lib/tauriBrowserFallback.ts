import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke?: unknown;
    };
    __XOLOTL_BROWSER_PREVIEW__?: boolean;
  }
}

const PREVIEW_MODELS = [
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-6",
  "kimi2.6",
  "kimi-coding",
  "minimax2.7",
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "glm5.1",
  "qwen3.6",
];

const PREVIEW_PROVIDERS = [
  "anthropic",
  "bedrock",
  "kimi",
  "kimi_coding",
  "minimax",
  "deepseek",
];

const PREVIEW_SUITES = [
  {
    id: "reasoning",
    name: "Reasoning",
    description: "Short prompts for comparing goal decomposition, assumptions, and verification discipline.",
    prompts: [
      {
        id: "repo-plan",
        prompt: "Plan a focused UI refactor for a desktop coding workbench without changing core behavior.",
        grader: "free",
      },
      {
        id: "bug-triage",
        prompt: "Given a failing UI smoke test, identify likely causes and propose the first verification step.",
        grader: "code",
      },
    ],
  },
  {
    id: "swe-pro",
    name: "SWE-Pro Style",
    description: "Repository-scale bug fixing, patch discipline, and regression thinking.",
    prompts: [
      {
        id: "sp1",
        prompt: "Patch this TypeScript TTL cache. `put` receives ttlSeconds, but the implementation stores `Date.now() + ttlSeconds`; expired entries should also be deleted when read.",
        grader: "code",
      },
    ],
  },
  {
    id: "frontend-design",
    name: "Frontend + Design Human Benchmark",
    description: "Blind human review for UI craft, hierarchy, responsiveness, and visual polish.",
    prompts: [
      {
        id: "fd1",
        prompt: "Create a single-file HTML/CSS/JS benchmark leaderboard for axolotl-themed model rankings.",
        grader: "visual",
      },
    ],
  },
  {
    id: "product-review",
    name: "Product Review",
    description: "Goal-oriented review prompts for polish, blind scoring, and production readiness.",
    prompts: [
      {
        id: "blind-eval-flow",
        prompt: "Evaluate whether a blind model review flow keeps human scoring objective before reveal.",
        grader: "free",
      },
    ],
  },
];

const previewHumanScores = (score: number, overrides: Record<string, number> = {}) => ({
  accuracy: score,
  helpfulness: score,
  quality: score,
  creativity: score,
  design: score,
  aesthetics: score,
  ai_slop: score,
  brevity: score,
  ...overrides,
});

const PREVIEW_EVALS = [
  {
    id: "preview-swe-ttl",
    prompt: "Patch this TypeScript TTL cache. `put` receives ttlSeconds, but the implementation stores `Date.now() + ttlSeconds`; expired entries should also be deleted when read.",
    models: ["kimi-coding", "claude-sonnet-4-6", "deepseek-v4-pro"],
    results: [
      {
        model: "kimi-coding",
        content: "cache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });\nif (hit.expiresAt <= Date.now()) { cache.delete(key); return null; }",
        input_tokens: 820,
        output_tokens: 420,
        duration_ms: 3400,
        error: null,
      },
      {
        model: "claude-sonnet-4-6",
        content: "cache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });\nif (hit.expiresAt < Date.now()) return null;",
        input_tokens: 900,
        output_tokens: 510,
        duration_ms: 4100,
        error: null,
      },
      {
        model: "deepseek-v4-pro",
        content: "cache.set(key, { value, expiresAt: Date.now() + ttlSeconds });\nif (hit.expiresAt < Date.now()) return null;",
        input_tokens: 760,
        output_tokens: 260,
        duration_ms: 2400,
        error: null,
      },
    ],
    human_scores: {},
    manual_reviews: {},
    auto_scores: {},
    judge: null,
    reasoning_traces: {},
    goal_grades: {},
    is_goal_eval: false,
    goal: null,
    suite_id: "swe-pro",
    suite_run_id: "preview-suite",
    suite_prompt_id: "sp1",
    created_at: 1_780_000_000,
  },
  {
    id: "preview-design-board",
    prompt: "Create a single-file HTML/CSS/JS benchmark leaderboard for axolotl-themed model rankings.",
    models: ["kimi-coding", "claude-sonnet-4-6", "minimax2.7"],
    results: [
      {
        model: "kimi-coding",
        content: "```html\n<section class=\"leaderboard\">Axolotl rankings with responsive rows.</section>\n```",
        input_tokens: 700,
        output_tokens: 980,
        duration_ms: 5200,
        error: null,
      },
      {
        model: "claude-sonnet-4-6",
        content: "```html\n<main class=\"board\">Minimal champion view, filters, and score bars.</main>\n```",
        input_tokens: 760,
        output_tokens: 1040,
        duration_ms: 6100,
        error: null,
      },
      {
        model: "minimax2.7",
        content: "```html\n<div class=\"dashboard\">Compact benchmark cards and visual preview.</div>\n```",
        input_tokens: 720,
        output_tokens: 880,
        duration_ms: 3900,
        error: null,
      },
    ],
    human_scores: {
      "kimi-coding": previewHumanScores(8, { design: 9, aesthetics: 8.5, creativity: 8 }),
      "claude-sonnet-4-6": previewHumanScores(8.5, { design: 8.5, aesthetics: 9, creativity: 8 }),
      "minimax2.7": previewHumanScores(7, { design: 7, aesthetics: 7.5, creativity: 8.5 }),
    },
    manual_reviews: {},
    auto_scores: {},
    judge: null,
    reasoning_traces: {},
    goal_grades: {},
    is_goal_eval: false,
    goal: null,
    suite_id: "frontend-design",
    suite_run_id: "preview-design",
    suite_prompt_id: "fd1",
    created_at: 1_780_010_000,
  },
];

function installTauriBrowserFallback() {
  if (!import.meta.env.DEV) return;
  if (typeof window === "undefined") return;
  if (window.__TAURI_INTERNALS__?.invoke) return;

  window.__XOLOTL_BROWSER_PREVIEW__ = true;
  mockWindows("main");
  mockIPC(handlePreviewCommand, { shouldMockEvents: true });
}

function handlePreviewCommand(cmd: string, args?: unknown): unknown {
  switch (cmd) {
    case "smoke_test":
      return "ok";
    case "list_models":
      return PREVIEW_MODELS;
    case "list_eval_suites":
      return PREVIEW_SUITES;
    case "list_evals":
      return PREVIEW_EVALS.map((evalResult) => ({
        id: evalResult.id,
        prompt: evalResult.prompt,
        models: evalResult.models,
        created_at: evalResult.created_at,
        manual_review_count: Object.keys(evalResult.manual_reviews).length,
        suite_id: evalResult.suite_id,
        suite_run_id: evalResult.suite_run_id,
      }));
    case "list_agents":
    case "list_sessions":
    case "list_skills":
    case "list_mcp_servers":
    case "list_prompt_commands":
      return [];
    case "load_eval": {
      const id = isRecord(args) && typeof args.id === "string" ? args.id : undefined;
      const evalResult = PREVIEW_EVALS.find((item) => item.id === id);
      if (!evalResult) throw "Preview eval not found";
      return JSON.stringify(evalResult);
    }
    case "get_api_key_status":
      return Object.fromEntries(PREVIEW_PROVIDERS.map((provider) => [provider, false]));
    case "load_session":
    case "save_session":
    case "delete_session":
    case "delete_eval":
    case "save_manual_reviews":
      return null;
    case "cleanup_eval_processes":
      return 0;
    case "cancel_chat_turn":
      return true;
    case "start_eval_artifact":
      return {
        artifact_dir: "preview://eval-artifacts",
        entry_path: "preview://eval-artifacts/index.html",
        message: "Preview artifact prepared",
      };
    default:
      throw `Preview mode does not run Tauri command: ${cmd}`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

installTauriBrowserFallback();
