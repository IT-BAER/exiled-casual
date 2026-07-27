import { Simulation } from "../loop";
import type { Health, Mana, MoveTarget, MoveDir, SessionC, MonsterC, Position, ItemC, FlasksC, ProgressC, EnergyShieldC } from "../components";
import { fp } from "@exiled/fixed-point";
import { fnv1a32 } from "../rng";
import {
  rollItem, areaLevel, FLASK_CHARGES_PER_KILL, gainXp, xpAward,
  waystoneScaleFor, waystoneDrops, waystoneMods,
  dropCount, dropCategory, quantityScaleMilli, MONSTER_ILVL_OFFSET, DROP_POOL, BOSS_DROP_POOL,
} from "@exiled/rules";
import { recomputePlayerStats } from "../derived";
import { ITEM_POOLS, baseOf, currencyItem, currencyForRoll } from "@exiled/content-runtime";

/**
 * Monster rarity as the loot math indexes it: 0..3 normal, magic, rare, unique.
 * We have no magic monsters yet; the index exists so adding them is data.
 * A boss is unique, which is 29.5x a normal monster's quantity — that burst is
 * docs/09 rule 3 (intensity beats density) falling out of PoE's own numbers
 * rather than a hardcoded count.
 */
const MR_NORMAL = 0;
const MR_RARE = 2;
const MR_UNIQUE = 3;

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

      // What the kill pays. Every monster is on the same math now, PoE's own:
      // its rarity is a quantity multiplier rather than a special case, the
      // stone is a second and linear channel on top of it, and the whole part
      // of the result is guaranteed while the remainder is one coin flip.
      if (s && s.area === "map") {
        const pos = world.get<Position>(e, "position");
        if (pos) {
          const mr = isBoss ? MR_UNIQUE : isRare ? MR_RARE : MR_NORMAL;
          const ws = waystoneScaleFor(s.waystoneSeed);
          const area = quantityScaleMilli(MR_NORMAL, ws.quantityPct, 0);
          // A boss can never pay nothing: docs/09 rule 4, the map closes on a
          // guaranteed payout. Everything above the floor stays fully variable.
          const count = Math.max(dropCount(fnv1a32(`count:${s.mapSeed}:${tick}:${e}`), mr, area), isBoss ? 1 : 0);
          const ilvl = areaLevel(s.areaTier) + MONSTER_ILVL_OFFSET[mr]!;
          const pool = isBoss ? BOSS_DROP_POOL : DROP_POOL;

          for (let i = 0; i < count; i++) {
            const seed = fnv1a32(`${s.mapSeed}:${tick}:${e}:${i}`);
            // Category is its own stream (docs/02 §13), so what a drop is stays
            // independent of what it rolled. The boss's first item is the
            // guaranteed one and skips the pool: it is always a rare.
            const forced = isBoss && i === 0;
            const equipment = forced || dropCategory(fnv1a32(`cat:${s.mapSeed}:${tick}:${e}:${i}`), pool) === "equipment";
            const item = equipment
              ? rollItem(ITEM_POOLS, seed, ilvl, mr, forced ? "rare" : undefined, ws.rarityPct)
              : currencyItem(currencyForRoll(seed >>> 8));
            const base = equipment ? baseOf(item.baseId) : { w: 1, h: 1 };
            // Second and further rings, so a stone that doubles the payout does
            // not stack two plates on one tile.
            const off = DROP_SPREAD[i % DROP_SPREAD.length]!;
            const ring = Math.trunc(i / DROP_SPREAD.length) * fp(0.5);
            const ge = world.create();
            world.set<Position>(ge, "position", { x: pos.x + off.dx + ring, y: pos.y + off.dy + ring });
            world.set<ItemC>(ge, "item", { item, w: base.w, h: base.h });
          }
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
