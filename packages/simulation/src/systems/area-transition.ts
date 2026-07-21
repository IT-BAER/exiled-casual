import { generateArea } from "@pact/mapgen";
import { CONTENT_VERSION } from "@pact/content-runtime";
import { Simulation } from "../loop";
import type { SessionC, MoveTarget, MoveDir, Position } from "../components";
import { buildArea, HIDEOUT_SPAWN, MAP_SPAWN } from "../areas";

export function registerAreaTransition(sim: Simulation): void {
  sim.register("areaTransition", (world) => {
    const sessionEntities = world.query("session");
    if (sessionEntities.length === 0) return;
    const sessionE = sessionEntities[0]!;
    const session = world.get<SessionC>(sessionE, "session")!;
    if (session.pendingArea === "") return;

    const newArea = session.pendingArea as "hideout" | "map";

    // Entities to keep: player(s) + the session singleton.
    const keepSet = new Set<number>(world.query("player"));
    keepSet.add(sessionE);

    // Spread alive to a snapshot before destroying (world.alive is mutated by destroy).
    for (const e of [...world.alive]) {
      if (!keepSet.has(e)) world.destroy(e);
    }

    // Commit the new area to the session before calling buildArea so that
    // spawnPortalRing reads the correct portalsLeft.
    const newSession: SessionC = { ...session, area: newArea, pendingArea: "" };
    world.set<SessionC>(sessionE, "session", newSession);

    // The map is placed against its generated layout; the hideout ignores it.
    // ponytail: collision is registered once at sim creation, so transitioning
    // INTO the map won't collide until Phase D re-wires systems per area.
    const layout = generateArea(newSession.mapSeed, CONTENT_VERSION);
    buildArea(world, newArea, newSession, layout);

    // Move player(s) to the area's spawn and clear stale movement state.
    const spawnPt = newArea === "hideout" ? HIDEOUT_SPAWN : MAP_SPAWN;
    for (const p of world.query("player")) {
      world.set<Position>(p, "position", { x: spawnPt.x, y: spawnPt.y });
      const mt = world.get<MoveTarget>(p, "moveTarget");
      if (mt) world.set<MoveTarget>(p, "moveTarget", { ...mt, active: 0 });
      const md = world.get<MoveDir>(p, "moveDir");
      if (md) world.set<MoveDir>(p, "moveDir", { dx: 0, dy: 0 });
    }
  });
}
