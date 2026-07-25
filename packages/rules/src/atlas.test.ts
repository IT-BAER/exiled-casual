import { describe, it, expect } from "vitest";
import {
  areaLevel, monsterTierScale, offerWaystones, WAYSTONE_OFFER_COUNT,
  atlasGraph, ATLAS_NODE_COUNT, isNodeReachable, atlasNodeTier, WAYSTONE_MAX_TIER,
} from "./atlas.js";

describe("atlas rules", () => {
  it("areaLevel is 64 + tier", () => {
    expect(areaLevel(1)).toBe(65);
    expect(areaLevel(15)).toBe(79);
  });

  it("monsterTierScale is per-mille, 1.0 at tier 0", () => {
    expect(monsterTierScale(0)).toEqual({ lifeMilli: 1000, dmgMilli: 1000 });
    expect(monsterTierScale(10)).toEqual({ lifeMilli: 2500, dmgMilli: 2000 });
  });

  it("offerWaystones is deterministic for a seed", () => {
    const a = offerWaystones(42, WAYSTONE_OFFER_COUNT);
    const b = offerWaystones(42, WAYSTONE_OFFER_COUNT);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    for (const w of a) {
      expect(w.tier).toBeGreaterThanOrEqual(1);
      expect(w.tier).toBeLessThanOrEqual(15);
      expect(Number.isInteger(w.seed)).toBe(true);
    }
    expect(new Set(a.map((w) => w.id)).size).toBe(3); // ids unique
  });

  it("always offers a Tier 1 waystone in the first slot", () => {
    for (const seed of [1, 42, 999, 0xdeadbeef]) {
      const ws = offerWaystones(seed, WAYSTONE_OFFER_COUNT);
      expect(ws[0]!.id).toBe("ws-0");
      expect(ws[0]!.tier).toBe(1);
    }
  });

  it("different seeds usually differ", () => {
    expect(offerWaystones(1, 3)).not.toEqual(offerWaystones(2, 3));
  });

});

describe("atlas graph", () => {
  it("is deterministic for a seed and differs between seeds", () => {
    expect(atlasGraph(42)).toEqual(atlasGraph(42));
    expect(atlasGraph(42)).not.toEqual(atlasGraph(43));
  });

  it("lays every node inside the unit square with a unique id", () => {
    const g = atlasGraph(42);
    expect(g).toHaveLength(ATLAS_NODE_COUNT);
    expect(new Set(g.map((n) => n.id)).size).toBe(g.length);
    for (const n of g) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(1);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(1);
    }
  });

  it("links symmetrically — a route is walkable in both directions", () => {
    for (const seed of [1, 42, 999, 0xdeadbeef]) {
      const g = atlasGraph(seed);
      const byId = new Map(g.map((n) => [n.id, n]));
      for (const n of g) {
        for (const other of n.links) {
          expect(byId.get(other)?.links).toContain(n.id);
        }
      }
    }
  });

  it("reaches every node from the first one, so no map is stranded", () => {
    for (const seed of [1, 42, 999, 0xdeadbeef, 7, 123456]) {
      const g = atlasGraph(seed);
      const byId = new Map(g.map((n) => [n.id, n]));
      const seen = new Set<string>([g[0]!.id]);
      const queue = [g[0]!.id];
      while (queue.length > 0) {
        for (const next of byId.get(queue.pop()!)!.links) {
          if (seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      expect(seen.size).toBe(g.length);
    }
  });
});

describe("atlas fog", () => {
  const g = atlasGraph(42);

  it("opens the first node on a fresh atlas and nothing else", () => {
    expect(isNodeReachable(g, [], g[0]!.id)).toBe(true);
    const far = g.find((n) => n.id !== g[0]!.id && !g[0]!.links.includes(n.id))!;
    expect(isNodeReachable(g, [], far.id)).toBe(false);
  });

  it("opens a node once a neighbour is completed", () => {
    const first = g[0]!;
    const neighbour = g.find((n) => n.id === first.links[0])!;
    expect(isNodeReachable(g, [], neighbour.id)).toBe(false);
    expect(isNodeReachable(g, [first.id], neighbour.id)).toBe(true);
  });

  it("does not open a node two routes away", () => {
    const first = g[0]!;
    const twoAway = g.find(
      (n) => n.id !== first.id && !first.links.includes(n.id) && n.links.some((l) => first.links.includes(l)),
    )!;
    expect(isNodeReachable(g, [first.id], twoAway.id)).toBe(false);
  });

  it("is false for an id that is not on the graph", () => {
    expect(isNodeReachable(g, [], "node.nope")).toBe(false);
  });
});

describe("atlasNodeTier", () => {
  const graph = atlasGraph(2026);

  it("the first place accepts the lowest stone there is", () => {
    expect(atlasNodeTier(graph, graph[0]!.id)).toBe(1);
  });

  it("a neighbour of the start costs two tiers more", () => {
    expect(atlasNodeTier(graph, graph[0]!.links[0]!)).toBe(3);
  });

  it("every place is reachable and inside the 1..15 band", () => {
    for (const n of graph) {
      const t = atlasNodeTier(graph, n.id);
      expect(t).toBeGreaterThanOrEqual(1);
      expect(t).toBeLessThanOrEqual(WAYSTONE_MAX_TIER);
    }
  });

  it("is stable and rises with distance from the start", () => {
    const first = atlasNodeTier(graph, graph[0]!.id);
    const far = Math.max(...graph.map((n) => atlasNodeTier(graph, n.id)));
    expect(far).toBeGreaterThan(first);
    expect(atlasNodeTier(graph, graph[3]!.id)).toBe(atlasNodeTier(graph, graph[3]!.id));
  });

  it("an unknown place reads as the starting tier rather than throwing", () => {
    expect(atlasNodeTier(graph, "node.nowhere")).toBe(1);
  });
});
