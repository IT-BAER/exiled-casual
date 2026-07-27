// Waystone rarity and map modifiers. Pure and seed-derived, like the rest of
// this leaf: the client renders the same offers the sim validates, and a session
// only has to remember the stone's seed to re-derive everything about the run.

export type WaystoneRarity = "normal" | "magic" | "rare";

/**
 * One rolled map modifier. `kind` is PoE's split and it is not cosmetic: a
 * prefix pays you and a suffix charges you, so a rare stone is always both a
 * better run and a harder one, never one without the other.
 */
export interface WaystoneMod {
  id: string;
  kind: "prefix" | "suffix";
  /** Rendered line, with the rolled value already in it. */
  label: string;
  value: number;
}

interface ModDef {
  id: string;
  kind: "prefix" | "suffix";
  min: number;
  max: number;
  /** Line as PoE2 words it, with %d standing in for the roll. */
  text: string;
}

/**
 * Six modifiers, and every one of them changes the run — none is a line that
 * only renders. Two prefixes pay (more monsters to kill, more experience per
 * kill) and four suffixes charge (tougher monsters, monsters that resist what
 * you cast, and the classic PoE penalty that makes your own resistances a
 * problem again). Wordings follow PoE2's map-modifier phrasing.
 */
const MOD_DEFS: readonly ModDef[] = [
  { id: "packSize", kind: "prefix", min: 15, max: 45, text: "%d% increased Monster pack size" },
  { id: "experience", kind: "prefix", min: 10, max: 30, text: "%d% increased Experience gain" },
  // The area channel, and in PoE it is the strong one: the player's own
  // quantity and rarity are the only channel that diminishes, so a map's
  // numbers stay worth their face value however many you stack.
  { id: "quantity", kind: "prefix", min: 20, max: 60, text: "%d% increased Quantity of Items found" },
  { id: "rarity", kind: "prefix", min: 30, max: 90, text: "%d% increased Rarity of Items found" },
  { id: "monsterLife", kind: "suffix", min: 20, max: 60, text: "Monsters have %d% more Life" },
  { id: "monsterDamage", kind: "suffix", min: 15, max: 40, text: "Monsters deal %d% more Damage" },
  { id: "monsterElementalRes", kind: "suffix", min: 15, max: 40, text: "Monsters have %d% increased Elemental Resistances" },
  { id: "playerResPenalty", kind: "suffix", min: 10, max: 30, text: "Players have -%d% to all Elemental Resistances" },
];

/** How many of each affix a rarity carries. PoE's own 0 / 1+1 / 2+2 ladder. */
const AFFIX_COUNT: Record<WaystoneRarity, { prefix: number; suffix: number }> = {
  normal: { prefix: 0, suffix: 0 },
  magic: { prefix: 1, suffix: 1 },
  rare: { prefix: 2, suffix: 2 },
};

// Mulberry32, inlined for the same reason atlas.ts inlines it: this leaf takes
// no @exiled imports, so it cannot form a cycle with the sim.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/**
 * A stone's rarity. Rolled off its own seed, not the tier: in PoE a Waystone's
 * rarity and its tier are independent, which is exactly what makes a low-tier
 * rare worth keeping and a high-tier normal worth running when you are behind.
 */
export function waystoneRarity(waystoneSeed: number): WaystoneRarity {
  // Seed 0 is the "no stone" sentinel a session carries when no map is open (and
  // in the lab, which never opens one), so it must never roll modifiers onto a
  // run nobody paid for. A real offer landing on exactly 0 is a 1-in-2^32 coin
  // that costs its owner one plain map.
  if (waystoneSeed === 0) return "normal";
  const roll = mulberry32(waystoneSeed ^ 0x5ba1)() % 100;
  if (roll < 45) return "normal";
  if (roll < 85) return "magic";
  return "rare";
}

/**
 * The stone's rolled modifiers, in a fixed order (prefixes then suffixes) so
 * two runs of the same stone read identically. Values are integers.
 */
export function waystoneMods(waystoneSeed: number): WaystoneMod[] {
  const rarity = waystoneRarity(waystoneSeed);
  const want = AFFIX_COUNT[rarity];
  const rnd = mulberry32(waystoneSeed ^ 0x0f17);
  const out: WaystoneMod[] = [];

  for (const kind of ["prefix", "suffix"] as const) {
    const pool = MOD_DEFS.filter((d) => d.kind === kind);
    // Draw without replacement: a stone never rolls the same modifier twice.
    const remaining = [...pool];
    for (let i = 0; i < want[kind] && remaining.length > 0; i++) {
      const def = remaining.splice(rnd() % remaining.length, 1)[0]!;
      const span = def.max - def.min + 1;
      const value = def.min + (rnd() % span);
      out.push({ id: def.id, kind: def.kind, value, label: def.text.replace("%d", String(value)) });
    }
  }
  return out;
}

/** Everything the sim needs from a stone's modifiers, folded into one block. */
export interface WaystoneScale {
  /** Extra monster life and damage, per-mille on top of the tier's own scaling. */
  lifeMilli: number;
  dmgMilli: number;
  /** Flat percent added to every monster's elemental resistances. */
  monsterResAdd: number;
  /** Flat percent taken off the player's elemental resistances inside the map. */
  playerResPenalty: number;
  /** Extra monsters, integer percent. */
  packSizePct: number;
  /** Extra experience per kill, integer percent. */
  experiencePct: number;
  /** The area quantity and rarity channels, integer percent. Linear, never diminished. */
  quantityPct: number;
  rarityPct: number;
}

export function waystoneScale(mods: readonly WaystoneMod[]): WaystoneScale {
  const s: WaystoneScale = {
    lifeMilli: 1000, dmgMilli: 1000,
    monsterResAdd: 0, playerResPenalty: 0, packSizePct: 0, experiencePct: 0,
    quantityPct: 0, rarityPct: 0,
  };
  for (const m of mods) {
    switch (m.id) {
      case "monsterLife": s.lifeMilli += m.value * 10; break;
      case "monsterDamage": s.dmgMilli += m.value * 10; break;
      case "monsterElementalRes": s.monsterResAdd += m.value; break;
      case "playerResPenalty": s.playerResPenalty += m.value; break;
      case "packSize": s.packSizePct += m.value; break;
      case "experience": s.experiencePct += m.value; break;
      case "quantity": s.quantityPct += m.value; break;
      case "rarity": s.rarityPct += m.value; break;
    }
  }
  return s;
}

/** The scale a run actually uses: the stone's modifiers, read from its seed. */
export function waystoneScaleFor(waystoneSeed: number): WaystoneScale {
  return waystoneScale(waystoneMods(waystoneSeed));
}
