import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { EGG_INCUBATE_FOOD_COST, EGG_INCUBATE_PEARL_COST } from "./civCreatureProgression";

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
const PREVIEW_RESCUE_X = PREVIEW_WORLD.rescueX;
const PREVIEW_RESCUE_Y = PREVIEW_WORLD.rescueY;
const PREVIEW_BRIDGE_X = PREVIEW_WORLD.bridgeX;
const PREVIEW_BRIDGE_Y = PREVIEW_WORLD.bridgeY;

const DEFAULT_PREVIEW_CIV_SESSION = {
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
        role: index === 7 ? "elder" : index === 6 ? "scout" : index === 1 ? "builder" : "worker",
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
      { id: "breach-1", kind: "object", name: "Nest Breach", x: PREVIEW_HOME_X - 3, y: PREVIEW_WORLD.floor[PREVIEW_HOME_X - 3] - 1, health: 35, mood: 0, role: "breach", activity: "needs_repair" },
      { id: "leak-1", kind: "object", name: "Nest Leak", x: PREVIEW_HOME_X - 2, y: PREVIEW_WORLD.floor[PREVIEW_HOME_X - 3] - 1, health: 62, mood: 0, role: "leak", activity: "active" },
      { id: "trapped-1", kind: "object", name: "Trapped Juvenile", x: PREVIEW_RESCUE_X, y: PREVIEW_RESCUE_Y, health: 45, mood: 12, role: "trapped", activity: "blocked" },
      { id: "oxygen-1", kind: "object", name: "Low Oxygen Pocket", x: Math.max(1, PREVIEW_RESCUE_X - 1), y: PREVIEW_RESCUE_Y, health: 70, mood: 0, role: "oxygen", activity: "active" },
      { id: "bridge-1", kind: "object", name: "Bridge Gap", x: PREVIEW_BRIDGE_X, y: PREVIEW_BRIDGE_Y, health: 35, mood: 0, role: "bridge", activity: "open" },
      { id: "seep-1", kind: "object", name: "Silt Vent", x: Math.min(PREVIEW_WORLD.width - 2, PREVIEW_BRIDGE_X + 2), y: PREVIEW_BRIDGE_Y, health: 70, mood: 0, role: "seep", activity: "active" },
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
      pearls: 6,
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

const PREVIEW_CIV_STORAGE_KEY = "xolotl-preview-civ-session-v1";
const CIV_BROWSER_PREVIEW_SNAPSHOT_KEY = "xolotl-preview-civ-store-snapshot-v1";
const PREVIEW_CIV_STORAGE_VERSION = 1;
const PREVIEW_SHOP_BUILDING_INITIAL_HEALTH = 45;
const PREVIEW_SHOP_BUILDING_PROGRESS_PER_TURN = 30;
type PreviewCivSession = typeof DEFAULT_PREVIEW_CIV_SESSION & { civs?: Record<string, unknown>[] };

let previewCivSession: PreviewCivSession = loadPreviewCivSession();

function clonePreviewCivSession(session: PreviewCivSession = DEFAULT_PREVIEW_CIV_SESSION): PreviewCivSession {
  return JSON.parse(JSON.stringify(session)) as PreviewCivSession;
}

function syncPreviewPrimaryCiv(session: PreviewCivSession): PreviewCivSession {
  if (!Array.isArray(session.civs) || !isRecord(session.civs[0])) return session;
  const primary = session.civs[0];
  return {
    ...session,
    civs: [
      {
        ...primary,
        name: typeof primary.name === "string" ? primary.name : session.name,
        model: typeof primary.model === "string" ? primary.model : session.model,
        era: session.civilization.era,
        population: session.civilization.population,
        health: session.civilization.health,
        morale: session.civilization.morale,
        resources: session.civilization.resources,
        techs: session.civilization.techs,
        policies: session.civilization.policies,
        score: session.civilization.score,
      },
      ...session.civs.slice(1),
    ],
  };
}

function loadPreviewCivSession(): PreviewCivSession {
  const storage = previewBrowserStorage();
  if (!storage) return clonePreviewCivSession();
  try {
    const raw = storage.getItem(PREVIEW_CIV_STORAGE_KEY);
    if (!raw) return clonePreviewCivSession();
    const parsed = JSON.parse(raw);
    const session = isRecord(parsed) && parsed.version === PREVIEW_CIV_STORAGE_VERSION ? parsed.session : null;
    if (!isRecord(session) || typeof session.id !== "string" || !isRecord(session.world)) {
      return clonePreviewCivSession();
    }
    return session as PreviewCivSession;
  } catch {
    return clonePreviewCivSession();
  }
}

function persistPreviewCivSession() {
  const storage = previewBrowserStorage();
  if (!storage) return;
  try {
    previewCivSession = syncPreviewPrimaryCiv(previewCivSession);
    storage.setItem(PREVIEW_CIV_STORAGE_KEY, JSON.stringify({
      version: PREVIEW_CIV_STORAGE_VERSION,
      session: previewCivSession,
    }));
    storage.setItem(CIV_BROWSER_PREVIEW_SNAPSHOT_KEY, JSON.stringify(previewCivSession));
  } catch {
    // Browser preview persistence is best-effort; the real Tauri backend still owns durable saves.
  }
}

function resetPreviewCivSession() {
  previewCivSession = clonePreviewCivSession();
  const storage = previewBrowserStorage();
  if (!storage) return;
  try {
    storage.removeItem(PREVIEW_CIV_STORAGE_KEY);
    storage.removeItem(CIV_BROWSER_PREVIEW_SNAPSHOT_KEY);
  } catch {
    // Non-fatal in private browsing or restricted preview contexts.
  }
}

function hydratePreviewCivSessionFromStore() {
  const storage = previewBrowserStorage();
  if (!storage) return;
  try {
    const raw = storage.getItem(CIV_BROWSER_PREVIEW_SNAPSHOT_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.id !== "string" || !isRecord(parsed.world)) return;
    const updatedAt = typeof parsed.updated_at === "number" && Number.isFinite(parsed.updated_at) ? parsed.updated_at : 0;
    if (parsed.id !== previewCivSession.id || updatedAt < previewCivSession.updated_at) return;
    const civInput = Array.isArray(parsed.civs) && isRecord(parsed.civs[0])
      ? parsed.civs[0]
      : isRecord(parsed.civilization)
        ? parsed.civilization
        : null;
    const model = typeof parsed.model === "string"
      ? parsed.model
      : civInput && typeof civInput.model === "string"
        ? civInput.model
        : previewCivSession.model;
    previewCivSession = {
      ...previewCivSession,
      ...parsed,
      model,
      civilization: {
        ...previewCivSession.civilization,
        ...(civInput ?? {}),
      },
      modifiers: Array.isArray(parsed.modifiers) ? parsed.modifiers : previewCivSession.modifiers,
      log: Array.isArray(parsed.log) ? parsed.log : previewCivSession.log,
    } as PreviewCivSession;
  } catch {
    // A corrupt preview store should fall back to the seeded browser session.
  }
}

function previewBrowserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

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
  const homeCx = Math.floor(HOME * bandW + bandW / 2);
  const breachX = homeCx - 3;
  place("fiber", breachX - 1, floor[breachX], 8);
  const rescueX = Math.min(W - 2, homeCx + 8);
  const rescueY = Math.max(SURF + 2, floor[rescueX] - 2);
  for (const rubble of previewRescueRubbleTiles(rescueX, rescueY)) {
    const t = tiles[rubble.y * W + rubble.x];
    if (t && !previewIsSubstrate(t.terrain)) {
      t.terrain = "stone";
      t.resource = null;
      t.amount = 0;
    }
  }
  const bridgeX = Math.min(W - 3, homeCx + 14);
  const bridgeY = Math.max(SURF + 2, floor[bridgeX] - 1);
  for (const bridge of previewBridgeTiles(bridgeX, bridgeY)) {
    const t = tiles[bridge.y * W + bridge.x];
    if (t) {
      t.terrain = bridge.y >= DEEP ? "deepwater" : "water";
      t.resource = null;
      t.amount = 0;
    }
  }
  place("glowshards", Math.min(W - 3, bridgeX + 3), floor[Math.min(W - 3, bridgeX + 3)], 5);
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
  return { width: W, height: H, tiles, regions, floor, homeCx, rescueX, rescueY, bridgeX, bridgeY };
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

function advancePreviewEggLifecycle(nextTurn: number, createdAt: number) {
  let hatched = 0;
  for (const entity of previewCivSession.world.entities) {
    if (entity.kind !== "egg" && entity.stage !== "egg") continue;
    const remaining = typeof entity.hatches_in === "number" && Number.isFinite(entity.hatches_in)
      ? Math.max(0, Math.floor(entity.hatches_in))
      : 0;
    if (remaining > 1) {
      entity.hatches_in = remaining - 1;
      continue;
    }
    const genes = entity.genes ?? { allele_a: entity.morph ?? "leucistic", allele_b: "wild", size_gene: 1, fertility: 0.8, longevity: 1, vigor: 1 };
    const suffix = entity.id.match(/\d+$/)?.[0] ?? entity.id.slice(-3);
    entity.kind = "axolotl";
    entity.name = `Hatchling ${suffix}`;
    entity.role = "juvenile";
    entity.stage = "hatchling";
    entity.sex = nextTurn % 2 === 0 ? "f" : "m";
    entity.age = 0;
    entity.size = 0.5;
    entity.morph = typeof genes.allele_a === "string" ? genes.allele_a : (entity.morph ?? "leucistic");
    const patterned = entity as typeof entity & { pattern?: string | null };
    patterned.pattern = patterned.pattern ?? "plain";
    entity.hatches_in = null;
    entity.activity = "hatch";
    entity.genes = genes;
    hatched += 1;
  }
  if (hatched === 0) return [];
  return [{
    turn: nextTurn,
    kind: "lifecycle",
    title: "Eggs hatched",
    body: `${hatched} egg(s) hatched into wriggling hatchlings.`,
    created_at: createdAt,
  }];
}

function previewLivingPopulation() {
  return previewCivSession.world.entities.filter((entity) => (
    entity.kind === "axolotl" && entity.stage !== "egg"
  )).length;
}

function assignPreviewBuilders(x: number, y: number) {
  let assigned = 0;
  for (const entity of previewCivSession.world.entities) {
    if (assigned >= 2) break;
    if (entity.kind !== "axolotl" || entity.stage === "egg") continue;
    const directed = entity as typeof entity & { activity?: string; target_x?: number; target_y?: number };
    directed.activity = "build";
    directed.target_x = x;
    directed.target_y = y;
    assigned += 1;
  }
}

function advancePreviewAxolotlLifecycle() {
  for (const entity of previewCivSession.world.entities) {
    if (entity.kind !== "axolotl" || entity.stage === "egg") continue;
    entity.age = Math.max(0, Math.floor(entity.age ?? 0) + 1);
    if (entity.age < 3) {
      entity.stage = "hatchling";
      entity.role = "juvenile";
      entity.size = 0.5;
    } else if (entity.age < 7) {
      entity.stage = "juvenile";
      entity.role = "juvenile";
      entity.size = 0.72;
    } else {
      entity.stage = "adult";
      entity.role = entity.role === "elder" ? "elder" : "worker";
      entity.size = 1;
    }
    if (entity.activity === "fed") entity.activity = "";
    if (!entity.activity) {
      entity.activity = entity.stage === "hatchling" || entity.stage === "juvenile"
        ? "play"
        : entity.stage === "elder"
          ? "rest"
          : "";
    }
  }
}

function advancePreviewConstruction(nextTurn: number, createdAt: number) {
  const logs: typeof previewCivSession.log = [];
  const activeSites: Array<{ x: number; y: number }> = [];
  for (const entity of previewCivSession.world.entities) {
    if (entity.kind !== "building" || entity.activity !== "construction") continue;
    entity.health = Math.min(100, entity.health + PREVIEW_SHOP_BUILDING_PROGRESS_PER_TURN);
    if (entity.health >= 95) {
      entity.health = 100;
      entity.activity = "built";
      logs.push({
        turn: nextTurn,
        kind: "construction",
        title: "Construction complete",
        body: `${entity.name} is ready.`,
        created_at: createdAt + logs.length,
      });
    } else {
      activeSites.push({ x: entity.x, y: entity.y });
    }
  }
  for (const site of activeSites) assignPreviewBuilders(site.x, site.y);
  return logs;
}

function advancePreviewCiv() {
  const nextTurn = previewCivSession.turn + 1;
  const nextUpdatedAt = previewCivSession.updated_at + 10;
  advancePreviewAxolotlLifecycle();
  const lifecycleLog = advancePreviewEggLifecycle(nextTurn, nextUpdatedAt + 1);
  const constructionLog = advancePreviewConstruction(nextTurn, nextUpdatedAt + 2);
  const population = previewLivingPopulation();
  previewCivSession = {
    ...previewCivSession,
    turn: nextTurn,
    updated_at: nextUpdatedAt,
    civilization: {
      ...previewCivSession.civilization,
      population,
      resources: {
        ...previewCivSession.civilization.resources,
        food: Math.max(0, previewCivSession.civilization.resources.food + 5 - population),
        clean_water: Math.max(0, previewCivSession.civilization.resources.clean_water + 4 - population),
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
        turn: nextTurn,
        kind: "ai_decision",
        title: "AI intent: reinforce basics",
        body: "The preview model gathered food and kept water reserves stable.",
        created_at: nextUpdatedAt,
      },
      ...lifecycleLog,
      ...constructionLog,
    ].slice(-80),
  };
  persistPreviewCivSession();
}

function previewPlayerTargetUsedThisTurn(title: string, targetId: string) {
  const marker = `target=${targetId}`;
  return previewCivSession.log.some(
    (entry) =>
      entry.turn === previewCivSession.turn &&
      entry.kind === "player" &&
      entry.title === title &&
      entry.body.includes(marker),
  );
}

function previewMarker(body: string, key: string) {
  const match = body.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`));
  return match?.[1]?.trim() ?? "";
}

function previewNumberMarker(body: string, key: string, fallback: number) {
  const value = Number.parseInt(previewMarker(body, key), 10);
  return Number.isFinite(value) ? value : fallback;
}

function previewTaskSourceResource(resource: string) {
  return resource === "food" ? "moss" : resource;
}

function previewRescueRubbleTiles(x: number, y: number) {
  const shaftX = Math.max(0, x - 1);
  const shaftTop = Math.max(7, y - 3);
  const tiles = [];
  for (let tileY = shaftTop; tileY <= y; tileY += 1) {
    tiles.push({ x: shaftX, y: tileY });
  }
  tiles.push({ x, y: y + 1 });
  return tiles;
}

function previewRescueRubbleRemaining(objectId: string) {
  const object = previewCivSession.world.entities.find((item) => item.id === objectId);
  if (!object) return 1;
  if ((object as { activity?: string }).activity === "rescued") return 0;
  return previewRescueRubbleTiles(object.x, object.y).filter((rubble) => (
    previewCivSession.world.tiles.some((tile) => tile.x === rubble.x && tile.y === rubble.y && previewIsSubstrate(tile.terrain))
  )).length;
}

function previewBridgeTiles(x: number, y: number) {
  return [
    { x: Math.max(0, x - 1), y: y + 1 },
    { x, y: y + 1 },
    { x: x + 1, y: y + 1 },
  ];
}

function previewBridgeTilesRemaining(objectId: string) {
  const object = previewCivSession.world.entities.find((item) => item.id === objectId);
  if (!object) return 1;
  if ((object as { activity?: string }).activity === "built") return 0;
  return previewBridgeTiles(object.x, object.y).filter((bridge) => (
    previewCivSession.world.tiles.some((tile) => tile.x === bridge.x && tile.y === bridge.y && !previewIsSubstrate(tile.terrain))
  )).length;
}

function previewSetNpcCelebrationTarget(npcId: string, x: number, y: number, moodBoost: number) {
  const npc = previewCivSession.world.entities.find((item) => item.id === npcId && item.kind === "axolotl");
  if (!npc) return null;
  npc.mood = Math.min(100, (npc.mood ?? 0) + moodBoost);
  const directed = npc as { activity?: string; target_x?: number; target_y?: number };
  directed.activity = "celebrate";
  directed.target_x = x;
  directed.target_y = y;
  return npc;
}

function previewSpawnRescuedJuvenile(object: { id: string; x: number; y: number }) {
  const id = `rescued-${object.id}`;
  if (previewCivSession.world.entities.some((item) => item.id === id)) return false;
  previewCivSession.world.entities.push({
    id,
    kind: "axolotl",
    name: "Rescued Juvenile",
    x: Math.min(previewCivSession.world.width - 1, object.x + 1),
    y: Math.max(0, Math.min(previewCivSession.world.height - 1, object.y)),
    health: 100,
    mood: 96,
    role: "juvenile",
    morph: "leucistic",
    stage: "juvenile",
    sex: "f",
    age: 4,
    size: 0.72,
    accessories: [],
    genes: { allele_a: "leucistic", allele_b: "leucistic", size_gene: 1, fertility: 0.7, longevity: 1, vigor: 1 },
    hatches_in: null,
    parents: [],
    activity: "rescued",
  } as (typeof previewCivSession.world.entities)[number]);
  return true;
}

function previewSealNearbySeeps(x: number, y: number) {
  for (const entity of previewCivSession.world.entities) {
    if (entity.kind !== "object" || entity.role !== "seep") continue;
    if (Math.abs(entity.x - x) > 4 || Math.abs(entity.y - y) > 3) continue;
    entity.health = 100;
    (entity as { activity?: string }).activity = "sealed";
  }
}

function previewSealNearbyLeaks(x: number, y: number) {
  for (const entity of previewCivSession.world.entities) {
    if (entity.kind !== "object" || entity.role !== "leak") continue;
    if (Math.abs(entity.x - x) > 3 || Math.abs(entity.y - y) > 3) continue;
    entity.health = 100;
    (entity as { activity?: string }).activity = "sealed";
  }
}

function previewActivePlayerTask() {
  const latest = [...previewCivSession.log]
    .reverse()
    .find((entry) => entry.kind === "player" && ["NPC request", "Task pending", "Task complete"].includes(entry.title));
  const kind = previewMarker(latest?.body ?? "", "task");
  if (!latest || latest.title === "Task complete" || !["fetch_resource", "trade_resource", "visit_building", "repair_object", "rescue_object", "build_bridge"].includes(kind)) return null;
  const npcId = previewMarker(latest.body, "npc");
  if (!npcId) return null;
  const resource = previewMarker(latest.body, "resource");
  return {
    kind,
    npcId,
    resource,
    source: previewMarker(latest.body, "source") || previewTaskSourceResource(resource),
    amount: Math.max(1, previewNumberMarker(latest.body, "amount", 1)),
    baseline: previewNumberMarker(latest.body, "baseline", 0),
    reward: previewMarker(latest.body, "reward") || "morale",
    rewardResource: previewMarker(latest.body, "reward_resource"),
    rewardAmount: Math.max(0, previewNumberMarker(latest.body, "reward_amount", 0)),
    buildingId: previewMarker(latest.body, "building"),
    objectId: previewMarker(latest.body, "object"),
  };
}

function previewTaskForNpc(entity: { id: string; morph?: string; role?: string }) {
  if (entity.role === "builder") {
    const object = previewCivSession.world.entities.find((item) => item.kind === "object" && item.role === "bridge" && (item as { activity?: string }).activity !== "built");
    if (object) {
      return {
        kind: "build_bridge",
        npcId: entity.id,
        resource: "stone",
        source: "stone",
        amount: Math.max(1, previewBridgeTilesRemaining(object.id)),
        baseline: 0,
        reward: "glow_pocket",
        rewardResource: "",
        rewardAmount: 0,
        buildingId: "",
        objectId: object.id,
      };
    }
  }
  if (["gold", "copper", "firefly", "blue", "gfp"].includes(entity.morph ?? "")) {
    const resource = ["blue", "gfp"].includes(entity.morph ?? "") ? "fiber" : "wood";
    return {
      kind: "trade_resource",
      npcId: entity.id,
      resource,
      source: previewTaskSourceResource(resource),
      amount: 2,
      baseline: previewCivSession.civilization.resources[resource as keyof typeof previewCivSession.civilization.resources] ?? 0,
      reward: "resource",
      rewardResource: ["blue", "gfp"].includes(entity.morph ?? "") ? "clean_water" : "tools",
      rewardAmount: 1,
      buildingId: "",
      objectId: "",
    };
  }
  if (entity.role === "elder") {
    const object = previewCivSession.world.entities.find((item) => item.kind === "object" && item.role === "breach" && (item as { activity?: string }).activity !== "repaired")
      ?? previewCivSession.world.entities.find((item) => item.kind === "object" && item.role === "breach");
    if (object) {
      const resource = "fiber";
      return {
        kind: "repair_object",
        npcId: entity.id,
        resource,
        source: previewTaskSourceResource(resource),
        amount: 2,
        baseline: previewCivSession.civilization.resources[resource as keyof typeof previewCivSession.civilization.resources] ?? 0,
        reward: "nest_safety",
        rewardResource: "",
        rewardAmount: 0,
        buildingId: "",
        objectId: object.id,
      };
    }
  }
  if (entity.role === "scout") {
    const object = previewCivSession.world.entities.find((item) => item.kind === "object" && item.role === "trapped" && (item as { activity?: string }).activity !== "rescued");
    if (object) {
      return {
        kind: "rescue_object",
        npcId: entity.id,
        resource: "rubble",
        source: "rubble",
        amount: Math.max(1, previewRescueRubbleRemaining(object.id)),
        baseline: 0,
        reward: "morale",
        rewardResource: "",
        rewardAmount: 0,
        buildingId: "",
        objectId: object.id,
      };
    }
  }
  if (["melanoid", "axanthic", "mystic"].includes(entity.morph ?? "") || entity.role === "elder") {
    const building = previewCivSession.world.entities.find((item) => item.kind === "building" && item.role === (entity.role === "elder" ? "nest" : "pond"))
      ?? previewCivSession.world.entities.find((item) => item.kind === "building");
    return {
      kind: "visit_building",
      npcId: entity.id,
      resource: "",
      source: "",
      amount: 0,
      baseline: 0,
      reward: "morale",
      rewardResource: "",
      rewardAmount: 0,
      buildingId: building?.id ?? "",
      objectId: "",
    };
  }
  const resource = ["wild", "leucistic", "albino", "piebald"].includes(entity.morph ?? "")
    ? "food"
    : "food";
  return {
    kind: "fetch_resource",
    npcId: entity.id,
    resource,
    source: previewTaskSourceResource(resource),
    amount: 2,
    baseline: previewCivSession.civilization.resources[resource as keyof typeof previewCivSession.civilization.resources] ?? 0,
    reward: "morale",
    rewardResource: "",
    rewardAmount: 0,
    buildingId: "",
    objectId: "",
  };
}

function applyPreviewCivIntervention(args?: unknown) {
  const intervention = isRecord(args) && isRecord(args.intervention) ? args.intervention : {};
  const target = typeof intervention.target === "string" ? intervention.target : "food";
  const amount = typeof intervention.amount === "number" ? intervention.amount : 10;
  const kind = typeof intervention.kind === "string" ? intervention.kind : "grant_resource";
  const resources = { ...previewCivSession.civilization.resources };
  let population = previewCivSession.civilization.population;
  let morale = previewCivSession.civilization.morale;
  let health = previewCivSession.civilization.health;
  let shouldLog = kind !== "move_entity";
  let logKind = "intervention";
  let logTitle = "Observer intervention";
  const extraLogs: Array<{ kind: string; title: string; body: string }> = [];
  const resourceKey = target as keyof typeof resources;
  if (kind === "grant_resource") resources[resourceKey] = (resources[resourceKey] ?? 0) + amount;
  if (kind === "remove_resource") resources[resourceKey] = Math.max(0, (resources[resourceKey] ?? 0) - amount);
  let logBody = "";
  if (kind === "harvest_resource") {
    const x = typeof intervention.x === "number" ? intervention.x : -1;
    const y = typeof intervention.y === "number" ? intervention.y : -1;
    const tile = previewCivSession.world.tiles.find((item) => item.x === x && item.y === y);
    if (tile?.resource && tile.amount > 0) {
      const gained = previewHarvestYield(tile.resource);
      const harvested = Math.max(1, Math.min(typeof intervention.amount === "number" ? intervention.amount : 1, tile.amount));
      tile.amount = Math.max(0, tile.amount - harvested);
      if (tile.amount === 0) tile.resource = null;
      const gainedKey = gained as keyof typeof resources;
      resources[gainedKey] = (resources[gainedKey] ?? 0) + harvested;
      resources.pearls = (resources.pearls ?? 0) + previewCurrencyReward(gained, harvested);
      const discovery = previewRareDiscovery("harvest", gained, x, y, harvested);
      if (discovery) {
        resources.pearls = (resources.pearls ?? 0) + discovery.pearls;
        extraLogs.push({
          kind: "player",
          title: "Rare discovery",
          body: previewDiscoveryLogBody(discovery, "harvesting", gained, x, y),
        });
      }
      logBody = `harvested ${harvested} ${gained} from ${x},${y}`;
    } else {
      logBody = `found no resource at ${x},${y}`;
    }
  }
  if (kind === "mine_tile") {
    const x = typeof intervention.x === "number" ? intervention.x : -1;
    const y = typeof intervention.y === "number" ? intervention.y : -1;
    const tile = previewCivSession.world.tiles.find((item) => item.x === x && item.y === y);
    if (tile && previewIsSubstrate(tile.terrain)) {
      const gained = tile.resource ? previewHarvestYield(tile.resource) : previewTerrainYield(tile.terrain);
      tile.terrain = y >= 34 ? "deepwater" : "water";
      tile.resource = null;
      tile.amount = 0;
      const gainedKey = gained as keyof typeof resources;
      resources[gainedKey] = (resources[gainedKey] ?? 0) + 1;
      resources.pearls = (resources.pearls ?? 0) + previewCurrencyReward(gained, 1);
      const discovery = previewRareDiscovery("mine", gained, x, y, 1);
      if (discovery) {
        resources.pearls = (resources.pearls ?? 0) + discovery.pearls;
        extraLogs.push({
          kind: "player",
          title: "Rare discovery",
          body: previewDiscoveryLogBody(discovery, "mining", gained, x, y),
        });
      }
      const entityId = typeof intervention.entity_id === "string" ? intervention.entity_id : "";
      const entity = previewCivSession.world.entities.find((item) => item.id === entityId && item.kind === "axolotl");
      if (entity) {
        (entity as { activity?: string; target_x?: number; target_y?: number }).activity = "player_mine";
        (entity as { target_x?: number }).target_x = x;
        (entity as { target_y?: number }).target_y = y;
      }
      logKind = "player";
      logTitle = "Tile mined";
      logBody = `mined ${gained} from ${x},${y}`;
    } else {
      logBody = `found no mineable tile at ${x},${y}`;
    }
  }
  if (kind === "place_tile") {
    const x = typeof intervention.x === "number" ? intervention.x : -1;
    const y = typeof intervention.y === "number" ? intervention.y : -1;
    const tile = previewCivSession.world.tiles.find((item) => item.x === x && item.y === y);
    const material = target;
    const materialKey = material as keyof typeof resources;
    if (tile && !previewIsSubstrate(tile.terrain) && previewPlaceableResource(material) && (resources[materialKey] ?? 0) > 0) {
      resources[materialKey] = Math.max(0, (resources[materialKey] ?? 0) - 1);
      tile.terrain = previewPlaceTerrain(material);
      tile.resource = null;
      tile.amount = 0;
      const entityId = typeof intervention.entity_id === "string" ? intervention.entity_id : "";
      const entity = previewCivSession.world.entities.find((item) => item.id === entityId && item.kind === "axolotl");
      if (entity) {
        (entity as { activity?: string; target_x?: number; target_y?: number }).activity = "player_build";
        (entity as { target_x?: number }).target_x = x;
        (entity as { target_y?: number }).target_y = y;
      }
      logKind = "player";
      logTitle = "Tile placed";
      logBody = `placed ${tile.terrain} at ${x},${y}`;
      const task = previewActivePlayerTask();
      if (task?.kind === "build_bridge" && previewBridgeTilesRemaining(task.objectId) <= 0) {
        morale = Math.min(100, morale + 3);
        health = Math.min(100, health + 0.8);
        resources.glowshards = (resources.glowshards ?? 0) + 1;
        resources.pearls = (resources.pearls ?? 0) + 5;
        const object = previewCivSession.world.entities.find((item) => item.id === task.objectId && item.kind === "object");
        if (object) {
          object.health = 100;
          (object as { activity?: string }).activity = "built";
          previewSealNearbySeeps(object.x, object.y);
        }
        const npc = object ? previewSetNpcCelebrationTarget(task.npcId, object.x, object.y, 6) : null;
        logTitle = "Task complete";
        const npcName = npc?.name ?? "the builder";
        const objectName = object?.name ?? "the bridge";
        logBody = `target=${task.objectId}; Built ${objectName} for ${npcName}. The resource pocket is reachable and the silt vent is sealed; task=build_bridge; npc=${task.npcId}; object=${task.objectId}; resource=${task.resource}; source=${task.source}; amount=${task.amount}; baseline=${task.baseline}; reward=${task.reward};`;
      }
    } else {
      logBody = `could not place ${material} at ${x},${y}`;
    }
  }
  if (kind === "move_entity") {
    const entityId = typeof intervention.entity_id === "string" ? intervention.entity_id : "";
    const entity = previewCivSession.world.entities.find((item) => item.id === entityId && item.kind === "axolotl");
    if (entity) {
      if (typeof intervention.x === "number") entity.x = Math.max(0, Math.min(previewCivSession.world.width - 1, intervention.x));
      if (typeof intervention.y === "number") entity.y = Math.max(0, Math.min(previewCivSession.world.height - 1, intervention.y));
      (entity as { activity?: string }).activity = "player";
    }
  }
  if (kind === "repair_object") {
    const entityId = typeof intervention.entity_id === "string" ? intervention.entity_id : "";
    const object = previewCivSession.world.entities.find((item) => item.id === entityId && item.kind === "object");
    const task = previewActivePlayerTask();
    if (object && task?.kind === "repair_object" && task.objectId === entityId) {
      const resourceKey = task.resource as keyof typeof resources;
      const have = resources[resourceKey] ?? 0;
      const required = task.baseline + task.amount;
      if (have >= required) {
        resources[resourceKey] = Math.max(0, have - task.amount);
        resources.clean_water = (resources.clean_water ?? 0) + 1;
        resources.pearls = (resources.pearls ?? 0) + 4;
        morale = Math.min(100, morale + 3);
        health = Math.min(100, health + 1.2);
        object.health = 100;
        (object as { activity?: string }).activity = "repaired";
        previewSealNearbyLeaks(object.x, object.y);
        const npc = previewSetNpcCelebrationTarget(task.npcId, object.x, object.y, 6);
        logKind = "player";
        logTitle = "Task complete";
        const npcName = npc?.name ?? "the requester";
        logBody = `target=${task.objectId}; Repaired ${object.name} for ${npcName}. The nest leak is sealed and the nest is safe again; task=repair_object; npc=${task.npcId}; object=${task.objectId}; resource=${task.resource}; source=${task.source}; amount=${task.amount}; baseline=${task.baseline}; reward=${task.reward};`;
      } else {
        logKind = "player";
        logTitle = "Task pending";
        logBody = `target=${task.npcId}; Need ${required - have} more ${task.resource} before repairing ${object.name}; task=repair_object; npc=${task.npcId}; object=${task.objectId}; resource=${task.resource}; source=${task.source}; amount=${task.amount}; baseline=${task.baseline}; reward=${task.reward};`;
      }
    } else {
      shouldLog = false;
    }
  }
  if (kind === "rescue_object") {
    const entityId = typeof intervention.entity_id === "string" ? intervention.entity_id : "";
    const object = previewCivSession.world.entities.find((item) => item.id === entityId && item.kind === "object");
    const task = previewActivePlayerTask();
    if (object && task?.kind === "rescue_object" && task.objectId === entityId) {
      const remaining = previewRescueRubbleRemaining(entityId);
      if (remaining <= 0) {
        morale = Math.min(100, morale + 4);
        health = Math.min(100, health + 1);
        resources.pearls = (resources.pearls ?? 0) + 6;
        object.health = 100;
        object.mood = 100;
        (object as { activity?: string }).activity = "rescued";
        if (previewSpawnRescuedJuvenile(object)) population += 1;
        const npc = previewSetNpcCelebrationTarget(task.npcId, object.x, object.y, 7);
        logKind = "player";
        logTitle = "Task complete";
        const npcName = npc?.name ?? "the scout";
        logBody = `target=${task.objectId}; Rescued ${object.name} for ${npcName}. The blocked path is clear and the low-oxygen pocket is behind you; task=rescue_object; npc=${task.npcId}; object=${task.objectId}; resource=${task.resource}; source=${task.source}; amount=${task.amount}; baseline=${task.baseline}; reward=${task.reward};`;
      } else {
        logKind = "player";
        logTitle = "Task pending";
        logBody = `target=${task.npcId}; Clear ${remaining} more rubble near ${object.name}; task=rescue_object; npc=${task.npcId}; object=${task.objectId}; resource=${task.resource}; source=${task.source}; amount=${task.amount}; baseline=${task.baseline}; reward=${task.reward};`;
      }
    } else {
      shouldLog = false;
    }
  }
  if (kind === "feed_hatchling") {
    const entityId = typeof intervention.entity_id === "string" ? intervention.entity_id : "";
    const hatchling = previewCivSession.world.entities.find((item) => (
      item.id === entityId && item.kind === "axolotl" && item.stage === "hatchling"
    ));
    logKind = "player";
    if (!hatchling) {
      logTitle = "Hatchling care blocked";
      logBody = "hatchling not found";
    } else if (previewPlayerTargetUsedThisTurn("Hatchling fed", entityId)) {
      shouldLog = false;
    } else if ((resources.food ?? 0) < 1) {
      logTitle = "Hatchling care blocked";
      logBody = `target=${entityId}; not enough food for ${hatchling.name}`;
    } else {
      resources.food = Math.max(0, (resources.food ?? 0) - 1);
      hatchling.health = Math.min(100, (hatchling.health ?? 0) + 6);
      hatchling.mood = Math.min(100, (hatchling.mood ?? 0) + 8);
      (hatchling as { activity?: string }).activity = "fed";
      morale = Math.min(100, morale + 1);
      logTitle = "Hatchling fed";
      logBody = `target=${entityId}; Fed ${hatchling.name}; -1 food; care=feed_hatchling; health=${Math.round(hatchling.health ?? 0)}; mood=${Math.round(hatchling.mood ?? 0)};`;
    }
  }
  if (kind === "talk_entity") {
    const entityId = typeof intervention.entity_id === "string" ? intervention.entity_id : "";
    const entity = previewCivSession.world.entities.find((item) => item.id === entityId && item.kind === "axolotl");
    if (entity) {
      const task = previewActivePlayerTask();
      if (task?.npcId === entityId) {
        if (task.kind === "repair_object") {
          if (previewPlayerTargetUsedThisTurn("Task pending", entityId)) {
            shouldLog = false;
          } else {
            const have = resources[task.resource as keyof typeof resources] ?? 0;
            const required = task.baseline + task.amount;
            const objectName = previewCivSession.world.entities.find((item) => item.id === task.objectId)?.name ?? "the damaged site";
            (entity as { activity?: string }).activity = "waiting";
            logKind = "player";
            logTitle = "Task pending";
            logBody = have >= required
              ? `target=${task.npcId}; ${entity.name} says ${objectName} is ready to repair. Patch it to seal the nest leak; task=repair_object; npc=${task.npcId}; object=${task.objectId}; resource=${task.resource}; source=${task.source}; amount=${task.amount}; baseline=${task.baseline}; reward=${task.reward};`
              : `target=${task.npcId}; ${entity.name} still needs ${required - have} more ${task.resource} before repairing ${objectName}. The nest leak clouds the work site; gather ${task.source} and return; task=repair_object; npc=${task.npcId}; object=${task.objectId}; resource=${task.resource}; source=${task.source}; amount=${task.amount}; baseline=${task.baseline}; reward=${task.reward};`;
          }
        } else if (task.kind === "rescue_object") {
          if (previewPlayerTargetUsedThisTurn("Task pending", entityId)) {
            shouldLog = false;
          } else {
            const remaining = previewRescueRubbleRemaining(task.objectId);
            const objectName = previewCivSession.world.entities.find((item) => item.id === task.objectId)?.name ?? "the trapped axolotl";
            (entity as { activity?: string }).activity = "waiting";
            logKind = "player";
            logTitle = "Task pending";
            logBody = remaining <= 0
              ? `target=${task.npcId}; ${entity.name} says ${objectName} is reachable. Watch your oxygen in the pocket; task=rescue_object; npc=${task.npcId}; object=${task.objectId}; resource=${task.resource}; source=${task.source}; amount=${task.amount}; baseline=${task.baseline}; reward=${task.reward};`
              : `target=${task.npcId}; ${entity.name} needs ${remaining} more rubble cleared near ${objectName}. The pocket drains oxygen, so retreat if it gets low; task=rescue_object; npc=${task.npcId}; object=${task.objectId}; resource=${task.resource}; source=${task.source}; amount=${task.amount}; baseline=${task.baseline}; reward=${task.reward};`;
          }
        } else if (task.kind === "build_bridge") {
          if (previewPlayerTargetUsedThisTurn("Task pending", entityId)) {
            shouldLog = false;
          } else {
            const remaining = previewBridgeTilesRemaining(task.objectId);
            const objectName = previewCivSession.world.entities.find((item) => item.id === task.objectId)?.name ?? "the bridge gap";
            (entity as { activity?: string }).activity = "waiting";
            logKind = "player";
            logTitle = "Task pending";
            logBody = remaining <= 0
              ? `target=${task.npcId}; ${entity.name} says ${objectName} is bridged and the silt vent is sealed; task=build_bridge; npc=${task.npcId}; object=${task.objectId}; resource=${task.resource}; source=${task.source}; amount=${task.amount}; baseline=${task.baseline}; reward=${task.reward};`
              : `target=${task.npcId}; ${entity.name} needs ${remaining} more bridge tile${remaining === 1 ? "" : "s"} placed at ${objectName}. Work through the silt plume before it is sealed; task=build_bridge; npc=${task.npcId}; object=${task.objectId}; resource=${task.resource}; source=${task.source}; amount=${task.amount}; baseline=${task.baseline}; reward=${task.reward};`;
          }
        } else if (task.kind === "visit_building") {
          if (previewPlayerTargetUsedThisTurn("Task pending", entityId)) {
            shouldLog = false;
          } else {
            (entity as { activity?: string }).activity = "waiting";
            const buildingName = previewCivSession.world.entities.find((item) => item.id === task.buildingId)?.name ?? "the target building";
            logKind = "player";
            logTitle = "Task pending";
            logBody = `target=${task.npcId}; ${entity.name} wants you to check ${buildingName}; task=visit_building; npc=${task.npcId}; building=${task.buildingId}; reward=${task.reward};`;
          }
        } else {
        const resourceKey = task.resource as keyof typeof resources;
        const have = resources[resourceKey] ?? 0;
        const required = task.baseline + task.amount;
        if (have >= required) {
          resources[resourceKey] = Math.max(0, have - task.amount);
          entity.mood = Math.min(100, (entity.mood ?? 0) + 6);
          (entity as { activity?: string }).activity = "celebrate";
          if (task.kind === "trade_resource" && task.rewardResource) {
            const rewardKey = task.rewardResource as keyof typeof resources;
            resources[rewardKey] = (resources[rewardKey] ?? 0) + Math.max(1, task.rewardAmount);
            morale = Math.min(100, morale + 1);
            resources.pearls = (resources.pearls ?? 0) + 3;
          } else {
            morale = Math.min(100, morale + 2);
            resources.pearls = (resources.pearls ?? 0) + 2;
          }
          logKind = "player";
          logTitle = "Task complete";
          logBody = task.kind === "trade_resource"
            ? `target=${task.npcId}; Traded ${task.amount} ${task.resource} with ${entity.name} for ${Math.max(1, task.rewardAmount)} ${task.rewardResource}; task=trade_resource; npc=${task.npcId}; resource=${task.resource}; source=${task.source}; amount=${task.amount}; baseline=${task.baseline}; reward=${task.reward}; reward_resource=${task.rewardResource}; reward_amount=${Math.max(1, task.rewardAmount)};`
            : `target=${task.npcId}; Delivered ${task.amount} ${task.resource} to ${entity.name}. The pond feels more coordinated; task=fetch_resource; npc=${task.npcId}; resource=${task.resource}; source=${task.source}; amount=${task.amount}; baseline=${task.baseline}; reward=${task.reward};`;
        } else if (previewPlayerTargetUsedThisTurn("Task pending", entityId)) {
          shouldLog = false;
        } else {
          (entity as { activity?: string }).activity = "waiting";
          logKind = "player";
          logTitle = "Task pending";
          logBody = `target=${task.npcId}; ${entity.name} still needs ${required - have} more ${task.resource}. ${task.kind === "trade_resource" ? "Bring" : "Gather"} ${task.source} and return; task=${task.kind}; npc=${task.npcId}; resource=${task.resource}; source=${task.source}; amount=${task.amount}; baseline=${task.baseline}; reward=${task.reward}; reward_resource=${task.rewardResource}; reward_amount=${task.rewardAmount};`;
        }
        }
      } else if (task) {
        if (previewPlayerTargetUsedThisTurn("Conversation", entityId)) {
          shouldLog = false;
        } else {
          entity.mood = Math.min(100, (entity.mood ?? 0) + 1);
          (entity as { activity?: string }).activity = "socialize";
          const requester = previewCivSession.world.entities.find((item) => item.id === task.npcId)?.name ?? "the requester";
          logKind = "player";
          logTitle = "Conversation";
          logBody = `target=${entityId}; ${entity.name} points you back to ${requester}'s request for ${task.resource}.`;
        }
      } else if (previewPlayerTargetUsedThisTurn("NPC request", entityId)) {
        shouldLog = false;
      } else {
        const nextTask = previewTaskForNpc(entity);
        entity.mood = Math.min(100, (entity.mood ?? 0) + 4);
        (entity as { activity?: string }).activity = "socialize";
        morale = Math.min(100, morale + 1);
        logKind = "player";
        logTitle = "NPC request";
        if (nextTask.kind === "trade_resource") {
          logBody = `target=${nextTask.npcId}; ${entity.name} offers ${Math.max(1, nextTask.rewardAmount)} ${nextTask.rewardResource} for ${nextTask.amount} ${nextTask.resource}; task=trade_resource; npc=${nextTask.npcId}; resource=${nextTask.resource}; source=${nextTask.source}; amount=${nextTask.amount}; baseline=${nextTask.baseline}; reward=${nextTask.reward}; reward_resource=${nextTask.rewardResource}; reward_amount=${Math.max(1, nextTask.rewardAmount)};`;
        } else if (nextTask.kind === "visit_building") {
          const buildingName = previewCivSession.world.entities.find((item) => item.id === nextTask.buildingId)?.name ?? "the building";
          logBody = `target=${nextTask.npcId}; ${entity.name} asks you to check ${buildingName}; task=visit_building; npc=${nextTask.npcId}; building=${nextTask.buildingId}; reward=${nextTask.reward};`;
        } else if (nextTask.kind === "repair_object") {
          const objectName = previewCivSession.world.entities.find((item) => item.id === nextTask.objectId)?.name ?? "the damaged site";
          logBody = `target=${nextTask.npcId}; ${entity.name} asks you to repair ${objectName}. Gather ${nextTask.amount} ${nextTask.resource} and fix it; a nest leak slows the repair site until sealed; task=repair_object; npc=${nextTask.npcId}; object=${nextTask.objectId}; resource=${nextTask.resource}; source=${nextTask.source}; amount=${nextTask.amount}; baseline=${nextTask.baseline}; reward=${nextTask.reward};`;
        } else if (nextTask.kind === "rescue_object") {
          const objectName = previewCivSession.world.entities.find((item) => item.id === nextTask.objectId)?.name ?? "the trapped axolotl";
          logBody = `target=${nextTask.npcId}; ${entity.name} asks you to rescue ${objectName}. Mine ${nextTask.amount} rubble tiles around the marker; the pocket drains oxygen, so retreat when low; task=rescue_object; npc=${nextTask.npcId}; object=${nextTask.objectId}; resource=${nextTask.resource}; source=${nextTask.source}; amount=${nextTask.amount}; baseline=${nextTask.baseline}; reward=${nextTask.reward};`;
        } else if (nextTask.kind === "build_bridge") {
          const objectName = previewCivSession.world.entities.find((item) => item.id === nextTask.objectId)?.name ?? "the bridge gap";
          logBody = `target=${nextTask.npcId}; ${entity.name} asks you to build ${objectName}. Place ${nextTask.amount} bridge tile${nextTask.amount === 1 ? "" : "s"} using ${nextTask.resource}; a silt vent slows the crossing until the bridge is sealed; task=build_bridge; npc=${nextTask.npcId}; object=${nextTask.objectId}; resource=${nextTask.resource}; source=${nextTask.source}; amount=${nextTask.amount}; baseline=${nextTask.baseline}; reward=${nextTask.reward};`;
        } else {
          logBody = `target=${nextTask.npcId}; ${entity.name} asks for ${nextTask.amount} ${nextTask.resource}. Gather ${nextTask.source} and return; task=fetch_resource; npc=${nextTask.npcId}; resource=${nextTask.resource}; source=${nextTask.source}; amount=${nextTask.amount}; baseline=${nextTask.baseline}; reward=${nextTask.reward};`;
        }
      }
    } else {
      shouldLog = false;
    }
  }
  if (kind === "use_building") {
    const entityId = typeof intervention.entity_id === "string" ? intervention.entity_id : "";
    const building = previewCivSession.world.entities.find((item) => item.id === entityId && item.kind === "building");
    if (building) {
      const task = previewActivePlayerTask();
        if (task?.kind === "visit_building" && task.buildingId === entityId) {
        morale = Math.min(100, morale + 2);
        health = Math.min(100, health + 0.8);
        if (building.role === "pond") resources.clean_water = (resources.clean_water ?? 0) + 1;
        resources.pearls = (resources.pearls ?? 0) + 3;
        const npc = previewCivSession.world.entities.find((item) => item.id === task.npcId && item.kind === "axolotl");
        if (npc) {
          npc.mood = Math.min(100, (npc.mood ?? 0) + 5);
          (npc as { activity?: string }).activity = "celebrate";
        }
        logKind = "player";
        logTitle = "Task complete";
        logBody = `target=${task.buildingId}; Checked ${building.name} for the requester. The ${building.role} feels tended; task=visit_building; npc=${task.npcId}; building=${task.buildingId}; reward=${task.reward};`;
      } else if (previewPlayerTargetUsedThisTurn("Building used", entityId)) {
        shouldLog = false;
      } else {
        if (building.role === "pond") {
          resources.clean_water = (resources.clean_water ?? 0) + 1;
          health = Math.min(100, health + 0.6);
        } else if (building.role === "nest") {
          morale = Math.min(100, morale + 1);
        } else if (building.role === "farm") {
          resources.food = (resources.food ?? 0) + 1;
        } else if (building.role === "workshop") {
          resources.tools = (resources.tools ?? 0) + 1;
        } else {
          morale = Math.min(100, morale + 0.4);
        }
        resources.pearls = (resources.pearls ?? 0) + 1;
        logKind = "player";
        logTitle = "Building used";
        logBody = `target=${entityId}; used ${building.name}`;
      }
    }
  }
  if (kind === "shop_purchase") {
    const cost = previewShopCost(target);
    if (cost <= 0) {
      logKind = "player";
      logTitle = "Shop blocked";
      logBody = `unknown shop item ${target}`;
    } else if ((resources.pearls ?? 0) < cost) {
      logKind = "player";
      logTitle = "Shop blocked";
      logBody = `not enough pearls for ${target}`;
    } else {
      resources.pearls = Math.max(0, (resources.pearls ?? 0) - cost);
      logKind = "player";
      logTitle = "Shop purchase";
      if (target === "supply_cache") {
        resources.wood = (resources.wood ?? 0) + 8;
        resources.stone = (resources.stone ?? 0) + 8;
        resources.clay = (resources.clay ?? 0) + 8;
        resources.fiber = (resources.fiber ?? 0) + 8;
        logBody = `bought Supply Cache for ${cost} pearls`;
      } else if (target === "pond_blessing") {
        morale = Math.min(100, morale + 3);
        previewCivSession.modifiers.push({
          id: `shop-cooperation-aura-preview-${previewCivSession.updated_at}`,
          kind: "cooperation_aura",
          label: "Cooperation Aura",
          polarity: "buff",
          remaining_turns: 6,
          intensity: 1,
        });
        logBody = `bought Pond Blessing for ${cost} pearls`;
      } else if (target === "rare_lure") {
        const x = PREVIEW_HOME_X;
        const y = PREVIEW_WORLD.floor[x] ?? PREVIEW_HOME_FLOOR;
        previewPlace("amber", Math.max(1, x - 1), y, 3);
        previewPlace("glowshards", Math.min(PREVIEW_WORLD.width - 2, x + 1), y, 3);
        logBody = `bought Rare Lure for ${cost} pearls`;
      } else if (target === "common_egg" || target === "rare_egg") {
        const rare = target === "rare_egg";
        const morph = rare ? "mystic" : "leucistic";
        previewCivSession.world.entities.push({
          id: `shop-egg-preview-${previewCivSession.world.entities.length}`,
          kind: "egg",
          name: rare ? "Rare Mystic Egg" : "Common Egg",
          x: PREVIEW_HOME_X - 5,
          y: PREVIEW_HOME_FLOOR - 3,
          health: 100,
          mood: 100,
          role: "egg",
          morph,
          pattern: rare ? "marbled" : "plain",
          stage: "egg",
          sex: "",
          age: 0,
          size: 0.5,
          accessories: [],
          genes: { allele_a: morph, allele_b: rare ? "gfp" : "wild", size_gene: rare ? 1.1 : 1, fertility: 0.8, longevity: 1, vigor: 1 },
          hatches_in: 3,
          parents: ["shop"],
        } as (typeof previewCivSession.world.entities)[number]);
        logBody = `bought ${rare ? "Rare Egg" : "Common Egg"} for ${cost} pearls`;
      } else {
        const role = target === "workshop_kit" ? "workshop" : target === "storage_kit" ? "storage" : "farm";
        const name = role === "workshop" ? "Tool Workshop" : role === "storage" ? "Shell Cache" : "Moss Farm";
        const x = Math.min(PREVIEW_WORLD.width - 2, PREVIEW_HOME_X + 5 + previewCivSession.world.entities.length % 5);
        const y = PREVIEW_HOME_FLOOR - 1;
        previewCivSession.world.entities.push({
          id: `shop-${role}-preview-${previewCivSession.world.entities.length}`,
          kind: "building",
          name,
          x,
          y,
          health: PREVIEW_SHOP_BUILDING_INITIAL_HEALTH,
          mood: 100,
          role,
          activity: "construction",
        } as (typeof previewCivSession.world.entities)[number]);
        assignPreviewBuilders(x, y);
        logBody = `bought ${name} kit for ${cost} pearls; construction started near ${x},${y}`;
      }
    }
  }
  if (kind === "incubate_egg") {
    const entityId = typeof intervention.entity_id === "string" ? intervention.entity_id : "";
    const egg = previewCivSession.world.entities.find((entity) => (
      entity.id === entityId && (entity.kind === "egg" || entity.stage === "egg")
    ));
    if (!egg) {
      logKind = "player";
      logTitle = "Incubation blocked";
      logBody = "egg not found";
    } else {
      const remaining = typeof egg.hatches_in === "number" && Number.isFinite(egg.hatches_in)
        ? Math.max(0, Math.floor(egg.hatches_in))
        : 0;
      if (remaining <= 1) {
        logKind = "player";
        logTitle = "Incubation blocked";
        logBody = `${egg.name} is ready to hatch next turn`;
      } else if ((resources.pearls ?? 0) < EGG_INCUBATE_PEARL_COST) {
        logKind = "player";
        logTitle = "Incubation blocked";
        logBody = `not enough pearls for ${egg.name}`;
      } else if ((resources.food ?? 0) < EGG_INCUBATE_FOOD_COST) {
        logKind = "player";
        logTitle = "Incubation blocked";
        logBody = `not enough food for ${egg.name}`;
      } else {
        resources.pearls = Math.max(0, (resources.pearls ?? 0) - EGG_INCUBATE_PEARL_COST);
        resources.food = Math.max(0, (resources.food ?? 0) - EGG_INCUBATE_FOOD_COST);
        egg.hatches_in = remaining - 1;
        egg.activity = "incubating";
        logKind = "player";
        logTitle = "Egg incubated";
        logBody = `${egg.name} warmed; hatch timer is now ${remaining - 1} turn(s). Cost ${EGG_INCUBATE_PEARL_COST} pearls and ${EGG_INCUBATE_FOOD_COST} food.`;
      }
    }
  }
  const modifierKinds = ["apply_buff", "apply_debuff", "trigger_event"];
  previewCivSession = {
    ...previewCivSession,
    updated_at: previewCivSession.updated_at + 5,
    civilization: { ...previewCivSession.civilization, population, health, morale, resources },
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
    log: shouldLog
      ? [
          ...previewCivSession.log,
          {
            turn: previewCivSession.turn,
            kind: logKind,
            title: logTitle,
            body: logBody || `${kind} ${target}`,
            created_at: previewCivSession.updated_at + 5,
          },
          ...extraLogs.map((entry, index) => ({
            turn: previewCivSession.turn,
            kind: entry.kind,
            title: entry.title,
            body: entry.body,
            created_at: previewCivSession.updated_at + 6 + index,
          })),
        ].slice(-80)
      : previewCivSession.log,
  };
  persistPreviewCivSession();
}

function previewHarvestYield(resource: string) {
  return resource === "moss" ? "food" : resource;
}

function previewCurrencyReward(resource: string, amount: number) {
  const unit = resource === "glowshards" || resource === "amber"
    ? 3
    : ["ore", "sulfur", "coral", "tools"].includes(resource)
      ? 2
      : 1;
  return unit * Math.max(1, amount);
}

type PreviewRareDiscovery = {
  label: string;
  resource: "pearls";
  amount: number;
  pearls: number;
  shopHint: string;
};

function previewRareDiscovery(
  action: "harvest" | "mine",
  resource: string,
  x: number,
  y: number,
  amount: number,
): PreviewRareDiscovery | null {
  if (resource === "glowshards" || resource === "amber") {
    return {
      label: "Prismatic Pearl Cache",
      resource: "pearls",
      amount: 4,
      pearls: 4,
      shopHint: "rare_egg",
    };
  }
  if (["ore", "sulfur", "coral"].includes(resource)) {
    return {
      label: "Ancient Shell Cache",
      resource: "pearls",
      amount: 2,
      pearls: 2,
      shopHint: "rare_lure",
    };
  }
  if (amount !== 1) return null;
  const roll = previewHash(`${previewCivSession.seed}:${previewCivSession.turn}:${action}:${resource}:${x}:${y}:${amount}`);
  const divisor = action === "mine" ? 5 : 7;
  if (roll % divisor !== 0) return null;
  return {
    label: "Hidden Pearl Cache",
    resource: "pearls",
    amount: 1,
    pearls: 1,
    shopHint: "common_egg",
  };
}

function previewDiscoveryLogBody(
  discovery: PreviewRareDiscovery,
  verb: string,
  sourceResource: string,
  x: number,
  y: number,
) {
  return `Found ${discovery.label} while ${verb} ${sourceResource}; reward_resource=${discovery.resource}; reward_amount=${discovery.amount}; bonus_pearls=${discovery.pearls}; source=${sourceResource}; x=${x}; y=${y}; shop_hint=${discovery.shopHint};`;
}

function previewHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function previewShopCost(item: string) {
  if (item === "supply_cache") return 6;
  if (item === "pond_blessing") return 8;
  if (item === "rare_lure") return 10;
  if (item === "common_egg") return 12;
  if (item === "farm_kit" || item === "storage_kit") return 14;
  if (item === "workshop_kit") return 18;
  if (item === "rare_egg") return 30;
  return 0;
}

function previewPlace(resource: string, x: number, y: number, amount: number) {
  for (let dy = 0; dy < 2; dy += 1) {
    for (let dx = 0; dx < 3; dx += 1) {
      const tile = previewCivSession.world.tiles.find((item) => item.x === x + dx && item.y === y + dy);
      if (tile && previewIsSubstrate(tile.terrain)) {
        tile.resource = resource;
        tile.amount = amount;
      }
    }
  }
}

function previewIsSubstrate(terrain: string) {
  return terrain !== "air" && terrain !== "water" && terrain !== "deepwater";
}

function previewTerrainYield(terrain: string) {
  if (terrain === "moss" || terrain === "peat") return "fiber";
  if (terrain === "mud" || terrain === "earth" || terrain === "sand" || terrain === "salt") return "clay";
  if (terrain === "coral") return "coral";
  if (terrain === "ice") return "ice";
  if (terrain === "crystal") return "glowshards";
  return "stone";
}

function previewPlaceableResource(resource: string) {
  return ["stone", "clay", "wood", "fiber", "coral", "ice"].includes(resource);
}

function previewPlaceTerrain(resource: string) {
  if (resource === "clay") return "mud";
  if (resource === "wood" || resource === "fiber") return "moss";
  if (resource === "coral") return "coral";
  if (resource === "ice") return "ice";
  return "stone";
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
  if (cmd.includes("civ")) hydratePreviewCivSessionFromStore();
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
      const freshSession = clonePreviewCivSession();
      const createdAt = Math.floor(Date.now() / 1000);
      previewCivSession = {
        ...freshSession,
        id: `preview-civ-${Date.now()}`,
        name: typeof config.name === "string" && config.name.trim() ? config.name.trim() : "Axolotl Colony",
        model: typeof config.model === "string" ? config.model : "kimi-coding",
        turn: 0,
        updated_at: createdAt,
        created_at: createdAt,
      };
      persistPreviewCivSession();
      return previewCivSession.id;
    }
    case "advance_civ_turn":
      advancePreviewCiv();
      return JSON.stringify(previewCivSession);
    case "apply_civ_intervention":
      applyPreviewCivIntervention(args);
      return JSON.stringify(previewCivSession);
    case "delete_civ_session":
      resetPreviewCivSession();
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
