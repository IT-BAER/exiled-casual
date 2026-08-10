import { describe, it, expect } from "vitest";
import {
  areaLevel, monsterTierScale, offerWaystones, WAYSTONE_OFFER_COUNT,
  atlasGraph, ATLAS_NODE_COUNT, isNodeReachable, atlasNodeTier, nextNodeTier, WAYSTONE_MAX_TIER,
} from "./atlas.js";
import { xpToNext, monsterXp } from "./xp.js";

describe("atlas rules", () => {
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

  it("gives every place a name and a line of lore, fixed to its index", () => {
    const g = atlasGraph(42);
    const other = atlasGraph(43);
    for (let i = 0; i < g.length; i++) {
      expect(g[i]!.flavour.length).toBeGreaterThan(10);
      // Lore rides on the index with the name, so a place reads the same in
      // every account's world even though the layout is seeded per account.
      expect(other[i]!.flavour).toBe(g[i]!.flavour);
      expect(other[i]!.name).toBe(g[i]!.name);
    }
    expect(new Set(g.map((n) => n.flavour)).size).toBe(g.length);
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

describe("nextNodeTier", () => {
  const graph = atlasGraph(2026);

  it("names the cheapest stone that opens somewhere new", () => {
    // Every route out of the start is one hop, and a hop is two tiers.
    expect(nextNodeTier(graph, graph[0]!.id, [graph[0]!.id])).toBe(3);
  });

  it("is null once every route out has been cleared", () => {
    const first = graph[0]!;
    expect(nextNodeTier(graph, first.id, [first.id, ...first.links])).toBeNull();
  });

  it("is null for a place that is not on the graph", () => {
    expect(nextNodeTier(graph, "node.nowhere", [])).toBeNull();
  });
});

describe("the Atlas spans a 1-100 character's climb", () => {
  it("opens at a level a fresh character can survive", () => {
    expect(areaLevel(0)).toBe(2);
  });

  it("tops out below the level cap, so the last levels are a grind by choice", () => {
    expect(areaLevel(ATLAS_NODE_COUNT - 1)).toBe(86);
  });

  it("climbs by a fixed step, so a tier is always worth the same jump", () => {
    for (let t = 0; t < ATLAS_NODE_COUNT - 1; t++) {
      expect(areaLevel(t + 1) - areaLevel(t)).toBe(6);
    }
  });

  it("costs a sane number of kills at every level, which is the real contract", () => {
    // The two curves are only meaningful against each other: a level must never
    // cost so few kills that it is noise, nor so many that the track stops
    // paying (docs/09 rule 7). Measured in normal-monster equivalents at the
    // area level a character of that level would be running; a rare is 8 of
    // these and a boss 40, so real kill counts are several times smaller.
    // This case lives here rather than in xp.test.ts because it needs BOTH
    // curves, and it is the only thing stopping them being tuned separately.
    for (const level of [1, 10, 50, 90, 99]) {
      const tier = Math.max(0, Math.min(ATLAS_NODE_COUNT - 1, Math.round((level - 2) / 6)));
      const kills = xpToNext(level) / monsterXp(areaLevel(tier), "normal");
      expect(kills).toBeGreaterThan(10);
      expect(kills).toBeLessThan(5_000);
    }
  });

  it("keeps tier 0 monsters at their authored numbers", () => {
    // The reference character is tuned against tier 0. If this scale ever stops
    // being 1000/1000, every band in balance.test.ts moves with it.
    expect(monsterTierScale(0)).toEqual({ lifeMilli: 1000, dmgMilli: 1000 });
  });

  it("scales monsters across the whole Atlas rather than the old 15 tiers", () => {
    const top = monsterTierScale(ATLAS_NODE_COUNT - 1);
    expect(top.lifeMilli).toBeGreaterThan(monsterTierScale(0).lifeMilli);
    expect(top.dmgMilli).toBeGreaterThan(monsterTierScale(0).dmgMilli);
    expect(Number.isSafeInteger(top.lifeMilli)).toBe(true);
    expect(Number.isSafeInteger(top.dmgMilli)).toBe(true);
  });
});
