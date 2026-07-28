import { MAP_PORTALS } from "@exiled/protocol";
import { atlasGraph, isNodeReachable, mapSeedFor, atlasNodeTier } from "@exiled/rules";
import { Simulation } from "../loop";
import type { Position, InteractableC, SessionC, InventoryC } from "../components";
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
        if (!atlasNodeId) continue;
        if (session.completedNodes.includes(atlasNodeId)) continue;
        // Fog is a server rule, not a greyed-out button: the client is untrusted.
        const graph = atlasGraph(session.atlasSeed);
        if (!isNodeReachable(graph, session.completedNodes, atlasNodeId)) continue;
        // The stone is a grid item now, named by where it sits: the client sends
        // a cell, the sim reads its own inventory. It never trusts a client to
        // name a stone, and a cell holding anything but a waystone is a no-op.
        const inv = world.get<InventoryC>(sessionE, "inventory");
        const index = inv ? inv.items.findIndex((p) => p.x === cmd.data?.["x"] && p.y === cmd.data?.["y"]) : -1;
        const placed = index === -1 ? undefined : inv!.items[index]!;
        const ws = placed?.item.waystone;
        if (!ws) continue;
        // A place further out demands a better stone. Server-side for the same
        // reason the fog is: the greyed-out tile is a courtesy, not the rule.
        if (ws.tier < atlasNodeTier(graph, atlasNodeId)) continue;
        // Spent: opening the map consumes the stone, which is what makes sustain
        // a mechanic rather than a menu.
        world.set<InventoryC>(sessionE, "inventory", {
          ...inv!,
          items: inv!.items.filter((_, i) => i !== index),
        });
        world.set<SessionC>(sessionE, "session", {
          ...session,
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
