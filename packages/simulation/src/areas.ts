import { fp, fpMul } from "@exiled/fixed-point";
import { makeRare, monsterTierScale, waystoneScaleFor } from "@exiled/rules";
import { MONSTERS, rareTemplate } from "@exiled/content-runtime";
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
 * Where a pack-size extra stands relative to the socket it doubles. Literal
 * fixed-point, in the same idiom as PORTAL_RING and the boss's SUMMON_RING.
 */
const PACK_SPREAD: readonly { dx: number; dy: number }[] = [
  { dx: fp(0), dy: fp(0) },
  { dx: fp(1.4), dy: fp(0.9) },
  { dx: fp(-1.4), dy: fp(-0.9) },
];

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

    // Portals equal to the current portal budget (0 if map not open or exhausted).
    spawnPortalRing(world, session.portalsLeft);
  } else {
    // Map: imps fill the spawn sockets (last one carries the rare), the warden
    // holds the boss room, and the return portal sits in the exit room. Every
    // position is a walkable socket from the generated layout.
    const scale = mapDangerScale(session);
    const ws = waystoneScaleFor(session.waystoneSeed);
    const impDef = withMonsterRes(MONSTERS.get("monster.cinder_imp.v1")!, ws.monsterResAdd);
    const spawns = layout.spawnSockets;
    // Pack size adds monsters to the sockets the layout already has, one extra
    // pass at a time: the generator owns where a fight can stand, and a modifier
    // must not be able to put one inside a wall.
    const total = spawns.length + Math.trunc((spawns.length * ws.packSizePct) / 100);
    for (let i = 0; i < total; i++) {
      const s = spawns[i % spawns.length]!;
      // The last of the layout's own sockets carries the rare; the pack-size
      // extras are ordinary monsters, so a big roll means more to kill rather
      // than more rares to answer.
      const rare = i === spawns.length - 1;
      // The map's own seed picks the rare's element, so a given map always
      // demands the same resistance and a replay of it stays identical.
      const def = rare ? makeRare(impDef, rareTemplate(session.mapSeed)) : impDef;
      // Extras are nudged off the socket centre so a doubled pack does not stand
      // in one column. Literal offsets, never trig: the sim stays deterministic.
      const ring = PACK_SPREAD[Math.trunc(i / spawns.length) % PACK_SPREAD.length]!;
      spawnMonster(world, def, fp(s.x) + ring.dx, fp(s.y) + ring.dy, rare, scale);
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
