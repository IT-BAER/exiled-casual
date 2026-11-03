import { describe, it, expect } from "vitest";
import type { Item } from "@exiled/content-schema";
import { cartographerPrice, vendorSellPrice, CARTOGRAPHER_ROTATE_TICKS, CARTOGRAPHER_STOCK_MIN, CARTOGRAPHER_STOCK_MAX } from "@exiled/rules";
import { CONTENT_VERSION, isWaystone } from "@exiled/content-runtime";
import { MemoryKv } from "@exiled/persistence";
import { createCombatSim } from "./combat-sim";
import { intentToCommand, buildSnapshot } from "./protocol-bridge";
import { stockMapShop, restockMapShop } from "./vendor";
import { spawnPortalRing, MAP_DEVICE_POS, PORTAL_RADIUS } from "./areas";
import { saveTo, loadInto } from "./persist";
import type { InventoryC, VendorC, ProgressC, InteractableC, Position, BuybackC } from "./components";

function makeWorld() {
  return createCombatSim(7, { area: "hideout" });
}
type W = ReturnType<typeof makeWorld>["world"];
const sessionE = (world: W) => world.query("session")[0]!;
const getInv = (world: W) => world.get<InventoryC>(sessionE(world), "inventory")!;
const getShop = (world: W) => world.get<VendorC>(sessionE(world), "mapShop")!;
const getGold = (world: W) => world.get<ProgressC>(sessionE(world), "progress")!.gold;
function setGold(world: W, gold: number) {
  const p = world.get<ProgressC>(sessionE(world), "progress")!;
  world.set<ProgressC>(sessionE(world), "progress", { ...p, gold });
}
const dist = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.y - b.y) / 1000;
const stone = (seed: number, tier: number): Item =>
  ({ baseId: "map.waystone", rarity: "normal", itemLevel: 1, affixes: [], waystone: { seed, tier } });
const WAND: Item = { baseId: "base.ember_wand", rarity: "magic", itemLevel: 10, affixes: [{ affixId: "mod.fire_dmg_1", value: 1 }] };

describe("Maren stands in the hideout", () => {
  it("near the map device and clear of every portal the device can open", () => {
    const { world } = makeWorld();
    spawnPortalRing(world, 6);
    const of = (kind: string) => world.query("interactable").filter((e) => world.get<InteractableC>(e, "interactable")!.kind === kind)
      .map((e) => world.get<Position>(e, "position")!);
    const [maren] = of("cartographer");
    expect(of("cartographer")).toHaveLength(1);
    expect(dist(maren!, MAP_DEVICE_POS)).toBeLessThanOrEqual(4.5);
    const portals = of("portal");
    expect(portals).toHaveLength(6);
    for (const p of portals) expect(dist(maren!, p)).toBeGreaterThan(PORTAL_RADIUS / 1000 + 1);
  });

  it("is a body the player walks round, and the walk to the device stays open", () => {
    const { world } = makeWorld();
    const [e] = world.query("interactable").filter((x) => world.get<InteractableC>(x, "interactable")!.kind === "cartographer");
    const p = world.get<Position>(e!, "position")!;
    // The lane from the arrival spot to the device: no point of it within a body of her.
    for (let t = 0; t <= 10; t++) {
      const at = { x: Math.round((MAP_DEVICE_POS.x * t) / 10), y: Math.round((MAP_DEVICE_POS.y * t) / 10) };
      expect(dist(at, p)).toBeGreaterThan(0.5 + 0.28 + 0.5);
    }
  });
});

describe("Maren's stock", () => {
  it("stands up with the session: six to ten waystones, priced in the snapshot at four times the counter", () => {
    const { world, sim } = makeWorld();
    const shop = getShop(world);
    expect(shop.items.length).toBeGreaterThanOrEqual(CARTOGRAPHER_STOCK_MIN);
    expect(shop.items.length).toBeLessThanOrEqual(CARTOGRAPHER_STOCK_MAX);
    expect(shop.items.every((p) => isWaystone(p.item))).toBe(true);
    const snap = buildSnapshot(world, sim, sim.tick, CONTENT_VERSION);
    expect(snap.mapShop!.items).toHaveLength(shop.items.length);
    expect(snap.mapShop!.items[0]!.price).toBe(cartographerPrice(shop.items[0]!.item));
    expect(snap.entities.some((e) => e.kind === "cartographer")).toBe(true);
  });

  it("is the same table for the same seed, level and rotation, and a new one for any other", () => {
    expect(stockMapShop(7, 10, 0)).toEqual(stockMapShop(7, 10, 0));
    expect(stockMapShop(7, 10, 1)).not.toEqual(stockMapShop(7, 10, 0));
    expect(stockMapShop(7, 11, 0)).not.toEqual(stockMapShop(7, 10, 0));
    expect(stockMapShop(8, 10, 0)).not.toEqual(stockMapShop(7, 10, 0));
  });

  it("rotates when ROTATE_TICKS have passed, and not a tick before", () => {
    const { world, sim } = makeWorld();
    const level = world.get<ProgressC>(sessionE(world), "progress")!.level;
    const first = getShop(world);
    while (sim.tick < CARTOGRAPHER_ROTATE_TICKS) sim.step([]);
    expect(getShop(world)).toEqual(first);
    sim.step([]);
    expect(getShop(world)).toEqual(stockMapShop(7, level, 1));
    expect(getShop(world)).not.toEqual(first);
  });

  it("restocks on a level-up at the current rotation", () => {
    const { world } = makeWorld();
    const before = getShop(world);
    restockMapShop(world, sessionE(world), 12, CARTOGRAPHER_ROTATE_TICKS * 2 + 5);
    expect(getShop(world)).toEqual(stockMapShop(7, 12, 2));
    expect(getShop(world)).not.toEqual(before);
  });

  it("keeps a purchase's hole across a save and load, and an older save gets a fresh table", async () => {
    const { sim, world, playerEntity } = makeWorld();
    const cell = getShop(world).items[0]!;
    setGold(world, cartographerPrice(cell.item));
    sim.step([intentToCommand({ kind: "buyItem", x: cell.x, y: cell.y, shop: "maps" }, playerEntity, 0)]);
    const kv = new MemoryKv();
    await saveTo(kv, world);
    const fresh = makeWorld();
    await loadInto(kv, fresh.world);
    expect(getShop(fresh.world)).toEqual(getShop(world));

    const old = JSON.parse((await kv.load())!) as Record<string, unknown>;
    delete old["mapShop"];
    const legacy = new MemoryKv();
    await legacy.save(JSON.stringify(old));
    const restored = makeWorld();
    expect(await loadInto(legacy, restored.world)).toBe(true);
    const level = restored.world.get<ProgressC>(sessionE(restored.world), "progress")!.level;
    expect(getShop(restored.world)).toEqual(stockMapShop(7, level, 0));
  });
});

describe("trading with Maren", () => {
  it("buying a waystone charges four times the counter's price and lands it in the backpack", () => {
    const { sim, world, playerEntity } = makeWorld();
    const cell = getShop(world).items[0]!;
    const price = cartographerPrice(cell.item);
    setGold(world, price + 3);
    sim.step([intentToCommand({ kind: "buyItem", x: cell.x, y: cell.y, shop: "maps" }, playerEntity, 0)]);
    expect(getGold(world)).toBe(3);
    expect(getInv(world).items.map((p) => p.item)).toContainEqual(cell.item);
    expect(getShop(world).items.some((p) => p.x === cell.x && p.y === cell.y)).toBe(false);
  });

  it("refuses a buy on the rotation tick: the stone clicked is gone, the cell's new one is not charged for", () => {
    const { sim, world, playerEntity } = makeWorld();
    const clicked = getShop(world).items[0]!;
    while (sim.tick < CARTOGRAPHER_ROTATE_TICKS) sim.step([]);
    setGold(world, 1_000_000);
    const before = getInv(world);
    sim.step([intentToCommand({ kind: "buyItem", x: clicked.x, y: clicked.y, shop: "maps", seed: clicked.item.waystone!.seed }, playerEntity, 0)]);
    expect(getGold(world)).toBe(1_000_000);
    expect(getInv(world)).toEqual(before);
  });

  it("sells the stone the seed names when the table has not turned", () => {
    const { sim, world, playerEntity } = makeWorld();
    const cell = getShop(world).items[0]!;
    setGold(world, cartographerPrice(cell.item));
    sim.step([intentToCommand({ kind: "buyItem", x: cell.x, y: cell.y, shop: "maps", seed: cell.item.waystone!.seed }, playerEntity, 0)]);
    expect(getGold(world)).toBe(0);
    expect(getInv(world).items.map((p) => p.item)).toContainEqual(cell.item);
  });

  it("refuses a purse one coin short", () => {
    const { sim, world, playerEntity } = makeWorld();
    const cell = getShop(world).items[0]!;
    setGold(world, cartographerPrice(cell.item) - 1);
    sim.step([intentToCommand({ kind: "buyItem", x: cell.x, y: cell.y, shop: "maps" }, playerEntity, 0)]);
    expect(getShop(world).items).toContainEqual(cell);
  });

  it("buys a waystone at the counter's sell value, onto the shared buyback page", () => {
    const { sim, world, playerEntity } = makeWorld();
    const s = stone(12345, 3);
    world.set<InventoryC>(sessionE(world), "inventory", { ...getInv(world), items: [{ x: 5, y: 3, w: 1, h: 1, item: s }] });
    setGold(world, 0);
    sim.step([intentToCommand({ kind: "sellItem", x: 5, y: 3, shop: "maps" }, playerEntity, 0)]);
    expect(getGold(world)).toBe(vendorSellPrice(s));
    expect(getInv(world).items).toHaveLength(0);
    expect(world.get<BuybackC>(sessionE(world), "buyback")!.items.map((p) => p.item)).toContainEqual(s);
  });

  it("refuses anything that is not a waystone, taking nothing and paying nothing", () => {
    const { sim, world, playerEntity } = makeWorld();
    world.set<InventoryC>(sessionE(world), "inventory", { ...getInv(world), items: [{ x: 0, y: 0, w: 1, h: 2, item: WAND }] });
    setGold(world, 0);
    sim.step([intentToCommand({ kind: "sellItem", x: 0, y: 0, shop: "maps" }, playerEntity, 0)]);
    expect(getGold(world)).toBe(0);
    expect(getInv(world).items).toHaveLength(1);
  });
});
