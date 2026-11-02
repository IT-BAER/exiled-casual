// The eighteen class skills of spec 2026-11-01 §1, each cast from its real content
// def at gem level 1 in a small world, asserting the behaviour that defines it.
import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { resBlock } from "@exiled/content-schema";
import { MONSTERS, SKILLS } from "@exiled/content-runtime";
import { Simulation } from "../loop";
import { spawnMonster } from "../areas";
import { createCombatSim } from "../combat-sim";
import { damageCode } from "../damage-types";
import { activeStatuses, damageTakenPct, isStunned } from "../status";
import { registerResourceRegen } from "./resource";
import { registerSkillCast } from "./skill-cast";
import { registerPlayerMovement } from "./player-movement";
import { registerMonsterAI } from "./monster-ai";
import { registerProjectileMove } from "./projectile";
import { registerSkillArea } from "./skill-area";
import { registerGroundAreaTick } from "./ground-area";
import { registerAilmentTick } from "./ailment";
import { registerDamageResolve } from "./damage-resolve";
import { registerDeath, reviveVitals } from "./death";
import { registerExpiry } from "./expiry";
import type {
  BuffsC, CastingC, Cooldowns, DefensesC, Faction, GroundAreaC, Health, Mana, MonsterC, MoveDir, MoveTarget,
  PlayerC, Position, SessionC, SkillAreaC,
} from "../components";

const IMP = MONSTERS.get("monster.cinder_imp.v1")!;

function rig() {
  const sim = new Simulation();
  const ref = { active: null };
  registerResourceRegen(sim);
  registerSkillCast(sim, SKILLS, ref, 7);
  registerPlayerMovement(sim, ref);
  registerMonsterAI(sim, ref);
  registerProjectileMove(sim, ref);
  registerSkillArea(sim, ref);
  registerGroundAreaTick(sim);
  registerAilmentTick(sim);
  registerDamageResolve(sim);
  registerDeath(sim, ref);
  registerExpiry(sim);
  const w = sim.world;
  const p = w.create();
  w.set<Position>(p, "position", { x: 0, y: 0 });
  w.set<Health>(p, "health", { life: fp(100), maxLife: fp(100) });
  w.set<Mana>(p, "mana", { mana: fp(200), maxMana: fp(200), regen: 0 });
  w.set<Faction>(p, "faction", { team: 0 });
  w.set<PlayerC>(p, "player", { moveSpeed: fp(0.15), bodyRadius: fp(0.5) });
  w.set<Cooldowns>(p, "cooldowns", {});
  w.set<DefensesC>(p, "defenses", { res: resBlock(), armour: 0 });
  w.set<MoveTarget>(p, "moveTarget", { x: 0, y: 0, active: 0 });
  w.set<MoveDir>(p, "moveDir", { dx: 0, dy: 0, hx: 0, hy: 0 });
  /** An inert imp with `life` (default 1000, so no hit kills it). */
  const mob = (x: number, y: number, life = 1000) => {
    const e = spawnMonster(w, IMP, fp(x), fp(y), false);
    w.set<MonsterC>(e, "monster", { ...w.get<MonsterC>(e, "monster")!, inert: 1 });
    w.set<Health>(e, "health", { life: fp(life), maxLife: fp(life) });
    return e;
  };
  const press = (id: string, tx: number, ty: number) =>
    sim.step([{ tick: sim.tick, entity: p, type: "useSkill", skillId: `skill.${id}.v1`, data: { tx: fp(tx), ty: fp(ty) } }]);
  /** Press once and step until the wind-up has resolved. */
  const cast = (id: string, tx: number, ty: number) => {
    press(id, tx, ty);
    for (let i = 0; i < (SKILLS.get(`skill.${id}.v1`)!.castTicks ?? 0); i++) sim.step();
  };
  const steps = (n: number) => { for (let i = 0; i < n; i++) sim.step(); };
  const lost = (e: number, from = 1000) => from - (w.get<Health>(e, "health")?.life ?? 0) / 1000;
  const at = (e: number) => w.get<Position>(e, "position")!;
  const buff = (id: string) => w.get<BuffsC>(p, "buffs")?.list.find((b) => b.id === id);
  const statuses = (e: number) => activeStatuses(w, e, sim.tick).map((s) => s.id);
  return { sim, w, p, mob, press, cast, steps, lost, at, buff, statuses };
}

/** Wind-ups started while `id` is held for `ticks` ticks. */
function heldCasts(r: ReturnType<typeof rig>, id: string, ticks: number): number {
  let n = 0;
  for (let i = 0; i < ticks; i++) {
    const before = r.w.get<CastingC>(r.p, "casting");
    r.press(id, 10, 0);
    const after = r.w.get<CastingC>(r.p, "casting");
    if (after && after !== before && after.untilTick > r.sim.tick - 1) n++;
  }
  return n;
}

describe("buff speed quickens a repeat-beat skill", () => {
  it("Haste shortens a held Snap Shot's beat, not only its wind-up", () => {
    const plain = rig();
    const plainCasts = heldCasts(plain, "snap_shot", 195);

    const hasted = rig();
    hasted.cast("haste", 0, 0);
    expect(hasted.buff("haste")).toBeDefined();
    const hastedCasts = heldCasts(hasted, "snap_shot", 195);

    // 15-tick beat: 13 casts in 195 ticks. Haste's 15% cuts it to 13 ticks: 15.
    expect(plainCasts).toBe(13);
    expect(hastedCasts).toBe(15);
  });

  it("leaves a long true cooldown as authored", () => {
    const r = rig();
    r.cast("haste", 0, 0);
    const t = r.sim.tick;
    r.press("rain_of_arrows", 5, 0);
    expect(r.w.get<Cooldowns>(r.p, "cooldowns")!["skill.rain_of_arrows.v1"]).toBe(t + 120);
  });
});

describe("buffs across an area transition", () => {
  it("an aura and a timed buff survive hideout -> map -> hideout, and the aura still holds its mana", () => {
    const { sim, world, playerEntity: p } = createCombatSim(42, { area: "hideout", classId: "class.stalker" });
    const use = (id: string) => {
      sim.step([{ tick: sim.tick, entity: p, type: "useSkill", skillId: id, data: { tx: fp(3), ty: 0 } }]);
      for (let i = 0; i < 12; i++) sim.step([]);
    };
    use("skill.haste.v1");
    use("skill.blood_rage.v1");
    const ids = () => (world.get<BuffsC>(p, "buffs")?.list ?? []).map((b) => b.id).sort();
    expect(ids()).toEqual(["blood_rage", "haste"]);
    const until = world.get<BuffsC>(p, "buffs")!.list.find((b) => b.id === "blood_rage")!.untilTick;

    const sessionE = world.query("session")[0]!;
    const go = (area: "map" | "hideout") => {
      const s = world.get<SessionC>(sessionE, "session")!;
      world.set<SessionC>(sessionE, "session", { ...s, pendingArea: area });
      sim.step([]);
      expect(world.get<SessionC>(sessionE, "session")!.area).toBe(area);
    };
    go("map");
    expect(ids()).toEqual(["blood_rage", "haste"]);
    go("hideout");
    expect(ids()).toEqual(["blood_rage", "haste"]);
    expect(world.get<BuffsC>(p, "buffs")!.list.find((b) => b.id === "blood_rage")!.untilTick).toBe(until);

    // The aura's quarter is still held back from the pool after the crossing.
    for (let i = 0; i < 300; i++) sim.step([]);
    const m = world.get<Mana>(p, "mana")!;
    expect(m.mana).toBe(m.maxMana - Math.trunc((m.maxMana * 25) / 100));
    expect(ids()).toEqual(["haste"]);
  });

  it("a revive refills only the mana an aura leaves free", () => {
    const r = rig();
    r.cast("haste", 0, 0);
    r.w.set<Mana>(r.p, "mana", { ...r.w.get<Mana>(r.p, "mana")!, mana: 0 });
    reviveVitals(r.w, r.p);
    expect(r.w.get<Mana>(r.p, "mana")!.mana).toBe(fp(150));
  });
});

const FIRE = damageCode("fire");
const near = (a: number, b: number) => Math.abs(a - b) <= fp(0.05);
const areasOf = (r: ReturnType<typeof rig>, id: string) => r.w.query("skillArea")
  .map((e) => ({ ...r.w.get<SkillAreaC>(e, "skillArea")!, ...r.at(e) }))
  .filter((a) => a.skillId === `skill.${id}.v1`);
const groundsOf = (r: ReturnType<typeof rig>, id: string) => r.w.query("groundArea")
  .map((e) => ({ ...r.w.get<GroundAreaC>(e, "groundArea")!, ...r.at(e) }))
  .filter((g) => g.skillId === `skill.${id}.v1`);

describe("Ironsworn", () => {
  it("Infernal Cry scorches and taunts the ring round him and lifts his damage", () => {
    const r = rig();
    const close = r.mob(2, 0);
    const far = r.mob(7, 0);
    r.cast("infernal_cry", 1, 0);
    const s = activeStatuses(r.w, close, r.sim.tick).find((x) => x.id === "scorched");
    expect(s).toMatchObject({ damageTakenPct: 20, damageTakenType: FIRE });
    expect(r.statuses(far)).toEqual([]);
    expect(r.buff("infernal_cry")).toMatchObject({ damagePct: 25 });
  });

  it("Leap Slam lands at the aim and batters and throws back what is there", () => {
    const r = rig();
    const m = r.mob(8, 0);
    r.cast("leap_slam", 6, 0);
    r.steps(16);
    expect(near(r.at(r.p).x, fp(6))).toBe(true);
    expect(r.lost(m)).toBeGreaterThan(50);
    expect(r.at(m).x).toBeGreaterThan(fp(8.5));
  });

  it("Earthquake hits the cone now and erupts round the slam a second later, stunning it", () => {
    const r = rig();
    const front = r.mob(2, 0);
    const far = r.mob(4.2, 0);
    const behind = r.mob(-2.5, 0);
    r.cast("earthquake", 5, 0);
    expect(r.lost(front)).toBeGreaterThan(30);
    expect(r.lost(far)).toBe(0);
    r.steps(30);
    // The aftershock stands 1.5 ahead, where the slam landed: past the cone's reach, short of his back.
    expect(r.lost(far)).toBeGreaterThan(60);
    expect(isStunned(r.w.get<MonsterC>(far, "monster")!, r.sim.tick)).toBe(true);
    expect(r.lost(behind)).toBe(0);
  });

  it("Determination holds a quarter of the pool and takes 15% off a hit", () => {
    const r = rig();
    r.cast("determination", 0, 0);
    expect(r.w.get<Mana>(r.p, "mana")!.mana).toBe(fp(150));
    // damageResolve multiplies every hit by (100 + this) / 100.
    expect(damageTakenPct(r.w, r.p, FIRE, r.sim.tick)).toBe(-15);
  });

  it("Sunder rolls five bursts along the aim from a radius ahead, one every four ticks", () => {
    const r = rig();
    r.cast("sunder", 10, 0);
    const a = areasOf(r, "sunder");
    expect(a.map((x) => x.x)).toEqual([1, 2, 3, 4, 5].map((i) => fp(1.6) * i));
    expect(a.map((x) => x.impactTick - a[0]!.impactTick)).toEqual([0, 4, 8, 12, 16]);
  });

  it("Blood Rage speeds him up and drains life, never below 1", () => {
    const r = rig();
    r.w.set<Health>(r.p, "health", { life: fp(3), maxLife: fp(100) });
    r.cast("blood_rage", 0, 0);
    expect(r.buff("blood_rage")).toMatchObject({ speedPct: 25, moveSpeedPct: 10, drain: fp(5) });
    r.steps(90);
    expect(r.w.get<Health>(r.p, "health")!.life).toBe(fp(1));
  });
});

describe("Stalker", () => {
  it("Escape Shot hops back six units and its arrow bursts and chills at the aim", () => {
    const r = rig();
    const a = r.mob(5, 0);
    const b = r.mob(5, 1.2);
    r.cast("escape_shot", 8, 0);
    r.steps(30);
    expect(near(r.at(r.p).x, fp(-6))).toBe(true);
    expect(r.lost(a)).toBe(28);
    expect(r.lost(b)).toBe(28);
    expect(r.statuses(a)).toContain("chilled");
  });

  it("Ice Shot shatters on the first body and chills the one beside it", () => {
    const r = rig();
    const a = r.mob(6, 0);
    const b = r.mob(6, 1.4);
    r.cast("ice_shot", 10, 0);
    r.steps(20);
    expect(r.lost(a)).toBe(32);
    expect(r.lost(b)).toBe(32);
    expect(r.statuses(b)).toContain("chilled");
  });

  it("Sniper's Mark marks only the enemy nearest the aim", () => {
    const r = rig();
    const a = r.mob(5, 0);
    const b = r.mob(6, 1);
    r.cast("snipers_mark", 5, 0);
    expect(r.statuses(a)).toEqual(["marked"]);
    expect(r.statuses(b)).toEqual([]);
  });

  it("Lightning Arrow chains from its target to three more and no further", () => {
    const r = rig();
    const ms = [0, 3, 6, 9, 12].map((y) => r.mob(5, y));
    r.cast("lightning_arrow", 5, 0);
    r.steps(60);
    expect(ms.map((m) => r.lost(m))).toEqual([38, 38, 38, 38, 0]);
  });

  it("Rain of Arrows drops twelve arrows over the target, two ticks apart", () => {
    const r = rig();
    r.cast("rain_of_arrows", 6, 0);
    const a = areasOf(r, "rain_of_arrows");
    expect(a).toHaveLength(12);
    expect(a.map((x) => x.impactTick - a[0]!.impactTick)).toEqual(Array.from({ length: 12 }, (_, i) => 2 * i));
    for (const x of a) expect((x.x - fp(6)) ** 2 + x.y ** 2).toBeLessThanOrEqual(fp(3) ** 2);
  });

  it("Haste is an aura that reserves a quarter and switches off for free", () => {
    const r = rig();
    r.cast("haste", 0, 0);
    expect(r.buff("haste")).toMatchObject({ untilTick: 0, reservePct: 25, speedPct: 15, moveSpeedPct: 10 });
    r.press("haste", 0, 0); // still on cooldown: a held key does not undo the cast
    expect(r.buff("haste")).toBeDefined();
    r.steps(30);
    r.press("haste", 0, 0);
    expect(r.buff("haste")).toBeUndefined();
  });
});

describe("Emberbound", () => {
  it("Flame Dash rushes to the aim and leaves a burning trail behind", () => {
    const r = rig();
    r.cast("flame_dash", 7, 0);
    r.steps(7);
    expect(near(r.at(r.p).x, fp(7))).toBe(true);
    const trail = groundsOf(r, "flame_dash");
    expect(trail.length).toBeGreaterThanOrEqual(7);
    expect(trail.every((g) => g.ailmentKind === "burning")).toBe(true);
  });

  it("Ember Nova burns the ring round him and hurls it back", () => {
    const r = rig();
    const m = r.mob(2, 0);
    r.cast("ember_nova", 2, 0);
    r.steps(1);
    expect(r.lost(m)).toBe(30);
    expect(r.at(m).x).toBeGreaterThan(fp(3));
  });

  it("Flammability curses the area at the aim with fire damage taken", () => {
    const r = rig();
    const a = r.mob(8, 0);
    const b = r.mob(9, 1);
    const out = r.mob(14, 0);
    r.cast("flammability", 8, 0);
    for (const m of [a, b]) {
      expect(activeStatuses(r.w, m, r.sim.tick)[0]).toMatchObject({ id: "flammable", damageTakenPct: 25, damageTakenType: FIRE });
    }
    expect(r.statuses(out)).toEqual([]);
  });

  it("Solar Orb hovers at the aim and pulses fire through what stands under it", () => {
    const r = rig();
    const m = r.mob(6, 1);
    r.cast("solar_orb", 6, 0);
    const orb = groundsOf(r, "solar_orb");
    expect(orb).toHaveLength(1);
    expect(orb[0]!.pulse?.every).toBe(15);
    r.steps(60);
    expect(r.lost(m)).toBeGreaterThanOrEqual(48);
  });

  it("Firestorm calls ten meteors on the target, five ticks apart", () => {
    const r = rig();
    r.cast("firestorm", 6, 0);
    const a = areasOf(r, "firestorm");
    expect(a).toHaveLength(10);
    expect(a.map((x) => x.impactTick - a[0]!.impactTick)).toEqual(Array.from({ length: 10 }, (_, i) => 5 * i));
    for (const x of a) expect((x.x - fp(6)) ** 2 + x.y ** 2).toBeLessThanOrEqual(fp(3) ** 2);
  });

  it("Herald of Ash leaves burning ground where a kill falls", () => {
    const r = rig();
    r.cast("herald_of_ash", 0, 0);
    expect(r.buff("herald_of_ash")).toMatchObject({ damagePct: 15, reservePct: 25 });
    const m = r.mob(2, 0, 1);
    r.cast("ember_nova", 2, 0);
    r.steps(2);
    expect(r.w.alive.has(m) && (r.w.get<Health>(m, "health")?.life ?? 0) > 0).toBe(false);
    expect(groundsOf(r, "herald_of_ash")).toHaveLength(1);
  });
});
