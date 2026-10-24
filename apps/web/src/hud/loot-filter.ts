import type { SnapshotEntity } from "@exiled/protocol";
import { RARITY } from "./ItemTooltip";

/**
 * A ground plate's look, taken from NeverSink's 2-SEMI-STRICT PoE1 filter
 * (FilterBlade export `EC.filter`, 8.20.2). `tier` names the filter block it came
 * from. A null border is NeverSink leaving the border unset, which PoE draws as none.
 */
export interface PlateStyle {
  tier: string;
  text: string;
  border: string | null;
  bg: string;
  fontPx: number;
}

/**
 * NeverSink's alphas assume PoE's dark floors (a rare's plate is 39% grey); over
 * the Strand's sand that leaves yellow text on nothing, so no plate goes thinner.
 */
export const MIN_PLATE_ALPHA = 0.78;

/** A filter colour, its alpha out of 255 as the filter writes it. */
function rgb(r: number, g: number, b: number, a = 255): string {
  if (a >= 255) return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(MIN_PLATE_ALPHA, Math.round((a / 255) * 100) / 100)})`;
}

/** PoE's font sizes run 18-45 (32 when unset); 40 is the 16px plate this HUD was laid out at. */
const px = (size: number) => Math.round(size * 0.4);

/** What PoE draws where a block sets nothing: currency's own beige, on black at 240. */
const CURRENCY_TEXT = rgb(170, 158, 130);
const DEFAULT_BG = rgb(0, 0, 0, 240);
const DARK = rgb(20, 20, 0);
const BLACK = rgb(0, 0, 0);

/** Filled when the orb is worth stopping for; the levelling scrolls and shards stay dark. */
const LOW_ORB: Omit<PlateStyle, "tier"> = { text: rgb(190, 178, 135), border: rgb(190, 178, 135), bg: DARK, fontPx: px(45) };
const filled = (bg: string): Omit<PlateStyle, "tier"> => ({ text: BLACK, border: BLACK, bg, fontPx: px(45) });

/** By base. This game's own orbs take the tier of the PoE1 orb they act like. */
const CURRENCY: Record<string, PlateStyle> = {
  "currency.wisdom": { tier: "currency->leveling wisdom", text: CURRENCY_TEXT, border: rgb(100, 50, 30), bg: DARK, fontPx: px(45) },
  "currency.portal": { tier: "currency->leveling portal", text: CURRENCY_TEXT, border: rgb(30, 50, 100), bg: DARK, fontPx: px(45) },
  "currency.transmutation": { tier: "currency->leveling t3trans", ...LOW_ORB },
  "currency.augmentation": { tier: "currency->leveling t5aug", ...LOW_ORB },
  "currency.alchemy": { tier: "currency t5alchemy", ...filled(rgb(213, 159, 0)) },
  // A Regal: magic to rare, plus a mod.
  "currency.elevation": { tier: "currency t6chrom", ...filled(rgb(210, 178, 135)) },
  // An Exalted: a mod onto a rare.
  "currency.embers": { tier: "currency t3annul", ...filled(rgb(240, 90, 35)) },
};

/** NeverSink's map bands, which set no border. */
function waystone(tier: number): PlateStyle {
  const band = tier >= 14 ? "a" : tier >= 11 ? "b" : tier >= 6 ? "c" : "d";
  const light = band === "a" ? rgb(235, 235, 235) : band === "b" ? rgb(200, 200, 200) : null;
  return {
    tier: `maps maps_${band}`,
    text: light ? BLACK : rgb(255, 255, 255),
    border: null,
    bg: light ?? DARK,
    fontPx: px(45),
  };
}

export function plateStyle(e: SnapshotEntity): PlateStyle {
  if (e.kind === "gold") {
    return e.jackpot
      ? { tier: "gold stack3", text: rgb(235, 200, 110), border: rgb(235, 200, 110), bg: DARK, fontPx: px(45) }
      : { tier: "gold anyother", text: rgb(180, 180, 180), border: BLACK, bg: rgb(20, 20, 0, 180), fontPx: px(35) };
  }
  const currency = CURRENCY[e.baseId ?? ""];
  if (currency) return currency;
  if (e.itemClass === "waystone") return waystone(e.waystoneTier ?? 1);
  switch (e.rarity) {
    case "unique":
      return { tier: "uniques t2", text: rgb(255, 255, 255), border: rgb(255, 255, 255), bg: rgb(175, 96, 37), fontPx: px(45) };
    case "rare":
      return e.itemClass === "wand"
        ? { tier: "leveling->rare->caster general", text: RARITY.rare.text, border: rgb(50, 50, 150), bg: rgb(43, 43, 100, 210), fontPx: px(40) }
        : { tier: "leveling->rare->remaining", text: RARITY.rare.text, border: null, bg: rgb(80, 80, 80, 100), fontPx: px(40) };
    case "magic":
      return { tier: "leveling->magic->remaining", text: RARITY.magic.text, border: null, bg: DEFAULT_BG, fontPx: px(35) };
    default:
      return { tier: "default", text: RARITY.normal.text, border: null, bg: DEFAULT_BG, fontPx: px(32) };
  }
}
