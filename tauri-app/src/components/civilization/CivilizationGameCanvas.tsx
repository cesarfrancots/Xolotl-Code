import { useEffect, useRef } from "react";
import Phaser from "phaser";
import type { CivSessionSnapshot, CivEntity } from "../../bindings";
import { primaryCiv } from "../../stores/civStore";
import { activeCivPlayerTask, type CivPlayerTask } from "../../lib/civPlayerTasks";
import type { CivPilotCommand } from "../../lib/civPilot";
import {
  axolotlLevel,
  axolotlRarity,
  EGG_INCUBATE_FOOD_COST,
  EGG_INCUBATE_PEARL_COST,
  genePotential,
  hatchProgressPercent,
  hatchTurnsRemaining,
  isEggEntity,
  rarityLabel,
} from "../../lib/civCreatureProgression";

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
    civCamera?: {
      zoomBy(factor: number): void;
      recenter(): void;
      toggleFollow(): void;
      focusRegion(x: number, width: number): void;
      // Additive (REN-02): the four above remain (ARENA-02 extend-only contract).
      focusCiv?(civId: string): void;
      frameAll?(): void;
    };
  }
}

type CivilizationGameCanvasProps = {
  snapshot: CivSessionSnapshot;
  turnRunning?: boolean;
  possessedEntityId?: string | null;
  playerTool?: PlayerTool;
  buildResource?: string;
  gameMode?: GameViewMode;
  pilotCommand?: CivPilotCommand;
  pilotActive?: boolean;
  onPlayerInteract?: (interaction: PlayerInteraction) => void;
  onPlayerMove?: (move: PlayerMove) => void;
};

const TILE_SIZE = 16;
const VARIANT_COUNT = 12;
const FRAMES_PER_VARIANT = 4;
const SURFACE_ROWS = 6; // air band at the very top (matches backend WATER_SURFACE_Y)
const WATER_FLOOR_Y = 50; // base seabed row where colonies live (matches backend WATER_FLOOR_Y)
const PLAYER_DASH_COOLDOWN_MS = 1350;
const PLAYER_JUMP_IMPULSE = -8.2;
const PLAYER_JUMP_GRAVITY = 0.28;
const PLAYER_MAX_FALL_SPEED = 5.2;
const PLAYER_WALL_SLIDE_MAX_FALL_SPEED = 1.35;
const PLAYER_WALL_KICK_IMPULSE_Y = -7.2;
const PLAYER_WALL_KICK_IMPULSE_X = 3.4;
const PLAYER_WALL_KICK_CONTROL_LOCK_MS = 520;
const PLAYER_JUMP_BUFFER_MS = 180;
const PLAYER_INTERACT_BUFFER_MS = 180;
const PLAYER_BUILD_INTERACT_RADIUS = 86;
const PLAYER_GROUND_COYOTE_MS = 160;
const PLAYER_WALL_COYOTE_MS = 150;
const PLAYER_MANUAL_SWIM_ACCEL = 0.34;
const PLAYER_MANUAL_SWIM_DRAG = 0.19;
const PLAYER_MANUAL_GROUND_ACCEL = 0.42;
const PLAYER_MANUAL_GROUND_DRAG = 0.28;
const PLAYER_MANUAL_STOP_EPSILON = 0.04;
const SILT_VENT_RADIUS_PX = 58;
const LOW_OXYGEN_RADIUS_PX = 68;
const SILT_VENT_MIN_SPEED = 0.62;
const PLAYER_OXYGEN_RECOVER_PER_FRAME = 0.78;
const PLAYER_OXYGEN_DRAIN_PER_FRAME = 0.13;
const PLAYER_OXYGEN_CRITICAL = 16;
const PLAYER_OXYGEN_WARNING = 34;
const PILOT_MOVE_ARRIVE_RADIUS = 24;

// Sprite-sheet variant order — must match MORPHS in civilization.rs.
const MORPHS = [
  "leucistic", "wild", "melanoid", "gold", "axanthic", "blue",
  "copper", "gfp", "albino", "piebald", "firefly", "mystic",
];
const ACCESSORIES = [
  "flowercrown", "strawhat", "leafhat", "scarf", "glasses", "wizardhat",
  "crown", "snorkel", "bow", "headphones", "chefhat", "piratehat",
];
const RESOURCE_KEYS: Record<string, string> = {
  moss: "res-food", food: "res-food", clean_water: "res-water", wood: "res-wood",
  stone: "res-stone", clay: "res-clay", fiber: "res-fiber", tools: "res-tools",
  glowshards: "res-glowshards", kelp: "res-fiber", ore: "res-stone", ice: "res-water",
  coral: "res-clay", sulfur: "res-glowshards", amber: "res-glowshards", herbs: "res-food",
  pearls: "res-glowshards",
};
const BUILDING_KEYS: Record<string, string> = {
  nest: "bld-nest", storage: "bld-storage", farm: "bld-farm", workshop: "bld-workshop",
  canal: "bld-canal", pond: "bld-pondheart",
};
const TERRAIN_TILES: Record<string, string> = {
  sand: "tile-sand", moss: "tile-moss", mud: "tile-mud",
  earth: "tile-earth", stone: "tile-stone", crystal: "tile-crystal",
  coral: "tile-crystal", ice: "tile-crystal", basalt: "tile-stone",
  peat: "tile-mud", salt: "tile-sand", sandstone: "tile-sand",
};
// Head anchor for each accessory, as a fraction of the body height from centre.
const ACC_OFFSET: Record<string, number> = {
  flowercrown: -0.42, strawhat: -0.46, leafhat: -0.48, wizardhat: -0.54, crown: -0.48,
  chefhat: -0.54, piratehat: -0.48, headphones: -0.40, bow: -0.34,
  glasses: -0.12, snorkel: -0.10, scarf: 0.10,
};
const ACC_SCALE: Record<string, number> = {
  scarf: 0.56, glasses: 0.5, snorkel: 0.5, bow: 0.46, headphones: 0.7,
};
// Translucent water wash per biome, so each region reads with its own colour.
const BIOME_WASH: Record<string, number> = {
  shallows: 0x53d2e0, reedmarsh: 0x46b58f, mudflats: 0x9c8a55, kelpforest: 0x39a868,
  openwater: 0x3f93c4, deeptrench: 0x16223f, crystalcave: 0x8f73d8, thermalvent: 0xc86a44,
  coralreef: 0xf06fa2, glacier: 0xa9e4ff, volcanic: 0xb44734, bog: 0x5f8f52,
  saltflats: 0xd7c792, abyss: 0x090d20,
};
// Minimap entity dot colours per morph.
const MORPH_DOT: Record<string, number> = {
  leucistic: 0xffd9e6, wild: 0x6f7d52, melanoid: 0x4a4a55, gold: 0xf2c75b, axanthic: 0xb9b39b,
  blue: 0x8fb8d8, copper: 0xc77f4a, gfp: 0x8effb4, albino: 0xfff0f4, piebald: 0xd8c0cc,
  firefly: 0xffe27a, mystic: 0xc89bff,
};

export type PlayerInteraction = {
  entityId: string;
  kind: "resource" | "building" | "npc" | "terrain" | "object" | "empty";
  action?: "mine_tile" | "place_tile" | "repair_object" | "rescue_object" | "feed_hatchling";
  label: string;
  x: number;
  y: number;
  tileX?: number;
  tileY?: number;
  amount?: number;
  distance?: number;
  targetId?: string;
  resource?: string;
  terrain?: string;
  buildResource?: string;
  yieldsResource?: string;
  objectRole?: string;
  stage?: string;
  locked?: boolean;
  cycle_index?: number;
  cycle_count?: number;
};

export type AxoActionAnimation =
  | "idle"
  | "swim"
  | "walk"
  | "mine"
  | "gather"
  | "build"
  | "repair"
  | "rescue"
  | "feed"
  | "talk"
  | "hatch"
  | "dash"
  | "jump"
  | "wall_slide"
  | "rest"
  | "play"
  | "eat"
  | "use";

export type AxoInteractionAnimation = {
  state: AxoActionAnimation;
  durationMs: number;
  hue: number;
};

export function axoActionAnimationForInteraction(
  interaction: Pick<PlayerInteraction, "kind" | "action">,
): AxoInteractionAnimation | null {
  if (interaction.action === "mine_tile") return { state: "mine", durationMs: 660, hue: 0xffc866 };
  if (interaction.action === "place_tile") return { state: "build", durationMs: 700, hue: 0x72e6a4 };
  if (interaction.action === "repair_object") return { state: "repair", durationMs: 760, hue: 0x73f0df };
  if (interaction.action === "rescue_object") return { state: "rescue", durationMs: 860, hue: 0x80ffc0 };
  if (interaction.action === "feed_hatchling") return { state: "feed", durationMs: 720, hue: 0xffd4ec };
  if (interaction.kind === "resource") return { state: "gather", durationMs: 620, hue: 0xbfe9ff };
  if (interaction.kind === "npc") return { state: "talk", durationMs: 620, hue: 0xffd4ec };
  if (interaction.kind === "building" || interaction.kind === "object") return { state: "use", durationMs: 620, hue: 0xaee9ff };
  return null;
}

export type PlayerMove = {
  entityId: string;
  x: number;
  y: number;
  tileX: number;
  tileY: number;
};

type PlayerTextState = {
  possessedEntityId: string | null;
  view_mode?: GameViewMode;
  control_mode?: "released" | "manual" | "codex";
  pilot_active?: boolean;
  player_tool: PlayerTool;
  player: {
    x: number;
    y: number;
    tile_x: number;
    tile_y: number;
    activity: string;
    locomotion?: "swim" | "grounded" | "jump" | "wall_slide";
    animation?: AxoActionAnimation;
    action_ms_remaining?: number;
    floor_y?: number;
    wall_contact?: PlayerWallContactState | null;
    velocity_x?: number;
    velocity_y?: number;
    jump_velocity_y?: number;
    jump_buffer_ms?: number;
    coyote_ms?: number;
    dash_ready?: boolean;
    dash_cooldown_ms?: number;
    blocked?: PlayerBlockState | null;
    hazard_contact?: PlayerHazardState | null;
    oxygen?: PlayerOxygenState;
  } | null;
  animated_entities?: {
    id: string;
    x: number;
    y: number;
    tile_x: number;
    tile_y: number;
    activity: string;
    animation: AxoActionAnimation;
    target_x?: number;
    target_y?: number;
    target_kind?: string;
    moving: boolean;
  }[];
  active_target?: PlayerInteraction | null;
  target_lock?: PlayerTargetLockState | null;
  lastInteraction: PlayerInteraction | null;
  nearby_interactions: PlayerInteraction[];
  task_interactions: PlayerInteraction[];
};

type PlayerTargetLockState = {
  key: string;
  kind: PlayerInteraction["kind"];
  label: string;
  targetId?: string;
  action?: PlayerInteraction["action"];
  index: number;
  count: number;
};

type PlayerHazardState = {
  id: string;
  label: string;
  role: string;
  x: number;
  y: number;
  tile_x: number;
  tile_y: number;
  distance: number;
  severity: number;
};

type PlayerOxygenState = {
  value: number;
  max: number;
  status: "stable" | "recovering" | "draining" | "low" | "critical";
  in_pocket: boolean;
  source: string | null;
};

type PlayerBlockState = {
  x: number;
  y: number;
  tile_x: number;
  tile_y: number;
  reason: "solid_tile" | "steep_rise";
  age_ms?: number;
};

type PlayerBlockEvent = PlayerBlockState & { at: number };
type PlayerWallContactState = {
  direction: -1 | 1;
  x: number;
  y: number;
  tile_x: number;
  tile_y: number;
  age_ms?: number;
};
type PlayerWallContactEvent = PlayerWallContactState & { at: number };
type CivTile = CivSessionSnapshot["world"]["tiles"][number];

type PlayerKeys = {
  left: Phaser.Input.Keyboard.Key[];
  right: Phaser.Input.Keyboard.Key[];
  up: Phaser.Input.Keyboard.Key[];
  down: Phaser.Input.Keyboard.Key[];
  dash: Phaser.Input.Keyboard.Key[];
  interact: Phaser.Input.Keyboard.Key[];
};

export type PlayerTool = "use" | "mine" | "build";
type GameViewMode = "play" | "observe" | "god";

export function CivilizationGameCanvas({
  snapshot,
  turnRunning = false,
  possessedEntityId = null,
  playerTool = "use",
  buildResource = "stone",
  gameMode = "play",
  pilotCommand = null,
  pilotActive = false,
  onPlayerInteract,
  onPlayerMove,
}: CivilizationGameCanvasProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<CivPhaserScene | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const snapshotRef = useRef(snapshot);

  useEffect(() => {
    snapshotRef.current = snapshot;
    sceneRef.current?.setSnapshot(snapshot);
    window.render_game_to_text = () => sceneRef.current?.renderToText() ?? renderSnapshotToText(snapshotRef.current, undefined, gameMode);
    window.advanceTime = (ms: number) => sceneRef.current?.advanceTime(ms);
  }, [snapshot, gameMode]);

  useEffect(() => {
    sceneRef.current?.setTurnRunning(turnRunning);
  }, [turnRunning]);

  useEffect(() => {
    sceneRef.current?.setPlayerControl(possessedEntityId, onPlayerInteract, onPlayerMove);
  }, [possessedEntityId, onPlayerInteract, onPlayerMove]);

  useEffect(() => {
    sceneRef.current?.setPlayerTool(playerTool, buildResource);
  }, [playerTool, buildResource]);

  useEffect(() => {
    sceneRef.current?.setGameMode(gameMode);
  }, [gameMode]);

  useEffect(() => {
    sceneRef.current?.setPilotCommand(pilotCommand);
  }, [pilotCommand]);

  useEffect(() => {
    sceneRef.current?.setPilotActive(pilotActive);
  }, [pilotActive]);

  useEffect(() => {
    if (!parentRef.current || gameRef.current) return;
    const scene = new CivPhaserScene(snapshotRef.current);
    sceneRef.current = scene;

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: parentRef.current,
      backgroundColor: "#03080d",
      render: { pixelArt: true, antialias: false },
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
      scene,
    });
    gameRef.current = game;
    game.canvas.tabIndex = 0;
    game.canvas.setAttribute("aria-label", "Axolotl civilization playfield");
    scene.setTurnRunning(turnRunning);
    scene.setPlayerControl(possessedEntityId, onPlayerInteract, onPlayerMove);
    scene.setPlayerTool(playerTool, buildResource);
    scene.setGameMode(gameMode);
    scene.setPilotCommand(pilotCommand);
    scene.setPilotActive(pilotActive);

    window.render_game_to_text = () => sceneRef.current?.renderToText() ?? renderSnapshotToText(snapshotRef.current, undefined, gameMode);
    window.advanceTime = (ms: number) => sceneRef.current?.advanceTime(ms);

    return () => {
      delete window.render_game_to_text;
      delete window.advanceTime;
      delete window.civCamera;
      sceneRef.current = null;
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="civ-canvas-shell">
      <div ref={parentRef} className="civ-canvas-host" aria-label="Axolotl civilization world" />
    </div>
  );
}

type AccSprite = { img: Phaser.GameObjects.Image; baseOffY: number };

type AxoSprite = {
  id: string;
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
  baseScale: number;
  frameBase: number;
  glow?: Phaser.GameObjects.Sprite;
  accessories: AccSprite[];
  accSignature: string;
  homeX: number;
  homeY: number;
  renderX: number;
  renderY: number;
  targetX?: number;
  targetY?: number;
  activity: string;
  facing: number;
  phase: number;
  wander: number;
  size: number;
  isEgg: boolean;
  glowMorph: boolean;
  born: number;
  workSeed: number;
  animState: AxoActionAnimation;
  animStartedAt: number;
  animUntil: number;
  animHue: number;
  actionOriginX?: number;
  actionOriginY?: number;
  actionTargetX?: number;
  actionTargetY?: number;
  appliedTint?: number;
};

type AxoVisualTarget = {
  x: number;
  y: number;
  kind: string;
  arriveRadius: number;
};

type Particle = { x: number; y: number; vx: number; vy: number; age: number; ttl: number; color: number; r: number; rise: boolean };
type Pulse = { x: number; y: number; age: number; ttl: number; hue: number };

class CivPhaserScene extends Phaser.Scene {
  private snapshot: CivSessionSnapshot;
  private turnRunning = false;
  private spritesReady = false;

  private worldW = 0;
  private worldH = 0;
  private bakeSig = "";
  private floorByCol: number[] = [];
  private substrateTiles = new Set<string>();

  private bgBase?: Phaser.GameObjects.Rectangle;
  private water?: Phaser.GameObjects.TileSprite;
  private wash?: Phaser.GameObjects.Graphics;
  private territory?: Phaser.GameObjects.Graphics;
  private depthGrad?: Phaser.GameObjects.Graphics;
  private skyGrad?: Phaser.GameObjects.Graphics;
  private substrate?: Phaser.GameObjects.Container;
  private caustics?: Phaser.GameObjects.Graphics;
  private shadows?: Phaser.GameObjects.Graphics;
  private resourceLayer?: Phaser.GameObjects.Container;
  private buildingLayer?: Phaser.GameObjects.Container;
  private effects?: Phaser.GameObjects.Graphics;
  private minimap?: Phaser.GameObjects.Graphics;
  private uiCam?: Phaser.Cameras.Scene2D.Camera;

  private axos = new Map<string, AxoSprite>();
  private knownBuildings = new Set<string>();
  private prevResourceSig = "";
  private prevBuildingSig = "";
  private particles: Particle[] = [];
  private pulses: Pulse[] = [];

  private possessedEntityId: string | null = null;
  private playerInteract?: (interaction: PlayerInteraction) => void;
  private playerMove?: (move: PlayerMove) => void;
  private playerKeys?: PlayerKeys;
  private playerTool: PlayerTool = "use";
  private buildResource = "stone";
  private gameMode: GameViewMode = "play";
  private pilotCommand: CivPilotCommand = null;
  private pilotActive = false;
  private lastPilotInteractNonce = 0;
  private lastInteractAt = 0;
  private lastInteractPressedAt = -Infinity;
  private interactWasDown = false;
  private lastInteraction: PlayerInteraction | null = null;
  private playerTargetLockKey: string | null = null;
  private lastPlayerLocomotion: "swim" | "grounded" | "jump" | "wall_slide" = "swim";
  private playerManualVelocityX = 0;
  private playerManualVelocityY = 0;
  private playerJumpVelocityX = 0;
  private playerJumpVelocityY = 0;
  private lastPlayerDashAt = -PLAYER_DASH_COOLDOWN_MS;
  private lastPlayerBlock: PlayerBlockEvent | null = null;
  private lastPlayerWallContact: PlayerWallContactEvent | null = null;
  private lastPlayerGroundedAt = -Infinity;
  private lastJumpPressedAt = -Infinity;
  private playerOxygen = 100;
  private wallKickControlUntil = 0;
  private dashWasDown = false;
  private jumpWasDown = false;
  private lastMoveSyncAt = 0;
  private lastMoveSyncTile = "";
  private playerEntryPlacedKey: string | null = null;
  private readonly handleDomPlayerKeyDown = (event: KeyboardEvent) => {
    if (!this.possessedEntityId || event.repeat || this.domControlFocused()) return;
    if (event.code === "Tab" || event.key === "Tab") {
      event.preventDefault();
      this.cyclePlayerTarget(event.shiftKey ? -1 : 1);
      return;
    }
    const isInteract = event.code === "KeyE"
      || event.key.toLowerCase() === "e"
      || event.code === "Space"
      || event.key === " "
      || event.key === "Spacebar";
    if (!isInteract) return;
    if (event.code === "Space" || event.key === " " || event.key === "Spacebar") event.preventDefault();
    this.lastInteractPressedAt = this.elapsed;
  };

  private elapsed = 0;
  private prevTurn = 0;
  private colony = { x: 0, y: 0 };
  // One framing point (world pixels) per civ; drives the multi-colony camera fit.
  private colonies: { civId: string; x: number; y: number; alive: boolean }[] = [];
  // Living-civ count from the previous snapshot — a shrink triggers a collapse re-frame.
  private prevLivingCount = -1;
  private civColorById = new Map<string, { tint: number; alive: boolean }>();

  private following = true;
  private dragging = false;
  private overMap = false;
  private dragX = 0;
  private dragY = 0;
  private minZoom = 0.2;
  private readonly maxZoom = 2.6;
  private framed = false;

  // minimap rect in screen space
  private mm = { x: 0, y: 0, w: 220, h: 130 };

  constructor(snapshot: CivSessionSnapshot) {
    super("CivPhaserScene");
    this.snapshot = snapshot;
    this.prevTurn = snapshot.turn;
  }

  preload() {
    this.load.spritesheet("civ-axolotls", "/civ/axolotl-animated-seeds.png", { frameWidth: 64, frameHeight: 64 });
    this.load.image("civ-water", "/civ/tiles/tile-water.png");
    this.load.image("egg", "/civ/stages/egg-single.png");
    for (const key of new Set(Object.values(TERRAIN_TILES))) this.load.image(key, `/civ/tiles/${key}.png`);
    for (const key of new Set(Object.values(RESOURCE_KEYS))) this.load.image(key, `/civ/resources/${key}.png`);
    for (const key of new Set(Object.values(BUILDING_KEYS))) this.load.image(key, `/civ/buildings/${key}.png`);
    for (const acc of ACCESSORIES) this.load.image(`acc-${acc}`, `/civ/accessories/acc-${acc}.png`);
  }

  create() {
    this.bgBase = this.add.rectangle(0, 0, 10, 10, 0x040a12).setOrigin(0, 0).setDepth(-20);
    this.water = this.add.tileSprite(0, 0, 10, 10, "civ-water").setOrigin(0, 0).setDepth(-12);
    this.water.setTileScale(TILE_SIZE / 256, TILE_SIZE / 256);
    this.wash = this.add.graphics().setDepth(-11);
    this.territory = this.add.graphics().setDepth(-10.5);
    this.depthGrad = this.add.graphics().setDepth(-10);
    this.skyGrad = this.add.graphics().setDepth(-9);
    this.substrate = this.add.container().setDepth(-7);
    this.caustics = this.add.graphics().setDepth(-6);
    this.shadows = this.add.graphics().setDepth(2);
    this.resourceLayer = this.add.container().setDepth(3);
    this.buildingLayer = this.add.container().setDepth(4);
    this.effects = this.add.graphics().setDepth(50);
    this.minimap = this.add.graphics().setDepth(1000).setScrollFactor(0);

    // The minimap lives on a separate UI camera so it stays screen-fixed and is
    // never scaled by the world camera's zoom.
    this.uiCam = this.cameras.add(0, 0, this.scale.width || 10, this.scale.height || 10);
    this.uiCam.setScroll(0, 0);
    this.cameras.main.ignore(this.minimap);
    this.uiCam.ignore(
      [
        this.bgBase, this.water, this.wash, this.territory, this.depthGrad, this.skyGrad,
        this.substrate, this.caustics, this.shadows, this.resourceLayer,
        this.buildingLayer, this.effects,
      ].filter(Boolean) as Phaser.GameObjects.GameObject[],
    );

    this.spritesReady = this.textures.exists("civ-axolotls");
    if (this.spritesReady) {
      for (let v = 0; v < VARIANT_COUNT; v += 1) {
        const key = `axo-${v}`;
        if (this.anims.exists(key)) continue;
        const frames = Array.from({ length: FRAMES_PER_VARIANT }, (_, i) => v * FRAMES_PER_VARIANT + i);
        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers("civ-axolotls", { frames }),
          frameRate: 4.5,
          repeat: -1,
        });
      }
    }

    this.installInput();
    this.installPlayerControls();
    window.addEventListener("keydown", this.handleDomPlayerKeyDown, { capture: true });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener("keydown", this.handleDomPlayerKeyDown, { capture: true });
    });
    this.installCameraApi();
    this.scale.on("resize", () => this.onResize());

    this.civColorById = buildCivColorMap(this.snapshot.civs);
    this.rebuildWorld();
    this.syncEntities();
    this.recomputeColony();
    this.recomputeColonies();
    // Seed the collapse baseline from the authoritative civ list (see MED-03 in
    // setSnapshot), not from however many colonies happened to resolve this frame.
    // `alive` is `false` only once collapsed; undefined defaults to living.
    this.prevLivingCount = (this.snapshot.civs ?? []).filter((c) => c.alive !== false).length;
    this.onResize();
  }

  // ── public bridge ────────────────────────────────────────────────────────
  setSnapshot(snapshot: CivSessionSnapshot) {
    if (snapshot.turn > this.prevTurn) this.spawnPulse(this.colony.x, this.colony.y, 0x6dd6a7);
    this.prevTurn = snapshot.turn;
    this.snapshot = snapshot;
    if (!this.sys?.isActive()) return;
    this.civColorById = buildCivColorMap(snapshot.civs);
    this.rebuildWorld();
    this.syncEntities();
    if (this.possessedEntityId && !this.axos.has(this.possessedEntityId)) {
      this.possessedEntityId = null;
      this.clearPlayerTargetLock();
    }
    this.recomputeColony();
    this.recomputeColonies();
    // Re-frame on collapse: when the living-civ count shrinks, drop the dead civ
    // from the default view. (World create/load re-frames via the `framed` flip.)
    // Count from the authoritative civ list, NOT this.colonies — a colony that is
    // alive but momentarily unresolvable (no home_region/entities/spawn_x) would
    // otherwise drop from the count and trigger a spurious collapse re-frame (MED-03).
    // `alive` is `false` only once collapsed; undefined defaults to living.
    const living = (this.snapshot.civs ?? []).filter((c) => c.alive !== false).length;
    if (this.prevLivingCount >= 0 && living < this.prevLivingCount && living > 0) {
      this.frameAll();
    }
    this.prevLivingCount = living;
  }

  setTurnRunning(running: boolean) {
    this.turnRunning = running;
  }

  setPlayerControl(
    entityId: string | null,
    onInteract?: (interaction: PlayerInteraction) => void,
    onMove?: (move: PlayerMove) => void,
  ) {
    const changed = entityId !== this.possessedEntityId;
    this.possessedEntityId = entityId;
    this.playerInteract = onInteract;
    this.playerMove = onMove;
    if (changed) {
      this.lastInteraction = null;
      this.clearPlayerTargetLock();
      this.playerManualVelocityX = 0;
      this.playerManualVelocityY = 0;
      this.playerJumpVelocityX = 0;
      this.playerJumpVelocityY = 0;
      this.jumpWasDown = false;
      this.lastPlayerGroundedAt = -Infinity;
      this.lastJumpPressedAt = -Infinity;
      this.lastInteractPressedAt = -Infinity;
      this.interactWasDown = false;
      this.lastPlayerLocomotion = "swim";
      this.lastPlayerWallContact = null;
      this.playerOxygen = 100;
      this.wallKickControlUntil = 0;
    }
    if (entityId) {
      this.following = true;
      const axo = this.axos.get(entityId);
      if (axo) {
        if (changed) this.maybePlacePlayerAtPlayableEntry(axo);
        if (this.sys?.isActive()) this.cameras.main.pan(axo.renderX, axo.renderY, 220, Phaser.Math.Easing.Sine.Out);
      }
    }
  }

  setPilotCommand(command: CivPilotCommand) {
    if (command) this.clearPlayerTargetLock();
    this.pilotCommand = command;
  }

  setPilotActive(active: boolean) {
    if (active && !this.pilotActive) this.clearPlayerTargetLock();
    this.pilotActive = active;
  }

  setPlayerTool(tool: PlayerTool, buildResource: string) {
    const nextBuildResource = placeableBuildResource(buildResource) ? buildResource : "stone";
    if (tool !== this.playerTool || nextBuildResource !== this.buildResource) this.clearPlayerTargetLock();
    this.playerTool = tool;
    this.buildResource = nextBuildResource;
  }

  setGameMode(mode: GameViewMode) {
    this.gameMode = mode;
    if (mode === "play") {
      const axo = this.playerAxo();
      if (axo) this.maybePlacePlayerAtPlayableEntry(axo);
    }
  }

  renderToText(): string {
    const axo = this.playerAxo();
    const hazardContact = axo ? this.playerHazardContact(axo) : null;
    const activeTarget = axo ? this.findPlayerInteraction(axo) : null;
    const playerAnimation = axo ? this.currentAxoAnimation(axo) : null;
    return renderSnapshotToText(this.snapshot, {
      possessedEntityId: this.possessedEntityId,
      view_mode: this.gameMode,
      control_mode: this.possessedEntityId ? this.pilotActive ? "codex" : "manual" : "released",
      pilot_active: this.pilotActive,
      player: axo
        ? {
            x: Math.round(axo.renderX),
            y: Math.round(axo.renderY),
            tile_x: Math.floor(axo.renderX / TILE_SIZE),
            tile_y: Math.floor(axo.renderY / TILE_SIZE),
            activity: "player",
            locomotion: this.lastPlayerLocomotion,
            animation: playerAnimation?.state,
            action_ms_remaining: playerAnimation?.active ? Math.max(0, Math.ceil(axo.animUntil - this.elapsed)) : 0,
            floor_y: Math.round(this.playerFloorY(axo.renderX)),
            wall_contact: this.recentPlayerWallContact(),
            velocity_x: Math.round(this.playerVelocityX() * 100) / 100,
            velocity_y: Math.round(this.playerVelocityY() * 100) / 100,
            jump_velocity_y: Math.round(this.playerJumpVelocityY * 100) / 100,
            jump_buffer_ms: this.jumpBufferMsRemaining(),
            coyote_ms: this.groundCoyoteMsRemaining(),
            dash_ready: this.elapsed - this.lastPlayerDashAt >= PLAYER_DASH_COOLDOWN_MS,
            dash_cooldown_ms: Math.max(0, Math.ceil(PLAYER_DASH_COOLDOWN_MS - (this.elapsed - this.lastPlayerDashAt))),
            blocked: this.recentPlayerBlock(),
            hazard_contact: hazardContact,
            oxygen: this.playerOxygenState(hazardContact),
          }
        : null,
      animated_entities: this.animatedEntityStates(),
      active_target: activeTarget,
      target_lock: this.targetLockState(activeTarget),
      lastInteraction: this.lastInteraction,
      nearby_interactions: axo ? this.nearbyInteractionOptions(axo) : [],
      task_interactions: axo ? this.taskInteractionOptions(axo) : [],
      player_tool: this.playerTool,
    });
  }

  advanceTime(ms: number) {
    const dt = Math.max(0, ms);
    this.elapsed += dt;
    if (this.sys?.isActive()) this.step(dt);
    for (const axo of this.axos.values()) {
      if ("anims" in axo.body) (axo.body as Phaser.GameObjects.Sprite).anims?.update(this.elapsed, dt);
    }
  }

  update(_time: number, delta: number) {
    this.elapsed += delta;
    this.step(delta);
  }

  // ── world (static, rebuilt only when the terrain signature changes) ───────
  private rebuildWorld() {
    const world = this.snapshot.world;
    this.worldW = world.width * TILE_SIZE;
    this.worldH = world.height * TILE_SIZE;
    const sig = `${world.width}x${world.height}:${this.snapshot.seed}:${terrainSignature(world.tiles)}`;

    this.cameras.main.setBounds(0, 0, this.worldW, this.worldH);
    this.bgBase?.setSize(this.worldW, this.worldH);
    this.water?.setSize(this.worldW, this.worldH);

    if (sig !== this.bakeSig) {
      this.bakeSig = sig;
      this.bakeTerrain();
      this.framed = false;
      // force a fresh draw of dynamic layers for the new world.
      this.prevResourceSig = "";
      this.prevBuildingSig = "";
      this.knownBuildings.clear();
    }
    this.drawResources();
    this.drawBuildings();
  }

  private bakeTerrain() {
    const world = this.snapshot.world;
    const W = world.width;
    const H = world.height;

    // floor (topmost substrate row) per column — used by substrate + minimap.
    this.floorByCol = new Array(W).fill(H);
    this.substrateTiles = new Set();
    for (const t of world.tiles) {
      if (!isSubstrate(t.terrain)) continue;
      this.substrateTiles.add(`${t.x},${t.y}`);
      if (t.y < this.floorByCol[t.x]) this.floorByCol[t.x] = t.y;
    }

    // water wash by region + a sky/depth gradient.
    this.wash?.clear();
    for (const region of world.regions ?? []) {
      const col = BIOME_WASH[region.biome];
      if (col === undefined) continue;
      this.wash?.fillStyle(col, 0.1);
      this.wash?.fillRect(region.x * TILE_SIZE, SURFACE_ROWS * TILE_SIZE, region.width * TILE_SIZE, this.worldH);
    }
    // per-owner territory overlay (civ-colour fill + border); unowned -> neutral.
    this.territory?.clear();
    const territoryTop = SURFACE_ROWS * TILE_SIZE;
    for (const region of world.regions ?? []) {
      const overlay = regionOverlayFor(region.owner, this.civColorById);
      if (!overlay) continue;
      const rx = region.x * TILE_SIZE;
      const rw = region.width * TILE_SIZE;
      const rh = this.worldH - territoryTop;
      this.territory?.fillStyle(overlay.tint, overlay.alive ? 0.14 : 0.06);
      this.territory?.fillRect(rx, territoryTop, rw, rh);
      this.territory?.lineStyle(2, overlay.tint, overlay.alive ? 0.6 : 0.25);
      this.territory?.strokeRect(rx, territoryTop, rw, rh);
    }
    this.depthGrad?.clear();
    const bands = 40;
    const top = SURFACE_ROWS * TILE_SIZE;
    for (let i = 0; i < bands; i += 1) {
      const f = i / (bands - 1);
      const y = top + f * (this.worldH - top);
      this.depthGrad?.fillStyle(0x020912, Math.min(0.6, f * f * 0.7));
      this.depthGrad?.fillRect(0, y, this.worldW, (this.worldH - top) / bands + 1);
    }
    this.skyGrad?.clear();
    for (let i = 0; i < SURFACE_ROWS * 2; i += 1) {
      const f = i / (SURFACE_ROWS * 2 - 1);
      this.skyGrad?.fillStyle(0x0a2230, (1 - f) * 0.9);
      this.skyGrad?.fillRect(0, (i * TILE_SIZE) / 2, this.worldW, TILE_SIZE / 2 + 1);
    }

    // substrate tiles as a container of images (off-screen ones cost ~nothing).
    this.substrate?.removeAll(true);
    for (const t of world.tiles) {
      const key = TERRAIN_TILES[t.terrain];
      if (!key || !this.textures.exists(key)) continue;
      const img = this.add.image(t.x * TILE_SIZE, t.y * TILE_SIZE, key).setOrigin(0, 0);
      img.setDisplaySize(TILE_SIZE + 0.5, TILE_SIZE + 0.5);
      // darken with depth below the seabed for a sense of mass.
      const d = t.y - this.floorByCol[t.x];
      if (d > 2) img.setTint(shade(0xffffff, Math.max(0.45, 1 - d * 0.05)));
      this.substrate?.add(img);
    }
  }

  private drawResources() {
    const layer = this.resourceLayer;
    if (!layer) return;
    let sig = "";
    for (const tile of this.snapshot.world.tiles) {
      if (tile.resource && tile.amount > 0) sig += `${tile.x},${tile.y},${tile.resource};`;
    }
    if (sig === this.prevResourceSig) return;
    this.prevResourceSig = sig;
    layer.removeAll(true);
    for (const tile of this.snapshot.world.tiles) {
      if (!tile.resource || tile.amount <= 0) continue;
      const key = RESOURCE_KEYS[tile.resource] ?? "res-food";
      if (!this.textures.exists(key)) continue;
      const px = tile.x * TILE_SIZE + TILE_SIZE / 2;
      const py = tile.y * TILE_SIZE + TILE_SIZE / 2;
      const img = this.add.image(px, py, key).setOrigin(0.5, 0.78);
      img.setDisplaySize(17, 17);
      img.setDepth(tile.y * 0.01);
      if (tile.resource === "glowshards" || tile.resource === "pearls") {
        img.setData("glow", true);
        img.setBlendMode(Phaser.BlendModes.ADD);
        img.setAlpha(0.92);
      }
      layer.add(img);
    }
  }

  private drawBuildings() {
    const layer = this.buildingLayer;
    if (!layer) return;
    let sig = "";
    for (const e of this.snapshot.world.entities) {
      if (e.kind === "building" || e.kind === "object") sig += `${e.id},${e.kind},${e.x},${e.y},${e.role},${e.activity},${e.civ_id ?? ""},${Math.round(e.health ?? 0)};`;
    }
    if (sig === this.prevBuildingSig) return;
    this.prevBuildingSig = sig;
    layer.removeAll(true);
    const seen = new Set<string>();
    for (const entity of this.snapshot.world.entities) {
      if (entity.kind !== "building" && entity.kind !== "object") continue;
      seen.add(entity.id);
      if (entity.kind === "object") {
        this.drawWorldObject(layer, entity);
        continue;
      }
      const key = BUILDING_KEYS[entity.role] ?? "bld-storage";
      if (!this.textures.exists(key)) continue;
      const px = entity.x * TILE_SIZE + TILE_SIZE / 2;
      const py = entity.y * TILE_SIZE + TILE_SIZE / 2;
      const img = this.add.image(px, py, key).setOrigin(0.5, 0.84);
      const big = entity.role === "pond" ? 58 : entity.role === "nest" ? 44 : 40;
      img.setDisplaySize(big, big);
      img.setDepth(entity.y * 0.02);
      layer.add(img);
      const buildingInfo = this.civColorById.get(entity.civ_id ?? "");
      const buildingTint = civTintFor(buildingInfo, GREY_TINT);
      if (buildingTint != null) img.setTint(buildingTint);
      if (this.isConstructionSite(entity)) this.drawConstructionOverlay(layer, entity, px, py, big);
      if (!this.knownBuildings.has(entity.id)) {
        this.spawnPulse(px, py - 6, 0xaee9ff);
        this.tweens.add({ targets: img, scaleX: img.scaleX * 1.12, scaleY: img.scaleY * 1.12, yoyo: true, duration: 240, ease: "Sine.out" });
      }
    }
    this.knownBuildings = seen;
  }

  private isConstructionSite(entity: CivEntity) {
    return entity.kind === "building" && (entity.activity === "construction" || (entity.health ?? 100) < 95);
  }

  private drawConstructionOverlay(layer: Phaser.GameObjects.Container, entity: CivEntity, px: number, py: number, size: number) {
    const progress = Phaser.Math.Clamp((entity.health ?? 0) / 100, 0, 1);
    const g = this.add.graphics();
    g.setDepth(entity.y * 0.02 + 0.36);
    g.lineStyle(2, 0x061114, 0.78);
    g.strokeRoundedRect(px - size * 0.38, py - size * 0.56, size * 0.76, size * 0.68, 5);
    g.lineStyle(1.6, 0xffd36e, 0.86);
    g.lineBetween(px - size * 0.36, py - size * 0.46, px + size * 0.36, py - size * 0.12);
    g.lineBetween(px + size * 0.36, py - size * 0.46, px - size * 0.36, py - size * 0.12);
    g.fillStyle(0x061114, 0.72);
    g.fillRoundedRect(px - 18, py + size * 0.04, 36, 6, 3);
    g.fillStyle(0x72e6a4, 0.92);
    g.fillRoundedRect(px - 17, py + size * 0.04 + 1, 34 * progress, 4, 2);
    layer.add(g);
  }

  private drawWorldObject(layer: Phaser.GameObjects.Container, entity: CivEntity) {
    const px = entity.x * TILE_SIZE + TILE_SIZE / 2;
    const py = entity.y * TILE_SIZE + TILE_SIZE / 2 - 4;
    if (entity.role === "trapped") {
      this.drawTrappedObject(layer, entity, px, py);
      return;
    }
    if (entity.role === "bridge") {
      this.drawBridgeObject(layer, entity, px, py);
      return;
    }
    if (entity.role === "seep" || entity.role === "leak" || entity.role === "oxygen") {
      this.drawHazardVentObject(layer, entity, px, py);
      return;
    }
    const fixed = entity.activity === "repaired" || (entity.health ?? 0) >= 95;
    const body = this.add.graphics();
    body.setDepth(entity.y * 0.02 + 0.2);
    body.lineStyle(3, 0x061114, 0.68);
    body.fillStyle(fixed ? 0x5bd49b : 0xc96a4a, 0.86);
    body.fillRoundedRect(px - 14, py - 10, 28, 20, 5);
    body.strokeRoundedRect(px - 14, py - 10, 28, 20, 5);
    body.lineStyle(2, fixed ? 0xc4ffe0 : 0xffd08c, 0.9);
    body.strokeRoundedRect(px - 10, py - 6, 20, 12, 4);
    body.lineStyle(2, 0x061114, 0.72);
    if (fixed) {
      body.lineBetween(px - 7, py, px - 1, py + 5);
      body.lineBetween(px - 1, py + 5, px + 8, py - 5);
      body.lineStyle(1.5, 0xd7ffe9, 0.88);
      body.lineBetween(px - 7, py - 1, px - 1, py + 4);
      body.lineBetween(px - 1, py + 4, px + 8, py - 6);
    } else {
      body.lineBetween(px - 2, py - 8, px + 1, py - 2);
      body.lineBetween(px + 1, py - 2, px - 3, py + 3);
      body.lineBetween(px - 3, py + 3, px + 3, py + 9);
      body.lineStyle(1.5, 0xffe0b0, 0.86);
      body.lineBetween(px + 5, py - 8, px + 1, py - 2);
      body.lineBetween(px + 1, py - 2, px + 7, py + 5);
    }
    layer.add(body);
    if (!this.knownBuildings.has(entity.id)) {
      this.spawnPulse(px, py - 2, fixed ? 0x80ffc0 : 0xffc866);
    }
  }

  private drawTrappedObject(layer: Phaser.GameObjects.Container, entity: CivEntity, px: number, py: number) {
    const rescued = entity.activity === "rescued";
    const body = this.add.graphics();
    body.setDepth(entity.y * 0.02 + 0.25);
    body.fillStyle(rescued ? 0x7ee6b7 : 0x78d8ff, rescued ? 0.72 : 0.54);
    body.lineStyle(3, 0x061114, 0.66);
    body.fillCircle(px, py, 14);
    body.strokeCircle(px, py, 14);
    body.lineStyle(2, rescued ? 0xd8ffea : 0xd8f8ff, 0.88);
    body.strokeCircle(px, py, 10);
    body.fillStyle(rescued ? 0xffe7ef : 0xffd2df, 0.95);
    body.fillEllipse(px, py + 2, 16, 10);
    body.fillStyle(0x2a1822, 0.92);
    body.fillCircle(px - 4, py, 1.5);
    body.fillCircle(px + 4, py, 1.5);
    body.lineStyle(1.5, 0x2a1822, 0.8);
    if (rescued) {
      body.lineBetween(px - 4, py + 4, px - 1, py + 6);
      body.lineBetween(px - 1, py + 6, px + 5, py + 2);
    } else {
      body.arc(px, py + 3, 4, Math.PI * 0.08, Math.PI * 0.92, false);
    }
    body.fillStyle(0xffffff, 0.7);
    body.fillCircle(px - 5, py - 7, 2.2);
    layer.add(body);
    if (!this.knownBuildings.has(entity.id)) {
      this.spawnPulse(px, py - 2, rescued ? 0x80ffc0 : 0x78d8ff);
    }
  }

  private drawBridgeObject(layer: Phaser.GameObjects.Container, entity: CivEntity, px: number, py: number) {
    const built = entity.activity === "built" || (entity.health ?? 0) >= 95;
    const body = this.add.graphics();
    body.setDepth(entity.y * 0.02 + 0.23);
    const color = built ? 0x79dfa3 : 0xffd06d;
    body.lineStyle(3, 0x061114, 0.66);
    body.fillStyle(0x061114, 0.46);
    body.fillRoundedRect(px - 18, py - 11, 36, 22, 5);
    body.strokeRoundedRect(px - 18, py - 11, 36, 22, 5);
    body.fillStyle(color, built ? 0.72 : 0.52);
    for (let i = -1; i <= 1; i += 1) {
      body.fillRoundedRect(px + i * 11 - 4, py - 6, 8, 13, 3);
    }
    body.lineStyle(2, color, 0.9);
    body.lineBetween(px - 18, py + 2, px + 18, py + 2);
    body.lineStyle(2, 0xffffff, 0.45);
    body.lineBetween(px - 12, py - 8, px - 12, py - 17);
    body.fillStyle(built ? 0xc9ffe0 : 0xfff2b8, 0.9);
    body.fillTriangle(px - 12, py - 17, px - 12, py - 9, px + 1, py - 13);
    if (!built) {
      body.lineStyle(1.5, 0x061114, 0.7);
      body.lineBetween(px - 20, py + 12, px + 20, py - 12);
      body.lineStyle(1.2, 0xfff0b8, 0.78);
      body.lineBetween(px - 17, py + 10, px + 17, py - 10);
    }
    layer.add(body);
    if (!this.knownBuildings.has(entity.id)) {
      this.spawnPulse(px, py - 2, color);
    }
  }

  private drawHazardVentObject(layer: Phaser.GameObjects.Container, entity: CivEntity, px: number, py: number) {
    const active = this.isHazardActive(entity);
    const sealed = !active || entity.activity === "sealed" || (entity.health ?? 0) >= 95;
    const leak = entity.role === "leak";
    const oxygen = entity.role === "oxygen";
    const body = this.add.graphics();
    body.setDepth(entity.y * 0.02 + 0.24);
    body.lineStyle(3, 0x061114, 0.68);
    body.fillStyle(sealed ? 0x5a6f72 : oxygen ? 0x3d3f86 : leak ? 0x2e6973 : 0x7c5336, sealed ? 0.58 : 0.86);
    body.fillRoundedRect(px - 13, py - 7, 26, 14, 5);
    body.strokeRoundedRect(px - 13, py - 7, 26, 14, 5);
    body.lineStyle(2, sealed ? 0x9fb8bd : oxygen ? 0xbfc3ff : leak ? 0x79f0e2 : 0xffb35f, sealed ? 0.58 : 0.9);
    body.lineBetween(px - 10, py + 1, px + 10, py + 1);
    if (sealed) {
      body.lineStyle(2, 0xb7c9cf, 0.78);
      body.lineBetween(px - 7, py - 3, px + 7, py + 4);
      body.lineBetween(px + 7, py - 3, px - 7, py + 4);
    } else if (oxygen) {
      body.fillStyle(0xd8dcff, 0.84);
      body.fillCircle(px - 6, py - 3, 2.6);
      body.fillCircle(px + 2, py - 4, 2.1);
      body.fillCircle(px + 7, py + 1, 1.8);
      body.lineStyle(1.5, 0xe6e8ff, 0.75);
      body.strokeCircle(px - 6, py - 13, 5);
      body.strokeCircle(px + 7, py - 18, 3.8);
    } else {
      body.fillStyle(leak ? 0xa5fff0 : 0xffc66f, 0.78);
      body.fillCircle(px - 4, py - 3, 2.3);
      body.fillCircle(px + 4, py - 3, 2.3);
      body.lineStyle(1.5, leak ? 0xb8fff5 : 0xffe2a1, 0.75);
      body.lineBetween(px - 8, py - 10, px - 5, py - 18);
      body.lineBetween(px, py - 8, px + 2, py - 21);
      body.lineBetween(px + 8, py - 10, px + 5, py - 17);
    }
    layer.add(body);
    if (!this.knownBuildings.has(entity.id)) {
      this.spawnPulse(px, py - 2, sealed ? 0x9fb8bd : oxygen ? 0xbfc3ff : leak ? 0x73f0df : 0xff9a4f);
    }
  }

  // ── entities (persistent pool, diffed per snapshot) ───────────────────────
  private syncEntities() {
    const present = new Set<string>();
    for (const entity of this.snapshot.world.entities) {
      if (entity.kind === "building" || entity.kind === "object") continue;
      present.add(entity.id);
      const existing = this.axos.get(entity.id);
      if (existing) this.updateAxo(existing, entity);
      else this.axos.set(entity.id, this.createAxo(entity));
    }
    for (const [id, axo] of [...this.axos]) {
      if (present.has(id)) continue;
      this.fadeOutAxo(axo);
      this.axos.delete(id);
    }
  }

  // Multiply-tint the body by the owning civ's colour (lightened so morph/GFP
  // detail still reads), grey for a dead civ. Wild fauna (civ_id == null → map
  // miss) keeps its default morph tint. Re-applies ONLY when the wanted tint
  // differs from the last applied value (no per-frame whole-world re-tint).
  private applyCivTint(axo: AxoSprite, entity: CivEntity) {
    const info = this.civColorById.get(entity.civ_id ?? "");
    const wanted = civTintFor(info, GREY_TINT);
    if (wanted == null) {
      // Wild fauna / map miss. If a civ tint was previously applied (owned->wild
      // transition), clear it so the sprite returns to its default morph tint
      // rather than keeping the old civ's colour forever (MED-02).
      if (axo.appliedTint !== undefined) {
        axo.body.clearTint();
        axo.appliedTint = undefined;
      }
      return;
    }
    if (axo.appliedTint === wanted) return;
    axo.body.setTint(wanted);
    axo.appliedTint = wanted;
  }

  private createAxo(entity: CivEntity): AxoSprite {
    const px = entity.x * TILE_SIZE + TILE_SIZE / 2;
    const py = entity.y * TILE_SIZE + TILE_SIZE / 2 - 6;
    const isEgg = entity.kind === "egg" || entity.stage === "egg";
    const container = this.add.container(px, py);
    container.setDepth(8 + entity.y * 0.02);
    this.uiCam?.ignore(container);

    let body: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
    let glow: Phaser.GameObjects.Sprite | undefined;
    let frameBase = 0;
    const glowMorph = ["gfp", "mystic", "firefly"].includes(entity.morph ?? "");

    if (isEgg) {
      body = this.add.image(0, 0, this.textures.exists("egg") ? "egg" : "civ-water");
      body.setDisplaySize(13, 13);
    } else if (this.spritesReady) {
      const variant = morphVariant(entity, this.snapshot.seed);
      frameBase = variant * FRAMES_PER_VARIANT;
      const s = this.add.sprite(0, 0, "civ-axolotls", variant * FRAMES_PER_VARIANT);
      s.setDisplaySize(38, 38);
      s.play({ key: `axo-${variant}`, startFrame: hashInt(entity.id) % FRAMES_PER_VARIANT });
      body = s;
      if (glowMorph) {
        // a second sprite playing the same swim cycle, so the halo tracks the body's pose.
        const g = this.add.sprite(0, 0, "civ-axolotls", variant * FRAMES_PER_VARIANT);
        g.play({ key: `axo-${variant}`, startFrame: hashInt(entity.id) % FRAMES_PER_VARIANT });
        g.setDisplaySize(57, 57);
        g.setTint(morphGlowTint(entity.morph));
        g.setAlpha(0.16);
        g.setBlendMode(Phaser.BlendModes.ADD);
        container.add(g);
        glow = g;
      }
    } else {
      body = this.add.image(0, 0, "civ-water");
      body.setDisplaySize(12, 12);
      body.setTint(0xef9bc0);
    }
    container.add(body);

    const axo: AxoSprite = {
      id: entity.id,
      container,
      body,
      baseScale: body.scaleX,
      frameBase,
      glow,
      accessories: [],
      accSignature: "",
      homeX: px,
      homeY: py,
      renderX: px,
      renderY: py,
      activity: entity.activity ?? "",
      facing: 1,
      phase: (hashInt(entity.id) % 360) * 0.0175,
      wander: 1 + (hashInt(entity.id) % 3) * 0.6,
      size: isEgg ? 1 : clampSize(entity.size),
      isEgg,
      glowMorph,
      born: this.elapsed,
      workSeed: (hashInt(entity.id) % 100) * 0.1,
      animState: !isEgg && entity.stage === "hatchling" && (entity.age ?? 99) <= 1 ? "hatch" : "idle",
      animStartedAt: this.elapsed,
      animUntil: !isEgg && entity.stage === "hatchling" && (entity.age ?? 99) <= 1 ? this.elapsed + 1400 : this.elapsed,
      animHue: 0xffd4ec,
    };
    if (axo.animState === "hatch") {
      this.spawnPulse(px, py, axo.animHue);
      for (let i = 0; i < 14; i += 1) {
        this.spawnParticle(px + rand(-8, 8), py + rand(-8, 8), rand(-0.24, 0.24), rand(-0.58, -0.08), i % 2 === 0 ? 0xffd4ec : 0xc7f2ff, true);
      }
    }
    this.syncAccessories(axo, entity);
    this.applyTarget(axo, entity);
    this.applyCivTint(axo, entity);
    return axo;
  }

  private updateAxo(axo: AxoSprite, entity: CivEntity) {
    const playerControlled = entity.id === this.possessedEntityId && entity.kind === "axolotl" && entity.stage !== "egg";
    axo.homeX = playerControlled ? axo.renderX : entity.x * TILE_SIZE + TILE_SIZE / 2;
    axo.homeY = playerControlled ? axo.renderY : entity.y * TILE_SIZE + TILE_SIZE / 2 - 6;
    axo.activity = playerControlled ? "player" : entity.activity ?? "";
    axo.container.setDepth(8 + entity.y * 0.02);
    const nowEgg = entity.kind === "egg" || entity.stage === "egg";
    axo.size = nowEgg ? 1 : clampSize(entity.size);
    if (nowEgg !== axo.isEgg) {
      // stage flipped (egg hatched) — rebuild the body cleanly.
      this.fadeOutAxo(axo);
      this.axos.set(entity.id, this.createAxo(entity));
      return;
    }
    this.syncAccessories(axo, entity);
    if (playerControlled) {
      axo.targetX = undefined;
      axo.targetY = undefined;
    } else {
      this.applyTarget(axo, entity);
    }
    this.applyCivTint(axo, entity);
  }

  private applyTarget(axo: AxoSprite, entity: CivEntity) {
    if (typeof entity.target_x === "number" && typeof entity.target_y === "number") {
      axo.targetX = entity.target_x * TILE_SIZE + TILE_SIZE / 2;
      axo.targetY = entity.target_y * TILE_SIZE + TILE_SIZE / 2 - 4;
    } else {
      axo.targetX = undefined;
      axo.targetY = undefined;
    }
  }

  private syncAccessories(axo: AxoSprite, entity: CivEntity) {
    const worn = entity.accessories ?? [];
    const sig = worn.join(",");
    if (sig === axo.accSignature) return;
    axo.accSignature = sig;
    for (const a of axo.accessories) a.img.destroy();
    axo.accessories = [];
    if (axo.isEgg) return;
    for (const acc of worn) {
      const key = `acc-${acc}`;
      if (!this.textures.exists(key)) continue;
      const baseOffY = (ACC_OFFSET[acc] ?? -0.42) * 38;
      const img = this.add.image(0, baseOffY, key).setOrigin(0.5, 0.5);
      img.setDisplaySize(38 * (ACC_SCALE[acc] ?? 0.6), 38 * (ACC_SCALE[acc] ?? 0.6));
      img.setDepth(1);
      axo.container.add(img);
      axo.accessories.push({ img, baseOffY });
    }
  }

  private fadeOutAxo(axo: AxoSprite) {
    const sign = axo.container.scaleX < 0 ? -1 : 1;
    this.tweens.add({
      targets: axo.container,
      alpha: 0,
      scaleX: sign * axo.size * 0.4,
      scaleY: axo.size * 0.4,
      duration: 300,
      ease: "Sine.in",
      onComplete: () => axo.container.destroy(),
    });
  }

  // ── per-frame ─────────────────────────────────────────────────────────────
  private step(dt: number) {
    const dtN = Math.min(dt, 60) / 16.67;
    const cam = this.cameras.main;
    this.updatePlayerControl(dtN);
    const followTarget = this.playerAxo();
    const focusX = followTarget?.renderX ?? this.colony.x;
    const focusY = followTarget?.renderY ?? this.colony.y;
    if (this.following && this.sys.isActive() && !cam.panEffect.isRunning && !this.dragging) {
      cam.scrollX += (focusX - cam.midPoint.x) * Math.min(1, 0.06 * dtN);
      cam.scrollY += (focusY - cam.midPoint.y) * Math.min(1, 0.06 * dtN);
    }
    this.animateCaustics();
    this.animateEntities(dtN);
    this.animateEffects(dt, dtN);
    this.drawMinimap();
  }

  private animateCaustics() {
    const g = this.caustics;
    if (!g) return;
    g.clear();
    const t = this.elapsed * 0.0011;
    const top = SURFACE_ROWS * TILE_SIZE;
    const bottom = top + 13 * TILE_SIZE;
    const view = this.cameras.main.worldView;
    const x0 = Math.max(0, view.x - 80);
    const x1 = Math.min(this.worldW, view.right + 80);
    for (let i = 0; i < 9; i += 1) {
      const x = x0 + ((i * 211 + this.elapsed * 0.02) % (x1 - x0 + 200)) - 100;
      const a = 0.04 + 0.035 * Math.sin(t * 2 + i);
      g.fillStyle(0xbff4ff, a);
      g.fillTriangle(x, top, x + 40, top, x - 70, bottom);
    }
    for (let x = Math.floor(x0 / 8) * 8; x < x1; x += 8) {
      const a = 0.03 + 0.045 * Math.sin(x * 0.08 + t * 6);
      g.fillStyle(0xffffff, a);
      g.fillRect(x, top - 1, 6, 1);
    }
  }

  private triggerAxoActionAnimation(
    entityId: string | undefined,
    state: AxoActionAnimation,
    durationMs: number,
    hue: number,
    target?: { x: number; y: number },
  ) {
    if (!entityId) return;
    const axo = this.axos.get(entityId);
    if (!axo || axo.isEgg) return;
    axo.animState = state;
    axo.animStartedAt = this.elapsed;
    axo.animUntil = this.elapsed + durationMs;
    axo.animHue = hue;
    axo.actionOriginX = axo.renderX;
    axo.actionOriginY = axo.renderY;
    if (target) {
      axo.actionTargetX = target.x;
      axo.actionTargetY = target.y;
    } else {
      axo.actionTargetX = undefined;
      axo.actionTargetY = undefined;
    }
  }

  private currentAxoAnimation(axo: AxoSprite): { state: AxoActionAnimation; active: boolean; progress: number; hue: number } {
    const active = this.elapsed < axo.animUntil;
    if (active) {
      const duration = Math.max(1, axo.animUntil - axo.animStartedAt);
      return {
        state: axo.animState,
        active: true,
        progress: Math.max(0, Math.min(1, (this.elapsed - axo.animStartedAt) / duration)),
        hue: axo.animHue,
      };
    }
    return { state: this.ambientAxoAnimation(axo), active: false, progress: 0, hue: axo.animHue };
  }

  private ambientAxoAnimation(axo: AxoSprite): AxoActionAnimation {
    if (axo.isEgg) return "idle";
    const playerControlled = axo.id === this.possessedEntityId;
    if (playerControlled && this.elapsed - this.lastPlayerDashAt < 320) return "dash";
    if (playerControlled) {
      if (this.lastPlayerLocomotion === "wall_slide") return "wall_slide";
      if (this.lastPlayerLocomotion === "jump") return "jump";
      if (this.lastPlayerLocomotion === "grounded") return Math.abs(this.playerVelocityX()) > 0.08 ? "walk" : "rest";
      return Math.hypot(this.playerVelocityX(), this.playerVelocityY()) > 0.08 ? "swim" : "idle";
    }
    if (axo.activity === "gather") return "gather";
    if (axo.activity === "eat") return "eat";
    if (axo.activity === "build") return "build";
    if (axo.activity === "rest") return "rest";
    if (axo.activity === "play") return "play";
    if (axo.targetX !== undefined && axo.targetY !== undefined) return "swim";
    const visualTarget = this.visualActivityTarget(axo, axo.activity);
    if (visualTarget && dist(axo.renderX, axo.renderY, visualTarget.x, visualTarget.y) > visualTarget.arriveRadius + 8) return "swim";
    return "idle";
  }

  private applyAxoFrame(axo: AxoSprite, anim: { state: AxoActionAnimation; active: boolean; progress: number }) {
    if (axo.isEgg || !(axo.body instanceof Phaser.GameObjects.Sprite)) return;
    const offset = this.axoFrameOffset(axo, anim);
    axo.body.setFrame(axo.frameBase + offset);
    axo.glow?.setFrame(axo.frameBase + offset);
  }

  private axoFrameOffset(axo: AxoSprite, anim: { state: AxoActionAnimation; active: boolean; progress: number }) {
    const seq = (frames: number[]) => {
      const idx = Math.min(frames.length - 1, Math.max(0, Math.floor(anim.progress * frames.length)));
      return frames[idx] % FRAMES_PER_VARIANT;
    };
    const loop = (speed: number) => Math.floor(this.elapsed * speed + axo.phase * 10) % FRAMES_PER_VARIANT;
    if (anim.active) {
      switch (anim.state) {
        case "mine": return seq([0, 1, 2, 3, 2, 1]);
        case "gather":
        case "feed": return seq([0, 1, 0, 2, 1]);
        case "build":
        case "repair": return seq([1, 2, 3, 2, 1]);
        case "rescue": return seq([2, 3, 2, 1, 0]);
        case "talk": return seq([0, 1, 0, 1]);
        case "hatch": return seq([0, 1, 2, 3, 3, 2]);
        case "dash": return seq([3, 2, 1]);
        case "jump": return 2;
        case "wall_slide": return 1;
        case "use": return seq([0, 2, 1]);
        default: break;
      }
    }
    switch (anim.state) {
      case "swim": return loop(0.010);
      case "walk": return loop(0.018);
      case "gather":
      case "eat": return loop(0.021);
      case "build":
      case "repair": return loop(0.024);
      case "play": return loop(0.026);
      case "dash": return loop(0.036);
      case "jump": return 2;
      case "wall_slide": return 1;
      case "rest": return Math.floor(this.elapsed * 0.004 + axo.phase) % 2;
      default: return Math.floor(this.elapsed * 0.006 + axo.phase) % 2;
    }
  }

  private animatedEntityStates() {
    return Array.from(this.axos.values()).slice(0, 28).map((axo) => {
      const anim = this.currentAxoAnimation(axo);
      const liveTarget = this.liveAxoTarget(axo, anim);
      return {
        id: axo.id,
        x: Math.round(axo.renderX),
        y: Math.round(axo.renderY),
        tile_x: Math.floor(axo.renderX / TILE_SIZE),
        tile_y: Math.floor(axo.renderY / TILE_SIZE),
        activity: axo.activity,
        animation: anim.state,
        ...(liveTarget ? {
          target_x: Math.round(liveTarget.x),
          target_y: Math.round(liveTarget.y),
          target_kind: liveTarget.kind,
        } : {}),
        moving: Boolean(liveTarget && dist(axo.renderX, axo.renderY, liveTarget.x, liveTarget.y) > liveTarget.arriveRadius),
      };
    });
  }

  private liveAxoTarget(axo: AxoSprite, anim: { state: AxoActionAnimation; active: boolean; progress: number }): AxoVisualTarget | null {
    const actionTarget = this.actionMovementTarget(axo, anim);
    if (actionTarget) return actionTarget;
    if (axo.targetX !== undefined && axo.targetY !== undefined) {
      return { x: axo.targetX, y: axo.targetY, kind: "snapshot", arriveRadius: 18 };
    }
    if (axo.id === this.possessedEntityId) return null;
    return this.visualActivityTarget(axo, axo.activity);
  }

  private actionMovementTarget(axo: AxoSprite, anim: { state: AxoActionAnimation; active: boolean; progress: number }): AxoVisualTarget | null {
    if (!anim.active || axo.actionTargetX === undefined || axo.actionTargetY === undefined) return null;
    const ox = axo.actionOriginX ?? axo.renderX;
    const oy = axo.actionOriginY ?? axo.renderY;
    const dx = axo.actionTargetX - ox;
    const dy = axo.actionTargetY - oy;
    const d = Math.hypot(dx, dy);
    if (d < 2) return null;
    const stop = anim.state === "talk" || anim.state === "feed" || anim.state === "eat" ? 18 : 9;
    const maxTravel = anim.state === "dash"
      ? 70
      : anim.state === "mine" || anim.state === "build" || anim.state === "repair" || anim.state === "rescue"
        ? 46
        : 34;
    const travel = Math.max(0, Math.min(maxTravel, d - stop));
    if (travel <= 1) return null;
    const surge = Math.sin(anim.progress * Math.PI);
    return {
      x: ox + (dx / d) * travel * surge,
      y: oy + (dy / d) * travel * surge,
      kind: `action:${anim.state}`,
      arriveRadius: 4,
    };
  }

  private visualActivityTarget(axo: AxoSprite, activity: string): AxoVisualTarget | null {
    if (axo.isEgg || activity === "player" || activity === "rest") return null;
    const t = this.elapsed * 0.001 + axo.phase;
    if (activity === "gather" || activity === "eat") {
      const resource = this.resourceActivityBase(axo);
      if (resource) {
        return activity === "eat"
          ? this.withAxoOrbit(resource, axo, 8, 4, "resource")
          : this.commuteAxoTarget(resource, axo, 14, 8, "resource", 9200);
      }
    }
    if (activity === "build" || activity === "repair" || activity === "rescue") {
      const work = this.workObjectActivityBase(axo, activity);
      if (work) return this.commuteAxoTarget(work, axo, 12, 6, work.kind, 10400);
    }
    if (activity === "play") {
      return this.clampedAxoTarget(
        axo.homeX + Math.sin(t * 1.7 + axo.workSeed) * (46 + axo.wander * 10),
        axo.homeY + Math.cos(t * 1.25) * 28,
        "play_patrol",
        10,
      );
    }
    if (activity === "explore") {
      return this.clampedAxoTarget(
        axo.homeX + Math.sin(t * 0.85 + axo.workSeed) * 86,
        axo.homeY + Math.cos(t * 0.7) * 46,
        "explore_patrol",
        12,
      );
    }
    if (!activity) {
      return this.clampedAxoTarget(
        axo.homeX + Math.sin(t * 0.62 + axo.workSeed) * (24 + axo.wander * 11),
        axo.homeY + Math.cos(t * 0.5 + axo.phase) * 16,
        "idle_patrol",
        8,
      );
    }
    return this.clampedAxoTarget(
      axo.homeX + Math.sin(t * 0.9 + axo.workSeed) * 32,
      axo.homeY + Math.cos(t * 0.8) * 18,
      "activity_patrol",
      10,
    );
  }

  private withAxoOrbit(base: AxoVisualTarget, axo: AxoSprite, radiusX: number, radiusY: number, kind: string): AxoVisualTarget {
    const t = this.elapsed * 0.0016 + axo.phase + axo.workSeed;
    return this.clampedAxoTarget(
      base.x + Math.sin(t) * radiusX,
      base.y + Math.cos(t * 1.15) * radiusY,
      kind,
      base.arriveRadius,
    );
  }

  private commuteAxoTarget(base: AxoVisualTarget, axo: AxoSprite, radiusX: number, radiusY: number, kind: string, cycleMs: number): AxoVisualTarget {
    const seed = hashInt(`${axo.id}:${kind}`) % cycleMs;
    const phase = ((this.elapsed + seed) % cycleMs) / cycleMs;
    const smooth = (v: number) => v * v * (3 - 2 * v);
    const route = phase < 0.36
      ? smooth(phase / 0.36)
      : phase < 0.58
        ? 1
        : phase < 0.92
          ? smooth(1 - (phase - 0.58) / 0.34)
          : 0;
    const t = this.elapsed * 0.0018 + axo.phase + axo.workSeed;
    const orbitStrength = Math.max(0, Math.min(1, (route - 0.72) / 0.28));
    const workX = base.x + Math.sin(t) * radiusX * orbitStrength;
    const workY = base.y + Math.cos(t * 1.15) * radiusY * orbitStrength;
    return this.clampedAxoTarget(
      axo.homeX + (workX - axo.homeX) * route,
      axo.homeY + (workY - axo.homeY) * route,
      route > 0.12 && route < 0.88 ? `${kind}:commute` : kind,
      route > 0.12 && route < 0.88 ? 10 : base.arriveRadius,
    );
  }

  private clampedAxoTarget(x: number, y: number, kind: string, arriveRadius: number): AxoVisualTarget {
    return {
      x: Phaser.Math.Clamp(x, 8, Math.max(8, this.worldW - 8)),
      y: Phaser.Math.Clamp(y, SURFACE_ROWS * TILE_SIZE + 12, Math.max(SURFACE_ROWS * TILE_SIZE + 12, this.worldH - 8)),
      kind,
      arriveRadius,
    };
  }

  private resourceActivityBase(axo: AxoSprite): AxoVisualTarget | null {
    const candidates = this.snapshot.world.tiles
      .filter((tile) => tile.resource && tile.amount > 0)
      .map((tile) => ({
        x: tile.x * TILE_SIZE + TILE_SIZE / 2,
        y: tile.y * TILE_SIZE + TILE_SIZE / 2,
        kind: `resource:${tile.resource}`,
        arriveRadius: 18,
        d: dist(axo.homeX, axo.homeY, tile.x * TILE_SIZE + TILE_SIZE / 2, tile.y * TILE_SIZE + TILE_SIZE / 2),
      }))
      .sort((a, b) => a.d - b.d);
    if (candidates.length === 0) return null;
    const span = Math.min(7, candidates.length);
    const picked = candidates[hashInt(`${axo.id}:resource`) % span];
    return { x: picked.x, y: picked.y, kind: picked.kind, arriveRadius: picked.arriveRadius };
  }

  private workObjectActivityBase(axo: AxoSprite, activity: string): AxoVisualTarget | null {
    const wantedRoles = activity === "repair"
      ? new Set(["breach", "leak", "seep", "oxygen"])
      : activity === "rescue"
        ? new Set(["trapped"])
        : new Set(["bridge", "breach", "nest", "pond"]);
    const candidates = this.snapshot.world.entities
      .filter((entity) => (entity.kind === "object" || entity.kind === "building") && wantedRoles.has(entity.role ?? ""))
      .map((entity) => ({
        x: entity.x * TILE_SIZE + TILE_SIZE / 2,
        y: entity.y * TILE_SIZE + TILE_SIZE / 2 - 4,
        kind: `${entity.kind}:${entity.role ?? "work"}`,
        arriveRadius: entity.kind === "building" ? 24 : 18,
        d: dist(axo.homeX, axo.homeY, entity.x * TILE_SIZE + TILE_SIZE / 2, entity.y * TILE_SIZE + TILE_SIZE / 2 - 4),
      }))
      .sort((a, b) => a.d - b.d);
    if (candidates.length === 0) return null;
    const span = Math.min(4, candidates.length);
    const picked = candidates[hashInt(`${axo.id}:${activity}`) % span];
    return { x: picked.x, y: picked.y, kind: picked.kind, arriveRadius: picked.arriveRadius };
  }

  private animateEntities(dtN: number) {
    const sh = this.shadows;
    if (!sh) return;
    sh.clear();
    const view = this.cameras.main.worldView;
    for (const axo of this.axos.values()) {
      const t = this.elapsed * (axo.isEgg ? 0.0018 : 0.0028) + axo.phase;
      const playerControlled = axo.id === this.possessedEntityId && !axo.isEgg;
      const act = playerControlled ? "player" : axo.activity;
      const anim = this.currentAxoAnimation(axo);
      const liveTarget = this.liveAxoTarget(axo, anim);
      const targetX = liveTarget?.x;
      const targetY = liveTarget?.y;
      const hasTarget = targetX !== undefined && targetY !== undefined;

      // where it wants to be
      let wanderX = 0;
      let wanderY = 0;
      let bob = Math.sin(t) * (axo.isEgg ? 0.8 : 1.7);
      let squashX = 1;
      let squashY = 1;
      let sway = 0;
      let ease = 0.038;

      if (!axo.isEgg) {
        switch (act) {
          case "gather":
          case "eat": {
            ease = 0.08;
            const near = hasTarget && dist(axo.renderX, axo.renderY, targetX!, targetY!) < (liveTarget?.arriveRadius ?? 16);
            if (near || (!hasTarget && act === "eat")) {
              const peck = Math.abs(Math.sin(this.elapsed * 0.02 + axo.workSeed));
              bob = -peck * 3.4;
              squashY = 1 - peck * 0.16;
              squashX = 1 + peck * 0.1;
              if (Math.random() < 0.10 * dtN) {
                const col = act === "eat" ? 0xbfe9ff : 0x9c7a4d;
                this.spawnParticle(axo.renderX + rand(-4, 4), axo.renderY + 6, rand(-0.3, 0.3), act === "eat" ? -0.5 : 0.5, col, act === "eat");
              }
            }
            break;
          }
          case "build": {
            ease = 0.075;
            const near = hasTarget && dist(axo.renderX, axo.renderY, targetX!, targetY!) < (liveTarget?.arriveRadius ?? 18);
            if (near) {
              const hit = Math.sin(this.elapsed * 0.016 + axo.workSeed);
              sway = hit * 0.16;
              squashX = 1 + Math.abs(hit) * 0.12;
              bob = -Math.abs(hit) * 2;
              if (Math.random() < 0.12 * dtN) this.spawnParticle(axo.renderX + rand(-5, 5), axo.renderY + 4, rand(-0.4, 0.4), rand(-0.6, -0.1), 0xb9a98a, false);
            }
            break;
          }
          case "rest": {
            ease = 0.04;
            wanderY = 6;
            bob = Math.sin(t * 0.6) * 0.7;
            squashY = 1 + 0.05 * Math.sin(this.elapsed * 0.003 + axo.phase);
            break;
          }
          case "play": {
            ease = 0.07;
            wanderX = Math.sin(t * 1.7) * axo.wander * 2.4 + Math.sin(t * 3.3) * 1.5;
            wanderY = Math.cos(t * 2.1) * 3;
            bob = Math.sin(t * 2.4) * 2.4;
            squashY = 1 + 0.08 * Math.sin(this.elapsed * 0.02);
            break;
          }
          case "explore": {
            ease = 0.065;
            bob = Math.sin(t * 1.4) * 1.6;
            if (Math.random() < 0.06 * dtN) this.spawnParticle(axo.renderX - axo.facing * 8, axo.renderY, -axo.facing * 0.3, -0.4, 0xcdeefe, true);
            break;
          }
          case "player": {
            ease = 0.16;
            bob = Math.sin(t * 1.8) * 1.5;
            sway = Math.sin(t * 1.5) * 0.07;
            squashY = 1 + 0.035 * Math.sin(this.elapsed * 0.012 + axo.phase);
            break;
          }
          default: {
            // ambient swim
            wanderX = Math.sin(t * 0.6) * axo.wander;
            wanderY = Math.sin(t * 0.9 + axo.phase) * 1.2;
            sway = Math.sin(t * 1.3) * 0.05;
          }
        }
      }

      if (!axo.isEgg) {
        const hit = anim.active ? Math.sin(anim.progress * Math.PI) : 0;
        const snap = anim.active ? Math.sin(anim.progress * Math.PI * 4) : Math.sin(this.elapsed * 0.018 + axo.phase);
        switch (anim.state) {
          case "mine": {
            ease = Math.max(ease, 0.12);
            const strike = Math.max(0, snap);
            wanderX += axo.facing * strike * 3.2;
            bob -= hit * 2.8;
            sway += axo.facing * snap * 0.18;
            squashX += hit * 0.16;
            squashY -= hit * 0.10;
            if (anim.active && Math.random() < 0.18 * dtN) {
              this.spawnParticle(axo.renderX + axo.facing * 10 + rand(-2, 4), axo.renderY + rand(-5, 6), axo.facing * rand(0.10, 0.42), rand(-0.50, 0.08), 0xffc866, false);
            }
            break;
          }
          case "gather":
          case "feed":
          case "eat": {
            const nibble = anim.active ? Math.abs(Math.sin(anim.progress * Math.PI * 5)) : Math.abs(Math.sin(this.elapsed * 0.02 + axo.workSeed));
            bob -= nibble * 2.4;
            squashY -= nibble * 0.12;
            squashX += nibble * 0.08;
            if (anim.active && Math.random() < 0.12 * dtN) {
              this.spawnParticle(axo.renderX + axo.facing * 8 + rand(-4, 4), axo.renderY + 5, rand(-0.18, 0.18), rand(-0.48, -0.08), anim.hue, true);
            }
            break;
          }
          case "build":
          case "repair": {
            const tap = anim.active ? Math.abs(snap) : Math.abs(Math.sin(this.elapsed * 0.017 + axo.workSeed));
            wanderX += axo.facing * tap * 1.8;
            bob -= tap * 2.2;
            sway += axo.facing * snap * 0.14;
            squashX += tap * 0.12;
            if (anim.active && Math.random() < 0.14 * dtN) {
              this.spawnParticle(axo.renderX + axo.facing * 9 + rand(-5, 5), axo.renderY + rand(-5, 5), rand(-0.24, 0.24), rand(-0.52, -0.10), anim.hue, true);
            }
            break;
          }
          case "rescue": {
            bob -= hit * 4.5;
            sway += axo.facing * snap * 0.10;
            squashX += hit * 0.12;
            squashY += hit * 0.04;
            if (anim.active && Math.random() < 0.18 * dtN) {
              this.spawnParticle(axo.renderX + rand(-9, 9), axo.renderY + rand(-8, 6), rand(-0.24, 0.24), rand(-0.62, -0.10), anim.hue, true);
            }
            break;
          }
          case "talk": {
            bob += snap * 1.1;
            squashY += Math.abs(snap) * 0.05;
            if (anim.active && Math.random() < 0.08 * dtN) {
              this.spawnParticle(axo.renderX + rand(-5, 5), axo.renderY - 8 + rand(-3, 3), rand(-0.12, 0.12), rand(-0.40, -0.18), 0xffd4ec, true);
            }
            break;
          }
          case "hatch": {
            bob -= hit * 7;
            squashX += hit * 0.24;
            squashY += hit * 0.18;
            sway += Math.sin(anim.progress * Math.PI * 6) * 0.08;
            if (anim.active && Math.random() < 0.16 * dtN) {
              this.spawnParticle(axo.renderX + rand(-8, 8), axo.renderY + rand(-8, 6), rand(-0.20, 0.20), rand(-0.60, -0.16), anim.hue, true);
            }
            break;
          }
          case "dash": {
            ease = Math.max(ease, 0.22);
            sway += -axo.facing * 0.18;
            squashX += 0.20;
            squashY -= 0.10;
            break;
          }
          case "jump": {
            bob -= 2.4;
            sway += -axo.facing * 0.08;
            squashY += 0.08;
            break;
          }
          case "wall_slide": {
            bob += Math.sin(this.elapsed * 0.04 + axo.phase) * 0.9;
            sway += -axo.facing * 0.16;
            squashX -= 0.06;
            break;
          }
          case "use": {
            bob -= hit * 2.2;
            squashX += hit * 0.10;
            sway += axo.facing * snap * 0.08;
            break;
          }
          default:
            break;
        }
      }
      if (liveTarget?.kind.startsWith("action:")) ease = Math.max(ease, 0.48);
      else if (hasTarget && !playerControlled) ease = Math.max(ease, 0.055);

      const anchorX = (hasTarget ? targetX! : axo.homeX) + wanderX;
      const anchorY = (hasTarget ? targetY! : axo.homeY) + wanderY;
      // facing follows the desired travel direction (captured BEFORE easing, with a
      // deadzone) so workers sitting on a target keep their last heading.
      const dxTravel = anchorX - axo.renderX;
      if (dxTravel > 3) axo.facing = 1;
      else if (dxTravel < -3) axo.facing = -1;
      const k = Math.min(1, ease * dtN);
      axo.renderX += (anchorX - axo.renderX) * k;
      axo.renderY += (anchorY - axo.renderY) * k;

      const pop = Math.min(1, 0.34 + (this.elapsed - axo.born) / 260);
      const cont = axo.container;
      cont.x = axo.renderX;
      cont.y = axo.renderY;
      cont.rotation = sway * axo.facing;
      cont.scaleX = axo.size * axo.facing * pop;
      cont.scaleY = axo.size * pop;

      axo.body.y = bob;
      axo.body.setScale(axo.baseScale * squashX, axo.baseScale * squashY);
      this.applyAxoFrame(axo, anim);
      for (const a of axo.accessories) a.img.y = a.baseOffY + bob;
      if (axo.glow) {
        axo.glow.y = bob;
        axo.glow.setAlpha(0.12 + 0.09 * (Math.sin(this.elapsed * 0.004 + axo.phase) * 0.5 + 0.5));
      }

      // contact shadow on the seabed-ish line beneath the body
      if (axo.renderX > view.x - 40 && axo.renderX < view.right + 40) {
        const lift = (bob + 2) / 4;
        sh.fillStyle(0x000000, Math.max(0.06, 0.2 - lift * 0.08));
        sh.fillEllipse(axo.renderX, axo.homeY + (axo.isEgg ? 8 : 14), (axo.isEgg ? 7 : 11) * axo.size, 3.2 * axo.size);
      }
    }
  }

  private animateEffects(dt: number, dtN: number) {
    const g = this.effects;
    if (!g) return;
    g.clear();

    // particles
    for (const p of this.particles) {
      p.age += dt;
      p.x += p.vx * dtN;
      p.y += p.vy * dtN;
      p.vy += (p.rise ? -0.012 : 0.03) * dtN;
      const a = Math.max(0, 1 - p.age / p.ttl);
      g.fillStyle(p.color, a * (p.rise ? 0.5 : 0.7));
      g.fillCircle(p.x, p.y, p.r * (p.rise ? 1 + p.age / p.ttl : 1));
    }
    this.particles = this.particles.filter((p) => p.age < p.ttl).slice(-260);
    this.drawHazardPlumes(g);
    this.drawRescueCelebrations(g);

    // turn pulse rings
    for (const pulse of this.pulses) {
      pulse.age += dt;
      const kk = pulse.age / pulse.ttl;
      if (kk >= 1) continue;
      g.lineStyle(2, pulse.hue, (1 - kk) * 0.6);
      g.strokeCircle(pulse.x, pulse.y, 8 + kk * 70);
    }
    this.pulses = this.pulses.filter((p) => p.age < p.ttl);

    // colony "thinking" aura
    if (this.turnRunning) {
      const t = this.elapsed * 0.006;
      const aura = 0.18 + 0.12 * (Math.sin(t * 2) * 0.5 + 0.5);
      g.lineStyle(2, 0x77d6ff, aura);
      g.strokeCircle(this.colony.x, this.colony.y, 28 + Math.sin(t * 2) * 4);
      for (let i = 0; i < 3; i += 1) {
        const bb = Math.sin(t * 3 - i * 0.7) * 2;
        const a = 0.4 + 0.4 * (Math.sin(t * 3 - i * 0.7) * 0.5 + 0.5);
        g.fillStyle(0xaee9ff, a);
        g.fillCircle(this.colony.x - 8 + i * 8, this.colony.y - 34 + bb, 2);
      }
    }

    const player = this.playerAxo();
    if (player) {
      const t = this.elapsed * 0.006;
      g.lineStyle(2, 0xf8d36f, 0.72 + 0.22 * Math.sin(t * 2.2));
      g.strokeCircle(player.renderX, player.renderY + 2, 21 + Math.sin(t) * 2);
      g.fillStyle(0xf8d36f, 0.18);
      g.fillCircle(player.renderX, player.renderY + 2, 25);
      this.drawPlayerTargetReticle(g, player);
      this.drawPlayerOxygenMeter(g, player);
    }
    this.drawPlayerBlockFeedback(g);
  }

  private drawHazardPlumes(g: Phaser.GameObjects.Graphics) {
    const t = this.elapsed * 0.006;
    const player = this.playerAxo();
    const contact = player ? this.playerHazardContact(player) : null;
    for (const vent of this.activeHazards()) {
      const px = vent.x * TILE_SIZE + TILE_SIZE / 2;
      const py = vent.y * TILE_SIZE + TILE_SIZE / 2 - 4;
      const leak = vent.role === "leak";
      const oxygen = vent.role === "oxygen";
      const pulse = 0.5 + 0.5 * Math.sin(t * 2 + hashInt(vent.id) * 0.01);
      const radius = this.hazardRadius(vent) + pulse * (oxygen ? 10 : 8);
      const strong = contact?.id === vent.id;
      g.fillStyle(oxygen ? 0x7377ff : leak ? 0x53e6d5 : 0xff7a35, strong ? 0.2 : 0.12);
      g.fillCircle(px, py, radius);
      g.lineStyle(
        strong ? 2.4 : 1.6,
        strong ? (oxygen ? 0xe2e5ff : leak ? 0xd8fff8 : 0xfff0a6) : (oxygen ? 0xa8adff : leak ? 0x6cf0dd : 0xff9f4f),
        strong ? 0.84 : 0.58,
      );
      g.strokeCircle(px, py, radius);
      for (let i = 0; i < 6; i += 1) {
        const phase = t * 1.8 + i * 0.9 + hashInt(vent.id) * 0.003;
        const bx = px + Math.sin(phase) * (5 + i * 2);
        const by = py - 8 - ((this.elapsed * (0.018 + i * 0.002) + i * 11) % 44);
        const alpha = 0.18 + 0.18 * Math.sin(phase + 1.2);
        g.fillStyle(
          oxygen
            ? (i % 2 === 0 ? 0xdfe2ff : 0x8f95ff)
            : leak
              ? (i % 2 === 0 ? 0xa7fff1 : 0x54e5d4)
              : (i % 2 === 0 ? 0xffd26e : 0xff8f3d),
          Math.max(0.08, alpha),
        );
        g.fillCircle(bx, by, 2.2 + (i % 3) * 0.8);
      }
    }
  }

  private activeHazards(): CivEntity[] {
    return this.snapshot.world.entities.filter((entity) => this.isHazardActive(entity));
  }

  private drawRescueCelebrations(g: Phaser.GameObjects.Graphics) {
    const t = this.elapsed * 0.006;
    const rescuedObjects = this.snapshot.world.entities.filter((entity) => (
      entity.kind === "object"
      && entity.role === "trapped"
      && entity.activity === "rescued"
    ));
    for (const entity of rescuedObjects) {
      const px = entity.x * TILE_SIZE + TILE_SIZE / 2;
      const py = entity.y * TILE_SIZE + TILE_SIZE / 2 - 4;
      const phase = t + hashInt(entity.id) * 0.003;
      const pulse = 0.5 + 0.5 * Math.sin(phase * 2.4);
      const ring = 23 + pulse * 6;

      g.fillStyle(0x7ee6b7, 0.10 + pulse * 0.05);
      g.fillCircle(px, py, ring);
      g.lineStyle(2.2, 0xd8ffea, 0.42 + pulse * 0.28);
      g.strokeCircle(px, py, ring);
      g.lineStyle(1.3, 0x80ffc0, 0.52);
      g.strokeCircle(px, py, 14 + (1 - pulse) * 5);

      const badgeX = px + 16;
      const badgeY = py - 18 + Math.sin(phase * 1.6) * 1.5;
      g.fillStyle(0x031015, 0.74);
      g.fillCircle(badgeX, badgeY, 10);
      g.fillStyle(0x7ee6b7, 0.94);
      g.fillCircle(badgeX, badgeY, 7);
      g.lineStyle(2.2, 0x031015, 0.78);
      g.lineBetween(badgeX - 4, badgeY, badgeX - 1, badgeY + 3);
      g.lineBetween(badgeX - 1, badgeY + 3, badgeX + 5, badgeY - 4);
      g.lineStyle(1.2, 0xffffff, 0.78);
      g.lineBetween(badgeX - 4, badgeY - 1, badgeX - 1, badgeY + 2);
      g.lineBetween(badgeX - 1, badgeY + 2, badgeX + 5, badgeY - 5);

      for (let i = 0; i < 4; i += 1) {
        const drift = (this.elapsed * (0.012 + i * 0.002) + i * 13) % 34;
        const bx = px - 14 + i * 8 + Math.sin(phase + i) * 2;
        const by = py + 7 - drift;
        const alpha = Math.max(0.08, 0.34 * (1 - drift / 34));
        g.fillStyle(i % 2 === 0 ? 0xd8ffea : 0xffd8e5, alpha);
        g.fillCircle(bx, by, 1.8 + (i % 2) * 0.7);
      }
    }
  }

  private isHazardActive(entity: CivEntity) {
    if (entity.kind !== "object" || entity.activity === "sealed") return false;
    if (entity.role === "seep") {
      const bridge = this.snapshot.world.entities.find((item) => (
        item.kind === "object"
        && item.role === "bridge"
        && Math.abs(item.x - entity.x) <= 4
        && Math.abs(item.y - entity.y) <= 3
      ));
      return !bridge || bridge.activity !== "built";
    }
    if (entity.role === "leak") {
      const breach = this.snapshot.world.entities.find((item) => (
        item.kind === "object"
        && item.role === "breach"
        && Math.abs(item.x - entity.x) <= 3
        && Math.abs(item.y - entity.y) <= 3
      ));
      return !breach || breach.activity !== "repaired";
    }
    if (entity.role === "oxygen") {
      const trapped = this.snapshot.world.entities.find((item) => (
        item.kind === "object"
        && item.role === "trapped"
        && Math.abs(item.x - entity.x) <= 3
        && Math.abs(item.y - entity.y) <= 3
      ));
      return !trapped || trapped.activity !== "rescued";
    }
    return false;
  }

  private hazardRadius(entity: CivEntity) {
    return entity.role === "oxygen" ? LOW_OXYGEN_RADIUS_PX : SILT_VENT_RADIUS_PX;
  }

  private playerHazardContact(axo: AxoSprite): PlayerHazardState | null {
    let best: PlayerHazardState | null = null;
    for (const vent of this.activeHazards()) {
      const x = vent.x * TILE_SIZE + TILE_SIZE / 2;
      const y = vent.y * TILE_SIZE + TILE_SIZE / 2 - 4;
      const radius = this.hazardRadius(vent);
      const d = dist(axo.renderX, axo.renderY, x, y);
      if (d > radius) continue;
      const severity = Math.max(0, Math.min(1, 1 - d / radius));
      const state: PlayerHazardState = {
        id: vent.id,
        label: vent.name || (vent.role === "oxygen" ? "Low Oxygen Pocket" : vent.role === "leak" ? "Nest Leak" : "Silt Vent"),
        role: vent.role,
        x: Math.round(x),
        y: Math.round(y),
        tile_x: vent.x,
        tile_y: vent.y,
        distance: Math.round(d),
        severity: Math.round(severity * 100) / 100,
      };
      if (!best || state.distance < best.distance) best = state;
    }
    return best;
  }

  private playerHazardSpeedFactor(contact: PlayerHazardState | null) {
    if (!contact) return 1;
    if (contact.role === "oxygen") {
      if (this.playerOxygen <= PLAYER_OXYGEN_CRITICAL) return 0.82;
      return 1;
    }
    return Math.max(SILT_VENT_MIN_SPEED, 1 - contact.severity * 0.44);
  }

  private updatePlayerOxygen(dtN: number, contact: PlayerHazardState | null) {
    if (contact?.role === "oxygen") {
      const drain = PLAYER_OXYGEN_DRAIN_PER_FRAME * (0.8 + contact.severity * 2.4);
      this.playerOxygen = Math.max(0, this.playerOxygen - drain * dtN);
      return;
    }
    this.playerOxygen = Math.min(100, this.playerOxygen + PLAYER_OXYGEN_RECOVER_PER_FRAME * dtN);
  }

  private playerOxygenState(contact: PlayerHazardState | null): PlayerOxygenState {
    const inPocket = contact?.role === "oxygen";
    const value = Math.round(this.playerOxygen);
    const status: PlayerOxygenState["status"] = value <= PLAYER_OXYGEN_CRITICAL
      ? "critical"
      : value <= PLAYER_OXYGEN_WARNING
        ? "low"
        : inPocket
          ? "draining"
          : value < 100
            ? "recovering"
            : "stable";
    return {
      value,
      max: 100,
      status,
      in_pocket: Boolean(inPocket),
      source: inPocket ? contact.label : null,
    };
  }

  private drawPlayerOxygenMeter(g: Phaser.GameObjects.Graphics, axo: AxoSprite) {
    const contact = this.playerHazardContact(axo);
    const state = this.playerOxygenState(contact);
    if (state.value >= 100 && !state.in_pocket) return;

    const ratio = Math.max(0, Math.min(1, state.value / state.max));
    const x = Math.round(axo.renderX - 23);
    const y = Math.round(axo.renderY - 39);
    const w = 46;
    const h = 7;
    const critical = state.status === "critical";
    const low = state.status === "low";
    const fill = critical ? 0xff5e78 : low ? 0xffd76b : state.status === "recovering" ? 0x8ef0c2 : 0xa8adff;
    const pulse = critical ? 0.16 + 0.12 * (Math.sin(this.elapsed * 0.018) * 0.5 + 0.5) : 0;

    g.fillStyle(0x031015, 0.78);
    g.fillRoundedRect(x - 9, y - 4, w + 15, h + 8, 5);
    g.lineStyle(1, critical ? 0xffb0bd : low ? 0xffe8a3 : 0xdfe2ff, critical ? 0.78 : 0.52);
    g.strokeRoundedRect(x - 9, y - 4, w + 15, h + 8, 5);
    if (pulse > 0) {
      g.fillStyle(0xff5e78, pulse);
      g.fillRoundedRect(x - 10, y - 5, w + 17, h + 10, 6);
    }

    g.fillStyle(0x0a2433, 0.9);
    g.fillRoundedRect(x, y, w, h, 3);
    g.fillStyle(fill, 0.92);
    g.fillRoundedRect(x, y, Math.max(3, Math.round(w * ratio)), h, 3);
    g.lineStyle(1, 0xffffff, 0.28);
    g.lineBetween(x + 2, y + 2, x + Math.max(3, Math.round(w * ratio)) - 2, y + 2);

    const bx = x - 5;
    const by = y + 3;
    g.fillStyle(fill, 0.24);
    g.fillCircle(bx, by, 6);
    g.lineStyle(1.5, fill, 0.86);
    g.strokeCircle(bx, by, 4.5);
    g.fillStyle(0xffffff, 0.62);
    g.fillCircle(bx - 1.5, by - 1.5, 1.3);
    if (state.in_pocket || low || critical) {
      const drift = (this.elapsed * 0.012) % 10;
      g.fillStyle(fill, low || critical ? 0.68 : 0.48);
      g.fillCircle(x + w + 5, y + 6 - drift * 0.35, 1.8);
      g.fillCircle(x + w + 1, y + 2 - drift * 0.28, 1.2);
    }
  }

  private drawPlayerBlockFeedback(g: Phaser.GameObjects.Graphics) {
    const block = this.recentPlayerBlock();
    if (!block) return;
    const x = block.tile_x * TILE_SIZE;
    const y = block.tile_y * TILE_SIZE;
    const fade = 1 - Math.min(1, (block.age_ms ?? 0) / 850);
    g.fillStyle(0xff6b4a, 0.16 * fade);
    g.fillRect(x, y, TILE_SIZE, TILE_SIZE);
    g.lineStyle(3, 0x031015, 0.5 * fade);
    drawCornerReticle(g, x - 2, y - 2, TILE_SIZE + 4, 6);
    g.lineStyle(2, 0xffd76b, 0.9 * fade);
    drawCornerReticle(g, x - 2, y - 2, TILE_SIZE + 4, 6);
  }

  private drawPlayerTargetReticle(g: Phaser.GameObjects.Graphics, axo: AxoSprite) {
    const target = this.findPlayerInteraction(axo);
    if (!target || target.kind === "empty") return;

    const locked = target.locked === true;
    const alpha = 0.72 + 0.18 * Math.sin(this.elapsed * 0.009);
    const color = target.action === "mine_tile"
      ? 0xffc866
      : target.action === "place_tile"
        ? 0x72e6a4
        : target.action === "feed_hatchling"
          ? 0xffb9d8
        : target.kind === "resource"
          ? 0xb7f0a4
          : target.kind === "npc"
            ? 0xffd4ec
            : target.kind === "object"
              ? 0xffc866
              : 0x9be8ff;

    if (target.kind === "terrain" && typeof target.tileX === "number" && typeof target.tileY === "number") {
      const x = target.tileX * TILE_SIZE;
      const y = target.tileY * TILE_SIZE;
      const cx = x + TILE_SIZE / 2;
      const cy = y + TILE_SIZE / 2;
      g.lineStyle(3, 0x031015, 0.52);
      g.lineBetween(axo.renderX, axo.renderY + 2, cx, cy);
      g.lineStyle(1.5, color, 0.64);
      g.lineBetween(axo.renderX, axo.renderY + 2, cx, cy);
      g.fillStyle(color, target.action === "place_tile" ? 0.18 : 0.10);
      g.fillRect(x + 1, y + 1, TILE_SIZE - 2, TILE_SIZE - 2);
      g.lineStyle(3, 0x031015, 0.62);
      drawCornerReticle(g, x - 1, y - 1, TILE_SIZE + 2, 7);
      g.lineStyle(2, color, alpha);
      drawCornerReticle(g, x - 1, y - 1, TILE_SIZE + 2, 7);
      if (locked) {
        g.lineStyle(4, 0x031015, 0.62);
        drawCornerReticle(g, x - 4, y - 4, TILE_SIZE + 8, 9);
        g.lineStyle(2, 0xffffff, 0.74);
        drawCornerReticle(g, x - 4, y - 4, TILE_SIZE + 8, 9);
      }
      g.fillStyle(0x031015, 0.58);
      g.fillCircle(cx, cy, 3.6);
      g.fillStyle(color, alpha);
      g.fillCircle(cx, cy, 2.2);
      const markerY = y - 22;
      g.lineStyle(3, 0x031015, 0.62);
      g.lineBetween(cx, markerY + 9, cx, y + 2);
      g.lineStyle(2, color, alpha);
      g.lineBetween(cx, markerY + 9, cx, y + 2);
      g.fillStyle(0x031015, 0.76);
      g.fillCircle(cx, markerY + 7, 9.5);
      g.fillStyle(color, 0.88);
      g.fillCircle(cx, markerY + 7, 6.2);
      g.fillStyle(0xffffff, 0.58);
      g.fillCircle(cx - 2.2, markerY + 4.5, 1.8);
      g.fillStyle(0x031015, 0.72);
      g.fillTriangle(cx, markerY, cx - 10, markerY + 11, cx + 10, markerY + 11);
      g.fillStyle(color, alpha);
      g.fillTriangle(cx, markerY + 2, cx - 7, markerY + 9, cx + 7, markerY + 9);
      if (target.action === "place_tile") {
        g.lineStyle(3, 0x031015, 0.58);
        g.lineBetween(x + TILE_SIZE / 2, y + 3, x + TILE_SIZE / 2, y + TILE_SIZE - 3);
        g.lineBetween(x + 3, y + TILE_SIZE / 2, x + TILE_SIZE - 3, y + TILE_SIZE / 2);
        g.lineStyle(2, color, alpha);
        g.lineBetween(x + TILE_SIZE / 2, y + 4, x + TILE_SIZE / 2, y + TILE_SIZE - 4);
        g.lineBetween(x + 4, y + TILE_SIZE / 2, x + TILE_SIZE - 4, y + TILE_SIZE / 2);
      }
      return;
    }

    if (locked) {
      const r = target.kind === "npc" ? 24 : target.kind === "object" ? 23 : 19;
      g.lineStyle(4, 0x031015, 0.66);
      g.strokeCircle(target.x, target.y, r);
      g.lineStyle(2, 0xffffff, 0.78);
      g.strokeCircle(target.x, target.y, r);
      g.fillStyle(0x031015, 0.70);
      g.fillTriangle(target.x, target.y - r - 13, target.x - 8, target.y - r - 3, target.x + 8, target.y - r - 3);
      g.fillStyle(color, 0.92);
      g.fillTriangle(target.x, target.y - r - 10, target.x - 5, target.y - r - 4, target.x + 5, target.y - r - 4);
    }
    g.lineStyle(locked ? 3 : 2, color, alpha);
    g.strokeCircle(target.x, target.y, target.kind === "npc" ? 18 : target.kind === "object" ? 17 : 13);
    g.fillStyle(color, 0.12);
    g.fillCircle(target.x, target.y, target.kind === "npc" ? 20 : target.kind === "object" ? 19 : 15);
    g.lineStyle(1, 0xffffff, 0.36);
    g.lineBetween(axo.renderX, axo.renderY + 2, target.x, target.y);
  }

  // ── minimap ───────────────────────────────────────────────────────────────
  private drawMinimap() {
    const g = this.minimap;
    if (!g || this.worldW === 0) return;
    g.clear();
    const { x, y, w, h } = this.mm;
    const sx = w / this.snapshot.world.width;
    const sy = h / this.snapshot.world.height;

    g.fillStyle(0x05121b, 0.82);
    g.fillRoundedRect(x - 5, y - 5, w + 10, h + 10, 7);
    g.lineStyle(1, 0x3a6f7a, 0.5);
    g.strokeRoundedRect(x - 5, y - 5, w + 10, h + 10, 7);

    // water + seabed silhouette per region
    for (const region of this.snapshot.world.regions ?? []) {
      const rx = x + region.x * sx;
      const rw = region.width * sx;
      const overlay = regionOverlayFor(region.owner, this.civColorById);
      const fill = overlay ? overlay.tint : BIOME_WASH[region.biome] ?? 0x2f6f88;
      g.fillStyle(fill, 0.34);
      g.fillRect(rx, y + SURFACE_ROWS * sy, rw, h - SURFACE_ROWS * sy);
    }
    // seabed mass
    const W = this.snapshot.world.width;
    const step = Math.max(1, Math.floor(W / w));
    for (let c = 0; c < W; c += step) {
      const fy = this.floorByCol[c] ?? this.snapshot.world.height;
      g.fillStyle(0x2a3340, 0.92);
      g.fillRect(x + c * sx, y + fy * sy, Math.max(1, step * sx + 0.5), h - fy * sy);
    }

    // entities
    for (const e of this.snapshot.world.entities) {
      if (e.kind === "building") {
        g.fillStyle(e.role === "pond" ? 0xffd98a : 0xaee9ff, 0.95);
        g.fillRect(x + e.x * sx - 1, y + e.y * sy - 1, 3, 3);
      } else if (e.kind === "egg") {
        g.fillStyle(0x9be8ff, 0.85);
        g.fillRect(x + e.x * sx, y + e.y * sy, 1.4, 1.4);
      } else {
        g.fillStyle(MORPH_DOT[e.morph ?? "leucistic"] ?? 0xffd9e6, 0.95);
        g.fillRect(x + e.x * sx, y + e.y * sy, 1.8, 1.8);
      }
    }
    const player = this.playerAxo();
    if (player) {
      g.fillStyle(0xffd76b, 1);
      g.fillCircle(x + (player.renderX / TILE_SIZE) * sx, y + (player.renderY / TILE_SIZE) * sy, 3.2);
    }

    // current viewport
    const v = this.cameras.main.worldView;
    g.lineStyle(1, 0xffffff, 0.75);
    g.strokeRect(
      x + (v.x / TILE_SIZE) * sx,
      y + (v.y / TILE_SIZE) * sy,
      (v.width / TILE_SIZE) * sx,
      (v.height / TILE_SIZE) * sy,
    );
  }

  // ── input + camera ─────────────────────────────────────────────────────────
  private installInput() {
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.pointerOnMap(p)) {
        this.overMap = true;
        this.panFromMap(p);
      } else {
        this.dragging = true;
        this.following = false;
        this.dragX = p.x;
        this.dragY = p.y;
      }
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (this.overMap && p.isDown) {
        this.panFromMap(p);
      } else if (this.dragging && p.isDown) {
        const cam = this.cameras.main;
        cam.scrollX -= (p.x - this.dragX) / cam.zoom;
        cam.scrollY -= (p.y - this.dragY) / cam.zoom;
        this.dragX = p.x;
        this.dragY = p.y;
      }
    });
    const end = () => {
      this.dragging = false;
      this.overMap = false;
    };
    this.input.on("pointerup", end);
    this.input.on("pointerupoutside", end);
    this.input.on("gameout", end);
    this.input.on("wheel", (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.zoomAt(p.x, p.y, dy > 0 ? 0.9 : 1.1);
    });
  }

  private installPlayerControls() {
    const kb = this.input.keyboard;
    if (!kb) return;
    const interactKeys = [
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.E),
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
    ];
    this.playerKeys = {
      left: [kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT), kb.addKey(Phaser.Input.Keyboard.KeyCodes.A)],
      right: [kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT), kb.addKey(Phaser.Input.Keyboard.KeyCodes.D)],
      up: [kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP), kb.addKey(Phaser.Input.Keyboard.KeyCodes.W)],
      down: [kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN), kb.addKey(Phaser.Input.Keyboard.KeyCodes.S)],
      dash: [kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT), kb.addKey(Phaser.Input.Keyboard.KeyCodes.Q)],
      interact: interactKeys,
    };
    for (const key of interactKeys) {
      key.on("down", () => {
        if (!this.domControlFocused()) this.lastInteractPressedAt = this.elapsed;
      });
    }
  }

  private updatePlayerControl(dtN: number) {
    const axo = this.playerAxo();
    const keys = this.playerKeys;
    if (!axo || axo.isEgg || !keys || this.domControlFocused()) return;

    const left = keys.left.some((key) => key.isDown);
    const right = keys.right.some((key) => key.isDown);
    const up = keys.up.some((key) => key.isDown);
    const down = keys.down.some((key) => key.isDown);
    const dashDown = keys.dash.some((key) => key.isDown);
    const manualMove = left || right || up || down;
    const manualHorizontal = (right ? 1 : 0) - (left ? 1 : 0);
    let dx = (right ? 1 : 0) - (left ? 1 : 0);
    let dy = (down ? 1 : 0) - (up ? 1 : 0);
    const pilotControlled = !manualMove && (this.pilotCommand?.kind === "move" || this.pilotCommand?.kind === "explore");
    if (!manualMove && this.pilotCommand?.kind === "move") {
      dx = this.pilotCommand.target.x - axo.renderX;
      dy = this.pilotCommand.target.y - axo.renderY;
      if (Math.hypot(dx, dy) < PILOT_MOVE_ARRIVE_RADIUS) {
        dx = 0;
        dy = 0;
      }
    } else if (!manualMove && this.pilotCommand?.kind === "explore") {
      dx = this.pilotCommand.vector.x;
      dy = this.pilotCommand.vector.y;
    }
    const inputDx = dx;
    const inputDy = dy;

    const floorY = this.playerFloorY(axo.renderX);
    const floorDelta = floorY - axo.renderY;
    const nearGround = floorDelta <= 18 && floorDelta >= -3;
    const jumpPhysicsWasActive = this.playerJumpVelocityY !== 0
      || Math.abs(this.playerJumpVelocityX) > 0.05
      || this.lastPlayerLocomotion === "jump"
      || this.lastPlayerLocomotion === "wall_slide";
    if (nearGround && !jumpPhysicsWasActive) this.lastPlayerGroundedAt = this.elapsed;
    const wasGrounded = this.groundCoyoteMsRemaining() > 0;
    const wantsUp = dy < -0.18;
    const wantsDown = dy > 0.18;
    const jumpPressed = up && !this.jumpWasDown;
    if (jumpPressed) this.lastJumpPressedAt = this.elapsed;
    const bufferedJumpPressed = this.jumpBufferMsRemaining() > 0;
    const hazardContact = this.playerHazardContact(axo);
    this.updatePlayerOxygen(dtN, hazardContact);
    const wallContact = !nearGround && !wasGrounded && manualHorizontal !== 0
      ? this.playerWallContact(axo, manualHorizontal)
      : null;
    if (wallContact) this.recordPlayerWallContact(wallContact);
    const bufferedWallContact = !wallContact && manualHorizontal !== 0 ? this.recentBufferedWallContact(manualHorizontal) : null;
    const jumpWallContact = wallContact ?? bufferedWallContact;
    const wallJumpStarted = Boolean(bufferedJumpPressed && jumpWallContact && !wantsDown);
    const jumpStarted = bufferedJumpPressed && !wallJumpStarted && wasGrounded && !wantsDown;
    this.jumpWasDown = up;
    const pilotDash = !manualMove && this.pilotCommand?.kind === "move" && this.pilotCommand.burst;
    const canDash = this.elapsed - this.lastPlayerDashAt >= PLAYER_DASH_COOLDOWN_MS;
    const wantsDash = ((dashDown && !this.dashWasDown) || pilotDash) && canDash && (dx !== 0 || dy !== 0);
    this.dashWasDown = dashDown;
    const hazardSpeed = this.playerHazardSpeedFactor(hazardContact);
    if (wallJumpStarted && jumpWallContact) {
      this.lastJumpPressedAt = -Infinity;
      this.lastPlayerGroundedAt = -Infinity;
      this.playerJumpVelocityX = -jumpWallContact.direction * PLAYER_WALL_KICK_IMPULSE_X * Math.max(0.86, hazardSpeed);
      this.playerJumpVelocityY = PLAYER_WALL_KICK_IMPULSE_Y * Math.max(0.86, hazardSpeed);
      this.wallKickControlUntil = this.elapsed + PLAYER_WALL_KICK_CONTROL_LOCK_MS;
      this.recordPlayerWallContact(jumpWallContact);
      this.spawnWallKickWake(axo, jumpWallContact.direction);
      this.triggerAxoActionAnimation(axo.id, "jump", 420, 0xc7f2ff);
    } else if (jumpStarted) {
      this.lastJumpPressedAt = -Infinity;
      this.lastPlayerGroundedAt = -Infinity;
      this.playerJumpVelocityX = 0;
      this.playerJumpVelocityY = PLAYER_JUMP_IMPULSE * Math.max(0.86, hazardSpeed);
      this.spawnJumpWake(axo);
      this.triggerAxoActionAnimation(axo.id, "jump", 420, 0xc7f2ff);
    }
    const jumpPhysicsActive = jumpStarted
      || wallJumpStarted
      || this.playerJumpVelocityY !== 0
      || Math.abs(this.playerJumpVelocityX) > 0.05
      || this.lastPlayerLocomotion === "jump"
      || this.lastPlayerLocomotion === "wall_slide";
    if (pilotControlled) {
      this.playerManualVelocityX = 0;
      this.playerManualVelocityY = 0;
    }
    const manualVelocityActive = !pilotControlled
      && !jumpPhysicsActive
      && (manualMove || Math.hypot(this.playerManualVelocityX, this.playerManualVelocityY) > PLAYER_MANUAL_STOP_EPSILON);

    if (dx !== 0 || dy !== 0 || jumpPhysicsActive || manualVelocityActive) {
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      let nextRawX = axo.renderX;
      let nextRawY = axo.renderY;
      let locomotion: "swim" | "grounded" = "swim";
      let nextLocomotion: "swim" | "grounded" | "jump" | "wall_slide" = "swim";
      if (jumpPhysicsActive) {
        this.playerManualVelocityX = 0;
        this.playerManualVelocityY = 0;
        const wallKickLocked = this.elapsed < this.wallKickControlUntil;
        const wallSlide = !wallJumpStarted
          && !wallKickLocked
          && wallContact
          && this.playerJumpVelocityY > 0
          && manualHorizontal === wallContact.direction;
        if (wallSlide) {
          nextLocomotion = "wall_slide";
          this.recordPlayerWallContact(wallContact);
          if (Math.random() < 0.18 * dtN) {
            this.spawnParticle(axo.renderX + wallContact.direction * 8, axo.renderY + rand(-6, 8), -wallContact.direction * 0.18, 0.20, 0xffe8a3, true);
          }
        } else {
          nextLocomotion = "jump";
        }
        const horizontalInputSpeed = wallKickLocked ? 0 : manualHorizontal * 2.35 * hazardSpeed;
        nextRawX = axo.renderX + (horizontalInputSpeed + this.playerJumpVelocityX) * dtN;
        this.playerJumpVelocityX *= Math.pow(0.88, dtN);
        if (Math.abs(this.playerJumpVelocityX) < 0.05) this.playerJumpVelocityX = 0;
        this.playerJumpVelocityY = Math.min(PLAYER_MAX_FALL_SPEED, this.playerJumpVelocityY + PLAYER_JUMP_GRAVITY * dtN);
        if (wallSlide) this.playerJumpVelocityY = Math.min(this.playerJumpVelocityY, PLAYER_WALL_SLIDE_MAX_FALL_SPEED);
        nextRawY = axo.renderY + (this.playerJumpVelocityY + (wantsDown ? 1.1 : 0)) * dtN;
        locomotion = "swim";
      } else if (manualVelocityActive) {
        const inputLen = Math.hypot(inputDx, inputDy);
        const inputNX = inputLen > 0 ? inputDx / inputLen : 0;
        const inputNY = inputLen > 0 ? inputDy / inputLen : 0;
        const groundedWalk = (nearGround || wasGrounded)
          && !wantsUp
          && !wantsDown
          && (Math.abs(manualHorizontal) > 0 || Math.abs(this.playerManualVelocityX) > PLAYER_MANUAL_STOP_EPSILON);
        if (groundedWalk) {
          const targetVX = manualHorizontal * 2.15 * hazardSpeed;
          const factor = Math.min(1, (Math.abs(targetVX) > 0 ? PLAYER_MANUAL_GROUND_ACCEL : PLAYER_MANUAL_GROUND_DRAG) * dtN);
          this.playerManualVelocityX += (targetVX - this.playerManualVelocityX) * factor;
          this.playerManualVelocityY = 0;
          if (Math.abs(this.playerManualVelocityX) < PLAYER_MANUAL_STOP_EPSILON) this.playerManualVelocityX = 0;

          const candidateX = axo.renderX + this.playerManualVelocityX * dtN;
          const currentFloorY = this.playerFloorY(axo.renderX);
          const candidateFloorY = this.playerFloorY(candidateX);
          const steepRise = candidateFloorY < currentFloorY - 18;
          if (steepRise) {
            this.recordPlayerBlock(Math.floor(candidateX / TILE_SIZE), this.playerFloorTile(candidateX), "steep_rise");
            this.playerManualVelocityX = 0;
          }
          nextRawX = steepRise ? axo.renderX : candidateX;
          const targetFloorY = steepRise ? currentFloorY : candidateFloorY;
          nextRawY = axo.renderY + (targetFloorY - axo.renderY) * Math.min(1, 0.72 * dtN);
          locomotion = "grounded";
          nextLocomotion = "grounded";
        } else {
          const speed = (nearGround && wantsUp ? 3.55 : 3.1) * hazardSpeed;
          const targetVX = inputNX * speed;
          const targetVY = inputNY * speed;
          const factor = Math.min(1, (inputLen > 0 ? PLAYER_MANUAL_SWIM_ACCEL : PLAYER_MANUAL_SWIM_DRAG) * dtN);
          this.playerManualVelocityX += (targetVX - this.playerManualVelocityX) * factor;
          this.playerManualVelocityY += (targetVY - this.playerManualVelocityY) * factor;
          if (Math.abs(this.playerManualVelocityX) < PLAYER_MANUAL_STOP_EPSILON) this.playerManualVelocityX = 0;
          if (Math.abs(this.playerManualVelocityY) < PLAYER_MANUAL_STOP_EPSILON) this.playerManualVelocityY = 0;
          nextRawX = axo.renderX + this.playerManualVelocityX * dtN;
          nextRawY = axo.renderY + this.playerManualVelocityY * dtN;
        }
      } else if ((nearGround || wasGrounded) && Math.abs(dx) > 0.05 && !wantsUp && !wantsDown) {
        const walkSpeed = 2.15 * hazardSpeed;
        const candidateX = axo.renderX + dx * walkSpeed * dtN;
        const currentFloorY = this.playerFloorY(axo.renderX);
        const candidateFloorY = this.playerFloorY(candidateX);
        const steepRise = candidateFloorY < currentFloorY - 18;
        if (steepRise) this.recordPlayerBlock(Math.floor(candidateX / TILE_SIZE), this.playerFloorTile(candidateX), "steep_rise");
        nextRawX = steepRise ? axo.renderX : candidateX;
        const targetFloorY = steepRise ? currentFloorY : candidateFloorY;
        nextRawY = axo.renderY + (targetFloorY - axo.renderY) * Math.min(1, 0.72 * dtN);
        locomotion = "grounded";
        nextLocomotion = "grounded";
      } else {
        const speed = (nearGround && wantsUp ? 3.55 : 3.1) * hazardSpeed;
        nextRawX = axo.renderX + dx * speed * dtN;
        nextRawY = axo.renderY + dy * speed * dtN;
      }
      if (wantsDash) {
        const dashDistance = (locomotion === "grounded" ? 76 : 96) * Math.max(0.74, hazardSpeed);
        if (locomotion === "grounded") {
          const startFloorY = this.playerFloorY(axo.renderX);
          const dashX = nextRawX + dx * dashDistance;
          const dashFloorY = this.playerFloorY(dashX);
          if (dashFloorY >= startFloorY - 22) {
            nextRawX = dashX;
            nextRawY = dashFloorY;
          }
        } else {
          nextRawX += dx * dashDistance;
          nextRawY += dy * dashDistance;
        }
        this.lastPlayerDashAt = this.elapsed;
        if (manualMove) {
          this.playerManualVelocityX = dx * (locomotion === "grounded" ? 2.8 : 3.55) * Math.max(0.74, hazardSpeed);
          this.playerManualVelocityY = locomotion === "grounded" ? 0 : dy * 3.1 * Math.max(0.74, hazardSpeed);
        }
        this.spawnDashWake(axo, dx, dy);
        this.triggerAxoActionAnimation(axo.id, "dash", 330, 0xffd76b);
      }
      const resolved = this.resolvePlayerTerrainMove(axo, nextRawX, nextRawY, locomotion, wantsUp);
      const next = this.clampPlayerPosition(resolved.x, resolved.y);
      const landedFloorY = this.playerFloorY(next.x);
      if (jumpPhysicsActive && next.y >= landedFloorY - 0.5 && this.playerJumpVelocityY >= 0) {
        next.y = landedFloorY;
        nextLocomotion = "grounded";
        this.playerJumpVelocityX = 0;
        this.playerJumpVelocityY = 0;
        this.wallKickControlUntil = 0;
      } else if (!jumpPhysicsActive && nextLocomotion !== "grounded") {
        this.playerJumpVelocityX = 0;
        this.playerJumpVelocityY = 0;
        this.wallKickControlUntil = 0;
      }
      axo.renderX = next.x;
      axo.renderY = next.y;
      axo.homeX = next.x;
      axo.homeY = next.y;
      axo.targetX = undefined;
      axo.targetY = undefined;
      axo.activity = "player";
      if (Math.abs(dx) > 0.08) axo.facing = dx > 0 ? 1 : -1;
      if (Math.random() < 0.06 * dtN) {
        this.spawnParticle(axo.renderX - axo.facing * 10, axo.renderY + 1, -axo.facing * 0.24, -0.38, 0xc7f2ff, true);
      }
      this.following = true;
      this.lastPlayerLocomotion = nextLocomotion;
      this.maybeSyncPlayerMove(axo);
    } else if (nearGround || wasGrounded) {
      const settledY = axo.renderY + (floorY - axo.renderY) * Math.min(1, 0.36 * dtN);
      const next = this.clampPlayerPosition(axo.renderX, settledY);
      axo.renderY = next.y;
      axo.homeY = next.y;
      this.lastPlayerLocomotion = "grounded";
      this.playerJumpVelocityX = 0;
      this.playerJumpVelocityY = 0;
      this.wallKickControlUntil = 0;
    } else {
      this.lastPlayerLocomotion = "swim";
      this.playerJumpVelocityX = 0;
      this.playerJumpVelocityY = 0;
      this.wallKickControlUntil = 0;
    }

    const interactDown = keys.interact.some((key) => key.isDown);
    const bufferedInteract = Number.isFinite(this.lastInteractPressedAt)
      && this.elapsed - this.lastInteractPressedAt <= PLAYER_INTERACT_BUFFER_MS;
    const pilotInteract = this.pilotCommand?.kind === "interact" && this.pilotCommand.nonce !== this.lastPilotInteractNonce;
    if (pilotInteract && this.pilotCommand?.kind === "interact") this.lastPilotInteractNonce = this.pilotCommand.nonce;
    const justInteracted = pilotInteract || bufferedInteract || (interactDown && !this.interactWasDown);
    this.interactWasDown = interactDown;
    if (justInteracted && this.elapsed - this.lastInteractAt > 260) {
      const interaction = pilotInteract && this.pilotCommand?.kind === "interact"
        ? this.findPilotInteraction(axo, this.pilotCommand)
        : this.findPlayerInteraction(axo);
      this.lastInteractAt = this.elapsed;
      this.lastInteractPressedAt = -Infinity;
      this.lastInteraction = interaction;
      this.spawnInteractionFeedback(interaction);
      this.playerInteract?.(interaction);
      if (!pilotInteract) this.clearPlayerTargetLock();
    }
  }

  private spawnInteractionFeedback(interaction: PlayerInteraction) {
    const x = interaction.x;
    const y = interaction.y;
    if (interaction.kind === "empty") {
      this.spawnPulse(x, y, 0x8aa0b8);
      return;
    }

    const actionAnimation = axoActionAnimationForInteraction(interaction);
    if (actionAnimation) {
      this.triggerAxoActionAnimation(
        interaction.entityId,
        actionAnimation.state,
        actionAnimation.durationMs,
        actionAnimation.hue,
        { x: interaction.x, y: interaction.y },
      );
      if (interaction.targetId && interaction.targetId !== interaction.entityId) {
        const targetState: AxoActionAnimation = actionAnimation.state === "feed"
          ? "eat"
          : actionAnimation.state === "talk"
            ? "talk"
            : actionAnimation.state === "rescue"
            ? "rescue"
            : "use";
        const actor = this.axos.get(interaction.entityId);
        this.triggerAxoActionAnimation(
          interaction.targetId,
          targetState,
          Math.min(actionAnimation.durationMs, 700),
          actionAnimation.hue,
          actor ? { x: actor.renderX, y: actor.renderY } : undefined,
        );
      }
    }

    if (interaction.action === "mine_tile") {
      const base = interaction.terrain === "moss" || interaction.resource === "fiber"
        ? 0x9be56f
        : interaction.terrain === "mud" || interaction.resource === "clay"
          ? 0xc79b63
          : interaction.resource === "glowshards"
            ? 0xbba3ff
            : 0xffc866;
      for (let i = 0; i < 14; i += 1) {
        this.spawnParticle(x + rand(-7, 7), y + rand(-5, 6), rand(-0.48, 0.48), rand(-0.58, -0.04), i % 3 === 0 ? 0xffe8a3 : base, false);
      }
      this.spawnPulse(x, y, 0xffc866);
      return;
    }

    if (interaction.action === "place_tile") {
      for (let i = 0; i < 12; i += 1) {
        this.spawnParticle(x + rand(-8, 8), y + rand(-4, 8), rand(-0.28, 0.28), rand(-0.42, 0.10), i % 2 === 0 ? 0x72e6a4 : 0xe4fff0, false);
      }
      this.spawnPulse(x, y, 0x72e6a4);
      return;
    }

    if (interaction.action === "repair_object") {
      for (let i = 0; i < 16; i += 1) {
        this.spawnParticle(x + rand(-12, 12), y + rand(-8, 8), rand(-0.26, 0.26), rand(-0.48, -0.10), i % 2 === 0 ? 0x73f0df : 0xd8fff8, true);
      }
      this.spawnPulse(x, y, 0x73f0df);
      return;
    }

    if (interaction.action === "rescue_object") {
      for (let i = 0; i < 20; i += 1) {
        this.spawnParticle(x + rand(-13, 13), y + rand(-10, 8), rand(-0.30, 0.30), rand(-0.62, -0.12), i % 2 === 0 ? 0xffd8e5 : 0x7ee6b7, true);
      }
      this.spawnPulse(x, y, 0x80ffc0);
      return;
    }

    if (interaction.kind === "resource") {
      const color = resourceFeedbackColor(interaction.resource ?? interaction.label);
      for (let i = 0; i < 8; i += 1) {
        this.spawnParticle(x + rand(-6, 6), y + rand(-5, 5), rand(-0.24, 0.24), rand(-0.46, -0.04), color, true);
      }
      this.spawnPulse(x, y, color);
      return;
    }

    const hue = interaction.kind === "npc"
      ? 0xffd4ec
      : interaction.kind === "building"
        ? 0xaee9ff
        : interaction.kind === "object"
          ? 0xffc866
          : 0xffd76b;
    for (let i = 0; i < 6; i += 1) {
      this.spawnParticle(x + rand(-6, 6), y + rand(-5, 5), rand(-0.18, 0.18), rand(-0.42, -0.08), hue, true);
    }
    this.spawnPulse(x, y, hue);
  }

  private spawnDashWake(axo: AxoSprite, dx: number, dy: number) {
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;
    for (let i = 0; i < 13; i += 1) {
      const spread = (i - 6) * 0.08;
      this.spawnParticle(
        axo.renderX - nx * (10 + i * 3),
        axo.renderY - ny * (6 + i * 2),
        -nx * (0.35 + i * 0.012) - ny * spread,
        -ny * 0.28 + nx * spread - 0.08,
        i % 3 === 0 ? 0xffe8a3 : 0xc7f2ff,
        true,
      );
    }
    this.spawnPulse(axo.renderX, axo.renderY, 0xffd76b);
  }

  private spawnJumpWake(axo: AxoSprite) {
    for (let i = 0; i < 7; i += 1) {
      this.spawnParticle(
        axo.renderX + rand(-9, 9),
        axo.renderY + 7 + rand(-1, 2),
        rand(-0.32, 0.32),
        rand(0.04, 0.34),
        i % 2 === 0 ? 0xffe8a3 : 0xc7f2ff,
        true,
      );
    }
    this.spawnPulse(axo.renderX, axo.renderY + 5, 0xffd76b);
  }

  private spawnWallKickWake(axo: AxoSprite, wallDirection: -1 | 1) {
    for (let i = 0; i < 9; i += 1) {
      this.spawnParticle(
        axo.renderX + wallDirection * (7 + i * 0.8),
        axo.renderY + rand(-8, 8),
        wallDirection * rand(0.06, 0.22),
        rand(-0.28, 0.22),
        i % 2 === 0 ? 0xffe8a3 : 0xc7f2ff,
        true,
      );
    }
    this.spawnPulse(axo.renderX + wallDirection * 8, axo.renderY, 0xffd76b);
  }

  private maybeSyncPlayerMove(axo: AxoSprite) {
    const tileX = Math.floor(axo.renderX / TILE_SIZE);
    const tileY = Math.floor(axo.renderY / TILE_SIZE);
    const tileKey = `${axo.id}:${tileX},${tileY}`;
    if (tileKey === this.lastMoveSyncTile || this.elapsed - this.lastMoveSyncAt < 1100) return;
    this.lastMoveSyncTile = tileKey;
    this.lastMoveSyncAt = this.elapsed;
    this.playerMove?.({
      entityId: axo.id,
      x: axo.renderX,
      y: axo.renderY,
      tileX,
      tileY,
    });
  }

  private maybePlacePlayerAtPlayableEntry(axo: AxoSprite) {
    if (axo.isEgg || this.gameMode !== "play") return;
    const key = `${this.snapshot.id}:${axo.id}`;
    if (this.playerEntryPlacedKey === key) return;
    const currentTarget = this.findPreferredPlayerInteraction(axo);
    const alreadyPlayable = currentTarget.kind !== "empty" && (currentTarget.distance ?? 999) <= 44;
    const alreadyNearColony = dist(axo.renderX, axo.renderY, this.colony.x, this.colony.y) < 150;
    if (alreadyPlayable && alreadyNearColony) {
      this.playerEntryPlacedKey = key;
      return;
    }

    const entry = this.playerEntryPoint();
    if (!entry) return;
    axo.renderX = entry.x;
    axo.renderY = entry.y;
    axo.homeX = entry.x;
    axo.homeY = entry.y;
    axo.targetX = undefined;
    axo.targetY = undefined;
    this.playerManualVelocityX = 0;
    this.playerManualVelocityY = 0;
    this.playerJumpVelocityX = 0;
    this.playerJumpVelocityY = 0;
    this.lastPlayerLocomotion = "grounded";
    this.lastPlayerGroundedAt = this.elapsed;
    this.lastMoveSyncTile = `${axo.id}:${Math.floor(entry.x / TILE_SIZE)},${Math.floor(entry.y / TILE_SIZE)}`;
    this.lastMoveSyncAt = this.elapsed;
    this.playerEntryPlacedKey = key;
    this.spawnPulse(entry.x, entry.y, 0xf8d36f);
  }

  private playerEntryPoint(): { x: number; y: number } | null {
    const resource = this.nearestWorldResourceToColony();
    if (resource) {
      return this.clampPlayerPosition(resource.x - 30, resource.y - 12);
    }
    const point = this.nearestWorldEntityToColony(["building", "object"]);
    if (point) {
      return this.clampPlayerPosition(point.x - 34, point.y - 4);
    }
    return this.clampPlayerPosition(this.colony.x - 42, this.playerFloorY(this.colony.x - 42));
  }

  private nearestWorldResourceToColony(): { x: number; y: number } | null {
    let best: { x: number; y: number; d: number } | null = null;
    for (const tile of this.snapshot.world.tiles) {
      if (!tile.resource || tile.amount <= 0) continue;
      const x = tile.x * TILE_SIZE + TILE_SIZE / 2;
      const y = tile.y * TILE_SIZE + TILE_SIZE / 2;
      const d = dist(this.colony.x, this.colony.y, x, y);
      if (!best || d < best.d) best = { x, y, d };
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  private nearestWorldEntityToColony(kinds: CivEntity["kind"][]): { x: number; y: number } | null {
    let best: { x: number; y: number; d: number } | null = null;
    for (const entity of this.snapshot.world.entities) {
      if (!kinds.includes(entity.kind)) continue;
      const x = entity.x * TILE_SIZE + TILE_SIZE / 2;
      const y = entity.y * TILE_SIZE + TILE_SIZE / 2 - 6;
      const d = dist(this.colony.x, this.colony.y, x, y);
      if (!best || d < best.d) best = { x, y, d };
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  private clampPlayerPosition(x: number, y: number) {
    const col = Phaser.Math.Clamp(Math.floor(x / TILE_SIZE), 0, Math.max(0, this.snapshot.world.width - 1));
    const floorTile = this.floorByCol[col] ?? this.snapshot.world.height - 1;
    const minY = SURFACE_ROWS * TILE_SIZE + 10;
    const maxY = Math.max(minY + 8, floorTile * TILE_SIZE - 8);
    return {
      x: Phaser.Math.Clamp(x, 8, Math.max(8, this.worldW - 8)),
      y: Phaser.Math.Clamp(y, minY, maxY),
    };
  }

  private resolvePlayerTerrainMove(
    axo: AxoSprite,
    targetX: number,
    targetY: number,
    locomotion: "swim" | "grounded",
    wantsUp: boolean,
  ) {
    const block = this.firstPlayerSideBlock(axo.renderX, axo.renderY, targetX, targetY, locomotion, wantsUp);
    if (!block) return { x: targetX, y: targetY };
    this.recordPlayerBlock(block.tileX, block.tileY, "solid_tile");
    return { x: axo.renderX, y: targetY };
  }

  private firstPlayerSideBlock(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    locomotion: "swim" | "grounded",
    wantsUp: boolean,
  ): { tileX: number; tileY: number } | null {
    const deltaX = toX - fromX;
    const direction = Math.sign(deltaX);
    if (direction === 0 || Math.abs(deltaX) < 0.4) return null;

    const samples = Math.min(18, Math.max(1, Math.ceil(Math.abs(deltaX) / 8)));
    const currentFloorY = this.playerFloorY(fromX);
    for (let i = 1; i <= samples; i += 1) {
      const k = i / samples;
      const centerX = fromX + deltaX * k;
      const centerY = fromY + (toY - fromY) * k;
      const frontX = centerX + direction * 9;
      const probes = locomotion === "grounded"
        ? [centerY - 8, centerY + 1]
        : [centerY - 8, centerY, centerY + 7];

      for (const probeY of probes) {
        const tile = this.solidTileAtWorld(frontX, probeY);
        if (!tile) continue;

        const tileTop = tile.tileY * TILE_SIZE;
        const tileFloorY = tileTop - 8;
        if (locomotion === "grounded" && tileFloorY >= currentFloorY - 18) continue;
        if (wantsUp && centerY + 7 <= tileTop + 1) continue;
        return tile;
      }
    }
    return null;
  }

  private playerWallContact(axo: AxoSprite, direction: number): PlayerWallContactState | null {
    const dir = direction < 0 ? -1 : 1;
    const probeX = axo.renderX + dir * 11;
    const probes = [axo.renderY - 9, axo.renderY - 2, axo.renderY + 6];
    for (const probeY of probes) {
      const tile = this.solidTileAtWorld(probeX, probeY);
      if (!tile) continue;
      const tileCenterX = tile.tileX * TILE_SIZE + TILE_SIZE / 2;
      const tileCenterY = tile.tileY * TILE_SIZE + TILE_SIZE / 2;
      return {
        direction: dir,
        x: tileCenterX,
        y: tileCenterY,
        tile_x: tile.tileX,
        tile_y: tile.tileY,
      };
    }
    return null;
  }

  private solidTileAtWorld(x: number, y: number): { tileX: number; tileY: number } | null {
    const tileX = Math.floor(x / TILE_SIZE);
    const tileY = Math.floor(y / TILE_SIZE);
    if (tileX < 0 || tileY < SURFACE_ROWS || tileX >= this.snapshot.world.width || tileY >= this.snapshot.world.height) return null;
    return this.substrateTiles.has(`${tileX},${tileY}`) ? { tileX, tileY } : null;
  }

  private recordPlayerBlock(tileX: number, tileY: number, reason: PlayerBlockState["reason"]) {
    const clampedX = Phaser.Math.Clamp(tileX, 0, Math.max(0, this.snapshot.world.width - 1));
    const clampedY = Phaser.Math.Clamp(tileY, SURFACE_ROWS, Math.max(SURFACE_ROWS, this.snapshot.world.height - 1));
    const sameTile = this.lastPlayerBlock?.tile_x === clampedX && this.lastPlayerBlock.tile_y === clampedY;
    if (!sameTile || !this.lastPlayerBlock || this.elapsed - this.lastPlayerBlock.at > 220) {
      this.spawnPulse(clampedX * TILE_SIZE + TILE_SIZE / 2, clampedY * TILE_SIZE + TILE_SIZE / 2, 0xff6b4a);
    }
    this.lastPlayerBlock = {
      x: clampedX * TILE_SIZE + TILE_SIZE / 2,
      y: clampedY * TILE_SIZE + TILE_SIZE / 2,
      tile_x: clampedX,
      tile_y: clampedY,
      reason,
      at: this.elapsed,
    };
  }

  private recordPlayerWallContact(contact: PlayerWallContactState) {
    this.lastPlayerWallContact = {
      ...contact,
      at: this.elapsed,
    };
  }

  private recentPlayerBlock(): PlayerBlockState | null {
    if (!this.lastPlayerBlock) return null;
    const age = this.elapsed - this.lastPlayerBlock.at;
    if (age > 850) return null;
    return {
      x: this.lastPlayerBlock.x,
      y: this.lastPlayerBlock.y,
      tile_x: this.lastPlayerBlock.tile_x,
      tile_y: this.lastPlayerBlock.tile_y,
      reason: this.lastPlayerBlock.reason,
      age_ms: Math.max(0, Math.round(age)),
    };
  }

  private playerVelocityX() {
    return this.playerJumpVelocityX !== 0 ? this.playerJumpVelocityX : this.playerManualVelocityX;
  }

  private playerVelocityY() {
    return this.playerJumpVelocityY !== 0 ? this.playerJumpVelocityY : this.playerManualVelocityY;
  }

  private recentPlayerWallContact(): PlayerWallContactState | null {
    if (!this.lastPlayerWallContact) return null;
    const age = this.elapsed - this.lastPlayerWallContact.at;
    if (age > 700) return null;
    return {
      direction: this.lastPlayerWallContact.direction,
      x: this.lastPlayerWallContact.x,
      y: this.lastPlayerWallContact.y,
      tile_x: this.lastPlayerWallContact.tile_x,
      tile_y: this.lastPlayerWallContact.tile_y,
      age_ms: Math.max(0, Math.round(age)),
    };
  }

  private jumpBufferMsRemaining() {
    if (!Number.isFinite(this.lastJumpPressedAt)) return 0;
    return Math.max(0, Math.ceil(PLAYER_JUMP_BUFFER_MS - (this.elapsed - this.lastJumpPressedAt)));
  }

  private groundCoyoteMsRemaining() {
    if (!Number.isFinite(this.lastPlayerGroundedAt)) return 0;
    return Math.max(0, Math.ceil(PLAYER_GROUND_COYOTE_MS - (this.elapsed - this.lastPlayerGroundedAt)));
  }

  private recentBufferedWallContact(direction: number): PlayerWallContactState | null {
    if (!this.lastPlayerWallContact) return null;
    const age = this.elapsed - this.lastPlayerWallContact.at;
    if (age > PLAYER_WALL_COYOTE_MS) return null;
    const dir = direction < 0 ? -1 : 1;
    return this.lastPlayerWallContact.direction === dir ? this.lastPlayerWallContact : null;
  }

  private playerFloorY(x: number) {
    const floorTile = this.playerFloorTile(x);
    const minY = SURFACE_ROWS * TILE_SIZE + 18;
    return Math.max(minY, floorTile * TILE_SIZE - 8);
  }

  private playerFloorTile(x: number) {
    const col = Phaser.Math.Clamp(Math.floor(x / TILE_SIZE), 0, Math.max(0, this.snapshot.world.width - 1));
    return this.floorByCol[col] ?? this.snapshot.world.height - 1;
  }

  private findPlayerInteraction(axo: AxoSprite): PlayerInteraction {
    const locked = this.lockedPlayerInteraction(axo);
    if (locked) return locked;
    return this.findPreferredPlayerInteraction(axo);
  }

  private findPreferredPlayerInteraction(axo: AxoSprite): PlayerInteraction {
    if (this.playerTool === "mine") {
      return this.preferredTerrainMineInteraction(axo, 54) ?? this.emptyInteraction(axo, "No mineable tile in reach");
    }
    if (this.playerTool === "build") {
      return this.preferredTerrainPlaceInteraction(axo, PLAYER_BUILD_INTERACT_RADIUS) ?? this.emptyInteraction(axo, "No buildable water in reach");
    }

    const task = activeCivPlayerTask(this.snapshot, primaryCiv(this.snapshot));
    if (task?.kind === "visit_building") {
      const taskBuilding = this.buildingInteractionOptions(axo, 54, 8).find((building) => building.targetId === task.buildingId);
      if (taskBuilding) return taskBuilding;
    }
    if (task?.kind === "repair_object" && task.status === "ready") {
      const taskObject = this.objectInteractionOptions(axo, 58, 8).find((object) => object.targetId === task.objectId);
      if (taskObject) return taskObject;
    }
    if (task?.kind === "rescue_object" && task.status === "ready") {
      const taskObject = this.objectInteractionOptions(axo, 92, 8).find((object) => object.targetId === task.objectId);
      if (taskObject) return taskObject;
    }
    if (task?.status === "ready") {
      const taskNpc = this.npcInteractionOptions(axo, 54, 8).find((npc) => npc.targetId === task.npcId);
      if (taskNpc) return taskNpc;
    }
    if (task && task.kind !== "visit_building" && task.status !== "ready") {
      const taskResource = this.taskResourceInteractionOptions(axo, 46, 6, task)[0];
      if (taskResource) return taskResource;
    }

    const resource = this.nearestResourceInteraction(axo, 38);
    if (resource) return resource;

    const building = this.nearestBuildingInteraction(axo, 46);
    if (building) return building;

    const npc = this.nearestNpcInteraction(axo, 42);
    if (npc) return npc;

    return this.emptyInteraction(axo, "Nothing in reach");
  }

  private lockedPlayerInteraction(axo: AxoSprite): PlayerInteraction | null {
    if (!this.playerTargetLockKey) return null;
    const options = this.playerTargetOptions(axo);
    const index = options.findIndex((item) => playerTargetKey(item) === this.playerTargetLockKey);
    if (index < 0) {
      this.clearPlayerTargetLock();
      return null;
    }
    return this.withTargetLock(options[index], index, options.length);
  }

  private playerTargetOptions(axo: AxoSprite): PlayerInteraction[] {
    const task = activeCivPlayerTask(this.snapshot, primaryCiv(this.snapshot));
    if (this.playerTool === "mine") {
      const taskMineTiles = task?.kind === "rescue_object" && task.status !== "ready"
        ? this.rescueRubbleInteractionOptions(axo, task.objectId, 104, 12)
        : [];
      return uniqueInteractions([
        ...taskMineTiles,
        ...this.terrainMineInteractionOptions(axo, 76, 14),
      ]);
    }
    if (this.playerTool === "build") {
      const taskBuildTiles = task?.kind === "build_bridge" && task.status !== "ready"
        ? this.bridgePlaceInteractionOptions(axo, task.objectId, PLAYER_BUILD_INTERACT_RADIUS, 12)
        : [];
      return uniqueInteractions([
        ...taskBuildTiles,
        ...this.terrainPlaceInteractionOptions(axo, PLAYER_BUILD_INTERACT_RADIUS, 14),
      ]);
    }
    return this.useInteractionOptions(axo);
  }

  private useInteractionOptions(axo: AxoSprite): PlayerInteraction[] {
    const task = activeCivPlayerTask(this.snapshot, primaryCiv(this.snapshot));
    const taskOptions: PlayerInteraction[] = [];
    if (task?.kind === "visit_building") {
      taskOptions.push(...this.buildingInteractionOptions(axo, 64, 8).filter((building) => building.targetId === task.buildingId));
    }
    if (task?.kind === "repair_object" && task.status === "ready") {
      taskOptions.push(...this.objectInteractionOptions(axo, 70, 8).filter((object) => object.targetId === task.objectId));
    }
    if (task?.kind === "rescue_object" && task.status === "ready") {
      taskOptions.push(...this.objectInteractionOptions(axo, 104, 8).filter((object) => object.targetId === task.objectId));
    }
    if (task?.status === "ready") {
      taskOptions.push(...this.npcInteractionOptions(axo, 72, 10).filter((npc) => npc.targetId === task.npcId));
    }
    if (task && task.kind !== "visit_building" && task.status !== "ready") {
      taskOptions.push(...this.taskResourceInteractionOptions(axo, 52, 8, task));
    }
    return uniqueInteractions([
      ...taskOptions,
      ...this.resourceInteractionOptions(axo, 46, 10),
      ...this.buildingInteractionOptions(axo, 58, 8),
      ...this.objectInteractionOptions(axo, 76, 8),
      ...this.npcInteractionOptions(axo, 72, 12),
    ]);
  }

  private cyclePlayerTarget(direction: 1 | -1) {
    const axo = this.playerAxo();
    if (!axo || axo.isEgg) return;
    const options = this.playerTargetOptions(axo).filter((item) => item.kind !== "empty");
    if (options.length === 0) {
      this.clearPlayerTargetLock();
      return;
    }
    const preferred = this.findPreferredPlayerInteraction(axo);
    const currentKey = this.playerTargetLockKey ?? (preferred.kind !== "empty" ? playerTargetKey(preferred) : null);
    const currentIndex = currentKey ? options.findIndex((item) => playerTargetKey(item) === currentKey) : -1;
    const nextIndex = currentIndex < 0
      ? 0
      : (currentIndex + direction + options.length) % options.length;
    const next = options[nextIndex];
    this.playerTargetLockKey = playerTargetKey(next);
    this.spawnPulse(next.x, next.y, next.kind === "npc" ? 0xffd4ec : next.kind === "object" ? 0xffc866 : 0x9be8ff);
  }

  private clearPlayerTargetLock() {
    this.playerTargetLockKey = null;
  }

  private withTargetLock(target: PlayerInteraction, index: number, count: number): PlayerInteraction {
    return {
      ...target,
      locked: true,
      cycle_index: index + 1,
      cycle_count: count,
    };
  }

  private targetLockState(target: PlayerInteraction | null): PlayerTargetLockState | null {
    if (!target?.locked) return null;
    const state: PlayerTargetLockState = {
      key: playerTargetKey(target),
      kind: target.kind,
      label: target.label,
      index: target.cycle_index ?? 1,
      count: target.cycle_count ?? 1,
    };
    if (target.targetId) state.targetId = target.targetId;
    if (target.action) state.action = target.action;
    return state;
  }

  private findPilotInteraction(axo: AxoSprite, command: Extract<NonNullable<CivPilotCommand>, { kind: "interact" }>): PlayerInteraction {
    const target = command.target;
    if (!target) return this.findPlayerInteraction(axo);

    const direct = this.pilotTargetInteractionOptions(axo, target)
      .find((interaction) => this.matchesPilotTarget(interaction, target));
    if (direct) return direct;

    return this.findPlayerInteraction(axo);
  }

  private pilotTargetInteractionOptions(axo: AxoSprite, target: NonNullable<Extract<NonNullable<CivPilotCommand>, { kind: "interact" }>["target"]>): PlayerInteraction[] {
    if (target.kind === "terrain" && target.action === "mine_tile") {
      const direct = typeof target.tileX === "number" && typeof target.tileY === "number"
        ? this.terrainMineInteractionForTile(axo, target.tileX, target.tileY, 90)
        : null;
      return uniqueInteractions([
        ...(direct ? [direct] : []),
        ...this.terrainMineInteractionOptions(axo, 62, 12),
      ]);
    }
    if (target.kind === "terrain" && target.action === "place_tile") {
      const direct = typeof target.tileX === "number" && typeof target.tileY === "number"
        ? this.terrainPlaceInteractionForTile(axo, target.tileX, target.tileY, 72)
        : null;
      return uniqueInteractions([
        ...(direct ? [direct] : []),
        ...this.terrainPlaceInteractionOptions(axo, 56, 12),
      ]);
    }
    if (target.kind === "resource") return this.resourceInteractionOptions(axo, 54, 12);
    if (target.kind === "building") return this.buildingInteractionOptions(axo, 62, 12);
    if (target.kind === "object") return this.objectInteractionOptions(axo, target.action === "rescue_object" ? 96 : 68, 12);
    if (target.kind === "npc") return this.npcInteractionOptions(axo, 64, 12);
    return [];
  }

  private matchesPilotTarget(interaction: PlayerInteraction, target: NonNullable<Extract<NonNullable<CivPilotCommand>, { kind: "interact" }>["target"]>) {
    if (target.targetId && interaction.targetId === target.targetId) return true;
    if (target.action && interaction.action !== target.action) return false;
    if (typeof target.tileX === "number" && typeof target.tileY === "number") {
      return interaction.tileX === target.tileX && interaction.tileY === target.tileY;
    }
    if (target.kind !== interaction.kind) return false;
    return dist(interaction.x, interaction.y, target.x, target.y) <= 18;
  }

  private emptyInteraction(axo: AxoSprite, label: string): PlayerInteraction {
    return {
      entityId: axo.id,
      kind: "empty",
      label,
      x: axo.renderX,
      y: axo.renderY,
      tileX: Math.floor(axo.renderX / TILE_SIZE),
      tileY: Math.floor(axo.renderY / TILE_SIZE),
      distance: 0,
    };
  }

  private nearestResourceInteraction(axo: AxoSprite, radius: number): PlayerInteraction | null {
    return this.resourceInteractionOptions(axo, radius, 1)[0] ?? null;
  }

  private nearestBuildingInteraction(axo: AxoSprite, radius: number): PlayerInteraction | null {
    return this.buildingInteractionOptions(axo, radius, 1)[0] ?? null;
  }

  private nearestNpcInteraction(axo: AxoSprite, radius: number): PlayerInteraction | null {
    return this.npcInteractionOptions(axo, radius, 1)[0] ?? null;
  }

  private nearbyInteractionOptions(axo: AxoSprite): PlayerInteraction[] {
    return uniqueInteractions([
      ...this.resourceInteractionOptions(axo, 90, 8),
      ...this.buildingInteractionOptions(axo, 96, 5),
      ...this.objectInteractionOptions(axo, 120, 5),
      ...this.npcInteractionOptions(axo, 72, 8),
      ...this.terrainMineInteractionOptions(axo, 90, 4),
      ...this.terrainPlaceInteractionOptions(axo, 90, 3),
    ])
      .sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999))
      .slice(0, 18);
  }

  private taskInteractionOptions(axo: AxoSprite): PlayerInteraction[] {
    const task = activeCivPlayerTask(this.snapshot, primaryCiv(this.snapshot));
    const taskResources = task && task.kind !== "visit_building" && task.status !== "ready"
      ? this.taskResourceInteractionOptions(axo, 1800, 4, task)
      : [];
    const taskObjects = (task?.kind === "repair_object" || task?.kind === "rescue_object") && task.status === "ready"
      ? this.objectInteractionOptions(axo, 1800, 8).filter((item) => item.targetId === task.objectId)
      : [];
    const taskBuildTiles = task?.kind === "build_bridge" && task.status !== "ready"
      ? this.bridgePlaceInteractionOptions(axo, task.objectId, 120, 5)
      : [];
    const taskMineTiles = task?.kind === "rescue_object" && task.status !== "ready"
      ? this.rescueRubbleInteractionOptions(axo, task.objectId, 1800, 3)
      : [];
    return uniqueInteractions([...taskResources, ...taskObjects, ...taskMineTiles, ...taskBuildTiles])
      .sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999))
      .slice(0, 18);
  }

  private taskResourceInteractionOptions(axo: AxoSprite, radius: number, limit: number, task: CivPlayerTask): PlayerInteraction[] {
    if (task.kind === "visit_building" || task.kind === "rescue_object" || task.kind === "build_bridge" || task.status === "ready") return [];
    return this.resourceInteractionOptions(axo, radius, this.snapshot.world.tiles.length)
      .filter((item) => item.resource === task.sourceResource || harvestYieldResource(item.resource ?? "") === task.resource)
      .slice(0, limit);
  }

  private resourceInteractionOptions(axo: AxoSprite, radius: number, limit: number): PlayerInteraction[] {
    const options: PlayerInteraction[] = [];
    for (const tile of this.snapshot.world.tiles) {
      if (!tile.resource || tile.amount <= 0) continue;
      const x = tile.x * TILE_SIZE + TILE_SIZE / 2;
      const y = tile.y * TILE_SIZE + TILE_SIZE / 2;
      const d = dist(axo.renderX, axo.renderY, x, y);
      if (d > radius) continue;
      options.push({
        entityId: axo.id,
        kind: "resource",
        label: tile.resource,
        resource: tile.resource,
        targetId: `tile:${tile.x},${tile.y}`,
        x,
        y,
        tileX: tile.x,
        tileY: tile.y,
        amount: tile.amount,
        distance: Math.round(d),
      });
    }
    return options.sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999)).slice(0, limit);
  }

  private buildingInteractionOptions(axo: AxoSprite, radius: number, limit: number): PlayerInteraction[] {
    const options: PlayerInteraction[] = [];
    for (const entity of this.snapshot.world.entities) {
      if (entity.kind !== "building") continue;
      const x = entity.x * TILE_SIZE + TILE_SIZE / 2;
      const y = entity.y * TILE_SIZE + TILE_SIZE / 2 - 8;
      const d = dist(axo.renderX, axo.renderY, x, y);
      if (d > radius) continue;
      options.push({
        entityId: axo.id,
        kind: "building",
        label: entity.name || entity.role || "building",
        targetId: entity.id,
        x,
        y,
        tileX: entity.x,
        tileY: entity.y,
        distance: Math.round(d),
      });
    }
    return options.sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999)).slice(0, limit);
  }

  private objectInteractionOptions(axo: AxoSprite, radius: number, limit: number): PlayerInteraction[] {
    const options: PlayerInteraction[] = [];
    for (const entity of this.snapshot.world.entities) {
      if (entity.kind !== "object") continue;
      if (entity.role === "seep" || entity.role === "leak" || entity.role === "oxygen") continue;
      const x = entity.x * TILE_SIZE + TILE_SIZE / 2;
      const y = entity.y * TILE_SIZE + TILE_SIZE / 2 - 4;
      const d = dist(axo.renderX, axo.renderY, x, y);
      if (d > radius) continue;
      const repaired = entity.activity === "repaired" || (entity.health ?? 0) >= 95;
      const rescued = entity.activity === "rescued";
      const action = entity.role === "trapped"
        ? rescued ? undefined : "rescue_object"
        : entity.role === "bridge"
          ? undefined
          : repaired ? undefined : "repair_object";
      options.push({
        entityId: axo.id,
        kind: "object",
        action,
        label: entity.name || entity.role || "object",
        targetId: entity.id,
        x,
        y,
        tileX: entity.x,
        tileY: entity.y,
        distance: Math.round(d),
        objectRole: entity.role,
      });
    }
    return options.sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999)).slice(0, limit);
  }

  private npcInteractionOptions(axo: AxoSprite, radius: number, limit: number): PlayerInteraction[] {
    const options: PlayerInteraction[] = [];
    for (const entity of this.snapshot.world.entities) {
      if (entity.kind !== "axolotl" || entity.id === axo.id || entity.stage === "egg") continue;
      const sprite = this.axos.get(entity.id);
      if (!sprite) continue;
      const d = dist(axo.renderX, axo.renderY, sprite.renderX, sprite.renderY);
      if (d > radius) continue;
      const isHatchling = entity.stage === "hatchling";
      options.push({
        entityId: axo.id,
        kind: "npc",
        action: isHatchling ? "feed_hatchling" : undefined,
        label: isHatchling ? `Feed ${entity.name || "hatchling"}` : entity.name || "Axolotl",
        targetId: entity.id,
        x: sprite.renderX,
        y: sprite.renderY,
        tileX: entity.x,
        tileY: entity.y,
        distance: Math.round(d),
        stage: entity.stage,
      });
    }
    return options.sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999)).slice(0, limit);
  }

  private nearestTerrainMineInteraction(axo: AxoSprite, radius: number): PlayerInteraction | null {
    return this.terrainMineInteractionOptions(axo, radius, 1)[0] ?? null;
  }

  private nearestTerrainPlaceInteraction(axo: AxoSprite, radius: number): PlayerInteraction | null {
    return this.terrainPlaceInteractionOptions(axo, radius, 1)[0] ?? null;
  }

  private preferredTerrainPlaceInteraction(axo: AxoSprite, radius: number): PlayerInteraction | null {
    const task = activeCivPlayerTask(this.snapshot, primaryCiv(this.snapshot));
    if (task?.kind === "build_bridge" && task.status !== "ready") {
      const bridgeTile = this.bridgePlaceInteractionOptions(axo, task.objectId, radius + 36, 5)[0];
      if (bridgeTile) return bridgeTile;
    }
    return this.nearestTerrainPlaceInteraction(axo, radius);
  }

  private preferredTerrainMineInteraction(axo: AxoSprite, radius: number): PlayerInteraction | null {
    const task = activeCivPlayerTask(this.snapshot, primaryCiv(this.snapshot));
    if (task?.kind === "rescue_object" && task.status !== "ready") {
      const rescueTile = this.rescueRubbleInteractionOptions(axo, task.objectId, radius + 96, 3)[0];
      if (rescueTile) return rescueTile;
    }

    const blocked = this.lastPlayerBlock;
    if (blocked && this.elapsed - blocked.at <= 1200) {
      const blockedTarget = this.terrainMineInteractionForTile(axo, blocked.tile_x, blocked.tile_y, radius + 12);
      if (blockedTarget) return blockedTarget;
    }

    const facing = axo.facing >= 0 ? 1 : -1;
    const baseX = Math.floor(axo.renderX / TILE_SIZE);
    const baseY = Math.floor(axo.renderY / TILE_SIZE);
    const candidates: Array<{ x: number; y: number }> = [];
    for (let reach = 1; reach <= 3; reach += 1) {
      candidates.push(
        { x: baseX + facing * reach, y: baseY },
        { x: baseX + facing * reach, y: baseY + 1 },
        { x: baseX + facing * reach, y: baseY - 1 },
      );
    }
    candidates.push({ x: baseX, y: baseY + 1 });

    const seen = new Set<string>();
    for (const candidate of candidates) {
      const key = `${candidate.x},${candidate.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const target = this.terrainMineInteractionForTile(axo, candidate.x, candidate.y, radius);
      if (target) return target;
    }

    return this.nearestTerrainMineInteraction(axo, radius);
  }

  private rescueRubbleInteractionOptions(axo: AxoSprite, objectId: string, radius: number, limit: number): PlayerInteraction[] {
    const object = this.snapshot.world.entities.find((entity) => entity.id === objectId && entity.kind === "object");
    if (!object) return [];
    const options = rescueRubbleTiles(object.x, object.y)
      .map((candidate) => this.terrainMineInteractionForTile(axo, candidate.x, candidate.y, radius))
      .filter((item): item is PlayerInteraction => Boolean(item));
    return options.sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999)).slice(0, limit);
  }

  private terrainMineInteractionOptions(axo: AxoSprite, radius: number, limit: number): PlayerInteraction[] {
    const options: PlayerInteraction[] = [];
    for (const tile of this.snapshot.world.tiles) {
      const option = this.terrainMineInteractionFromTile(axo, tile, radius);
      if (option) options.push(option);
    }
    return options.sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999)).slice(0, limit);
  }

  private terrainMineInteractionForTile(axo: AxoSprite, tileX: number, tileY: number, radius: number): PlayerInteraction | null {
    const tile = this.tileAt(tileX, tileY);
    return tile ? this.terrainMineInteractionFromTile(axo, tile, radius) : null;
  }

  private terrainMineInteractionFromTile(axo: AxoSprite, tile: CivTile, radius: number): PlayerInteraction | null {
    if (!isSubstrate(tile.terrain)) return null;
    const x = tile.x * TILE_SIZE + TILE_SIZE / 2;
    const y = tile.y * TILE_SIZE + TILE_SIZE / 2;
    const d = dist(axo.renderX, axo.renderY, x, y);
    if (d > radius) return null;
    const yielded = tile.resource ? harvestYieldResource(tile.resource) : terrainYieldResource(tile.terrain);
    return {
      entityId: axo.id,
      kind: "terrain",
      action: "mine_tile",
      label: tile.resource ? `${tile.resource} vein` : tile.terrain,
      targetId: `tile:${tile.x},${tile.y}`,
      x,
      y,
      tileX: tile.x,
      tileY: tile.y,
      terrain: tile.terrain,
      resource: tile.resource ?? undefined,
      yieldsResource: yielded,
      amount: tile.amount,
      distance: Math.round(d),
    };
  }

  private terrainPlaceInteractionOptions(axo: AxoSprite, radius: number, limit: number): PlayerInteraction[] {
    const options: PlayerInteraction[] = [];
    const facing = axo.facing >= 0 ? 1 : -1;
    const baseX = Math.floor(axo.renderX / TILE_SIZE);
    const baseY = Math.floor(axo.renderY / TILE_SIZE);
    const candidates = [
      { x: baseX + facing, y: baseY + 1 },
      { x: baseX, y: baseY + 1 },
      { x: baseX + facing, y: baseY },
      { x: baseX + facing * 2, y: baseY + 1 },
      { x: baseX + facing * 2, y: baseY },
      { x: baseX + facing, y: baseY + 2 },
      { x: baseX - facing, y: baseY + 1 },
      { x: baseX + facing, y: baseY - 1 },
      { x: baseX + facing, y: baseY - 2 },
      { x: baseX + facing, y: baseY - 3 },
      { x: baseX + facing, y: baseY - 4 },
      { x: baseX + facing, y: baseY - 5 },
      { x: baseX + facing * 2, y: baseY - 1 },
      { x: baseX, y: baseY - 1 },
      { x: baseX + facing * 2, y: baseY - 2 },
      { x: baseX, y: baseY - 2 },
      { x: baseX + facing * 2, y: baseY - 3 },
      { x: baseX, y: baseY - 3 },
      { x: baseX + facing * 2, y: baseY - 4 },
      { x: baseX, y: baseY - 4 },
      { x: baseX + facing * 2, y: baseY - 5 },
      { x: baseX, y: baseY - 5 },
    ];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (candidate.x < 0 || candidate.y < SURFACE_ROWS || candidate.x >= this.snapshot.world.width || candidate.y >= this.snapshot.world.height) continue;
      const key = `${candidate.x},${candidate.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const option = this.terrainPlaceInteractionForTile(axo, candidate.x, candidate.y, radius);
      if (option) options.push(option);
    }
    return options.slice(0, limit);
  }

  private bridgePlaceInteractionOptions(axo: AxoSprite, objectId: string, radius: number, limit: number): PlayerInteraction[] {
    const object = this.snapshot.world.entities.find((entity) => entity.id === objectId && entity.kind === "object");
    if (!object) return [];
    const candidates = [
      { x: Math.max(0, object.x - 1), y: object.y + 1 },
      { x: object.x, y: object.y + 1 },
      { x: object.x + 1, y: object.y + 1 },
    ];
    const options = candidates
      .map((candidate) => this.terrainPlaceInteractionForTile(axo, candidate.x, candidate.y, radius))
      .filter((item): item is PlayerInteraction => Boolean(item));
    return options.sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999)).slice(0, limit);
  }

  private terrainPlaceInteractionForTile(axo: AxoSprite, tileX: number, tileY: number, radius: number): PlayerInteraction | null {
    const tile = this.tileAt(tileX, tileY);
    if (!tile || isSubstrate(tile.terrain) || tile.terrain === "air" || this.tileHasBlockingEntity(tileX, tileY)) return null;
    const x = tile.x * TILE_SIZE + TILE_SIZE / 2;
    const y = tile.y * TILE_SIZE + TILE_SIZE / 2;
    const d = dist(axo.renderX, axo.renderY, x, y);
    if (d > radius) return null;
    return {
      entityId: axo.id,
      kind: "terrain",
      action: "place_tile",
      label: placeTerrainForResource(this.buildResource),
      targetId: `tile:${tile.x},${tile.y}`,
      x,
      y,
      tileX: tile.x,
      tileY: tile.y,
      terrain: tile.terrain,
      buildResource: this.buildResource,
      distance: Math.round(d),
    };
  }

  private tileHasBlockingEntity(x: number, y: number): boolean {
    return this.snapshot.world.entities.some((entity) => (
      entity.kind === "building" && entity.x === x && entity.y === y
    ));
  }

  private tileAt(x: number, y: number): CivTile | undefined {
    return this.snapshot.world.tiles.find((tile) => tile.x === x && tile.y === y);
  }

  private playerAxo(): AxoSprite | null {
    if (!this.possessedEntityId) return null;
    return this.axos.get(this.possessedEntityId) ?? null;
  }

  private domControlFocused(): boolean {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    return ["BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) || el.isContentEditable;
  }

  private pointerOnMap(p: Phaser.Input.Pointer) {
    const { x, y, w, h } = this.mm;
    return p.x >= x - 5 && p.x <= x + w + 5 && p.y >= y - 5 && p.y <= y + h + 5;
  }

  private panFromMap(p: Phaser.Input.Pointer) {
    this.following = false;
    const { x, y, w, h } = this.mm;
    const fx = Phaser.Math.Clamp((p.x - x) / w, 0, 1);
    const fy = Phaser.Math.Clamp((p.y - y) / h, 0, 1);
    this.cameras.main.centerOn(fx * this.worldW, fy * this.worldH);
  }

  private zoomAt(screenX: number, screenY: number, factor: number) {
    const cam = this.cameras.main;
    const before = cam.getWorldPoint(screenX, screenY);
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, this.minZoom, this.maxZoom));
    const after = cam.getWorldPoint(screenX, screenY);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
  }

  private installCameraApi() {
    window.civCamera = {
      zoomBy: (factor: number) => {
        const cam = this.cameras.main;
        this.zoomAt(cam.width / 2, cam.height / 2, factor);
      },
      recenter: () => {
        const target = this.playerAxo();
        this.following = true;
        this.cameras.main.pan(target?.renderX ?? this.colony.x, target?.renderY ?? this.colony.y, 360, Phaser.Math.Easing.Sine.Out);
      },
      toggleFollow: () => {
        this.following = !this.following;
        if (this.following) {
          const target = this.playerAxo();
          this.cameras.main.pan(target?.renderX ?? this.colony.x, target?.renderY ?? this.colony.y, 360, Phaser.Math.Easing.Sine.Out);
        }
      },
      focusRegion: (rx: number, width: number) => {
        this.following = false;
        const cx = (rx + width / 2) * TILE_SIZE;
        const cy = this.worldH * 0.46;
        const cam = this.cameras.main;
        const target = Phaser.Math.Clamp(cam.width / (width * TILE_SIZE * 1.15), this.minZoom, this.maxZoom);
        cam.pan(cx, cy, 420, Phaser.Math.Easing.Sine.Out);
        cam.zoomTo(target, 420, Phaser.Math.Easing.Sine.Out);
      },
      // Additive (REN-02): the four methods above stay (ARENA-02 extend-only).
      focusCiv: (civId: string) => this.focusCiv(civId),
      frameAll: () => this.frameAll(),
    };
  }

  // Fit the camera over all LIVING colonies (the default multi-civ view). Falls
  // back to the single-colony centre when no colony resolves (T-02-04).
  private frameAll() {
    const cam = this.cameras.main;
    const cw = this.scale.width;
    const ch = this.scale.height;
    const b = colonyBounds(this.colonies, 6 * TILE_SIZE);
    if (!b || b.w <= 0 || b.h <= 0) {
      this.following = false;
      cam.pan(this.colony.x, this.colony.y, 420, Phaser.Math.Easing.Sine.Out);
      return;
    }
    this.following = false;
    const fit = Math.min(cw / b.w, ch / b.h);
    cam.zoomTo(Phaser.Math.Clamp(fit, this.minZoom, this.maxZoom), 420, Phaser.Math.Easing.Sine.Out);
    cam.pan(b.x + b.w / 2, b.y + b.h / 2, 420, Phaser.Math.Easing.Sine.Out);
  }

  // Pan + zoom to one civ's colony. Unresolvable civ -> fall back to frameAll().
  private focusCiv(civId: string) {
    const tgt = focusTarget(civId, this.snapshot.civs, this.snapshot.world.regions, this.snapshot.world.entities);
    if (!tgt) {
      this.frameAll();
      return;
    }
    this.following = false;
    const cam = this.cameras.main;
    const cx = tgt.tx * TILE_SIZE;
    const cy = tgt.ty * TILE_SIZE;
    const target = Phaser.Math.Clamp(cam.width / (28 * TILE_SIZE), this.minZoom, this.maxZoom);
    cam.pan(cx, cy, 420, Phaser.Math.Easing.Sine.Out);
    cam.zoomTo(target, 420, Phaser.Math.Easing.Sine.Out);
  }

  private onResize() {
    const cam = this.cameras.main;
    const cw = this.scale.width;
    const ch = this.scale.height;
    if (cw === 0 || ch === 0 || !this.worldW || !this.worldH) return;
    this.uiCam?.setSize(cw, ch);
    this.minZoom = Math.max(0.12, Math.min(cw / this.worldW, ch / this.worldH) * 0.92);
    // minimap sits bottom-left, sized to the world aspect.
    const mw = Math.max(150, Math.min(248, cw * 0.2));
    this.mm = { x: 16, y: ch - mw * (this.snapshot.world.height / this.snapshot.world.width) - 16, w: mw, h: mw * (this.snapshot.world.height / this.snapshot.world.width) };
    if (!this.framed) {
      this.framed = true;
      // Only use the multi-colony fit when there are >= 2 colonies; a lone colony
      // keeps the legacy single-civ world-fit (the dominant path) instead of being
      // clamped to maxZoom by its tiny 12-tile bounding box (MED-01).
      const b = this.colonies.length >= 2 ? colonyBounds(this.colonies, 6 * TILE_SIZE) : null;
      if (b && b.w > 0 && b.h > 0) {
        // Multi-colony fit: frame the bounding box over all living colonies, but
        // never zoom out past a readable per-colony scale (cap the default opening
        // view at ~88 visible tiles). Far-apart colonies may sit off-screen at the
        // start; the explicit "frame all" button zooms out to show every colony.
        const fit = Math.max(Math.min(cw / b.w, ch / b.h), cw / (88 * TILE_SIZE));
        cam.setZoom(Phaser.Math.Clamp(fit, this.minZoom, this.maxZoom));
        cam.centerOn(b.x + b.w / 2, b.y + b.h / 2);
      } else {
        // Fallback (single/no colony): the original world-fit centred on this.colony.
        const fit = Math.min(cw / this.worldW, ch / this.worldH);
        cam.setZoom(Phaser.Math.Clamp(Math.max(fit * 1.7, cw / (60 * TILE_SIZE)), this.minZoom, this.maxZoom));
        cam.centerOn(this.colony.x, this.colony.y);
      }
    } else {
      cam.setZoom(Phaser.Math.Clamp(cam.zoom, this.minZoom, this.maxZoom));
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  private recomputeColony() {
    const ents = this.snapshot.world.entities;
    const pond = ents.find((e) => e.role === "pond") ?? ents.find((e) => e.role === "nest");
    if (pond) {
      this.colony = { x: pond.x * TILE_SIZE + TILE_SIZE / 2, y: pond.y * TILE_SIZE - 6 };
      return;
    }
    const axos = ents.filter((e) => e.kind === "axolotl" && e.stage !== "egg");
    if (axos.length === 0) {
      this.colony = { x: this.worldW / 2, y: this.worldH * 0.45 };
      return;
    }
    const sx = axos.reduce((a, e) => a + e.x, 0) / axos.length;
    const sy = axos.reduce((a, e) => a + e.y, 0) / axos.length;
    this.colony = { x: sx * TILE_SIZE, y: sy * TILE_SIZE - 6 };
  }

  // One framing point (world pixels) per LIVING civ, via the same precedence as
  // focusTarget (home-region centre -> entities centroid -> spawn_x). Feeds the
  // multi-colony bounding box used by frameAll() and the default onResize fit.
  private recomputeColonies() {
    const civs = this.snapshot.civs ?? [];
    const regions = this.snapshot.world.regions;
    const entities = this.snapshot.world.entities;
    const out: { civId: string; x: number; y: number; alive: boolean }[] = [];
    for (const c of civs) {
      if (!c.id || c.alive === false) continue;
      const tgt = focusTarget(c.id, civs, regions, entities);
      if (!tgt) continue;
      out.push({ civId: c.id, x: tgt.tx * TILE_SIZE, y: tgt.ty * TILE_SIZE, alive: true });
    }
    this.colonies = out;
  }

  private spawnParticle(x: number, y: number, vx: number, vy: number, color: number, rise: boolean) {
    this.particles.push({ x, y, vx, vy, age: 0, ttl: rise ? 900 : 650, color, r: rand(0.8, 1.8), rise });
  }

  private spawnPulse(x: number, y: number, hue: number) {
    this.pulses.push({ x, y, age: 0, ttl: 850, hue });
  }
}

function morphVariant(entity: CivEntity, seed: number): number {
  const idx = entity.morph ? MORPHS.indexOf(entity.morph) : -1;
  if (idx >= 0) return idx;
  return seedVariant(seed, entity.id);
}

function morphGlowTint(morph: string | undefined): number {
  if (morph === "gfp") return 0x7dffb0;
  if (morph === "firefly") return 0xffe27a;
  return 0xc89bff;
}

function isSubstrate(terrain: string): boolean {
  return terrain !== "air" && terrain !== "water" && terrain !== "deepwater";
}

function terrainSignature(tiles: CivSessionSnapshot["world"]["tiles"]): string {
  let hash = 2166136261;
  for (const tile of tiles) {
    for (let i = 0; i < tile.terrain.length; i += 1) {
      hash ^= tile.terrain.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    hash ^= tile.resource?.charCodeAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return String(hash >>> 0);
}

function harvestYieldResource(resource: string) {
  return resource === "moss" ? "food" : resource;
}

function resourceFeedbackColor(resource: string) {
  if (resource === "food" || resource === "moss" || resource === "herbs") return 0x9be56f;
  if (resource === "clean_water" || resource === "ice") return 0xaee9ff;
  if (resource === "wood") return 0xd2a66f;
  if (resource === "stone" || resource === "ore") return 0xc6ccd2;
  if (resource === "clay") return 0xc9855a;
  if (resource === "fiber" || resource === "kelp") return 0x73f0df;
  if (resource === "tools") return 0xf0d27a;
  if (resource === "pearls") return 0xffdf7a;
  if (resource === "glowshards" || resource === "amber" || resource === "sulfur") return 0xc7a2ff;
  if (resource === "coral") return 0xff8fb4;
  return 0xffd76b;
}

function uniqueInteractions(items: PlayerInteraction[]) {
  const seen = new Set<string>();
  const unique: PlayerInteraction[] = [];
  for (const item of items) {
    const key = playerTargetKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function playerTargetKey(item: PlayerInteraction) {
  return item.targetId
    ? `${item.targetId}:${item.action ?? item.kind}`
    : `${item.kind}:${item.action ?? ""}:${item.label}:${Math.round(item.x)},${Math.round(item.y)}`;
}

function terrainYieldResource(terrain: string) {
  if (terrain === "moss" || terrain === "peat") return "fiber";
  if (["mud", "earth", "sand", "salt"].includes(terrain)) return "clay";
  if (terrain === "coral") return "coral";
  if (terrain === "ice") return "ice";
  if (terrain === "crystal") return "glowshards";
  return "stone";
}

function placeableBuildResource(resource: string) {
  return ["stone", "clay", "wood", "fiber", "coral", "ice"].includes(resource);
}

function placeTerrainForResource(resource: string) {
  if (resource === "clay") return "mud";
  if (resource === "wood" || resource === "fiber") return "moss";
  if (resource === "coral") return "coral";
  if (resource === "ice") return "ice";
  return "stone";
}

function rescueRubbleTiles(x: number, y: number) {
  const shaftX = Math.max(0, x - 1);
  const shaftTop = Math.max(7, y - 3);
  const tiles = [];
  for (let tileY = shaftTop; tileY <= y; tileY += 1) {
    tiles.push({ x: shaftX, y: tileY });
  }
  tiles.push({ x, y: y + 1 });
  return tiles;
}

function clampSize(size: number | null | undefined): number {
  const s = typeof size === "number" && size > 0 ? size : 1;
  return Math.max(0.45, Math.min(1.7, s));
}

function shade(color: number, factor: number): number {
  const r = Math.round(((color >> 16) & 0xff) * factor);
  const g = Math.round(((color >> 8) & 0xff) * factor);
  const b = Math.round((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

// Blend each channel toward white by `t` (0 = unchanged, 1 = white). Pure; used
// to keep a multiply civ-tint light enough that morph/GFP detail still reads.
function lighten(color: number, t: number): number {
  const f = Math.max(0, Math.min(1, t));
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const blend = (c: number) => Math.round(c + (0xff - c) * f);
  return (blend(r) << 16) | (blend(g) << 8) | blend(b);
}

/** Flat grey used to desaturate dead/collapsed civs' entities and overlays. */
const GREY_TINT = 0x888888;

// ── pure civ-tint helpers (Phaser-free named exports, unit-tested) ──────────

/**
 * Resolve a hex colour string to a 24-bit tint number. Total / fail-safe:
 * tolerant of a leading "#" and 3-digit shorthand; missing or non-finite input
 * returns 0xffffff (T-02-01 — a colour string only ever becomes a number, never
 * markup, and never throws / NaN).
 */
export function hexToTint(hex: string | null | undefined): number {
  if (!hex) return 0xffffff;
  const h = hex.replace(/^#/, "");
  if (h.length !== 3 && h.length !== 6) return 0xffffff;
  if (!/^[0-9a-fA-F]+$/.test(h)) return 0xffffff;
  const expanded = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = Number.parseInt(expanded, 16);
  return Number.isFinite(n) ? n : 0xffffff;
}

/**
 * Build the per-snapshot `civ_id -> {tint, alive}` lookup. Skips id-less civs;
 * `alive` defaults to true; an undefined civ list yields an empty map.
 */
export function buildCivColorMap(
  civs: { id?: string; color?: string; alive?: boolean }[] | undefined,
): Map<string, { tint: number; alive: boolean }> {
  const m = new Map<string, { tint: number; alive: boolean }>();
  for (const c of civs ?? []) {
    if (!c.id) continue;
    m.set(c.id, { tint: hexToTint(c.color), alive: c.alive !== false });
  }
  return m;
}

/**
 * Pick the tint to apply for an entity given its resolved civ info.
 * - undefined info (map miss — wild fauna / null civ_id) -> null = leave default.
 * - living civ -> a lightened identity tint (multiply keeps morph detail).
 * - dead civ -> the flat grey constant.
 */
export function civTintFor(
  info: { tint: number; alive: boolean } | undefined,
  grey: number = GREY_TINT,
): number | null {
  if (!info) return null;
  return info.alive ? lighten(info.tint, 0.5) : grey;
}

/**
 * Decide the territory overlay for a region's owner. Null when unowned/absent or
 * the owner is not a known civ (neutral, Pitfall 4); else the {tint, alive} entry.
 */
export function regionOverlayFor(
  owner: string | null | undefined,
  map: Map<string, { tint: number; alive: boolean }>,
): { tint: number; alive: boolean } | null {
  if (!owner) return null;
  return map.get(owner) ?? null;
}

/**
 * Axis-aligned bounding box over all LIVING colonies, in whatever unit the caller
 * passed (the scene passes world pixels). Dead colonies are excluded so a collapse
 * re-frame drops them; returns null when no colony is alive (T-02-04 — the caller
 * falls back to `this.colony`). Each side is inflated by `pad`. Pure — no Phaser.
 */
export function colonyBounds(
  colonies: { x: number; y: number; alive: boolean }[],
  pad: number,
): { x: number; y: number; w: number; h: number } | null {
  const live = colonies.filter((c) => c.alive);
  if (live.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of live) {
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y);
    maxY = Math.max(maxY, c.y);
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

/**
 * Resolve a civ's home point in WORLD-TILE coordinates (the caller multiplies by
 * TILE_SIZE, mirroring focusRegion's `(rx + width/2) * TILE_SIZE` math). Precedence:
 *   (a) the civ's home_region matched in `regions` -> that region's centre
 *       (`y + height/2`, NOT `height/2` — the region starts at its `y`, not 0);
 *   (b) else the centroid of entities whose civ_id === civId (~seabed level);
 *   (c) else the civ's spawn_x at the seabed band (WATER_FLOOR_Y), so all three
 *       branches resolve to comparable altitudes (the colony band, not the surface);
 *   (d) else null (T-02-04 — the caller falls back to frameAll()).
 * Pure — no Phaser; never throws on missing/malformed input.
 */
export function focusTarget(
  civId: string,
  civs: { id?: string; spawn_x?: number; home_region?: string }[] | undefined,
  regions: { id: string; x: number; y: number; width: number; height?: number; owner?: string | null }[] | undefined,
  entities: { civ_id?: string | null; x: number; y: number }[] | undefined,
): { tx: number; ty: number } | null {
  const civ = (civs ?? []).find((c) => c.id === civId);
  if (!civ) return null;
  // (a) home-region centre: region top (y) + half its height, not height/2.
  if (civ.home_region) {
    const region = (regions ?? []).find((r) => r.id === civ.home_region);
    if (region) {
      return { tx: region.x + region.width / 2, ty: region.y + (region.height ?? 0) / 2 };
    }
  }
  // (b) centroid of the civ's entities (already at ~seabed level).
  const own = (entities ?? []).filter((e) => e.civ_id === civId);
  if (own.length > 0) {
    const sx = own.reduce((a, e) => a + e.x, 0) / own.length;
    const sy = own.reduce((a, e) => a + e.y, 0) / own.length;
    return { tx: sx, ty: sy };
  }
  // (c) spawn_x at the seabed band — colonies live near WATER_FLOOR_Y, not the
  // water surface; matching the colony altitude the other branches resolve to.
  if (typeof civ.spawn_x === "number") {
    return { tx: civ.spawn_x, ty: WATER_FLOOR_Y };
  }
  // (d) unresolvable.
  return null;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function drawCornerReticle(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, len: number) {
  const x2 = x + size;
  const y2 = y + size;
  g.lineBetween(x, y, x + len, y);
  g.lineBetween(x, y, x, y + len);
  g.lineBetween(x2, y, x2 - len, y);
  g.lineBetween(x2, y, x2, y + len);
  g.lineBetween(x, y2, x + len, y2);
  g.lineBetween(x, y2, x, y2 - len);
  g.lineBetween(x2, y2, x2 - len, y2);
  g.lineBetween(x2, y2, x2, y2 - len);
}

function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

function hashInt(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function seedVariant(seed: number, id: string): number {
  let hash = seed >>> 0;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % VARIANT_COUNT;
}

export function renderSnapshotToText(snapshot: CivSessionSnapshot, playerState?: PlayerTextState, viewMode: GameViewMode = "play"): string {
  const civ = primaryCiv(snapshot);
  const possessedPlayer = playerState?.possessedEntityId && playerState.player
    ? { id: playerState.possessedEntityId, player: playerState.player }
    : null;
  const deathEvents = (snapshot.log ?? []).filter((entry) => (
    /\b(died|death|dead|collapsed|failure|failed|starved|perished)\b/i.test(`${entry.title} ${entry.body}`)
  )).length;
  const failedCivs = (snapshot.civs ?? []).filter((c) => c.alive === false || (c.population ?? 0) <= 0).length;
  const eggs = snapshot.world.entities.filter((entity) => isEggEntity(entity) && (!entity.civ_id || entity.civ_id === civ.id));
  const recentHatchLog = [...(snapshot.log ?? [])].reverse().find((entry) => entry.title === "Eggs hatched") ?? null;
  const recentCareLog = [...(snapshot.log ?? [])].reverse().find((entry) => entry.title === "Hatchling fed") ?? null;
  const recentDiscoveryLog = [...(snapshot.log ?? [])].reverse().find((entry) => entry.title === "Rare discovery") ?? null;
  return JSON.stringify({
    coordinate_system: "origin top-left; x right; y down; tiles are 16px",
    session: { id: snapshot.id, turn: snapshot.turn, model: civ.model ?? "unknown", view_mode: playerState?.view_mode ?? viewMode },
    run_tracking: {
      turns_elapsed: snapshot.turn,
      living_civs: Math.max(0, (snapshot.civs ?? []).length - failedCivs),
      failed_civs: failedCivs,
      death_events: deathEvents,
      no_turn_limit: true,
    },
    civilization: {
      id: civ.id,
      era: civ.era,
      population: civ.population,
      health: civ.health,
      morale: civ.morale,
      score: civ.score,
      resources: civ.resources,
      modifiers: snapshot.modifiers.map((modifier) => ({
        kind: modifier.kind,
        polarity: modifier.polarity,
        remaining_turns: modifier.remaining_turns,
      })),
    },
    economy: {
      currency_resource: "pearls",
      pearls: civ.resources?.pearls ?? 0,
      shop_goals: [
        { id: "common_egg", cost: 12 },
        { id: "rare_lure", cost: 10 },
        { id: "rare_egg", cost: 30 },
      ],
      recent_discovery: recentDiscoveryLog ? {
        turn: recentDiscoveryLog.turn,
        body: recentDiscoveryLog.body,
      } : null,
    },
    player: playerState ?? {
      possessedEntityId: null,
      view_mode: viewMode,
      control_mode: "released",
      pilot_active: false,
      player_tool: "use",
      player: null,
      animated_entities: [],
      active_target: null,
      target_lock: null,
      lastInteraction: null,
      nearby_interactions: [],
      task_interactions: [],
    },
    player_task: activeCivPlayerTask(snapshot, civ),
    hatchery: {
      recent_hatch: recentHatchLog ? {
        turn: recentHatchLog.turn,
        body: recentHatchLog.body,
      } : null,
      recent_care: recentCareLog ? {
        turn: recentCareLog.turn,
        body: recentCareLog.body,
      } : null,
      eggs: eggs.map((entity) => {
        const hatchesIn = hatchTurnsRemaining(entity);
        return {
          id: entity.id,
          name: entity.name,
          morph: entity.morph,
          pattern: entity.pattern,
          rarity: axolotlRarity(entity),
          rarity_label: rarityLabel(axolotlRarity(entity)),
          level: axolotlLevel(entity),
          gene_potential: genePotential(entity),
          hatches_in: hatchesIn,
          hatch_progress: hatchProgressPercent(entity),
          incubation_cost: {
            pearls: EGG_INCUBATE_PEARL_COST,
            food: EGG_INCUBATE_FOOD_COST,
          },
          can_incubate: hatchesIn !== null
            && hatchesIn > 1
            && (civ.resources?.pearls ?? 0) >= EGG_INCUBATE_PEARL_COST
            && (civ.resources?.food ?? 0) >= EGG_INCUBATE_FOOD_COST,
          source: (entity.parents ?? []).includes("shop") ? "shop" : "nest",
          x: entity.x,
          y: entity.y,
        };
      }),
    },
    visible_entities: snapshot.world.entities.map((entity) => {
      const livePlayer = possessedPlayer?.id === entity.id ? possessedPlayer.player : null;
      const creature = entity.kind === "axolotl" || isEggEntity(entity);
      return {
        id: entity.id,
        name: entity.name,
        kind: entity.kind,
        role: entity.role,
        morph: entity.morph,
        pattern: entity.pattern, // GEN-01 visible pattern (ARENA-01 text-state, mirrors morph)
        stage: entity.stage,
        rarity: creature ? axolotlRarity(entity) : null,
        level: creature ? axolotlLevel(entity) : null,
        gene_potential: creature ? genePotential(entity) : null,
        hatches_in: creature ? hatchTurnsRemaining(entity) : null,
        health: Math.round(entity.health ?? 0),
        sex: entity.sex,
        age: entity.age,
        accessories: entity.accessories,
        activity: livePlayer?.activity ?? entity.activity,
        target_x: entity.target_x,
        target_y: entity.target_y,
        x: livePlayer?.tile_x ?? entity.x,
        y: livePlayer?.tile_y ?? entity.y,
      };
    }),
    civs: (snapshot.civs ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      model: c.model,
      color: c.color,
      alive: c.alive,
      population: c.population,
      era: c.era,
      score: c.score,
      controller: c.controller ?? null,
      resources: c.resources,
    })),
    leaderboard: [...(snapshot.civs ?? [])]
      .sort((a, b) => (b.score.total ?? 0) - (a.score.total ?? 0))
      .map((c) => ({
        id: c.id,
        name: c.name,
        model: c.model,
        color: c.color,
        alive: c.alive,
        score: c.score,
        controller: c.controller ?? null,
      })),
    environment: snapshot.environment,
  });
}
