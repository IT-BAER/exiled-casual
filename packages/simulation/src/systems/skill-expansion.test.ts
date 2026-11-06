// The class-skill expansion's sim mechanics (spec 2026-11-01 §2), each proved on
// test-local SkillDefs through the real systems in their canonical order.
import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { resBlock, type SkillDef, type EffectNode } from "@exiled/content-schema";
import { MONSTERS, SKILLS } from "@exiled/content-runtime";
import { effectiveSkill } from "@exiled/rules";
import { isToWorker } from "@exiled/protocol";
import { Simulation } from "../loop";
import { gridCollision, type CollisionRef } from "../collision";
import { makeGrid } from "../test-grid";
import { spawnMonster } from "../areas";
import { createCombatSim, spawnLabActors } from "../combat-sim";
import { applyDevOp } from "../dev-ops";
import { buildSnapshot, effectLines } from "../protocol-bridge";
import { checksumWorld } from "../checksum";
import { applyStatus, monsterSpeed } from "../status";
import { registerResourceRegen } from "./resource";
import { registerSkillCast } from "./skill-cast";
import { registerPlayerMovement } from "./player-movement";
import { registerMonsterAI } from "./monster-ai";
import { registerBossAI } from "./boss-ai";
import { registerProjectileMove } from "./projectile";
import { registerSkillArea } from "./skill-area";
import { registerGroundAreaTick } from "./ground-area";
import { registerAilmentTick } from "./ailment";
import { registerDamageResolve } from "./damage-resolve";
import { registerDeath } from "./death";
import { registerExpiry } from "./expiry";
import type {
  BuffsC, Cooldowns, DefensesC, Faction, GroundAreaC, Health, Mana, MonsterC, MoveDir, MoveTarget, PlayerC,
  Position, SkillAreaC, StatusesC, TravelC,
} from "../components";

const IMP = MONSTERS.get("monster.cinder_imp.v1")!;
const WARDEN = MONSTERS.get("monster.cinder_warden.v1")!;
const FIRE = (n: number) => ({ type: "fire" as const, amountFixed: fp(n) });

function skill(id: string, effects: EffectNode[], extra: Partial<SkillDef> = {}): SkillDef {
  return {
    id: `skill.${id}.v1`, name: id, unlockLevel: 1, manaCostFixed: 0, cooldownTicks: 0,
    growth: { perLevel: { damagePct: 0, manaPct: 0 }, breakpoints: [] }, effects, ...extra,
  };
}

function rig(defs: SkillDef[], grid?: string[], seed = 7) {
  const sim = new Simulation();
  const ref: CollisionRef = { active: grid ? gridCollision(makeGrid(grid)) : null };
  registerResourceRegen(sim);
  registerSkillCast(sim, new Map(defs.map((d) => [d.id, d])), ref, seed);
  registerPlayerMovement(sim, ref);
  registerMonsterAI(sim, ref);
  registerBossAI(sim, MONSTERS, ref);
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
  w.set<Mana>(p, "mana", { mana: fp(100), maxMana: fp(100), regen: 0 });
  w.set<Faction>(p, "faction", { team: 0 });
  w.set<PlayerC>(p, "player", { moveSpeed: fp(0.15), bodyRadius: fp(0.5) });
  w.set<Cooldowns>(p, "cooldowns", {});
  w.set<DefensesC>(p, "defenses", { res: resBlock(), armour: 0 });
  w.set<MoveTarget>(p, "moveTarget", { x: 0, y: 0, active: 0 });
  w.set<MoveDir>(p, "moveDir", { dx: 0, dy: 0, hx: 0, hy: 0 });
  const mob = (x: number, y: number, inert = true, def = IMP) => {
    const e = spawnMonster(w, def, fp(x), fp(y), false);
    if (inert) w.set<MonsterC>(e, "monster", { ...w.get<MonsterC>(e, "monster")!, inert: 1 });
    return e;
  };
  const cast = (id: string, tx: number, ty: number) =>
    sim.step([{ tick: sim.tick, entity: p, type: "useSkill", skillId: `skill.${id}.v1`, data: { tx: fp(tx), ty: fp(ty) } }]);
  const life = (e: number) => w.get<Health>(e, "health")?.life;
  const at = (e: number) => w.get<Position>(e, "position")!;
  return { sim, w, p, mob, cast, life, at };
}

describe("areaHit", () => {
  it("lands an instant disc the tick it is cast, as an entity that lives one tick more", () => {
    const r = rig([skill("nova", [{ type: "areaHit", at: "self", radiusFixed: fp(2), damage: FIRE(10) }])]);
    const imp = r.mob(1, 0);
    const far = r.mob(4, 0);
    r.cast("nova", 1, 0);
    expect(r.life(imp)).toBe(fp(30));
    expect(r.life(far)).toBe(fp(40));
    const areas = r.w.query("skillArea");
    expect(areas).toHaveLength(1);
    expect(r.w.get<SkillAreaC>(areas[0]!, "skillArea")!.spentTick).toBe(0);
    r.sim.step();
    expect(r.w.query("skillArea")).toHaveLength(0);
  });

  it("clamps to its range, steps each impact along the aim and lands them on their own ticks", () => {
    const r = rig([skill("sunder", [{
      type: "areaHit", at: "target", radiusFixed: fp(1), damage: FIRE(5), maxRangeFixed: fp(4),
      delayTicks: 3, count: 3, intervalTicks: 2, stepFixed: fp(2),
    }])]);
    r.cast("sunder", 10, 0);
    const areas = r.w.query("skillArea").map((e) => ({ ...r.w.get<SkillAreaC>(e, "skillArea")!, ...r.at(e) }));
    expect(areas.map((a) => [a.x, a.y, a.impactTick, a.index])).toEqual([
      [fp(4), 0, 3, 0], [fp(6), 0, 5, 1], [fp(8), 0, 7, 2],
    ]);
    const snap = buildSnapshot(r.w, r.sim, r.sim.tick, "test");
    const wire = snap.entities.filter((e) => e.kind === "skillArea");
    expect(wire.map((e) => [e.x, e.impactIn, e.index, e.dirX, e.skillId])).toEqual([
      [4, 2 / 30, 0, 1, "skill.sunder.v1"], [6, 4 / 30, 1, 1, "skill.sunder.v1"], [8, 6 / 30, 2, 1, "skill.sunder.v1"],
    ]);
    const imp = r.mob(6, 0);
    for (let i = 0; i < 4; i++) r.sim.step();
    expect(r.life(imp)).toBe(fp(40));
    r.sim.step(); // tick 5: the second impact
    expect(r.life(imp)).toBe(fp(35));
  });

  it("hits with repeatDamagePct of its damage on every impact after the first", () => {
    const r = rig([skill("quake", [{
      type: "areaHit", at: "target", radiusFixed: fp(1), damage: FIRE(20), count: 3, intervalTicks: 2, repeatDamagePct: 25,
    }])]);
    const imp = r.mob(2, 0);
    r.cast("quake", 2, 0);
    expect(r.life(imp)).toBe(fp(20));
    r.sim.step();
    r.sim.step();
    expect(r.life(imp)).toBe(fp(15));
    r.sim.step();
    r.sim.step();
    expect(r.life(imp)).toBe(fp(10));
  });

  it("Faultline at gem 15: the second aftershock lands for 15% of the first", () => {
    const quake = effectiveSkill(SKILLS.get("skill.earthquake.v1")!, 15);
    const r = rig([{ ...quake, castTicks: 0 }]);
    const dummy = r.mob(1.5, 0);
    r.w.set<Health>(dummy, "health", { life: fp(10000), maxLife: fp(10000) });
    r.w.set<DefensesC>(dummy, "defenses", { res: resBlock(), armour: 0 });
    r.cast("earthquake", 1.5, 0);
    const afterSlam = r.life(dummy)!;
    for (let i = 0; i < 30; i++) r.sim.step();
    const afterFirst = r.life(dummy)!;
    for (let i = 0; i < 15; i++) r.sim.step();
    const afterSecond = r.life(dummy)!;
    const first = afterSlam - afterFirst;
    const second = afterFirst - afterSecond;
    expect(first).toBeGreaterThan(0);
    expect(second / first).toBeGreaterThan(0.14);
    expect(second / first).toBeLessThan(0.16);
  });

  it("scatters impacts inside the disc, the same way on the same seed", () => {
    const def = skill("rain", [{
      type: "areaHit", at: "target", radiusFixed: fp(0.5), count: 12, scatterFixed: fp(2),
    }]);
    const spots = (seed: number) => {
      const r = rig([def], undefined, seed);
      r.cast("rain", 5, 0);
      return r.w.query("skillArea").map((e) => r.at(e));
    };
    const a = spots(7);
    expect(spots(7)).toEqual(a);
    expect(new Set(a.map((s) => `${s.x},${s.y}`)).size).toBeGreaterThan(1);
    for (const s of a) expect((s.x - fp(5)) ** 2 + s.y ** 2).toBeLessThanOrEqual(fp(2) ** 2);
    expect(spots(8)).not.toEqual(a);
  });

  it("hits only inside a cone along the aim", () => {
    const r = rig([skill("quake", [{
      type: "areaHit", at: "self", radiusFixed: fp(3), shape: "cone", arcDegrees: 90, damage: FIRE(10),
    }])]);
    const front = r.mob(2, 0.5);
    const back = r.mob(-2, 0);
    const side = r.mob(0, 2.5);
    r.cast("quake", 5, 0);
    expect([r.life(front), r.life(back), r.life(side)]).toEqual([fp(30), fp(40), fp(40)]);
  });

  it("knocks back away from the centre and stops at a wall", () => {
    const grid = ["..........", "..........", ".....#....", "..........", ".........."].map((row) => row.replace("#", "#"));
    const wall = grid.map((row) => row.slice(0, 5) + "#" + row.slice(6));
    const r = rig([skill("slam", [{ type: "areaHit", at: "self", radiusFixed: fp(3), knockbackFixed: fp(5) }])], wall);
    r.w.set<Position>(r.p, "position", { x: fp(1), y: fp(2) });
    const imp = r.mob(3, 2);
    r.cast("slam", 3, 2);
    const x = r.at(imp).x;
    expect(x).toBeGreaterThan(fp(3));
    expect(x).toBeLessThanOrEqual(fp(4));
    expect(r.at(imp).y).toBe(fp(2));
  });

  it("stuns: a stunned chaser does not move until it wears off; a boss shrugs the stun and halves a slow", () => {
    const r = rig([skill("stun", [{ type: "areaHit", at: "self", radiusFixed: fp(5), stunTicks: 10 }])]);
    const imp = r.mob(4, 0, false);
    const boss = r.mob(-30, 0, true, WARDEN);
    r.cast("stun", 4, 0);
    const held = r.at(imp);
    expect(r.w.get<MonsterC>(imp, "monster")!.stunnedUntilTick).toBe(10);
    expect(buildSnapshot(r.w, r.sim, r.sim.tick, "t").entities.find((e) => e.id === imp)!.stunned).toBe(true);
    for (let i = 0; i < 9; i++) r.sim.step();
    expect(r.at(imp)).toEqual(held);
    r.sim.step();
    r.sim.step();
    expect(r.at(imp).x).toBeLessThan(held.x);
    applyStatus(r.w, boss, { statusId: "chilled", durationTicks: 30, slowPct: 40, stunTicks: 30 }, r.sim.tick);
    expect(r.w.get<MonsterC>(boss, "monster")!.stunnedUntilTick).toBeUndefined();
    expect(r.w.get<StatusesC>(boss, "statuses")!.list[0]!.slowPct).toBe(20);
  });
});

describe("statuses on monsters", () => {
  it("a chill slows the walk by its percent, through the one speed helper", () => {
    const r = rig([]);
    const slowed = r.mob(6, 0, false);
    const free = r.mob(-6, 0, false);
    applyStatus(r.w, slowed, { statusId: "chilled", durationTicks: 60, slowPct: 50 }, 0);
    const base = r.w.get<MonsterC>(free, "monster")!.moveSpeed;
    expect(monsterSpeed(r.w, slowed, base, 0)).toBe(Math.trunc(base / 2));
    r.sim.step();
    expect(fp(6) - r.at(slowed).x).toBe(Math.trunc(base / 2));
    expect(r.at(free).x + fp(6)).toBe(base);
  });

  it("refreshes the same id and adds damage taken only for its type, before resistance", () => {
    const r = rig([
      skill("firenova", [{ type: "areaHit", at: "self", radiusFixed: fp(15), damage: FIRE(10) }]),
      skill("coldnova", [{ type: "areaHit", at: "self", radiusFixed: fp(15), damage: { type: "cold", amountFixed: fp(10) } }]),
    ]);
    const imp = r.mob(10, 0);
    applyStatus(r.w, imp, { statusId: "flammable", durationTicks: 30, damageTakenPct: 50, damageTakenType: 0 }, 0);
    applyStatus(r.w, imp, { statusId: "flammable", durationTicks: 60, damageTakenPct: 50, damageTakenType: 0 }, 0);
    expect(r.w.get<StatusesC>(imp, "statuses")!.list).toEqual([
      { id: "flammable", untilTick: 60, damageTakenPct: 50, damageTakenType: 0 },
    ]);
    r.cast("firenova", 1, 0);
    expect(r.life(imp)).toBe(fp(25));
    r.cast("coldnova", 1, 0);
    expect(r.life(imp)).toBe(fp(15));
    expect(buildSnapshot(r.w, r.sim, r.sim.tick, "t").entities.find((e) => e.id === imp)!.statuses).toEqual(["flammable"]);
  });

  it("a single mark takes only the enemy nearest the aim; a taunt wakes the struck and alerts the pack", () => {
    const r = rig([
      skill("mark", [{
        type: "applyStatus", at: "target", radiusFixed: fp(3), single: 1, statusId: "marked", durationTicks: 90,
        damageTakenPct: 30,
      }]),
      skill("cry", [{ type: "applyStatus", at: "self", radiusFixed: fp(21), statusId: "taunted", durationTicks: 60, taunt: 1 }]),
    ]);
    const near = r.mob(5.5, 0);
    const other = r.mob(6.5, 1);
    r.cast("mark", 5, 0);
    expect(r.w.has(near, "statuses")).toBe(true);
    expect(r.w.has(other, "statuses")).toBe(false);
    const a = r.mob(20, 0, false);
    const b = r.mob(23, 0, false);
    r.cast("cry", 20, 0);
    expect(r.w.get<StatusesC>(a, "statuses")!.list[0]!.id).toBe("taunted");
    expect(r.w.has(b, "statuses")).toBe(false);
    expect(r.w.get<MonsterC>(a, "monster")!.state).toBe("chase");
    expect(r.w.get<MonsterC>(b, "monster")!.state).toBe("chase");
  });
});

describe("buffs and auras", () => {
  const rage = skill("rage", [{ type: "applyBuff", buffId: "blood_rage", durationTicks: 30, damagePct: 50, moveSpeedPct: 100 }]);
  const aura = skill("haste", [{ type: "applyBuff", buffId: "haste", durationTicks: 0, reserveManaPct: 25 }], { cooldownTicks: 30 });
  const hit = skill("hit", [{ type: "areaHit", at: "self", radiusFixed: fp(5), damage: FIRE(10) }]);

  it("a timed buff refreshes rather than stacks, adds damage and move speed, and runs out", () => {
    const r = rig([rage, hit]);
    const imp = r.mob(2, 0);
    r.cast("rage", 1, 0);
    r.sim.step();
    r.cast("rage", 1, 0);
    expect(r.w.get<BuffsC>(r.p, "buffs")!.list).toEqual([
      { id: "blood_rage", skillId: "skill.rage.v1", untilTick: 32, damagePct: 50, moveSpeedPct: 100 },
    ]);
    r.cast("hit", 1, 0);
    expect(r.life(imp)).toBe(fp(25));
    // He faces the cast's aim (+x) already, so the step is a full one, doubled.
    r.sim.step([{ tick: r.sim.tick, entity: r.p, type: "moveDir", data: { dx: 1, dy: 0 } }]);
    expect(r.at(r.p).x).toBe(fp(0.3));
    const snap = buildSnapshot(r.w, r.sim, r.sim.tick, "t");
    expect(snap.player.buffs).toContainEqual({ id: "blood_rage", kind: "buff", remainingSec: 1, lines: ["50% increased Damage", "100% increased Movement Speed"] });
    while (r.sim.tick <= 32) r.sim.step();
    expect(r.w.has(r.p, "buffs")).toBe(false);
  });

  it("life regenerates and drains per second, and drain stops at 1 life", () => {
    const r = rig([
      skill("regen", [{ type: "applyBuff", buffId: "regen", durationTicks: 300, lifeRegenPerSecFixed: fp(30) }]),
      skill("drain", [{ type: "applyBuff", buffId: "drain", durationTicks: 300, lifeDrainPerSecFixed: fp(30) }]),
    ]);
    r.w.set<Health>(r.p, "health", { life: fp(50), maxLife: fp(100) });
    r.cast("regen", 1, 0);
    for (let i = 0; i < 30; i++) r.sim.step();
    expect(r.life(r.p)).toBe(fp(80));
    r.w.remove(r.p, "buffs");
    r.w.set<Health>(r.p, "health", { life: fp(10), maxLife: fp(100) });
    r.cast("drain", 1, 0);
    for (let i = 0; i < 60; i++) r.sim.step();
    expect(r.life(r.p)).toBe(fp(1));
  });

  it("an aura reserves mana, caps regeneration, toggles off without mana and is refused when the pool cannot hold it", () => {
    const r = rig([aura]);
    r.w.set<Mana>(r.p, "mana", { mana: fp(100), maxMana: fp(100), regen: fp(5) });
    r.cast("haste", 1, 0);
    expect(r.w.get<Mana>(r.p, "mana")!.mana).toBe(fp(75));
    r.sim.step();
    expect(r.w.get<Mana>(r.p, "mana")!.mana).toBe(fp(75));
    const snap = buildSnapshot(r.w, r.sim, r.sim.tick, "t");
    expect(snap.player.manaReserved).toBe(25);
    const shown = snap.player.buffs?.find((b) => b.id === "haste");
    expect(shown).toMatchObject({ kind: "buff", remainingSec: 0, aura: true, reserved: 25 });
    expect(shown?.lines?.[0]).toBe("Aura: reserves 25% of maximum Mana");
    r.w.set<Cooldowns>(r.p, "cooldowns", {});
    r.cast("haste", 1, 0); // off
    expect(r.w.has(r.p, "buffs")).toBe(false);
    // The key is still down: the client re-sends it next snapshot, which must not switch it back on.
    r.cast("haste", 1, 0);
    expect(r.w.has(r.p, "buffs")).toBe(false);
    expect(r.w.get<Mana>(r.p, "mana")!.mana).toBe(fp(80));
    r.w.set<Cooldowns>(r.p, "cooldowns", {});
    r.w.set<Mana>(r.p, "mana", { mana: fp(20), maxMana: fp(100), regen: 0 });
    r.cast("haste", 1, 0); // refused: 20 cannot hold 25
    expect(r.w.has(r.p, "buffs")).toBe(false);
    expect(r.w.get<Cooldowns>(r.p, "cooldowns")!["skill.haste.v1"]).toBeUndefined();
    expect(r.w.get<Mana>(r.p, "mana")!.mana).toBe(fp(20));
  });

  it("a held aura key does not undo the cast it just made; a press after the cooldown does", () => {
    const r = rig([aura]);
    r.cast("haste", 1, 0);
    expect(r.w.has(r.p, "buffs")).toBe(true);
    for (let i = 0; i < 10; i++) r.cast("haste", 1, 0); // the client re-sends a held key every snapshot
    expect(r.w.has(r.p, "buffs")).toBe(true);
    while (r.sim.tick < 31) r.sim.step();
    r.cast("haste", 1, 0);
    expect(r.w.has(r.p, "buffs")).toBe(false);
  });

  it("damage taken on the player is floored at a tenth", () => {
    const r = rig([skill("wall", [{ type: "applyBuff", buffId: "determination", durationTicks: 0, damageTakenPct: -95 }])]);
    r.cast("wall", 1, 0);
    r.mob(1, 0, false);
    r.sim.step();
    expect(r.life(r.p)).toBe(fp(100) - Math.trunc(IMP.attackDamage.amountFixed / 10));
  });

  it("a herald's kill leaves its burning ground on the corpse", () => {
    const burning = { kind: "burning" as const, stacksPerApply: 1, dpsFixed: fp(5), durationTicks: 60, maxStacks: 3 };
    const r = rig([
      skill("herald", [{
        type: "applyBuff", buffId: "herald_of_ash", durationTicks: 0,
        onKillGround: { radiusFixed: fp(1.5), durationTicks: 60, ailment: burning },
      }]),
      hit,
    ]);
    r.cast("herald", 1, 0);
    const imp = r.mob(2, 0);
    r.w.set<Health>(imp, "health", { life: fp(1), maxLife: fp(40) });
    r.cast("hit", 1, 0);
    expect(r.w.alive.has(imp)).toBe(false);
    const g = r.w.query("groundArea");
    expect(g).toHaveLength(1);
    expect(r.at(g[0]!)).toEqual({ x: fp(2), y: 0 });
    expect(r.w.get<GroundAreaC>(g[0]!, "groundArea")!.skillId).toBe("skill.herald.v1");
  });
});

describe("travel", () => {
  const leap = skill("leap", [{
    type: "travel", distanceFixed: fp(6), ticks: 4,
    arrival: { radiusFixed: fp(1.5), damage: FIRE(10), knockbackFixed: fp(1) },
  }]);
  const dash = skill("dash", [{
    type: "travel", distanceFixed: fp(4), ticks: 4,
    trail: {
      spacingFixed: fp(1), radiusFixed: fp(0.5), durationTicks: 60,
      ailment: { kind: "burning", stacksPerApply: 1, dpsFixed: fp(4), durationTicks: 30, maxStacks: 3 },
    },
  }]);
  const hop = skill("hop", [{ type: "travel", distanceFixed: fp(3), ticks: 3, direction: "away" }]);
  const bolt = skill("bolt", [{ type: "areaHit", at: "self", radiusFixed: fp(1), damage: FIRE(1) }], { cooldownTicks: 5 });

  it("leaps to a nearer aim, holds moves and casts, lands its arrival, then obeys the last move", () => {
    const r = rig([leap, bolt]);
    const imp = r.mob(4, 1);
    r.cast("leap", 4, 0);
    expect(r.w.get<TravelC>(r.p, "travel")!.untilTick).toBe(4);
    const snap = buildSnapshot(r.w, r.sim, r.sim.tick, "t");
    expect(snap.player.travel).toEqual({ skillId: "skill.leap.v1", ticks: 4, elapsed: 1, dirX: 1, dirY: 0 });
    r.cast("bolt", 0, 0);
    expect(r.w.get<Cooldowns>(r.p, "cooldowns")!["skill.bolt.v1"]).toBeUndefined();
    r.sim.step([{ tick: r.sim.tick, entity: r.p, type: "moveTo", data: { x: fp(4), y: fp(3) } }]);
    expect(r.w.get<TravelC>(r.p, "travel")!.pending).toEqual({ type: "moveTo", data: { x: fp(4), y: fp(3) } });
    r.sim.step();
    expect(r.at(r.p)).toEqual({ x: fp(4), y: 0 });
    expect(r.life(imp)).toBe(fp(30));
    expect(r.at(imp).y).toBe(fp(2));
    r.sim.step();
    expect(r.w.has(r.p, "travel")).toBe(false);
    expect(r.w.get<MoveTarget>(r.p, "moveTarget")).toMatchObject({ x: fp(4), y: fp(3), active: 1 });
  });

  it("stops at a wall instead of sliding along it", () => {
    const grid = Array.from({ length: 5 }, () => "...#......");
    const r = rig([leap], grid);
    r.w.set<Position>(r.p, "position", { x: fp(1), y: fp(2) });
    r.cast("leap", 7, 2);
    for (let i = 0; i < 4; i++) r.sim.step();
    expect(r.at(r.p).x).toBeLessThanOrEqual(fp(2));
    expect(r.at(r.p).y).toBe(fp(2));
  });

  it("hops away from the aim, and a dash lays a trail of burning patches", () => {
    const r = rig([hop, dash]);
    r.cast("hop", 5, 0);
    for (let i = 0; i < 3; i++) r.sim.step();
    expect(r.at(r.p)).toEqual({ x: -fp(3), y: 0 });
    r.cast("dash", -3, 10);
    for (let i = 0; i < 4; i++) r.sim.step();
    expect(r.at(r.p)).toEqual({ x: -fp(3), y: fp(4) });
    const patches = r.w.query("groundArea").map((e) => r.at(e).y);
    expect(patches).toEqual([0, fp(1), fp(2), fp(3), fp(4)]);
  });
});

describe("ground and projectiles", () => {
  it("a pulsing patch hits on its own beat and slows what stands in it", () => {
    const r = rig([skill("orb", [{
      type: "spawnGroundArea", radiusFixed: fp(2), durationTicks: 60,
      pulse: { damage: FIRE(5), everyTicks: 10 }, slowPct: 40,
    }])]);
    const imp = r.mob(4, 0);
    r.cast("orb", 4, 0);
    expect(r.life(imp)).toBe(fp(35));
    expect(r.w.get<StatusesC>(imp, "statuses")!.list[0]).toMatchObject({ id: "chilled", slowPct: 40 });
    for (let i = 0; i < 9; i++) r.sim.step();
    expect(r.life(imp)).toBe(fp(35));
    r.sim.step();
    expect(r.life(imp)).toBe(fp(30));
    expect(r.w.has(imp, "ailment")).toBe(false);
  });

  const arrow = (extra: object) => skill("arrow", [{
    type: "spawnProjectile", speedPerSecFixed: fp(30), radiusFixed: fp(0.3), maxRangeFixed: fp(20), damage: FIRE(10), ...extra,
  } as EffectNode]);

  it("explodes onto every other enemy round the struck body and leaves its status", () => {
    const r = rig([arrow({ explodeRadiusFixed: fp(1.5), onHit: { statusId: "chilled", durationTicks: 60, slowPct: 30 } })]);
    const a = r.mob(3, 0);
    const b = r.mob(3, 1.8);
    const c = r.mob(3, 4);
    r.cast("arrow", 3, 0);
    for (let i = 0; i < 4; i++) r.sim.step();
    expect([r.life(a), r.life(b), r.life(c)]).toEqual([fp(30), fp(30), fp(40)]);
    expect(r.w.get<StatusesC>(b, "statuses")!.list[0]!.id).toBe("chilled");
  });

  it("chains to the nearest enemy not yet hit, once per chain", () => {
    const r = rig([arrow({ chainCount: 1, chainRangeFixed: fp(5) })]);
    const a = r.mob(3, 0);
    const c = r.mob(3, 4);
    const d = r.mob(3, -8);
    r.cast("arrow", 3, 0);
    for (let i = 0; i < 12; i++) r.sim.step();
    expect([r.life(a), r.life(c), r.life(d)]).toEqual([fp(30), fp(30), fp(40)]);
  });
});

describe("render edges", () => {
  it("a chained bolt names the body it left", () => {
    const r = rig([skill("arrow", [{
      type: "spawnProjectile", speedPerSecFixed: fp(30), radiusFixed: fp(0.3), maxRangeFixed: fp(20), damage: FIRE(10),
      chainCount: 1, chainRangeFixed: fp(5),
    } as EffectNode])]);
    const a = r.mob(3, 0);
    r.mob(3, 4);
    r.cast("arrow", 3, 0);
    const chained: (number | undefined)[] = [];
    for (let i = 0; i < 6; i++) {
      r.sim.step();
      for (const e of buildSnapshot(r.w, r.sim, r.sim.tick, "t").entities) if (e.kind === "projectile" && e.chainFrom !== undefined) chained.push(e.chainFrom);
    }
    expect(chained.length).toBeGreaterThan(0);
    expect(new Set(chained)).toEqual(new Set([a]));
  });

  it("every resolved cast stamps its release edge, which no checksum sees", () => {
    const r = rig([skill("cry", [{ type: "applyBuff", buffId: "cry", durationTicks: 30, damagePct: 10 }], { castTicks: 3 })]);
    r.cast("cry", 0, 0);
    expect(buildSnapshot(r.w, r.sim, r.sim.tick, "t").player.castRelease).toBeUndefined();
    const before = checksumWorld(r.w);
    r.w.set(r.p, "castRelease", { tick: 999, skill: "x" });
    expect(checksumWorld(r.w)).toBe(before);
    r.w.remove(r.p, "castRelease");
    for (let i = 0; i < 4; i++) r.sim.step();
    expect(buildSnapshot(r.w, r.sim, r.sim.tick, "t").player.castRelease).toEqual({ skillId: "skill.cry.v1", tick: 3 });
  });

  it("a status cast leaves a marker where it landed, even on nobody, that hurts no one", () => {
    const r = rig([skill("curse", [{
      type: "applyStatus", at: "target", radiusFixed: fp(3), maxRangeFixed: fp(18), statusId: "flammable", durationTicks: 90,
    }])]);
    const far = r.mob(15, 0);
    r.cast("curse", 6, 0);
    const marks = buildSnapshot(r.w, r.sim, r.sim.tick, "t").entities.filter((e) => e.kind === "skillArea");
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ x: 6, y: 0, radius: 3, skillId: "skill.curse.v1", spent: true });
    const near = r.mob(6, 0);
    r.cast("curse", 6, 0);
    r.sim.step();
    expect(r.life(near)).toBe(r.w.get<Health>(near, "health")!.maxLife);
    expect(r.life(far)).toBe(r.w.get<Health>(far, "health")!.maxLife);
    for (let i = 0; i < 3; i++) r.sim.step();
    expect(r.w.query("skillArea")).toHaveLength(0);
  });
});

describe("old worlds", () => {
  it("serialize unchanged until an expansion effect writes something", () => {
    const a = createCombatSim(3);
    const b = createCombatSim(3);
    for (let i = 0; i < 40; i++) { a.sim.step(); b.sim.step(); }
    expect(checksumWorld(a.world)).toBe(checksumWorld(b.world));
    for (const c of ["buffs", "statuses", "travel", "skillArea"]) expect(a.world.componentNames()).not.toContain(c);
  });
});

describe("lab tools", () => {
  it("dummies stand inert in two rows in front of him, at ten times the life, and clear removes them", () => {
    const g = createCombatSim(1, { monsters: false });
    g.world.set<MoveDir>(g.playerEntity, "moveDir", { dx: 0, dy: 0, hx: fp(1), hy: 0 });
    spawnLabActors(g.world, "dummy", 0, 0, 7);
    const dummies = g.world.query("monster");
    expect(dummies).toHaveLength(7);
    const before = dummies.map((e) => ({ ...g.world.get<Position>(e, "position")! }));
    for (const p of before) {
      expect(p.x).toBeGreaterThan(fp(3));
      const d2 = p.x * p.x + p.y * p.y;
      expect(d2).toBeGreaterThanOrEqual(fp(4.9) ** 2);
      expect(d2).toBeLessThanOrEqual(fp(7.1) ** 2);
    }
    expect(g.world.get<Health>(dummies[0]!, "health")!.maxLife).toBe(IMP.maxLifeFixed * 10);
    for (let i = 0; i < 90; i++) g.sim.step();
    expect(dummies.map((e) => g.world.get<Position>(e, "position"))).toEqual(before);
    expect(g.world.get<Health>(g.playerEntity, "health")!.life).toBe(g.world.get<Health>(g.playerEntity, "health")!.maxLife);
    spawnLabActors(g.world, "clear", 0, 0);
    expect(g.world.query("monster")).toHaveLength(0);
  });

  it("refill readies every cooldown and fills life and the unreserved mana", () => {
    const g = createCombatSim(1, { area: "hideout" });
    const p = g.playerEntity;
    g.world.set<Cooldowns>(p, "cooldowns", { "skill.x.v1": 999 });
    const h = g.world.get<Health>(p, "health")!;
    const m = g.world.get<Mana>(p, "mana")!;
    g.world.set<Health>(p, "health", { ...h, life: 1 });
    g.world.set<Mana>(p, "mana", { ...m, mana: 0 });
    g.world.set<BuffsC>(p, "buffs", { list: [{ id: "haste", skillId: "skill.haste.v1", untilTick: 0, reservePct: 20 }] });
    applyDevOp(g.world, { op: "refill" });
    expect(g.world.get<Cooldowns>(p, "cooldowns")).toEqual({});
    expect(g.world.get<Health>(p, "health")!.life).toBe(h.maxLife);
    expect(g.world.get<Mana>(p, "mana")!.mana).toBe(m.maxMana - Math.trunc((m.maxMana * 20) / 100));
  });

  it("home puts him back at the lab start facing +y with seven dummies and nothing else standing", () => {
    const g = createCombatSim(1, { area: "hideout", monsters: false });
    const p = g.playerEntity;
    spawnLabActors(g.world, "pack", fp(9), fp(9));
    g.world.set<Position>(p, "position", { x: fp(9), y: fp(-4) });
    g.world.set<MoveTarget>(p, "moveTarget", { x: fp(12), y: fp(12), active: 1 });
    g.world.set<MoveDir>(p, "moveDir", { dx: fp(1), dy: 0, hx: fp(1), hy: 0 });
    g.world.set<TravelC>(p, "travel", { dx: fp(1), dy: 0, ticksLeft: 5 } as unknown as TravelC);
    g.world.set<Cooldowns>(p, "cooldowns", { "skill.x.v1": 999 });
    const h = g.world.get<Health>(p, "health")!;
    g.world.set<Health>(p, "health", { ...h, life: 1 });
    applyDevOp(g.world, { op: "home" });
    expect(g.world.get<Position>(p, "position")).toEqual({ x: 0, y: 0 });
    expect(g.world.has(p, "travel")).toBe(false);
    expect(g.world.get<MoveTarget>(p, "moveTarget")!.active).toBe(0);
    expect(g.world.get<MoveDir>(p, "moveDir")).toEqual({ dx: 0, dy: 0, hx: 0, hy: fp(1) });
    const mobs = g.world.query("monster");
    expect(mobs).toHaveLength(7);
    for (const e of mobs) {
      expect(g.world.get<MonsterC>(e, "monster")!.inert).toBe(1);
      expect(g.world.get<Position>(e, "position")!.y).toBeGreaterThan(fp(3));
    }
    expect(g.world.get<Cooldowns>(p, "cooldowns")).toEqual({});
    expect(g.world.get<Health>(p, "health")!.life).toBe(h.maxLife);
  });

  it("the spawn message takes a dummy count", () => {
    expect(isToWorker({ type: "spawn", what: "dummy", count: 9 })).toBe(true);
    expect(isToWorker({ type: "spawn", what: "dummy" })).toBe(true);
    expect(isToWorker({ type: "spawn", what: "dummy", count: 0 })).toBe(false);
    expect(isToWorker({ type: "spawn", what: "dummy", count: 1.5 })).toBe(false);
  });
});

describe("describeSkills lines", () => {
  it("words every new effect's numbers", () => {
    expect(effectLines({
      type: "areaHit", at: "target", radiusFixed: fp(1.5), delayTicks: 30, count: 5, intervalTicks: 3, stunTicks: 15,
      onHit: { statusId: "chilled", durationTicks: 60, slowPct: 30 },
    })).toEqual([
      "Area radius is 1.5 metres", "Lands after 1 seconds", "5 impacts, one every 0.1 seconds", "Stuns for 0.5 seconds",
      "Inflicts Chilled for 2 seconds", "Chilled enemies are 30% slower",
    ]);
    expect(effectLines({
      type: "areaHit", at: "target", radiusFixed: fp(3), count: 2, intervalTicks: 15, repeatDamagePct: 10,
    })).toEqual(["Area radius is 3 metres", "2 impacts, one every 0.5 seconds", "Every impact after the first deals 10% of the damage"]);
    expect(effectLines({ type: "areaHit", at: "target", radiusFixed: fp(3), repeatDamagePct: 10 }))
      .toEqual(["Area radius is 3 metres"]);
    expect(effectLines({ type: "applyBuff", buffId: "haste", durationTicks: 0, reserveManaPct: 25, speedPct: 20 }))
      .toEqual(["Aura: reserves 25% of maximum Mana", "20% increased Attack and Cast Speed"]);
    expect(effectLines({
      type: "applyStatus", at: "target", radiusFixed: fp(2), statusId: "flammable", durationTicks: 120,
      damageTakenPct: 25, damageTakenType: "fire",
    })).toEqual([
      "Area radius is 2 metres", "Inflicts Flammable for 4 seconds", "Flammable enemies take 25% increased Fire Damage",
    ]);
    expect(effectLines({ type: "travel", distanceFixed: fp(3), ticks: 6, direction: "away" })).toEqual(["Leaps back 3 metres"]);
    expect(effectLines({
      type: "spawnProjectile", speedPerSecFixed: 1, radiusFixed: 1, maxRangeFixed: 1, damage: FIRE(1),
      chainCount: 3, chainRangeFixed: fp(6),
    })).toEqual(["Chains 3 times within 6 metres"]);
  });
});
