import { fp, fpDist2, fpMul } from "@exiled/fixed-point";
import { blockerCollision, gridCollision } from "./collision";
import {
  makeRare, mapBaseIdForNode, monsterTierScale, waystoneScaleFor,
  areaLevel, dropCount, dropCategory, quantityScaleMilli, rollItem,
  MONSTER_ILVL_OFFSET, DROP_POOL,
} from "@exiled/rules";
import {
  PACK_COUNT, bossFor, mapBase, pickPack, rareTemplate,
  ITEM_POOLS, baseOf, currencyItem, currencyForRoll, hideoutFootprints,
} from "@exiled/content-runtime";
import { ELEMENTS, type MonsterDef } from "@exiled/content-schema";
import type { AreaLayout } from "@exiled/mapgen";
import type { World, Entity } from "./ecs";
import { damageCode } from "./damage-types";
import { fnv1a32 } from "./rng";
import type {
  Position, Health, Faction, MonsterC, DefensesC, BossC,
  InteractableC, SessionC, AreaKind, ItemC, ContainerC,
} from "./components";
import type { Blocker, Collision } from "./collision";

/** What a cache pays as the loot math indexes rarity: 2 = rare. A found room is
 *  worth a rare monster's burst, which is where the number comes from rather
 *  than a table of its own. */
const REWARD_RARITY = 2;

// Hideout player spawn (the origin). The map spawns the player on its generated
// "start" socket instead — see area-transition.ts / combat-sim.ts.
export const HIDEOUT_SPAWN = { x: fp(0), y: fp(0) } as const;

/**
 * How close the player has to be to take a portal. Shared by the ring, the map's
 * exit and a Portal Scroll's own doorway, because the scroll's guard against being
 * spent on a spot that is already covered reads this same number.
 */
export const PORTAL_RADIUS: number = fp(2.5);

// Close enough to the (0,0) spawn that the device is on screen the moment you
// arrive: the camera only shows ~9.5 world units vertically.
//
// The literals below are the composed frame — device straight ahead, stash to
// the left, vendor to the right — turned 45 degrees clockwise, because the
// camera is. It looks past the grid diagonally (`CAMERA_ALPHA`), so a device
// placed on +y alone lands up-and-right of the player instead of above him and
// the vendor walks off the bottom-right corner. The turn is rigid and about the
// (0,0) spawn: (x,y) -> ((x-y)/sqrt2, (x+y)/sqrt2), which is why the numbers are
// no longer round. Re-derive them if `CAMERA_ALPHA` ever moves again.
const MAP_DEVICE_X: number = fp(-2.828);
const MAP_DEVICE_Y: number = fp(2.828);
const STASH_X: number = fp(-4.95);
const STASH_Y: number = fp(-2.121);
// Mirror of the stash on the opposite side of the map device, so the two
// vendors flank it the way PoE2's camp keeps the stash and the crafting bench
// on either side of the fire.
const VENDOR_X: number = fp(2.121);
const VENDOR_Y: number = fp(4.95);

/**
 * Offsets from the map device, plus the render yaw that angles each portal outward.
 * Hand-written literals; index order is stable and load-bearing.
 *
 * An arc behind the device rather than a full ring, for two reasons: it frames the
 * way the PoE reference does (portals cluster on the far side, not surrounding you),
 * and a full ring would drop a portal on top of the player's spawn point.
 *
 * The offsets carry the same 45-degree turn as the props above — an arc composed
 * across the screen reads as a line running off the corner without it. The yaws
 * do not: the renderer turns every fixed yaw by the camera's own lean.
 */
const PORTAL_RING: readonly { dx: number; dy: number; yaw: number }[] = [
  { dx: fp(-2.475), dy: fp(-2.475), yaw: -1.4 },
  { dx: fp(-3.394), dy: fp(-0.849), yaw: -0.8 },
  { dx: fp(-3.111), dy: fp(1.556),  yaw: -0.25 },
  { dx: fp(-1.556), dy: fp(3.111),  yaw: 0.25 },
  { dx: fp(0.849),  dy: fp(3.394),  yaw: 0.8 },
  { dx: fp(2.475),  dy: fp(2.475),  yaw: 1.4 },
];

/**
 * Spawn `count` portals around the map device (indices 0..count-1 from PORTAL_RING).
 * Shared by buildArea (hideout path) and the interact system (device activation).
 */
export function spawnPortalRing(world: World, count: number): void {
  // Idempotent: activating the device with a run already open replaces that run,
  // and a ring that appended would leave twelve doorways round a device that owns
  // six. buildArea calls this into a world with none, so it costs nothing there.
  for (const e of [...world.alive]) {
    if (world.get<InteractableC>(e, "interactable")?.kind === "portal") world.destroy(e);
  }
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
      radius: PORTAL_RADIUS,
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

/**
 * @param tick the sim tick the area is being built on. It is the live half of
 *   every loot roll here: PoE rolls a drop when it drops (a kill reads the
 *   killing blow's own state, a strongbox rolls when it is opened), so nothing
 *   the player can walk back to may be a pure function of the map. `mapSeed` is
 *   `mapSeedFor(waystoneSeed, nodeId)` — the same stone on the same node forever
 *   — so the tick is what stops a second entry from laying out the same floor.
 *   Replay stays exact: the same command log rebuilds the area on the same tick.
 */
export function buildArea(world: World, area: AreaKind, session: SessionC, layout: AreaLayout, tick = 0): void {
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
    // Build collision once so every spread position can be validated against
    // the grid before use. Sockets are guaranteed on floor cells by mapgen;
    // the ring offsets are not, so a member could embed in a thick wall and
    // be stuck for the entire run without this guard.
    const col = gridCollision(layout.grid);
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
        // Entrance-mirroring preference is first; fall back to the socket centre
        // (never the nearer offset) so no fallback moves a member closer to the
        // entrance than the socket itself — the alternate side is closer and
        // could land within AGGRO_RADIUS where the preferred was safely a wall.
        const preferred = useFar ? { x: farX, y: farY } : { x: nearX, y: nearY };
        const pos = col.isWalkable(preferred.x, preferred.y, def.radiusFixed)
          ? preferred
          : { x: sx, y: sy };
        spawnMonster(world, def, pos.x, pos.y, rare, scale);
      }
    }

    // The boss is the biome's, not a constant. Boss death is what completes an
    // Atlas node, so a hard-coded id here meant every map in the game — four
    // biomes, four monster pools, four tilesets — ended on the same warden.
    const boss = anchor(layout, "boss");
    const bossDef = withMonsterRes(bossFor(biomeId), ws.monsterResAdd);
    spawnMonster(world, bossDef, fp(boss.x), fp(boss.y), false, scale);

    // Every reward anchor is a CONTAINER now, not loot lying on the floor: a
    // chest, a barrel or a crate the player has to click. The payout math is
    // unchanged — the seed string the old floor caches rolled from rides in
    // `ContainerC.key`, so the same map on the same tick pays the same items;
    // only the moment of the roll moved from area build to the lid opening,
    // which is where PoE rolls a strongbox and where docs/09 wants the wait.
    for (const a of layout.objectiveAnchors) {
      if (!a.id.startsWith("reward.")) continue;
      const pick = fnv1a32(`container:${session.mapSeed}:${a.id}`);
      const ce = world.create();
      world.set<Position>(ce, "position", { x: fp(a.x), y: fp(a.y) });
      world.set<InteractableC>(ce, "interactable", {
        kind: "container",
        radius: fp(2),
        // Seeded, render-only: rows of identically-facing barrels read as level
        // furniture; a scatter of yaws reads as someone's stores.
        yaw: ((pick >>> 8) % 628) / 100,
      });
      world.set<ContainerC>(ce, "container", {
        look: CONTAINER_LOOKS[pick % CONTAINER_LOOKS.length]!,
        key: `cache:${session.mapSeed}:${tick}:${a.id}`,
        opened: 0,
      });
    }

    // Return portal so the map can be exited without dying.
    const exit = anchor(layout, "exit");
    const portalE = world.create();
    world.set<Position>(portalE, "position", { x: fp(exit.x), y: fp(exit.y) });
    world.set<InteractableC>(portalE, "interactable", {
      kind: "portal",
      radius: PORTAL_RADIUS,
      yaw: 3.1416,
    });
  }
}

/**
 * What an interactable's BODY is, which is not what its `radius` says.
 *
 * `InteractableC.radius` is how close you must stand to use the thing (2.5 for
 * the map device, so it answers before you are on top of it); this is how much
 * floor it takes up. A portal is missing on purpose: it is a doorway, and one
 * you cannot walk into is one you cannot take.
 */
const BLOCK_RADIUS: Partial<Record<InteractableC["kind"], number>> = {
  mapDevice: 0.85,   // DEVICE_SPAN 1.61 across in build_props.py
  stash: 0.6,        // STASH_CHEST_W 1.20
  vendor: 0.4,       // a man
  container: 0.42,   // the widest of chest 0.82, crate 0.80, barrel 0.56
};

/**
 * The collision the area is played against: its walls, plus everything standing
 * on the floor.
 *
 * Built from the world rather than from the layout, so it has to be called AFTER
 * `buildArea` — the containers and the shops it collides against are entities
 * that function creates. The hideout has no walls and gets its furniture alone,
 * which is why it is a Collision now where it used to be null.
 */
export function areaCollision(world: World, area: AreaKind, layout: AreaLayout): Collision {
  const blockers: Blocker[] = [];
  for (const e of world.query("interactable")) {
    const it = world.get<InteractableC>(e, "interactable")!;
    const r = BLOCK_RADIUS[it.kind];
    if (r === undefined) continue;
    const p = world.get<Position>(e, "position")!;
    blockers.push({ x: p.x, y: p.y, r: fp(r) });
  }
  if (area !== "map") {
    // Sim (x, y) is Babylon (x, z): the decor list is written in the renderer's
    // axes because that is where it is composed.
    for (const f of hideoutFootprints()) blockers.push({ x: fp(f.x), y: fp(f.z), r: fp(f.r) });
    return blockerCollision(blockers);
  }
  return gridCollision(layout.grid, blockers);
}

/** The looks a reward container can wear, indexed by the anchor's seed. */
const CONTAINER_LOOKS: readonly ContainerC["look"][] = ["chest", "barrel", "crate"];

/**
 * Roll and spill a container's payout onto the floor around it.
 *
 * The maths is the old floor-cache maths verbatim: `key` is the same seed
 * string buildArea used to roll with at area build, so moving the roll to the
 * moment of opening changed WHEN the items exist, never WHICH items they are.
 * A cache pays on the same math a rare kill does (REWARD_RARITY), the count is
 * rolled per container so the player never learns a rate (docs/09), and at
 * least one item drops — a room the player had to find must never be empty.
 */
export function spillContainer(
  world: World,
  session: SessionC,
  key: string,
  ax: number,
  ay: number,
  collision?: Collision | null,
): void {
  const ws = waystoneScaleFor(session.waystoneSeed);
  const cacheIlvl = areaLevel(session.areaTier) + MONSTER_ILVL_OFFSET[REWARD_RARITY]!;
  // The AREA channel only — dropCount folds the rarity channel in itself, and
  // passing a rare-scaled multiplier here scales it twice: 14 items a cache.
  const cacheArea = quantityScaleMilli(0, ws.quantityPct, 0);
  const count = Math.max(1, dropCount(fnv1a32(key), REWARD_RARITY, cacheArea));
  for (let i = 0; i < count; i++) {
    const seed = fnv1a32(`${key}:${i}`);
    const equipment = dropCategory(fnv1a32(`cachecat:${key.slice("cache:".length)}:${i}`), DROP_POOL) === "equipment";
    const item = equipment
      ? rollItem(ITEM_POOLS, seed, cacheIlvl, REWARD_RARITY, undefined, ws.rarityPct)
      : currencyItem(currencyForRoll(seed >>> 8));
    const base = equipment ? baseOf(item.baseId) : { w: 1, h: 1 };
    // Same spread idiom as a death burst, so a five-item payout is a pile on
    // the floor rather than five plates stacked on one tile.
    const off = PACK_SPREAD[i % PACK_SPREAD.length]!;
    const ring = Math.trunc(i / PACK_SPREAD.length) * fp(0.5);
    const px = ax + off.dx + ring, py = ay + off.dy + ring;
    const on = collision && !collision.isWalkable(px, py, fp(0.3)) ? { x: ax, y: ay } : { x: px, y: py };
    const ge = world.create();
    world.set<Position>(ge, "position", on);
    world.set<ItemC>(ge, "item", { item, w: base.w, h: base.h });
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
    slamReadyTick: 0,
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
