// Pondfall — UI/game store shared by the React HUD and the Phaser canvas.
//
// The store owns the persistent VillageState and the transient BattleState.
// All mutations route through the pure logic in lib/pond so the store stays
// a thin orchestration layer: settle timers → apply action → persist.

import { create } from "zustand";
import type {
  BattleState,
  BuildingKind,
  SpellKind,
  TroopKind,
  VillageState,
} from "../lib/pond/types";
import {
  applyBattleOutcome,
  brewSpell,
  cancelTraining,
  clearObstacle,
  collectFrom,
  finishNow,
  heroReady,
  knockOutHero,
  moveBuilding,
  placeBuilding,
  recordRaid,
  settleVillage,
  startHeroUpgrade,
  startResearch,
  trainTroop,
  upgradeBuilding,
  upgradeWorker,
  type ActionResult,
} from "../lib/pond/village";
import { castSpell, createBattle, deployTroop, spellsSpent, troopsSpent } from "../lib/pond/battle";
import { HERO_REGEN_MS, battlePearls, nextEnemyCost } from "../lib/pond/config";
import { generateEnemyVillage, simulateAwayRaid } from "../lib/pond/enemy";
import { loadVillage, resetVillage, saveVillage } from "../lib/pond/save";

export type PondMode = "home" | "battle";

/** Pointer interaction the canvas should run: idle pan/select, placing a new
 *  building, moving an existing one, or deploying troops in battle. */
export type CanvasTool =
  | { type: "idle" }
  | { type: "place"; kind: BuildingKind }
  | { type: "move"; buildingId: string }
  | { type: "deploy"; troop: TroopKind }
  | { type: "spell"; spell: SpellKind };

interface PondStore {
  village: VillageState;
  mode: PondMode;
  tool: CanvasTool;
  selectedBuildingId: string | null;
  shopOpen: boolean;
  armyOpen: boolean;
  /** One-line status/error surfaced in the HUD, auto-cleared by the view. */
  notice: string | null;
  /** Bumped whenever village layout changes so the canvas re-syncs sprites. */
  layoutRevision: number;
  battle: BattleState | null;
  /** Bumped by the canvas a few times a second during battle for HUD updates. */
  battleRevision: number;

  hydrate: () => void;
  settle: () => void;
  setMode: (mode: PondMode) => void;
  setTool: (tool: CanvasTool) => void;
  selectBuilding: (id: string | null) => void;
  setShopOpen: (open: boolean) => void;
  setArmyOpen: (open: boolean) => void;
  setNotice: (notice: string | null) => void;

  place: (kind: BuildingKind, x: number, y: number) => boolean;
  move: (id: string, x: number, y: number) => boolean;
  upgrade: (id: string) => boolean;
  collect: (id: string) => boolean;
  train: (troop: TroopKind) => boolean;
  cancelTrain: (index: number) => boolean;
  brew: (spell: SpellKind) => boolean;
  research: (troop: TroopKind) => boolean;
  upgradeHero: () => boolean;
  finishBuildingNow: (id: string) => boolean;
  finishResearchNow: () => boolean;
  finishHeroNow: () => boolean;
  clearObstacleById: (id: string) => boolean;
  upgradeWorkerAt: (workshopId: string) => boolean;
  resetGame: () => void;

  startBattle: () => void;
  nextEnemy: () => void;
  deploy: (troop: TroopKind, x: number, y: number) => boolean;
  cast: (spell: SpellKind, x: number, y: number) => boolean;
  notifyBattleTick: () => void;
  endBattle: () => void;
  surrenderBattle: () => void;
}

export const usePondStore = create<PondStore>()((set, get) => {
  const commit = (result: ActionResult): boolean => {
    if (!result.ok) {
      set({ notice: result.error });
      return false;
    }
    saveVillage(result.village);
    set((s) => ({ village: result.village, layoutRevision: s.layoutRevision + 1, notice: null }));
    return true;
  };

  return {
    village: loadVillage(Date.now()),
    mode: "home",
    tool: { type: "idle" },
    selectedBuildingId: null,
    shopOpen: false,
    armyOpen: false,
    notice: null,
    layoutRevision: 0,
    battle: null,
    battleRevision: 0,

    hydrate: () => {
      const now = Date.now();
      let village = settleVillage(loadVillage(now), now);
      const raid = simulateAwayRaid(village, now);
      if (raid) {
        village = recordRaid(village, raid);
        set({
          notice: raid.defended
            ? `${raid.attackerName} attacked while you were away — your defenses held!`
            : `${raid.attackerName} raided your pond while you were away.`,
        });
      }
      saveVillage(village);
      set((s) => ({ village, layoutRevision: s.layoutRevision + 1 }));
    },

    settle: () => {
      const now = Date.now();
      const village = settleVillage(get().village, now);
      saveVillage(village);
      set((s) => ({ village, layoutRevision: s.layoutRevision + 1 }));
    },

    setMode: (mode) => set({ mode }),
    setTool: (tool) => set({ tool }),
    selectBuilding: (id) =>
      set({ selectedBuildingId: id, ...(id ? { shopOpen: false, armyOpen: false } : {}) }),
    setShopOpen: (open) =>
      set({ shopOpen: open, ...(open ? { armyOpen: false, selectedBuildingId: null } : {}) }),
    setArmyOpen: (open) =>
      set({ armyOpen: open, ...(open ? { shopOpen: false, selectedBuildingId: null } : {}) }),
    setNotice: (notice) => set({ notice }),

    place: (kind, x, y) => {
      const now = Date.now();
      const settled = settleVillage(get().village, now);
      return commit(placeBuilding(settled, kind, x, y, now));
    },
    move: (id, x, y) => {
      const settled = settleVillage(get().village, Date.now());
      return commit(moveBuilding(settled, id, x, y));
    },
    upgrade: (id) => {
      const now = Date.now();
      const settled = settleVillage(get().village, now);
      return commit(upgradeBuilding(settled, id, now));
    },
    collect: (id) => {
      const now = Date.now();
      const settled = settleVillage(get().village, now);
      return commit(collectFrom(settled, id, now));
    },
    train: (troop) => {
      const now = Date.now();
      const settled = settleVillage(get().village, now);
      return commit(trainTroop(settled, troop, now));
    },
    cancelTrain: (index) => {
      const now = Date.now();
      const settled = settleVillage(get().village, now);
      return commit(cancelTraining(settled, index, now));
    },
    brew: (spell) => {
      const now = Date.now();
      const settled = settleVillage(get().village, now);
      return commit(brewSpell(settled, spell, now));
    },
    research: (troop) => {
      const now = Date.now();
      const settled = settleVillage(get().village, now);
      return commit(startResearch(settled, troop, now));
    },
    upgradeHero: () => {
      const now = Date.now();
      const settled = settleVillage(get().village, now);
      return commit(startHeroUpgrade(settled, now));
    },
    finishHeroNow: () => {
      const now = Date.now();
      const settled = settleVillage(get().village, now);
      return commit(finishNow(settled, { type: "hero" }, now));
    },
    finishBuildingNow: (id) => {
      const now = Date.now();
      const settled = settleVillage(get().village, now);
      return commit(finishNow(settled, { type: "building", id }, now));
    },
    finishResearchNow: () => {
      const now = Date.now();
      const settled = settleVillage(get().village, now);
      return commit(finishNow(settled, { type: "research" }, now));
    },
    clearObstacleById: (id) => {
      const now = Date.now();
      const settled = settleVillage(get().village, now);
      return commit(clearObstacle(settled, id, now));
    },
    upgradeWorkerAt: (workshopId) => {
      const settled = settleVillage(get().village, Date.now());
      return commit(upgradeWorker(settled, workshopId));
    },
    resetGame: () => {
      const village = resetVillage(Date.now());
      set((s) => ({
        village,
        battle: null,
        mode: "home",
        tool: { type: "idle" },
        selectedBuildingId: null,
        layoutRevision: s.layoutRevision + 1,
        notice: "A fresh pond awaits.",
      }));
    },

    startBattle: () => {
      const now = Date.now();
      const village = settleVillage(get().village, now);
      const hasArmy = Object.values(village.army).some((count) => (count ?? 0) > 0);
      if (!hasArmy) {
        set({ notice: "Train some axolotls before raiding." });
        return;
      }
      saveVillage(village);
      const enemy = generateEnemyVillage(village, now);
      const battle = createBattle({
        enemyName: enemy.name,
        enemyTownHallLevel: enemy.townHallLevel,
        buildings: enemy.buildings,
        army: { ...village.army, ...(heroReady(village, now) ? { sovereign: 1 } : {}) },
        troopLevels: { ...village.research, sovereign: village.hero?.level ?? 1 },
        spells: village.spells,
        trophyReward: enemy.trophyReward,
        trophyRisk: enemy.trophyRisk,
      });
      set((s) => ({
        village,
        battle,
        mode: "battle",
        tool: { type: "idle" },
        selectedBuildingId: null,
        shopOpen: false,
        armyOpen: false,
        layoutRevision: s.layoutRevision + 1,
        battleRevision: 0,
        notice: null,
      }));
    },

    nextEnemy: () => {
      const battle = get().battle;
      if (!battle || battle.ended || battle.troops.length > 0) return;
      const now = Date.now();
      const village = settleVillage(get().village, now);
      const cost = nextEnemyCost(battle.enemyTownHallLevel);
      if (village.resources.shards < cost) {
        set({ notice: `Scouting another pond costs ${cost} glowshards.` });
        return;
      }
      village.resources.shards -= cost;
      saveVillage(village);
      const enemy = generateEnemyVillage(village, now);
      const next = createBattle({
        enemyName: enemy.name,
        enemyTownHallLevel: enemy.townHallLevel,
        buildings: enemy.buildings,
        army: { ...village.army, ...(heroReady(village, now) ? { sovereign: 1 } : {}) },
        troopLevels: { ...village.research, sovereign: village.hero?.level ?? 1 },
        spells: village.spells,
        trophyReward: enemy.trophyReward,
        trophyRisk: enemy.trophyRisk,
      });
      set((s) => ({
        village,
        battle: next,
        layoutRevision: s.layoutRevision + 1,
        battleRevision: s.battleRevision + 1,
        notice: null,
      }));
    },

    deploy: (troop, x, y) => {
      const battle = get().battle;
      if (!battle) return false;
      const placed = deployTroop(battle, troop, x, y);
      if (placed) set((s) => ({ battleRevision: s.battleRevision + 1 }));
      return placed;
    },

    cast: (spell, x, y) => {
      const battle = get().battle;
      if (!battle) return false;
      const casted = castSpell(battle, spell, x, y);
      if (casted) set((s) => ({ battleRevision: s.battleRevision + 1 }));
      return casted;
    },

    notifyBattleTick: () => set((s) => ({ battleRevision: s.battleRevision + 1 })),

    endBattle: () => {
      const battle = get().battle;
      if (!battle) return;
      // The hero is not an army unit: it comes home (or regenerates if KO'd).
      const spent = troopsSpent(battle);
      delete spent.sovereign;
      const trophyDelta = battle.victory
        ? battle.trophyReward
        : battle.troops.length > 0
          ? -battle.trophyRisk
          : 0;
      let village = applyBattleOutcome(get().village, {
        victory: battle.victory,
        lootWon: battle.lootWon,
        trophyDelta,
        pearlsWon: battlePearls(battle.stars),
        troopsSpent: spent,
        spellsSpent: spellsSpent(battle, get().village.spells),
      });
      const heroTroop = battle.troops.find((t) => t.kind === "sovereign");
      if (heroTroop?.dead) {
        village = knockOutHero(village, Date.now(), HERO_REGEN_MS);
      }
      saveVillage(village);
      set((s) => ({
        village,
        battle: null,
        mode: "home",
        tool: { type: "idle" },
        layoutRevision: s.layoutRevision + 1,
      }));
    },

    surrenderBattle: () => {
      const battle = get().battle;
      if (!battle || battle.ended) return;
      // End the fight but keep the result modal up; endBattle() runs when
      // the player clicks "Return home".
      battle.ended = true;
      battle.victory = battle.stars > 0;
      set((s) => ({ battleRevision: s.battleRevision + 1 }));
    },
  };
});
