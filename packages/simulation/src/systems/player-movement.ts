import { FP_SCALE, fp, fpClamp, fpStepToward, isqrt, type Fixed } from "@exiled/fixed-point";
import { Simulation } from "../loop";
import { WORLD_MIN, WORLD_MAX } from "../movement";
import { slide, type CollisionRef } from "../collision";
import type { Position, PlayerC, MoveTarget, MoveDir, CastingC, Health } from "../components";

/** Player moves at this percent of moveSpeed during post-cast recovery. */
export const CASTING_MOVE_PCT = 40;

/**
 * How far the heading may swing in one tick, as the chord across the unit
 * circle: 0.35 is a touch over 20 degrees, so a right-angle turn takes about
 * five ticks and a full reversal nine — a sixth to a third of a second.
 *
 * A chord and not an angle because the sim owns no trigonometry: stepping the
 * heading vector toward the target vector by a fixed length and renormalising
 * IS a rotation, and it is all integer math, so the replay checksum holds.
 */
const TURN_CHORD = fp(0.35);

/**
 * Speed while the heading is fighting the keys, as a percent of the run.
 *
 * Nobody changes direction at full pace: you shed speed into the corner and
 * spend it coming out. Full ahead is 100, a dead-on reversal is this, and the
 * angle in between reads off the dot product — so the cost is continuous, which
 * is the difference between a runner and a turret. The recovery is free: the
 * percentage climbs by itself as the heading closes on the key.
 */
const TURN_SPEED_FLOOR_PCT = 62;

/** A vector rescaled to length 1 (Fixed). Zero in, zero out. */
function unit(x: Fixed, y: Fixed): { x: Fixed; y: Fixed } {
  const len = isqrt(x * x + y * y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: Math.trunc((x * FP_SCALE) / len), y: Math.trunc((y * FP_SCALE) / len) };
}

/**
 * The heading after one tick of steering from `h` toward `t` (both unit).
 *
 * The dead-on flip is the whole reason this is a function: a heading stepped
 * straight at its own opposite just shrinks along its own line and pops back
 * out where it started, so it would never turn at all. Nothing in the geometry
 * says which way around to go, so pick the left hand and commit.
 */
function steer(h: { x: Fixed; y: Fixed }, t: { x: Fixed; y: Fixed }): { x: Fixed; y: Fixed } {
  const cross = h.x * t.y - h.y * t.x;
  const dot = h.x * t.x + h.y * t.y;
  if (cross === 0) {
    if (dot >= 0) return t; // already there
    return unit(h.x - Math.trunc((h.y * TURN_CHORD) / FP_SCALE), h.y + Math.trunc((h.x * TURN_CHORD) / FP_SCALE));
  }
  const step = fpStepToward(h.x, h.y, t.x, t.y, TURN_CHORD);
  return unit(h.x + step.dx, h.y + step.dy);
}

export function registerPlayerMovement(sim: Simulation, collisionRef?: CollisionRef): void {
  sim.register("playerMovement", (world, tick, commands) => {
    // Read the live level collision (mutated by area transitions); null off-map.
    const collision = collisionRef?.active ?? undefined;

    // 1. Apply commands to moveTarget / moveDir components.
    for (const cmd of commands) {
      if (cmd.entity === undefined) continue;
      if (!world.has(cmd.entity, "player")) continue;
      // A corpse does not take orders. Without this, a click behind the death
      // screen walks the body around while the screen asks where to come back.
      // Absent health reads as alive, so every legacy fixture is unchanged.
      if ((world.get<Health>(cmd.entity, "health")?.life ?? 1) <= 0) continue;
      const e = cmd.entity;
      if (cmd.type === "moveTo") {
        const x = fpClamp(cmd.data?.["x"] ?? 0, WORLD_MIN, WORLD_MAX);
        const y = fpClamp(cmd.data?.["y"] ?? 0, WORLD_MIN, WORLD_MAX);
        world.set<MoveTarget>(e, "moveTarget", { x, y, active: 1 });
      } else if (cmd.type === "moveDir") {
        const dx = cmd.data?.["dx"] ?? 0;
        const dy = cmd.data?.["dy"] ?? 0;
        // The heading survives the command: a new key changes where the player
        // is being asked to go, not where they are already going.
        const prev = world.get<MoveDir>(e, "moveDir");
        world.set<MoveDir>(e, "moveDir", { dx, dy, hx: prev?.hx ?? 0, hy: prev?.hy ?? 0 });
      } else if (cmd.type === "stop") {
        const mt = world.get<MoveTarget>(e, "moveTarget");
        if (mt) world.set<MoveTarget>(e, "moveTarget", { x: mt.x, y: mt.y, active: 0 });
        world.set<MoveDir>(e, "moveDir", { dx: 0, dy: 0, hx: 0, hy: 0 });
      }
    }

    // 2. Integrate all player entities.
    for (const e of world.query("position", "player")) {
      const pos = world.get<Position>(e, "position")!;
      const player = world.get<PlayerC>(e, "player")!;
      const moveDir = world.get<MoveDir>(e, "moveDir");
      const moveTarget = world.get<MoveTarget>(e, "moveTarget");

      // Post-cast recovery slows the player; effect already fired on the cast tick.
      const casting = world.get<CastingC>(e, "casting");
      const speed = casting && casting.untilTick > tick
        ? Math.trunc(player.moveSpeed * CASTING_MOVE_PCT / 100)
        : player.moveSpeed;

      // Intended movement delta for this tick.
      let ddx = 0;
      let ddy = 0;
      const dirActive = moveDir && (moveDir.dx !== 0 || moveDir.dy !== 0);
      if (dirActive && moveDir) {
        const want = unit(moveDir.dx * FP_SCALE, moveDir.dy * FP_SCALE);
        // Standing still has no heading to turn from, so the first step is the
        // key itself; after that the keys steer a heading that already exists.
        const held = moveDir.hx === 0 && moveDir.hy === 0
          ? want
          : steer({ x: moveDir.hx, y: moveDir.hy }, want);
        world.set<MoveDir>(e, "moveDir", { dx: moveDir.dx, dy: moveDir.dy, hx: held.x, hy: held.y });
        // What is left of the run after the corner. dot is in Fixed² because
        // both vectors are unit Fixed, so it lands in [-FP_SCALE, FP_SCALE].
        const dot = Math.trunc((held.x * want.x + held.y * want.y) / FP_SCALE);
        // Rounded, not truncated: a unit vector is only unit to the nearest
        // thousandth, so a heading dead on its key reads 999 and would forfeit
        // a percent of the run forever after every turn.
        const pct = TURN_SPEED_FLOOR_PCT
          + Math.trunc(((100 - TURN_SPEED_FLOOR_PCT) * (dot + FP_SCALE) + FP_SCALE) / (2 * FP_SCALE));
        const cornered = Math.trunc((speed * pct) / 100);
        // The heading is a unit vector, so one multiply is the whole step and
        // the diagonal is exactly as fast as the cardinal it was built from.
        ddx = Math.trunc((held.x * cornered) / FP_SCALE);
        ddy = Math.trunc((held.y * cornered) / FP_SCALE);
      } else if (moveTarget?.active === 1) {
        const step = fpStepToward(pos.x, pos.y, moveTarget.x, moveTarget.y, speed);
        ddx = step.dx;
        ddy = step.dy;
        // Click-to-move sets the heading too, so a WASD key pressed at the end
        // of a walk steers from where the player is going, not from a stale one.
        if (moveDir) {
          const h = unit(ddx, ddy);
          world.set<MoveDir>(e, "moveDir", { dx: moveDir.dx, dy: moveDir.dy, hx: h.x, hy: h.y });
        }
      }

      // Resolve against level collision (slide along walls) when a map is loaded;
      // otherwise the actor is bounded only by the world extent.
      const moved = collision
        ? slide(collision, pos.x, pos.y, ddx, ddy, player.bodyRadius)
        : { x: pos.x + ddx, y: pos.y + ddy };
      const resolved = {
        x: fpClamp(moved.x, WORLD_MIN, WORLD_MAX),
        y: fpClamp(moved.y, WORLD_MIN, WORLD_MAX),
      };

      // Deactivate the move target once we actually reach it.
      if (moveTarget?.active === 1 && resolved.x === moveTarget.x && resolved.y === moveTarget.y) {
        world.set<MoveTarget>(e, "moveTarget", { x: moveTarget.x, y: moveTarget.y, active: 0 });
      }
      world.set<Position>(e, "position", resolved);
    }
  });
}
