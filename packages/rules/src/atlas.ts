// Pure, deterministic Waystone/Atlas rules. No @exiled imports so both the sim and
// the client can compute identical offers from the same seed (replay-stable).

export interface Waystone { id: string; seed: number; tier: number }
export interface AtlasNode { id: string; name: string }

/**
 * A node on the Atlas graph: a *place*, with a position on the world map and the
 * routes leading out of it. PoE2's Atlas is generated per account, so this one is
 * too — the seed is the character's `atlasSeed`. What it deliberately does NOT
 * carry is difficulty: the Waystone brings the tier, the node brings the layout,
 * which is why running the same place twice gives the same rooms at whatever tier
 * you can afford (atlas-maps.webp: a node is a location, its icon is its content).
 */
export interface AtlasGraphNode extends AtlasNode {
  /** Position on the world map, 0..1 on both axes. */
  x: number;
  y: number;
  /** Ids of the nodes a route runs to. Always symmetric. */
  links: string[];
}

export const WAYSTONE_OFFER_COUNT = 3;

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
// zero @exiled deps and cannot form an import cycle with @exiled/simulation).
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
 * The fog rule: you may run the first node, or any place a route leads to from
 * one you have already cleared. PoE2 reveals the Atlas the same way, one hop at a
 * time from what you finished, which is what turns a node list into a route
 * decision — the neighbours you open are the ones you can reach next.
 */
export function isNodeReachable(
  graph: readonly AtlasGraphNode[],
  completedNodes: readonly string[],
  nodeId: string,
): boolean {
  const node = graph.find((n) => n.id === nodeId);
  if (!node) return false;
  if (node.id === graph[0]?.id) return true;
  return node.links.some((l) => completedNodes.includes(l));
}

/**
 * The seed a run draws its map from. Both halves matter: the Waystone, so two
 * stones are two different runs, and the place, so the same stone taken to two
 * nodes is not the same dungeon twice. FNV-1a, inlined to keep this leaf free of
 * `@exiled` imports (same reason as the PRNG below).
 */
export function mapSeedFor(waystoneSeed: number, atlasNodeId: string): number {
  const input = `${waystoneSeed}:${atlasNodeId}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const ATLAS_NODE_COUNT = 12;

// Names are fixed per index so a place keeps its name across a content update;
// only its position and its routes come from the seed.
const NODE_NAMES: readonly string[] = [
  "Ashen Glade", "Emberfall", "Cinder Vault", "Blackmire", "Sunken Chapel",
  "Ossuary Steps", "Rustwater", "The Pale Reach", "Kiln of Ash", "Thornwake",
  "Gallowsmoor", "Vault of Cinders",
];

/**
 * The world map. Nodes land on a jittered 4x3 grid — a grid alone reads as a
 * spreadsheet and pure random clumps, and the reference's world is loose but
 * evenly covered. Routes are a minimum spanning tree (every place reachable,
 * which the fog rule depends on) plus every remaining short pair, so the graph
 * has loops and a choice of route rather than one forced chain.
 */
export function atlasGraph(atlasSeed: number): AtlasGraphNode[] {
  const rnd = mulberry32(atlasSeed >>> 0);
  const frac = () => rnd() / 0x100000000;
  const cols = 4, rows = 3;
  const nodes: AtlasGraphNode[] = [];
  for (let i = 0; i < ATLAS_NODE_COUNT; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    // Cell centre, jittered by up to 35% of a cell so nodes never leave 0..1.
    const jx = (frac() - 0.5) * 0.7, jy = (frac() - 0.5) * 0.7;
    const name = NODE_NAMES[i] ?? `Region ${i}`;
    nodes.push({
      id: `node.${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      name,
      x: (col + 0.5 + jx) / cols,
      y: (row + 0.5 + jy) / rows,
      links: [],
    });
  }

  const dist = (a: AtlasGraphNode, b: AtlasGraphNode) => Math.hypot(a.x - b.x, a.y - b.y);
  const link = (a: AtlasGraphNode, b: AtlasGraphNode) => {
    if (a.links.includes(b.id)) return;
    a.links.push(b.id);
    b.links.push(a.id);
  };

  // Prim from node 0: repeatedly join the nearest unconnected node to the tree.
  const inTree = [nodes[0]!];
  const rest = nodes.slice(1);
  while (rest.length > 0) {
    let bi = 0, bj = 0, best = Infinity;
    for (let i = 0; i < inTree.length; i++) {
      for (let j = 0; j < rest.length; j++) {
        const d = dist(inTree[i]!, rest[j]!);
        if (d < best) { best = d; bi = i; bj = j; }
      }
    }
    link(inTree[bi]!, rest[bj]!);
    inTree.push(rest.splice(bj, 1)[0]!);
  }

  // Loops: any remaining pair inside a cell's width of each other.
  const near = 1 / cols;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (dist(nodes[i]!, nodes[j]!) <= near) link(nodes[i]!, nodes[j]!);
    }
  }
  return nodes;
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
