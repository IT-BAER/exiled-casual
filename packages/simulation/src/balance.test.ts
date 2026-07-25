import { describe, expect, it } from "vitest";
import { fp } from "@exiled/fixed-point";
import { baseCasterStats, burningTickDamage, AILMENT_TICK_INTERVAL } from "@exiled/rules";
import { MONSTERS, SKILLS, RARE_TEMPLATES } from "@exiled/content-runtime";
import { makeRare } from "@exiled/rules";
import { createCombatSim, spawnLabActors } from "./combat-sim";
import { spawnMonster } from "./areas";
import { Simulation } from "./loop";
import type { Command } from "./loop";
import type { World, Entity } from "./ecs";
import type { Health, Position } from "./components";

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
 * Measured at the retune (Tier 0, no gear), so a future run has something to
 * compare against rather than only a band to clear:
 *
 *   kill    imp 0.5s | pack of five 1.2s | rare 2.6s (6.7s vs its own element)
 *           Cinder Warden 20.1s
 *   die     imp 26.0s | pack 6.6s | Warden phase 1 11.0s | phase 2 3.8s
 */

const HZ = 30;
const BOLT = "skill.ember_bolt.v1";
const GROUND = "skill.cinder_ground.v1";
const GROUND_CD = SKILLS.get(GROUND)!.cooldownTicks;
/** Far enough that the monster has to close, near enough to be in every range. */
const SPAWN_Y = fp(6);

interface Rig { sim: Simulation; world: World; player: Entity }

function rig(): Rig {
  const { sim, world, playerEntity } = createCombatSim(7, { monsters: false });
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
 */
function ticksToClear(
  { sim, world, player }: Rig,
  opts: { ground?: boolean; maxSecs?: number } = {},
): number {
  const max = (opts.maxSecs ?? 90) * HZ;
  world.set<Health>(player, "health", { life: fp(1e6), maxLife: fp(1e6) });
  for (let t = 1; t <= max; t++) {
    const target = nearestMonster(world);
    const skill = opts.ground !== false && sim.tick % GROUND_CD === 0 ? GROUND : BOLT;
    sim.step(target === undefined ? [] : cast(sim, player, target, skill));
    if (world.query("monster").length === 0) return t;
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

describe("time to kill", () => {
  it("a lone imp dies in under a second and a half", () => {
    const r = rig();
    spawnImp(r);
    expect(ticksToClear(r, { ground: false }) / HZ).toBeLessThan(1.5);
  });

  it("a five-imp pack clears in under six seconds", () => {
    const r = rig();
    for (const [dx, dy] of [[-1.5, 0], [0, 0], [1.5, 0], [-0.75, 1.5], [0.75, 1.5]] as const) {
      spawnImp(r, fp(dx), fp(dy));
    }
    expect(ticksToClear(r) / HZ).toBeLessThan(6);
  });

  it.each(RARE_TEMPLATES.map((t) => [t.element, t] as const))(
    "a %s rare takes between 2 and 12 seconds",
    (_element, template) => {
      const r = rig();
      spawnMonster(r.world, makeRare(impDef(), template), fp(0), SPAWN_Y, true);
      const secs = ticksToClear(r) / HZ;
      expect(secs).toBeGreaterThan(2);
      expect(secs).toBeLessThan(12);
    },
  );

  it("the Cinder Warden takes between 15 and 40 seconds", () => {
    const r = rig();
    spawnWarden(r);
    const secs = ticksToClear(r) / HZ;
    expect(secs).toBeGreaterThan(15);
    expect(secs).toBeLessThan(40);
  });
});

describe("time to death, player standing still and doing nothing", () => {
  it("a lone imp needs at least fifteen seconds", () => {
    const r = rig();
    spawnImp(r);
    expect(ticksToDeath(r) / HZ).toBeGreaterThan(15);
  });

  it("a five-imp pack kills in three to eight seconds", () => {
    const r = rig();
    for (const [dx, dy] of [[-1.5, 0], [0, 0], [1.5, 0], [-0.75, 1.5], [0.75, 1.5]] as const) {
      spawnImp(r, fp(dx), fp(dy));
    }
    const secs = ticksToDeath(r) / HZ;
    expect(secs).toBeGreaterThan(3);
    expect(secs).toBeLessThan(8);
  });

  it("the Warden's phase 1 kills in six to fifteen seconds", () => {
    const r = rig();
    spawnWarden(r);
    const secs = ticksToDeath(r) / HZ;
    expect(secs).toBeGreaterThan(6);
    expect(secs).toBeLessThan(15);
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
