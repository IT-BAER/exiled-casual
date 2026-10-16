import { CLASS_IDS } from "./classes";
import { PASSIVE_TREE, canAllocate, passiveNode, passiveTheme, startNodeId } from "./passives";

/**
 * A measuring stick for the passive tree: how far each door is from what the
 * tree offers, and how much offence or defence a budget of points buys.
 *
 * Pure and deterministic. Paths follow the tree's links, and every step is checked by
 * `canAllocate`, so the bench cannot disagree with the game on legality.
 */

export type BenchAxis = "offence" | "defence";

/**
 * The value unit: one minor node of the stat's own theme is worth 1. Percent
 * stats with no minor of their own count one unit per 10 %. A negative value
 * counts negative. `axis: null` is counted on neither axis.
 */
export const PASSIVE_BENCH_STATS: Readonly<Record<string, { unit: number; axis: BenchAxis | null }>> = {
  spellDamagePct: { unit: 6, axis: "offence" },
  castSpeedPct: { unit: 3, axis: "offence" },
  critChancePct: { unit: 8, axis: "offence" },
  maxLife: { unit: 8, axis: "defence" },
  strength: { unit: 5, axis: "defence" },
  armour: { unit: 14, axis: "defence" },
  armourPct: { unit: 10, axis: "defence" },
  energyShield: { unit: 9, axis: "defence" },
  energyShieldPct: { unit: 10, axis: "defence" },
  fireResPct: { unit: 6, axis: "defence" },
  coldResPct: { unit: 6, axis: "defence" },
  lightningResPct: { unit: 6, axis: "defence" },
  chaosResPct: { unit: 5, axis: "defence" },
  maxMana: { unit: 6, axis: null },
  manaRegenPct: { unit: 10, axis: null },
};

export const PASSIVE_BENCH_BUDGETS = [10, 20, 50, 99] as const;

/** The balance target. Measured by the bench and reported, not enforced anywhere yet. */
export const PASSIVE_BENCH_TARGET = {
  /** Worst class over best class, per axis per budget. */
  minAxisRatio: 0.9,
  /** Points from every door to its nearest offence notable and its nearest defence notable. */
  notableWithin: 12,
  /** Every keystone from every door. */
  keystoneWithin: 60,
} as const;

export interface PassiveBenchWalk {
  /** The allocation order, each step legal by `canAllocate` on the ones before it. */
  nodes: readonly string[];
  /** Sum of the walk's value on its own axis, rounded to 0.01. */
  total: number;
}

export interface PassiveBenchClass {
  classId: string;
  /** Points to the cheapest notable of each theme. */
  notableByTheme: Record<string, number>;
  /** Points to the cheapest notable of each spoke, keyed by the spoke's id segment. */
  notableBySpoke: Record<string, number>;
  /** Points to each keystone, by node id. */
  keystone: Record<string, number>;
  walks: Record<BenchAxis, Record<number, PassiveBenchWalk>>;
  /** Share of the 99-point walk spent on travel nodes, rounded to 0.01. */
  travelShare: Record<BenchAxis, number>;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A node's worth on one axis, in units. */
export function passiveAxisValue(id: string, axis: BenchAxis): number {
  let sum = 0;
  for (const m of passiveNode(id)?.mods ?? []) {
    const w = PASSIVE_BENCH_STATS[m.stat];
    if (w?.axis === axis) sum += m.value / w.unit;
  }
  return sum;
}

/** Each notable's own rosette, the minors `canAllocate` counts for it. */
const CLUSTER: ReadonlyMap<string, readonly string[]> = new Map(
  PASSIVE_TREE.filter((n) => n.kind === "notable").map((hub) => {
    const prefix = hub.id.replace(/hub$/, "");
    return [hub.id, PASSIVE_TREE.filter((n) => n.kind === "minor" && n.id.startsWith(prefix)).map((n) => n.id)];
  }),
);

const linksOf = (id: string): readonly string[] => passiveNode(id)?.links ?? [];
const isStart = (id: string): boolean => passiveNode(id)?.kind === "start";
const isNotable = (id: string): boolean => passiveNode(id)?.kind === "notable";

/**
 * Fewest new nodes to reach any of `targets` from `door` plus `taken`, along
 * links and ignoring the notable rule. A lower bound on any legal route.
 */
function looseDistance(door: string, taken: ReadonlySet<string>, targets: readonly string[]): number {
  const seen = new Set([door, ...taken]);
  let layer = [...seen];
  for (let d = 0; layer.length > 0; d++) {
    if (layer.some((id) => targets.includes(id))) return d;
    const next: string[] = [];
    for (const id of layer) {
      for (const n of linksOf(id)) {
        if (seen.has(n) || isStart(n)) continue;
        seen.add(n);
        next.push(n);
      }
    }
    layer = next;
  }
  return Infinity;
}

/**
 * The fewest allocations from nothing that leave `target` allocated, with every
 * step legal by `canAllocate`, as an allocation order. A* over allocated sets: a
 * set's cost is its size whatever order built it, so a set is final the first
 * time it is seen, and the heuristic never overestimates.
 */
export function cheapestPassivePath(classId: string, target: string): string[] | null {
  const node = passiveNode(target);
  if (!node || node.kind === "start") return null;
  const door = startNodeId(classId);
  const minors = CLUSTER.get(target) ?? [];
  const need = Math.floor(minors.length / 2) + 1;
  const estimate = (taken: ReadonlySet<string>): number => {
    if (node.kind !== "notable") return looseDistance(door, taken, [target]);
    const have = minors.filter((m) => taken.has(m)).length;
    // The first minor, the rest of the majority, then the hub itself.
    if (have === 0) return looseDistance(door, taken, minors) + need;
    return Math.max(0, need - have) + 1;
  };

  interface Entry { path: string[]; key: string; f: number }
  const open: Entry[] = [{ path: [], key: "", f: estimate(new Set()) }];
  const seen = new Set([""]);
  while (open.length > 0) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      const a = open[i]!;
      const b = open[bi]!;
      if (a.f < b.f || (a.f === b.f && (a.path.length > b.path.length
        || (a.path.length === b.path.length && a.key < b.key)))) bi = i;
    }
    const cur = open.splice(bi, 1)[0]!;
    if (!Number.isFinite(cur.f)) return null;
    if (cur.path.includes(target)) return cur.path;
    const taken = new Set(cur.path);
    const frontier = new Set<string>();
    for (const id of [door, ...cur.path]) for (const n of linksOf(id)) frontier.add(n);
    for (const n of [...frontier].sort()) {
      if (!canAllocate(classId, cur.path, n)) continue;
      const key = [...cur.path, n].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      taken.add(n);
      open.push({ path: [...cur.path, n], key, f: cur.path.length + 1 + estimate(taken) });
      taken.delete(n);
    }
  }
  return null;
}

interface Plan { target: string; path: string[]; value: number }

/**
 * Every target worth walking to from `taken`, each with a shortest legal path:
 * a breadth-first sweep through minors and keystones (most value on a tie of
 * length), and for a notable, the cheapest way into its rosette then enough of
 * the rosette to open it.
 */
function plans(classId: string, taken: readonly string[], axis: BenchAxis): Plan[] {
  const door = startNodeId(classId);
  const owned = new Set(taken);
  const cost = new Map<string, number>();
  const gain = new Map<string, number>();
  const prev = new Map<string, string>();
  let layer = [door, ...taken].sort();
  for (const id of layer) { cost.set(id, 0); gain.set(id, 0); }
  for (let d = 1; layer.length > 0; d++) {
    const next = new Set<string>();
    for (const u of layer) {
      for (const v of linksOf(u)) {
        if (cost.has(v) || isStart(v) || isNotable(v)) continue;
        next.add(v);
      }
    }
    layer = [...next].sort();
    for (const v of layer) {
      let best: string | undefined;
      for (const u of linksOf(v)) {
        if (cost.get(u) !== d - 1) continue;
        if (best === undefined || gain.get(u)! > gain.get(best)! || (gain.get(u) === gain.get(best) && u < best)) best = u;
      }
      cost.set(v, d);
      gain.set(v, gain.get(best!)! + passiveAxisValue(v, axis));
      prev.set(v, best!);
    }
  }
  const pathOf = (id: string): string[] => {
    const out: string[] = [];
    for (let c: string | undefined = id; c !== undefined && cost.get(c)! > 0; c = prev.get(c)) out.unshift(c);
    return out;
  };

  const out: Plan[] = [];
  for (const id of cost.keys()) {
    if (cost.get(id)! > 0) out.push({ target: id, path: pathOf(id), value: gain.get(id)! });
  }
  for (const [hub, minors] of CLUSTER) {
    if (owned.has(hub)) continue;
    const path: string[] = [];
    if (!minors.some((m) => owned.has(m))) {
      const entries = minors.filter((m) => cost.has(m));
      if (entries.length === 0) continue;
      entries.sort((a, b) => cost.get(a)! - cost.get(b)! || gain.get(b)! - gain.get(a)! || (a < b ? -1 : 1));
      path.push(...pathOf(entries[0]!));
    }
    let blocked = false;
    while (!canAllocate(classId, [...taken, ...path], hub)) {
      const now = [...taken, ...path];
      const open = minors.filter((m) => !now.includes(m) && canAllocate(classId, now, m));
      if (open.length === 0) { blocked = true; break; }
      // The hub's own neighbours first: the majority is useless until it touches the hub.
      open.sort((a, b) => Number(linksOf(hub).includes(b)) - Number(linksOf(hub).includes(a)) || (a < b ? -1 : 1));
      path.push(open[0]!);
    }
    if (blocked) continue;
    path.push(hub);
    out.push({ target: hub, path, value: path.reduce((s, id) => s + passiveAxisValue(id, axis), 0) });
  }
  return out;
}

/**
 * Best-first walk from the door: take the target with the most axis value per
 * point (its whole path counted on both sides), ties to the lower node id, and
 * stop when nothing with positive value still fits the budget.
 */
export function passiveBenchWalk(classId: string, axis: BenchAxis, budget: number): PassiveBenchWalk {
  const walk: string[] = [];
  for (;;) {
    let best: Plan | undefined;
    for (const p of plans(classId, walk, axis)) {
      if (p.value <= 0 || walk.length + p.path.length > budget) continue;
      if (best === undefined) { best = p; continue; }
      const lhs = p.value * best.path.length;
      const rhs = best.value * p.path.length;
      if (lhs > rhs + 1e-9 || (Math.abs(lhs - rhs) <= 1e-9 && p.target < best.target)) best = p;
    }
    if (!best) break;
    for (const id of best.path) {
      if (!canAllocate(classId, walk, id)) throw new Error(`passive bench planned an illegal step to ${id}`);
      walk.push(id);
    }
  }
  return { nodes: walk, total: round2(walk.reduce((s, id) => s + passiveAxisValue(id, axis), 0)) };
}

/** Points to the cheapest of `ids`. `cost` memoises per node: a notable is priced by theme and by spoke. */
function cheapestOf(classId: string, ids: readonly string[], cost: Map<string, number>): number {
  let best = Infinity;
  for (const id of ids) {
    if (!cost.has(id)) cost.set(id, cheapestPassivePath(classId, id)?.length ?? Infinity);
    best = Math.min(best, cost.get(id)!);
  }
  return best;
}

/** The whole bench, one entry per class in `CLASS_IDS` order. */
export function passiveBench(): PassiveBenchClass[] {
  const notables = PASSIVE_TREE.filter((n) => n.kind === "notable").map((n) => n.id);
  const byTheme = new Map<string, string[]>();
  const bySpoke = new Map<string, string[]>();
  for (const id of notables) {
    const theme = passiveTheme(id)!;
    const spoke = id.split(".")[1]!;
    byTheme.set(theme, [...(byTheme.get(theme) ?? []), id]);
    bySpoke.set(spoke, [...(bySpoke.get(spoke) ?? []), id]);
  }
  const keystones = PASSIVE_TREE.filter((n) => n.kind === "keystone").map((n) => n.id);

  return CLASS_IDS.map((classId) => {
    const walks = { offence: {}, defence: {} } as Record<BenchAxis, Record<number, PassiveBenchWalk>>;
    const travelShare = {} as Record<BenchAxis, number>;
    for (const axis of ["offence", "defence"] as const) {
      for (const budget of PASSIVE_BENCH_BUDGETS) walks[axis][budget] = passiveBenchWalk(classId, axis, budget);
      const full = walks[axis][99]!.nodes;
      const travel = full.filter((id) => passiveTheme(id) === "travel").length;
      travelShare[axis] = full.length === 0 ? 0 : round2(travel / full.length);
    }
    const cost = new Map<string, number>();
    return {
      classId,
      notableByTheme: Object.fromEntries([...byTheme].map(([t, ids]) => [t, cheapestOf(classId, ids, cost)])),
      notableBySpoke: Object.fromEntries([...bySpoke].map(([s, ids]) => [s, cheapestOf(classId, ids, cost)])),
      keystone: Object.fromEntries(keystones.map((id) => [id, cheapestOf(classId, [id], cost)])),
      walks,
      travelShare,
    };
  });
}
