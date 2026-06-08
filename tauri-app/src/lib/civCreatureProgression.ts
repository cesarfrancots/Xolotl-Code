import type { CivEntity } from "../bindings";

export type AxolotlRarity = "common" | "uncommon" | "rare" | "mythic";

const RARITY_ORDER: AxolotlRarity[] = ["common", "uncommon", "rare", "mythic"];
const COMMON_MORPHS = new Set(["leucistic", "wild", "gold", "axanthic", "copper", "albino"]);
const UNCOMMON_MORPHS = new Set(["blue", "melanoid", "piebald"]);
const RARE_MORPHS = new Set(["gfp", "firefly"]);
const MYTHIC_MORPHS = new Set(["mystic"]);
const MORPH_ASSETS = new Set([
  "albino", "axanthic", "blue", "copper", "firefly", "gfp",
  "gold", "leucistic", "melanoid", "mystic", "piebald", "wild",
]);

export function isEggEntity(entity: CivEntity) {
  return entity.kind === "egg" || entity.stage === "egg";
}

export function axolotlMorphAsset(morph?: string | null) {
  const safe = typeof morph === "string" ? morph : "";
  return MORPH_ASSETS.has(safe) ? safe : "leucistic";
}

export function axolotlRarity(entity: CivEntity): AxolotlRarity {
  const morph = axolotlMorphAsset(entity.morph);
  let rarity: AxolotlRarity = COMMON_MORPHS.has(morph)
    ? "common"
    : UNCOMMON_MORPHS.has(morph)
      ? "uncommon"
      : RARE_MORPHS.has(morph)
        ? "rare"
        : MYTHIC_MORPHS.has(morph)
          ? "mythic"
          : "common";
  if ((entity.pattern ?? "") === "marbled") rarity = bumpRarity(rarity);
  return rarity;
}

export function axolotlLevel(entity: CivEntity) {
  const stage = entity.stage ?? (isEggEntity(entity) ? "egg" : "adult");
  const base = stage === "egg"
    ? 1
    : stage === "hatchling"
      ? 2
      : stage === "juvenile"
        ? 5
        : stage === "elder"
          ? 18
          : 9;
  const ageBonus = stage === "egg" ? 0 : Math.floor((entity.age ?? 0) / 2);
  const rarityBonus = RARITY_ORDER.indexOf(axolotlRarity(entity)) * 2;
  const traitBonus = Math.max(0, Math.floor((genePotential(entity) - 64) / 12));
  return clampInt(base + ageBonus + rarityBonus + traitBonus, 1, 99);
}

export function genePotential(entity: CivEntity) {
  const genes = entity.genes;
  if (!genes) return 60;
  const values = [
    normalizeGene(genes.size_gene, 0.7, 1.4),
    normalizeGene(genes.fertility, 0.3, 1.0),
    normalizeGene(genes.vigor, 0.8, 1.25),
    normalizeGene(genes.strength, 0.5, 1.6),
    normalizeGene(genes.cold_resistance, 0, 1),
    normalizeGene(genes.disease_resistance, 0, 1),
  ];
  return clampInt(Math.round(values.reduce((sum, item) => sum + item, 0) / values.length), 1, 100);
}

export function hatchTurnsRemaining(entity: CivEntity) {
  return typeof entity.hatches_in === "number" && Number.isFinite(entity.hatches_in)
    ? Math.max(0, Math.floor(entity.hatches_in))
    : null;
}

export function hatchProgressPercent(entity: CivEntity, totalTurns = 3) {
  const remaining = hatchTurnsRemaining(entity);
  if (remaining === null) return 0;
  const total = Math.max(1, totalTurns);
  return clampInt(Math.round(((total - Math.min(total, remaining)) / total) * 100), 0, 100);
}

export function rarityLabel(rarity: AxolotlRarity) {
  return rarity[0].toUpperCase() + rarity.slice(1);
}

function bumpRarity(rarity: AxolotlRarity): AxolotlRarity {
  return RARITY_ORDER[Math.min(RARITY_ORDER.length - 1, RARITY_ORDER.indexOf(rarity) + 1)];
}

function normalizeGene(value: number | null | undefined, lo: number, hi: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 60;
  return ((Math.max(lo, Math.min(hi, value)) - lo) / (hi - lo)) * 100;
}

function clampInt(value: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.round(value)));
}
