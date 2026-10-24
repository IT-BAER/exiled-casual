import { existsSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { FAMILY_BY_CLASS, areaLevel, familyOf } from "@exiled/rules";
import { ITEM_POOLS, UNARMED, baseOf, describeItem, itemStatMods, spellAddedDamage, waystoneItem, weaponDamage } from "./items.js";

describe("ITEM_POOLS", () => {
  it("has bases and affixes with positive base dimensions", () => {
    expect(ITEM_POOLS.bases.length).toBeGreaterThan(0);
    expect(ITEM_POOLS.affixes.length).toBeGreaterThan(0);
    for (const b of ITEM_POOLS.bases) {
      expect(b.w).toBeGreaterThan(0);
      expect(b.h).toBeGreaterThan(0);
    }
  });

  // No character totals Str, Dex or Int, so a tooltip's attribute requirement
  // could never be met or checked; reqLevel is the only one equip enforces.
  it("asks for no attribute on any base", () => {
    expect(ITEM_POOLS.bases.filter((b) => b.stats?.reqAttr !== undefined).map((b) => b.id)).toEqual([]);
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
    // Ember Wand copies Goat's Horn's stat block (reference-screenshots/item-rare.png), so it
    // carries that base's implicit too. Same value on every drop, unlike an affix.
    expect(of("base.ember_wand")).toBe("12% increased Damage");
    expect(of("base.ironsworn_helm")).toBeUndefined();
  });

  it("shows a rare item's generated name and keeps the base type", () => {
    const base = ITEM_POOLS.bases[0]!;
    const d = describeItem({ baseId: base.id, rarity: "rare", itemLevel: 82, affixes: [], name: "Corpse Husk" });
    expect(d.name).toBe("Corpse Husk");
    expect(d.baseName).toBe(base.name);
  });

  it("a waystone names itself once and reads its tier and area level, as in PoE2", () => {
    const d = describeItem(waystoneItem(7, 2));
    expect(d.name).toBe("Waystone (Tier 2)");
    // PoE2's base type IS the tiered name, so no second header line repeats "Waystone".
    expect(d.baseName).toBe(d.name);
    expect(d.statLines).toEqual([{ label: "Waystone Tier", value: "2" }, { label: "Area Level", value: String(areaLevel(2)) }]);
    expect(d.help).toBe("Can be used in a Map Device, allowing you to enter a Map. Waystones can only be used once.");
  });

  it("the permanent waystone does not claim it is spent", () => {
    const d = describeItem({ ...waystoneItem(0, 1), waystone: { seed: 0, tier: 1, permanent: true } });
    expect(d.help).toBe("Can be used in a Map Device, allowing you to enter a Map.");
  });

  it("every currency says what it does and how to spend it, in PoE2's words", () => {
    const of = (baseId: string) => {
      const d = describeItem({ baseId, rarity: "normal", itemLevel: 1, affixes: [] });
      return [d.lines, d.help];
    };
    const apply = (target: string) => `Right click this item then left click ${target} to apply it.`;
    expect(of("currency.wisdom")).toEqual([["Identifies an item"], apply("an unidentified item")]);
    expect(of("currency.transmutation")).toEqual([["Upgrades a Normal item to a Magic item with 1 modifier"], apply("a normal item")]);
    expect(of("currency.augmentation")).toEqual([["Augments a Magic item with a new random modifier"], apply("a magic item")]);
    expect(of("currency.elevation")).toEqual([["Upgrades a Magic item to a Rare item, adding 1 modifier"], apply("a magic item")]);
    expect(of("currency.alchemy")).toEqual([["Upgrades a Normal or Magic item to a Rare item with 4 random modifiers"], apply("a normal or magic item")]);
    expect(of("currency.embers")).toEqual([["Augments a Rare item with a new random modifier"], apply("a rare item")]);
    expect(of("currency.portal")).toEqual([["Creates a portal to your hideout"], "Right click on this item to use it. Only works inside a map."]);
    // The legacy id resolves to the same scroll, so an old save reads the same text.
    expect(of("base.wisdom_scroll")).toEqual(of("currency.wisdom"));
  });

  it("gear carries no usage line", () => {
    expect(describeItem({ baseId: "base.ironsworn_helm", rarity: "normal", itemLevel: 1, affixes: [] }).help).toBeUndefined();
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

  it("gives every class family the same number of uniques", () => {
    const perFamily: Record<string, number> = {};
    for (const f of Object.values(FAMILY_BY_CLASS)) perFamily[f] = 0;
    for (const u of ITEM_POOLS.uniques ?? []) perFamily[familyOf(u.baseId)]! += 1;
    expect(perFamily).toEqual({ ironsworn: 3, stalker: 3, ember: 3 });
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

  it("ship the art they name, or the drop is a reward nobody sees", () => {
    for (const u of ITEM_POOLS.uniques ?? []) {
      expect(existsSync(new URL(`../../../apps/web/public${u.icon}`, import.meta.url)), u.icon).toBe(true);
    }
  });
});

describe("baseOf", () => {
  it("throws on an unknown base id", () => {
    expect(() => baseOf("base.nope")).toThrow();
  });
});

describe("itemStatMods", () => {
  it("returns the base implicit even on a normal item", () => {
    expect(itemStatMods({ baseId: "base.ember_wand", rarity: "normal", itemLevel: 1, affixes: [] }))
      .toEqual([{ stat: "spellDamagePct", value: 12 }]);
  });

  it("returns nothing for a base with no implicit and no affixes", () => {
    expect(itemStatMods({ baseId: "base.ember_focus", rarity: "normal", itemLevel: 1, affixes: [] }))
      .toEqual([]);
  });

  it("resolves each affix to its stat id and rolled value, implicit first", () => {
    expect(itemStatMods({
      baseId: "base.ember_robe", rarity: "rare", itemLevel: 80,
      affixes: [{ affixId: "affix.life", value: 33 }, { affixId: "affix.fire_res", value: 21 }],
    })).toEqual([
      { stat: "manaRegenPct", value: 30 },
      { stat: "maxLife", value: 33 },
      { stat: "fireResPct", value: 21 },
    ]);
  });

  it("skips an affix id the pool no longer has", () => {
    expect(itemStatMods({
      baseId: "base.ember_focus", rarity: "magic", itemLevel: 80,
      affixes: [{ affixId: "affix.gone", value: 9 }, { affixId: "affix.mana", value: 12 }],
    })).toEqual([{ stat: "maxMana", value: 12 }]);
  });
});

describe("the plate set's base Armour", () => {
  const plain = (baseId: string) => ({ baseId, rarity: "normal" as const, itemLevel: 1, affixes: [] });
  it.each([
    ["base.ironsworn_plate", 45], ["base.ironsworn_helm", 29],
    ["base.ironsworn_gauntlets", 15], ["base.ironsworn_sabatons", 22],
  ])("%s carries PoE2's first Str base value, %i", (baseId, armour) => {
    expect(itemStatMods(plain(baseId))).toContainEqual({ stat: "armour", value: armour });
    expect(describeItem(plain(baseId)).statLines).toContainEqual({ label: "Armour", value: String(armour) });
  });

  it("the girdle carries none, as no PoE2 belt does", () => {
    expect(itemStatMods(plain("base.ironsworn_girdle")).some((m) => m.stat === "armour")).toBe(false);
  });
});

describe("unidentified items", () => {
  const rare = {
    baseId: "base.ember_wand", rarity: "rare" as const, itemLevel: 82,
    affixes: [{ affixId: "affix.life", value: 33 }], name: "Corpse Husk", unidentified: true,
  };

  it("shows the base name and no affix lines until identified", () => {
    const d = describeItem(rare);
    expect(d.unidentified).toBe(true);
    expect(d.name).toBe(d.baseName);
    expect(d.lines).toEqual([]);
  });

  it("still shows rarity, the base stat block and the implicit", () => {
    const d = describeItem(rare);
    expect(d.rarity).toBe("rare");
    expect(d.implicit).toBe("12% increased Damage");
    expect(d.statLines.length).toBeGreaterThan(0);
  });

  it("reveals the generated name and its mods once identified", () => {
    const d = describeItem({ ...rare, unidentified: undefined });
    expect(d.name).toBe("Corpse Husk");
    expect(d.lines).toEqual(["+33 to maximum Life"]);
    expect(d.unidentified).toBeUndefined();
  });
});

describe("jewellery", () => {
  // Each copies one PoE2 base (poe2db): Amber Amulet, Ruby Ring, Pearlescent Amulet,
  // Sapphire Ring, Azure Amulet, Lazuli Ring, with that base's level requirement.
  it.each([
    ["base.ironsworn_torc", "amulet", "+12 to Strength", 8],
    ["base.ironsworn_signet", "ring", "+25% to Fire Resistance", 8],
    ["base.stalker_talisman", "amulet", "+8% to all Elemental Resistances", 8],
    ["base.stalker_band", "ring", "+25% to Cold Resistance", 12],
    ["base.ember_pendant", "amulet", "25% increased Mana Regeneration Rate", undefined],
    ["base.ember_loop", "ring", "+25 to maximum Mana", undefined],
  ] as const)("%s is a 1x1 %s reading %s", (baseId, itemClass, implicit, reqLevel) => {
    const base = ITEM_POOLS.bases.find((b) => b.id === baseId);
    expect(base).toMatchObject({ itemClass, w: 1, h: 1 });
    const d = describeItem({ baseId, rarity: "normal", itemLevel: 1, affixes: [] });
    expect(d.implicit).toBe(implicit);
    expect(d.reqLevel).toBe(reqLevel);
    expect(existsSync(new URL(`../../../apps/web/public${d.icon}`, import.meta.url)), d.icon).toBe(true);
  });

  it("gives every class family exactly one amulet and one ring", () => {
    for (const family of Object.values(FAMILY_BY_CLASS)) {
      const own = ITEM_POOLS.bases.filter((b) => familyOf(b.id) === family);
      expect(own.filter((b) => b.itemClass === "amulet"), family).toHaveLength(1);
      expect(own.filter((b) => b.itemClass === "ring"), family).toHaveLength(1);
    }
  });
});

describe("the Ironsworn Broadsword", () => {
  it("is a plate-family one-hand sword on PoE2's Shortsword block", () => {
    const sword = baseOf("base.ironsworn_broadsword");
    expect(familyOf(sword.id)).toBe(FAMILY_BY_CLASS["class.ironsworn"]);
    expect(sword).toMatchObject({ itemClass: "sword", w: 1, h: 3, icon: "/textures/items/broadsword.webp" });
    expect(sword.stats).toEqual({ physMin: 6, physMax: 9, critPct: 5, aps: 1.55, reqLevel: 1 });
  });

  it("rolls every damage mod the hammer rolls", () => {
    const pool = (cls: string) => ITEM_POOLS.affixes.filter((a) => a.itemClasses?.includes(cls)).map((a) => a.id);
    expect(pool("sword")).toEqual(pool("mace"));
  });
});

describe("affix pools per item class", () => {
  // A rare fills 3 prefixes and 3 suffixes; a class with fewer than that eligible
  // at item level 1 rolls a rare with holes in it.
  it("offers every droppable class a rare's three prefixes and three suffixes at item level 1", () => {
    for (const cls of new Set(ITEM_POOLS.bases.map((b) => b.itemClass))) {
      const at1 = ITEM_POOLS.affixes.filter((a) => a.minItemLevel <= 1 && (a.itemClasses === undefined || a.itemClasses.includes(cls)));
      expect(at1.filter((a) => a.kind === "prefix").length, `${cls} prefixes`).toBeGreaterThanOrEqual(3);
      expect(at1.filter((a) => a.kind === "suffix").length, `${cls} suffixes`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("weaponDamage (local, PoE: (base + added) * (1 + increased))", () => {
  const hammer = (affixes: { affixId: string; value: number }[]) =>
    ({ baseId: "base.ironsworn_hammer", rarity: "rare" as const, itemLevel: 10, affixes });

  it("is the base block on a plain weapon", () => {
    expect(weaponDamage(hammer([]))).toEqual({ physMin: 6, physMax: 10, fire: 0, cold: 0, critPct: 5, aps: 1.45, modified: false });
  });

  it("adds local flat physical before local increased scales it, each end truncated", () => {
    const w = weaponDamage(hammer([{ affixId: "affix.added_phys", value: 12 }, { affixId: "affix.phys_dmg_pct", value: 40 }]));
    // (6 + 12) * 1.4 = 25.2, (10 + 12) * 1.4 = 30.8
    expect([w.physMin, w.physMax, w.modified]).toEqual([25, 30, true]);
  });

  it("carries an attack weapon's flat fire and cold as its own parts", () => {
    const w = weaponDamage(hammer([{ affixId: "affix.fire_dmg", value: 9 }, { affixId: "affix.cold_dmg", value: 4 }]));
    expect([w.physMin, w.physMax, w.fire, w.cold]).toEqual([6, 10, 9, 4]);
  });

  it("leaves a wand's elemental damage to its spells, not to its attack", () => {
    const w = weaponDamage({ baseId: "base.ember_wand", rarity: "magic", itemLevel: 10, affixes: [{ affixId: "affix.fire_dmg", value: 9 }] });
    expect(w.fire).toBe(0);
  });

  it("falls back to an unarmed fist with no weapon", () => {
    expect(weaponDamage(undefined)).toEqual(UNARMED);
    expect(UNARMED).toMatchObject({ physMin: 2, physMax: 6, critPct: 5, aps: 1.2 });
  });
});

describe("spellAddedDamage", () => {
  it("sums fire and cold from a wand and a focus, and nothing from an attack weapon", () => {
    const wand = { baseId: "base.ember_wand", rarity: "magic" as const, itemLevel: 10, affixes: [{ affixId: "affix.fire_dmg", value: 9 }] };
    const focus = { baseId: "base.ember_focus", rarity: "magic" as const, itemLevel: 10, affixes: [{ affixId: "affix.cold_dmg", value: 5 }, { affixId: "affix.fire_dmg", value: 2 }] };
    const mace = { baseId: "base.ironsworn_hammer", rarity: "magic" as const, itemLevel: 10, affixes: [{ affixId: "affix.fire_dmg", value: 7 }] };
    expect(spellAddedDamage([wand, focus])).toEqual({ fire: 11, cold: 5 });
    expect(spellAddedDamage([mace, undefined])).toEqual({ fire: 0, cold: 0 });
  });
});

describe("a weapon tooltip shows what the attack will use", () => {
  const stat = (d: ReturnType<typeof describeItem>, label: string) => d.statLines.find((s) => s.label === label);

  it("prints the local range, flagged as modified, once a mod moves it", () => {
    const d = describeItem({ baseId: "base.ironsworn_hammer", rarity: "rare", itemLevel: 10, affixes: [
      { affixId: "affix.added_phys", value: 12 }, { affixId: "affix.phys_dmg_pct", value: 40 },
    ] });
    expect(stat(d, "Physical Damage")).toEqual({ label: "Physical Damage", value: "25-30", augmented: true });
  });

  it("an unmodified weapon reads its base range, unflagged", () => {
    const d = describeItem({ baseId: "base.ironsworn_hammer", rarity: "normal", itemLevel: 1, affixes: [] });
    expect(stat(d, "Physical Damage")).toEqual({ label: "Physical Damage", value: "6-10" });
    expect(stat(d, "Fire Damage")).toBeUndefined();
  });

  it("adds an elemental line for an attack weapon's fire and cold", () => {
    const d = describeItem({ baseId: "base.stalker_bow", rarity: "magic", itemLevel: 10, affixes: [{ affixId: "affix.cold_dmg", value: 7 }] });
    expect(stat(d, "Cold Damage")).toEqual({ label: "Cold Damage", value: "7", augmented: true });
  });

  it("keeps an unread weapon's range at its base, as its mods are hidden", () => {
    const d = describeItem({ baseId: "base.ironsworn_hammer", rarity: "rare", itemLevel: 10, unidentified: true,
      affixes: [{ affixId: "affix.added_phys", value: 12 }] });
    expect(stat(d, "Physical Damage")).toEqual({ label: "Physical Damage", value: "6-10" });
  });
});
