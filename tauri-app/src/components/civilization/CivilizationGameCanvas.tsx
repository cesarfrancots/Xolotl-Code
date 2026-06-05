import { useEffect, useRef } from "react";
import Phaser from "phaser";
import type { CivSessionSnapshot, CivTile } from "../../bindings";

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
  }
}

type CivilizationGameCanvasProps = {
  snapshot: CivSessionSnapshot;
  turnRunning?: boolean;
};

const TILE_SIZE = 16;
const GAME_WIDTH = 64 * TILE_SIZE;
const GAME_HEIGHT = 36 * TILE_SIZE;
const VARIANT_COUNT = 12;
const FRAMES_PER_VARIANT = 4;
const WATER_SURFACE_Y = 23; // tiles above this are "air"/sky

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
      backgroundColor: "#070d11",
      render: { pixelArt: true, antialias: false },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
      },
      scene,
    });
    gameRef.current = game;
    scene.setTurnRunning(turnRunning);

    window.render_game_to_text = () => renderSnapshotToText(snapshotRef.current);
    window.advanceTime = (ms: number) => sceneRef.current?.advanceTime(ms);

    return () => {
      delete window.render_game_to_text;
      delete window.advanceTime;
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

type AxoSprite = {
  sprite: Phaser.GameObjects.Sprite;
  baseX: number;
  baseY: number;
  phase: number;
  wander: number;
};

type Pulse = { x: number; y: number; age: number; ttl: number; hue: number };

class CivPhaserScene extends Phaser.Scene {
  private snapshot: CivSessionSnapshot;
  private turnRunning = false;
  private spritesReady = false;

  private terrain?: Phaser.GameObjects.Graphics;
  private water?: Phaser.GameObjects.Graphics;
  private resourceLayer?: Phaser.GameObjects.Graphics;
  private sparkle?: Phaser.GameObjects.Graphics;
  private grid?: Phaser.GameObjects.Graphics;
  private shadows?: Phaser.GameObjects.Graphics;
  private effects?: Phaser.GameObjects.Graphics;

  private axos: AxoSprite[] = [];
  private buildings: Phaser.GameObjects.GameObject[] = [];
  private waterTiles: Array<{ x: number; y: number }> = [];
  private resourceTiles: CivTile[] = [];

  private elapsed = 0;
  private prevTurn = 0;
  private pulses: Pulse[] = [];
  private colony = { x: GAME_WIDTH / 2, y: GAME_HEIGHT * 0.45 };

  constructor(snapshot: CivSessionSnapshot) {
    super("CivPhaserScene");
    this.snapshot = snapshot;
    this.prevTurn = snapshot.turn;
  }

  preload() {
    this.load.spritesheet("civ-axolotls", "/civ/axolotl-animated-seeds.png", {
      frameWidth: 64,
      frameHeight: 64,
    });
  }

  create() {
    this.cameras.main.setBounds(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.terrain = this.add.graphics();
    this.water = this.add.graphics();
    this.resourceLayer = this.add.graphics();
    this.sparkle = this.add.graphics();
    this.grid = this.add.graphics();
    this.shadows = this.add.graphics();
    this.effects = this.add.graphics();

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

    this.renderWorld();
  }

  setSnapshot(snapshot: CivSessionSnapshot) {
    if (snapshot.turn > this.prevTurn) {
      this.spawnPulse(this.colony.x, this.colony.y, 0x6dd6a7);
    }
    this.prevTurn = snapshot.turn;
    this.snapshot = snapshot;
    if (this.sys?.isActive()) this.renderWorld();
  }

  setTurnRunning(running: boolean) {
    this.turnRunning = running;
  }

  /**
   * Deterministically advance the simulation clock. Intended for the headless /
   * observer harness (window.advanceTime) when the live requestAnimationFrame loop
   * is not driving the scene. step() is idempotent (clear-then-redraw, last write
   * wins), so calling this while the loop is also running merely fast-forwards.
   */
  advanceTime(ms: number) {
    const dt = Math.max(0, ms);
    this.elapsed += dt;
    if (this.sys?.isActive()) this.step(dt);
    for (const axo of this.axos) {
      // keep deterministic frame stepping for headless / observer use
      axo.sprite.anims?.update(this.elapsed, dt);
    }
  }

  update(_time: number, delta: number) {
    this.elapsed += delta;
    this.step(delta);
  }

  // --- world (static-ish) -------------------------------------------------
  private renderWorld() {
    if (!this.terrain || !this.resourceLayer || !this.grid) return;
    this.terrain.clear();
    this.resourceLayer.clear();
    this.grid.clear();
    for (const axo of this.axos) axo.sprite.destroy();
    for (const b of this.buildings) b.destroy();
    this.axos = [];
    this.buildings = [];
    this.waterTiles = [];
    this.resourceTiles = [];

    // sky -> water backdrop. Solid base first so the Canvas renderer (which ignores
    // gradient fills) still shows a sensible sky; WebGL layers the gradient on top.
    this.terrain.fillStyle(0x0a2029, 1);
    this.terrain.fillRect(0, 0, GAME_WIDTH, WATER_SURFACE_Y * TILE_SIZE);
    this.terrain.fillGradientStyle(0x081820, 0x081820, 0x0a232b, 0x0c2a33, 1);
    this.terrain.fillRect(0, 0, GAME_WIDTH, WATER_SURFACE_Y * TILE_SIZE);
    this.terrain.fillStyle(0x07171c, 1);
    this.terrain.fillRect(0, WATER_SURFACE_Y * TILE_SIZE, GAME_WIDTH, GAME_HEIGHT);

    for (const tile of this.snapshot.world.tiles) {
      drawTile(this.terrain, tile);
      if (tile.terrain === "water") this.waterTiles.push({ x: tile.x, y: tile.y });
      if (tile.resource && tile.amount > 0) {
        drawResource(this.resourceLayer, tile);
        this.resourceTiles.push(tile);
      }
    }

    this.grid.lineStyle(1, 0x1d3640, 0.22);
    for (let x = 0; x <= this.snapshot.world.width; x += 4) {
      this.grid.lineBetween(x * TILE_SIZE, 0, x * TILE_SIZE, GAME_HEIGHT);
    }
    for (let y = 0; y <= this.snapshot.world.height; y += 4) {
      this.grid.lineBetween(0, y * TILE_SIZE, GAME_WIDTH, y * TILE_SIZE);
    }

    let cxSum = 0;
    let cySum = 0;
    let axoCount = 0;
    for (const entity of this.snapshot.world.entities) {
      const px = entity.x * TILE_SIZE + TILE_SIZE / 2;
      const py = entity.y * TILE_SIZE + TILE_SIZE / 2;
      if (entity.kind === "axolotl") {
        const baseY = py - 8;
        if (this.spritesReady) {
          const variant = seedVariant(this.snapshot.seed, entity.id);
          const sprite = this.add.sprite(px, baseY, "civ-axolotls", variant * FRAMES_PER_VARIANT);
          const size = entity.role === "juvenile" ? 24 : entity.role === "caretaker" ? 32 : 29;
          sprite.setDisplaySize(size, size);
          sprite.play({ key: `axo-${variant}`, startFrame: hashInt(entity.id) % FRAMES_PER_VARIANT });
          this.axos.push({ sprite, baseX: px, baseY, phase: (hashInt(entity.id) % 360) * 0.0175, wander: 1 + (hashInt(entity.id) % 3) * 0.6 });
        } else {
          const dot = this.add.circle(px, baseY, 6, 0xef9bc0, 0.9) as unknown as Phaser.GameObjects.Sprite;
          this.axos.push({ sprite: dot, baseX: px, baseY, phase: hashInt(entity.id) % 7, wander: 1 });
        }
        cxSum += px;
        cySum += baseY;
        axoCount += 1;
      } else {
        const building = this.add.rectangle(px, py - 4, 26, 18, buildingColor(entity.role), 0.96);
        building.setStrokeStyle(1, 0xdafff7, 0.34);
        this.buildings.push(building);
        if (entity.role === "pond") this.colony = { x: px, y: py - 2 };
      }
    }
    if (axoCount > 0 && !this.snapshot.world.entities.some((e) => e.role === "pond")) {
      this.colony = { x: cxSum / axoCount, y: cySum / axoCount };
    }
  }

  // --- per-frame animation ------------------------------------------------
  private step(dt: number) {
    this.animateWater();
    this.animateSparkle();
    this.animateEntities();
    this.animateEffects(dt);
  }

  private animateWater() {
    if (!this.water) return;
    this.water.clear();
    const t = this.elapsed * 0.0016;
    for (const { x, y } of this.waterTiles) {
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      const wave = Math.sin((x + y) * 0.7 + t * 3);
      this.water.fillStyle(0x9ff0ff, 0.05 + 0.06 * (wave * 0.5 + 0.5));
      const ly = py + (wave > 0 ? 2 : TILE_SIZE - 4);
      this.water.fillRect(px + 1, ly, TILE_SIZE - 2, 1);
      // surface sheen on the top row of the pond
      if (y === WATER_SURFACE_Y) {
        this.water.fillStyle(0xffffff, 0.05 + 0.05 * Math.sin(x * 0.9 + t * 4));
        this.water.fillRect(px, py, TILE_SIZE, 1);
      }
    }
  }

  private animateSparkle() {
    if (!this.sparkle) return;
    this.sparkle.clear();
    const t = this.elapsed * 0.005;
    for (const tile of this.resourceTiles) {
      const twinkle = Math.sin(t + (tile.x * 13 + tile.y * 7));
      if (twinkle < 0.55) continue;
      const a = (twinkle - 0.55) / 0.45;
      const cx = tile.x * TILE_SIZE + 8;
      const cy = tile.y * TILE_SIZE + 4;
      this.sparkle.fillStyle(0xffffff, 0.5 * a);
      this.sparkle.fillRect(cx, cy - 2, 1, 5);
      this.sparkle.fillRect(cx - 2, cy, 5, 1);
    }
  }

  private animateEntities() {
    if (!this.shadows) return;
    this.shadows.clear();
    for (const axo of this.axos) {
      const t = this.elapsed * 0.004 + axo.phase;
      const bob = Math.sin(t) * 1.7;
      const wander = Math.sin(t * 0.6) * axo.wander;
      axo.sprite.x = axo.baseX + wander;
      axo.sprite.y = axo.baseY + bob;
      if ("flipX" in axo.sprite) axo.sprite.setFlipX(wander < 0);
      // contact shadow — tighter when the axolotl bobs up
      const lift = (bob + 1.7) / 3.4; // 0..1
      this.shadows.fillStyle(0x000000, 0.26 - lift * 0.12);
      const sw = 9 - lift * 2;
      this.shadows.fillEllipse(axo.baseX + wander, axo.baseY + 12, sw, 3.2);
    }
  }

  private animateEffects(dt: number) {
    if (!this.effects) return;
    this.effects.clear();

    // expanding turn-resolution rings
    for (const pulse of this.pulses) {
      pulse.age += dt;
      const k = pulse.age / pulse.ttl;
      if (k >= 1) continue;
      const r = 8 + k * 70;
      this.effects.lineStyle(2, pulse.hue, (1 - k) * 0.6);
      this.effects.strokeCircle(pulse.x, pulse.y, r);
    }
    this.pulses = this.pulses.filter((p) => p.age < p.ttl);

    // "thinking" feedback while a turn is being decided
    if (this.turnRunning) {
      const t = this.elapsed * 0.006;
      const aura = 0.18 + 0.12 * (Math.sin(t * 2) * 0.5 + 0.5);
      this.effects.lineStyle(2, 0x77d6ff, aura);
      this.effects.strokeCircle(this.colony.x, this.colony.y, 26 + Math.sin(t * 2) * 4);
      for (let i = 0; i < 3; i += 1) {
        const bob = Math.sin(t * 3 - i * 0.7) * 2;
        const a = 0.4 + 0.4 * (Math.sin(t * 3 - i * 0.7) * 0.5 + 0.5);
        this.effects.fillStyle(0xaee9ff, a);
        this.effects.fillCircle(this.colony.x - 8 + i * 8, this.colony.y - 30 + bob, 2);
      }
    }

    // score health band across the top
    const score = this.snapshot.civilization.score.total ?? 0;
    const band = score >= 70 ? 0x6dd6a7 : score >= 45 ? 0xd7bd67 : 0xc46767;
    const pulse = this.turnRunning ? 0.18 + 0.12 * (Math.sin(this.elapsed * 0.006) * 0.5 + 0.5) : 0.22;
    this.effects.fillStyle(band, pulse);
    this.effects.fillRect(0, 0, GAME_WIDTH, 4);
  }

  private spawnPulse(x: number, y: number, hue: number) {
    this.pulses.push({ x, y, age: 0, ttl: 850, hue });
  }
}

function drawTile(graphics: Phaser.GameObjects.Graphics, tile: CivTile) {
  if (tile.terrain === "air") return;
  const x = tile.x * TILE_SIZE;
  const y = tile.y * TILE_SIZE;
  graphics.fillStyle(terrainColor(tile.terrain, tile.x, tile.y), 1);
  graphics.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  graphics.fillStyle(0xffffff, tile.terrain === "water" ? 0.06 : 0.035);
  graphics.fillRect(x, y, TILE_SIZE, 1);
}

function drawResource(graphics: Phaser.GameObjects.Graphics, tile: CivTile) {
  const x = tile.x * TILE_SIZE + 4;
  const y = tile.y * TILE_SIZE + 4;
  graphics.fillStyle(resourceColor(tile.resource ?? ""), 0.92);
  graphics.fillRect(x, y, 8, 8);
  graphics.fillStyle(0xffffff, 0.22);
  graphics.fillRect(x + 2, y + 2, 3, 2);
}

function terrainColor(terrain: string, x: number, y: number): number {
  const jitter = ((x * 17 + y * 31) % 4) * 0x020202;
  switch (terrain) {
    case "water":
      return 0x1b6b78 + jitter;
    case "mud":
      return 0x51453f + jitter;
    case "earth":
      return 0x3c342b + jitter;
    case "stone":
      return 0x383d42 + jitter;
    default:
      return y < 11 ? 0x0c1d24 : 0x0a171c;
  }
}

function resourceColor(resource: string): number {
  switch (resource) {
    case "moss":
    case "food":
      return 0x74c96d;
    case "clean_water":
      return 0x63d7e8;
    case "wood":
      return 0xa57247;
    case "stone":
      return 0xaab1b7;
    case "clay":
      return 0xb56b58;
    case "fiber":
      return 0xd2d18a;
    case "glowshards":
      return 0xd67cf4;
    default:
      return 0xe0d2aa;
  }
}

function buildingColor(role: string): number {
  switch (role) {
    case "nest":
      return 0x8e6a58;
    case "farm":
      return 0x5e8a52;
    case "workshop":
      return 0x766b8f;
    case "canal":
      return 0x477b86;
    case "storage":
      return 0x9a774e;
    default:
      return 0x4d8790;
  }
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
      x: entity.x,
      y: entity.y,
    })),
  });
}
