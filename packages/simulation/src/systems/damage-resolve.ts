import {
  applyDamage, bossChargeSteps, absorbWithEnergyShield, ES_RECHARGE_DELAY_TICKS, applySingleAilment,
} from "@exiled/rules";
import { MONSTERS } from "@exiled/content-runtime";
import type { MonsterDef } from "@exiled/content-schema";
import { Simulation } from "../loop";
import type {
  Health, DefensesC, FlasksC, EnergyShieldC, MonsterC, SessionC, Position, CastingC, RollC, AilmentC,
} from "../components";
import { ROLL_AVOID_TICKS } from "./player-movement";
import { damageTypeOf } from "../damage-types";
import { BURNING_SOURCE, RECAP_WINDOW_TICKS } from "../death-recap";
import type { World } from "../ecs";
import type { DamageEvent } from "../components";
import { toNumber } from "@exiled/fixed-point";
import { alertPack } from "./monster-ai";
import { createStream, type RandomStream } from "../rng";

/** Spawn grace: 10 seconds at 30 Hz, or until the player moves or casts. */
export const SPAWN_GRACE_TICKS = 300;

export function registerDamageResolve(
  sim: Simulation,
  seed = 0,
  monsters: ReadonlyMap<string, MonsterDef> = MONSTERS,
): void {
  // One stream for every on-hit ailment roll, drawn only when the hitter's
  // species has an onHit: a run with no applier consumes nothing.
  const ailmentRolls = createStream(seed, "ailment");
  sim.register("damageResolve", (world, tick) => {
    // Maintain the spawn grace every tick, not only when damage arrives: the
    // break is one-way, so "he cast three seconds ago" must already have
    // cleared it by the time the next hit asks.
    const sessionE = world.query("session")[0];
    const session = sessionE !== undefined
      ? world.get<SessionC>(sessionE, "session")! : undefined;
    let graced = false;
    if (session?.graceUntilTick) {
      const p = world.query("player")[0];
      const pos = p !== undefined ? world.get<Position>(p, "position") : undefined;
      const casting = p !== undefined ? world.get<CastingC>(p, "casting") : undefined;
      const broken =
        tick >= session.graceUntilTick ||
        pos === undefined ||
        pos.x !== session.graceX || pos.y !== session.graceY ||
        (casting !== undefined && casting.untilTick > tick);
      if (broken) {
        const { graceUntilTick: _u, graceX: _x, graceY: _y, ...rest } = session;
        world.set<SessionC>(sessionE!, "session", rest);
      } else {
        graced = true;
      }
    }
    const q = sim.damageQueue
      .slice()
      .sort((a, b) =>
        a.target !== b.target ? a.target - b.target :
        a.source !== b.source ? a.source - b.source :
        a.type - b.type,
      );
    sim.damageQueue = [];

    for (const ev of q) {
      // Spawn grace swallows the hit entirely: no life, no shield, no recharge
      // delay. The monster still noticed him when it decided to attack.
      if (graced && world.has(ev.target, "player")) continue;
      // The opening of a roll is the same total swallow, but only for a single
      // hit, a slam's included: burning ground and ailments outlast any roll.
      if (ev.via !== undefined && world.has(ev.target, "player")) {
        const roll = world.get<RollC>(ev.target, "roll");
        if (roll && tick - roll.startTick < ROLL_AVOID_TICKS) continue;
      }
      const health = world.get<Health>(ev.target, "health");
      const def = world.get<DefensesC>(ev.target, "defenses");
      if (!health || !def) continue;

      const final = applyDamage(
        { type: damageTypeOf(ev.type), amountFixed: ev.amountFixed },
        { resPct: def.res, armourFixed: def.armour },
      );
      // Energy shield stands in front of life and pays double for chaos. Every
      // hit that touches the shield — even one it fully stops — pushes the
      // recharge back, which is what makes the pool a reward for disengaging.
      let toLife = final;
      const shield = world.get<EnergyShieldC>(ev.target, "energyShield");
      if (shield && shield.maxEs > 0) {
        const split = absorbWithEnergyShield(final, shield.es, damageTypeOf(ev.type) === "chaos");
        toLife = split.toLife;
        world.set<EnergyShieldC>(ev.target, "energyShield", {
          ...shield,
          es: Math.max(0, shield.es - split.esCost),
          rechargeAtTick: tick + ES_RECHARGE_DELAY_TICKS,
        });
      }

      if (health.life > 0 && final > 0 && world.has(ev.target, "player")) recordHit(sim, world, ev, final, tick);
      if (health.life > 0 && ev.source !== ev.target && world.has(ev.target, "player")) {
        applyOnHit(world, monsters, ailmentRolls, ev, tick);
      }

      const after = Math.max(0, health.life - toLife);
      world.set<Health>(ev.target, "health", { ...health, life: after });

      // Being shot is the other way to notice someone (monster-ai.ts owns the
      // first: walking into earshot). Without this, a pack outside the aggro
      // radius can be killed from off screen while it sleeps through it. The
      // boss writes its own state every tick, so it is left alone.
      const mon = world.get<MonsterC>(ev.target, "monster");
      if (mon?.state === "idle" && !world.has(ev.target, "boss")) {
        world.set<MonsterC>(ev.target, "monster", { ...mon, state: "chase" });
        alertPack(world, ev.target);
      }

      // A boss pays flask charges as it bleeds, not when it dies: see
      // FLASK_BOSS_CHARGE_STEPS. Stateless — the hit knows both sides of itself.
      if (world.has(ev.target, "boss")) {
        const steps = bossChargeSteps(health.life, after, health.maxLife);
        if (steps > 0) {
          for (const pe of world.query("player", "flasks")) {
            const f = world.get<FlasksC>(pe, "flasks")!;
            world.set<FlasksC>(pe, "flasks", {
              ...f,
              lifeCharges: Math.min(f.lifeMax, f.lifeCharges + steps),
              manaCharges: Math.min(f.manaMax, f.manaCharges + steps),
            });
          }
        }
      }
    }
  });
}

/**
 * The hitter's onHit ailment, rolled on the pre-mitigation hit. A dead hitter
 * (a bolt or slam outliving its monster) has no species left, so rolls nothing.
 */
function applyOnHit(
  world: World, monsters: ReadonlyMap<string, MonsterDef>, rolls: RandomStream, ev: DamageEvent, tick: number,
): void {
  const mon = world.get<MonsterC>(ev.source, "monster");
  const onHit = mon ? monsters.get(mon.defId)?.onHit : undefined;
  if (!onHit || rolls.nextInt(0, 99) >= onHit.chancePct) return;
  const kind = onHit.ailment;
  const prev = world.get<AilmentC>(ev.target, kind);
  const live = prev ? { dpsFixed: prev.dps, expiryTick: prev.expiryTick } : undefined;
  const next = applySingleAilment(kind, live, ev.amountFixed, damageTypeOf(ev.type), tick);
  if (next === undefined || next === live) return;
  world.set<AilmentC>(ev.target, kind, { kind, stacks: 1, dps: next.dpsFixed, expiryTick: next.expiryTick });
}

/** The death screen's memory. A DoT names its victim as source; a dead shooter has no species left. */
function recordHit(sim: Simulation, world: World, ev: DamageEvent, final: number, tick: number): void {
  const mon = ev.source === ev.target ? undefined : world.get<MonsterC>(ev.source, "monster");
  const species = ev.source !== ev.target ? (mon?.defId ?? "")
    : ev.ailment !== undefined ? `ailment.${ev.ailment}` : BURNING_SOURCE;
  const hits = sim.recentHits.filter((h) => h.tick > tick - RECAP_WINDOW_TICKS);
  hits.push({ tick, species, rare: mon?.rare === 1, type: ev.type, amount: toNumber(final) });
  sim.recentHits = hits;
}
