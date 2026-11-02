import { describe, it, expect } from "vitest";
import {
  vendorBuyPrice, vendorSellPrice, rollVendorStock, VENDOR_MARGIN_PCT, VENDOR_STOCK, START_GOLD,
  cartographerPrice, rollCartographerStock, cartographerTopTier, CARTOGRAPHER_MARKUP, CARTOGRAPHER_STOCK_MIN, CARTOGRAPHER_STOCK_MAX,
} from "./vendor.js";
import { waystoneRarity } from "./waystone.js";
import { areaLevel, WAYSTONE_MAX_TIER } from "./atlas.js";
import { START_LEVEL } from "./xp.js";
import type { Item, ItemAffix, ItemPools } from "@exiled/content-schema";

const POOLS: ItemPools = {
  bases: [
    { id: "b0", name: "B0", itemClass: "wand", w: 1, h: 2 },
    { id: "b1", name: "B1", itemClass: "focus", w: 2, h: 2 },
  ],
  affixes: [
    { id: "a.low", kind: "prefix", nameWord: "Hale", stat: "maxLife", label: "life", minItemLevel: 1, min: 5, max: 20 },
    { id: "a.mid", kind: "suffix", nameWord: "of the Furnace", stat: "fireResPct", label: "res", minItemLevel: 1, min: 4, max: 10 },
  ],
};

function item(over: Partial<Item> = {}): Item {
  return { baseId: "weapon.ember_wand", rarity: "normal", itemLevel: 20, affixes: [], ...over };
}

function affixes(n: number): ItemAffix[] {
  return Array.from({ length: n }, (_, i) => ({ affixId: `affix.stub_${i}`, value: 1 }));
}

describe("vendor pricing", () => {
  it("never pays more for an item than it charges, so buy-then-sell cannot print gold", () => {
    for (const rarity of ["normal", "magic", "rare", "unique"] as const) {
      for (const itemLevel of [1, 20, 45, 85]) {
        const it_ = item({ rarity, itemLevel, affixes: affixes(rarity === "normal" ? 0 : 2) });
        expect(vendorSellPrice(it_)).toBeLessThan(vendorBuyPrice(it_));
      }
    }
  });

  it("charges more for a rarer item", () => {
    const at = (rarity: Item["rarity"]) => vendorBuyPrice(item({ rarity, affixes: affixes(2) }));
    expect(at("normal")).toBeLessThan(at("magic"));
    expect(at("magic")).toBeLessThan(at("rare"));
    expect(at("rare")).toBeLessThan(at("unique"));
  });

  it("charges more for a higher item level", () => {
    expect(vendorBuyPrice(item({ itemLevel: 1 }))).toBeLessThan(vendorBuyPrice(item({ itemLevel: 60 })));
  });

  it("prices in whole gold", () => {
    for (const itemLevel of [1, 7, 13, 40, 85]) {
      expect(Number.isInteger(vendorBuyPrice(item({ itemLevel })))).toBe(true);
      expect(Number.isInteger(vendorSellPrice(item({ itemLevel })))).toBe(true);
    }
  });

  it("always pays at least a coin for something it will accept", () => {
    expect(vendorSellPrice(item({ itemLevel: 1 }))).toBeGreaterThan(0);
  });

  it("refuses to buy currency, which is the payment and not the goods", () => {
    expect(vendorSellPrice(item({ baseId: "currency.transmutation" }))).toBe(0);
    expect(vendorSellPrice(item({ baseId: "currency.wisdom", rarity: "magic" }))).toBe(0);
  });

  it("refuses an unread item, so nothing is sold sight unseen", () => {
    expect(vendorSellPrice(item({ rarity: "rare", affixes: affixes(4), unidentified: true }))).toBe(0);
  });

  it("keeps a margin the player can feel", () => {
    expect(VENDOR_MARGIN_PCT).toBeGreaterThan(0);
    expect(VENDOR_MARGIN_PCT).toBeLessThan(100);
  });

  it("starts a character with two magic pieces' worth of gold and short of a rare", () => {
    const opening = (rarity: Item["rarity"]) => vendorBuyPrice(item({ rarity, itemLevel: START_LEVEL }));
    expect(START_GOLD).toBeGreaterThanOrEqual(2 * opening("magic"));
    expect(START_GOLD).toBeLessThan(opening("rare"));
  });
});

describe("rollVendorStock", () => {
  it("is deterministic: one seed is one shelf", () => {
    expect(rollVendorStock(POOLS, 1234, 20)).toEqual(rollVendorStock(POOLS, 1234, 20));
  });

  it("restocks differently when the seed moves on", () => {
    expect(rollVendorStock(POOLS, 1234, 20)).not.toEqual(rollVendorStock(POOLS, 1235, 20));
  });

  it("fills the shelf", () => {
    expect(rollVendorStock(POOLS, 7, 20)).toHaveLength(VENDOR_STOCK);
  });

  it("shows its goods: nothing on the shelf is unread", () => {
    for (const it_ of rollVendorStock(POOLS, 9, 40)) {
      expect(it_.unidentified).toBeUndefined();
    }
  });

  it("stocks to the player's level, never above it", () => {
    for (const it_ of rollVendorStock(POOLS, 3, 12)) {
      expect(it_.itemLevel).toBeGreaterThan(0);
      expect(it_.itemLevel).toBeLessThanOrEqual(12);
    }
  });

  it("sells mostly plain goods, so a rare on the shelf is worth walking over for", () => {
    const rarities = Array.from({ length: 40 }, (_, s) => rollVendorStock(POOLS, s, 30)).flat();
    const rare = rarities.filter((i) => i.rarity === "rare").length;
    expect(rare).toBeGreaterThan(0);
    expect(rare / rarities.length).toBeLessThan(0.2);
  });

  it("prices every piece it stocks", () => {
    for (const it_ of rollVendorStock(POOLS, 11, 25)) {
      expect(vendorBuyPrice(it_)).toBeGreaterThan(0);
    }
  });
});

describe("waystone pricing", () => {
  // Seeds whose stones roll each rarity, found rather than hard-coded.
  const seedOf = (r: string) => { for (let s = 1; ; s++) if (waystoneRarity(s) === r) return s; };
  const stone = (seed: number, tier: number): Item =>
    ({ baseId: "map.waystone", rarity: "normal", itemLevel: 1, affixes: [], waystone: { seed, tier } });

  it("values a stone by its own rarity and tier, not the blank item fields it carries", () => {
    const normal = seedOf("normal");
    expect(vendorBuyPrice(stone(normal, 8))).toBeGreaterThan(vendorBuyPrice(stone(normal, 1)));
    expect(vendorBuyPrice(stone(seedOf("rare"), 5))).toBeGreaterThan(vendorBuyPrice(stone(seedOf("magic"), 5)));
    expect(vendorBuyPrice(stone(seedOf("magic"), 5))).toBeGreaterThan(vendorBuyPrice(stone(normal, 5)));
  });

  it("will not buy the permanent stone, which every load hands back", () => {
    expect(vendorSellPrice({ ...stone(0, 1), waystone: { seed: 0, tier: 1, permanent: true } })).toBe(0);
    expect(vendorSellPrice(stone(seedOf("magic"), 3))).toBeGreaterThan(0);
  });

  it("the cartographer asks four times the counter's own price", () => {
    const s = stone(seedOf("rare"), 6);
    expect(CARTOGRAPHER_MARKUP).toBe(4);
    expect(cartographerPrice(s)).toBe(vendorBuyPrice(s) * 4);
  });
});

describe("rollCartographerStock", () => {
  it("lays out six to ten stones, the same ones for the same seed and level", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const stock = rollCartographerStock(seed, 30);
      expect(stock.length).toBeGreaterThanOrEqual(CARTOGRAPHER_STOCK_MIN);
      expect(stock.length).toBeLessThanOrEqual(CARTOGRAPHER_STOCK_MAX);
      expect(rollCartographerStock(seed, 30)).toEqual(stock);
    }
  });

  it("stocks the tiers the level can run, never above them, and never the seed-0 blank", () => {
    for (const level of [1, 14, 30, 60, 100]) {
      const top = cartographerTopTier(level);
      expect(areaLevel(top)).toBeLessThanOrEqual(Math.max(level, areaLevel(1)));
      for (const w of rollCartographerStock(level * 7919, level)) {
        expect(w.tier).toBeGreaterThanOrEqual(Math.max(1, top - 2));
        expect(w.tier).toBeLessThanOrEqual(top);
        expect(w.seed).not.toBe(0);
      }
    }
    expect(cartographerTopTier(100)).toBe(WAYSTONE_MAX_TIER);
  });

  it("mixes rarities, and a new seed or tier band is a new stock", () => {
    const rarities = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) for (const w of rollCartographerStock(seed, 30)) rarities.add(waystoneRarity(w.seed));
    expect([...rarities].sort()).toEqual(["magic", "normal", "rare"]);
    expect(rollCartographerStock(5, 60)).not.toEqual(rollCartographerStock(5, 30));
    expect(rollCartographerStock(6, 30)).not.toEqual(rollCartographerStock(5, 30));
  });
});
