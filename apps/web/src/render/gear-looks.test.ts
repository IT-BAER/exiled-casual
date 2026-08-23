import { describe, it, expect } from "vitest";
import { GEAR_LOOKS, looksForEquipment } from "./gear-looks";
import { BASE_LOOKS, SLOTS } from "./rig";

describe("dressing the character from what he has equipped", () => {
  it("leaves every gear slot empty when nothing is equipped", () => {
    expect(looksForEquipment({})).toEqual(BASE_LOOKS);
  });

  it("shows the wand, the buckler and the helm the sim says he is wearing", () => {
    const looks = looksForEquipment({
      weapon1: { baseId: "base.emberwand" },
      weapon2: { baseId: "base.ember_buckler" },
      helmet: { baseId: "base.cinder_cap" },
    });
    expect(looks.weapon1).toBe("emberwand");
    expect(looks.weapon2).toBe("buckler");
    expect(looks.helmet).toBe("iron");
    expect(looks.base).toBe("male");
  });

  /**
   * Most bases have no mesh yet. An unmapped one has to leave its slot empty
   * rather than fall back to some other piece: a tower shield that renders as a
   * buckler is a lie about what dropped, and docs/09 is built on the drop being
   * legible.
   */
  it("shows nothing for a base with no mesh, rather than the wrong one", () => {
    const looks = looksForEquipment({
      body: { baseId: "base.stalker_leathers" },
      weapon2: { baseId: "base.ashwall_tower_shield" },
    });
    expect(looks.weapon2).toBeNull();
    expect(looks).toEqual({ ...BASE_LOOKS });
  });

  it("ignores an equipped item the sim sent with no base id at all", () => {
    expect(looksForEquipment({ helmet: {} })).toEqual(BASE_LOOKS);
  });

  it("only ever names slots the wardrobe actually has", () => {
    for (const entry of Object.values(GEAR_LOOKS)) {
      expect(SLOTS).toContain(entry.slot);
    }
  });
});
