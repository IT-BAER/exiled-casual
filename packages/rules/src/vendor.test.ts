import { describe, it, expect } from "vitest";
import { vendorBuyPrice, vendorSellPrice, rollVendorStock, VENDOR_MARGIN_PCT, VENDOR_STOCK } from "./vendor.js";
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
