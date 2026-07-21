import { MAP_PORTALS } from "@pact/protocol";
import { Simulation } from "../loop";
import type { Position, InteractableC, SessionC } from "../components";
import { spawnPortalRing } from "../areas";
import { inRangeOf } from "../protocol-bridge";

export function registerInteractSystem(sim: Simulation): void {
  sim.register("interact", (world, _tick, commands) => {
    // Require a session singleton; legacy sims without one are no-ops.
    const sessionEntities = world.query("session");
    if (sessionEntities.length === 0) return;
    const sessionE = sessionEntities[0]!;

    for (const cmd of commands) {
      if (cmd.type !== "interact" || cmd.entity === undefined) continue;

      const targetId = cmd.data?.["targetId"];
      if (targetId === undefined) continue;

      // Entity must be alive with interactable + position.
      if (!world.alive.has(targetId)) continue;
      if (!world.has(targetId, "interactable") || !world.has(targetId, "position")) continue;

      // Range re-check: the sim is authoritative (client is untrusted).
      const playerPos = world.get<Position>(cmd.entity, "position");
      if (!playerPos) continue;

      const ia = world.get<InteractableC>(targetId, "interactable")!;
      const pos = world.get<Position>(targetId, "position")!;
      if (!inRangeOf(playerPos.x, playerPos.y, pos.x, pos.y, ia.radius)) continue;

      // Re-read session here (may have been updated by a previous command this tick).
      const session = world.get<SessionC>(sessionE, "session")!;

      if (ia.kind === "mapDevice") {
        if (session.mapOpen !== 0) continue; // already open, no-op
        world.set<SessionC>(sessionE, "session", {
          ...session,
          mapOpen: 1,
          portalsLeft: MAP_PORTALS,
        });
        spawnPortalRing(world, MAP_PORTALS);
      } else if (ia.kind === "portal") {
        world.set<SessionC>(sessionE, "session", {
          ...session,
          pendingArea: session.area === "hideout" ? "map" : "hideout",
        });
      }
    }
  });
}
