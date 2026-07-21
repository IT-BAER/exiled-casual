import { Simulation } from "../loop";
import type { Health, Mana, MoveTarget, MoveDir, SessionC } from "../components";

export function registerDeath(sim: Simulation): void {
  sim.register("death", (world) => {
    for (const e of world.query("monster", "health")) {
      if ((world.get<Health>(e, "health")?.life ?? 1) > 0) continue;
      // A dying map boss completes the active Atlas node before it is destroyed.
      if (world.has(e, "boss")) {
        const sessionE = world.query("session")[0];
        if (sessionE !== undefined) {
          const s = world.get<SessionC>(sessionE, "session")!;
          if (s.area === "map" && s.activeNodeId !== "" && !s.completedNodes.includes(s.activeNodeId)) {
            world.set<SessionC>(sessionE, "session", {
              ...s,
              completedNodes: [...s.completedNodes, s.activeNodeId],
            });
          }
        }
      }
      world.destroy(e);
    }

    for (const e of world.query("player", "health")) {
      const h = world.get<Health>(e, "health")!;
      if (h.life > 0) continue;

      // Restore vitals and clear movement/ailment regardless of path.
      world.set<Health>(e, "health", { ...h, life: h.maxLife });
      const mn = world.get<Mana>(e, "mana");
      if (mn) world.set<Mana>(e, "mana", { ...mn, mana: mn.maxMana });
      const mt = world.get<MoveTarget>(e, "moveTarget");
      if (mt) world.set<MoveTarget>(e, "moveTarget", { ...mt, active: 0 });
      const md = world.get<MoveDir>(e, "moveDir");
      if (md) world.set<MoveDir>(e, "moveDir", { dx: 0, dy: 0 });
      world.remove(e, "ailment");

      const sessionEntities = world.query("session");
      const sessionE = sessionEntities[0];

      if (sessionE === undefined) {
        // Legacy path: no session. Teleport to origin so golden-replay checksums match.
        world.set(e, "position", { x: 0, y: 0 });
      } else {
        // Session path: only spend a portal when dying in the map.
        const session = world.get<SessionC>(sessionE, "session")!;
        if (session.area === "map") {
          const newPortals = Math.max(0, session.portalsLeft - 1);
          world.set<SessionC>(sessionE, "session", {
            ...session,
            portalsLeft: newPortals,
            mapOpen: newPortals === 0 ? 0 : session.mapOpen,
            pendingArea: "hideout",
          });
        }
      }
    }
  });
}
