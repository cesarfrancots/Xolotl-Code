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

const PREVIEW_WORLD = buildPreviewCivWorld();
const PREVIEW_HOME_X = PREVIEW_WORLD.homeCx;
const PREVIEW_HOME_FLOOR = PREVIEW_WORLD.floor[PREVIEW_HOME_X];

let previewCivSession = {
  id: "preview-civ-pond",
  name: "Preview Pond",
  model: "kimi-coding",
  seed: 4242,
  created_at: 1_780_020_000,
  updated_at: 1_780_020_000,
  turn: 3,
  world: {
    width: PREVIEW_WORLD.width,
    height: PREVIEW_WORLD.height,
    tiles: PREVIEW_WORLD.tiles,
    regions: PREVIEW_WORLD.regions,
    entities: [
      ...["leucistic", "wild", "gold", "axanthic", "copper", "blue", "melanoid", "albino"].map((morph, index) => ({
        id: `axo-${index + 1}`,
        kind: "axolotl",
        name: `Axolotl ${index + 1}`,
        x: PREVIEW_HOME_X - 8 + (index % 8) * 2,
        y: 12 + (index % 4),
        health: 82,
        mood: 78,
        role: index === 7 ? "elder" : "worker",
        morph,
        stage: index === 7 ? "elder" : "adult",
        sex: index % 2 === 0 ? "f" : "m",
        age: index === 7 ? 27 : 10 + index,
        size: index === 7 ? 1.06 : 1,
        accessories: index === 0 ? ["flowercrown"] : index === 2 ? ["strawhat"] : index === 4 ? ["snorkel"] : [],
        genes: { allele_a: morph, allele_b: "wild", size_gene: 1, fertility: 0.8, longevity: 1, vigor: 1 },
        hatches_in: null,
        parents: [],
        activity: index === 1 ? "gather" : index === 3 ? "play" : index === 7 ? "rest" : "",
      })),
      {
        id: "egg-preview-1", kind: "egg", name: "Egg", x: PREVIEW_HOME_X - 6, y: PREVIEW_HOME_FLOOR - 3, health: 100, mood: 100, role: "egg",
        morph: "mystic", stage: "egg", sex: "", age: 0, size: 0.5, accessories: [],
        genes: { allele_a: "mystic", allele_b: "wild", size_gene: 1, fertility: 0.8, longevity: 1, vigor: 1 },
        hatches_in: 2, parents: ["axo-1", "axo-2"],
      },
      { id: "pond-heart", kind: "building", name: "Pond Heart", x: PREVIEW_HOME_X, y: PREVIEW_HOME_FLOOR - 2, health: 100, mood: 100, role: "pond" },
      { id: "nest-1", kind: "building", name: "Reed Nest", x: PREVIEW_HOME_X - 6, y: PREVIEW_WORLD.floor[PREVIEW_HOME_X - 6] - 1, health: 100, mood: 100, role: "nest" },
    ],
  },
  civilization: {
    era: "pond_camp",
    population: 8,
    health: 82,
    morale: 78,
    resources: {
      food: 45,
      clean_water: 40,
      wood: 18,
      stone: 11,
      clay: 8,
      fiber: 12,
      tools: 2,
      glowshards: 1,
    },
    techs: ["forage", "basic_shelter"],
    policies: ["share_equally"],
    score: { survival: 74, ethics: 78, intelligence: 31, total: 64.1 },
  },
  modifiers: [
    { id: "clear-water-preview", kind: "clear_water", label: "Clear Water", polarity: "buff", remaining_turns: 2, intensity: 1 },
  ],
  log: [
    { turn: 1, kind: "ai_decision", title: "AI intent: stabilize food and water", body: "The colony gathered moss and cleaned the pond edge.", created_at: 1_780_020_010 },
    { turn: 2, kind: "action", title: "Policy adopted", body: "The colony adopted share_equally.", created_at: 1_780_020_020 },
    { turn: 3, kind: "intervention", title: "Modifier applied", body: "Observer applied Clear Water for 2 turns.", created_at: 1_780_020_030 },
  ],
};

type PreviewTile = { x: number; y: number; terrain: string; resource: string | null; amount: number; biome: string };

// A compact JS mirror of the Rust procedural biome world, so the browser preview
// matches the shipped 128x72 multi-biome continent (regions, biomes, seabed).
function buildPreviewCivWorld() {
  const W = 128;
  const H = 72;
  const SURF = 6;
  const BASE = 50;
  const DEEP = 34;
  const biomes = [
    { id: "shallows", name: "Sunlit Shallows", off: -10, deep: false, top: "sand", mid: "sand", low: "earth", res: ["moss", "fiber"] },
    { id: "kelpforest", name: "Kelp Forest", off: -6, deep: false, top: "moss", mid: "moss", low: "earth", res: ["wood", "fiber", "moss"] },
    { id: "mudflats", name: "Mud Flats", off: 0, deep: false, top: "mud", mid: "earth", low: "stone", res: ["clay", "clay", "fiber"] },
    { id: "reedmarsh", name: "Reed Marsh", off: -4, deep: false, top: "moss", mid: "mud", low: "earth", res: ["moss", "wood", "fiber"] },
    { id: "openwater", name: "Open Water", off: 4, deep: false, top: "sand", mid: "earth", low: "stone", res: ["stone"] },
    { id: "crystalcave", name: "Crystal Caverns", off: 8, deep: true, top: "crystal", mid: "stone", low: "crystal", res: ["glowshards", "glowshards", "stone"] },
    { id: "deeptrench", name: "Deep Trench", off: 16, deep: true, top: "stone", mid: "stone", low: "stone", res: ["glowshards", "stone"] },
    { id: "thermalvent", name: "Thermal Vents", off: 10, deep: true, top: "stone", mid: "earth", low: "stone", res: ["stone", "glowshards", "clay"] },
  ];
  const HOME = 3; // reedmarsh band, roughly centred
  const bandW = W / biomes.length;
  const colBiome: number[] = [];
  for (let x = 0; x < W; x += 1) colBiome[x] = Math.min(biomes.length - 1, Math.floor(x / bandW));
  const floor: number[] = [];
  for (let x = 0; x < W; x += 1) {
    const b = biomes[colBiome[x]];
    const ripple = Math.round(Math.sin(x * 0.16) * 2.6 + Math.sin(x * 0.06) * 1.6);
    floor[x] = Math.max(SURF + 16, Math.min(H - 4, BASE + b.off + ripple));
  }
  const tiles: PreviewTile[] = [];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const b = biomes[colBiome[x]];
      const fl = floor[x];
      let terrain = "air";
      let biome = "";
      if (y < SURF) {
        terrain = "air";
      } else if (y < fl) {
        const deepZone = b.deep && y >= SURF + (fl - SURF) / 3;
        const nearFloor = y + 5 >= fl;
        terrain = y >= DEEP && (deepZone || nearFloor) ? "deepwater" : "water";
        biome = b.id;
      } else {
        const d = y - fl;
        terrain = d < 2 ? b.top : d < 6 ? b.mid : b.low;
        biome = b.id;
      }
      tiles.push({ x, y, terrain, resource: null, amount: 0, biome });
    }
  }
  const place = (res: string, x: number, fy: number, amt: number) => {
    for (let dy = 0; dy < 2; dy += 1) {
      for (let dx = 0; dx < 3; dx += 1) {
        const t = tiles[(fy + dy) * W + (x + dx)];
        if (t && t.terrain !== "air" && t.terrain !== "water" && t.terrain !== "deepwater") {
          t.resource = res;
          t.amount = amt;
        }
      }
    }
  };
  biomes.forEach((b, bi) => {
    const sx = Math.floor(bi * bandW);
    for (let p = 0; p < 2; p += 1) {
      const rx = sx + 3 + p * 7;
      if (rx > 1 && rx < W - 2) place(b.res[p % b.res.length], rx - 1, floor[rx], 8 + p * 3);
    }
  });
  const regions = biomes.map((b, bi) => ({
    id: `region-${Math.floor(bi * bandW)}`,
    name: b.name,
    biome: b.id,
    x: Math.floor(bi * bandW),
    y: SURF,
    width: Math.round(bandW),
    height: H - SURF,
    owner: null as string | null,
  }));
  return { width: W, height: H, tiles, regions, floor, homeCx: Math.floor(HOME * bandW + bandW / 2) };
}

function previewCivMeta() {
  return [{
    id: previewCivSession.id,
    name: previewCivSession.name,
    model: previewCivSession.model,
    created_at: previewCivSession.created_at,
    updated_at: previewCivSession.updated_at,
    turn: previewCivSession.turn,
    score: previewCivSession.civilization.score.total,
  }];
}

function advancePreviewCiv() {
  previewCivSession = {
    ...previewCivSession,
    turn: previewCivSession.turn + 1,
    updated_at: previewCivSession.updated_at + 10,
    civilization: {
      ...previewCivSession.civilization,
      resources: {
        ...previewCivSession.civilization.resources,
        food: Math.max(0, previewCivSession.civilization.resources.food + 5 - previewCivSession.civilization.population),
        clean_water: Math.max(0, previewCivSession.civilization.resources.clean_water + 4 - previewCivSession.civilization.population),
        wood: previewCivSession.civilization.resources.wood + 3,
      },
      score: {
        survival: 76,
        ethics: 80,
        intelligence: 34 + previewCivSession.turn,
        total: 66 + previewCivSession.turn * 0.4,
      },
    },
    modifiers: previewCivSession.modifiers
      .map((modifier) => ({ ...modifier, remaining_turns: Math.max(0, modifier.remaining_turns - 1) }))
      .filter((modifier) => modifier.remaining_turns > 0),
    log: [
      ...previewCivSession.log,
      {
        turn: previewCivSession.turn + 1,
        kind: "ai_decision",
        title: "AI intent: reinforce basics",
        body: "The preview model gathered food and kept water reserves stable.",
        created_at: previewCivSession.updated_at + 10,
      },
    ].slice(-80),
  };
}

function applyPreviewCivIntervention(args?: unknown) {
  const intervention = isRecord(args) && isRecord(args.intervention) ? args.intervention : {};
  const target = typeof intervention.target === "string" ? intervention.target : "food";
  const amount = typeof intervention.amount === "number" ? intervention.amount : 10;
  const kind = typeof intervention.kind === "string" ? intervention.kind : "grant_resource";
  const resources = { ...previewCivSession.civilization.resources };
  const resourceKey = target as keyof typeof resources;
  if (kind === "grant_resource") resources[resourceKey] = (resources[resourceKey] ?? 0) + amount;
  if (kind === "remove_resource") resources[resourceKey] = Math.max(0, (resources[resourceKey] ?? 0) - amount);
  const modifierKinds = ["apply_buff", "apply_debuff", "trigger_event"];
  previewCivSession = {
    ...previewCivSession,
    updated_at: previewCivSession.updated_at + 5,
    civilization: { ...previewCivSession.civilization, resources },
    modifiers: modifierKinds.includes(kind)
      ? [
          ...previewCivSession.modifiers,
          {
            id: `${target}-preview-${previewCivSession.updated_at}`,
            kind: target,
            label: target.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            polarity: target.includes("drought") || target.includes("rot") || target.includes("fatigue") ? "debuff" : "buff",
            remaining_turns: 4,
            intensity: 1,
          },
        ]
      : previewCivSession.modifiers,
    log: [
      ...previewCivSession.log,
      {
        turn: previewCivSession.turn,
        kind: "intervention",
        title: "Observer intervention",
        body: `${kind} ${target}`,
        created_at: previewCivSession.updated_at + 5,
      },
    ].slice(-80),
  };
}

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
    case "list_projects":
    case "add_project":
    case "remove_project":
      return [];
    case "list_civ_sessions":
      return previewCivMeta();
    case "browse_directory":
      return { path: "", parent: null, children: [] };
    case "pick_directory":
      return null;
    case "load_eval": {
      const id = isRecord(args) && typeof args.id === "string" ? args.id : undefined;
      const evalResult = PREVIEW_EVALS.find((item) => item.id === id);
      if (!evalResult) throw "Preview eval not found";
      return JSON.stringify(evalResult);
    }
    case "load_civ_session":
      return JSON.stringify(previewCivSession);
    case "create_civ_session": {
      const config = isRecord(args) && isRecord(args.config) ? args.config : {};
      previewCivSession = {
        ...previewCivSession,
        id: `preview-civ-${Date.now()}`,
        name: typeof config.name === "string" && config.name.trim() ? config.name.trim() : "Axolotl Colony",
        model: typeof config.model === "string" ? config.model : "kimi-coding",
        turn: 0,
        updated_at: Math.floor(Date.now() / 1000),
        created_at: Math.floor(Date.now() / 1000),
      };
      return previewCivSession.id;
    }
    case "advance_civ_turn":
      advancePreviewCiv();
      return JSON.stringify(previewCivSession);
    case "apply_civ_intervention":
      applyPreviewCivIntervention(args);
      return JSON.stringify(previewCivSession);
    case "delete_civ_session":
      return null;
    case "get_api_key_status":
      return Object.fromEntries(PREVIEW_PROVIDERS.map((provider) => [provider, false]));
    case "load_session":
    case "save_session":
    case "delete_session":
    case "delete_eval":
    case "save_manual_reviews":
    case "touch_project":
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
