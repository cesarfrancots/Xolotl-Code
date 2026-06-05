import { useEffect, useRef } from "react";
import Phaser from "phaser";
import type { CivSessionSnapshot, CivEntity } from "../../bindings";

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
    civCamera?: {
      zoomBy(factor: number): void;
      recenter(): void;
      toggleFollow(): void;
      focusRegion(x: number, width: number): void;
    };
  }
}

type CivilizationGameCanvasProps = {
  snapshot: CivSessionSnapshot;
  turnRunning?: boolean;
};

const TILE_SIZE = 16;
const VARIANT_COUNT = 12;
const FRAMES_PER_VARIANT = 4;
const SURFACE_ROWS = 6; // air band at the very top (matches backend WATER_SURFACE_Y)

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
  glowshards: "res-glowshards",
};
const BUILDING_KEYS: Record<string, string> = {
  nest: "bld-nest", storage: "bld-storage", farm: "bld-farm", workshop: "bld-workshop",
  canal: "bld-canal", pond: "bld-pondheart",
};
const TERRAIN_TILES: Record<string, string> = {
  sand: "tile-sand", moss: "tile-moss", mud: "tile-mud",
  earth: "tile-earth", stone: "tile-stone", crystal: "tile-crystal",
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
};
// Minimap entity dot colours per morph.
const MORPH_DOT: Record<string, number> = {
  leucistic: 0xffd9e6, wild: 0x6f7d52, melanoid: 0x4a4a55, gold: 0xf2c75b, axanthic: 0xb9b39b,
  blue: 0x8fb8d8, copper: 0xc77f4a, gfp: 0x8effb4, albino: 0xfff0f4, piebald: 0xd8c0cc,
  firefly: 0xffe27a, mystic: 0xc89bff,
};

export function CivilizationGameCanvas({ snapshot, turnRunning = false }: CivilizationGameCanvasProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<CivPhaserScene | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const snapshotRef = useRef(snapshot);

  useEffect(() => {
    snapshotRef.current = snapshot;
    sceneRef.current?.setSnapshot(snapshot);
    window.render_game_to_text = () => renderSnapshotToText(snapshotRef.current);
    window.advanceTime = (ms: number) => sceneRef.current?.advanceTime(ms);
  }, [snapshot]);

  useEffect(() => {
    sceneRef.current?.setTurnRunning(turnRunning);
  }, [turnRunning]);

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
    scene.setTurnRunning(turnRunning);

    window.render_game_to_text = () => renderSnapshotToText(snapshotRef.current);
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

  private bgBase?: Phaser.GameObjects.Rectangle;
  private water?: Phaser.GameObjects.TileSprite;
  private wash?: Phaser.GameObjects.Graphics;
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

  private elapsed = 0;
  private prevTurn = 0;
  private colony = { x: 0, y: 0 };

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
        this.bgBase, this.water, this.wash, this.depthGrad, this.skyGrad,
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
    this.installCameraApi();
    this.scale.on("resize", () => this.onResize());

    this.rebuildWorld();
    this.syncEntities();
    this.recomputeColony();
    this.onResize();
  }

  // ── public bridge ────────────────────────────────────────────────────────
  setSnapshot(snapshot: CivSessionSnapshot) {
    if (snapshot.turn > this.prevTurn) this.spawnPulse(this.colony.x, this.colony.y, 0x6dd6a7);
    this.prevTurn = snapshot.turn;
    this.snapshot = snapshot;
    if (!this.sys?.isActive()) return;
    this.rebuildWorld();
    this.syncEntities();
    this.recomputeColony();
  }

  setTurnRunning(running: boolean) {
    this.turnRunning = running;
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
    const sig = `${world.width}x${world.height}:${this.snapshot.seed}`;

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
    for (const t of world.tiles) {
      if (isSubstrate(t.terrain) && t.y < this.floorByCol[t.x]) this.floorByCol[t.x] = t.y;
    }

    // water wash by region + a sky/depth gradient.
    this.wash?.clear();
    for (const region of world.regions ?? []) {
      const col = BIOME_WASH[region.biome];
      if (col === undefined) continue;
      this.wash?.fillStyle(col, 0.1);
      this.wash?.fillRect(region.x * TILE_SIZE, SURFACE_ROWS * TILE_SIZE, region.width * TILE_SIZE, this.worldH);
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
      if (tile.resource === "glowshards") {
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
      if (e.kind === "building") sig += `${e.id},${e.x},${e.y},${e.role};`;
    }
    if (sig === this.prevBuildingSig) return;
    this.prevBuildingSig = sig;
    layer.removeAll(true);
    const seen = new Set<string>();
    for (const entity of this.snapshot.world.entities) {
      if (entity.kind !== "building") continue;
      seen.add(entity.id);
      const key = BUILDING_KEYS[entity.role] ?? "bld-storage";
      if (!this.textures.exists(key)) continue;
      const px = entity.x * TILE_SIZE + TILE_SIZE / 2;
      const py = entity.y * TILE_SIZE + TILE_SIZE / 2;
      const img = this.add.image(px, py, key).setOrigin(0.5, 0.84);
      const big = entity.role === "pond" ? 58 : entity.role === "nest" ? 44 : 40;
      img.setDisplaySize(big, big);
      img.setDepth(entity.y * 0.02);
      layer.add(img);
      if (!this.knownBuildings.has(entity.id)) {
        this.spawnPulse(px, py - 6, 0xaee9ff);
        this.tweens.add({ targets: img, scaleX: img.scaleX * 1.12, scaleY: img.scaleY * 1.12, yoyo: true, duration: 240, ease: "Sine.out" });
      }
    }
    this.knownBuildings = seen;
  }

  // ── entities (persistent pool, diffed per snapshot) ───────────────────────
  private syncEntities() {
    const present = new Set<string>();
    for (const entity of this.snapshot.world.entities) {
      if (entity.kind === "building") continue;
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

  private createAxo(entity: CivEntity): AxoSprite {
    const px = entity.x * TILE_SIZE + TILE_SIZE / 2;
    const py = entity.y * TILE_SIZE + TILE_SIZE / 2 - 6;
    const isEgg = entity.kind === "egg" || entity.stage === "egg";
    const container = this.add.container(px, py);
    container.setDepth(8 + entity.y * 0.02);
    this.uiCam?.ignore(container);

    let body: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
    let glow: Phaser.GameObjects.Sprite | undefined;
    const glowMorph = entity.morph === "gfp" || entity.morph === "mystic" || entity.morph === "firefly";

    if (isEgg) {
      body = this.add.image(0, 0, this.textures.exists("egg") ? "egg" : "civ-water");
      body.setDisplaySize(13, 13);
    } else if (this.spritesReady) {
      const variant = morphVariant(entity, this.snapshot.seed);
      const s = this.add.sprite(0, 0, "civ-axolotls", variant * FRAMES_PER_VARIANT);
      s.setDisplaySize(38, 38);
      s.play({ key: `axo-${variant}`, startFrame: hashInt(entity.id) % FRAMES_PER_VARIANT });
      body = s;
      if (glowMorph) {
        // a second sprite playing the same swim cycle, so the halo tracks the body's pose.
        const g = this.add.sprite(0, 0, "civ-axolotls", variant * FRAMES_PER_VARIANT);
        g.play({ key: `axo-${variant}`, startFrame: hashInt(entity.id) % FRAMES_PER_VARIANT });
        g.setDisplaySize(57, 57);
        g.setTint(entity.morph === "gfp" ? 0x7dffb0 : entity.morph === "firefly" ? 0xffe27a : 0xc89bff);
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
    };
    this.syncAccessories(axo, entity);
    this.applyTarget(axo, entity);
    return axo;
  }

  private updateAxo(axo: AxoSprite, entity: CivEntity) {
    axo.homeX = entity.x * TILE_SIZE + TILE_SIZE / 2;
    axo.homeY = entity.y * TILE_SIZE + TILE_SIZE / 2 - 6;
    axo.activity = entity.activity ?? "";
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
    this.applyTarget(axo, entity);
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
    if (this.following && this.sys.isActive() && !cam.panEffect.isRunning && !this.dragging) {
      cam.scrollX += (this.colony.x - cam.midPoint.x) * Math.min(1, 0.06 * dtN);
      cam.scrollY += (this.colony.y - cam.midPoint.y) * Math.min(1, 0.06 * dtN);
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

  private animateEntities(dtN: number) {
    const sh = this.shadows;
    if (!sh) return;
    sh.clear();
    const view = this.cameras.main.worldView;
    for (const axo of this.axos.values()) {
      const t = this.elapsed * (axo.isEgg ? 0.0025 : 0.004) + axo.phase;
      const act = axo.activity;
      const hasTarget = axo.targetX !== undefined && axo.targetY !== undefined;

      // where it wants to be
      let wanderX = 0;
      let wanderY = 0;
      let bob = Math.sin(t) * (axo.isEgg ? 0.8 : 1.7);
      let squashX = 1;
      let squashY = 1;
      let sway = 0;
      let ease = 0.05;

      if (!axo.isEgg) {
        switch (act) {
          case "gather":
          case "eat": {
            ease = 0.08;
            const near = hasTarget && dist(axo.renderX, axo.renderY, axo.targetX!, axo.targetY!) < 16;
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
            const near = hasTarget && dist(axo.renderX, axo.renderY, axo.targetX!, axo.targetY!) < 18;
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
            ease = 0.09;
            wanderX = Math.sin(t * 1.7) * axo.wander * 2.4 + Math.sin(t * 3.3) * 1.5;
            wanderY = Math.cos(t * 2.1) * 3;
            bob = Math.sin(t * 2.4) * 2.4;
            squashY = 1 + 0.08 * Math.sin(this.elapsed * 0.02);
            break;
          }
          case "explore": {
            ease = 0.085;
            bob = Math.sin(t * 1.4) * 1.6;
            if (Math.random() < 0.06 * dtN) this.spawnParticle(axo.renderX - axo.facing * 8, axo.renderY, -axo.facing * 0.3, -0.4, 0xcdeefe, true);
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

      const anchorX = (hasTarget ? axo.targetX! : axo.homeX) + wanderX;
      const anchorY = (hasTarget ? axo.targetY! : axo.homeY) + wanderY;
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
      g.fillStyle(BIOME_WASH[region.biome] ?? 0x2f6f88, 0.34);
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
        this.following = true;
        this.cameras.main.pan(this.colony.x, this.colony.y, 360, "Sine.out");
      },
      toggleFollow: () => {
        this.following = !this.following;
        if (this.following) this.cameras.main.pan(this.colony.x, this.colony.y, 360, "Sine.out");
      },
      focusRegion: (rx: number, width: number) => {
        this.following = false;
        const cx = (rx + width / 2) * TILE_SIZE;
        const cy = this.worldH * 0.46;
        const cam = this.cameras.main;
        const target = Phaser.Math.Clamp(cam.width / (width * TILE_SIZE * 1.15), this.minZoom, this.maxZoom);
        cam.pan(cx, cy, 420, "Sine.out");
        cam.zoomTo(target, 420, "Sine.out");
      },
    };
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
      const fit = Math.min(cw / this.worldW, ch / this.worldH);
      cam.setZoom(Phaser.Math.Clamp(Math.max(fit * 1.7, cw / (60 * TILE_SIZE)), this.minZoom, this.maxZoom));
      cam.centerOn(this.colony.x, this.colony.y);
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

function isSubstrate(terrain: string): boolean {
  return terrain !== "air" && terrain !== "water" && terrain !== "deepwater";
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

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
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

function renderSnapshotToText(snapshot: CivSessionSnapshot): string {
  return JSON.stringify({
    coordinate_system: "origin top-left; x right; y down; tiles are 16px",
    session: { id: snapshot.id, turn: snapshot.turn, model: snapshot.model },
    civilization: {
      era: snapshot.civilization.era,
      population: snapshot.civilization.population,
      health: snapshot.civilization.health,
      morale: snapshot.civilization.morale,
      score: snapshot.civilization.score,
      resources: snapshot.civilization.resources,
      modifiers: snapshot.modifiers.map((modifier) => ({
        kind: modifier.kind,
        polarity: modifier.polarity,
        remaining_turns: modifier.remaining_turns,
      })),
    },
    visible_entities: snapshot.world.entities.map((entity) => ({
      id: entity.id,
      kind: entity.kind,
      role: entity.role,
      morph: entity.morph,
      stage: entity.stage,
      sex: entity.sex,
      age: entity.age,
      accessories: entity.accessories,
      activity: entity.activity,
      x: entity.x,
      y: entity.y,
    })),
  });
}
