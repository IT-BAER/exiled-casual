// Pure, deterministic Waystone/Atlas rules. No @exiled imports so both the sim and
// the client can compute identical offers from the same seed (replay-stable).

/**
 * A stone the character owns. `id` is POSITIONAL — assigned from the stone's
 * index in the owned list when the snapshot is built, and re-resolved against
 * that same list when the Map Device activates one. A stone has no identity of
 * its own beyond its seed and its tier, and two identical stones are genuinely
 * interchangeable, so an index is the honest key.
 */
export interface Waystone { id: string; seed: number; tier: number }
export interface AtlasNode { id: string; name: string }

/** One line of lore, shown when the place is opened on the Atlas. */
export function atlasNodeFlavour(index: number): string {
  return NODE_FLAVOUR[index] ?? "No one who went in has said what is there.";
}

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
  /**
   * The line of lore the Atlas prints when you open the place. PoE2 puts one
   * under every node's name, and it is the only thing on that panel that is
   * neither a number nor a colour: a place with a rumour attached is somewhere
   * you want to go, a tier number is a chore.
   */
  flavour: string;
}

export const WAYSTONE_OFFER_COUNT = 3;

/**
 * Natural area level per docs/01:308, rescaled for a 1-100 character. Tier 0 is
 * level 2 so a character out of the character-creation screen can run the first
 * node, and the fifteenth is 86 so the last stretch to 100 is a tier the player
 * has chosen to farm rather than one the Atlas hands him.
 */
export function areaLevel(tier: number): number {
  return 2 + 6 * tier;
}

// ponytail: linear per-mille scaling is a calibration placeholder (docs/01:780
// says monster-vs-level needs empirical tuning). Two knobs; adjust here only.
// The per-tier step tracks the six area levels a tier now covers, so a monster
// at the top of the Atlas is about ten times a tier-0 one rather than three.
export function monsterTierScale(tier: number): { lifeMilli: number; dmgMilli: number } {
  return { lifeMilli: 1000 + 650 * tier, dmgMilli: 1000 + 430 * tier };
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
 * The lowest Waystone tier a place will accept, by how far out it sits: hops
 * from the first node, two tiers a hop.
 *
 * PoE2's Atlas gets harder the further from the start you push, and that is what
 * turns a graph into progression rather than a set of doors. It could not exist
 * before Waystones sustained themselves — gating a place behind a tier when the
 * three starting stones were all a character would ever own was a way to
 * hard-lock it. Now a cleared modified stone pays back a tier higher, so the far
 * side of the world is reachable by playing toward it.
 */
export function atlasNodeTier(graph: readonly AtlasGraphNode[], nodeId: string): number {
  const start = graph[0];
  if (!start) return 1;
  // Breadth-first, so "far" means hops along the routes rather than distance on
  // the map — the fog rule walks the same edges.
  const depth = new Map<string, number>([[start.id, 0]]);
  const queue = [start.id];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = graph.find((n) => n.id === id);
    if (!node) continue;
    for (const l of node.links) {
      if (depth.has(l)) continue;
      depth.set(l, depth.get(id)! + 1);
      queue.push(l);
    }
  }
  return Math.min(WAYSTONE_MAX_TIER, 1 + 2 * (depth.get(nodeId) ?? 0));
}

/**
 * The tier of the cheapest place a cleared node opens up: the lowest
 * `atlasNodeTier` among its routes that have not been run yet. Null when every
 * route out is already cleared, or the node is not on the graph.
 *
 * This is what the boss has to pay. A hop out costs two tiers and a plain run
 * hands back the tier you brought, so without it a character who spends his
 * last high stone on a far node is farming the same place until a modified
 * stone happens to roll — the Atlas stops being a route decision and becomes a
 * slot machine for permission to move.
 */
export function nextNodeTier(
  graph: readonly AtlasGraphNode[],
  nodeId: string,
  completedNodes: readonly string[],
): number | null {
  const node = graph.find((n) => n.id === nodeId);
  if (!node) return null;
  const onward = node.links
    .filter((l) => !completedNodes.includes(l))
    .map((l) => atlasNodeTier(graph, l));
  return onward.length === 0 ? null : Math.min(...onward);
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

export const ATLAS_NODE_COUNT = 15;

// Names are fixed per index so a place keeps its name across a content update;
// only its position and its routes come from the seed.
const NODE_NAMES: readonly string[] = [
  "The Wrackline", "Emberfall", "Cinder Vault", "Blackmire", "Sunken Chapel",
  "Ossuary Steps", "Rustwater", "The Pale Reach", "Kiln of Ash", "Thornwake",
  "Gallowsmoor", "Vault of Cinders", "Hollowbriar", "Gullscour", "Bonestrand",
];

/**
 * Map base ids. This module is a pure leaf — no `@exiled` imports — so it may
 * hold only the ids; the DEFINITIONS (biome, tileset, layout grammar) live in
 * `@exiled/content-runtime`, and a test there fails if the two lists disagree.
 */
export const MAP_BASE_IDS = [
  "map.vaal_stone", "map.desert", "map.swamp", "map.forest", "map.coast",
] as const;
export type MapBaseId = (typeof MAP_BASE_IDS)[number];

/**
 * Which base each Atlas node is built from, fixed per index alongside its name
 * and its flavour: what a place is made of is part of the place, not of the
 * seed. Three nodes per base, so no biome is a novelty.
 */
const NODE_MAP_BASES: readonly MapBaseId[] = [
  // Index 0 is where every character starts (atlasNodeTier calls it tier 1), so
  // it is the strand: the first thing anyone sees is open sky over open water.
  "map.coast",       // The Wrackline
  "map.desert",      // Emberfall
  "map.vaal_stone",  // Cinder Vault
  "map.swamp",       // Blackmire
  "map.swamp",       // Sunken Chapel
  "map.vaal_stone",  // Ossuary Steps
  "map.swamp",       // Rustwater
  "map.desert",      // The Pale Reach
  "map.desert",      // Kiln of Ash
  "map.forest",      // Thornwake
  "map.forest",      // Gallowsmoor
  "map.vaal_stone",  // Vault of Cinders
  "map.forest",      // Hollowbriar
  "map.coast",       // Gullscour
  "map.coast",       // Bonestrand
];

/** The base an Atlas node runs, by its index in the fixed name table. */
export function mapBaseIdForIndex(index: number): MapBaseId {
  return NODE_MAP_BASES[index] ?? "map.vaal_stone";
}

/** Node ids are derived from the fixed names, so this resolves without a graph. */
export function atlasNodeIndex(nodeId: string): number {
  return NODE_NAMES.findIndex((n) => nodeIdFor(n) === nodeId);
}

/** The base an Atlas node runs. Unknown nodes fall back to the first base. */
export function mapBaseIdForNode(nodeId: string): MapBaseId {
  const i = atlasNodeIndex(nodeId);
  return i < 0 ? "map.vaal_stone" : mapBaseIdForIndex(i);
}

function nodeIdFor(name: string): string {
  return `node.${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

// Fixed per index alongside the name, for the same reason: the layout is seeded
// per account, the place is not.
const NODE_FLAVOUR: readonly string[] = [
  "The tide brings everything back. Not always in one piece.",
  "The rain fell hot for a week, and the town drank all of it.",
  "They sealed the door from the inside. Ask yourself why.",
  "The mud keeps every step, and gives none of them back.",
  "Its bells still ring, six fathoms under.",
  "Every stair was somebody once. Climb kindly.",
  "Drink here, and the river takes its iron back out of you.",
  "Past the last cairn the cold does the killing for him.",
  "It was raised to fire bricks. It fires other things now.",
  "The hedge grew inward until there was no village left to fence.",
  "Twelve ropes, twelve winters, one patient wind.",
  "What burned here was kept, not buried.",
  "The thorns lean toward the path. They have had time to learn it.",
  "The birds got here first, and left nothing worth the walk.",
  "Count the hulls. Then count the crews.",
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
  const cols = 5, rows = 3;
  const nodes: AtlasGraphNode[] = [];
  for (let i = 0; i < ATLAS_NODE_COUNT; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    // Cell centre, jittered by up to 35% of a cell so nodes never leave 0..1.
    const jx = (frac() - 0.5) * 0.7, jy = (frac() - 0.5) * 0.7;
    const name = NODE_NAMES[i] ?? `Region ${i}`;
    nodes.push({
      id: nodeIdFor(name),
      name,
      x: (col + 0.5 + jx) / cols,
      y: (row + 0.5 + jy) / rows,
      links: [],
      flavour: atlasNodeFlavour(i),
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

/** Waystone tiers run 1..15, as PoE2's do. */
export const WAYSTONE_MAX_TIER = 15;

/**
 * What a cleared map hands back. Sustain is the whole point: without it a
 * character owns exactly the stones it started with, every map is one of three
 * forever, and nothing can be gated behind a tier because running out would
 * hard-lock the character.
 *
 * A plain stone returns one, so a run of them is break-even and a character can
 * farm the same tier indefinitely. A stone that carried modifiers returns two,
 * one of them a tier higher — so the way to climb is to take the risk, which is
 * the same trade PoE's Atlas is built on. Deterministic in the map's own seed.
 */
export function waystoneDrops(
  mapSeed: number,
  runTier: number,
  stoneHadModifiers: boolean,
): Waystone[] {
  const rnd = mulberry32(mapSeed ^ 0xd0b5);
  const clamp = (t: number) => Math.max(1, Math.min(WAYSTONE_MAX_TIER, t));
  const out: Waystone[] = [{ id: "", seed: rnd(), tier: clamp(runTier) }];
  if (stoneHadModifiers) out.push({ id: "", seed: rnd(), tier: clamp(runTier + 1) });
  return out;
}

export function offerWaystones(atlasSeed: number, count: number): Waystone[] {
  const rnd = mulberry32(atlasSeed);
  const out: Waystone[] = [];
  for (let i = 0; i < count; i++) {
    const seed = rnd();
    const roll = 1 + (rnd() % 15); // 1..15
    // First slot is always Tier 1 so a fresh character has a survivable map to
    // enter (Area Level 8); the rest roll the full range.
    const tier = i === 0 ? 1 : roll;
    out.push({ id: `ws-${i}`, seed, tier });
  }
  return out;
}
