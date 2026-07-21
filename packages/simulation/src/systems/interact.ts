import { MAP_PORTALS } from "@pact/protocol";
import { offerWaystones, atlasNodes, WAYSTONE_OFFER_COUNT } from "@pact/rules";
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
      // ── Map activation: pick a node + waystone from the preparation panel ──
      if (cmd.type === "activateMap") {
        const session = world.get<SessionC>(sessionE, "session")!;
        if (session.mapOpen !== 0) continue;      // already open
        if (session.area !== "hideout") continue; // only from the hideout device
        const atlasNodeId = cmd.atlasNodeId;
        const waystoneId = cmd.waystoneId;
        if (!atlasNodeId || !waystoneId) continue;
        if (!atlasNodes().some((n) => n.id === atlasNodeId)) continue;
        if (session.completedNodes.includes(atlasNodeId)) continue;
        const ws = offerWaystones(session.atlasSeed, WAYSTONE_OFFER_COUNT)
          .find((w) => w.id === waystoneId);
        if (!ws) continue;
        world.set<SessionC>(sessionE, "session", {
          ...session,
          mapSeed: ws.seed,
          areaTier: ws.tier,
          activeNodeId: atlasNodeId,
          portalsLeft: MAP_PORTALS,
          mapOpen: 1,
        });
        spawnPortalRing(world, MAP_PORTALS);
        continue;
      }

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
        // The device no longer auto-opens; the client opens the preparation
        // panel and sends activateMap. A device click is now a no-op.
        continue;
      } else if (ia.kind === "portal") {
        world.set<SessionC>(sessionE, "session", {
          ...session,
          pendingArea: session.area === "hideout" ? "map" : "hideout",
        });
      }
    }
  });
}
