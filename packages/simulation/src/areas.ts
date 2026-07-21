import { fp } from "@pact/fixed-point";
import { makeRare, monsterTierScale } from "@pact/rules";
import { MONSTERS, RARE_TEMPLATE } from "@pact/content-runtime";
import type { MonsterDef } from "@pact/content-schema";
import type { AreaLayout } from "@pact/mapgen";
import type { World, Entity } from "./ecs";
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

    // Portals equal to the current portal budget (0 if map not open or exhausted).
    spawnPortalRing(world, session.portalsLeft);
  } else {
    // Map: imps fill the spawn sockets (last one carries the rare), the warden
    // holds the boss room, and the return portal sits in the exit room. Every
    // position is a walkable socket from the generated layout.
    const scale = monsterTierScale(session.areaTier);
    const impDef = MONSTERS.get("monster.cinder_imp.v1")!;
    const spawns = layout.spawnSockets;
    for (let i = 0; i < spawns.length; i++) {
      const s = spawns[i]!;
      const rare = i === spawns.length - 1;
      const def = rare ? makeRare(impDef, RARE_TEMPLATE) : impDef;
      spawnMonster(world, def, fp(s.x), fp(s.y), rare, scale);
    }

    const boss = anchor(layout, "boss");
    spawnMonster(world, MONSTERS.get("monster.cinder_warden.v1")!, fp(boss.x), fp(boss.y), false, scale);

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
  const scaledLife = Math.trunc(def.maxLifeFixed * scale.lifeMilli / 1000);
  const scaledDmg = Math.trunc(def.attackDamage.amountFixed * scale.dmgMilli / 1000);
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
    attackType: def.attackDamage.type === "fire" ? 0 : 1,
    attackReadyTick: 0,
    state: "idle",
    rare: rare ? 1 : 0,
    summoned: 0,
  });
  world.set<DefensesC>(e, "defenses", {
    fireResPct: def.defenses.fireResPct,
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
