import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { StatBlock, baseCasterStats, applyItemMods, RES_CAP, ARMOUR_DMG_MULT, PDR_CAP } from "./stats.js";

describe("constants", () => {
  it("RES_CAP === 75", () => {
    expect(RES_CAP).toBe(75);
  });

  it("ARMOUR_DMG_MULT === 10 (PoE2's curve; PoE1 uses 5)", () => {
    expect(ARMOUR_DMG_MULT).toBe(10);
  });

  it("PDR_CAP === 90", () => {
    expect(PDR_CAP).toBe(90);
  });
});

describe("baseCasterStats", () => {
  it("returns exact contract values", () => {
    const s: StatBlock = baseCasterStats();
    expect(s.maxLifeFixed).toBe(fp(100));        // 100000
    expect(s.maxManaFixed).toBe(fp(60));          // 60000
    expect(s.manaRegenPerSecFixed).toBe(fp(15));  // 15000
    expect(s.moveSpeedFixed).toBe(fp(4.2));       // 4200
    expect(s.resPct).toEqual({ fire: 0, cold: 0, lightning: 0, chaos: 0 });
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
    // base fp(15)/s, +45% implicit + 10% suffix = 155% → 23.25/s
    const s = applyItemMods(baseCasterStats(), [
      { stat: "manaRegenPct", value: 45 },
      { stat: "manaRegenPct", value: 10 },
    ]);
    expect(s.manaRegenPerSecFixed).toBe(fp(23.25));
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
    expect(s.resPct.fire).toBe(85); // RES_CAP is applied by applyDamage, not here
  });

  it("each element's mod lands on its own resistance and nowhere else", () => {
    const s = applyItemMods(baseCasterStats(), [
      { stat: "coldResPct", value: 12 },
      { stat: "lightningResPct", value: 7 },
      { stat: "chaosResPct", value: 5 },
    ]);
    expect(s.resPct).toEqual({ fire: 0, cold: 12, lightning: 7, chaos: 5 });
  });

  it("collects spell damage percent", () => {
    const s = applyItemMods(baseCasterStats(), [
      { stat: "spellDamagePct", value: 12 },
      { stat: "spellDamagePct", value: 25 },
    ]);
    expect(s.spellDamagePct).toBe(37);
  });

  it("collects increased critical strike chance", () => {
    const s = applyItemMods(baseCasterStats(), [
      { stat: "critChancePct", value: 12 },
      { stat: "critChancePct", value: 13 },
    ]);
    expect(s.critChancePct).toBe(25); // increases add, then multiply the skill's own base
  });

  it("collects cast speed percent", () => {
    const s = applyItemMods(baseCasterStats(), [
      { stat: "castSpeedPct", value: 9 },
      { stat: "castSpeedPct", value: 6 },
    ]);
    expect(s.castSpeedPct).toBe(15); // PoE adds increases together, never multiplies them
  });

  it("ignores stats the sim has no mechanic for", () => {
    const s = applyItemMods(baseCasterStats(), [
      { stat: "dexterity", value: 20 }, // no accuracy system to land on
    ]);
    expect(s).toEqual(baseCasterStats());
  });

  it("strength buys life at PoE2's two per point", () => {
    const s = applyItemMods(baseCasterStats(), [
      { stat: "strength", value: 20 },
    ]);
    expect(s.maxLifeFixed).toBe(fp(140)); // 100 + 20 x 2
  });

  it("strength stacks with a flat life roll on the same character", () => {
    const s = applyItemMods(baseCasterStats(), [
      { stat: "strength", value: 15 },
      { stat: "maxLife", value: 40 },
    ]);
    expect(s.maxLifeFixed).toBe(fp(170)); // 100 + 30 + 40
  });

  it("energy shield adds flat, then its percent scales the sum", () => {
    const s = applyItemMods(baseCasterStats(), [
      { stat: "energyShield", value: 35 },
      { stat: "energyShield", value: 25 },
      { stat: "energyShieldPct", value: 30 },
    ]);
    expect(s.maxEnergyShieldFixed).toBe(fp(78)); // (35 + 25) x 1.3
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
