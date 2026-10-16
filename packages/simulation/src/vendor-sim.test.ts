import { describe, it, expect } from "vitest";
import type { Item } from "@exiled/content-schema";
import { vendorBuyPrice, vendorSellPrice, VENDOR_STOCK, START_GOLD } from "@exiled/rules";
import { createCombatSim } from "./combat-sim";
import { intentToCommand, buildSnapshot } from "./protocol-bridge";
import { stockVendor, restockVendor, STAPLE_COUNT } from "./vendor";
import { saveTo, loadInto } from "./persist";
import { MemoryKv } from "@exiled/persistence";
import { CONTENT_VERSION } from "@exiled/content-runtime";
import type { InventoryC, VendorC, ProgressC, BuybackC, ShardsC } from "./components";

const RARE_WAND: Item = {
  baseId: "base.ember_wand",
  rarity: "rare",
  itemLevel: 65,
  affixes: [{ affixId: "mod.fire_dmg_1", value: 1 }],
};
const NORMAL_WAND: Item = { baseId: "base.ember_wand", rarity: "normal", itemLevel: 65, affixes: [] };
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
/** The whole shelf: the always-stocked staples plus the rolled goods. */
const SHELF = VENDOR_STOCK + STAPLE_COUNT;
/**
 * The first cell that is actually sold OUT of stock. The staples sit at the front
 * of the shelf and never leave it, so a test about a purchase emptying a cell has
 * to shop past them.
 */
const firstRolled = (world: W) => getVendor(world).items[STAPLE_COUNT]!;

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
    expect(getVendor(world).items).toHaveLength(SHELF);
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
    const shelf = firstRolled(world);
    setGold(world, vendorBuyPrice(shelf.item));
    sim.step([intentToCommand({ kind: "buyItem", x: shelf.x, y: shelf.y }, playerEntity, 0)]);

    const kv = new MemoryKv();
    await saveTo(kv, world);
    const fresh = makeWorld();
    await loadInto(kv, fresh.world);

    expect(getVendor(fresh.world).items).toHaveLength(SHELF - 1);
  });

  it("stocks a different shelf for a different world seed", () => {
    expect(getVendor(createCombatSim(7, { area: "hideout" }).world).items)
      .not.toEqual(getVendor(createCombatSim(8, { area: "hideout" }).world).items);
  });
});

describe("buyItem", () => {
  it("takes the gold and hands over the goods", () => {
    const { sim, world, playerEntity } = makeWorld();
    const shelf = firstRolled(world);
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
    const shelf = firstRolled(world);
    setGold(world, vendorBuyPrice(shelf.item) - 1);

    sim.step([intentToCommand({ kind: "buyItem", x: shelf.x, y: shelf.y }, playerEntity, 0)]);

    expect(getGold(world)).toBe(vendorBuyPrice(shelf.item) - 1);
    expect(getVendor(world).items).toHaveLength(SHELF);
    expect(getInv(world).items).toHaveLength(0);
  });

  it("refuses when the backpack has no room, and keeps the gold", () => {
    const { sim, world, playerEntity } = makeWorld();
    const shelf = firstRolled(world);
    setGold(world, 999_999);
    // Wall the backpack off with 1x1 junk in every cell.
    const inv = getInv(world);
    setInv(world, Array.from({ length: inv.cols * inv.rows }, (_, i) => ({
      x: i % inv.cols, y: Math.trunc(i / inv.cols), w: 1, h: 1, item: NORMAL_WAND,
    })));

    sim.step([intentToCommand({ kind: "buyItem", x: shelf.x, y: shelf.y }, playerEntity, 0)]);

    expect(getGold(world)).toBe(999_999);
    expect(getVendor(world).items).toHaveLength(SHELF);
  });

  it("always sells a Scroll of Wisdom and keeps it on the shelf", () => {
    const { sim, world, playerEntity } = makeWorld();
    const cell = getVendor(world).items.find((p) => p.item.baseId === "currency.wisdom")!;
    expect(cell).toBeDefined();
    setGold(world, vendorBuyPrice(cell.item));

    sim.step([intentToCommand({ kind: "buyItem", x: cell.x, y: cell.y }, playerEntity, 0)]);

    expect(getGold(world)).toBe(0);
    expect(getInv(world).items.map((p) => p.item.baseId)).toContain("currency.wisdom");
    expect(getVendor(world).items.some((p) => p.x === cell.x && p.y === cell.y)).toBe(true);
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
    expect(getGold(world)).toBe(START_GOLD + vendorSellPrice(NORMAL_WAND));
  });

  it("pays gold and shards for one rare, because the bench and the till are one counter", () => {
    const { sim, world, playerEntity } = makeWorld();
    setInv(world, [{ x: 0, y: 0, w: 1, h: 2, item: RARE_WAND }]);
    sim.step([intentToCommand({ kind: "sellItem", x: 0, y: 0 }, playerEntity, 0)]);
    expect(getGold(world)).toBe(START_GOLD + vendorSellPrice(RARE_WAND));
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
    expect(getGold(world)).toBe(START_GOLD);
  });
});

describe("buybackItem", () => {
  const getBuyback = (world: W) => world.get<BuybackC>(sessionE(world), "buyback")?.items ?? [];
  const getShards = (world: W) => world.get<ShardsC>(sessionE(world), "shards")!.counts;
  const sell = (f: ReturnType<typeof makeWorld>, x: number, y: number, tick = 0) =>
    f.sim.step([intentToCommand({ kind: "sellItem", x, y }, f.playerEntity, tick)]);
  const buyBack = (f: ReturnType<typeof makeWorld>, x: number, y: number, tick = 1) =>
    f.sim.step([intentToCommand({ kind: "buybackItem", x, y }, f.playerEntity, tick)]);

  it("undoes a sale exactly: the piece comes home, the gold and the shard go back", () => {
    const f = makeWorld();
    setInv(f.world, [{ x: 3, y: 1, w: 1, h: 2, item: RARE_WAND }]);
    sell(f, 3, 1);
    const entry = getBuyback(f.world)[0]!;
    expect(entry.item).toEqual(RARE_WAND);

    buyBack(f, entry.x, entry.y);

    expect(getInv(f.world).items.map((p) => p.item)).toEqual([RARE_WAND]);
    expect(getGold(f.world)).toBe(START_GOLD);
    expect(getShards(f.world)["currency.elevation"] ?? 0).toBe(0);
    expect(getBuyback(f.world)).toHaveLength(0);
  });

  it("takes back the orb the sale's shard completed", () => {
    const f = makeWorld();
    setInv(f.world, [{ x: 0, y: 0, w: 1, h: 2, item: RARE_WAND }]);
    f.world.set<ShardsC>(sessionE(f.world), "shards", { counts: { "currency.elevation": 9 } });
    sell(f, 0, 0);
    expect(getInv(f.world).items.map((p) => p.item.baseId)).toEqual(["currency.elevation"]);
    const entry = getBuyback(f.world)[0]!;

    buyBack(f, entry.x, entry.y);

    expect(getInv(f.world).items.map((p) => p.item)).toEqual([RARE_WAND]);
    expect(getShards(f.world)["currency.elevation"]).toBe(9);
    expect(getGold(f.world)).toBe(START_GOLD);
  });

  it("refuses, changing nothing, when that orb has already left the backpack", () => {
    const f = makeWorld();
    setInv(f.world, [{ x: 0, y: 0, w: 1, h: 2, item: RARE_WAND }]);
    f.world.set<ShardsC>(sessionE(f.world), "shards", { counts: { "currency.elevation": 9 } });
    sell(f, 0, 0);
    setInv(f.world, []);
    const entry = getBuyback(f.world)[0]!;

    buyBack(f, entry.x, entry.y);

    expect(getInv(f.world).items).toHaveLength(0);
    expect(getGold(f.world)).toBe(START_GOLD + vendorSellPrice(RARE_WAND));
    expect(getShards(f.world)["currency.elevation"]).toBe(0);
    expect(getBuyback(f.world)).toHaveLength(1);
  });

  it("refuses when the purse is one coin short of what the sale paid", () => {
    const f = makeWorld();
    setInv(f.world, [{ x: 0, y: 0, w: 1, h: 2, item: NORMAL_WAND }]);
    sell(f, 0, 0);
    setGold(f.world, vendorSellPrice(NORMAL_WAND) - 1);
    const entry = getBuyback(f.world)[0]!;

    buyBack(f, entry.x, entry.y);

    expect(getInv(f.world).items).toHaveLength(0);
    expect(getGold(f.world)).toBe(vendorSellPrice(NORMAL_WAND) - 1);
    expect(getBuyback(f.world)).toHaveLength(1);
  });

  it("refuses when the backpack has no room, and keeps the gold", () => {
    const f = makeWorld();
    setInv(f.world, [{ x: 0, y: 0, w: 1, h: 2, item: NORMAL_WAND }]);
    sell(f, 0, 0);
    const inv = getInv(f.world);
    setInv(f.world, Array.from({ length: inv.cols * inv.rows }, (_, i) => ({
      x: i % inv.cols, y: Math.trunc(i / inv.cols), w: 1, h: 1, item: NORMAL_WAND,
    })));
    const gold = getGold(f.world);
    const entry = getBuyback(f.world)[0]!;

    buyBack(f, entry.x, entry.y);

    expect(getGold(f.world)).toBe(gold);
    expect(getBuyback(f.world)).toHaveLength(1);
  });

  it("buys back a piece sold out of the stash into the backpack", () => {
    const f = makeWorld();
    setInv(f.world, []);
    f.world.set<InventoryC>(sessionE(f.world), "stash", { cols: 12, rows: 12, items: [{ x: 5, y: 5, w: 1, h: 2, item: NORMAL_WAND }] });
    f.sim.step([intentToCommand({ kind: "sellItem", x: 5, y: 5, from: "stash" }, f.playerEntity, 0)]);
    const entry = getBuyback(f.world)[0]!;

    buyBack(f, entry.x, entry.y);

    expect(getInv(f.world).items.map((p) => p.item)).toEqual([NORMAL_WAND]);
  });

  it("makes the oldest sales give way when the page is full", () => {
    const f = makeWorld();
    // A 12x8 page holds 48 wands of 1x2; the 49th sale pushes the first one out.
    const sold = Array.from({ length: 49 }, (_, i) => ({ ...NORMAL_WAND, itemLevel: i + 1 }));
    sold.forEach((item, i) => {
      setInv(f.world, [{ x: 0, y: 0, w: 1, h: 2, item }]);
      sell(f, 0, 0, i);
    });
    const kept = getBuyback(f.world).map((p) => p.item.itemLevel);
    expect(kept).toHaveLength(48);
    expect(kept).not.toContain(1);
    expect(kept).toContain(49);
  });

  it("empties when the vendor restocks", () => {
    const f = makeWorld();
    setInv(f.world, [{ x: 0, y: 0, w: 1, h: 2, item: NORMAL_WAND }]);
    sell(f, 0, 0);
    restockVendor(f.world, sessionE(f.world), 2);
    expect(getBuyback(f.world)).toHaveLength(0);
    expect(getVendor(f.world).items).toEqual(stockVendor(7, 2).items);
  });

  it("survives a save and load, and a save without one loads empty", async () => {
    const f = makeWorld();
    setInv(f.world, [{ x: 0, y: 0, w: 1, h: 2, item: RARE_WAND }]);
    sell(f, 0, 0);
    const kv = new MemoryKv();
    await saveTo(kv, f.world);

    const fresh = makeWorld();
    await loadInto(kv, fresh.world);
    expect(getBuyback(fresh.world)).toEqual(getBuyback(f.world));

    const old = JSON.parse((await kv.load())!) as Record<string, unknown>;
    delete old["buyback"];
    await kv.save(JSON.stringify(old));
    const older = makeWorld();
    await loadInto(kv, older.world);
    expect(getBuyback(older.world)).toHaveLength(0);
  });

  it("shows the page in the snapshot, priced at the sale, refused once the orb is gone", () => {
    const f = makeWorld();
    expect(buildSnapshot(f.world, f.sim, 0, CONTENT_VERSION).buyback?.items).toEqual([]);
    setInv(f.world, [{ x: 0, y: 0, w: 1, h: 2, item: RARE_WAND }]);
    f.world.set<ShardsC>(sessionE(f.world), "shards", { counts: { "currency.elevation": 9 } });
    sell(f, 0, 0);

    const page = () => buildSnapshot(f.world, f.sim, 1, CONTENT_VERSION).buyback!;
    expect(page()).toMatchObject({ cols: 12, rows: 8 });
    expect(page().items).toEqual([expect.objectContaining({ x: 0, y: 0, w: 1, h: 2, price: vendorSellPrice(RARE_WAND), refused: false })]);
    setInv(f.world, []);
    expect(page().items[0]!.refused).toBe(true);
  });

  it("leaves a sell and buy back loop gold- and shard-neutral", () => {
    const f = makeWorld();
    setInv(f.world, [{ x: 0, y: 0, w: 1, h: 2, item: RARE_WAND }]);
    for (let i = 0; i < 25; i++) {
      sell(f, getInv(f.world).items[0]!.x, getInv(f.world).items[0]!.y, 2 * i);
      const entry = getBuyback(f.world)[0]!;
      buyBack(f, entry.x, entry.y, 2 * i + 1);
    }
    expect(getGold(f.world)).toBe(START_GOLD);
    expect(getShards(f.world)["currency.elevation"] ?? 0).toBe(0);
    expect(getInv(f.world).items.map((p) => p.item)).toEqual([RARE_WAND]);
  });
});

describe("starting gold", () => {
  it("gives a fresh character enough to open the shop with", () => {
    const { world } = makeWorld();
    expect(getGold(world)).toBe(START_GOLD);
    expect(START_GOLD).toBeGreaterThan(0);
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
