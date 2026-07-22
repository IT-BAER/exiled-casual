// Pure, deterministic Waystone/Atlas rules. No @pact imports so both the sim and
// the client can compute identical offers from the same seed (replay-stable).

export interface Waystone { id: string; seed: number; tier: number }
export interface AtlasNode { id: string; name: string }

export const WAYSTONE_OFFER_COUNT = 3;

// Fixed node list for this slice. Nodes are named destinations; tier comes from
// the Waystone, not the node. Real per-node tiers/biomes are Phase 5.
const NODES: readonly AtlasNode[] = [
  { id: "node.ashen_glade", name: "Ashen Glade" },
  { id: "node.emberfall", name: "Emberfall" },
  { id: "node.cinder_vault", name: "Cinder Vault" },
];

export function atlasNodes(): AtlasNode[] {
  return NODES.map((n) => ({ ...n }));
}

// Natural area level per docs/01:308.
export function areaLevel(tier: number): number {
  return 64 + tier;
}

// ponytail: linear per-mille scaling is a calibration placeholder (docs/01:780
// says monster-vs-level needs empirical tuning). Two knobs; adjust here only.
export function monsterTierScale(tier: number): { lifeMilli: number; dmgMilli: number } {
  return { lifeMilli: 1000 + 150 * tier, dmgMilli: 1000 + 100 * tier };
}

// Mulberry32 (same family as the sim PRNG, but inlined so this leaf module keeps
// zero @pact deps and cannot form an import cycle with @pact/simulation).
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

export function offerWaystones(atlasSeed: number, count: number): Waystone[] {
  const rnd = mulberry32(atlasSeed);
  const out: Waystone[] = [];
  for (let i = 0; i < count; i++) {
    const seed = rnd();
    const roll = 1 + (rnd() % 15); // 1..15
    // First slot is always Tier 1 so a fresh character has a survivable map to
    // enter (Area Level 65); the rest roll the full range.
    const tier = i === 0 ? 1 : roll;
    out.push({ id: `ws-${i}`, seed, tier });
  }
  return out;
}
