import { Simulation } from "../loop";
import type { Position, SessionC } from "../components";
import { reviveVitals } from "./death";
import { SPAWN_GRACE_TICKS } from "./damage-resolve";

/**
 * Answering the death screen.
 *
 * Dying no longer decides anything (systems/death.ts just puts the session in
 * `dead: 1` and leaves the body where it fell); this is where the cost is paid
 * and the choice honoured. PoE1 sends you to town and eats one of the map's six
 * portals; PoE2 lets you come back at a checkpoint inside the map instead. We
 * take PoE2's choice and PoE1's price, so a checkpoint revive is not free — it is
 * the same portal, spent to keep your place instead of your progress.
 *
 * "at the checkpoint" is the map's entrance for now: the map has one, recorded on
 * the session when the area was built. Mid-map checkpoints are a mapgen anchor
 * away and change nothing here.
 *
 * The last portal cannot buy a checkpoint. Spending it closes the map, and coming
 * back into a closed map is not a state this session has — so at one portal left
 * the only honest answer is the hideout, and the client greys the other button.
 */
export function registerRevive(sim: Simulation): void {
  sim.register("revive", (world, tick, commands) => {
    const sessionE = world.query("session")[0];
    if (sessionE === undefined) return;
    const session = world.get<SessionC>(sessionE, "session")!;
    if (session.dead !== 1) return;

    for (const cmd of commands) {
      if (cmd.type !== "revive") continue;

      // 1 = at the checkpoint, anything else = back to the hideout. Only ever
      // granted while a portal would still be left over to walk back in on.
      const wantsCheckpoint = cmd.data?.["checkpoint"] === 1;
      const inMap = session.area === "map";
      const portalsLeft = inMap ? Math.max(0, session.portalsLeft - 1) : session.portalsLeft;
      const atCheckpoint = wantsCheckpoint && inMap && portalsLeft > 0;

      world.set<SessionC>(sessionE, "session", {
        ...session,
        dead: 0,
        portalsLeft,
        mapOpen: inMap && portalsLeft === 0 ? 0 : session.mapOpen,
        pendingArea: atCheckpoint ? "" : "hideout",
        // A checkpoint revive wakes among the same monsters, so it carries the
        // same spawn grace a fresh entry does (damage-resolve breaks it). The
        // hideout has nothing to be graced against.
        ...(atCheckpoint
          ? {
            graceUntilTick: tick + SPAWN_GRACE_TICKS,
            graceX: session.checkpointX ?? 0,
            graceY: session.checkpointY ?? 0,
          }
          : {}),
      });

      for (const p of world.query("player")) {
        reviveVitals(world, p);
        // The hideout path is placed by areaTransition; only the checkpoint has
        // to move the body itself, since the area it wakes in is the same one.
        if (atCheckpoint) {
          world.set<Position>(p, "position", {
            x: session.checkpointX ?? 0, y: session.checkpointY ?? 0,
          });
        }
      }
      return; // one revive per death, whatever else is in the queue
    }
  });
}
