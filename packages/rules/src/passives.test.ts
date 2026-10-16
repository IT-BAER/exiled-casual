import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  PASSIVE_TREE, canAllocate, canRefund, isStartNode, passiveLines, passiveNode,
  passivePoints, passiveStatMods, passiveTheme, startNodeId,
} from "./passives";
import { CLASS_IDS } from "./classes";
import { MAX_LEVEL, START_LEVEL } from "./xp";
import { applyItemMods, baseCasterStats } from "./stats";

describe("the passive tree's shape", () => {
  it("is comprehensive enough to be a decision: 200+ nodes, notables and keystones", () => {
    expect(PASSIVE_TREE.length).toBeGreaterThan(200);
    const kinds = new Set(PASSIVE_TREE.map((n) => n.kind));
    expect([...kinds].sort()).toEqual(["keystone", "minor", "notable", "start"]);
  });

  it("has one door per class and nothing else free", () => {
    const starts = PASSIVE_TREE.filter((n) => n.kind === "start");
    expect(starts.map((n) => n.id).sort()).toEqual(CLASS_IDS.map(startNodeId).sort());
    for (const s of starts) expect(s.mods).toEqual([]);
  });

  it("names every link, and every link both ways", () => {
    for (const node of PASSIVE_TREE) {
      for (const other of node.links) {
        const n = passiveNode(other);
        expect(n, `${node.id} links to missing ${other}`).toBeDefined();
        expect(n!.links, `${other} does not link back to ${node.id}`).toContain(node.id);
      }
    }
  });

  it("leaves nothing stranded: every node is walkable from every door", () => {
    for (const classId of CLASS_IDS) {
      const seen = new Set([startNodeId(classId)]);
      const queue = [startNodeId(classId)];
      while (queue.length > 0) {
        for (const next of passiveNode(queue.pop()!)!.links) {
          if (seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      expect(seen.size, `${classId} cannot reach the whole tree`).toBe(PASSIVE_TREE.length);
    }
  });

  it("gives every node a place of its own", () => {
    const spots = new Set(PASSIVE_TREE.map((n) => `${n.x},${n.y}`));
    expect(spots.size).toBe(PASSIVE_TREE.length);
  });

  /**
   * A line drawn through a node it does not name reads as a connection that does
   * not exist — the eye cannot tell "passes behind" from "links to". The radii
   * are the client's drawing radii; the tree owns the geometry, so the tree
   * guards it.
   */
  it("routes no link through a node it does not name", () => {
    const RADII = { start: 30, minor: 11, notable: 21, keystone: 24 } as const;
    const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
      return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
    };
    for (const a of PASSIVE_TREE) {
      for (const bid of a.links) {
        if (a.id > bid) continue; // each edge once
        const b = passiveNode(bid)!;
        for (const n of PASSIVE_TREE) {
          if (n.id === a.id || n.id === bid) continue;
          const d = segDist(n.x, n.y, a.x, a.y, b.x, b.y);
          expect(d, `${a.id} -> ${bid} passes through ${n.id}`).toBeGreaterThan(RADII[n.kind] + 2);
        }
      }
    }
  });

  it("holds between 280 and 330 nodes", () => {
    expect(PASSIVE_TREE.length).toBeGreaterThanOrEqual(280);
    expect(PASSIVE_TREE.length).toBeLessThanOrEqual(330);
  });

  it("has exactly one keystone per spoke, each hung off its own spoke's outer cluster", () => {
    const keystones = PASSIVE_TREE.filter((n) => n.kind === "keystone");
    expect(keystones.length).toBe(8);
    const spokes = new Set<string>();
    for (const ks of keystones) {
      expect(ks.links.length, ks.id).toBe(1);
      const m = /^p\.(\w+)\.3\.\d+$/.exec(ks.links[0]!);
      expect(m, `${ks.id} hangs off ${ks.links[0]}`).not.toBeNull();
      spokes.add(m![1]!);
    }
    expect(spokes.size).toBe(8);
  });

  it("themes every outer-ring cluster node and every bridge", () => {
    const ids = PASSIVE_TREE.map((n) => n.id).filter((id) => /^p\.\w+\.4\./.test(id) || id.startsWith("p.bridge.0."));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(passiveTheme(id), id).not.toBeNull();
    for (const id of ids.filter((i) => i.startsWith("p.bridge."))) expect(passiveTheme(id)).toBe("travel");
  });

  it("joins every outer-ring cluster to the ring-3 clusters of both spokes it sits between", () => {
    const spokeOf = (id: string) => /^p\.(\w+)\.(\d)\./.exec(id);
    const order = ["ember", "ash", "cinder", "stone", "bulwark", "veil", "storm", "hearth"];
    order.forEach((spoke, si) => {
      const members = PASSIVE_TREE.filter((n) => n.id.startsWith(`p.${spoke}.4.`));
      expect(members.length, spoke).toBe(7);
      const reached = new Set<string>();
      for (const n of members) {
        for (const l of n.links) {
          const m = spokeOf(l);
          if (m && m[2] === "3") reached.add(m[1]!);
        }
      }
      expect([...reached].sort(), spoke).toEqual([spoke, order[(si + 1) % 8]!].sort());
    });
  });

  /**
   * The tree only grows: a saved character's allocation names ids, so an id, a
   * link or a mod that moved would silently change or strand what he owns.
   */
  it("keeps every node, link and mod of the 239-node tree it grew from", () => {
    const before = JSON.parse(
      readFileSync(new URL("./passives.before-ring4.json", import.meta.url), "utf8"),
    ) as Record<string, { links: string[]; mods: unknown }>;
    expect(Object.keys(before).length).toBe(239);
    for (const [id, old] of Object.entries(before)) {
      const now = passiveNode(id);
      expect(now, `${id} is gone`).toBeDefined();
      for (const l of old.links) expect(now!.links, `${id} lost its link to ${l}`).toContain(l);
      expect(now!.mods, `${id} changed its mods`).toEqual(old.mods);
    }
  });
});

/** The nodes to take, door excluded and `id` included, to walk there legally. */
function pathTo(classId: string, id: string): string[] {
  const start = startNodeId(classId);
  const prev = new Map<string, string>();
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === id) break;
    for (const n of passiveNode(cur)!.links) {
      if (seen.has(n)) continue;
      seen.add(n);
      prev.set(n, cur);
      queue.push(n);
    }
  }
  const out: string[] = [];
  for (let c = id; c !== start; c = prev.get(c)!) out.unshift(c);
  return out;
}

describe("allocation", () => {
  const CLASS = CLASS_IDS[0]!;
  const neighbours = passiveNode(startNodeId(CLASS))!.links;

  it("opens on the nodes the door touches, and nothing further", () => {
    expect(canAllocate(CLASS, [], neighbours[0]!)).toBe(true);
    const far = PASSIVE_TREE.find(
      (n) => n.kind === "keystone",
    )!;
    expect(canAllocate(CLASS, [], far.id)).toBe(false);
  });

  it("walks: a node becomes reachable once its neighbour is taken", () => {
    const first = neighbours[0]!;
    const second = passiveNode(first)!.links.find((n) => !isStartNode(n) && n !== first)!;
    expect(canAllocate(CLASS, [], second)).toBe(false);
    expect(canAllocate(CLASS, [first], second)).toBe(true);
  });

  it("refuses a node already taken, and refuses a door", () => {
    expect(canAllocate(CLASS, [neighbours[0]!], neighbours[0]!)).toBe(false);
    expect(canAllocate(CLASS, [], startNodeId(CLASS))).toBe(false);
  });

  it("refuses a node that does not exist", () => {
    expect(canAllocate(CLASS, [], "p.nowhere")).toBe(false);
  });

  /**
   * A notable is the cluster's centre, not its side door: it opens only once
   * MORE THAN HALF of its own rosette's minors are taken. Half is not enough —
   * on a four-minor cluster two are 50% and the hub stays shut.
   */
  it("keeps a notable shut until most of its own minors are taken", () => {
    const hub = passiveNode("p.ember.0.hub")!;
    expect(hub.kind).toBe("notable");
    const minors = PASSIVE_TREE
      .filter((n) => n.kind === "minor" && n.id.startsWith("p.ember.0."))
      .map((n) => n.id);
    expect(minors.length).toBe(4);
    // Adjacent (the hub touches minors[0]) but only half the rosette: shut.
    expect(canAllocate(CLASS, [minors[0]!, minors[1]!], hub.id)).toBe(false);
    // Three of four is a majority: open.
    expect(canAllocate(CLASS, [minors[0]!, minors[1]!, minors[2]!], hub.id)).toBe(true);
  });

  /**
   * Undo, with PoE's one condition: what is left has to still be a tree grown
   * from the door. Refunding the node a whole branch hangs off would leave every
   * node past it floating, so it is refused rather than silently cascading.
   */
  describe("refund", () => {
    it("gives back the last node taken", () => {
      const first = neighbours[0]!;
      expect(canRefund(CLASS, [first], first)).toBe(true);
    });

    it("refuses a node that is holding another one up", () => {
      const first = neighbours[0]!;
      const second = passiveNode(first)!.links.find((n) => !isStartNode(n) && n !== first)!;
      expect(canRefund(CLASS, [first, second], first)).toBe(false);
      expect(canRefund(CLASS, [first, second], second)).toBe(true);
    });

    it("refuses a node that was never taken, and refuses the door", () => {
      expect(canRefund(CLASS, [], neighbours[0]!)).toBe(false);
      expect(canRefund(CLASS, [neighbours[0]!], startNodeId(CLASS))).toBe(false);
    });

    /** A notable's own threshold outlives the click that opened it: pulling a
     *  minor back out from under it would leave a hub nothing qualifies for. */
    it("refuses a minor whose notable would fall below its threshold", () => {
      const minors = PASSIVE_TREE
        .filter((n) => n.kind === "minor" && n.id.startsWith("p.ember.0."))
        .map((n) => n.id);
      const path = pathTo(CLASS, minors[0]!);
      const taken = [...path, ...minors, "p.ember.0.hub"];
      expect(canRefund(CLASS, taken, "p.ember.0.hub")).toBe(true);
      // Four minors, so the hub needs three. Giving one back leaves exactly
      // three and is allowed; giving a second back would leave two, which is
      // half of four and not a majority, so the hub holds it in place.
      expect(canRefund(CLASS, taken, minors[3]!)).toBe(true);
      const three = taken.filter((n) => n !== minors[3]);
      expect(canRefund(CLASS, three, minors[2]!)).toBe(false);
    });
  });

  /** Another class's door is not a door of yours: it is not in your allocated set. */
  it("does not let one class walk in through another's door", () => {
    const other = CLASS_IDS[1]!;
    const theirs = passiveNode(startNodeId(other))!.links
      .find((n) => !passiveNode(startNodeId(CLASS))!.links.includes(n));
    expect(theirs, "the two doors share every neighbour").toBeDefined();
    expect(canAllocate(CLASS, [], theirs!)).toBe(false);
  });
});

describe("what the points buy", () => {
  it("starts with a handful and never outgrows the tree", () => {
    expect(passivePoints(START_LEVEL)).toBe(0);
    expect(passivePoints(MAX_LEVEL)).toBe(99);
    expect(passivePoints(MAX_LEVEL)).toBeLessThan(PASSIVE_TREE.length / 2);
  });

  it("clamps rather than paying out below the starting level or past the cap", () => {
    expect(passivePoints(1)).toBe(passivePoints(START_LEVEL));
    expect(passivePoints(1000)).toBe(passivePoints(MAX_LEVEL));
  });

  it("folds into the same stat block gear does", () => {
    const life = PASSIVE_TREE.find((n) => n.mods.some((m) => m.stat === "maxLife" && m.value > 0))!;
    const base = baseCasterStats();
    const withOne = applyItemMods(base, passiveStatMods([life.id]));
    expect(withOne.maxLifeFixed).toBeGreaterThan(base.maxLifeFixed);
    // Twice the node is twice the life, so nothing about the fold is positional.
    const twice = applyItemMods(base, [...passiveStatMods([life.id]), ...passiveStatMods([life.id])]);
    expect(twice.maxLifeFixed - base.maxLifeFixed).toBe((withOne.maxLifeFixed - base.maxLifeFixed) * 2);
  });

  it("ignores a node that is not in the tree rather than throwing mid-run", () => {
    expect(passiveStatMods(["p.nowhere"])).toEqual([]);
  });
});

describe("the passive budget over a 1-100 climb", () => {
  it("gives a brand-new character nothing to spend yet", () => {
    expect(passivePoints(START_LEVEL)).toBe(0);
  });

  it("reaches the same budget at the cap the 65-94 era ended on", () => {
    // 99 points in a 315-node tree: enough to walk two disciplines and a
    // keystone, never enough to walk all eight. That budget is the design.
    expect(passivePoints(MAX_LEVEL)).toBe(99);
  });

  it("never exceeds the budget however far past the cap it is asked", () => {
    expect(passivePoints(MAX_LEVEL + 50)).toBe(passivePoints(MAX_LEVEL));
  });

  it("is monotonic and whole", () => {
    for (let lv = START_LEVEL; lv < MAX_LEVEL; lv++) {
      expect(passivePoints(lv + 1)).toBeGreaterThanOrEqual(passivePoints(lv));
      expect(Number.isSafeInteger(passivePoints(lv))).toBe(true);
    }
  });
});

describe("tooltips", () => {
  it("writes a price as PoE does: 'reduced' for a percentage, a minus for a flat", () => {
    const spent = PASSIVE_TREE.find(
      (n) => n.kind === "keystone" && n.mods.some((m) => m.value < 0 && m.stat.endsWith("Pct")),
    )!;
    const lines = passiveLines(spent);
    expect(lines.length).toBe(spent.mods.length);
    // "-20% increased Cast Speed" reads as a bug; "20% reduced" reads as a price.
    expect(lines.join(" ")).not.toContain("% increased Cast Speed");
    expect(lines.some((l) => l.includes("reduced"))).toBe(true);
    const flat = PASSIVE_TREE.find(
      (n) => n.mods.some((m) => m.value < 0 && !m.stat.endsWith("Pct")),
    )!;
    expect(passiveLines(flat).some((l) => l.startsWith("-"))).toBe(true);
  });

  it("words every keystone's every mod, never a raw stat name", () => {
    const keystones = PASSIVE_TREE.filter((n) => n.kind === "keystone");
    for (const ks of keystones) {
      const lines = passiveLines(ks);
      expect(lines.length, ks.id).toBe(ks.mods.length);
      for (const [i, line] of lines.entries()) {
        expect(line, ks.id).toMatch(/^[+-]?\d+%?\s\S/);
        expect(line, `${ks.id} prints its raw stat`).not.toContain(ks.mods[i]!.stat);
      }
    }
  });

  it("says something for every mod on every node", () => {
    for (const node of PASSIVE_TREE) {
      for (const line of passiveLines(node)) {
        expect(line, `${node.id} has an unworded mod`).toMatch(/^[+-]?\d+%?\s\S/);
      }
    }
  });
});
