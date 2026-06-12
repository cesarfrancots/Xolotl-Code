// Pondfall — Phaser renderer for the village and battles.
//
// The canvas is a dumb view over pondStore: it draws whatever the store
// holds, forwards pointer intents back into store actions, and (in battle
// mode) drives the pure simulation clock in lib/pond/battle.

import { useEffect, useRef } from "react";
import Phaser from "phaser";
import {
  BUILDINGS,
  GRID_SIZE,
  HERO_CROWN_SPRITE,
  OBSTACLES,
  RESOURCE_ICONS,
  SPELLS,
  TILE_TEXTURES,
  TROOPS,
  WORKER_SPRITE,
  buildingSpritePath,
  troopSpritePath,
} from "../../lib/pond/config";
import { canDeployAt, stepBattle } from "../../lib/pond/battle";
import { footprintFree, pendingProduction } from "../../lib/pond/village";
import type { BattleState, BuildingKind, SpellKind, TroopKind } from "../../lib/pond/types";
import { usePondStore } from "../../stores/pondStore";

const TILE = 24;
const WORLD = GRID_SIZE * TILE;
const MARGIN = TILE * 6;
const CLICK_SLOP_PX = 7;
const COLLECT_BADGE_MIN = 40;

const TROOP_SCALE = (TILE * 1.15) / 128;

type BuildingVisual = {
  sprite: Phaser.GameObjects.Image;
  badge?: Phaser.GameObjects.Image;
  bar?: Phaser.GameObjects.Graphics;
  /** Idle troops shown lounging on army camps. */
  troops?: Phaser.GameObjects.Image[];
};

/** The pixel tiles ship with a baked-in light border; crop it for tiling. */
const TILE_FRAME_INSET = 10;
const INNER_FRAME = "inner";

type TroopVisual = {
  sprite: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Graphics;
  /** The Supreme Axolotl wears its crown into battle. */
  crown?: Phaser.GameObjects.Image;
};

function textureKeyForBuilding(kind: BuildingKind): string {
  return `bld:${BUILDINGS[kind].sprite}`;
}

class PondScene extends Phaser.Scene {
  private buildingVisuals = new Map<string, BuildingVisual>();
  private obstacleVisuals = new Map<string, BuildingVisual>();
  private troopVisuals = new Map<string, TroopVisual>();
  private workerVisuals = new Map<string, Phaser.GameObjects.Image>();
  private workerFx: Phaser.GameObjects.Graphics | null = null;
  private ghost: Phaser.GameObjects.Image | null = null;
  private gridOverlay: Phaser.GameObjects.Graphics | null = null;
  private effects: Phaser.GameObjects.Graphics | null = null;
  private syncedLayoutRevision = -1;
  private syncedMode: "home" | "battle" | null = null;
  private downAt = { x: 0, y: 0, panning: false };
  private lastDrag = { x: 0, y: 0 };
  private lastHudPush = 0;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super("pond");
  }

  preload(): void {
    const seen = new Set<string>();
    for (const config of Object.values(BUILDINGS)) {
      const key = `bld:${config.sprite}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.load.image(key, buildingSpritePath(config.sprite));
    }
    for (const kind of Object.keys(TROOPS) as TroopKind[]) {
      this.load.image(`troop:${kind}`, troopSpritePath(kind));
    }
    for (const obstacle of Object.values(OBSTACLES)) {
      this.load.image(`obs:${obstacle.kind}`, buildingSpritePath(obstacle.sprite));
    }
    for (const spell of Object.values(SPELLS)) {
      this.load.image(`spell:${spell.kind}`, spell.icon);
    }
    this.load.image("worker", WORKER_SPRITE);
    this.load.image("crown", HERO_CROWN_SPRITE);
    this.load.image("egg", "/civ/stages/egg-single.png");
    this.load.image("icon:kelp", RESOURCE_ICONS.kelp);
    this.load.image("icon:shards", RESOURCE_ICONS.shards);
    this.load.image("tile:ground", TILE_TEXTURES.ground);
    this.load.image("tile:shore", TILE_TEXTURES.shore);
    this.load.image("tile:water", TILE_TEXTURES.deepwater);
  }

  create(): void {
    for (const key of ["tile:water", "tile:shore", "tile:ground", "bld:tile-moss"]) {
      const texture = this.textures.get(key);
      const source = texture.getSourceImage() as { width: number; height: number };
      texture.add(
        INNER_FRAME,
        0,
        TILE_FRAME_INSET,
        TILE_FRAME_INSET,
        source.width - TILE_FRAME_INSET * 2,
        source.height - TILE_FRAME_INSET * 2,
      );
    }

    // Water surrounds the playable moss shelf, like a pond seen from above.
    // The tile art carries its own border, so the repeat is locked to the
    // placement grid (one texture per 2×2 tiles) to read as deliberate seams.
    const groundScale = (TILE * 2) / 128;
    this.add
      .tileSprite(WORLD / 2, WORLD / 2, WORLD + MARGIN * 4, WORLD + MARGIN * 4, "tile:water", INNER_FRAME)
      .setTileScale(0.5)
      .setDepth(-30);
    this.add
      .tileSprite(WORLD / 2, WORLD / 2, WORLD + TILE * 2, WORLD + TILE * 2, "tile:shore")
      .setTileScale(groundScale)
      .setDepth(-20);
    this.add
      .tileSprite(WORLD / 2, WORLD / 2, WORLD, WORLD, "tile:ground")
      .setTileScale(groundScale)
      .setDepth(-10);

    this.gridOverlay = this.add.graphics().setDepth(-5);
    this.drawGrid();
    this.effects = this.add.graphics().setDepth(900);
    this.workerFx = this.add.graphics().setDepth(890);

    const camera = this.cameras.main;
    camera.setBounds(-MARGIN, -MARGIN, WORLD + MARGIN * 2, WORLD + MARGIN * 2);
    camera.centerOn(WORLD / 2, WORLD / 2);
    camera.setZoom(this.scale.height > 0 ? Math.max(0.7, this.scale.height / (WORLD + MARGIN)) : 1);

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.downAt = { x: pointer.x, y: pointer.y, panning: false };
      this.lastDrag = { x: pointer.x, y: pointer.y };
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      this.onPointerMove(pointer);
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      this.onPointerUp(pointer);
    });
    this.input.on(
      "wheel",
      (pointer: Phaser.Input.Pointer, _objs: unknown, _dx: number, dy: number) => {
        // Proportional to wheel delta (smooth on trackpads, stepped on mice),
        // capped per event so a flick can't slam the camera, and anchored on
        // the cursor so the point under the pointer stays put.
        const clamped = Phaser.Math.Clamp(dy, -50, 50);
        this.zoomAt(pointer.x, pointer.y, Math.exp(-clamped * 0.003));
      },
    );

    this.unsubscribe = usePondStore.subscribe(() => this.markDirty());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribe?.();
      this.unsubscribe = null;
    });
    this.markDirty();
  }

  private zoomAt(screenX: number, screenY: number, factor: number): void {
    const camera = this.cameras.main;
    const minZoom = Math.max(0.55, camera.height / (WORLD + MARGIN * 2));
    const next = Phaser.Math.Clamp(camera.zoom * factor, minZoom, 2.2);
    if (next === camera.zoom) return;
    const before = camera.getWorldPoint(screenX, screenY);
    camera.setZoom(next);
    const after = camera.getWorldPoint(screenX, screenY);
    camera.scrollX += before.x - after.x;
    camera.scrollY += before.y - after.y;
  }

  private drawGrid(): void {
    if (!this.gridOverlay) return;
    this.gridOverlay.clear();
    this.gridOverlay.lineStyle(1, 0x0c2f2c, 0.25);
    for (let i = 0; i <= GRID_SIZE; i += 1) {
      this.gridOverlay.lineBetween(i * TILE, 0, i * TILE, WORLD);
      this.gridOverlay.lineBetween(0, i * TILE, WORLD, i * TILE);
    }
  }

  private markDirty(): void {
    // Actual work happens in update(); the flag pattern keeps store
    // subscriptions cheap (they can fire many times per frame).
    this.syncedLayoutRevision = -1;
  }

  private tileAt(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return { x: Math.floor(world.x / TILE), y: Math.floor(world.y / TILE) };
  }

  private worldTileAt(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return { x: world.x / TILE, y: world.y / TILE };
  }

  private buildingIdAt(tileX: number, tileY: number): string | null {
    const store = usePondStore.getState();
    const list =
      store.mode === "battle"
        ? (store.battle?.buildings ?? []).filter((b) => !b.destroyed)
        : store.village.buildings;
    for (const building of list) {
      const size = BUILDINGS[building.kind].size;
      if (tileX >= building.x && tileX < building.x + size && tileY >= building.y && tileY < building.y + size) {
        return building.id;
      }
    }
    if (store.mode === "home") {
      for (const obstacle of store.village.obstacles) {
        const size = OBSTACLES[obstacle.kind].size;
        if (
          tileX >= obstacle.x &&
          tileX < obstacle.x + size &&
          tileY >= obstacle.y &&
          tileY < obstacle.y + size
        ) {
          return obstacle.id;
        }
      }
    }
    return null;
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (pointer.isDown) {
      const moved = Math.hypot(pointer.x - this.downAt.x, pointer.y - this.downAt.y);
      if (moved > CLICK_SLOP_PX) this.downAt.panning = true;
      if (this.downAt.panning) {
        const camera = this.cameras.main;
        camera.scrollX -= (pointer.x - this.lastDrag.x) / camera.zoom;
        camera.scrollY -= (pointer.y - this.lastDrag.y) / camera.zoom;
      }
      this.lastDrag = { x: pointer.x, y: pointer.y };
    }
    this.updateGhost(pointer);
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.downAt.panning) return;
    const store = usePondStore.getState();
    const tool = store.tool;
    const tile = this.tileAt(pointer);

    if (store.mode === "battle") {
      if (store.battle && !store.battle.ended) {
        const at = this.worldTileAt(pointer);
        if (tool.type === "deploy") store.deploy(tool.troop, at.x, at.y);
        else if (tool.type === "spell") store.cast(tool.spell, at.x, at.y);
      }
      return;
    }

    if (tool.type === "place") {
      const size = BUILDINGS[tool.kind].size;
      const x = tile.x - Math.floor(size / 2);
      const y = tile.y - Math.floor(size / 2);
      if (store.place(tool.kind, x, y)) {
        // Walls and traps place in runs — keep the tool armed (Esc/X cancels).
        const sticky = tool.kind === "wall" || Boolean(BUILDINGS[tool.kind].isTrap);
        if (!sticky) store.setTool({ type: "idle" });
      }
      return;
    }
    if (tool.type === "move") {
      const moving = store.village.buildings.find((b) => b.id === tool.buildingId);
      if (moving) {
        const size = BUILDINGS[moving.kind].size;
        const x = tile.x - Math.floor(size / 2);
        const y = tile.y - Math.floor(size / 2);
        if (store.move(moving.id, x, y)) store.setTool({ type: "idle" });
      }
      return;
    }

    const hitId = this.buildingIdAt(tile.x, tile.y);
    if (!hitId) {
      store.selectBuilding(null);
      return;
    }
    const building = store.village.buildings.find((b) => b.id === hitId);
    if (building && pendingProduction(building, Date.now()) >= COLLECT_BADGE_MIN) {
      store.collect(hitId);
    }
    store.selectBuilding(hitId);
  }

  private updateGhost(pointer: Phaser.Input.Pointer): void {
    const store = usePondStore.getState();
    const tool = store.tool;
    let ghostKind: BuildingKind | null = null;
    let validity = true;
    let footprint = 1;

    if (store.mode === "home" && (tool.type === "place" || tool.type === "move")) {
      const kind =
        tool.type === "place"
          ? tool.kind
          : store.village.buildings.find((b) => b.id === tool.buildingId)?.kind ?? null;
      if (kind) {
        ghostKind = kind;
        footprint = BUILDINGS[kind].size;
        const tile = this.tileAt(pointer);
        const x = tile.x - Math.floor(footprint / 2);
        const y = tile.y - Math.floor(footprint / 2);
        validity = footprintFree(
          store.village,
          x,
          y,
          footprint,
          tool.type === "move" ? tool.buildingId : undefined,
        );
        this.positionGhost(kind, x, y, validity);
      }
    } else if (store.mode === "battle" && tool.type === "deploy" && store.battle) {
      const at = this.worldTileAt(pointer);
      validity = canDeployAt(store.battle, at.x, at.y);
      this.positionDeployGhost(tool.troop, at.x, at.y, validity);
      return;
    } else if (store.mode === "battle" && tool.type === "spell" && store.battle) {
      const at = this.worldTileAt(pointer);
      this.positionSpellGhost(tool.spell, at.x, at.y);
      return;
    }

    if (!ghostKind && this.ghost) {
      this.ghost.destroy();
      this.ghost = null;
    }
  }

  private ensureGhost(textureKey: string): Phaser.GameObjects.Image {
    if (!this.ghost || this.ghost.texture.key !== textureKey) {
      this.ghost?.destroy();
      this.ghost = this.add.image(0, 0, textureKey).setAlpha(0.55).setDepth(800);
    }
    return this.ghost;
  }

  private positionGhost(kind: BuildingKind, x: number, y: number, valid: boolean): void {
    const size = BUILDINGS[kind].size;
    const ghost = this.ensureGhost(textureKeyForBuilding(kind));
    ghost.setDisplaySize(size * TILE, size * TILE);
    ghost.setPosition((x + size / 2) * TILE, (y + size / 2) * TILE);
    ghost.setTint(valid ? 0x9dffb0 : 0xff8a8a);
  }

  private positionDeployGhost(troop: TroopKind, x: number, y: number, valid: boolean): void {
    const ghost = this.ensureGhost(`troop:${troop}`);
    ghost.setScale(TROOP_SCALE * 1.1);
    ghost.setPosition(x * TILE, y * TILE);
    ghost.setTint(valid ? 0xffffff : 0xff8a8a);
  }

  private positionSpellGhost(spell: SpellKind, x: number, y: number): void {
    const ghost = this.ensureGhost(`spell:${spell}`);
    const diameter = SPELLS[spell].radiusTiles * 2 * TILE;
    ghost.setDisplaySize(diameter, diameter);
    ghost.setPosition(x * TILE, y * TILE);
    ghost.setAlpha(0.3);
    ghost.setTint(spell === "heal" ? 0x9dffb0 : 0x8fe6ff);
  }

  // ── Sprite syncing ──────────────────────────────────────────────────────

  private clearBuildingVisuals(): void {
    for (const visual of this.buildingVisuals.values()) {
      visual.sprite.destroy();
      visual.badge?.destroy();
      visual.bar?.destroy();
      for (const troop of visual.troops ?? []) troop.destroy();
    }
    this.buildingVisuals.clear();
    for (const visual of this.obstacleVisuals.values()) {
      visual.sprite.destroy();
      visual.bar?.destroy();
    }
    this.obstacleVisuals.clear();
    for (const sprite of this.workerVisuals.values()) sprite.destroy();
    this.workerVisuals.clear();
  }

  /**
   * Tadpoles idle by their workshop and swim over to active job sites,
   * splashing little work rings while they build.
   */
  private refreshWorkers(now: number): void {
    const store = usePondStore.getState();
    if (store.mode !== "home") return;
    const village = store.village;
    const live = new Set<string>();
    this.workerFx?.clear();

    const siteFor = (workshopId: string): { x: number; y: number } | null => {
      for (const building of village.buildings) {
        if (building.job?.workerId === workshopId) {
          const size = BUILDINGS[building.kind].size;
          return { x: (building.x + size / 2) * TILE, y: (building.y + size + 0.4) * TILE };
        }
      }
      for (const obstacle of village.obstacles) {
        if (obstacle.clearingUntil !== null && obstacle.clearingWorkerId === workshopId) {
          const size = OBSTACLES[obstacle.kind].size;
          return { x: (obstacle.x + size / 2) * TILE, y: (obstacle.y + size + 0.4) * TILE };
        }
      }
      return null;
    };

    for (const workshop of village.buildings) {
      if (workshop.kind !== "workshop" || !workshop.worker || workshop.level === 0) continue;
      live.add(workshop.id);
      let sprite = this.workerVisuals.get(workshop.id);
      if (!sprite) {
        sprite = this.add.image(0, 0, "worker").setScale(TROOP_SCALE * 0.85).setDepth(600);
        sprite.setPosition(
          (workshop.x + BUILDINGS.workshop.size + 0.5) * TILE,
          (workshop.y + BUILDINGS.workshop.size / 2) * TILE,
        );
        this.workerVisuals.set(workshop.id, sprite);
      }
      const site = siteFor(workshop.id);
      const home = {
        x: (workshop.x + BUILDINGS.workshop.size + 0.5) * TILE,
        y: (workshop.y + BUILDINGS.workshop.size / 2) * TILE,
      };
      const target = site ?? home;
      const bob = site ? Math.sin(now / 130) * 2.5 : Math.sin(now / 420) * 1.5;
      const goalX = target.x + (site ? Math.sin(now / 210) * 3 : 0);
      const goalY = target.y + bob;
      // Swim toward the goal instead of teleporting.
      const dx = goalX - sprite.x;
      const dy = goalY - sprite.y;
      const distance = Math.hypot(dx, dy);
      const arrived = distance < 14;
      const step = Math.min(distance, 3.2);
      if (distance > 0.5) {
        sprite.x += (dx / distance) * step;
        sprite.y += (dy / distance) * step;
      }
      sprite.setFlipX(dx < -1 ? true : dx > 1 ? false : sprite.flipX);
      // Hammering wiggle + splash rings once on site.
      if (site && arrived) {
        sprite.setRotation(Math.sin(now / 110) * 0.18);
        const phase = (now % 850) / 850;
        if (this.workerFx) {
          this.workerFx.lineStyle(2, 0xd9f3ff, 0.7 * (1 - phase));
          this.workerFx.strokeCircle(target.x, target.y + 4, 4 + phase * 14);
          if (phase < 0.3) {
            this.workerFx.fillStyle(0xfff1a8, 0.8);
            this.workerFx.fillCircle(target.x + Math.sin(now / 90) * 6, target.y - 2, 2);
          }
        }
      } else {
        sprite.setRotation(Math.sin(now / 500) * 0.05);
      }
    }

    for (const [id, sprite] of this.workerVisuals) {
      if (!live.has(id)) {
        sprite.destroy();
        this.workerVisuals.delete(id);
      }
    }
  }

  private syncObstacles(): void {
    const store = usePondStore.getState();
    const list = store.mode === "home" ? store.village.obstacles : [];
    const live = new Set<string>();
    for (const obstacle of list) {
      live.add(obstacle.id);
      const size = OBSTACLES[obstacle.kind].size;
      let visual = this.obstacleVisuals.get(obstacle.id);
      if (!visual) {
        visual = { sprite: this.add.image(0, 0, `obs:${obstacle.kind}`) };
        this.obstacleVisuals.set(obstacle.id, visual);
      }
      visual.sprite.setDisplaySize(size * TILE, size * TILE);
      visual.sprite.setPosition((obstacle.x + size / 2) * TILE, (obstacle.y + size / 2) * TILE);
      visual.sprite.setDepth(obstacle.y * 4 + 1);
      const selected = store.selectedBuildingId === obstacle.id;
      visual.sprite.setTint(selected ? 0xfff2ae : 0xffffff);
      visual.sprite.setAlpha(obstacle.clearingUntil !== null ? 0.6 : 1);
    }
    for (const [id, visual] of this.obstacleVisuals) {
      if (!live.has(id)) {
        visual.sprite.destroy();
        visual.bar?.destroy();
        this.obstacleVisuals.delete(id);
      }
    }
  }

  /** Up to four idle troops lounging on an army camp, CoC-style. */
  private syncCampTroops(visual: BuildingVisual, building: { x: number; y: number }): void {
    for (const troop of visual.troops ?? []) troop.destroy();
    visual.troops = [];
    const army = usePondStore.getState().village.army;
    const kinds = Object.entries(army)
      .filter(([, count]) => (count ?? 0) > 0)
      .map(([kind]) => kind as TroopKind)
      .slice(0, 4);
    const size = BUILDINGS.armyCamp.size;
    const spots = [
      [0.3, 0.35],
      [0.7, 0.4],
      [0.35, 0.72],
      [0.72, 0.74],
    ];
    kinds.forEach((kind, index) => {
      const [fx, fy] = spots[index];
      const image = this.add
        .image((building.x + size * fx) * TILE, (building.y + size * fy) * TILE, `troop:${kind}`)
        .setScale(TROOP_SCALE * 0.9)
        .setFlipX(index % 2 === 1)
        .setDepth(building.y * 4 + 3);
      visual.troops?.push(image);
    });
  }

  private clearTroopVisuals(): void {
    for (const visual of this.troopVisuals.values()) {
      visual.sprite.destroy();
      visual.bar.destroy();
      visual.crown?.destroy();
    }
    this.troopVisuals.clear();
  }

  /** The Supreme Axolotl lounges on its throne (crown and all) when home. */
  private syncThroneHero(visual: BuildingVisual, building: { x: number; y: number }): void {
    for (const extra of visual.troops ?? []) extra.destroy();
    visual.troops = [];
    const store = usePondStore.getState();
    if (!store.village.hero) return;
    const size = BUILDINGS.sovereignThrone.size;
    const cx = (building.x + size / 2) * TILE;
    const cy = (building.y + size / 2) * TILE;
    const away = store.village.hero.regenUntil > Date.now() || store.village.hero.upgradeJob;
    const body = this.add
      .image(cx, cy, "troop:sovereign")
      .setScale(TROOP_SCALE * 1.25)
      .setDepth(building.y * 4 + 3)
      .setAlpha(away ? 0.45 : 1);
    const crown = this.add
      .image(cx, cy - TILE * 0.55, "crown")
      .setScale(TROOP_SCALE * 0.6)
      .setDepth(building.y * 4 + 4)
      .setAlpha(away ? 0.45 : 1);
    visual.troops = [body, crown];
  }

  private syncBuildings(): void {
    const store = usePondStore.getState();
    const list = store.mode === "battle" ? store.battle?.buildings ?? [] : store.village.buildings;
    const live = new Set<string>();

    for (const building of list) {
      const config = BUILDINGS[building.kind];
      // Enemy traps stay invisible until they erupt (the blast effect shows).
      if (store.mode === "battle" && config.isTrap) continue;
      live.add(building.id);
      let visual = this.buildingVisuals.get(building.id);
      if (!visual) {
        const sprite = this.add.image(0, 0, textureKeyForBuilding(building.kind));
        visual = { sprite };
        this.buildingVisuals.set(building.id, visual);
      }
      const size = config.size;
      // The camp re-uses the moss tile art; crop its baked-in border.
      if (building.kind === "armyCamp") {
        visual.sprite.setTexture(textureKeyForBuilding(building.kind), INNER_FRAME);
      } else {
        visual.sprite.setTexture(textureKeyForBuilding(building.kind));
      }
      visual.sprite.setDisplaySize(size * TILE, size * TILE);
      visual.sprite.setPosition((building.x + size / 2) * TILE, (building.y + size / 2) * TILE);
      visual.sprite.setDepth(building.y * 4 + (building.kind === "wall" ? 0 : 2));

      if (store.mode === "battle") {
        const destroyed = "destroyed" in building && building.destroyed;
        visual.sprite.setTint(destroyed ? 0x2e2e38 : 0xffffff);
        visual.sprite.setAlpha(destroyed ? 0.55 : 1);
      } else {
        const selected = store.selectedBuildingId === building.id;
        const underConstruction = "job" in building && Boolean(building.job);
        // Distinguish same-sprite buildings with light tints. The camp is
        // darkened so its moss patch reads against the moss ground.
        const tint =
          building.kind === "crystalSpire"
            ? 0x8fe6ff
            : building.kind === "kelpVat"
              ? 0xc9ffc9
              : building.kind === "shardVault"
                ? 0xffd9f0
                : building.kind === "spellSpring"
                  ? 0xd5b8ff
                  : building.kind === "sovereignThrone"
                    ? 0xffd98a
                    : building.kind === "tideTrap"
                      ? 0x7fa8d8
                      : building.kind === "armyCamp"
                        ? 0x86b06a
                        : 0xffffff;
        visual.sprite.setTint(selected ? 0xfff2ae : tint);
        visual.sprite.setAlpha(underConstruction ? 0.65 : 1);
        if (building.kind === "armyCamp" && building.level > 0) {
          this.syncCampTroops(visual, building);
        }
        if (building.kind === "sovereignThrone" && building.level > 0) {
          this.syncThroneHero(visual, building);
        }
      }
    }

    for (const [id, visual] of this.buildingVisuals) {
      if (!live.has(id)) {
        visual.sprite.destroy();
        visual.badge?.destroy();
        visual.bar?.destroy();
        for (const troop of visual.troops ?? []) troop.destroy();
        this.buildingVisuals.delete(id);
      }
    }
  }

  /** Collect badges + construction bars; cheap enough to refresh every frame. */
  private refreshHomeOverlays(now: number): void {
    const store = usePondStore.getState();
    if (store.mode !== "home") return;
    for (const building of store.village.buildings) {
      const visual = this.buildingVisuals.get(building.id);
      if (!visual) continue;
      const config = BUILDINGS[building.kind];
      const size = config.size;
      const cx = (building.x + size / 2) * TILE;
      const topY = building.y * TILE;

      const pending = pendingProduction(building, now);
      if (pending >= COLLECT_BADGE_MIN && config.produces) {
        if (!visual.badge) {
          visual.badge = this.add
            .image(cx, topY, config.produces === "kelp" ? "icon:kelp" : "icon:shards")
            .setDisplaySize(TILE * 0.9, TILE * 0.9)
            .setDepth(950);
        }
        visual.badge.setPosition(cx, topY - 6 + Math.sin(now / 280) * 3);
      } else if (visual.badge && config.produces) {
        // Collector badges only — the hatchery manages its own egg badge below.
        visual.badge.destroy();
        visual.badge = undefined;
      }

      if (building.job) {
        if (!visual.bar) visual.bar = this.add.graphics().setDepth(950);
        const total = building.job.finishesAt - building.job.startedAt || 1;
        const progress = Phaser.Math.Clamp((now - building.job.startedAt) / total, 0, 1);
        const width = size * TILE * 0.8;
        visual.bar.clear();
        visual.bar.fillStyle(0x081b1a, 0.85);
        visual.bar.fillRect(cx - width / 2, topY - 10, width, 5);
        visual.bar.fillStyle(0x6fe3a5, 1);
        visual.bar.fillRect(cx - width / 2, topY - 10, width * progress, 5);
      } else if (building.kind === "hatchery" && store.village.trainQueue.length > 0) {
        // Hatching progress: a bobbing egg + cyan bar, visible without any panel.
        const head = store.village.trainQueue[0];
        const total = TROOPS[head.troop].trainTimeMs || 1;
        const progress = Phaser.Math.Clamp(1 - (head.finishesAt - now) / total, 0, 1);
        if (!visual.badge) {
          visual.badge = this.add
            .image(cx, topY, "egg")
            .setDisplaySize(TILE * 0.9, TILE * 0.9)
            .setDepth(950);
        }
        visual.badge.setTexture("egg");
        visual.badge.setPosition(cx, topY - 16 + Math.sin(now / 280) * 3);
        if (!visual.bar) visual.bar = this.add.graphics().setDepth(950);
        const width = size * TILE * 0.8;
        visual.bar.clear();
        visual.bar.fillStyle(0x081b1a, 0.85);
        visual.bar.fillRect(cx - width / 2, topY - 8, width, 5);
        visual.bar.fillStyle(0x7fd1ff, 1);
        visual.bar.fillRect(cx - width / 2, topY - 8, width * progress, 5);
      } else if (visual.bar) {
        visual.bar.destroy();
        visual.bar = undefined;
        if (building.kind === "hatchery" && visual.badge) {
          visual.badge.destroy();
          visual.badge = undefined;
        }
      }
    }

    for (const obstacle of store.village.obstacles) {
      const visual = this.obstacleVisuals.get(obstacle.id);
      if (!visual) continue;
      if (obstacle.clearingUntil !== null) {
        if (!visual.bar) visual.bar = this.add.graphics().setDepth(950);
        const config = OBSTACLES[obstacle.kind];
        const progress = Phaser.Math.Clamp(
          1 - (obstacle.clearingUntil - now) / config.clearTimeMs,
          0,
          1,
        );
        const cx = (obstacle.x + config.size / 2) * TILE;
        const topY = obstacle.y * TILE;
        const width = config.size * TILE * 0.8;
        visual.bar.clear();
        visual.bar.fillStyle(0x081b1a, 0.85);
        visual.bar.fillRect(cx - width / 2, topY - 10, width, 5);
        visual.bar.fillStyle(0xf2d06b, 1);
        visual.bar.fillRect(cx - width / 2, topY - 10, width * progress, 5);
      } else if (visual.bar) {
        visual.bar.destroy();
        visual.bar = undefined;
      }
    }
  }

  private syncTroops(battle: BattleState): void {
    const live = new Set<string>();
    for (const troop of battle.troops) {
      if (troop.dead) continue;
      live.add(troop.id);
      let visual = this.troopVisuals.get(troop.id);
      if (!visual) {
        const hero = troop.kind === "sovereign";
        const sprite = this.add
          .image(0, 0, `troop:${troop.kind}`)
          .setScale(TROOP_SCALE * (hero ? 1.3 : 1))
          .setDepth(700);
        const bar = this.add.graphics().setDepth(701);
        visual = { sprite, bar };
        if (hero) {
          visual.crown = this.add.image(0, 0, "crown").setScale(TROOP_SCALE * 0.6).setDepth(702);
        }
        this.troopVisuals.set(troop.id, visual);
      }
      const px = troop.x * TILE;
      const py = troop.y * TILE;
      visual.sprite.setFlipX(visual.sprite.x > px);
      visual.sprite.setPosition(px, py);
      // Raging hero glows red-hot.
      visual.sprite.setTint((troop.rageMsLeft ?? 0) > 0 ? 0xffb08a : 0xffffff);
      visual.crown?.setPosition(px, py - TILE * 0.62);
      visual.bar.clear();
      if (troop.hp < troop.maxHp) {
        const width = TILE * 1.1;
        visual.bar.fillStyle(0x081b1a, 0.85);
        visual.bar.fillRect(px - width / 2, py - TILE * 0.85, width, 3);
        visual.bar.fillStyle(troop.kind === "sovereign" ? 0xffd06b : 0x7fd1ff, 1);
        visual.bar.fillRect(px - width / 2, py - TILE * 0.85, width * (troop.hp / troop.maxHp), 3);
      }
    }
    for (const [id, visual] of this.troopVisuals) {
      if (!live.has(id)) {
        visual.sprite.destroy();
        visual.bar.destroy();
        visual.crown?.destroy();
        this.troopVisuals.delete(id);
      }
    }
  }

  private drawBattleEffects(battle: BattleState): void {
    if (!this.effects) return;
    this.effects.clear();
    // Active spell zones pulse gently while they last.
    const pulse = 0.8 + Math.sin(this.time.now / 180) * 0.2;
    for (const spell of battle.activeSpells) {
      const config = SPELLS[spell.kind];
      const color = spell.kind === "heal" ? 0x9dffb0 : 0x8fe6ff;
      this.effects.lineStyle(2, color, 0.7 * pulse);
      this.effects.strokeCircle(spell.x * TILE, spell.y * TILE, config.radiusTiles * TILE);
      this.effects.fillStyle(color, 0.10 * pulse);
      this.effects.fillCircle(spell.x * TILE, spell.y * TILE, config.radiusTiles * TILE);
    }
    for (const event of battle.events) {
      if (event.type === "shot" && event.x !== undefined && event.y !== undefined) {
        const source =
          battle.troops.find((t) => t.id === event.fromId) ??
          battle.buildings.find((b) => b.id === event.fromId);
        if (source) {
          const sx = "kind" in source && typeof source.x === "number" ? source.x : 0;
          const sy = source.y;
          this.effects.lineStyle(2, 0xaef3ff, 0.9);
          this.effects.lineBetween(sx * TILE, sy * TILE, event.x * TILE, event.y * TILE);
        }
        this.effects.fillStyle(0xfff1a8, 0.9);
        this.effects.fillCircle(event.x * TILE, event.y * TILE, 4);
      } else if (event.type === "heal" && event.x !== undefined && event.y !== undefined) {
        this.effects.lineStyle(2, 0x9dffb0, 0.8);
        this.effects.strokeCircle(event.x * TILE, event.y * TILE, TILE * 0.7);
      } else if (event.type === "destroyed" && event.x !== undefined && event.y !== undefined) {
        this.effects.fillStyle(0xffb38a, 0.5);
        this.effects.fillCircle(event.x * TILE, event.y * TILE, TILE * 1.4);
      }
    }
  }

  update(time: number, delta: number): void {
    const store = usePondStore.getState();

    const modeChanged = this.syncedMode !== store.mode;
    if (modeChanged) {
      this.syncedMode = store.mode;
      this.clearBuildingVisuals();
      this.clearTroopVisuals();
      this.effects?.clear();
      this.workerFx?.clear();
      for (const sprite of this.workerVisuals.values()) sprite.destroy();
      this.workerVisuals.clear();
      this.ghost?.destroy();
      this.ghost = null;
      this.syncedLayoutRevision = -1;
      // Reset the camera so battles never start at a leftover extreme zoom.
      this.cameras.main.setZoom(
        Math.max(0.7, this.scale.height / (WORLD + MARGIN)) || 1,
      );
      this.cameras.main.centerOn(WORLD / 2, WORLD / 2);
    }

    if (this.syncedLayoutRevision !== store.layoutRevision) {
      this.syncedLayoutRevision = store.layoutRevision;
      this.syncBuildings();
      this.syncObstacles();
    }

    if (store.mode === "home") {
      const wallNow = Date.now();
      this.refreshHomeOverlays(wallNow);
      this.refreshWorkers(wallNow);
      return;
    }

    const battle = store.battle;
    if (!battle) return;
    if (!battle.ended) {
      stepBattle(battle, delta);
      this.syncBuildings();
      this.syncTroops(battle);
      this.drawBattleEffects(battle);
      if (time - this.lastHudPush > 200 || battle.ended) {
        this.lastHudPush = time;
        store.notifyBattleTick();
      }
    }
  }
}

export function PondCanvas() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!hostRef.current || gameRef.current) return;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: hostRef.current,
      backgroundColor: "#07181f",
      pixelArt: true,
      scene: [PondScene],
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: hostRef.current.clientWidth || 800,
        height: hostRef.current.clientHeight || 600,
      },
    });
    gameRef.current = game;
    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return <div ref={hostRef} className="pond-canvas-host" data-testid="pond-canvas" />;
}
