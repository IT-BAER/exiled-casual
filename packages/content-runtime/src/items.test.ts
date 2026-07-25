import { describe, it, expect } from "vitest";
import { ITEM_POOLS, baseOf, describeItem } from "./items.js";

describe("ITEM_POOLS", () => {
  it("has bases and affixes with positive base dimensions", () => {
    expect(ITEM_POOLS.bases.length).toBeGreaterThan(0);
    expect(ITEM_POOLS.affixes.length).toBeGreaterThan(0);
    for (const b of ITEM_POOLS.bases) {
      expect(b.w).toBeGreaterThan(0);
      expect(b.h).toBeGreaterThan(0);
    }
  });
});

describe("describeItem", () => {
  it("names a normal item by its base and lists no affix lines", () => {
    const base = ITEM_POOLS.bases[0]!;
    const d = describeItem({ baseId: base.id, rarity: "normal", itemLevel: 65, affixes: [] });
    expect(d.name).toBe(base.name);
    expect(d.rarity).toBe("normal");
    expect(d.lines).toEqual([]);
  });
  it("formats magic affix lines as value + label", () => {
    const base = ITEM_POOLS.bases[0]!;
    const affix = ITEM_POOLS.affixes[0]!;
    const d = describeItem({ baseId: base.id, rarity: "magic", itemLevel: 65, affixes: [{ affixId: affix.id, value: 12 }] });
    expect(d.lines).toEqual([`+12 ${affix.label}`]);
  });
  it("hugs the percent sign and drops the plus on increased mods", () => {
    const base = ITEM_POOLS.bases[0]!;
    const line = (affixId: string, value: number) =>
      describeItem({ baseId: base.id, rarity: "magic", itemLevel: 65, affixes: [{ affixId, value }] }).lines[0];
    expect(line("affix.cast_speed", 3)).toBe("3% increased Cast Speed");
    expect(line("affix.fire_res", 13)).toBe("+13% to Fire Resistance");
    expect(line("affix.life", 9)).toBe("+9 to maximum Life");
    expect(line("affix.cold_res", 24)).toBe("+24% to Cold Resistance");
    expect(line("affix.chaos_res", 7)).toBe("+7% to Chaos Resistance");
    expect(line("affix.strength", 12)).toBe("+12 to Strength");
    expect(line("affix.crit_chance", 18)).toBe("18% increased Critical Strike Chance");
    expect(line("affix.mana_regen", 30)).toBe("30% increased Mana Regeneration Rate");
  });

  it("renders a base's fixed implicit, and none for a base without one", () => {
    const of = (baseId: string) => describeItem({ baseId, rarity: "normal", itemLevel: 65, affixes: [] }).implicit;
    // Ember Wand copies Goat's Horn's stat block (poe2-screenshots/item-rare.png), so it
    // carries that base's implicit too. Same value on every drop, unlike an affix.
    expect(of("base.emberwand")).toBe("12% increased Spell Damage");
    expect(of("base.cinder_cap")).toBeUndefined();
  });

  it("shows a rare item's generated name and keeps the base type", () => {
    const base = ITEM_POOLS.bases[0]!;
    const d = describeItem({ baseId: base.id, rarity: "rare", itemLevel: 82, affixes: [], name: "Corpse Husk" });
    expect(d.name).toBe("Corpse Husk");
    expect(d.baseName).toBe(base.name);
  });
});

describe("uniques", () => {
  it("bind to a real base and only reference real affixes", () => {
    const uniques = ITEM_POOLS.uniques ?? [];
    expect(uniques.length).toBeGreaterThan(0);
    for (const u of uniques) {
      expect(() => baseOf(u.baseId)).not.toThrow();
      expect(u.flavour.length).toBeGreaterThan(0);
      for (const m of u.mods) {
        expect(ITEM_POOLS.affixes.some((a) => a.id === m.affixId)).toBe(true);
        expect(m.min).toBeLessThanOrEqual(m.max);
      }
    }
  });

  it("describeItem attaches the flavour line for a unique and nothing else", () => {
    const u = ITEM_POOLS.uniques![0]!;
    const d = describeItem({ baseId: u.baseId, rarity: "unique", itemLevel: 82, affixes: [], name: u.name });
    expect(d.flavour).toBe(u.flavour);
    expect(d.baseName).toBe(baseOf(u.baseId).name);

    const rare = describeItem({ baseId: u.baseId, rarity: "rare", itemLevel: 82, affixes: [], name: u.name });
    expect(rare.flavour).toBeUndefined();
  });

  it("carry their own art instead of the base's", () => {
    for (const u of ITEM_POOLS.uniques ?? []) {
      const d = describeItem({ baseId: u.baseId, rarity: "unique", itemLevel: 82, affixes: [], name: u.name });
      expect(u.icon).toBeTruthy();
      expect(d.icon).toBe(u.icon);
      expect(d.icon).not.toBe(baseOf(u.baseId).icon);
    }
  });
});

describe("baseOf", () => {
  it("throws on an unknown base id", () => {
    expect(() => baseOf("base.nope")).toThrow();
  });
});
