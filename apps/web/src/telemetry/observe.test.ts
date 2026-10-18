import { describe, it, expect } from "vitest";
import type { Snapshot, SnapshotEntity } from "@exiled/protocol";
import { testPlayer } from "../test-fixtures";
import { createGameObserver } from "./observe";

const item = (id: number, rarity: "normal" | "magic" | "rare" | "unique") =>
  ({ id, kind: "groundItem", rarity, x: 0, y: 0 }) as unknown as SnapshotEntity;

const snap = (over: Omit<Partial<Snapshot>, "player"> & { player?: Partial<Snapshot["player"]> } = {}): Snapshot => {
  const { player, ...rest } = over;
  return {
    tick: 0, area: "map", portalsLeft: 0, mapOpen: true, areaTier: 2, atlasSeed: 1, completedNodes: [],
    player: testPlayer(player), entities: [], skillBar: [],
    ...rest,
  } as unknown as Snapshot;
};

describe("game observer", () => {
  it("emits an area event with the tier on the first snapshot after the area message", () => {
    const o = createGameObserver();
    o.area("map", "strand");
    expect(o.observe(snap({ areaTier: 4 }))).toEqual([{ k: "area", area: "map", biome: "strand", tier: 4 }]);
    expect(o.observe(snap())).toEqual([]);
    o.area("hideout", null);
    expect(o.observe(snap({ area: "hideout", areaTier: 0 }))).toEqual([{ k: "area", area: "hideout" }]);
  });

  it("emits level only on an increase", () => {
    const o = createGameObserver();
    expect(o.observe(snap({ player: { level: 5 } }))).toEqual([]);
    expect(o.observe(snap({ player: { level: 6 } }))).toEqual([{ k: "level", level: 6 }]);
    expect(o.observe(snap({ player: { level: 6 } }))).toEqual([]);
  });

  it("emits death once, on the alive to dead edge, with the killer", () => {
    const o = createGameObserver();
    o.area("map", "vaal");
    o.observe(snap());
    const dead = snap({
      player: { alive: false },
      deathRecap: { killingBlow: { species: "monster.x", rare: true, damage: 9, element: "fire", pctOfLife: 50 }, sources: [], total: 9, byElement: {} },
    });
    expect(o.observe(dead)).toEqual([
      { k: "death", level: 65, tier: 2, biome: "vaal", killer: "monster.x", element: "fire", rare: true },
    ]);
    expect(o.observe(dead)).toEqual([]);
    o.observe(snap());
    expect(o.observe(snap({ player: { alive: false } })).map((e) => e.k)).toEqual(["death"]);
  });

  it("emits mapDone when completedNodes gains an id", () => {
    const o = createGameObserver();
    o.area("map", "swamp");
    o.observe(snap({ completedNodes: ["node.a"] }));
    expect(o.observe(snap({ completedNodes: ["node.a", "node.b"] }))).toEqual([
      { k: "mapDone", node: "node.b", tier: 2, biome: "swamp" },
    ]);
    expect(o.observe(snap({ completedNodes: ["node.a", "node.b"] }))).toEqual([]);
  });

  it("counts new ground items by rarity, ignores the ones already lying there, and resets on area", () => {
    const o = createGameObserver();
    o.observe(snap({ entities: [item(1, "rare")] }));
    expect(o.takeLoot()).toBeNull();
    o.observe(snap({ entities: [item(1, "rare"), item(2, "magic"), item(3, "magic"), item(4, "unique")] }));
    o.observe(snap({ entities: [item(2, "magic"), item(5, "normal")] }));
    expect(o.takeLoot()).toEqual({ normal: 1, magic: 2, rare: 0, unique: 1 });
    expect(o.takeLoot()).toBeNull();
    o.area("map", "desert");
    o.observe(snap({ entities: [item(1, "rare")] }));
    expect(o.takeLoot()).toBeNull();
  });

  it("reports the context a beat carries", () => {
    const o = createGameObserver();
    o.area("map", "forest");
    o.observe(snap({ areaTier: 3, player: { level: 9 } }));
    expect(o.context()).toEqual({ area: "map", biome: "forest", tier: 3, level: 9, classId: "class.stalker" });
  });
});
