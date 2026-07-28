import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { MemoryKv } from "@exiled/persistence";
import type { Item } from "@exiled/content-schema";
import { createCombatSim } from "./combat-sim";
import { intentToCommand, buildSnapshot } from "./protocol-bridge";
import { saveTo, loadInto, VERSION } from "./persist";
import { canEquip, EQUIP_SLOTS_BY_CLASS } from "./equipment";
import { CONTENT_VERSION } from "@exiled/content-runtime";
import type { InventoryC, EquipmentC, Position, Health, Mana, DefensesC, OffenseC } from "./components";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// base.emberwand: itemClass="wand", w=1, h=2
const WAND: Item = { baseId: "base.emberwand", rarity: "normal", itemLevel: 65, affixes: [] };
// base.cinder_cap: itemClass="helmet", w=2, h=2
const HELMET: Item = { baseId: "base.cinder_cap", rarity: "normal", itemLevel: 65, affixes: [] };
// base.ashen_focus: itemClass="focus", w=2, h=2
const FOCUS: Item = { baseId: "base.ashen_focus", rarity: "normal", itemLevel: 65, affixes: [] };

function makeWorld() {
  return createCombatSim(7, { area: "hideout" });
}

function sessionE(world: ReturnType<typeof makeWorld>["world"]) {
  return world.query("session")[0]!;
}

function getInv(world: ReturnType<typeof makeWorld>["world"]): InventoryC {
  return world.get<InventoryC>(sessionE(world), "inventory")!;
}

function getEquip(world: ReturnType<typeof makeWorld>["world"]): EquipmentC {
  return world.get<EquipmentC>(sessionE(world), "equipment")!;
}

function placeInInv(
  world: ReturnType<typeof makeWorld>["world"],
  item: Item, x: number, y: number, w: number, h: number,
) {
  const inv = getInv(world);
  world.set<InventoryC>(sessionE(world), "inventory", {
    ...inv,
    items: [...inv.items, { x, y, w, h, item }],
  });
}

function clearInv(world: ReturnType<typeof makeWorld>["world"]) {
  const inv = getInv(world);
  world.set<InventoryC>(sessionE(world), "inventory", { ...inv, items: [] });
}

// ---------------------------------------------------------------------------
// canEquip / EQUIP_SLOTS_BY_CLASS unit tests
// ---------------------------------------------------------------------------

describe("canEquip", () => {
  it("allows wand in weapon1 and weapon2", () => {
    expect(canEquip("wand", "weapon1")).toBe(true);
    expect(canEquip("wand", "weapon2")).toBe(true);
  });

  it("rejects wand in helmet slot", () => {
    expect(canEquip("wand", "helmet")).toBe(false);
  });

  it("rejects unknown item class anywhere", () => {
    expect(canEquip("boots", "weapon1")).toBe(false);
    expect(canEquip("unknown", "helmet")).toBe(false);
  });

  it("allows helmet in helmet slot only", () => {
    expect(canEquip("helmet", "helmet")).toBe(true);
    expect(canEquip("helmet", "weapon1")).toBe(false);
  });

  it("EQUIP_SLOTS_BY_CLASS wand entry contains weapon1 and weapon2", () => {
    expect(EQUIP_SLOTS_BY_CLASS["wand"]).toContain("weapon1");
    expect(EQUIP_SLOTS_BY_CLASS["wand"]).toContain("weapon2");
  });
});

// ---------------------------------------------------------------------------
// equipItem intent
// ---------------------------------------------------------------------------

describe("equipment system — equipItem", () => {
  it("equips a wand from the grid into weapon1: removes from grid, fills slot", () => {
    const { sim, world, playerEntity } = makeWorld();
    clearInv(world);
    placeInInv(world, WAND, 0, 0, 1, 2);

    sim.step([intentToCommand({ kind: "equipItem", x: 0, y: 0, slot: "weapon1" }, playerEntity, 0)]);

    expect(getInv(world).items).toHaveLength(0);
    expect(getEquip(world).slots["weapon1"]?.baseId).toBe("base.emberwand");
  });

  it("rejects equipping a helmet into weapon1 (illegal class/slot pair)", () => {
    const { sim, world, playerEntity } = makeWorld();
    clearInv(world);
    placeInInv(world, HELMET, 0, 0, 2, 2);

    sim.step([intentToCommand({ kind: "equipItem", x: 0, y: 0, slot: "weapon1" }, playerEntity, 0)]);

    expect(getInv(world).items).toHaveLength(1); // unchanged
    expect(getEquip(world).slots["weapon1"]).toBeUndefined();
  });

  it("no-op when no item at the given origin cell", () => {
    const { sim, world, playerEntity } = makeWorld();

    sim.step([intentToCommand({ kind: "equipItem", x: 5, y: 3, slot: "weapon1" }, playerEntity, 0)]);

    expect(getEquip(world).slots["weapon1"]).toBeUndefined();
  });

  it("equipping into an occupied slot swaps the occupant back into the grid", () => {
    const { sim, world, playerEntity } = makeWorld();
    clearInv(world);

    // Equip first wand
    placeInInv(world, WAND, 0, 0, 1, 2);
    sim.step([intentToCommand({ kind: "equipItem", x: 0, y: 0, slot: "weapon1" }, playerEntity, 0)]);
    expect(getEquip(world).slots["weapon1"]?.itemLevel).toBe(65);

    // Equip second wand (different itemLevel to tell them apart)
    placeInInv(world, { ...WAND, itemLevel: 70 }, 0, 0, 1, 2);
    sim.step([intentToCommand({ kind: "equipItem", x: 0, y: 0, slot: "weapon1" }, playerEntity, 1)]);

    expect(getEquip(world).slots["weapon1"]?.itemLevel).toBe(70);
    expect(getInv(world).items).toHaveLength(1);
    expect(getInv(world).items[0]!.item.itemLevel).toBe(65); // first wand back in grid
  });

  it("rolls back entirely when displaced occupant does not fit back in the grid", () => {
    const { sim, world, playerEntity } = makeWorld();

    // Use a 1-col × 2-row inventory: exactly fits a wand (1x2), never a focus (2x2).
    world.set<InventoryC>(sessionE(world), "inventory", { cols: 1, rows: 2, items: [] });

    // Manually put a focus (2x2) into weapon1 (bypasses equip rules; tests rollback path only).
    world.set<EquipmentC>(sessionE(world), "equipment", { slots: { weapon1: FOCUS } });

    // Place a wand in the 1x2 inventory.
    placeInInv(world, WAND, 0, 0, 1, 2);

    // Try to equip the wand into weapon1. After removing wand from grid (empty), the
    // system tries to place the 2x2 focus back into a 1-col grid → fails → rollback.
    sim.step([intentToCommand({ kind: "equipItem", x: 0, y: 0, slot: "weapon1" }, playerEntity, 0)]);

    // Everything must be unchanged.
    expect(getInv(world).items).toHaveLength(1);
    expect(getInv(world).items[0]!.item.baseId).toBe("base.emberwand");
    expect(getEquip(world).slots["weapon1"]?.baseId).toBe("base.ashen_focus");
  });
});

// ---------------------------------------------------------------------------
// unequipItem intent
// ---------------------------------------------------------------------------

describe("equipment system — unequipItem", () => {
  it("unequip returns item to the grid", () => {
    const { sim, world, playerEntity } = makeWorld();
    clearInv(world);

    placeInInv(world, WAND, 0, 0, 1, 2);
    sim.step([intentToCommand({ kind: "equipItem", x: 0, y: 0, slot: "weapon1" }, playerEntity, 0)]);
    expect(getEquip(world).slots["weapon1"]).toBeDefined();

    sim.step([intentToCommand({ kind: "unequipItem", slot: "weapon1" }, playerEntity, 1)]);

    expect(getEquip(world).slots["weapon1"]).toBeUndefined();
    expect(getInv(world).items).toHaveLength(1);
    expect(getInv(world).items[0]!.item.baseId).toBe("base.emberwand");
  });

  it("no-op when the slot is already empty", () => {
    const { sim, world, playerEntity } = makeWorld();
    clearInv(world);

    sim.step([intentToCommand({ kind: "unequipItem", slot: "weapon1" }, playerEntity, 0)]);

    expect(getEquip(world).slots["weapon1"]).toBeUndefined();
    expect(getInv(world).items).toHaveLength(0);
  });

  it("no-op when inventory is full (item stays equipped)", () => {
    const { sim, world, playerEntity } = makeWorld();

    // Use a 1x1 inventory (too small for any real item).
    world.set<InventoryC>(sessionE(world), "inventory", { cols: 1, rows: 1, items: [] });
    world.set<EquipmentC>(sessionE(world), "equipment", { slots: { weapon1: WAND } });

    // Wand is 1x2 → h=2 > rows=1 → placeFirstFit returns null → no-op.
    sim.step([intentToCommand({ kind: "unequipItem", slot: "weapon1" }, playerEntity, 0)]);

    expect(getEquip(world).slots["weapon1"]?.baseId).toBe("base.emberwand");
    expect(getInv(world).items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// moveItem intent
// ---------------------------------------------------------------------------

describe("equipment system - moveItem", () => {
  it("moves an item to a free rectangle", () => {
    const { sim, world, playerEntity } = makeWorld();
    clearInv(world);
    placeInInv(world, WAND, 0, 0, 1, 2);

    sim.step([intentToCommand({ kind: "moveItem", x: 0, y: 0, toX: 3, toY: 1 }, playerEntity, 0)]);

    const items = getInv(world).items;
    expect(items).toHaveLength(1);
    expect({ x: items[0]!.x, y: items[0]!.y }).toEqual({ x: 3, y: 1 });
  });

  it("refuses a destination that collides with another item", () => {
    const { sim, world, playerEntity } = makeWorld();
    clearInv(world);
    placeInInv(world, WAND, 0, 0, 1, 2);
    placeInInv(world, WAND, 3, 1, 1, 2);

    sim.step([intentToCommand({ kind: "moveItem", x: 0, y: 0, toX: 3, toY: 2 }, playerEntity, 0)]);

    expect(getInv(world).items.map((p) => ({ x: p.x, y: p.y }))).toEqual([{ x: 0, y: 0 }, { x: 3, y: 1 }]);
  });

  it("allows a destination that only overlaps the item's own old footprint", () => {
    const { sim, world, playerEntity } = makeWorld();
    clearInv(world);
    placeInInv(world, WAND, 0, 0, 1, 2);

    sim.step([intentToCommand({ kind: "moveItem", x: 0, y: 0, toX: 0, toY: 1 }, playerEntity, 0)]);

    expect(getInv(world).items[0]!.y).toBe(1);
  });

  it("refuses a destination that hangs off the grid", () => {
    const { sim, world, playerEntity } = makeWorld();
    clearInv(world);
    const inv = getInv(world);
    placeInInv(world, WAND, 0, 0, 1, 2);

    sim.step([intentToCommand({ kind: "moveItem", x: 0, y: 0, toX: inv.cols - 1, toY: inv.rows - 1 }, playerEntity, 0)]);

    expect({ x: getInv(world).items[0]!.x, y: getInv(world).items[0]!.y }).toEqual({ x: 0, y: 0 });
  });
});

// ---------------------------------------------------------------------------
// dropItem intent
// ---------------------------------------------------------------------------

describe("equipment system — dropItem", () => {
  it("removes item from grid and spawns a groundItem entity at the player position", () => {
    const { sim, world, playerEntity } = makeWorld();
    clearInv(world);
    placeInInv(world, WAND, 0, 0, 1, 2);

    const playerPos = world.get<Position>(playerEntity, "position")!;
    sim.step([intentToCommand({ kind: "dropItem", x: 0, y: 0 }, playerEntity, 0)]);

    expect(getInv(world).items).toHaveLength(0);

    const groundItems = world.query("item", "position");
    expect(groundItems).toHaveLength(1);
    const pos = world.get<Position>(groundItems[0]!, "position")!;
    expect(pos.x).toBe(playerPos.x);
    expect(pos.y).toBe(playerPos.y);
  });

  it("no-op when no item at the given origin cell", () => {
    const { sim, world, playerEntity } = makeWorld();
    clearInv(world);

    sim.step([intentToCommand({ kind: "dropItem", x: 3, y: 2 }, playerEntity, 0)]);

    expect(getInv(world).items).toHaveLength(0);
    expect(world.query("item", "position")).toHaveLength(0);
  });

  it("dropped item is pickup-able by the existing pickup path", () => {
    const { sim, world, playerEntity } = makeWorld();
    clearInv(world);
    placeInInv(world, WAND, 0, 0, 1, 2);

    // Drop it (player at origin, item spawns at origin).
    sim.step([intentToCommand({ kind: "dropItem", x: 0, y: 0 }, playerEntity, 0)]);
    expect(getInv(world).items).toHaveLength(0);

    const groundEntity = world.query("item", "position")[0]!;
    // Pick it back up.
    sim.step([intentToCommand({ kind: "pickupItem", entityId: groundEntity }, playerEntity, 1)]);

    expect(getInv(world).items).toHaveLength(1);
    expect(world.alive.has(groundEntity)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Snapshot — equipment field
// ---------------------------------------------------------------------------

describe("buildSnapshot — equipment", () => {
  it("snapshot.equipment is empty when no slots are filled", () => {
    const { world, sim } = makeWorld();
    const snap = buildSnapshot(world, sim, 0, CONTENT_VERSION);
    expect(snap.equipment).toEqual({});
  });

  it("snapshot.equipment reflects a filled slot with display-ready fields", () => {
    const { world, sim } = makeWorld();
    world.set<EquipmentC>(sessionE(world), "equipment", { slots: { weapon1: WAND } });

    const snap = buildSnapshot(world, sim, 0, CONTENT_VERSION);
    expect(snap.equipment["weapon1"]).toBeDefined();
    expect(snap.equipment["weapon1"]!.name).toBe("Ember Wand");
    expect(snap.equipment["weapon1"]!.rarity).toBe("normal");
    expect(snap.equipment["weapon1"]!.itemClass).toBe("wand");
  });

  it("carries the base id, which is what the renderer dresses the character from", () => {
    const { world, sim } = makeWorld();
    world.set<EquipmentC>(sessionE(world), "equipment", { slots: { body: GEARED_ROBE } });

    const snap = buildSnapshot(world, sim, 0, CONTENT_VERSION);
    // Each armour base has its own baked texture, so an equipped slot that
    // reaches the client without its base id renders as the authored outfit.
    expect(snap.equipment["body"]!.baseId).toBe("base.emberweave_robe");
  });
});

// ---------------------------------------------------------------------------
// Derived stats: an equipped mod has to reach the player, not just the tooltip
// ---------------------------------------------------------------------------

/** A robe (implicit 45% mana regen) carrying +40 life, +20 fire res and +50 armour. */
const GEARED_ROBE: Item = {
  baseId: "base.emberweave_robe", rarity: "rare", itemLevel: 80,
  affixes: [
    { affixId: "affix.life", value: 40 },
    { affixId: "affix.fire_res", value: 20 },
    { affixId: "affix.armour", value: 50 },
  ],
};

describe("derived player stats", () => {
  it("a bare player has exactly the base stat block", () => {
    const { world, playerEntity } = makeWorld();
    expect(world.get<Health>(playerEntity, "health")!.maxLife).toBe(fp(100));
    expect(world.get<DefensesC>(playerEntity, "defenses")!.armour).toBe(fp(0));
    expect(world.has(playerEntity, "offense")).toBe(false);
  });

  it("equipping raises maxLife, armour and fire resistance", () => {
    const { world, sim, playerEntity } = makeWorld();
    clearInv(world);
    placeInInv(world, GEARED_ROBE, 0, 0, 2, 3);
    sim.step([intentToCommand({ kind: "equipItem", x: 0, y: 0, slot: "body" }, playerEntity, 0)]);

    expect(world.get<Health>(playerEntity, "health")!.maxLife).toBe(fp(140));
    expect(world.get<DefensesC>(playerEntity, "defenses")!.armour).toBe(fp(50));
    expect(world.get<DefensesC>(playerEntity, "defenses")!.res.fire).toBe(20);
  });

  it("the base implicit applies too: the robe's 45% mana regeneration", () => {
    const { world, sim, playerEntity } = makeWorld();
    clearInv(world);
    placeInInv(world, GEARED_ROBE, 0, 0, 2, 3);
    sim.step([intentToCommand({ kind: "equipItem", x: 0, y: 0, slot: "body" }, playerEntity, 0)]);

    // base fp(15)/s * 1.45 = fp(21.75)/s → trunc(21750 / 30) = 725 per tick
    expect(world.get<Mana>(playerEntity, "mana")!.regen).toBe(725);
  });

  it("the wand implicit gives the player spell damage", () => {
    const { world, sim, playerEntity } = makeWorld();
    clearInv(world);
    placeInInv(world, WAND, 0, 0, 1, 2);
    sim.step([intentToCommand({ kind: "equipItem", x: 0, y: 0, slot: "weapon1" }, playerEntity, 0)]);

    expect(world.get<OffenseC>(playerEntity, "offense")!.spellDamagePct).toBe(12);
  });

  it("unequipping takes the mods back off", () => {
    const { world, sim, playerEntity } = makeWorld();
    clearInv(world);
    placeInInv(world, GEARED_ROBE, 0, 0, 2, 3);
    sim.step([intentToCommand({ kind: "equipItem", x: 0, y: 0, slot: "body" }, playerEntity, 0)]);
    sim.step([intentToCommand({ kind: "unequipItem", slot: "body" }, playerEntity, 1)]);

    expect(world.get<Health>(playerEntity, "health")!.maxLife).toBe(fp(100));
    expect(world.get<DefensesC>(playerEntity, "defenses")!.armour).toBe(fp(0));
    expect(world.get<DefensesC>(playerEntity, "defenses")!.res.fire).toBe(0);
  });

  it("keeps current life where it was, so equipping never heals", () => {
    const { world, sim, playerEntity } = makeWorld();
    clearInv(world);
    const h = world.get<Health>(playerEntity, "health")!;
    world.set<Health>(playerEntity, "health", { ...h, life: fp(30) });
    placeInInv(world, GEARED_ROBE, 0, 0, 2, 3);
    sim.step([intentToCommand({ kind: "equipItem", x: 0, y: 0, slot: "body" }, playerEntity, 0)]);

    expect(world.get<Health>(playerEntity, "health")!.life).toBe(fp(30));
    expect(world.get<Health>(playerEntity, "health")!.maxLife).toBe(fp(140));
  });

  it("clamps current life down when the life mod comes off", () => {
    const { world, sim, playerEntity } = makeWorld();
    clearInv(world);
    placeInInv(world, GEARED_ROBE, 0, 0, 2, 3);
    sim.step([intentToCommand({ kind: "equipItem", x: 0, y: 0, slot: "body" }, playerEntity, 0)]);
    const h = world.get<Health>(playerEntity, "health")!;
    world.set<Health>(playerEntity, "health", { ...h, life: h.maxLife });
    sim.step([intentToCommand({ kind: "unequipItem", slot: "body" }, playerEntity, 1)]);

    expect(world.get<Health>(playerEntity, "health")!.life).toBe(fp(100));
  });

  it("the snapshot carries the totals the character sheet reads", () => {
    const { world, sim, playerEntity } = makeWorld();
    clearInv(world);
    placeInInv(world, GEARED_ROBE, 0, 0, 2, 3);
    sim.step([intentToCommand({ kind: "equipItem", x: 0, y: 0, slot: "body" }, playerEntity, 0)]);

    const s = buildSnapshot(world, sim, 1, CONTENT_VERSION).player.stats;
    expect(s.armour).toBe(50);
    // Armour's share depends on the hit, so the sheet quotes SHEET_REFERENCE_HIT:
    // 50 / (50 + 10 * 6) = 45%.
    expect(s.armourPct).toBe(45);
    expect(s.res.fire).toBe(20);
    // trunc(fp(21.75)/30) = 725 per tick, so the sheet reports 725*30 = fp(21.75)/s.
    expect(s.manaRegenPerSec).toBeCloseTo(21.75, 5);
    expect(s.spellDamagePct).toBe(0);
  });

  it("the sheet's fire resistance is the uncapped total, so overcapping is visible", () => {
    const { world, sim, playerEntity } = makeWorld();
    clearInv(world);
    const OVERCAP: Item = {
      baseId: "base.emberweave_robe", rarity: "rare", itemLevel: 80,
      affixes: [{ affixId: "affix.fire_res", value: 80 }],
    };
    placeInInv(world, OVERCAP, 0, 0, 2, 3);
    sim.step([intentToCommand({ kind: "equipItem", x: 0, y: 0, slot: "body" }, playerEntity, 0)]);

    expect(buildSnapshot(world, sim, 1, CONTENT_VERSION).player.stats.res.fire).toBe(80);
  });

  it("restoring a save applies the saved gear and starts the session full", async () => {
    const kv = new MemoryKv();
    const { world } = makeWorld();
    world.set<EquipmentC>(sessionE(world), "equipment", { slots: { body: GEARED_ROBE } });
    await saveTo(kv, world);

    const { world: w2, playerEntity: p2 } = makeWorld();
    expect(await loadInto(kv, w2)).toBe(true);
    expect(w2.get<Health>(p2, "health")!.maxLife).toBe(fp(140));
    expect(w2.get<Health>(p2, "health")!.life).toBe(fp(140));
    expect(w2.get<DefensesC>(p2, "defenses")!.res.fire).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Persist round-trip
// ---------------------------------------------------------------------------

describe("persist — equipment", () => {
  it("round-trip preserves filled equipment slots", async () => {
    const kv = new MemoryKv();
    const { world } = makeWorld();
    world.set<EquipmentC>(sessionE(world), "equipment", { slots: { weapon1: WAND } });

    await saveTo(kv, world);

    const { world: w2 } = makeWorld();
    expect(await loadInto(kv, w2)).toBe(true);
    expect(w2.get<EquipmentC>(sessionE(w2), "equipment")!.slots["weapon1"]?.baseId)
      .toBe("base.emberwand");
  });

  it("old save without equipment field loads as empty slots (backwards compat)", async () => {
    const kv = new MemoryKv();
    // Manually write a current-version save with no equipment field.
    await kv.save(JSON.stringify({
      version: VERSION,
      session: {
        area: "hideout", atlasSeed: 0, mapSeed: 0, waystoneSeed: 0, areaTier: 0,
        activeNodeId: "", completedNodes: [], portalsLeft: 0, mapOpen: 0, pendingArea: "",
      },
      inventory: { cols: 12, rows: 5, items: [] },
    }));

    const { world } = makeWorld();
    expect(await loadInto(kv, world)).toBe(true);
    expect(world.get<EquipmentC>(sessionE(world), "equipment")!.slots).toEqual({});
  });
});
