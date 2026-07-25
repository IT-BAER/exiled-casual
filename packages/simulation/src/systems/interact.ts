import { MAP_PORTALS } from "@exiled/protocol";
import { atlasGraph, isNodeReachable, mapSeedFor, atlasNodeTier } from "@exiled/rules";
import { Simulation } from "../loop";
import type { Position, InteractableC, SessionC } from "../components";
import { spawnPortalRing } from "../areas";
import { inRangeOf } from "../protocol-bridge";

/** "ws-3" -> 3, and null for anything that is not a positional stone id. */
function waystoneIndex(id: string): number | null {
  const m = /^ws-(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

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
        if (session.completedNodes.includes(atlasNodeId)) continue;
        // Fog is a server rule, not a greyed-out button: the client is untrusted.
        const graph = atlasGraph(session.atlasSeed);
        if (!isNodeReachable(graph, session.completedNodes, atlasNodeId)) continue;
        // The id is the stone's index in the owned stock (see Waystone.id), so
        // the sim resolves it against its own list rather than trusting a client
        // to name a stone the character does not have.
        const index = waystoneIndex(waystoneId);
        const ws = index === null ? undefined : session.waystones[index];
        if (!ws) continue;
        // A place further out demands a better stone. Server-side for the same
        // reason the fog is: the greyed-out tile is a courtesy, not the rule.
        if (ws.tier < atlasNodeTier(graph, atlasNodeId)) continue;
        world.set<SessionC>(sessionE, "session", {
          ...session,
          // Spent: opening the map consumes the stone, which is what makes
          // sustain a mechanic rather than a menu.
          waystones: session.waystones.filter((_, i) => i !== index),
          // The place is half the seed: the same Waystone run at two nodes has to
          // draw two different maps, or the route decision buys nothing.
          mapSeed: mapSeedFor(ws.seed, atlasNodeId),
          waystoneSeed: ws.seed,
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
