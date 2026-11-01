import { fpClamp, isqrt, type Fixed } from "@exiled/fixed-point";
import { Simulation } from "../loop";
import type { World, Entity } from "../ecs";
import { WORLD_MIN, WORLD_MAX } from "../movement";
import { sweep, type Collision, type CollisionRef } from "../collision";
import { bodyRadiusOf } from "../body";
import type { Faction, Health, Position, SkillAreaC } from "../components";
import { applyStatus, stun } from "../status";

/**
 * Push `target` `dist` away from (cx, cy), stopped by the first wall its body
 * meets. Standing dead on the centre it is pushed along (fallbackX, fallbackY),
 * the aim x1000. Bosses are not moved: their arena positioning is boss-ai's.
 */
export function knockback(
  world: World, collision: Collision | undefined, target: Entity,
  cx: Fixed, cy: Fixed, dist: Fixed, fallbackX: number, fallbackY: number,
): void {
  if (dist <= 0 || world.has(target, "boss")) return;
  const p = world.get<Position>(target, "position")!;
  let dx = p.x - cx;
  let dy = p.y - cy;
  let len = isqrt(dx * dx + dy * dy);
  if (len === 0) {
    dx = fallbackX;
    dy = fallbackY;
    len = isqrt(dx * dx + dy * dy);
    if (len === 0) return;
  }
  const mx = Math.trunc((dx * dist) / len);
  const my = Math.trunc((dy * dist) / len);
  const reach = collision ? sweep(collision, p.x, p.y, mx, my, bodyRadiusOf(world, target)) : { dx: mx, dy: my };
  if (reach.dx === 0 && reach.dy === 0) return;
  world.set<Position>(target, "position", {
    x: fpClamp(p.x + reach.dx, WORLD_MIN, WORLD_MAX),
    y: fpClamp(p.y + reach.dy, WORLD_MIN, WORLD_MAX),
  });
}

/**
 * Every skillArea whose impact tick has come lands now: its hit on every enemy
 * inside (a cone also inside its wedge), then knockback, stun and status. It
 * stays one tick more with spentTick set, so the snapshot shows where it landed;
 * the expiry system removes it after. A dead owner cancels nothing: the impact
 * was decided when it was cast.
 */
export function registerSkillArea(sim: Simulation, collisionRef?: CollisionRef): void {
  sim.register("skillArea", (world, tick) => {
    const collision = collisionRef?.active ?? undefined;
    for (const a of world.query("skillArea", "position")) {
      const area = world.get<SkillAreaC>(a, "skillArea")!;
      if (area.spentTick !== undefined || tick < area.impactTick) continue;
      // A status cast's marker lands on nobody: it only shows where the cast went.
      if (area.marker === 1) {
        world.set<SkillAreaC>(a, "skillArea", { ...area, spentTick: tick });
        continue;
      }
      const c = world.get<Position>(a, "position")!;
      const cosHalfArc = area.shape === "cone"
        ? Math.round(Math.cos(((area.arc ?? 360) / 2) * Math.PI / 180) * 10000)
        : -10001;
      for (const target of world.query("position", "health", "faction")) {
        if (world.get<Faction>(target, "faction")!.team === area.team) continue;
        if ((world.get<Health>(target, "health")?.life ?? 1) <= 0) continue;
        const t = world.get<Position>(target, "position")!;
        const dx = t.x - c.x;
        const dy = t.y - c.y;
        const reach = area.radius + bodyRadiusOf(world, target);
        const d2 = dx * dx + dy * dy;
        if (d2 > reach * reach) continue;
        if (area.shape === "cone") {
          const d = isqrt(d2);
          if (d > 0 && Math.trunc(((dx * area.dirX + dy * area.dirY) * 10) / d) < cosHalfArc) continue;
        }
        for (const p of area.parts) {
          sim.enqueueDamage({ target, source: area.ownerId, amountFixed: p.amount, type: p.type });
        }
        if (area.onHit) applyStatus(world, target, area.onHit, tick);
        if (area.stun) stun(world, target, area.stun, tick);
        if (area.knockback) knockback(world, collision, target, c.x, c.y, area.knockback, area.dirX, area.dirY);
      }
      world.set<SkillAreaC>(a, "skillArea", { ...area, spentTick: tick });
    }
  });
}
