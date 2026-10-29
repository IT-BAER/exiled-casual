import { applyCurrency, craftWaystone } from "@exiled/rules";
import { ITEM_POOLS, isCurrency, baseOf, isPermanentWaystone } from "@exiled/content-runtime";
import { fnv1a32 } from "../rng";
import { Simulation } from "../loop";
import { recomputePlayerStats } from "../derived";
import type { InventoryC, EquipmentC } from "../components";
import type { Item } from "@exiled/content-schema";

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
      if (cmd.type !== "applyCurrency" && cmd.type !== "applyCurrencyAll") continue;
      const { fromX, fromY, x, y } = cmd.data ?? {};
      if (fromX === undefined || fromY === undefined) continue;
      let inv = world.get<InventoryC>(sessionE, "inventory")!;

      // A worn piece: the same craft, written back into its slot, and the sheet follows.
      if (cmd.type === "applyCurrency" && cmd.slot !== undefined) {
        const equip = world.get<EquipmentC>(sessionE, "equipment");
        const worn = equip?.slots[cmd.slot];
        const src = inv.items.findIndex((p) => p.x === fromX && p.y === fromY);
        if (!equip || !worn || src < 0) continue;
        const crafted = craft(inv.items[src]!.item, worn, `${tick}:slot:${cmd.slot}`);
        if (crafted === null) continue;
        world.set<EquipmentC>(sessionE, "equipment", { slots: { ...equip.slots, [cmd.slot]: crafted } });
        world.set<InventoryC>(sessionE, "inventory", spend(inv, src));
        recomputePlayerStats(world);
        continue;
      }

      if (cmd.type === "applyCurrency") {
        if (x === undefined || y === undefined) continue;
        const crafted = applyOnce(inv, fromX, fromY, x, y, tick);
        if (crafted) world.set<InventoryC>(sessionE, "inventory", crafted);
        continue;
      }

      // Shift: one unit per target in reading order, until the stack is gone.
      // Each target is its own single application, so it is refused or paid
      // exactly as a click on it would be.
      const targets = inv.items
        .filter((p) => p.x !== fromX || p.y !== fromY)
        .map((p) => [p.x, p.y] as const)
        .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      for (const [tx, ty] of targets) {
        if (!inv.items.some((p) => p.x === fromX && p.y === fromY)) break;
        inv = applyOnce(inv, fromX, fromY, tx, ty, tick) ?? inv;
      }
      world.set<InventoryC>(sessionE, "inventory", inv);
    }
  });
}

/** One unit of the currency at (fromX,fromY) onto the item at (x,y); null when refused. */
function applyOnce(inv: InventoryC, fromX: number, fromY: number, x: number, y: number, tick: number): InventoryC | null {
  const src = inv.items.findIndex((p) => p.x === fromX && p.y === fromY);
  const dst = inv.items.findIndex((p) => p.x === x && p.y === y);
  if (src < 0 || dst < 0 || src === dst) return null;

  const target = inv.items[dst]!;
  const crafted = craft(inv.items[src]!.item, target.item, `${tick}:${x}:${y}`);
  if (crafted === null) return null;

  const items = inv.items.slice();
  items[dst] = { ...target, item: crafted };
  return spend({ ...inv, items }, src);
}

/** What `currency` makes of `target`, or null when it refuses; `where` keys the seed. */
function craft(currency: Item, target: Item, where: string): Item | null {
  // Currency on currency is never a craft, whatever the transition table says.
  if (!isCurrency(currency) || isCurrency(target)) return null;
  // The permanent waystone is the one item in the game that stays white. It
  // is never consumed, so a rolled modifier on it would be a permanent one —
  // the floor under sustain would become the best stone anybody owns.
  if (isPermanentWaystone(target)) return null;

  // The base id is the currency id: content and rules agree on the namespace, so
  // nothing has to carry a second identifier through the wire.
  const currencyId = baseOf(currency.baseId).id;
  const seed = fnv1a32(`craft:${currencyId}:${where}`);
  if (target.waystone) {
    const crafted = craftWaystone(currencyId, target.waystone.seed, seed);
    return crafted === null ? null : { ...target, waystone: { ...target.waystone, seed: crafted } };
  }
  return applyCurrency(ITEM_POOLS, currencyId, target, seed);
}

/** One unit off the stack at index `src`; the last unit takes the cell with it. */
function spend(inv: InventoryC, src: number): InventoryC {
  const items = inv.items.slice();
  const currency = items[src]!;
  const left = (currency.count ?? 1) - 1;
  if (left <= 0) items.splice(src, 1);
  else items[src] = { ...currency, count: left };
  return { ...inv, items };
}
