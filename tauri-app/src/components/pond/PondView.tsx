// Pondfall — React shell around the Phaser canvas, laid out like a classic
// mobile base-builder: status plate top-left, resource meters top-right,
// round action buttons bottom-right, big raid button bottom-left.

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpCircle,
  Egg,
  FlaskConical,
  Hammer,
  Maximize2,
  Minimize2,
  Move,
  RefreshCw,
  ScrollText,
  Shield,
  Sparkles,
  Star,
  Swords,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import {
  BUILDINGS,
  MAX_WORKER_LEVEL,
  OBSTACLES,
  PEARL_ICON,
  RESOURCE_ICONS,
  SPELLS,
  SPELL_ORDER,
  TROOPS,
  TROOP_ORDER,
  WORKER_SPRITE,
  buildingSpritePath,
  finishNowCost,
  HERO_CROWN_SPRITE,
  heroLevelCap,
  heroUpgradeCost,
  heroUpgradeTimeMs,
  leagueFor,
  maxBuildingLevel,
  nextEnemyCost,
  researchCost,
  researchTimeMs,
  troopLevelCap,
  troopSpritePath,
  workerSpeedMultiplier,
  workerUpgradeCost,
  WORKSHOP_PEARL_COSTS,
} from "../../lib/pond/config";
import {
  armyHousingCapacity,
  armyHousingUsed,
  buildingCost,
  builderCount,
  busyBuilders,
  busyWorkerIds,
  countByKind,
  hatcheryLevel,
  labLevel,
  pendingProduction,
  spellCapacity,
  spellSpringLevel,
  spellsHeld,
  storageCapacity,
  townHallLevel,
  troopLevel,
} from "../../lib/pond/village";
import { availableLoot } from "../../lib/pond/battle";
import type { BuildingKind, ResourceKind, VillageState } from "../../lib/pond/types";
import { usePondStore } from "../../stores/pondStore";
import { useUiStore } from "../../stores/uiStore";
import { PondCanvas } from "./PondCanvas";

const SHOP_ORDER: BuildingKind[] = [
  "kelpFarm",
  "shardMine",
  "kelpVat",
  "shardVault",
  "hatchery",
  "armyCamp",
  "workshop",
  "lab",
  "spellSpring",
  "sovereignThrone",
  "bubbleGeyser",
  "crystalSpire",
  "elderDen",
  "mudspitter",
  "tideTrap",
  "wall",
];

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

export function formatAmount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  return `${Math.round(value)}`;
}

/** True when something time-driven is pending and the UI should tick. */
export function villageHasPendingWork(village: VillageState): boolean {
  return (
    village.trainQueue.length > 0 ||
    village.buildings.some((b) => b.job !== null) ||
    village.buildings.some((b) => BUILDINGS[b.kind].produces !== undefined)
  );
}

function useNowTicker(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(handle);
  }, [intervalMs]);
  return now;
}

function ResourceMeter({ resource, village }: { resource: ResourceKind; village: VillageState }) {
  const capacity = storageCapacity(village, resource);
  const amount = village.resources[resource];
  const fill = capacity > 0 ? Math.min(1, amount / capacity) : 0;
  return (
    <div className={`pond-meter pond-meter-${resource}${fill >= 1 ? " is-full" : ""}`}>
      <img src={RESOURCE_ICONS[resource]} alt={resource} className="pond-meter-icon" />
      <div className="pond-meter-body">
        <span className="pond-meter-value">{formatAmount(amount)}</span>
        <div className="pond-meter-bar">
          <div className="pond-meter-fill" style={{ width: `${fill * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

function FinishNowButton({
  remainingMs,
  pearls,
  onClick,
}: {
  remainingMs: number;
  pearls: number;
  onClick: () => void;
}) {
  const cost = finishNowCost(remainingMs);
  return (
    <button type="button" className="pond-btn pond-btn-pearl" disabled={pearls < cost} onClick={onClick}>
      <img src={PEARL_ICON} alt="pearls" className="pond-chip-icon" />
      Finish — {cost}
    </button>
  );
}

function LabSection({ now }: { now: number }) {
  const village = usePondStore((s) => s.village);
  const research = usePondStore((s) => s.research);
  const finishResearchNow = usePondStore((s) => s.finishResearchNow);
  const lab = labLevel(village);
  const cap = troopLevelCap(lab);
  const hatchery = hatcheryLevel(village);
  const job = village.researchJob;

  return (
    <div className="pond-lab">
      {job ? (
        <div className="pond-progress-row">
          <FlaskConical className="h-3.5 w-3.5 pond-pulse" />
          <span>
            {TROOPS[job.troop].name} → Lv {job.toLevel} — {formatDuration(job.finishesAt - now)}
          </span>
          <FinishNowButton
            remainingMs={job.finishesAt - now}
            pearls={village.pearls}
            onClick={finishResearchNow}
          />
        </div>
      ) : (
        <div className="pond-shop-grid">
          {TROOP_ORDER.filter((kind) => TROOPS[kind].unlockLevel <= hatchery).map((kind) => {
            const level = troopLevel(village, kind);
            const maxed = level >= cap;
            const cost = maxed ? 0 : researchCost(kind, level + 1);
            return (
              <button
                key={kind}
                type="button"
                className="pond-shop-card"
                disabled={maxed || village.resources.kelp < cost}
                title={
                  maxed
                    ? level >= troopLevelCap(6)
                      ? "Fully researched"
                      : "Upgrade the Glow Lab to research further"
                    : `${formatDuration(researchTimeMs(level + 1))} of research`
                }
                onClick={() => research(kind)}
              >
                <img src={troopSpritePath(kind)} alt="" />
                <span className="pond-shop-name">
                  {TROOPS[kind].name}
                  <span className="pond-count-badge">Lv {level}</span>
                </span>
                <span className="pond-shop-meta">
                  {maxed ? "maxed" : `→ Lv ${level + 1} · ${formatAmount(cost)} kelp`}
                </span>
              </button>
            );
          })}
          {hatchery === 0 && <p className="pond-panel-desc">Build a Hatchery to unlock research.</p>}
        </div>
      )}
    </div>
  );
}

function ObstaclePanel({ id, now }: { id: string; now: number }) {
  const village = usePondStore((s) => s.village);
  const clearObstacleById = usePondStore((s) => s.clearObstacleById);
  const selectBuilding = usePondStore((s) => s.selectBuilding);
  const obstacle = village.obstacles.find((o) => o.id === id);
  if (!obstacle) return null;
  const config = OBSTACLES[obstacle.kind];

  return (
    <section className="pond-glass pond-panel" aria-label={`${config.name} details`}>
      <header className="pond-panel-head">
        <img src={buildingSpritePath(config.sprite)} alt="" className="pond-panel-icon" />
        <div className="min-w-0">
          <div className="pond-panel-title">{config.name}</div>
          <p className="pond-panel-desc">
            Clearing rewards {config.rewardKelp} kelp and {config.rewardPearls} pearl
            {config.rewardPearls === 1 ? "" : "s"}.
          </p>
        </div>
        <button type="button" className="pond-icon-btn" aria-label="Close" onClick={() => selectBuilding(null)}>
          <X className="h-3.5 w-3.5" />
        </button>
      </header>
      {obstacle.clearingUntil !== null ? (
        <div className="pond-progress-row">
          <Hammer className="h-3.5 w-3.5 pond-pulse" />
          <span>Clearing — {formatDuration(obstacle.clearingUntil - now)}</span>
        </div>
      ) : (
        <footer className="pond-panel-actions">
          <button
            type="button"
            className="pond-btn pond-btn-primary"
            disabled={village.resources.kelp < config.clearCost}
            onClick={() => clearObstacleById(obstacle.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear — {formatAmount(config.clearCost)} kelp ({formatDuration(config.clearTimeMs)})
          </button>
        </footer>
      )}
    </section>
  );
}

function HeroSection({ now }: { now: number }) {
  const village = usePondStore((s) => s.village);
  const upgradeHero = usePondStore((s) => s.upgradeHero);
  const finishHeroNow = usePondStore((s) => s.finishHeroNow);
  const hero = village.hero;
  if (!hero) {
    return <p className="pond-panel-desc">Finish the throne to summon the Supreme Axolotl.</p>;
  }
  const cap = heroLevelCap(townHallLevel(village));
  const maxed = hero.level >= cap;
  const cost = maxed ? 0 : heroUpgradeCost(hero.level + 1);
  const regenLeft = Math.max(0, hero.regenUntil - now);

  return (
    <div className="pond-worker-row pond-hero-row">
      <span className="pond-hero-portrait">
        <img src={troopSpritePath("sovereign")} alt="" className="pond-worker-icon" />
        <img src={HERO_CROWN_SPRITE} alt="" className="pond-hero-crown" />
      </span>
      <div className="min-w-0">
        <div className="pond-panel-title">
          Supreme Axolotl
          <span className="pond-level-badge">Lv {hero.level}</span>
        </div>
        <p className="pond-panel-desc">
          {hero.upgradeJob
            ? `Training to Lv ${hero.upgradeJob.toLevel} — ${formatDuration(hero.upgradeJob.finishesAt - now)}`
            : regenLeft > 0
              ? `Recovering — ready in ${formatDuration(regenLeft)}`
              : "Ready to lead the next raid"}
        </p>
      </div>
      {hero.upgradeJob ? (
        <FinishNowButton
          remainingMs={hero.upgradeJob.finishesAt - now}
          pearls={village.pearls}
          onClick={finishHeroNow}
        />
      ) : (
        <button
          type="button"
          className="pond-btn pond-btn-primary"
          disabled={maxed || village.resources.kelp < cost}
          title={
            maxed
              ? "Upgrade the Pondheart to train further"
              : `${formatDuration(heroUpgradeTimeMs(hero.level + 1))} of training`
          }
          onClick={() => upgradeHero()}
        >
          <ArrowUpCircle className="h-3.5 w-3.5" />
          {maxed ? `Capped at Lv ${cap}` : `Train — ${formatAmount(cost)} kelp`}
        </button>
      )}
    </div>
  );
}

function WorkerSection({ workshopId }: { workshopId: string }) {
  const village = usePondStore((s) => s.village);
  const upgradeWorkerAt = usePondStore((s) => s.upgradeWorkerAt);
  const workshop = village.buildings.find((b) => b.id === workshopId);
  const worker = workshop?.worker;
  if (!worker) return null;
  const busy = busyWorkerIds(village).has(workshopId);
  const maxed = worker.level >= MAX_WORKER_LEVEL;
  const cost = maxed ? 0 : workerUpgradeCost(worker.level);
  const speedPct = Math.round((workerSpeedMultiplier(worker.level) - 1) * 100);

  return (
    <div className="pond-worker-row">
      <img src={WORKER_SPRITE} alt="" className="pond-worker-icon" />
      <div className="min-w-0">
        <div className="pond-panel-title">
          {worker.name}
          <span className="pond-level-badge">Lv {worker.level}</span>
        </div>
        <p className="pond-panel-desc">
          {busy ? "Hard at work" : "Lounging at home"}
          {speedPct > 0 ? ` · builds ${speedPct}% faster` : ""}
        </p>
      </div>
      <button
        type="button"
        className="pond-btn pond-btn-primary"
        disabled={maxed || village.resources.shards < cost}
        title={maxed ? "Master builder" : `Train ${worker.name} to build faster`}
        onClick={() => upgradeWorkerAt(workshopId)}
      >
        <ArrowUpCircle className="h-3.5 w-3.5" />
        {maxed ? "Maxed" : `Train — ${formatAmount(cost)} shards`}
      </button>
    </div>
  );
}

/** One-line "what you get" preview for the next building level. */
export function nextLevelPerk(kind: BuildingKind, currentLevel: number): string | null {
  const config = BUILDINGS[kind];
  const current = config.levels[Math.max(0, currentLevel - 1)];
  const next = config.levels[currentLevel];
  if (!next || currentLevel < 1) return null;
  const parts: string[] = [];
  if (next.ratePerHour && current.ratePerHour) {
    parts.push(`${formatAmount(current.ratePerHour)} → ${formatAmount(next.ratePerHour)}/h`);
  }
  if (next.capacity && current.capacity) {
    parts.push(`capacity ${formatAmount(current.capacity)} → ${formatAmount(next.capacity)}`);
  }
  if (next.dps && current.dps) parts.push(`damage ${current.dps} → ${next.dps}/s`);
  if (next.housing && current.housing) {
    const label = kind === "hatchery" ? "queue" : kind === "spellSpring" ? "spell slots" : "housing";
    if (next.housing !== current.housing) parts.push(`${label} ${current.housing} → ${next.housing}`);
  }
  if (next.hp && current.hp && parts.length < 2) parts.push(`HP ${current.hp} → ${next.hp}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function BuildingPanel({ id, now }: { id: string; now: number }) {
  const village = usePondStore((s) => s.village);
  const upgrade = usePondStore((s) => s.upgrade);
  const collect = usePondStore((s) => s.collect);
  const setTool = usePondStore((s) => s.setTool);
  const selectBuilding = usePondStore((s) => s.selectBuilding);
  const finishBuildingNow = usePondStore((s) => s.finishBuildingNow);

  const building = village.buildings.find((b) => b.id === id);
  if (!building) return <ObstaclePanel id={id} now={now} />;
  const config = BUILDINGS[building.kind];
  const thLevel = townHallLevel(village);
  const levelCap =
    building.kind === "wall"
      ? Math.min(config.levels.length, Math.ceil(thLevel / 2))
      : maxBuildingLevel(building.kind, thLevel);
  const nextLevel = building.level + 1;
  const canUpgrade = !building.job && nextLevel <= levelCap;
  const upgradeCost = canUpgrade ? buildingCost(village, building.kind, nextLevel) : 0;
  const pending = pendingProduction(building, now);

  return (
    <section className="pond-glass pond-panel" aria-label={`${config.name} details`}>
      <header className="pond-panel-head">
        <img src={buildingSpritePath(config.sprite)} alt="" className="pond-panel-icon" />
        <div className="min-w-0">
          <div className="pond-panel-title">
            {config.name}
            <span className="pond-level-badge">Lv {Math.max(1, building.level)}</span>
          </div>
          <p className="pond-panel-desc">{config.description}</p>
        </div>
        <button type="button" className="pond-icon-btn" aria-label="Close" onClick={() => selectBuilding(null)}>
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      {building.job && (
        <div className="pond-progress-row">
          <Hammer className="h-3.5 w-3.5 pond-pulse" />
          <span>
            {building.job.toLevel === 1 ? "Building" : `Upgrading to Lv ${building.job.toLevel}`} —{" "}
            {formatDuration(building.job.finishesAt - now)}
          </span>
          <FinishNowButton
            remainingMs={building.job.finishesAt - now}
            pearls={village.pearls}
            onClick={() => finishBuildingNow(building.id)}
          />
        </div>
      )}

      {building.kind === "lab" && building.level > 0 && <LabSection now={now} />}

      {building.kind === "workshop" && building.worker && <WorkerSection workshopId={building.id} />}

      {building.kind === "sovereignThrone" && building.level > 0 && <HeroSection now={now} />}

      {canUpgrade && nextLevelPerk(building.kind, building.level) && (
        <div className="pond-stat-row">
          <span className="pond-stat-label">Next level</span>
          <span className="pond-stat-value">{nextLevelPerk(building.kind, building.level)}</span>
        </div>
      )}

      {config.produces && building.level > 0 && (
        <div className="pond-stat-row">
          <span className="pond-stat-label">Ready to collect</span>
          <span className="pond-stat-value">{formatAmount(pending)}</span>
          <button
            type="button"
            className="pond-btn"
            disabled={pending <= 0}
            onClick={() => collect(building.id)}
          >
            Collect
          </button>
        </div>
      )}

      <footer className="pond-panel-actions">
        <button
          type="button"
          className="pond-btn"
          onClick={() => setTool({ type: "move", buildingId: building.id })}
        >
          <Move className="h-3.5 w-3.5" />
          Move
        </button>
        {nextLevel <= config.levels.length && (
          <button
            type="button"
            className="pond-btn pond-btn-primary"
            disabled={!canUpgrade}
            title={canUpgrade ? undefined : building.job ? "Under construction" : "Upgrade the Pondheart first"}
            onClick={() => upgrade(building.id)}
          >
            <ArrowUpCircle className="h-3.5 w-3.5" />
            Upgrade — {formatAmount(upgradeCost)} {config.costResource === "kelp" ? "kelp" : "shards"}
          </button>
        )}
      </footer>
    </section>
  );
}

function ShopPanel() {
  const village = usePondStore((s) => s.village);
  const setTool = usePondStore((s) => s.setTool);
  const setShopOpen = usePondStore((s) => s.setShopOpen);
  const thLevel = townHallLevel(village);
  const builders = builderCount(village);
  const busy = busyBuilders(village);

  return (
    <section className="pond-glass pond-panel pond-shop" aria-label="Build shop">
      <header className="pond-panel-head">
        <div className="pond-panel-title">Build</div>
        <span className="pond-chip">
          <Hammer className="h-3 w-3" /> {builders - busy}/{builders} crews free
        </span>
        <button type="button" className="pond-icon-btn" aria-label="Close shop" onClick={() => setShopOpen(false)}>
          <X className="h-3.5 w-3.5" />
        </button>
      </header>
      <div className="pond-shop-grid">
        {SHOP_ORDER.map((kind) => {
          const config = BUILDINGS[kind];
          const owned = countByKind(village, kind);
          const allowed = config.maxCount[thLevel - 1] ?? 0;
          // Workshops are bought with pearls, CoC-builder style.
          const pearlPriced = kind === "workshop";
          const cost = pearlPriced
            ? WORKSHOP_PEARL_COSTS[Math.min(owned, WORKSHOP_PEARL_COSTS.length - 1)]
            : config.levels[0].cost;
          const affordable = pearlPriced
            ? village.pearls >= cost
            : village.resources[config.costResource] >= cost;
          const slotFree = owned < allowed;
          const locked = allowed === 0;
          return (
            <button
              key={kind}
              type="button"
              className="pond-shop-card"
              disabled={locked || !slotFree || !affordable}
              title={
                locked
                  ? `Unlocks at a higher Pondheart level`
                  : !slotFree
                    ? `All slots used (${owned}/${allowed})`
                    : !affordable
                      ? "Not enough resources"
                      : config.description
              }
              onClick={() => {
                setTool({ type: "place", kind });
                setShopOpen(false);
              }}
            >
              <img src={buildingSpritePath(config.sprite)} alt="" />
              <span className="pond-shop-name">{config.name}</span>
              <span className="pond-shop-meta">
                {owned}/{allowed || "—"} · {formatAmount(cost)}{" "}
                {pearlPriced ? "pearls" : config.costResource === "kelp" ? "kelp" : "shards"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SpellSection({ now }: { now: number }) {
  const village = usePondStore((s) => s.village);
  const brew = usePondStore((s) => s.brew);
  const spring = spellSpringLevel(village);
  if (spring === 0) return null;
  const held = spellsHeld(village);
  const capacity = spellCapacity(village);

  return (
    <>
      <div className="pond-section-title">
        <Sparkles className="h-3.5 w-3.5" />
        Spells
        <span className="pond-chip">
          {held}/{capacity}
        </span>
      </div>
      <div className="pond-shop-grid">
        {SPELL_ORDER.map((kind) => {
          const config = SPELLS[kind];
          const locked = config.unlockLevel > spring;
          const count = village.spells[kind] ?? 0;
          return (
            <button
              key={kind}
              type="button"
              className="pond-shop-card"
              disabled={locked}
              title={locked ? `Unlocks at Spell Spring level ${config.unlockLevel}` : config.description}
              onClick={() => brew(kind)}
            >
              <img src={config.icon} alt="" />
              <span className="pond-shop-name">
                {config.name}
                {count > 0 && <span className="pond-count-badge">×{count}</span>}
              </span>
              <span className="pond-shop-meta">
                {formatAmount(config.cost)} kelp · {formatDuration(config.brewTimeMs)}
              </span>
            </button>
          );
        })}
      </div>
      {village.brewQueue.length > 0 && (
        <div className="pond-queue" aria-label="Brewing queue">
          {village.brewQueue.map((job, index) => (
            <span key={`${job.spell}-${index}`} className="pond-chip pond-queue-chip">
              <img src={SPELLS[job.spell].icon} alt="" className="pond-chip-icon" />
              {SPELLS[job.spell].name}
              <span className="pond-chip-cap">{formatDuration(job.finishesAt - now)}</span>
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function ArmyPanel({ now }: { now: number }) {
  const village = usePondStore((s) => s.village);
  const train = usePondStore((s) => s.train);
  const cancelTrain = usePondStore((s) => s.cancelTrain);
  const setArmyOpen = usePondStore((s) => s.setArmyOpen);
  const hatchery = hatcheryLevel(village);
  const used = armyHousingUsed(village);
  const capacity = armyHousingCapacity(village);

  return (
    <section className="pond-glass pond-panel pond-army" aria-label="Army">
      <header className="pond-panel-head">
        <div className="pond-panel-title">Hatchery</div>
        <span className="pond-chip">
          <Egg className="h-3 w-3" /> {used}/{capacity} housing
        </span>
        <button type="button" className="pond-icon-btn" aria-label="Close army" onClick={() => setArmyOpen(false)}>
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      {hatchery === 0 ? (
        <p className="pond-panel-desc">Build a Hatchery to start raising raiders.</p>
      ) : (
        <>
          <div className="pond-shop-grid">
            {TROOP_ORDER.map((kind) => {
              const config = TROOPS[kind];
              const lockedBy = config.unlockLevel > hatchery;
              const count = village.army[kind] ?? 0;
              return (
                <button
                  key={kind}
                  type="button"
                  className="pond-shop-card"
                  disabled={lockedBy}
                  title={lockedBy ? `Unlocks at Hatchery level ${config.unlockLevel}` : config.description}
                  onClick={() => train(kind)}
                >
                  <img src={troopSpritePath(kind)} alt="" />
                  <span className="pond-shop-name">
                    {config.name}
                    {count > 0 && <span className="pond-count-badge">×{count}</span>}
                  </span>
                  <span className="pond-shop-meta">
                    Lv {troopLevel(village, kind)} · {config.housing} housing ·{" "}
                    {formatAmount(config.cost)} kelp
                  </span>
                </button>
              );
            })}
          </div>
          {village.trainQueue.length > 0 && (
            <div className="pond-queue" aria-label="Hatching queue">
              {village.trainQueue.map((job, index) => (
                <button
                  key={`${job.troop}-${index}`}
                  type="button"
                  className="pond-chip pond-queue-chip"
                  title="Cancel"
                  onClick={() => cancelTrain(index)}
                >
                  <img src={troopSpritePath(job.troop)} alt="" className="pond-chip-icon" />
                  {TROOPS[job.troop].name}
                  <span className="pond-chip-cap">{formatDuration(job.finishesAt - now)}</span>
                  <X className="h-3 w-3" />
                </button>
              ))}
            </div>
          )}
          <SpellSection now={now} />
        </>
      )}
    </section>
  );
}

function JournalPanel({ onClose }: { onClose: () => void }) {
  const village = usePondStore((s) => s.village);
  const resetGame = usePondStore((s) => s.resetGame);
  return (
    <section className="pond-glass pond-panel" aria-label="Journal">
      <header className="pond-panel-head">
        <div className="pond-panel-title">Pond Journal</div>
        <button type="button" className="pond-icon-btn" aria-label="Close journal" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </button>
      </header>
      <div className="pond-stat-row">
        <span className="pond-stat-label">Raids won / lost</span>
        <span className="pond-stat-value">
          {village.battlesWon} / {village.battlesLost}
        </span>
      </div>
      {village.raidLog.length === 0 ? (
        <p className="pond-panel-desc">No enemy raids yet. Your pond is peaceful… for now.</p>
      ) : (
        <ul className="pond-journal-list">
          {village.raidLog.map((report) => (
            <li key={report.id} className={report.defended ? "is-defended" : "is-lost"}>
              <Shield className="h-3.5 w-3.5" />
              <span>
                {report.attackerName} {report.defended ? "was repelled" : "raided you"}
                {!report.defended &&
                  ` — lost ${formatAmount(report.lostKelp)} kelp, ${formatAmount(report.lostShards)} shards`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <footer className="pond-panel-actions">
        <button
          type="button"
          className="pond-btn pond-btn-danger"
          onClick={() => {
            if (window.confirm("Flood the pond and start over? This wipes your village.")) resetGame();
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Start over
        </button>
      </footer>
    </section>
  );
}

function BattleHud() {
  const battle = usePondStore((s) => s.battle);
  usePondStore((s) => s.battleRevision);
  const village = usePondStore((s) => s.village);
  const tool = usePondStore((s) => s.tool);
  const setTool = usePondStore((s) => s.setTool);
  const endBattle = usePondStore((s) => s.endBattle);
  const surrenderBattle = usePondStore((s) => s.surrenderBattle);
  const nextEnemy = usePondStore((s) => s.nextEnemy);
  if (!battle) return null;

  const reserveEntries = TROOP_ORDER.filter((kind) => (battle.reserve[kind] ?? 0) > 0);
  const heroInReserve = (battle.reserve.sovereign ?? 0) > 0;
  const spellEntries = SPELL_ORDER.filter((kind) => (battle.spellReserve[kind] ?? 0) > 0);
  const deployed = battle.troops.length > 0;
  const scoutable = !deployed && !battle.ended;
  const remaining = availableLoot(battle);
  const rerollCost = nextEnemyCost(battle.enemyTownHallLevel);

  return (
    <>
      <div className="pond-glass pond-battle-bar" role="status">
        <span className="pond-battle-enemy">
          <Swords className="h-3.5 w-3.5" />
          {battle.enemyName}
        </span>
        <span className="pond-chip">{formatDuration(battle.timeLeftMs)}</span>
        <span className="pond-chip">{battle.destructionPct}%</span>
        <span className="pond-chip pond-stars">
          {[1, 2, 3].map((star) => (
            <Star key={star} className={`h-3.5 w-3.5${battle.stars >= star ? " is-earned" : ""}`} />
          ))}
        </span>
        <span className="pond-chip" title="Loot won / still in the base">
          <img src={RESOURCE_ICONS.kelp} alt="kelp" className="pond-chip-icon" />
          {formatAmount(battle.lootWon.kelp)}
          <span className="pond-chip-cap">/ {formatAmount(remaining.kelp)}</span>
        </span>
        <span className="pond-chip" title="Loot won / still in the base">
          <img src={RESOURCE_ICONS.shards} alt="shards" className="pond-chip-icon" />
          {formatAmount(battle.lootWon.shards)}
          <span className="pond-chip-cap">/ {formatAmount(remaining.shards)}</span>
        </span>
        {scoutable && (
          <button
            type="button"
            className="pond-btn"
            disabled={village.resources.shards < rerollCost}
            title={`Skip this pond for ${rerollCost} glowshards`}
            onClick={nextEnemy}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Next — {rerollCost}
          </button>
        )}
      </div>

      {!battle.ended && (
        <div className="pond-glass pond-deploy-tray" aria-label="Deploy troops">
          {reserveEntries.length === 0 && spellEntries.length === 0 && !heroInReserve && (
            <span className="pond-panel-desc">No axolotls left to deploy.</span>
          )}
          {heroInReserve && (
            <button
              type="button"
              className={`pond-shop-card pond-deploy-card pond-hero-card${
                tool.type === "deploy" && tool.troop === "sovereign" ? " is-active" : ""
              }`}
              title={TROOPS.sovereign.description}
              onClick={() => setTool({ type: "deploy", troop: "sovereign" })}
            >
              <span className="pond-hero-portrait">
                <img src={troopSpritePath("sovereign")} alt="" />
                <img src={HERO_CROWN_SPRITE} alt="" className="pond-hero-crown" />
              </span>
              <span className="pond-shop-name">Sovereign</span>
              <span className="pond-count-badge">Lv {battle.troopLevels.sovereign ?? 1}</span>
            </button>
          )}
          {reserveEntries.map((kind) => (
            <button
              key={kind}
              type="button"
              className={`pond-shop-card pond-deploy-card${
                tool.type === "deploy" && tool.troop === kind ? " is-active" : ""
              }`}
              onClick={() => setTool({ type: "deploy", troop: kind })}
            >
              <img src={troopSpritePath(kind)} alt="" />
              <span className="pond-shop-name">{TROOPS[kind].name}</span>
              <span className="pond-count-badge">×{battle.reserve[kind]}</span>
            </button>
          ))}
          {spellEntries.map((kind) => (
            <button
              key={kind}
              type="button"
              className={`pond-shop-card pond-deploy-card pond-spell-card${
                tool.type === "spell" && tool.spell === kind ? " is-active" : ""
              }`}
              title={SPELLS[kind].description}
              onClick={() => setTool({ type: "spell", spell: kind })}
            >
              <img src={SPELLS[kind].icon} alt="" />
              <span className="pond-shop-name">{SPELLS[kind].name}</span>
              <span className="pond-count-badge">×{battle.spellReserve[kind]}</span>
            </button>
          ))}
          <button type="button" className="pond-btn" onClick={surrenderBattle}>
            {deployed ? "Retreat" : "Scout away"}
          </button>
        </div>
      )}

      {battle.ended && (
        <div className="pond-battle-result" role="dialog" aria-label="Battle result">
          <div className="pond-glass pond-panel pond-result-card">
            <div className="pond-result-stars">
              {[1, 2, 3].map((star) => (
                <Star key={star} className={`h-8 w-8${battle.stars >= star ? " is-earned" : ""}`} />
              ))}
            </div>
            <div className={`pond-result-title${battle.victory ? " is-victory" : ""}`}>
              {battle.victory ? "Raid successful!" : "Raid failed"}
            </div>
            <div className="pond-stat-row">
              <span className="pond-stat-label">Destruction</span>
              <span className="pond-stat-value">{battle.destructionPct}%</span>
            </div>
            <div className="pond-stat-row">
              <span className="pond-stat-label">Loot</span>
              <span className="pond-stat-value">
                {formatAmount(battle.lootWon.kelp)} kelp · {formatAmount(battle.lootWon.shards)} shards
              </span>
            </div>
            <div className="pond-stat-row">
              <span className="pond-stat-label">Trophies</span>
              <span className="pond-stat-value">
                {battle.victory ? `+${battle.trophyReward}` : deployed ? `−${battle.trophyRisk}` : "±0"}
              </span>
            </div>
            <footer className="pond-panel-actions">
              <button type="button" className="pond-btn pond-btn-primary pond-btn-big" onClick={endBattle}>
                Return home
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

export function PondView() {
  const village = usePondStore((s) => s.village);
  const mode = usePondStore((s) => s.mode);
  const tool = usePondStore((s) => s.tool);
  const notice = usePondStore((s) => s.notice);
  const shopOpen = usePondStore((s) => s.shopOpen);
  const armyOpen = usePondStore((s) => s.armyOpen);
  const selectedBuildingId = usePondStore((s) => s.selectedBuildingId);
  const hydrate = usePondStore((s) => s.hydrate);
  const settle = usePondStore((s) => s.settle);
  const setShopOpen = usePondStore((s) => s.setShopOpen);
  const setArmyOpen = usePondStore((s) => s.setArmyOpen);
  const setNotice = usePondStore((s) => s.setNotice);
  const setTool = usePondStore((s) => s.setTool);
  const startBattle = usePondStore((s) => s.startBattle);
  const fullscreen = useUiStore((s) => s.gameFullscreen);
  const setGameFullscreen = useUiStore((s) => s.setGameFullscreen);

  const [journalOpen, setJournalOpen] = useState(false);
  const now = useNowTicker(1000);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Leaving the game view always restores the app chrome.
  useEffect(() => () => setGameFullscreen(false), [setGameFullscreen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Esc first disarms an active tool, then leaves fullscreen.
      if (usePondStore.getState().tool.type !== "idle") {
        setTool({ type: "idle" });
        return;
      }
      if (fullscreen) setGameFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen, setGameFullscreen, setTool]);

  // Finish construction/training/research/clearing the moment timers lapse.
  useEffect(() => {
    if (mode !== "home") return;
    const due =
      village.buildings.some((b) => b.job && b.job.finishesAt <= now) ||
      (village.trainQueue.length > 0 && village.trainQueue[0].finishesAt <= now) ||
      (village.brewQueue.length > 0 && village.brewQueue[0].finishesAt <= now) ||
      (village.researchJob !== null && village.researchJob.finishesAt <= now) ||
      (village.hero?.upgradeJob != null && village.hero.upgradeJob.finishesAt <= now) ||
      village.obstacles.some((o) => o.clearingUntil !== null && o.clearingUntil <= now);
    if (due) settle();
  }, [mode, now, settle, village]);

  useEffect(() => {
    if (!notice) return;
    const handle = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(handle);
  }, [notice, setNotice]);

  const shieldLeftMs = Math.max(0, village.shieldUntil - now);
  const league = useMemo(() => leagueFor(village.trophies), [village.trophies]);

  return (
    <div className="pond-view" data-mode={mode} data-fullscreen={fullscreen || undefined}>
      <PondCanvas />

      <button
        type="button"
        className="pond-fs-btn"
        title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
        aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        onClick={() => setGameFullscreen(!fullscreen)}
      >
        {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>

      {mode === "home" && (
        <>
          <header className="pond-glass pond-status">
            <div className="pond-status-name">{village.name}</div>
            <div className="pond-status-row">
              <span className="pond-chip pond-chip-trophy" title={league}>
                <Trophy className="h-3 w-3" />
                {village.trophies}
              </span>
              <span className="pond-chip">{league}</span>
              <span className="pond-chip" title="Free tadpole crews / total">
                <Hammer className="h-3 w-3" />
                {builderCount(village) - busyBuilders(village)}/{builderCount(village)}
              </span>
              {shieldLeftMs > 0 && (
                <span className="pond-chip pond-chip-shield" title="Shield — no enemy raids">
                  <Shield className="h-3 w-3" />
                  {formatDuration(shieldLeftMs)}
                </span>
              )}
            </div>
          </header>

          <aside className="pond-resources" aria-label="Resources">
            <ResourceMeter resource="kelp" village={village} />
            <ResourceMeter resource="shards" village={village} />
            <div className="pond-meter pond-meter-pearls" title="Pearls — finish timers instantly">
              <img src={PEARL_ICON} alt="pearls" className="pond-meter-icon" />
              <div className="pond-meter-body">
                <span className="pond-meter-value">{village.pearls}</span>
              </div>
            </div>
          </aside>

          <nav className="pond-fabs" aria-label="Pond actions">
            <button
              type="button"
              className={`pond-fab${shopOpen ? " is-active" : ""}`}
              onClick={() => setShopOpen(!shopOpen)}
            >
              <Hammer className="h-5 w-5" />
              <span>Build</span>
            </button>
            <button
              type="button"
              className={`pond-fab${armyOpen ? " is-active" : ""}`}
              onClick={() => setArmyOpen(!armyOpen)}
            >
              <Egg className="h-5 w-5" />
              <span>Army</span>
            </button>
            <button
              type="button"
              className={`pond-fab${journalOpen ? " is-active" : ""}`}
              onClick={() => setJournalOpen(!journalOpen)}
            >
              <ScrollText className="h-5 w-5" />
              <span>Journal</span>
            </button>
          </nav>

          <button type="button" className="pond-raid-btn" onClick={startBattle}>
            <Swords className="h-5 w-5" />
            Raid!
          </button>

          {tool.type !== "idle" && (
            <div className="pond-glass pond-tool-hint">
              {tool.type === "place" && `Placing ${BUILDINGS[tool.kind].name} — click a free spot`}
              {tool.type === "move" && "Click a new spot for the building"}
              {(tool.type === "deploy" || tool.type === "spell") && "Deploying"}
              <button type="button" className="pond-icon-btn" aria-label="Cancel" onClick={() => setTool({ type: "idle" })}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div className="pond-dock">
            {selectedBuildingId && <BuildingPanel id={selectedBuildingId} now={now} />}
            {shopOpen && <ShopPanel />}
            {armyOpen && <ArmyPanel now={now} />}
            {journalOpen && <JournalPanel onClose={() => setJournalOpen(false)} />}
          </div>
        </>
      )}

      {mode === "battle" && <BattleHud />}

      {notice && (
        <div className="pond-notice" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
