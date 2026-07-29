import { isqrt, fpDist2 } from "@exiled/fixed-point";
import { Simulation } from "../loop";
import { bodyRadiusOf } from "../body";
import type { CollisionRef } from "../collision";
import type { Position, ProjectileC, Faction } from "../components";

export function registerProjectileMove(sim: Simulation, collisionRef?: CollisionRef): void {
  sim.register("projectileMove", (world) => {
    const collision = collisionRef?.active ?? undefined;
    for (const e of world.query("projectile", "position")) {
      const proj = world.get<ProjectileC>(e, "projectile")!;
      if (proj.remainingRange <= 0) continue; // spent last tick; inert until the expiry system despawns it

      const pos = world.get<Position>(e, "position")!;

      // Advance.
      const nx = pos.x + proj.dirx;
      const ny = pos.y + proj.diry;
      const traveled = isqrt(proj.dirx * proj.dirx + proj.diry * proj.diry);
      let newRange = proj.remainingRange - traveled;

      // A wall stops a bolt where its own body touches the rock, and it stays
      // where it was rather than one step inside: the impact belongs on the face.
      // Tested per tick, not swept — a bolt covers 0.4 units a tick against a
      // half-unit cell, so the disc always overlaps the cell it would enter.
      if (collision && !collision.isWalkable(nx, ny, proj.radius)) {
        world.set<ProjectileC>(e, "projectile", { ...proj, remainingRange: 0 });
        continue;
      }

      // Anything damageable on another team, not just monsters: the player has
      // no `monster` component, which is the only reason a monster's bolt used
      // to pass straight through. Body radius comes from body.ts so a projectile
      // and a telegraph agree about how wide a target is.
      const combinedR2Fn = (bodyRadius: number) => {
        const r = proj.radius + bodyRadius;
        return r * r;
      };
      for (const m of world.query("position", "health", "faction")) {
        const mFaction = world.get<Faction>(m, "faction")!;
        if (mFaction.team === proj.team) continue; // same team
        const mPos = world.get<Position>(m, "position")!;
        const dist2 = fpDist2(nx, ny, mPos.x, mPos.y);
        if (dist2 <= combinedR2Fn(bodyRadiusOf(world, m))) {
          sim.enqueueDamage({
            target: m,
            source: proj.ownerId,
            amountFixed: proj.damageAmount,
            type: proj.damageType,
          });
          newRange = 0; // spent
          break; // first target only
        }
      }

      // Intentionally not clamped to WORLD_MIN/WORLD_MAX: projectiles fly past the arena edge and are removed by range depletion / the expiry system, not pinned to the wall.
      world.set<Position>(e, "position", { x: nx, y: ny });
      world.set<ProjectileC>(e, "projectile", { ...proj, remainingRange: newRange });
    }
  });
}
