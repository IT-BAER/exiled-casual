import { describe, it, expect } from "vitest";
import { MemoryKv } from "@exiled/persistence";
import { rollItem, areaLevel } from "@exiled/rules";
import { ITEM_POOLS, baseOf } from "@exiled/content-runtime";
import { createCombatSim } from "./combat-sim";
import { snapshot, restore, saveTo, loadInto } from "./persist";
import type { SessionC, InventoryC } from "./components";

function sessionEntity(world: ReturnType<typeof createCombatSim>["world"]) {
  return world.query("session")[0]!;
}
function getSession(world: ReturnType<typeof createCombatSim>["world"]): SessionC {
  return world.get<SessionC>(sessionEntity(world), "session")!;
}
function setSession(world: ReturnType<typeof createCombatSim>["world"], patch: Partial<SessionC>): void {
  const e = sessionEntity(world);
  world.set<SessionC>(e, "session", { ...world.get<SessionC>(e, "session")!, ...patch });
}

/** A real committed item placed in the inventory, so loot survival is genuine. */
function stashLoot(world: ReturnType<typeof createCombatSim>["world"]): void {
  const item = rollItem(ITEM_POOLS, 12345, areaLevel(1), 2);
  const base = baseOf(item.baseId);
  const e = sessionEntity(world);
  const inv = world.get<InventoryC>(e, "inventory")!;
  world.set<InventoryC>(e, "inventory", { ...inv, items: [...inv.items, { x: 0, y: 0, w: base.w, h: base.h, item }] });
}

describe("persist: snapshot/restore round-trip", () => {
  it("round-trips durable session + inventory through a blob", async () => {
    const kv = new MemoryKv();
    const { world } = createCombatSim(7, { area: "hideout" });
    setSession(world, { completedNodes: ["node-a"] });
    stashLoot(world);
    await saveTo(kv, world);

    const reboot = createCombatSim(7, { area: "hideout" });
    expect(await loadInto(kv, reboot.world)).toBe(true);
    expect(getSession(reboot.world).completedNodes).toEqual(["node-a"]);
    expect(reboot.world.get<InventoryC>(sessionEntity(reboot.world), "inventory")!.items).toHaveLength(1);
  });

  it("loadInto returns false when nothing was ever saved", async () => {
    const { world } = createCombatSim(7, { area: "hideout" });
    expect(await loadInto(new MemoryKv(), world)).toBe(false);
  });
});

// The spec §9.4 validation gate: a forced worker restart at any activation or
// finalization boundary cannot duplicate or lose inputs, loot, or progression.
describe("persist: run-transaction fault injection", () => {
  it("abandons an in-flight run on restart (no half-committed map)", async () => {
    const kv = new MemoryKv();
    const { world } = createCombatSim(7, { area: "hideout" });
    // Activation boundary: a run is open (map area, node active, portals held).
    setSession(world, { area: "map", activeNodeId: "node-x", mapOpen: 1, portalsLeft: 6, areaTier: 1, pendingArea: "" });
    await saveTo(kv, world);

    // Forced restart mid-run.
    const reboot = createCombatSim(7, { area: "hideout" }).world;
    expect(await loadInto(kv, reboot)).toBe(true);
    const s = getSession(reboot);
    expect(s.area).toBe("hideout");       // rolled back to safety
    expect(s.activeNodeId).toBe("");      // run abandoned, nothing half-committed
    expect(s.mapOpen).toBe(0);
    expect(s.completedNodes).toEqual([]); // uncompleted node did NOT commit
  });

  it("keeps a completed node and its loot exactly once across restart", async () => {
    const kv = new MemoryKv();
    const { world } = createCombatSim(7, { area: "hideout" });
    // Finalization boundary: boss died, node committed, loot in inventory.
    setSession(world, { completedNodes: ["node-x"] });
    stashLoot(world);
    await saveTo(kv, world);

    // Restart, then a SECOND restore into the same world (a replayed
    // finalization) must not double-apply — proves no duplication.
    const reboot = createCombatSim(7, { area: "hideout" }).world;
    expect(await loadInto(kv, reboot)).toBe(true);
    expect(await loadInto(kv, reboot)).toBe(true);
    const s = getSession(reboot);
    expect(s.completedNodes).toEqual(["node-x"]);                                    // progression kept, not duplicated
    expect(reboot.get<InventoryC>(sessionEntity(reboot), "inventory")!.items).toHaveLength(1); // loot kept, not duplicated
  });

  it("snapshot is null with no session singleton", () => {
    const { world } = createCombatSim(7); // no area opt -> no session
    expect(snapshot(world)).toBeNull();
  });

  it("restore is a no-op when the reboot world has no session", () => {
    const bare = createCombatSim(7).world;
    expect(() => restore(bare, { version: 1, session: {} as SessionC, inventory: {} as InventoryC })).not.toThrow();
  });
});
