import { baseOf } from "@exiled/content-runtime";
import { Simulation } from "../loop";
import { placeFirstFit } from "../inventory";
import { canEquip } from "../equipment";
import type { Position, ItemC, InventoryC, EquipmentC } from "../components";
import type { Item } from "@exiled/content-schema";

export function registerEquipmentSystem(sim: Simulation): void {
  sim.register("equipment", (world, _tick, commands) => {
    const sessionE = world.query("session")[0];
    if (sessionE === undefined) return;

    for (const cmd of commands) {
      if (cmd.entity === undefined) continue;

      // ── equipItem ──────────────────────────────────────────────────────────
      if (cmd.type === "equipItem") {
        const x = cmd.data?.["x"];
        const y = cmd.data?.["y"];
        const slot = cmd.slot;
        if (x === undefined || y === undefined || slot === undefined) continue;

        const inv = world.get<InventoryC>(sessionE, "inventory")!;
        const placed = inv.items.find((p) => p.x === x && p.y === y);
        if (!placed) continue;

        const base = baseOf(placed.item.baseId);
        if (!canEquip(base.itemClass, slot)) continue;

        const equip = world.get<EquipmentC>(sessionE, "equipment")!;
        const occupant: Item | undefined = equip.slots[slot];

        // Remove the equipping item from the grid.
        const afterRemoval = inv.items.filter((p) => !(p.x === x && p.y === y));

        if (occupant !== undefined) {
          // Try to place the displaced occupant back into the (post-removal) grid.
          const tempInv: InventoryC = { ...inv, items: afterRemoval };
          const occupantBase = baseOf(occupant.baseId);
          const fit = placeFirstFit(tempInv, occupantBase.w, occupantBase.h);
          if (fit === null) continue; // rollback: leave everything unchanged

          world.set<InventoryC>(sessionE, "inventory", {
            ...inv,
            items: [...afterRemoval, { x: fit.x, y: fit.y, w: occupantBase.w, h: occupantBase.h, item: occupant }],
          });
        } else {
          world.set<InventoryC>(sessionE, "inventory", { ...inv, items: afterRemoval });
        }

        world.set<EquipmentC>(sessionE, "equipment", {
          slots: { ...equip.slots, [slot]: placed.item },
        });
        continue;
      }

      // ── unequipItem ────────────────────────────────────────────────────────
      if (cmd.type === "unequipItem") {
        const slot = cmd.slot;
        if (slot === undefined) continue;

        const equip = world.get<EquipmentC>(sessionE, "equipment")!;
        const item: Item | undefined = equip.slots[slot];
        if (item === undefined) continue; // empty slot, no-op

        const inv = world.get<InventoryC>(sessionE, "inventory")!;
        const base = baseOf(item.baseId);
        const fit = placeFirstFit(inv, base.w, base.h);
        if (fit === null) continue; // no room, stay equipped

        const newSlots = { ...equip.slots };
        delete newSlots[slot];
        world.set<EquipmentC>(sessionE, "equipment", { slots: newSlots });
        world.set<InventoryC>(sessionE, "inventory", {
          ...inv,
          items: [...inv.items, { x: fit.x, y: fit.y, w: base.w, h: base.h, item }],
        });
        continue;
      }

      // ── dropItem ───────────────────────────────────────────────────────────
      if (cmd.type === "dropItem") {
        const x = cmd.data?.["x"];
        const y = cmd.data?.["y"];
        if (x === undefined || y === undefined) continue;

        const inv = world.get<InventoryC>(sessionE, "inventory")!;
        const placed = inv.items.find((p) => p.x === x && p.y === y);
        if (!placed) continue;

        const playerPos = world.get<Position>(cmd.entity, "position");
        if (!playerPos) continue;

        world.set<InventoryC>(sessionE, "inventory", {
          ...inv,
          items: inv.items.filter((p) => !(p.x === x && p.y === y)),
        });

        const ge = world.create();
        world.set<Position>(ge, "position", { x: playerPos.x, y: playerPos.y });
        world.set<ItemC>(ge, "item", { item: placed.item, w: placed.w, h: placed.h });
        continue;
      }
    }
  });
}
