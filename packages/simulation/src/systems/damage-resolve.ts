import { applyDamage, bossChargeSteps, absorbWithEnergyShield, ES_RECHARGE_DELAY_TICKS } from "@exiled/rules";
import { Simulation } from "../loop";
import type {
  Health, DefensesC, FlasksC, EnergyShieldC, MonsterC, SessionC, Position, CastingC,
} from "../components";
import { damageTypeOf } from "../damage-types";

/** Spawn grace: 10 seconds at 30 Hz, or until the player moves or casts. */
export const SPAWN_GRACE_TICKS = 300;

export function registerDamageResolve(sim: Simulation): void {
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

      const after = Math.max(0, health.life - toLife);
      world.set<Health>(ev.target, "health", { ...health, life: after });

      // Being shot is the other way to notice someone (monster-ai.ts owns the
      // first: walking into earshot). Without this, a pack outside the aggro
      // radius can be killed from off screen while it sleeps through it. The
      // boss writes its own state every tick, so it is left alone.
      const mon = world.get<MonsterC>(ev.target, "monster");
      if (mon?.state === "idle" && !world.has(ev.target, "boss")) {
        world.set<MonsterC>(ev.target, "monster", { ...mon, state: "chase" });
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
