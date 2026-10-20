import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { scalePct, effectiveSkill, applyDamage } from "@exiled/rules";
import { SKILLS } from "@exiled/content-runtime";
import { resBlock, type Item } from "@exiled/content-schema";
import { newCharacter } from "./playtest";
import { spawnLabActors } from "./combat-sim";
import { recomputePlayerStats } from "./derived";
import { damageCode } from "./damage-types";
import type { BotGame as Game } from "./bot";
import type {
  CastingC, Cooldowns, DamageEvent, DefensesC, EquipmentC, Health, OffenseC, Position, ProjectileC,
} from "./components";

const STRIKE = "skill.strike.v1";
const SNAP = "skill.snap_shot.v1";
const BOLT = "skill.ember_bolt.v1";
const SPARK = "skill.ember_spark.v1";

function arm(g: Game, slot: string, item: Item | undefined): void {
  const eq = g.world.get<EquipmentC>(g.session, "equipment")!;
  g.world.set<EquipmentC>(g.session, "equipment", { slots: { ...eq.slots, [slot]: item } });
  recomputePlayerStats(g.world, { refill: true });
}

/** One imp a metre in front of him, with no armour and the given resistances. */
function target(g: Game, res: Partial<Record<"fire" | "cold", number>> = {}): number {
  const me = g.world.get<Position>(g.player, "position")!;
  spawnLabActors(g.world, "imp", 0, 0);
  const e = g.world.query("monster").at(-1)!;
  g.world.set<Position>(e, "position", { x: me.x + fp(1), y: me.y });
  g.world.set<DefensesC>(e, "defenses", { res: { ...resBlock(), ...res }, armour: 0 });
  g.world.set<Health>(e, "health", { life: fp(100000), maxLife: fp(100000) });
  return e;
}

/** Cast once at the target and play the hit out; returns every damage event the player sent. */
function castAt(g: Game, skillId: string, at: number): { events: DamageEvent[]; tick: number } {
  const events: DamageEvent[] = [];
  const enqueue = g.sim.enqueueDamage.bind(g.sim);
  g.sim.enqueueDamage = (e: DamageEvent) => {
    if (e.source === g.player) events.push(e);
    enqueue(e);
  };
  const p = g.world.get<Position>(at, "position")!;
  const tick = g.sim.tick;
  g.sim.step([{ tick, entity: g.player, type: "useSkill", skillId, data: { tx: p.x, ty: p.y } }]);
  for (let i = 0; i < 40 && events.length === 0; i++) g.sim.step([]);
  // Every part of one hit is enqueued in the same tick.
  return { events, tick };
}

const amount = (skillId: string) => {
  const e = effectiveSkill(SKILLS.get(skillId)!, 1).effects[0]!;
  return (e as { damage: { amountFixed: number } }).damage.amountFixed;
};
/** The hit is either plain or a crit, and the crit roll is the seed's business. */
const hitOrCrit = (v: number) => [v, v * 2];

const hammer = (affixes: { affixId: string; value: number }[]): Item =>
  ({ baseId: "base.ironsworn_hammer", rarity: "rare", itemLevel: 10, affixes });

describe("weapon damage reaches the attack", () => {
  it("starter gear hits exactly as the skill is authored: one part, its own type, its own cooldown", () => {
    const g = newCharacter("class.ironsworn", 3);
    const imp = target(g);
    const { events, tick } = castAt(g, STRIKE, imp);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe(damageCode("physical"));
    expect(hitOrCrit(amount(STRIKE))).toContain(events[0]!.amountFixed);
    expect(g.world.get<Cooldowns>(g.player, "cooldowns")![STRIKE]).toBe(tick + SKILLS.get(STRIKE)!.cooldownTicks);
  });

  it("a Stalker's starter bow looses the authored arrow, with nothing extra on it", () => {
    const g = newCharacter("class.stalker", 3);
    const imp = target(g);
    const p = g.world.get<Position>(imp, "position")!;
    g.sim.step([{ tick: g.sim.tick, entity: g.player, type: "useSkill", skillId: SNAP, data: { tx: p.x, ty: p.y } }]);
    let proj: ProjectileC | undefined;
    for (let i = 0; i < 20 && !proj; i++) {
      g.sim.step([]);
      const e = g.world.query("projectile")[0];
      proj = e === undefined ? undefined : g.world.get<ProjectileC>(e, "projectile");
    }
    expect(proj).toBeDefined();
    expect(hitOrCrit(amount(SNAP))).toContain(proj!.damageAmount);
    expect(proj!.extraDamage).toBeUndefined();
  });

  it("the wind-up of a starter attack carries no weapon field, so a starter replay serializes as before", () => {
    const g = newCharacter("class.ironsworn", 3);
    const imp = target(g);
    const p = g.world.get<Position>(imp, "position")!;
    g.sim.step([{ tick: g.sim.tick, entity: g.player, type: "useSkill", skillId: STRIKE, data: { tx: p.x, ty: p.y } }]);
    const casting = g.world.get<CastingC>(g.player, "casting")!;
    expect(Object.keys(casting)).not.toContain("hit");
  });

  it("an Ironsworn's hammer with +12 physical and 40% increased hits for (25 + 30) / (6 + 10) of Strike", () => {
    const g = newCharacter("class.ironsworn", 3);
    arm(g, "weapon1", hammer([{ affixId: "affix.added_phys", value: 12 }, { affixId: "affix.phys_dmg_pct", value: 40 }]));
    const imp = target(g);
    const { events } = castAt(g, STRIKE, imp);
    expect(events).toHaveLength(1);
    // (6 + 12) * 1.4 = 25, (10 + 12) * 1.4 = 30, against the starter's 6-10.
    expect(hitOrCrit(Math.trunc((amount(STRIKE) * 55) / 16))).toContain(events[0]!.amountFixed);
  });

  it("a weapon's fire is a fire part of the same hit, and fire resistance reduces only that part", () => {
    const g = newCharacter("class.ironsworn", 3);
    arm(g, "weapon1", hammer([{ affixId: "affix.fire_dmg", value: 9 }]));
    const imp = target(g, { fire: 50 });
    const before = g.world.get<Health>(imp, "health")!.life;
    const { events } = castAt(g, STRIKE, imp);
    g.sim.step([]);
    const phys = events.find((e) => e.type === damageCode("physical"))!;
    const fire = events.find((e) => e.type === damageCode("fire"))!;
    const crit = phys.amountFixed === amount(STRIKE) ? 1 : 2;
    expect(phys.amountFixed).toBe(amount(STRIKE) * crit);
    // 2 * 9 / (6 + 10) of the authored hit, at the same effectiveness as the weapon's physical.
    expect(fire.amountFixed).toBe(Math.trunc((amount(STRIKE) * 18) / 16) * crit);
    const lost = before - g.world.get<Health>(imp, "health")!.life;
    const resolved = (e: DamageEvent, type: "physical" | "fire") =>
      applyDamage({ type, amountFixed: e.amountFixed }, { resPct: { ...resBlock(), fire: 50 }, armourFixed: 0 });
    expect(lost).toBe(resolved(phys, "physical") + resolved(fire, "fire"));
    expect(resolved(fire, "fire")).toBeLessThan(fire.amountFixed);
  });

  it("an arrow from a bow with cold damage lands as a physical part and a cold part", () => {
    const g = newCharacter("class.stalker", 3);
    arm(g, "weapon1", { baseId: "base.stalker_bow", rarity: "magic", itemLevel: 1, affixes: [{ affixId: "affix.cold_dmg", value: 6 }] });
    const imp = target(g);
    const { events } = castAt(g, SNAP, imp);
    expect(events.map((e) => e.type)).toEqual([damageCode("physical"), damageCode("cold")]);
    const crit = events[0]!.amountFixed === amount(SNAP) ? 1 : 2;
    // 2 * 6 over the starter bow's 6 + 9.
    expect(events[1]!.amountFixed).toBe(Math.trunc((amount(SNAP) * 12) / 15) * crit);
  });

  it("a faster weapon shortens an attack's cooldown by the attack-speed ratio, rounded", () => {
    const g = newCharacter("class.ironsworn", 3);
    // Broadsword 1.55 APS against the hammer's 1.45: 21 * 145 / 155 = 19.6 -> 20.
    arm(g, "weapon1", { baseId: "base.ironsworn_broadsword", rarity: "normal", itemLevel: 1, affixes: [] });
    const imp = target(g);
    const { tick } = castAt(g, STRIKE, imp);
    expect(g.world.get<Cooldowns>(g.player, "cooldowns")![STRIKE]).toBe(tick + 20);
  });

  it("an Emberbound wand's fire adds to Ember Bolt at 100% and to Ember Spark at 60%", () => {
    const wand = (fire: number): Item => ({ baseId: "base.ember_kindling_wand", rarity: "magic", itemLevel: 1,
      affixes: fire ? [{ affixId: "affix.fire_dmg", value: fire }] : [] });
    for (const [skill, eff] of [[BOLT, 100], [SPARK, 60]] as const) {
      const g = newCharacter("class.emberbound", 3);
      arm(g, "weapon1", wand(20));
      const inc = g.world.get<OffenseC>(g.player, "offense")?.spellDamagePct ?? 0;
      const imp = target(g);
      const { events } = castAt(g, skill, imp);
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe(damageCode("fire"));
      const expected = scalePct(amount(skill) + Math.trunc((fp(20) * eff) / 100), inc);
      expect(hitOrCrit(expected), skill).toContain(events[0]!.amountFixed);
    }
  });
});
