import { describe, it, expect } from "vitest";
import { disenchantYield, SHARDS_PER_ORB } from "./disenchant.js";
import type { Item, ItemAffix } from "@exiled/content-schema";

function item(over: Partial<Item> = {}): Item {
  return { baseId: "weapon.ember_wand", rarity: "rare", itemLevel: 20, affixes: [], ...over };
}

function affixes(n: number): ItemAffix[] {
  return Array.from({ length: n }, (_, i) => ({ affixId: `affix.stub_${i}`, value: 1 }));
}

describe("disenchantYield", () => {
  it("pays a Transmutation Shard for a magic item", () => {
    expect(disenchantYield(item({ rarity: "magic", affixes: affixes(2) })))
      .toEqual({ orbBaseId: "currency.transmutation", shards: 1 });
  });

  it("pays an Elevation Shard for a rare", () => {
    expect(disenchantYield(item({ affixes: affixes(4) })))
      .toEqual({ orbBaseId: "currency.elevation", shards: 1 });
  });

  it("pays two Elevation Shards for a six-affix rare", () => {
    expect(disenchantYield(item({ affixes: affixes(6) })))
      .toEqual({ orbBaseId: "currency.elevation", shards: 2 });
  });

  it("pays an Embers Shard for a unique", () => {
    expect(disenchantYield(item({ rarity: "unique", affixes: affixes(3) })))
      .toEqual({ orbBaseId: "currency.embers", shards: 1 });
  });

  it("refuses a normal item", () => {
    expect(disenchantYield(item({ rarity: "normal" }))).toBeNull();
  });

  it("refuses currency", () => {
    expect(disenchantYield(item({ baseId: "currency.transmutation", rarity: "normal" }))).toBeNull();
    expect(disenchantYield(item({ baseId: "currency.wisdom", rarity: "magic" }))).toBeNull();
  });

  it("refuses an unread item, so nothing is thrown away sight unseen", () => {
    expect(disenchantYield(item({ rarity: "rare", unidentified: true }))).toBeNull();
  });

  it("takes ten shards to make an orb", () => {
    expect(SHARDS_PER_ORB).toBe(10);
  });
});
