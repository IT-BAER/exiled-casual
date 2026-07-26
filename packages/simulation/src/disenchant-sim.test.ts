import { describe, it, expect } from "vitest";
import { MemoryKv } from "@exiled/persistence";
import type { Item } from "@exiled/content-schema";
import { createCombatSim } from "./combat-sim";
import { intentToCommand } from "./protocol-bridge";
import { saveTo, loadInto } from "./persist";
import type { InventoryC, StashC, ShardsC } from "./components";

// A rare wand, identifiable, non-currency, yields 1 Elevation shard.
const RARE_WAND: Item = {
  baseId: "base.emberwand",
  rarity: "rare",
  itemLevel: 65,
  affixes: [
    { affixId: "mod.fire_dmg_1", value: 1 },
    { affixId: "mod.cast_speed_1", value: 1 },
  ],
};

// A magic wand, yields 1 Transmutation shard.
const MAGIC_WAND: Item = {
  baseId: "base.emberwand",
  rarity: "magic",
  itemLevel: 65,
  affixes: [{ affixId: "mod.fire_dmg_1", value: 1 }],
};

// A normal item, disenchantYield returns null.
const NORMAL_WAND: Item = { baseId: "base.emberwand", rarity: "normal", itemLevel: 65, affixes: [] };

// An unidentified rare, disenchantYield returns null.
const UNID_WAND: Item = { baseId: "base.emberwand", rarity: "rare", itemLevel: 65, affixes: [], unidentified: true };

// Currency, disenchantYield returns null.
const TRANSMUTE: Item = { baseId: "currency.transmutation", rarity: "normal", itemLevel: 1, affixes: [] };

function makeWorld() {
  return createCombatSim(7, { area: "hideout" });
}
type W = ReturnType<typeof makeWorld>["world"];

const sessionE = (world: W) => world.query("session")[0]!;
const getInv = (world: W) => world.get<InventoryC>(sessionE(world), "inventory")!;
const getStash = (world: W) => world.get<StashC>(sessionE(world), "stash")!;
const getShards = (world: W) => world.get<ShardsC>(sessionE(world), "shards")!;

function setInv(world: W, items: InventoryC["items"]) {
  world.set<InventoryC>(sessionE(world), "inventory", { ...getInv(world), items });
}
function setStash(world: W, items: StashC["items"]) {
  world.set<StashC>(sessionE(world), "stash", { ...getStash(world), items });
}
function setShards(world: W, counts: Record<string, number>) {
  world.set<ShardsC>(sessionE(world), "shards", { counts });
}

describe("disenchant - sell from backpack", () => {
  it("removes a rare from the backpack and banks 1 elevation shard", () => {
    const { sim, world, playerEntity } = makeWorld();
    setInv(world, [{ x: 0, y: 0, w: 1, h: 2, item: RARE_WAND }]);
    sim.step([intentToCommand({ kind: "sellItem", x: 0, y: 0 }, playerEntity, 0)]);
    expect(getInv(world).items).toHaveLength(0);
    expect(getShards(world).counts["currency.elevation"]).toBe(1);
  });

  it("sells from the stash via from: stash", () => {
    const { sim, world, playerEntity } = makeWorld();
    setStash(world, [{ x: 0, y: 0, w: 1, h: 2, item: RARE_WAND }]);
    sim.step([intentToCommand({ kind: "sellItem", x: 0, y: 0, from: "stash" }, playerEntity, 0)]);
    expect(getStash(world).items).toHaveLength(0);
    expect(getShards(world).counts["currency.elevation"]).toBe(1);
  });
});

describe("disenchant - shard-to-orb conversion", () => {
  it("ten elevation shards mint one Orb of Elevation into the backpack leaving 0 behind", () => {
    const { sim, world, playerEntity } = makeWorld();
    // Pre-bank 9 shards then sell one rare to push it to 10.
    setShards(world, { "currency.elevation": 9 });
    setInv(world, [{ x: 0, y: 0, w: 1, h: 2, item: RARE_WAND }]);
    sim.step([intentToCommand({ kind: "sellItem", x: 0, y: 0 }, playerEntity, 0)]);
    expect(getShards(world).counts["currency.elevation"]).toBe(0);
    const inv = getInv(world);
    const orb = inv.items.find((p) => p.item.baseId === "currency.elevation");
    expect(orb).toBeDefined();
    expect(orb!.count).toBe(1);
  });

  it("an eleventh shard banks 1 after minting the orb", () => {
    const { sim, world, playerEntity } = makeWorld();
    // Pre-bank 10 and sell a magic to get 11 total; one orb mints, 1 stays.
    setShards(world, { "currency.transmutation": 10 });
    setInv(world, [{ x: 0, y: 0, w: 1, h: 2, item: MAGIC_WAND }]);
    sim.step([intentToCommand({ kind: "sellItem", x: 0, y: 0 }, playerEntity, 0)]);
    expect(getShards(world).counts["currency.transmutation"]).toBe(1);
    const inv = getInv(world);
    const orb = inv.items.find((p) => p.item.baseId === "currency.transmutation");
    expect(orb!.count).toBe(1);
  });

  it("selling into an existing orb stack bumps its count, not a second cell", () => {
    const { sim, world, playerEntity } = makeWorld();
    // Place an existing stack of 2 elevation orbs.
    setInv(world, [
      { x: 0, y: 0, w: 1, h: 1, item: { baseId: "currency.elevation", rarity: "normal", itemLevel: 1, affixes: [] }, count: 2 },
      { x: 1, y: 0, w: 1, h: 2, item: RARE_WAND },
    ]);
    setShards(world, { "currency.elevation": 9 });
    sim.step([intentToCommand({ kind: "sellItem", x: 1, y: 0 }, playerEntity, 0)]);
    const inv = getInv(world);
    const elevCells = inv.items.filter((p) => p.item.baseId === "currency.elevation");
    expect(elevCells).toHaveLength(1);
    expect(elevCells[0]!.count).toBe(3);
  });
});

describe("disenchant - refused items", () => {
  it("leaves a normal item in place and banks no shards", () => {
    const { sim, world, playerEntity } = makeWorld();
    setInv(world, [{ x: 0, y: 0, w: 1, h: 2, item: NORMAL_WAND }]);
    sim.step([intentToCommand({ kind: "sellItem", x: 0, y: 0 }, playerEntity, 0)]);
    expect(getInv(world).items).toHaveLength(1);
    expect(getShards(world).counts).toEqual({});
  });

  it("leaves an unidentified item in place and banks no shards", () => {
    const { sim, world, playerEntity } = makeWorld();
    setInv(world, [{ x: 0, y: 0, w: 1, h: 2, item: UNID_WAND }]);
    sim.step([intentToCommand({ kind: "sellItem", x: 0, y: 0 }, playerEntity, 0)]);
    expect(getInv(world).items).toHaveLength(1);
    expect(getShards(world).counts).toEqual({});
  });
});

describe("disenchant - persistence", () => {
  it("survives a save/load round-trip with banked shards", async () => {
    const kv = new MemoryKv();
    const a = makeWorld();
    setShards(a.world, { "currency.elevation": 3 });
    await saveTo(kv, a.world);

    const b = makeWorld();
    expect(await loadInto(kv, b.world)).toBe(true);
    expect(getShards(b.world).counts["currency.elevation"]).toBe(3);
  });

  it("loads a save with no shards field as empty counts", async () => {
    const kv = new MemoryKv();
    const a = makeWorld();
    await saveTo(kv, a.world);
    const raw = JSON.parse((await kv.load())!) as Record<string, unknown>;
    delete raw["shards"];
    await kv.save(JSON.stringify(raw));

    const b = makeWorld();
    setShards(b.world, { "currency.elevation": 5 });
    expect(await loadInto(kv, b.world)).toBe(true);
    expect(getShards(b.world).counts).toEqual({});
  });
});
