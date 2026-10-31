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

  const mon = (id: number, x: number, extra: Partial<SnapshotEntity> = {}) =>
    ({ id, kind: "monster", x, y: 0, life: 100, maxLife: 100, ...extra }) as SnapshotEntity;

  it("sees a rare once it comes within about a screen, and counts its death once", () => {
    const o = createGameObserver();
    o.area("map", "strand");
    o.observe(snap());
    const far = mon(7, 30, { rare: true });
    expect(o.observe(snap({ entities: [far, mon(8, 2)] }))).toEqual([]);
    const near = mon(7, 6, { rare: true });
    expect(o.observe(snap({ entities: [near] }))).toEqual([{ k: "rareSeen", tier: 2, biome: "strand" }]);
    expect(o.observe(snap({ entities: [near] }))).toEqual([]);
    // Monsters leave the snapshot only by dying.
    expect(o.observe(snap({ entities: [mon(8, 2)] }))).toEqual([{ k: "rareKill", tier: 2, biome: "strand" }]);
    expect(o.observe(snap({ entities: [] }))).toEqual([]);
  });

  it("does not take a new area's empty snapshot for a dead rare", () => {
    const o = createGameObserver();
    o.area("map", "strand");
    o.observe(snap());
    o.observe(snap({ entities: [mon(7, 3, { rare: true })] }));
    o.area("hideout", null);
    expect(o.observe(snap({ area: "hideout", areaTier: 0 })).map((e) => e.k)).toEqual(["area"]);
  });

  it("reports the boss waking and the first hit on it, once per area", () => {
    const o = createGameObserver();
    o.area("map", "desert");
    o.observe(snap());
    const boss = (extra: Partial<SnapshotEntity>) => mon(9, 20, { boss: true, ...extra });
    expect(o.observe(snap({ entities: [boss({ bossAwake: false })] }))).toEqual([]);
    expect(o.observe(snap({ entities: [boss({ bossAwake: true })] }))).toEqual([{ k: "bossSeen", tier: 2, biome: "desert" }]);
    expect(o.observe(snap({ entities: [boss({ bossAwake: true, life: 90 })] }))).toEqual([{ k: "bossFight", tier: 2, biome: "desert" }]);
    expect(o.observe(snap({ entities: [boss({ bossAwake: true, life: 50 })] }))).toEqual([]);
    o.area("map", "desert");
    o.observe(snap());
    expect(o.observe(snap({ entities: [boss({ bossAwake: true, life: 40 })] })).map((e) => e.k)).toEqual(["bossSeen", "bossFight"]);
  });

  it("calls an area change a portal only when the player stood at one", () => {
    const portal = (inRange: boolean) => ({ id: 3, kind: "portal", x: 1, y: 0, inRange }) as SnapshotEntity;
    const o = createGameObserver();
    o.area("hideout", null);
    o.observe(snap({ area: "hideout", entities: [portal(true)] }));
    o.area("map", "strand");
    expect(o.observe(snap()).map((e) => e.k)).toEqual(["portal", "area"]);
    // Dead, then back in the hideout through the death screen: no portal was walked.
    o.observe(snap({ entities: [portal(false)], player: { alive: false } }));
    o.area("hideout", null);
    expect(o.observe(snap({ area: "hideout" })).map((e) => e.k)).toEqual(["area"]);
  });

  it("emits the portal before the area it leads to, with where it led", () => {
    const o = createGameObserver();
    o.area("hideout", null);
    o.observe(snap({ area: "hideout", entities: [{ id: 3, kind: "portal", x: 0, y: 0, inRange: true } as SnapshotEntity] }));
    o.area("map", "swamp");
    expect(o.observe(snap())[0]).toEqual({ k: "portal", to: "map" });
  });

  it("counts containers opened since the last beat into the beat's context", () => {
    const box = (id: number, opened: boolean) => ({ id, kind: "container", x: 0, y: 0, opened }) as SnapshotEntity;
    const o = createGameObserver();
    o.area("map", "forest");
    o.observe(snap({ entities: [box(1, true), box(2, false), box(3, false)] }));
    o.observe(snap({ entities: [box(1, true), box(2, true), box(3, false)] }));
    o.observe(snap({ entities: [box(1, true), box(2, true), box(3, true)] }));
    expect(o.takeCaches()).toBe(2);
    expect(o.takeCaches()).toBe(0);
  });

  it("reports the context a beat carries", () => {
    const o = createGameObserver();
    o.area("map", "forest");
    o.observe(snap({ areaTier: 3, player: { level: 9 } }));
    expect(o.context()).toEqual({ area: "map", biome: "forest", tier: 3, level: 9, classId: "class.stalker" });
  });
});
