import { fp, toNumber } from "@exiled/fixed-point";
import { ROT_STEP, decorById, decorDiscs, rotTrig } from "@exiled/content-runtime";
import { Simulation } from "../loop";
import type { CollisionRef } from "../collision";
import type { HideoutLayoutC, HideoutPieceC, PlayerC, Position, SessionC } from "../components";
import type { World } from "../ecs";
import { BLOCK_RADIUS, HIDEOUT_SPAWN, hideoutCollision } from "../areas";
import { isPieceId, isServiceId, onHideoutFloor, placeServices } from "../hideout-layout";

/** The body the arrival spot has to keep free: where every walk home lands. */
const ARRIVAL_BODY = fp(0.5);

/**
 * Edit Hideout: the player picks a piece up and puts it down somewhere else, the
 * way PoE's decoration mode does. The client shows the piece riding the cursor;
 * this is where the move becomes real, so it is also where it is refused.
 *
 * Appended after every other system, so a world that never edits its hideout runs
 * exactly as before.
 */
export function registerHideoutEdit(sim: Simulation, collisionRef?: CollisionRef): void {
  // The layout the world's services and collision were last stood up from. A
  // restore swaps the component under us; the next tick notices and re-applies.
  let applied: HideoutLayoutC | undefined;

  sim.register("hideoutEdit", (world, _tick, commands) => {
    const sessionE = world.query("session")[0];
    if (sessionE === undefined) return;
    const session = world.get<SessionC>(sessionE, "session")!;
    for (const cmd of commands) {
      if (session.area !== "hideout" || session.dead === 1) continue;
      if (cmd.type === "resetHideoutLayout") {
        world.remove(sessionE, "hideoutLayout");
        continue;
      }
      if (cmd.type !== "placeHideoutPiece" || typeof cmd.pieceId !== "string") continue;
      const x = cmd.data?.["x"], y = cmd.data?.["y"], rot = cmd.data?.["rot"];
      if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(rot)) continue;
      const piece: HideoutPieceC = { id: cmd.pieceId, x: x!, y: y!, rot: (((rot!) % 360) + 360) % 360 };
      if (!canPlace(world, piece)) continue;
      const kept = (world.get<HideoutLayoutC>(sessionE, "hideoutLayout")?.pieces ?? []).filter((p) => p.id !== piece.id);
      const pieces = [...kept, piece].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      world.set<HideoutLayoutC>(sessionE, "hideoutLayout", { pieces });
    }

    const now = world.get<HideoutLayoutC>(sessionE, "hideoutLayout");
    if (session.area !== "hideout" || now === applied) return;
    applied = now;
    placeServices(world, now?.pieces ?? []);
    const collision = hideoutCollision(world);
    if (collisionRef) collisionRef.active = collision;
    // A reset or a load can stand furniture back on the spot he is standing on,
    // and a body inside a blocker cannot step in any direction. The arrival spot
    // is the one place no placement may cover.
    for (const p of world.query("player")) {
      const at = world.get<Position>(p, "position")!;
      const body = world.get<PlayerC>(p, "player")?.bodyRadius ?? ARRIVAL_BODY;
      if (!collision.isWalkable(at.x, at.y, body)) world.set<Position>(p, "position", { x: HIDEOUT_SPAWN.x, y: HIDEOUT_SPAWN.y });
    }
  });
}

/**
 * Whether `piece` may stand there: a piece this hideout has, a whole rotation
 * step, on the floor, and clear of the player's body and of the arrival spot.
 * Anything else may overlap anything: PoE lets decorations crowd each other, and
 * the player who walled himself in has Reset.
 */
function canPlace(world: World, piece: HideoutPieceC): boolean {
  if (!isPieceId(piece.id) || piece.rot % ROT_STEP !== 0 || !onHideoutFloor(piece.x, piece.y)) return false;
  const decor = decorById(piece.id);
  const discs = isServiceId(piece.id)
    ? [{ x: piece.x, y: piece.y, r: fp(BLOCK_RADIUS[piece.id] ?? 0) }]
    : decorDiscs(decor!, toNumber(piece.x), toNumber(piece.y), rotTrig(piece.rot))
      .map((d) => ({ x: fp(d.x), y: fp(d.z), r: fp(d.r) }));
  const bodies = [{ x: HIDEOUT_SPAWN.x, y: HIDEOUT_SPAWN.y, r: ARRIVAL_BODY }];
  for (const p of world.query("player")) {
    const at = world.get<Position>(p, "position")!;
    bodies.push({ x: at.x, y: at.y, r: world.get<PlayerC>(p, "player")?.bodyRadius ?? ARRIVAL_BODY });
  }
  for (const d of discs) {
    if (d.r <= 0) continue;
    for (const b of bodies) {
      const dx = d.x - b.x, dy = d.y - b.y, reach = d.r + b.r;
      if (dx * dx + dy * dy < reach * reach) return false;
    }
  }
  return true;
}
