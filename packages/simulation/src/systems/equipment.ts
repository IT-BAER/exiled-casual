import { baseOf, isCurrency, canonicalBaseId, currencyItem } from "@exiled/content-runtime";
import { disenchantYield, SHARDS_PER_ORB, vendorBuyPrice, vendorSellPrice } from "@exiled/rules";
import { Simulation } from "../loop";
import { isStaple } from "../vendor";
import { placeFirstFit, canPlaceAt } from "../inventory";
import { canEquip } from "../equipment";
import { recomputePlayerStats } from "../derived";
import type { Position, ItemC, InventoryC, VendorC, EquipmentC, ShardsC, ProgressC } from "../components";
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
        recomputePlayerStats(world);
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
        recomputePlayerStats(world);
        continue;
      }

      // ── moveItem ───────────────────────────────────────────────────────────
      if (cmd.type === "moveItem") {
        const x = cmd.data?.["x"];
        const y = cmd.data?.["y"];
        const toX = cmd.data?.["toX"];
        const toY = cmd.data?.["toY"];
        if (x === undefined || y === undefined || toX === undefined || toY === undefined) continue;

        // 0 (or absent) = backpack, 1 = stash — see protocol-bridge.
        const fromComp = cmd.data?.["from"] === 1 ? "stash" : "inventory";
        const toComp = cmd.data?.["to"] === 1 ? "stash" : "inventory";

        const src = world.get<InventoryC>(sessionE, fromComp);
        const dst = world.get<InventoryC>(sessionE, toComp);
        if (!src || !dst) continue;

        const i = src.items.findIndex((p) => p.x === x && p.y === y);
        if (i < 0) continue;
        const placed = src.items[i]!;

        // Same currency already sitting on the target cell: pour one stack into
        // the other rather than refusing the move as a collision.
        const target = dst.items.findIndex((p, j) =>
          !(fromComp === toComp && j === i) && p.x === toX && p.y === toY);
        if (target >= 0) {
          const hit = dst.items[target]!;
          if (!isCurrency(placed.item) || canonicalBaseId(hit.item.baseId) !== canonicalBaseId(placed.item.baseId)) continue;
          const merged = { ...hit, count: (hit.count ?? 1) + (placed.count ?? 1) };
          if (fromComp === toComp) {
            world.set<InventoryC>(sessionE, toComp, {
              ...dst,
              items: dst.items.map((p, j) => (j === target ? merged : p)).filter((_, j) => j !== i),
            });
          } else {
            world.set<InventoryC>(sessionE, fromComp, { ...src, items: src.items.filter((_, j) => j !== i) });
            world.set<InventoryC>(sessionE, toComp, { ...dst, items: dst.items.map((p, j) => (j === target ? merged : p)) });
          }
          continue;
        }

        // Ignoring itself, or nudging a 1x2 wand down one row would collide with
        // the row it is currently standing on and every move would be refused.
        if (!canPlaceAt(dst, placed.w, placed.h, toX, toY, fromComp === toComp ? i : -1)) continue;

        if (fromComp === toComp) {
          world.set<InventoryC>(sessionE, toComp, {
            ...dst,
            items: dst.items.map((p, j) => (j === i ? { ...p, x: toX, y: toY } : p)),
          });
        } else {
          world.set<InventoryC>(sessionE, fromComp, { ...src, items: src.items.filter((_, j) => j !== i) });
          world.set<InventoryC>(sessionE, toComp, { ...dst, items: [...dst.items, { ...placed, x: toX, y: toY }] });
        }
        continue;
      }

      // ── sellItem ───────────────────────────────────────────────────────────
      if (cmd.type === "sellItem") {
        const x = cmd.data?.["x"];
        const y = cmd.data?.["y"];
        if (x === undefined || y === undefined) continue;

        // 0 (or absent) = backpack, 1 = stash — mirrors moveItem's encoding.
        const comp = cmd.data?.["from"] === 1 ? "stash" : "inventory";
        const container = world.get<InventoryC>(sessionE, comp);
        if (!container) continue;

        const placed = container.items.find((p) => p.x === x && p.y === y);
        if (!placed) continue;

        // Gold is what the counter always pays; shards are the extra a magic or
        // better piece breaks down into. A refusal is a refusal on both — the two
        // agree on currency and on unread items, which is why one guard covers it.
        const gold = vendorSellPrice(placed.item);
        if (gold === 0) continue; // item refused; nothing consumed
        const yld = disenchantYield(placed.item);

        // Remove from container.
        world.set<InventoryC>(sessionE, comp, {
          ...container,
          items: container.items.filter((p) => !(p.x === x && p.y === y)),
        });

        const prog = world.get<ProgressC>(sessionE, "progress")!;
        world.set<ProgressC>(sessionE, "progress", { ...prog, gold: prog.gold + gold });

        if (yld === null) continue; // paid in gold only; nothing to break down

        // Accumulate shards and mint any complete orbs into the backpack.
        const shardsC = world.get<ShardsC>(sessionE, "shards")!;
        const counts = { ...shardsC.counts };
        counts[yld.orbBaseId] = (counts[yld.orbBaseId] ?? 0) + yld.shards;

        while ((counts[yld.orbBaseId] ?? 0) >= SHARDS_PER_ORB) {
          // Try merging into an existing stack, else place a fresh 1x1 cell.
          const inv = world.get<InventoryC>(sessionE, "inventory")!;
          const canonId = canonicalBaseId(yld.orbBaseId);
          const stackIdx = inv.items.findIndex((p) => canonicalBaseId(p.item.baseId) === canonId);
          if (stackIdx >= 0) {
            const items = inv.items.slice();
            items[stackIdx] = { ...items[stackIdx]!, count: (items[stackIdx]!.count ?? 1) + 1 };
            world.set<InventoryC>(sessionE, "inventory", { ...inv, items });
          } else {
            const slot = placeFirstFit(inv, 1, 1);
            if (slot === null) break; // no room; bank the shards for a later sale
            world.set<InventoryC>(sessionE, "inventory", {
              ...inv,
              items: [...inv.items, { x: slot.x, y: slot.y, w: 1, h: 1, item: currencyItem(yld.orbBaseId), count: 1 }],
            });
          }
          counts[yld.orbBaseId]! -= SHARDS_PER_ORB;
        }

        world.set<ShardsC>(sessionE, "shards", { counts });
        continue;
      }

      // ── buyItem ────────────────────────────────────────────────────────────
      if (cmd.type === "buyItem") {
        const x = cmd.data?.["x"];
        const y = cmd.data?.["y"];
        if (x === undefined || y === undefined) continue;

        const shelf = world.get<VendorC>(sessionE, "vendor");
        if (!shelf) continue;
        const stocked = shelf.items.find((p) => p.x === x && p.y === y);
        if (!stocked) continue;

        const prog = world.get<ProgressC>(sessionE, "progress")!;
        const price = vendorBuyPrice(stocked.item);
        if (prog.gold < price) continue; // cannot afford it; the shelf keeps the piece

        // Room before money: a purchase that cannot be carried must not be charged
        // for, and there is no cursor to hold the goods on the way out.
        const inv = world.get<InventoryC>(sessionE, "inventory")!;
        const fit = placeFirstFit(inv, stocked.w, stocked.h);
        if (fit === null) continue;

        world.set<InventoryC>(sessionE, "inventory", {
          ...inv,
          items: [...inv.items, { x: fit.x, y: fit.y, w: stocked.w, h: stocked.h, item: stocked.item }],
        });
        // A staple's cell is a price tag, not a unit: buying one leaves it on the
        // shelf, because the shop is where the way home comes from (vendor.ts).
        if (!isStaple(stocked.item)) {
          world.set<VendorC>(sessionE, "vendor", {
            ...shelf,
            items: shelf.items.filter((p) => !(p.x === x && p.y === y)),
          });
        }
        world.set<ProgressC>(sessionE, "progress", { ...prog, gold: prog.gold - price });
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
