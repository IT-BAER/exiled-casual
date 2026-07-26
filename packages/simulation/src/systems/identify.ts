import { WISDOM_SCROLL_BASE_ID } from "@exiled/content-runtime";
import { Simulation } from "../loop";
import type { InventoryC } from "../components";

/**
 * Scroll of Wisdom: one scroll reveals one item (docs/02 §8). The mods were rolled
 * at drop time and are only being uncovered here, so nothing about the item changes
 * except that it can finally be read.
 */
export function registerIdentifySystem(sim: Simulation): void {
  sim.register("identify", (world, _tick, commands) => {
    const sessionE = world.query("session")[0];
    if (sessionE === undefined) return;

    for (const cmd of commands) {
      if (cmd.type !== "identifyItem") continue;
      const x = cmd.data?.["x"];
      const y = cmd.data?.["y"];
      if (x === undefined || y === undefined) continue;

      const inv = world.get<InventoryC>(sessionE, "inventory")!;
      const target = inv.items.findIndex((p) => p.x === x && p.y === y);
      if (target < 0 || inv.items[target]!.item.unidentified !== true) continue;

      const scrolls = inv.items.findIndex((p) => p.item.baseId === WISDOM_SCROLL_BASE_ID);
      if (scrolls < 0) continue; // nothing to spend: no-op

      const items = inv.items.slice();
      const { unidentified: _spent, ...revealed } = items[target]!.item;
      items[target] = { ...items[target]!, item: revealed };
      const left = (items[scrolls]!.count ?? 1) - 1;
      if (left <= 0) items.splice(scrolls, 1);
      else items[scrolls] = { ...items[scrolls]!, count: left };

      world.set<InventoryC>(sessionE, "inventory", { ...inv, items });
    }
  });
}
