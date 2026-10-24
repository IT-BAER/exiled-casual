import { describe, it, expect } from "vitest";
import type { SnapshotEntity } from "@exiled/protocol";
import { MIN_PLATE_ALPHA, plateStyle } from "./loot-filter";
import { RARITY } from "./ItemTooltip";

const item = (over: Partial<SnapshotEntity>): SnapshotEntity =>
  ({ id: 1, kind: "groundItem", x: 0, y: 0, rarity: "normal", name: "Thing", ...over }) as SnapshotEntity;
const currency = (baseId: string) => item({ itemClass: "currency", baseId });
const alphaOf = (css: string) => Number(css.match(/rgba?\([^)]*?,\s*([\d.]+)\)$/)?.[1] ?? 1);

/**
 * NeverSink's 2-SEMI-STRICT (EC.filter, 8.20.2) per drop this game has, by the
 * block each one falls into; the game's own orbs take the tier of the PoE1 orb
 * they act like (Elevation is a Regal, Embers an Exalted).
 */
describe("the loot filter", () => {
  it.each([
    ["currency.wisdom", "currency->leveling wisdom", "rgb(170, 158, 130)", "rgb(100, 50, 30)", "rgb(20, 20, 0)"],
    ["currency.portal", "currency->leveling portal", "rgb(170, 158, 130)", "rgb(30, 50, 100)", "rgb(20, 20, 0)"],
    ["currency.transmutation", "currency->leveling t3trans", "rgb(190, 178, 135)", "rgb(190, 178, 135)", "rgb(20, 20, 0)"],
    ["currency.augmentation", "currency->leveling t5aug", "rgb(190, 178, 135)", "rgb(190, 178, 135)", "rgb(20, 20, 0)"],
    ["currency.alchemy", "currency t5alchemy", "rgb(0, 0, 0)", "rgb(0, 0, 0)", "rgb(213, 159, 0)"],
    ["currency.elevation", "currency t6chrom", "rgb(0, 0, 0)", "rgb(0, 0, 0)", "rgb(210, 178, 135)"],
    ["currency.embers", "currency t3annul", "rgb(0, 0, 0)", "rgb(0, 0, 0)", "rgb(240, 90, 35)"],
  ])("styles %s as %s", (baseId, tier, text, border, bg) => {
    expect(plateStyle(currency(baseId))).toEqual({ tier, text, border, bg, fontPx: 18 });
  });

  it("ranks the rarer orbs louder: a filled plate, never the dark one the scrolls wear", () => {
    const filled = (id: string) => plateStyle(currency(id)).bg !== "rgb(20, 20, 0)";
    expect(["currency.alchemy", "currency.elevation", "currency.embers"].every(filled)).toBe(true);
    expect(["currency.wisdom", "currency.portal", "currency.transmutation", "currency.augmentation"].some(filled)).toBe(false);
  });

  it.each([
    [1, "maps maps_d", "rgb(255, 255, 255)", "rgb(20, 20, 0)"],
    [5, "maps maps_d", "rgb(255, 255, 255)", "rgb(20, 20, 0)"],
    [6, "maps maps_c", "rgb(255, 255, 255)", "rgb(20, 20, 0)"],
    [10, "maps maps_c", "rgb(255, 255, 255)", "rgb(20, 20, 0)"],
    [11, "maps maps_b", "rgb(0, 0, 0)", "rgb(200, 200, 200)"],
    [13, "maps maps_b", "rgb(0, 0, 0)", "rgb(200, 200, 200)"],
    [14, "maps maps_a", "rgb(0, 0, 0)", "rgb(235, 235, 235)"],
    [16, "maps maps_a", "rgb(0, 0, 0)", "rgb(235, 235, 235)"],
  ])("styles a tier %i waystone as %s", (waystoneTier, tier, text, bg) => {
    expect(plateStyle(item({ itemClass: "waystone", waystoneTier, rarity: "magic" })))
      .toEqual({ tier, text, border: null, bg, fontPx: 18 });
  });

  it("plates a unique on NeverSink's brown fill", () => {
    expect(plateStyle(item({ rarity: "unique", itemClass: "ring" }))).toEqual({
      tier: "uniques t2", text: "rgb(255, 255, 255)", border: "rgb(255, 255, 255)", bg: "rgb(175, 96, 37)", fontPx: 18,
    });
  });

  it("frames a rare wand as a caster rare and leaves other rares unframed", () => {
    expect(plateStyle(item({ rarity: "rare", itemClass: "wand" }))).toMatchObject({
      tier: "leveling->rare->caster general", text: RARITY.rare.text, border: "rgb(50, 50, 150)", fontPx: 16,
    });
    expect(plateStyle(item({ rarity: "rare", itemClass: "boots" }))).toMatchObject({
      tier: "leveling->rare->remaining", text: RARITY.rare.text, border: null, fontPx: 16,
    });
  });

  it("keeps magic and normal gear quieter than anything above them", () => {
    const magic = plateStyle(item({ rarity: "magic", itemClass: "helmet" }));
    const normal = plateStyle(item({ rarity: "normal", itemClass: "helmet" }));
    expect(magic).toMatchObject({ tier: "leveling->magic->remaining", text: RARITY.magic.text, border: null, fontPx: 14 });
    expect(normal).toMatchObject({ tier: "default", text: RARITY.normal.text, border: null, fontPx: 13 });
    const rare = plateStyle(item({ rarity: "rare", itemClass: "helmet" }));
    expect(magic.fontPx).toBeLessThan(rare.fontPx);
  });

  it("styles a gold pile by NeverSink's smallest and largest stack tiers", () => {
    const pile = (jackpot: boolean) => plateStyle({ id: 1, kind: "gold", x: 0, y: 0, amount: 9, jackpot } as SnapshotEntity);
    expect(pile(true)).toEqual({
      tier: "gold stack3", text: "rgb(235, 200, 110)", border: "rgb(235, 200, 110)", bg: "rgb(20, 20, 0)", fontPx: 18,
    });
    expect(pile(false)).toMatchObject({ tier: "gold anyother", text: "rgb(180, 180, 180)", fontPx: 14 });
  });

  // NeverSink's alphas assume PoE's dark floors; the Strand's sand needs an opaque plate.
  it("never lets a plate go thinner than the floor every biome can read it over", () => {
    const all = [
      plateStyle({ id: 1, kind: "gold", x: 0, y: 0, amount: 9, jackpot: false } as SnapshotEntity),
      plateStyle(item({ rarity: "rare", itemClass: "boots" })),
      plateStyle(item({ rarity: "rare", itemClass: "wand" })),
      plateStyle(item({ rarity: "magic", itemClass: "boots" })),
      plateStyle(item({ rarity: "normal", itemClass: "boots" })),
    ];
    for (const s of all) expect(alphaOf(s.bg), s.tier).toBeGreaterThanOrEqual(MIN_PLATE_ALPHA);
  });
});
