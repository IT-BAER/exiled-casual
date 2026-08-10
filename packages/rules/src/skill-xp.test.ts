import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import type { SkillDef } from "@exiled/content-schema";
import {
  MAX_GEM_LEVEL, maxGemLevel, gemXpToNext, isUnlocked, splitGemXp, gainGemXp,
  effectiveSkill, reachedBreakpoints, nextBreakpoint,
} from "./skill-xp";
import { xpToNext } from "./xp";

const bolt: SkillDef = {
  id: "skill.fixture_bolt.v1",
  name: "Fixture Bolt",
  unlockLevel: 4,
  manaCostFixed: fp(10),
  cooldownTicks: 30,
  growth: {
    perLevel: { damagePct: 6, manaPct: 4, own: { field: "maxRangeFixed", perMille: 20 } },
    breakpoints: [
      { atLevel: 5, text: "Pierces one enemy", patch: { pierceCount: 1 } },
      { atLevel: 15, text: "Pierces three enemies", patch: { pierceCount: 3 } },
    ],
  },
  effects: [{
    type: "spawnProjectile",
    speedPerSecFixed: fp(12),
    radiusFixed: fp(0.4),
    maxRangeFixed: fp(20),
    damage: { type: "fire", amountFixed: fp(36) },
  }],
};

const ground: SkillDef = {
  id: "skill.fixture_ground.v1",
  name: "Fixture Ground",
  unlockLevel: 8,
  manaCostFixed: fp(20),
  cooldownTicks: 90,
  growth: { perLevel: { damagePct: 6, manaPct: 4 }, breakpoints: [] },
  effects: [{
    type: "spawnGroundArea",
    radiusFixed: fp(2.5),
    durationTicks: 90,
    ailment: { kind: "burning", stacksPerApply: 1, dpsFixed: fp(8), durationTicks: 60, maxStacks: 5 },
  }],
};

describe("maxGemLevel", () => {
  it("is the character level until 20, then 20 forever", () => {
    expect(maxGemLevel(1)).toBe(1);
    expect(maxGemLevel(7)).toBe(7);
    expect(maxGemLevel(20)).toBe(20);
    expect(maxGemLevel(100)).toBe(MAX_GEM_LEVEL);
  });

  it("never returns less than 1, whatever nonsense it is handed", () => {
    expect(maxGemLevel(0)).toBe(1);
    expect(maxGemLevel(-5)).toBe(1);
  });
});

describe("gemXpToNext", () => {
  it("is zero at the cap and rising below it", () => {
    expect(gemXpToNext(MAX_GEM_LEVEL)).toBe(0);
    expect(gemXpToNext(1)).toBeGreaterThan(0);
    for (let l = 1; l < MAX_GEM_LEVEL - 1; l++) {
      expect(gemXpToNext(l + 1)).toBeGreaterThan(gemXpToNext(l));
    }
  });

  it("costs a whole climb to cap: gem 20 lands between character 30 and 55", () => {
    // The band, not the constant. Total gem experience for the whole climb...
    let total = 0;
    for (let l = 1; l < MAX_GEM_LEVEL; l++) total += gemXpToNext(l);
    // ...is earned as one THIRD of the character's, on a three-skill bar.
    const charXpNeeded = total * 3;
    // Invert the real character curve by walking it.
    let acc = 0;
    let charLevel = 1;
    while (acc < charXpNeeded && charLevel < 100) {
      acc += xpToNext(charLevel);
      charLevel++;
    }
    expect(charLevel).toBeGreaterThan(30);
    expect(charLevel).toBeLessThan(55);
  });
});

describe("isUnlocked", () => {
  it("opens at exactly the authored level and never before", () => {
    expect(isUnlocked(bolt, 3, "class.stalker")).toBe(false);
    expect(isUnlocked(bolt, 4, "class.stalker")).toBe(true);
    expect(isUnlocked(bolt, 100, "class.stalker")).toBe(true);
  });

  it("a classless skill belongs to everyone", () => {
    for (const c of ["class.stalker", "class.ironsworn", "class.emberbound", ""]) {
      expect(isUnlocked(bolt, 4, c), c).toBe(true);
    }
  });

  it("a class-restricted skill is refused to every other class, at any level", () => {
    const owned: SkillDef = { ...bolt, classId: "class.emberbound" };
    expect(isUnlocked(owned, 100, "class.emberbound")).toBe(true);
    expect(isUnlocked(owned, 100, "class.stalker")).toBe(false);
    expect(isUnlocked(owned, 100, "")).toBe(false);
  });
});

describe("splitGemXp", () => {
  it("divides evenly and truncates per slot", () => {
    expect(splitGemXp(100, 1)).toBe(100);
    expect(splitGemXp(100, 2)).toBe(50);
    expect(splitGemXp(100, 5)).toBe(20);
    expect(splitGemXp(101, 5)).toBe(20);   // the remainder is dropped, not banked
    expect(splitGemXp(3, 5)).toBe(0);
  });

  it("is zero rather than infinite on an empty bar", () => {
    expect(splitGemXp(100, 0)).toBe(0);
    expect(splitGemXp(100, -1)).toBe(0);
  });
});

describe("gainGemXp", () => {
  it("levels once, and loops for an award that crosses two thresholds", () => {
    const one = gainGemXp({ level: 1, xp: 0 }, gemXpToNext(1), 20);
    expect(one.level).toBe(2);
    expect(one.xp).toBe(0);

    const two = gainGemXp({ level: 1, xp: 0 }, gemXpToNext(1) + gemXpToNext(2), 20);
    expect(two.level).toBe(3);
  });

  it("BANKS experience past the cap instead of burning it, and pops when the cap rises", () => {
    const parked = gainGemXp({ level: 3, xp: 0 }, gemXpToNext(3) * 4, 3);
    expect(parked.level).toBe(3);
    expect(parked.xp).toBeGreaterThan(gemXpToNext(3));
    // The character levels; nothing else changes. The banked experience pays now.
    const popped = gainGemXp(parked, 0, 5);
    expect(popped.level).toBe(5);
  });

  it("stops dead at MAX_GEM_LEVEL and banks nothing there", () => {
    const capped = gainGemXp({ level: MAX_GEM_LEVEL, xp: 0 }, 10_000_000, MAX_GEM_LEVEL);
    expect(capped).toEqual({ level: MAX_GEM_LEVEL, xp: 0 });
  });
});

describe("effectiveSkill", () => {
  it("is the def itself at gem 1", () => {
    const at1 = effectiveSkill(bolt, 1);
    expect(at1.manaCostFixed).toBe(bolt.manaCostFixed);
    const e = at1.effects[0]!;
    if (e.type !== "spawnProjectile") throw new Error("wrong effect");
    expect(e.damage.amountFixed).toBe(fp(36));
    expect(e.maxRangeFixed).toBe(fp(20));
    expect(e.pierceCount).toBeUndefined();
  });

  it("compounds damage 6% and mana 4% per level, so damage outruns cost", () => {
    const at20 = effectiveSkill(bolt, 20);
    const e = at20.effects[0]!;
    if (e.type !== "spawnProjectile") throw new Error("wrong effect");
    // 1.06^19 is about 3.03, 1.04^19 about 2.11.
    expect(e.damage.amountFixed).toBeGreaterThan(fp(36) * 2.9);
    expect(e.damage.amountFixed).toBeLessThan(fp(36) * 3.2);
    expect(at20.manaCostFixed).toBeGreaterThan(fp(10) * 2.0);
    expect(at20.manaCostFixed).toBeLessThan(fp(10) * 2.3);
    const damageRatio = e.damage.amountFixed / fp(36);
    const manaRatio = at20.manaCostFixed / fp(10);
    expect(damageRatio).toBeGreaterThan(manaRatio);
  });

  it("adds the authored own-scalar linearly, in per-mille of the def's own value", () => {
    // 20 per-mille of fp(20) is fp(0.4) per level above 1.
    expect(pierceRange(effectiveSkill(bolt, 2))).toBe(fp(20) + fp(0.4));
    expect(pierceRange(effectiveSkill(bolt, 11))).toBe(fp(20) + fp(0.4) * 10);
  });

  it("scales an ailment's damage too, or a ground skill gains nothing from a level", () => {
    const at10 = effectiveSkill(ground, 10);
    const e = at10.effects[0]!;
    if (e.type !== "spawnGroundArea") throw new Error("wrong effect");
    expect(e.ailment.dpsFixed).toBeGreaterThan(fp(8));
  });

  it("applies every breakpoint reached, in order, the later one winning", () => {
    expect(pierceOf(effectiveSkill(bolt, 4))).toBeUndefined();
    expect(pierceOf(effectiveSkill(bolt, 5))).toBe(1);
    expect(pierceOf(effectiveSkill(bolt, 14))).toBe(1);
    expect(pierceOf(effectiveSkill(bolt, 15))).toBe(3);
    expect(pierceOf(effectiveSkill(bolt, 20))).toBe(3);
  });

  it("never mutates the def it was handed", () => {
    const before = JSON.stringify(bolt);
    effectiveSkill(bolt, 20);
    expect(JSON.stringify(bolt)).toBe(before);
  });

  it("returns only integers, because a component value that is not one throws", () => {
    for (let l = 1; l <= 20; l++) {
      const s = effectiveSkill(bolt, l);
      expect(Number.isInteger(s.manaCostFixed), `mana at ${l}`).toBe(true);
      const e = s.effects[0]!;
      if (e.type !== "spawnProjectile") throw new Error("wrong effect");
      expect(Number.isInteger(e.damage.amountFixed), `damage at ${l}`).toBe(true);
      expect(Number.isInteger(e.maxRangeFixed), `range at ${l}`).toBe(true);
    }
  });
});

describe("breakpoint queries", () => {
  it("reachedBreakpoints grows as the gem does", () => {
    expect(reachedBreakpoints(bolt, 4)).toHaveLength(0);
    expect(reachedBreakpoints(bolt, 5)).toHaveLength(1);
    expect(reachedBreakpoints(bolt, 15)).toHaveLength(2);
  });

  it("nextBreakpoint is the grey line the tooltip shows, and null once there are none", () => {
    expect(nextBreakpoint(bolt, 1)!.atLevel).toBe(5);
    expect(nextBreakpoint(bolt, 5)!.atLevel).toBe(15);
    expect(nextBreakpoint(bolt, 15)).toBeNull();
    expect(nextBreakpoint(ground, 1)).toBeNull();
  });
});

function pierceOf(def: SkillDef): number | undefined {
  const e = def.effects[0]!;
  return e.type === "spawnProjectile" ? e.pierceCount : undefined;
}
function pierceRange(def: SkillDef): number {
  const e = def.effects[0]!;
  if (e.type !== "spawnProjectile") throw new Error("wrong effect");
  return e.maxRangeFixed;
}
