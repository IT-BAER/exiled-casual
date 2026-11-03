import { isqrt, fpDist2, fpStepToward } from "@exiled/fixed-point";
import { Simulation } from "../loop";
import type { World, Entity } from "../ecs";
import { bodyRadiusOf } from "../body";
import type { CollisionRef } from "../collision";
import type { Position, ProjectileC, Faction, Health } from "../components";
import { applyStatus } from "../status";

/**
 * A chaining bolt struck `struck`: a new one leaves that body toward the nearest
 * living enemy within chainRange that this chain has not hit yet, at the same
 * speed, carrying the hit list. Nobody in range ends the chain.
 */
function chain(world: World, proj: ProjectileC, struck: Entity, at: Position, speed: number): void {
  const hitIds = [...(proj.hitIds ?? []), struck];
  const range = proj.chainRange ?? 0;
  let next = -1;
  let best = Infinity;
  for (const o of world.query("position", "health", "faction")) {
    if (hitIds.includes(o) || world.get<Faction>(o, "faction")!.team === proj.team) continue;
    if ((world.get<Health>(o, "health")?.life ?? 1) <= 0) continue;
    const op = world.get<Position>(o, "position")!;
    const d2 = fpDist2(at.x, at.y, op.x, op.y);
    if (d2 <= range * range && d2 < best) { best = d2; next = o; }
  }
  if (next === -1 || speed <= 0) return;
  const np = world.get<Position>(next, "position")!;
  const step = fpStepToward(at.x, at.y, np.x, np.y, speed);
  if (step.dx === 0 && step.dy === 0) return;
  const bolt = world.create();
  world.set<Position>(bolt, "position", { x: at.x, y: at.y });
  const { pierceLeft: _p, volley: _v, spentTick: _s, ...rest } = proj;
  world.set<ProjectileC>(bolt, "projectile", {
    ...rest,
    dirx: step.dx,
    diry: step.dy,
    // Enough to reach the far edge of the chain's reach and the body standing on it.
    remainingRange: range + bodyRadiusOf(world, next) + proj.radius,
    hitIds,
    chainLeft: (proj.chainLeft ?? 1) - 1,
    chainFrom: struck,
  });
}

export function registerProjectileMove(sim: Simulation, collisionRef?: CollisionRef): void {
  sim.register("projectileMove", (world, tick) => {
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
        world.set<ProjectileC>(e, "projectile", { ...proj, remainingRange: 0, spentTick: tick });
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
      let pierceLeft = proj.pierceLeft ?? 0;
      let at = { x: nx, y: ny };
      let hitIds = proj.hitIds;
      for (const m of world.query("position", "health", "faction")) {
        const mFaction = world.get<Faction>(m, "faction")!;
        if (mFaction.team === proj.team) continue; // same team
        const mPos = world.get<Position>(m, "position")!;
        const dist2 = fpDist2(nx, ny, mPos.x, mPos.y);
        if (dist2 <= combinedR2Fn(bodyRadiusOf(world, m))) {
          if (hitIds && hitIds.includes(m)) continue;
          const strike = (t: number): void => {
            sim.enqueueDamage({
              target: t,
              source: proj.ownerId,
              amountFixed: proj.damageAmount,
              type: proj.damageType,
              via: "projectile",
              ...(proj.electrocutes ? { electrocutes: true as const } : {}),
            });
            for (const x of proj.extraDamage ?? []) {
              sim.enqueueDamage({ target: t, source: proj.ownerId, amountFixed: x.amount, type: x.type, via: "projectile" });
            }
            if (proj.onHit) applyStatus(world, t, proj.onHit, tick);
          };
          strike(m);
          // The same hit bursts onto every other enemy round the struck body.
          if (proj.explodeRadius) {
            for (const o of world.query("position", "health", "faction")) {
              if (o === m || world.get<Faction>(o, "faction")!.team === proj.team) continue;
              if ((world.get<Health>(o, "health")?.life ?? 1) <= 0) continue;
              const op = world.get<Position>(o, "position")!;
              const r = proj.explodeRadius + bodyRadiusOf(world, o);
              if (fpDist2(mPos.x, mPos.y, op.x, op.y) <= r * r) strike(o);
            }
          }
          if (proj.chainLeft) chain(world, proj, m, mPos, traveled);
          if (proj.volley !== undefined) {
            for (const s of world.query("projectile")) {
              const sp = world.get<ProjectileC>(s, "projectile")!;
              if (s === e || sp.volley !== proj.volley || sp.ownerId !== proj.ownerId) continue;
              world.set<ProjectileC>(s, "projectile", { ...sp, hitIds: [...(sp.hitIds ?? []), m] });
            }
          }
          if (pierceLeft > 0) {
            pierceLeft--;
            hitIds = [...(hitIds ?? []), m];
            continue; // keeps flying, and may strike a second body this same tick
          }
          newRange = 0; // spent
          // Rest on the struck body's near surface: the client bursts where the bolt
          // last stood, and a point-blank step can end inside the caster instead.
          const body = bodyRadiusOf(world, m);
          if (traveled > 0) at = { x: mPos.x - Math.trunc((proj.dirx * body) / traveled), y: mPos.y - Math.trunc((proj.diry * body) / traveled) };
          break; // first target only
        }
      }

      // Intentionally not clamped to WORLD_MIN/WORLD_MAX: projectiles fly past the arena edge and are removed by range depletion / the expiry system, not pinned to the wall.
      world.set<Position>(e, "position", at);
      world.set<ProjectileC>(e, "projectile", {
        ...proj,
        remainingRange: newRange,
        ...(newRange <= 0 ? { spentTick: tick } : {}),
        ...(proj.pierceLeft !== undefined ? { pierceLeft, hitIds: hitIds ?? [] } : {}),
      });
    }
  });
}
