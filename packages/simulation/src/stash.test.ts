import { describe, it, expect } from "vitest";
import { MemoryKv } from "@exiled/persistence";
import type { Item } from "@exiled/content-schema";
import { createCombatSim } from "./combat-sim";
import { intentToCommand } from "./protocol-bridge";
import { saveTo, loadInto } from "./persist";
import type { InventoryC, StashC, InteractableC } from "./components";

const WAND: Item = { baseId: "base.emberwand", rarity: "normal", itemLevel: 65, affixes: [] };
const TRANSMUTE: Item = { baseId: "currency.transmutation", rarity: "normal", itemLevel: 1, affixes: [] };

function makeWorld() {
  return createCombatSim(7, { area: "hideout" });
}
type W = ReturnType<typeof makeWorld>["world"];

const sessionE = (world: W) => world.query("session")[0]!;
const getInv = (world: W) => world.get<InventoryC>(sessionE(world), "inventory")!;
const getStash = (world: W) => world.get<StashC>(sessionE(world), "stash")!;

function setInv(world: W, items: InventoryC["items"]) {
  world.set<InventoryC>(sessionE(world), "inventory", { ...getInv(world), items });
}
function setStash(world: W, items: StashC["items"]) {
  world.set<StashC>(sessionE(world), "stash", { ...getStash(world), items });
}

describe("stash - hideout interactable", () => {
  it("spawns exactly one stash beside the map device", () => {
    const { world } = makeWorld();
    const kinds = world.query("interactable").map((e) => world.get<InteractableC>(e, "interactable")!.kind);
    expect(kinds.filter((k) => k === "stash")).toHaveLength(1);
    expect(kinds.filter((k) => k === "mapDevice")).toHaveLength(1);
  });

  it("does not spawn a stash in a map area", () => {
    const { world } = createCombatSim(7, { area: "map" });
    const kinds = world.query("interactable").map((e) => world.get<InteractableC>(e, "interactable")!.kind);
    expect(kinds).not.toContain("stash");
  });
});

describe("stash - moveItem containers", () => {
  it("a move with no container fields still moves within the backpack", () => {
    const { sim, world, playerEntity } = makeWorld();
    setInv(world, [{ x: 0, y: 0, w: 1, h: 2, item: WAND }]);
    sim.step([intentToCommand({ kind: "moveItem", x: 0, y: 0, toX: 3, toY: 1 }, playerEntity, 0)]);
    expect(getInv(world).items).toEqual([{ x: 3, y: 1, w: 1, h: 2, item: WAND }]);
    expect(getStash(world).items).toEqual([]);
  });

  it("moves an item from the backpack into the stash", () => {
    const { sim, world, playerEntity } = makeWorld();
    setInv(world, [{ x: 0, y: 0, w: 1, h: 2, item: WAND }]);
    sim.step([intentToCommand(
      { kind: "moveItem", x: 0, y: 0, toX: 4, toY: 7, from: "backpack", to: "stash" }, playerEntity, 0)]);
    expect(getInv(world).items).toEqual([]);
    expect(getStash(world).items).toEqual([{ x: 4, y: 7, w: 1, h: 2, item: WAND }]);
  });

  it("moves an item from the stash back into the backpack", () => {
    const { sim, world, playerEntity } = makeWorld();
    setStash(world, [{ x: 4, y: 7, w: 1, h: 2, item: WAND }]);
    sim.step([intentToCommand(
      { kind: "moveItem", x: 4, y: 7, toX: 0, toY: 0, from: "stash", to: "backpack" }, playerEntity, 0)]);
    expect(getStash(world).items).toEqual([]);
    expect(getInv(world).items).toEqual([{ x: 0, y: 0, w: 1, h: 2, item: WAND }]);
  });

  it("moves within the stash", () => {
    const { sim, world, playerEntity } = makeWorld();
    setStash(world, [{ x: 0, y: 0, w: 1, h: 2, item: WAND }]);
    sim.step([intentToCommand(
      { kind: "moveItem", x: 0, y: 0, toX: 0, toY: 1, from: "stash", to: "stash" }, playerEntity, 0)]);
    expect(getStash(world).items).toEqual([{ x: 0, y: 1, w: 1, h: 2, item: WAND }]);
  });

  it("refuses a move onto an occupied cell and leaves both containers untouched", () => {
    const { sim, world, playerEntity } = makeWorld();
    setInv(world, [{ x: 0, y: 0, w: 1, h: 2, item: WAND }]);
    setStash(world, [{ x: 4, y: 7, w: 2, h: 2, item: { ...WAND, baseId: "base.cinder_cap" } }]);
    sim.step([intentToCommand(
      { kind: "moveItem", x: 0, y: 0, toX: 5, toY: 8, from: "backpack", to: "stash" }, playerEntity, 0)]);
    expect(getInv(world).items).toHaveLength(1);
    expect(getStash(world).items).toHaveLength(1);
  });

  it("refuses a move that would hang off the stash edge", () => {
    const { sim, world, playerEntity } = makeWorld();
    setInv(world, [{ x: 0, y: 0, w: 1, h: 2, item: WAND }]);
    const rows = getStash(world).rows;
    sim.step([intentToCommand(
      { kind: "moveItem", x: 0, y: 0, toX: 0, toY: rows - 1, from: "backpack", to: "stash" }, playerEntity, 0)]);
    expect(getStash(world).items).toEqual([]);
    expect(getInv(world).items).toHaveLength(1);
  });

  it("merges a currency stack onto the same currency already in the stash", () => {
    const { sim, world, playerEntity } = makeWorld();
    setInv(world, [{ x: 0, y: 0, w: 1, h: 1, item: TRANSMUTE, count: 3 }]);
    setStash(world, [{ x: 2, y: 2, w: 1, h: 1, item: TRANSMUTE, count: 5 }]);
    sim.step([intentToCommand(
      { kind: "moveItem", x: 0, y: 0, toX: 2, toY: 2, from: "backpack", to: "stash" }, playerEntity, 0)]);
    expect(getInv(world).items).toEqual([]);
    expect(getStash(world).items).toEqual([{ x: 2, y: 2, w: 1, h: 1, item: TRANSMUTE, count: 8 }]);
  });

  it("does not merge two different currencies", () => {
    const { sim, world, playerEntity } = makeWorld();
    setInv(world, [{ x: 0, y: 0, w: 1, h: 1, item: TRANSMUTE, count: 3 }]);
    setStash(world, [{ x: 2, y: 2, w: 1, h: 1, item: { ...TRANSMUTE, baseId: "currency.alchemy" }, count: 5 }]);
    sim.step([intentToCommand(
      { kind: "moveItem", x: 0, y: 0, toX: 2, toY: 2, from: "backpack", to: "stash" }, playerEntity, 0)]);
    expect(getInv(world).items).toHaveLength(1);
    expect(getStash(world).items).toHaveLength(1);
  });
});

describe("stash - persistence", () => {
  it("survives a save/load round trip", async () => {
    const kv = new MemoryKv();
    const a = makeWorld();
    setStash(a.world, [{ x: 4, y: 7, w: 1, h: 2, item: WAND }]);
    await saveTo(kv, a.world);

    const b = makeWorld();
    expect(await loadInto(kv, b.world)).toBe(true);
    expect(getStash(b.world).items).toEqual([{ x: 4, y: 7, w: 1, h: 2, item: WAND }]);
  });

  it("loads a save written before the stash existed, as an empty stash", async () => {
    const kv = new MemoryKv();
    const a = makeWorld();
    await saveTo(kv, a.world);
    const raw = JSON.parse((await kv.load())!) as Record<string, unknown>;
    delete raw["stash"];
    await kv.save(JSON.stringify(raw));

    const b = makeWorld();
    setStash(b.world, [{ x: 0, y: 0, w: 1, h: 2, item: WAND }]);
    expect(await loadInto(kv, b.world)).toBe(true);
    expect(getStash(b.world).items).toEqual([]);
  });
});
