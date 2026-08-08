import { fp } from "@exiled/fixed-point";
import { generateArea, type GrammarId } from "@exiled/mapgen";
import { CONTENT_VERSION, mapBase } from "@exiled/content-runtime";
import { mapBaseIdForNode } from "@exiled/rules";
import { Simulation } from "../loop";
import { type CollisionRef } from "../collision";
import type { SessionC, MoveTarget, MoveDir, Position } from "../components";
import { areaCollision, buildArea, HIDEOUT_SPAWN } from "../areas";
import { SPAWN_GRACE_TICKS } from "./damage-resolve";
import { recomputePlayerStats } from "../derived";
import { restoreArea, suspendArea, suspendedMatches, type SuspendedArea } from "../suspend";

export function registerAreaTransition(sim: Simulation, collisionRef?: CollisionRef): void {
  /**
   * The map the player walked out of and can still walk back into.
   *
   * A closure rather than a component: it must not be in the world, or it would
   * be in the checksum and in the save, and a whole area's population hashed
   * into every tick of the hideout is a lot of arithmetic to prove nothing
   * changed. It dies with the simulation, which is the honest lifetime — a
   * reloaded save has no map standing anywhere.
   */
  let suspended: SuspendedArea | null = null;

  sim.register("areaTransition", (world, tick) => {
    const sessionEntities = world.query("session");
    if (sessionEntities.length === 0) return;
    const sessionE = sessionEntities[0]!;
    const session = world.get<SessionC>(sessionE, "session")!;
    if (session.pendingArea === "") return;

    const newArea = session.pendingArea as "hideout" | "map";

    // Entities to keep: player(s) + the session singleton.
    const keepSet = new Set<number>(world.query("player"));
    keepSet.add(sessionE);

    // Walking out of a map that is still open freezes it, so coming back finds
    // it as it was left. `mapOpen` is the test rather than `portalsLeft`, because
    // the interact system has already spent the portal this crossing costs: at
    // zero portals it also closes the map, and a closed map is one nobody can
    // return to. Leaving with no portals left, or leaving the hideout, drops
    // whatever was held — the map it described is over or was never entered.
    if (session.area === "map" && newArea === "hideout" && session.mapOpen === 1) {
      suspended = suspendArea(world, keepSet, session, tick);
    } else if (session.area === "map") {
      suspended = null;
    }

    // Spread alive to a snapshot before destroying (world.alive is mutated by destroy).
    for (const e of [...world.alive]) {
      if (!keepSet.has(e)) world.destroy(e);
    }

    // Commit the new area to the session before calling buildArea so that
    // spawnPortalRing reads the correct portalsLeft.
    const newSession: SessionC = { ...session, area: newArea, pendingArea: "" };
    world.set<SessionC>(sessionE, "session", newSession);
    // Layout is generated below, so the checkpoint is written after it — see there.

    // The map is placed against its generated layout; the hideout ignores it.
    // The Atlas node decides which base is being run, and the base decides the
    // layout grammar — so a swamp is a loop and a desert is an open field.
    const layout = generateArea(
      newSession.mapSeed,
      CONTENT_VERSION,
      grammarForNode(newSession.activeNodeId),
    );
    // The same map, walked back into: put the frozen population back instead of
    // rolling a fresh one out of the seed. Anything else builds the area.
    if (newArea === "map" && suspendedMatches(suspended, newSession)) {
      restoreArea(world, suspended, tick);
    } else {
      buildArea(world, newArea, newSession, layout, tick);
    }
    // Entering a map consumes what was held either way: it was this map, and it
    // is now standing in the world again, or it was a map the player has walked
    // away from for good and a stale copy of it is just memory nobody will read.
    if (newArea === "map") suspended = null;

    // Swap the shared level collision: the map's walls, and in either area the
    // furniture and shops `buildArea` just stood up. After it, never before —
    // the containers it collides against are entities that call created.
    if (collisionRef) {
      collisionRef.active = areaCollision(world, newArea, layout);
    }

    // A map modifier can tax the player's resistances, and that tax is a
    // property of the area, so crossing a portal has to re-derive the block —
    // in either direction. Nothing else about the player changes here.
    recomputePlayerStats(world);

    // Move player(s) to the area's spawn and clear stale movement state. On the
    // map that is the generated "start" socket, not the (0,0) map origin.
    const spawnPt = newArea === "map" ? mapStart(layout) : HIDEOUT_SPAWN;
    // The map's entrance is also the checkpoint a death can send him back to
    // (systems/revive.ts). Recorded here rather than re-derived on revive, so
    // coming back never has to regenerate a layout to find one anchor.
    if (newArea === "map") {
      // Entering also grants the spawn grace: untouchable while he stands on
      // the entrance and does nothing. damage-resolve owns the breaking.
      world.set<SessionC>(sessionE, "session", {
        ...newSession, checkpointX: spawnPt.x, checkpointY: spawnPt.y,
        graceUntilTick: tick + SPAWN_GRACE_TICKS, graceX: spawnPt.x, graceY: spawnPt.y,
      });
    }
    for (const p of world.query("player")) {
      world.set<Position>(p, "position", { x: spawnPt.x, y: spawnPt.y });
      const mt = world.get<MoveTarget>(p, "moveTarget");
      if (mt) world.set<MoveTarget>(p, "moveTarget", { ...mt, active: 0 });
      const md = world.get<MoveDir>(p, "moveDir");
      if (md) world.set<MoveDir>(p, "moveDir", { dx: 0, dy: 0, hx: 0, hy: 0 });
    }
  });
}

/**
 * The layout grammar an Atlas node's map base is built from. Exported because
 * the client has to generate the identical layout to draw it, and any drift
 * between the two would put walls where the sim has none.
 */
export function grammarForNode(atlasNodeId: string): GrammarId {
  return mapBase(mapBaseIdForNode(atlasNodeId)).layoutGrammarId;
}

/** The map's "start" objective anchor, as fixed-point spawn coordinates. */
function mapStart(layout: ReturnType<typeof generateArea>): { x: number; y: number } {
  const a = layout.objectiveAnchors.find((s) => s.id === "start");
  if (!a) throw new Error('layout missing "start" anchor');
  return { x: fp(a.x), y: fp(a.y) };
}
