import { CLASS_IDS } from "./classes";
import { MAX_LEVEL, START_LEVEL } from "./xp";
import type { ItemStatMod } from "./stats";

/**
 * The passive tree: one shared web, three doors into it.
 *
 * PoE1's tree and PoE2's are the same idea and differ in shape — PoE1 puts seven
 * class starts on the rim of one enormous wheel, PoE2 hangs its own off a
 * smaller core — and the thing both are actually FOR is the same: the levels a
 * character earns are spent on a map, not on a list, and the map is what makes
 * two characters of one class different. `reference-screenshots/skill-tree.png`
 * and `skill-tree-closeup.jpg` are what this is drawn from: small round nodes in
 * clusters, a bigger notable at the middle of each cluster, a rare diamond
 * keystone at the end of a long run, and one bright allocated path through it.
 *
 * It is GENERATED from the tables below rather than authored node by node,
 * because 200 hand-placed dots is 200 chances for a link to go somewhere there
 * is no node. What is authored is the part that carries the design: which
 * disciplines exist, what each cluster is about, and what the keystones cost.
 * The geometry is a rule — clusters out along a spoke, minors round their
 * notable — so it cannot produce a node that nothing reaches.
 *
 * Every effect is an `ItemStatMod`, the same currency gear speaks, so a passive
 * and a chest piece are folded by the same `applyItemMods` and can never drift
 * apart. That is also why there is no keystone here that changes a RULE: this
 * sim has no hook for "you cannot be stunned", and a keystone whose text lies is
 * worse than one that trades numbers honestly.
 */

export type PassiveKind = "start" | "minor" | "notable" | "keystone";

export interface PassiveNode {
  id: string;
  name: string;
  kind: PassiveKind;
  /** Tree-space position. The client scales these; nothing in the sim reads them. */
  x: number;
  y: number;
  /** What allocating it grants. Empty on a class start, which is only a door. */
  mods: readonly ItemStatMod[];
  /** Neighbours, symmetric: if a is in b's list, b is in a's. */
  links: readonly string[];
}

/** One line of a node's tooltip, already worded. */
export interface PassiveLine {
  text: string;
}

// ---------------------------------------------------------------------------
// What a cluster can be about
// ---------------------------------------------------------------------------

interface Theme {
  /** Cluster label, used to name the notable. */
  title: string;
  /** What each small node in the cluster grants. */
  minor: readonly ItemStatMod[];
  /** What the notable at its middle grants, on top of nothing — it is not a sum. */
  notable: readonly ItemStatMod[];
}

/**
 * The minor values are deliberately small enough that one is never a decision
 * and six of them are: a cluster is the unit of choice, which is the shape both
 * PoE trees have and the reason a tree beats a list of upgrades.
 */
const THEMES = {
  life: {
    title: "Vitality",
    minor: [{ stat: "maxLife", value: 8 }],
    notable: [{ stat: "maxLife", value: 25 }],
  },
  brawn: {
    title: "Brawn",
    // Strength is Life at two per point (stats.ts), so this is the same stat
    // wearing the attribute's name — which is exactly what it is in PoE2.
    minor: [{ stat: "strength", value: 5 }],
    notable: [{ stat: "strength", value: 14 }, { stat: "armour", value: 20 }],
  },
  mana: {
    title: "Wellspring",
    minor: [{ stat: "maxMana", value: 6 }],
    notable: [{ stat: "maxMana", value: 18 }, { stat: "manaRegenPct", value: 12 }],
  },
  spell: {
    title: "Kindling",
    minor: [{ stat: "spellDamagePct", value: 6 }],
    notable: [{ stat: "spellDamagePct", value: 16 }],
  },
  cast: {
    title: "Quickening",
    minor: [{ stat: "castSpeedPct", value: 3 }],
    notable: [{ stat: "castSpeedPct", value: 8 }, { stat: "manaRegenPct", value: 8 }],
  },
  crit: {
    title: "Precision",
    minor: [{ stat: "critChancePct", value: 8 }],
    notable: [{ stat: "critChancePct", value: 22 }],
  },
  armour: {
    title: "Ironhide",
    minor: [{ stat: "armour", value: 14 }],
    notable: [{ stat: "armourPct", value: 20 }, { stat: "armour", value: 25 }],
  },
  ward: {
    title: "Ward",
    minor: [{ stat: "energyShield", value: 9 }],
    notable: [{ stat: "energyShieldPct", value: 18 }, { stat: "energyShield", value: 14 }],
  },
  fireRes: {
    title: "Cinder-Proof",
    minor: [{ stat: "fireResPct", value: 6 }],
    notable: [{ stat: "fireResPct", value: 15 }, { stat: "coldResPct", value: 8 }],
  },
  coldRes: {
    title: "Thaw",
    minor: [{ stat: "coldResPct", value: 6 }],
    notable: [{ stat: "coldResPct", value: 15 }, { stat: "lightningResPct", value: 8 }],
  },
  lightRes: {
    title: "Earthing",
    minor: [{ stat: "lightningResPct", value: 6 }],
    notable: [{ stat: "lightningResPct", value: 15 }, { stat: "fireResPct", value: 8 }],
  },
  chaosRes: {
    title: "Untainted",
    minor: [{ stat: "chaosResPct", value: 5 }],
    notable: [{ stat: "chaosResPct", value: 14 }, { stat: "maxLife", value: 12 }],
  },
  /**
   * The bridges between one discipline and the next. PoE calls these travel
   * nodes and pays almost nothing for them, which is the point: what they buy is
   * the ROUTE, and a route that costs points is what stops a tree being eight
   * separate ladders.
   */
  travel: {
    title: "Waypoint",
    minor: [{ stat: "maxLife", value: 4 }],
    notable: [{ stat: "maxLife", value: 4 }],
  },
} as const satisfies Record<string, Theme>;

type ThemeId = keyof typeof THEMES;

// ---------------------------------------------------------------------------
// The web's shape
// ---------------------------------------------------------------------------

/**
 * Eight disciplines round the core, each four clusters deep. A spoke is a
 * DIRECTION rather than a class's property: any character can walk any of them,
 * and what a class decides is only where the walk starts — which is PoE1's rule
 * and the reason two Rangers can end up nothing alike.
 *
 * The themes run defensive-first on purpose. The nearest cluster on every spoke
 * is something a level-65 character can use immediately, and the specialised
 * ones are two clusters out, so the first ten points are never wasted.
 */
const SPOKES: readonly { name: string; themes: readonly [ThemeId, ThemeId, ThemeId, ThemeId] }[] = [
  { name: "Ember",   themes: ["life", "spell", "fireRes", "spell"] },
  { name: "Ash",     themes: ["mana", "cast", "spell", "cast"] },
  { name: "Cinder",  themes: ["crit", "spell", "crit", "cast"] },
  { name: "Stone",   themes: ["armour", "brawn", "armour", "life"] },
  { name: "Bulwark", themes: ["life", "armour", "chaosRes", "brawn"] },
  { name: "Veil",    themes: ["ward", "mana", "ward", "coldRes"] },
  { name: "Storm",   themes: ["lightRes", "cast", "crit", "ward"] },
  { name: "Hearth",  themes: ["life", "fireRes", "mana", "coldRes"] },
];

/** How far out each ring of clusters sits, and how many minors it carries. */
const RING_RADIUS = [230, 360, 500, 650] as const;
const RING_MINORS = [4, 5, 6, 6] as const;
/** How far a minor sits from the notable it belongs to. */
const CLUSTER_SPREAD = 46;
/** Where the three class doors stand. */
const START_RADIUS = 96;

/**
 * The keystones, one at the far end of a spoke and each a TRADE.
 *
 * A keystone that is only a bigger notable is a notable, so every one of these
 * gives up something the character was already relying on. They are also the one
 * place the tree can be wrong for a build rather than merely unhelpful, which is
 * what makes reaching one feel like a decision instead of a reward.
 */
const KEYSTONES: readonly { spoke: string; name: string; mods: readonly ItemStatMod[] }[] = [
  {
    spoke: "Cinder", name: "Ashen Heart",
    mods: [{ stat: "spellDamagePct", value: 45 }, { stat: "maxLife", value: -60 }],
  },
  {
    spoke: "Bulwark", name: "Rooted",
    mods: [{ stat: "armourPct", value: 60 }, { stat: "maxLife", value: 40 }, { stat: "castSpeedPct", value: -20 }],
  },
  {
    spoke: "Veil", name: "Glass Ward",
    mods: [{ stat: "energyShieldPct", value: 80 }, { stat: "maxLife", value: -45 }],
  },
  {
    spoke: "Storm", name: "Live Wire",
    mods: [{ stat: "castSpeedPct", value: 25 }, { stat: "critChancePct", value: 40 }, { stat: "armourPct", value: -50 }],
  },
];

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const RAD = Math.PI / 180;
const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * A stable nudge in [-amount, +amount], hashed off a string.
 *
 * Eight identical spokes of identical rosettes drew a snowflake, and a snowflake
 * reads as a diagram of a tree rather than as one — the reference's web is
 * irregular everywhere (`skill-tree.png`). This is the irregularity, and it is
 * hashed rather than random so the tree is the same shape in the client, in the
 * sim and in a test.
 */
function wobble(key: string, amount: number): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (((h >>> 0) % 2001) / 1000 - 1) * amount;
}

function build(): PassiveNode[] {
  const nodes = new Map<string, PassiveNode & { links: string[] }>();
  const add = (n: PassiveNode & { links: string[] }) => { nodes.set(n.id, n); return n.id; };
  /** Symmetric by construction: nothing else in this file touches `links`. */
  const link = (a: string, b: string) => {
    const na = nodes.get(a);
    const nb = nodes.get(b);
    if (!na || !nb || a === b) return;
    if (!na.links.includes(b)) na.links.push(b);
    if (!nb.links.includes(a)) nb.links.push(a);
  };
  /**
   * The cluster member nearest a point. Every link that leaves a cluster attaches
   * HERE rather than at a fixed index: an entry chosen by index sat wherever the
   * rosette's rotation left it, and a quarter of the tree's lines cut straight
   * through nodes they did not name — which the eye reads as connections that do
   * not exist. The nearest member faces the far end by construction, so the line
   * clears its own rosette.
   */
  const nearest = (ids: readonly string[], x: number, y: number): string => {
    let best = ids[0]!;
    let bestD = Infinity;
    for (const id of ids) {
      const n = nodes.get(id)!;
      const d = (n.x - x) ** 2 + (n.y - y) ** 2;
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  };

  // The three doors, evenly spaced and each named for the class that starts there.
  const startIds: string[] = [];
  CLASS_IDS.forEach((classId, i) => {
    const angle = 90 + (360 / CLASS_IDS.length) * i;
    startIds.push(add({
      id: startNodeId(classId),
      name: "Origin",
      kind: "start",
      x: round1(Math.cos(angle * RAD) * START_RADIUS),
      y: round1(Math.sin(angle * RAD) * START_RADIUS),
      mods: [],
      links: [],
    }));
  });

  // One column of clusters per spoke, running outward.
  /** Each cluster's minors and centre, so every outgoing link can pick `nearest`. */
  const clusterAt = new Map<string, { minors: string[]; x: number; y: number }>();
  const lastOfSpoke = new Map<string, string>();
  SPOKES.forEach((spoke, si) => {
    const angle = (360 / SPOKES.length) * si + wobble(`${spoke.name}:spoke`, 5);
    spoke.themes.forEach((themeId, ri) => {
      const theme = THEMES[themeId];
      const radius = RING_RADIUS[ri]! + wobble(`${spoke.name}:${ri}:r`, 26);
      const lean = angle + wobble(`${spoke.name}:${ri}:a`, 7);
      const cx = Math.cos(lean * RAD) * radius;
      const cy = Math.sin(lean * RAD) * radius;
      const notable = add({
        id: `p.${spoke.name.toLowerCase()}.${ri}.hub`,
        name: `${theme.title} of ${spoke.name}`,
        kind: "notable",
        x: round1(cx), y: round1(cy),
        mods: theme.notable,
        links: [],
      });
      // Minors ring their notable, and the ring starts turned by the cluster's
      // own index so two clusters on one spoke never draw the same rosette.
      const count = RING_MINORS[ri]!;
      const minors: string[] = [];
      for (let m = 0; m < count; m++) {
        const key = `${spoke.name}:${ri}:${m}`;
        const a = angle + 40 + (360 / count) * m + ri * 17 + wobble(`${key}:a`, 9);
        const spread = CLUSTER_SPREAD + wobble(`${key}:s`, 9);
        minors.push(add({
          id: `p.${spoke.name.toLowerCase()}.${ri}.${m}`,
          name: theme.title,
          kind: "minor",
          x: round1(cx + Math.cos(a * RAD) * spread),
          y: round1(cy + Math.sin(a * RAD) * spread),
          mods: theme.minor,
          links: [],
        }));
      }
      // A chain round the rosette, so a cluster can be walked into and through
      // rather than only fanned out from — one minor is the way in, the notable
      // is bought with the rest.
      minors.forEach((id, m) => link(id, minors[(m + 1) % minors.length]!));
      link(notable, minors[0]!);
      link(notable, minors[Math.floor(count / 2)]!);
      if (ri > 0) {
        // The spoke's own ladder: the previous cluster's minor facing this one
        // to this cluster's minor facing back.
        const prev = clusterAt.get(`${si}:${ri - 1}`)!;
        link(nearest(prev.minors, cx, cy), nearest(minors, prev.x, prev.y));
      }
      lastOfSpoke.set(spoke.name, notable);
      clusterAt.set(`${si}:${ri}`, { minors, x: cx, y: cy });
    });
  });

  // Bridges between neighbouring spokes, two rings in.
  //
  // Without them the tree is eight ladders that only meet at the rim, and the
  // route decision — the thing a tree is FOR — collapses into "which ladder".
  // Each bridge is a pair of cheap travel nodes, PoE's own answer: what they buy
  // is the crossing, and paying two points for it is the cost of the crossing.
  for (const ri of [1, 2]) {
    SPOKES.forEach((spoke, si) => {
      const from = clusterAt.get(`${si}:${ri}`)!;
      const to = clusterAt.get(`${(si + 1) % SPOKES.length}:${ri}`)!;
      // The bridge lands on the minor of each cluster that faces the other.
      const fromId = nearest(from.minors, to.x, to.y);
      const toId = nearest(to.minors, from.x, from.y);
      const a = nodes.get(fromId)!;
      const b = nodes.get(toId)!;
      const theme = THEMES.travel;
      let prev = fromId;
      for (const t of [1, 2]) {
        const f = t / 3;
        // Bowed outward, so the bridge follows the ring rather than cutting the
        // chord straight through the empty middle.
        const bow = 1 + 0.16 * Math.sin(f * Math.PI);
        const id = add({
          id: `p.bridge.${ri}.${si}.${t}`,
          name: theme.title,
          kind: "minor",
          x: round1((a.x + (b.x - a.x) * f) * bow),
          y: round1((a.y + (b.y - a.y) * f) * bow),
          mods: theme.minor,
          links: [],
        });
        link(prev, id);
        prev = id;
      }
      link(prev, toId);
    });
  }

  // Every door opens onto the two spokes nearest it, so no class is born inside
  // one discipline. Nearest by angle, not by a table: the ring is generated.
  CLASS_IDS.forEach((classId, i) => {
    const angle = 90 + (360 / CLASS_IDS.length) * i;
    const door = nodes.get(startNodeId(classId))!;
    const perSpoke = 360 / SPOKES.length;
    const near = Math.round(angle / perSpoke);
    for (const d of [0, 1]) {
      const si = (near + d + SPOKES.length) % SPOKES.length;
      const first = clusterAt.get(`${si}:0`)!;
      link(startNodeId(classId), nearest(first.minors, door.x, door.y));
    }
  });

  // The rim: neighbouring spokes joined at their outermost clusters, which is
  // what turns eight dead ends into one web you can cross the long way round.
  SPOKES.forEach((_, si) => {
    const from = clusterAt.get(`${si}:3`)!;
    const to = clusterAt.get(`${(si + 1) % SPOKES.length}:3`)!;
    link(nearest(from.minors, to.x, to.y), nearest(to.minors, from.x, from.y));
  });

  // Keystones hang one step past the end of their spoke.
  for (const ks of KEYSTONES) {
    const si = SPOKES.findIndex((s) => s.name === ks.spoke);
    const angle = (360 / SPOKES.length) * si;
    const x = round1(Math.cos(angle * RAD) * (RING_RADIUS[3] + 130));
    const y = round1(Math.sin(angle * RAD) * (RING_RADIUS[3] + 130));
    const id = add({
      id: `p.keystone.${ks.name.toLowerCase().replace(/[^a-z]+/g, "_")}`,
      name: ks.name,
      kind: "keystone",
      x, y,
      mods: ks.mods,
      links: [],
    });
    const last = clusterAt.get(`${si}:3`)!;
    link(id, nearest(last.minors, x, y));
  }

  return [...nodes.values()];
}

export const PASSIVE_TREE: readonly PassiveNode[] = build();

const BY_ID: ReadonlyMap<string, PassiveNode> = new Map(PASSIVE_TREE.map((n) => [n.id, n]));

export function passiveNode(id: string): PassiveNode | undefined {
  return BY_ID.get(id);
}

/** The door a class is born at. Total, so an unknown class still has a tree. */
export function startNodeId(classId: string): string {
  return `p.start.${classId.replace(/^class\./, "")}`;
}

/**
 * The theme a node's face wears, for the client's icon lookup. Derived from the
 * id the same way build() assigned it; doors and keystones have no theme — a
 * door is only a frame, and a keystone's diamond is its own mark.
 */
export function passiveTheme(id: string): ThemeId | null {
  if (id.startsWith("p.bridge.")) return "travel";
  const m = /^p\.(\w+)\.(\d)\./.exec(id);
  if (!m) return null;
  const spoke = SPOKES.find((s) => s.name.toLowerCase() === m[1]);
  return spoke?.themes[Number(m[2])] ?? null;
}

/** Is `id` one of the three doors? Doors are free and cost no point. */
export function isStartNode(id: string): boolean {
  return passiveNode(id)?.kind === "start";
}

/**
 * How many points a character of this level has spent-able.
 *
 * Characters start at 65 (`xp.ts`), so a tree that only paid out per level would
 * hand a new character nothing to spend and a capped one 35 points in a web of
 * 200 nodes — a decision so thin it is a list. Twenty-four to open with and two
 * a level puts the cap at 94, which is roughly PoE's own reach: enough to walk
 * two disciplines and a keystone, never enough to walk all eight.
 */
export const PASSIVE_POINTS_AT_START = 24;
export const PASSIVE_POINTS_PER_LEVEL = 2;

export function passivePoints(level: number): number {
  const clamped = Math.min(Math.max(level, START_LEVEL), MAX_LEVEL);
  return PASSIVE_POINTS_AT_START + PASSIVE_POINTS_PER_LEVEL * (clamped - START_LEVEL);
}

/**
 * May this character take that node right now?
 *
 * The rule is PoE's and it is one sentence: a node is reachable when it touches
 * something you already own, and your door is something you already own. It is
 * checked HERE and again in the sim, because the client is untrusted.
 */
export function canAllocate(
  classId: string,
  allocated: readonly string[],
  id: string,
): boolean {
  const node = passiveNode(id);
  if (!node || node.kind === "start") return false;
  if (allocated.includes(id)) return false;
  // A notable is its cluster's centre, not a side door: it opens only once MORE
  // THAN HALF of its own rosette's minors are taken (owner's rule). Strictly
  // more — on a four-minor cluster two is still shut.
  if (node.kind === "notable") {
    const cluster = id.replace(/hub$/, "");
    const minors = PASSIVE_TREE.filter((n) => n.kind === "minor" && n.id.startsWith(cluster));
    const have = minors.filter((n) => allocated.includes(n.id)).length;
    if (have * 2 <= minors.length) return false;
  }
  const start = startNodeId(classId);
  return node.links.some((n) => n === start || allocated.includes(n));
}

/** Everything the allocated set grants, as gear-shaped mods. */
export function passiveStatMods(allocated: readonly string[]): ItemStatMod[] {
  const out: ItemStatMod[] = [];
  // Sorted, so the fold is in a stable order whatever order they were taken in.
  for (const id of [...allocated].sort()) {
    const node = passiveNode(id);
    if (node) out.push(...node.mods);
  }
  return out;
}

/**
 * A node's effect as tooltip lines. Worded here rather than in the client for
 * the same reason item mods are: the sheet and the tooltip must never be able to
 * describe the same number two different ways.
 */
export function passiveLines(node: PassiveNode): string[] {
  return node.mods.map((m) => {
    const label = STAT_LABEL[m.stat] ?? ` ${m.stat}`;
    const v = Math.abs(m.value);
    // PoE's own wording, and a keystone is where it matters: a downside written
    // as "-20% increased Cast Speed" reads as a bug, "20% reduced" reads as a price.
    if (label.includes("increased")) {
      return `${v}${label.replace("increased", m.value < 0 ? "reduced" : "increased")}`;
    }
    if (label.startsWith("%")) return `${m.value < 0 ? "-" : "+"}${v}${label}`;
    return `${m.value < 0 ? "-" : "+"}${v}${label}`;
  });
}

const STAT_LABEL: Readonly<Record<string, string>> = {
  maxLife: " to maximum Life",
  maxMana: " to maximum Mana",
  strength: " to Strength",
  armour: " to Armour",
  energyShield: " to maximum Energy Shield",
  energyShieldPct: "% increased maximum Energy Shield",
  armourPct: "% increased Armour",
  manaRegenPct: "% increased Mana Regeneration",
  spellDamagePct: "% increased Spell Damage",
  castSpeedPct: "% increased Cast Speed",
  critChancePct: "% increased Critical Strike Chance",
  fireResPct: "% to Fire Resistance",
  coldResPct: "% to Cold Resistance",
  lightningResPct: "% to Lightning Resistance",
  chaosResPct: "% to Chaos Resistance",
};
