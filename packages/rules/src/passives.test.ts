import { describe, it, expect } from "vitest";
import {
  PASSIVE_TREE, canAllocate, isStartNode, passiveLines, passiveNode,
  passivePoints, passiveStatMods, startNodeId,
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
});

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
    expect(passivePoints(START_LEVEL)).toBe(24);
    expect(passivePoints(MAX_LEVEL)).toBe(94);
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

  it("says something for every mod on every node", () => {
    for (const node of PASSIVE_TREE) {
      for (const line of passiveLines(node)) {
        expect(line, `${node.id} has an unworded mod`).toMatch(/^[+-]?\d+%?\s\S/);
      }
    }
  });
});
