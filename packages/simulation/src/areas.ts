import { fp, fpDist2, fpMul } from "@exiled/fixed-point";
import { makeRare, mapBaseIdForNode, monsterTierScale, waystoneScaleFor } from "@exiled/rules";
import { MONSTERS, PACK_COUNT, mapBase, pickPack, rareTemplate } from "@exiled/content-runtime";
import { ELEMENTS, type MonsterDef } from "@exiled/content-schema";
import type { AreaLayout } from "@exiled/mapgen";
import type { World, Entity } from "./ecs";
import { damageCode } from "./damage-types";
import type {
  Position, Health, Faction, MonsterC, DefensesC, BossC,
  InteractableC, SessionC, AreaKind,
} from "./components";

// Hideout player spawn (the origin). The map spawns the player on its generated
// "start" socket instead — see area-transition.ts / combat-sim.ts.
export const HIDEOUT_SPAWN = { x: fp(0), y: fp(0) } as const;

// Close enough to the (0,0) spawn that the device is on screen the moment you
// arrive: the ortho camera only shows ~9.5 world units vertically.
const MAP_DEVICE_X: number = fp(0);
const MAP_DEVICE_Y: number = fp(4);
const STASH_X: number = fp(-5);
const STASH_Y: number = fp(2);
// Mirror of the stash on the opposite side of the map device, so the two
// vendors flank it the way PoE2's camp keeps the stash and the crafting bench
// on either side of the fire.
const VENDOR_X: number = fp(5);
const VENDOR_Y: number = fp(2);

/**
 * Offsets from the map device, plus the render yaw that angles each portal outward.
 * Hand-written literals; index order is stable and load-bearing.
 *
 * An arc behind the device rather than a full ring, for two reasons: it frames the
 * way the PoE reference does (portals cluster on the far side, not surrounding you),
 * and a full ring would drop a portal on top of the player's spawn point.
 */
const PORTAL_RING: readonly { dx: number; dy: number; yaw: number }[] = [
  { dx: fp(-3.5), dy: fp(0),   yaw: -1.4 },
  { dx: fp(-3),   dy: fp(1.8), yaw: -0.8 },
  { dx: fp(-1.1), dy: fp(3.3), yaw: -0.25 },
  { dx: fp(1.1),  dy: fp(3.3), yaw: 0.25 },
  { dx: fp(3),    dy: fp(1.8), yaw: 0.8 },
  { dx: fp(3.5),  dy: fp(0),   yaw: 1.4 },
];

/**
 * Spawn `count` portals around the map device (indices 0..count-1 from PORTAL_RING).
 * Shared by buildArea (hideout path) and the interact system (device activation).
 */
export function spawnPortalRing(world: World, count: number): void {
  // Clamped: map affixes are specced to change the revive count (docs/01 §8), and
  // a budget larger than the ring would otherwise index past the end.
  const n = Math.min(count, PORTAL_RING.length);
  for (let i = 0; i < n; i++) {
    const slot = PORTAL_RING[i]!;
    const e = world.create();
    world.set<Position>(e, "position", {
      x: MAP_DEVICE_X + slot.dx,
      y: MAP_DEVICE_Y + slot.dy,
    });
    world.set<InteractableC>(e, "interactable", {
      kind: "portal",
      radius: fp(2.5),
      yaw: slot.yaw,
    });
  }
}

/**
 * Where the members of one pack stand relative to the socket they share. Literal
 * fixed-point, never trig: the sim stays deterministic.
 *
 * Eight entries, because the largest pack is a swarm of 4 and a 100% pack-size
 * roll doubles it. At five entries the extras landed back on top of the first
 * three and a doubled swarm read as four monsters, not eight.
 */
const PACK_SPREAD: readonly { dx: number; dy: number }[] = [
  { dx: fp(0), dy: fp(0) },
  { dx: fp(1.4), dy: fp(0.9) },
  { dx: fp(-1.4), dy: fp(-0.9) },
  { dx: fp(1.5), dy: fp(-0.8) },
  { dx: fp(-1.5), dy: fp(0.8) },
  { dx: fp(0), dy: fp(1.7) },
  { dx: fp(0), dy: fp(-1.7) },
  { dx: fp(2.2), dy: fp(0) },
];

// Same idiom as rules/items.ts and rules/vendor.ts: every consumer of
// mulberry32 keeps its own file-local copy rather than sharing one, so this
// leaf never has to import a stream generator from elsewhere.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/**
 * How dangerous this run's monsters are: the map's tier, then the Waystone's
 * own modifiers on top. One function so every spawner and the boss AI agree —
 * the last time these were computed in two places, a Tier 15 Warden slammed for
 * its Tier 1 number for weeks.
 */
export function mapDangerScale(session: SessionC): { lifeMilli: number; dmgMilli: number } {
  const tier = monsterTierScale(session.areaTier);
  const ws = waystoneScaleFor(session.waystoneSeed);
  // Per-mille factors compose by multiplication, not by addition: "40% more
  // life" on a Tier 10 map is 40% more than the tier already granted.
  return {
    lifeMilli: Math.trunc((tier.lifeMilli * ws.lifeMilli) / 1000),
    dmgMilli: Math.trunc((tier.dmgMilli * ws.dmgMilli) / 1000),
  };
}

/** The same monster, with a flat percent added to each of its elemental resistances. */
function withMonsterRes(def: MonsterDef, add: number): MonsterDef {
  if (add === 0) return def;
  const resPct = { ...def.defenses.resPct };
  for (const el of ELEMENTS) resPct[el] += add;
  return { ...def, defenses: { ...def.defenses, resPct } };
}

export function buildArea(world: World, area: AreaKind, session: SessionC, layout: AreaLayout): void {
  if (area === "hideout") {
    // Map device
    const deviceE = world.create();
    world.set<Position>(deviceE, "position", { x: MAP_DEVICE_X, y: MAP_DEVICE_Y });
    world.set<InteractableC>(deviceE, "interactable", {
      kind: "mapDevice",
      radius: fp(2.5),
      yaw: 0,
    });

    // Stash, off to the side of the map device the way PoE2's camp keeps its
    // chest at the edge of the fire rather than in the traffic lane.
    const stashE = world.create();
    world.set<Position>(stashE, "position", { x: STASH_X, y: STASH_Y });
    world.set<InteractableC>(stashE, "interactable", {
      kind: "stash",
      radius: fp(2.5),
      yaw: 0,
    });

    // Disenchanter vendor, mirroring the stash on the right side so items can
    // be sold without crossing the map-device traffic lane.
    const vendorE = world.create();
    world.set<Position>(vendorE, "position", { x: VENDOR_X, y: VENDOR_Y });
    world.set<InteractableC>(vendorE, "interactable", {
      kind: "vendor",
      // Turned to face the camera. This was 0 while the disenchanter was a
      // bench, which reads the same from either side; he is a man now, and at
      // yaw 0 the player walks up to talk to the back of his hood.
      radius: fp(2.5),
      yaw: 3.14159,
    });

    // Portals equal to the current portal budget (0 if map not open or exhausted).
    spawnPortalRing(world, session.portalsLeft);
  } else {
    // Map: the active node's biome pool fills the spawn sockets (last one
    // carries the rare), the warden holds the boss room, and the return portal
    // sits in the exit room. Every position is a walkable socket from the
    // generated layout.
    const scale = mapDangerScale(session);
    const ws = waystoneScaleFor(session.waystoneSeed);
    // Which biome this is decides what lives in it. Same route the layout
    // grammar takes (systems/area-transition.ts): the Atlas node picks the base,
    // the base picks the biome.
    const biomeId = mapBase(mapBaseIdForNode(session.activeNodeId)).biomeId;
    // One stream, walked once per socket in socket order, so the same map seed
    // always fields the same bestiary. Same idiom as rules/items.ts. mulberry32
    // returns a raw uint32, so pickPack (which wants a 0..1 roll) needs it
    // normalised the same way atlas.ts's frac() does, or every roll clamps to
    // the top of the pool and every socket fields the same species.
    const rnd = mulberry32(session.mapSeed ^ 0x9e37);
    const frac = () => rnd() / 0x100000000;
    const spawns = layout.spawnSockets;
    // The socket itself is a sanctioned distance from the entrance; the ring
    // offset is not. Mirroring an offset that would land closer to "start" onto
    // the far side keeps every member at least as far out as its socket, so a
    // pack can never wake on its own the moment the player steps off the portal.
    const startAnchor = anchor(layout, "start");
    const startX = fp(startAnchor.x), startY = fp(startAnchor.y);
    for (let i = 0; i < spawns.length; i++) {
      const s = spawns[i]!;
      const sx = fp(s.x), sy = fp(s.y);
      const base = withMonsterRes(pickPack(biomeId, frac()), ws.monsterResAdd);
      // Pack size adds to the pack the socket already has. The generator owns
      // where a fight can stand, so a modifier adds bodies to a sanctioned
      // socket and never invents a new one.
      const packed = PACK_COUNT[base.archetype];
      const count = packed + Math.trunc((packed * ws.packSizePct) / 100);
      for (let j = 0; j < count; j++) {
        // The first member of the last socket carries the rare, so a big pack-size
        // roll means more to kill rather than more rares to answer.
        const rare = i === spawns.length - 1 && j === 0;
        // The map's own seed picks the rare's element, so a given map always
        // demands the same resistance and a replay of it stays identical.
        const def = rare ? makeRare(base, rareTemplate(session.mapSeed)) : base;
        const ring = PACK_SPREAD[j % PACK_SPREAD.length]!;
        const nearX = sx + ring.dx, nearY = sy + ring.dy;
        const farX = sx - ring.dx, farY = sy - ring.dy;
        const useFar = fpDist2(startX, startY, farX, farY) > fpDist2(startX, startY, nearX, nearY);
        const x = useFar ? farX : nearX, y = useFar ? farY : nearY;
        spawnMonster(world, def, x, y, rare, scale);
      }
    }

    const boss = anchor(layout, "boss");
    const bossDef = withMonsterRes(MONSTERS.get("monster.cinder_warden.v1")!, ws.monsterResAdd);
    spawnMonster(world, bossDef, fp(boss.x), fp(boss.y), false, scale);

    // Return portal so the map can be exited without dying.
    const exit = anchor(layout, "exit");
    const portalE = world.create();
    world.set<Position>(portalE, "position", { x: fp(exit.x), y: fp(exit.y) });
    world.set<InteractableC>(portalE, "interactable", {
      kind: "portal",
      radius: fp(2.5),
      yaw: 3.1416,
    });
  }
}

/** An objective anchor from the layout, or throw if the generator omitted it. */
function anchor(layout: AreaLayout, id: string): { x: number; y: number } {
  const a = layout.objectiveAnchors.find((s) => s.id === id);
  if (!a) throw new Error(`layout missing "${id}" anchor`);
  return a;
}

export function spawnMonster(
  world: World,
  def: MonsterDef,
  x: number,
  y: number,
  rare: boolean,
  scale: { lifeMilli: number; dmgMilli: number } = { lifeMilli: 1000, dmgMilli: 1000 },
): Entity {
  const scaledLife = fpMul(def.maxLifeFixed, scale.lifeMilli);
  const scaledDmg = fpMul(def.attackDamage.amountFixed, scale.dmgMilli);
  const e = world.create();
  world.set<Position>(e, "position", { x, y });
  world.set<Health>(e, "health", { life: scaledLife, maxLife: scaledLife });
  world.set<Faction>(e, "faction", { team: 1 });
  world.set<MonsterC>(e, "monster", {
    defId: def.id,
    moveSpeed: Math.trunc(def.moveSpeedFixed / 30),
    bodyRadius: def.radiusFixed,
    attackRange: def.attackRangeFixed,
    attackCooldownTicks: def.attackCooldownTicks,
    attackDamage: scaledDmg,
    attackType: damageCode(def.attackDamage.type),
    attackReadyTick: 0,
    rootedUntilTick: 0,
    state: "idle",
    rare: rare ? 1 : 0,
    summoned: 0,
  });
  world.set<DefensesC>(e, "defenses", {
    res: def.defenses.resPct,
    armour: def.defenses.armourFixed,
  });
  if (def.boss) {
    world.set<BossC>(e, "boss", {
      phase: 1,
      nextAbilityTick: 0,
      spawnX: x,
      spawnY: y,
      rootedUntilTick: 0,
    });
  }
  return e;
}
