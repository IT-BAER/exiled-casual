import { FP_SCALE, fp, fpClamp, fpStepToward, isqrt, type Fixed } from "@exiled/fixed-point";
import { Simulation } from "../loop";
import { WORLD_MIN, WORLD_MAX } from "../movement";
import { slide, hasLineOfSight, type Collision, type CollisionRef } from "../collision";
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
 *
 * 88 and not the 62 it shipped at. At 62 a straight reversal — the commonest
 * thing a mouse asks for, left then right along the same line — dropped the
 * character to a trudge for the third of a second the turn takes, and what that
 * reads as on screen is the game hesitating rather than the body leaning. The
 * cost is still there and still continuous; it is a lean now, not a brake. The
 * turn RATE (TURN_CHORD) is what stops a spin, and it is untouched.
 */
const TURN_SPEED_FLOOR_PCT = 88;

/**
 * How far a click has to be before the walk to it is steered rather than aimed.
 *
 * Comfortably past the turn's own diameter (about 0.8 units at TURN_CHORD and a
 * walk's speed), so a target inside this can always be reached in a straight line
 * instead of circled. It is also the honest read of the input: a click half a unit
 * away is a nudge, not a corner.
 */
const TURN_FOR_DISTANCE: Fixed = fp(1);

/** Click-to-move may route around a blocked target only inside this distance. */
export const MAX_AUTO_ROUTE_DISTANCE: Fixed = fp(5);

/**
 * Where to walk THIS tick to end up at (tx, ty): the target itself while the line
 * to it is clear, and the next waypoint of the route around otherwise.
 *
 * The same one-controller-per-journey rule the monsters use (`chaseStep`): the
 * question is geometric and about the whole trip, so its answer changes once, when
 * the body rounds the corner. Anything that flips per tick makes a body judder
 * against the wall it is passing. An open floor answers "the target" every tick
 * and is byte-identical to the walk that shipped before routing existed.
 */
function aimAt(
  collision: Collision | undefined,
  x: Fixed, y: Fixed, tx: Fixed, ty: Fixed, bodyRadius: Fixed,
): { x: Fixed; y: Fixed } {
  if (!collision?.nav) return { x: tx, y: ty };
  if (hasLineOfSight(collision, x, y, tx, ty, bodyRadius)) return { x: tx, y: ty };
  const dx = tx - x;
  const dy = ty - y;
  if (isqrt(dx * dx + dy * dy) > MAX_AUTO_ROUTE_DISTANCE) return { x: tx, y: ty };
  // No route at all (a click inside solid rock with no mouth to stand in) hands
  // the walk back to the straight line, which the slide then stops at the wall.
  return collision.nav.waypoint(x, y, tx, ty, bodyRadius) ?? { x: tx, y: ty };
}

/**
 * The step a body takes while its heading `held` is still swinging toward `want`.
 *
 * Shared by the keys and the mouse, which is the whole point: the two used to
 * disagree about whether a change of direction costs anything.
 */
function corner(
  held: { x: Fixed; y: Fixed }, want: { x: Fixed; y: Fixed }, speed: Fixed,
): { dx: Fixed; dy: Fixed } {
  // dot is in Fixed² because both vectors are unit Fixed, so it lands in
  // [-FP_SCALE, FP_SCALE].
  const dot = Math.trunc((held.x * want.x + held.y * want.y) / FP_SCALE);
  // Rounded, not truncated: a unit vector is only unit to the nearest thousandth,
  // so a heading dead on its key reads 999 and would forfeit a percent of the run
  // forever after every turn.
  const pct = TURN_SPEED_FLOOR_PCT
    + Math.trunc(((100 - TURN_SPEED_FLOOR_PCT) * (dot + FP_SCALE) + FP_SCALE) / (2 * FP_SCALE));
  const cornered = Math.trunc((speed * pct) / 100);
  // The heading is a unit vector, so one multiply is the whole step and the
  // diagonal is exactly as fast as the cardinal it was built from.
  return {
    dx: Math.trunc((held.x * cornered) / FP_SCALE),
    dy: Math.trunc((held.y * cornered) / FP_SCALE),
  };
}

/** A vector rescaled to length 1 (Fixed). Zero in, zero out. */
export function unit(x: Fixed, y: Fixed): { x: Fixed; y: Fixed } {
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
        const step = corner(held, want, speed);
        ddx = step.dx;
        ddy = step.dy;
      } else if (moveTarget?.active === 1) {
        const toX = moveTarget.x - pos.x;
        const toY = moveTarget.y - pos.y;
        const far = isqrt(toX * toX + toY * toY) > TURN_FOR_DISTANCE;
        // A click far enough away is steered exactly as the keys are: the mouse
        // asks for a direction, the heading answers it a bounded amount per tick.
        // Before this, click-to-move wrote the heading straight from the step, so
        // a click behind the character spun him on the spot — and since the
        // renderer takes the facing off how far the mesh actually MOVED, limiting
        // the heading alone would have changed nothing on screen.
        //
        // Near enough, it walks straight in. Two reasons: a nudge of half a unit
        // is not a corner worth banking into, and the turn is tight but not free —
        // the tightest circle it can make is about 0.8 units across, so a target
        // inside that could be orbited rather than reached.
        if (far && moveDir) {
          const aim = aimAt(collision, pos.x, pos.y, moveTarget.x, moveTarget.y, player.bodyRadius);
          const want = unit(aim.x - pos.x, aim.y - pos.y);
          const held = moveDir.hx === 0 && moveDir.hy === 0
            ? want
            : steer({ x: moveDir.hx, y: moveDir.hy }, want);
          world.set<MoveDir>(e, "moveDir", { dx: moveDir.dx, dy: moveDir.dy, hx: held.x, hy: held.y });
          const step = corner(held, want, speed);
          ddx = step.dx;
          ddy = step.dy;
        } else {
          const step = fpStepToward(pos.x, pos.y, moveTarget.x, moveTarget.y, speed);
          ddx = step.dx;
          ddy = step.dy;
          // Click-to-move sets the heading too, so a WASD key pressed at the end
          // of a walk steers from where the player is going, not from a stale one.
          // Steered, never snapped: a held mouse re-issues this target every tick,
          // and a heading written straight off the step let the cursor spin the
          // body as fast as it could be circled. The step itself still aims (a
          // nudge inside the turning circle has to be reachable in a line), so the
          // body turns at its own rate while it side-steps the last half unit.
          if (moveDir) {
            const want = unit(ddx, ddy);
            const h = moveDir.hx === 0 && moveDir.hy === 0
              ? want
              : steer({ x: moveDir.hx, y: moveDir.hy }, want);
            world.set<MoveDir>(e, "moveDir", { dx: moveDir.dx, dy: moveDir.dy, hx: h.x, hy: h.y });
          }
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
