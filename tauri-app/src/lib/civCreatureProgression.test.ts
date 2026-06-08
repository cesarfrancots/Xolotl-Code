import { describe, expect, it } from "vitest";
import type { CivEntity } from "../bindings";
import {
  axolotlLevel,
  axolotlMorphAsset,
  axolotlRarity,
  genePotential,
  hatchProgressPercent,
  hatchTurnsRemaining,
  isEggEntity,
  rarityLabel,
} from "./civCreatureProgression";

const baseEntity = (patch: Partial<CivEntity> = {}): CivEntity => ({
  id: "axo-1",
  kind: "axolotl",
  name: "Axo",
  x: 1,
  y: 2,
  health: 100,
  mood: 100,
  role: "worker",
  morph: "leucistic",
  pattern: "plain",
  stage: "adult",
  age: 8,
  genes: {
    allele_a: "leucistic",
    allele_b: "wild",
    size_gene: 1,
    fertility: 0.7,
    longevity: 1,
    vigor: 1,
    pattern_a: "plain",
    pattern_b: "plain",
    strength: 1,
    cold_resistance: 0.5,
    disease_resistance: 0.5,
  },
  ...patch,
});

describe("civ creature progression", () => {
  it("classifies morph rarity on the restored 12-morph asset line", () => {
    expect(axolotlRarity(baseEntity({ morph: "leucistic" }))).toBe("common");
    expect(axolotlRarity(baseEntity({ morph: "melanoid" }))).toBe("uncommon");
    expect(axolotlRarity(baseEntity({ morph: "gfp" }))).toBe("rare");
    expect(axolotlRarity(baseEntity({ morph: "mystic" }))).toBe("mythic");
  });

  it("bumps marbled eggs one rarity tier and exposes hatch progress", () => {
    const egg = baseEntity({
      id: "egg-1",
      kind: "egg",
      role: "egg",
      stage: "egg",
      morph: "gold",
      pattern: "marbled",
      age: 0,
      hatches_in: 2,
    });

    expect(isEggEntity(egg)).toBe(true);
    expect(axolotlRarity(egg)).toBe("uncommon");
    expect(hatchTurnsRemaining(egg)).toBe(2);
    expect(hatchProgressPercent(egg)).toBe(33);
  });

  it("keeps level and gene potential bounded for strong rare adults", () => {
    const adult = baseEntity({
      morph: "firefly",
      age: 22,
      genes: {
        allele_a: "firefly",
        allele_b: "gfp",
        size_gene: 1.4,
        fertility: 1,
        longevity: 1.35,
        vigor: 1.25,
        pattern_a: "striped",
        pattern_b: "marbled",
        strength: 1.6,
        cold_resistance: 1,
        disease_resistance: 1,
      },
    });

    expect(genePotential(adult)).toBe(100);
    expect(axolotlLevel(adult)).toBeGreaterThan(20);
    expect(axolotlLevel(adult)).toBeLessThanOrEqual(99);
  });

  it("falls back to an existing portrait asset for unknown morphs", () => {
    expect(axolotlMorphAsset("unknown")).toBe("leucistic");
    expect(rarityLabel("rare")).toBe("Rare");
  });
});
