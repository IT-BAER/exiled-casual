// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { COSMETIC_SLOTS, looksForEquipment, meshLook } from "../render/rig";
import { WEARABLE_BASES, basesForSlot, orphanLooks } from "./bases";

/** Every `slot.look.part` name the wardrobe actually ships. */
const PART_NAMES = (() => {
  const glb = readFileSync(
    fileURLToPath(new URL("../../public/models/wardrobe.glb", import.meta.url)),
  );
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8")) as {
    meshes?: { name?: string }[];
    nodes?: { name?: string }[];
  };
  return [...(json.meshes ?? []), ...(json.nodes ?? [])]
    .map((n) => n.name ?? "")
    .filter((n) => n.length > 0);
})();

describe("wearable bases", () => {
  it("covers every armour and weapon slot the character has", () => {
    // Nothing carries a belt look yet, and a slot with no base would be a row
    // the panel could never fill — worth knowing which, not worth failing on.
    const covered = new Set(WEARABLE_BASES.map((b) => b.slot));
    for (const slot of ["weapon1", "weapon2", "helmet", "body", "gloves", "boots"] as const) {
      expect(covered.has(slot), `no base for ${slot}`).toBe(true);
    }
  });

  it("includes the three class starter bodies, which are out of the drop pool", () => {
    const body = basesForSlot("body").map((b) => b.id);
    expect(body).toContain("base.ironsworn_plate");
    expect(body).toContain("base.stalker_leathers");
    expect(body).toContain("base.emberbound_robe");
  });

  it("names every base, so the panel is not a wall of ids", () => {
    for (const b of WEARABLE_BASES) {
      expect(b.name.length).toBeGreaterThan(0);
      expect(b.name).not.toContain("base.");
    }
  });

  it("puts each base in exactly one slot's list", () => {
    const counted = COSMETIC_SLOTS.flatMap((s) => basesForSlot(s)).map((b) => b.id);
    expect(counted.length).toBe(WEARABLE_BASES.length);
    expect(new Set(counted).size).toBe(counted.length);
  });

  /**
   * The point of listing bases rather than looks: equipping one must resolve to
   * geometry that exists, or the viewer shows an invisible man and the art it was
   * built to judge is the art it cannot draw.
   */
  it("every base resolves to geometry the wardrobe ships", () => {
    for (const b of WEARABLE_BASES) {
      const looks = looksForEquipment({ [b.slot]: { baseId: b.id } });
      const look = looks[b.slot];
      // `belt` resolves to nothing on purpose: KayKit paints every outfit's belt
      // into its torso, so the slot has no mesh of its own to show.
      if (b.slot === "belt") {
        expect(look, `${b.id} should be the beltless slot`).toBeNull();
        continue;
      }
      expect(look, `${b.id} resolved to nothing`).not.toBeNull();
      const wanted = `${b.slot}.${meshLook(look!)}.`;
      expect(
        PART_NAMES.some((n) => n.startsWith(wanted)),
        `${b.id} -> ${look!} has no ${wanted}* in the wardrobe`,
      ).toBe(true);
    }
  });

  it("drops a look an item base already covers", () => {
    // `knight` is Ironsworn Plate. Listing both offers the same armour twice
    // under two names that render differently.
    expect(orphanLooks("body", ["knight", "barbarian"])).toEqual(["barbarian"]);
  });

  it("keeps a look no base points at", () => {
    expect(orphanLooks("body", ["barbarian"])).toContain("barbarian");
  });

  it("sends a base to its own outfit, not to a re-tint of one", () => {
    // The base used to pick a palette baked onto a single shared coat. It now
    // picks which of the six KayKit outfits is worn, so the resolved look IS
    // the difference between an Ironsworn and a Stalker.
    expect(looksForEquipment({ body: { baseId: "base.ironsworn_plate" } }).body).toBe("knight");
    expect(looksForEquipment({ body: { baseId: "base.stalker_leathers" } }).body).toBe("rogue");
  });
});
