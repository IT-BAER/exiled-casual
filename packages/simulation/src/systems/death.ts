import { Simulation } from "../loop";
import type { Health, Mana, MoveTarget, MoveDir, SessionC, MonsterC, Position, ItemC } from "../components";
import { fnv1a32 } from "../rng";
import { rollItem, areaLevel } from "@pact/rules";
import { ITEM_POOLS, baseOf } from "@pact/content-runtime";

export function registerDeath(sim: Simulation): void {
  sim.register("death", (world, tick) => {
    for (const e of world.query("monster", "health")) {
      if ((world.get<Health>(e, "health")?.life ?? 1) > 0) continue;

      const sessionE = world.query("session")[0];
      const s = sessionE !== undefined ? world.get<SessionC>(sessionE, "session") : undefined;
      const isBoss = world.has(e, "boss");
      const isRare = world.get<MonsterC>(e, "monster")?.rare === 1;

      // A dying map boss completes the active Atlas node before it is destroyed.
      if (isBoss && s && s.area === "map" && s.activeNodeId !== "" && !s.completedNodes.includes(s.activeNodeId)) {
        world.set<SessionC>(sessionE!, "session", { ...s, completedNodes: [...s.completedNodes, s.activeNodeId] });
      }

      // Boss and rare monsters drop one committed item where they die.
      if (s && s.area === "map" && (isBoss || isRare)) {
        const pos = world.get<Position>(e, "position");
        if (pos) {
          const seed = fnv1a32(`${s.mapSeed}:${tick}:${e}`);
          const item = rollItem(ITEM_POOLS, seed, areaLevel(s.areaTier), isBoss ? 2 : 1);
          const base = baseOf(item.baseId);
          const ge = world.create();
          world.set<Position>(ge, "position", { x: pos.x, y: pos.y });
          world.set<ItemC>(ge, "item", { item, w: base.w, h: base.h });
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
