import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { StatBlock, baseCasterStats, applyItemMods, RES_CAP, ARMOUR_K } from "./stats.js";

describe("constants", () => {
  it("RES_CAP === 75", () => {
    expect(RES_CAP).toBe(75);
  });

  it("ARMOUR_K === fp(10) === 10000", () => {
    expect(ARMOUR_K).toBe(10000);
    expect(ARMOUR_K).toBe(fp(10));
  });
});

describe("baseCasterStats", () => {
  it("returns exact contract values", () => {
    const s: StatBlock = baseCasterStats();
    expect(s.maxLifeFixed).toBe(fp(100));        // 100000
    expect(s.maxManaFixed).toBe(fp(60));          // 60000
    expect(s.manaRegenPerSecFixed).toBe(fp(6));   // 6000
    expect(s.moveSpeedFixed).toBe(fp(4.2));       // 4200
    expect(s.fireResPct).toBe(0);
    expect(s.armourFixed).toBe(fp(0));            // 0
  });

  it("returns a fresh object each call (no shared reference)", () => {
    const a = baseCasterStats();
    const b = baseCasterStats();
    expect(a).not.toBe(b);
  });

  it("starts with no spell damage bonus", () => {
    expect(baseCasterStats().spellDamagePct).toBe(0);
  });
});

describe("applyItemMods", () => {
  it("adds flat life and mana in fixed-point", () => {
    const s = applyItemMods(baseCasterStats(), [
      { stat: "maxLife", value: 40 },
      { stat: "maxMana", value: 30 },
    ]);
    expect(s.maxLifeFixed).toBe(fp(140));
    expect(s.maxManaFixed).toBe(fp(90));
  });

  it("sums like stats from several items", () => {
    const s = applyItemMods(baseCasterStats(), [
      { stat: "maxLife", value: 40 },
      { stat: "maxLife", value: 5 },
    ]);
    expect(s.maxLifeFixed).toBe(fp(145));
  });

  it("increases mana regeneration by percent of the base rate", () => {
    // base fp(6)/s, +45% implicit + 10% suffix = 155% → 9.3/s
    const s = applyItemMods(baseCasterStats(), [
      { stat: "manaRegenPct", value: 45 },
      { stat: "manaRegenPct", value: 10 },
    ]);
    expect(s.manaRegenPerSecFixed).toBe(fp(9.3));
  });

  it("applies % increased Armour to flat armour, PoE order", () => {
    // (0 + 100) * 1.3 = 130
    const s = applyItemMods(baseCasterStats(), [
      { stat: "armour", value: 100 },
      { stat: "armourPct", value: 30 },
    ]);
    expect(s.armourFixed).toBe(fp(130));
  });

  it("% increased Armour on its own does nothing (nothing to increase)", () => {
    expect(applyItemMods(baseCasterStats(), [{ stat: "armourPct", value: 30 }]).armourFixed).toBe(fp(0));
  });

  it("adds fire resistance as a raw percent, uncapped here", () => {
    const s = applyItemMods(baseCasterStats(), [
      { stat: "fireResPct", value: 25 },
      { stat: "fireResPct", value: 60 },
    ]);
    expect(s.fireResPct).toBe(85); // RES_CAP is applied by applyDamage, not here
  });

  it("collects spell damage percent", () => {
    const s = applyItemMods(baseCasterStats(), [
      { stat: "spellDamagePct", value: 12 },
      { stat: "spellDamagePct", value: 25 },
    ]);
    expect(s.spellDamagePct).toBe(37);
  });

  it("ignores stats the sim has no mechanic for", () => {
    const s = applyItemMods(baseCasterStats(), [
      { stat: "energyShield", value: 35 },
      { stat: "coldResPct", value: 25 },
      { stat: "strength", value: 20 },
      { stat: "critChancePct", value: 25 },
    ]);
    expect(s).toEqual(baseCasterStats());
  });

  it("does not mutate the base block", () => {
    const base = baseCasterStats();
    applyItemMods(base, [{ stat: "maxLife", value: 40 }]);
    expect(base.maxLifeFixed).toBe(fp(100));
  });

  it("is order-independent for mixed flats and percents", () => {
    const mods = [
      { stat: "armour", value: 60 },
      { stat: "armourPct", value: 30 },
      { stat: "armour", value: 10 },
    ];
    expect(applyItemMods(baseCasterStats(), mods).armourFixed)
      .toBe(applyItemMods(baseCasterStats(), [...mods].reverse()).armourFixed);
  });
});
