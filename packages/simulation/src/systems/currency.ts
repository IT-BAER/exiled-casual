import { applyCurrency } from "@exiled/rules";
import { ITEM_POOLS, isCurrency, baseOf, isPermanentWaystone } from "@exiled/content-runtime";
import { fnv1a32 } from "../rng";
import { Simulation } from "../loop";
import type { InventoryC } from "../components";

/**
 * Spend one unit of a currency from one inventory cell onto the item in another
 * (docs/02 §8). The transform itself is pure and lives in `@exiled/rules`; this system
 * only owns what it costs, which is one unit off the stack, and only when the transform
 * says the preconditions held. A refused application charges nothing.
 */
export function registerCurrencySystem(sim: Simulation): void {
  sim.register("currency", (world, tick, commands) => {
    const sessionE = world.query("session")[0];
    if (sessionE === undefined) return;

    for (const cmd of commands) {
      if (cmd.type !== "applyCurrency") continue;
      const { fromX, fromY, x, y } = cmd.data ?? {};
      if (fromX === undefined || fromY === undefined || x === undefined || y === undefined) continue;

      const inv = world.get<InventoryC>(sessionE, "inventory")!;
      const src = inv.items.findIndex((p) => p.x === fromX && p.y === fromY);
      const dst = inv.items.findIndex((p) => p.x === x && p.y === y);
      if (src < 0 || dst < 0 || src === dst) continue;

      const currency = inv.items[src]!;
      const target = inv.items[dst]!;
      // Currency on currency is never a craft, whatever the transition table says.
      if (!isCurrency(currency.item) || isCurrency(target.item)) continue;
      // The permanent waystone is the one item in the game that stays white. It
      // is never consumed, so a rolled modifier on it would be a permanent one —
      // the floor under sustain would become the best stone anybody owns.
      if (isPermanentWaystone(target.item)) continue;

      // The base id is the currency id: content and rules agree on the namespace, so
      // nothing has to carry a second identifier through the wire.
      const currencyId = baseOf(currency.item.baseId).id;
      const seed = fnv1a32(`craft:${currencyId}:${tick}:${x}:${y}`);
      const crafted = applyCurrency(ITEM_POOLS, currencyId, target.item, seed);
      if (crafted === null) continue;

      const items = inv.items.slice();
      items[dst] = { ...target, item: crafted };
      const left = (currency.count ?? 1) - 1;
      if (left <= 0) items.splice(items.indexOf(currency), 1);
      else items[src] = { ...currency, count: left };

      world.set<InventoryC>(sessionE, "inventory", { ...inv, items });
    }
  });
}
