import { PICKUP_RADIUS } from "@exiled/protocol";
import { Simulation } from "../loop";
import { inRangeOf } from "../protocol-bridge";
import { placeFirstFit } from "../inventory";
import type { Position, ItemC, InventoryC } from "../components";

export function registerPickupSystem(sim: Simulation): void {
  sim.register("pickup", (world, _tick, commands) => {
    const sessionE = world.query("session")[0];
    if (sessionE === undefined) return;

    for (const cmd of commands) {
      if (cmd.type !== "pickupItem" || cmd.entity === undefined) continue;
      const targetId = cmd.data?.["entityId"];
      if (targetId === undefined) continue;
      if (!world.alive.has(targetId)) continue;
      if (!world.has(targetId, "item") || !world.has(targetId, "position")) continue;

      const playerPos = world.get<Position>(cmd.entity, "position");
      const itemPos = world.get<Position>(targetId, "position");
      if (!playerPos || !itemPos) continue;
      if (!inRangeOf(playerPos.x, playerPos.y, itemPos.x, itemPos.y, PICKUP_RADIUS)) continue;

      const ic = world.get<ItemC>(targetId, "item")!;
      const inv = world.get<InventoryC>(sessionE, "inventory")!;
      const slot = placeFirstFit(inv, ic.w, ic.h);
      if (slot === null) continue; // no room: no-op, no ownership change

      world.set<InventoryC>(sessionE, "inventory", {
        ...inv,
        items: [...inv.items, { x: slot.x, y: slot.y, w: ic.w, h: ic.h, item: ic.item }],
      });
      world.destroy(targetId);
    }
  });
}
