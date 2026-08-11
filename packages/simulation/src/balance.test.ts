import { describe, expect, it } from "vitest";
import { fp } from "@exiled/fixed-point";
import { baseCasterStats, burningTickDamage, AILMENT_TICK_INTERVAL } from "@exiled/rules";
import { MONSTERS, SKILLS, RARE_TEMPLATES, MONSTER_POOLS, PACK_COUNT, BOSSES } from "@exiled/content-runtime";
import type { BiomeId, MonsterDef } from "@exiled/content-schema";
import { makeRare } from "@exiled/rules";
import { createCombatSim, spawnLabActors } from "./combat-sim";
import { gridCollision, sweep } from "./collision";
import { spawnMonster } from "./areas";
import { Simulation } from "./loop";
import type { Command } from "./loop";
import type { World, Entity } from "./ecs";
import type { Health, Mana, Position, MonsterC, SessionC, SkillsC, Cooldowns } from "./components";

/**
 * Encounter pacing, measured rather than asserted from arithmetic. Two slices
 * (armour-by-hit-size, elemental resistances) moved difficulty with nothing
 * watching, so this is the net: every band below is a design intent in seconds,
 * deliberately wide enough to survive a retune and narrow enough to catch a
 * fight drifting to three times its length.
 *
 * The rig is the real sim (`createCombatSim`) with real content. The player
 * stands still at the origin and plays its best rotation — Cinder Ground the
 * moment it is off cooldown, Ember Bolt with the mana left over — because the
 * mana pool, not the cast rate, is what caps its damage.
 *
 * Measured at the mana retune (Tier 0, no gear), so a future run has something to
 * compare against rather than only a band to clear:
 *
 *   kill    imp 0.6s | pack of five 1.2s | rare 3.2s (6.4s vs its own element)
 *           Cinder Warden 19.2s | Ghaltrek 17.7s | Mother Vhal 19.7s | Sirrath 26.7s
 *
 * Re-measured at the cooldown retune (bolt 0.5s -> 1s, ground 1s -> 3s, blink
 * 3s -> 5s), same character, same content otherwise:
 *
 *   kill    swamp boss 11.7s | forest 12.6s | coast 11.7s
 *           swarm 4.0s | brute 5.5s | shooter 3.4s | heavy 6.7s
 *
 * Bosses got SHORTER while trash got longer, and the two have one cause between
 * them: mana. A boss fight is long enough to be paid for by regeneration, and
 * Cinder Ground's 3-second field on a 3-second cooldown holds the same uptime it
 * always did for a third of the mana, so the freed pool buys bolts. Trash dies
 * inside the opening full pool, where a halved bolt rate is simply half the rate.
 *
 * The four bosses share one life pool and still measure 9 seconds apart, because
 * what is timed is the FIGHT and not the boss: Sirrath's phase two brings four
 * skitterers where the Warden's brings two imps, and the clear is not over until
 * the brood is. That is the intended shape of a swarm boss and it stays inside
 * the band; if a future add count pushes it past 40s, raise the count's cost,
 * not the band.
 *   die     imp 26.0s | pack 6.6s | Warden phase 1 11.0s | phase 2 3.8s
 *   act     2.18 casts/s against the Warden, of a 3.75/s ceiling
 *
 * The Warden's is the same 20-second fight it was before mana regeneration went
 * from 6/s to 15/s — its life was raised to hold that. What changed is what the
 * 20 seconds contain: 1.05 casts/s became 2.18.
 *
 * Re-measured at the casual pass (monster life -25%, monster hit -30%, content-
 * runtime/monsters.ts), which is the one retune here that moved a band because a
 * PERSON asked for it rather than because a number drifted: his reading is that
 * the first map is too hard for a casual player.
 *
 *   kill    swamp boss 8.7s | forest 9.7s | coast 8.7s
 *   die     five-imp pack 8.8s | Warden phase 1 16.0s
 *
 * Killing got ~25% faster and dying got ~45% slower, in one pass, which is the
 * whole shape of the change: the bands below were widened to what it measured,
 * not what would have kept them green.
 *
 * Measured for gem levels (Tier 0, no gear, one rare template, bolt+ground
 * rotation): a gem 1 caster kills the reference rare in 7.7s, gem 20 in 3.2s,
 * a 2.4x speedup, short of the 3.03x that 19 steps of 6%-per-level damage
 * alone would give, because Cinder Ground's cost rose the same 4%/level and
 * it fires on its own 3s cooldown regardless of gem level, so at gem 20 mana
 * buys fewer of its casts inside the same fight. Bolt cast in isolation (no
 * target needed, mana never goes towards a kill) sustains forever at gem 1
 * (regen 15/s beats a 10-mana cost every second) and runs dry after 7 casts
 * at gem 20 (cost compounds to ~21, regen does not), the mana economy
 * actually capping a maxed gem, not merely a design intent.
 */

const HZ = 30;
const BOLT = "skill.ember_bolt.v1";
const GROUND = "skill.cinder_ground.v1";
const GROUND_CD = SKILLS.get(GROUND)!.cooldownTicks;
/**
 * Casts per second a player with a bottomless pool would land: the bolt's cast
 * time, which is longer than its cooldown and so the thing that actually gates
 * back-to-back casting. Mana is the only other thing in the way, which is what
 * makes the measured rate below a reading of the mana economy and nothing else.
 */
const BOLT_DEF = SKILLS.get(BOLT)!;
const CAST_CEILING = HZ / Math.max(BOLT_DEF.cooldownTicks, BOLT_DEF.castTicks ?? 0);
const BOLT_RADIUS = BOLT_DEF.effects.reduce(
  (r, e) => (e.type === "spawnProjectile" ? e.radiusFixed : r), 0,
);
const BOLT_RANGE = BOLT_DEF.effects.reduce(
  (r, e) => (e.type === "spawnProjectile" ? e.maxRangeFixed : r), 0,
);
/** Far enough that the monster has to close, near enough to be in every range. */
const SPAWN_Y = fp(6);

interface Rig { sim: Simulation; world: World; player: Entity }

/**
 * The lab rig, at a gem level. The legacy path (no `area` option) never
 * creates a session, and `gemLevelFor` reads gem levels off one, so gem 1
 * (its fallback) needs no session at all and every pre-existing call stays
 * on the untouched legacy path. A gem level above 1 gets the minimal session
 * a gem lookup needs: `area: "hideout"`, tier 0, no waystone. That is neutral
 * for outbound damage only: the time-to-kill bands measure the same fight with
 * or without it. A hideout session does change what monsters do to the player,
 * so the time-to-death bands must keep running session-less.
 */
function rig(gemLevel = 1): Rig {
  const { sim, world, playerEntity } = createCombatSim(7, { monsters: false });
  if (gemLevel > 1) {
    const sessionE = world.create();
    world.set<SessionC>(sessionE, "session", {
      area: "hideout", atlasSeed: 0, mapSeed: 0, waystoneSeed: 0,
      areaTier: 0, activeNodeId: "", completedNodes: [], portalsLeft: 0, mapOpen: 0, pendingArea: "",
    });
    world.set<SkillsC>(sessionE, "skills", {
      gems: { [BOLT]: { level: gemLevel, xp: 0 }, [GROUND]: { level: gemLevel, xp: 0 } },
      bar: [],
    });
  }
  return { sim, world, player: playerEntity };
}

function impDef() {
  return MONSTERS.get("monster.cinder_imp.v1")!;
}

function spawnImp({ world }: Rig, dx = 0, dy = 0): Entity {
  return spawnMonster(world, impDef(), dx, SPAWN_Y + dy, false);
}

function spawnWarden({ world }: Rig): Entity {
  return spawnMonster(world, MONSTERS.get("monster.cinder_warden.v1")!, fp(0), SPAWN_Y, false);
}

function nearestMonster(world: World): Position | undefined {
  let best: Position | undefined;
  let bestD2 = Infinity;
  for (const m of world.query("monster", "position")) {
    const p = world.get<Position>(m, "position")!;
    const d2 = p.x * p.x + p.y * p.y; // player stands at the origin
    if (d2 < bestD2) { best = p; bestD2 = d2; }
  }
  return best;
}

function cast(sim: Simulation, player: Entity, at: Position, skillId: string): Command[] {
  return [{ tick: sim.tick, entity: player, type: "useSkill", skillId, data: { tx: at.x, ty: at.y } }];
}

/**
 * Ticks until no monster is left standing, or Infinity if the player never
 * clears. The rig's player is made unkillable first: it stands in melee range
 * doing nothing to dodge, and a death would refill its mana (death.ts) and hand
 * the fight a second opening burst — which made time-to-kill move whenever a
 * defensive number changed. Offence is measured here, defence in ticksToDeath.
 *
 * `casts` counts the presses that actually landed. Mana is the only thing that
 * can drop it below CAST_CEILING here, so casts per second is the fight's action
 * density — the number the mana economy is tuned against, and one a fight of the
 * right length can still fail: 20 seconds of watching a bar refill measures the
 * same as 20 seconds of casting on every cooldown.
 */
function ticksToClear(
  { sim, world, player }: Rig,
  opts: { ground?: boolean; maxSecs?: number } = {},
): { ticks: number; casts: number } {
  const max = (opts.maxSecs ?? 90) * HZ;
  world.set<Health>(player, "health", { life: fp(1e6), maxLife: fp(1e6) });
  const mana = () => world.get<Mana>(player, "mana")!.mana;
  let casts = 0;
  for (let t = 1; t <= max; t++) {
    const target = nearestMonster(world);
    const skill = opts.ground !== false && sim.tick % GROUND_CD === 0 ? GROUND : BOLT;
    // Regen only ever adds, and it is smaller than the cheapest cost, so mana
    // falling across a step means exactly one cast was paid for.
    const before = mana();
    sim.step(target === undefined ? [] : cast(sim, player, target, skill));
    if (mana() < before) casts++;
    if (world.query("monster").length === 0) return { ticks: t, casts };
  }
  return { ticks: Infinity, casts };
}

/**
 * Bolts cast at a fixed point every tick the cooldown allows, no monster or
 * kill involved: purely the mana economy at this gem level. Returns the
 * count of casts that actually spent mana before the first attempt that was
 * off cooldown but refused for lack of mana, or `Infinity` if that never
 * happened inside `maxSecs`.
 */
function castsToDry(gemLevel: number, maxSecs: number): number {
  const { sim, world, player } = rig(gemLevel);
  const mana = () => world.get<Mana>(player, "mana")!.mana;
  const offCooldown = () => (world.get<Cooldowns>(player, "cooldowns")?.[BOLT] ?? 0) <= sim.tick;
  const at: Position = { x: fp(0), y: SPAWN_Y };
  let casts = 0;
  for (let t = 1; t <= maxSecs * HZ; t++) {
    const attempting = offCooldown();
    const before = mana();
    sim.step(cast(sim, player, at, BOLT));
    if (mana() < before) { casts++; continue; }
    if (attempting) return casts;
  }
  return Infinity;
}

/**
 * Ticks until the player dies while casting nothing. Life only ever falls (there
 * is no regeneration), so the tick it rises is the tick the death system revived
 * it — that is the death.
 */
function ticksToDeath({ sim, world, player }: Rig, maxSecs = 120): number {
  const life = () => world.get<Health>(player, "health")!.life;
  let prev = life();
  for (let t = 1; t <= maxSecs * HZ; t++) {
    sim.step([]);
    const now = life();
    if (now > prev) return t;
    prev = now;
  }
  return Infinity;
}

/** Push a boss past its phase-2 threshold using the lab's own chip damage. */
function forcePhase2(r: Rig): void {
  for (let i = 0; i < 3; i++) spawnLabActors(r.world, "hurtboss", 0, 0);
  r.sim.step([]); // bossAI reads the new life and transitions
}

/**
 * The one measurement the lab rig above cannot make: what a real map does to you
 * the moment you step out of the portal. It was measuring nothing while every
 * monster in the area walked at the entrance from the tick it was built — seven
 * of them, rare included, in contact within four seconds, at every tier. The lab
 * never saw it because it places its own monsters six units away on purpose.
 */
describe("stepping out of the portal", () => {
  const TIER = 3;

  function mapEntry(seed = 7) {
    const { sim, world, playerEntity, layout } = createCombatSim(seed, { area: "map", tier: TIER });
    return { sim, world, player: playerEntity, collision: gridCollision(layout.grid) };
  }

  /** The nearest monster the bolt can actually REACH from where the player is:
   *  a wall stops it now, so the nearest by straight-line distance is regularly
   *  one the shot cannot make. Swept at the bolt's own radius, not as a point —
   *  a monster clear to a hairline ray is regularly blocked to the real bolt. */
  function shootable(
    world: World,
    player: Entity,
    collision: ReturnType<typeof gridCollision>,
  ): Position | undefined {
    const pos = world.get<Position>(player, "position")!;
    let target: Position | undefined;
    let best = Infinity;
    for (const m of world.query("monster", "position")) {
      if (world.has(m, "boss")) continue;
      const p = world.get<Position>(m, "position")!;
      const d2 = (p.x - pos.x) ** 2 + (p.y - pos.y) ** 2;
      if (d2 > BOLT_RANGE * BOLT_RANGE) continue; // the bolt expires short of it
      const reach = sweep(collision, pos.x, pos.y, p.x - pos.x, p.y - pos.y, BOLT_RADIUS);
      if (reach.dx !== p.x - pos.x || reach.dy !== p.y - pos.y) continue;
      if (d2 < best) { best = d2; target = p; }
    }
    return target;
  }

  it("does not put the whole map on top of you", () => {
    const { sim, world, player } = mapEntry();
    const total = world.query("monster").length;
    expect(total).toBeGreaterThan(4); // there is a map to be swarmed by
    for (let t = 0; t < 8 * HZ; t++) sim.step([]);

    const h = world.get<Health>(player, "health")!;
    expect(h.life).toBe(h.maxLife);
    const asleep = world.query("monster").filter(
      (m) => world.get<MonsterC>(m, "monster")!.state === "idle",
    ).length;
    expect(asleep).toBeGreaterThanOrEqual(total - 1);
  });

  it("still lets a pack be pulled — one bolt is an invitation", () => {
    // Whether the portal cell itself has a firing line is chunk geometry, and it
    // changes with every layout change (it held on the 7x7 lattice and does not
    // on seed 7 of the 9x9 one). That is the SETUP; the assertion is what the
    // bolt does once a shot exists, so take the first map that offers one. If
    // entrances with a shot ever became rare, this loop is what would say so.
    let entry: ReturnType<typeof mapEntry> | undefined;
    let target: Position | undefined;
    for (let seed = 0; seed < 20 && target === undefined; seed++) {
      const candidate = mapEntry(seed);
      const shot = shootable(candidate.world, candidate.player, candidate.collision);
      if (shot) { entry = candidate; target = shot; }
    }
    expect(target, "no map in 20 offered a shot from its entrance").toBeDefined();
    const { sim, world, player } = entry!;
    const total = world.query("monster").length;
    sim.step(cast(sim, player, target!, BOLT));
    for (let t = 0; t < 6 * HZ; t++) sim.step([]);
    const awake = world.query("monster").filter(
      (m) => world.get<MonsterC>(m, "monster")!.state !== "idle",
    ).length;
    expect(awake).toBeGreaterThan(0);
    // One pack answers, not the map: the invitation has to stay an invitation.
    expect(awake).toBeLessThan(total);
  });
});

describe("time to kill", () => {
  it("a lone imp dies in under a second and a half", () => {
    const r = rig();
    spawnImp(r);
    expect(ticksToClear(r, { ground: false }).ticks / HZ).toBeLessThan(1.5);
  });

  it("a five-imp pack clears in under six seconds", () => {
    const r = rig();
    for (const [dx, dy] of [[-1.5, 0], [0, 0], [1.5, 0], [-0.75, 1.5], [0.75, 1.5]] as const) {
      spawnImp(r, fp(dx), fp(dy));
    }
    expect(ticksToClear(r).ticks / HZ).toBeLessThan(6);
  });

  it.each(RARE_TEMPLATES.map((t) => [t.element, t] as const))(
    "a %s rare takes between 2 and 12 seconds",
    (_element, template) => {
      const r = rig();
      spawnMonster(r.world, makeRare(impDef(), template), fp(0), SPAWN_Y, true);
      const secs = ticksToClear(r).ticks / HZ;
      expect(secs).toBeGreaterThan(2);
      expect(secs).toBeLessThan(12);
    },
  );

  /**
   * Every map ends on its biome's boss, and a map boss is a ~12 second fight —
   * that is the design intent, and it is the same intent in all four biomes. The
   * three added with the models are not tuned to their own bands: they share the
   * Warden's life and are held to the Warden's band, so a biome cannot quietly
   * become the fast one to farm.
   *
   * It was ~20 seconds until the cooldown retune, and the boss life behind it did
   * not move: Cinder Ground's field lasts 3 seconds, so putting its cooldown at 3
   * bought the same permanent uptime for a third of the mana, and the freed pool
   * pays for bolts. Bolt damage is not the lever here — doubling it takes the
   * fight to 7.7s, and shortening the field to 1.5s does not move it at all.
   */
  it.each(Object.entries(BOSSES))("the %s boss takes between 7 and 40 seconds", (_biome, defId) => {
    const r = rig();
    spawnMonster(r.world, MONSTERS.get(defId)!, fp(0), SPAWN_Y, false);
    const secs = ticksToClear(r).ticks / HZ;
    expect(secs).toBeGreaterThan(7);
    expect(secs).toBeLessThan(40);
  });

  const referenceRare = RARE_TEMPLATES[0]!;

  it("a gem 1 character kills the reference rare inside the existing band", () => {
    const r = rig(1);
    spawnMonster(r.world, makeRare(impDef(), referenceRare), fp(0), SPAWN_Y, true);
    const secs = ticksToClear(r).ticks / HZ;
    expect(secs).toBeGreaterThan(2);
    expect(secs).toBeLessThan(12);
  });

  it("a gem 20 character kills it well under half the time, and still spends mana", () => {
    const r1 = rig(1);
    spawnMonster(r1.world, makeRare(impDef(), referenceRare), fp(0), SPAWN_Y, true);
    const secs1 = ticksToClear(r1).ticks / HZ;

    const r20 = rig(20);
    spawnMonster(r20.world, makeRare(impDef(), referenceRare), fp(0), SPAWN_Y, true);
    const secs20 = ticksToClear(r20).ticks / HZ;

    // 19 steps of 6%-per-level damage alone is 3.03x; Cinder Ground's own cost
    // rising 4%/level on a fixed 3s cooldown eats into that inside one fight,
    // so the measured speedup lands short of the pure damage number.
    const speedup = secs1 / secs20;
    expect(speedup).toBeGreaterThan(2);
    expect(speedup).toBeLessThan(3);

    // The load-bearing half: mana costs rose 4%/level too, so a gem 20 caster
    // runs dry in fewer casts than a gem 1 one, even though the pool itself
    // did not grow. Bolt cast alone, no target needed: at gem 1 the 15/s regen
    // outpaces a 10-mana cost cast every second and it never runs dry inside
    // 30 seconds; at gem 20 the cost compounds past what regen replaces.
    expect(castsToDry(1, 30)).toBe(Infinity);
    const dry20 = castsToDry(20, 30);
    expect(dry20).toBeGreaterThan(3);
    expect(dry20).toBeLessThan(10);
  });
});

describe("mana economy", () => {
  // The Warden on purpose: it is the only fight long enough that the opening
  // full pool stops flattering the number and regeneration alone is paying.
  it("the Warden fight is spent casting, not waiting for the bar", () => {
    const r = rig();
    spawnWarden(r);
    const { ticks, casts } = ticksToClear(r);
    expect((casts * HZ) / ticks).toBeGreaterThan(CAST_CEILING / 2);
  });
});

describe("time to death, player standing still and doing nothing", () => {
  it("a lone imp needs at least fifteen seconds", () => {
    const r = rig();
    spawnImp(r);
    expect(ticksToDeath(r) / HZ).toBeGreaterThan(15);
  });

  it("a five-imp pack kills in four to twelve seconds", () => {
    const r = rig();
    for (const [dx, dy] of [[-1.5, 0], [0, 0], [1.5, 0], [-0.75, 1.5], [0.75, 1.5]] as const) {
      spawnImp(r, fp(dx), fp(dy));
    }
    const secs = ticksToDeath(r) / HZ;
    expect(secs).toBeGreaterThan(4);
    expect(secs).toBeLessThan(12);
  });

  it("the Warden's phase 1 kills in eight to twenty-two seconds", () => {
    const r = rig();
    spawnWarden(r);
    const secs = ticksToDeath(r) / HZ;
    expect(secs).toBeGreaterThan(8);
    expect(secs).toBeLessThan(22);
  });

  it("phase 2 is deadlier than phase 1, but still leaves three seconds to walk out", () => {
    const phase1 = (() => { const r = rig(); spawnWarden(r); return ticksToDeath(r); })();
    const r = rig();
    spawnWarden(r);
    forcePhase2(r);
    const ticks = ticksToDeath(r);
    expect(ticks).toBeLessThan(phase1);
    expect(ticks / HZ).toBeGreaterThan(3);
  });

  it("the phase-2 burning ground alone needs four seconds to burn a base life pool", () => {
    const ground = MONSTERS.get("monster.cinder_warden.v1")!.boss!.phase2.fireGround;
    const perTick = burningTickDamage({
      kind: "burning",
      stacks: ground.maxStacks,
      dpsFixed: ground.dpsFixed,
      expiryTick: 0,
    });
    const dps = (perTick * HZ) / AILMENT_TICK_INTERVAL;
    expect(baseCasterStats().maxLifeFixed / dps).toBeGreaterThan(4);
  });
});

/**
 * Spawn `count` monsters of `def` in a spread line at SPAWN_Y and return the
 * seconds until the reference player clears them all. Player is unkillable
 * (offence only), matching the contract of ticksToClear.
 */
function secondsToClearPack(def: MonsterDef, count: number): number {
  const r = rig();
  for (let i = 0; i < count; i++) {
    spawnMonster(r.world, def, fp((i - Math.floor(count / 2)) * 1.4), SPAWN_Y, false);
  }
  return ticksToClear(r).ticks / HZ;
}

/**
 * Spawn one socket of every species in the biome (PACK_COUNT per archetype)
 * and return the seconds until an idle, non-casting player dies. Models the
 * "worst pack room" for the biome at Tier 1 with no gear.
 */
function secondsToKillIdlePlayer(biomeId: BiomeId): number {
  const r = rig();
  let offset = 0;
  for (const entry of MONSTER_POOLS[biomeId]) {
    const def = MONSTERS.get(entry.defId)!;
    const count = PACK_COUNT[def.archetype];
    for (let i = 0; i < count; i++) {
      spawnMonster(r.world, def, fp((offset + i) * 1.5 - 2), SPAWN_Y, false);
    }
    offset += count;
  }
  return ticksToDeath(r) / HZ;
}

describe("archetype time-to-kill (Tier 1, reference character)", () => {
  const bands: Record<string, { defId: string; min: number; max: number }> = {
    // Trash drifted the other way from the bosses at the cooldown retune: a short
    // fight opens on a full mana pool, so halving the bolt's rate is not paid back
    // by the pool the boss fight lives off. Measured 4.0 / 5.5 / 3.4 / 6.7s.
    swarm:   { defId: "monster.vaal_husk.v1",      min: 2, max: 5 },
    brute:   { defId: "monster.vaal_construct.v1", min: 4, max: 7 },
    shooter: { defId: "monster.dune_spitter.v1",   min: 2, max: 5 },
    heavy:   { defId: "monster.blood_sentinel.v1", min: 3, max: 8 },
  };

  for (const [archetype, band] of Object.entries(bands)) {
    it(`${archetype} dies in ${band.min}-${band.max}s`, () => {
      const def = MONSTERS.get(band.defId)!;
      const count = PACK_COUNT[def.archetype];
      const seconds = secondsToClearPack(def, count);
      expect(seconds).toBeGreaterThanOrEqual(band.min);
      expect(seconds).toBeLessThanOrEqual(band.max);
    });
  }
});

it("a full biome pack kills a stationary reference character in under 12s", () => {
  // One socket of each of Vaal Stone's three archetypes (swarm+brute+heavy), no dodge.
  const seconds = secondsToKillIdlePlayer("vaal_stone");
  expect(seconds).toBeLessThan(12);
});
