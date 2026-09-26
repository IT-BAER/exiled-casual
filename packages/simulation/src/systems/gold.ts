import { PICKUP_RADIUS } from "@exiled/protocol";
import { fp } from "@exiled/fixed-point";
import { goldDrop } from "@exiled/rules";
import { Simulation } from "../loop";
import type { World } from "../ecs";
import { inRangeOf } from "../protocol-bridge";
import { fnv1a32 } from "../rng";
import type { Collision } from "../collision";
import type { GoldC, MoveDir, MoveTarget, Position, ProgressC } from "../components";

/** Where the pile lands beside a drop: clear of every DROP_SPREAD plate, so no label sits on it. */
const GOLD_OFFSET = { dx: fp(0), dy: fp(1.1) };

/**
 * Roll and place the gold one kill or cache pays. Its own seed stream (`gold:`),
 * so what the items roll is byte-identical with or without it.
 */
export function dropGold(
  world: World, x: number, y: number, key: string, monsterRarity: number, level: number,
  collision?: Collision | null,
): void {
  const pile = goldDrop(fnv1a32(`gold:${key}`), monsterRarity, level);
  if (pile === null) return;
  const px = x + GOLD_OFFSET.dx, py = y + GOLD_OFFSET.dy;
  const on = collision && !collision.isWalkable(px, py, fp(0.3)) ? { x, y } : { x: px, y: py };
  const e = world.create();
  world.set<Position>(e, "position", on);
  world.set<GoldC>(e, "gold", { amount: pile.amount, jackpot: pile.jackpot ? 1 : 0 });
}

/**
 * PoE2's rule: gold in range is collected as the player MOVES, never while he
 * stands. A pile that drops at his feet mid-cast stays on the floor to be seen.
 */
export function registerGoldPickup(sim: Simulation): void {
  sim.register("goldPickup", (world) => {
    const sessionE = world.query("session")[0];
    if (sessionE === undefined) return;
    for (const p of world.query("player", "position")) {
      const md = world.get<MoveDir>(p, "moveDir");
      const moving = world.get<MoveTarget>(p, "moveTarget")?.active === 1 || (md !== undefined && (md.dx !== 0 || md.dy !== 0));
      if (!moving) continue;
      const pp = world.get<Position>(p, "position")!;
      for (const g of world.query("gold", "position")) {
        const gp = world.get<Position>(g, "position")!;
        if (!inRangeOf(pp.x, pp.y, gp.x, gp.y, PICKUP_RADIUS)) continue;
        const prog = world.get<ProgressC>(sessionE, "progress");
        if (!prog) return;
        world.set<ProgressC>(sessionE, "progress", { ...prog, gold: prog.gold + world.get<GoldC>(g, "gold")!.amount });
        world.destroy(g);
      }
    }
  });
}
