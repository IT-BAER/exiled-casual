import { isqrt, fpDist2 } from "@pact/fixed-point";
import { Simulation } from "../loop";
import type { Position, ProjectileC, MonsterC, Faction } from "../components";

export function registerProjectileMove(sim: Simulation): void {
  sim.register("projectileMove", (world) => {
    for (const e of world.query("projectile", "position")) {
      const pos = world.get<Position>(e, "position")!;
      const proj = world.get<ProjectileC>(e, "projectile")!;

      // Advance.
      const nx = pos.x + proj.dirx;
      const ny = pos.y + proj.diry;
      const traveled = isqrt(proj.dirx * proj.dirx + proj.diry * proj.diry);
      let newRange = proj.remainingRange - traveled;

      // Collision: find first monster (ascending id) within combined radius.
      const combinedR2Fn = (bodyRadius: number) => {
        const r = proj.radius + bodyRadius;
        return r * r;
      };
      for (const m of world.query("position", "monster", "faction")) {
        const mFaction = world.get<Faction>(m, "faction")!;
        if (mFaction.team === proj.team) continue; // same team
        const mPos = world.get<Position>(m, "position")!;
        const mMon = world.get<MonsterC>(m, "monster")!;
        const dist2 = fpDist2(nx, ny, mPos.x, mPos.y);
        if (dist2 <= combinedR2Fn(mMon.bodyRadius)) {
          sim.enqueueDamage({
            target: m,
            source: proj.ownerId,
            amountFixed: proj.damageAmount,
            type: proj.damageType,
          });
          newRange = 0; // spent
          break; // first monster only
        }
      }

      world.set<Position>(e, "position", { x: nx, y: ny });
      world.set<ProjectileC>(e, "projectile", { ...proj, remainingRange: newRange });
    }
  });
}
