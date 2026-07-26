import { Simulation } from "../loop";
import type { Health, Mana, MoveTarget, MoveDir, SessionC, MonsterC, Position, ItemC, FlasksC, ProgressC, EnergyShieldC } from "../components";
import { fp } from "@exiled/fixed-point";
import { fnv1a32 } from "../rng";
import {
  rollItem, areaLevel, FLASK_CHARGES_PER_KILL, gainXp, xpAward,
  waystoneScaleFor, waystoneDrops, waystoneMods,
} from "@exiled/rules";
import { recomputePlayerStats } from "../derived";
import { ITEM_POOLS, baseOf, wisdomScroll } from "@exiled/content-runtime";

/**
 * How many items a map boss pays out. `docs/09-reward-psychology.md` rule 3:
 * intensity beats density, so the same loot budget spent in one burst reads far
 * louder than the same items trickling off five monsters. One item made the
 * warden pay exactly what a rare pays, which is the flat ending PoE2's own
 * 0.2.0g patch went and fixed. Five is enough to cover the ground around the
 * corpse and still be pickable without a stash trip.
 */
export const BOSS_DROP_COUNT = 5;

/** Percent of map kills that pay a Scroll of Wisdom. One in four keeps the reveal cheap
 *  without making it free: a dry spell still has to be felt to be broken. */
const SCROLL_DROP_PCT = 25;

/**
 * Where each item of a burst lands relative to the corpse. Literal fixed-point
 * in the same idiom as areas.ts's PACK_SPREAD: never trig, so the sim stays
 * deterministic, and distinct per index so five plates do not overlap into one.
 */
const DROP_SPREAD: readonly { dx: number; dy: number }[] = [
  { dx: fp(0), dy: fp(0) },
  { dx: fp(1.3), dy: fp(0.8) },
  { dx: fp(-1.3), dy: fp(0.8) },
  { dx: fp(1.3), dy: fp(-0.8) },
  { dx: fp(-1.3), dy: fp(-0.8) },
];

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
        // Clearing a map hands stones back — one for a plain run, two (the
        // second a tier higher) for one taken on a stone that carried
        // modifiers. This is the loop that keeps a character in maps.
        const drops = waystoneDrops(s.mapSeed, s.areaTier, waystoneMods(s.waystoneSeed).length > 0);
        world.set<SessionC>(sessionE!, "session", {
          ...s,
          completedNodes: [...s.completedNodes, s.activeNodeId],
          waystones: [...s.waystones, ...drops.map((d) => ({ seed: d.seed, tier: d.tier }))],
        });
      }

      // A rare drops one committed item; a boss drops the burst (see below).
      if (s && s.area === "map" && (isBoss || isRare)) {
        const pos = world.get<Position>(e, "position");
        if (pos) {
          const count = isBoss ? BOSS_DROP_COUNT : 1;
          for (let i = 0; i < count; i++) {
            const seed = fnv1a32(`${s.mapSeed}:${tick}:${e}:${i}`);
            // The boss's first item is the guaranteed one. Everything after it
            // rolls normally, so the floor rises without the variance narrowing.
            const forced = isBoss && i === 0 ? "rare" : undefined;
            const item = rollItem(ITEM_POOLS, seed, areaLevel(s.areaTier), isBoss ? 2 : 1, forced);
            const base = baseOf(item.baseId);
            const off = DROP_SPREAD[i % DROP_SPREAD.length]!;
            const ge = world.create();
            world.set<Position>(ge, "position", { x: pos.x + off.dx, y: pos.y + off.dy });
            world.set<ItemC>(ge, "item", { item, w: base.w, h: base.h });
          }
        }
      }

      // Scrolls come off the volume kills, not the set pieces: an unread rare is only
      // a tease if the reveal is affordable, so supply has to outrun the unidentified
      // drops it pays for (docs/02 §24, docs/09 rule 1).
      if (s && s.area === "map") {
        const pos = world.get<Position>(e, "position");
        if (pos && fnv1a32(`scroll:${s.mapSeed}:${tick}:${e}`) % 100 < SCROLL_DROP_PCT) {
          const ge = world.create();
          world.set<Position>(ge, "position", { x: pos.x, y: pos.y });
          world.set<ItemC>(ge, "item", { item: wisdomScroll(), w: 1, h: 1 });
        }
      }

      // Experience, on the same terms as the loot: only in a map, where the area
      // level that prices the kill actually exists. A level-up re-derives the
      // player's stats, because the new maximum life is granted the way a chest
      // piece grants it — as headroom, not as a heal.
      if (s && s.area === "map" && sessionE !== undefined) {
        const prog = world.get<ProgressC>(sessionE, "progress");
        if (prog) {
          const kind = isBoss ? "boss" : isRare ? "rare" : "normal";
          // The stone's experience modifier is the last thing applied, so it
          // scales what the kill was actually worth after the level penalty.
          const base = xpAward(prog.level, areaLevel(s.areaTier), kind);
          const gain = Math.trunc((base * (100 + waystoneScaleFor(s.waystoneSeed).experiencePct)) / 100);
          const next = gainXp(prog.level, prog.xp, gain);
          world.set<ProgressC>(sessionE, "progress", next);
          if (next.level !== prog.level) recomputePlayerStats(world);
        }
      }

      // Grant flask charges to every player entity with flasks before destroy.
      for (const pe of world.query("player", "flasks")) {
        const f = world.get<FlasksC>(pe, "flasks")!;
        world.set<FlasksC>(pe, "flasks", {
          ...f,
          lifeCharges: Math.min(f.lifeMax, f.lifeCharges + FLASK_CHARGES_PER_KILL),
          manaCharges: Math.min(f.manaMax, f.manaCharges + FLASK_CHARGES_PER_KILL),
        });
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
      const es = world.get<EnergyShieldC>(e, "energyShield");
      if (es) world.set<EnergyShieldC>(e, "energyShield", { ...es, es: es.maxEs, rechargeAtTick: 0 });
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
