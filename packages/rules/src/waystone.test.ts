import { describe, it, expect } from "vitest";
import { waystoneRarity, waystoneMods, waystoneScale, waystoneScaleFor, craftWaystone, waystoneCurrencyAccepts } from "./waystone.js";
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

describe("waystone loot modifiers", () => {
  it("folds quantity and rarity into the scale", () => {
    const s = waystoneScale([
      { id: "quantity", kind: "prefix", value: 40, label: "" },
      { id: "rarity", kind: "prefix", value: 60, label: "" },
    ]);
    expect(s.quantityPct).toBe(40);
    expect(s.rarityPct).toBe(60);
  });

  it("defaults to none", () => {
    const s = waystoneScale([]);
    expect(s.quantityPct).toBe(0);
    expect(s.rarityPct).toBe(0);
  });

  it("both are reachable from a rolled stone", () => {
    const seen = new Set<string>();
    for (let s = 1; s < 2000; s++) for (const m of waystoneMods(s)) seen.add(m.id);
    expect(seen.has("quantity")).toBe(true);
    expect(seen.has("rarity")).toBe(true);
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
      quantityPct: 0, rarityPct: 0,
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
      quantityPct: 0, rarityPct: 0,
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

describe("craftWaystone", () => {
  function seedOfRarity(rarity: string): number {
    for (let s = 1; s < 100_000; s++) if (waystoneRarity(s) === rarity) return s;
    throw new Error(`no seed rolls ${rarity}`);
  }

  it("transmutation turns a plain stone magic", () => {
    const out = craftWaystone("currency.transmutation", seedOfRarity("normal"), 42);
    expect(out).not.toBeNull();
    expect(waystoneRarity(out!)).toBe("magic");
  });

  it("alchemy turns a plain or magic stone rare, elevation a magic one", () => {
    for (const [id, from] of [["currency.alchemy", "normal"], ["currency.alchemy", "magic"], ["currency.elevation", "magic"]] as const) {
      const out = craftWaystone(id, seedOfRarity(from), 7);
      expect(out, `${id} on ${from}`).not.toBeNull();
      expect(waystoneRarity(out!)).toBe("rare");
    }
  });

  it("refuses an orb the stone's rarity does not take, and every full stone", () => {
    expect(craftWaystone("currency.transmutation", seedOfRarity("magic"), 1)).toBeNull();
    expect(craftWaystone("currency.elevation", seedOfRarity("normal"), 1)).toBeNull();
    expect(craftWaystone("currency.alchemy", seedOfRarity("rare"), 1)).toBeNull();
    expect(craftWaystone("currency.augmentation", seedOfRarity("magic"), 1)).toBeNull();
    expect(craftWaystone("currency.embers", seedOfRarity("rare"), 1)).toBeNull();
    expect(craftWaystone("currency.wisdom", seedOfRarity("normal"), 1)).toBeNull();
  });

  it("is deterministic in the craft seed and varies with it", () => {
    const plain = seedOfRarity("normal");
    expect(craftWaystone("currency.alchemy", plain, 99)).toBe(craftWaystone("currency.alchemy", plain, 99));
    const outs = new Set<number | null>();
    for (let c = 1; c <= 20; c++) outs.add(craftWaystone("currency.alchemy", plain, c));
    expect(outs.size).toBeGreaterThan(1);
  });

  it("never lands on seed 0, the no-stone sentinel", () => {
    for (let c = 0; c < 500; c++) expect(craftWaystone("currency.transmutation", seedOfRarity("normal"), c)).not.toBe(0);
  });

  it("the client's guess reads the same table, and never offers the permanent stone", () => {
    expect(waystoneCurrencyAccepts("currency.transmutation", seedOfRarity("normal"))).toBe(true);
    expect(waystoneCurrencyAccepts("currency.elevation", seedOfRarity("magic"))).toBe(true);
    expect(waystoneCurrencyAccepts("currency.alchemy", seedOfRarity("rare"))).toBe(false);
    expect(waystoneCurrencyAccepts("currency.embers", seedOfRarity("rare"))).toBe(false);
    expect(waystoneCurrencyAccepts("currency.wisdom", seedOfRarity("normal"))).toBe(false);
    expect(waystoneCurrencyAccepts("currency.alchemy", 0)).toBe(false);
    expect(craftWaystone("currency.alchemy", 0, 5)).toBeNull();
  });
});
