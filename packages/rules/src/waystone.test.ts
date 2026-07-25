import { describe, it, expect } from "vitest";
import { waystoneRarity, waystoneMods, waystoneScale, waystoneScaleFor } from "./waystone.js";
import { offerWaystones, WAYSTONE_OFFER_COUNT } from "./atlas.js";

describe("waystoneRarity", () => {
  it("is a pure function of the stone's own seed", () => {
    expect(waystoneRarity(12345)).toBe(waystoneRarity(12345));
  });

  it("produces all three rarities across a spread of seeds", () => {
    const seen = new Set<string>();
    for (let s = 0; s < 400; s++) seen.add(waystoneRarity(s * 7919));
    expect([...seen].sort()).toEqual(["magic", "normal", "rare"]);
  });
});

describe("waystoneMods", () => {
  function seedOfRarity(rarity: string): number {
    for (let s = 1; s < 100_000; s++) if (waystoneRarity(s) === rarity) return s;
    throw new Error(`no seed rolls ${rarity}`);
  }

  it("a normal stone rolls nothing", () => {
    expect(waystoneMods(seedOfRarity("normal"))).toEqual([]);
  });

  it("a magic stone rolls one of each, a rare two of each", () => {
    const magic = waystoneMods(seedOfRarity("magic"));
    expect(magic.filter((m) => m.kind === "prefix")).toHaveLength(1);
    expect(magic.filter((m) => m.kind === "suffix")).toHaveLength(1);

    const rare = waystoneMods(seedOfRarity("rare"));
    expect(rare.filter((m) => m.kind === "prefix")).toHaveLength(2);
    expect(rare.filter((m) => m.kind === "suffix")).toHaveLength(2);
  });

  it("never rolls the same modifier twice on one stone", () => {
    for (let s = 1; s < 500; s++) {
      const ids = waystoneMods(s * 31).map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("prints the rolled value into the line", () => {
    for (let s = 1; s < 200; s++) {
      for (const m of waystoneMods(s * 97)) {
        expect(m.label).toContain(String(m.value));
        expect(Number.isInteger(m.value)).toBe(true);
      }
    }
  });

  it("is stable for a seed", () => {
    expect(waystoneMods(777)).toEqual(waystoneMods(777));
  });
});

describe("waystoneScale", () => {
  it("a stone with no modifiers changes nothing", () => {
    expect(waystoneScale([])).toEqual({
      lifeMilli: 1000, dmgMilli: 1000,
      monsterResAdd: 0, playerResPenalty: 0, packSizePct: 0, experiencePct: 0,
    });
  });

  it("folds each modifier onto its own knob", () => {
    const s = waystoneScale([
      { id: "monsterLife", kind: "suffix", value: 40, label: "" },
      { id: "monsterDamage", kind: "suffix", value: 25, label: "" },
      { id: "monsterElementalRes", kind: "suffix", value: 30, label: "" },
      { id: "playerResPenalty", kind: "suffix", value: 20, label: "" },
      { id: "packSize", kind: "prefix", value: 30, label: "" },
      { id: "experience", kind: "prefix", value: 15, label: "" },
    ]);
    expect(s).toEqual({
      lifeMilli: 1400, dmgMilli: 1250,
      monsterResAdd: 30, playerResPenalty: 20, packSizePct: 30, experiencePct: 15,
    });
  });
});

describe("the offers a character is given", () => {
  it("every offered stone has a rarity and a coherent scale", () => {
    for (const ws of offerWaystones(4242, WAYSTONE_OFFER_COUNT)) {
      expect(["normal", "magic", "rare"]).toContain(waystoneRarity(ws.seed));
      const scale = waystoneScaleFor(ws.seed);
      expect(scale.lifeMilli).toBeGreaterThanOrEqual(1000);
      expect(scale.packSizePct).toBeGreaterThanOrEqual(0);
    }
  });
});
