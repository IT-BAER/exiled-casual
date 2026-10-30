import { fpDist2, type Fixed } from "@exiled/fixed-point";
import type { MonsterDef } from "@exiled/content-schema";
import { Simulation } from "../loop";
import { bodyRadiusOf } from "../body";
import { spawnAdd } from "../areas";
import type { Position, Faction, TelegraphC, GroundAreaC } from "../components";

/**
 * Whether a telegraph standing at `at` reaches a body of `bodyRadius` at (x, y).
 * A lane runs from `at` along its direction: flat at the start, so the boss's back
 * is safe, and round at the far end. A ring spares a body wholly inside its hole.
 * Integer math only; the bot asks the same question the hit does.
 */
export function telegraphCovers(tg: TelegraphC, at: Position, x: Fixed, y: Fixed, bodyRadius: Fixed): boolean {
  const dx = x - at.x;
  const dy = y - at.y;
  const reach = tg.radius + bodyRadius;
  if (tg.shape === "line") {
    // Along and across the lane, both x1000 because the direction is.
    const along = dx * tg.dirX! + dy * tg.dirY!;
    const across = dx * tg.dirY! - dy * tg.dirX!;
    if (along < -bodyRadius * 1000) return false;
    if (along <= tg.length! * 1000) return Math.abs(across) <= reach * 1000;
    const endX = at.x + Math.trunc((tg.dirX! * tg.length!) / 1000);
    const endY = at.y + Math.trunc((tg.dirY! * tg.length!) / 1000);
    return fpDist2(endX, endY, x, y) <= reach * reach;
  }
  const d2 = dx * dx + dy * dy;
  if (d2 > reach * reach) return false;
  if (tg.shape !== "ring") return true;
  const hole = tg.inner! - bodyRadius;
  return hole <= 0 || d2 > hole * hole;
}

/** `monsters` resolves a brood mark's spawnDefId; without it a mark raises nothing. */
export function registerTelegraphResolve(sim: Simulation, monsters?: ReadonlyMap<string, MonsterDef>): void {
  sim.register("telegraphResolve", (world, tick) => {
    // Snapshot the list before destroying to avoid mutation-during-iteration issues.
    const telegraphs = world.query("telegraph", "position");

    for (const te of telegraphs) {
      const tg = world.get<TelegraphC>(te, "telegraph")!;
      // Every telegraph is a monster's wind-up, and death interrupts it (both PoE
      // games): killing a boss mid-slam must not let its corpse land the hit.
      if (!world.alive.has(tg.ownerId)) { world.destroy(te); continue; }
      if (tick < tg.impactTick) continue;

      const tgPos = world.get<Position>(te, "position")!;

      for (const e of tg.damage > 0 ? world.query("position", "health", "faction") : []) {
        const faction = world.get<Faction>(e, "faction")!;
        if (faction.team === tg.team) continue;

        const ePos = world.get<Position>(e, "position")!;
        if (!telegraphCovers(tg, tgPos, ePos.x, ePos.y, bodyRadiusOf(world, e))) continue;

        sim.enqueueDamage({ target: e, source: tg.ownerId, amountFixed: tg.damage, type: tg.damageType, via: "slam" });
      }

      const add = tg.spawnDefId === undefined ? undefined : monsters?.get(tg.spawnDefId);
      if (add) spawnAdd(world, add, tgPos.x, tgPos.y);

      // A phase-2 slam leaves a burning patch on the impact footprint. Field names
      // in tg.ground mirror GroundAreaC's ailment fields, so they spread straight in.
      if (tg.leavesGroundTicks > 0 && tg.ground) {
        const ga = world.create();
        world.set<Position>(ga, "position", { x: tgPos.x, y: tgPos.y });
        world.set<GroundAreaC>(ga, "groundArea", {
          radius: tg.radius,
          expiryTick: tick + tg.leavesGroundTicks,
          nextTick: tick,
          team: tg.team,
          ...tg.ground,
        });
      }

      world.destroy(te);
    }
  });
}
