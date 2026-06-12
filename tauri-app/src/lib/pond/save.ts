// Pondfall — persistence. The village is small JSON, so localStorage is the
// single source of truth in both the Tauri app and browser preview.

import { STARTING_PEARLS } from "./config";
import type { VillageState } from "./types";
import { createVillage, ensureWorkers } from "./village";

export const SAVE_KEY = "xolotl-pond-village-v1";

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function looksLikeVillage(value: unknown): value is VillageState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.version === "number" &&
    typeof v.name === "string" &&
    Array.isArray(v.buildings) &&
    typeof v.resources === "object" &&
    v.resources !== null
  );
}

/** Fills in fields added after v1 so old saves keep working. */
export function migrateVillage(village: VillageState, now: number): VillageState {
  return ensureWorkers({
    ...village,
    version: 2,
    pearls: village.pearls ?? STARTING_PEARLS,
    obstacles: village.obstacles ?? [],
    lastObstacleAt: village.lastObstacleAt ?? now,
    research: village.research ?? {},
    researchJob: village.researchJob ?? null,
    spells: village.spells ?? {},
    brewQueue: village.brewQueue ?? [],
    hero: village.hero ?? null,
  });
}

export function loadVillage(now: number): VillageState {
  const store = storage();
  if (store) {
    try {
      const raw = store.getItem(SAVE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (looksLikeVillage(parsed)) return migrateVillage(parsed, now);
      }
    } catch {
      // fall through to a fresh village
    }
  }
  return createVillage("Axolotl Bay", now);
}

export function saveVillage(village: VillageState): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(SAVE_KEY, JSON.stringify(village));
  } catch {
    // quota/full — losing one save beats crashing the game loop
  }
}

export function resetVillage(now: number): VillageState {
  const fresh = createVillage("Axolotl Bay", now);
  saveVillage(fresh);
  return fresh;
}
