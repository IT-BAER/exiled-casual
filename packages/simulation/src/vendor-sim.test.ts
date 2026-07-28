import { describe, it, expect } from "vitest";
import type { Item } from "@exiled/content-schema";
import { vendorBuyPrice, vendorSellPrice, VENDOR_STOCK } from "@exiled/rules";
import { createCombatSim } from "./combat-sim";
import { intentToCommand } from "./protocol-bridge";
import { stockVendor } from "./vendor";
import { saveTo, loadInto } from "./persist";
import { MemoryKv } from "@exiled/persistence";
import type { InventoryC, VendorC, ProgressC } from "./components";

const RARE_WAND: Item = {
  baseId: "base.emberwand",
  rarity: "rare",
  itemLevel: 65,
  affixes: [{ affixId: "mod.fire_dmg_1", value: 1 }],
};
const NORMAL_WAND: Item = { baseId: "base.emberwand", rarity: "normal", itemLevel: 65, affixes: [] };
const UNID_WAND: Item = { ...RARE_WAND, unidentified: true };
const TRANSMUTE: Item = { baseId: "currency.transmutation", rarity: "normal", itemLevel: 1, affixes: [] };

function makeWorld() {
  return createCombatSim(7, { area: "hideout" });
}
type W = ReturnType<typeof makeWorld>["world"];

const sessionE = (world: W) => world.query("session")[0]!;
const getInv = (world: W) => world.get<InventoryC>(sessionE(world), "inventory")!;
const getVendor = (world: W) => world.get<VendorC>(sessionE(world), "vendor")!;
const getGold = (world: W) => world.get<ProgressC>(sessionE(world), "progress")!.gold;

function setInv(world: W, items: InventoryC["items"]) {
  world.set<InventoryC>(sessionE(world), "inventory", { ...getInv(world), items });
}
function setGold(world: W, gold: number) {
  const p = world.get<ProgressC>(sessionE(world), "progress")!;
  world.set<ProgressC>(sessionE(world), "progress", { ...p, gold });
}

describe("vendor stock", () => {
  it("stands a shelf up with the session", () => {
    const { world } = makeWorld();
    expect(getVendor(world).items).toHaveLength(VENDOR_STOCK);
  });

  it("stocks the same shelf for the same world seed", () => {
    expect(getVendor(createCombatSim(7, { area: "hideout" }).world).items)
      .toEqual(getVendor(createCombatSim(7, { area: "hideout" }).world).items);
  });

  it("restocks on a level-up, so the shop is worth walking back to", () => {
    const { world } = makeWorld();
    const before = getVendor(world).items;
    const p = world.get<ProgressC>(sessionE(world), "progress")!;
    world.set<ProgressC>(sessionE(world), "progress", { ...p, level: p.level + 1 });
    // The shelf is a function of the world seed and the level that asked for it.
    expect(stockVendor(7, p.level + 1).items).not.toEqual(before);
  });

  it("keeps the holes a purchase left across a save and load", async () => {
    const { sim, world, playerEntity } = makeWorld();
    const shelf = getVendor(world).items[0]!;
    setGold(world, vendorBuyPrice(shelf.item));
    sim.step([intentToCommand({ kind: "buyItem", x: shelf.x, y: shelf.y }, playerEntity, 0)]);

    const kv = new MemoryKv();
    await saveTo(kv, world);
    const fresh = makeWorld();
    await loadInto(kv, fresh.world);

    expect(getVendor(fresh.world).items).toHaveLength(VENDOR_STOCK - 1);
  });

  it("stocks a different shelf for a different world seed", () => {
    expect(getVendor(createCombatSim(7, { area: "hideout" }).world).items)
      .not.toEqual(getVendor(createCombatSim(8, { area: "hideout" }).world).items);
  });
});

describe("buyItem", () => {
  it("takes the gold and hands over the goods", () => {
    const { sim, world, playerEntity } = makeWorld();
    const shelf = getVendor(world).items[0]!;
    const price = vendorBuyPrice(shelf.item);
    setGold(world, price + 5);

    sim.step([intentToCommand({ kind: "buyItem", x: shelf.x, y: shelf.y }, playerEntity, 0)]);

    expect(getGold(world)).toBe(5);
    expect(getVendor(world).items.some((p) => p.x === shelf.x && p.y === shelf.y)).toBe(false);
    expect(getInv(world).items.map((p) => p.item)).toContainEqual(shelf.item);
  });

  it("refuses when the purse is one coin short, and takes nothing", () => {
    const { sim, world, playerEntity } = makeWorld();
    setInv(world, []);
    const shelf = getVendor(world).items[0]!;
    setGold(world, vendorBuyPrice(shelf.item) - 1);

    sim.step([intentToCommand({ kind: "buyItem", x: shelf.x, y: shelf.y }, playerEntity, 0)]);

    expect(getGold(world)).toBe(vendorBuyPrice(shelf.item) - 1);
    expect(getVendor(world).items).toHaveLength(VENDOR_STOCK);
    expect(getInv(world).items).toHaveLength(0);
  });

  it("refuses when the backpack has no room, and keeps the gold", () => {
    const { sim, world, playerEntity } = makeWorld();
    const shelf = getVendor(world).items[0]!;
    setGold(world, 999_999);
    // Wall the backpack off with 1x1 junk in every cell.
    const inv = getInv(world);
    setInv(world, Array.from({ length: inv.cols * inv.rows }, (_, i) => ({
      x: i % inv.cols, y: Math.trunc(i / inv.cols), w: 1, h: 1, item: NORMAL_WAND,
    })));

    sim.step([intentToCommand({ kind: "buyItem", x: shelf.x, y: shelf.y }, playerEntity, 0)]);

    expect(getGold(world)).toBe(999_999);
    expect(getVendor(world).items).toHaveLength(VENDOR_STOCK);
  });

  it("ignores an empty shelf cell", () => {
    const { sim, world, playerEntity } = makeWorld();
    setInv(world, []);
    setGold(world, 999_999);
    sim.step([intentToCommand({ kind: "buyItem", x: 11, y: 11 }, playerEntity, 0)]);
    expect(getGold(world)).toBe(999_999);
    expect(getInv(world).items).toHaveLength(0);
  });
});

describe("sellItem pays gold", () => {
  it("pays for a normal item the disenchanter would have refused", () => {
    const { sim, world, playerEntity } = makeWorld();
    setInv(world, [{ x: 0, y: 0, w: 1, h: 2, item: NORMAL_WAND }]);
    sim.step([intentToCommand({ kind: "sellItem", x: 0, y: 0 }, playerEntity, 0)]);
    expect(getInv(world).items).toHaveLength(0);
    expect(getGold(world)).toBe(vendorSellPrice(NORMAL_WAND));
  });

  it("pays gold and shards for one rare, because the bench and the till are one counter", () => {
    const { sim, world, playerEntity } = makeWorld();
    setInv(world, [{ x: 0, y: 0, w: 1, h: 2, item: RARE_WAND }]);
    sim.step([intentToCommand({ kind: "sellItem", x: 0, y: 0 }, playerEntity, 0)]);
    expect(getGold(world)).toBe(vendorSellPrice(RARE_WAND));
    expect(world.get<{ counts: Record<string, number> }>(sessionE(world), "shards")!.counts["currency.elevation"]).toBe(1);
  });

  it("still refuses an unread item and currency, paying nothing", () => {
    const { sim, world, playerEntity } = makeWorld();
    setInv(world, [
      { x: 0, y: 0, w: 1, h: 2, item: UNID_WAND },
      { x: 2, y: 0, w: 1, h: 1, item: TRANSMUTE },
    ]);
    sim.step([
      intentToCommand({ kind: "sellItem", x: 0, y: 0 }, playerEntity, 0),
      intentToCommand({ kind: "sellItem", x: 2, y: 0 }, playerEntity, 1),
    ]);
    expect(getInv(world).items).toHaveLength(2);
    expect(getGold(world)).toBe(0);
  });
});

describe("gold persistence", () => {
  it("survives a save and load", async () => {
    const { world } = makeWorld();
    setGold(world, 4242);
    const kv = new MemoryKv();
    await saveTo(kv, world);

    const fresh = makeWorld();
    await loadInto(kv, fresh.world);
    expect(getGold(fresh.world)).toBe(4242);
  });
});
